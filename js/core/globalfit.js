/*  Global fit of several datasets with one circuit.
 *  Each fitted parameter is either shared (one value for all datasets) or local (one value per dataset).
 *  All shared = Yappari's global_fit_selected_datasets.
 *  Levenberg-Marquardt on the block-arrow normal equations (Schur complement on the shared block),
 *  so hundreds of datasets with local parameters stay cheap. Bounds are applied by projection,
 *  except for method 'LM' (unbounded).
 *
 *  job = { cdc, sets:[{id, f, zr, zi, p}], fit, shared (Uint8Array over all parameters), lo, hi,
 *          weight, method, maxIter, tol }
 *  Shared parameters start from sets[0].p, local ones from each set's own values.
 */
Y.defineCore('globalfit', function (Y) {
  'use strict';
  var LA = Y.linalg;

  function dotCols(J, m, a, b) { var t = 0, ca = a * m, cb = b * m; for (var i = 0; i < m; i++) t += J[ca + i] * J[cb + i]; return t; }
  function dotColVec(J, m, a, r) { var t = 0, ca = a * m; for (var i = 0; i < m; i++) t += J[ca + i] * r[i]; return t; }

  function run(job) {
    var t0 = Date.now();
    try {
      var prog = Y.fit.getProg(job.cdc), np = prog.names.length, j, i, a, b, c;
      var S = [], L = [];
      for (j = 0; j < np; j++) if (job.fit[j]) (job.shared[j] ? S : L).push(j);
      var nS = S.length, nL = L.length, nd = job.sets.length, nV = nS + nL;
      if (!nV) throw new Error('no free parameters');
      if (nd < 1) throw new Error('no datasets');
      var order = S.concat(L);
      var probs = job.sets.map(function (st) {
        var p = Float64Array.from(st.p);
        S.forEach(function (jj) { p[jj] = job.sets[0].p[jj]; });
        return new Y.fit.Problem({ f: st.f, zr: st.zr, zi: st.zi, sr: st.sr, si: st.si, p: p, fit: job.fit, lo: job.lo, hi: job.hi,
                                   method: job.method, weight: job.weight, freeOrder: order }, prog);
      });
      probs.forEach(function (P) { if (P.n < 1) throw new Error('a dataset has no data points'); });
      var bounded = job.method !== 'LM';
      var nX = nS + nd * nL, X = new Float64Array(nX), lo = new Float64Array(nX), hi = new Float64Array(nX);
      var x0 = probs[0].initialX();
      for (a = 0; a < nS; a++) { X[a] = x0[a]; lo[a] = probs[0].lo[a]; hi[a] = probs[0].hi[a]; }
      probs.forEach(function (P, ii) {
        var xi0 = P.initialX();
        for (var bb = 0; bb < nL; bb++) {
          var k = nS + ii * nL + bb;
          X[k] = xi0[nS + bb]; lo[k] = P.lo[nS + bb]; hi[k] = P.hi[nS + bb];
        }
      });
      var xs = probs.map(function () { return new Float64Array(nV); });
      function xOf(ii, V) {
        var out = xs[ii];
        for (var aa = 0; aa < nS; aa++) out[aa] = V[aa];
        for (var bb = 0; bb < nL; bb++) out[nS + bb] = V[nS + ii * nL + bb];
        return out;
      }
      var R = probs.map(function (P) { return new Float64Array(2 * P.n); });
      var Rn = probs.map(function (P) { return new Float64Array(2 * P.n); });
      function total(V, RR) {
        var s = 0;
        for (var ii = 0; ii < nd; ii++) { s += probs[ii].resid(xOf(ii, V), RR[ii]); if (!(s < Infinity)) return Infinity; }
        return s;
      }

      var A = new Float64Array(nS * nS), gS = new Float64Array(nS);
      var B = [], D = [], gL = [];
      for (i = 0; i < nd; i++) { B.push(new Float64Array(nS * nL)); D.push(new Float64Array(nL * nL)); gL.push(new Float64Array(nL)); }
      function blocks(central) {
        A.fill(0); gS.fill(0);
        for (var ii = 0; ii < nd; ii++) {
          var P = probs[ii], m = 2 * P.n, J = new Float64Array(m * nV);
          P.jac(xOf(ii, X), R[ii], J, central);
          for (var aa = 0; aa < nS; aa++) {
            gS[aa] += dotColVec(J, m, aa, R[ii]);
            for (var cc = 0; cc <= aa; cc++) { var t = dotCols(J, m, aa, cc); A[aa * nS + cc] += t; if (cc !== aa) A[cc * nS + aa] += t; }
          }
          for (var bb = 0; bb < nL; bb++) {
            gL[ii][bb] = dotColVec(J, m, nS + bb, R[ii]);
            for (aa = 0; aa < nS; aa++) B[ii][aa * nL + bb] = dotCols(J, m, aa, nS + bb);
            for (cc = 0; cc <= bb; cc++) { var t2 = dotCols(J, m, nS + bb, nS + cc); D[ii][bb * nL + cc] = t2; D[ii][cc * nL + bb] = t2; }
          }
          P.resid(xOf(ii, X), R[ii]);
        }
      }

      // damped step (Schur complement on the shared block) from X into Xn; false when the system is singular
      function step(mu) {
        var a, b, c, i;
        var M = Float64Array.from(A), rhs = new Float64Array(nS), chol = [], zg = [], ok = true;
        for (a = 0; a < nS; a++) { rhs[a] = -gS[a]; M[a * nS + a] += mu * Math.max(A[a * nS + a], 1e-300); }
        for (i = 0; i < nd && nL; i++) {
          var Dd = Float64Array.from(D[i]);
          for (b = 0; b < nL; b++) Dd[b * nL + b] += mu * Math.max(D[i][b * nL + b], 1e-300);
          var Lc = LA.cholesky(Dd, nL);
          if (!Lc) { ok = false; break; }
          chol.push(Lc);
          zg.push(LA.cholSolve(Lc, gL[i], nL));
          for (a = 0; a < nS; a++) {
            var col = new Float64Array(nL);
            for (b = 0; b < nL; b++) col[b] = B[i][a * nL + b];
            var z = LA.cholSolve(Lc, col, nL);                 // D^-1 B^T e_a
            for (c = 0; c < nS; c++) { var t = 0; for (b = 0; b < nL; b++) t += B[i][c * nL + b] * z[b]; M[c * nS + a] -= t; }
          }
          for (a = 0; a < nS; a++) { var t3 = 0; for (b = 0; b < nL; b++) t3 += B[i][a * nL + b] * zg[i][b]; rhs[a] += t3; }
        }
        var dS = ok ? (nS ? LA.solveSPD(M, rhs, nS) : new Float64Array(0)) : null;
        if (!dS) return false;
        Xn.set(X);
        for (a = 0; a < nS; a++) Xn[a] = X[a] + dS[a];
        for (i = 0; i < nd && nL; i++) {
          var v = new Float64Array(nL);
          for (b = 0; b < nL; b++) { var t4 = -gL[i][b]; for (a = 0; a < nS; a++) t4 -= B[i][a * nL + b] * dS[a]; v[b] = t4; }
          var dl = LA.cholSolve(chol[i], v, nL);
          for (b = 0; b < nL; b++) Xn[nS + i * nL + b] = X[nS + i * nL + b] + dl[b];
        }
        if (bounded) for (a = 0; a < nX; a++) Xn[a] = Math.min(hi[a], Math.max(lo[a], Xn[a]));
        return true;
      }

      var f = total(X, R);
      if (!(f < Infinity)) throw new Error('the model gives non-finite values at the start values');
      var mu = -1, nu = 2, it, conv = 0, needJ = true, msg = 'iteration limit reached';
      var Xn = new Float64Array(nX), st = new Float64Array(nX), maxIter = Math.max(1, job.maxIter | 0), tol = job.tol > 0 ? job.tol : 1e-12;
      for (it = 0; it < maxIter; it++) {
        if (needJ) {
          blocks(false); needJ = false;
          if (mu < 0) mu = 1e-3;          // dimensionless: the damping is mu × the diagonal of JᵀJ
        }
        if (!step(mu)) { mu *= nu; nu *= 2; if (mu > 1e30) { msg = 'singular system'; break; } continue; }
        for (a = 0; a < nX; a++) st[a] = Xn[a] - X[a];
        // predicted decrease with the undamped blocks
        var gs = 0, sAs = 0;
        for (a = 0; a < nS; a++) { gs += gS[a] * st[a]; for (c = 0; c < nS; c++) sAs += st[a] * A[a * nS + c] * st[c]; }
        for (i = 0; i < nd && nL; i++) {
          var off = nS + i * nL;
          for (b = 0; b < nL; b++) {
            gs += gL[i][b] * st[off + b];
            for (c = 0; c < nL; c++) sAs += st[off + b] * D[i][b * nL + c] * st[off + c];
            for (a = 0; a < nS; a++) sAs += 2 * st[a] * B[i][a * nL + b] * st[off + b];
          }
        }
        var pred = -(2 * gs + sAs), snorm = 0, xnorm = 0;
        for (a = 0; a < nX; a++) { snorm = Math.max(snorm, Math.abs(st[a])); xnorm = Math.max(xnorm, Math.abs(X[a])); }
        var fn = total(Xn, Rn);
        if (fn < f) {
          var rho = pred > 0 ? (f - fn) / pred : 0.5, rel = (f - fn) / f;
          X.set(Xn); var tmp = R; R = Rn; Rn = tmp; f = fn; needJ = true;
          mu *= Math.max(1 / 3, 1 - Math.pow(2 * rho - 1, 3)); nu = 2;
          if (rel < tol) { if (++conv >= 2) { msg = 'converged: χ² change below the tolerance'; it++; break; } } else conv = 0;
          if (snorm <= 1e-12 * (xnorm + 1e-12)) { msg = 'converged: steps below numerical resolution'; it++; break; }
        } else {
          mu *= nu; nu *= 2;
          if (mu > 1e25) { msg = 'converged: no step lowers χ² further'; break; }
        }
      }
      f = total(X, R);
      // a stop that looks like convergence is checked with one nearly undamped step (see Y.fit.stalled)
      if (/^converged/.test(msg) && f > 0) {
        var scale = 0;
        probs.forEach(function (P) { for (var k = 0; k < P.n; k++) { var u = P.swr[k] * P.zr[k], w2 = P.swi[k] * P.zi[k]; scale += u * u + w2 * w2; } });
        if (f > 1e-16 * scale) {
          blocks(true);
          if (step(1e-9) && total(Xn, Rn) < f * (1 - Math.max(1e-6, 100 * tol))) msg = Y.fit.STALL_MSG;
          f = total(X, R);
        }
      }

      // statistics
      var nPts = 0;
      probs.forEach(function (P) { nPts += 2 * P.n; });
      var dof = nPts - nX, chi2red = dof > 0 ? f / dof : NaN;
      var seS = new Float64Array(nS).fill(NaN), seL = probs.map(function () { return new Float64Array(nL).fill(NaN); });
      if (dof > 0) {
        blocks(true);
        var Ssch = Float64Array.from(A), Z = [], Dinv = [];
        for (i = 0; i < nd && nL; i++) {
          var Di = LA.invSPD(D[i], nL);
          Dinv.push(Di);
          if (!Di) { Z.push(null); continue; }
          var Zi = new Float64Array(nL * nS);                   // D^-1 B^T
          for (b = 0; b < nL; b++) for (a = 0; a < nS; a++) {
            var t5 = 0;
            for (c = 0; c < nL; c++) t5 += Di[b * nL + c] * B[i][a * nL + c];
            Zi[b * nS + a] = t5;
          }
          Z.push(Zi);
          for (a = 0; a < nS; a++) for (c = 0; c < nS; c++) {
            var t6 = 0;
            for (b = 0; b < nL; b++) t6 += B[i][a * nL + b] * Zi[b * nS + c];
            Ssch[a * nS + c] -= t6;
          }
        }
        var Sinv = nS ? LA.invSPD(Ssch, nS) : new Float64Array(0);
        if (Sinv) for (a = 0; a < nS; a++) seS[a] = Math.sqrt(Math.max(0, chi2red * Sinv[a * nS + a]));
        for (i = 0; i < nd && nL; i++) {
          if (!Dinv[i] || !Sinv) continue;
          for (b = 0; b < nL; b++) {
            var vv = Dinv[i][b * nL + b];
            for (a = 0; a < nS; a++) for (c = 0; c < nS; c++) vv += Z[i][b * nS + a] * Sinv[a * nS + c] * Z[i][b * nS + c];
            seL[i][b] = Math.sqrt(Math.max(0, chi2red * vv));
          }
        }
      }

      var sets = probs.map(function (P, ii) {
        var r = R[ii], m = 2 * P.n, chi = 0, k, q;
        P.resid(xOf(ii, X), r);
        for (k = 0; k < m; k++) chi += r[k] * r[k];
        var mean = 0, sst = 0, ssr = 0;
        for (k = 0; k < P.n; k++) mean += P.zr[k] + P.zi[k];
        mean /= m;
        for (k = 0; k < P.n; k++) {
          var u = P.zr[k] - mean, w2 = P.zi[k] - mean, e1 = P.zr[k] - P.cr[k], e2 = P.zi[k] - P.ci[k];
          sst += u * u + w2 * w2; ssr += e1 * e1 + e2 * e2;
        }
        var se = new Float64Array(np).fill(NaN), atBound = new Uint8Array(np);
        for (q = 0; q < nV; q++) {
          var jj = order[q], xv = xs[ii][q], sev = q < nS ? seS[q] : seL[ii][q - nS];
          var onB = bounded && (xv <= P.lo[q] + 1e-9 * (1 + Math.abs(P.lo[q])) || xv >= P.hi[q] - 1e-9 * (1 + Math.abs(P.hi[q])));
          if (onB) { atBound[jj] = 1; continue; }
          se[jj] = P.isLog[q] ? 100 * sev : 100 * sev / Math.abs(P.p[jj]);
        }
        var localDof = m - nL - nS / nd;
        return { id: job.sets[ii].id, p: Float64Array.from(P.p), se: se, atBound: atBound, chi2w: chi,
                 chi2red: localDof > 0 ? chi / localDof : NaN, r2: sst > 0 ? 1 - ssr / sst : NaN, n: P.n };
      });
      return { ok: true, sets: sets, chi2w: f, chi2red: chi2red, dof: dof, iter: it, msg: msg,
               nShared: nS, nLocal: nL, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, msg: String((e && e.message) || e) };
    }
  }

  Y.globalFit = { run: run };
});
