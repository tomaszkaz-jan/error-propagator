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

  // ----- Simple rules -----
  const rules = (eq, vars, opts) => EP.simpleRules(eq, vars, opts);
  test('rules: sum adds absolute uncertainties', () => near(rules('x + y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, 0.3));
  test('rules: difference adds absolute uncertainties', () => near(rules('x - y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, 0.3));
  test('rules: product adds % uncertainties', () => near(rules('x*y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, 6 * (0.05 + 0.2 / 3)));
  test('rules: quotient adds % uncertainties', () => near(rules('x/y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, (2 / 3) * (0.05 + 0.2 / 3)));
  test('rules: power multiplies % by n', () => near(rules('x^3', [v('x', 2, 0.1)]).sigma, 8 * 3 * 0.05));
  test('rules: pendulum = %L + 2×%T', () => {
    const r = rules('g = 4*pi^2*L/T^2', [v('L', 0.5, 0.002), v('T', 1.42, 0.03)]);
    const g = (4 * Math.PI ** 2 * 0.5) / 1.42 ** 2;
    near(r.sigma, g * (0.002 / 0.5 + (2 * 0.03) / 1.42));
  });
  test('rules: steps listed inner first', () => {
    const r = rules('(x + y)*z', [v('x', 2, 0.1), v('y', 3, 0.2), v('z', 4, 0)]);
    same(r.steps.length, 2);
    near(r.steps[0].delta, 0.3); near(r.steps[1].delta, 1.2);
    if (!r.steps[0].rule.includes('absolute')) throw new Error(r.steps[0].rule);
  });
  test('rules: repeated variable warns', () => {
    const r = rules('x/(x+y)', [v('x', 2, 0.1), v('y', 3, 0.2)]);
    near(r.sigma, 0.1 / 5 + (2 / 25) * 0.3);
    if (!r.warnings.some((w) => w.includes('more than once'))) throw new Error('no warning');
  });
  test('rules: functions use slope', () => near(rules('ln(x)', [v('x', 10, 0.5)]).sigma, 0.05));

  // ----- Max-min -----
  const mm = (eq, vars, opts) => EP.maxMin(eq, vars, opts);
  test('maxmin: sum', () => {
    const r = mm('x + y', [v('x', 2, 0.1), v('y', 3, 0.2)]);
    near(r.max, 5.3); near(r.min, 4.7); near(r.sigma, 0.3);
  });
  test('maxmin: pendulum', () => {
    const r = mm('g = 4*pi^2*L/T^2', [v('L', 0.5, 0.002), v('T', 1.42, 0.03)]);
    const hi = (4 * Math.PI ** 2 * 0.502) / 1.39 ** 2, lo = (4 * Math.PI ** 2 * 0.498) / 1.45 ** 2;
    near(r.max, hi); near(r.min, lo); near(r.sigma, (hi - lo) / 2);
    same(r.maxAt.map((a) => a.shift), [1, -1]);
  });
  test('maxmin: x/(x+y)', () => near(mm('x/(x+y)', [v('x', 2, 0.1), v('y', 3, 0.2)]).sigma, (2.1 / 4.9 - 1.9 / 5.1) / 2));
  test('maxmin: degrees', () => {
    const r = mm('sin(t)', [v('t', 30, 1)], { degrees: true });
    near(r.sigma, (Math.sin(31 * D) - Math.sin(29 * D)) / 2);
  });
  test('maxmin: peak inside range warns', () => {
    if (!mm('sin(t)', [v('t', 90, 2)], { degrees: true }).warnings.length) throw new Error('no warning');
  });

  // ----- Monte Carlo -----
  const mc = (eq, vars, opts) => EP.monteCarlo(eq, vars, opts, { n: 100000, seed: 1 });
  test('MC: sum matches quadrature within 1%', () => {
    const r = mc('x + y', [v('x', 2, 0.1), v('y', 3, 0.2)]);
    if (Math.abs(r.sd / Math.sqrt(0.05) - 1) > 0.01) throw new Error('sd ' + r.sd);
    if (Math.abs(r.mean - 5) > 0.003) throw new Error('mean ' + r.mean);
  });
  test('MC: pendulum agrees with partial derivatives', () => {
    const vars = [v('L', 0.5, 0.002), v('T', 1.42, 0.03)];
    const lin = calc('g = 4*pi^2*L/T^2', vars), r = mc('g = 4*pi^2*L/T^2', vars);
    const chk = EP.mcCheck(lin, r);
    if (!chk.ok) throw new Error(JSON.stringify(chk));
  });
  test('MC: flags large error on 1/x', () => {
    const vars = [v('x', 1, 0.3)];
    const chk = EP.mcCheck(calc('1/x', vars), mc('1/x', vars));
    if (chk.ok) throw new Error('should disagree');
  });
  test('MC: counts impossible values', () => {
    const r = mc('sqrt(x)', [v('x', 0.1, 0.1)]);
    if (!(r.failed > 10000 && r.failed < 20000)) throw new Error('failed ' + r.failed); // P(x<0) ≈ 15.9%
  });
  test('MC: same seed gives same answer', () => {
    same(mc('x*y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sd, mc('x*y', [v('x', 2, 0.1), v('y', 3, 0.2)]).sd);
  });

  // ----- LaTeX -----
  test('tex: variable names', () => {
    same(EP.nameTex('theta'), '\\theta');
    same(EP.nameTex('L_1'), 'L_{1}');
    same(EP.nameTex('v_max'), 'v_{\\mathrm{max}}');
    same(EP.nameTex('phi_2'), '\\phi_{2}');
    same(EP.nameTex('mv'), '\\mathit{mv}');
  });
  test('tex: equation', () => same(EP.equationTex('g = 4*pi^2*L/T^2').replace(/\s+/g, ' '), 'g = \\frac{4\\cdot{ \\pi}^{2}\\cdot L}{{ T}^{2}}'));
  test('tex: ln shows as \\ln', () => {
    if (!EP.equationTex('y = ln(x)').includes('\\ln')) throw new Error(EP.equationTex('y = ln(x)'));
  });
  test('tex: result', () => {
    same(EP.formatResult(9.789, 0.4155, 'auto').tex, '9.8 \\pm 0.4');
    same(EP.formatResult(6.674e-11, 0.015e-11, 'auto').tex, '\\left(6.674 \\pm 0.015\\right)\\times10^{-11}');
  });
  test('tex: numbers', () => {
    same(EP.numTex(19.5794), '19.58');
    same(EP.numTex(6.674e-11), '6.674\\times10^{-11}');
  });

  root.runTests = function () {
    return cases.map((c) => {
      try { c.fn(); return { name: c.name, ok: true }; }
      catch (e) { return { name: c.name, ok: false, msg: e.message }; }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
