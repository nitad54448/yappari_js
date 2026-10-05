/*  Application state and event bus.
 *  Events: 'datasets' (list changed), 'selection', 'params' (values / fit flags), 'model', 'settings',
 *          'data' (points changed: mask, delete, noise ...), 'stats' (fit results), 'busy',
 *          'labels' (frequency labels added or removed), 'theme' (light or dark switched)
 *
 *  Dataset: { id, name, f, zr, zi (Float64Array), mask (Uint8Array, 1 = left out of fits only, drawn hollow),
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
             nyqEqual: true, nyqSquare: false, resid: 'abs', phase: 'deg', view3d: 'nyq', useSigma: false, theme: 'system', contrib: false,
             drtMethod: 'tikhonov', drtSource: 'both', drtLambda: -3, drtIter: Math.log10(5e4), drtX: 'f' };   // Gold: 50 000 iterations
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
    if (st) S.settings = cleanSettings(st);
    var ov = load('elements');
    if (ov) Y.elementOverrides = cleanElementOverrides(ov);
    var m = load('model');
    if (m && m.cdc) {
      try { setModel(Y.circuit.parse(m.cdc), { limits: m.limits, shared: m.shared, quiet: true }); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- settings
  // Largest number of points of a simulated or splined spectrum, largest number of Gold iterations (the top of the DRT
  // slider) and range of log10 λ of the DRT. Settings from files and from the browser outside these are not used.
  var LIMITS = { points: 100000, goldIter: 100000, lambdaLog: [-12, 3] };
  function validMaxIter(v) { return Number.isInteger(v) && v >= 1 && v <= 65535; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function oneOf() { var a = Array.prototype.slice.call(arguments); return function (v) { return a.indexOf(v) >= 0; }; }
  function intIn(lo, hi) { return function (v) { return Number.isInteger(v) && v >= lo && v <= hi; }; }
  function numIn(lo, hi) { return function (v) { return typeof v === 'number' && v >= lo && v <= hi; }; }
  function positive(v) { return typeof v === 'number' && v > 0 && v < Infinity; }
  // the values each setting may take (the type is checked against the default as well)
  var VALID = {
    sep: oneOf('auto', 'tab', 'space', 'comma', 'semicolon'),
    method: function (v) { return own(Y.fit.methods, v); },
    weight: function (v) { return own(Y.fit.weightModes, v); },
    maxIter: validMaxIter, tol: positive, simStart: positive, simEnd: positive,
    simPoints: intIn(2, LIMITS.points), maxPlots: intIn(1, Infinity), legendMax: intIn(0, Infinity),
    resid: oneOf('abs', 'rel'), phase: oneOf('deg', 'rad'), theme: oneOf('system', 'light', 'dark'),
    view3d: oneOf('nyq', 'nyqcalc', 'zr', 'zi', 'zrdiff', 'zidiff'),
    drtMethod: oneOf('tikhonov', 'fisk', 'gold'), drtSource: oneOf('both', 're', 'im'), drtX: oneOf('f', 'tau'),
    drtLambda: numIn(LIMITS.lambdaLog[0], LIMITS.lambdaLog[1]), drtIter: numIn(0, Math.log10(LIMITS.goldIter))
  };
  function validSetting(key, v) {
    var d0 = defaults();
    return own(d0, key) && typeof v === typeof d0[key] && !(typeof v === 'number' && !isFinite(v)) && (!own(VALID, key) || VALID[key](v));
  }
  function setSetting(key, val) {
    if (!validSetting(key, val)) return;
    S.settings[key] = val;
    store('settings', S.settings);
    Y.bus.emit('settings', key);
  }
  function replaceSettings(st) { S.settings = cleanSettings(st); store('settings', S.settings); Y.bus.emit('settings', '*'); }
  function resetSettings() { S.settings = defaults(); store('settings', S.settings); Y.bus.emit('settings', '*'); }
  function saveElementOverrides() { store('elements', Y.elementOverrides); }

  // start value and limits of new elements (Settings): ov = {def, min, max, fit} for parameter i of an element kind,
  // missing values taken from the built-in ones. '' when usable, otherwise what is wrong.
  function elementDefaultProblem(kind, i, ov) {
    var b = Y.elements[kind].params[i], o = ov || {};
    var def = o.def != null ? o.def : b.def, min = o.min != null ? o.min : b.min, max = o.max != null ? o.max : b.max;
    if (!(min < max)) return 'min must be below max';
    if (!(def >= min && def <= max)) return 'the start value must lie between min and max';
    return '';
  }
  // overrides from a settings file or the browser: known kinds, finite numbers, true or false for fit; the numbers of
  // a parameter whose start value and limits do not fit together are dropped (its built-in values apply)
  function cleanElementOverrides(o) {
    var out = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    Object.keys(o).forEach(function (k) {
      if (Y.elementKinds.indexOf(k) < 0 || !Array.isArray(o[k])) return;
      out[k] = o[k].slice(0, Y.elements[k].params.length).map(function (e, i) {
        var r = {};
        if (e && typeof e === 'object') {
          ['def', 'min', 'max'].forEach(function (f) { if (typeof e[f] === 'number' && isFinite(e[f])) r[f] = e[f]; });
          if (elementDefaultProblem(k, i, r)) { delete r.def; delete r.min; delete r.max; }
          if (typeof e.fit === 'boolean') r.fit = e.fit;
        }
        return r;
      });
    });
    return out;
  }
  // settings from a file or from the browser: known keys with the type of their default and a valid value (see
  // VALID) replace those of base (the defaults when omitted); the others are ignored. A value of base that is not valid
  // (an older version, an edited file) falls back to the default.
  function cleanSettings(src, base) {
    var st = Object.assign(defaults(), base || {}), d0 = defaults();
    if (src && typeof src === 'object' && !Array.isArray(src)) Object.keys(src).forEach(function (k) {
      if (validSetting(k, src[k])) st[k] = src[k];
    });
    Object.keys(d0).forEach(function (k) { if (!validSetting(k, st[k])) st[k] = d0[k]; });
    return st;
  }

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

  // limits of one parameter that can be used: finite numbers, min below max
  function validLimit(L) { return !!L && typeof L === 'object' && typeof L.min === 'number' && typeof L.max === 'number' && isFinite(L.min) && isFinite(L.max) && L.min < L.max; }

  // opts: {limits, shared} to restore, quiet: no event. Limits that cannot be used (from the browser, an older
  // version ...) are replaced by the defaults of the element.
  function setModel(tree, opts) {
    opts = opts || {};
    var prog = tree ? Y.circuit.compile(tree) : null, old = S.model, limits = {}, shared = {};
    var isObj = function (o) { return !!o && typeof o === 'object' && !Array.isArray(o); };
    var oldL = isObj(opts.limits) ? opts.limits : old.limits, oldS = isObj(opts.shared) ? opts.shared : old.shared;
    if (prog) prog.params.forEach(function (pp) {
      var d = defaultsFor(pp), L = own(oldL, pp.name) ? oldL[pp.name] : null;
      limits[pp.name] = validLimit(L) ? { min: L.min, max: L.max } : { min: d.min, max: d.max };
      shared[pp.name] = own(oldS, pp.name) && oldS[pp.name] != null ? !!oldS[pp.name] : true;
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
               notes: raw.notes ? raw.notes.slice() : [], norm: raw.norm && raw.norm.k > 0 ? Object.assign({}, raw.norm) : null,
               p: raw.p ? Object.assign({}, raw.p) : {}, fit: raw.fit ? Object.assign({}, raw.fit) : {},
               stats: raw.stats || null, calc: null, curve: null, ver: -1 };
    remap(ds);
    return ds;
  }

  // new datasets go to the top of the list (as in Yappari), or just below the dataset opts.after (to the top when it is
  // not in the list); the first new one is selected (opts.selectAll: all of them; opts.select false: selection unchanged)
  function addDatasets(raws, opts) {
    opts = opts || {};
    var made = raws.map(makeDataset);
    if (opts.after) {
      var at = S.datasets.indexOf(opts.after);
      Array.prototype.splice.apply(S.datasets, [at < 0 ? 0 : at + 1, 0].concat(made));
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

  // fit result from Y.fit.run / Y.globalFit (p, se, atBound arrays in circuit order).
  // extra should hold the settings of the submitted job (method, weight, maxIter, tol), so the stored result
  // describes the calculation that was actually run; the current settings are only a fallback.
  function applyResult(ds, res, extra) {
    var nm = names(), se = {}, bound = {};
    nm.forEach(function (n, j) {
      ds.p[n] = res.p[j];
      if (res.se && isFinite(res.se[j])) se[n] = res.se[j];
      if (res.atBound && res.atBound[j]) bound[n] = true;
    });
    ds.stats = Object.assign({ chi2w: res.chi2w, chi2red: res.chi2red, r2: res.r2, n: res.n, iter: res.iter,
                               msg: res.msg, ok: res.ok, se: se, bound: bound,
                               method: S.settings.method, weight: S.settings.weight,
                               maxIter: S.settings.maxIter, tol: S.settings.tol }, extra || {});
    invalidate(ds);
  }

  // settings of a job, recorded with its result
  function jobMeta(job) { return { method: job.method, weight: job.weight, maxIter: job.maxIter, tol: job.tol }; }

  // how the fitted datasets of a list were fitted, from the settings stored with each result:
  // { method, weight, iter: text, mixed: bool, fitted: count }; texts say 'mixed' when they differ
  var WEIGHT_TEXT = { mod: '|Z|  (w = 1/|Z|)', mod2: '|Z|²  (w = 1/|Z|²)', unit: 'equal  (w = 1)', sigma: '1/σ² (measured)' };
  function fitSummary(list) {
    var fitted = list.filter(function (d) { return d.stats && d.stats.chi2w != null; });
    function one(fn) {
      var v = fitted.map(fn).filter(function (x, i, a) { return a.indexOf(x) === i; });
      return !fitted.length ? 'not fitted' : v.length === 1 ? v[0] : 'mixed (' + v.join('; ') + ')';
    }
    var method = one(function (d) { return (Y.fit.methods[d.stats.method] || d.stats.method || '?') + (d.stats.global ? ', global fit' : ''); });
    var weight = one(function (d) { return d.stats.weight === 'sigma' ? '1/σ² (' + (d.stats.sigma || 'measured') + ')' : (WEIGHT_TEXT[d.stats.weight] || d.stats.weight || '?'); });
    var iter = one(function (d) { return (d.stats.maxIter != null ? d.stats.maxIter : '?') + ', ' + (d.stats.tol != null ? d.stats.tol : '?'); });
    return { method: method, weight: weight, iter: iter, fitted: fitted.length };
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
  // Everything is checked and built before anything in memory changes, so a bad file leaves the
  // current circuit, datasets and settings as they were. Returns the prepared project for commitProject.
  var PROJECT_VERSION = 1;
  var STAT_NUM = ['chi2w', 'chi2red', 'r2', 'globalChi2red'];
  function prepareProject(doc) {
    if (!doc || typeof doc !== 'object' || doc.format !== 'yappari-js-project') throw new Error('not a Yappari JS project file');
    if (doc.version != null && !(doc.version >= 1 && doc.version <= PROJECT_VERSION))
      throw new Error('project version ' + doc.version + ' is not supported (this program reads version ' + PROJECT_VERSION + ')');
    function bad(what) { throw new Error('invalid project: ' + what); }
    function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
    function nums(a, n, what, nullOK) {
      if (!Array.isArray(a) || (n != null && a.length !== n)) bad(what + (Array.isArray(a) ? ' has ' + a.length + ' values instead of ' + n : ' is missing'));
      for (var k = 0; k < a.length; k++) {
        var v = a[k];
        if (!(typeof v === 'number' && isFinite(v)) && !(nullOK && v == null)) bad(what + ' value ' + (k + 1) + ' is not a number');
      }
      return a;
    }
    // settings: known keys with the type of the default; anything else keeps the default value
    if (doc.settings != null && !isObj(doc.settings)) bad('settings');
    var settings = cleanSettings(doc.settings);
    // circuit
    var m = doc.model == null ? {} : doc.model, tree = null, prog = null;
    if (!isObj(m)) bad('model');
    if (m.cdc != null && typeof m.cdc !== 'string') bad('circuit');
    if (m.cdc) {
      try { tree = Y.circuit.parse(m.cdc); prog = Y.circuit.compile(tree); }
      catch (e) { throw new Error('invalid circuit "' + m.cdc + '": ' + ((e && e.message) || e)); }
    }
    var limits = m.limits == null ? {} : m.limits, shared = m.shared == null ? {} : m.shared;
    if (!isObj(limits) || !isObj(shared)) bad('limits or shared flags');
    Object.keys(limits).forEach(function (n) {
      var L = limits[n];
      if (!isObj(L) || !(typeof L.min === 'number' && typeof L.max === 'number' && L.min < L.max)) bad('limits of ' + n);
    });
    // datasets
    if (doc.datasets != null && !Array.isArray(doc.datasets)) bad('datasets');
    var raws = (doc.datasets || []).map(function (r, i) {
      var what = 'dataset ' + (i + 1);
      if (!isObj(r)) bad(what);
      var n = nums(r.f, null, what + ': frequencies').length;  // 0 is fine: Delete points can empty a dataset
      r.f.forEach(function (v, k) { if (!(v > 0)) bad(what + ': frequency ' + (k + 1) + ' is not positive'); });
      nums(r.zr, n, what + ': Zr'); nums(r.zi, n, what + ': Zi');
      if (r.mask != null) nums(r.mask, n, what + ': mask');
      if ((r.sr == null) !== (r.si == null)) bad(what + ': only one of the standard-deviation columns');
      if (r.sr != null) { nums(r.sr, n, what + ': sigma Zr', true); nums(r.si, n, what + ': sigma Zi', true); }
      if (r.notes != null) nums(r.notes, null, what + ': labels');
      if (r.name != null && typeof r.name !== 'string') bad(what + ': name');
      ['p', 'fit'].forEach(function (key) { if (r[key] != null && !isObj(r[key])) bad(what + ': ' + key); });
      Object.keys(r.p || {}).forEach(function (pn) { if (!(typeof r.p[pn] === 'number' && isFinite(r.p[pn]))) bad(what + ': parameter ' + pn); });
      if (r.norm != null && !(isObj(r.norm) && r.norm.k > 0 && isFinite(r.norm.k) && /^(factor|area|resist)$/.test(r.norm.type))) bad(what + ': normalization');
      if (r.stats != null && !isObj(r.stats)) bad(what + ': fit statistics');
      // JSON writes NaN as null: statistics come back as NaN, so they are never mistaken for numbers
      var stats = r.stats ? Object.assign({}, r.stats) : null;
      if (stats) STAT_NUM.forEach(function (k) { if (k in stats && stats[k] == null) stats[k] = NaN; });
      return Object.assign({}, r, { stats: stats });
    });
    return { settings: settings, tree: tree, limits: limits, shared: shared, raws: raws };
  }

  // replaces the circuit, datasets and settings with a project from prepareProject (does not throw)
  function commitProject(pj) {
    S.settings = pj.settings;
    store('settings', S.settings);
    S.datasets = []; S.sel.clear();
    setModel(pj.tree, { limits: pj.limits, shared: pj.shared, quiet: true });
    S.datasets = pj.raws.map(makeDataset);
    Y.bus.emit('settings', '*'); Y.bus.emit('model'); Y.bus.emit('datasets');
    selectIds(S.datasets.length ? [S.datasets[0].id] : []);
  }

  function loadProject(doc) { commitProject(prepareProject(doc)); }

  // ---------------------------------------------------------------- normalization of Z (per dataset)
  // ds.norm: null (as measured, Ω), {type: 'factor', k} (unit unchanged), {type: 'area', k: A, A} (Ω·cm²) or
  // {type: 'resist', k: A/L, A, L} (Ω·cm). Z, its standard deviations and the parameters are in these units.
  var ZUNIT = { area: 'Ω·cm²', resist: 'Ω·cm' };
  function zUnit(ds) { return (ds && ds.norm && ZUNIT[ds.norm.type]) || 'Ω'; }
  function zUnitOf(list) {                                  // null when the datasets have different units
    var u = list.length ? zUnit(list[0]) : 'Ω';
    return list.every(function (d) { return zUnit(d) === u; }) ? u : null;
  }
  // a parameter unit (as listed in elements.js) in the units of this dataset
  function unitFor(u, ds) {
    var t = ds && ds.norm && ds.norm.type, L = t === 'area' ? 'cm²' : t === 'resist' ? 'cm' : '';
    if (!L || !u) return u;
    if (u.indexOf('Ω') >= 0) return u.replace('Ω', 'Ω·' + L);
    if (/^H/.test(u)) return u.replace(/^H/, 'H·' + L);
    if (/^F/.test(u)) return u + '·' + (L === 'cm²' ? 'cm⁻²' : 'cm⁻¹');
    return u;
  }
  function baseUnit(name) {
    var pp = S.model.prog && S.model.prog.params.filter(function (q) { return q.name === name; })[0];
    if (pp) return pp.unit || '';
    var m = /^([A-Za-z]+?)(\d+)(_\w+)?$/.exec(name), E = m && Y.elements[m[1]];
    var q = E && E.params.filter(function (x) { return x.suffix === (m[3] || ''); })[0];
    return q ? q.unit : '';
  }
  function paramUnit(name, ds) { return unitFor(baseUnit(name), ds); }
  function num4(v) { return String(+(+v).toPrecision(4)); }
  function normText(norm) {
    if (!norm) return 'as measured (Ω)';
    if (norm.type === 'area') return 'Z × A with A = ' + num4(norm.A) + ' cm² (Ω·cm²)';
    if (norm.type === 'resist') return 'Z × A / L with A = ' + num4(norm.A) + ' cm², L = ' + num4(norm.L) + ' cm (Ω·cm)';
    return 'Z × ' + num4(norm.k) + ' (correction factor, unit unchanged)';
  }
  // Z = measured Z × k. A new normalization replaces the previous one; parameters (and the remembered values of
  // removed elements) are converted so the model still matches: Ω and H × r, F ÷ r, the others unchanged.
  function normalize(ds, norm) {
    var r = (norm ? norm.k : 1) / (ds.norm ? ds.norm.k : 1);
    if (!(r > 0) || !isFinite(r)) throw new Error('the factor must be positive');
    if (r !== 1) {
      Y.dataops.scaleZ(ds, r);
      function scaled(n, v) { var u = baseUnit(n); return /Ω|^H/.test(u) ? v * r : /^F/.test(u) ? v / r : v; }
      Object.keys(ds.p).forEach(function (n) { ds.p[n] = scaled(n, ds.p[n]); });
      if (ds.mem) {                     // remembered entries are [value, fit flag]; new pairs, so undo records stay intact
        var mem = {};
        Object.keys(ds.mem).forEach(function (n) { var e = ds.mem[n]; mem[n] = e ? [scaled(n, e[0]), e[1]] : e; });
        ds.mem = mem;
      }
      if (ds.stats && ds.stats.chi2w != null) {               // 1/|Z|² and 1/σ² weights leave χ² unchanged
        var w = ds.stats.weight, c = w === 'unit' ? r * r : w === 'mod' ? r : 1;
        ds.stats = Object.assign({}, ds.stats, { chi2w: ds.stats.chi2w * c, chi2red: ds.stats.chi2red * c },
                                 ds.stats.globalChi2red != null ? { globalChi2red: ds.stats.globalChi2red * c } : {});
      }
    }
    ds.norm = norm ? Object.assign({}, norm) : null;
    invalidate(ds);
  }

  // dataset rebuilt from a history record (arrays copied, so the record stays intact)
  function fromRecord(r) {
    return { id: r.id, name: r.name, norm: r.norm ? Object.assign({}, r.norm) : null, f: Float64Array.from(r.f), zr: Float64Array.from(r.zr), zi: Float64Array.from(r.zi), mask: Uint8Array.from(r.mask),
             sr: r.sr ? Float64Array.from(r.sr) : null, si: r.si ? Float64Array.from(r.si) : null, notes: r.notes.slice(),
             p: Object.assign({}, r.p), fit: Object.assign({}, r.fit), mem: r.mem ? Object.assign({}, r.mem) : undefined,
             stats: r.stats, calc: null, curve: null, ver: -1 };
  }

  function setBusy(b) { S.busy = b; Y.bus.emit('busy', b); }

  return {
    S: S, defaults: defaults, cleanSettings: cleanSettings, validSetting: validSetting, LIMITS: LIMITS, restore: restore, store: store, load: load,
    setSetting: setSetting, resetSettings: resetSettings, replaceSettings: replaceSettings, saveElementOverrides: saveElementOverrides,
    elementDefaultProblem: elementDefaultProblem, cleanElementOverrides: cleanElementOverrides,
    names: names, setModel: setModel, setLimit: setLimit, setShared: setShared,
    makeDataset: makeDataset, addDatasets: addDatasets, byId: byId, removeDatasets: removeDatasets, clearAll: clearAll,
    rename: rename, move: move,
    selectIds: selectIds, toggle: toggle, range: range, selectAll: selectAll, selected: selected, first: first,
    vector: vector, setParam: setParam, setFit: setFit, copyParams: copyParams, applyResult: applyResult,
    invalidate: invalidate, invalidateAll: invalidateAll, calcFor: calcFor, curveFor: curveFor,
    bounds: bounds, unmasked: unmasked, fitData: fitData, sigmaFor: sigmaFor, jobFor: jobFor, jobMeta: jobMeta, fitSummary: fitSummary, loadProject: loadProject, prepareProject: prepareProject, commitProject: commitProject, setBusy: setBusy, fromRecord: fromRecord,
    zUnit: zUnit, zUnitOf: zUnitOf, unitFor: unitFor, paramUnit: paramUnit, normText: normText, normalize: normalize
  };
})();
