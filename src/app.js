(function () {
  'use strict';
  const EP = window.ErrorProp;
  const STORE = 'errorprop.v1';

  const state = load() || {
    equation: '',
    vars: {},        // name -> { value: '', unc: '', type: 'abs' | 'pct' }
    degrees: false,
    rounding: 'auto',
  };
  let shownNames = [];

  const $ = (id) => document.getElementById(id);
  const eqInput = $('eq'), varsBox = $('vars'), resultBox = $('result'), roundSel = $('round');

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
  const pretty = (expr) =>
    expr.replace(/ \^ /g, '^').replace(/ \* /g, '·').replace(/\bpi\b/g, 'π');
  const varState = (n) => (state.vars[n] = state.vars[n] || { value: '', unc: '', type: 'abs' });

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
      varsBox.append(el('div', { class: 'var-row' }, el('span', { class: 'var-name' }, n), value, el('span', { class: 'pm' }, '±'), unc, type));
    });
  }
  function mark(input) {
    const bad = input.value.trim() !== '' && isNaN(EP.parseNumber(input.value));
    input.classList.toggle('invalid', bad);
  }

  // ---------- calculation ----------
  function update() {
    save();
    let names;
    try {
      names = EP.listVariables(state.equation);
    } catch (err) {
      if (!state.equation.trim()) { renderVars([]); resultBox.replaceChildren(); return; }
      return showMessage(err.message, true);
    }
    if (names.join('|') !== shownNames.join('|')) renderVars(names);

    const vars = [];
    for (const n of names) {
      const s = varState(n);
      const value = EP.parseNumber(s.value);
      const unc = s.unc.trim() === '' ? 0 : EP.parseNumber(s.unc);
      if (s.value.trim() === '') continue; // reported as missing below
      if (isNaN(value)) return showMessage(`Can't read "${s.value}" as a number (value of ${n}).`, true);
      if (isNaN(unc)) return showMessage(`Can't read "${s.unc}" as a number (uncertainty of ${n}).`, true);
      vars.push({ name: n, value, unc, type: s.type });
    }

    let r;
    try {
      r = EP.calculate(state.equation, vars, { degrees: state.degrees });
    } catch (err) {
      const missing = err.message.startsWith('Enter a value');
      return showMessage(err.message, !missing);
    }
    showResult(r);
  }

  function showMessage(text, isError) {
    resultBox.replaceChildren(el('p', { class: 'msg' + (isError ? ' error' : '') }, text));
  }

  function showResult(r) {
    const mode = state.rounding === 'auto' ? 'auto' : Number(state.rounding);
    const f = EP.formatResult(r.value, r.sigma, mode);
    const big = el('span', { class: 'big' }, r.name + ' = ');
    if (f.sigma === null) big.append(f.value);
    else if (f.sci) big.append('(' + f.value + ' ± ' + f.sigma + ') × 10', el('sup', null, f.exp));
    else big.append(f.value + ' ± ' + f.sigma);

    const copyText = r.name + ' = ' + f.text;
    const copyBtn = el('button', { class: 'ghost', type: 'button' }, 'Copy');
    copyBtn.addEventListener('click', () => copy(copyText, copyBtn));

    const parts = [el('div', { class: 'answer' }, big, copyBtn)];
    const sub = el('div', { class: 'sub' });
    if (r.sigma > 0) sub.append('Relative uncertainty ' + num(r.relative * 100, 2) + '%  ·  Unrounded: ');
    else sub.append('No uncertainty: every variable has uncertainty 0.  Unrounded: ');
    sub.append(el('span', { class: 'mono' }, num(r.value, 8) + (r.sigma > 0 ? ' ± ' + num(r.sigma, 6) : '')));
    parts.push(sub);
    r.warnings.forEach((w) => parts.push(el('div', { class: 'warn' }, '⚠ ' + w)));

    if (r.sigma > 0) {
      // Contributions
      parts.push(el('h3', null, 'Where the uncertainty comes from'));
      [...r.terms].sort((a, b) => b.share - a.share).forEach((t) => {
        const pct = t.share * 100;
        parts.push(el('div', { class: 'bar-row' },
          el('span', { class: 'var-name' }, t.name),
          el('div', { class: 'bar' }, el('span', { style: 'width:' + pct.toFixed(1) + '%' })),
          el('span', { class: 'pct' }, (pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(pct >= 10 ? 0 : 1)) + '%')));
      });
      const top = [...r.terms].sort((a, b) => b.share - a.share)[0];
      if (top && top.share > 0.5 && r.terms.length > 1) {
        parts.push(el('p', { class: 'hint' }, `Most of the uncertainty comes from ${top.name}. Measuring it more precisely would help the most.`));
      }

      // Working
      parts.push(el('h3', null, 'Working'));
      const used = r.terms.filter((t) => t.sigma > 0);
      const formula = 'σ_' + r.name + ' = √( ' + used.map((t) => `(∂${r.name}/∂${t.name} · σ_${t.name})²`).join(' + ') + ' )';
      parts.push(el('div', { class: 'formula' }, formula));
      const rows = r.terms.map((t) => el('tr', null,
        el('td', { class: 'mono' }, t.name),
        el('td', { class: 'mono' }, pretty(t.derivative)),
        el('td', { class: 'mono' }, num(t.derivValue)),
        el('td', { class: 'mono' }, t.sigma > 0 ? num(t.sigma) : '0'),
        el('td', { class: 'mono' }, t.sigma > 0 ? num(Math.abs(t.term)) : '–')));
      parts.push(el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'x'), el('th', null, `∂${r.name}/∂x`), el('th', null, 'value'),
          el('th', null, 'σₓ'), el('th', null, '|∂' + r.name + '/∂x| · σₓ'))),
        el('tbody', null, rows))));
    }
    resultBox.replaceChildren(...parts);
  }

  function copy(text, btn) {
    const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy'), 1500); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const t = el('textarea', { style: 'position:fixed;opacity:0' });
      t.value = text; document.body.append(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      t.remove();
    }
  }

  // ---------- controls ----------
  function setDegrees(on) {
    state.degrees = on;
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', (b.dataset.deg === '1') === on));
  }
  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => { setDegrees(b.dataset.deg === '1'); update(); }));
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
  update();
})();
