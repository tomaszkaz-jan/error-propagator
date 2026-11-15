(function () {
  'use strict';
  const EP = window.ErrorProp;
  const STORE = 'errorprop.v1';
  const METHODS = {
    partial: { label: 'Partial derivatives', short: 'standard, adds in quadrature' },
    rules: { label: 'Simple rules', short: 'step by step, worst case' },
    maxmin: { label: 'Max–min', short: 'half the range of extremes' },
  };

  const state = Object.assign(
    { equation: '', vars: {}, degrees: false, rounding: 'auto', method: 'partial' },
    load() || {}
  );
  if (!METHODS[state.method]) state.method = 'partial';
  let shownNames = [];
  let mcTimer = null, mcToken = 0;

  const $ = (id) => document.getElementById(id);
  const eqInput = $('eq'), varsBox = $('vars'), resultBox = $('result'), roundSel = $('round'), preview = $('eq-preview');

  // ---------- helpers ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    kids.flat().forEach((k) => k != null && n.append(k.nodeType ? k : String(k)));
    return n;
  }
  /** An element with LaTeX rendered into it. */
  function tex(latex, display, cls) {
    const n = el(display ? 'div' : 'span', { class: (cls || '') + (display ? ' tex-display' : ' tex') });
    try {
      katex.render(latex, n, { displayMode: !!display, throwOnError: false });
    } catch (e) {
      n.textContent = latex;
    }
    return n;
  }
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const sup = (s) => String(s).replace(/[-0-9]/g, (c) => SUP[c]);
  function num(x, n) {
    if (!isFinite(x)) return String(x);
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e5) return String(Number(x.toPrecision(n || 4)));
    const [m, e] = x.toExponential((n || 4) - 1).split('e');
    return String(Number(m)) + '×10' + sup(Number(e));
  }
  const T = EP.numTex;
  const N = EP.nameTex;
  const varState = (n) => (state.vars[n] = state.vars[n] || { value: '', unc: '', type: 'abs' });
  const roundMode = () => (state.rounding === 'auto' ? 'auto' : Number(state.rounding));

  function copyButton(label, getText) {
    const b = el('button', { class: 'ghost small', type: 'button' }, label);
    b.addEventListener('click', () => {
      const text = getText();
      const done = () => { b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = label), 1500); };
      const fallback = () => {
        const t = el('textarea', { style: 'position:fixed;opacity:0' });
        t.value = text; document.body.append(t); t.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        t.remove();
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
    return b;
  }

  // ---------- variable rows ----------
  function renderVars(names) {
    shownNames = names;
    varsBox.replaceChildren();
    if (!names.length) {
      varsBox.append(el('p', { class: 'empty' }, 'Your variables will appear here once you type an equation.'));
      return;
    }
    names.forEach((n) => {
      const s = varState(n);
      const value = el('input', { class: 'v', type: 'text', inputmode: 'decimal', placeholder: 'value', 'aria-label': n + ' value', autocomplete: 'off' });
      value.value = s.value;
      const unc = el('input', { class: 'u', type: 'text', inputmode: 'decimal', placeholder: 'uncertainty', 'aria-label': n + ' uncertainty', autocomplete: 'off' });
      unc.value = s.unc;
      const type = el('select', { 'aria-label': n + ' uncertainty type' },
        el('option', { value: 'abs' }, 'abs'), el('option', { value: 'pct' }, '%'));
      type.value = s.type;
      value.addEventListener('input', () => { s.value = value.value; mark(value); update(); });
      unc.addEventListener('input', () => { s.unc = unc.value; mark(unc); update(); });
      type.addEventListener('change', () => { s.type = type.value; update(); });
      mark(value); mark(unc);
      varsBox.append(el('div', { class: 'var-row' }, tex(N(n), false, 'var-name'), value, el('span', { class: 'pm' }, '±'), unc, type));
    });
  }
  function mark(input) {
    input.classList.toggle('invalid', input.value.trim() !== '' && isNaN(EP.parseNumber(input.value)));
  }

  // ---------- calculation ----------
  function update() {
    save();
    clearTimeout(mcTimer);
    mcToken++;
    let names;
    try {
      names = EP.listVariables(state.equation);
      preview.replaceChildren(tex(EP.equationTex(state.equation), true));
    } catch (err) {
      preview.replaceChildren();
      if (!state.equation.trim()) { renderVars([]); resultBox.replaceChildren(); return; }
      return showMessage(err.message, true);
    }
    if (names.join('|') !== shownNames.join('|')) renderVars(names);

    const vars = [];
    for (const n of names) {
      const s = varState(n);
      if (s.value.trim() === '') continue; // reported as missing below
      const value = EP.parseNumber(s.value);
      const unc = s.unc.trim() === '' ? 0 : EP.parseNumber(s.unc);
      if (isNaN(value)) return showMessage(`Can't read "${s.value}" as a number (value of ${n}).`, true);
      if (isNaN(unc)) return showMessage(`Can't read "${s.unc}" as a number (uncertainty of ${n}).`, true);
      vars.push({ name: n, value, unc, type: s.type });
    }

    const opts = { degrees: state.degrees };
    let lin;
    try {
      lin = EP.calculate(state.equation, vars, opts);
    } catch (err) {
      return showMessage(err.message, !err.message.startsWith('Enter a value'));
    }
    const attempt = (fn) => { try { return fn(state.equation, vars, opts); } catch (e) { return e; } };
    const all = { partial: lin, rules: attempt(EP.simpleRules), maxmin: attempt(EP.maxMin) };
    const main = all[state.method];
    if (main instanceof Error) return showMessage(main.message, true);
    showResult(main, lin, all);
    if (lin.sigma > 0) scheduleMonteCarlo(lin, vars, opts);
  }

  function showMessage(text, isError) {
    resultBox.replaceChildren(el('p', { class: 'msg' + (isError ? ' error' : '') }, text));
  }

  function showResult(r, lin, all) {
    const f = EP.formatResult(r.value, r.sigma, roundMode());
    const resultTex = N(r.name) + ' = ' + f.tex;
    const parts = [];

    parts.push(el('div', { class: 'answer' },
      tex(resultTex, false, 'big'),
      el('div', { class: 'buttons' },
        copyButton('Copy', () => r.name + ' = ' + f.text),
        copyButton('Copy LaTeX', () => resultTex))));

    const sub = el('div', { class: 'sub' });
    if (r.sigma > 0) sub.append(METHODS[r.method].label + '  ·  Relative uncertainty ' + num(r.relative * 100, 2) + '%  ·  Unrounded: ');
    else if (isNaN(r.sigma)) sub.append('The uncertainty could not be worked out with this method.  Value: ');
    else sub.append('No uncertainty: every variable has uncertainty 0.  Unrounded: ');
    sub.append(el('span', { class: 'mono' }, num(r.value, 8) + (r.sigma > 0 ? ' ± ' + num(r.sigma, 6) : '')));
    parts.push(sub);

    const warnings = [...new Set([...(r.warnings || []), ...(r === lin ? [] : lin.warnings)])];
    warnings.forEach((w) => parts.push(el('div', { class: 'warn' }, '⚠ ' + w)));

    if (lin.sigma > 0) {
      parts.push(el('div', { id: 'mc', class: 'check pending' }, 'Running Monte Carlo check…'));
      parts.push(...contributions(lin, r !== lin));
    }
    if (r.sigma > 0) parts.push(...working(r, f));
    if (lin.sigma > 0) parts.push(...comparison(all));
    resultBox.replaceChildren(...parts);
  }

  function contributions(lin, note) {
    const out = [el('h3', null, 'Where the uncertainty comes from')];
    const sorted = [...lin.terms].sort((a, b) => b.share - a.share);
    sorted.forEach((t) => {
      const pct = t.share * 100;
      out.push(el('div', { class: 'bar-row' },
        tex(N(t.name), false, 'var-name'),
        el('div', { class: 'bar' }, el('span', { style: 'width:' + pct.toFixed(1) + '%' })),
        el('span', { class: 'pct' }, (pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(pct >= 10 ? 0 : 1)) + '%')));
    });
    const top = sorted[0];
    const hints = [];
    if (top && top.share > 0.5 && lin.terms.length > 1) hints.push(`Most of the uncertainty comes from ${top.name}. Measuring it more precisely would help the most.`);
    if (note) hints.push('Shares are from the partial-derivative method.');
    if (hints.length) out.push(el('p', { class: 'hint' }, hints.join(' ')));
    return out;
  }

  // Working: a list of [lhs, rhs, comment] lines, shown as maths and copyable as LaTeX.
  function working(r, f) {
    const g = N(r.name);
    const lines = [];
    if (r.method === 'partial') {
      const used = r.terms.filter((t) => t.sigma > 0);
      const d = (t) => '\\frac{\\partial ' + g + '}{\\partial ' + N(t.name) + '}';
      lines.push(['\\sigma_{' + g + '}', '\\sqrt{' + used.map((t) => '\\left(' + d(t) + '\\,\\sigma_{' + N(t.name) + '}\\right)^{2}').join(' + ') + '}']);
      used.forEach((t) => lines.push([d(t), t.derivTex + ' = ' + T(t.derivValue)]));
      lines.push(['\\sigma_{' + g + '}', '\\sqrt{' + used.map((t) => '\\left(' + T(t.derivValue) + ' \\times ' + T(t.sigma) + '\\right)^{2}').join(' + ') + '} = ' + T(r.sigma)]);
    } else if (r.method === 'rules') {
      r.steps.forEach((s) => lines.push([s.tex, T(s.value) + ' \\pm ' + T(s.delta, 3) + '\\quad(' + T((s.delta / Math.abs(s.value)) * 100, 2) + '\\%)', s.rule]));
    } else if (r.method === 'maxmin') {
      const at = (list) => g + '\\left(' + list.map((a) => N(a.name) + ' = ' + T(a.value, 6)).join(',\\ ') + '\\right)';
      lines.push(['{' + g + '}_{\\max}', at(r.maxAt) + ' = ' + T(r.max, 6)]);
      lines.push(['{' + g + '}_{\\min}', at(r.minAt) + ' = ' + T(r.min, 6)]);
      lines.push(['\\Delta ' + g, '\\frac{' + g + '_{\\max} - ' + g + '_{\\min}}{2} = \\frac{' + T(r.max, 6) + ' - ' + T(r.min, 6) + '}{2} = ' + T(r.sigma)]);
    }
    lines.push([g, f.tex]);

    const latex = () => '\\begin{align*}\n' + lines.map((l) => l[0] + ' &= ' + l[1] + (l[2] ? ' % ' + l[2] : '')).join(' \\\\\n') + '\n\\end{align*}';
    const out = [el('div', { class: 'section-head' }, el('h3', null, 'Working'), copyButton('Copy working as LaTeX', latex))];
    const box = el('div', { class: 'working' });
    lines.forEach((l) => {
      box.append(tex(l[0] + ' = ' + l[1], true));
      if (l[2]) box.append(el('div', { class: 'rule' }, l[2]));
    });
    out.push(box);
    if (r.method === 'partial' && r.terms.some((t) => t.sigma === 0)) {
      out.push(el('p', { class: 'hint' }, 'Variables with uncertainty 0 are left out of the sum.'));
    }
    return out;
  }

  function comparison(all) {
    const rows = Object.keys(METHODS).map((m) => {
      const r = all[m];
      const cell = r instanceof Error
        ? el('span', { class: 'muted' }, r.message)
        : tex(EP.formatResult(r.value, r.sigma, roundMode()).tex);
      const tr = el('tr', { class: m === state.method ? 'on' : 'pick', title: 'Use this method' },
        el('td', null, METHODS[m].label, el('div', { class: 'muted' }, METHODS[m].short)), el('td', null, cell));
      if (m !== state.method && !(r instanceof Error)) tr.addEventListener('click', () => setMethod(m, true));
      return tr;
    });
    rows.push(el('tr', { id: 'mc-row' }, el('td', null, 'Monte Carlo', el('div', { class: 'muted' }, 'simulation, 68% range')), el('td', { class: 'muted' }, '…')));
    return [
      el('h3', null, 'Compare methods'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, el('tbody', null, rows))),
      el('p', { class: 'hint' }, 'Simple rules and max–min give a worst-case uncertainty, so they come out larger. Click a method to use it.'),
    ];
  }

  // ---------- Monte Carlo (runs just after typing pauses) ----------
  function scheduleMonteCarlo(lin, vars, opts) {
    const token = mcToken;
    mcTimer = setTimeout(() => {
      if (token !== mcToken) return;
      let mc;
      try { mc = EP.monteCarlo(state.equation, vars, opts); } catch (e) { return showMc(null, e.message); }
      if (token === mcToken) showMc(lin, mc);
    }, 150);
  }

  function showMc(lin, mc) {
    const box = $('mc'), row = $('mc-row');
    if (!box) return;
    if (!lin) { box.className = 'check bad'; box.textContent = '⚠ ' + mc; return; }
    const c = EP.mcCheck(lin, mc);
    const n = mc.n.toLocaleString('en-GB');
    box.replaceChildren();
    if (c.ok) {
      box.className = 'check good';
      box.append(`✓ Monte Carlo check passed: ${n} simulated measurements have a 68% spread of ±${num(c.spread, 3)}, matching the formula (σ = ${num(lin.sigma, 3)}).`);
    } else {
      box.className = 'check bad';
      const why = [];
      if (Math.abs(c.sdDiff) >= 0.05) why.push(`the 68% spread is ±${num(c.spread, 3)}, ${num(Math.abs(c.sdDiff) * 100, 2)}% ${c.sdDiff > 0 ? 'bigger' : 'smaller'} than the formula's σ = ${num(lin.sigma, 3)}`);
      if (c.asym <= 0.8 || c.asym >= 1.25) why.push('the spread is lopsided (asymmetric)');
      if (c.shift >= 0.1) why.push('the typical result is shifted away from the calculated value');
      if (c.failedFrac >= 0.001) why.push(`${num(c.failedFrac * 100, 2)}% of simulated values were impossible (e.g. square root of a negative)`);
      box.append('⚠ Monte Carlo check: ' + why.join('; ') + '. Your uncertainties are big enough that the formula\'s straight-line approximation isn\'t reliable here. Consider quoting the Monte Carlo result: ');
      box.append(tex(N(lin.name) + ' = ' + asymTex(mc.median, c.up, c.down)));
    }
    if (row) {
      row.lastChild.className = '';
      row.lastChild.replaceChildren(tex(asymTex(mc.median, c.up, c.down)));
    }
  }

  // median^{+up}_{-down}, all rounded to the same decimal place (like value ± uncertainty).
  function asymTex(median, up, down) {
    const fUp = EP.formatResult(median, up, roundMode()), fDown = EP.formatResult(median, down, roundMode());
    if (fUp.sci || fDown.sci) return T(median, 4) + '^{+' + T(up, 2) + '}_{-' + T(down, 2) + '}';
    // use the finer of the two decimal places
    const dp = Math.max(...[fUp, fDown].map((f) => (f.sigma.split('.')[1] || '').length));
    const fix = (x) => (dp > 0 ? x.toFixed(dp) : String(Math.round(x)));
    return fix(median) + '^{+' + fix(up) + '}_{-' + fix(down) + '}';
  }

  // ---------- controls ----------
  function setDegrees(on) {
    state.degrees = on;
    document.querySelectorAll('[data-deg]').forEach((b) => b.classList.toggle('on', (b.dataset.deg === '1') === on));
  }
  function setMethod(m, recalc) {
    state.method = m;
    document.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('on', b.dataset.method === m));
    if (recalc) update();
  }
  document.querySelectorAll('[data-deg]').forEach((b) =>
    b.addEventListener('click', () => { setDegrees(b.dataset.deg === '1'); update(); }));
  document.querySelectorAll('[data-method]').forEach((b) =>
    b.addEventListener('click', () => setMethod(b.dataset.method, true)));
  roundSel.addEventListener('change', () => { state.rounding = roundSel.value; update(); });
  eqInput.addEventListener('input', () => { state.equation = eqInput.value; update(); });
  $('example').addEventListener('click', () => {
    state.equation = eqInput.value = 'g = 4*pi^2*L/T^2';
    state.vars.L = { value: '0.500', unc: '0.002', type: 'abs' };
    state.vars.T = { value: '1.42', unc: '0.03', type: 'abs' };
    shownNames = [];
    update();
  });

  eqInput.value = state.equation;
  roundSel.value = state.rounding;
  setDegrees(!!state.degrees);
  setMethod(state.method, false);
  update();
})();
