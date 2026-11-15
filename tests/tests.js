/*
 * Tests for the error propagation engine. Each expected answer is worked out
 * independently (by hand / textbook formulas), not by the engine itself.
 * Run:  ./tests/run.sh        (or open tests.html in a browser)
 */
(function (root) {
  'use strict';
  const EP = root.ErrorProp;
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  function near(got, want, label) {
    const tol = 1e-9 * Math.max(1, Math.abs(want));
    if (!(Math.abs(got - want) <= tol)) throw new Error((label || '') + ' got ' + got + ', expected ' + want);
  }
  function same(got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error('got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
  }
  function throwsMsg(fn, part) {
    try { fn(); } catch (e) {
      if (!(e instanceof EP.InputError)) throw new Error('wrong error type: ' + e.message);
      if (part && !e.message.includes(part)) throw new Error('message "' + e.message + '" lacks "' + part + '"');
      return;
    }
    throw new Error('expected an error');
  }
  const v = (name, value, unc, type) => ({ name, value, unc, type: type || 'abs' });
  const calc = (eq, vars, opts) => EP.calculate(eq, vars, opts);
  const D = Math.PI / 180;

  // ----- Propagation -----
  test('pendulum g = 4π²L/T²', () => {
    const r = calc('g = 4*pi^2*L/T^2', [v('L', 0.5, 0.002), v('T', 1.42, 0.03)]);
    const g = (4 * Math.PI ** 2 * 0.5) / 1.42 ** 2;
    near(r.value, g, 'value');
    near(r.sigma, g * Math.sqrt((0.002 / 0.5) ** 2 + ((2 * 0.03) / 1.42) ** 2), 'sigma');
    same(r.name, 'g');
  });
  test('sum adds in quadrature', () => {
    const r = calc('x + y', [v('x', 2, 0.1), v('y', 3, 0.2)]);
    near(r.value, 5); near(r.sigma, Math.sqrt(0.05));
  });
  test('difference adds in quadrature', () => {
    near(calc('x - y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, Math.sqrt(0.05));
  });
  test('product: relative errors in quadrature', () => {
    near(calc('x*y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, 6 * Math.hypot(0.05, 0.2 / 3));
  });
  test('quotient: relative errors in quadrature', () => {
    near(calc('x/y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, (2 / 3) * Math.hypot(0.05, 0.2 / 3));
  });
  test('power x^3 triples relative error', () => {
    const r = calc('x^3', [v('x', 2, 0.1)]);
    near(r.value, 8); near(r.sigma, 1.2);
  });
  test('ln(x): sigma/x', () => near(calc('ln(x)', [v('x', 10, 0.5)]).sigma, 0.05));
  test('log(x) is natural log too', () => near(calc('log(x)', [v('x', 10, 0.5)]).sigma, 0.05));
  test('log10(x)', () => near(calc('log10(x)', [v('x', 10, 0.5)]).sigma, 0.5 / (10 * Math.LN10)));
  test('exp(x)', () => near(calc('exp(x)', [v('x', 1, 0.1)]).sigma, Math.E * 0.1));
  test('sqrt(x)', () => {
    const r = calc('sqrt(x)', [v('x', 4, 0.4)]);
    near(r.value, 2); near(r.sigma, 0.1);
  });
  test('sin in degrees', () => {
    const r = calc('sin(theta)', [v('theta', 30, 1)], { degrees: true });
    near(r.value, 0.5); near(r.sigma, Math.cos(30 * D) * D);
  });
  test('asin in degrees returns degrees', () => {
    const r = calc('asin(x)', [v('x', 0.5, 0.01)], { degrees: true });
    near(r.value, 30); near(r.sigma, 0.01 / Math.sqrt(0.75) / D);
  });
  test('sin in radians', () => near(calc('sin(x)', [v('x', 0.5, 0.01)]).sigma, Math.cos(0.5) * 0.01));
  test('Snell n = sin(i)/sin(r) in degrees', () => {
    const r = calc('n = sin(a)/sin(b)', [v('a', 40, 0.5), v('b', 25, 0.5)], { degrees: true });
    const n = Math.sin(40 * D) / Math.sin(25 * D);
    near(r.value, n);
    near(r.sigma, n * Math.hypot(0.5 * D / Math.tan(40 * D), 0.5 * D / Math.tan(25 * D)));
  });
  test('percentage uncertainty', () => {
    near(calc('x*y', [v('x', 2, 5, 'pct'), v('y', 3, 0)]).sigma, 0.3);
  });
  test('E = m*c^2 (E and c are ordinary variables)', () => {
    const r = calc('E = m*c^2', [v('m', 2, 0.1), v('c', 3, 0)]);
    near(r.value, 18); near(r.sigma, 0.9);
  });
  test('phi, tau, E usable as variable names', () => {
    const r = calc('y = E*sin(phi) + tau', [v('E', 2, 0), v('phi', 1, 0.1), v('tau', 5, 0.3)]);
    near(r.value, 2 * Math.sin(1) + 5);
    near(r.sigma, Math.hypot(2 * Math.cos(1) * 0.1, 0.3));
  });
  test('variable appearing twice: x/(x+y)', () => {
    const r = calc('x/(x+y)', [v('x', 2, 0.1), v('y', 3, 0.2)]);
    near(r.value, 0.4); near(r.sigma, 0.02);
  });
  test('shares add up to 100%', () => {
    const r = calc('g = 4*pi^2*L/T^2', [v('L', 0.5, 0.002), v('T', 1.42, 0.03)]);
    near(r.terms.reduce((s, t) => s + t.share, 0), 1);
  });
  test('zero uncertainty variable has 0 share', () => {
    const r = calc('x*y', [v('x', 2, 0.1), v('y', 3, 0)]);
    same(r.terms[1].share, 0); near(r.sigma, 0.3);
  });
  test('all uncertainties zero gives sigma 0', () => same(calc('x*y', [v('x', 2, 0), v('y', 3, 0)]).sigma, 0));
  test('infinite derivative gives warning', () => {
    const r = calc('sqrt(x)', [v('x', 0, 0.1)]);
    if (!r.warnings.length) throw new Error('no warning');
  });
  test('negative values', () => {
    const r = calc('x*y', [v('x', -2, 0.1), v('y', 3, 0.2)]);
    near(r.value, -6); near(r.sigma, 6 * Math.hypot(0.05, 0.2 / 3));
  });
  test('tiny values (G-like)', () => {
    const r = calc('F = G*m*M/r^2', [v('G', 6.674e-11, 0), v('m', 5, 0.01), v('M', 10, 0.02), v('r', 0.1, 0.001)]);
    const F = (6.674e-11 * 50) / 0.01;
    near(r.value, F); near(r.sigma, F * Math.sqrt(0.002 ** 2 + 0.002 ** 2 + 0.02 ** 2));
  });

  // ----- Variable detection -----
  test('lists variables, not pi or functions', () => {
    same(EP.listVariables('g = 4*pi^2*L/T^2'), ['L', 'T']);
    same(EP.listVariables('sqrt(x) + sin(y) + e^z'), ['x', 'y', 'z']);
  });

  // ----- Errors -----
  test('error: empty', () => throwsMsg(() => calc('', []), 'equation'));
  test('error: nothing after =', () => throwsMsg(() => calc('g = ', []), 'Nothing after'));
  test('error: bad left side', () => throwsMsg(() => calc('a+b = c', [v('c', 1, 0)]), 'left side'));
  test('error: unreadable', () => throwsMsg(() => calc('4*/x', [])));
  test('error: missing value', () => throwsMsg(() => calc('x*y', [v('x', 1, 0)]), 'y'));
  test('error: negative uncertainty', () => throwsMsg(() => calc('x', [v('x', 1, -1)]), 'negative'));
  test('error: sqrt of negative', () => throwsMsg(() => calc('sqrt(x)', [v('x', -1, 0)]), 'real'));
  test('error: division by zero', () => throwsMsg(() => calc('1/x', [v('x', 0, 0)]), 'infinite'));

  // ----- Number input -----
  test('parseNumber', () => {
    same(EP.parseNumber('6.67e-11'), 6.67e-11);
    same(EP.parseNumber('6.67x10^-11'), 6.67e-11);
    same(EP.parseNumber('6.67 × 10^-11'), 6.67e-11);
    same(EP.parseNumber('0,5'), 0.5);
    same(EP.parseNumber('-.25'), -0.25);
    same(isNaN(EP.parseNumber('')), true);
    same(isNaN(EP.parseNumber('abc')), true);
    same(isNaN(EP.parseNumber('1.2.3')), true);
  });

  // ----- Rounding -----
  const fmt = (val, sig, mode) => EP.formatResult(val, sig, mode || 'auto').text;
  test('round: 1 s.f.', () => same(fmt(9.789312, 0.415548), '9.8 ± 0.4'));
  test('round: 2 s.f. when leading 1', () => same(fmt(12.345, 0.0123), '12.345 ± 0.012'));
  test('round: 0.0996 -> 0.10', () => same(fmt(1.2345, 0.0996), '1.23 ± 0.10'));
  test('round: big numbers', () => same(fmt(1234.5, 23), '1230 ± 20'));
  test('round: scientific small', () => same(fmt(6.674e-11, 0.015e-11), '(6.674 ± 0.015) × 10^-11'));
  test('round: scientific big', () => same(fmt(123456, 2345), '(1.23 ± 0.02) × 10^5'));
  test('round: negative value', () => same(fmt(-3.14159, 0.02), '-3.14 ± 0.02'));
  test('round: value smaller than uncertainty', () => same(fmt(0.03, 0.4), '0.0 ± 0.4'));
  test('round: forced 1 s.f.', () => same(fmt(12.346, 0.0123, 1), '12.35 ± 0.01'));
  test('round: forced 2 s.f.', () => same(fmt(9.789312, 0.415548, 2), '9.79 ± 0.42'));
  test('round: zero uncertainty', () => same(fmt(9.81, 0), '9.81'));

  root.runTests = function () {
    return cases.map((c) => {
      try { c.fn(); return { name: c.name, ok: true }; }
      catch (e) { return { name: c.name, ok: false, msg: e.message }; }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
