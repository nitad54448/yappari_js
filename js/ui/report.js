/*  HTML report: circuit, settings, and for each dataset its statistics, parameters with standard
 *  errors and six plots (Nyquist, Zr, Zi, |Z|, phase, residuals). Up to 30 datasets it opens in a new
 *  tab; larger reports are saved as an .html file.
 */
Y.report = (function () {
  'use strict';
  var S = Y.state.S, esc = Y.ui.esc;
  function fmt(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return a >= 1e-3 && a < 1e5 ? String(+v.toPrecision(6)) : v.toExponential(4).replace('e', 'E');
  }
  function css() { return Y.theme.exportCSS('report'); }

  function head(list) {
    var fs = Y.state.fitSummary(list), names = Y.state.names();
    var lim = names.map(function (n) {
      var L = S.model.limits[n];
      return '<tr><td>' + n + '</td><td>' + fmt(L.min) + '</td><td>' + fmt(L.max) + '</td><td>' + (S.model.shared[n] ? 'shared' : 'local') + '</td></tr>';
    }).join('');
    return '<h1>Yappari report</h1><p class="muted">' + Y.writers.stamp() + ', Yappari JS ' + esc(Y.version) + ', ' + list.length + ' dataset' + (list.length === 1 ? '' : 's') + '</p>' +
      '<h2>Circuit</h2><p><code>' + esc(S.model.cdc) + '</code></p>' + Y.schematic.svgString(S.model.tree) +
      '<table><tr><th>Method</th><td>' + esc(fs.method) + '</td></tr><tr><th>Weight</th><td>' + esc(fs.weight) +
      '</td></tr><tr><th>Iterations, tolerance</th><td>' + esc(fs.iter) + '</td></tr><tr><th>Standard errors</th><td>% of the value, from s²(JᵀJ)⁻¹ with s² = χ²red, DOF = 2N − p</td></tr></table>' +
      '<table><tr><th>Parameter</th><th>Min</th><th>Max</th><th>Global fit</th></tr>' + lim + '</table>';
  }

  function section(ds) {
    var st = ds.stats, names = Y.state.names(), img = Y.plots.imagesFor(ds, 560, 360);
    var rows = names.map(function (n) {
      var se = st && st.se ? st.se[n] : null, b = st && st.bound && st.bound[n];
      return '<tr><td>' + n + '</td><td>' + fmt(ds.p[n]) + ' ' + esc(Y.state.paramUnit(n, ds)) + '</td><td>' + (ds.fit[n] ? (b ? 'at its limit' : (Number.isFinite(se) ? '± ' + (+se.toPrecision(3)) + ' %' : '')) : 'fixed') + '</td></tr>';
    }).join('');
    var stats = st && st.chi2w != null ?
      '<table><tr><th>χ²w</th><td>' + fmt(st.chi2w) + '</td><th>χ²red</th><td>' + fmt(st.chi2red) + '</td><th>R²</th><td>' +
      (Number.isFinite(st.r2) ? st.r2.toFixed(6) : '—') + '</td><th>Points</th><td>' + (st.n || '') + '</td></tr></table><p class="muted">' +
      (st.global ? 'Global fit. ' : '') + (st.method ? esc(Y.fit.methods[st.method] || st.method) + (st.maxIter != null ? ', at most ' + st.maxIter + ' iterations, tolerance ' + st.tol : '') + '. ' : '') + (st.weight === 'sigma' ? 'Weights 1/σ², ' + esc(st.sigma || 'measured') + '. ' : '') + esc(st.msg || '') + (st.iter != null ? ', ' + st.iter + ' iterations' : '') + '.</p>' :
      '<p class="muted">Not fitted with these values.</p>';
    var pics = ['nyq', 'zr', 'zi', 'mod', 'ph', 'res'].filter(function (k) { return img[k]; })
      .map(function (k) { return '<img alt="" src="' + img[k] + '">'; }).join('');
    return '<section><h2>' + esc(ds.name) + '</h2>' + (ds.norm ? '<p class="muted">Normalized: ' + esc(Y.state.normText(ds.norm)) + '.</p>' : '') + stats + '<table><tr><th>Parameter</th><th>Value</th><th>Standard error</th></tr>' + rows +
      '</table><div class="imgs">' + pics + '</div></section>';
  }

  function build(list) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Yappari report</title><style>' + css() + '</style></head><body>' +
      head(list) + list.map(section).join('') + '</body></html>';
  }

  function save(list) {
    Y.writers.download('yappari_report_' + Y.writers.fileStamp() + '.html', build(list), 'text/html');
    Y.ui.toast('Report of ' + list.length + ' datasets saved.', 'ok');
  }

  function open(list) {
    if (list.length <= 30) {
      var w = window.open('', '_blank');
      if (w) w.document.write('<style>' + css() + '</style><p>Building the report…</p>');
      setTimeout(function () {
        if (w && !w.closed) {
          w.document.open(); w.document.write(build(list)); w.document.close();
          Y.ui.toast('Report of ' + list.length + ' dataset' + (list.length === 1 ? '' : 's') + ' opened in a new tab.', 'ok');
        } else save(list);
      }, 30);
      return;
    }
    Y.ui.confirm('The report holds ' + list.length + ' datasets with 6 images each, so it is saved as an HTML file instead of opened.', 'Save report', false, 'Large report')
      .then(function (ok) { if (ok) { Y.ui.toast('Building the report…', 'info'); setTimeout(function () { save(list); }, 30); } });
  }

  return { open: open, build: build };
})();
