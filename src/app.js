(function () {
  'use strict';
  const EP = window.ErrorProp;
  const STORE = 'errorprop.v1';
  const METHODS = {
    partial: { label: 'Partial derivatives', short: 'standard, adds in quadrature' },
    rules: { label: 'Simple rules', short: 'step by step, worst case' },
    maxmin: { label: 'Max–min', short: 'half the range of extremes' },
  };
  const RUN = { partial: EP.calculate, rules: EP.simpleRules, maxmin: EP.maxMin };
  const START_ROWS = 5;

  const state = Object.assign(
    { equation: '', vars: {}, degrees: false, rounding: 'auto', method: 'partial', mode: 'single', table: null },
    load() || {}
  );
  if (!METHODS[state.method]) state.method = 'partial';
  if (!state.table) state.table = { cols: {}, rows: [], selected: 0 };
  while (state.table.rows.length < START_ROWS) state.table.rows.push({});

  let names = [];             // variables in the current equation
  let builtFor = '';          // what the input area was last built for
  let detailTimer = null, rowMcTimer = null, token = 0;
  let rowCells = [];          // table: per-row { tr, res, chk }
  let rowResults = [];        // table: per-row computed results

  const $ = (id) => document.getElementById(id);
  const eqInput = $('eq'), varsBox = $('vars'), tableBox = $('table-box'), resultBox = $('result');
  const roundSel = $('round'), preview = $('eq-preview');

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
      if (v === false || v == null) return;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
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
  const roundMode = () => (state.rounding === 'auto' ? 'auto' : Number(state.rounding));
  const fmt = (v, s) => EP.formatResult(v, s, roundMode());
  const varState = (n) => (state.vars[n] = state.vars[n] || { value: '', unc: '', type: 'abs' });
  const colState = (n) => (state.table.cols[n] = state.table.cols[n] || { perRow: false, unc: '', type: 'abs' });
  const cellState = (row, n) => (row[n] = row[n] || { value: '', unc: '' });
  const blank = (s) => String(s == null ? '' : s).trim() === '';

  function copyText(text, b, label) {
    const done = () => { b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = label), 1500); };
    const fallback = () => {
      const t = el('textarea', { style: 'position:fixed;opacity:0' });
      t.value = text; document.body.append(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      t.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  function copyButton(label, getText) {
    const b = el('button', { class: 'ghost small', type: 'button' }, label);
    b.addEventListener('click', () => copyText(getText(), b, label));
    return b;
  }
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function mark(input) {
    input.classList.toggle('invalid', !blank(input.value) && isNaN(EP.parseNumber(input.value)));
  }
  // A typed number as LaTeX, keeping the person's significant figures where possible.
  function typedTex(s) {
    const t = String(s).trim();
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? t : T(EP.parseNumber(t), 6);
  }

  // ---------- main update ----------
  function update() {
    save();
    token++;
    clearTimeout(detailTimer); clearTimeout(rowMcTimer);
    try {
      names = EP.listVariables(state.equation);
      preview.replaceChildren(tex(EP.equationTex(state.equation), true));
    } catch (err) {
      preview.replaceChildren();
      if (blank(state.equation)) { names = []; rebuildInputs(); resultBox.replaceChildren(); return; }
      return message(resultBox, err.message, true);
    }
    rebuildInputs();
    if (state.mode === 'table') updateTable();
    else updateSingle();
  }

  function rebuildInputs(force) {
    const key = state.mode + '|' + names.join('|') + '|' +
      (state.mode === 'table' ? names.map((n) => colState(n).perRow).join(',') + '|' + state.table.rows.length : '');
    if (key === builtFor && !force) return;
    builtFor = key;
    if (state.mode === 'table') renderTable(); else renderVars();
  }

  function message(box, text, isError) {
    box.replaceChildren(el('p', { class: 'msg' + (isError ? ' error' : '') }, text));
  }

  // Values typed by the person -> vars for the engine (or an error message).
  function readVars(get) {
    const vars = [];
    const missing = [];
    for (const n of names) {
      const { value: vs, unc: us, type, needUnc } = get(n);
      if (blank(vs)) { missing.push(n); continue; }
      if (needUnc && blank(us)) { missing.push('uncertainty of ' + n); continue; }
      const value = EP.parseNumber(vs);
      const unc = blank(us) ? 0 : EP.parseNumber(us);
      if (isNaN(value)) return { error: `Can't read "${vs}" as a number (value of ${n}).` };
      if (isNaN(unc)) return { error: `Can't read "${us}" as a number (uncertainty of ${n}).` };
      vars.push({ name: n, value, unc, type });
    }
    if (missing.length) return { missing };
    return { vars };
  }

  // Runs all three methods. Returns { lin, all, main } or { error }.
  function runAll(vars, onlyMain) {
    const opts = { degrees: state.degrees };
    let lin;
    try { lin = EP.calculate(state.equation, vars, opts); } catch (e) { return { error: e.message }; }
    const all = { partial: lin };
    Object.keys(RUN).forEach((m) => {
      if (m === 'partial' || (onlyMain && m !== state.method)) return;
      try { all[m] = RUN[m](state.equation, vars, opts); } catch (e) { all[m] = e; }
    });
    const main = all[state.method];
    if (main instanceof Error) return { error: main.message, lin, all };
    return { lin, all, main, vars };
  }

  // ---------- single mode ----------
  function renderVars() {
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
      const type = typeSelect(s.type, n);
      value.addEventListener('input', () => { s.value = value.value; mark(value); update(); });
      unc.addEventListener('input', () => { s.unc = unc.value; mark(unc); update(); });
      type.addEventListener('change', () => { s.type = type.value; update(); });
      mark(value); mark(unc);
      varsBox.append(el('div', { class: 'var-row' }, tex(N(n), false, 'var-name'), value, el('span', { class: 'pm' }, '±'), unc, type));
    });
  }
  function typeSelect(value, n) {
    const s = el('select', { 'aria-label': n + ' uncertainty type' },
      el('option', { value: 'abs' }, 'abs'), el('option', { value: 'pct' }, '%'));
    s.value = value;
    return s;
  }

  function updateSingle() {
    const read = readVars((n) => varState(n));
    if (read.error) return message(resultBox, read.error, true);
    if (read.missing) return message(resultBox, 'Enter a value for: ' + read.missing.join(', '));
    const res = runAll(read.vars);
    if (res.error) return message(resultBox, res.error, !res.error.startsWith('Enter a value'));
    renderResult(resultBox, res);
  }

  // ---------- result rendering (single mode, and the selected row in table mode) ----------
  function renderResult(box, res) {
    const { main: r, lin, all, vars } = res;
    const f = fmt(r.value, r.sigma);
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
      parts.push(el('div', { class: 'check pending mc-check' }, 'Running Monte Carlo check…'));
      parts.push(...contributions(lin, r !== lin));
    }
    if (r.sigma > 0) parts.push(...working(r, f));
    if (lin.sigma > 0) parts.push(...comparison(all));
    box.replaceChildren(...parts);

    if (lin.sigma > 0) {
      const t = token;
      detailTimer = setTimeout(() => {
        if (t !== token) return;
        let mc;
        try { mc = EP.monteCarlo(state.equation, vars, { degrees: state.degrees }); } catch (e) { return showMc(box, null, e.message); }
        if (t === token) showMc(box, lin, mc);
      }, 150);
    }
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
        : tex(fmt(r.value, r.sigma).tex);
      const tr = el('tr', { class: m === state.method ? 'on' : 'pick', title: 'Use this method' },
        el('td', null, METHODS[m].label, el('div', { class: 'muted' }, METHODS[m].short)), el('td', null, cell));
      if (m !== state.method && !(r instanceof Error)) tr.addEventListener('click', () => setMethod(m, true));
      return tr;
    });
    rows.push(el('tr', { class: 'mc-row' }, el('td', null, 'Monte Carlo', el('div', { class: 'muted' }, 'simulation, 68% range')), el('td', { class: 'muted' }, '…')));
    return [
      el('h3', null, 'Compare methods'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, el('tbody', null, rows))),
      el('p', { class: 'hint' }, 'Simple rules and max–min give a worst-case uncertainty, so they come out larger. Click a method to use it.'),
    ];
  }

  function showMc(container, lin, mc) {
    const box = container.querySelector('.mc-check'), row = container.querySelector('.mc-row');
    if (!box) return;
    if (!lin) { box.className = 'check bad mc-check'; box.textContent = '⚠ ' + mc; return; }
    const c = EP.mcCheck(lin, mc);
    const n = mc.n.toLocaleString('en-GB');
    box.replaceChildren();
    if (c.ok) {
      box.className = 'check good mc-check';
      box.append(`✓ Monte Carlo check passed: ${n} simulated measurements have a 68% spread of ±${num(c.spread, 3)}, matching the formula (σ = ${num(lin.sigma, 3)}).`);
    } else {
      box.className = 'check bad mc-check';
      box.append('⚠ Monte Carlo check: ' + mcProblems(c, lin).join('; ') + '. Your uncertainties are big enough that the formula\'s straight-line approximation isn\'t reliable here. Consider quoting the Monte Carlo result: ');
      box.append(tex(N(lin.name) + ' = ' + asymTex(mc.median, c.up, c.down)));
    }
    if (row) {
      row.lastChild.className = '';
      row.lastChild.replaceChildren(tex(asymTex(mc.median, c.up, c.down)));
    }
  }
  function mcProblems(c, lin) {
    const why = [];
    if (Math.abs(c.sdDiff) >= 0.05) why.push(`the 68% spread is ±${num(c.spread, 3)}, ${num(Math.abs(c.sdDiff) * 100, 2)}% ${c.sdDiff > 0 ? 'bigger' : 'smaller'} than the formula's σ = ${num(lin.sigma, 3)}`);
    if (c.asym <= 0.8 || c.asym >= 1.25) why.push('the spread is lopsided (asymmetric)');
    if (c.shift >= 0.1) why.push('the typical result is shifted away from the calculated value');
    if (c.failedFrac >= 0.001) why.push(`${num(c.failedFrac * 100, 2)}% of simulated values were impossible (e.g. square root of a negative)`);
    return why;
  }

  // median^{+up}_{-down}, all rounded to the same decimal place (like value ± uncertainty).
  function asymTex(median, up, down) {
    const fUp = fmt(median, up), fDown = fmt(median, down);
    if (fUp.sci || fDown.sci) return T(median, 4) + '^{+' + T(up, 2) + '}_{-' + T(down, 2) + '}';
    const dp = Math.max(...[fUp, fDown].map((f) => (f.sigma.split('.')[1] || '').length));
    const fix = (x) => (dp > 0 ? x.toFixed(dp) : String(Math.round(x)));
    return fix(median) + '^{+' + fix(up) + '}_{-' + fix(down) + '}';
  }

  // ---------- table mode ----------

  // Editable columns in order (used for paste and Enter-to-move-down).
  const editCols = () => names.flatMap((n) => (colState(n).perRow ? [[n, 'value'], [n, 'unc']] : [[n, 'value']]));

  function renderTable() {
    tableBox.replaceChildren();
    rowCells = [];
    if (!names.length) {
      tableBox.append(el('p', { class: 'empty' }, 'Your columns will appear here once you type an equation.'));
      return;
    }
    // Uncertainty settings per variable
    const config = el('div', { class: 'col-config' });
    names.forEach((n) => {
      const c = colState(n);
      const unc = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'uncertainty', 'aria-label': n + ' uncertainty for all rows', autocomplete: 'off', disabled: c.perRow });
      unc.value = c.perRow ? '' : c.unc;
      unc.addEventListener('input', () => { c.unc = unc.value; mark(unc); update(); });
      mark(unc);
      const type = typeSelect(c.type, n);
      type.addEventListener('change', () => { c.type = type.value; update(); });
      const per = el('input', { type: 'checkbox', checked: c.perRow });
      per.addEventListener('change', () => {
        c.perRow = per.checked;
        // start each row's uncertainty from the shared one, so nothing silently becomes 0
        if (c.perRow && !blank(c.unc)) {
          state.table.rows.forEach((row) => {
            const cell = cellState(row, n);
            if (!blank(cell.value) && blank(cell.unc)) cell.unc = c.unc;
          });
        }
        update();
      });
      config.append(el('div', { class: 'cfg-row' },
        tex(N(n), false, 'var-name'),
        el('span', { class: 'pm' }, '±'), unc, type,
        el('label', { class: 'per-row' }, per, ' different for each row')));
    });
    tableBox.append(el('p', { class: 'hint first' }, 'Uncertainty of each variable (same for every row, unless you tick the box):'), config);

    // The grid
    const cols = editCols();
    const head = el('tr', null, el('th', { class: 'rownum' }, '#'),
      cols.map(([n, field]) => el('th', null, tex(field === 'unc' ? '\\sigma_{' + N(n) + '}' : N(n)))),
      el('th', { class: 'res-col' }, tex(N(resultName()))), el('th', { title: 'Monte Carlo check' }, 'check'), el('th'));
    const body = el('tbody');
    state.table.rows.forEach((row, r) => {
      const tr = el('tr', { class: r === state.table.selected ? 'sel' : '' });
      const numBtn = el('button', { type: 'button', class: 'rownum-btn', title: 'Show the working for this row' }, String(r + 1));
      numBtn.addEventListener('click', () => selectRow(r));
      tr.append(el('td', { class: 'rownum' }, numBtn));
      cols.forEach(([n, field], c) => {
        const cell = cellState(row, n);
        const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-r': r, 'data-c': c, 'aria-label': `Row ${r + 1} ${field === 'unc' ? 'uncertainty of ' : ''}${n}` });
        input.value = cell[field];
        mark(input);
        input.addEventListener('input', () => { cell[field] = input.value; mark(input); update(); });
        input.addEventListener('focus', () => { if (state.table.selected !== r) selectRow(r, true); });
        tr.append(el('td', null, input));
      });
      const res = el('td', { class: 'res' }), chk = el('td', { class: 'chk' });
      const del = el('button', { type: 'button', class: 'del', title: 'Delete row ' + (r + 1), 'aria-label': 'Delete row ' + (r + 1) }, '×');
      del.addEventListener('click', () => {
        state.table.rows.splice(r, 1);
        if (!state.table.rows.length) state.table.rows.push({});
        state.table.selected = Math.min(state.table.selected, state.table.rows.length - 1);
        builtFor = '';
        update();
      });
      tr.append(res, chk, el('td', null, del));
      body.append(tr);
      rowCells.push({ tr, res, chk });
    });
    const grid = el('table', { class: 'grid' }, el('thead', null, head), body);
    grid.addEventListener('paste', onPaste);
    grid.addEventListener('keydown', onGridKey);
    tableBox.append(el('div', { class: 'table-wrap grid-wrap' }, grid));

    const add = el('button', { type: 'button', class: 'ghost small' }, '+ Add row');
    add.addEventListener('click', () => { state.table.rows.push({}); update(); focusCell(state.table.rows.length - 1, 0); });
    const clear = el('button', { type: 'button', class: 'ghost small' }, 'Clear readings');
    clear.addEventListener('click', () => {
      if (clear.dataset.armed) {
        state.table.rows = Array.from({ length: START_ROWS }, () => ({}));
        state.table.selected = 0;
        builtFor = '';
        update();
      } else {
        clear.dataset.armed = '1'; clear.textContent = 'Click again to clear';
        setTimeout(() => { delete clear.dataset.armed; clear.textContent = 'Clear readings'; }, 3000);
      }
    });
    tableBox.append(el('div', { class: 'table-actions' }, add, clear,
      el('span', { class: 'hint' }, 'Tip: copy cells from Excel and paste them into any cell. Enter moves down.')));
  }

  function resultName() {
    const i = state.equation.indexOf('=');
    return (i > 0 && state.equation.slice(0, i).trim()) || 'f';
  }

  function focusCell(r, c) {
    const input = tableBox.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (input) { input.focus(); input.select(); }
  }

  function onGridKey(e) {
    const t = e.target;
    if (e.key !== 'Enter' || t.dataset.r == null) return;
    e.preventDefault();
    const r = Number(t.dataset.r), c = Number(t.dataset.c);
    if (r + 1 >= state.table.rows.length) { state.table.rows.push({}); update(); }
    focusCell(r + 1, c);
  }

  // Paste a block of cells from a spreadsheet, starting at the cell pasted into.
  function onPaste(e) {
    const t = e.target;
    if (t.dataset.r == null) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // a single value: normal paste
    e.preventDefault();
    const grid = EP.parseGrid(text);
    const cols = editCols();
    const r0 = Number(t.dataset.r), c0 = Number(t.dataset.c);
    grid.forEach((line, i) => {
      const r = r0 + i;
      while (state.table.rows.length <= r) state.table.rows.push({});
      line.forEach((val, j) => {
        const col = cols[c0 + j];
        if (col) cellState(state.table.rows[r], col[0])[col[1]] = val;
      });
    });
    builtFor = '';
    update();
    focusCell(r0, c0);
  }

  function selectRow(r, keepFocus) {
    state.table.selected = r;
    rowCells.forEach((c, i) => c.tr.classList.toggle('sel', i === r));
    if (keepFocus) { save(); token++; clearTimeout(detailTimer); renderDetail(); scheduleRowChecks(); }
    else update();
  }

  // Row r -> the values to calculate with.
  function rowGetter(row) {
    return (n) => {
      const c = colState(n), cell = cellState(row, n);
      return { value: cell.value, unc: c.perRow ? cell.unc : c.unc, type: c.type, needUnc: c.perRow };
    };
  }

  function updateTable() {
    rowResults = state.table.rows.map((row, r) => {
      const cells = rowCells[r];
      const empty = names.every((n) => blank(cellState(row, n).value));
      if (empty) { cells.res.replaceChildren(); cells.chk.replaceChildren(); return null; }
      const read = readVars(rowGetter(row));
      let res;
      if (read.error) res = { error: read.error };
      else if (read.missing) res = { error: 'Missing ' + read.missing.join(', '), missing: true };
      else res = runAll(read.vars, true);
      if (res.error) {
        cells.res.replaceChildren(el('span', { class: res.missing ? 'muted' : 'cell-error', title: res.error }, res.missing ? res.error : '⚠ ' + res.error));
        cells.chk.replaceChildren();
        return res;
      }
      const f = fmt(res.main.value, res.main.sigma);
      cells.res.replaceChildren(tex(f.tex));
      if (res.main.sigma > 0) cells.res.append(el('span', { class: 'muted rel' }, ' ' + num(res.main.relative * 100, 2) + '%'));
      cells.chk.replaceChildren(el('span', { class: 'muted' }, res.lin.sigma > 0 ? '…' : ''));
      return res;
    });
    renderSummary();
    scheduleRowChecks();
  }

  function goodRows() {
    return rowResults.map((r, i) => ({ r, i })).filter(({ r }) => r && !r.error);
  }

  function renderSummary() {
    const good = goodRows();
    const parts = [];
    if (!good.length) {
      const anyStarted = rowResults.some((r) => r);
      return message(resultBox, anyStarted ? 'Finish entering at least one row to see results.' : 'Enter your readings in the table (or paste them from a spreadsheet).');
    }
    const name = good[0].r.main.name, g = N(name);
    const s = EP.summarize(good.map(({ r }) => r.main.value), good.map(({ r }) => r.main.sigma));
    parts.push(el('div', { class: 'section-head first' }, el('h3', null, `Summary of ${good.length} row${good.length > 1 ? 's' : ''}`),
      el('div', { class: 'buttons' },
        (() => { const b = el('button', { type: 'button', class: 'small primary' }, 'Export CSV'); b.addEventListener('click', exportCsv); return b; })(),
        copyButton('Copy as LaTeX table', latexTable))));

    const lines = summaryLines(s, g);
    if (lines.length) {
      const list = el('div', { class: 'summary' });
      lines.forEach(([t, note]) => list.append(el('div', { class: 'sum-row' }, tex(t), el('span', { class: 'muted' }, note))));
      parts.push(list);
    } else {
      parts.push(el('p', { class: 'hint' }, 'Add more rows to see the mean.'));
    }
    if (s.chi2red > 2 && s.n >= 3) {
      parts.push(el('div', { class: 'warn' }, `⚠ The results scatter more than their uncertainties suggest (reduced χ² = ${num(s.chi2red, 2)}). There may be a systematic error, or the uncertainties may be underestimated. The plain mean ± standard error is the safer one to quote.`));
    }

    // Working for the selected row
    parts.push(el('div', { class: 'detail', id: 'detail' }));
    resultBox.replaceChildren(...parts);
    renderDetail();
  }

  function summaryLines(s, g) {
    const lines = [];
    if (s.n > 1) {
      lines.push(['\\bar{' + g + '} = ' + fmt(s.mean, s.sem).tex, 'mean ± standard error (σ/√n, from the spread of the results)']);
      lines.push(['s_{' + g + '} = ' + T(s.sd, 3), 'standard deviation of the results']);
    }
    if (isFinite(s.wmean) && s.n > 1) {
      lines.push([g + '_{w} = ' + fmt(s.wmean, s.wsigma).tex, 'weighted mean (each row weighted by 1/σ²)']);
    }
    return lines;
  }

  function renderDetail() {
    const box = $('detail');
    if (!box) return;
    const good = goodRows();
    let sel = state.table.selected;
    const chosen = rowResults[sel] && !rowResults[sel].error ? sel : good.length ? good[0].i : -1;
    if (chosen < 0) { box.replaceChildren(); return; }
    // the detail needs all methods for the comparison table
    const res = runAll(rowResults[chosen].vars);
    if (res.error) { box.replaceChildren(); return; }
    const inner = el('div');
    box.replaceChildren(el('h3', { class: 'detail-head' }, `Working for row ${chosen + 1}`,
      el('span', { class: 'muted' }, '  (click a row number to change)')), inner);
    renderResult(inner, res);
  }

  // Monte Carlo check per row (smaller sample, run in the background row by row).
  function scheduleRowChecks() {
    clearTimeout(rowMcTimer);
    const t = token;
    const queue = goodRows().filter(({ r }) => r.lin.sigma > 0);
    const next = () => {
      if (t !== token || !queue.length) return;
      const { r, i } = queue.shift();
      const cell = rowCells[i] && rowCells[i].chk;
      try {
        const mc = EP.monteCarlo(state.equation, r.vars, { degrees: state.degrees }, { n: 20000 });
        const c = EP.mcCheck(r.lin, mc);
        r.mc = { mc, c };
        if (cell) cell.replaceChildren(c.ok
          ? el('span', { class: 'ok-mark', title: 'Monte Carlo check passed' }, '✓')
          : el('span', { class: 'warn-mark', title: 'Monte Carlo check: ' + mcProblems(c, r.lin).join('; ') + '. Click the row number for details.' }, '⚠'));
      } catch (e) {
        if (cell) cell.replaceChildren(el('span', { class: 'warn-mark', title: e.message }, '⚠'));
      }
      rowMcTimer = setTimeout(next, 0);
    };
    rowMcTimer = setTimeout(next, 300);
  }

  // ---------- export ----------
  function exportCsv() {
    const good = goodRows();
    const name = good.length ? good[0].r.main.name : 'f';
    const header = ['row'];
    names.forEach((n) => header.push(n, n + ' uncertainty'));
    header.push(name, name + ' uncertainty', name + ' (rounded)', name + ' uncertainty (rounded)', 'relative uncertainty (%)', 'Monte Carlo check', 'notes');
    const rows = [header];
    const rounded = (f) => (f.sci ? f.value + 'e' + f.exp : f.value);
    rowResults.forEach((res, i) => {
      if (!res) return;
      const row = state.table.rows[i], get = rowGetter(row);
      const line = [i + 1];
      names.forEach((n) => {
        const v = get(n), x = EP.parseNumber(v.value), u = blank(v.unc) ? 0 : EP.parseNumber(v.unc);
        line.push(isNaN(x) ? v.value : x, v.type === 'pct' && isFinite(x) ? (Math.abs(x) * u) / 100 : u);
      });
      if (res.error) {
        line.push('', '', '', '', '', '', res.error);
      } else {
        const r = res.main, f = fmt(r.value, r.sigma);
        line.push(r.value, r.sigma, rounded(f), f.sigma == null ? '' : f.sigma, r.sigma > 0 ? r.relative * 100 : 0,
          res.mc ? (res.mc.c.ok ? 'passed' : 'warning: ' + mcProblems(res.mc.c, res.lin).join('; ')) : '',
          [...(r.warnings || [])].join(' '));
      }
      rows.push(line);
    });
    const s = good.length ? EP.summarize(good.map(({ r }) => r.main.value), good.map(({ r }) => r.main.sigma)) : null;
    if (s && s.n > 1) {
      rows.push([]);
      rows.push(['summary', 'value', 'uncertainty']);
      rows.push(['mean ± standard error', s.mean, s.sem]);
      rows.push(['standard deviation', s.sd, '']);
      if (isFinite(s.wmean)) rows.push(['weighted mean', s.wmean, s.wsigma]);
      if (isFinite(s.chi2red)) rows.push(['reduced chi-squared', s.chi2red, '']);
      rows.push(['rows', s.n, '']);
    }
    rows.push([]);
    rows.push(['equation', state.equation]);
    rows.push(['method', METHODS[state.method].label]);
    rows.push(['angles', state.degrees ? 'degrees' : 'radians']);
    download((name || 'results') + '-results.csv', '\uFEFF' + EP.toCsv(rows), 'text/csv;charset=utf-8');
  }

  function latexTable() {
    const cols = names.map((n) => {
      const c = colState(n);
      const fixedUnc = !c.perRow && !blank(c.unc) ? ' \\; (\\pm ' + typedTex(c.unc) + (c.type === 'pct' ? '\\%' : '') + ')' : '';
      return { n, c, head: '$' + N(n) + fixedUnc + '$' };
    });
    const good = goodRows();
    const name = good.length ? good[0].r.main.name : 'f';
    const lines = [];
    lines.push('\\begin{tabular}{' + 'c'.repeat(cols.length + 1) + '}');
    lines.push('\\hline');
    lines.push(cols.map((c) => c.head).concat('$' + N(name) + '$').join(' & ') + ' \\\\');
    lines.push('\\hline');
    good.forEach(({ r, i }) => {
      const row = state.table.rows[i];
      const cells = cols.map(({ n, c }) => {
        const cell = cellState(row, n);
        const val = typedTex(cell.value);
        return '$' + (c.perRow && !blank(cell.unc) ? val + ' \\pm ' + typedTex(cell.unc) + (c.type === 'pct' ? '\\%' : '') : val) + '$';
      });
      const f = fmt(r.main.value, r.main.sigma);
      lines.push(cells.concat('$' + f.tex + '$').join(' & ') + ' \\\\');
    });
    lines.push('\\hline');
    const s = good.length ? EP.summarize(good.map(({ r }) => r.main.value), good.map(({ r }) => r.main.sigma)) : null;
    if (s && s.n > 1) {
      summaryLines(s, N(name)).forEach(([t]) => lines.push('\\multicolumn{' + (cols.length + 1) + '}{l}{$' + t + '$} \\\\'));
      lines.push('\\hline');
    }
    lines.push('\\end{tabular}');
    return lines.join('\n');
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
  function setMode(m, recalc) {
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('single-card').hidden = m !== 'single';
    $('table-card').hidden = m !== 'table';
    if (m === 'table' && recalc) seedTable();
    builtFor = '';
    if (recalc) update();
  }
  // First time in table mode: carry over the single-mode values as row 1.
  function seedTable() {
    let ns;
    try { ns = EP.listVariables(state.equation); } catch (e) { return; }
    const t = state.table;
    const empty = t.rows.every((row) => ns.every((n) => !row[n] || blank(row[n].value)));
    if (!empty) return;
    ns.forEach((n) => {
      const v = state.vars[n];
      if (!v) return;
      const c = colState(n);
      if (blank(c.unc)) { c.unc = v.unc; c.type = v.type; }
      cellState(t.rows[0], n).value = v.value;
    });
  }

  document.querySelectorAll('[data-deg]').forEach((b) =>
    b.addEventListener('click', () => { setDegrees(b.dataset.deg === '1'); update(); }));
  document.querySelectorAll('[data-method]').forEach((b) =>
    b.addEventListener('click', () => setMethod(b.dataset.method, true)));
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode, true)));
  roundSel.addEventListener('change', () => { state.rounding = roundSel.value; update(); });
  eqInput.addEventListener('input', () => { state.equation = eqInput.value; builtFor = ''; update(); });
  $('example').addEventListener('click', () => {
    state.equation = eqInput.value = 'g = 4*pi^2*L/T^2';
    if (state.mode === 'table') {
      state.table.cols.L = { perRow: false, unc: '0.002', type: 'abs' };
      state.table.cols.T = { perRow: false, unc: '0.03', type: 'abs' };
      const data = [['0.300', '1.10'], ['0.400', '1.27'], ['0.500', '1.42'], ['0.600', '1.55'], ['0.700', '1.68']];
      state.table.rows = data.map(([L, T]) => ({ L: { value: L, unc: '' }, T: { value: T, unc: '' } }));
      state.table.selected = 0;
    } else {
      state.vars.L = { value: '0.500', unc: '0.002', type: 'abs' };
      state.vars.T = { value: '1.42', unc: '0.03', type: 'abs' };
    }
    builtFor = '';
    update();
  });

  eqInput.value = state.equation;
  roundSel.value = state.rounding;
  setDegrees(!!state.degrees);
  setMethod(state.method, false);
  setMode(state.mode === 'table' ? 'table' : 'single', false);
  update();
})();
