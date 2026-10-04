/*  Theme: the look of everything the program draws itself (canvas plots, dataset colours, circuit drawing, report)
 *  comes from the CSS variables of style.css, which is the one place that decides the appearance.
 *    Y.theme.get()          values of the theme shown on the page (cached; refresh() after a theme switch)
 *    Y.theme.get('light')   values of the light theme whatever the page shows: reports are always light
 *    Y.theme.seriesVar(n)   colour of dataset n (0-based) for HTML, as var(--series-k): follows the theme by itself
 *    Y.theme.partVars()     the contribution colours as var(--part-k), for the circuit drawing
 *  The fallbacks are only used when style.css lacks a variable. Series sizes and widths in the code are given for
 *  3.2 px markers and 1.5 px lines; ms and ls scale them to --plot-marker-size and --plot-line-width.
 */
Y.theme = (function () {
  'use strict';
  var cache = {}, probe = null;

  function read(cs) {
    function str(n) { return (cs.getPropertyValue(n) || '').trim(); }
    function col(n) { return str(n) || 'gray'; }
    function num(n, d) { var v = parseFloat(str(n)); return isFinite(v) && v >= 0 ? v : d; }
    function list(prefix) { var out = []; for (var i = 1; i <= 64; i++) { var v = str(prefix + i); if (!v) break; out.push(v); } return out; }
    var t = {
      bg: col('--plot-bg'), grid: col('--plot-grid'), minor: col('--plot-minor'), axis: col('--plot-axis'),
      ink: col('--ink'), ink2: col('--ink-2'), blue: col('--blue'), panel: col('--panel'), rule: col('--rule'), rule2: col('--rule-2'),
      font: str('--font-ui') || 'sans-serif', fontCode: str('--font-code') || 'monospace',
      zoomFill: col('--plot-zoom-fill'), zoomLine: col('--plot-zoom-line'),
      fontSize: num('--plot-font-size', 11), titleSize: num('--plot-title-size', 12),
      marker: num('--plot-marker-size', 3.2), line: num('--plot-line-width', 1.5),
      masked: num('--plot-masked-opacity', 0.45), area: num('--plot-area-opacity', 0.3), errorbar: num('--plot-errorbar-opacity', 0.5),
      series: list('--series-'), parts: list('--part-'),
      drt: { g: col('--drt-g'), zr: col('--drt-zr'), zi: col('--drt-zi'), misfit: col('--drt-misfit'), cv: col('--drt-cv'), chosen: col('--drt-chosen') },
      reportZr: col('--report-zr'), reportZi: col('--report-zi'),
      schematic: { wire: str('--schematic-wire') || '1px', line: str('--schematic-line') || '1px', box: str('--schematic-box') || '1px',
                   font: str('--schematic-font-size') || '12px', symbol: str('--schematic-symbol-size') || '11px' }
    };
    if (!t.series.length) t.series = [t.ink];
    if (!t.parts.length) t.parts = [t.ink2];
    t.ms = t.marker / 3.2; t.ls = t.line / 1.5;
    return t;
  }

  function get(which) {
    var key = which || 'page';
    if (!cache[key]) {
      var el = document.documentElement;
      if (which) {                           // a hidden element that carries the requested theme
        if (!probe) { probe = document.createElement('i'); probe.hidden = true; document.body.appendChild(probe); }
        probe.setAttribute('data-theme', which);
        el = probe;
      }
      cache[key] = read(getComputedStyle(el));
    }
    return cache[key];
  }
  function refresh() { cache = {}; }
  function seriesVar(n) { return 'var(--series-' + (n % get().series.length + 1) + ')'; }
  function partVars() { return get().parts.map(function (c, i) { return 'var(--part-' + (i + 1) + ')'; }); }

  return { get: get, refresh: refresh, seriesVar: seriesVar, partVars: partVars };
})();
