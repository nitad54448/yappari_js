/*  Operations on datasets. A dataset here is any object with Float64Array f, zr, zi and Uint8Array mask
 *  (mask[k] = 1: point left out of fits). Masks apply to fits only: every operation here, and the DRT and
 *  Z-HIT (js/core/drt.js), use masked points as well. DOM-free (also used by the Node tests).
 */
Y.dataops = (function () {
  'use strict';

  function logspace(a, b, n) {
    var out = new Float64Array(n), la = Math.log10(a), lb = Math.log10(b);
    for (var k = 0; k < n; k++) out[k] = n === 1 ? a : Math.pow(10, la + (lb - la) * k / (n - 1));
    return out;
  }

  // uniform noise in [-pct, +pct] % of |Z|, added to Zr and/or Zi; target 'f' perturbs the frequencies
  function addNoise(ds, pct, target, rnd) {
    rnd = rnd || Math.random;
    var a = pct / 100;
    for (var k = 0; k < ds.f.length; k++) {
      var m = Math.hypot(ds.zr[k], ds.zi[k]);
      if (target === 'z' || target === 'zr') ds.zr[k] += a * m * (2 * rnd() - 1);
      if (target === 'z' || target === 'zi') ds.zi[k] += a * m * (2 * rnd() - 1);
      if (target === 'f') ds.f[k] *= 1 + a * (2 * rnd() - 1);
    }
  }

  function negateZi(ds) { for (var k = 0; k < ds.zi.length; k++) ds.zi[k] = -ds.zi[k]; }
  function scaleZ(ds, factor) {
    for (var k = 0; k < ds.zr.length; k++) { ds.zr[k] *= factor; ds.zi[k] *= factor; if (ds.sr) ds.sr[k] *= Math.abs(factor); if (ds.si) ds.si[k] *= Math.abs(factor); }
  }

  // points sorted by ascending frequency, duplicate frequencies averaged; masked points included (masks are for fits)
  function cleanSorted(ds) {
    var idx = [];
    for (var k = 0; k < ds.f.length; k++) if (ds.f[k] > 0 && isFinite(ds.zr[k]) && isFinite(ds.zi[k])) idx.push(k);
    idx.sort(function (a, b) { return ds.f[a] - ds.f[b]; });
    var f = [], zr = [], zi = [], cnt = [];
    idx.forEach(function (k) {
      var last = f.length - 1;
      if (last >= 0 && Math.abs(ds.f[k] - f[last]) <= 1e-12 * f[last]) {
        zr[last] += ds.zr[k]; zi[last] += ds.zi[k]; cnt[last]++;
      } else { f.push(ds.f[k]); zr.push(ds.zr[k]); zi.push(ds.zi[k]); cnt.push(1); }
    });
    for (var j = 0; j < f.length; j++) { zr[j] /= cnt[j]; zi[j] /= cnt[j]; }
    return { f: Float64Array.from(f), zr: Float64Array.from(zr), zi: Float64Array.from(zi) };
  }

  function descending(ds) { var n = ds.f.length; return n > 1 && ds.f[0] > ds.f[n - 1]; }
  function reverseAll(o) { Array.prototype.reverse.call(o.f); Array.prototype.reverse.call(o.zr); Array.prototype.reverse.call(o.zi); return o; }

  // natural cubic spline: second derivatives
  function splineY2(x, y) {
    var n = x.length, y2 = new Float64Array(n), u = new Float64Array(n);
    for (var i = 1; i < n - 1; i++) {
      var sig = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]), p = sig * y2[i - 1] + 2;
      y2[i] = (sig - 1) / p;
      u[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
      u[i] = (6 * u[i] / (x[i + 1] - x[i - 1]) - sig * u[i - 1]) / p;
    }
    for (var k = n - 2; k >= 0; k--) y2[k] = y2[k] * y2[k + 1] + u[k];
    return y2;
  }
  function splineAt(x, y, y2, xq) {
    var lo = 0, hi = x.length - 1;
    while (hi - lo > 1) { var mid = (hi + lo) >> 1; if (x[mid] > xq) hi = mid; else lo = mid; }
    var h = x[hi] - x[lo], a = (x[hi] - xq) / h, b = (xq - x[lo]) / h;
    return a * y[lo] + b * y[hi] + ((a * a * a - a) * y2[lo] + (b * b * b - b) * y2[hi]) * h * h / 6;
  }

  // cubic spline of Zr and Zi versus log10(f), resampled on n log-spaced frequencies (masked points included)
  function spline(ds, n) {
    var c = cleanSorted(ds), m = c.f.length;
    if (m < 3) throw new Error('spline needs at least 3 distinct frequencies');
    var lx = c.f.map(Math.log10), y2r = splineY2(lx, c.zr), y2i = splineY2(lx, c.zi);
    var fq = logspace(c.f[0], c.f[m - 1], n), zr = new Float64Array(n), zi = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var xq = Math.log10(fq[k]);
      zr[k] = splineAt(lx, c.zr, y2r, xq); zi[k] = splineAt(lx, c.zi, y2i, xq);
    }
    var out = { f: fq, zr: zr, zi: zi };
    return descending(ds) ? reverseAll(out) : out;
  }

  // Savitzky-Golay: least-squares polynomial of degree deg on 2*side+1 neighbours (points taken as equally
  // spaced, i.e. log-spaced frequencies); windows are shifted at the ends instead of shrunk (masked points included)
  function smooth(ds, side, deg) {
    var c = cleanSorted(ds), n = c.f.length, w = 2 * side + 1;
    if (n < 3) throw new Error('smoothing needs at least 3 points');
    if (w > n) { side = (n - 1) >> 1; w = 2 * side + 1; }
    deg = Math.max(0, Math.min(deg, w - 1));
    var zr = new Float64Array(n), zi = new Float64Array(n), nc = deg + 1;
    for (var i = 0; i < n; i++) {
      var s0 = Math.min(Math.max(0, i - side), n - w), A = new Float64Array(nc * nc), br = new Float64Array(nc), bi = new Float64Array(nc);
      for (var j = s0; j < s0 + w; j++) {
        var x = j - i, pw = [];
        for (var a = 0, v = 1; a < nc; a++, v *= x) pw.push(v);
        for (a = 0; a < nc; a++) {
          br[a] += pw[a] * c.zr[j]; bi[a] += pw[a] * c.zi[j];
          for (var b = 0; b < nc; b++) A[a * nc + b] += pw[a] * pw[b];
        }
      }
      var L = Y.linalg.cholesky(A, nc);
      if (!L) { zr[i] = c.zr[i]; zi[i] = c.zi[i]; continue; }
      zr[i] = Y.linalg.cholSolve(L, br, nc)[0];
      zi[i] = Y.linalg.cholSolve(L, bi, nc)[0];
    }
    var out = { f: c.f, zr: zr, zi: zi };
    return descending(ds) ? reverseAll(out) : out;
  }

  // point-by-point mean of every point, masked or not; all datasets must share the same frequencies
  function average(list) {
    if (list.length < 2) throw new Error('select at least two datasets to average');
    var n = list[0].f.length;
    list.forEach(function (d) {
      if (d.f.length !== n) throw new Error('"' + d.name + '" has a different number of points');
      for (var k = 0; k < n; k++) if (Math.abs(d.f[k] - list[0].f[k]) > 1e-6 * Math.abs(list[0].f[k])) throw new Error('"' + d.name + '" was measured at different frequencies');
    });
    var zr = new Float64Array(n), zi = new Float64Array(n);
    list.forEach(function (d) { for (var k = 0; k < n; k++) { zr[k] += d.zr[k] / list.length; zi[k] += d.zi[k] / list.length; } });
    return { f: Float64Array.from(list[0].f), zr: zr, zi: zi };
  }

  // value of a point in the coordinates of a plot: 'nyq' x=Zr y=-Zi | 'zr' x=f y=Zr | 'zi' x=f y=Zi | 'mod' x=f y=|Z| | 'phase' x=f y=phase (deg)
  function coords(ds, k, kind) {
    var f = ds.f[k], zr = ds.zr[k], zi = ds.zi[k];
    switch (kind) {
      case 'nyq': return [zr, -zi];
      case 'zr': return [f, zr];
      case 'zi': return [f, zi];
      case 'mod': return [f, Math.hypot(zr, zi)];
      case 'phase': return [f, Math.atan2(zi, zr) * 180 / Math.PI];
    }
    return [NaN, NaN];
  }

  // flags of the points inside the rectangle [x0,x1] x [y0,y1] (data units): the unmasked ones (to mask them), or
  // all of them with withMasked (to delete them)
  function inView(ds, kind, v, withMasked) {
    var n = ds.f.length, out = new Uint8Array(n), cnt = 0;
    for (var k = 0; k < n; k++) {
      if (ds.mask[k] && !withMasked) continue;
      var c = coords(ds, k, kind);
      if (c[0] >= v.x0 && c[0] <= v.x1 && c[1] >= v.y0 && c[1] <= v.y1) { out[k] = 1; cnt++; }
    }
    out.count = cnt;
    return out;
  }

  // remove flagged points (returns number removed)
  function removePoints(ds, flags) {
    var keep = [];
    for (var k = 0; k < ds.f.length; k++) if (!flags[k]) keep.push(k);
    var removed = ds.f.length - keep.length;
    ['f', 'zr', 'zi', 'sr', 'si'].forEach(function (key) { if (ds[key]) ds[key] = Float64Array.from(keep, function (k) { return ds[key][k]; }); });
    ds.mask = Uint8Array.from(keep, function (k) { return ds.mask[k]; });
    return removed;
  }

  return { logspace: logspace, addNoise: addNoise, negateZi: negateZi, scaleZ: scaleZ, cleanSorted: cleanSorted,
           spline: spline, smooth: smooth, splineY2: splineY2, splineAt: splineAt, average: average, coords: coords, inView: inView, removePoints: removePoints };
})();
