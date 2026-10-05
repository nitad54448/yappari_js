/*  Commands behind the File / Data / Analysis menus, the Fit buttons and the command line. */
Y.cmd = (function () {
  'use strict';
  var S = Y.state.S, ui = Y.ui, running = null;

  function fmt(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return a >= 1e-3 && a < 1e5 ? String(+v.toPrecision(4)) : v.toExponential(2);
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function need(ok, msg) { if (!ok) ui.toast(msg, 'warn'); return !!ok; }
  function haveModel() { return need(S.model.prog, 'Build a circuit first, in the Model tab.'); }
  function haveSel(n) { n = n || 1; return need(S.sel.size >= n, n > 1 ? 'Select at least ' + n + ' datasets.' : 'Select one or more datasets first.'); }
  function idle() { return need(!S.busy, 'A fit is running. Wait for it to finish or press Stop.'); }
  function sel() { return Y.state.selected(); }
  function changed(list) { list.forEach(function (ds) { ds.stats = null; Y.state.invalidate(ds); }); Y.bus.emit('data'); }

  // ---------------------------------------------------------------- reading files
  var READ = {
    three: function (t, n) { return Y.readers.threeColumns(t, n, S.settings.sep); },
    table: function (t, n) { return Y.readers.headerTable(t, n); },
    gamry: function (t, n) { return Y.readers.gamryDTA(t, n); },
    biologic: function (t, n) { return Y.readers.biologicMPT(t, n); },
    zview: function (t, n) { return Y.readers.zview(t, n); },
    versa: function (t, n) { return Y.readers.versa(t, n); },
    mfli: function (t, n) { return Y.readers.mfliCsv(t, n); },
    auto: function (t, n) { return Y.readers.auto(t, n, S.settings.sep); }
  };

  function listNames(list) {
    var s = list.slice(0, 3).map(function (d) { return d.name; }).join(', ');
    return list.length > 3 ? s + ' …' : s;
  }

  // kind: three | table | zview | versa | custom (with def) | project | auto (files dropped on the window).
  // With auto, a definition file (.xml, .ini, .json) dropped together with data files is used to read them.
  async function readFiles(files, kind, def) {
    if (!idle()) return;
    var items = [];
    for (var i = 0; i < files.length; i++) {
      try { items.push({ name: files[i].name, text: await ui.readText(files[i]) }); }
      catch (e) { ui.toast(files[i].name + ': ' + e.message, 'err'); }
    }
    if (kind === 'project') {
      if (items.length) { try { await openProject(items[0].text); } catch (e) { ui.toast(items[0].name + ': ' + e.message, 'err'); } }
      return;
    }
    if (kind === 'auto') {
      var data = [];
      for (var k = 0; k < items.length; k++) {
        var it = items[k], head = it.text.slice(0, 400);
        if (/^\s*\{/.test(head) && /yappari-js-project/.test(head)) {
          try { await openProject(it.text); } catch (e) { ui.toast(it.name + ': ' + e.message, 'err'); }
          continue;
        }
        if (/\.(xml|ini|json)$/i.test(it.name)) {
          try { def = Y.readers.parseDefinition(it.text); Y.state.store('customdef', def); }
          catch (e) { ui.toast(it.name + ': ' + e.message, 'err'); }
          continue;
        }
        data.push(it);
      }
      if (def) {
        kind = 'custom';
        if (!data.length) { ui.toast('Definition read, header "' + def.header + '". Drop it together with the data files, or use File, Custom format.', 'info'); return; }
      }
      items = data;
    }
    var all = [], nFiles = 0, skipped = [], warnings = [];
    items.forEach(function (it) {
      try {
        var got = kind === 'custom' ? Y.readers.custom(it.text, it.name, def) : READ[kind](it.text, it.name);
        if (got.skipped) skipped.push(it.name + ' (' + got.skipped + ')');
        if (got.warning) warnings.push(got.warning);
        all = all.concat(got);
        nFiles++;
      } catch (e) { ui.toast(e.message, 'err'); }
    });
    if (all.length) {
      snapshot('reading ' + plural(nFiles, 'file'));
      Y.state.addDatasets(all);
      var pts = all.reduce(function (a, d) { return a + d.f.length; }, 0);
      ui.toast('Read ' + plural(all.length, 'dataset') + ' (' + pts + ' points) from ' + plural(nFiles, 'file') + ': ' + listNames(all) + '.', 'ok');
    }
    if (skipped.length) ui.toast('Incomplete rows (a missing or non-numeric value) were skipped: ' + skipped.join(', ') + '.', 'warn');
    warnings.forEach(function (w) { ui.toast(w, 'warn'); });
  }

  async function read(kind) {
    var files = await ui.pickFiles({ multiple: kind !== 'project', accept: kind === 'project' ? '.json,application/json' : '' });
    if (files.length) await readFiles(files, kind);
  }

  async function openProject(text) {
    if (!idle()) return;
    var doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error('The project file is not valid JSON.'); }
    var pj = Y.state.prepareProject(doc);                 // throws on a bad file; nothing has changed yet
    if (S.datasets.length && !(await ui.confirm('Opening a project replaces the circuit and the ' + plural(S.datasets.length, 'dataset') + ' in memory.', 'Open project', false, 'Open project'))) return;
    snapshot('opening a project', { settings: true });
    Y.state.commitProject(pj);
    ui.logLoad(pj.log, 'Log saved with the project, ' + plural(pj.log.length, 'line') + ' (newest first):');
    ui.toast('Opened a project with ' + plural(S.datasets.length, 'dataset') + (S.model.cdc ? ' and the circuit ' + S.model.cdc : '') + '.', 'ok');
  }

  // Native XML version 1. Keep every supported setting visible and round-trippable.
  var DEF_FIELDS = [
    { key: 'reader', label: 'File layout', type: 'select', options: [['table', 'Custom table'], ['mfliCsv', 'MFLI CSV (LabOne)'], ['zview', 'MFLI ZView / ZView'], ['yappariJS', 'Yappari JS Save data']] },
    { key: 'data_source', label: 'Impedance to load', type: 'select', options: [['auto', 'Measured if present, otherwise model'], ['measured', 'Measured Zr, Zi'], ['model', 'Model Zr, Zi']] },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'mode', label: 'Dataset separation', type: 'select', options: [['repeatedHeader', 'Repeated header'], ['single', 'One dataset per file'], ['blankLines', 'Blank lines']] },
    { key: 'header', label: 'Header text', type: 'text', hint: 'Literal text; spaces are significant. Used in repeated-header mode.' },
    { key: 'header_match', label: 'Header matching', type: 'select', options: [['contains', 'Contains'], ['startsWith', 'Starts with'], ['exact', 'Exact line']] },
    { key: 'label_source', label: 'Dataset label', type: 'select', options: [['afterHeader', 'Text after header'], ['index', 'Dataset number']] },
    { key: 'label_length', label: 'Label length', type: 'number', hint: '0 keeps the full text after the header; otherwise maximum character count.' },
    { key: 'end_marker', label: 'End marker', type: 'text', hint: 'Optional literal text ending a dataset. The marker line is excluded.' },
    { key: 'ignore_first', label: 'Skip first lines', type: 'number', hint: 'Per dataset, after its header; from the beginning in single/blank-line mode.' },
    { key: 'ignore_last', label: 'Skip last lines', type: 'number' },
    { key: 'footer_policy', label: 'Footer policy', type: 'select', options: [['keepNumeric', 'Keep trailing lines if all are valid data'], ['always', 'Always skip the specified lines']] },
    { key: 'separator', label: 'Delimiter', type: 'select', options: [['auto', 'Detect automatically'], ['tab', 'TAB'], ['space', 'Whitespace'], ['comma', 'Comma'], ['semicolon', 'Semicolon']] },
    { key: 'decimal_separator', label: 'Decimal separator', type: 'select', options: [['auto', 'Automatic'], ['.', 'Point'], [',', 'Comma']] },
    { key: 'comment_prefix', label: 'Comment prefix', type: 'text', hint: 'Optional prefix for whole comment lines, e.g. #.' },
    { key: 'missing_values', label: 'Missing values', type: 'text', hint: 'Semicolon-separated markers, e.g. NA;NaN;N/A. Empty fields are always missing.' },
    { key: 'representation', label: 'Impedance representation', type: 'select', options: [['cartesian', 'Real and imaginary'], ['polar', 'Magnitude and phase']] },
    { key: 'column_freq', label: 'Frequency column', type: 'number', hint: 'All column numbers start at 1.' },
    { key: 'column_zr', label: 'Real / magnitude column', type: 'number' },
    { key: 'column_zi', label: 'Imaginary / phase column', type: 'number' },
    { key: 'frequency_unit', label: 'Frequency unit', type: 'select', options: [['Hz', 'Hz'], ['kHz', 'kHz'], ['MHz', 'MHz'], ['rad/s', 'rad/s']] },
    { key: 'impedance_unit', label: 'Impedance unit', type: 'select', options: [['ohm', 'Ω'], ['kohm', 'kΩ'], ['Mohm', 'MΩ'], ['mohm', 'mΩ']] },
    { key: 'phase_unit', label: 'Phase unit (polar)', type: 'select', options: [['deg', 'Degrees'], ['rad', 'Radians']] },
    { key: 'negate_zi', label: 'Imaginary column contains −Zi', type: 'checkbox', hint: 'Cartesian only. Convert the stored −Zi to Zi.' },
    { key: 'invalid_rows', label: 'Invalid data rows', type: 'select', options: [['skipAndReport', 'Skip and report'], ['error', 'Stop with an error']] }
  ];

  function customDialog() {
    if (!idle()) return;
    var def, chosen = null, request = 0, busy = false;
    try { def = Y.readers.upgradeDefinition(Y.state.load('customdef') || Object.assign({}, Y.readers.modernDefaults, { mode: 'single' })); }
    catch (e) { def = Object.assign({}, Y.readers.modernDefaults, { mode: 'single' }); }
    var body = document.createElement('div');
    body.innerHTML = '<p class="intro">XML definitions (versions 1 and 2). Presets are listed in config/definitions/index.json. Select a preset, load an XML file, or edit the settings below.</p>' +
      '<div class="form-grid"><label for="f_preset">Preset</label><div><select id="f_preset" disabled><option value="">Loading presets…</option></select><small id="preset-status" role="status"></small></div>' +
      DEF_FIELDS.map(function (f) { return ui.fieldHTML(Object.assign({}, f, { value: def[f.key] })); }).join('') + '</div>' +
      '<div id="definition-preview" role="status" style="margin-top:1em;white-space:pre-wrap"></div>';
    var select = body.querySelector('#f_preset'), status = body.querySelector('#preset-status'), preview = body.querySelector('#definition-preview');
    function setBusy(value) { busy = value; body.querySelectorAll('[data-key]').forEach(function (e) { e.disabled = value; }); }
    function showLayout() {
      var kind = body.querySelector('[data-key="reader"]').value;
      DEF_FIELDS.forEach(function (f) {
        var visible = f.key === 'reader' || f.key === 'description' || (f.key === 'data_source' ? kind === 'yappariJS' : kind === 'table');
        var e = body.querySelector('[data-key="' + f.key + '"]');
        e.parentElement.hidden = !visible;
        body.querySelector('label[for="f_' + f.key + '"]').hidden = !visible;
      });
    }
    function fill(d) {
      DEF_FIELDS.forEach(function (f) {
        var e = body.querySelector('[data-key="' + f.key + '"]');
        if (f.type === 'checkbox') e.checked = d[f.key] || false; else e.value = d[f.key] == null ? Y.readers.modernDefaults[f.key] : d[f.key];
        e.classList.remove('invalid');
      });
      showLayout(); preview.textContent = '';
    }
    function grab() {
      if (busy) { ui.toast('Wait for the definition to finish loading.', 'info'); return null; }
      var v = ui.collect(body, DEF_FIELDS); if (!v) return null;
      try { return Y.readers.normalizeModern(Object.assign(v, { format_version: 2 })); }
      catch (e) { ui.toast(e.message, 'warn'); return null; }
    }
    async function getText(url) {
      var response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
      return response.text();
    }
    async function loadIndex() {
      try {
        var index = JSON.parse(await getText('config/definitions/index.json'));
        if (!index || !Array.isArray(index.definitions)) throw new Error('index.json must contain a definitions array.');
        var names = index.definitions;
        if (names.some(function (n) { return typeof n !== 'string' || !/^[^/\\\x00-\x1f]+\.xml$/i.test(n) || n.indexOf('..') >= 0; })) throw new Error('Use XML filenames only, without directory paths.');
        names = Array.from(new Set(names)).sort(function (a, b) { return a.localeCompare(b); });
        select.innerHTML = '<option value="">None — manual settings</option>';
        names.forEach(function (name) { var o = document.createElement('option'); o.value = name; o.textContent = name; select.appendChild(o); });
        select.disabled = false;
        status.textContent = names.length ? names.length + ' XML definitions available.' : 'No definitions listed. Load a file or enter settings.';
      } catch (e) {
        select.innerHTML = '<option value="">Presets unavailable</option>';
        status.textContent = 'Could not load config/definitions/index.json: ' + e.message + '. Use Load definition or manual settings. Serve the app over HTTP(S).';
      }
    }
    select.addEventListener('change', async function () {
      var id = ++request, name = select.value;
      if (!name) { setBusy(false); return; }
      setBusy(true); status.textContent = 'Loading ' + name + '…';
      try {
        var d = Y.readers.upgradeDefinition(Y.readers.parseDefinition(await getText('config/definitions/' + encodeURIComponent(name))));
        if (id !== request) return;
        fill(d); status.textContent = name + ' loaded.';
      } catch (e) {
        if (id !== request) return;
        select.value = ''; status.textContent = 'Could not load ' + name + ': ' + e.message + '. Previous settings retained.';
      } finally { if (id === request) setBusy(false); }
    });
    body.addEventListener('input', function (e) {
      if (e.target.hasAttribute('data-key')) { select.value = ''; status.textContent = 'Manual settings (edited).'; preview.textContent = ''; }
    });
    showLayout();
    body.addEventListener('change', showLayout);
    loadIndex();
    return ui.modal({
      title: 'Custom format, xml', body: body, wide: true,
      onOpen: function () { body.closest('dialog').classList.add('custom-format-dialog'); },
      buttons: [
        { label: 'Load definition…', left: true, close: false, onClick: function () {
          ui.pickFiles({ accept: '.xml,.ini,.json' }).then(async function (fs) {
            if (!fs.length) return;
            var id = ++request; setBusy(true);
            try {
              var d = Y.readers.upgradeDefinition(Y.readers.parseDefinition(await ui.readText(fs[0])));
              if (id !== request) return;
              fill(d); select.value = ''; status.textContent = fs[0].name + ' loaded.';
            } finally { if (id === request) setBusy(false); }
          }).catch(function (e) { ui.toast('Not a usable definition: ' + e.message, 'err'); });
        } },
        { label: 'Save definition…', left: true, close: false, onClick: function () {
          var v = grab(); if (!v) return;
          var name = select.value || 'custom_' + ((v.description || v.header).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'definition') + '.xml';
          Y.writers.download(name, Y.writers.definitionXML(v), 'application/xml');
          ui.toast('Downloaded ' + name + '. To make it a preset, place it in config/definitions/ and add its filename to index.json.', 'ok');
        } },
        { label: 'Preview data…', close: false, onClick: function () {
          var v = grab(); if (!v) return;
          ui.pickFiles({ multiple: false }).then(async function (fs) {
            if (!fs.length) return;
            var got = Y.readers.custom(await ui.readText(fs[0]), fs[0].name, v);
            preview.textContent = got.length + ' dataset(s), ' + got.reduce(function (n, d) { return n + d.f.length; }, 0) + ' points, ' + (got.skipped || 0) + ' invalid row(s) skipped.\n' +
              got.slice(0, 5).map(function (d) { return d.name + ': ' + d.f.length + ' points; first point: f=' + d.f[0] + ' Hz, Zr=' + d.zr[0] + ' Ω, Zi=' + d.zi[0] + ' Ω'; }).join('\n') + (got.warning ? '\n' + got.warning : '');
          }).catch(function (e) { preview.textContent = e.message; });
        } },
        { label: 'Cancel', value: null },
        { label: 'Choose data files…', primary: true, onClick: function () { chosen = grab(); return !!chosen; }, value: function () { return chosen; } }
      ]
    }).then(function (v) {
      ++request;
      if (!v) return;
      Y.state.store('customdef', v);
      return ui.pickFiles({ multiple: true }).then(function (fs) { if (fs.length) return readFiles(fs, 'custom', v); });
    });
  }

  // ---------------------------------------------------------------- fitting
  async function fitSelected() {
    if (!idle() || !haveModel() || !haveSel()) return;
    var list = sel(), names = Y.state.names();
    if (!list.some(function (ds) { return names.some(function (n) { return ds.fit[n]; }); })) {
      ui.toast('Tick "fit" next to at least one parameter.', 'warn'); return;
    }
    var b = Y.state.bounds(), cdc = S.model.cdc, jobs = list.map(function (ds) { return Y.state.jobFor(ds, b); });
    var nSig = jobs.filter(function (j) { return j.sr; }).length;
    snapshot('fit of ' + plural(list.length, 'dataset'));
    var t0 = performance.now(), last = 0, nOk = 0, nMax = 0, nStall = 0, nOther = 0, nBad = 0, results, job = null;
    Y.state.setBusy(true);
    ui.progress(0, jobs.length);
    try {
      running = job = Y.pool.fitMany(jobs, function (r, ji) {
        if (S.model.cdc !== cdc) return;
        var ds = Y.state.byId(r.id);
        if (!ds) return;
        var meta = Y.state.jobMeta(jobs[ji]);
        if (jobs[ji].sr) { meta.weight = 'sigma'; meta.sigma = jobs[ji].sigma; }
        if (r.p) Y.state.applyResult(ds, r, meta); else ds.stats = { ok: false, msg: r.msg };
        if (!r.ok) nBad++; else if (/iteration limit/.test(r.msg)) nMax++; else if (/^stopped/.test(r.msg)) nStall++;
        else if (Y.fit.status(r.msg) === 'warn') nOther++; else nOk++;
        var now = performance.now();
        if (now - last > 300) { last = now; Y.bus.emit('stats'); }
      }, function (done, total) { ui.progress(done, total); });
      syncButtons();                                     // Stop can stop it now
      results = await running.promise;
    } finally {
      running = null;
      Y.state.setBusy(false);
      ui.progress(0, 0);
      Y.bus.emit('stats');
    }
    var n = results.filter(Boolean).length, dt = ((performance.now() - t0) / 1000).toFixed(2), stopped = job.stopped();
    if (list.length === 1 && results[0] && results[0].ok) {
      var r = results[0];
      ui.toast('Fit of ' + list[0].name + ': χ²red ' + fmt(r.chi2red) + ', R² ' + (Number.isFinite(r.r2) ? r.r2.toFixed(6) : '—') + ', ' +
        r.iter + ' iterations, ' + r.msg + (nSig ? ', weights 1/σ² (' + jobs[0].sigma + ')' : '') + '.', Y.fit.status(r.msg));
    } else {
      ui.toast((stopped ? 'Stopped. ' : '') + 'Fitted ' + n + ' of ' + plural(list.length, 'dataset') + ' in ' + dt + ' s: ' + nOk + ' converged' +
        (nMax ? ', ' + nMax + ' stopped at the iteration limit' : '') + (nStall ? ', ' + nStall + ' stalled before a minimum' : '') +
        (nOther ? ', ' + nOther + ' ended otherwise (singular system, or all fitted parameters at their limits)' : '') +
        (nBad ? ', ' + nBad + ' failed' : '') +
        (S.settings.useSigma ? '; measured σ used for ' + nSig + ' of them' : '') + '.' +
        (stopped && n < list.length ? ' The ' + (list.length - n) + ' not fitted keep their values.' : ''), stopped || nBad || nMax || nStall || nOther ? 'warn' : 'ok');
    }
  }

  function stop() {
    if (!running) return;
    if (running.global) {
      if (!running.cancel()) ui.toast('This global fit runs on the main thread and cannot be stopped.', 'warn');
    } else running.cancel();                           // fitSelected reports what was fitted before the stop
  }

  async function globalFit() {
    if (!idle() || !haveModel() || !haveSel(2)) return;
    var list = sel(), first = list[0], names = Y.state.names(), b = Y.state.bounds();
    var fit = Uint8Array.from(names, function (n) { return first.fit[n] ? 1 : 0; });
    var shared = Uint8Array.from(names, function (n) { return S.model.shared[n] ? 1 : 0; });
    if (!fit.some(function (v) { return v; })) { ui.toast('Tick "fit" next to at least one parameter of ' + first.name + '.', 'warn'); return; }
    var job = { cdc: S.model.cdc, fit: fit, shared: shared, lo: b.lo, hi: b.hi, weight: S.settings.weight,
                method: S.settings.method === 'LM' ? 'LM' : 'LMB', maxIter: S.settings.maxIter, tol: S.settings.tol,
                sets: list.map(function (ds) { return Object.assign({ id: ds.id, p: Y.state.vector(ds) }, Y.state.unmasked(ds)); }) };
    snapshot('global fit');
    Y.state.setBusy(true);
    ui.progress(0, -1);
    ui.toast('Global fit of ' + plural(list.length, 'dataset') + ' running…', 'info');
    var res;
    try {
      running = Y.pool.globalFit(job);
      syncButtons();
      res = await running.promise;
    } finally {
      running = null;
      Y.state.setBusy(false);
      ui.progress(0, 0);
    }
    if (res.cancelled) { ui.toast('Global fit stopped; the parameters are unchanged.', 'info'); return; }
    if (!res.ok) { ui.toast('Global fit failed: ' + res.msg, 'err'); return; }
    res.sets.forEach(function (r) {
      var ds = Y.state.byId(r.id);
      if (!ds) return;
      names.forEach(function (n, j) { ds.fit[n] = !!job.fit[j]; });   // the flags that were fitted, not later edits
      var set = job.sets.filter(function (x) { return x.id === r.id; })[0];
      var meta = Object.assign(Y.state.jobMeta(job), { global: true, globalChi2red: res.chi2red });
      if (set && set.sr) { meta.weight = 'sigma'; meta.sigma = set.sigma; }
      Y.state.applyResult(ds, Object.assign({ iter: res.iter, msg: res.msg, ok: true }, r), meta);
    });
    Y.bus.emit('stats'); Y.bus.emit('params', {});
    ui.toast('Global fit of ' + plural(list.length, 'dataset') + ': ' + res.nShared + ' shared and ' + res.nLocal + ' local parameters, χ²red ' +
      fmt(res.chi2red) + ', ' + res.iter + ' iterations, ' + res.msg + '. Fit flags of ' + first.name + ' used for all.', Y.fit.status(res.msg));
  }

  function cloneTo(all) {
    if (!idle() || !haveModel() || !haveSel()) return;
    var from = Y.state.first(), targets = all ? S.datasets.slice() : sel();
    snapshot('clone parameters');
    Y.state.copyParams(from, targets);
    ui.toast('Copied the parameters of ' + from.name + ' to ' + plural(targets.length - 1, 'other dataset') + '.', 'ok');
  }

  // ---------------------------------------------------------------- points and datasets
  async function inView(remove) {
    if (!idle() || !haveSel()) return;
    var vf = Y.plots.viewFor(Y.app.tab());                 // the plot on screen, not one left zoomed in another tab
    if (!vf) { ui.toast('Open the Nyquist, Zr, Zi or |Z|, θ plot, zoom on the points, then run this again.', 'warn'); return; }
    // mask: the unmasked points in view; delete: every point in view, masked or not
    var list = sel(), flags = list.map(function (ds) { return Y.dataops.inView(ds, vf.kind, vf.v, remove); });
    var total = flags.reduce(function (a, f) { return a + f.count; }, 0), nMasked = 0;
    var visible = list.reduce(function (a, ds) { var c = 0; for (var k = 0; k < ds.mask.length; k++) if (remove || !ds.mask[k]) c++; return a + c; }, 0);
    list.forEach(function (ds, i) { for (var k = 0; k < ds.mask.length; k++) if (flags[i][k] && ds.mask[k]) nMasked++; });
    if (!total) { ui.toast('No points of the selected datasets are inside the current view.', 'warn'); return; }
    if (total === visible && !(await ui.confirm('All ' + total + (remove ? ' points' : ' unmasked points') + ' are inside the view. Zoom on the points to ' + (remove ? 'delete' : 'mask') + ' first, or continue to ' + (remove ? 'delete' : 'mask') + ' them all.', 'Continue', true, 'Every point is in view'))) return;
    if (remove) {
      if (!(await ui.confirm('Delete ' + plural(total, 'point') + (nMasked ? ' (' + nMasked + ' of them masked)' : '') + ' from ' + plural(list.length, 'dataset') + '? Deleted points cannot be restored; masked points can.', 'Delete points', true, 'Delete points'))) return;
      snapshot('delete points');
      list.forEach(function (ds, i) { Y.dataops.removePoints(ds, flags[i]); });
    } else { snapshot('mask'); list.forEach(function (ds, i) { for (var k = 0; k < ds.mask.length; k++) if (flags[i][k]) ds.mask[k] = 1; }); }
    changed(list);
    ui.toast((remove ? 'Deleted ' : 'Masked ') + plural(total, 'point') + ' in ' + plural(list.length, 'dataset') + '.', 'ok');
  }

  function unmask() {
    if (!idle() || !haveSel()) return;
    var list = sel(), n = 0;
    snapshot('unmask');
    list.forEach(function (ds) { for (var k = 0; k < ds.mask.length; k++) { n += ds.mask[k]; ds.mask[k] = 0; } });
    changed(list);
    ui.toast(n ? 'Unmasked ' + plural(n, 'point') + '.' : 'No masked points in the selected datasets.', 'info');
  }

  async function deleteDatasets() {
    if (!idle() || !haveSel()) return;
    var n = S.sel.size;
    if (!(await ui.confirm('Delete ' + plural(n, 'selected dataset') + '? This cannot be undone.', 'Delete', true, 'Delete datasets'))) return;
    snapshot('delete datasets');
    Y.state.removeDatasets(Array.from(S.sel));
    ui.toast('Deleted ' + plural(n, 'dataset') + '.', 'info');
  }

  // Normalization of Z, per dataset: none, a correction factor, electrode area (Ω·cm²) or resistivity (Ω·cm)
  async function correction() {
    if (!idle() || !haveSel()) return;
    var list = sel(), n0 = list[0].norm || { type: 'none' };
    var v = await ui.prompt('Normalize the impedance', [
      { key: 'type', label: 'Normalization', type: 'select', value: n0.type,
        options: [['none', 'None: as measured (Ω)'], ['factor', 'Correction factor (unit unchanged)'], ['area', 'Electrode area: Z × A (Ω·cm²)'], ['resist', 'Resistivity: Z × A / L (Ω·cm)']] },
      { key: 'k', label: 'Factor k', type: 'number', value: n0.type === 'factor' ? n0.k : 1, when: 'type:factor', hint: 'Z = measured Z × k' },
      { key: 'A', label: 'Electrode area A /cm²', type: 'number', value: n0.A || 1, when: 'type:area,resist' },
      { key: 'L', label: 'Thickness L /cm', type: 'number', value: n0.L || 0.1, when: 'type:resist', hint: 'Sample thickness between the electrodes' }],
      'Apply', 'For the ' + plural(list.length, 'selected dataset') + '. An earlier normalization is undone first, and the parameters are converted so the fit still matches: R in Ω·cm², C and Q per cm², and so on.');
    if (!v) return;
    var norm = v.type === 'none' ? null : v.type === 'factor' ? { type: 'factor', k: v.k } :
      v.type === 'area' ? { type: 'area', k: v.A, A: v.A } : { type: 'resist', k: v.A / v.L, A: v.A, L: v.L };
    if (norm && !(norm.k > 0 && isFinite(norm.k))) { ui.toast('The factor, the area and the thickness must be positive.', 'err'); return; }
    snapshot('normalization');
    list.forEach(function (ds) { Y.state.normalize(ds, norm); });
    Y.bus.emit('data'); Y.bus.emit('params', {}); Y.bus.emit('stats');
    var out = list.filter(function (ds) { return ds.stats && ds.stats.chi2w != null && Object.keys(ds.p).some(function (n) {
      var L = S.model.limits[n]; return L && (ds.p[n] < L.min || ds.p[n] > L.max); }); }).length;
    ui.toast((norm ? 'Normalized ' : 'Back to the measured values for ') + plural(list.length, 'dataset') + (norm ? ': ' + Y.state.normText(norm) : '') + '.' +
      (out ? ' Some parameters are now outside their limits (Settings).' : ''), out ? 'warn' : 'ok');
  }

  function simulate() {
    if (!idle() || !haveModel()) return;
    var st = S.settings, f = Y.dataops.logspace(st.simStart, st.simEnd, Math.min(Y.state.LIMITS.points, Math.max(2, st.simPoints | 0))), src = Y.state.first();
    var pv = src ? Y.state.vector(src) : Float64Array.from(S.model.prog.params, function (pp) { return Y.paramDefault(pp.kind, pp.pi).def; });
    var z = Y.circuit.impedance(S.model.prog, f, pv);
    snapshot('simulate');
    S.simCount++;
    Y.state.addDatasets([{ name: 'sim_' + S.simCount, f: f, zr: z.re, zi: z.im,
                           p: src ? Object.assign({}, src.p) : undefined, fit: src ? Object.assign({}, src.fit) : undefined, norm: src ? src.norm : null }]);
    ui.toast('Simulated sim_' + S.simCount + ': ' + f.length + ' points from ' + Y.plots.fmtF(st.simStart) + ' to ' + Y.plots.fmtF(st.simEnd) +
      (src ? ', parameters of ' + src.name : ', default parameters') + '.', 'ok');
  }

  // ---------------------------------------------------------------- data operations
  function applyNoise(pct, target) {
    if (!idle() || !haveSel()) return;
    if (target === 'f' && !(Math.abs(pct) < 100)) { ui.toast('Noise on the frequencies must stay below 100 %, so that they remain positive.', 'warn'); return; }
    var list = sel();
    snapshot('noise');
    list.forEach(function (ds) { Y.dataops.addNoise(ds, pct, target); });
    changed(list);
    ui.toast('Added noise up to ±' + pct + ' % of |Z| (' + { z: 'Zr and Zi', zr: 'Zr', zi: 'Zi', f: 'frequency' }[target] + ') to ' + plural(list.length, 'dataset') + '.', 'ok');
  }
  async function noise() {
    if (!haveSel()) return;
    var v = await ui.prompt('Add random noise', [
      { key: 'pct', label: 'Amplitude, % of |Z|', type: 'number', value: 1 },
      { key: 'target', label: 'Applied to', type: 'select', value: 'z', options: [['z', 'Zr and Zi'], ['zr', 'Zr only'], ['zi', 'Zi only'], ['f', 'Frequency (tests)']] }
    ], 'Add noise', 'Uniform noise, changes the selected datasets in place.');
    if (v) applyNoise(v.pct, v.target);
  }
  function negateZi() {
    if (!idle() || !haveSel()) return;
    var list = sel();
    snapshot('negate Zi');
    list.forEach(Y.dataops.negateZi);
    changed(list);
    ui.toast('Changed the sign of Zi in ' + plural(list.length, 'dataset') + '.', 'ok');
  }
  function derive(prefix, fn, label) {
    if (!idle() || !haveSel()) return;
    var out = [];
    try {
      sel().forEach(function (ds) {
        var r = fn(ds);
        out.push({ name: prefix + ds.name, f: r.f, zr: r.zr, zi: r.zi, p: Object.assign({}, ds.p), fit: Object.assign({}, ds.fit), norm: ds.norm });
      });
    } catch (e) { ui.toast(e.message, 'err'); return; }
    snapshot(label);
    Y.state.addDatasets(out, { selectAll: true });
    ui.toast(label + ': ' + plural(out.length, 'new dataset') + ' named ' + prefix + '…', 'ok');
  }
  // a spline gets 3 to LIMITS.points frequencies; smoothing 1 to 1000 points on each side and a degree from 0 to 10
  // (larger values only cost time: a window wider than the data is narrowed to it)
  function splineN(n) {
    var m = Math.round(n), L = Y.state.LIMITS.points;
    if (!(m >= 3 && m <= L)) { ui.toast('Spline: enter a whole number of frequencies from 3 to ' + L + '.', 'warn'); return; }
    derive('sp_', function (ds) { return Y.dataops.spline(ds, m); }, 'Spline on ' + m + ' log-spaced frequencies');
  }
  function smoothN(side, deg) {
    var sd = Math.round(side), dg = Math.round(deg);
    if (!(sd >= 1 && sd <= 1000 && dg >= 0 && dg <= 10)) { ui.toast('Smoothing: 1 to 1000 points on each side, and a polynomial degree from 0 to 10.', 'warn'); return; }
    derive('sm_', function (ds) { return Y.dataops.smooth(ds, sd, dg); }, 'Savitzky–Golay smoothing');
  }
  async function spline() {
    if (!haveSel()) return;
    var v = await ui.prompt('Spline to a log frequency grid', [{ key: 'n', label: 'Number of frequencies', type: 'number', value: 128 }], 'Create datasets',
      'Cubic spline of Zr and Zi versus log f. Avoid it on noisy data, and do not add many more points than measured.');
    if (v) splineN(v.n);
  }
  async function smooth() {
    if (!haveSel()) return;
    var v = await ui.prompt('Smooth (Savitzky–Golay)', [
      { key: 'side', label: 'Points on each side', type: 'number', value: 5 },
      { key: 'deg', label: 'Polynomial degree', type: 'number', value: 2 }], 'Create datasets', 'Assumes log-spaced frequencies.');
    if (v) smoothN(v.side, v.deg);
  }
  function average() {
    if (!idle() || !haveSel(2)) return;
    var list = sel();
    try {
      var k0 = list[0].norm ? list[0].norm.k : 1;
      if (list.some(function (d) { return (d.norm ? d.norm.k : 1) !== k0 || Y.state.zUnit(d) !== Y.state.zUnit(list[0]); }))
        throw new Error('Normalize the datasets the same way before averaging them.');
      var r = Y.dataops.average(list);
      snapshot('average');
      Y.state.addDatasets([{ name: 'average', f: r.f, zr: r.zr, zi: r.zi, p: Object.assign({}, list[0].p), fit: Object.assign({}, list[0].fit), norm: list[0].norm }]);
      ui.toast('Averaged ' + plural(list.length, 'dataset') + ' into "average".', 'ok');
    } catch (e) { ui.toast(e.message, 'err'); }
  }

  // ---------------------------------------------------------------- saving
  function saveParams() {
    if (!haveModel() || !haveSel()) return;
    var txt = Y.writers.paramsText(sel(), Y.state.names(), Object.assign({ cdc: S.model.cdc }, Y.state.fitSummary(sel())));
    Y.writers.download('yappari_parameters_' + Y.writers.fileStamp() + '.txt', txt);
    ui.toast('Saved the parameters of ' + plural(S.sel.size, 'dataset') + '.', 'ok');
  }
  async function saveData() {
    if (!haveSel()) return;
    var v = await ui.prompt('Save data', [
      { key: 'exp', label: 'Measured Zr, Zi', type: 'checkbox', value: true },
      { key: 'calc', label: 'Model Zr, Zi', type: 'checkbox', value: !!S.model.prog },
      { key: 'sep', label: 'Separator', type: 'select', value: S.settings.sep === 'auto' ? 'tab' : S.settings.sep,
        options: [['tab', 'TAB'], ['semicolon', 'Semicolon'], ['comma', 'Comma'], ['space', 'Space']] }
    ], 'Save', 'One block per dataset; File, Table with column headers reads the file back.');
    if (!v) return;
    if (!v.exp && !(v.calc && S.model.prog)) { ui.toast('Nothing to save: tick the measured or the model values (a model needs a circuit).', 'warn'); return; }
    var txt = Y.writers.dataText(sel(), { sep: v.sep, exp: v.exp, calc: v.calc && !!S.model.prog }, function (ds) { return Y.state.calcFor(ds); });
    Y.writers.download('yappari_data_' + Y.writers.fileStamp() + '.txt', txt);
    ui.toast('Saved the data of ' + plural(S.sel.size, 'dataset') + '.', 'ok');
  }
  function saveProject() {
    if (!need(S.datasets.length || S.model.prog, 'Nothing to save yet.')) return;
    var lines = ui.logEntries();
    Y.writers.download('yappari_project_' + Y.writers.fileStamp() + '.json', Y.writers.projectJSON(S, lines), 'application/json');
    ui.toast('Saved the project: circuit, settings, ' + plural(S.datasets.length, 'dataset') + ' and the Log (' + plural(lines.length, 'line') + ').', 'ok');
  }
  function report() { if (haveModel() && haveSel()) Y.report.open(sel()); }

  // ---------------------------------------------------------------- demo data
  function demo() {
    if (!idle()) return;
    var tree = Y.circuit.parse('R(RQ)(RQ)'), prog = Y.circuit.compile(tree), f = Y.dataops.logspace(1e6, 1e-2, 71), raws = [];
    for (var i = 0; i < 24; i++) {
      var p = Float64Array.from([50 * (1 + 0.01 * i), 1.2e4 * Math.exp(-0.07 * i), 2e-10, 0.93, 4e4 * Math.exp(-0.05 * i), 6e-7, 0.82]);
      var z = Y.circuit.impedance(prog, f, p), d = { name: 'demo_' + (i < 10 ? '0' : '') + i, f: f, zr: z.re, zi: z.im };
      Y.dataops.addNoise(d, 1, 'z');
      raws.push(d);
    }
    var setCircuit = !S.model.prog;
    snapshot('demo spectra');                           // before the circuit is set: undo removes it again
    if (setCircuit) Y.state.setModel(tree);
    Y.state.addDatasets(raws);
    ui.toast('Added 24 simulated spectra of R(RQ)(RQ) with 1 % noise' + (setCircuit ? ', and set that circuit' : '') +
      '. Fit demo_00, clone its parameters to all, select all and fit.', 'ok');
  }

  // ---------------------------------------------------------------- history (js/history.js)
  // A restore point is taken before every command or action that changes datasets: "undo" goes back one step,
  // and the Log has a "Restore before" button on the line of each action still kept in memory.
  function snapshot(label, opts) { Y.history.take(label, opts); }
  function undo() { if (idle()) Y.history.undo(); }

  // ---------------------------------------------------------------- frequency labels, DRT, Z-HIT, Kramers–Kronig test
  function parseFreq(t) {
    var m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([kKMmuµ]?)\s*(?:hz)?\s*$/i.exec(String(t).replace(',', '.'));
    if (!m) return NaN;
    return Number(m[1]) * ({ k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, 'µ': 1e-6 }[m[2]] || 1);
  }
  function addLabels(fv) {
    if (!haveSel()) return;
    if (!(fv > 0)) { ui.toast('Not a frequency. Examples: 1000, 1k, 2.5M, 10m.', 'warn'); return; }
    snapshot('labels');
    var n = 0;
    sel().forEach(function (ds) {
      var k = Y.plots.nearestPoint(ds, fv);
      if (k < 0) return;
      ds.notes = ds.notes || [];
      if (!ds.notes.some(function (v) { return Math.abs(v / ds.f[k] - 1) < 1e-9; })) { ds.notes.push(ds.f[k]); n++; }
    });
    Y.plots.refresh(false);
    Y.bus.emit('labels');
    ui.toast('Labelled the point nearest to ' + Y.plots.fmtF(fv, 4) + ' in ' + plural(n, 'dataset') + '.', 'ok');
  }
  async function labelDialog() {
    if (!haveSel()) return;
    var v = await ui.prompt('Label a frequency on the Nyquist plot', [{ key: 'f', label: 'Frequency /Hz', type: 'text', value: '1k',
      hint: 'The nearest measured point of each selected dataset gets a label. 1k = 1000, 2.5M = 2.5e6, 10m = 0.01.' }], 'Add labels');
    if (v) addLabels(parseFreq(v.f));
  }
  function clearLabels() {
    if (!haveSel()) return;
    snapshot('clear labels');
    sel().forEach(function (ds) { ds.notes = []; });
    Y.plots.refresh(false);
    Y.bus.emit('labels');
    ui.toast('Labels removed from the selected datasets.', 'info');
  }
  function showTab(t) { Y.app.showTab(t); }
  function drtSelected() { if (haveSel()) showTab('drt'); }
  function drtSave() { if (haveSel()) Y.drtTab.saveSelected(); }
  // Z-HIT of the selected datasets, computed in slices with the progress bar (as the Kramers–Kronig test), so that a
  // large selection keeps the window responsive; finish() always clears the busy state
  function zhitSelected() {
    if (!idle() || !haveSel()) return;
    var src = sel(), out = [], lines = [], warnings = [], failed = 0, i = 0;
    function one(ds) {
      try {
        var r = Y.drt.zhit(ds);
        var idx = [];
        for (var k = 0; k < r.f.length; k++) if (isFinite(r.dev[k])) idx.push(k);
        out.push({ name: 'zh_' + ds.name,
          f: Float64Array.from(idx, function (j) { return r.f[j]; }),
          zr: Float64Array.from(idx, function (j) { return r.zr[j]; }),
          zi: Float64Array.from(idx, function (j) { return r.zi[j]; }),
          p: Object.assign({}, ds.p), fit: Object.assign({}, ds.fit), norm: ds.norm });
        lines.push(ds.name + ': ' + (100 * r.rms).toFixed(2) + ' % rms, at most ' + (100 * r.max).toFixed(1) + ' % at ' + Y.plots.fmtF(r.fmax, 3) +
          ', ' + r.checked + ' of ' + r.f.length + ' distinct-frequency points checked' +
          (r.gap ? ', gaps split the data into ' + r.ranges + ' independently normalized ranges' : ''));
        r.skippedRanges.forEach(function (sg) {
          warnings.push(ds.name + ': NOT checked, ' + sg.n + ' points from ' + Y.plots.fmtF(sg.f0, 3) + ' to ' + Y.plots.fmtF(sg.f1, 3) +
            ' (' + sg.reason + '); omitted from zh_ output.');
        });
      } catch (e) { failed++; ui.toast(ds.name + ': ' + e.message, 'err'); }
    }
    function finish(err) {
      Y.state.setBusy(false);
      ui.progress(0, 0);
      if (err) { ui.toast('Z-HIT stopped: ' + ((err && err.message) || err) + '. No dataset was added.', 'err'); return; }
      if (!out.length) return;
      snapshot('Z-HIT');
      var made = Y.state.addDatasets(out, { select: false });
      Y.state.selectIds(made.map(function (d) { return d.id; }).concat(src.map(function (d) { return d.id; })));
      lines.forEach(function (l) { ui.log('Z-HIT ' + l, 'info'); });
      warnings.forEach(function (l) { ui.log('Z-HIT ' + l, 'warn'); });
      ui.toast('Z-HIT, measured |Z| against |Z| rebuilt from the phase. ' + lines.slice(0, 2).join('; ') + (lines.length > 2 ? ' …' : '') +
        '. New datasets zh_… contain only checked points and are selected with the originals.' +
        (warnings.length ? ' ' + warnings.length + ' ranges were not checked; see Log.' : '') +
        (failed ? ' ' + failed + ' datasets failed; see Log.' : '') +
        ' Deviations can also reflect noise, endpoints or sharp resonances; this is not a pass/fail test.', warnings.length || failed ? 'warn' : 'info');
    }
    ui.progress(0, src.length);
    Y.state.setBusy(true);
    (function slice() {
      try {
        var t0 = performance.now();
        while (i < src.length && performance.now() - t0 < 40) one(src[i++]);
        ui.progress(i, src.length);
      } catch (e) { finish(e); return; }
      if (i < src.length) setTimeout(slice, 0); else finish(null);
    })();
  }


  // Kramers–Kronig test (Lin-KK, js/core/kk.js). New datasets kk_… hold the fit that obeys the Kramers–Kronig relations,
  // at the distinct measured frequencies. o.M fixes the number of RC elements (kk>>M); otherwise M is where more elements
  // stop improving the fit. The datasets are computed in slices with a progress bar, so a large selection keeps the
  // window responsive.
  function kkSelected(o) {
    if (!idle() || !haveSel()) return;
    o = o || {};
    var src = sel(), out = [], lines = [], failed = 0, i = 0;
    // ends the run; always clears the busy state, also when something unexpected throws, so the program cannot stay busy
    function finish(err) {
      Y.state.setBusy(false);
      ui.progress(0, 0);
      if (err) { ui.toast('Kramers–Kronig test stopped: ' + ((err && err.message) || err) + '. No dataset was added.', 'err'); return; }
      if (!out.length) return;
      snapshot('Kramers–Kronig test');
      var made = Y.state.addDatasets(out, { select: false });
      Y.state.selectIds(made.map(function (d) { return d.id; }).concat(src.map(function (d) { return d.id; })));
      lines.forEach(function (l) { ui.log('KK ' + l, 'info'); });
      ui.toast('Kramers–Kronig test (Lin-KK), measured Z against a fit that obeys the Kramers–Kronig relations. ' + lines.slice(0, 2).join('; ') +
        (lines.length > 2 ? ' …' : '') + '. New datasets kk_… hold that fit and are selected with the originals.' +
        (failed ? ' ' + plural(failed, 'dataset') + ' failed, see Log.' : '') +
        ' Residuals above the noise, or with a trend, point to drift, non-linearity or artefacts; this is not a pass/fail test.', failed ? 'warn' : 'info');
    }
    ui.progress(0, src.length);
    Y.state.setBusy(true);
    (function slice() {
      try {
        var t0 = performance.now();
        while (i < src.length && performance.now() - t0 < 40) {
          var ds = src[i++];
          try {
            var r = Y.kk.run(ds, o);
            out.push({ name: 'kk_' + ds.name, f: r.f, zr: r.zr, zi: r.zi, p: Object.assign({}, ds.p), fit: Object.assign({}, ds.fit), norm: ds.norm });
            lines.push(ds.name + ': ' + plural(r.M, 'RC element') + (r.auto ? '' : ' (fixed)') + ', residuals Zr ' +
              (100 * r.rmsRe).toFixed(2) + ' %, Zi ' + (100 * r.rmsIm).toFixed(2) + ' % rms, at most ' + (100 * r.max).toFixed(1) + ' % of |Z| at ' +
              Y.plots.fmtF(r.fmax, 3) + ', ' + r.n + ' distinct-frequency points');
          } catch (e) { failed++; ui.toast(ds.name + ': ' + e.message, 'err'); }
        }
        ui.progress(i, src.length);
      } catch (e) { finish(e); return; }
      if (i < src.length) setTimeout(slice, 0); else finish(null);
    })();
  }

  // ---------------------------------------------------------------- availability
  // why(id): why a command cannot run now, '' when it can. Menus grey such items out and the buttons that run the same
  // commands are disabled, with the reason as tooltip. The commands keep their own checks for the command line and keys.
  var NO_DATA = 'No data loaded yet. Use File, or drop files on the window.', NO_SEL = 'No dataset selected.',
      NO_MODEL = 'No circuit yet. Build one in the Model tab.', BUSY = 'Not while a fit is running.';
  function noSel() { return !S.datasets.length ? NO_DATA : !S.sel.size ? NO_SEL : ''; }
  function idleSel() { return S.busy ? BUSY : noSel(); }
  function withModel() { return noSel() || (S.model.prog ? '' : NO_MODEL); }
  function anyMasked(list) { return list.some(function (ds) { for (var k = 0; k < ds.mask.length; k++) if (ds.mask[k]) return true; return false; }); }
  function anyLabels(list) { return list.some(function (ds) { return !!(ds.notes && ds.notes.length); }); }
  function anyInView(list, vf, withMasked) {
    var v = vf.v;
    return list.some(function (ds) {
      for (var k = 0; k < ds.f.length; k++) {
        if (ds.mask[k] && !withMasked) continue;
        var c = Y.dataops.coords(ds, k, vf.kind);
        if (c[0] >= v.x0 && c[0] <= v.x1 && c[1] >= v.y0 && c[1] <= v.y1) return true;
      }
      return false;
    });
  }
  function inViewWhy(withMasked) {
    var r = idleSel();
    if (r) return r;
    var vf = Y.plots.viewFor(Y.app.tab());
    if (!vf) return 'Open the Nyquist, Zr, Zi or |Z|, θ plot first.';
    return anyInView(sel(), vf, withMasked) ? '' : withMasked ? 'No point of the selected datasets in the current view.' : 'No unmasked point of the selected datasets in the current view.';
  }
  function fitWhy() {
    if (S.busy) return BUSY;
    var r = withModel();
    if (r) return r;
    var g = !!(Y.app && Y.app.fitMode && Y.app.fitMode() === 'global'), list = sel(), names = Y.state.names();
    if (g && list.length < 2) return 'A global fit needs at least two selected datasets.';
    var ticked = g ? names.some(function (n) { return list[0].fit[n]; })
                   : list.some(function (ds) { return names.some(function (n) { return ds.fit[n]; }); });
    return ticked ? '' : 'Tick “fit” next to at least one parameter (Parameters tab).';
  }
  var WHY = {
    read: function () { return S.busy ? BUSY : ''; },                           // reading files, opening a project, demo
    saveProject: function () { return S.datasets.length || S.model.prog ? '' : 'Nothing to save yet.'; },
    withModel: withModel,                                                       // save parameters, report
    selection: noSel,                                                           // save data, DRT view and search, labels, PNG
    edit: idleSel,                                                              // commands that change the selected datasets
    undo: function () { return S.busy ? BUSY : Y.history.count() ? '' : 'Nothing to undo.'; },
    inView: function () { return inViewWhy(false); },                         // mask: unmasked points in view
    deleteInView: function () { return inViewWhy(true); },                    // delete: any point in view
    unmask: function () { return idleSel() || (anyMasked(sel()) ? '' : 'No masked points in the selected datasets.'); },
    average: function () { return S.busy ? BUSY : !S.datasets.length ? NO_DATA : S.sel.size < 2 ? 'Select at least two datasets.' : ''; },
    simulate: function () { return S.busy ? BUSY : S.model.prog ? '' : NO_MODEL; },
    unlabel: function () { return noSel() || (anyLabels(sel()) ? '' : 'No frequency labels on the selected datasets.'); },
    fit: fitWhy,
    cloneAll: function () { return S.busy ? BUSY : withModel() || (S.datasets.length > 1 ? '' : 'There is only one dataset.'); },
    cloneSel: function () { return S.busy ? BUSY : withModel() || (S.sel.size > 1 ? '' : 'Select the datasets to copy to as well.'); },
    stop: function () { return running ? '' : 'Only fits can be stopped.'; }
  };
  function why(id) { var f = WHY[id]; return f ? f() || '' : ''; }

  // buttons that run the same commands as menu items, kept in step with the state
  var BUTTONS = [['#btn-fit', 'fit'], ['#btn-stop', 'stop'], ['#clone-all', 'cloneAll'], ['#clone-sel', 'cloneSel'],
                 ['[data-plot-action="label"]', 'selection'], ['[data-plot-action="unlabel"]', 'unlabel'],
                 ['[data-plot-action="png"]', 'selection'], ['#drt-search', 'selection'], ['#drt-all', 'edit']];
  var syncRaf = 0;
  function syncButtons() {
    if (syncRaf) { cancelAnimationFrame(syncRaf); syncRaf = 0; }
    BUTTONS.forEach(function (b) {
      var r = why(b[1]);
      document.querySelectorAll(b[0]).forEach(function (el) { ui.able(el, r); });
    });
  }
  function scheduleSync() { if (!syncRaf) syncRaf = requestAnimationFrame(function () { syncRaf = 0; syncButtons(); }); }

  // ---------------------------------------------------------------- command line
  var HELP = [
    ['rndz>>x', 'noise up to ±x % of |Z| on Zr and Zi of the selected datasets'],
    ['rndzr>>x, rndzi>>x', 'noise on Zr only, or on Zi only'],
    ['rndf>>x', 'noise on the frequencies, for tests'],
    ['negate_zi', 'change the sign of Zi'],
    ['spline>>n', 'new datasets on n log-spaced frequencies'],
    ['smooth>>s&d', 'Savitzky–Golay, s points on each side, degree d'],
    ['average', 'mean of the selected datasets'],
    ['fit, globalfit', 'fit the selected datasets one by one, or together'],
    ['clone_all, clone_active', 'copy the parameters of the first selected dataset'],
    ['mask, unmask', 'mask the points inside the current plot view, or show them all again'],
    ['simulate', 'new dataset from the circuit and the current parameters'],
    ['select>>text', 'select the datasets whose name contains text (regular expressions work)'],
    ['demo', 'add 24 simulated spectra'],
    ['undo', 'go back one step, repeat to go further; the Log has a Restore button on each action'],
    ['label>>f', 'label the point nearest to f on the Nyquist plot (1k, 2.5M, 10m allowed)'],
    ['unlabel', 'remove the labels of the selected datasets'],
    ['contrib', 'show or hide the contributions of the parts in series'],
    ['drt, drt_save', 'show the DRT of the selected datasets, or save it to a file'],
    ['drt_search', 'search the regularisation of the DRT'],
    ['zhit', 'Z-HIT check of the selected datasets'],
    ['kk, kk>>M', 'Kramers–Kronig test (Lin-KK) of the selected datasets, with M RC elements (chosen automatically when omitted)'],
    ['help', 'this list']
  ];
  function showHelp() {
    ui.modal({ title: 'Commands', wide: true, body: '<p class="intro">Type them in the command line at the bottom of the window. They act on the selected datasets.</p><table class="grid">' +
      HELP.map(function (h) { return '<tr><td><code>' + ui.esc(h[0]) + '</code></td><td>' + ui.esc(h[1]) + '</td></tr>'; }).join('') + '</table>' });
  }

  function runCommand(line) {
    var s = String(line).trim();
    if (!s) return;
    ui.log('› ' + s, 'cmd');
    var lm = /^label>>(.+)$/i.exec(s);
    if (lm) { addLabels(parseFreq(lm[1])); return; }
    var m = /^select>>(.+)$/i.exec(s);
    if (m) {
      var rx;
      try { rx = new RegExp(m[1].trim(), 'i'); } catch (e) { ui.toast('Not a valid pattern: ' + e.message, 'err'); return; }
      var ids = S.datasets.filter(function (d) { return rx.test(d.name); }).map(function (d) { return d.id; });
      snapshot('select');
      Y.state.selectIds(ids);
      ui.toast('Selected ' + plural(ids.length, 'dataset') + ' matching ' + m[1].trim() + '.', ids.length ? 'ok' : 'warn');
      return;
    }
    m = /^([a-z_]+)(?:>>(.*))?$/i.exec(s.replace(/\s+/g, ''));
    if (!m) { ui.toast('Unknown command: ' + s + '. Type help for the list.', 'err'); return; }
    var cmd = m[1].toLowerCase(), a = (m[2] || '').split('&').filter(Boolean).map(function (x) { return ui.parseNum(x); });
    var noiseT = { rndz: 'z', rndzr: 'zr', rndzr_: 'zr', rndzi: 'zi', rndzi_: 'zi', rndf: 'f' };
    if (cmd in noiseT) { applyNoise(isFinite(a[0]) ? a[0] : 1, noiseT[cmd]); return; }
    switch (cmd) {
      case 'negate_zi': negateZi(); break;
      case 'spline': if (haveSel()) splineN(isFinite(a[0]) ? a[0] : 128); break;
      case 'smooth': if (haveSel()) smoothN(isFinite(a[0]) ? a[0] : 5, isFinite(a[1]) ? a[1] : 2); break;
      case 'average': average(); break;
      case 'fit': fitSelected(); break;
      case 'globalfit': case 'global_fit': globalFit(); break;
      case 'clone_all': cloneTo(true); break;
      case 'clone_active': cloneTo(false); break;
      case 'mask': inView(false); break;
      case 'unmask': unmask(); break;
      case 'simulate': simulate(); break;
      case 'demo': demo(); break;
      case 'undo': undo(); break;
      case 'unlabel': clearLabels(); break;
      case 'contrib': Y.state.setSetting('contrib', !S.settings.contrib); ui.toast('Contributions ' + (S.settings.contrib ? 'shown' : 'hidden') + '.', 'info'); break;
      case 'drt': drtSelected(); break;
      case 'drt_save': drtSave(); break;
      case 'drt_search': Y.drtTab.searchDialog(); break;
      case 'zhit': zhitSelected(); break;
      case 'kk':
        if (m[2] && !(Number.isInteger(a[0]) && a[0] >= 1)) { ui.toast('kk>>M needs a whole number of RC elements, at least 1; kk alone chooses it.', 'err'); break; }
        kkSelected(m[2] ? { M: a[0] } : {}); break;
      case 'help': showHelp(); break;
      default: ui.toast('Unknown command: ' + cmd + '. Type help for the list.', 'err');
    }
  }

  // ---------------------------------------------------------------- menus
  function init() {
    var M = {                                  // label, command, availability rule (see WHY)
      file: [['3 columns: f, Zr, Zi…', function () { read('three'); }, 'read'],
             ['Table with column headers…', function () { read('table'); }, 'read'],
             ['ZView .z / .txt…', function () { read('zview'); }, 'read'], null,
             ['BioLogic MPT…', function () { read('biologic'); }, 'read'],
             ['Gamry DTA…', function () { read('gamry'); }, 'read'],
             ['VersaStudio .par…', function () { read('versa'); }, 'read'],
             ['Custom format, xml', customDialog, 'read'], null,
             ['Open project…', function () { read('project'); }, 'read'], ['Save project', saveProject, 'saveProject'], null,
             ['Save parameters of selected', saveParams, 'withModel'], ['Save data of selected…', saveData, 'selection'],
             ['Report of selected datasets', report, 'withModel'], null,
             ['Load 24 demo spectra', demo, 'read']],
      data: [['Undo the last command', undo, 'undo'], null,
             ['Mask points in the current view', function () { inView(false); }, 'inView'], ['Unmask selected datasets', unmask, 'unmask'],
             ['Delete points in the current view…', function () { inView(true); }, 'deleteInView'], ['Delete selected datasets…', deleteDatasets, 'edit'], null,
             ['Normalize: area, resistivity or factor…', correction, 'edit'], ['Negate Zi', negateZi, 'edit'], null,
             ['Add random noise…', noise, 'edit'], ['Spline to a log frequency grid…', spline, 'edit'],
             ['Smooth (Savitzky–Golay)…', smooth, 'edit'], ['Average selected datasets', average, 'average'], null,
             ['Simulate spectrum', simulate, 'simulate']],
      analysis: [['Show the DRT of selected datasets', drtSelected, 'selection'], ['Save the DRT of selected datasets…', drtSave, 'edit'],
                 ['DRT λ search…', function () { Y.drtTab.searchDialog(); }, 'selection'], null,
                 ['Z-HIT of selected datasets', zhitSelected, 'edit'],
                 ['Kramers–Kronig test of selected datasets', function () { kkSelected(); }, 'edit'], null,
                 ['Label a frequency on the Nyquist plot…', labelDialog, 'selection'], ['Clear Nyquist labels', clearLabels, 'unlabel'], null,
                 ['Command line help', showHelp]]
    };
    document.querySelectorAll('[data-menu]').forEach(function (b) {
      b.addEventListener('click', function () {
        ui.menu(b, M[b.getAttribute('data-menu')].map(function (it) { return it ? { label: it[0], act: it[1], off: why(it[2]) } : { sep: true }; }));
      });
    });
    ['datasets', 'selection', 'model', 'params', 'data', 'labels'].forEach(function (ev) { Y.bus.on(ev, scheduleSync); });
    Y.bus.on('busy', syncButtons);
    syncButtons();
  }

  return { init: init, readFiles: readFiles, fitSelected: fitSelected, globalFit: globalFit, stop: stop, cloneTo: cloneTo, undo: undo,
           labelDialog: labelDialog, clearLabels: clearLabels, addLabels: addLabels, zhitSelected: zhitSelected, kkSelected: kkSelected, drtSelected: drtSelected,
           inView: inView, unmask: unmask, deleteDatasets: deleteDatasets, simulate: simulate, demo: demo,
           runCommand: runCommand, saveProject: saveProject, saveParams: saveParams, showHelp: showHelp,
           why: why, syncButtons: syncButtons };
})();
