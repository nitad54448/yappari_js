/*  Kramers-Kronig test (Lin-KK), DOM-free (also used by the Node tests). Analysis menu, below Z-HIT; command kk, kk>>M.
 *  B. A. Boukamp, J. Electrochem. Soc. 142 (1995) 1885; M. Schoenleber, D. Klotz, E. Ivers-Tiffee, Electrochim. Acta 131
 *  (2014) 20.
 *
 *    Z_KK(w) = R0 + j w L + 1/(j w C) + sum_k R_k / (1 + j w tau_k)
 *
 *  M time constants tau_k log-spaced over 1/w_max .. 1/w_min; R0, R_k, L and 1/C by linear least squares weighted by
 *  1/|Z| (Householder QR with column pivoting), on Zr and Zi together ('complex'), or the classical transform tests:
 *  'real' (R0, R_k from Zr; L, C from what remains of Zi) and 'imag' (R_k, L, C from Zi; R0 from Zr). Every term is
 *  causal, linear and stable whatever its sign, so Z_KK obeys the Kramers-Kronig relations; the residuals
 *  (Z - Z_KK)/|Z| show how far the data do not.
 *  M: the fit is made for M = 1 .. min(50, N/2) and the smallest M whose rms residual stays within 10 % (and 0.1
 *  percentage point) of the best one is kept: the elbow where more elements stop improving the fit, as for the lambda
 *  suggestion of the DRT. Or M is given, or chosen by Schoenleber's criterion (option c): M grows until
 *  mu = 1 - sum|R_k < 0| / sum|R_k >= 0| <= c (c = 0.85 in the paper); mu is returned in every case.
 *  Masked points are used (masks apply to circuit fits only), duplicate frequencies averaged; gaps need no special care.
 *
 *  Y.kk.run(ds, options) -> result (see run below);  Y.kk.lstsq(A, b, rows, cols, rtol) -> x
 */
Y.kk = (function () {
  'use strict';

  // ---------------------------------------------------------------- least squares
  // Least squares min |A x - b| (A row-major, rows x cols) by Householder QR with column pivoting. The columns are
  // scaled to unit norm first; once the largest remaining column norm falls below rtol, the other columns are left
  // out (coefficient 0), so nearly dependent columns cannot inflate the coefficients.
  function lstsq(A0, b0, rows, cols, rtol) {
    var A = Float64Array.from(A0), b = Float64Array.from(b0), sc = new Float64Array(cols), perm = [], i, j, k, t;
    for (j = 0; j < cols; j++) {
      for (t = 0, i = 0; i < rows; i++) t += A[i * cols + j] * A[i * cols + j];
      sc[j] = t > 0 && t < Infinity ? 1 / Math.sqrt(t) : 0;
      for (i = 0; i < rows; i++) A[i * cols + j] *= sc[j];
      perm.push(j);
    }
    var rank = 0, kmax = Math.min(rows, cols);
    for (k = 0; k < kmax; k++) {
      var p = -1, best = 0;
      for (j = k; j < cols; j++) {
        for (t = 0, i = k; i < rows; i++) t += A[i * cols + j] * A[i * cols + j];
        if (t > best) { best = t; p = j; }
      }
      if (p < 0 || !(Math.sqrt(best) > rtol)) break;
      if (p !== k) {
        for (i = 0; i < rows; i++) { t = A[i * cols + k]; A[i * cols + k] = A[i * cols + p]; A[i * cols + p] = t; }
        t = perm[k]; perm[k] = perm[p]; perm[p] = t;
      }
      var nrm = Math.sqrt(best), x0 = A[k * cols + k], alpha = x0 > 0 ? -nrm : nrm, v0 = x0 - alpha, vv = best - x0 * x0 + v0 * v0;
      A[k * cols + k] = v0;                                  // Householder vector in column k, from row k down
      for (j = k + 1; j < cols; j++) {
        for (t = 0, i = k; i < rows; i++) t += A[i * cols + k] * A[i * cols + j];
        t *= 2 / vv;
        for (i = k; i < rows; i++) A[i * cols + j] -= t * A[i * cols + k];
      }
      for (t = 0, i = k; i < rows; i++) t += A[i * cols + k] * b[i];
      t *= 2 / vv;
      for (i = k; i < rows; i++) b[i] -= t * A[i * cols + k];
      A[k * cols + k] = alpha;                               // diagonal of R
      rank++;
    }
    var x = new Float64Array(cols), z = new Float64Array(rank);
    for (k = rank - 1; k >= 0; k--) {
      for (t = b[k], j = k + 1; j < rank; j++) t -= A[k * cols + j] * z[j];
      z[k] = t / A[k * cols + k];
    }
    for (k = 0; k < rank; k++) x[perm[k]] = z[k] * sc[perm[k]];
    return x;
  }
  // columns from .. to-1 of a row-major matrix with nc columns
  function columns(src, rows, nc, from, to) {
    var w = to - from, out = new Float64Array(rows * w);
    for (var r = 0; r < rows; r++) for (var j = 0; j < w; j++) out[r * w + j] = src[r * nc + from + j];
    return out;
  }
  function validPoint(f, re, im) {
    var m = Math.hypot(re, im);
    return f > 0 && isFinite(f) && isFinite(re) && isFinite(im) && m > 0 && isFinite(m) && isFinite(2 * Math.PI * f);
  }
  var RTOL = 1e-10;                // unit-norm columns whose remaining norm is below this are left out

  // ---------------------------------------------------------------- the test
  // Kramers-Kronig test of a dataset (see header). o: { M: fixed number of RC elements (1 .. N-2); otherwise the elbow
  // of the rms residual, or with c (0 < c < 1) the mu criterion; maxM: 50, largest automatic M (also at most N/2);
  // fit: 'complex' | 'real' | 'imag'; cap: true (series capacitance) }. The points are those of
  // Y.dataops.cleanSorted (ascending, duplicates averaged, masked points included). zr, zi: Z_KK at these points;
  // resRe, resIm: (Z - Z_KK)/|Z| parts; dev: |Z - Z_KK|/|Z|; chi2ps: Boukamp's pseudo chi-square, sum(resRe² + resIm²).
  function run(ds, o) {
    o = Object.assign({ maxM: 50, fit: 'complex', cap: true }, o || {});
    if ((o.c != null && !(o.c > 0 && o.c < 1)) || !Number.isInteger(o.maxM) || o.maxM < 1 || ['complex', 'real', 'imag'].indexOf(o.fit) < 0)
      throw new Error('the Kramers–Kronig test needs 0 < c < 1, a whole maxM of at least 1, and fit complex, real or imag');
    if (o.M != null && !(Number.isInteger(o.M) && o.M >= 1)) throw new Error('the number of RC elements must be a whole number of at least 1');
    if (!ds || !ds.f || !ds.zr || !ds.zi || ds.f.length !== ds.zr.length || ds.f.length !== ds.zi.length)
      throw new Error('the Kramers–Kronig test needs matching frequency, Zr and Zi arrays');
    var j, k;
    for (j = 0; j < ds.f.length; j++) if (!validPoint(ds.f[j], ds.zr[j], ds.zi[j]))
      throw new Error('the Kramers–Kronig test needs finite positive frequencies and finite nonzero |Z| (invalid point ' + (j + 1) + ')');
    var c = Y.dataops.cleanSorted(ds), n = c.f.length;
    for (k = 0; k < n; k++) if (!validPoint(c.f[k], c.zr[k], c.zi[k]))
      throw new Error('the Kramers–Kronig test found invalid impedance after averaging duplicate frequencies');
    if (n < 6) throw new Error('the Kramers–Kronig test needs at least 6 distinct frequencies');
    if (o.M != null && o.M > n - 2) throw new Error(o.M + ' RC elements are too many for ' + n + ' distinct frequencies (at most ' + (n - 2) + ')');
    var w = new Float64Array(n), m = new Float64Array(n), bre = new Float64Array(n), bim = new Float64Array(n);
    for (k = 0; k < n; k++) { w[k] = 2 * Math.PI * c.f[k]; m[k] = Math.hypot(c.zr[k], c.zi[k]); bre[k] = c.zr[k] / m[k]; bim[k] = c.zi[k] / m[k]; }
    var lt0 = Math.log(1 / w[n - 1]), lt1 = Math.log(1 / w[0]);

    // the model with M RC elements; columns divided by |Z|, real and imaginary parts: R0 | R_1 .. R_M | L | 1/C
    function fitM(M) {
      var nc = M + (o.cap ? 3 : 2), tau = new Float64Array(M), RE = new Float64Array(n * nc), IM = new Float64Array(n * nc);
      var k, q, x, d, s, a, b;
      for (q = 0; q < M; q++) tau[q] = Math.exp(M > 1 ? lt0 + (lt1 - lt0) * q / (M - 1) : (lt0 + lt1) / 2);
      for (k = 0; k < n; k++) {
        var row = k * nc;
        RE[row] = 1 / m[k];
        for (q = 0; q < M; q++) { x = w[k] * tau[q]; d = (1 + x * x) * m[k]; RE[row + 1 + q] = 1 / d; IM[row + 1 + q] = -x / d; }
        IM[row + M + 1] = w[k] / m[k];
        if (o.cap) IM[row + M + 2] = -1 / (w[k] * m[k]);
      }
      var coef = new Float64Array(nc);
      if (o.fit === 'complex') {
        var A = new Float64Array(2 * n * nc), y = new Float64Array(2 * n);
        A.set(RE); A.set(IM, n * nc); y.set(bre); y.set(bim, n);
        coef = lstsq(A, y, 2 * n, nc, RTOL);
      } else if (o.fit === 'real') {
        coef.set(lstsq(columns(RE, n, nc, 0, M + 1), bre, n, M + 1, RTOL));
        var rest = new Float64Array(n);
        for (k = 0; k < n; k++) { for (s = bim[k], q = 1; q <= M; q++) s -= IM[k * nc + q] * coef[q]; rest[k] = s; }
        coef.set(lstsq(columns(IM, n, nc, M + 1, nc), rest, n, nc - M - 1, RTOL), M + 1);
      } else {
        coef.set(lstsq(columns(IM, n, nc, 1, nc), bim, n, nc - 1, RTOL), 1);
        var num = 0, den = 0;                              // R0: weighted mean of what remains of Zr
        for (k = 0; k < n; k++) { for (s = bre[k], q = 1; q <= M; q++) s -= RE[k * nc + q] * coef[q]; num += s / m[k]; den += 1 / (m[k] * m[k]); }
        coef[0] = num / den;
      }
      var zr = new Float64Array(n), zi = new Float64Array(n), pos = 0, neg = 0, e = 0;
      for (k = 0; k < n; k++) {
        for (a = 0, b = 0, q = 0; q < nc; q++) { a += RE[k * nc + q] * coef[q]; b += IM[k * nc + q] * coef[q]; }
        zr[k] = a * m[k]; zi[k] = b * m[k];
        e += (bre[k] - a) * (bre[k] - a) + (bim[k] - b) * (bim[k] - b);
      }
      for (q = 1; q <= M; q++) { if (coef[q] < 0) neg -= coef[q]; else pos += coef[q]; }
      return { M: M, tau: tau, coef: coef, zr: zr, zi: zi, rms: Math.sqrt(e / n), mu: pos > 0 ? 1 - neg / pos : (neg > 0 ? -Infinity : 1) };
    }

    var top = Math.max(1, Math.min(o.maxM, Math.floor(n / 2))), r = null, M, crit = o.M != null ? 'fixed' : o.c != null ? 'mu' : 'rms';
    if (crit === 'fixed') r = fitM(o.M);
    else if (crit === 'mu') for (M = 1; M <= top; M++) { r = fitM(M); if (r.mu <= o.c) break; }
    else {                                                 // elbow: smallest M within 10 % (and 0.1 point) of the best rms
      var fits = [], best = Infinity;
      for (M = 1; M <= top; M++) { fits.push(fitM(M)); if (fits[M - 1].rms < best) best = fits[M - 1].rms; }
      var thr = best + Math.min(0.1 * best, 0.001);
      for (M = 0; M < fits.length && !r; M++) if (fits[M].rms <= thr) r = fits[M];
    }
    if (!r || !isFinite(r.rms)) throw new Error('the Kramers–Kronig fit is not finite; no result was accepted');
    var resRe = new Float64Array(n), resIm = new Float64Array(n), dev = new Float64Array(n), sRe = 0, sIm = 0, worst = -1, fw = NaN;
    for (k = 0; k < n; k++) {
      resRe[k] = (c.zr[k] - r.zr[k]) / m[k]; resIm[k] = (c.zi[k] - r.zi[k]) / m[k]; dev[k] = Math.hypot(resRe[k], resIm[k]);
      sRe += resRe[k] * resRe[k]; sIm += resIm[k] * resIm[k];
      if (dev[k] > worst) { worst = dev[k]; fw = c.f[k]; }
    }
    if (!isFinite(sRe) || !isFinite(sIm)) throw new Error('the Kramers–Kronig fit is not finite; no result was accepted');
    var nM = r.M;
    return { f: c.f, zr: r.zr, zi: r.zi, resRe: resRe, resIm: resIm, dev: dev, n: n,
             rmsRe: Math.sqrt(sRe / n), rmsIm: Math.sqrt(sIm / n), rms: Math.sqrt((sRe + sIm) / n), max: worst, fmax: fw, chi2ps: sRe + sIm,
             M: nM, mu: r.mu, c: o.c, crit: crit, auto: crit !== 'fixed', top: top, fit: o.fit, cap: !!o.cap,
             capped: crit === 'mu' ? !(r.mu <= o.c) : crit === 'rms' && nM === top,
             tau: r.tau, R: r.coef.slice(1, nM + 1), R0: r.coef[0], L: r.coef[nM + 1], C: o.cap ? 1 / r.coef[nM + 2] : Infinity };
  }

  return { run: run, lstsq: lstsq };
})();
