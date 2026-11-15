/*
 * Error propagation engine.
 *
 * Uses the general (first-order) propagation formula for independent variables:
 *     sigma_f^2 = sum_i ( df/dx_i * sigma_i )^2
 * with the partial derivatives worked out exactly by math.js (symbolic
 * differentiation), then evaluated at the measured values.
 *
 * Works in the browser and in the test runner. Needs `math` (math.js) loaded first.
 */
(function (root) {
  'use strict';

  const math = root.math;
  if (!math) throw new Error('math.js must be loaded before propagate.js');

  // Only these symbols are treated as constants. Everything else is a variable,
  // so physics names like E, phi, tau, c, g can all be used freely.
  const CONSTANTS = { pi: Math.PI, e: Math.E };

  const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
  const INV_TRIG = new Set(['asin', 'acos', 'atan', 'asec', 'acsc', 'acot']);
  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

  class InputError extends Error {}

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

  // Names used as variables (excludes function names and pi/e), in order of appearance.
  function variablesIn(node) {
    const seen = [];
    node.traverse(function (n, path, parent) {
      if (!n.isSymbolNode) return;
      if (parent && parent.isFunctionNode && path === 'fn') return; // it's a function name
      if (n.name in CONSTANTS) return;
      if (!seen.includes(n.name)) seen.push(n.name);
    });
    return seen;
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

  function prepare(text, opts) {
    const { name, expr } = splitEquation(text);
    const raw = parseExpr(expr);
    const node = rewrite(raw, !!(opts && opts.degrees));
    return { name, node, variables: variablesIn(raw) };
  }

  /** The variable names used in an equation (for building the input rows). */
  function listVariables(text) {
    const { expr } = splitEquation(text);
    return variablesIn(parseExpr(expr));
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

  // ---------- Propagation ----------

  /**
   * @param {string} text   equation, e.g. "g = 4*pi^2*L/T^2"
   * @param {Array<{name, value, unc, type}>} vars  type is 'abs' or 'pct'
   * @param {{degrees?: boolean}} opts
   */
  function calculate(text, vars, opts) {
    opts = opts || {};
    const { name, node, variables } = prepare(text, opts);
    const byName = {};
    (vars || []).forEach((v) => (byName[v.name] = v));

    const missing = variables.filter((n) => !byName[n] || !isFinite(Number(byName[n].value)));
    if (missing.length) throw new InputError('Enter a value for: ' + missing.join(', '));

    const scope = new Map();
    variables.forEach((n) => scope.set(n, Number(byName[n].value)));
    Object.keys(CONSTANTS).forEach((c) => scope.set(c, CONSTANTS[c]));

    let value;
    try {
      value = toReal(node.evaluate(scope), 'The result');
    } catch (err) {
      if (err instanceof InputError) throw err;
      throw new InputError("Couldn't evaluate the equation: " + err.message);
    }
    if (!isFinite(value)) throw new InputError('The result is infinite or undefined (division by zero?).');

    const warnings = [];
    const terms = variables.map((n) => {
      const v = byName[n];
      const x = Number(v.value);
      const u = Number(v.unc) || 0;
      if (u < 0) throw new InputError('Uncertainty of ' + n + ' must not be negative.');
      const sigma = v.type === 'pct' ? (Math.abs(x) * u) / 100 : u;

      let deriv;
      try {
        deriv = math.derivative(node, n);
      } catch (err) {
        throw new InputError("Couldn't differentiate with respect to " + n + ': ' + err.message);
      }
      let dv;
      try {
        dv = toReal(deriv.evaluate(scope), 'The derivative with respect to ' + n);
      } catch (err) {
        dv = NaN;
      }
      if (!isFinite(dv) && sigma > 0) {
        warnings.push(
          'The derivative with respect to ' + n + ' is infinite or undefined at ' + n + ' = ' + x +
          ', so the standard formula breaks down here. Treat this uncertainty with caution.'
        );
      }
      const term = sigma === 0 ? 0 : dv * sigma;
      return { name: n, value: x, sigma, derivative: deriv.toString(), derivValue: dv, term };
    });

    const variance = terms.reduce((s, t) => s + t.term * t.term, 0);
    const sigma = Math.sqrt(variance);
    terms.forEach((t) => (t.share = variance > 0 && isFinite(variance) ? (t.term * t.term) / variance : 0));

    return {
      name,
      value,
      sigma,
      relative: value !== 0 ? sigma / Math.abs(value) : Infinity,
      terms,
      warnings,
      expression: node.toString(),
    };
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
   */
  function formatResult(value, sigma, mode) {
    if (!(sigma > 0) || !isFinite(sigma)) {
      const v = Number(value.toPrecision(10)).toString();
      return { sci: false, value: v, sigma: null, exp: 0, text: v };
    }
    const { U, q } = roundUncertainty(sigma, mode);
    const V = roundToPlace(value, q);
    const lead = V !== 0 ? Math.abs(V) : U;
    const E = String(lead).length - 1 + q; // power of ten of the leading digit
    if (E >= 5 || E <= -4) {
      const v = decimal(V, q - E), s = decimal(U, q - E);
      return { sci: true, value: v, sigma: s, exp: E, text: '(' + v + ' ± ' + s + ') × 10^' + E };
    }
    const v = decimal(V, q), s = decimal(U, q);
    return { sci: false, value: v, sigma: s, exp: 0, text: v + ' ± ' + s };
  }

  root.ErrorProp = {
    calculate,
    listVariables,
    parseNumber,
    formatResult,
    InputError,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
