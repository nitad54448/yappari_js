/*  Step 2 analyses (DOM-free).
 *
 *  DRT, distribution of relaxation times (series RC behaviour):
 *    Z(w) = Rinf + Rpol * integral g(tau) / (1 + j w tau) dln(tau),   integral g dln(tau) = 1
 *    Rinf = Zr at the highest frequency, Rpol = Zr at the lowest frequency - Rinf (from the data, as in Yappari 5.1).
 *    tau grid: log-spaced over 1/w_max .. 1/w_min with the density of the data, at least 10 per decade (so gaps
 *    in the frequencies leave no holes in the distribution) and at most 20 (the cost grows as the cube of it). Masked points are used (masks apply to fits only). The system is divided by Rpol, so lambda does not depend on the
 *    size of the impedance.
 *    'tikhonov'  min |A g - y|^2 + lambda^2 |g|^2 with g >= 0 (active-set NNLS of Bro & De Jong, normal equations)
 *    'fisk'      iterated Tikhonov: g <- max(0, g + 0.1 (A'A + lambda^2 I)^-1 A'(y - A g)) from the Tikhonov
 *                solution, stopped when |g| changes by less than 0.25 %
 *    'gold'      Gold's multiplicative deconvolution of the non-negative system; the iterations regularise
 *                (GOLD_ITER = 50 000 by default, fewer = smoother)
 *    source: 'both' (Zr and Zi), 're' (Zr only), 'im' (Zi only)
 *    lambda search: rms misfit of the DRT, and re-im cross-validation (Zr predicted by a DRT of Zi alone, compared
 *    with the measured Zr, shown for information). The suggested value is the strongest regularisation whose
 *    misfit stays within 10 % of the best one: the elbow where more smoothing starts to cost accuracy.
 *    Peaks: R = Rpol * area, tau = exp(g-weighted mean of ln tau), C = tau / R.
 *
 *  Z-HIT: ln|Z(w0)| = C + (2/pi) integral phi dln(w) + g1 phi' + g3 phi''' + g5 phi(5) + g7 phi(7)  (derivatives in ln w)
 *    g1 = -pi/6, g3 = -pi^3/360, g5 = -pi^5/15120, g7 = -pi^7/604800: terms of coth(pi k / 2), the kernel
 *    linking ln|Z| and the phase. Phase resampled on a uniform ln w grid (cubic spline, >= 10 points per decade);
 *    derivatives from local least-squares polynomials of degree 5 over +-1 decade, so phi(7) is taken as 0: a
 *    degree-7 fit is deliberately excluded. Noise and endpoint effects can still amplify errors with degree 5.
 *    Within one half-window of either endpoint, smoothly blend toward a first-derivative-only correction
 *    from a local quadratic over about half a decade. This avoids one-sided high-order derivatives.
 *    Each checked range must contain the full two-decade derivative window and at least 10 distinct points.
 *    C matches the median log-modulus difference in each range. Masked points are used; gaps split ranges.
 *    Unchecked ranges are reported explicitly; they are not presented as reconstructed data.
 */
Y.drt = (function () {
  'use strict';
  var LA = Y.linalg;
  var GAMMA = [-Math.PI / 6, -Math.pow(Math.PI, 3) / 360, -Math.pow(Math.PI, 5) / 15120, -Math.pow(Math.PI, 7) / 604800];

  function maxAbs(v) { var m = 0; for (var i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m; }
  function median(a) { var s = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  var TAU_PER_DECADE = 20;
  function prepare(ds) {
    var c = Y.dataops.cleanSorted(ds), n = c.f.length;
    if (n < 6) throw new Error('the DRT needs at least 6 points');
    var rinf = c.zr[n - 1], rpol = c.zr[0] - rinf;
    if (!(rpol > 0)) throw new Error('Rpol = Zr(lowest f) − Zr(highest f) = ' + rpol.toPrecision(3) + ' Ω is not positive, no DRT');
    var w = new Float64Array(n), k;
    for (k = 0; k < n; k++) w[k] = 2 * Math.PI * c.f[k];
    // τ points: the density of the data, at least 10 and at most TAU_PER_DECADE per decade (the cost grows as nt³)
    var lt0 = Math.log(1 / w[n - 1]), lt1 = Math.log(1 / w[0]), dec = (lt1 - lt0) / Math.LN10;
    var nt = Math.min(Math.max(n, Math.ceil(dec * 10) + 1), Math.max(Math.ceil(dec * TAU_PER_DECADE) + 1, 6)), h = (lt1 - lt0) / (nt - 1);
    var tau = new Float64Array(nt), lt = new Float64Array(nt), dl = new Float64Array(nt).fill(h);
    for (k = 0; k < nt; k++) { lt[k] = lt0 + k * h; tau[k] = Math.exp(lt[k]); }
    return { f: c.f, w: w, zr: c.zr, zi: c.zi, n: n, nt: nt, rinf: rinf, rpol: rpol, tau: tau, lt: lt, dl: dl };
  }

  // kernels, divided by Rpol: re[m*nt+j] = dl_j/(1+x^2), im[m*nt+j] = -dl_j x/(1+x^2), x = w_m tau_j
  function kernels(P) {
    var n = P.n, nt = P.nt, re = new Float64Array(n * nt), im = new Float64Array(n * nt);
    for (var m = 0; m < n; m++) for (var j = 0; j < nt; j++) {
      var x = P.w[m] * P.tau[j], d = 1 + x * x;
      re[m * nt + j] = P.dl[j] / d; im[m * nt + j] = -P.dl[j] * x / d;
    }
    return { re: re, im: im };
  }

  // rows of the chosen data; sy.n is the number of unknowns (relaxation times)
  function system(P, K, source) {
    var n = P.n, nt = P.nt, useRe = source !== 'im', useIm = source !== 're', rows = (useRe ? n : 0) + (useIm ? n : 0);
    var A = new Float64Array(rows * nt), y = new Float64Array(rows), r = 0, m, j;
    if (useRe) for (m = 0; m < n; m++, r++) { for (j = 0; j < nt; j++) A[r * nt + j] = K.re[m * nt + j]; y[r] = (P.zr[m] - P.rinf) / P.rpol; }
    if (useIm) for (m = 0; m < n; m++, r++) { for (j = 0; j < nt; j++) A[r * nt + j] = K.im[m * nt + j]; y[r] = P.zi[m] / P.rpol; }
    return { A: A, y: y, rows: rows, n: nt };
  }

  function normal(sy) {
    var n = sy.n, A = sy.A, H = new Float64Array(n * n), c = new Float64Array(n), a, b;
    for (var r = 0; r < sy.rows; r++) {
      var off = r * n, yr = sy.y[r];
      for (a = 0; a < n; a++) {
        var v = A[off + a];
        if (!v) continue;
        c[a] += v * yr;
        for (b = a; b < n; b++) H[a * n + b] += v * A[off + b];
      }
    }
    for (a = 0; a < n; a++) for (b = 0; b < a; b++) H[a * n + b] = H[b * n + a];
    return { H: H, c: c };
  }

  // min 1/2 g'Hg - c'g with g >= 0, H symmetric positive definite (active set, Bro & De Jong 1997)
  function fnnls(H, c, n) {
    var x = new Float64Array(n), P = new Uint8Array(n), w = Float64Array.from(c), tol = 1e-10 * Math.max(maxAbs(c), 1e-300), it = 0, j, q;
    function solveP() {
      var idx = [];
      for (var jj = 0; jj < n; jj++) if (P[jj]) idx.push(jj);
      var m = idx.length, M = new Float64Array(m * m), b = new Float64Array(m), s = new Float64Array(n);
      for (var a = 0; a < m; a++) { b[a] = c[idx[a]]; for (var qq = 0; qq < m; qq++) M[a * m + qq] = H[idx[a] * n + idx[qq]]; }
      var sol = LA.solveSPD(M, b, m);
      if (sol) for (a = 0; a < m; a++) s[idx[a]] = sol[a];
      return s;
    }
    while (it++ < 3 * n + 50) {
      var jm = -1, wm = tol;
      for (j = 0; j < n; j++) if (!P[j] && w[j] > wm) { wm = w[j]; jm = j; }
      if (jm < 0) break;
      P[jm] = 1;
      var s = solveP(), inner = 0;
      while (inner++ < n) {
        var alpha = Infinity, neg = false;
        for (j = 0; j < n; j++) if (P[j] && s[j] <= 0) { neg = true; var den = x[j] - s[j], t = den > 0 ? x[j] / den : 0; if (t < alpha) alpha = t; }
        if (!neg) break;
        for (j = 0; j < n; j++) x[j] += alpha * (s[j] - x[j]);
        for (j = 0; j < n; j++) if (P[j] && x[j] <= 1e-15) { P[j] = 0; x[j] = 0; }
        s = solveP();
      }
      for (j = 0; j < n; j++) x[j] = P[j] ? s[j] : 0;
      for (j = 0; j < n; j++) { var hx = 0; for (q = 0; q < n; q++) hx += H[j * n + q] * x[q]; w[j] = c[j] - hx; }
    }
    return x;
  }

  function regularised(NE, n, lambda) {
    var H = Float64Array.from(NE.H), l2 = lambda * lambda;
    for (var j = 0; j < n; j++) H[j * n + j] += l2;
    return H;
  }
  function tikhonov(NE, n, lambda) { return fnnls(regularised(NE, n, lambda), NE.c, n); }

  function fisk(NE, n, lambda) {
    var g = tikhonov(NE, n, lambda), L = LA.cholesky(regularised(NE, n, lambda), n), j, q;
    if (!L) return g;
    var norm = Math.sqrt(g.reduce(function (a, v) { return a + v * v; }, 0)), r = new Float64Array(n);
    for (var it = 0; it < 2000; it++) {
      for (j = 0; j < n; j++) { var hx = 0; for (q = 0; q < n; q++) hx += NE.H[j * n + q] * g[q]; r[j] = NE.c[j] - hx; }
      var d = LA.cholSolve(L, r, n), nn = 0;
      for (j = 0; j < n; j++) { g[j] = Math.max(0, g[j] + 0.1 * d[j]); nn += g[j] * g[j]; }
      nn = Math.sqrt(nn);
      if (Math.abs(nn - norm) <= 0.0025 * Math.max(norm, 1e-300)) break;
      norm = nn;
    }
    return g;
  }

  // Gold: imaginary rows negated so that the system and the data are non-negative (negative data set to 0).
  // Entries that have decayed below 1e-14 of the maximum are frozen at 0 (checked every 200 iterations),
  // which speeds up the many late iterations without changing the result. goldStart prepares the iteration and
  // goldAdvance continues it up to a number of iterations, so a scan can stop at each value it needs.
  var GOLD_ITER = 50000;
  function goldStart(sy, n) {
    var rows = sy.rows, A = new Float64Array(sy.A.length), y = new Float64Array(rows), j;
    for (var r = 0; r < rows; r++) {
      var neg = false;
      for (j = 0; j < n; j++) if (sy.A[r * n + j] < 0) { neg = true; break; }
      for (j = 0; j < n; j++) A[r * n + j] = Math.abs(sy.A[r * n + j]);
      y[r] = Math.max(0, neg ? -sy.y[r] : sy.y[r]);
    }
    var NE = normal({ A: A, y: y, rows: rows, n: n }), act = [];
    for (j = 0; j < n; j++) act.push(j);
    return { n: n, H: NE.H, c: NE.c, g: new Float64Array(n).fill(1 / n), Hg: new Float64Array(n), act: act, it: 0 };
  }
  function goldAdvance(st, iters) {
    var n = st.n, H = st.H, c = st.c, g = st.g, Hg = st.Hg, act = st.act, na = act.length, j, q, a;
    while (st.it < iters) {
      st.it++;
      for (a = 0; a < na; a++) { j = act[a]; var s = 0, row = j * n; for (var b = 0; b < na; b++) { q = act[b]; s += H[row + q] * g[q]; } Hg[j] = s; }
      for (a = 0; a < na; a++) { j = act[a]; g[j] = Hg[j] > 0 ? g[j] * c[j] / Hg[j] : 0; }
      if (st.it % 200 === 0) {
        var gmax = 0;
        for (a = 0; a < na; a++) gmax = Math.max(gmax, g[act[a]]);
        act = st.act = act.filter(function (jj) { if (g[jj] > 1e-14 * gmax) return true; g[jj] = 0; return false; });
        na = act.length;
      }
    }
    return g;
  }
  function goldRun(sy, n, iters) { return goldAdvance(goldStart(sy, n), iters); }

  function solve(P, K, o, sy) {
    sy = sy || system(P, K, o.source || 'both');
    if (o.method === 'gold') return goldRun(sy, P.nt, Math.max(1, Math.round(o.iterations || GOLD_ITER)));
    var NE = normal(sy);
    return o.method === 'fisk' ? fisk(NE, P.nt, o.lambda) : tikhonov(NE, P.nt, o.lambda);
  }

  function peaks(P, g) {
    var n = P.nt, max = 0, out = [], cur = null, j;
    for (j = 0; j < n; j++) max = Math.max(max, g[j]);
    var thr = max * 1e-3;
    for (j = 0; j <= n; j++) {
      if (j < n && g[j] > thr) {
        if (!cur) cur = { a: 0, m: 0 };
        var a = g[j] * P.dl[j];
        cur.a += a; cur.m += a * P.lt[j];
      } else if (cur) { out.push(cur); cur = null; }
    }
    return out.map(function (p) {
      var tau = Math.exp(p.m / p.a), R = P.rpol * p.a;
      return { tau: tau, f: 1 / (2 * Math.PI * tau), R: R, C: tau / R, share: p.a };
    }).filter(function (p) { return p.share > 0.002; }).sort(function (a, b) { return b.f - a.f; });
  }

  function compute(ds, o) {
    var P = prepare(ds), K = kernels(P), g = solve(P, K, o), n = P.n, nt = P.nt, j;
    var zr = new Float64Array(n), zi = new Float64Array(n), err = 0, area = 0;
    for (var m = 0; m < n; m++) {
      var a = 0, b = 0;
      for (j = 0; j < nt; j++) { a += K.re[m * nt + j] * g[j]; b += K.im[m * nt + j] * g[j]; }
      zr[m] = P.rinf + P.rpol * a; zi[m] = P.rpol * b;
      err += ((zr[m] - P.zr[m]) * (zr[m] - P.zr[m]) + (zi[m] - P.zi[m]) * (zi[m] - P.zi[m])) / (P.zr[m] * P.zr[m] + P.zi[m] * P.zi[m]);
    }
    for (j = 0; j < nt; j++) area += g[j] * P.dl[j];
    return { f: P.f, tau: P.tau, g: g, zr: zr, zi: zi, zrExp: P.zr, ziExp: P.zi, rinf: P.rinf, rpol: P.rpol, peaks: peaks(P, g),
             err: Math.sqrt(err / n), area: area, method: o.method, source: o.source || 'both', lambda: o.lambda, iterations: o.iterations };
  }

  // values to scan: lambda from 1e-6 to 1, or Gold iterations from 100 to GOLD_ITER (50 000)
  function scanValues(method, count) {
    var out = [], k;
    if (method === 'gold') {
      var top = Math.log10(GOLD_ITER) - 2;
      for (k = 0; k < count; k++) { var v = Math.round(Math.pow(10, 2 + top * k / (count - 1))); if (!out.length || v > out[out.length - 1]) out.push(v); }
      return out;
    }
    for (k = 0; k < count; k++) out.push(Math.pow(10, -6 + 6 * k / (count - 1)));
    return out;
  }

  // lambda search, done step by step by the caller: step(k) for value k, in increasing k (for Gold, each step
  // continues the iterations of the previous one up to values[k])
  function scanner(ds, o, values) {
    var P = prepare(ds), K = kernels(P), n = P.n, nt = P.nt, sF = system(P, K, o.source || 'both'), sI = system(P, K, 'im');
    var res = { values: values, err: new Float64Array(values.length).fill(NaN), cv: new Float64Array(values.length).fill(NaN) };
    function score(k, gF, gI) {
      var e = 0, cv = 0;
      for (var m = 0; m < n; m++) {
        var a = 0, b = 0, c = 0, row = m * nt;
        for (var j = 0; j < nt; j++) { a += K.re[row + j] * gF[j]; b += K.im[row + j] * gF[j]; c += K.re[row + j] * gI[j]; }
        var mod2 = P.zr[m] * P.zr[m] + P.zi[m] * P.zi[m], zr = P.rinf + P.rpol * a, zi = P.rpol * b, zp = P.rinf + P.rpol * c;
        e += ((zr - P.zr[m]) * (zr - P.zr[m]) + (zi - P.zi[m]) * (zi - P.zi[m])) / mod2;
        cv += (zp - P.zr[m]) * (zp - P.zr[m]) / mod2;
      }
      res.err[k] = Math.sqrt(e / n); res.cv[k] = Math.sqrt(cv / n);
    }
    if (o.method === 'gold') {
      var stF = goldStart(sF, nt), stI = goldStart(sI, nt);
      return { total: values.length, result: res, step: function (k) {
        score(k, goldAdvance(stF, values[k]), goldAdvance(stI, values[k]));
      } };
    }
    var NF = normal(sF), NI = normal(sI), fn = o.method === 'fisk' ? fisk : tikhonov;
    return { total: values.length, result: res, step: function (k) { score(k, fn(NF, nt, values[k]), fn(NI, nt, values[k])); } };
  }
  // suggested value: the strongest regularisation whose misfit stays within 10 % of the best misfit and at most
  // 0.1 percentage point above it (largest lambda, or fewest Gold iterations): where smoothing starts to cost accuracy
  function bestIndex(res, method) {
    var emin = Infinity, k, b = -1;
    for (k = 0; k < res.err.length; k++) if (res.err[k] < emin) emin = res.err[k];
    if (!(emin < Infinity)) return -1;
    var thr = emin + Math.min(0.1 * emin, 0.001);
    for (k = 0; k < res.err.length; k++) if (res.err[k] <= thr) { b = k; if (method === 'gold') break; }
    return b;
  }

  // derivatives of orders 1, 3, 5, 7 on a uniform grid (step h): local least-squares polynomials
  function derivatives(y, h, half, deg) {
    var n = y.length, w = Math.min(2 * half + 1, n % 2 ? n : n - 1);
    half = (w - 1) >> 1; w = 2 * half + 1; deg = Math.min(deg, w - 1);
    var nc = deg + 1, fact = [1, 1, 2, 6, 24, 120, 720, 5040], orders = [1, 3, 5, 7], out = orders.map(function () { return new Float64Array(n); });
    var pw = new Float64Array(nc);
    for (var i = 0; i < n; i++) {
      var s0 = Math.min(Math.max(0, i - half), n - w), A = new Float64Array(nc * nc), b = new Float64Array(nc), a, q;
      for (var j = s0; j < s0 + w; j++) {
        var t = (j - i) / half;
        pw[0] = 1;
        for (a = 1; a < nc; a++) pw[a] = pw[a - 1] * t;
        for (a = 0; a < nc; a++) { b[a] += pw[a] * y[j]; for (q = 0; q < nc; q++) A[a * nc + q] += pw[a] * pw[q]; }
      }
      var coef = LA.solveSPD(A, b, nc);
      if (!coef) throw new Error('Z-HIT phase derivative calculation failed');
      for (var o = 0; o < 4; o++) if (orders[o] < nc) out[o][i] = fact[orders[o]] * coef[orders[o]] / Math.pow(half * h, orders[o]);
    }
    return out;
  }

  // |Z| rebuilt from the phase at the points of one continuous range (f ascending)
  function rebuild(f, zr, zi, o) {
    var n = f.length, k, i, x = new Float64Array(n), ph = new Float64Array(n), lz = new Float64Array(n);
    for (k = 0; k < n; k++) { x[k] = Math.log(2 * Math.PI * f[k]); ph[k] = Math.atan2(zi[k], zr[k]); lz[k] = Math.log(Math.hypot(zr[k], zi[k])); }
    var N = Math.max(n, Math.ceil((x[n - 1] - x[0]) / Math.LN10 * 10) + 1), h = (x[n - 1] - x[0]) / (N - 1);
    var y2 = Y.dataops.splineY2(x, ph), X = new Float64Array(N), Ph = new Float64Array(N), I = new Float64Array(N), L = new Float64Array(N);
    for (i = 0; i < N; i++) { X[i] = x[0] + i * h; Ph[i] = Y.dataops.splineAt(x, ph, y2, X[i]); }
    for (i = 1; i < N; i++) I[i] = I[i - 1] + 0.5 * h * (Ph[i] + Ph[i - 1]);
    var D = derivatives(Ph, h, Math.max(2, Math.round(o.win * Math.LN10 / h)), o.deg);
    // A high-degree polynomial evaluated at the end of a shifted window gives unstable
    // third/fifth derivatives. Use a short, low-degree slope estimate at the boundary,
    // smoothly returning to the full correction where its window is centered.
    // This rule uses phase and frequency only, never the measured modulus.
    var E = derivatives(Ph, h, Math.max(2, Math.round(0.25 * o.win * Math.LN10 / h)), Math.min(2, o.deg));
    for (i = 0; i < N; i++) {
      var t = Math.min(1, Math.min(i, N - 1 - i) * h / (o.win * Math.LN10));
      var blend = t * t * (3 - 2 * t);  // smoothstep: zero slope at either end of the blend
      var full = GAMMA[0] * D[0][i] + GAMMA[1] * D[1][i] + GAMMA[2] * D[2][i] + GAMMA[3] * D[3][i];
      L[i] = (2 / Math.PI) * I[i] + blend * full + (1 - blend) * GAMMA[0] * E[0][i];
    }
    var yL = Y.dataops.splineY2(X, L), Lm = new Float64Array(n), diff = new Float64Array(n);
    for (k = 0; k < n; k++) { Lm[k] = Y.dataops.splineAt(X, L, yL, x[k]); diff[k] = lz[k] - Lm[k]; }
    var C = median(diff), mod = new Float64Array(n);
    for (k = 0; k < n; k++) {
      mod[k] = Math.exp(Lm[k] + C);
      if (!(mod[k] > 0) || !isFinite(mod[k])) throw new Error('Z-HIT reconstruction is not finite and positive; the phase or frequency range is unsuitable');
    }
    return { mod: mod, ph: ph, lz: lz };
  }

  // Z-HIT of a dataset. A gap in the frequencies (more than 4 times the usual spacing and half a decade)
  // splits the data: each continuous range is rebuilt on its own, since the phase integral cannot cross a gap.
  // A range needs 10 distinct points and the full derivative window (2*win decades).
  // Unchecked points have NaN output/deviation and are omitted from the UI's reconstructed dataset.
  function zhit(ds, o) {
    o = Object.assign({ deg: 5, win: 1 }, o || {});      // local polynomials of degree 5 over +-1 decade (see header)
    if (!Number.isInteger(o.deg) || o.deg < 1 || o.deg > 5 || !(o.win >= 1) || !isFinite(o.win))
      throw new Error('Z-HIT requires a polynomial degree from 1 to 5 and a half-window of at least 1 decade');
    if (!ds || !ds.f || !ds.zr || !ds.zi || ds.f.length !== ds.zr.length || ds.f.length !== ds.zi.length)
      throw new Error('Z-HIT needs matching frequency, Zr and Zi arrays');
    function valid(f, re, im) {
      var m = Math.hypot(re, im);
      return f > 0 && isFinite(f) && isFinite(re) && isFinite(im) && m > 0 && isFinite(m) && isFinite(2 * Math.PI * f);
    }
    for (var j = 0; j < ds.f.length; j++) if (!valid(ds.f[j], ds.zr[j], ds.zi[j]))
      throw new Error('Z-HIT needs finite positive frequencies and finite nonzero |Z| (invalid point ' + (j + 1) + ')');
    var c = Y.dataops.cleanSorted(ds), n = c.f.length, k;
    for (k = 0; k < n; k++) if (!valid(c.f[k], c.zr[k], c.zi[k]))
      throw new Error('Z-HIT found invalid impedance after averaging duplicate frequencies');
    if (n < 10) throw new Error('Z-HIT needs at least 10 points');
    var sp = [];
    for (k = 1; k < n; k++) sp.push(Math.log10(c.f[k] / c.f[k - 1]));
    var lim = Math.max(4 * median(sp), 0.5), segs = [], start = 0, gap = null;
    for (k = 1; k < n; k++) if (sp[k - 1] > lim) {
      segs.push([start, k]); start = k;
      if (!gap || sp[k - 1] > gap.decades) gap = { f0: c.f[k - 1], f1: c.f[k], decades: sp[k - 1] };
    }
    segs.push([start, n]);
    var zr = new Float64Array(n).fill(NaN), zi = new Float64Array(n).fill(NaN), dev = new Float64Array(n).fill(NaN), rms = 0, done = 0, worst = 0, fw = null, skippedRanges = [];
    segs.forEach(function (sg) {
      var a = sg[0], m = sg[1] - a;
      var span = Math.log10(c.f[a + m - 1]) - Math.log10(c.f[a]);
      if (m < 10 || span + 1e-9 < 2 * o.win) {
        skippedRanges.push({ f0: c.f[a], f1: c.f[a + m - 1], n: m,
          reason: m < 10 ? 'fewer than 10 distinct points' : 'less than ' + (2 * o.win) + ' decades (the full derivative window)' });
        return;
      }
      var r = rebuild(c.f.subarray(a, a + m), c.zr.subarray(a, a + m), c.zi.subarray(a, a + m), o);
      for (var i = 0; i < m; i++) {
        var q = a + i;
        zr[q] = r.mod[i] * Math.cos(r.ph[i]); zi[q] = r.mod[i] * Math.sin(r.ph[i]);
        dev[q] = Math.exp(r.lz[i]) / r.mod[i] - 1;
        if (!isFinite(dev[q]) || !isFinite(dev[q] * dev[q])) throw new Error('Z-HIT deviation is non-finite; no result was accepted');
        rms += dev[q] * dev[q]; done++;
        if (fw == null || Math.abs(dev[q]) > worst) { worst = Math.abs(dev[q]); fw = c.f[q]; }
      }
    });
    if (!done) throw new Error('Z-HIT needs a continuous range with at least 10 distinct points spanning at least ' + (2 * o.win) + ' decades; no range was checked');
    if (!isFinite(rms)) throw new Error('Z-HIT RMS deviation is non-finite; no result was accepted');
    return { f: c.f, zr: zr, zi: zi, dev: dev, rms: Math.sqrt(rms / done), max: worst, fmax: fw, gap: gap,
             ranges: segs.length, checked: done, unchecked: n - done, skippedRanges: skippedRanges };
  }

  return { compute: compute, scanValues: scanValues, scanner: scanner, bestIndex: bestIndex, zhit: zhit, GAMMA: GAMMA, GOLD_ITER: GOLD_ITER };
})();
