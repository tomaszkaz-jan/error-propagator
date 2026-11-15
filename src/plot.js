/*
 * Draws the straight-line fit graph (like LSFR-25.py): data with x and y error
 * bars, the fitted line, and a residuals plot underneath. Produces SVG text,
 * for the page (themed colours, axis titles added by the page in LaTeX) or for
 * export (white background, all text drawn in, fit results printed below).
 */
(function (root) {
  'use strict';

  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const sup = (s) => String(s).replace(/[-0-9]/g, (c) => SUP[c]);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (n) => (Math.round(n * 100) / 100).toString();

  const SCREEN = {
    bg: 'none', ink: 'var(--text)', muted: 'var(--muted)', grid: 'var(--line)', fit: 'var(--fit)', point: 'var(--text)',
    font: 'inherit',
  };
  const PRINT = {
    bg: '#ffffff', ink: '#1b1f24', muted: '#555555', grid: '#dddddd', fit: '#d62728', point: '#000000',
    font: 'Helvetica, Arial, sans-serif',
  };

  /** Power of ten to pull out of an axis (like matplotlib's ×10^k), or 0. */
  function axisExp(lo, hi) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    if (!(m > 0) || !isFinite(m)) return 0;
    const e = Math.floor(Math.log10(m));
    return e <= -3 || e >= 4 ? e : 0;
  }

  function niceStep(range, target) {
    const raw = range / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const k = raw / p;
    return (k < 1.5 ? 1 : k < 3 ? 2 : k < 7 ? 5 : 10) * p;
  }

  function ticks(lo, hi, target) {
    const step = niceStep(hi - lo, target);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { values: out, step };
  }

  function tickLabel(v, step, e) {
    const s = step / Math.pow(10, e);
    const dp = Math.max(0, -Math.floor(Math.log10(s) + 1e-9));
    return (v / Math.pow(10, e)).toFixed(Math.min(dp, 10)).replace(/^-0(\.0+)?$/, '0');
  }

  function range(vals, errs) {
    let lo = Infinity, hi = -Infinity;
    vals.forEach((v, i) => { const e = errs ? errs[i] || 0 : 0; lo = Math.min(lo, v - e); hi = Math.max(hi, v + e); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }

  /**
   * spec: {
   *   points: [{x, y, sx, sy, label}], fit: {m, c}, residuals: [r], rsig: [sigma used],
   *   xTitle, yTitle, title, info: [[left, right], ...]   (titles/info used for export)
   * }
   * mode: 'screen' | 'print'
   * Returns { svg, xE, yE, width, height }
   */
  function build(spec, mode) {
    const P = mode === 'print' ? PRINT : SCREEN;
    const print = mode === 'print';
    const W = Math.max(320, Math.min(760, Math.round(spec.width || 760)));
    const nX = Math.max(3, Math.round(W / 110));
    const left = print ? 92 : W < 500 ? 52 : 70, right = W < 500 ? 12 : 24;
    const top = print ? (spec.title ? 54 : 24) : 14;
    const mainH = W < 500 ? 260 : 360, gap = print ? 74 : 56, resH = W < 500 ? 110 : 140;
    const infoH = print && spec.info ? 22 * spec.info.length + 26 : 0;
    const bottomAxis = print ? 56 : 30;
    const H = top + mainH + gap + resH + bottomAxis + infoH;
    const pw = W - left - right;

    const pts = spec.points;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    let [x0, x1] = range(xs, pts.map((p) => p.sx));
    let [y0, y1] = range(ys, pts.map((p) => p.sy));
    if (spec.fit) { // make sure the line is visible across the range
      const ya = spec.fit.m * x0 + spec.fit.c, yb = spec.fit.m * x1 + spec.fit.c;
      y0 = Math.min(y0, Math.min(ya, yb)); y1 = Math.max(y1, Math.max(ya, yb));
    }
    const xE = axisExp(x0, x1), yE = axisExp(y0, y1);
    const X = (v) => left + ((v - x0) / (x1 - x0)) * pw;
    const Y = (v) => top + mainH - ((v - y0) / (y1 - y0)) * mainH;

    const rt = top + mainH + gap;
    const rs = spec.rsig || [];
    let rmax = 0;
    (spec.residuals || []).forEach((r, i) => (rmax = Math.max(rmax, Math.abs(r) + (rs[i] || 0))));
    if (!(rmax > 0)) rmax = 1;
    rmax *= 1.15;
    const rE = axisExp(-rmax, rmax);
    const RY = (v) => rt + resH / 2 - (v / rmax) * (resH / 2);

    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(P.font)}" font-size="13" role="img" aria-label="${esc(spec.ariaLabel || 'Straight-line fit graph')}">`);
    if (P.bg !== 'none') o.push(`<rect width="${W}" height="${H}" fill="${P.bg}"/>`);
    if (print && spec.title) o.push(`<text x="${W / 2}" y="32" text-anchor="middle" font-size="18" font-weight="600" fill="${P.ink}">${esc(spec.title)}</text>`);

    // Axes, grid, tick labels for a panel
    function panel(t, h, ylo, yhi, yFn, yExp, yTicks) {
      o.push(`<rect x="${left}" y="${t}" width="${pw}" height="${h}" fill="none" style="stroke:${P.muted}" stroke-width="1"/>`);
      const xt = ticks(x0, x1, nX);
      xt.values.forEach((v) => {
        const x = f(X(v));
        o.push(`<line x1="${x}" x2="${x}" y1="${t}" y2="${t + h}" style="stroke:${P.grid}" stroke-width="1"/>`);
        o.push(`<text x="${x}" y="${t + h + 17}" text-anchor="middle" style="fill:${P.muted}">${esc(tickLabel(v, xt.step, xE))}</text>`);
      });
      const yt = yTicks || ticks(ylo, yhi, 6);
      yt.values.forEach((v) => {
        const y = f(yFn(v));
        o.push(`<line x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}" style="stroke:${P.grid}" stroke-width="1"/>`);
        o.push(`<text x="${left - 8}" y="${f(yFn(v) + 4)}" text-anchor="end" style="fill:${P.muted}">${esc(tickLabel(v, yt.step, yExp))}</text>`);
      });
    }

    function errorBars(cx, cy, ex0, ex1, ey0, ey1, cls) {
      const s = `style="stroke:${P.point}" stroke-width="1.2"`;
      if (ey1 - ey0 > 0.5) o.push(`<line x1="${f(cx)}" x2="${f(cx)}" y1="${f(ey0)}" y2="${f(ey1)}" ${s}/><line x1="${f(cx - 4)}" x2="${f(cx + 4)}" y1="${f(ey0)}" y2="${f(ey0)}" ${s}/><line x1="${f(cx - 4)}" x2="${f(cx + 4)}" y1="${f(ey1)}" y2="${f(ey1)}" ${s}/>`);
      if (ex1 - ex0 > 0.5) o.push(`<line x1="${f(ex0)}" x2="${f(ex1)}" y1="${f(cy)}" y2="${f(cy)}" ${s}/><line x1="${f(ex0)}" x2="${f(ex0)}" y1="${f(cy - 4)}" y2="${f(cy + 4)}" ${s}/><line x1="${f(ex1)}" x2="${f(ex1)}" y1="${f(cy - 4)}" y2="${f(cy + 4)}" ${s}/>`);
    }
    const marker = (cx, cy, title) => o.push(`<g style="stroke:${P.point}" stroke-width="1.6"><line x1="${f(cx - 5)}" y1="${f(cy - 5)}" x2="${f(cx + 5)}" y2="${f(cy + 5)}"/><line x1="${f(cx - 5)}" y1="${f(cy + 5)}" x2="${f(cx + 5)}" y2="${f(cy - 5)}"/>${title ? `<title>${esc(title)}</title>` : ''}<circle cx="${f(cx)}" cy="${f(cy)}" r="9" fill="transparent" stroke="none"/></g>`);

    // ---- main plot
    panel(top, mainH, y0, y1, Y, yE);
    o.push(`<clipPath id="clip-main"><rect x="${left}" y="${top}" width="${pw}" height="${mainH}"/></clipPath>`);
    o.push('<g clip-path="url(#clip-main)">');
    if (spec.fit) {
      o.push(`<line x1="${f(X(x0))}" y1="${f(Y(spec.fit.m * x0 + spec.fit.c))}" x2="${f(X(x1))}" y2="${f(Y(spec.fit.m * x1 + spec.fit.c))}" style="stroke:${P.fit}" stroke-width="2"/>`);
    }
    pts.forEach((p) => {
      errorBars(X(p.x), Y(p.y), X(p.x - (p.sx || 0)), X(p.x + (p.sx || 0)), Y(p.y + (p.sy || 0)), Y(p.y - (p.sy || 0)));
      marker(X(p.x), Y(p.y), p.label);
    });
    o.push('</g>');

    // ---- residuals
    const rTicks = (() => { const t = ticks(-rmax, rmax, 4); return t; })();
    panel(rt, resH, -rmax, rmax, RY, rE, rTicks);
    o.push(`<text x="${left + pw / 2}" y="${rt - 10}" text-anchor="middle" font-size="14" font-weight="600" style="fill:${P.ink}">Residuals</text>`);
    o.push(`<line x1="${left}" x2="${left + pw}" y1="${f(RY(0))}" y2="${f(RY(0))}" style="stroke:${P.fit}" stroke-width="1.6"/>`);
    (spec.residuals || []).forEach((r, i) => {
      const p = pts[i], s = rs[i] || 0;
      errorBars(X(p.x), RY(r), 0, 0, RY(r + s), RY(r - s));
      marker(X(p.x), RY(r), p.label ? p.label + ', residual ' + r.toPrecision(4) : '');
    });

    // ---- titles and info (export only; the page shows LaTeX titles instead)
    if (print) {
      const mul = (e) => (e ? ' (×10' + sup(e) + ')' : '');
      o.push(`<text x="${left + pw / 2}" y="${rt + resH + 44}" text-anchor="middle" font-size="15" style="fill:${P.ink}">${esc((spec.xTitle || 'x') + mul(xE))}</text>`);
      o.push(`<text transform="translate(22 ${top + mainH / 2}) rotate(-90)" text-anchor="middle" font-size="15" style="fill:${P.ink}">${esc((spec.yTitle || 'y') + mul(yE))}</text>`);
      if (rE) o.push(`<text transform="translate(22 ${rt + resH / 2}) rotate(-90)" text-anchor="middle" font-size="12" style="fill:${P.muted}">${esc('×10' + sup(rE))}</text>`);
      if (spec.info) {
        let y = rt + resH + bottomAxis + 22;
        spec.info.forEach(([a, b]) => {
          o.push(`<text x="${left}" y="${y}" font-size="14" style="fill:${P.ink}">${esc(a)}</text>`);
          if (b) o.push(`<text x="${left + pw}" y="${y}" text-anchor="end" font-size="14" style="fill:${P.ink}">${esc(b)}</text>`);
          y += 22;
        });
      }
    }
    o.push('</svg>');
    return { svg: o.join(''), xE, yE, rE, width: W, height: H, layout: { left, pw, top, mainH, rt, resH } };
  }

  /** Renders print-mode SVG to a PNG Blob at `scale`× resolution. */
  function toPng(svgText, width, height, scale) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = width * scale; c.height = height * scale;
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png');
      };
      img.onerror = () => reject(new Error('Could not draw the graph image.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }

  root.Plot = { build, toPng, axisExp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
