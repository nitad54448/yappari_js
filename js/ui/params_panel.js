/*  Parameters: the list in the side panel (values of the dataset shown, the first selected one or the one browsed to with ← →; edits apply to all
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

  // Global fit mode: a padlock before the fit tick, closed = shared (one value for all datasets), open = local.
  var LOCK_SVG = {
    shared: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    local: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };
  function globalMode() { return !!(Y.app && Y.app.fitMode && Y.app.fitMode() === 'global'); }

  // ---------------------------------------------------------------- side panel list
  function renderList() {
    var host = $('#param-list'), ds = Y.state.first(), prog = S.model.prog, head = $('#param-ds'), more = S.sel.size > 1 ? S.sel.size - 1 : 0;
    head.textContent = ds ? ds.name : '';                  // cut with … when long (style.css); the whole name is in the tooltip
    $('#param-more').textContent = ds && more ? 'and ' + more + ' more' : '';
    head.title = !ds ? '' : more ? ds.name + ' (' + (Y.state.selected().indexOf(ds) + 1) + ' of ' + S.sel.size + ' selected; ← → show the others). Changes apply to all ' + S.sel.size + ' selected datasets.' : ds.name;
    syncStep();
    if (!prog) { host.innerHTML = '<p class="hint">No circuit yet. Build one in the Model tab.</p>'; renderStats(); return; }
    host.innerHTML = prog.params.map(function (pp) {
      var E = Y.elements[pp.kind], dis = ds && !S.busy ? '' : ' disabled';
      return '<div class="prow" data-name="' + pp.name + '"><span class="pn" title="' + esc(E.title + ', ' + pp.label + (pp.unit ? ' /' + pp.unit : '')) + '">' + pp.name + '</span>' +
        '<input class="pv" aria-label="' + pp.name + '" spellcheck="false" autocomplete="off"' + dis + '>' +
        '<span class="pu" title="' + esc(pp.unit) + '">' + esc(pp.unit) + '</span><span class="ps"></span>' +
        '<button type="button" class="pl" aria-label="Shared or local ' + pp.name + '"></button>' +
        '<input class="pf" type="checkbox" title="Fit ' + pp.name + '" aria-label="Fit ' + pp.name + '"' + dis + '></div>';
    }).join('') + (ds ? '' : '<p class="hint">Start values for new datasets. Select a dataset to edit its values.</p>');
    renderValues();
  }

  function renderValues() {
    var ds = Y.state.first(), list = Y.state.selected(), g = globalMode();
    if (!S.model.prog) return;
    $('#param-list').classList.toggle('global', g);
    document.querySelectorAll('#param-list .prow').forEach(function (row) {
      var n = row.getAttribute('data-name'), pp = info(n);
      if (!pp) return;
      var d = Y.paramDefault(pp.kind, pp.pi), v = ds ? ds.p[n] : d.def, fit = ds ? ds.fit[n] : d.fit;
      var inp = row.querySelector('.pv'), pu = row.querySelector('.pu'), uu = Y.state.unitFor(pp.unit, ds);
      if (pu.textContent !== uu) { pu.textContent = uu; pu.title = uu; }
      if (editing !== n) inp.value = fmtVal(v);
      // several selected datasets that disagree on the fit flag: mixed state; a click fits the parameter in all of them
      var nFit = list.filter(function (x) { return x.fit[n]; }).length, mixed = list.length > 1 && nFit > 0 && nFit < list.length;
      var pf = row.querySelector('.pf');
      pf.checked = !!fit && !mixed; pf.indeterminate = mixed;
      pf.title = mixed ? 'Fitted in ' + nFit + ' of ' + list.length + ' selected datasets' + (g ? '; the global fit uses the ticks of ' + ds.name : '') +
        '. Click to fit ' + n + ' in all of them.' : (fit ? 'Fitted' : 'Held fixed') + (list.length > 1 ? ' in all ' + list.length + ' selected datasets' : '') + '. Click to ' + (fit ? 'hold ' + n + ' fixed.' : 'fit ' + n + '.');
      row.classList.toggle('fixed', !fit && !mixed);
      row.classList.toggle('mixed', mixed);
      var pl = row.querySelector('.pl'), sh = !!S.model.shared[n];
      pl.hidden = !g;
      if (g) {
        pl.innerHTML = LOCK_SVG[sh ? 'shared' : 'local'];
        pl.className = 'pl ' + (sh ? 'shared' : 'local');
        pl.title = (sh ? 'Shared: one value of ' + n + ' for all selected datasets in the global fit.' : 'Local: each dataset gets its own value of ' + n + ' in the global fit.') +
          ' Click to make it ' + (sh ? 'local.' : 'shared.');
        pl.disabled = S.busy;
      }
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
      '</dd><dt>Fit</dt><dd title="' + esc(msg) + '">' + (st.global ? 'global, ' : '') + (st.iter != null ? esc(st.iter) + ' it, ' : '') + esc(short) +
      (short === 'converged' ? ' <span class="why">(' + esc(msg.replace(/^converged: /, '')) + ')</span>' : '') + '</dd></dl>';
  }

  // ← → next to the dataset name. Several datasets selected: the panel shows the previous or next of them, in a cycle;
  // the selection is kept, so edits still apply to all of them. One or none selected: the previous or next dataset of
  // the list becomes the selection (without a selection, → starts at the top of the list and ← at the bottom).
  function neighbour(dir) {
    var f = Y.state.first();
    if (S.sel.size > 1) {
      var sl = Y.state.selected(), k = (sl.indexOf(f) + dir + sl.length) % sl.length;
      return { ds: sl[k], k: k, n: sl.length, cycle: true };
    }
    var list = S.datasets, i = f ? list.indexOf(f) : -1, j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    return j >= 0 && j < list.length ? { ds: list[j], k: j, n: list.length } : null;
  }
  function syncStep() {
    [['#param-prev', -1, 'Previous'], ['#param-next', 1, 'Next']].forEach(function (b) {
      var el = $(b[0]), nb = neighbour(b[1]);
      if (nb) el.dataset.tip = b[2] + (nb.cycle ? ' selected dataset: ' : ' dataset: ') + nb.ds.name + ' (' + (nb.k + 1) + ' of ' + nb.n + (nb.cycle ? ' selected; the selection is kept)' : ')');
      Y.ui.able(el, !S.datasets.length ? 'No data loaded yet.' : nb ? '' : b[1] < 0 ? 'This is the first dataset of the list.' : 'This is the last dataset of the list.');
    });
  }
  function stepDataset(dir) {
    var nb = neighbour(dir);
    if (!nb) return;
    if (nb.cycle) { editing = null; Y.state.setFocus(nb.ds.id); } else Y.state.selectIds([nb.ds.id]);
  }

  // Snapshot only real changes, including edits applied to several selected datasets. burst: the change is one step
  // of the mouse wheel or of an arrow key; the steps that follow each other on one parameter (and the same selection)
  // share one restore point and one line of the Log, so undo goes back to before them.
  function changeValue(n, v, burst) {
    var list = Y.state.selected();
    if (!list.some(function (ds) { return ds.p[n] !== v; })) return;
    var merge = burst ? 'step ' + n + ' ' + list.map(function (ds) { return ds.id; }).join(',') : null;
    Y.history.take('parameter ' + n, { merge: merge });
    Y.state.setParam(n, v);
    Y.ui.toast(n + ' set to ' + fmtVal(v) + '.', 'info', merge);
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
    changeValue(n, c);
  }

  function step(n, dir, e) {
    var ds = Y.state.first(), pp = info(n);
    if (!ds || !pp || S.busy) return;
    var v = ds.p[n], big = e.shiftKey, fine = e.altKey || e.ctrlKey;
    if (pp.scale === 'log' && v > 0) v *= Math.pow(big ? 1.1 : fine ? 1.002 : 1.02, dir);
    else v += dir * (big ? 0.05 : fine ? 0.001 : 0.005);
    editing = null;
    changeValue(n, clampVal(n, +v.toPrecision(12)), true);
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
    host.addEventListener('click', function (e) {
      var pl = e.target.closest('.pl');
      if (!pl || S.busy) return;
      var n = pl.closest('.prow').getAttribute('data-name'), sh = !S.model.shared[n];
      Y.state.setShared(n, sh);
      Y.ui.toast(n + (sh ? ' shared: one value for all datasets in the global fit.' : ' local: one value per dataset in the global fit.'), 'info');
    });
    host.addEventListener('change', function (e) {
      if (!e.target.classList.contains('pf')) return;
      var n = e.target.closest('.prow').getAttribute('data-name'), ds = Y.state.first();
      if (S.busy) { e.target.checked = !!(ds && ds.fit[n]); Y.ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
      var on = e.target.checked;
      e.target.indeterminate = false;
      if (!Y.state.selected().some(function (d) { return !!d.fit[n] !== on; })) return;
      Y.history.take('fit flag ' + n);
      Y.state.setFit(n, on);
      Y.ui.toast(n + (on ? ' will be fitted.' : ' held fixed.'), 'info');
    });
  }

  // ---------------------------------------------------------------- Parameters tab
  var GROUPS = [
    { legend: 'Fit', fields: [
      { key: 'method', label: 'Method', type: 'select', options: [['TRDL', 'Trust-region dogleg, bounded'], ['LMB', 'Levenberg–Marquardt, bounded'], ['LM', 'Levenberg–Marquardt, no bounds'], ['NM', 'Nelder–Mead, bounded']] },
      { key: 'weight', label: 'Weight of each point', type: 'select', options: [['mod', '1/|Z|'], ['mod2', '1/|Z|²'], ['unit', '1 (no weighting)']],
        hint: 'χ²w = Σ w·[(Zr − Zr calc)² + (Zi − Zi calc)²]' },
      { key: 'maxIter', label: 'Maximum iterations', type: 'int', min: 1, max: 65535, strict: true, hint: 'Whole number from 1 to 65535 (unsigned 16-bit).' },
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
      { key: 'simPoints', label: 'Points, log spaced', type: 'int', min: 2, max: Y.state.LIMITS.points }] },
    { legend: 'Plots', fields: [
      { key: 'maxPlots', label: 'Datasets drawn at most', type: 'int', min: 1, hint: 'Larger selections are thinned out evenly for drawing; fits use all of them.' },
      { key: 'nyqEqual', label: 'Same scale on both Nyquist axes', type: 'check' },
      { key: 'nyqSquare', label: 'Square Nyquist plot', type: 'check', hint: 'Square frame and saved image, also in the Nyquist toolbar. With the same scale on both axes, both axes span the same range.' },
      { key: 'resid', label: 'Residuals', type: 'select', options: [['abs', 'Absolute, in the unit of Z'], ['rel', 'Relative, % of |Z|']] },
      { key: 'phase', label: 'Phase unit', type: 'select', options: [['deg', 'Degrees'], ['rad', 'Radians']] }] }
  ];
  // what a numeric field accepts, for the message shown when a value is refused
  function rangeText(f) {
    if (f.type === 'int') return 'enter a whole number' + (f.min != null && f.max != null ? ' from ' + f.min + ' to ' + f.max : f.min != null ? ' of at least ' + f.min : '');
    return f.positive ? 'enter a positive number' : 'enter a valid number';
  }
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
      if (e.type === 'checkbox') e.checked = !!v;
      else if (document.activeElement !== e) {
        e.value = v;
        e.classList.remove('invalid');
        e.removeAttribute('aria-invalid');
      }
    });
  }
  function onSetting(e) {
    var el = e.target, k = el.getAttribute('data-set');
    if (!k) return;
    var f = spec(k), v;
    if (el.type === 'checkbox') v = el.checked;
    else if (f.type === 'int' || f.type === 'num') {
      v = Y.ui.parseNum(el.value);
      if (f.type === 'int' && !f.strict) v = Math.round(v);
      var bad = !isFinite(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max) || (f.strict && !Number.isInteger(v)) || (f.positive && !(v > 0));
      el.classList.toggle('invalid', bad);
      if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      if (bad) { Y.ui.toast(f.label + ': ' + rangeText(f) + '.', 'warn'); return; }
    } else v = el.value;
    if (f.type === 'int' || f.type === 'num') el.value = v;
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
  // start value, min and max must fit together (min < max, min <= start value <= max); otherwise nothing is saved
  function onElem(e) {
    var tr = e.target.closest('tr'), f = e.target.getAttribute('data-ef');
    if (!tr || !f) return;
    var k = tr.getAttribute('data-kind'), i = +tr.getAttribute('data-i');
    var next = Object.assign({}, (Y.elementOverrides[k] || [])[i] || {});
    if (f === 'fit') next.fit = e.target.checked;
    else {
      next[f] = Y.ui.parseNum(e.target.value);
      var why = isFinite(next[f]) ? Y.state.elementDefaultProblem(k, i, next) : 'not a number';
      e.target.classList.toggle('invalid', !!why);
      if (why) { Y.ui.toast('Start values of ' + k + (Y.elements[k].params.length > 1 ? ' ' + Y.elements[k].params[i].label : '') + ': ' + why + '. Not saved.', 'warn'); return; }
    }
    var ov = Y.elementOverrides[k] = Y.elementOverrides[k] || [];
    ov[i] = next;
    tr.querySelectorAll('[data-ef]').forEach(function (x) { x.classList.remove('invalid'); });
    Y.state.saveElementOverrides();
    Y.ui.toast('Saved: new ' + k + ' elements start with these values.', 'info');
  }

  function bindTab() {
    $('#settings-form').addEventListener('change', onSetting);
    $('#sp-fit').addEventListener('change', onSetting);
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
          var st = Y.state.cleanSettings(doc.settings, S.settings);             // values of the wrong type are ignored
          Object.keys(st).forEach(function (k) { S.settings[k] = st[k]; });
          Y.state.store('settings', S.settings);
          Y.elementOverrides = Y.state.cleanElementOverrides(doc.elements);   // values that do not fit together are dropped
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
    $('#param-prev').addEventListener('click', function () { stepDataset(-1); });
    $('#param-next').addEventListener('click', function () { stepDataset(1); });
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
    Y.bus.on('fitmode', renderValues);
    Y.bus.on('shared', function () { renderValues(); renderLimits(); });
    // values and fit flags are locked while a fit runs: results would overwrite edits made meanwhile
    Y.bus.on('busy', function (b) {
      if (b && editing) { var a = document.activeElement; if (a && a.blur) a.blur(); }
      var on = !!Y.state.first() && !b;
      document.querySelectorAll('#param-list .pv, #param-list .pf').forEach(function (el) { el.disabled = !on; });
      document.querySelectorAll('#param-list .pl').forEach(function (el) { el.disabled = !!b; });
    });
    renderList(); renderLimits();
  }

  return { init: init, fmtVal: fmtVal };
})();
