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

  // ----- Tables -----
  test('summary: mean, sd, standard error', () => {
    const s = EP.summarize([9.6, 9.8, 10.0, 9.9, 9.7]);
    near(s.mean, 9.8); near(s.sd, Math.sqrt(0.1 / 4)); near(s.sem, Math.sqrt(0.1 / 4) / Math.sqrt(5));
  });
  test('summary: weighted mean', () => {
    const s = EP.summarize([10, 12], [1, 2]); // weights 1 and 1/4
    near(s.wmean, (10 + 12 / 4) / 1.25); near(s.wsigma, 1 / Math.sqrt(1.25));
    near(s.chi2red, (1 * (10 - s.wmean) ** 2 + 0.25 * (12 - s.wmean) ** 2) / 1);
  });
  test('summary: no weighted mean if a sigma is 0', () => same(isNaN(EP.summarize([1, 2], [0.1, 0]).wmean), true));
  test('summary: single value', () => { const s = EP.summarize([5]); near(s.mean, 5); same(isNaN(s.sem), true); });
  test('csv: quoting', () => same(EP.toCsv([['a', 'b,c'], ['say "hi"', 1.5]]), 'a,"b,c"\r\n"say ""hi""",1.5\r\n'));
  test('paste: tab separated with trailing newline', () =>
    same(EP.parseGrid('0.5\t1.42\r\n0.6\t1.55\r\n'), [['0.5', '1.42'], ['0.6', '1.55']]));
  test('paste: single column', () => same(EP.parseGrid('1\n2\n3'), [['1'], ['2'], ['3']]));
  test('cache: same equation different values', () => {
    near(calc('x^2', [v('x', 2, 0.1)]).sigma, 0.4);
    near(calc('x^2', [v('x', 3, 0.1)]).sigma, 0.6);
    near(calc('x^2', [v('x', 3, 0.1)], { degrees: true }).sigma, 0.6);
  });

  // ----- Units -----
  const vu = (name, value, unc, unit, type) => ({ name, value, unc, unit, type: type || 'abs' });
  test('units: none given -> units null', () => same(calc('x*y', [v('x', 2, 0.1), v('y', 3, 0.2)]).units, null));
  test('units: cm and s -> m/s', () => {
    const r = calc('v = d/t', [vu('d', 100, 1, 'cm'), vu('t', 2, 0.1, 's')]);
    near(r.value, 0.5); near(r.sigma, 0.5 * Math.hypot(0.01, 0.05));
    same(r.units.display, 'm / s');
  });
  test('units: pendulum with L in cm gives m/s^2', () => {
    const r = calc('g = 4*pi^2*L/T^2', [vu('L', 50, 0.2, 'cm'), vu('T', 1.42, 0.03, 's')]);
    const g = (4 * Math.PI ** 2 * 0.5) / 1.42 ** 2;
    near(r.value, g); near(r.sigma, g * Math.hypot(0.002 / 0.5, (2 * 0.03) / 1.42));
    same(r.units.display, 'm / s^2');
  });
  test('units: result shown in km/h', () => {
    const r = calc('v = d/t', [vu('d', 100, 1, 'm'), vu('t', 10, 0.1, 's')], { resultUnit: 'km/h' });
    const d = EP.toDisplay(r.units, r.value, r.sigma);
    near(d.value, 36); near(d.sigma, 36 * Math.hypot(0.01, 0.01));
  });
  test('units: °C uncertainty converts by scale only', () => {
    const r = calc('dT = T1 - T2', [vu('T1', 20, 0.5, 'degC'), vu('T2', 10, 0.5, 'degC')]);
    near(r.value, 10); near(r.sigma, Math.hypot(0.5, 0.5)); same(r.units.display, 'K');
  });
  test('units: single °C value becomes kelvin', () => {
    const r = calc('T = t', [vu('t', 20, 0.5, 'degC')]);
    near(r.value, 293.15); near(r.sigma, 0.5);
    const d = EP.toDisplay(calc('T = t', [vu('t', 20, 0.5, 'degC')], { resultUnit: 'degC' }).units, r.value, r.sigma);
    near(d.value, 20); near(d.sigma, 0.5);
  });
  test('units: % uncertainty with units', () => near(calc('x', [vu('x', 50, 2, 'cm', 'pct')]).sigma, 0.01));
  test('units: deg unit works with radians setting', () => {
    const r = calc('sin(theta)', [vu('theta', 30, 1, 'deg')]);
    near(r.value, 0.5); near(r.sigma, Math.cos(30 * D) * D);
  });
  test('units: deg unit works with degrees setting', () => {
    const r = calc('sin(theta)', [vu('theta', 30, 1, 'deg')], { degrees: true });
    near(r.value, 0.5); near(r.sigma, Math.cos(30 * D) * D);
  });
  test('units: rad unit with degrees setting', () => {
    const r = calc('sin(theta)', [vu('theta', Math.PI / 6, 0.01, 'rad')], { degrees: true });
    near(r.value, 0.5); near(r.sigma, Math.cos(Math.PI / 6) * 0.01);
  });
  test('units: mixing units of the same kind (mm + cm)', () => {
    const r = calc('L = a + b', [vu('a', 5, 0.1, 'mm'), vu('b', 2, 0.1, 'cm')]);
    near(r.value, 0.025); near(r.sigma, Math.hypot(0.0001, 0.001)); same(r.units.display, 'm');
  });
  test('units: dimensionless result', () => same(calc('r = a/b', [vu('a', 2, 0, 'm'), vu('b', 50, 0, 'cm')]).units.display, ''));
  test('units: force in N', () => {
    const r = calc('F = m*a', [vu('m', 2, 0.1, 'kg'), vu('a', 3, 0.1, 'm/s^2')], { resultUnit: 'N' });
    near(r.value, 6); same(r.units.display, 'N'); near(r.units.scale, 1);
  });
  test('units: other methods carry units', () => {
    const vars = [vu('d', 100, 1, 'cm'), vu('t', 2, 0.1, 's')];
    same(EP.simpleRules('v = d/t', vars).units.display, 'm / s');
    same(EP.maxMin('v = d/t', vars).units.display, 'm / s');
    near(EP.maxMin('v = d/t', vars).max, 1.01 / 1.9);
  });
  test('units error: adding length and time', () => throwsMsg(() => calc('x + y', [vu('x', 1, 0, 'm'), vu('y', 1, 0, 's')]), "don't match"));
  test('units error: sin of a length', () => throwsMsg(() => calc('sin(x)', [vu('x', 1, 0, 'm')]), 'angle'));
  test('units error: plain number added', () => throwsMsg(() => calc('x + 2', [vu('x', 1, 0, 'm')]), 'plain number'));
  test('units error: unknown unit', () => throwsMsg(() => calc('x', [vu('x', 1, 0, 'furlongz')]), 'Unknown unit'));
  test('units error: number in unit box', () => throwsMsg(() => calc('x', [vu('x', 1, 0, '5 cm')]), 'only the unit'));
  test('units error: wrong result unit', () => throwsMsg(() => calc('v = d/t', [vu('d', 1, 0, 'm'), vu('t', 1, 0, 's')], { resultUnit: 'kg' }), "can’t be converted"));
  test('units: LaTeX', () => {
    same(EP.unitTex('m / s^2'), '\\mathrm{m}\\,\\mathrm{s}^{-2}');
    same(EP.unitTex('cm'), '\\mathrm{cm}');
    same(EP.unitTex('um'), '\\mu \\mathrm{m}');
    same(EP.unitTex('deg'), '^{\\circ}');
    same(EP.withUnit(EP.formatResult(9.79, 0.42, 'auto'), { display: 'm / s^2', tex: 'U' }).text, '(9.8 ± 0.4) m / s^2');
  });

  // ----- Linear fit: must match the lab's LSFR-25.py exactly -----
  // Reference numbers produced by running LSFR-25.py's own fitting_procedure
  // and chi_squared_function on these data files (part3.txt, part4.txt).
  const nearRel = (got, want, label) => {
    if (!(Math.abs(got - want) <= 1e-9 * Math.abs(want))) throw new Error((label || '') + ' got ' + got + ', expected ' + want);
  };
  const P3 = [[204.0816327, 2.69e-3, 3.27e-4], [123.4567901, 2.45e-3, 0.0003245], [82.6446281, 1.94e-3, 0.0003194],
    [69.44444444, 1.51e-3, 0.0003151], [59.17159763, 1.40e-3, 0.000314], [51.02040816, 1.10e-3, 0.000311],
    [44.44444444, 1.03e-3, 0.0003103], [34.60207612, 9.70e-4, 0.0003097], [27.70083102, 8.40e-4, 0.0003084],
    [22.67573696, 5.70e-4, 0.0003057]];
  const P4 = [[7.50e-5, -6.571283042, 0.022428571], [1.50e-4, -7.002065958, 0.033967033], [2.25e-4, -7.143477613, 0.038974684],
    [3.00e-4, -7.338538195, 0.047153846], [3.75e-4, -7.701828378, 0.067371681]];
  const col = (d, k) => d.map((r) => r[k]);
  test('fit: matches LSFR on part3.txt', () => {
    const f = EP.linearFit(col(P3, 0), col(P3, 1), col(P3, 2));
    nearRel(f.m, 1.2112874988678087e-05, 'm'); nearRel(f.c, 0.0005756260767552172, 'c');
    nearRel(f.sm, 1.9448726150644534e-06, 'sm'); nearRel(f.sc, 0.00016837926642909338, 'sc');
    nearRel(f.chi2, 5.123042740527304, 'chi2'); same(f.dof, 8); nearRel(f.chi2red, 0.640380342565913, 'chi2red');
  });
  test('fit: matches LSFR on part4.txt', () => {
    const f = EP.linearFit(col(P4, 0), col(P4, 1), col(P4, 2));
    nearRel(f.m, -3616.0861641362235, 'm'); nearRel(f.c, -6.335251275556468, 'c');
    nearRel(f.sm, 166.46773037260698, 'sm'); nearRel(f.sc, 0.029957536688149773, 'sc');
    nearRel(f.chi2, 18.90674127668198, 'chi2'); same(f.dof, 3); nearRel(f.chi2red, 6.302247092227327, 'chi2red');
  });
  test('fit: residuals', () => {
    const f = EP.linearFit([1, 2, 3], [2, 4, 7], [1, 1, 1]);
    near(f.m, 2.5); near(f.c, -2 / 3);
    near(f.residuals[0], 2 - (2.5 - 2 / 3)); near(f.chi2, f.residuals.reduce((a, r) => a + r * r, 0));
  });
  test('fit: through origin', () => {
    const f = EP.linearFit([1, 2, 3], [2.1, 3.9, 6.2], [0.1, 0.2, 0.1], { origin: true });
    const w = [100, 25, 100];
    near(f.m, (w[0] * 2.1 + w[1] * 2 * 3.9 + w[2] * 3 * 6.2) / (w[0] + w[1] * 4 + w[2] * 9));
    near(f.sm, 1 / Math.sqrt(w[0] + w[1] * 4 + w[2] * 9)); same(f.c, 0); same(f.dof, 2);
  });
  test('fit: x errors (effective variance) on exact line', () => {
    const x = [1, 2, 3, 4], y = [3, 5, 7, 9], sy = [0.1, 0.1, 0.2, 0.2], sx = [0.05, 0.05, 0.05, 0.05];
    const f = EP.linearFit(x, y, sy, { sx, useXErrors: true });
    near(f.m, 2); near(f.c, 1); near(f.chi2, 0);
    const s = sy.map((v) => Math.sqrt(v * v + 4 * 0.0025)), w = s.map((v) => 1 / (v * v));
    const S = w.reduce((a, b) => a + b), Sx = w.reduce((a, b, i) => a + b * x[i], 0), Sxx = w.reduce((a, b, i) => a + b * x[i] * x[i], 0);
    near(f.sm, Math.sqrt(S / (S * Sxx - Sx * Sx)));
    if (!f.converged) throw new Error('did not converge');
  });
  test('fit: x errors make chi2 smaller', () => {
    const x = col(P4, 0), y = col(P4, 1), sy = col(P4, 2), sx = x.map((v) => v * 0.05);
    const a = EP.linearFit(x, y, sy), b = EP.linearFit(x, y, sy, { sx, useXErrors: true });
    if (!(b.chi2 < a.chi2)) throw new Error(a.chi2 + ' vs ' + b.chi2);
    same(EP.linearFit(x, y, sy, { sx, useXErrors: false }).chi2, a.chi2);
  });
  test('fit: errors', () => {
    throwsMsg(() => EP.linearFit([1, 2], [1, 2], [1, 1]), 'at least 3');
    throwsMsg(() => EP.linearFit([1, 2, 3], [1, 2, 3], [1, 0, 1]), 'greater than 0');
    throwsMsg(() => EP.linearFit([2, 2, 2], [1, 2, 3], [1, 1, 1]), 'same');
  });
  test('chi2 probability: known values', () => {
    near(EP.chi2Prob(3.841458820694124, 1), 0.05);
    near(EP.chi2Prob(18.307038053275146, 10), 0.05);
    near(EP.chi2Prob(4, 2), Math.exp(-2));                 // k=2: Q = e^(-x/2)
    near(EP.chi2Prob(6, 4), Math.exp(-3) * (1 + 3));       // k=4: Q = e^(-x/2)(1 + x/2)
    near(EP.chi2Prob(0, 3), 1);
  });

  test('slope units', () => {
    same(EP.divideUnits('m / s^2', 'cm').display, 'm / (s^2 cm)');
    same(EP.divideUnits('V', 'A').display, 'V / A');
    same(EP.divideUnits('m', 'm'), null);
    same(EP.divideUnits('m', 'cm').display, 'm/(cm)');
    same(EP.divideUnits('', 's').display, 's^-1');
    same(EP.divideUnits('', ''), null);
  });

  root.runTests = function () {
    return cases.map((c) => {
      try { c.fn(); return { name: c.name, ok: true }; }
      catch (e) { return { name: c.name, ok: false, msg: e.message }; }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
