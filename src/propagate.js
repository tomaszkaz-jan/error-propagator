/*
 * Error propagation engine.
 *
 * Methods:
 *  - Partial derivatives (standard): sigma_f^2 = sum_i (df/dx_i * sigma_i)^2,
 *    with derivatives worked out exactly by math.js. Assumes independent variables.
 *  - Simple rules (step by step): add absolute uncertainties for + and -, add
 *    percentage uncertainties for x and /, multiply the percentage by n for powers.
 *  - Max-min: evaluate at every combination of x_i +/- dx_i, take half the range.
 *  - Monte Carlo: simulate many measurements to check the linear approximation.
 *
 * Works in the browser and in the test runner. Needs `math` (math.js) loaded first.
 */
(function (root) {
  'use strict';

  const math = root.math;
  if (!math) throw new Error('math.js must be loaded before propagate.js');

  // Only these symbols are constants. Everything else is a variable, so physics
  // names like E, phi, tau, c, g can be used freely.
  const CONSTANTS = { pi: Math.PI, e: Math.E };

  const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
  const INV_TRIG = new Set(['asin', 'acos', 'atan', 'asec', 'acsc', 'acot']);
  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const MAXMIN_LIMIT = 16;

  class InputError extends Error {}

  // ---------- LaTeX ----------

  const GREEK = new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa ' +
    'lambda mu nu xi rho sigma tau upsilon phi varphi chi psi omega ' +
    'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega').split(' '));

  /** LaTeX for a variable name: theta -> \theta, L_1 -> L_{1}, v_max -> v_{\mathrm{max}}. */
  function nameTex(name) {
    if (name === 'pi') return '\\pi';
    const i = name.indexOf('_');
    const base = i > 0 ? name.slice(0, i) : name;
    const sub = i > 0 ? name.slice(i + 1) : '';
    const b = GREEK.has(base) ? '\\' + base : base.length > 1 ? '\\mathit{' + base + '}' : base;
    if (!sub) return b;
    const s = GREEK.has(sub) ? '\\' + sub : /^[0-9]+$/.test(sub) || sub.length === 1 ? sub : '\\mathrm{' + sub.replace(/_/g, '\\_') + '}';
    return b + '_{' + s + '}';
  }

  const TEX_OPTS = {
    parenthesis: 'auto',
    implicit: 'show',
    handler: function (node) {
      if (node.isSymbolNode) return ' ' + nameTex(node.name); // space keeps "\cdot L" apart
    },
  };
  const toTex = (node) => node.toTex(TEX_OPTS);

  /** A number in LaTeX with n significant figures, using \times 10^{} when needed. */
  function numTex(x, n) {
    n = n || 4;
    if (!isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{undefined}';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e5) return String(Number(x.toPrecision(n)));
    const [m, e] = x.toExponential(n - 1).split('e');
    return Number(m) + '\\times10^{' + Number(e) + '}';
  }

  // ---------- Parsing ----------

  function splitEquation(text) {
    const src = String(text || '').trim();
    if (!src) throw new InputError('Type an equation, e.g.  g = 4*pi^2*L/T^2');
    const eq = src.indexOf('=');
    if (eq === -1) return { name: 'f', expr: src };
    const name = src.slice(0, eq).trim();
    const expr = src.slice(eq + 1).trim();
    if (!NAME_RE.test(name)) {
      throw new InputError('The left side of "=" must be a single name, e.g.  g = ...');
    }
    if (!expr) throw new InputError('Nothing after "=". Type the right-hand side of the equation.');
    if (expr.includes('=')) throw new InputError('Only one "=" is allowed.');
    return { name, expr };
  }

  function parseExpr(expr) {
    try {
      return math.parse(expr);
    } catch (err) {
      throw new InputError("Couldn't read the equation: " + err.message);
    }
  }

  // Each variable name -> how many times it appears, in order of first appearance.
  function countVariables(node) {
    const counts = new Map();
    node.traverse(function (n, path, parent) {
      if (!n.isSymbolNode) return;
      if (parent && parent.isFunctionNode && path === 'fn') return; // a function name
      if (n.name in CONSTANTS) return;
      counts.set(n.name, (counts.get(n.name) || 0) + 1);
    });
    return counts;
  }

  const piOver180 = () =>
    new math.OperatorNode('/', 'divide', [new math.SymbolNode('pi'), new math.ConstantNode(180)]);

  // ln -> log, and (in degree mode) convert trig arguments/results so the chain
  // rule automatically includes the pi/180 factor.
  function rewrite(node, degrees) {
    return node.transform(function (n) {
      if (!(n.isFunctionNode && n.fn && n.fn.isSymbolNode)) return n;
      let name = n.fn.name;
      let args = n.args.map((a) => rewrite(a, degrees));
      if (name === 'ln') name = 'log';
      if (degrees && TRIG.has(name)) {
        args = [new math.OperatorNode('*', 'multiply', [args[0], piOver180()])];
      }
      const call = new math.FunctionNode(new math.SymbolNode(name), args);
      if (degrees && INV_TRIG.has(name)) {
        return new math.OperatorNode('/', 'divide', [call, piOver180()]);
      }
      return call;
    });
  }

  // Parsed equations are cached so a table of many rows only parses and
  // differentiates the equation once. Cached objects are never modified.
  const prepCache = new Map();

  function prepare(text, opts) {
    const degrees = !!(opts && opts.degrees);
    const key = degrees + '|' + text;
    if (prepCache.has(key)) return prepCache.get(key);
    const { name, expr } = splitEquation(text);
    const raw = parseExpr(expr);
    const node = rewrite(raw, degrees);
    const counts = countVariables(raw);
    const p = { name, raw, node, counts, variables: [...counts.keys()], derivs: new Map() };
    if (prepCache.size > 50) prepCache.clear();
    prepCache.set(key, p);
    return p;
  }

  // d(equation)/d(variable), worked out once per equation and cached.
  function derivativeOf(p, n) {
    if (!p.derivs.has(n)) {
      let d;
      try {
        d = math.derivative(p.node, n);
      } catch (err) {
        throw new InputError("Couldn't differentiate with respect to " + n + ': ' + err.message);
      }
      p.derivs.set(n, { node: d, code: d.compile(), str: d.toString(), tex: toTex(d) });
    }
    return p.derivs.get(n);
  }

  /** The variable names used in an equation (for building the input rows). */
  function listVariables(text) {
    const { expr } = splitEquation(text);
    return [...countVariables(parseExpr(expr)).keys()];
  }

  /** The typed equation as LaTeX (as typed, before any degree conversion). */
  function equationTex(text) {
    const { name, expr } = splitEquation(text);
    const raw = rewrite(parseExpr(expr), false); // ln -> log so it shows as \ln
    return nameTex(name) + ' = ' + toTex(raw);
  }

  // ---------- Numbers ----------

  /** Read a number typed by a person: "6.67e-11", "6.67x10^-11", "0,5". */
  function parseNumber(str) {
    let s = String(str == null ? '' : str).trim().replace(/\s+/g, '');
    if (!s) return NaN;
    s = s.replace(/[x×*]10\^/i, 'e').replace(/−/g, '-');
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }

  function toReal(v, what) {
    if (typeof v === 'number') return v;
    if (v && typeof v.re === 'number') {
      if (Math.abs(v.im) < 1e-12 * Math.max(1, Math.abs(v.re))) return v.re;
      throw new InputError(what + ' is not a real number (e.g. square root or log of a negative number).');
    }
    if (typeof v === 'boolean') return v ? 1 : 0;
    throw new InputError(what + ' did not give a number.');
  }

  // ---------- Fast evaluation (for max-min and Monte Carlo) ----------

  const H = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, abs: Math.abs, log10: Math.log10, log2: Math.log2,
    log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)),
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    asec: (x) => Math.acos(1 / x), acsc: (x) => Math.asin(1 / x), acot: (x) => Math.atan(1 / x),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  };
  const JS_OPS = { add: '+', subtract: '-', multiply: '*', divide: '/' };

  function toJs(n, index) {
    if (n.isParenthesisNode) return toJs(n.content, index);
    if (n.isConstantNode) {
      if (typeof n.value !== 'number') throw new Error('non-numeric constant');
      return '(' + n.value + ')';
    }
    if (n.isSymbolNode) {
      if (n.name in CONSTANTS) return '(' + CONSTANTS[n.name] + ')';
      return 's[' + index[n.name] + ']';
    }
    if (n.isOperatorNode) {
      const a = n.args.map((x) => toJs(x, index));
      if (n.fn === 'unaryMinus') return '(-' + a[0] + ')';
      if (n.fn === 'unaryPlus') return a[0];
      if (n.fn === 'pow') return 'Math.pow(' + a[0] + ',' + a[1] + ')';
      if (JS_OPS[n.fn] && a.length === 2) return '(' + a[0] + JS_OPS[n.fn] + a[1] + ')';
    }
    if (n.isFunctionNode && n.fn.isSymbolNode && H[n.fn.name]) {
      return 'H.' + n.fn.name + '(' + n.args.map((x) => toJs(x, index)).join(',') + ')';
    }
    throw new Error('unsupported in fast mode');
  }

  /** Returns f(array of variable values) -> number (NaN if not a real number). */
  function makeEvaluator(s) {
    const index = {};
    s.variables.forEach((n, i) => (index[n] = i));
    try {
      const fn = new Function('H', 's', 'return ' + toJs(s.node, index) + ';').bind(null, H);
      const check = fn(s.x);
      if (Math.abs(check - s.value) <= 1e-9 * Math.max(1, Math.abs(s.value))) {
        fn.fast = true;
        return fn;
      }
    } catch (e) { /* fall back to math.js */ }
    const code = s.node.compile();
    const scope = new Map(Object.entries(CONSTANTS));
    const slow = function (arr) {
      s.variables.forEach((n, i) => scope.set(n, arr[i]));
      try { return toReal(code.evaluate(scope), ''); } catch (e) { return NaN; }
    };
    slow.fast = false;
    return slow;
  }

  // ---------- Shared setup ----------

  function setup(text, vars, opts) {
    opts = opts || {};
    const p = prepare(text, opts);
    const byName = {};
    (vars || []).forEach((v) => (byName[v.name] = v));

    const missing = p.variables.filter((n) => !byName[n] || !isFinite(Number(byName[n].value)));
    if (missing.length) throw new InputError('Enter a value for: ' + missing.join(', '));

    const x = p.variables.map((n) => Number(byName[n].value));
    const sig = p.variables.map((n, i) => {
      const v = byName[n];
      const u = Number(v.unc) || 0;
      if (u < 0) throw new InputError('Uncertainty of ' + n + ' must not be negative.');
      return v.type === 'pct' ? (Math.abs(x[i]) * u) / 100 : u;
    });

    const units = applyUnits(p, byName, x, sig, opts); // converts x, sig to SI in place

    const scope = new Map(Object.entries(CONSTANTS));
    p.variables.forEach((n, i) => scope.set(n, x[i]));

    let value;
    try {
      value = toReal(p.node.evaluate(scope), 'The result');
    } catch (err) {
      if (err instanceof InputError) throw err;
      throw new InputError("Couldn't evaluate the equation: " + err.message);
    }
    if (!isFinite(value)) throw new InputError('The result is infinite or undefined (division by zero?).');

    return Object.assign({}, p, { x, sig, scope, value, units }); // copy: p is cached
  }

  // ---------- Units ----------
  //
  // When any variable has a unit, every value and uncertainty is converted to SI
  // (angles: to degrees or radians, matching the Angles setting), the maths is
  // done on plain numbers, and math.js checks the units of the equation and
  // works out the unit of the result. Uncertainties convert by scale only, so
  // ±0.5 °C becomes ±0.5 K (not ±273.65 K).

  const RAD = () => math.unit('rad');

  function readUnit(str, what) {
    let U;
    try {
      U = math.unit(str);
    } catch (e) {
      throw new InputError('Unknown unit "' + str + '"' + what + '. Try units like m, cm, mm, s, ms, kg, g, N, J, W, V, A, Hz, K, degC, deg, rad.');
    }
    if (U.value !== null) throw new InputError('Type only the unit' + what + ' (e.g. "cm"), without a number.');
    return U;
  }

  function conversion(fromStr, toStr) {
    const offset = math.unit(0, fromStr).toNumber(toStr);
    return { scale: math.unit(1, fromStr).toNumber(toStr) - offset, offset };
  }

  function friendlyUnitError(err) {
    const m = err.message || '';
    if (/Units do not match/.test(m)) return "The units don't match: the equation adds or subtracts quantities with different units (e.g. a length and a time). Check the units of your variables.";
    if (/no angle/.test(m)) return "A trig function (sin, cos, tan…) was given something that isn't an angle. Check the units.";
    if (/expected: Unit, actual: number|actual: Unit/.test(m)) return 'A quantity with units is combined with a plain number that has none (e.g. L + 2). Give it a unit, or check the equation.';
    return 'Units problem: ' + m + '. Functions like log, exp and powers with a variable exponent need inputs without units.';
  }

  function applyUnits(p, byName, x, sig, opts) {
    const typed = p.variables.map((n) => String(byName[n].unit || '').trim());
    if (!typed.some(Boolean)) return null;
    const degrees = !!opts.degrees;
    const varUnits = {};
    const unitScope = new Map(Object.entries(CONSTANTS));
    p.variables.forEach((n, i) => {
      if (!typed[i]) { unitScope.set(n, x[i]); return; }
      const U = readUnit(typed[i], ' for ' + n);
      const target = U.equalBase(RAD()) ? (degrees ? 'deg' : 'rad') : U.toSI().formatUnits();
      const c = conversion(typed[i], target);
      x[i] = x[i] * c.scale + c.offset;
      sig[i] = sig[i] * Math.abs(c.scale);
      varUnits[n] = target;
      unitScope.set(n, math.unit(x[i], target));
    });

    // Let math.js check the equation's units and find the result's unit.
    let r;
    try {
      r = p.node.evaluate(unitScope);
    } catch (err) {
      throw new InputError(friendlyUnitError(err));
    }
    let si = '';
    if (math.isUnit(r)) si = r.equalBase(RAD()) ? (degrees ? 'deg' : 'rad') : r.toSI().formatUnits();

    const want = String(opts.resultUnit || '').trim();
    let display = si, c = { scale: 1, offset: 0 };
    if (want) {
      const W = readUnit(want, ' for the result');
      if (!si) throw new InputError('The result has no units, so it can’t be shown in ' + want + '.');
      if (!W.equalBase(math.unit(si))) throw new InputError('The result is in ' + si + ', which can’t be converted to ' + want + '.');
      c = conversion(si, want);
      display = want;
    }
    return { display, si, tex: unitTex(display), scale: c.scale, offset: c.offset, vars: varUnits };
  }

  const UNIT_TEX = { deg: '^{\\circ}', degC: '^{\\circ}\\mathrm{C}', degF: '^{\\circ}\\mathrm{F}', ohm: '\\Omega' };
  const PREFIX_TEX = { u: '\\mu ' };

  /** "m / s^2" -> \mathrm{m}\,\mathrm{s}^{-2} */
  function unitTex(str) {
    if (!str) return '';
    let U;
    try { U = math.unit(str); } catch (e) { return '\\text{' + str.replace(/[\\{}$&#^_%~]/g, '') + '}'; }
    return U.units.map((u) => {
      const name = u.unit.name, pre = u.prefix ? u.prefix.name : '';
      const base = UNIT_TEX[name] && !pre ? UNIT_TEX[name] : '\\mathrm{' + (PREFIX_TEX[pre] ? '' : pre) + name + '}';
      const full = PREFIX_TEX[pre] ? PREFIX_TEX[pre] + base : base;
      return full + (u.power !== 1 ? '^{' + u.power + '}' : '');
    }).join('\\,');
  }

  /** True if the text is a unit math.js understands (e.g. "cm", "m/s^2", "degC"). */
  function isUnit(str) {
    try { return math.unit(String(str).trim()).value === null; } catch (e) { return false; }
  }

  /** Converts a result from SI to the display unit. */
  function toDisplay(units, value, sigma) {
    if (!units) return { value, sigma };
    return { value: value * units.scale + units.offset, sigma: sigma * Math.abs(units.scale) };
  }

  /** LaTeX/text for a formatted result with its unit: (9.79 \pm 0.42)\,\mathrm{m}\,\mathrm{s}^{-2} */
  function withUnit(f, units) {
    if (!units || !units.display) return { tex: f.tex, text: f.text };
    const sep = units.tex.startsWith('^') ? '' : '\\,';
    const wrap = !f.sci && f.sigma !== null;
    return {
      tex: (wrap ? '\\left(' + f.tex + '\\right)' : f.tex) + sep + units.tex,
      text: (wrap ? '(' + f.text + ')' : f.text) + ' ' + units.display,
    };
  }

  // ---------- Method 1: partial derivatives ----------

  /**
   * @param {string} text   equation, e.g. "g = 4*pi^2*L/T^2"
   * @param {Array<{name, value, unc, type}>} vars  type is 'abs' or 'pct'
   * @param {{degrees?: boolean}} opts
   */
  function calculate(text, vars, opts) {
    const s = setup(text, vars, opts);
    const warnings = [];
    const terms = s.variables.map((n, i) => {
      const sigma = s.sig[i];
      const deriv = derivativeOf(s, n);
      let dv;
      try {
        dv = toReal(deriv.code.evaluate(s.scope), 'The derivative with respect to ' + n);
      } catch (err) {
        dv = NaN;
      }
      if (!isFinite(dv) && sigma > 0) {
        warnings.push(
          'The derivative with respect to ' + n + ' is infinite or undefined at ' + n + ' = ' + s.x[i] +
          ', so the standard formula breaks down here. Treat this uncertainty with caution.'
        );
      }
      const term = sigma === 0 ? 0 : dv * sigma;
      return {
        name: n, value: s.x[i], sigma, term,
        derivative: deriv.str, derivTex: deriv.tex, derivValue: dv,
      };
    });

    const variance = terms.reduce((sum, t) => sum + t.term * t.term, 0);
    const sigma = Math.sqrt(variance);
    terms.forEach((t) => (t.share = variance > 0 && isFinite(variance) ? (t.term * t.term) / variance : 0));

    return {
      method: 'partial', name: s.name, units: s.units, value: s.value, sigma,
      relative: s.value !== 0 ? sigma / Math.abs(s.value) : Infinity,
      terms, warnings,
      expression: s.node.toString(),
      equationTex: nameTex(s.name) + ' = ' + toTex(s.raw),
    };
  }

  // ---------- Method 2: simple rules, step by step ----------

  function ruleFor(n, args) {
    if (n.isFunctionNode) return 'Function ' + n.fn.name + ': uncertainty = |slope| × uncertainty of its input';
    switch (n.fn) {
      case 'add': case 'subtract':
        return 'Adding/subtracting: add the absolute uncertainties';
      case 'multiply': case 'divide':
        if (args.some((a) => a.d === 0)) return 'Multiplying/dividing by an exact number: percentage uncertainty unchanged';
        return 'Multiplying/dividing: add the percentage uncertainties';
      case 'pow':
        if (args[1].d === 0) return 'Power of ' + numTex(args[1].v) + ': multiply the percentage uncertainty by ' + numTex(Math.abs(args[1].v));
        return 'Power with an uncertain exponent: add |slope| × uncertainty for each part';
      case 'unaryMinus':
        return 'Changing sign: uncertainty unchanged';
      default:
        return 'Add |slope| × uncertainty for each part';
    }
  }

  function simpleRules(text, vars, opts) {
    const s = setup(text, vars, opts);
    const index = {};
    s.variables.forEach((n, i) => (index[n] = i));
    const steps = [];
    const warnings = [];

    function walk(n) {
      if (n.isParenthesisNode) return walk(n.content);
      if (n.isConstantNode) return { v: Number(n.value), d: 0 };
      if (n.isSymbolNode) {
        if (n.name in CONSTANTS) return { v: CONSTANTS[n.name], d: 0 };
        const i = index[n.name];
        return { v: s.x[i], d: s.sig[i] };
      }
      if (!(n.isOperatorNode || n.isFunctionNode)) throw new InputError('Simple rules cannot handle "' + n.toString() + '".');
      const args = n.args.map(walk);
      const v = toReal(n.evaluate(s.scope), 'Part of the equation');
      if (!args.some((a) => a.d > 0)) return { v, d: 0 };

      // For each input: |d(operation)/d(input)| * uncertainty of input.
      // For + - x / ^ this is exactly the textbook rule (see ruleFor).
      const syms = args.map((_, k) => new math.SymbolNode('u' + k));
      const op = n.isOperatorNode ? new math.OperatorNode(n.op, n.fn, syms) : new math.FunctionNode(n.fn, syms);
      const sc = new Map(Object.entries(CONSTANTS));
      args.forEach((a, k) => sc.set('u' + k, a.v));
      let d = 0;
      args.forEach((a, k) => {
        if (!(a.d > 0)) return;
        let slope;
        try { slope = toReal(math.derivative(op, 'u' + k).evaluate(sc), ''); } catch (e) { slope = NaN; }
        if (!isFinite(slope)) warnings.push('The slope of "' + n.toString() + '" is infinite or undefined here, so the simple rules break down.');
        d += Math.abs(slope) * a.d;
      });
      steps.push({ tex: toTex(n), value: v, delta: d, rule: ruleFor(n, args) });
      return { v, d };
    }

    const top = walk(s.node);
    const repeated = s.variables.filter((n, i) => s.counts.get(n) > 1 && s.sig[i] > 0);
    if (repeated.length) {
      warnings.push(repeated.join(', ') + (repeated.length > 1 ? ' appear' : ' appears') +
        ' more than once. The simple rules treat each appearance as separate, which overestimates the uncertainty. The partial-derivative method handles this correctly.');
    }
    return {
      method: 'rules', name: s.name, units: s.units, value: s.value, sigma: top.d,
      relative: s.value !== 0 ? top.d / Math.abs(s.value) : Infinity,
      steps, warnings,
    };
  }

  // ---------- Method 3: max-min ----------

  function maxMin(text, vars, opts) {
    const s = setup(text, vars, opts);
    const unc = s.variables.map((_, i) => i).filter((i) => s.sig[i] > 0);
    if (unc.length > MAXMIN_LIMIT) throw new InputError('Max–min needs too many combinations for more than ' + MAXMIN_LIMIT + ' uncertain variables.');
    const f = makeEvaluator(s);
    let max = { v: s.value, at: s.x.slice() }, min = { v: s.value, at: s.x.slice() };
    let failed = 0, cornerMax = -Infinity, cornerMin = Infinity;
    const arr = s.x.slice();
    for (let mask = 0; mask < 1 << unc.length; mask++) {
      unc.forEach((i, b) => (arr[i] = s.x[i] + (mask & (1 << b) ? s.sig[i] : -s.sig[i])));
      const v = f(arr);
      if (!isFinite(v)) { failed++; continue; }
      cornerMax = Math.max(cornerMax, v); cornerMin = Math.min(cornerMin, v);
      if (v > max.v) max = { v, at: arr.slice() };
      if (v < min.v) min = { v, at: arr.slice() };
    }
    const warnings = [];
    if (failed) warnings.push(failed + ' of the combinations gave no real answer (e.g. square root of a negative).');
    if (unc.length && (s.value > cornerMax || s.value < cornerMin)) {
      warnings.push('The result at your measured values lies outside the range of the extremes, so the equation peaks inside the range (e.g. sin near 90°). Max–min may be unreliable here.');
    }
    const sigma = (max.v - min.v) / 2;
    const label = (at) => s.variables.map((n, i) => ({ name: n, value: at[i], shift: Math.sign(at[i] - s.x[i]) }));
    return {
      method: 'maxmin', name: s.name, units: s.units, value: s.value, sigma,
      relative: s.value !== 0 ? sigma / Math.abs(s.value) : Infinity,
      max: max.v, min: min.v, maxAt: label(max.at), minAt: label(min.at), warnings,
    };
  }

  // ---------- Monte Carlo check ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Simulates N measurements with Gaussian errors. Returns the spread of the results. */
  function monteCarlo(text, vars, opts, mc) {
    mc = mc || {};
    const s = setup(text, vars, opts);
    const f = makeEvaluator(s);
    const N = mc.n || (f.fast ? 100000 : 20000);
    const rand = mulberry32(mc.seed == null ? 12345 : mc.seed);
    let spare = null;
    const gauss = () => {
      if (spare !== null) { const g = spare; spare = null; return g; }
      let u = 0; while (u === 0) u = rand();
      const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * rand();
      spare = r * Math.sin(th);
      return r * Math.cos(th);
    };
    const out = new Float64Array(N);
    const arr = s.x.slice();
    let used = 0, sum = 0;
    for (let k = 0; k < N; k++) {
      for (let i = 0; i < arr.length; i++) arr[i] = s.sig[i] > 0 ? s.x[i] + s.sig[i] * gauss() : s.x[i];
      const v = f(arr);
      if (isFinite(v)) { out[used++] = v; sum += v; }
    }
    if (used < 2) throw new InputError('Monte Carlo: almost no simulated values gave a real answer.');
    const vals = out.subarray(0, used).sort();
    const mean = sum / used;
    let ss = 0;
    for (let k = 0; k < used; k++) ss += (vals[k] - mean) * (vals[k] - mean);
    const pct = (p) => vals[Math.min(used - 1, Math.max(0, Math.round(p * (used - 1))))];
    return {
      method: 'montecarlo', name: s.name, units: s.units, value: s.value,
      n: N, used, failed: N - used, mean, sd: Math.sqrt(ss / (used - 1)),
      lo: pct(0.158655), median: pct(0.5), hi: pct(0.841345),
    };
  }

  /** Does the Monte Carlo spread agree with the partial-derivative result? */
  function mcCheck(lin, mc) {
    // Half-width of the central 68% range: like sigma, but not thrown off by rare huge outliers.
    const spread = (mc.hi - mc.lo) / 2;
    const sdDiff = lin.sigma > 0 ? (spread - lin.sigma) / lin.sigma : 0;
    const up = mc.hi - mc.median, down = mc.median - mc.lo;
    const asym = down > 0 ? up / down : Infinity;
    const shift = lin.sigma > 0 ? Math.abs(mc.median - lin.value) / lin.sigma : 0;
    const failedFrac = mc.failed / mc.n;
    const ok = Math.abs(sdDiff) < 0.05 && shift < 0.1 && asym > 0.8 && asym < 1.25 && failedFrac < 0.001;
    return { ok, spread, sdDiff, asym, shift, failedFrac, up, down };
  }

  // ---------- Rounding for reporting ----------

  // Uncertainty -> integer digits U and decimal position q (sigma ~ U * 10^q).
  function roundUncertainty(sigma, mode) {
    let sf = mode === 2 || mode === '2' ? 2 : 1;
    if (mode === 'auto' || mode == null) {
      // 1 significant figure, or 2 if the leading digit is 1 (e.g. 0.14, not 0.1)
      if (sigma.toExponential(1)[0] === '1') sf = 2;
    }
    const [mant, ex] = sigma.toExponential(sf - 1).split('e');
    return { U: parseInt(mant.replace('.', ''), 10), q: parseInt(ex, 10) - (sf - 1) };
  }

  function roundToPlace(x, q) {
    const a = Math.abs(x);
    const r = q < 0 ? Math.round(a * Math.pow(10, -q)) : Math.round(a / Math.pow(10, q));
    return x < 0 ? -r : r;
  }

  // Integer n times 10^q as a decimal string.
  function decimal(n, q) {
    const neg = n < 0;
    let s = String(Math.abs(n));
    if (q >= 0) s = n === 0 ? '0' : s + '0'.repeat(q);
    else {
      const d = -q;
      s = s.padStart(d + 1, '0');
      s = s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
    }
    return (neg && n !== 0 ? '-' : '') + s;
  }

  /**
   * Round value and uncertainty for a report: uncertainty to 1-2 s.f., value to
   * the same decimal place. Uses scientific notation for very big/small numbers.
   * mode: 'auto' (1 s.f., or 2 if it starts with 1), 1, or 2.
   * Returns { text, tex, value, sigma, sci, exp }.
   */
  function formatResult(value, sigma, mode) {
    if (!(sigma > 0) || !isFinite(sigma)) {
      const v = Number(value.toPrecision(10)).toString();
      return { sci: false, value: v, sigma: null, exp: 0, text: v, tex: numTex(value, 10) };
    }
    const { U, q } = roundUncertainty(sigma, mode);
    const V = roundToPlace(value, q);
    const lead = V !== 0 ? Math.abs(V) : U;
    const E = String(lead).length - 1 + q; // power of ten of the leading digit
    if (E >= 5 || E <= -4) {
      const v = decimal(V, q - E), s = decimal(U, q - E);
      return {
        sci: true, value: v, sigma: s, exp: E,
        text: '(' + v + ' ± ' + s + ') × 10^' + E,
        tex: '\\left(' + v + ' \\pm ' + s + '\\right)\\times10^{' + E + '}',
      };
    }
    const v = decimal(V, q), s = decimal(U, q);
    return { sci: false, value: v, sigma: s, exp: 0, text: v + ' ± ' + s, tex: v + ' \\pm ' + s };
  }

  // ---------- Tables: summary, CSV, pasted data ----------

  /**
   * Summary of a column of results with uncertainties.
   * mean ± standard error, and the weighted mean (weights 1/sigma^2) ± 1/sqrt(sum of weights).
   * chi2red > ~2 means the results scatter more than their uncertainties suggest.
   */
  function summarize(values, sigmas) {
    const n = values.length;
    if (!n) return null;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : NaN;
    const out = { n, mean, sd, sem: n > 1 ? sd / Math.sqrt(n) : NaN, wmean: NaN, wsigma: NaN, chi2red: NaN };
    if (sigmas && sigmas.length === n && sigmas.every((s) => s > 0 && isFinite(s))) {
      const w = sigmas.map((s) => 1 / (s * s));
      const sw = w.reduce((a, b) => a + b, 0);
      out.wmean = values.reduce((a, v, i) => a + w[i] * v, 0) / sw;
      out.wsigma = 1 / Math.sqrt(sw);
      if (n > 1) out.chi2red = values.reduce((a, v, i) => a + w[i] * (v - out.wmean) ** 2, 0) / (n - 1);
    }
    return out;
  }

  /** 2D array -> CSV text (quotes cells containing commas, quotes or newlines). */
  function toCsv(rows) {
    const cell = (c) => {
      const s = c == null ? '' : String(c);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  /** Text pasted from Excel / Google Sheets / Numbers (tab-separated) -> 2D array. */
  function parseGrid(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.map((l) => l.split('\t').map((c) => c.trim()));
  }

  root.ErrorProp = {
    isUnit,
    unitTex,
    toDisplay,
    withUnit,
    summarize,
    toCsv,
    parseGrid,
    calculate,
    simpleRules,
    maxMin,
    monteCarlo,
    mcCheck,
    listVariables,
    equationTex,
    nameTex,
    numTex,
    parseNumber,
    formatResult,
    InputError,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
