/*  Start-up: restore the last settings and circuit, wire tabs, buttons, command line, drag and drop. */
(function () {
  'use strict';
  var S = Y.state.S;
  function $(s) { return document.querySelector(s); }
  var VIEWS = { nyq: 1, zr: 1, zi: 1, bode: 1, d3: 1 };      // plot views inside the EIS tab
  var lastView = 'nyq', curTab = 'nyq';

  // tab: a plot view (nyq, zr, zi, bode, d3), 'eis' (the last plot view), or a workspace (model, drt, params, log, about)
  function showTab(tab) {
    if (tab === 'eis') tab = lastView;
    if (!document.getElementById('pane-' + tab)) tab = 'nyq';
    if (VIEWS[tab]) lastView = tab;
    curTab = tab;
    var top = VIEWS[tab] ? 'eis' : tab;
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === top;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === tab)); });
    document.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + tab); });
    var isPlot = !!VIEWS[tab] || tab === 'drt';
    $('#ptools').hidden = !VIEWS[tab];            // the DRT tab has its own toolbar
    $('#view-seg').hidden = !VIEWS[tab];
    $('#ptools .tool-sep').hidden = !VIEWS[tab];
    $('#v3d-wrap').hidden = tab !== 'd3';
    $('#pt-nyq').hidden = tab !== 'nyq';
    $('#pt-show').hidden = !(tab === 'nyq' || tab === 'zr' || tab === 'zi' || tab === 'bode');
    $('#pt-contrib').hidden = !(tab === 'nyq' || tab === 'zr' || tab === 'zi');
    $('#phint').textContent = tab === 'd3' ? 'Drag to rotate, wheel to zoom, double-click to reset.' :
      tab === 'drt' ? 'Distributions of the selected datasets; spectra, residuals and peaks of the first one. Drag to zoom, double-click to reset.' :
      'Drag to zoom, shift-drag to pan, double-click to reset. Click a legend entry (data, Fit or a contribution) to hide or show it.';
    if (isPlot) Y.plots.show(tab);
    if (tab === 'drt') Y.drtTab.show();
    Y.state.store('tab', tab);
  }
  Y.app = { showTab: showTab, tab: function () { return curTab; } };

  // fit bar: individual or global fit, and the fit method (same setting as in Settings)
  function fitMode() { return Y.state.load('fitmode') === 'global' ? 'global' : 'single'; }
  function syncFitbar() {
    var g = fitMode() === 'global';
    document.querySelectorAll('[data-fitmode]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-fitmode') === 'global') === g)); });
    $('#btn-fit').textContent = g ? 'Global fit of selected' : 'Fit selected';
    $('#fit-mode-hint').textContent = g ? 'One fit of all selected datasets. Parameters ticked “shared” in Settings get one value for all, the others one value per dataset.'
                                        : 'Each selected dataset is fitted on its own, in parallel.';
    $('#fit-method').value = S.settings.method;
    $('#fit-weight').value = S.settings.weight;
  }
  function syncTarget() {
    var n = S.sel.size, f = Y.state.first();
    $('#fit-target').innerHTML = !S.datasets.length ? 'No datasets yet.' :
      (n ? '<b>' + n + '</b> of ' + S.datasets.length + ' datasets selected' + (n === 1 && f ? ': ' + esc(f.name) : '') : 'No dataset selected. Choose some in Datasets.') +
      (S.model.cdc ? '<br>Circuit <code>' + esc(S.model.cdc) + '</code>' : '<br>No circuit yet, build one in Model.');
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // side panel tabs: Datasets, Parameters, Fit
  function showSide(name) {
    if (!document.getElementById('sp-' + name)) name = 'datasets';
    document.querySelectorAll('[data-side]').forEach(function (b) {
      var on = b.getAttribute('data-side') === name;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.side-panel').forEach(function (p) { p.classList.toggle('on', p.id === 'sp-' + name); });
    Y.state.store('side', name);
  }
  Y.app.showSide = showSide;
  // side panel width: drag the left edge, arrow keys when focused, double-click to reset; remembered
  var SIDE_MIN = 260, SIDE_DEF = 350;
  function setSide(w, save) {
    w = Math.round(Math.max(SIDE_MIN, Math.min(w, window.innerWidth * 0.6)));
    document.documentElement.style.setProperty('--side-w', w + 'px');
    if (save) Y.state.store('sidew', w);
  }
  function initGrip() {
    var g = $('#side-grip'), w0 = Y.state.load('sidew');
    if (w0) setSide(w0, false);
    g.addEventListener('pointerdown', function (e) {
      e.preventDefault(); g.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
      function mv(ev) { setSide(window.innerWidth - ev.clientX, false); }
      function up() {
        g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        setSide(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w')), true);
      }
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', function () { setSide(SIDE_DEF, true); });
    g.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var w = $('.side').getBoundingClientRect().width, d = e.shiftKey ? 50 : 10;
      setSide(w + (e.key === 'ArrowLeft' ? d : -d), true);
    });
  }

  // DRT: one view at a time (g, spectrum, residuals or peaks), chosen in the toolbar, given the full height
  function initDrtView() {
    var sel = $('#drt-view'), views = document.querySelectorAll('#drt-views .drt-view');
    function open(name) {
      if (!document.querySelector('#drt-views .drt-view[data-sec="' + name + '"]')) name = 'g';
      views.forEach(function (v) { v.classList.toggle('on', v.getAttribute('data-sec') === name); });
      sel.value = name;
      Y.state.store('drtsec', name);
    }
    sel.addEventListener('change', function () { open(sel.value); });
    Y.app.drtView = open;
    open(Y.state.load('drtsec') || 'g');
  }

  function runFit() { if (fitMode() === 'global') Y.cmd.globalFit(); else Y.cmd.fitSelected(); }

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
    $('.top').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); showTab(tabs[j].getAttribute('data-tab'));
    });

    $('#btn-fit').addEventListener('click', runFit);
    document.querySelectorAll('[data-fitmode]').forEach(function (b) {
      b.addEventListener('click', function () { Y.state.store('fitmode', b.getAttribute('data-fitmode')); syncFitbar(); });
    });
    $('#fit-method').addEventListener('change', function () { Y.state.setSetting('method', $('#fit-method').value); });
    $('#fit-weight').addEventListener('change', function () { Y.state.setSetting('weight', $('#fit-weight').value); });
    Y.bus.on('settings', function (k) { if (k === '*' || k === 'method' || k === 'weight') syncFitbar(); });
    Y.bus.on('selection', syncTarget); Y.bus.on('datasets', syncTarget); Y.bus.on('model', syncTarget);
    var sideTabs = Array.prototype.slice.call(document.querySelectorAll('[data-side]'));
    sideTabs.forEach(function (b) { b.addEventListener('click', function () { showSide(b.getAttribute('data-side')); }); });
    $('.side-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = sideTabs.indexOf(document.activeElement); if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + sideTabs.length) % sideTabs.length;
      sideTabs[j].focus(); showSide(sideTabs[j].getAttribute('data-side'));
    });
    $('#clone-all').addEventListener('click', function () { Y.cmd.cloneTo(true); });
    $('#clone-sel').addEventListener('click', function () { Y.cmd.cloneTo(false); });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-view')); }); });
    initGrip();
    initDrtView();
    $('#cmd-help').addEventListener('click', function () { Y.cmd.showHelp(); });
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
      if (e.key === 'F9') { e.preventDefault(); runFit(); }
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
    function syncContrib() { cb.forEach(function (c) { c.checked = !!S.settings.contrib; }); $('#fit-toggle').checked = S.settings.showFit !== false; $('#data-toggle').checked = S.settings.showData !== false; }
    $('#data-toggle').addEventListener('change', function () { Y.state.setSetting('showData', $('#data-toggle').checked); });
    $('#fit-toggle').addEventListener('change', function () { Y.state.setSetting('showFit', $('#fit-toggle').checked); });
    cb.forEach(function (c) { c.addEventListener('change', function () { Y.state.setSetting('contrib', c.checked); }); });
    Y.bus.on('settings', function (k) { if (k === '*' || k === 'theme') applyTheme(); if (k === '*' || k === 'contrib' || k === 'showFit' || k === 'showData') syncContrib(); });
    applyTheme(); syncContrib();

    $('#about-version').textContent = Y.version;
    syncFitbar();
    showSide(Y.state.load('side') || 'datasets');
    showTab(Y.state.load('tab') || 'nyq');
    Y.bus.emit('model'); Y.bus.emit('datasets'); Y.bus.emit('selection'); Y.bus.emit('settings', '*');
    var w = Y.pool.usingWorkers();
    Y.ui.toast('Ready. ' + (w ? 'Fits run in ' + Y.pool.size() + ' parallel workers.' : 'Web Workers are unavailable, fits run in this window.'), 'info');
  }

  init();
})();
