/*  Start-up: restore the last settings and circuit, wire tabs, buttons, command line, drag and drop. */
(function () {
  'use strict';
  var S = Y.state.S;
  function $(s) { return document.querySelector(s); }
  var PLOT_TABS = { nyq: 1, zr: 1, zi: 1, bode: 1, d3: 1, drt: 1 };

  function showTab(tab) {
    if (!document.getElementById('pane-' + tab)) tab = 'nyq';
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + tab); });
    var isPlot = !!PLOT_TABS[tab];
    $('#ptools').hidden = !isPlot;
    $('#v3d-wrap').hidden = tab !== 'd3';
    $('#pt-nyq').hidden = tab !== 'nyq';
    $('#pt-contrib').hidden = !(tab === 'nyq' || tab === 'zr' || tab === 'zi');
    $('#phint').textContent = tab === 'd3' ? 'Drag to rotate, wheel to zoom, double-click to reset.' :
      tab === 'drt' ? 'Distributions of the selected datasets; spectra, residuals and peaks of the first one. Drag to zoom, double-click to reset.' :
      'Drag to zoom, shift-drag to pan, double-click to reset. Click a legend entry to hide that dataset.';
    if (isPlot) Y.plots.show(tab);
    if (tab === 'drt') Y.drtTab.show();
    Y.state.store('tab', tab);
  }

  function init() {
    Y.state.restore();
    Y.plots.init();
    Y.drtTab.init();
    Y.datasetsPanel.init();
    Y.paramsPanel.init();
    Y.modelEditor.init();
    Y.cmd.init();
    Y.history.init();

    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); showTab(tabs[j].getAttribute('data-tab'));
    });

    $('#btn-fit').addEventListener('click', function () { Y.cmd.fitSelected(); });
    $('#btn-stop').addEventListener('click', function () { Y.cmd.stop(); });
    Y.bus.on('busy', function (b) {
      document.body.classList.toggle('busy', !!b);
      $('#btn-fit').disabled = !!b;
      $('#btn-stop').hidden = !b;
    });

    var hist = Y.state.load('history') || [], hi = hist.length, cl = $('#cmdline');
    cl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();                    // the Enter key must not also activate the button of a dialog the command opens
        var v = cl.value.trim();
        if (!v) return;
        hist.push(v); if (hist.length > 50) hist.shift();
        Y.state.store('history', hist); hi = hist.length; cl.value = '';
        Y.cmd.runCommand(v);
      } else if (e.key === 'ArrowUp') { if (hi > 0) { hi--; cl.value = hist[hi]; e.preventDefault(); } }
      else if (e.key === 'ArrowDown') { if (hi < hist.length) { hi++; cl.value = hist[hi] || ''; e.preventDefault(); } }
    });

    var depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    window.addEventListener('dragenter', function (e) { if (hasFiles(e)) { depth++; document.body.classList.add('dropping'); } });
    window.addEventListener('dragleave', function (e) { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0;
      document.body.classList.remove('dropping');
      Y.cmd.readFiles(Array.prototype.slice.call(e.dataTransfer.files), 'auto');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'F9') { e.preventDefault(); Y.cmd.fitSelected(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); Y.cmd.saveProject(); }
    });
    window.addEventListener('beforeunload', function (e) { if (S.datasets.length) { e.preventDefault(); e.returnValue = ''; } });

    // dark mode: the switch sets light or dark; the first choice follows the system
    function isDark() { var t = S.settings.theme; return t === 'dark' || (t !== 'light' && !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
    function applyTheme() {
      var t = S.settings.theme;
      if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
      $('#theme-toggle').setAttribute('aria-checked', String(isDark()));
      Y.plots.redrawAll();
    }
    $('#theme-toggle').addEventListener('click', function () { Y.state.setSetting('theme', isDark() ? 'light' : 'dark'); });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (S.settings.theme !== 'dark' && S.settings.theme !== 'light') applyTheme(); });
    // contributions: one setting, two check boxes (plots and Model tab)
    var cb = [$('#contrib-toggle'), $('#contrib-model')];
    function syncContrib() { cb.forEach(function (c) { c.checked = !!S.settings.contrib; }); }
    cb.forEach(function (c) { c.addEventListener('change', function () { Y.state.setSetting('contrib', c.checked); }); });
    Y.bus.on('settings', function (k) { if (k === '*' || k === 'theme') applyTheme(); if (k === '*' || k === 'contrib') syncContrib(); });
    applyTheme(); syncContrib();

    $('#about-version').textContent = Y.version;
    showTab(Y.state.load('tab') || 'nyq');
    Y.bus.emit('model'); Y.bus.emit('datasets'); Y.bus.emit('selection'); Y.bus.emit('settings', '*');
    var w = Y.pool.usingWorkers();
    Y.ui.toast('Ready. ' + (w ? 'Fits run in ' + Y.pool.size() + ' parallel workers.' : 'Web Workers are unavailable, fits run in this window.'), 'info');
  }

  init();
})();
