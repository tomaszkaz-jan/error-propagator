(function () {
  'use strict';
  const EP = window.ErrorProp;
  const METHODS = {
    partial: { label: 'Partial derivatives', short: 'standard, adds in quadrature' },
    rules: { label: 'Simple rules', short: 'step by step, worst case' },
    maxmin: { label: 'Max-min', short: 'half the range of extremes' },
  };
  const RUN = { partial: EP.calculate, rules: EP.simpleRules, maxmin: EP.maxMin };
  const START_ROWS = 5;

  // ================= Saved sessions =================
  // All sessions live in this browser's localStorage under one key:
  //   { active: id, sessions: { id: { name, created, updated, data } } }
  const SKEY = 'errorprop.sessions.v1';
  const OLD_KEY = 'errorprop.v1';
  let storageOk = true;

  const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max || 200);
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // A column name for x-y mode: a plain variable name, but not the constants pi or e.
  const xyName = (k) => typeof k === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && k !== 'pi' && k !== 'e';

  // Only known fields with the right types survive (also used for restored backup files).
  function cleanData(d) {
    d = d && typeof d === 'object' ? d : {};
    const out = {
      equation: str(d.equation, 500),
      vars: {},
      degrees: !!d.degrees,
      rounding: ['auto', '1', '2'].includes(String(d.rounding)) ? String(d.rounding) : 'auto',
      method: METHODS[d.method] ? d.method : 'partial',
      mode: d.mode === 'table' ? 'table' : 'single',
      resultUnit: str(d.resultUnit, 60),
      accepted: str(d.accepted, 60),
      acceptedUnc: str(d.acceptedUnc, 60),
      table: { cols: {}, rows: [], selected: 0 },
    };
    const name = (k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && k.length <= 40;
    const type = (t) => (t === 'pct' ? 'pct' : 'abs');
    Object.entries(d.vars && typeof d.vars === 'object' ? d.vars : {}).forEach(([k, v]) => {
      if (name(k) && v && typeof v === 'object') out.vars[k] = { value: str(v.value, 60), unc: str(v.unc, 60), type: type(v.type), unit: str(v.unit, 60), reps: str(v.reps, 4000), inst: str(v.inst, 60) };
    });
    const t = d.table && typeof d.table === 'object' ? d.table : {};
    Object.entries(t.cols && typeof t.cols === 'object' ? t.cols : {}).forEach(([k, c]) => {
      if (name(k) && c && typeof c === 'object') out.table.cols[k] = { perRow: !!c.perRow && !c.fixed, unc: str(c.unc, 60), type: type(c.type), unit: str(c.unit, 60), fixed: !!c.fixed, value: str(c.value, 60) };
    });
    (Array.isArray(t.rows) ? t.rows.slice(0, 2000) : []).forEach((row) => {
      const r = {};
      Object.entries(row && typeof row === 'object' ? row : {}).forEach(([k, c]) => {
        if (name(k) && c && typeof c === 'object') r[k] = { value: str(c.value, 60), unc: str(c.unc, 60) };
      });
      out.table.rows.push(r);
    });
    while (out.table.rows.length < START_ROWS) out.table.rows.push({});
    out.table.selected = Math.max(0, Math.min(Number(t.selected) || 0, out.table.rows.length - 1));
    out.table.tab = ['summary', 'graph', 'row'].includes(t.tab) ? t.tab : 'summary';
    const axis = (a, def) => (typeof a === 'string' && /^(result|custom|var:[A-Za-z_][A-Za-z0-9_]{0,39})$/.test(a) ? a : def);
    const cleanGraph = (gr) => {
      gr = gr && typeof gr === 'object' ? gr : {};
      return {
        x: axis(gr.x, ''), y: axis(gr.y, ''),
        derived: str(gr.derived, 300), derivedAccepted: str(gr.derivedAccepted, 60),
        xExpr: str(gr.xExpr, 200), yExpr: str(gr.yExpr, 200),
        xErrors: !!gr.xErrors, origin: !!gr.origin, title: str(gr.title, 120),
      };
    };
    out.table.graph = cleanGraph(t.graph);
    // "Just x and y": two columns straight into the fit, no equation. It has its own graph settings.
    const xy = t.xy && typeof t.xy === 'object' ? t.xy : {};
    let xn = xyName(xy.x) ? xy.x : 'x', yn = xyName(xy.y) ? xy.y : 'y';
    if (xn === yn) { xn = 'x'; yn = 'y'; }
    // Optional free-text labels ("Log gain") shown instead of the variable names.
    out.table.xy = { on: !!xy.on, x: xn, y: yn, xLabel: str(xy.xLabel, 40), yLabel: str(xy.yLabel, 40) };
    out.table.xyGraph = cleanGraph(t.xyGraph);
    return out;
  }

  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY));
      if (s && s.sessions && typeof s.sessions === 'object' && Object.keys(s.sessions).length) {
        if (!s.sessions[s.active]) s.active = Object.keys(s.sessions)[0];
        return s;
      }
    } catch (e) { /* fall through */ }
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch (e) { /* none */ }
    const id = newId(), now = Date.now();
    return { active: id, sessions: { [id]: { name: 'My first session', created: now, updated: now, data: cleanData(old) } } };
  }

  const store = loadStore();
  const state = cleanData(store.sessions[store.active].data);

  function save() {
    const s = store.sessions[store.active];
    s.data = JSON.parse(JSON.stringify(state));
    s.updated = Date.now();
    try {
      localStorage.setItem(SKEY, JSON.stringify(store));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    savedLabel();
  }

  // ================= DOM helpers =================
  let names = [];             // variables in the current equation
  let builtFor = '';          // what the input area was last built for
  let detailTimer = null, rowMcTimer = null, token = 0;
  let rowCells = [];          // table: per-row { tr, res, chk }
  let rowResults = [];        // table: per-row computed results

  const $ = (id) => document.getElementById(id);
  const eqInput = $('eq'), varsBox = $('vars'), tableBox = $('table-box'), resultBox = $('result');
  const roundSel = $('round'), preview = $('eq-preview'), resultUnitInput = $('result-unit');

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
  const varState = (n) => (state.vars[n] = state.vars[n] || { value: '', unc: '', type: 'abs', unit: '', reps: '', inst: '' });
  const colState = (n) => (state.table.cols[n] = state.table.cols[n] || { perRow: false, unc: '', type: 'abs', unit: '', fixed: false, value: '' });
  const xyMode = () => state.mode === 'table' && state.table.xy.on;
  const activeGraph = () => (xyMode() ? state.table.xyGraph : state.table.graph);
  // "Same value in every row" only applies with an equation; x-y columns are always read per row.
  const isFixed = (n) => !xyMode() && colState(n).fixed;
  // x-y mode: a column's typed label (plain text) if it has one, else its variable name.
  const xyLabel = (n) => {
    const xy = state.table.xy;
    if (!xyMode()) return '';
    return n === xy.x ? xy.xLabel : n === xy.y ? xy.yLabel : '';
  };
  const texText = (t) => '\\text{' + t.replace(/[\\{}$&#^_%~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\textasciicircum{}' : c === '~' ? '\\textasciitilde{}' : '\\' + c)) + '}';
  const colTex = (n) => (xyLabel(n) ? texText(xyLabel(n)) : N(n));
  const colPlain = (n) => xyLabel(n) || n;
  const cellState = (row, n) => (row[n] = row[n] || { value: '', unc: '' });
  const blank = (s) => String(s == null ? '' : s).trim() === '';
  const engineOpts = () => ({ degrees: state.degrees, resultUnit: state.resultUnit });

  /** A result in its display unit: { f: formatted, tex, text, value, sigma } */
  function shown(r) {
    const d = EP.toDisplay(r.units, r.value, r.sigma);
    const f = fmt(d.value, d.sigma);
    const u = EP.withUnit(f, r.units);
    return { f, tex: u.tex, text: r.units && r.units.display ? u.text.slice(0, -r.units.display.length) + prettyUnit(r.units.display) : u.text, value: d.value, sigma: d.sigma };
  }
  // "m / s^2" -> "m/s²", "(kg m) / s^2" -> "(kg m)/s²" for plain text
  const prettyUnit = (s) => String(s).replace(/ \/ /g, '/').replace(/\^(-?\d+)/g, (m, d) => sup(d));
  const unitSuffix = (units) => (units && units.display ? ' ' + prettyUnit(units.display) : '');
  const unitTexSuffix = (units) => (units && units.display ? (units.tex.startsWith('^') ? '' : '\\,') + units.tex : '');

  function copyText(text, b, label) {
    clip(text, () => { b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = label), 1500); });
  }
  // For buttons whose content isn't plain text (a result in the table): show a tick beside it.
  function copyFlash(text, b) {
    clip(text, () => { b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1200); });
  }
  function clip(text, done) {
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
  const safeFile = (s) => str(s, 60).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'results';
  function mark(input) {
    input.classList.toggle('invalid', !blank(input.value) && isNaN(EP.parseNumber(input.value)));
  }
  function markUnit(input) {
    input.classList.toggle('invalid', !blank(input.value) && !EP.isUnit(input.value));
  }
  // A typed number as LaTeX, keeping the person's significant figures where possible.
  function typedTex(s) {
    const t = String(s).trim();
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? t : T(EP.parseNumber(t), 6);
  }
  function unitInput(value, label, onChange) {
    const u = el('input', { class: 'unit', type: 'text', placeholder: 'unit', 'aria-label': label, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    u.value = value || '';
    markUnit(u);
    u.addEventListener('input', () => { markUnit(u); onChange(u.value); });
    return u;
  }

  // ---------- undo bar (for clearing readings, deleting rows and sessions) ----------
  let toastTimer = null;
  function dismissToast() {
    clearTimeout(toastTimer);
    const t = document.querySelector('.toast');
    if (t) t.remove();
  }
  function undoable(text, undo) {
    dismissToast();
    const b = el('button', { type: 'button', class: 'small' }, 'Undo');
    const t = el('div', { class: 'toast', role: 'status' }, el('span', null, text), b);
    b.addEventListener('click', () => { dismissToast(); undo(); });
    document.body.append(t);
    toastTimer = setTimeout(dismissToast, 8000);
  }

  // The collapsed settings card shows the current choices in one line.
  function settingsSummary() {
    const bits = [METHODS[state.method].label, state.degrees ? 'Degrees' : 'Radians'];
    if (!blank(state.resultUnit)) bits.push('Result in ' + state.resultUnit.trim());
    if (!blank(state.accepted)) bits.push('Accepted value ' + state.accepted.trim());
    if (state.rounding !== 'auto') bits.push(state.rounding + ' s.f.');
    $('settings-summary').replaceChildren(...bits.map((b) => el('span', { class: 'tag' }, b)));
  }

  // ================= main update =================
  function update() {
    save();
    settingsSummary();
    token++;
    clearTimeout(detailTimer); clearTimeout(rowMcTimer);
    if (xyMode()) {
      names = [state.table.xy.x, state.table.xy.y];
      rebuildInputs();
      return updateTable();
    }
    try {
      names = EP.listVariables(state.equation);
      preview.replaceChildren(tex(EP.equationTex(state.equation), true));
    } catch (err) {
      preview.replaceChildren();
      if (blank(state.equation)) { names = []; rebuildInputs(); emptyState(); return; }
      return message(resultBox, err.message, true);
    }
    rebuildInputs();
    if (state.mode === 'table') updateTable();
    else updateSingle();
  }

  function rebuildInputs(force) {
    const key = state.mode + (xyMode() ? '/xy' : '') + '|' + names.join('|') + '|' +
      (state.mode === 'table' ? names.map((n) => colState(n).perRow + '/' + colState(n).fixed).join(',') + '|' + state.table.rows.length : '');
    if (key === builtFor && !force) return;
    builtFor = key;
    if (state.mode === 'table') renderTable(); else renderVars();
  }

  // Shown before any equation is typed: a few real lab equations to start from.
  const EXAMPLES = [
    {
      name: 'Pendulum', eq: 'g = 4*pi^2*L/T^2', accepted: '9.81',
      vars: { L: ['50.0', '0.2', 'cm'], T: ['1.42', '0.03', 's'] },
      rows: { L: ['30.0', '40.0', '50.0', '60.0', '70.0'], T: ['1.10', '1.27', '1.42', '1.55', '1.68'] },
      graph: { y: 'custom', yExpr: 'T^2', x: 'var:L', derived: 'g = 4*pi^2/m', derivedAccepted: '9.81' },
    },
    {
      name: 'Snell’s law', eq: 'n = sin(a)/sin(b)',
      vars: { a: ['40', '0.5', 'deg'], b: ['25', '0.5', 'deg'] },
      rows: { a: ['20', '30', '40', '50', '60'], b: ['13.2', '19.5', '25.4', '30.7', '35.3'] },
      graph: { y: 'custom', yExpr: 'sin(a)', x: 'custom', xExpr: 'sin(b)', derived: 'n = m' },
    },
    {
      name: 'Ohm’s law', eq: 'R = V/I',
      vars: { V: ['5.02', '0.05', 'V'], I: ['0.213', '0.002', 'A'] },
      rows: { V: ['1.00', '2.01', '3.02', '3.98', '5.02'], I: ['0.043', '0.085', '0.128', '0.169', '0.213'] },
      graph: { y: 'var:V', x: 'var:I', derived: 'R = m' },
    },
    {
      name: 'Kinetic energy', eq: 'E_k = 0.5*m*v^2',
      vars: { m: ['0.250', '0.001', 'kg'], v: ['3.1', '0.1', 'm/s'] },
      fixed: ['m'],
      rows: { v: ['1.2', '1.9', '2.4', '3.1', '3.6'] },
      graph: {},
    },
  ];
  function emptyState() {
    const list = el('div', { class: 'examples' });
    EXAMPLES.forEach((ex) => {
      const b = el('button', { type: 'button' }, el('span', { class: 'ex-name' }, ex.name), el('span', { class: 'ex-eq' }, ex.eq));
      b.addEventListener('click', () => loadExample(ex));
      list.append(b);
    });
    resultBox.replaceChildren(el('div', { class: 'empty-state' },
      el('h2', null, 'Start with an equation'),
      el('p', null, state.mode === 'table'
        ? 'Type your own above, or open one of these worked examples with a table of realistic readings and a fitted graph.'
        : 'Type your own above, or open one of these worked examples with realistic measurements and units.'),
      list));
  }
  // Only reachable while the equation is empty, so it never replaces typed work.
  function loadExample(ex) {
    state.equation = eqInput.value = ex.eq;
    state.accepted = ex.accepted || ''; state.acceptedUnc = '';
    Object.entries(ex.vars).forEach(([n, [value, unc, unit]]) => {
      state.vars[n] = { value, unc, type: 'abs', unit, reps: '', inst: '' };
      const fixed = (ex.fixed || []).includes(n);
      state.table.cols[n] = { perRow: false, unc, type: 'abs', unit, fixed, value: fixed ? value : '' };
    });
    const count = Math.max(...Object.values(ex.rows).map((c) => c.length));
    state.table.rows = Array.from({ length: count }, (_, i) => {
      const row = {};
      Object.entries(ex.rows).forEach(([n, col]) => (row[n] = { value: col[i] || '', unc: '' }));
      return row;
    });
    state.table.selected = 0;
    Object.assign(state.table.graph, { x: '', y: '', xExpr: '', yExpr: '', derived: '', derivedAccepted: '', xErrors: false, origin: false, title: '' }, ex.graph);
    state.table.tab = ex.graph.derived ? 'graph' : 'summary';
    applyControls();
    builtFor = '';
    update();
  }

  // ---------- compare a result with an accepted value ----------
  function comparisonBox(nameTex, value, sigma, units, accStr, accUncStr) {
    if (blank(accStr)) return null;
    const acc = EP.parseNumber(accStr), au = blank(accUncStr) ? 0 : EP.parseNumber(accUncStr);
    if (isNaN(acc) || isNaN(au) || au < 0) return el('div', { class: 'check pending' }, 'Can’t read the accepted value as a number.');
    const k = EP.compare(value, sigma, acc, au), us = unitSuffix(units);
    const signed = (x, n) => (x >= 0 ? '+' : '−') + num(Math.abs(x), n);
    const diff = `Difference from the accepted value: ${signed(k.diff, 3)}${us}` + (isFinite(k.percent) ? ` (${signed(k.percent, 2)}%)` : '') + '.';
    if (!(k.nSigma >= 0)) return el('div', { class: 'check pending' }, diff + ' There is no uncertainty to compare it against.');
    const n = num(k.nSigma, 2);
    let cls = 'good', verdict;
    if (k.nSigma <= 1) verdict = `Agrees with the accepted value: ${n}σ away (within 1σ).`;
    else if (k.nSigma <= 2) verdict = `Consistent with the accepted value: ${n}σ away (within 2σ).`;
    else if (k.nSigma <= 3) { cls = 'bad'; verdict = `Borderline: ${n}σ from the accepted value. Agreement is usually claimed within 2σ.`; }
    else { cls = 'bad'; verdict = `Disagrees with the accepted value: ${n}σ away. Look for a systematic error, or uncertainties that are too small.`; }
    const sig = au > 0 ? '\\sqrt{\\sigma^{2} + \\sigma_{\\text{acc}}^{2}}' : '\\sigma';
    const line = '\\frac{\\left|{' + nameTex + '} - {' + nameTex + '}_{\\text{acc}}\\right|}{' + sig + '} = \\frac{\\left|' + T(value, 5) + ' - ' + T(acc, 5) + '\\right|}{' + T(k.combined, 3) + '} = ' + T(k.nSigma, 2);
    return el('div', { class: 'check ' + cls + ' compare-box' }, verdict + ' ' + diff, tex(line, true));
  }

  function message(box, text, isError) {
    box.replaceChildren(el('p', { class: 'msg' + (isError ? ' error' : '') }, text));
  }

  // Values typed by the person -> vars for the engine (or an error message).
  function readVars(get) {
    const vars = [];
    const missing = [];
    for (const n of names) {
      const { value: vs, unc: us, type, needUnc, unit } = get(n);
      if (blank(vs)) { missing.push(n); continue; }
      if (needUnc && blank(us)) { missing.push('uncertainty of ' + n); continue; }
      const value = EP.parseNumber(vs);
      const unc = blank(us) ? 0 : EP.parseNumber(us);
      if (isNaN(value)) return { error: `Can't read "${vs}" as a number (value of ${n}).` };
      if (isNaN(unc)) return { error: `Can't read "${us}" as a number (uncertainty of ${n}).` };
      vars.push({ name: n, value, unc, type, unit: unit || '' });
    }
    if (missing.length) return { missing };
    return { vars };
  }

  // Runs the methods. Returns { lin, all, main, vars } or { error }.
  function runAll(vars, onlyMain) {
    const opts = engineOpts();
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

  // ================= single mode =================
  const openReps = new Set(); // variables whose repeated-readings panel is open

  // Repeated readings -> mean and uncertainty written into the variable.
  function applyReps(v) {
    if (blank(v.reps)) return null;
    try {
      const inst = blank(v.inst) ? 0 : EP.parseNumber(v.inst);
      if (isNaN(inst)) throw new Error('Can’t read the instrument uncertainty as a number.');
      const st = EP.repeatStats(EP.parseReadings(v.reps), inst);
      v.value = String(Number(st.mean.toPrecision(10)));
      v.unc = String(Number(st.sigma.toPrecision(6)));
      v.type = 'abs';
      return { st };
    } catch (e) {
      return { error: e.message };
    }
  }

  function constantChip(n, label, onUse) {
    const k = EP.PHYSICAL_CONSTANTS[n];
    const b = el('button', { type: 'button', class: 'small chip' }, `Use ${n} = ${num(k.value, 9)} ${prettyUnit(k.unit)}`, el('span', { class: 'muted' }, ' ' + k.label + label));
    b.addEventListener('click', () => onUse(k));
    return b;
  }

  function renderVars() {
    varsBox.replaceChildren();
    if (!names.length) {
      varsBox.append(el('p', { class: 'empty' }, 'Your variables will appear here once you type an equation.'));
      return;
    }
    varsBox.append(el('div', { class: 'var-head', 'aria-hidden': 'true' },
      el('span', { class: 'h-name' }, 'Name'), el('span', null, 'Value'), el('span', { class: 'h-pm' }),
      el('span', null, 'Uncertainty'), el('span', null, 'Type'), el('span', null, 'Unit'), el('span', { class: 'h-rep' })));
    const chips = el('div', { class: 'chips' });
    names.forEach((n) => {
      const s = varState(n);
      const value = el('input', { class: 'v', type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'value', 'aria-label': n + ' value', autocomplete: 'off' });
      const unc = el('input', { class: 'u', type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'uncertainty', 'aria-label': n + ' uncertainty', autocomplete: 'off' });
      const type = typeSelect(s.type, n);
      value.addEventListener('input', () => { s.value = value.value; mark(value); update(); });
      unc.addEventListener('input', () => { s.unc = unc.value; mark(unc); update(); });
      type.addEventListener('change', () => { s.type = type.value; update(); });
      const unit = unitInput(s.unit, n + ' unit', (u) => { s.unit = u; update(); });

      // Repeated readings panel
      if (!blank(s.reps)) openReps.add(n);
      const repBtn = el('button', { type: 'button', class: 'small rep-btn', title: 'Work out the value and uncertainty from repeated readings' }, 'Repeats');
      const readings = el('textarea', { rows: '2', placeholder: 'e.g. 1.41 1.43 1.40 1.44 1.42 (or paste a column)', 'aria-label': n + ' repeated readings', autocapitalize: 'off', spellcheck: 'false' });
      readings.value = s.reps;
      const inst = el('input', { type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'optional', 'aria-label': n + ' instrument uncertainty', autocomplete: 'off' });
      inst.value = s.inst;
      const stats = el('div', { class: 'rep-stats' });
      const panel = el('div', { class: 'reps' },
        el('label', null, el('span', { class: 'opt-label' }, 'Readings of ', tex(N(n))), readings),
        el('label', null, el('span', { class: 'opt-label' }, 'Instrument uncertainty'), inst),
        stats);
      const sync = () => {
        const r = applyReps(s);
        const on = !!r;
        value.disabled = unc.disabled = type.disabled = on;
        value.value = s.value; unc.value = s.unc; type.value = s.type;
        mark(value); mark(unc); mark(inst);
        stats.replaceChildren();
        if (!r) stats.append(el('span', { class: 'muted' }, 'The mean becomes the value, and the standard error s/√n (combined with the instrument uncertainty) becomes the uncertainty.'));
        else if (r.error) stats.append(el('span', { class: 'cell-error' }, r.error));
        else {
          const t = r.st, g = N(n);
          const line = '\\bar{' + g + '} = ' + T(t.mean, 6) + ',\\quad s = ' + T(t.sd, 3) + ',\\quad \\frac{s}{\\sqrt{n}} = \\frac{' + T(t.sd, 3) + '}{\\sqrt{' + t.n + '}} = ' + T(t.se, 3);
          stats.append(el('div', null, tex(line)));
          if (t.instrument > 0) stats.append(el('div', null, tex('\\sigma_{' + g + '} = \\sqrt{' + T(t.se, 3) + '^{2} + ' + T(t.instrument, 3) + '^{2}} = ' + T(t.sigma, 3))));
          if (!(t.sigma > 0)) stats.append(el('div', { class: 'muted' }, 'All the readings are identical, so the spread is 0. Add the instrument uncertainty.'));
        }
      };
      const show = () => { panel.hidden = !openReps.has(n); repBtn.setAttribute('aria-expanded', String(openReps.has(n))); repBtn.classList.toggle('on', openReps.has(n)); };
      repBtn.addEventListener('click', () => {
        if (openReps.has(n)) { openReps.delete(n); s.reps = ''; readings.value = ''; sync(); update(); } else { openReps.add(n); }
        show();
        if (openReps.has(n)) readings.focus();
      });
      readings.addEventListener('input', () => { s.reps = readings.value; sync(); update(); });
      inst.addEventListener('input', () => { s.inst = inst.value; sync(); update(); });
      sync(); show();

      varsBox.append(el('div', { class: 'var-row' }, tex(N(n), false, 'var-name'), value, el('span', { class: 'pm' }, '±'), unc, type, unit, repBtn), panel);

      if (EP.PHYSICAL_CONSTANTS[n] && blank(s.value)) {
        chips.append(constantChip(n, '', (k) => {
          Object.assign(s, { value: String(k.value), unc: String(k.unc), type: 'abs', unit: k.unit, reps: '' });
          builtFor = ''; update();
        }));
      }
    });
    if (chips.children.length) varsBox.append(chips);
    varsBox.append(el('p', { class: 'hint' }, 'Units are optional. Give them (e.g. cm, s, kg, degC, deg) and the app converts to SI and checks that your equation’s units make sense.'));
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
    const badReps = names.map((n) => [n, applyReps(varState(n))]).find(([, r]) => r && r.error);
    if (badReps) return message(resultBox, `Repeated readings of ${badReps[0]}: ${badReps[1].error}`, true);
    if (read.missing) return message(resultBox, 'Enter a value for: ' + read.missing.join(', '));
    const res = runAll(read.vars);
    if (res.error) return message(resultBox, res.error, !res.error.startsWith('Enter a value'));
    renderResult(resultBox, res);
  }

  // ================= result rendering =================
  function renderResult(box, res) {
    const { main: r, lin, all, vars } = res;
    const sh = shown(r);
    const resultTex = N(r.name) + ' = ' + sh.tex;
    const parts = [];

    parts.push(el('div', { class: 'answer' },
      tex(resultTex, false, 'big'),
      el('div', { class: 'buttons' },
        copyButton('Copy', () => r.name + ' = ' + sh.text),
        copyButton('Copy LaTeX', () => resultTex))));

    const sub = el('div', { class: 'sub' });
    if (r.sigma > 0) sub.append(METHODS[r.method].label + '  ·  Relative uncertainty ' + num(r.relative * 100, 2) + '%  ·  Unrounded: ');
    else if (isNaN(r.sigma)) sub.append('The uncertainty could not be worked out with this method.  Value: ');
    else sub.append('No uncertainty: every variable has uncertainty 0.  Unrounded: ');
    sub.append(el('span', { class: 'mono' }, num(sh.value, 8) + (r.sigma > 0 ? ' ± ' + num(sh.sigma, 6) : '') + unitSuffix(r.units)));
    parts.push(sub);

    const warnings = [...new Set([...(r.warnings || []), ...(r === lin ? [] : lin.warnings)])];
    warnings.forEach((w) => parts.push(el('div', { class: 'warn' }, w)));
    const cmp = comparisonBox(N(r.name), sh.value, sh.sigma, r.units, state.accepted, state.acceptedUnc);
    if (cmp) parts.push(cmp);

    if (lin.sigma > 0) {
      parts.push(el('div', { class: 'check pending mc-check' }, 'Running Monte Carlo check…'));
      parts.push(...contributions(lin, r !== lin));
    }
    if (r.sigma > 0) parts.push(...working(r, sh));
    if (lin.sigma > 0) parts.push(...comparison(all));
    box.replaceChildren(...parts);

    if (lin.sigma > 0) {
      const t = token;
      detailTimer = setTimeout(() => {
        if (t !== token) return;
        let mc;
        try { mc = EP.monteCarlo(state.equation, vars, engineOpts()); } catch (e) { return showMc(box, null, e.message); }
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
  function working(r, sh) {
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
    lines.push([g, sh.tex]);

    const latex = () => '\\begin{align*}\n' + lines.map((l) => l[0] + ' &= ' + l[1] + (l[2] ? ' % ' + l[2] : '')).join(' \\\\\n') + '\n\\end{align*}';
    const out = [el('div', { class: 'section-head' }, el('h3', null, 'Working'), copyButton('Copy working as LaTeX', latex))];
    if (r.units) {
      const list = Object.entries(r.units.vars).map(([n, u]) => n + ' in ' + u).join(', ');
      const conv = r.units.display !== r.units.si ? `, then the result is converted to ${r.units.display}` : '';
      out.push(el('p', { class: 'hint first' }, `Working is in SI units (${list}${conv}).`));
    }
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
      const cell = r instanceof Error ? el('span', { class: 'muted' }, r.message) : tex(shown(r).tex);
      const tr = el('tr', { class: m === state.method ? 'on' : 'pick', title: 'Use this method' },
        el('td', null, METHODS[m].label, el('div', { class: 'muted' }, METHODS[m].short)), el('td', null, cell));
      if (m !== state.method && !(r instanceof Error)) tr.addEventListener('click', () => setMethod(m, true));
      return tr;
    });
    rows.push(el('tr', { class: 'mc-row' }, el('td', null, 'Monte Carlo', el('div', { class: 'muted' }, 'simulation, 68% range')), el('td', { class: 'muted' }, '…')));
    return [
      el('h3', null, 'Compare methods'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, el('tbody', null, rows))),
      el('p', { class: 'hint' }, 'Simple rules and max-min give a worst-case uncertainty, so they come out larger. Click a method to use it.'),
    ];
  }

  function showMc(container, lin, mc) {
    const box = container.querySelector('.mc-check'), row = container.querySelector('.mc-row');
    if (!box) return;
    if (!lin) { box.className = 'check bad mc-check'; box.textContent = mc; return; }
    const c = EP.mcCheck(lin, mc);
    const n = mc.n.toLocaleString('en-GB');
    const u = lin.units, k = u ? Math.abs(u.scale) : 1;
    const asym = asymTex(EP.toDisplay(u, mc.median, 0).value, c.up * k, c.down * k) + unitTexSuffix(u);
    box.replaceChildren();
    if (c.ok) {
      box.className = 'check good mc-check';
      box.append(`✓ Monte Carlo check passed: ${n} simulated measurements have a 68% spread of ±${num(c.spread * k, 3)}${unitSuffix(u)}, matching the formula (σ = ${num(lin.sigma * k, 3)}${unitSuffix(u)}).`);
    } else {
      box.className = 'check bad mc-check';
      box.append('Monte Carlo check: ' + mcProblems(c, lin).join('; ') + '. Your uncertainties are big enough that the formula\'s straight-line approximation isn\'t reliable here. Consider quoting the Monte Carlo result: ');
      box.append(tex(N(lin.name) + ' = ' + asym));
    }
    if (row) {
      row.lastChild.className = '';
      row.lastChild.replaceChildren(tex(asym));
    }
  }
  function mcProblems(c, lin) {
    const k = lin.units ? Math.abs(lin.units.scale) : 1, us = unitSuffix(lin.units);
    const why = [];
    if (Math.abs(c.sdDiff) >= 0.05) why.push(`the 68% spread is ±${num(c.spread * k, 3)}${us}, ${num(Math.abs(c.sdDiff) * 100, 2)}% ${c.sdDiff > 0 ? 'bigger' : 'smaller'} than the formula's σ = ${num(lin.sigma * k, 3)}${us}`);
    if (c.asym <= 0.8 || c.asym >= 1.25) why.push('the spread is lopsided (asymmetric)');
    if (c.shift >= 0.1) why.push('the typical result is shifted away from the calculated value');
    if (c.failedFrac >= 0.001) why.push(`${num(c.failedFrac * 100, 2)}% of simulated values were impossible (e.g. square root of a negative)`);
    return why;
  }

  // median^{+up}_{-down}, all rounded to the same decimal place (like value ± uncertainty).
  function asymTex(median, up, down) {
    const fUp = fmt(median, up), fDown = fmt(median, down);
    if (fUp.sci || fDown.sci || fUp.sigma == null || fDown.sigma == null) return T(median, 4) + '^{+' + T(up, 2) + '}_{-' + T(down, 2) + '}';
    const dp = Math.max(...[fUp, fDown].map((f) => (f.sigma.split('.')[1] || '').length));
    const fix = (x) => (dp > 0 ? x.toFixed(dp) : String(Math.round(x)));
    return fix(median) + '^{+' + fix(up) + '}_{-' + fix(down) + '}';
  }

  // ================= table mode =================

  // Editable columns in order (used for paste and Enter-to-move-down).
  const editCols = () => names.filter((n) => !isFixed(n)).flatMap((n) => (colState(n).perRow ? [[n, 'value'], [n, 'unc']] : [[n, 'value']]));

  function renderTable() {
    tableBox.replaceChildren();
    rowCells = [];
    if (!names.length) {
      tableBox.append(el('p', { class: 'empty' }, 'Your columns will appear here once you type an equation.'));
      return;
    }
    // Uncertainty, unit and (optionally) one fixed value per variable
    const config = el('div', { class: 'col-config' });
    const chips = el('div', { class: 'chips' });
    names.forEach((n, ni) => {
      const c = colState(n);
      const fixedHere = isFixed(n);
      const numAttrs = { type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' };
      const unc = el('input', Object.assign({ class: 'u-all', placeholder: 'uncertainty', 'aria-label': n + ' uncertainty for all rows', disabled: c.perRow }, numAttrs));
      unc.value = c.perRow ? '' : c.unc;
      unc.addEventListener('input', () => { c.unc = unc.value; mark(unc); update(); });
      mark(unc);
      const type = typeSelect(c.type, n);
      type.addEventListener('change', () => { c.type = type.value; update(); });
      const unit = unitInput(c.unit, n + ' unit', (u) => { c.unit = u; builtFor = ''; update(); refocus('.cfg-row', n); });
      unit.dataset.var = n;
      let fval = null;
      if (fixedHere) {
        fval = el('input', Object.assign({ class: 'fixed-value', placeholder: 'value', 'aria-label': n + ' value for every row' }, numAttrs));
        fval.value = c.value;
        mark(fval);
        fval.addEventListener('input', () => { c.value = fval.value; mark(fval); update(); });
      }
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
      const fixed = el('input', { type: 'checkbox', checked: c.fixed });
      fixed.addEventListener('change', () => {
        c.fixed = fixed.checked;
        if (c.fixed) {
          c.perRow = false;
          const first = state.table.rows.find((row) => row[n] && !blank(row[n].value));
          if (blank(c.value) && first) c.value = first[n].value;
        }
        builtFor = '';
        update();
      });
      let label = tex(N(n), false, 'var-name');
      if (xyMode()) {
        // x-y mode: the column names are typed here (they label the graph axes).
        const which = ni ? 'y' : 'x';
        label = el('label', { class: 'xy-name' }, el('span', { class: 'axis-tag' }, which),
          el('input', { type: 'text', class: 'mono col-name', value: colPlain(n), 'aria-label': `Name of the ${which} column`, title: 'Rename this column (it labels the graph axis)', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'data-axis': which }));
        label.querySelector('input').addEventListener('change', (e) => renameXy(which, e.target));
      }
      config.append(el('div', { class: 'cfg-row' + (fixedHere ? ' is-fixed' : '') },
        label, fval,
        el('span', { class: 'pm' }, '±'), unc, type, unit,
        el('div', { class: 'cfg-extra' },
          fixedHere ? null : el('label', { class: 'per-row' }, per, ' uncertainty differs in each row'),
          xyMode() ? null : el('label', { class: 'per-row' }, fixed, ' same value in every row'))));
      if (!xyMode() && EP.PHYSICAL_CONSTANTS[n] && !c.fixed && state.table.rows.every((row) => !row[n] || blank(row[n].value))) {
        chips.append(constantChip(n, ', in every row', (k) => {
          Object.assign(c, { fixed: true, perRow: false, value: String(k.value), unc: String(k.unc), type: 'abs', unit: k.unit });
          builtFor = ''; update();
        }));
      }
    });
    tableBox.append(el('p', { class: 'hint first' }, xyMode()
      ? 'Name each column (any text, e.g. Log gain), then give its uncertainty and unit. The fit needs a y uncertainty: tick the box if it differs in each row.'
      : 'Uncertainty and unit of each variable. Tick a box if the uncertainty differs in each row, or if the value is the same in every row.'), config);
    if (chips.children.length) tableBox.append(chips);

    // The grid
    const cols = editCols();
    const unitOf = (n) => (blank(colState(n).unit) ? '' : '\\ (' + EP.unitTex(colState(n).unit.trim()) + ')');
    const head = el('tr', null, el('th', { class: 'rownum' }, '#'),
      cols.map(([n, field]) => el('th', null, tex((field === 'unc' ? '\\sigma_{' + colTex(n) + '}' : colTex(n)) + unitOf(n)))),
      xyMode() ? null : el('th', { class: 'res-col' }, el('span', { class: 'res-head' }, tex(N(resultName()))), colCopy()),
      xyMode() ? null : el('th', { title: 'Monte Carlo check' }, 'check'), el('th'));
    const body = el('tbody');
    state.table.rows.forEach((row, r) => {
      const tr = el('tr', { class: r === state.table.selected ? 'sel' : '' });
      // With an equation, the row number opens that row's working; x-y rows have no working.
      const numBtn = xyMode() ? el('span', { class: 'rownum-plain' }, String(r + 1))
        : el('button', { type: 'button', class: 'rownum-btn', title: 'Show the working for this row' }, String(r + 1));
      if (!xyMode()) numBtn.addEventListener('click', () => selectRow(r));
      tr.append(el('td', { class: 'rownum' }, numBtn));
      cols.forEach(([n, field], c) => {
        const cell = cellState(row, n);
        const input = el('input', { type: 'text', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'data-r': r, 'data-c': c, 'aria-label': `Row ${r + 1} ${field === 'unc' ? 'uncertainty of ' : ''}${n}` });
        input.value = cell[field];
        mark(input);
        input.addEventListener('input', () => { cell[field] = input.value; mark(input); update(); });
        input.addEventListener('focus', () => { if (state.table.selected !== r) selectRow(r, true); });
        tr.append(el('td', null, input));
      });
      const res = xyMode() ? null : el('td', { class: 'res' }), chk = xyMode() ? null : el('td', { class: 'chk' });
      const del = el('button', { type: 'button', class: 'del', title: 'Delete row ' + (r + 1), 'aria-label': 'Delete row ' + (r + 1) }, '×');
      del.addEventListener('click', () => {
        const before = JSON.stringify(state.table.rows), sel = state.table.selected;
        const hadData = Object.values(row).some((c) => c && (!blank(c.value) || !blank(c.unc)));
        state.table.rows.splice(r, 1);
        if (!state.table.rows.length) state.table.rows.push({});
        state.table.selected = Math.min(state.table.selected, state.table.rows.length - 1);
        builtFor = '';
        update();
        if (hadData) undoable(`Row ${r + 1} deleted.`, () => { state.table.rows = JSON.parse(before); state.table.selected = sel; builtFor = ''; update(); });
      });
      let rowCopy = null;
      if (!xyMode()) {
        rowCopy = el('button', { type: 'button', class: 'row-copy', title: `Copy row ${r + 1} (readings and result) for a spreadsheet`, 'aria-label': `Copy row ${r + 1}` }, '⧉');
        rowCopy.addEventListener('click', () => copyFlash(rowText(r), rowCopy));
      }
      tr.append(...[res, chk].filter(Boolean), el('td', { class: 'row-btns' }, rowCopy, del));
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
      const before = JSON.stringify(state.table.rows), sel = state.table.selected;
      state.table.rows = Array.from({ length: START_ROWS }, () => ({}));
      state.table.selected = 0;
      builtFor = '';
      update();
      undoable('Readings cleared.', () => { state.table.rows = JSON.parse(before); state.table.selected = sel; builtFor = ''; update(); });
    });
    tableBox.append(el('div', { class: 'table-actions' }, add, clear,
      el('span', { class: 'hint' }, 'Tip: copy cells from Excel and paste them into any cell. Enter and the arrow keys move between cells.')));
  }

  function colCopy() {
    const b = el('button', { type: 'button', class: 'ghost small col-copy', title: 'Copy every result: value and uncertainty as two columns, ready to paste into a spreadsheet' }, 'Copy');
    b.addEventListener('click', () => copyText(resultColumnText(), b, 'Copy'));
    return b;
  }

  // x-y mode: rename a column, carrying its readings and settings across. Any text is fine:
  // "V" or "theta_0" become the variable name; "Log gain" is kept as a label, with the
  // variable name Log_gain (used in axis expressions such as ln(Log_gain)).
  function renameXy(which, input) {
    const xy = state.table.xy, from = xy[which], other = xy[which === 'x' ? 'y' : 'x'];
    const text = input.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text) { input.value = colPlain(from); return; }
    let to = text;
    if (!xyName(text)) {
      to = text.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
      if (!/^[A-Za-z]/.test(to)) to = which + (to ? '_' + to : '');
      if (to === 'pi' || to === 'e') to += '_';
    }
    if (to === other) to = (to + '_2').slice(0, 40);
    if (to !== from) {
      if (state.table.cols[from]) state.table.cols[to] = state.table.cols[from];
      state.table.rows.forEach((row) => { if (row[from]) { row[to] = row[from]; delete row[from]; } });
      const g = state.table.xyGraph;
      ['x', 'y'].forEach((a) => { if (g[a] === 'var:' + from) g[a] = 'var:' + to; });
      xy[which] = to;
    }
    xy[which + 'Label'] = text === to ? '' : text;
    builtFor = '';
    update();
  }

  // After a rebuild, put the cursor back in the unit box being typed in.
  function refocus(sel, n) {
    const u = tableBox.querySelector(`${sel} input.unit[data-var="${n}"]`);
    if (u) { u.focus(); const l = u.value.length; u.setSelectionRange(l, l); }
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
    if (t.dataset.r == null || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const r = Number(t.dataset.r), c = Number(t.dataset.c);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (r + 1 >= state.table.rows.length) { state.table.rows.push({}); update(); }
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const to = r + (e.key === 'ArrowDown' ? 1 : -1);
      if (to < 0 || to >= state.table.rows.length) return;
      e.preventDefault();
      focusCell(to, c);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // only leave the cell when the cursor is already at its edge
      const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
      const atEnd = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
      const to = c + (e.key === 'ArrowRight' ? 1 : -1);
      if ((e.key === 'ArrowLeft' ? !atStart : !atEnd) || !tableBox.querySelector(`input[data-r="${r}"][data-c="${to}"]`)) return;
      e.preventDefault();
      focusCell(r, to);
    }
  }

  // Paste a block of cells from a spreadsheet, starting at the cell pasted into.
  function onPaste(e) {
    const t = e.target;
    if (t.dataset.r == null) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // a single value: normal paste
    e.preventDefault();
    let grid = EP.parseGrid(text);
    // A first line with no numbers in it (e.g. "L (cm)  T (s)") is a header: skip it.
    const isHeader = (line) => line.some((v) => !blank(v)) && line.every((v) => blank(v) || isNaN(EP.parseNumber(v)));
    if (grid.length > 1 && isHeader(grid[0]) && !isHeader(grid[1])) grid = grid.slice(1);
    const cols = editCols();
    const r0 = Number(t.dataset.r), c0 = Number(t.dataset.c);
    grid.slice(0, 2000).forEach((line, i) => {
      const r = r0 + i;
      while (state.table.rows.length <= r) state.table.rows.push({});
      line.forEach((val, j) => {
        const col = cols[c0 + j];
        if (col) cellState(state.table.rows[r], col[0])[col[1]] = str(val, 60);
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
    else { state.table.tab = 'row'; update(); }
  }

  // Row r -> the values to calculate with.
  function rowGetter(row) {
    return (n) => {
      const c = colState(n), cell = cellState(row, n);
      const fixed = isFixed(n);
      return { value: fixed ? c.value : cell.value, unc: c.perRow && !fixed ? cell.unc : c.unc, type: c.type, needUnc: c.perRow && !fixed, unit: c.unit };
    };
  }

  function updateTable() {
    if (xyMode()) return updateXy();
    let units = null;
    rowResults = state.table.rows.map((row, r) => {
      const cells = rowCells[r];
      const free = names.filter((n) => !isFixed(n));
      const empty = free.every((n) => blank(cellState(row, n).value));
      if (empty) { cells.res.replaceChildren(); cells.chk.replaceChildren(); return null; }
      const read = readVars(rowGetter(row));
      let res;
      if (read.error) res = { error: read.error };
      else if (read.missing) res = { error: 'Missing ' + read.missing.join(', '), missing: true };
      else res = runAll(read.vars, true);
      if (res.error) {
        cells.res.replaceChildren(el('span', { class: res.missing ? 'muted' : 'cell-error', title: res.error }, res.error));
        cells.chk.replaceChildren();
        return res;
      }
      units = units || res.main.units;
      const sh = shown(res.main);
      const copyRes = el('button', { type: 'button', class: 'res-copy', title: 'Click to copy ' + sh.text }, tex(sh.f.tex));
      copyRes.addEventListener('click', () => copyFlash(sh.text, copyRes));
      cells.res.replaceChildren(copyRes);
      if (res.main.sigma > 0) cells.res.append(el('span', { class: 'muted rel' }, ' ' + num(res.main.relative * 100, 2) + '%'));
      cells.chk.replaceChildren(el('span', { class: 'muted' }, res.lin.sigma > 0 ? '…' : ''));
      return res;
    });
    // result unit in the column header
    const head = tableBox.querySelector('.res-head');
    if (head) head.replaceChildren(tex(N(resultName()) + (units && units.display ? '\\ (' + units.tex + ')' : '')));
    renderSummary();
    scheduleRowChecks();
  }

  // x-y mode: each row is just its two readings; the result card is the fit.
  function updateXy() {
    rowResults = state.table.rows.map((row) => {
      if (names.every((n) => blank(cellState(row, n).value))) return null;
      const read = readVars(rowGetter(row));
      if (read.error) return { error: read.error };
      if (read.missing) return { error: 'missing ' + read.missing.map((m) => m.replace(/^(uncertainty of )?(.*)$/, (a, u, n) => (u || '') + colPlain(n))).join(', '), missing: true };
      return { vars: read.vars };
    });
    if (!goodRows().length) {
      return message(resultBox, rowResults.some((r) => r)
        ? 'Finish a row (an x and a y) to see the fit.'
        : 'Type your x and y readings in the table, or paste two columns from a spreadsheet. Give y an uncertainty: the fit weights each point by it.');
    }
    resultBox.replaceChildren(graphSection());
    renderGraph();
  }

  function goodRows() {
    return rowResults.map((r, i) => ({ r, i })).filter(({ r }) => r && !r.error);
  }

  // Summary statistics, worked out in the display unit.
  function tableSummary(good) {
    const vals = good.map(({ r }) => shown(r.main));
    return EP.summarize(vals.map((v) => v.value), vals.map((v) => v.sigma));
  }

  function renderSummary() {
    const good = goodRows();
    const parts = [];
    if (!good.length) {
      const anyStarted = rowResults.some((r) => r);
      return message(resultBox, anyStarted ? 'Finish entering at least one row to see results.'
        : names.every((n) => colState(n).fixed) ? 'Every variable is set to the same value in every row. Untick one to enter readings.'
          : 'Enter your readings in the table (or paste them from a spreadsheet).');
    }
    const first = good[0].r.main, g = N(first.name);
    const s = tableSummary(good);
    const csvBtn = el('button', { type: 'button', class: 'small primary' }, 'Export CSV');
    csvBtn.addEventListener('click', exportCsv);
    parts.push(el('div', { class: 'section-head first' }, el('h3', null, `Summary of ${good.length} row${good.length > 1 ? 's' : ''}`),
      el('div', { class: 'buttons' }, csvBtn, copyButton('Copy as LaTeX table', latexTable))));

    const lines = summaryLines(s, g, first.units);
    if (lines.length) {
      const list = el('div', { class: 'summary' });
      lines.forEach(([t, note]) => list.append(el('div', { class: 'sum-row' }, tex(t), el('span', { class: 'muted' }, note))));
      parts.push(list);
    } else {
      parts.push(el('p', { class: 'hint' }, 'Add more rows to see the mean.'));
    }
    if (s.n > 1) {
      const cmp = comparisonBox('\\bar{' + g + '}', s.mean, s.sem, first.units, state.accepted, state.acceptedUnc);
      if (cmp) parts.push(cmp);
    }
    if (s.chi2red > 2 && s.n >= 3) {
      parts.push(el('div', { class: 'warn' }, `If every row measures the same quantity: the results scatter more than their uncertainties suggest (reduced χ² = ${num(s.chi2red, 2)}), so there may be a systematic error or underestimated uncertainties, and the plain mean ± standard error is the safer one to quote. (If the rows are meant to change, e.g. points for a graph, ignore this and use the straight-line fit below.)`));
    }
    const tab = state.table.tab;
    const panel = (id, kids) => el('div', { class: 'tab-panel', 'data-panel': id, role: 'tabpanel', hidden: tab !== id }, kids);
    resultBox.replaceChildren(tabBar(),
      panel('summary', parts), panel('graph', graphSection()), panel('row', el('div', { class: 'detail', id: 'detail' })));
    renderGraph();
    renderDetail();
  }

  // Summary | Graph and fit | Row working
  function tabBar() {
    const bar = el('div', { class: 'seg tabs', role: 'tablist', 'aria-label': 'Results' });
    [['summary', 'Summary'], ['graph', 'Graph and fit'], ['row', 'Row working']].forEach(([id, label]) => {
      const on = state.table.tab === id;
      const b = el('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(on), class: on ? 'on' : '' }, label);
      b.addEventListener('click', () => showTab(id));
      bar.append(b);
    });
    return bar;
  }
  function showTab(id) {
    state.table.tab = id;
    save();
    resultBox.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    resultBox.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    if (id === 'graph') renderGraph(); // redraw at the real width now it is visible
  }

  // ================= straight-line fit and graph (LSFR method) =================
  let lastFit = null; // for the CSV export

  const graphState = () => {
    const g = activeGraph();
    const free = names.filter((n) => !isFixed(n));
    const ok = (a) => (a === 'result' && !xyMode()) || a === 'custom' || (a.startsWith('var:') && names.includes(a.slice(4)));
    // Default to two measured columns: a result plotted against its own inputs is not independent data.
    if (!g.x || !ok(g.x)) g.x = free.length ? 'var:' + free[0] : 'result';
    if (!g.y || !ok(g.y)) g.y = free.length >= 2 ? 'var:' + free[1] : 'result';
    return g;
  };

  // The measured variables (with an uncertainty) that an axis depends on.
  function axisVars(which, expr) {
    let ns;
    if (which === 'result') ns = names;
    else if (which.startsWith('var:')) ns = [which.slice(4)];
    else { try { ns = EP.listVariables(expr.includes('=') ? expr : 'f = ' + expr); } catch (e) { ns = []; } }
    return ns.filter((n) => { const c = colState(n); return (c.perRow && !c.fixed) || EP.parseNumber(c.unc) > 0; });
  }

  function axisOptions(selected) {
    const s = el('select', null,
      xyMode() ? null : el('option', { value: 'result' }, resultName() + ' (the result)'),
      names.map((n) => el('option', { value: 'var:' + n }, colPlain(n))),
      el('option', { value: 'custom' }, 'expression'));
    s.value = selected;
    return s;
  }

  function graphSection() {
    const g = graphState();
    const box = el('div', { class: 'graph-section' });
    const ySel = axisOptions(g.y), xSel = axisOptions(g.x);
    const exprInput = (key, ph) => {
      const i = el('input', { type: 'text', class: 'mono expr', placeholder: ph, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': key === 'xExpr' ? 'x axis expression' : 'y axis expression' });
      i.value = g[key];
      i.addEventListener('input', () => { g[key] = i.value; save(); renderGraph(); });
      return i;
    };
    const yExpr = exprInput('yExpr', 'e.g. ln(V)'), xExpr = exprInput('xExpr', 'e.g. 1/d^2');
    const showExpr = () => { yExpr.hidden = g.y !== 'custom'; xExpr.hidden = g.x !== 'custom'; };
    showExpr();
    ySel.addEventListener('change', () => { g.y = ySel.value; showExpr(); save(); renderGraph(); });
    xSel.addEventListener('change', () => { g.x = xSel.value; showExpr(); save(); renderGraph(); });
    const check = (key, label, title) => {
      const c = el('input', { type: 'checkbox', checked: g[key] });
      c.addEventListener('change', () => { g[key] = c.checked; save(); renderGraph(); });
      return el('label', { class: 'per-row', title }, c, ' ' + label);
    };
    const derived = el('input', { type: 'text', class: 'mono derived-eq', placeholder: 'e.g. g = 4*pi^2/m', 'aria-label': 'Equation using the slope m and intercept c', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    derived.value = g.derived;
    const dAcc = el('input', { type: 'text', class: 'unit wide', placeholder: 'optional', 'aria-label': 'Accepted value for the calculated quantity', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    dAcc.value = g.derivedAccepted;
    const redoDerived = () => { save(); if (lastFit) renderDerived({ fit: lastFit.fit, slopeU: lastFit.slopeU, yUnits: lastFit.yUnits, hasUnits: lastFit.hasUnits }); };
    derived.addEventListener('input', () => { g.derived = derived.value; redoDerived(); });
    dAcc.addEventListener('input', () => { g.derivedAccepted = dAcc.value; mark(dAcc); redoDerived(); });
    const title = el('input', { type: 'text', placeholder: 'Title for the PNG', 'aria-label': 'Graph title', autocomplete: 'off' });
    title.value = g.title;
    title.addEventListener('input', () => { g.title = title.value; save(); });

    box.append(
      el('h3', null, 'Straight-line fit'),
      el('p', { class: 'hint first' }, 'Weighted least-squares fit of y = mx + c, the same method as the lab’s LSFR script. Each point is weighted by 1/σ_y², and points with no y uncertainty are left out.'),
      el('div', { class: 'graph-controls' },
        el('label', { class: 'axis-pick' }, el('span', { class: 'opt-label' }, 'y axis'), ySel, yExpr),
        el('label', { class: 'axis-pick' }, el('span', { class: 'opt-label' }, 'x axis'), xSel, xExpr)),
      el('div', { class: 'graph-controls' },
        check('xErrors', 'use x error bars in the fit', 'Effective variance: σ² = σ_y² + (m σ_x)². LSFR itself uses y errors only.'),
        check('origin', 'line through the origin (y = mx)', 'Fit y = mx with no intercept'),
        title),
      el('div', { id: 'graph-out' }),
      el('h3', null, 'Calculate from the fit'),
      el('p', { class: 'hint first' }, 'Use the slope m and intercept c in an equation, with pi, e and named constants (g, h, k_B, R, G, q_e and more) if you need them. The link between m and c is included in the uncertainty.'),
      el('div', { class: 'graph-controls' },
        el('label', { class: 'axis-pick grow' }, el('span', { class: 'opt-label' }, 'Equation'), derived),
        el('label', { class: 'axis-pick' }, el('span', { class: 'opt-label' }, 'Accepted value'), dAcc)),
      el('div', { id: 'derived-out' }));
    return box;
  }

  // One axis value for a row: { v, s, unit, error }
  function axisValue(which, expr, res, rowIndex) {
    if (which === 'result') {
      const sh = shown(res.main);
      return { v: sh.value, s: sh.sigma, unit: res.main.units ? res.main.units.display : '' };
    }
    if (which.startsWith('var:')) {
      const n = which.slice(4);
      const g = rowGetter(state.table.rows[rowIndex])(n);
      const x = EP.parseNumber(g.value), u = blank(g.unc) ? 0 : EP.parseNumber(g.unc);
      return { v: x, s: g.type === 'pct' ? (Math.abs(x) * u) / 100 : u, unit: colState(n).unit.trim() };
    }
    if (blank(expr)) return { error: 'type an expression for this axis' };
    try {
      const r = RUN[state.method](expr, res.vars, { degrees: state.degrees });
      const d = EP.toDisplay(r.units, r.value, r.sigma);
      return { v: d.value, s: d.sigma, unit: r.units ? r.units.display : '' };
    } catch (e) {
      const m = /^Enter a value for: (.*)$/.exec(e.message);
      return { error: m ? `${m[1]} isn’t a column in your table` : e.message };
    }
  }

  // Axis title: LaTeX for the page, plain text for the image.
  function axisTitle(which, expr, unit) {
    let t, p;
    if (which === 'result') { t = N(resultName()); p = resultName(); }
    else if (which.startsWith('var:')) { t = colTex(which.slice(4)); p = colPlain(which.slice(4)); }
    else {
      p = expr.trim();
      try {
        const full = EP.equationTex(expr.includes('=') ? expr : 'f = ' + expr);
        t = expr.includes('=') ? N(expr.split('=')[0].trim()) : full.slice(full.indexOf(' = ') + 3);
        if (expr.includes('=')) p = expr.split('=')[0].trim();
      } catch (e) { t = '\\text{?}'; }
    }
    return {
      tex: t + (unit ? '\\ \\left(' + EP.unitTex(unit) + '\\right)' : ''),
      plain: prettyUnit(p).replace(/\*/g, '·') + (unit ? ' (' + prettyUnit(unit) + ')' : ''),
    };
  }

  function renderGraph() {
    const out = $('graph-out');
    if (!out) return;
    lastFit = null;
    const g = graphState();
    const pts = [], left = [];
    let xu = '', yu = '';
    if (xyMode()) rowResults.forEach((r, i) => { if (r && r.error) left.push(`row ${i + 1} (${r.error})`); });
    goodRows().forEach(({ r: res, i }) => {
      const ax = axisValue(g.x, g.xExpr, res, i), ay = axisValue(g.y, g.yExpr, res, i);
      const why = ax.error || ay.error;
      if (why) return left.push(`row ${i + 1} (${why})`);
      if (!isFinite(ax.v) || !isFinite(ay.v)) return left.push(`row ${i + 1} (not a number)`);
      if (!(ay.s > 0)) return left.push(`row ${i + 1} (y uncertainty is 0)`);
      xu = xu || ax.unit; yu = yu || ay.unit;
      pts.push({ x: ax.v, y: ay.v, sx: ax.s || 0, sy: ay.s, row: i + 1 });
    });
    const xt = axisTitle(g.x, g.xExpr, xu), yt = axisTitle(g.y, g.yExpr, yu);
    pts.forEach((p) => (p.label = `Row ${p.row}: x = ${num(p.x, 5)} ± ${num(p.sx, 3)}, y = ${num(p.y, 5)} ± ${num(p.sy, 3)}`));

    const leftNote = left.length ? el('p', { class: 'hint' }, 'Left out: ' + left.join('; ') + '.') : null;
    const xv = axisVars(g.x, g.xExpr), shared = axisVars(g.y, g.yExpr).filter((n) => xv.includes(n));
    const sharedNote = shared.length ? el('div', { class: 'warn' }, `Both axes depend on ${shared.join(' and ')}, so their error bars are linked, but the fit treats them as independent. The uncertainties on m and c, and χ², are not reliable for this choice of axes. Plot two separately measured quantities instead (for example T^2 against L).`) : null;
    renderDerived(null);
    let fit;
    try {
      fit = EP.linearFit(pts.map((p) => p.x), pts.map((p) => p.y), pts.map((p) => p.sy),
        { sx: pts.map((p) => p.sx), useXErrors: g.xErrors, origin: g.origin });
    } catch (e) {
      const noYErr = !pts.length && left.some((l) => l.includes('y uncertainty is 0'));
      return out.replaceChildren(el('p', { class: 'msg' }, noYErr
        ? 'Give the y readings an uncertainty (in the y row above the table). The fit weights each point by 1/σ_y², so it can’t use points without one.'
        : e.message), leftNote || '');
    }

    const spec = { points: pts, fit, residuals: fit.residuals, rsig: fit.sigmaUsed, ariaLabel: `Graph of ${yt.plain} against ${xt.plain} with fitted line` };
    const screen = Plot.build(Object.assign({}, spec, { width: out.clientWidth || 760 }), 'screen');
    const mul = (e) => (e ? '\\;\\left(\\times10^{' + e + '}\\right)' : '');
    const svgBox = el('div', { class: 'plot-svg' });
    svgBox.innerHTML = screen.svg; // generated by plot.js; all text in it is escaped

    // Results
    const slopeU = EP.divideUnits(yu, xu);
    const yUnits = yu ? { display: yu, tex: EP.unitTex(yu) } : null;
    const fm = EP.withUnit(fmt(fit.m, fit.sm), slopeU), fc = EP.withUnit(fmt(fit.c, fit.sc), yUnits);
    const lines = ['m = ' + fm.tex];
    if (!fit.origin) lines.push('c = ' + fc.tex);
    lines.push('\\chi^{2} = ' + T(fit.chi2, 4) + ',\\quad \\nu = ' + fit.dof + ',\\quad \\chi^{2}_{\\nu} = \\frac{\\chi^{2}}{\\nu} = ' + T(fit.chi2red, 3));
    lines.push('P\\left(\\chi^{2} \\ge ' + T(fit.chi2, 4) + '\\right) = ' + T(fit.p, 2));
    const results = el('div', { class: 'fit-results' }, lines.map((l) => tex(l, false, 'fit-line')));
    const raw = el('p', { class: 'hint' }, 'Unrounded (as LSFR prints): m = ' + fit.m.toExponential(4) + ' ± ' + fit.sm.toExponential(4) +
      (fit.origin ? '' : ',  c = ' + fit.c.toExponential(4) + ' ± ' + fit.sc.toExponential(4)) +
      (fit.xErrors ? `. x errors included by effective variance (${fit.converged ? 'converged' : 'did not fully converge'} after ${fit.iterations} iterations).` : '.'));

    let verdict;
    if (fit.p < 0.05) verdict = el('div', { class: 'warn' }, `Reduced χ² = ${num(fit.chi2red, 3)} is large: the points scatter more than their error bars allow (only a ${num(fit.p * 100, 2)}% chance if the line were right). Either the relationship isn’t a straight line, or the uncertainties are underestimated. Look for a pattern in the residuals.`);
    else if (fit.p > 0.95) verdict = el('div', { class: 'warn' }, `Reduced χ² = ${num(fit.chi2red, 3)} is small: the points fit better than their error bars suggest. The uncertainties may be overestimated.`);
    else verdict = el('div', { class: 'check good' }, `✓ Good fit: reduced χ² = ${num(fit.chi2red, 3)} is close to 1, so the line agrees with the data within the error bars.`);

    const fitTex = () => '\\begin{align*}\n' + lines.map((l) => l.replace(' = ', ' &= ')).join(' \\\\\n') + '\n\\end{align*}';
    const pngBtn = el('button', { type: 'button', class: 'small primary' }, 'Download graph (PNG)');
    pngBtn.addEventListener('click', () => downloadGraph(spec, xt, yt, fm, fc, fit, pngBtn, slopeU, yUnits));
    const buttons = el('div', { class: 'buttons' }, pngBtn,
      copyButton('Copy graph as LaTeX (pgfplots)', () => pgfplots(pts, fit, xt.tex, yt.tex)),
      copyButton('Copy fit results as LaTeX', fitTex));

    out.replaceChildren(
      el('div', { class: 'plot' },
        el('div', { class: 'plot-ylabel' }, el('span', { class: 'muted' }, 'y: '), tex(yt.tex + mul(screen.yE))),
        svgBox,
        el('div', { class: 'plot-xlabel' }, el('span', { class: 'muted' }, 'x: '), tex(xt.tex + mul(screen.xE)))),
      results, sharedNote || '', verdict, raw, leftNote || '', buttons);

    lastFit = { fit, xt, yt, slopeU, yUnits, n: pts.length, hasUnits: !!(xu || yu) };
    renderDerived({ fit, slopeU, yUnits, hasUnits: !!(xu || yu) });
  }

  // A quantity worked out from the fitted slope and intercept, e.g. g = 4*pi^2/m.
  function renderDerived(ctx) {
    const out = $('derived-out');
    if (!out) return;
    const g = activeGraph();
    if (lastFit) lastFit.derived = null;
    if (!ctx || blank(g.derived)) return out.replaceChildren();
    const { fit, slopeU, yUnits, hasUnits } = ctx;
    const fail = (t) => out.replaceChildren(el('p', { class: 'msg error' }, t));
    let ns;
    try { ns = EP.listVariables(g.derived); } catch (e) { return fail(e.message); }
    const vars = [], used = [];
    for (const n of ns) {
      if (n === 'm') vars.push({ name: 'm', value: fit.m, unc: fit.sm, type: 'abs', unit: slopeU ? slopeU.display : '' });
      else if (n === 'c') {
        if (fit.origin) return fail('This fit goes through the origin, so there is no intercept c.');
        vars.push({ name: 'c', value: fit.c, unc: fit.sc, type: 'abs', unit: yUnits ? yUnits.display : '' });
      } else if (EP.PHYSICAL_CONSTANTS[n]) {
        const k = EP.PHYSICAL_CONSTANTS[n];
        vars.push({ name: n, value: k.value, unc: k.unc, type: 'abs', unit: hasUnits ? k.unit : '' });
        used.push(`${n} = ${num(k.value, 9)} ${prettyUnit(k.unit)}`);
      } else {
        return fail(`${n} isn’t available here. Use m, c, pi, e, or a constant: ${Object.keys(EP.PHYSICAL_CONSTANTS).join(', ')}.`);
      }
    }
    let r;
    try {
      r = EP.calculate(g.derived, vars, { degrees: state.degrees, correlations: [{ a: 'm', b: 'c', rho: fit.rho }] });
    } catch (e) { return fail(e.message); }
    const sh = shown(r), resultTex = N(r.name) + ' = ' + sh.tex;
    const notes = [];
    if (ns.includes('m') && ns.includes('c')) notes.push(`Includes the correlation between m and c (ρ = ${num(fit.rho, 3)}).`);
    if (used.length) notes.push('Using ' + used.join(', ') + '.');
    if (r.sigma > 0) notes.push('Relative uncertainty ' + num(r.relative * 100, 2) + '%.');
    out.replaceChildren(
      el('div', { class: 'answer' }, tex(resultTex, false, 'big'),
        el('div', { class: 'buttons' }, copyButton('Copy', () => r.name + ' = ' + sh.text), copyButton('Copy LaTeX', () => resultTex))),
      notes.length ? el('div', { class: 'sub' }, notes.join(' ')) : '',
      ...r.warnings.map((w) => el('div', { class: 'warn' }, w)),
      comparisonBox(N(r.name), sh.value, sh.sigma, r.units, g.derivedAccepted, '') || '');
    if (lastFit) lastFit.derived = { equation: g.derived, name: r.name, value: sh.value, sigma: sh.sigma, unit: r.units && r.units.display ? r.units.display : '' };
  }

  function downloadGraph(spec, xt, yt, fm, fc, fit, btn, slopeU, yUnits) {
    const g = activeGraph();
    const txt = (w, u) => (u && u.display ? w.text.slice(0, w.text.length - u.display.length) + prettyUnit(u.display) : w.text);
    const info = [
      [fit.origin ? 'Fit: y = mx' : 'Fit: y = mx + c', 'χ² = ' + num(fit.chi2, 4)],
      ['m = ' + txt(fm, slopeU), 'Degrees of freedom = ' + fit.dof],
      [fit.origin ? '' : 'c = ' + txt(fc, yUnits), 'Reduced χ² = ' + num(fit.chi2red, 3)],
      ['', 'P(χ² ≥ ' + num(fit.chi2, 4) + ') = ' + num(fit.p, 2)],
    ];
    const print = Plot.build(Object.assign({}, spec, { title: g.title.trim(), xTitle: xt.plain, yTitle: yt.plain, info }), 'print');
    Plot.toPng(print.svg, print.width, print.height, 3).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: safeFile(g.title || 'graph') + '-fit.png' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      btn.textContent = 'Downloaded ✓'; setTimeout(() => (btn.textContent = 'Download graph (PNG)'), 1500);
    }, (e) => { btn.textContent = e.message; });
  }

  const n12 = (x) => String(Number(x.toPrecision(12)));

  function pgfplots(pts, fit, xlabel, ylabel) {
    const g = activeGraph();
    const texEsc = (s) => s.replace(/[\\{}$&#^_%~]/g, (c) => '\\' + (c === '\\' ? 'textbackslash{}' : c === '^' ? '^{}' : c === '~' ? '~{}' : c));
    const xs = pts.map((p) => p.x);
    const lo = Math.min(...xs.map((x, i) => x - pts[i].sx)), hi = Math.max(...xs.map((x, i) => x + pts[i].sx));
    return [
      '% Needs \\usepackage{pgfplots} and \\pgfplotsset{compat=1.18} in the preamble',
      '\\begin{tikzpicture}',
      '\\begin{axis}[',
      '  width=12cm, height=8cm, grid=major,',
      g.title.trim() ? '  title={' + texEsc(g.title.trim()) + '},' : null,
      '  xlabel={$' + xlabel + '$},',
      '  ylabel={$' + ylabel + '$},',
      ']',
      '\\addplot+[only marks, mark=x, color=black, error bars/.cd, x dir=both, x explicit, y dir=both, y explicit]',
      '  coordinates {',
      ...pts.map((p) => `    (${n12(p.x)}, ${n12(p.y)}) +- (${n12(p.sx)}, ${n12(p.sy)})`),
      '  };',
      `\\addplot[red, thick, domain=${n12(lo)}:${n12(hi)}, samples=2] {${n12(fit.m)}*x + ${n12(fit.c)}};`,
      '\\end{axis}',
      '\\end{tikzpicture}',
    ].filter((l) => l !== null).join('\n');
  }

  function summaryLines(s, g, units) {
    const lines = [];
    const wu = (f) => EP.withUnit(f, units).tex;
    if (s.n > 1) {
      lines.push(['\\bar{' + g + '} = ' + wu(fmt(s.mean, s.sem)), 'mean ± standard error (σ/√n, from the spread of the results)']);
      lines.push(['s_{' + g + '} = ' + T(s.sd, 3) + unitTexSuffix(units), 'standard deviation of the results']);
    }
    if (isFinite(s.wmean) && s.n > 1) {
      lines.push([g + '_{w} = ' + wu(fmt(s.wmean, s.wsigma)), 'weighted mean (each row weighted by 1/σ²)']);
    }
    return lines;
  }

  function renderDetail() {
    const box = $('detail');
    if (!box) return;
    const good = goodRows();
    const sel = state.table.selected;
    const chosen = rowResults[sel] && !rowResults[sel].error ? sel : good.length ? good[0].i : -1;
    if (chosen < 0) { box.replaceChildren(); return; }
    const res = runAll(rowResults[chosen].vars); // all methods, for the comparison
    if (res.error) { box.replaceChildren(); return; }
    const inner = el('div');
    box.replaceChildren(el('h3', { class: 'detail-head' }, `Working for row ${chosen + 1}`,
      el('span', { class: 'muted' }, '  (click a row number to change)')), inner);
    renderResult(inner, res);
  }

  // Monte Carlo check per row (smaller sample, run in the background row by row).
  function scheduleRowChecks() {
    clearTimeout(rowMcTimer);
    if (xyMode()) return;
    const t = token;
    const queue = goodRows().filter(({ r }) => r.lin.sigma > 0);
    const next = () => {
      if (t !== token || !queue.length) return;
      const { r, i } = queue.shift();
      const cell = rowCells[i] && rowCells[i].chk;
      try {
        const mc = EP.monteCarlo(state.equation, r.vars, engineOpts(), { n: 20000 });
        const c = EP.mcCheck(r.lin, mc);
        r.mc = { mc, c };
        if (cell) cell.replaceChildren(c.ok
          ? el('span', { class: 'ok-mark', title: 'Monte Carlo check passed', 'aria-label': 'Monte Carlo check passed' }, '✓')
          : el('span', { class: 'warn-mark', title: 'Monte Carlo check: ' + mcProblems(c, r.lin).join('; ') + '. Click the row number for details.', 'aria-label': 'Monte Carlo warning' }, '!'));
      } catch (e) {
        if (cell) cell.replaceChildren(el('span', { class: 'warn-mark', title: e.message, 'aria-label': 'Warning' }, '!'));
      }
      rowMcTimer = setTimeout(next, 0);
    };
    rowMcTimer = setTimeout(next, 300);
  }

  // ================= export =================
  // A rounded result as plain numbers for a spreadsheet: 3.2e5, not "3.2" with the power lost.
  const rounded = (f) => (f.sci ? f.value + 'e' + f.exp : f.value);
  const roundedSigma = (f) => (f.sigma == null ? '' : f.sci ? f.sigma + 'e' + f.exp : f.sigma);

  // Copy the result column: value and uncertainty as two spreadsheet columns, one line per
  // table row (blank for rows with no result) so it lines up when pasted beside the readings.
  function resultColumnText() {
    return rowResults.map((res) => {
      if (!res || res.error) return '';
      const f = shown(res.main).f;
      return rounded(f) + '\t' + roundedSigma(f);
    }).join('\n');
  }
  // Copy one row: its readings as typed, then the result and its uncertainty.
  function rowText(i) {
    const row = state.table.rows[i], res = rowResults[i];
    const cells = editCols().map(([n, field]) => cellState(row, n)[field].trim());
    if (res && !res.error) { const f = shown(res.main).f; cells.push(rounded(f), roundedSigma(f)); }
    return cells.join('\t');
  }
  function exportCsv() {
    const good = goodRows();
    const first = good.length ? good[0].r.main : null;
    const name = first ? first.name : resultName();
    const ru = first && first.units && first.units.display ? ' [' + first.units.display + ']' : '';
    const header = ['row'];
    names.forEach((n) => {
      const u = blank(colState(n).unit) ? '' : ' [' + colState(n).unit.trim() + ']';
      header.push(n + u, n + ' uncertainty' + u);
    });
    header.push(name + ru, name + ' uncertainty' + ru, name + ' (rounded)', name + ' uncertainty (rounded)', 'relative uncertainty (%)', 'Monte Carlo check', 'notes');
    const rows = [header];
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
        const r = res.main, sh = shown(r);
        line.push(sh.value, sh.sigma, rounded(sh.f), roundedSigma(sh.f), r.sigma > 0 ? r.relative * 100 : 0,
          res.mc ? (res.mc.c.ok ? 'passed' : 'warning: ' + mcProblems(res.mc.c, res.lin).join('; ')) : '',
          [...(r.warnings || [])].join(' '));
      }
      rows.push(line);
    });
    const s = good.length ? tableSummary(good) : null;
    if (s && s.n > 1) {
      rows.push([]);
      rows.push(['summary', 'value' + ru, 'uncertainty' + ru]);
      rows.push(['mean ± standard error', s.mean, s.sem]);
      rows.push(['standard deviation', s.sd, '']);
      if (isFinite(s.wmean)) rows.push(['weighted mean', s.wmean, s.wsigma]);
      if (isFinite(s.chi2red)) rows.push(['reduced chi-squared', s.chi2red, '']);
      rows.push(['rows', s.n, '']);
    }
    if (lastFit) {
      const F = lastFit.fit, su = lastFit.slopeU ? ' [' + lastFit.slopeU.display + ']' : '', yu = lastFit.yUnits ? ' [' + lastFit.yUnits.display + ']' : '';
      rows.push([]);
      rows.push(['straight-line fit (LSFR method)', 'value', 'uncertainty']);
      rows.push(['y axis', lastFit.yt.plain]);
      rows.push(['x axis', lastFit.xt.plain]);
      rows.push(['slope m' + su, F.m, F.sm]);
      if (!F.origin) rows.push(['intercept c' + yu, F.c, F.sc]);
      rows.push(['chi-squared', F.chi2]);
      rows.push(['degrees of freedom', F.dof]);
      rows.push(['reduced chi-squared', F.chi2red]);
      rows.push(['P(chi-squared >= observed)', F.p]);
      rows.push(['points in fit', lastFit.n]);
      rows.push(['x errors in fit', F.xErrors ? 'yes (effective variance)' : 'no (as LSFR)']);
      rows.push(['line through origin', F.origin ? 'yes' : 'no']);
      if (lastFit.derived) {
        const d = lastFit.derived;
        rows.push(['calculated from the fit', d.equation]);
        rows.push([d.name + (d.unit ? ' [' + d.unit + ']' : ''), d.value, d.sigma]);
      }
    }
    rows.push([]);
    rows.push(['session', store.sessions[store.active].name]);
    rows.push(['equation', state.equation]);
    rows.push(['method', METHODS[state.method].label]);
    rows.push(['angles', state.degrees ? 'degrees' : 'radians']);
    download(safeFile(name) + '-results.csv', '\uFEFF' + EP.toCsv(rows), 'text/csv;charset=utf-8');
  }

  function latexTable() {
    const cols = names.map((n) => {
      const c = colState(n);
      const parts = [];
      if (!blank(c.unit)) parts.push(EP.unitTex(c.unit.trim()));
      if (!c.perRow && !blank(c.unc)) parts.push('\\pm ' + typedTex(c.unc) + (c.type === 'pct' ? '\\%' : ''));
      return { n, c, head: '$' + N(n) + (parts.length ? ' \\; (' + parts.join(',\\ ') + ')' : '') + '$' };
    });
    const good = goodRows();
    const first = good.length ? good[0].r.main : null;
    const name = first ? first.name : resultName();
    const ru = first && first.units && first.units.display ? ' \\; (' + first.units.tex + ')' : '';
    const lines = [];
    lines.push('\\begin{tabular}{' + 'c'.repeat(cols.length + 1) + '}');
    lines.push('\\hline');
    lines.push(cols.map((c) => c.head).concat('$' + N(name) + ru + '$').join(' & ') + ' \\\\');
    lines.push('\\hline');
    good.forEach(({ r, i }) => {
      const row = state.table.rows[i];
      const cells = cols.map(({ n, c }) => {
        const cell = cellState(row, n);
        const val = typedTex(c.fixed ? c.value : cell.value);
        return '$' + (c.perRow && !c.fixed && !blank(cell.unc) ? val + ' \\pm ' + typedTex(cell.unc) + (c.type === 'pct' ? '\\%' : '') : val) + '$';
      });
      lines.push(cells.concat('$' + shown(r.main).f.tex + '$').join(' & ') + ' \\\\');
    });
    lines.push('\\hline');
    const s = good.length ? tableSummary(good) : null;
    if (s && s.n > 1) {
      summaryLines(s, N(name), first.units).forEach(([t]) => lines.push('\\multicolumn{' + (cols.length + 1) + '}{l}{$' + t + '$} \\\\'));
      lines.push('\\hline');
    }
    lines.push('\\end{tabular}');
    return lines.join('\n');
  }

  // ================= session bar =================
  const sessSelect = $('session-select');
  const sessNote = $('session-note');

  function savedLabel(msg) {
    if (msg) { sessNote.textContent = msg; sessNote.className = 'session-note'; return; }
    sessNote.textContent = storageOk ? 'Saved automatically' : 'Not saved: this browser is blocking storage';
    sessNote.className = 'session-note' + (storageOk ? '' : ' bad');
  }

  function renderSessionBar() {
    sessSelect.replaceChildren(...Object.entries(store.sessions)
      .sort((a, b) => (a[1].created || 0) - (b[1].created || 0))
      .map(([id, s]) => el('option', { value: id }, s.name)));
    sessSelect.value = store.active;
  }

  function switchSession(id) {
    if (!store.sessions[id]) return;
    dismissToast();
    store.active = id;
    const fresh = cleanData(store.sessions[id].data);
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, fresh);
    applyControls();
    builtFor = '';
    renderSessionBar();
    update();
  }

  function uniqueName(base) {
    const used = new Set(Object.values(store.sessions).map((s) => s.name));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(base + ' ' + i)) return base + ' ' + i;
  }

  function addSession(name, data) {
    const id = newId(), now = Date.now();
    store.sessions[id] = { name: uniqueName(name), created: now, updated: now, data: cleanData(data) };
    return id;
  }

  // Inline rename: swap the dropdown for a text box.
  function startRename() {
    const s = store.sessions[store.active];
    const input = el('input', { type: 'text', class: 'session-name', value: s.name, 'aria-label': 'Session name', maxlength: '80' });
    sessSelect.hidden = true;
    sessSelect.after(input);
    input.focus(); input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (keep && v && v !== s.name) { s.name = uniqueName(v.slice(0, 80)); save(); }
      input.remove();
      sessSelect.hidden = false;
      renderSessionBar();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  const sessMenu = $('s-menu');
  const closeMenu = () => { sessMenu.open = false; };
  document.addEventListener('click', (e) => { if (sessMenu.open && !sessMenu.contains(e.target)) closeMenu(); });
  sessMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sessMenu.open) { closeMenu(); sessMenu.querySelector('summary').focus(); }
  });

  sessSelect.addEventListener('change', () => switchSession(sessSelect.value));
  $('s-new').addEventListener('click', () => {
    const id = addSession('New lab', { mode: state.mode, degrees: state.degrees, rounding: state.rounding, method: state.method });
    switchSession(id);
    startRename();
  });
  $('s-rename').addEventListener('click', () => { closeMenu(); startRename(); });
  $('s-dup').addEventListener('click', () => {
    closeMenu();
    const id = addSession(store.sessions[store.active].name + ' (copy)', JSON.parse(JSON.stringify(state)));
    switchSession(id);
  });
  $('s-del').addEventListener('click', () => {
    closeMenu();
    save();
    const id = store.active, gone = store.sessions[id];
    delete store.sessions[id];
    const ids = Object.keys(store.sessions);
    const placeholder = ids.length ? null : addSession('My first session', {});
    switchSession(placeholder || ids[0]);
    undoable(`Deleted “${gone.name}”.`, () => {
      store.sessions[id] = gone;
      // the stand-in made for the last session goes away again if it was never used
      if (placeholder && store.sessions[placeholder] && blank(store.sessions[placeholder].data.equation)) delete store.sessions[placeholder];
      switchSession(id);
    });
  });
  $('s-backup').addEventListener('click', () => {
    closeMenu();
    save();
    const backup = { app: 'error-propagator', version: 1, exported: new Date().toISOString(), sessions: Object.values(store.sessions).map((s) => ({ name: s.name, data: s.data })) };
    download('error-propagator-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup, null, 1), 'application/json');
  });
  $('s-restore-file').addEventListener('change', (e) => {
    closeMenu();
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5e6) return savedLabel('That file is too big to be a backup.');
    file.text().then((text) => {
      let data;
      try { data = JSON.parse(text); } catch (err) { return savedLabel('That file isn’t a backup from this app.'); }
      const list = data && Array.isArray(data.sessions) ? data.sessions : null;
      if (!list || !list.length) return savedLabel('No sessions found in that file.');
      let firstId = null;
      list.slice(0, 200).forEach((s) => {
        if (!s || typeof s !== 'object') return;
        const id = addSession(str(s.name, 80).trim() || 'Restored session', s.data);
        firstId = firstId || id;
      });
      if (!firstId) return savedLabel('No sessions found in that file.');
      switchSession(firstId);
      savedLabel(`Restored ${list.length} session${list.length > 1 ? 's' : ''}`);
    });
  });

  // ================= controls =================
  function pressed(b, on) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function setDegrees(on) {
    state.degrees = on;
    document.querySelectorAll('[data-deg]').forEach((b) => pressed(b, (b.dataset.deg === '1') === on));
  }
  function setMethod(m, recalc) {
    state.method = m;
    document.querySelectorAll('[data-method]').forEach((b) => pressed(b, b.dataset.method === m));
    if (recalc) update();
  }
  function setMode(m, recalc) {
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => pressed(b, b.dataset.mode === m));
    $('single-card').hidden = m !== 'single';
    $('table-card').hidden = m !== 'table';
    if (m === 'table' && recalc) seedTable();
    setKind(state.table.xy.on, false);
    builtFor = '';
    if (recalc) update();
  }
  // Table mode: readings go into the equation, or straight into an x-y fit.
  function setKind(xy, recalc) {
    state.table.xy.on = xy;
    document.querySelectorAll('[data-kind]').forEach((b) => pressed(b, (b.dataset.kind === 'xy') === xy));
    $('table-kind').hidden = state.mode !== 'table';
    $('eq-card').hidden = xyMode();
    $('table-label').textContent = xyMode() ? 'Readings (x and y)' : 'Readings';
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
      if (blank(c.unit)) c.unit = v.unit || '';
      cellState(t.rows[0], n).value = v.value;
    });
  }
  function applyControls() {
    eqInput.value = state.equation;
    roundSel.value = state.rounding;
    resultUnitInput.value = state.resultUnit;
    markUnit(resultUnitInput);
    $('accepted').value = state.accepted; $('accepted-unc').value = state.acceptedUnc;
    openReps.clear();
    setDegrees(!!state.degrees);
    setMethod(state.method, false);
    setMode(state.mode, false);
  }

  document.querySelectorAll('[data-deg]').forEach((b) =>
    b.addEventListener('click', () => { setDegrees(b.dataset.deg === '1'); update(); }));
  document.querySelectorAll('[data-method]').forEach((b) =>
    b.addEventListener('click', () => setMethod(b.dataset.method, true)));
  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode, true)));
  document.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => setKind(b.dataset.kind === 'xy', true)));
  roundSel.addEventListener('change', () => { state.rounding = roundSel.value; update(); });
  resultUnitInput.addEventListener('input', () => { state.resultUnit = resultUnitInput.value; markUnit(resultUnitInput); update(); });
  eqInput.addEventListener('input', () => { state.equation = eqInput.value; builtFor = ''; update(); });
  // Symbol keys under the equation box (shown on touch screens): insert at the cursor.
  $('eq-keys').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-ins]');
    if (!b) return;
    e.preventDefault(); // keep the keyboard open and the cursor in place
    const start = eqInput.selectionStart == null ? eqInput.value.length : eqInput.selectionStart;
    const end = eqInput.selectionEnd == null ? start : eqInput.selectionEnd;
    eqInput.setRangeText(b.dataset.ins, start, end, 'end');
    eqInput.focus();
    eqInput.dispatchEvent(new Event('input'));
  });

  const settings = $('settings');
  try { settings.open = localStorage.getItem('errorprop.settingsOpen') === '1'; } catch (e) { /* storage blocked */ }
  settings.addEventListener('toggle', () => {
    try { localStorage.setItem('errorprop.settingsOpen', settings.open ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  $('print').addEventListener('click', () => window.print());

  const accInput = $('accepted'), accUncInput = $('accepted-unc');
  accInput.addEventListener('input', () => { state.accepted = accInput.value; mark(accInput); update(); });
  accUncInput.addEventListener('input', () => { state.acceptedUnc = accUncInput.value; mark(accUncInput); update(); });

  const themeSel = $('theme');
  try { themeSel.value = localStorage.getItem('errorprop.theme') || ''; } catch (e) { /* storage blocked */ }
  themeSel.addEventListener('change', () => {
    const t = themeSel.value;
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { if (t) localStorage.setItem('errorprop.theme', t); else localStorage.removeItem('errorprop.theme'); } catch (e) { /* ignore */ }
  });

  let resizeTimer = null, lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.mode === 'table') renderGraph(); }, 200);
  });

  renderSessionBar();
  applyControls();
  update();
})();
