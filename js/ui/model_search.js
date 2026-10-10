/* Catalogue search: bounded memory, seeded data-informed random starts plus a refinement per model, cancellable worker fits.
 * Starts: each element gets values that make it visible in the measured window (a random frequency inside the data
 * range and a random |Z| around the measured ones), drawn from a generator seeded per circuit, so a search with the same
 * seed gives the same starts whatever the batch order or the number of workers. Starts run in rounds of four; a circuit
 * stops early once two starts reach the same minimum.
 * Converged fits are kept; parameters at a limit or with a large standard error are noted in the table (and can be
 * discarded by the user), since a poorly determined parameter does not make the circuit wrong. */
Y.modelSearch = (function () {
  'use strict';
  var kinds = ['R', 'C', 'L', 'Q', 'W', 'Wo', 'Ws', 'G', 'HN'];
  var ROUND = 4, START_CHOICES = [4, 8, 16, 32], DEFAULT_STARTS = 8, SAME_MIN = 1e-6;
  function why() {
    if (Y.state.S.busy) return 'A calculation is running.';
    if (Y.app.fitMode() !== 'single') return 'Use Individual fit mode.';
    if (Y.state.selected().length !== 1) return 'Select exactly one dataset.';
    return '';
  }
  function candidate(cdc, allowed, count) {
    var tree = Y.circuit.parse(cdc), els = Y.circuit.elements(tree);
    if (els.length !== count || els.some(function (e) { return !allowed[e.k]; })) return null;
    return { tree: tree, prog: Y.circuit.compile(tree), elements: els.length, canon: Y.modelRank.canon(tree), key: Y.modelRank.elementKey(tree) };
  }

  // ---------------------------------------------------------------- seeded random numbers
  // mulberry32: small, fast, good enough for start values; one stream per circuit from (seed, code)
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function streamFor(seed, cdc) {
    var h = (seed >>> 0) ^ 0x9E3779B9;
    for (var i = 0; i < cdc.length; i++) { h = Math.imul(h ^ cdc.charCodeAt(i), 0x01000193); h ^= h >>> 13; }
    return mulberry32(h >>> 0);
  }

  // ---------------------------------------------------------------- start values
  // the window the data cover: angular frequencies and |Z| (unmasked points)
  function dataRanges(data) {
    var wmin = Infinity, wmax = 0, zmin = Infinity, zmax = 0;
    for (var k = 0; k < data.f.length; k++) {
      var w = 2 * Math.PI * data.f[k], z = Math.hypot(data.zr[k], data.zi[k]);
      if (w > 0 && isFinite(w)) { wmin = Math.min(wmin, w); wmax = Math.max(wmax, w); }
      if (z > 0 && isFinite(z)) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    }
    if (!(wmax > 0)) { wmin = 1; wmax = 1e6; }
    if (!(zmax > 0)) { zmin = 1; zmax = 1e3; }
    if (wmin === wmax) { wmin /= 10; wmax *= 10; }
    return { wmin: wmin, wmax: wmax, zmin: zmin / 30, zmax: zmax * 10 };
  }
  function logUniform(rng, a, b) { return Math.exp(Math.log(a) + rng() * (Math.log(b) - Math.log(a))); }
  // value of parameter pi of an element whose impedance has magnitude ~z at angular frequency w (el holds the draws)
  function guess(kind, pi, el) {
    var w = el.w, z = el.z;
    switch (kind) {
      case 'R': return z;
      case 'C': return 1 / (w * z);
      case 'L': return z / w;
      case 'Q': return pi ? el.n : 1 / (z * Math.pow(w, el.n));
      case 'W': return z * Math.sqrt(w / 2);
      case 'Wo': case 'Ws': return pi ? 1 / Math.sqrt(el.w2) : z * Math.sqrt(w / 2);
      case 'G': return pi ? 1 / w : z;
      case 'HN': return [z, 1 / w, el.n, el.b][pi];
    }
    return NaN;
  }
  // start values of one circuit: every element visible in the measured window, inside its limits
  function startValues(c, rng, ranges) {
    var p = [], lo = [], hi = [], el = null;
    c.prog.params.forEach(function (pp) {
      var d = Y.paramDefault(pp.kind, pp.pi), a = d.min, b = d.max;
      if (!isFinite(a) || !isFinite(b) || !(a < b)) throw new Error('Invalid bounds for ' + pp.name);
      if (pp.pi === 0) el = { w: logUniform(rng, ranges.wmin, ranges.wmax), w2: logUniform(rng, ranges.wmin, ranges.wmax),
                              z: logUniform(rng, ranges.zmin, ranges.zmax), n: 0.6 + 0.4 * rng(), b: 0.5 + 0.5 * rng() };
      var v = guess(pp.kind, pp.pi, el);
      if (!isFinite(v)) v = d.scale === 'log' && a > 0 ? logUniform(rng, a, b) : a + rng() * (b - a);
      lo.push(a); hi.push(b); p.push(Math.min(b, Math.max(a, v)));
    });
    return { p: p, lo: lo, hi: hi };
  }
  // count fit jobs of a circuit (random: a generator, or Math.random; ranges: dataRanges(data))
  function jobs(c, data, settings, random, count, ranges) {
    random = random || Math.random; count = count || ROUND; ranges = ranges || dataRanges(data);
    return Array.from({ length: count }, function (_, start) {
      var s = startValues(c, random, ranges);
      return Object.assign({}, data, settings, { id: start, cdc: c.prog.cdc, p: Float64Array.from(s.p),
        lo: Float64Array.from(s.lo), hi: Float64Array.from(s.hi), fit: new Uint8Array(s.p.length).fill(1), hessian: true });
    });
  }

  // ---------------------------------------------------------------- quality of a fit
  // Core fit.se stores relative standard errors in percent, not absolute errors.
  // reject: why the fit cannot be ranked (failed, not converged) or is discarded by the user's filters
  // (filters.bounds: a parameter at a limit; filters.se: a standard error above filters.maxSE %). notes: what is weak.
  function quality(c, result, filters) {
    filters = filters || {};
    var names = c.prog.names, n = names.length, maxSE = filters.maxSE > 0 ? filters.maxSE : 50, notes = [];
    if (!result || !result.ok || !result.p || result.p.length !== n || Array.from(result.p).some(function (p) { return !isFinite(p); }))
      return { reject: 'failed or non-finite fit', notes: notes };
    if (!/^converged/.test(result.msg || '')) return { reject: 'not converged', notes: notes };
    if (!result.atBound || result.atBound.length !== n || !result.se || result.se.length !== n)
      return { reject: 'missing fit diagnostics', notes: notes };
    var atLimit = [], poor = [], undetermined = [];
    for (var j = 0; j < n; j++) {
      if (result.atBound[j]) { atLimit.push(names[j]); continue; }
      var se = result.se[j];
      if (!isFinite(se) || se < 0) undetermined.push(names[j]);
      else if (se > maxSE) poor.push(names[j] + ' ' + (se >= 1000 ? '>1000' : se.toPrecision(2)) + '%');
    }
    if (atLimit.length) notes.push('at limit: ' + atLimit.join(', '));
    if (undetermined.length) notes.push('no SE: ' + undetermined.join(', '));
    if (poor.length) notes.push('SE > ' + maxSE + '%: ' + poor.join(', '));
    var reject = filters.bounds && atLimit.length ? 'parameter at a limit' :
      filters.se && (poor.length || undetermined.length) ? 'standard error above ' + maxSE + '%' : '';
    return { reject: reject, notes: notes };
  }
  function unreliable(c, result, filters) { return quality(c, result, filters).reject; }
  function refinementJob(job, result) {
    return Object.assign({}, job, { id: 'refinement', p: Float64Array.from(result.p) });
  }


  // ---------------------------------------------------------------- figure of merit
  // opts.mode: 'bayes' (evidence × literature prior, Y.modelRank; needs opts.priors and opts.ranges) or 'bic' (default)
  function scoring(data, weight, penalty, opts) {
    var n = data.f.length, sigma = data.sr && data.si && data.sr.length === n && data.si.length === n;
    var wr = new Float64Array(n), wi = new Float64Array(n), energy = 0;
    var weights = sigma ? null : Y.fit.weights(data.zr, data.zi, weight);
    for (var i = 0; i < n; i++) {
      if (sigma && (!(data.sr[i] > 0) || !(data.si[i] > 0) || !isFinite(data.sr[i]) || !isFinite(data.si[i])))
        throw new Error('Sigma values must be positive and finite.');
      wr[i] = sigma ? 1 / data.sr[i] : Math.sqrt(weights[i]);
      wi[i] = sigma ? 1 / data.si[i] : Math.sqrt(weights[i]);
      var r = data.zr[i] * wr[i], v = data.zi[i] * wi[i]; energy += r * r + v * v;
    }
    if (!isFinite(energy)) throw new Error('Weighted data exceed numeric range; rescale the dataset.');
    opts = opts || {};
    return { wr: wr, wi: wi, sigma: !!sigma, energy: energy > 0 ? energy : 1, penalty: penalty == null ? 1 : penalty,
             mode: opts.mode === 'bayes' ? 'bayes' : 'bic', priors: opts.priors || Y.modelRank.builtin(), ranges: opts.ranges || dataRanges(data) };
  }
  // entry of one fit: score (BIC form, higher is better), lw (log weight used for ranking and probabilities: log posterior,
  // or score/2 for BIC, both approximations of ln evidence), rms (%), the model curve relative to |Z| (to find equivalent circuits)
  function assess(c, result, data, metric) {
    if (!result.ok || !result.p || Array.from(result.p).some(function (p) { return !isFinite(p); })) return null;
    metric = metric || scoring(data, 'mod2', 1);
    var n = data.f.length, z = Y.circuit.impedance(c.prog, data.f, result.p), sum = 0, weighted = 0, samples = [], curve = new Float64Array(2 * n);
    var step = Math.max(1, Math.ceil(n / 128));
    for (var i = 0; i < n; i++) {
      var scale = Math.max(Math.hypot(data.zr[i], data.zi[i]), 1e-30);
      var r = (z.re[i] - data.zr[i]) / scale, v = (z.im[i] - data.zi[i]) / scale;
      if (!isFinite(r) || !isFinite(v)) return null;
      curve[2 * i] = z.re[i] / scale; curve[2 * i + 1] = z.im[i] / scale;
      sum += r * r + v * v;
      var rw = (z.re[i] - data.zr[i]) * metric.wr[i], iw = (z.im[i] - data.zi[i]) * metric.wi[i];
      weighted += rw * rw + iw * iw;
      if (i % step === 0 || i === n - 1) samples.push([Math.log10(data.f[i]), 100 * r, 100 * v]);
    }
    samples.sort(function (a, b) { return a[0] - b[0]; });
    var m = 2 * n, mse = sum / m;
    if (!isFinite(weighted)) return null;
    // Known sigma: Gaussian deviance. Otherwise estimate a common weighted noise scale.
    // Weighted data energy is constant across models; normalizing it makes display unit-invariant.
    var loss = metric.sigma ? weighted : m * Math.log(Math.max(weighted / metric.energy, 1e-24));
    var score = -loss - (c.prog.names.length + metric.penalty * c.elements) * Math.log(m);
    var e = { cdc: c.prog.cdc, elements: c.elements, parameters: c.prog.names.length, score: score, lw: score / 2,
      rms: 100 * Math.sqrt(mse), samples: samples, result: result, chi2: weighted, curve: curve, key: c.key || '', canon: c.canon || '' };
    if (metric.mode === 'bayes') {
      var ev = Y.modelRank.evidence({ prog: c.prog, p: result.p, jtj: result.jtj, chi2: weighted, m: m, sigma: metric.sigma, energy: metric.energy },
                                    metric.priors, metric.ranges);
      e.weight = Y.modelRank.weightOf(metric.priors, e.canon);
      e.lnZ = ev ? ev.lnZ : (score + metric.penalty * c.elements * Math.log(m)) / 2;   // no curvature: BIC approximation
      e.lw = e.weight > 0 ? e.lnZ + Math.log(e.weight) : -Infinity;
    } else e.lnZ = e.lw;
    return e;
  }
  // the same worker budget as ordinary fits (Y.pool.size)
  function workerCount() { return Y.pool && Y.pool.size ? Y.pool.size() : Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1)); }
  // rows: classes of equivalent circuits (Y.modelRank.addEntry); the representative gives the shown values
  function displayRows(rows, key, ascending) {
    var direction = ascending ? 1 : -1;
    function val(cl) {
      var r = cl.rep;
      switch (key) {
        case 'rank': return rows.indexOf(cl);
        case 'cdc': return r.cdc;
        case 'equiv': return cl.members.length;
        case 'prob': case 'score': return cl.lw;
        case 'prior': return r.weight == null ? 0 : r.weight;
        case 'status': return r.result.msg;
        case 'notes': return (r.notes || []).join('; ');
        case 'hits': return (r.hits || 0) / (r.starts || 1);
        case 'residuals': return r.rms;
        default: return r[key];
      }
    }
    return rows.slice().sort(function (a, b) {
      var av = val(a), bv = val(b);
      return direction * (typeof av === 'string' ? av.localeCompare(bv) : av - bv) || b.lw - a.lw;
    });
  }
  // a circuit being searched: its starts, the best fit, how many starts reached it, the best fit kept for the table
  function newItem(c, seed) { return { c: c, rng: streamFor(seed, c.prog.cdc), started: 0, job0: null, best: null, hits: 0, kept: null, done: false }; }
  // one more fit of the item: the best minimum and the number of starts that reached it (relative χ² within SAME_MIN);
  // refined: the refinement of the best fit, which is not an independent start
  function consider(item, entry, q, refined) {
    if (!entry) return;
    var b = item.best;
    if (!b || entry.chi2 < b.chi2 * (1 - SAME_MIN)) { item.best = entry; item.hits = refined && b ? item.hits : 1; }
    else if (entry.chi2 <= b.chi2 * (1 + SAME_MIN)) { if (!refined) item.hits++; if (entry.lw > b.lw) item.best = entry; }
    if (q && !q.reject && (!item.kept || entry.lw > item.kept.lw)) { entry.notes = q.notes; item.kept = entry; }
  }
  function plot(canvas, samples) {
    var ctx = canvas.getContext('2d'); if (!ctx) return;
    canvas.width = 340; canvas.height = 110;
    var xs = samples.map(function (s) { return s[0]; }), xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var peak = Math.max(0.01, Math.max.apply(null, samples.map(function (s) { return Math.max(Math.abs(s[1]), Math.abs(s[2])); })));
    var power = Math.pow(10, Math.floor(Math.log10(peak))), ymax = Math.ceil(peak / power) * power;
    // colours and font from style.css (Y.theme): axis text, grid, and the report colours of Zr and Zi
    var th = Y.theme && Y.theme.get ? Y.theme.get() : null, colZr = th ? th.reportZr : '#2457a6', colZi = th ? th.reportZi : '#d1495b';
    ctx.font = '12px ' + (th ? th.font : 'sans-serif'); ctx.fillStyle = th ? th.ink2 : '#52606d'; ctx.strokeStyle = th ? th.axis : '#9aa5b1';
    [-1, 0, 1].forEach(function (v) {
      var y = 44 - 32 * v; ctx.beginPath(); ctx.moveTo(65, y); ctx.lineTo(328, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText((v * ymax).toPrecision(2) + '%', 61, y + 4);
    });
    ctx.textAlign = 'center';
    [0, .5, 1].forEach(function (fraction) {
      var x = 65 + 263 * fraction, logf = xmin + fraction * (xmax - xmin);
      ctx.beginPath(); ctx.moveTo(x, 76); ctx.lineTo(x, 81); ctx.stroke();
      ctx.fillText(Math.pow(10, logf).toPrecision(2), x, 94);
    });
    ctx.fillText('Frequency (Hz, log scale)', 196, 108);
    [1, 2].forEach(function (j) {
      ctx.strokeStyle = j === 1 ? colZr : colZi; ctx.beginPath();
      samples.forEach(function (s, i) { var x = 65 + 263 * (s[0] - xmin) / (xmax - xmin || 1), y = 44 - 32 * s[j] / ymax;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    });
    canvas.title = 'Residuals / |Z| (%), log frequency; blue Zr, red Zi. Range ±' + ymax.toPrecision(3) + '%';
  }
  function num(v) { v = String(v == null ? '' : v).trim().replace(',', '.'); return v === '' ? NaN : Number(v); }
  function pct(x) { return !(x > 0) ? '0' : x >= 99.95 ? '100' : x >= 10 ? x.toFixed(1) : x >= 0.01 ? x.toPrecision(2) : '<0.01'; }
  // catalog/priors.txt (editable literature prior); the built-in parameter priors and a uniform circuit prior without it
  async function loadPriors(signal) {
    try {
      var response = await fetch('catalog/priors.txt', { signal: signal });
      if (response.ok) return Y.modelRank.parsePriors(await response.text());
    } catch (e) { if (e && e.name === 'AbortError') throw e; }
    var pr = Y.modelRank.builtin(); pr.warnings.push('catalog/priors.txt not found: uniform circuit prior'); return pr;
  }
  async function open() {
    var reason = why(); if (reason) { Y.ui.toast(reason); return; }
    var setup = document.createElement('div'), seed0 = Math.floor(Math.random() * 1e9);
    setup.innerHTML = '<label>Maximum elements <select class="search-max">' + Array.from({ length: 7 }, function (_, i) {
      return '<option' + (i === 4 ? ' selected' : '') + '>' + (i + 1) + '</option>'; }).join('') + '</select></label><p>Allowed circuit elements</p><div class="search-kinds">' + kinds.map(function (k) {
      return '<label><input type="checkbox" value="' + k + '" checked> ' + k + '</label>'; }).join(' ') + '</div>' +
      '<p><label>Ranking <select class="search-mode"><option value="bayes" selected>Bayesian: evidence × literature prior (catalog/priors.txt)</option>' +
      '<option value="bic">BIC: fit + complexity penalty</option></select></label></p>' +
      '<p><label>BIC element penalty λ <input class="search-penalty" type="range" min="0" max="10" step="0.25" value="1" disabled> <output class="search-penalty-value">1</output></label></p>' +
      '<p><label>Random starts per circuit <select class="search-starts">' + START_CHOICES.map(function (n) {
        return '<option' + (n === DEFAULT_STARTS ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label> ' +
      '<label>Seed <input class="search-seed" inputmode="numeric" size="11" value="' + seed0 + '"></label></p>' +
      '<p class="hint">Starts are drawn inside the measured frequency and |Z| window, in rounds of 4; a circuit stops early once two starts reach the same minimum. The same seed gives the same starts.</p>' +
      '<p>Discard circuits with <label><input type="checkbox" class="search-drop-bounds"> a parameter at a limit</label> ' +
      '<label><input type="checkbox" class="search-drop-se"> a standard error above</label> <input class="search-maxse" inputmode="decimal" size="4" value="50"> %</p>' +
      '<p class="search-error" role="alert"></p>';
    setup.querySelector('.search-penalty').oninput = function () { setup.querySelector('.search-penalty-value').textContent = this.value; };
    var modeSel = setup.querySelector('.search-mode');
    if (modeSel) modeSel.onchange = function () { setup.querySelector('.search-penalty').disabled = modeSel.value !== 'bic'; };
    function fail(msg) { setup.querySelector('.search-error').textContent = msg; return false; }
    setup.className = 'search-setup';
    var ok = await Y.ui.modal({ title: 'Search models', body: setup, wide: true, buttons: [{ label: 'Cancel' }, { label: 'Search', primary: true, value: true,
      onClick: function () {
        if (!setup.querySelector('.search-kinds input[type=checkbox]:checked')) return fail('Select at least one element.');
        var penalty = Number(setup.querySelector('.search-penalty').value);
        if (!isFinite(penalty) || penalty < 0 || penalty > 10 || setup.querySelector('.search-penalty').value.trim() === '') return fail('Element penalty must be from 0 to 10.');
        var sd = setup.querySelector('.search-seed').value.trim();
        if (!/^\d{1,10}$/.test(sd) || Number(sd) > 4294967295) return fail('Seed must be a whole number from 0 to 4294967295.');
        var mx = num(setup.querySelector('.search-maxse').value);
        if (!(mx > 0 && isFinite(mx))) return fail('The standard-error limit must be a positive number.');
      } }] });
    if (!ok || why()) return;
    var max = Number(setup.querySelector('.search-max').value), allowed = {};
    setup.querySelectorAll('.search-kinds input[type=checkbox]:checked').forEach(function (e) { allowed[e.value] = true; });
    var mode = modeSel && modeSel.value === 'bic' ? 'bic' : 'bayes';
    var nStarts = Number(setup.querySelector('.search-starts').value), seed = Number(setup.querySelector('.search-seed').value.trim()) >>> 0;
    var filters = { bounds: setup.querySelector('.search-drop-bounds').checked, se: setup.querySelector('.search-drop-se').checked,
                    maxSE: num(setup.querySelector('.search-maxse').value) };
    var ds = Y.state.selected()[0], data = Y.state.fitData(ds), st = Y.state.S.settings;
    if (!data.f.length || Array.from(data.f).some(function (f) { return !(f > 0) || !isFinite(f); })) {
      Y.ui.toast('Search needs unmasked data with positive finite frequencies.'); return;
    }
    var penalty = mode === 'bic' ? Number(setup.querySelector('.search-penalty').value) : 0, ranges = dataRanges(data), metric;
    try { metric = scoring(data, st.weight, penalty, { mode: mode, ranges: ranges }); }
    catch (e) { Y.ui.toast(e.message); return; }
    var settings = { method: st.method, weight: st.weight, maxIter: st.maxIter, tol: st.tol };
    var rows = [], selected = null, stopped = false, closed = false, active = null, controller = new AbortController(), logOther = -Infinity;
    function sink(lw) { logOther = Y.modelRank.logAddExp(logOther, lw); }
    var activeModels = [], priorText = '';
    var scanned = 0, fitted = 0, invalid = 0, excluded = 0, attempts = 0, early = 0, rejected = 0, total = null, workers = workerCount(), label = 'Loading catalogue', dirty = true;
    var sortKey = 'score', ascending = false;
    var body = document.createElement('div');
    // [key, title, class of the column (style.css: c-num right-aligned, c-code circuit codes …)]
    var columns = [['rank', 'Rank', 'c-num'], ['cdc', 'Circuit', 'c-code'], ['equiv', 'Equivalent', 'c-eq'], ['elements', 'Elements', 'c-num'], ['parameters', 'Parameters', 'c-num'],
                   ['prob', 'P %', 'c-num c-prob'], ['score', 'Δ ln P', 'c-num'], ['prior', 'Prior', 'c-num'], ['rms', 'RMS %', 'c-num'], ['hits', 'Same minimum', 'c-num'],
                   ['status', 'Fit status', 'c-status'], ['notes', 'Notes', 'c-notes'], ['residuals', 'Residuals', 'c-res']];
    body.innerHTML = '<p class="search-status" role="status"></p><progress class="search-progress" aria-label="Model search progress"></progress><p class="search-count"></p>' +
      '<p>' + (mode === 'bayes' ? 'Ranked by posterior probability: Laplace evidence of the fit (fit quality and an Occam factor for each parameter, against priors scaled to the measured window) × literature prior of the circuit (Prior: its weight in catalog/priors.txt). ' :
        'Ranked by BIC (fit weighting, ln m per parameter and λ ln m per element); P % from BIC weights. ') +
      'P % is relative to all circuits searched (equivalent ones counted once); Δ ln P against the best. Equivalent: circuits with the same elements whose model curves differ by less than ' + (100 * Y.modelRank.EQUIV) + '% of the residuals (they cannot be told apart on these data) are one row, ranked as one model (highest prior of its forms, mean evidence); choose one in the list to apply it. ' +
      'Up to ' + nStarts + ' starts per circuit (seed ' + seed + ') + one refinement, with your fit settings. Notes: parameters at a limit or with a standard error above ' + filters.maxSE + '%' +
      (filters.bounds || filters.se ? '; circuits with ' + [filters.bounds ? 'a parameter at a limit' : '', filters.se ? 'such a standard error' : ''].filter(Boolean).join(' or ') + ' are discarded' : '') +
      '. Same minimum: starts that reached the best fit. Residuals: blue Zr, red Zi, normalized by |Z|. Click a row to select it; click a column title to sort.</p>' +
      '<div class="search-scroll"><table class="search-results"><thead><tr>' + columns.map(function (c) {
      return '<th data-sort="' + c[0] + '" class="' + c[2] + '"><button type="button">' + c[1] + '</button></th>'; }).join('') + '</tr></thead><tbody></tbody></table></div>';
    body.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.querySelector('button').onclick = function () {
        var key = th.getAttribute('data-sort'); ascending = sortKey === key ? !ascending : ['score', 'prob', 'prior'].indexOf(key) < 0; sortKey = key; dirty = true; render();
      };
    });
    var buttons, timer;
    function retain(item) {
      var e = item.kept;
      if (!e) return;
      e.hits = e === item.best ? item.hits : 1; e.starts = item.started; e.lo = item.job0.lo; e.hi = item.job0.hi;
      if (Y.modelRank.addEntry(rows, e, 100, sink)) dirty = true;
    }
    function stop() { stopped = true; controller.abort(); if (active) active.cancel(); activeModels.forEach(retain); label = 'Stopped — results retained'; dirty = true; render(); }
    function render() {
      if (closed) return;
      body.querySelector('.search-status').textContent = label + ' · ' + scanned + ' models scanned · ' + fitted + ' circuits fitted · ' + attempts + ' fits completed · ' +
        early + ' stopped early (same minimum twice) · ' + invalid + ' invalid/skipped · ' + (excluded ? excluded + ' excluded (prior weight 0) · ' : '') +
        rejected + ' rejected (no converged fit' + (filters.bounds || filters.se ? ', or discarded by your filters' : '') + ') · ' + workers + ' workers' + (priorText ? ' · ' + priorText : '');
      var progress = body.querySelector('.search-progress');
      if (total !== null) { progress.max = Math.max(1, total); progress.value = total ? fitted : 1; }
      body.querySelector('.search-count').textContent = total === null ? 'Counting eligible models…' : fitted + ' / ' + total + ' models done · ' + (total - fitted) + ' remaining · ' + attempts + ' fits';
      if (buttons) { buttons[0].disabled = stopped; buttons[2].disabled = rows.indexOf(selected) < 0; }
      if (!dirty) return; dirty = false;
      var table = body.querySelector('tbody'); table.textContent = '';
      body.querySelectorAll('th[data-sort]').forEach(function (th) {
        var key = th.getAttribute('data-sort'), col = columns.find(function (c) { return c[0] === key; });
        th.setAttribute('aria-sort', key === sortKey ? (ascending ? 'ascending' : 'descending') : 'none');
        th.querySelector('button').textContent = col[1] + (key === sortKey ? (ascending ? ' ↑' : ' ↓') : '');
      });
      var best = rows.length ? rows[0].lw : 0, logTotal = Y.modelRank.logTotal(rows, logOther);
      displayRows(rows, sortKey, ascending).forEach(function (cl) {
        var r = cl.rep, tr = document.createElement('tr'); tr.tabIndex = 0; tr.className = cl === selected ? 'selected' : '';
        tr.setAttribute('aria-selected', String(cl === selected));
        function cell(text, title) { var td = document.createElement('td'); td.textContent = text; if (title) td.title = title; td.className = columns[tr.children.length][2]; tr.appendChild(td); return td; }
        cell(rows.indexOf(cl) + 1); cell(r.cdc);
        var eq = cell(cl.members.length > 1 ? '' : '—');
        if (cl.members.length > 1) {
          var sel = document.createElement('select');
          sel.setAttribute('aria-label', 'Equivalent circuits of ' + r.cdc);
          cl.members.forEach(function (m) {
            var o = document.createElement('option'); o.value = m.cdc;
            o.textContent = m.cdc + (m === r ? '' : ' (Δ ln P ' + (m.lw - r.lw).toFixed(1) + ')'); o.selected = m.cdc === (cl.pick || r.cdc); sel.appendChild(o);
          });
          sel.onchange = function () { cl.pick = sel.value; selected = cl; dirty = true; };
          sel.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); };
          eq.appendChild(sel);
        }
        cell(r.elements); cell(r.parameters);
        cell(pct(100 * Math.exp(cl.lw - logTotal)));
        cell((cl.lw - best).toFixed(1), mode === 'bayes' && r.lnZ != null ? 'ln evidence ' + r.lnZ.toFixed(1) + ', ln prior ' + (r.weight > 0 ? Math.log(r.weight).toFixed(2) : '−∞') : '');
        cell(mode === 'bayes' ? String(r.weight) : '—', mode === 'bayes' ? ((Y.modelRank && metric.priors.circuits[r.canon]) ? 'Listed in catalog/priors.txt: ' + (metric.priors.circuits[r.canon].note || metric.priors.circuits[r.canon].code) : 'Not listed: default weight') : '');
        cell(r.rms.toPrecision(4)); cell((r.hits || 0) + ' / ' + (r.starts || 0)); cell(r.result.msg); cell((r.notes || []).join('; '));
        var td = document.createElement('td'); td.className = 'c-res';
        var canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Zr and Zi relative residuals'); td.appendChild(canvas); tr.appendChild(td); plot(canvas, r.samples);
        function choose() { selected = cl; dirty = true; render(); }
        tr.onclick = choose; tr.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }; table.appendChild(tr);
      });
    }
    Y.state.setBusy(true);
    var dialog = Y.ui.modal({ title: 'Model search results', size: 'xl', body: body, buttons: [
      { label: 'Stop', close: false, onClick: stop }, { label: 'Cancel', value: null },
      { label: 'Apply circuit', primary: true, value: 'apply', onClick: function () {
        if (rows.indexOf(selected) < 0) return false; stop(); } }],
      onOpen: function (b) { var dlg = b.closest('dialog'); dlg.classList.add('search-dialog'); buttons = dlg.querySelectorAll('.btns button'); render(); } });
    timer = setInterval(render, 400);
    async function run() {
      try {
        if (mode === 'bayes') {
          metric.priors = await loadPriors(controller.signal);
          priorText = 'priors: ' + metric.priors.source + ' (' + metric.priors.listed + ' circuits listed, default weight ' + metric.priors.defaultWeight + ')' +
            (metric.priors.warnings.length ? ', ' + metric.priors.warnings.length + ' warning(s): ' + metric.priors.warnings.slice(0, 3).join('; ') : '');
        }
        var catalogue = [];
        // Count and filter before fitting so the progress denominator stays exact.
        for (var n = 1; n <= max && !stopped; n++) {
          var name = 'models_' + n + '_elements';
          var response = await fetch('catalog/' + name + '.txt', { signal: controller.signal });
          if (response.status === 404) response = await fetch('catalog/' + name, { signal: controller.signal });
          if (!response.ok) throw new Error('Cannot read catalog/' + name + '.txt (' + response.status + ')');
          var lines = (await response.text()).split(/\r?\n/);
          for (var i = 0; i < lines.length && !stopped; i++) {
            var cdc = lines[i].trim(); if (!cdc || cdc[0] === '#') continue;
            scanned++;
            if (scanned % 250 === 0) await new Promise(function (r) { setTimeout(r, 0); });
            if (stopped) break;
            try {
              var c = candidate(cdc, allowed, n);
              if (!c) continue;
              if (c.prog.names.length >= 2 * data.f.length) { invalid++; continue; }
              if (mode === 'bayes' && !(Y.modelRank.weightOf(metric.priors, c.canon) > 0)) { excluded++; continue; }
              catalogue.push({ cdc: cdc, count: n });
            } catch (_) { invalid++; }
          }
        }
        if (stopped) return;
        total = catalogue.length; render();
        // Bounded batches fill the worker budget: each round sends up to four starts per circuit.
        var batchSize = Math.max(1, Math.ceil(workers / ROUND));
        for (var offset = 0; offset < total && !stopped; offset += batchSize) {
          var models = catalogue.slice(offset, offset + batchSize).map(function (item) { return newItem(candidate(item.cdc, allowed, item.count), seed); });
          activeModels = models;
          label = 'Fitting models ' + (offset + 1) + '–' + Math.min(total, offset + batchSize);
          for (;;) {
            var batch = [], owners = [];
            models.forEach(function (item) {
              if (item.done) return;
              var k = Math.min(ROUND, nStarts - item.started), js = jobs(item.c, data, settings, item.rng, k, ranges);
              if (!item.job0) item.job0 = js[0];
              item.started += k;
              js.forEach(function (j) { batch.push(j); owners.push(item); });
            });
            if (!batch.length) break;
            active = Y.pool.fitMany(batch, function (result, index) {
              if (closed || stopped) return;
              var item = owners[index]; attempts++;
              consider(item, assess(item.c, result, data, metric), quality(item.c, result, filters));
            }, null, { workerCount: workers });
            await active.promise; active = null;
            if (stopped) break;
            models.forEach(function (item) {
              if (item.done) return;
              if (item.hits >= 2 && item.started < nStarts) { item.done = true; early++; }
              else if (item.started >= nStarts) item.done = true;
            });
          }
          if (stopped) break;
          var finalItems = models.filter(function (item) { return !!item.best; });
          models.forEach(function (item) { if (!item.best) { fitted++; rejected++; } });
          if (finalItems.length) {
            label = 'Refining models ' + (offset + 1) + '–' + Math.min(total, offset + batchSize);
            active = Y.pool.fitMany(finalItems.map(function (item) { return refinementJob(item.job0, item.best.result); }), function (result, index) {
              if (closed || stopped) return;
              var item = finalItems[index]; attempts++; fitted++;
              consider(item, assess(item.c, result, data, metric), quality(item.c, result, filters), true);
              if (item.kept) retain(item); else rejected++;
            }, null, { workerCount: workers });
            await active.promise; active = null;
          }
          activeModels = [];
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (!stopped) { stopped = true; label = total ? 'Search complete — select a circuit to apply' : 'No eligible models'; dirty = true; render(); }
      } catch (e) { if (!stopped) { stopped = true; label = 'Search stopped: ' + e.message; dirty = true; render(); } }
    }
    // Always stop before releasing app state, including Escape and replacement dialogs.
    var task = run();
    var action = await dialog; closed = true; stop(); clearInterval(timer); await task;
    try {
      if (action === 'apply' && selected) {
        var chosen = selected.members.find(function (m) { return m.cdc === (selected.pick || selected.rep.cdc); }) || selected.rep;
        if (chosen && Y.state.S.datasets.indexOf(ds) >= 0) {
          var tree = Y.circuit.parse(chosen.cdc), prog = Y.circuit.compile(tree);
          Y.history.take('apply searched circuit');
          // limits kept by parameter name, as when the circuit is edited; new names get the element limits the search used
          Y.state.setModel(tree);
          prog.names.forEach(function (name) { ds.fit[name] = true; });
          var meta = Object.assign({}, settings);
          if (data.sr) { meta.weight = 'sigma'; meta.sigma = data.sigma; }
          Y.state.applyResult(ds, chosen.result, meta);
          Y.bus.emit('params', {});
          var L = (Y.state.S.model && Y.state.S.model.limits) || {}, outside = prog.names.filter(function (name, j) { var v = chosen.result.p[j]; return L[name] && (v < L[name].min || v > L[name].max); });
          if (outside.length) Y.ui.toast('Applied ' + chosen.cdc + '. Outside the limits kept from the previous circuit: ' + outside.join(', ') +
            ' (Settings); a bounded fit would move them back inside.', 'warn');
        }
      }
    } finally { Y.state.setBusy(false); }
  }
  return { open: open, why: why, candidate: candidate, jobs: jobs, startValues: startValues, dataRanges: dataRanges, streamFor: streamFor,
           assess: assess, displayRows: displayRows, workerCount: workerCount, plot: plot, scoring: scoring, loadPriors: loadPriors,
           quality: quality, unreliable: unreliable, refinementJob: refinementJob, consider: consider, newItem: newItem };
})();
