/*  Bayesian ranking of the model search (DOM-free, also used by the Node tests).
 *
 *  Posterior of a circuit M given the spectrum D:  P(M | D) ∝ P(D | M) P(M)
 *    P(M)      literature prior: the weight of the circuit in catalog/priors.txt (editable), or the default weight.
 *    P(D | M)  evidence, Laplace approximation at the fitted optimum θ* (natural coordinates: ln p for parameters that span
 *              decades, p for n, α, β):
 *                ln P(D|M) ≈ ln L(θ*) + ln π(θ*) + (k/2) ln 2π − ½ ln det(JᵀJ / s² + Σπ⁻¹)
 *              Weighted residuals as in the fit. With measured σ: ln L = −χ²/2 (s² = 1). Otherwise the common noise scale
 *              is integrated out (Jeffreys prior): ln L = −(m/2) ln χ²w, s² = χ²w / m (m = 2N; constants common to all
 *              circuits are dropped and χ²w is divided by the weighted data energy, so the result does not depend on units).
 *              π: independent priors per parameter (priors.txt): log-normal for R, C, L, Q, Aw, B, τ, centred on the values
 *              the measured window can show (frequencies and |Z| of the data), k standard deviations to either end; normal
 *              for n, α, β. A parameter the data do not determine costs little and gains nothing; a sharply determined one
 *              costs ln(prior width / posterior width): the Occam factor that replaces the k ln m of BIC.
 *  Equivalent circuits: the same elements and model curves that differ on the data by less than EQUIV of the residuals
 *  (Voigt and ladder forms, which give the same spectra) form one class, ranked as one model: its prior is the highest
 *  prior among its written forms and its evidence the mean over them, so a model that the catalogue writes in many ways
 *  (or with many degenerate extra elements) is not counted many times.
 *
 *  Y.modelRank.parsePriors(text) -> priors;  canon(tree);  logPrior(priors, canon);  evidence(...);  addEntry(classes, entry)
 */
Y.modelRank = (function () {
  'use strict';
  var LN2PI = Math.log(2 * Math.PI), EQUIV = 0.1, EQUIV_FLOOR = 1e-5, MAX_CLASSES = 100;
  var FIXED = { R: 1, C: 1, L: 1, W: 1 };

  // ---------------------------------------------------------------- canonical code
  // element kinds only, groups sorted, directly repeated R, C, L or W in one group counted once (they reduce to one):
  // the same string for R(RQ), (QR)R and R1(Q2R3)
  function canon(n) {
    if (n.t === 'e') return n.k;
    var seen = {}, kept = [];
    n.c.map(canon).sort().forEach(function (x) { if (FIXED[x]) { if (seen[x]) return; seen[x] = 1; } kept.push(x); });
    if (kept.length === 1) return kept[0];
    return (n.t === 'p' ? '(' : '[') + kept.join('') + (n.t === 'p' ? ')' : ']');
  }
  function elementKey(tree) { return Y.circuit.elements(tree).map(function (e) { return e.k; }).sort().join(','); }

  // ---------------------------------------------------------------- prior file
  var PARAM_KEYS = {};
  Object.keys(Y.elements).forEach(function (k) { Y.elements[k].params.forEach(function (p) { PARAM_KEYS[k + p.suffix] = p.scale; }); });
  function builtin() {
    return { defaultWeight: 1, circuits: Object.create(null), listed: 0,
             params: { '*': { type: 'window', k: 2 }, Q_n: { type: 'normal', mean: 0.85, sd: 0.15 },
                       HN_a: { type: 'normal', mean: 0.8, sd: 0.2 }, HN_b: { type: 'normal', mean: 0.8, sd: 0.2 } },
             warnings: [], source: 'built-in' };
  }
  // circuit, default and param lines (see catalog/priors.txt); unreadable lines are reported in warnings and skipped
  function parsePriors(text) {
    var pr = builtin();
    pr.source = 'catalog/priors.txt';
    String(text).split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.replace(/^﻿/, '').trim();
      if (!line || line[0] === '#') return;
      var f = line.split(/\t+| {2,}/).map(function (s) { return s.trim(); }), what = f[0].toLowerCase(), bad = function (m) { pr.warnings.push('line ' + (i + 1) + ': ' + m); };
      if (what === 'default') {
        var d = Number(f[1]);
        if (d > 0 && isFinite(d)) pr.defaultWeight = d; else bad('default weight must be positive');
      } else if (what === 'circuit') {
        var w = Number(f[2]);
        if (!(w >= 0) || !isFinite(w)) { bad('weight of ' + f[1] + ' must be a number >= 0'); return; }
        try {
          var key = canon(Y.circuit.parse(f[1], { number: false }));
          if (!(key in pr.circuits)) pr.listed++;
          pr.circuits[key] = { weight: w, code: f[1], note: f.slice(3).join(' ') };
        } catch (e) { bad(f[1] + ': ' + e.message); }
      } else if (what === 'param') {
        var name = f[1], type = (f[2] || '').toLowerCase();
        if (name !== '*' && !(name in PARAM_KEYS) && !/^(R|C|L|Q|W|Wo|Ws|G|HN)$/.test(name)) { bad('unknown parameter ' + name); return; }
        if (type === 'window') {
          var kk = Number(f[3]);
          if (kk > 0 && isFinite(kk)) pr.params[name] = { type: 'window', k: kk }; else bad('window needs a positive number of standard deviations');
        } else if (type === 'normal') {
          var mu = Number(f[3]), sd = Number(f[4]);
          if (isFinite(mu) && sd > 0 && isFinite(sd)) pr.params[name] = { type: 'normal', mean: mu, sd: sd }; else bad('normal needs a mean and a positive sd');
        } else bad('unknown prior type ' + f[2]);
      } else bad('unknown entry ' + f[0]);
    });
    return pr;
  }
  function weightOf(priors, key) { var c = priors.circuits[key]; return c ? c.weight : priors.defaultWeight; }
  function logPrior(priors, key) { var w = weightOf(priors, key); return w > 0 ? Math.log(w) : -Infinity; }

  // ---------------------------------------------------------------- parameter priors
  // natural coordinate of parameter j and its prior { x, mu, sd } (ranges: Y.modelSearch.dataRanges)
  function paramPrior(prog, p, j, priors, ranges) {
    var pp = prog.params[j], key = pp.kind + Y.elements[pp.kind].params[pp.pi].suffix;
    var spec = priors.params[key] || priors.params[pp.kind] || null;
    if (pp.scale !== 'log') {
      var s = spec && spec.type === 'normal' ? spec : null;
      if (!s) { var d = Y.paramDefault(pp.kind, pp.pi); s = { mean: (d.min + d.max) / 2, sd: (d.max - d.min) / 4 }; }
      return { x: p[j], mu: s.mean, sd: s.sd };
    }
    var k = (spec && spec.type === 'window' ? spec : priors.params['*'] || { k: 2 }).k;
    var lw0 = Math.log(ranges.wmin), lw1 = Math.log(ranges.wmax), lz0 = Math.log(ranges.zmin), lz1 = Math.log(ranges.zmax), a, b;
    switch (key) {
      case 'C': a = -lw1 - lz1; b = -lw0 - lz0; break;
      case 'L': a = lz0 - lw1; b = lz1 - lw0; break;
      case 'Q': var n = Math.min(1.5, Math.max(0.05, p[j + 1])); a = -lz1 - n * lw1; b = -lz0 - n * lw0; break;
      case 'W': case 'Wo_A': case 'Ws_A': a = lz0 + 0.5 * (lw0 - Math.LN2); b = lz1 + 0.5 * (lw1 - Math.LN2); break;
      case 'Wo_B': case 'Ws_B': a = -0.5 * lw1; b = -0.5 * lw0; break;
      case 'G_tau': case 'HN_tau': a = -lw1; b = -lw0; break;
      default: a = lz0; b = lz1;                                         // R, G_R, HN_R
    }
    return { x: Math.log(Math.max(p[j], 1e-300)), mu: (a + b) / 2, sd: Math.max((b - a) / (2 * k), 1e-3) };
  }

  // ---------------------------------------------------------------- evidence
  // o: { prog, p, jtj (k×k natural JᵀJ of the weighted residuals), chi2 (weighted), m (2N), sigma (measured σ), energy }
  // -> { lnZ, lnL, lnPrior, logdet } or null without a usable curvature
  function evidence(o, priors, ranges) {
    var k = o.prog.names.length, H = o.jtj;
    if (!H || H.length !== k * k || !(o.chi2 >= 0)) return null;
    var s2 = o.sigma ? 1 : Math.max(o.chi2 / o.m, 1e-300 * (o.energy || 1));
    var lnL = o.sigma ? -o.chi2 / 2 : -(o.m / 2) * Math.log(Math.max(o.chi2 / (o.energy || 1), 1e-300));
    var A = new Float64Array(k * k), lnPrior = 0, i, j;
    for (i = 0; i < k * k; i++) A[i] = H[i] / s2;
    for (j = 0; j < k; j++) {
      var pr = paramPrior(o.prog, o.p, j, priors, ranges), z = (pr.x - pr.mu) / pr.sd;
      if (!isFinite(z)) return null;
      lnPrior += -0.5 * z * z - Math.log(pr.sd) - 0.5 * LN2PI;
      A[j * k + j] += 1 / (pr.sd * pr.sd);
    }
    var L = Y.linalg.cholesky(A, k), tr = 0;
    for (j = 0; j < k; j++) tr += Math.abs(A[j * k + j]);
    for (var ridge = 1e-12 * tr / k, t = 0; !L && t < 8; t++, ridge *= 100) {
      var B = Float64Array.from(A);
      for (j = 0; j < k; j++) B[j * k + j] += ridge;
      L = Y.linalg.cholesky(B, k);
    }
    if (!L) return null;
    var logdet = 0;
    for (j = 0; j < k; j++) logdet += 2 * Math.log(L[j * k + j]);
    var lnZ = lnL + lnPrior + 0.5 * k * LN2PI - 0.5 * logdet;
    return isFinite(lnZ) ? { lnZ: lnZ, lnL: lnL, lnPrior: lnPrior, logdet: logdet } : null;
  }

  // ---------------------------------------------------------------- classes of equivalent circuits
  function logAddExp(a, b) { if (a === -Infinity) return b; if (b === -Infinity) return a; var m = Math.max(a, b); return m + Math.log(Math.exp(a - m) + Math.exp(b - m)); }
  // rms difference of two model curves (both relative to |Z| of the data) against the residuals of the better fit
  function equivalent(a, b) {
    if (a.key !== b.key || !a.curve || !b.curve || a.curve.length !== b.curve.length) return false;
    var s = 0, n = a.curve.length;
    for (var i = 0; i < n; i++) { var d = a.curve[i] - b.curve[i]; s += d * d; }
    return Math.sqrt(s / n) <= Math.max(EQUIV * Math.min(a.rms, b.rms) / 100, EQUIV_FLOOR);
  }
  // class value: highest log prior of its members + log of their mean evidence (entries without lnZ: lnZ = lw, ln prior 0)
  function refresh(cl) {
    cl.members.sort(function (x, y) { return y.lw - x.lw || x.cdc.length - y.cdc.length || x.cdc.localeCompare(y.cdc); });
    cl.rep = cl.members[0];
    var lnZ = -Infinity, lnW = -Infinity;
    cl.members.forEach(function (e) {
      lnZ = logAddExp(lnZ, e.lnZ != null ? e.lnZ : e.lw);
      lnW = Math.max(lnW, e.lnZ != null ? e.lw - e.lnZ : 0);
    });
    cl.lw = lnZ - Math.log(cl.members.length) + lnW;
    if (cl.pick && !cl.members.some(function (e) { return e.cdc === cl.pick; })) cl.pick = null;
  }
  function order(classes, max, sink) {
    classes.sort(function (a, b) { return b.lw - a.lw || a.rep.parameters - b.rep.parameters || a.rep.cdc.localeCompare(b.rep.cdc); });
    var n = max || MAX_CLASSES;
    if (classes.length > n) { if (sink) classes.slice(n).forEach(function (cl) { sink(cl.lw); }); classes.length = n; }
  }
  // entry: { cdc, key (elementKey), lw (log weight: log posterior, or score/2 for BIC), lnZ (log evidence), rms (%), curve, ... }.
  // Returns true when the table changed. A circuit already present keeps its better entry. sink(lw) receives the value of
  // each class that leaves the table (or does not enter it), so probabilities can still be normalised over all classes.
  function addEntry(classes, e, max, sink) {
    var i, cl;
    for (i = 0; i < classes.length; i++) {
      cl = classes[i];
      var at = cl.members.findIndex(function (x) { return x.cdc === e.cdc; });
      if (at < 0) continue;
      if (cl.members[at].lw >= e.lw) return false;
      cl.members[at] = e; refresh(cl); order(classes, max, sink); return true;
    }
    for (i = 0; i < classes.length; i++) {
      cl = classes[i];
      if (cl.key === e.key && equivalent(cl.rep, e)) { cl.members.push(e); refresh(cl); order(classes, max, sink); return true; }
    }
    cl = { key: e.key, members: [e], pick: null };
    refresh(cl); classes.push(cl); order(classes, max, sink);
    return classes.indexOf(cl) >= 0;
  }
  // log of the total weight: the classes in the table and those that left it (other, from sink)
  function logTotal(classes, other) { return classes.reduce(function (s, cl) { return logAddExp(s, cl.lw); }, other == null ? -Infinity : other); }

  return { canon: canon, elementKey: elementKey, parsePriors: parsePriors, builtin: builtin, weightOf: weightOf, logPrior: logPrior,
           paramPrior: paramPrior, evidence: evidence, equivalent: equivalent, addEntry: addEntry, logTotal: logTotal, logAddExp: logAddExp, EQUIV: EQUIV };
})();
