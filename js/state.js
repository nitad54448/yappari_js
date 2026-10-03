/*  Application state and event bus.
 *  Events: 'datasets' (list changed), 'selection', 'params' (values / fit flags), 'model', 'settings',
 *          'data' (points changed: mask, delete, noise ...), 'stats' (fit results), 'busy'
 *
 *  Dataset: { id, name, f, zr, zi (Float64Array), mask (Uint8Array, 1 = hidden & not fitted),
 *             p: {name: value}, fit: {name: bool}, stats: null | {...}, calc/curve: cached model values }
 *  Every dataset holds its own parameter values for the one circuit; limits and the global-fit
 *  "shared" flags are per parameter name, for all datasets (as in Yappari).
 */
Y.bus = (function () {
  'use strict';
  var handlers = {};
  return {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit: function (ev, data) {
      (handlers[ev] || []).slice().forEach(function (fn) {
        try { fn(data); } catch (e) { console.error('[' + ev + ']', e); }
      });
    }
  };
})();

Y.state = (function () {
  'use strict';
  var LS = 'yappari.';

  function defaults() {
    return { sep: 'auto', method: 'TRDL', weight: 'mod', maxIter: 2500, tol: 1e-12,
             simStart: 1e-3, simEnd: 1e6, simPoints: 128, maxPlots: 60, legendMax: 24,
             nyqEqual: true, resid: 'abs', phase: 'deg', view3d: 'nyq', useSigma: false, theme: 'system', contrib: false,
             drtMethod: 'tikhonov', drtSource: 'both', drtLambda: -3, drtIter: 5, drtX: 'f' };
  }

  var S = {
    datasets: [], sel: new Set(), anchor: null, nextId: 1, simCount: 0, busy: false,
    model: { tree: null, prog: null, cdc: '', limits: {}, shared: {}, version: 0 },
    settings: defaults()
  };

  // ---------------------------------------------------------------- persistence (localStorage)
  function store(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
  function load(key) { try { var v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  function restore() {
    var st = load('settings');
    if (st) Object.keys(st).forEach(function (k) { if (k in S.settings) S.settings[k] = st[k]; });
    var ov = load('elements');
    if (ov) Y.elementOverrides = ov;
    var m = load('model');
    if (m && m.cdc) {
      try { setModel(Y.circuit.parse(m.cdc), { limits: m.limits, shared: m.shared, quiet: true }); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- settings
  function setSetting(key, val) {
    S.settings[key] = val;
    store('settings', S.settings);
    Y.bus.emit('settings', key);
  }
  function resetSettings() { S.settings = defaults(); store('settings', S.settings); Y.bus.emit('settings', '*'); }
  function saveElementOverrides() { store('elements', Y.elementOverrides); }

  // ---------------------------------------------------------------- model
  function names() { return S.model.prog ? S.model.prog.names : []; }

  function defaultsFor(pp) { return Y.paramDefault(pp.kind, pp.pi); }

  function remap(ds) {
    var np = {}, nf = {}, prog = S.model.prog;
    ds.mem = ds.mem || {};                      // values of parameters that left the circuit
    Object.keys(ds.p).forEach(function (n) { ds.mem[n] = [ds.p[n], ds.fit[n]]; });
    if (prog) prog.params.forEach(function (pp) {
      if (pp.name in ds.p) { np[pp.name] = ds.p[pp.name]; nf[pp.name] = ds.fit[pp.name]; }
      else if (ds.mem[pp.name]) { np[pp.name] = ds.mem[pp.name][0]; nf[pp.name] = ds.mem[pp.name][1]; }
      else { var d = defaultsFor(pp); np[pp.name] = d.def; nf[pp.name] = d.fit; }
    });
    ds.p = np; ds.fit = nf;
  }

  // opts: {limits, shared} to restore, quiet: no event
  function setModel(tree, opts) {
    opts = opts || {};
    var prog = tree ? Y.circuit.compile(tree) : null, old = S.model, limits = {}, shared = {};
    var oldL = opts.limits || old.limits, oldS = opts.shared || old.shared;
    if (prog) prog.params.forEach(function (pp) {
      var d = defaultsFor(pp);
      limits[pp.name] = oldL[pp.name] ? { min: oldL[pp.name].min, max: oldL[pp.name].max } : { min: d.min, max: d.max };
      shared[pp.name] = oldS[pp.name] != null ? !!oldS[pp.name] : true;
    });
    var same = old.prog && prog && old.prog.cdc === prog.cdc;
    S.model = { tree: tree, prog: prog, cdc: prog ? prog.cdc : '', limits: limits, shared: shared, version: old.version + 1 };
    S.datasets.forEach(function (ds) { remap(ds); if (!same) ds.stats = null; invalidate(ds); });
    store('model', { cdc: S.model.cdc, limits: limits, shared: shared });
    if (!opts.quiet) Y.bus.emit('model');
  }

  function setLimit(name, which, val) {
    if (!S.model.limits[name]) return;
    S.model.limits[name][which] = val;
    store('model', { cdc: S.model.cdc, limits: S.model.limits, shared: S.model.shared });
  }
  function setShared(name, val) {
    S.model.shared[name] = !!val;
    store('model', { cdc: S.model.cdc, limits: S.model.limits, shared: S.model.shared });
  }

  // ---------------------------------------------------------------- datasets
  function nanIfNull(v) { return v == null ? NaN : v; }
  function makeDataset(raw) {
    var n = raw.f.length;
    var ds = { id: S.nextId++, name: raw.name || 'data', f: Float64Array.from(raw.f), zr: Float64Array.from(raw.zr),
               zi: Float64Array.from(raw.zi), mask: raw.mask ? Uint8Array.from(raw.mask) : new Uint8Array(n),
               sr: raw.sr ? Float64Array.from(raw.sr, nanIfNull) : null, si: raw.si ? Float64Array.from(raw.si, nanIfNull) : null,
               notes: raw.notes ? raw.notes.slice() : [],
               p: raw.p ? Object.assign({}, raw.p) : {}, fit: raw.fit ? Object.assign({}, raw.fit) : {},
               stats: raw.stats || null, calc: null, curve: null, ver: -1 };
    remap(ds);
    return ds;
  }

  // new datasets go to the top of the list (as in Yappari), the first one is selected
  function addDatasets(raws, opts) {
    opts = opts || {};
    var made = raws.map(makeDataset);
    if (opts.after) {
      var at = S.datasets.indexOf(opts.after);
      Array.prototype.splice.apply(S.datasets, [at < 0 ? 0 : at, 0].concat(made));
    } else Array.prototype.unshift.apply(S.datasets, made);
    Y.bus.emit('datasets');
    if (made.length && opts.select !== false) {
      if (opts.selectAll) selectIds(made.map(function (d) { return d.id; }));
      else selectIds([made[0].id]);
    }
    return made;
  }

  function byId(id) { for (var i = 0; i < S.datasets.length; i++) if (S.datasets[i].id === id) return S.datasets[i]; return null; }

  function removeDatasets(ids) {
    var set = new Set(ids);
    S.datasets = S.datasets.filter(function (d) { return !set.has(d.id); });
    ids.forEach(function (id) { S.sel.delete(id); });
    Y.bus.emit('datasets'); Y.bus.emit('selection');
  }
  function clearAll() { S.datasets = []; S.sel.clear(); S.anchor = null; Y.bus.emit('datasets'); Y.bus.emit('selection'); }

  function rename(id, name) { var d = byId(id); if (d && name) { d.name = name; Y.bus.emit('datasets'); } }

  function move(id, beforeId) {
    var d = byId(id);
    if (!d || id === beforeId) return;
    S.datasets.splice(S.datasets.indexOf(d), 1);
    var at = beforeId == null ? S.datasets.length : S.datasets.indexOf(byId(beforeId));
    S.datasets.splice(at < 0 ? S.datasets.length : at, 0, d);
    Y.bus.emit('datasets');
  }

  // ---------------------------------------------------------------- selection
  function selectIds(ids, keepAnchor) {
    S.sel = new Set(ids);
    if (!keepAnchor) S.anchor = ids.length ? ids[0] : null;
    Y.bus.emit('selection');
  }
  function toggle(id) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.anchor = id; Y.bus.emit('selection'); }
  function range(id) {
    var a = S.datasets.findIndex(function (d) { return d.id === S.anchor; }), b = S.datasets.findIndex(function (d) { return d.id === id; });
    if (a < 0) a = b;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    selectIds(S.datasets.slice(lo, hi + 1).map(function (d) { return d.id; }), true);
  }
  function selectAll() { selectIds(S.datasets.map(function (d) { return d.id; }), true); }
  function selected() { return S.datasets.filter(function (d) { return S.sel.has(d.id); }); }
  function first() { for (var i = 0; i < S.datasets.length; i++) if (S.sel.has(S.datasets[i].id)) return S.datasets[i]; return null; }

  // ---------------------------------------------------------------- parameters
  function vector(ds) { return Float64Array.from(names(), function (n) { return ds.p[n]; }); }

  function setParam(name, value, list) {
    (list || selected()).forEach(function (ds) { ds.p[name] = value; ds.stats = null; invalidate(ds); });
    Y.bus.emit('params', { name: name });
  }
  function setFit(name, on, list) {
    (list || selected()).forEach(function (ds) { ds.fit[name] = !!on; });
    Y.bus.emit('params', { name: name, flag: true });
  }
  function copyParams(from, list) {
    list.forEach(function (ds) {
      if (ds === from) return;
      names().forEach(function (n) { ds.p[n] = from.p[n]; ds.fit[n] = from.fit[n]; });
      ds.stats = null; invalidate(ds);
    });
    Y.bus.emit('params', {});
  }

  // fit result from Y.fit.run / Y.globalFit (p, se, atBound arrays in circuit order)
  function applyResult(ds, res, extra) {
    var nm = names(), se = {}, bound = {};
    nm.forEach(function (n, j) {
      ds.p[n] = res.p[j];
      if (res.se && isFinite(res.se[j])) se[n] = res.se[j];
      if (res.atBound && res.atBound[j]) bound[n] = true;
    });
    ds.stats = Object.assign({ chi2w: res.chi2w, chi2red: res.chi2red, r2: res.r2, n: res.n, iter: res.iter,
                               msg: res.msg, ok: res.ok, se: se, bound: bound,
                               method: S.settings.method, weight: S.settings.weight }, extra || {});
    invalidate(ds);
  }

  // ---------------------------------------------------------------- model values (cached)
  function invalidate(ds) { ds.calc = null; ds.curve = null; }
  function invalidateAll() { S.datasets.forEach(invalidate); }

  function calcFor(ds) {
    if (!S.model.prog) return null;
    if (!ds.calc || ds.ver !== S.model.version) {
      ds.calc = Y.circuit.impedance(S.model.prog, ds.f, vector(ds));
      ds.curve = null; ds.ver = S.model.version;
    }
    return ds.calc;
  }
  // smooth model curve over the measured frequency range (for plotting lines)
  function curveFor(ds) {
    if (!S.model.prog || !ds.f.length) return null;
    if (!ds.curve || ds.ver !== S.model.version) {
      var lo = Infinity, hi = 0;
      for (var k = 0; k < ds.f.length; k++) if (ds.f[k] > 0) { lo = Math.min(lo, ds.f[k]); hi = Math.max(hi, ds.f[k]); }
      if (!(hi > 0)) return null;
      var f = Y.dataops.logspace(lo, hi, Math.max(240, 3 * ds.f.length));
      var z = Y.circuit.impedance(S.model.prog, f, vector(ds));
      ds.curve = { f: f, re: z.re, im: z.im };
      if (!ds.calc || ds.ver !== S.model.version) { ds.calc = Y.circuit.impedance(S.model.prog, ds.f, vector(ds)); ds.ver = S.model.version; }
    }
    return ds.curve;
  }

  // ---------------------------------------------------------------- fit jobs
  function bounds() {
    var nm = names(), lo = new Float64Array(nm.length), hi = new Float64Array(nm.length);
    nm.forEach(function (n, j) { lo[j] = S.model.limits[n].min; hi[j] = S.model.limits[n].max; });
    return { lo: lo, hi: hi };
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // Measured standard deviations of Zr and Zi at the points idx. Points without one get the median relative
  // error (sigma/|Z|) of the others. null when fewer than 3 points have a value.
  function sigmaFor(ds, idx) {
    if (!ds.sr || !ds.si) return null;
    var n = idx.length, sr = new Float64Array(n), si = new Float64Array(n), rr = [], ri = [], both = 0;
    idx.forEach(function (k, i) {
      var m = Math.hypot(ds.zr[k], ds.zi[k]), a = ds.sr[k], b = ds.si[k];
      sr[i] = a > 0 && a < Infinity ? a : NaN; si[i] = b > 0 && b < Infinity ? b : NaN;
      if (sr[i] === sr[i] && m > 0) rr.push(sr[i] / m);
      if (si[i] === si[i] && m > 0) ri.push(si[i] / m);
      if (sr[i] === sr[i] && si[i] === si[i]) both++;
    });
    if (rr.length < 3 || ri.length < 3) return null;
    var mr = median(rr), mi = median(ri);
    idx.forEach(function (k, i) {
      var m = Math.hypot(ds.zr[k], ds.zi[k]) || 1;
      if (!(sr[i] === sr[i])) sr[i] = mr * m;
      if (!(si[i] === si[i])) si[i] = mi * m;
      sr[i] = Math.max(sr[i], 1e-9 * m); si[i] = Math.max(si[i], 1e-9 * m);
    });
    return { sr: sr, si: si, measured: both, n: n };
  }

  // unmasked points for a fit, with measured standard deviations when the setting asks for them
  function fitData(ds) {
    var idx = [];
    for (var k = 0; k < ds.f.length; k++) if (!ds.mask[k]) idx.push(k);
    var d = { f: Float64Array.from(idx, function (k) { return ds.f[k]; }), zr: Float64Array.from(idx, function (k) { return ds.zr[k]; }),
              zi: Float64Array.from(idx, function (k) { return ds.zi[k]; }) };
    if (S.settings.useSigma) {
      var sg = sigmaFor(ds, idx);
      if (sg) { d.sr = sg.sr; d.si = sg.si; d.sigma = sg.measured === sg.n ? 'measured' : 'measured at ' + sg.measured + ' of ' + sg.n + ' points'; }
    }
    return d;
  }
  function unmasked(ds) { return fitData(ds); }
  function jobFor(ds, b) {
    var u = fitData(ds), st = S.settings;
    var job = { id: ds.id, cdc: S.model.cdc, f: u.f, zr: u.zr, zi: u.zi, p: vector(ds),
                fit: Uint8Array.from(names(), function (n) { return ds.fit[n] ? 1 : 0; }),
                lo: b.lo, hi: b.hi, method: st.method, weight: st.weight, maxIter: st.maxIter, tol: st.tol };
    if (u.sr) { job.sr = u.sr; job.si = u.si; job.sigma = u.sigma; }
    return job;
  }

  // ---------------------------------------------------------------- project
  function loadProject(doc) {
    if (!doc || doc.format !== 'yappari-js-project') throw new Error('not a Yappari JS project file');
    var d = defaults();
    S.settings = Object.assign(d, doc.settings || {});
    store('settings', S.settings);
    S.datasets = []; S.sel.clear();
    var tree = null;
    if (doc.model && doc.model.cdc) tree = Y.circuit.parse(doc.model.cdc);
    setModel(tree, { limits: (doc.model && doc.model.limits) || {}, shared: (doc.model && doc.model.shared) || {}, quiet: true });
    S.datasets = (doc.datasets || []).map(makeDataset);
    Y.bus.emit('settings', '*'); Y.bus.emit('model'); Y.bus.emit('datasets');
    selectIds(S.datasets.length ? [S.datasets[0].id] : []);
  }

  // dataset rebuilt from a history record (arrays copied, so the record stays intact)
  function fromRecord(r) {
    return { id: r.id, name: r.name, f: Float64Array.from(r.f), zr: Float64Array.from(r.zr), zi: Float64Array.from(r.zi), mask: Uint8Array.from(r.mask),
             sr: r.sr ? Float64Array.from(r.sr) : null, si: r.si ? Float64Array.from(r.si) : null, notes: r.notes.slice(),
             p: Object.assign({}, r.p), fit: Object.assign({}, r.fit), mem: r.mem ? Object.assign({}, r.mem) : undefined,
             stats: r.stats, calc: null, curve: null, ver: -1 };
  }

  function setBusy(b) { S.busy = b; Y.bus.emit('busy', b); }

  return {
    S: S, defaults: defaults, restore: restore, store: store, load: load,
    setSetting: setSetting, resetSettings: resetSettings, saveElementOverrides: saveElementOverrides,
    names: names, setModel: setModel, setLimit: setLimit, setShared: setShared,
    makeDataset: makeDataset, addDatasets: addDatasets, byId: byId, removeDatasets: removeDatasets, clearAll: clearAll,
    rename: rename, move: move,
    selectIds: selectIds, toggle: toggle, range: range, selectAll: selectAll, selected: selected, first: first,
    vector: vector, setParam: setParam, setFit: setFit, copyParams: copyParams, applyResult: applyResult,
    invalidate: invalidate, invalidateAll: invalidateAll, calcFor: calcFor, curveFor: curveFor,
    bounds: bounds, unmasked: unmasked, fitData: fitData, sigmaFor: sigmaFor, jobFor: jobFor, loadProject: loadProject, setBusy: setBusy, fromRecord: fromRecord
  };
})();
