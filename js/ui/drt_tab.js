/*  DRT tab: distribution of relaxation times of the first selected dataset (as in Yappari 5.1), recomputed when
 *  the dataset, the method, the data used or the regularisation changes. Search and Explore scan the
 *  regularisation; "DRT of selected" computes every selected dataset (Save data can then write them).
 */
Y.drtTab = (function () {
  'use strict';
  var S = Y.state.S, P = {}, timer = 0, lastId = null, current = null;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return Y.ui.esc(s); }
  function fmt(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return a !== 0 && (a >= 1e5 || a < 1e-2) ? v.toExponential(3).replace('e', 'E') : String(+v.toPrecision(4));
  }
  function gold() { return S.settings.drtMethod === 'gold'; }
  function opts() {
    var st = S.settings;
    return { method: st.drtMethod, source: st.drtSource, lambda: Math.pow(10, st.drtLambda), iterations: Math.round(Math.pow(10, st.drtIter)) };
  }
  function parText() { return gold() ? String(Math.round(Math.pow(10, S.settings.drtIter))) : fmt(Math.pow(10, S.settings.drtLambda)); }

  function syncControls() {
    var st = S.settings, sl = $('#drt-slider');
    $('#drt-method').value = st.drtMethod; $('#drt-source').value = st.drtSource; $('#drt-x').value = st.drtX;
    if (gold()) { sl.min = 2; sl.max = 5; sl.step = 0.05; sl.value = st.drtIter; } else { sl.min = -6; sl.max = 0; sl.step = 0.05; sl.value = st.drtLambda; }   // Gold: 100 to 100 000
    $('#drt-par-name').textContent = gold() ? 'Iterations' : 'λ';
    if (document.activeElement !== $('#drt-par')) $('#drt-par').value = parText();
    $('#drt-search').textContent = gold() ? 'Search iterations…' : 'Search λ…';
  }

  function tipG(s, i) {
    var r = s.r;
    return r ? '<b>' + esc(s.name) + '</b><br>τ = ' + fmt(r.tau[i]) + ' s, 1/(2πτ) = ' + Y.plots.fmtF(1 / (2 * Math.PI * r.tau[i]), 4) + '<br>g = ' + fmt(r.g[i]) : '';
  }
  function tipZ(s, i) {
    var f = s.fq ? s.fq[i] : s.x[i];
    return esc(s.name || '') + '<br>f = ' + Y.plots.fmtF(f, 4) + ', τ = 1/(2πf) = ' + fmt(1 / (2 * Math.PI * f)) + ' s<br>' + fmt(s.y[i]) + ' ' + (current ? Y.state.zUnit(current.ds) : 'Ω');
  }
  // the three plots share one axis: frequency (g placed at f = 1/(2πτ)) or time constant (spectra at τ = 1/(2πf))
  function xLabel() { return S.settings.drtX === 'tau' ? 'τ /s' : 'f /Hz'; }

  function init() {
    P.res = new Y.Plot2D($('#drt-res'), { xlog: true, ylog: true, xlabel: 'f /Hz', ylabel: '|ΔZ| /Ω', legendMax: 3, tooltip: tipZ });
    P.g = new Y.Plot2D($('#drt-g'), { xlog: true, xlabel: 'f /Hz', ylabel: 'g', legend: false, legendMax: 12, tooltip: tipG, empty: 'Select a dataset' });
    P.z = new Y.Plot2D($('#drt-z'), { xlog: true, xlabel: 'f /Hz', ylabel: 'Zr, −Zi /Ω', legendMax: 4, tooltip: tipZ });
    var trio = [P.res, P.g, P.z];
    trio.forEach(function (a) {
      a.o.onView = function (v) {
        trio.forEach(function (b) {
          if (b === a) return;
          b.setXView(v.x0, v.x1);
        });
      };
    });
    function set(key, val) { Y.state.setSetting(key, val); syncControls(); schedule(); }
    $('#drt-method').addEventListener('change', function (e) { set('drtMethod', e.target.value); });
    $('#drt-source').addEventListener('change', function (e) { set('drtSource', e.target.value); });
    $('#drt-x').addEventListener('change', function (e) { Y.state.setSetting('drtX', e.target.value); [P.res, P.g, P.z].forEach(function (p) { p.setOptions({ xlabel: xLabel() }); }); render(true); });
    $('#drt-slider').addEventListener('input', function (e) { set(gold() ? 'drtIter' : 'drtLambda', +e.target.value); });
    // typed value: Gold iterations from 1 to LIMITS.goldIter, λ from 1e-12 to 1000 (Y.state.LIMITS)
    $('#drt-par').addEventListener('change', function (e) {
      var v = Y.ui.parseNum(e.target.value), L = Y.state.LIMITS, lg = Math.log10(v);
      var ok = gold() ? v >= 1 && v <= L.goldIter : lg >= L.lambdaLog[0] && lg <= L.lambdaLog[1];
      if (!ok) {
        Y.ui.toast(gold() ? 'Gold iterations: enter a number from 1 to ' + L.goldIter + '.' :
          'λ: enter a number from 1E' + L.lambdaLog[0] + ' to 1E' + L.lambdaLog[1] + '.', 'warn');
        syncControls(); return;
      }
      set(gold() ? 'drtIter' : 'drtLambda', lg);
    });
    $('#drt-search').addEventListener('click', searchDialog);
    $('#drt-all').addEventListener('click', saveSelected);
    ['selection', 'data', 'datasets'].forEach(function (ev) { Y.bus.on(ev, function () { if (visible()) schedule(); }); });
    Y.bus.on('settings', function (k) { if (k === '*') { syncControls(); if (visible()) schedule(); } });
    Y.bus.on('theme', function () { if (current) render(false); });
    [P.res, P.g, P.z].forEach(function (p) { p.setOptions({ xlabel: xLabel() }); });
    syncControls();
  }

  function visible() { var p = $('#pane-drt'); return !!p && p.classList.contains('on'); }
  function show() { syncControls(); schedule(true); }
  function schedule(now) { clearTimeout(timer); timer = setTimeout(update, now ? 0 : (gold() ? 300 : 60)); }

  // The distributions of the selected datasets (as plotted, at most 12; Gold, being slow, only the first) are
  // drawn in the dataset colours; spectra, residuals and peaks are those of the first selected dataset.
  // The first dataset is computed and drawn at once; the others are computed afterwards in short slices, so a large
  // selection does not block the window. A newer update (selection, method, λ ...) cancels the slices still to run.
  var MAX_OVERLAY = 12, gen = 0;
  function update() {
    var my = ++gen, sel = Y.plots.plotted(), ds = sel[0];
    if (!ds) { current = null; lastId = null; clear('Select one or more datasets to see their distribution of relaxation times.'); return; }
    var o = opts(), list = gold() ? [ds] : sel.slice(0, MAX_OVERLAY), all = [], t0 = performance.now(), i = 1;
    try { ds.drt = Y.drt.compute(ds, o); all.push({ ds: ds, r: ds.drt }); }
    catch (e) { current = null; lastId = null; clear(ds.name + ': ' + e.message); return; }
    var key = list.map(function (d) { return d.id; }).join(','), fresh = key !== lastId;   // same datasets: keep the zoom
    lastId = key;
    function show(final) {
      current = { ds: ds, r: ds.drt, all: all.slice(), left: S.sel.size - (final ? all.length : list.length), ms: performance.now() - t0 };
      render(fresh);
    }
    if (list.length > 1) show(false);
    (function more() {
      if (my !== gen) return;
      var t = performance.now();
      while (i < list.length && performance.now() - t < 30) {
        var d = list[i++];
        try { d.drt = Y.drt.compute(d, o); all.push({ ds: d, r: d.drt }); } catch (e) { /* shown for the first one only */ }
      }
      if (i < list.length) setTimeout(more, 0); else show(true);
    })();
  }
  function clear(msg) {
    [P.res, P.g, P.z].forEach(function (p) { p.setSeries([]); });
    $('#drt-peaks').innerHTML = '<p class="hint">' + esc(msg) + '</p>';
  }
  function absDiff(a, b) { return Float64Array.from(a, function (v, k) { return Math.abs(v - b[k]); }); }
  function neg(a) { return Float64Array.from(a, function (v) { return -v; }); }

  function render(auto) {
    if (!current) return;
    var r = current.r, xf = S.settings.drtX !== 'tau', multi = current.all.length > 1, name = current.ds.name, C = Y.theme.get().drt;
    var xs = xf ? r.f : Float64Array.from(r.f, function (f) { return 1 / (2 * Math.PI * f); });
    var u = Y.state.zUnit(current.ds);
    P.res.o.ylabel = '|ΔZ| /' + u; P.z.o.ylabel = 'Zr, −Zi /' + u;
    // Also update after project/settings loads, not just dropdown changes.
    [P.res, P.g, P.z].forEach(function (p) {
      if (p.o.xlabel !== xLabel()) auto = true;  // a saved zoom uses the old units too
      p.o.xlabel = xLabel();
    });
    if (auto) [P.res, P.g, P.z].forEach(function (p) { p.auto = true; });
    P.g.o.legend = multi;
    P.g.setSeries(current.all.map(function (it) {
      return { name: it.ds.name, group: 'g' + it.ds.id, x: Float64Array.from(it.r.tau, function (t) { return xf ? 1 / (2 * Math.PI * t) : t; }), y: it.r.g,
               color: multi ? Y.plots.color(it.ds) : C.g, mode: multi ? 'lines' : 'area', width: multi ? 1.6 : 1.4, hover: true, legend: true, r: it.r };
    }), !auto);
    P.z.setSeries([
      { name: 'Zr, ' + name, group: 'zr', x: xs, fq: r.f, y: r.zrExp, color: C.zr, mode: 'markers', hover: true, legend: true },
      { group: 'zr', x: xs, fq: r.f, y: r.zr, color: C.zr, mode: 'lines' },
      { name: '−Zi, ' + name, group: 'zi', x: xs, fq: r.f, y: neg(r.ziExp), color: C.zi, mode: 'markers', hover: true, legend: true },
      { group: 'zi', x: xs, fq: r.f, y: neg(r.zi), color: C.zi, mode: 'lines' }], !auto);
    P.res.setSeries([
      { name: '|Zr − Zr drt|', group: 'r', x: xs, fq: r.f, y: absDiff(r.zrExp, r.zr), color: C.zr, mode: 'markers', hover: true, legend: true, size: 3 },
      { name: '|Zi − Zi drt|', group: 'i', x: xs, fq: r.f, y: absDiff(r.ziExp, r.zi), color: C.zi, mode: 'markers', hover: true, legend: true, size: 3 }], !auto);
    var rows = r.peaks.map(function (p, k) {
      return '<tr><td>' + (k + 1) + '</td><td>' + fmt(p.f) + '</td><td>' + fmt(p.tau) + '</td><td>' + fmt(p.R) + '</td><td>' + fmt(p.C) + '</td><td>' + (100 * p.share).toFixed(1) + ' %</td></tr>';
    }).join('');
    var others = multi ? ' The distributions of ' + (current.all.length - 1) + ' other selected datasets are drawn in their colours' +
      (current.left > 0 ? ' (' + current.left + ' more not drawn)' : '') + '.' : (gold() && S.sel.size > 1 ? ' Gold is slow: only the first selected dataset is drawn.' : '');
    $('#drt-peaks').innerHTML = '<table class="grid compact"><thead><tr><th>Peaks of ' + esc(name) + '</th><th>1/(2πτ) /Hz</th><th>τ /s</th><th>R /' + u + '</th><th>C = τ/R /' + Y.state.unitFor('F', current.ds) + '</th><th>of Rpol</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No peak</td></tr>') + '</tbody></table><p class="hint">' + esc(name) + ': R∞ = ' + fmt(r.rinf) + ' ' + u + ' and Rpol = ' + fmt(r.rpol) +
      ' ' + u + ' from the data, ∫g dlnτ = ' + r.area.toFixed(3) + ', misfit ' + (100 * r.err).toFixed(2) + ' % rms, ' + r.f.length + ' points, ' + r.tau.length + ' τ values, ' +
      Math.round(current.ms) + ' ms. R and C of each peak are estimates, useful as start values.' + others + '</p>';
  }

  function describe(o) {
    return (o.method === 'gold' ? 'Gold, ' + o.iterations + ' iterations' : (o.method === 'fisk' ? 'Fisk' : 'Tikhonov') + ', λ = ' + fmt(o.lambda)) +
      ', data ' + { both: 'Zr and Zi', im: 'Zi', re: 'Zr' }[o.source];
  }

  // DRT of every selected dataset with the current settings, saved to a text file. The work runs in slices with the
  // busy state set; finish() always clears it, also when something unexpected throws, so the program cannot stay busy.
  function saveSelected() {
    var list = Y.state.selected();
    if (!list.length) { Y.ui.toast('Select one or more datasets first.', 'warn'); return; }
    if (S.busy) { Y.ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    var o = opts(), i = 0, items = [], bad = 0;
    function finish(err) {
      Y.state.setBusy(false); Y.ui.progress(0, 0);
      try {
        if (err) throw err;
        if (items.length) Y.writers.download('yappari_drt_' + Y.writers.fileStamp() + '.txt', Y.writers.drtText(items, S.settings.sep, describe(o)));
      } catch (e) { Y.ui.toast('The DRT could not be saved: ' + ((e && e.message) || e), 'err'); return; }
      Y.ui.toast('Saved the DRT of ' + items.length + ' dataset' + (items.length === 1 ? '' : 's') + ' (' + describe(o) + ')' +
        (bad ? '; ' + bad + ' not possible, see Log' : '') + '.', bad ? 'warn' : 'ok');
    }
    Y.ui.progress(0, list.length); Y.state.setBusy(true);
    (function chunk() {
      try {
        var t = performance.now();
        while (i < list.length && performance.now() - t < 40) {
          try { list[i].drt = Y.drt.compute(list[i], o); items.push({ name: list[i].name, r: list[i].drt, norm: list[i].norm }); }
          catch (e) { bad++; Y.ui.log(list[i].name + ': ' + e.message, 'warn'); }
          i++;
        }
        Y.ui.progress(i, list.length);
      } catch (e) { finish(e); return; }
      if (i < list.length) setTimeout(chunk, 0); else finish(null);
    })();
  }

  function nearestIndex(values, x) {
    var b = 0;
    values.forEach(function (v, k) { if (Math.abs(Math.log(v / x)) < Math.abs(Math.log(values[b] / x))) b = k; });
    return b;
  }

  function searchDialog() {
    var ds = Y.state.first();
    if (!ds) { Y.ui.toast('Select a dataset first.', 'warn'); return; }
    var o = opts(), isGold = gold(), values = Y.drt.scanValues(o.method, isGold ? 25 : 31), sc;
    try { sc = Y.drt.scanner(ds, o, values); } catch (e) { Y.ui.toast(ds.name + ': ' + e.message, 'err'); return; }
    var body = document.createElement('div'), closed = false, chosen = -1, plot = null, what = isGold ? 'number of iterations' : 'λ';
    body.innerHTML = '<p class="intro">' + esc(ds.name) + ': misfit of the DRT and re–im cross-validation (Zr predicted by a DRT of Zi alone), both rms and relative to |Z|, for each ' +
      what + '. The suggestion is the strongest regularisation whose misfit stays within 10 % of the best one. Click the plot to choose another value.</p>' +
      '<div class="dlg-plot" id="scan-plot"></div><p class="scan-msg" id="scan-msg">Computing…</p>';
    function draw() {
      var C = Y.theme.get().drt, res = sc.result, err = Array.from(res.err, function (v) { return 100 * v; }), cv = Array.from(res.cv, function (v) { return 100 * v; });
      var all = err.concat(cv).filter(function (v) { return v > 0 && isFinite(v); });
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), series = [
        { name: 'misfit', group: 'e', x: values, y: err, color: C.misfit, mode: 'lines', legend: true },
        { name: 'misfit', group: 'e', x: values, y: err, color: C.misfit, mode: 'markers', hover: true },
        { name: 're–im cross-validation', group: 'c', x: values, y: cv, color: C.cv, mode: 'lines', legend: true },
        { name: 're–im cross-validation', group: 'c', x: values, y: cv, color: C.cv, mode: 'markers', hover: true }];
      if (chosen >= 0) series.push({ name: 'chosen', group: 'x', x: [values[chosen], values[chosen]], y: [lo, hi], color: C.chosen, mode: 'lines', width: 1.5, legend: true });
      plot.setSeries(series, true);
      $('#scan-msg').textContent = chosen >= 0 ? 'Chosen: ' + (isGold ? values[chosen] + ' iterations' : 'λ = ' + fmt(values[chosen])) + ', misfit ' + err[chosen].toFixed(2) + ' %.' : '';
    }
    Y.ui.modal({
      title: isGold ? 'Search the number of Gold iterations' : 'Search the regularisation parameter λ', size: 'xl', body: body,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Use this value', primary: true, value: function () { return chosen >= 0 ? values[chosen] : null; } }],
      onOpen: function () {
        plot = new Y.Plot2D($('#scan-plot'), { xlog: true, ylog: true, xlabel: isGold ? 'iterations' : 'λ', ylabel: 'rms /%', legendMax: 4,
          tooltip: function (s, i) { return esc(s.name) + ': ' + fmt(s.y[i]) + ' % at ' + fmt(s.x[i]); },
          onClick: function (x) { if (x > 0 && sc.result.err.every(function (v) { return v === v; })) { chosen = nearestIndex(values, x); draw(); } } });
        var k = 0;
        (function step() {
          if (closed) return;
          var t = performance.now();
          while (k < sc.total && performance.now() - t < 60) { sc.step(k); k++; }
          $('#scan-msg').textContent = 'Computing… ' + Math.round(100 * k / sc.total) + ' %';
          if (k < sc.total) { setTimeout(step, 0); return; }
          chosen = Y.drt.bestIndex(sc.result, o.method);
          draw();
        })();
      }
    }).then(function (v) {
      closed = true;
      if (plot) plot.destroy();
      if (v == null) return;
      Y.state.setSetting(isGold ? 'drtIter' : 'drtLambda', Math.log10(v));
      syncControls(); schedule(true);
      Y.ui.toast('DRT ' + (isGold ? 'iterations set to ' + v : 'λ set to ' + fmt(v)) + '.', 'ok');
    });
  }

  return { init: init, show: show, plots: function () { return P.res ? [P.res, P.g, P.z] : []; },
           saveSelected: saveSelected, searchDialog: searchDialog };
})();
