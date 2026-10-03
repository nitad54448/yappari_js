/*  Parameters: the list in the side panel (values of the first selected dataset; edits apply to all
 *  selected datasets) and the Parameters tab (fit, data, plot settings, limits, element defaults).
 *  Mouse wheel over a parameter: x1.02 per step (log parameters) or +-0.005 (linear ones);
 *  Shift = larger steps, Alt or Ctrl = finer steps. Arrow keys do the same in the value field.
 */
Y.paramsPanel = (function () {
  'use strict';
  var S = Y.state.S, esc = Y.ui.esc, editing = null;
  function $(s) { return document.querySelector(s); }

  function fmtVal(v) {
    if (typeof v !== 'number' || !isFinite(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e-2 && a < 1e5) return String(+v.toPrecision(6));
    return v.toExponential(4).replace('e', 'E');
  }
  function fmtStat(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return a >= 1e-3 && a < 1e4 ? String(+v.toPrecision(5)) : v.toExponential(3).replace('e', 'E');
  }
  function fmtPct(v) { return v >= 100 ? '>100%' : (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + '%'; }
  function info(name) {
    var ps = S.model.prog ? S.model.prog.params : [];
    for (var i = 0; i < ps.length; i++) if (ps[i].name === name) return ps[i];
    return null;
  }
  function bounded() { return S.settings.method !== 'LM'; }
  function clampVal(n, v) { var L = S.model.limits[n]; return bounded() && L ? Math.min(L.max, Math.max(L.min, v)) : v; }

  // ---------------------------------------------------------------- side panel list
  function renderList() {
    var host = $('#param-list'), ds = Y.state.first(), prog = S.model.prog, head = $('#param-ds');
    head.textContent = ds ? (S.sel.size > 1 ? ds.name + ' and ' + (S.sel.size - 1) + ' more' : ds.name) : '';
    head.title = S.sel.size > 1 ? 'Values of the first selected dataset. Changes apply to all ' + S.sel.size + ' selected datasets.' : '';
    if (!prog) { host.innerHTML = '<p class="hint">No circuit yet. Build one in the Model tab.</p>'; renderStats(); return; }
    host.innerHTML = prog.params.map(function (pp) {
      var E = Y.elements[pp.kind], dis = ds && !S.busy ? '' : ' disabled';
      return '<div class="prow" data-name="' + pp.name + '"><span class="pn" title="' + esc(E.title + ', ' + pp.label + (pp.unit ? ' /' + pp.unit : '')) + '">' + pp.name + '</span>' +
        '<input class="pv" aria-label="' + pp.name + '" spellcheck="false" autocomplete="off"' + dis + '>' +
        '<span class="pu" title="' + esc(pp.unit) + '">' + esc(pp.unit) + '</span><span class="ps"></span>' +
        '<input class="pf" type="checkbox" title="Fit ' + pp.name + '" aria-label="Fit ' + pp.name + '"' + dis + '></div>';
    }).join('') + (ds ? '' : '<p class="hint">Start values for new datasets. Select a dataset to edit its values.</p>');
    renderValues();
  }

  function renderValues() {
    var ds = Y.state.first();
    if (!S.model.prog) return;
    document.querySelectorAll('#param-list .prow').forEach(function (row) {
      var n = row.getAttribute('data-name'), pp = info(n);
      if (!pp) return;
      var d = Y.paramDefault(pp.kind, pp.pi), v = ds ? ds.p[n] : d.def, fit = ds ? ds.fit[n] : d.fit;
      var inp = row.querySelector('.pv'), pu = row.querySelector('.pu'), uu = Y.state.unitFor(pp.unit, ds);
      if (pu.textContent !== uu) { pu.textContent = uu; pu.title = uu; }
      if (editing !== n) inp.value = fmtVal(v);
      row.querySelector('.pf').checked = !!fit;
      row.classList.toggle('fixed', !fit);
      var se = row.querySelector('.ps'), st = ds && ds.stats;
      if (st && st.bound && st.bound[n]) { se.textContent = 'limit'; se.title = 'At its limit, no standard error'; se.className = 'ps lim'; }
      else if (st && st.se && Number.isFinite(st.se[n])) { se.textContent = st.se[n] >= 100 ? '>100%' : '±' + fmtPct(st.se[n]); se.title = 'Standard error, % of the value'; se.className = 'ps'; }
      else { se.textContent = ''; se.title = ''; se.className = 'ps'; }
    });
    renderStats();
  }

  function renderStats() {
    var ds = Y.state.first(), st = ds && ds.stats, host = $('#param-stats');
    if (!ds || !S.model.prog) { host.innerHTML = ''; return; }
    if (!st) { host.innerHTML = '<p class="hint">Not fitted with these values.</p>'; return; }
    if (st.chi2w == null) { host.innerHTML = '<p class="hint err">Fit failed: ' + esc(st.msg || '') + '</p>'; return; }
    var msg = st.msg || '', short = /^converged/.test(msg) ? 'converged' : /iteration limit/.test(msg) ? 'iteration limit' : /^stopped/.test(msg) ? 'stalled, not a minimum' : msg;
    var wname = { mod: '1/|Z|', mod2: '1/|Z|²', unit: '1', sigma: '1/σ², ' + (st.sigma || 'measured') }[st.weight] || st.weight || '';
    host.innerHTML = '<dl><dt>χ²<sub>w</sub></dt><dd>' + fmtStat(st.chi2w) + '</dd><dt>χ²<sub>red</sub></dt><dd>' + fmtStat(st.chi2red) +
      '</dd><dt>R²</dt><dd>' + (Number.isFinite(st.r2) ? st.r2.toFixed(6) : '—') + '</dd><dt>Weights</dt><dd>' + esc(wname) +
      '</dd><dt>Fit</dt><dd title="' + esc(msg) + '">' + (st.global ? 'global, ' : '') + (st.iter != null ? st.iter + ' it, ' : '') + esc(short) +
      (short === 'converged' ? ' <span class="why">(' + esc(msg.replace(/^converged: /, '')) + ')</span>' : '') + '</dd></dl>';
  }

  function commitInput(inp) {
    var row = inp.closest('.prow'), n = row.getAttribute('data-name'), ds = Y.state.first();
    if (!ds) return;
    if (S.busy) { inp.value = fmtVal(ds.p[n]); return; }  // a running fit owns the values
    if (inp.value === fmtVal(ds.p[n])) return;            // unchanged: keep the fit statistics
    var v = Y.ui.parseNum(inp.value);
    if (!isFinite(v)) { inp.value = fmtVal(ds.p[n]); Y.ui.toast('Not a number: ' + n + ' unchanged.', 'warn'); return; }
    var c = clampVal(n, v);
    if (c !== v) Y.ui.toast(n + ' kept within its limits, ' + fmtVal(S.model.limits[n].min) + ' to ' + fmtVal(S.model.limits[n].max) + ' (see Settings).', 'warn');
    Y.state.setParam(n, c);
  }

  function step(n, dir, e) {
    var ds = Y.state.first(), pp = info(n);
    if (!ds || !pp || S.busy) return;
    var v = ds.p[n], big = e.shiftKey, fine = e.altKey || e.ctrlKey;
    if (pp.scale === 'log' && v > 0) v *= Math.pow(big ? 1.1 : fine ? 1.002 : 1.02, dir);
    else v += dir * (big ? 0.05 : fine ? 0.001 : 0.005);
    editing = null;
    Y.state.setParam(n, clampVal(n, +v.toPrecision(12)));
  }

  function bindList() {
    var host = $('#param-list');
    host.addEventListener('focusin', function (e) { if (e.target.classList.contains('pv')) editing = e.target.closest('.prow').getAttribute('data-name'); });
    host.addEventListener('focusout', function (e) { if (e.target.classList.contains('pv')) { commitInput(e.target); editing = null; renderValues(); } });
    host.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('pv')) return;
      var n = e.target.closest('.prow').getAttribute('data-name');
      if (e.key === 'Enter') { e.preventDefault(); commitInput(e.target); e.target.select(); }
      else if (e.key === 'Escape') { editing = null; renderValues(); e.target.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(n, e.key === 'ArrowUp' ? 1 : -1, e); editing = n; }
    });
    host.addEventListener('wheel', function (e) {
      var row = e.target.closest('.prow');
      if (!row || !Y.state.first()) return;
      e.preventDefault();
      step(row.getAttribute('data-name'), e.deltaY < 0 ? 1 : -1, e);
    }, { passive: false });
    host.addEventListener('change', function (e) {
      if (!e.target.classList.contains('pf')) return;
      var n = e.target.closest('.prow').getAttribute('data-name'), ds = Y.state.first();
      if (S.busy) { e.target.checked = !!(ds && ds.fit[n]); Y.ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
      Y.state.setFit(n, e.target.checked);
    });
  }

  // ---------------------------------------------------------------- Parameters tab
  var GROUPS = [
    { legend: 'Fit', fields: [
      { key: 'method', label: 'Method', type: 'select', options: [['TRDL', 'Trust-region dogleg, bounded'], ['LMB', 'Levenberg–Marquardt, bounded'], ['LM', 'Levenberg–Marquardt, no bounds'], ['NM', 'Nelder–Mead, bounded']] },
      { key: 'weight', label: 'Weight of each point', type: 'select', options: [['mod', '1/|Z|'], ['mod2', '1/|Z|²'], ['unit', '1 (no weighting)']],
        hint: 'χ²w = Σ w·[(Zr − Zr calc)² + (Zi − Zi calc)²]' },
      { key: 'maxIter', label: 'Maximum iterations', type: 'int', min: 1 },
      { key: 'tol', label: 'Stop when χ² changes less than', type: 'num', positive: true, hint: 'Relative change between two iterations.' }] },
    { legend: 'Data files', fields: [
      { key: 'sep', label: 'Column separator, 3-column files and saved data', type: 'select',
        options: [['auto', 'Detect automatically'], ['tab', 'TAB'], ['space', 'Space'], ['comma', 'Comma'], ['semicolon', 'Semicolon']],
        hint: 'Decimal commas are accepted whenever the separator is not a comma.' },
      { key: 'useSigma', label: 'Use measured standard deviations as weights, w = 1/σ²', type: 'check',
        hint: 'When the file has them (MFLI csv, saved data). Points without one get the median relative error of the others.' }] },
    { legend: 'Simulation', fields: [
      { key: 'simStart', label: 'Start frequency /Hz', type: 'num', positive: true },
      { key: 'simEnd', label: 'End frequency /Hz', type: 'num', positive: true },
      { key: 'simPoints', label: 'Points, log spaced', type: 'int', min: 2 }] },
    { legend: 'Plots', fields: [
      { key: 'maxPlots', label: 'Datasets drawn at most', type: 'int', min: 1, hint: 'Larger selections are thinned out evenly for drawing; fits use all of them.' },
      { key: 'nyqEqual', label: 'Same scale on both Nyquist axes', type: 'check' },
      { key: 'resid', label: 'Residuals', type: 'select', options: [['abs', 'Absolute, in the unit of Z'], ['rel', 'Relative, % of |Z|']] },
      { key: 'phase', label: 'Phase unit', type: 'select', options: [['deg', 'Degrees'], ['rad', 'Radians']] }] }
  ];
  function spec(k) { for (var i = 0; i < GROUPS.length; i++) for (var j = 0; j < GROUPS[i].fields.length; j++) if (GROUPS[i].fields[j].key === k) return GROUPS[i].fields[j]; return {}; }

  function renderSettings() {
    $('#settings-form').innerHTML = GROUPS.map(function (g) {
      return '<fieldset><legend>' + g.legend + '</legend><div class="form-grid">' + g.fields.map(function (f) {
        var id = 'set_' + f.key, v = S.settings[f.key], ctl;
        if (f.type === 'select') ctl = '<select id="' + id + '" data-set="' + f.key + '">' + f.options.map(function (o) {
          return '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select>';
        else if (f.type === 'check') ctl = '<input type="checkbox" id="' + id + '" data-set="' + f.key + '"' + (v ? ' checked' : '') + '>';
        else ctl = '<input id="' + id + '" data-set="' + f.key + '" value="' + esc(v) + '" inputmode="decimal" spellcheck="false" autocomplete="off">';
        return '<label for="' + id + '">' + esc(f.label) + '</label><div>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
      }).join('') + '</div></fieldset>';
    }).join('');
  }
  function syncSettings() {
    document.querySelectorAll('[data-set]').forEach(function (e) {
      var v = S.settings[e.getAttribute('data-set')];
      if (e.type === 'checkbox') e.checked = !!v; else if (document.activeElement !== e) e.value = v;
    });
  }
  function onSetting(e) {
    var el = e.target, k = el.getAttribute('data-set');
    if (!k) return;
    var f = spec(k), v;
    if (el.type === 'checkbox') v = el.checked;
    else if (f.type === 'int' || f.type === 'num') {
      v = Y.ui.parseNum(el.value);
      if (f.type === 'int') v = Math.round(v);
      var bad = !isFinite(v) || (f.min != null && v < f.min) || (f.positive && !(v > 0));
      el.classList.toggle('invalid', bad);
      if (bad) { Y.ui.toast(f.label + ': enter a valid number.', 'warn'); return; }
    } else v = el.value;
    Y.state.setSetting(k, v);
    if (k === 'method') renderValues();
  }

  function renderLimits() {
    var host = $('#limits'), prog = S.model.prog;
    if (!prog) { host.innerHTML = '<p class="hint">No circuit yet.</p>'; return; }
    host.innerHTML = '<table class="grid"><thead><tr><th>Parameter</th><th>Min</th><th>Max</th>' +
      '<th title="Global fit: one value for all datasets (ticked) or one value per dataset">Shared in global fit</th></tr></thead><tbody>' +
      prog.params.map(function (pp) {
        var L = S.model.limits[pp.name];
        return '<tr data-name="' + pp.name + '"><td>' + pp.name + ' <small>' + esc(Y.state.unitFor(pp.unit, Y.state.first())) + '</small></td>' +
          '<td><input data-lim="min" value="' + fmtVal(L.min) + '" inputmode="decimal"></td>' +
          '<td><input data-lim="max" value="' + fmtVal(L.max) + '" inputmode="decimal"></td>' +
          '<td><input type="checkbox" data-shared' + (S.model.shared[pp.name] ? ' checked' : '') + '></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function onLimit(e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    var n = tr.getAttribute('data-name');
    if (e.target.hasAttribute('data-shared')) { Y.state.setShared(n, e.target.checked); return; }
    var which = e.target.getAttribute('data-lim');
    if (!which) return;
    var v = Y.ui.parseNum(e.target.value), L = S.model.limits[n];
    var bad = !isFinite(v) || (which === 'min' ? v >= L.max : v <= L.min);
    e.target.classList.toggle('invalid', bad);
    if (bad) { Y.ui.toast('Limits of ' + n + ': min must be below max.', 'warn'); return; }
    Y.state.setLimit(n, which, v);
    Y.ui.toast('Limits of ' + n + ': ' + fmtVal(L.min) + ' to ' + fmtVal(L.max) + '.', 'info');
  }

  function renderElementDefaults() {
    $('#elem-defaults').innerHTML = '<table class="grid"><thead><tr><th>Element</th><th>Parameter</th><th>Start value</th><th>Min</th><th>Max</th><th>Fit</th></tr></thead><tbody>' +
      Y.elementKinds.map(function (k) {
        return Y.elements[k].params.map(function (p, i) {
          var d = Y.paramDefault(k, i);
          return '<tr data-kind="' + k + '" data-i="' + i + '"><td>' + (i ? '' : '<b>' + k + '</b>') + '</td><td>' + p.label + (p.unit ? ' <small>' + esc(p.unit) + '</small>' : '') + '</td>' +
            '<td><input data-ef="def" value="' + fmtVal(d.def) + '"></td><td><input data-ef="min" value="' + fmtVal(d.min) + '"></td>' +
            '<td><input data-ef="max" value="' + fmtVal(d.max) + '"></td><td><input type="checkbox" data-ef="fit"' + (d.fit ? ' checked' : '') + '></td></tr>';
        }).join('');
      }).join('') + '</tbody></table>';
  }
  function onElem(e) {
    var tr = e.target.closest('tr'), f = e.target.getAttribute('data-ef');
    if (!tr || !f) return;
    var k = tr.getAttribute('data-kind'), i = +tr.getAttribute('data-i');
    var ov = Y.elementOverrides[k] = Y.elementOverrides[k] || [];
    ov[i] = ov[i] || {};
    if (f === 'fit') ov[i].fit = e.target.checked;
    else {
      var v = Y.ui.parseNum(e.target.value);
      e.target.classList.toggle('invalid', !isFinite(v));
      if (!isFinite(v)) return;
      ov[i][f] = v;
    }
    Y.state.saveElementOverrides();
    Y.ui.toast('Saved: new ' + k + ' elements start with these values.', 'info');
  }

  function bindTab() {
    $('#settings-form').addEventListener('change', onSetting);
    $('#limits').addEventListener('change', onLimit);
    $('#elem-defaults').addEventListener('change', onElem);
    $('#set-save').addEventListener('click', function () {
      Y.writers.download('yappari_settings.json', JSON.stringify({ format: 'yappari-js-settings', version: 1, settings: S.settings, elements: Y.elementOverrides }, null, 2), 'application/json');
    });
    $('#set-load').addEventListener('click', function () {
      Y.ui.pickFiles({ accept: '.json' }).then(function (fs) {
        if (!fs.length) return;
        return Y.ui.readText(fs[0]).then(function (t) {
          var doc = JSON.parse(t);
          if (!doc || doc.format !== 'yappari-js-settings') throw new Error('this is not a Yappari JS settings file');
          Object.keys(doc.settings || {}).forEach(function (k) { if (k in S.settings) S.settings[k] = doc.settings[k]; });
          Y.state.store('settings', S.settings);
          Y.elementOverrides = doc.elements || {};
          Y.state.saveElementOverrides();
          renderElementDefaults();
          Y.bus.emit('settings', '*');
          Y.ui.toast('Settings loaded from ' + fs[0].name + '.', 'ok');
        });
      }).catch(function (e) { Y.ui.toast('Settings not loaded: ' + e.message, 'err'); });
    });
    $('#set-reset').addEventListener('click', function () {
      Y.ui.confirm('Reset fit, data, simulation and plot settings to their original values?', 'Reset settings').then(function (ok) {
        if (ok) { Y.state.resetSettings(); Y.ui.toast('Settings reset.', 'info'); }
      });
    });
    $('#elem-reset').addEventListener('click', function () {
      Y.elementOverrides = {};
      Y.state.saveElementOverrides();
      renderElementDefaults();
      Y.ui.toast('Element start values and limits reset.', 'info');
    });
  }

  function init() {
    bindList();
    renderSettings();
    renderElementDefaults();
    bindTab();
    Y.bus.on('model', function () { renderList(); renderLimits(); });
    Y.bus.on('selection', renderList);
    Y.bus.on('datasets', renderList);
    Y.bus.on('params', renderValues);
    Y.bus.on('stats', renderValues);
    Y.bus.on('data', renderValues);
    Y.bus.on('settings', syncSettings);
    // values and fit flags are locked while a fit runs: results would overwrite edits made meanwhile
    Y.bus.on('busy', function (b) {
      if (b && editing) { var a = document.activeElement; if (a && a.blur) a.blur(); }
      var on = !!Y.state.first() && !b;
      document.querySelectorAll('#param-list .pv, #param-list .pf').forEach(function (el) { el.disabled = !on; });
    });
    renderList(); renderLimits();
  }

  return { init: init, fmtVal: fmtVal };
})();
