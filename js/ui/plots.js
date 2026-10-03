/*  The plot tabs. Only the visible tab is redrawn; the others are marked dirty.
 *  Selected datasets are decimated to "max plots" for display (all selected ones are still used in
 *  calculations, as in Yappari). Model lines are smooth curves; residuals use the model at the data points.
 */
Y.plots = (function () {
  'use strict';
  var S = Y.state.S, P = {}, current = 'nyq', dirty = { nyq: true, zr: true, zi: true, bode: true, d3: true }, raf = 0, bodeLast = 'mod';
  var PALETTE = ['#2457a6', '#d1495b', '#2e9e6a', '#7a4fb5', '#d98a00', '#00999a', '#b0368c', '#5c7a29', '#c2571a', '#3a86ff', '#8d6e63', '#556270'];
  var needAuto = { nyq: true, zr: true, zi: true, bode: true, d3: true };
  var PART_COLORS = ['#d1495b', '#2e9e6a', '#7a4fb5', '#d98a00', '#00999a', '#b0368c', '#3a86ff', '#8d6e63'];

  function $(s) { return document.querySelector(s); }
  function color(ds) { return PALETTE[(ds.id - 1) % PALETTE.length]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function fmtF(f, digits) {
    var u = [[1e6, 'MHz'], [1e3, 'kHz'], [1, 'Hz'], [1e-3, 'mHz'], [1e-6, 'µHz']];
    for (var i = 0; i < u.length; i++) if (f >= u[i][0] * 0.9999) return +(f / u[i][0]).toPrecision(digits || 5) + ' ' + u[i][1];
    return f.toExponential(3) + ' Hz';
  }
  function fmtZ(v) {
    var a = Math.abs(v);
    return (a !== 0 && (a >= 1e5 || a < 1e-2)) ? v.toExponential(4) : String(+v.toPrecision(5));
  }
  function phaseScale() { return S.settings.phase === 'rad' ? Math.PI / 180 : 1; }
  function phaseLabel() { return S.settings.phase === 'rad' ? 'θ /rad' : 'θ /°'; }

  function tooltip(s, i) {
    var ds = s.ds, k = s.idx[i], zr = ds.zr[k], zi = ds.zi[k], c = Y.state.calcFor(ds), u = Y.state.zUnit(ds);
    var th = Math.atan2(zi, zr) * 180 / Math.PI * phaseScale();
    var h = '<b>' + esc(ds.name) + '</b>' + (s.masked ? ' <i>masked</i>' : '') + '<br>f = ' + fmtF(ds.f[k]) + '<br>Zr = ' + fmtZ(zr) + ' ' + u + ', Zi = ' + fmtZ(zi) + ' ' + u +
            '<br>|Z| = ' + fmtZ(Math.hypot(zr, zi)) + ' ' + u + ', θ = ' + (+th.toPrecision(4)) + (S.settings.phase === 'rad' ? ' rad' : '°');
    if (c) h += '<br><span class="muted">model: Zr = ' + fmtZ(c.re[k]) + ', Zi = ' + fmtZ(c.im[k]) + '</span>';
    return h;
  }

  // selected datasets, decimated evenly to at most maxPlots
  function plotted() {
    var sel = Y.state.selected(), n = sel.length, m = Math.max(1, S.settings.maxPlots | 0);
    if (n <= m) return sel;
    var out = [];
    for (var i = 0; i < m; i++) out.push(sel[Math.round(i * (n - 1) / (m - 1 || 1))]);
    return out;
  }

  function curveXY(cv, kind) {
    var n = cv.f.length, x = new Float64Array(n), y = new Float64Array(n), ps = phaseScale();
    for (var k = 0; k < n; k++) {
      var re = cv.re[k], im = cv.im[k];
      switch (kind) {
        case 'nyq': x[k] = re; y[k] = -im; break;
        case 'zr': x[k] = cv.f[k]; y[k] = re; break;
        case 'zi': x[k] = cv.f[k]; y[k] = im; break;
        case 'mod': x[k] = cv.f[k]; y[k] = Math.hypot(re, im); break;
        case 'phase': x[k] = cv.f[k]; y[k] = Math.atan2(im, re) * 180 / Math.PI * ps; break;
      }
    }
    return [x, y];
  }

  // series for one plot kind; residuals for 'zr' / 'zi'
  function build(kind, list, opts) {
    opts = opts || {};
    // data, model curve and contributions are drawn and hidden independently (toolbar or legend)
    var showFit = opts.report || S.settings.showFit !== false, showData = opts.report || S.settings.showData !== false;
    var main = [], res = [], lmax = S.settings.legendMax, rel = S.settings.resid === 'rel', ps = phaseScale();
    list.forEach(function (ds, n) {
      var col = color(ds), idx = [], k;
      for (k = 0; k < ds.f.length; k++) if (!ds.mask[k]) idx.push(k);
      var X = new Float64Array(idx.length), Yv = new Float64Array(idx.length);
      idx.forEach(function (kk, i) {
        var c = Y.dataops.coords(ds, kk, kind);
        X[i] = c[0]; Yv[i] = kind === 'phase' ? c[1] * ps : c[1];
      });
      var ex = null, ey = null;                              // measured standard deviations as error bars
      if (ds.sr && ds.si && (kind === 'zr' || kind === 'zi' || kind === 'nyq')) {
        ey = Float64Array.from(idx, function (kk) { return kind === 'zr' ? ds.sr[kk] : ds.si[kk]; });
        if (kind === 'nyq') ex = Float64Array.from(idx, function (kk) { return ds.sr[kk]; });
      }
      if (showData) main.push({ name: ds.name, group: ds.id, x: X, y: Yv, color: col, mode: 'markers', hover: true,
                  legend: n < lmax, ds: ds, idx: idx, size: opts.size, ex: ex, ey: ey });
      var midx = [];                                         // masked points stay visible, hollow and pale
      for (k = 0; k < ds.f.length; k++) if (ds.mask[k]) midx.push(k);
      if (midx.length && showData) {
        var MX = new Float64Array(midx.length), MY = new Float64Array(midx.length);
        midx.forEach(function (kk, i) { var c = Y.dataops.coords(ds, kk, kind); MX[i] = c[0]; MY[i] = kind === 'phase' ? c[1] * ps : c[1]; });
        main.push({ name: ds.name, group: ds.id, x: MX, y: MY, color: col, mode: 'markers', hollow: true, alpha: 0.45, noAuto: true,
                    hover: true, masked: true, ds: ds, idx: midx, size: opts.size });
      }
      var cv = Y.state.curveFor(ds);
      if (cv) {
        var xy = curveXY(cv, kind), line = { name: 'Fit', group: 'fit', x: xy[0], y: xy[1], color: col, mode: 'lines', legend: true, width: opts.width };
        if (showFit) main.push(line);
        if (n === 0 && S.settings.contrib && !opts.noContrib && (kind === 'nyq' || kind === 'zr' || kind === 'zi'))
          Array.prototype.push.apply(main, contribSeries(ds, kind, cv, kind === 'nyq' ? line : null));
      }
      if (cv && (kind === 'zr' || kind === 'zi')) {
        var calc = Y.state.calcFor(ds), rx = new Float64Array(idx.length), ry = new Float64Array(idx.length);
        idx.forEach(function (kk, i) {
          var obs = kind === 'zr' ? ds.zr[kk] : ds.zi[kk], mod = kind === 'zr' ? calc.re[kk] : calc.im[kk];
          rx[i] = ds.f[kk];
          ry[i] = rel ? 100 * (obs - mod) / Math.hypot(ds.zr[kk], ds.zi[kk]) : obs - mod;
        });
        var rey = ey ? Float64Array.from(idx, function (kk, i) { return rel ? 100 * ey[i] / Math.hypot(ds.zr[kk], ds.zi[kk]) : ey[i]; }) : null;
        res.push({ name: ds.name, group: ds.id, x: rx, y: ry, color: col, mode: 'markers', hover: true, ds: ds, idx: idx, size: 3, ey: rey });
        if (midx.length) res.push({ name: ds.name, group: ds.id, x: Float64Array.from(midx, function (kk) { return ds.f[kk]; }),
          y: Float64Array.from(midx, function (kk) {
            var obs = kind === 'zr' ? ds.zr[kk] : ds.zi[kk], mod = kind === 'zr' ? calc.re[kk] : calc.im[kk];
            return rel ? 100 * (obs - mod) / Math.hypot(ds.zr[kk], ds.zi[kk]) : obs - mod;
          }), color: col, mode: 'markers', hollow: true, alpha: 0.45, noAuto: true, hover: true, masked: true, ds: ds, idx: midx, size: 3 });
      }
    });
    return { main: main, res: res };
  }

  // ---------------------------------------------------------------- contributions of the parts in series
  // The parts of the top-level series chain add up: Z = sum of Z_part. On Zr and Zi plots each part is drawn
  // exactly; on the Nyquist plot the model curve takes the colour of the part with the largest |Zi| at each
  // frequency, and each part is drawn alone, shifted along Zr as if the relaxations were separate.
  function partsOf(ds, f) {
    var tree = S.model.tree;
    if (!tree) return [];
    return (tree.t === 's' ? tree.c : [tree]).map(function (node, i) {
      var prog = Y.circuit.compile(node), z = Y.circuit.impedance(prog, f, Float64Array.from(prog.names, function (nm) { return ds.p[nm]; }));
      var imax = 0, zmax = 0, kmax = 0;
      for (var k = 0; k < f.length; k++) { var a = Math.abs(z.im[k]); if (a > imax) { imax = a; kmax = k; } zmax = Math.max(zmax, Math.hypot(z.re[k], z.im[k])); }
      return { label: Y.circuit.toCDC(node, true).replace(/^\[(.*)\]$/, '$1'), color: PART_COLORS[i % PART_COLORS.length],
               re: z.re, im: z.im, resistive: !(imax > 1e-9 * zmax), kmax: kmax, i: i };
    });
  }
  function contribSeries(ds, kind, cv, total) {
    var parts = partsOf(ds, cv.f), out = [], n = cv.f.length;
    if (!parts.length) return out;
    if (kind === 'zr' || kind === 'zi') {
      parts.forEach(function (p) { out.push({ name: p.label, group: 'part' + p.i, x: cv.f, y: kind === 'zr' ? p.re : p.im, color: p.color, mode: 'lines', dash: [6, 4], width: 1.6, legend: true }); });
      return out;
    }
    var react = parts.filter(function (p) { return !p.resistive; });
    if (total) {
      total.colors = new Array(n); total.colorGroups = new Array(n); total.width = 2.4;
      for (var k = 0; k < n; k++) {
        var best = react[0] || parts[0], bv = -1;
        react.forEach(function (p) { var v = Math.abs(p.im[k]); if (v > bv) { bv = v; best = p; } });
        total.colors[k] = best.color; total.colorGroups[k] = 'part' + best.i;
      }
    }
    var x0 = 0;
    parts.forEach(function (p) {
      if (!p.resistive) return;
      out.push({ name: p.label, group: 'part' + p.i, x: [x0, x0 + p.re[0]], y: [0, 0], color: p.color, mode: 'lines', width: 4, legend: true });
      x0 += p.re[0];
    });
    var order = react.slice().sort(function (a, b) { return cv.f[b.kmax] - cv.f[a.kmax]; });
    order.forEach(function (p, i) {
      var off = x0;
      order.forEach(function (q, j) { if (j < i) off += q.re[0]; else if (j > i) off += q.re[n - 1]; });
      out.push({ name: p.label, group: 'part' + p.i, x: Float64Array.from(p.re, function (v) { return v + off; }), y: Float64Array.from(p.im, function (v) { return -v; }),
                 color: p.color, mode: 'lines', dash: [6, 4], width: 1.6, legend: true });
    });
    return out;
  }

  // ---------------------------------------------------------------- frequency labels on the Nyquist plot
  function nearestPoint(ds, fv) {
    var best = -1, bd = Infinity;
    for (var k = 0; k < ds.f.length; k++) {
      if (ds.mask[k] || !(ds.f[k] > 0)) continue;
      var d = Math.abs(Math.log(ds.f[k] / fv));
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function notesFor(list) {
    var out = [];
    list.forEach(function (ds) {
      (ds.notes || []).forEach(function (fv) {
        var k = nearestPoint(ds, fv);
        if (k >= 0) out.push({ x: ds.zr[k], y: -ds.zi[k], text: fmtF(ds.f[k], 3), color: color(ds) });
      });
    });
    return out;
  }
  function toggleNote(s, i) {
    if (!s.ds || !s.idx) return;
    var ds = s.ds, fk = ds.f[s.idx[i]];
    ds.notes = ds.notes || [];
    var at = ds.notes.findIndex(function (v) { return Math.abs(v / fk - 1) < 1e-9; });
    if (at >= 0) ds.notes.splice(at, 1); else ds.notes.push(fk);
    refresh(false);
  }

  function linkX(a, b) {
    a.o.onView = function (v) { b.setXView(v.x0, v.x1); };
    b.o.onView = function (v) { a.setXView(v.x0, v.x1); };
  }

  function init() {
    var lm = S.settings.legendMax;
    P.nyq = new Y.Plot2D($('#nyq-host'), { xlabel: 'Zr /Ω', ylabel: '−Zi /Ω', equal: S.settings.nyqEqual, tooltip: tooltip, legendMax: lm, empty: 'Select one or more datasets',
                                           onPointClick: toggleNote, pointClickActive: function () { var c = $('#label-click'); return !!(c && c.checked); } });
    P.zr = new Y.Plot2D($('#zr-host'), { xlog: true, ylabel: 'Zr /Ω', tooltip: tooltip, legendMax: lm, empty: 'Select one or more datasets' });
    P.zrRes = new Y.Plot2D($('#zr-res'), { xlog: true, xlabel: 'f /Hz', ylabel: residLabel('Zr'), legend: false, tooltip: tooltip });
    P.zi = new Y.Plot2D($('#zi-host'), { xlog: true, ylabel: 'Zi /Ω', tooltip: tooltip, legendMax: lm, empty: 'Select one or more datasets' });
    P.ziRes = new Y.Plot2D($('#zi-res'), { xlog: true, xlabel: 'f /Hz', ylabel: residLabel('Zi'), legend: false, tooltip: tooltip });
    P.mod = new Y.Plot2D($('#mod-host'), { xlog: true, ylog: true, ylabel: '|Z| /Ω', tooltip: tooltip, legendMax: lm, empty: 'Select one or more datasets',
                                           onInteract: function () { bodeLast = 'mod'; } });
    P.ph = new Y.Plot2D($('#ph-host'), { xlog: true, xlabel: 'f /Hz', ylabel: phaseLabel(), legend: false, tooltip: tooltip,
                                         onInteract: function () { bodeLast = 'phase'; } });
    linkX(P.zr, P.zrRes); linkX(P.zi, P.ziRes); linkX(P.mod, P.ph);
    P.d3 = new Y.Plot3D($('#d3-host'));
    var sel3 = $('#view3d');
    if (sel3) { sel3.value = S.settings.view3d; sel3.addEventListener('change', function () { Y.state.setSetting('view3d', sel3.value); }); }

    ['selection', 'datasets', 'model', 'data'].forEach(function (ev) { Y.bus.on(ev, function () { refresh(true); }); });
    ['params', 'stats'].forEach(function (ev) { Y.bus.on(ev, function () { refresh(false); }); });
    Y.bus.on('settings', function (key) {
      P.nyq.setOptions({ equal: S.settings.nyqEqual, legendMax: S.settings.legendMax });
      P.zrRes.o.ylabel = residLabel('Zr'); P.ziRes.o.ylabel = residLabel('Zi'); P.ph.o.ylabel = phaseLabel();
      refresh(key === 'maxPlots' || key === 'nyqEqual' || key === 'phase' || key === 'resid' || key === '*' || key === 'view3d');
    });
    document.querySelectorAll('[data-plot-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-plot-action');
        if (a === 'auto') autoscale(current);
        if (a === 'png') exportPNG(current);
        if (a === 'label') Y.cmd.labelDialog();
        if (a === 'unlabel') Y.cmd.clearLabels();
      });
    });
  }

  function residLabel(part, uz) { return S.settings.resid === 'rel' ? part + ' − calc /%|Z|' : part + ' − calc' + (uz || ' /Ω'); }

  function refresh(auto) {
    if (auto) Object.keys(needAuto).forEach(function (k) { needAuto[k] = true; });
    Object.keys(dirty).forEach(function (k) { dirty[k] = true; });
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; render(current); });
  }

  function setAuto(tab, list) {
    if (!needAuto[tab]) return;
    needAuto[tab] = false;
    list.forEach(function (p) { p.auto = true; p.hidden.clear(); });
  }

  function render(tab) {
    if (!tab || !dirty[tab]) return;
    dirty[tab] = false;
    var list = plotted(), s;
    var u = Y.state.zUnitOf(list), uz = u ? ' /' + u : ' (mixed units)';     // unit of Z (normalization)
    P.nyq.o.xlabel = 'Zr' + uz; P.nyq.o.ylabel = '−Zi' + uz; P.zr.o.ylabel = 'Zr' + uz; P.zi.o.ylabel = 'Zi' + uz; P.mod.o.ylabel = '|Z|' + uz;
    P.zrRes.o.ylabel = residLabel('Zr', uz); P.ziRes.o.ylabel = residLabel('Zi', uz);
    var empty = S.datasets.length ? 'Select one or more datasets' : 'No data yet. Use File, drop files on this window, or type demo in the command line below.';
    [P.nyq, P.zr, P.zi, P.mod].forEach(function (p) { p.o.empty = empty; });
    var note = $('#plot-note');
    if (note) {
      var nsel = S.sel.size;
      note.textContent = nsel > list.length ? 'Showing ' + list.length + ' of ' + nsel + ' selected (max plots)' : '';
    }
    switch (tab) {
      case 'nyq':
        setAuto('nyq', [P.nyq]);
        P.nyq.notes = notesFor(list);
        P.nyq.setSeries(build('nyq', list).main, true);
        break;
      case 'zr':
        setAuto('zr', [P.zr, P.zrRes]); s = build('zr', list);
        P.zr.setSeries(s.main, true); P.zrRes.setSeries(s.res, true);
        if (!P.zr.auto && P.zr.view) P.zrRes.setXView(P.zr.view.x0, P.zr.view.x1);
        break;
      case 'zi':
        setAuto('zi', [P.zi, P.ziRes]); s = build('zi', list);
        P.zi.setSeries(s.main, true); P.ziRes.setSeries(s.res, true);
        if (!P.zi.auto && P.zi.view) P.ziRes.setXView(P.zi.view.x0, P.zi.view.x1);
        break;
      case 'bode':
        setAuto('bode', [P.mod, P.ph]);
        P.mod.setSeries(build('mod', list).main, true); P.ph.setSeries(build('phase', list).main, true);
        break;
      case 'd3':
        P.d3.setData(data3d(list));
        break;
    }
  }

  function data3d(list) {
    var mode = S.settings.view3d, xs = [], ys = [], zs = [], fBased = !/^nyq/.test(mode);
    var needCalc = /calc|diff/.test(mode);
    list.forEach(function (ds, n) {
      var c = needCalc ? Y.state.calcFor(ds) : null;
      if (needCalc && !c) return;
      for (var k = 0; k < ds.f.length; k++) {
        if (ds.mask[k]) continue;
        var x, z;
        switch (mode) {
          case 'nyq': x = ds.zr[k]; z = -ds.zi[k]; break;
          case 'nyqcalc': x = c.re[k]; z = -c.im[k]; break;
          case 'zr': x = ds.f[k]; z = ds.zr[k]; break;
          case 'zi': x = ds.f[k]; z = ds.zi[k]; break;
          case 'zrdiff': x = ds.f[k]; z = ds.zr[k] - c.re[k]; break;
          case 'zidiff': x = ds.f[k]; z = ds.zi[k] - c.im[k]; break;
        }
        xs.push(x); ys.push(n); zs.push(z);
      }
    });
    var u = Y.state.zUnitOf(list), uz = u ? ' /' + u : ' (mixed units)';
    var zl = { nyq: '−Zi' + uz, nyqcalc: '−Zi calc' + uz, zr: 'Zr' + uz, zi: 'Zi' + uz, zrdiff: 'Zr − calc' + uz, zidiff: 'Zi − calc' + uz }[mode];
    return { x: xs, y: ys, z: zs, xlog: fBased, labels: { x: fBased ? 'f /Hz' : 'Zr' + uz, y: 'dataset', z: zl } };
  }

  function show(tab) {
    current = tab;
    if (dirty[tab]) { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(current); }); }
  }

  function autoscale(tab) {
    ({ nyq: [P.nyq], zr: [P.zr, P.zrRes], zi: [P.zi, P.ziRes], bode: [P.mod, P.ph], drt: Y.drtTab.plots() }[tab] || []).forEach(function (p) { p.hidden.clear(); p.autoscale(true); });
    if (tab === 'd3') { P.d3.reset(); P.d3.draw(); }
  }

  // visible rectangle of the current 2D plot, in data units, for mask / delete
  function viewFor(tab) {
    tab = tab || current;
    var v;
    switch (tab) {
      case 'nyq': return P.nyq.view ? { kind: 'nyq', v: P.nyq.dataView() } : null;
      case 'zr': return P.zr.view ? { kind: 'zr', v: P.zr.dataView() } : null;
      case 'zi': return P.zi.view ? { kind: 'zi', v: P.zi.dataView() } : null;
      case 'bode':
        if (bodeLast === 'phase' && P.ph.view) {
          v = P.ph.dataView(); var s = 1 / phaseScale();
          return { kind: 'phase', v: { x0: v.x0, x1: v.x1, y0: v.y0 * s, y1: v.y1 * s } };
        }
        return P.mod.view ? { kind: 'mod', v: P.mod.dataView() } : null;
    }
    return null;
  }

  function exportPNG(tab) {
    var parts = { nyq: [P.nyq], zr: [P.zr, P.zrRes], zi: [P.zi, P.ziRes], bode: [P.mod, P.ph], d3: [P.d3], drt: Y.drtTab.plots() }[tab];
    if (!parts) return;
    if (tab === 'drt') {                          // only the plot open in the accordion, or all when the peak table is open
      var open = parts.filter(function (p) { return p.canvas.offsetParent !== null; });
      parts = open.length ? open : parts.filter(function (p) { return p.canvas.width > 0; });
    }
    var cvs = parts.map(function (p) { return p.canvas; }), w = Math.max.apply(null, cvs.map(function (c) { return c.width; }));
    var h = cvs.reduce(function (a, c) { return a + c.height; }, 0), out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ctx = out.getContext('2d'), y = 0;
    cvs.forEach(function (c) { ctx.drawImage(c, 0, y); y += c.height; });
    var a = document.createElement('a');
    a.href = out.toDataURL('image/png'); a.download = 'yappari_' + tab + '_' + Y.writers.fileStamp() + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // static images of one dataset for the report
  function imagesFor(ds, w, h) {
    var uz = ' /' + Y.state.zUnit(ds);
    var one = [ds], out = {}, nq = build('nyq', one, { size: 4, width: 1.6, noContrib: true, report: true }), zr = build('zr', one, { size: 4, noContrib: true, report: true }), zi = build('zi', one, { size: 4, noContrib: true, report: true });
    out.nyq = Y.Plot2D.image(nq.main, { xlabel: 'Zr' + uz, ylabel: '−Zi' + uz, equal: S.settings.nyqEqual, legend: false }, w, h);
    out.zr = Y.Plot2D.image(zr.main, { xlog: true, xlabel: 'f /Hz', ylabel: 'Zr' + uz, legend: false }, w, h);
    out.zi = Y.Plot2D.image(zi.main, { xlog: true, xlabel: 'f /Hz', ylabel: 'Zi' + uz, legend: false }, w, h);
    out.mod = Y.Plot2D.image(build('mod', one, { size: 4, report: true }).main, { xlog: true, ylog: true, xlabel: 'f /Hz', ylabel: '|Z|' + uz, legend: false }, w, h);
    out.ph = Y.Plot2D.image(build('phase', one, { size: 4, report: true }).main, { xlog: true, xlabel: 'f /Hz', ylabel: phaseLabel(), legend: false }, w, h);
    if (zr.res.length) out.res = Y.Plot2D.image(zr.res.concat(zi.res.map(function (s) { return Object.assign({}, s, { color: '#d1495b' }); })),
      { xlog: true, xlabel: 'f /Hz', ylabel: 'residuals (Zr blue, Zi red)', legend: false }, w, Math.round(h * 0.6));
    return out;
  }

  function redrawAll() {
    Object.keys(P).forEach(function (k) { P[k].draw(); });
    if (Y.drtTab) Y.drtTab.plots().forEach(function (p) { p.draw(); });
  }

  return { init: init, show: show, refresh: refresh, viewFor: viewFor, color: color, plotted: plotted, redrawAll: redrawAll, _plots: P,
           PART_COLORS: PART_COLORS, nearestPoint: nearestPoint,
           imagesFor: imagesFor, current: function () { return current; }, fmtF: fmtF, fmtZ: fmtZ };
})();
