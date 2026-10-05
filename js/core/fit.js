/*  Non-linear least squares for one dataset.
 *
 *  Minimised quantity (Yappari definition):  chi2_w = sum_k w_k [ (Zr_calc - Zr_obs)^2 + (Zi_calc - Zi_obs)^2 ]
 *    weight 'mod'  : w = 1/|Z_obs|     'mod2' : w = 1/|Z_obs|^2     'unit' : w = 1
 *  reduced chi2 = chi2_w / DOF,  DOF = 2N - p  (N frequencies, real and imaginary parts both counted, p fitted parameters)
 *  R2 = 1 - SS_res/SS_tot on the stacked, unweighted (Zr, Zi) vector.
 *  SE (%) = 100 * sqrt(diag(s2 (J^T J)^-1)) / |p|, s2 = reduced chi2, J of the weighted residuals at the solution
 *          (central differences). Parameters sitting on a bound get no SE.
 *
 *  Internally, parameters with scale 'log' are fitted as x = ln(p): positivity is automatic and
 *  values spanning many decades (Q, C, R) are handled evenly. The solution is the same. A lower limit of 0 keeps
 *  this (ln 0 = −∞); a 'log' parameter that must be fitted linearly (negative lower limit) is scaled by its size.
 *
 *  Measured standard deviations (job.sr, job.si) replace the weights: w = 1/sigma^2 for each part.
 *  Stop messages start with "converged:" followed by the rule that ended the fit (all are normal ends);
 *  the other ends ("iteration limit reached", "stopped: ...", "singular system", "all fitted parameters are at
 *  their limits") are warnings (status 'warn').
 *
 *  Methods:  'TRDL' trust-region dogleg with box bounds (dogbox variant)   'LMB' Levenberg-Marquardt with bounds
 *            'LM'   Levenberg-Marquardt without bounds                        'NM'  Nelder-Mead with bounds
 *
 *  job = { id, cdc, f, zr, zi (Float64Array, unmasked points), p (all parameters, circuit order),
 *          fit (Uint8Array 1 = free), lo, hi (limits), method, weight, maxIter, tol }
 */
Y.defineCore('fit', function (Y) {
  'use strict';
  var LA = Y.linalg;
  var progCache = {};

  function getProg(cdc) {
    var pr = progCache[cdc];
    if (!pr) { pr = Y.circuit.compile(Y.circuit.parse(cdc)); progCache[cdc] = pr; }
    return pr;
  }

  function weights(zr, zi, mode) {
    var n = zr.length, w = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var m2 = zr[k] * zr[k] + zi[k] * zi[k];
      var v = mode === 'mod2' ? 1 / m2 : (mode === 'mod' ? 1 / Math.sqrt(m2) : 1);
      w[k] = isFinite(v) ? v : 0;
    }
    return w;
  }

  // ---------------------------------------------------------------- problem
  function Problem(job, prog) {
    var n = job.f.length, k, q;
    this.prog = prog; this.n = n;
    this.w = new Float64Array(n);
    for (k = 0; k < n; k++) this.w[k] = 2 * Math.PI * job.f[k];
    this.zr = job.zr; this.zi = job.zi;
    // sqrt of the weights of the real and imaginary parts: 1/sigma when measured standard deviations are given
    var wt = weights(job.zr, job.zi, job.weight), sig = job.sr && job.si && job.sr.length === n && job.si.length === n;
    this.swr = new Float64Array(n); this.swi = new Float64Array(n);
    for (k = 0; k < n; k++) {
      if (sig) { this.swr[k] = 1 / job.sr[k]; this.swi[k] = 1 / job.si[k]; }
      else this.swr[k] = this.swi[k] = Math.sqrt(wt[k]);
    }
    this.ev = Y.circuit.makeEvaluator(prog, this.w);
    this.cr = new Float64Array(n); this.ci = new Float64Array(n);
    this.p = Float64Array.from(job.p);
    this.bounded = job.method !== 'LM';
    var free = [];
    if (job.freeOrder) free = job.freeOrder.slice();
    else for (q = 0; q < this.p.length; q++) if (job.fit[q]) free.push(q);
    this.free = free;
    var nf = free.length;
    // Solver variables. A 'log' parameter with a positive value is fitted as x = ln p; a lower limit of 0 is then
    // ln 0 = −∞ (no lower limit for x). The others are fitted as x = p / s: s = 1 for n, α, β, and for a 'log'
    // parameter that must stay linear (negative lower limit, start value 0, or negative with LM) s is its size, so
    // that difference steps, step caps and the trust region follow it (1e-9 F as well as 1e4 Ω).
    this.isLog = new Uint8Array(nf); this.sc = new Float64Array(nf); this.lo = new Float64Array(nf); this.hi = new Float64Array(nf);
    for (q = 0; q < nf; q++) {
      var j = free[q], v = this.p[j], lo = job.lo[j], hi = job.hi[j], logKind = prog.params[j].scale === 'log';
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      var logOK = logKind && v > 0 && (!this.bounded || (lo >= 0 && hi > 0));
      this.isLog[q] = logOK ? 1 : 0;
      this.sc[q] = logOK || !logKind ? 1 : linScale(v, lo, hi);
      if (this.bounded) { this.lo[q] = logOK ? Math.log(lo) : lo / this.sc[q]; this.hi[q] = logOK ? Math.log(hi) : hi / this.sc[q]; }
      else { this.lo[q] = -Infinity; this.hi[q] = Infinity; }
    }
    this.nev = 0;
    this._r1 = new Float64Array(2 * n); this._r2 = new Float64Array(2 * n);
  }

  // size of a 'log' parameter that is fitted linearly: its start value, else its smallest nonzero finite limit, else 1
  function linScale(v, lo, hi) {
    var a = Math.abs(v);
    if (a > 0 && a < Infinity) return a;
    var c = [Math.abs(lo), Math.abs(hi)].filter(function (b) { return b > 0 && b < Infinity; });
    return c.length ? Math.min.apply(null, c) : 1;
  }

  Problem.prototype.initialX = function () {
    var nf = this.free.length, x = new Float64Array(nf);
    for (var q = 0; q < nf; q++) {
      var v = this.p[this.free[q]];
      x[q] = this.isLog[q] ? Math.log(v) : v / this.sc[q];
      if (this.bounded) x[q] = Math.min(this.hi[q], Math.max(this.lo[q], x[q]));
    }
    return x;
  };

  Problem.prototype.setX = function (x) {
    for (var q = 0; q < x.length; q++) {
      var j = this.free[q];
      this.p[j] = this.isLog[q] ? Math.exp(x[q]) : x[q] * this.sc[q];
    }
  };

  // weighted residuals r (length 2N); returns chi2_w (Infinity if not finite)
  Problem.prototype.resid = function (x, r) {
    this.setX(x); this.nev++;
    this.ev(this.p, this.cr, this.ci);
    var s = 0, n = this.n, zr = this.zr, zi = this.zi, swr = this.swr, swi = this.swi, cr = this.cr, ci = this.ci;
    for (var k = 0; k < n; k++) {
      var a = swr[k] * (cr[k] - zr[k]), b = swi[k] * (ci[k] - zi[k]);
      r[2 * k] = a; r[2 * k + 1] = b;
      s += a * a + b * b;
    }
    return s < Infinity ? s : Infinity;     // also catches NaN
  };

  // finite-difference Jacobian, column-major: J[q*m + i] = d r_i / d x_q
  Problem.prototype.jac = function (x, r0, J, central) {
    var m = 2 * this.n, nf = x.length, xs = Float64Array.from(x), r1 = this._r1, r2 = this._r2, i, q;
    for (q = 0; q < nf; q++) {
      var h = this.isLog[q] ? 1e-6 : 1e-6 * Math.max(Math.abs(x[q]), 0.1), col = q * m;
      if (central) {
        xs[q] = x[q] + h; this.resid(xs, r1);
        xs[q] = x[q] - h; this.resid(xs, r2);
        for (i = 0; i < m; i++) { var d = (r1[i] - r2[i]) / (2 * h); J[col + i] = d === d && Math.abs(d) < Infinity ? d : 0; }
      } else {
        var hh = (this.bounded && x[q] + h > this.hi[q]) ? -h : h;
        xs[q] = x[q] + hh; this.resid(xs, r1);
        for (i = 0; i < m; i++) { var e = (r1[i] - r0[i]) / hh; J[col + i] = e === e && Math.abs(e) < Infinity ? e : 0; }
      }
      xs[q] = x[q];
    }
    this.setX(x);
  };

  // A = J^T J (nf x nf), g = J^T r
  function normalEq(J, r, m, nf, A, g) {
    for (var a = 0; a < nf; a++) {
      var ca = a * m, s = 0, i;
      for (i = 0; i < m; i++) s += J[ca + i] * r[i];
      g[a] = s;
      for (var b = 0; b <= a; b++) {
        var cb = b * m, t = 0;
        for (i = 0; i < m; i++) t += J[ca + i] * J[cb + i];
        A[a * nf + b] = t; A[b * nf + a] = t;
      }
    }
  }

  // variables sitting on a bound with the gradient pushing outwards are frozen for this step
  function activeSet(P, x, g, act) {
    var nfree = 0;
    for (var q = 0; q < x.length; q++) {
      var atLo = P.bounded && x[q] <= P.lo[q] + 1e-12 * (1 + Math.abs(P.lo[q]));
      var atHi = P.bounded && x[q] >= P.hi[q] - 1e-12 * (1 + Math.abs(P.hi[q]));
      act[q] = ((atLo && g[q] > 0) || (atHi && g[q] < 0)) ? 1 : 0;
      if (!act[q]) nfree++;
    }
    return nfree;
  }

  function maxAbs(v) { var m = 0; for (var i = 0; i < v.length; i++) { var a = Math.abs(v[i]); if (a > m) m = a; } return m; }

  // predicted decrease of f = r.r for step s:  -(2 g.s + s^T A s)
  function predicted(A, g, s, nf) {
    var gs = 0, sAs = 0;
    for (var a = 0; a < nf; a++) {
      if (!s[a]) continue;
      gs += g[a] * s[a];
      var t = 0;
      for (var c = 0; c < nf; c++) t += A[a * nf + c] * s[c];
      sAs += s[a] * t;
    }
    return -(2 * gs + sAs);
  }

  // ---------------------------------------------------------------- Levenberg-Marquardt
  function lm(P, x, o) {
    var nf = x.length, m = 2 * P.n;
    var r = new Float64Array(m), rn = new Float64Array(m), J = new Float64Array(m * nf);
    var A = new Float64Array(nf * nf), g = new Float64Array(nf), act = new Uint8Array(nf);
    var xn = new Float64Array(nf), s = new Float64Array(nf);
    var f = P.resid(x, r);
    if (!(f < Infinity)) return { x: x, it: 0, msg: 'the model gives non-finite values at the start values', fail: true };
    var mu = -1, nu = 2, it, needJ = true, conv = 0, msg = 'iteration limit reached', q, a, c;
    for (it = 0; it < o.maxIter; it++) {
      if (needJ) {
        P.jac(x, r, J, false); normalEq(J, r, m, nf, A, g); needJ = false;
        if (mu < 0) mu = 1e-3;              // dimensionless: the damping below is mu × diag(JᵀJ) (Marquardt scaling)
      }
      if (!activeSet(P, x, g, act)) { msg = 'all fitted parameters are at their limits'; break; }
      var F = [], gmax = 0, maxd = 0;
      for (q = 0; q < nf; q++) if (!act[q]) { F.push(q); gmax = Math.max(gmax, Math.abs(g[q])); maxd = Math.max(maxd, A[q * nf + q]); }
      if (gmax <= 1e-14 * f) { msg = 'converged: zero gradient'; break; }
      var nF = F.length, M = new Float64Array(nF * nF), b = new Float64Array(nF);
      for (a = 0; a < nF; a++) {
        b[a] = -g[F[a]];
        for (c = 0; c < nF; c++) M[a * nF + c] = A[F[a] * nf + F[c]];
        M[a * nF + a] += mu * Math.max(A[F[a] * nf + F[a]], 1e-12 * maxd, 1e-300);
      }
      var dF = LA.solveSPD(M, b, nF);
      if (!dF) { mu *= nu; nu *= 2; if (mu > 1e30) { msg = 'singular system'; break; } continue; }
      // cap the step (a factor e^3 for log-scaled parameters) so that a poor start cannot fling
      // parameters to 0 or infinity in one jump; damping keeps the direction
      var scl = 1;
      for (a = 0; a < nF; a++) {
        var cap = P.isLog[F[a]] ? 3 : 0.5 * Math.max(Math.abs(x[F[a]]), 1);
        if (Math.abs(dF[a]) * scl > cap) scl = cap / Math.abs(dF[a]);
      }
      xn.set(x); s.fill(0);
      for (a = 0; a < nF; a++) {
        q = F[a];
        var v = x[q] + scl * dF[a];
        if (P.bounded) v = Math.min(P.hi[q], Math.max(P.lo[q], v));
        xn[q] = v; s[q] = v - x[q];
      }
      var pred = predicted(A, g, s, nf), snorm = maxAbs(s), xnorm = maxAbs(x);
      var fn = P.resid(xn, rn);
      if (fn < f) {
        var rho = pred > 0 ? (f - fn) / pred : 0.5, rel = (f - fn) / f;
        x.set(xn); var tmp = r; r = rn; rn = tmp; f = fn; needJ = true;
        mu *= Math.max(1 / 3, 1 - Math.pow(2 * rho - 1, 3)); nu = 2;
        if (rel < o.tol) { if (++conv >= 2) { msg = 'converged: χ² change below the tolerance'; it++; break; } } else conv = 0;
        if (snorm <= 1e-12 * (xnorm + 1e-12)) { msg = 'converged: steps below numerical resolution'; it++; break; }
      } else {
        mu *= nu; nu *= 2;
        if (mu > 1e25 || snorm <= 1e-15 * (xnorm + 1e-12)) { msg = 'converged: no step lowers χ² further'; break; }
      }
    }
    P.resid(x, r);
    return { x: x, it: it, msg: msg };
  }

  // ---------------------------------------------------------------- trust-region dogleg with bounds
  function trdl(P, x, o) {
    var nf = x.length, m = 2 * P.n;
    var r = new Float64Array(m), rn = new Float64Array(m), J = new Float64Array(m * nf);
    var A = new Float64Array(nf * nf), g = new Float64Array(nf), act = new Uint8Array(nf);
    var xn = new Float64Array(nf), s = new Float64Array(nf);
    var f = P.resid(x, r);
    if (!(f < Infinity)) return { x: x, it: 0, msg: 'the model gives non-finite values at the start values', fail: true };
    var Delta = 1, needJ = true, conv = 0, msg = 'iteration limit reached', it, q, a, c;
    for (it = 0; it < o.maxIter; it++) {
      if (needJ) { P.jac(x, r, J, false); normalEq(J, r, m, nf, A, g); needJ = false; }
      if (!activeSet(P, x, g, act)) { msg = 'all fitted parameters are at their limits'; break; }
      var F = [], gmax = 0, maxd = 0;
      for (q = 0; q < nf; q++) if (!act[q]) { F.push(q); gmax = Math.max(gmax, Math.abs(g[q])); maxd = Math.max(maxd, A[q * nf + q]); }
      if (gmax <= 1e-14 * f) { msg = 'converged: zero gradient'; break; }
      var nF = F.length, M = new Float64Array(nF * nF), gF = new Float64Array(nF), nb = new Float64Array(nF);
      for (a = 0; a < nF; a++) {
        gF[a] = g[F[a]]; nb[a] = -gF[a];
        for (c = 0; c < nF; c++) M[a * nF + c] = A[F[a] * nf + F[c]];
      }
      // Cauchy step along -g
      var gg = 0, gAg = 0;
      for (a = 0; a < nF; a++) {
        gg += gF[a] * gF[a];
        var t = 0;
        for (c = 0; c < nF; c++) t += M[a * nF + c] * gF[c];
        gAg += gF[a] * t;
      }
      var alpha = gAg > 0 ? gg / gAg : Delta / (Math.sqrt(gg) || 1);
      var pc = new Float64Array(nF);
      for (a = 0; a < nF; a++) pc[a] = -alpha * gF[a];
      // Gauss-Newton step (tiny ridge for safety)
      var Mr = Float64Array.from(M);
      for (a = 0; a < nF; a++) Mr[a * nF + a] += 1e-12 * maxd + 1e-300;
      var pg = LA.solveSPD(Mr, nb, nF);
      if (pg) for (a = 0; a < nF; a++) if (!(Math.abs(pg[a]) < Infinity)) { pg = null; break; }
      // box = trust region (inf-norm) intersected with the bounds, relative to x
      var lb = new Float64Array(nF), ub = new Float64Array(nF);
      for (a = 0; a < nF; a++) {
        q = F[a];
        lb[a] = P.bounded ? Math.max(P.lo[q] - x[q], -Delta) : -Delta;
        ub[a] = P.bounded ? Math.min(P.hi[q] - x[q], Delta) : Delta;
      }
      var stepFrac = function (v) {          // largest t in [0,1] with t*v inside the box
        var tt = 1;
        for (var i2 = 0; i2 < nF; i2++) {
          if (v[i2] > 0) tt = Math.min(tt, ub[i2] / v[i2]);
          else if (v[i2] < 0) tt = Math.min(tt, lb[i2] / v[i2]);
        }
        return Math.max(0, tt);
      };
      var p = new Float64Array(nF);
      if (pg && stepFrac(pg) >= 1) p.set(pg);
      else {
        var tc = stepFrac(pc);
        if (tc < 1 || !pg) for (a = 0; a < nF; a++) p[a] = tc * pc[a];
        else {
          var tt = 1;
          for (a = 0; a < nF; a++) {
            var d = pg[a] - pc[a];
            if (d > 0) tt = Math.min(tt, (ub[a] - pc[a]) / d);
            else if (d < 0) tt = Math.min(tt, (lb[a] - pc[a]) / d);
          }
          tt = Math.max(0, tt);
          for (a = 0; a < nF; a++) p[a] = pc[a] + tt * (pg[a] - pc[a]);
        }
      }
      xn.set(x); s.fill(0);
      for (a = 0; a < nF; a++) {
        q = F[a];
        var v = x[q] + p[a];
        if (P.bounded) v = Math.min(P.hi[q], Math.max(P.lo[q], v));
        xn[q] = v; s[q] = v - x[q];
      }
      var pred = predicted(A, g, s, nf), pinf = maxAbs(s), xnorm = maxAbs(x);
      var fn = P.resid(xn, rn);
      var rho = (pred > 0 && fn < Infinity) ? (f - fn) / pred : -1;
      if (rho < 0.25) Delta = Math.max(0.25 * pinf, 1e-300);
      else if (rho > 0.75 && pinf >= 0.95 * Delta) Delta = Math.min(2 * Delta, 1e3);
      if (rho > 1e-4 && fn < f) {
        var rel = (f - fn) / f;
        x.set(xn); var tmp = r; r = rn; rn = tmp; f = fn; needJ = true;
        if (rel < o.tol) { if (++conv >= 2) { msg = 'converged: χ² change below the tolerance'; it++; break; } } else conv = 0;
      }
      if (Delta <= 1e-13 * (1 + xnorm)) { msg = 'converged: steps below numerical resolution'; it++; break; }
    }
    P.resid(x, r);
    return { x: x, it: it, msg: msg };
  }

  // ---------------------------------------------------------------- Nelder-Mead with bounds
  function nelderMead(P, x0, o) {
    var n = x0.length, rt = new Float64Array(2 * P.n), lo = P.lo, hi = P.hi;
    var alpha = 1, gamma = n > 1 ? 1 + 2 / n : 2, rho = n > 1 ? 0.75 - 1 / (2 * n) : 0.5, sigma = n > 1 ? 1 - 1 / n : 0.5;
    var maxIt = Math.max(o.maxIter, 1) * Math.max(n, 1), totalIt = 0;
    function clip(v) { if (P.bounded) for (var j = 0; j < n; j++) v[j] = Math.min(hi[j], Math.max(lo[j], v[j])); return v; }
    function F(v) { return P.resid(v, rt); }
    function run(start, scale) {
      var S = [], fs = [], j, i, it;
      var v0 = clip(Float64Array.from(start));
      S.push(v0); fs.push(F(v0));
      for (j = 0; j < n; j++) {
        var v = Float64Array.from(v0);
        var step = (P.isLog[j] ? 0.1 : 0.05 * Math.max(Math.abs(v0[j]), 0.1)) * scale;
        v[j] += step;
        if (P.bounded && v[j] > hi[j]) v[j] = v0[j] - step;
        clip(v); S.push(v); fs.push(F(v));
      }
      var xc = new Float64Array(n), xr = new Float64Array(n), xe = new Float64Array(n), xk = new Float64Array(n);
      for (it = 0; it < maxIt && totalIt < maxIt; it++, totalIt++) {
        var idx = fs.map(function (_, k) { return k; }).sort(function (a2, b2) { return fs[a2] - fs[b2]; });
        S = idx.map(function (k) { return S[k]; }); fs = idx.map(function (k) { return fs[k]; });
        var diam = 0;
        for (i = 1; i <= n; i++) for (j = 0; j < n; j++) diam = Math.max(diam, Math.abs(S[i][j] - S[0][j]));
        if ((fs[n] - fs[0]) <= o.tol * Math.abs(fs[0]) + 1e-300 || diam < 1e-11 * (1 + maxAbs(S[0]))) break;
        xc.fill(0);
        for (i = 0; i < n; i++) for (j = 0; j < n; j++) xc[j] += S[i][j] / n;
        for (j = 0; j < n; j++) xr[j] = xc[j] + alpha * (xc[j] - S[n][j]);
        clip(xr); var fr = F(xr);
        if (fr < fs[0]) {
          for (j = 0; j < n; j++) xe[j] = xc[j] + gamma * (xr[j] - xc[j]);
          clip(xe); var fe = F(xe);
          if (fe < fr) { S[n] = Float64Array.from(xe); fs[n] = fe; } else { S[n] = Float64Array.from(xr); fs[n] = fr; }
        } else if (fr < fs[n - 1]) {
          S[n] = Float64Array.from(xr); fs[n] = fr;
        } else {
          var outside = fr < fs[n];
          for (j = 0; j < n; j++) xk[j] = outside ? xc[j] + rho * (xr[j] - xc[j]) : xc[j] + rho * (S[n][j] - xc[j]);
          clip(xk); var fk = F(xk);
          if (fk < (outside ? fr : fs[n])) { S[n] = Float64Array.from(xk); fs[n] = fk; }
          else {
            for (i = 1; i <= n; i++) {
              for (j = 0; j < n; j++) S[i][j] = S[0][j] + sigma * (S[i][j] - S[0][j]);
              clip(S[i]); fs[i] = F(S[i]);
            }
          }
        }
      }
      var best = 0;
      for (i = 1; i <= n; i++) if (fs[i] < fs[best]) best = i;
      return { x: S[best], f: fs[best] };
    }
    var res = run(x0, 1);
    if (!(res.f < Infinity)) return { x: x0, it: totalIt, msg: 'the model gives non-finite values at the start values', fail: true };
    var res2 = run(res.x, 0.1);                       // one restart guards against a collapsed simplex
    if (res2.f < res.f) res = res2;
    var msg = totalIt >= maxIt ? 'iteration limit reached' : 'converged: simplex collapsed';
    P.resid(res.x, rt);
    return { x: res.x, it: totalIt, msg: msg };
  }

  // ---------------------------------------------------------------- statistics
  function finalStats(P, x) {
    var m = 2 * P.n, nf = x.length, r = new Float64Array(m), k, q, a, c, i;
    var chi2 = P.resid(x, r);
    var mean = 0;
    for (k = 0; k < P.n; k++) mean += P.zr[k] + P.zi[k];
    mean /= m;
    var sst = 0, ssr = 0;
    for (k = 0; k < P.n; k++) {
      var u = P.zr[k] - mean, v = P.zi[k] - mean, e1 = P.zr[k] - P.cr[k], e2 = P.zi[k] - P.ci[k];
      sst += u * u + v * v; ssr += e1 * e1 + e2 * e2;
    }
    var r2 = sst > 0 ? 1 - ssr / sst : NaN;
    var dof = m - nf, chi2red = dof > 0 ? chi2 / dof : NaN;
    var np = P.p.length, se = new Float64Array(np).fill(NaN), atBound = new Uint8Array(np), idx = [];
    for (q = 0; q < nf; q++) {
      var onB = P.bounded && (x[q] <= P.lo[q] + 1e-9 * (1 + Math.abs(P.lo[q])) || x[q] >= P.hi[q] - 1e-9 * (1 + Math.abs(P.hi[q])));
      if (onB) atBound[P.free[q]] = 1; else idx.push(q);
    }
    if (idx.length && dof > 0 && chi2 < Infinity) {
      var J = new Float64Array(m * nf), sub = idx.length, A = new Float64Array(sub * sub);
      P.jac(x, r, J, true);
      for (a = 0; a < sub; a++) for (c = 0; c <= a; c++) {
        var ca = idx[a] * m, cb = idx[c] * m, t = 0;
        for (i = 0; i < m; i++) t += J[ca + i] * J[cb + i];
        A[a * sub + c] = t; A[c * sub + a] = t;
      }
      var inv = LA.invSPD(A, sub);
      if (inv) for (a = 0; a < sub; a++) {
        q = idx[a];
        var j = P.free[q], vv = chi2red * inv[a * sub + a];
        if (vv >= 0) se[j] = P.isLog[q] ? 100 * Math.sqrt(vv) : 100 * Math.sqrt(vv) * P.sc[q] / Math.abs(P.p[j]);
      }
      P.resid(x, r);
    }
    return { chi2w: chi2, chi2red: chi2red, r2: r2, dof: dof, se: se, atBound: atBound };
  }

  // ---------------------------------------------------------------- stagnation check
  // A solver can stop with tiny steps that are not at a minimum (heavy damping, a trust region shrunk by
  // noise ...). Before a stop is reported as convergence, one bounded Gauss-Newton step is tried from the
  // final point: if it still lowers χ² by more than max(1e-6, 100·tol) (relative), the fit stalled.
  var STALL_MSG = 'stopped: no further progress, but χ² can still decrease (not a minimum; try other start values or another method)';
  function dataScale(P) {
    var s = 0;
    for (var k = 0; k < P.n; k++) { var a = P.swr[k] * P.zr[k], b = P.swi[k] * P.zi[k]; s += a * a + b * b; }
    return s;
  }
  function stalled(P, x, tol) {
    var m = 2 * P.n, nf = x.length, r = new Float64Array(m), q, a, c;
    if (!nf) return false;
    var f = P.resid(x, r);
    if (!(f < Infinity) || f <= 1e-16 * dataScale(P)) { P.resid(x, r); return false; }   // residuals at round-off level
    var J = new Float64Array(m * nf), A = new Float64Array(nf * nf), g = new Float64Array(nf), act = new Uint8Array(nf);
    P.jac(x, r, J, true); normalEq(J, r, m, nf, A, g);
    if (!activeSet(P, x, g, act)) { P.resid(x, r); return false; }
    var F = [];
    for (q = 0; q < nf; q++) if (!act[q]) F.push(q);
    var nF = F.length, M = new Float64Array(nF * nF), b = new Float64Array(nF);
    for (a = 0; a < nF; a++) {
      b[a] = -g[F[a]];
      for (c = 0; c < nF; c++) M[a * nF + c] = A[F[a] * nf + F[c]];
      M[a * nF + a] *= 1 + 1e-9;
    }
    var d = LA.solveSPD(M, b, nF), better = false;
    if (d) {
      var xn = Float64Array.from(x), scl = 1;
      for (a = 0; a < nF; a++) {
        var cap = P.isLog[F[a]] ? 3 : 0.5 * Math.max(Math.abs(x[F[a]]), 1);
        if (Math.abs(d[a]) * scl > cap) scl = cap / Math.abs(d[a]);
      }
      for (a = 0; a < nF; a++) {
        q = F[a]; var v = x[q] + scl * d[a];
        if (P.bounded) v = Math.min(P.hi[q], Math.max(P.lo[q], v));
        xn[q] = v;
      }
      var fn = P.resid(xn, new Float64Array(m));
      better = fn < f * (1 - Math.max(1e-6, 100 * tol));
    }
    P.resid(x, r);                                     // leave P at the final point
    return better;
  }

  // fit status from the message: 'ok' converged (or statistics only, nothing fitted); 'warn' every other end:
  // iteration limit, stalled, singular system, all fitted parameters at their limits. Failures are told by ok: false.
  function status(msg) { return /^(converged|no free parameters)/.test(msg || '') ? 'ok' : 'warn'; }

  // ---------------------------------------------------------------- entry point (also used inside workers)
  function run(job) {
    var t0 = Date.now();
    try {
      var prog = getProg(job.cdc);
      if (prog.names.length !== job.p.length) throw new Error('parameter count does not match the circuit');
      var P = new Problem(job, prog);
      if (P.n < 1) return { id: job.id, ok: false, msg: 'no data points left (all masked?)' };
      if (!Number.isInteger(job.maxIter) || job.maxIter < 1 || job.maxIter > 65535) throw new Error('Maximum iterations must be an integer from 1 to 65535');
      var o = { maxIter: job.maxIter, tol: job.tol > 0 ? job.tol : 1e-12 };
      var x = P.initialX(), res;
      if (!x.length) { P.resid(x, new Float64Array(2 * P.n)); res = { x: x, it: 0, msg: 'no free parameters: statistics only' }; }
      else if (job.method === 'NM') res = nelderMead(P, x, o);
      else if (job.method === 'LM' || job.method === 'LMB') res = lm(P, x, o);
      else res = trdl(P, x, o);
      if (/^converged/.test(res.msg) && !/zero gradient/.test(res.msg) && stalled(P, res.x, o.tol))
        res.msg = STALL_MSG;
      var st = finalStats(P, res.x);
      return { id: job.id, ok: !res.fail, p: Float64Array.from(P.p), se: st.se, atBound: st.atBound,
               chi2w: st.chi2w, chi2red: st.chi2red, r2: st.r2, dof: st.dof, n: P.n,
               iter: res.it, nev: P.nev, msg: res.msg, ms: Date.now() - t0 };
    } catch (e) {
      return { id: job.id, ok: false, msg: String((e && e.message) || e) };
    }
  }

  Y.fit = { run: run, status: status, stalled: stalled, STALL_MSG: STALL_MSG, getProg: getProg, weights: weights, Problem: Problem, normalEq: normalEq,
            methods: { TRDL: 'Trust-region dogleg (bounded)', LMB: 'Levenberg–Marquardt (bounded)',
                       LM: 'Levenberg–Marquardt (unbounded)', NM: 'Nelder–Mead (bounded)' },
            weightModes: { mod: '|Z|  (w = 1/|Z|)', mod2: '|Z|²  (w = 1/|Z|²)', unit: 'equal  (w = 1)' } };
});
