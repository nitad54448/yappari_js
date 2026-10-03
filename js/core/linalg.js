/*  Dense linear algebra for small symmetric positive definite systems (normal equations).
 *  Matrices are Float64Array, row-major, n x n.
 */
Y.defineCore('linalg', function (Y) {
  'use strict';

  function cholesky(A, n) {
    var L = new Float64Array(n * n);
    for (var i = 0; i < n; i++) {
      for (var j = 0; j <= i; j++) {
        var s = A[i * n + j];
        for (var k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (!(s > 0) || !isFinite(s)) return null;
          L[i * n + i] = Math.sqrt(s);
        } else {
          L[i * n + j] = s / L[j * n + j];
        }
      }
    }
    return L;
  }

  function cholSolve(L, b, n) {
    var x = new Float64Array(n), i, k, s;
    for (i = 0; i < n; i++) {               // L y = b
      s = b[i];
      for (k = 0; k < i; k++) s -= L[i * n + k] * x[k];
      x[i] = s / L[i * n + i];
    }
    for (i = n - 1; i >= 0; i--) {          // L^T x = y
      s = x[i];
      for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
      x[i] = s / L[i * n + i];
    }
    return x;
  }

  // solve A x = b; if A is not numerically PD, retry with a growing ridge. Returns null on failure.
  function solveSPD(A, b, n) {
    var L = cholesky(A, n);
    if (L) return cholSolve(L, b, n);
    var tr = 0, i;
    for (i = 0; i < n; i++) tr += Math.abs(A[i * n + i]);
    var ridge = (tr / Math.max(n, 1)) * 1e-12 || 1e-300;
    for (var attempt = 0; attempt < 8; attempt++, ridge *= 100) {
      var B = Float64Array.from(A);
      for (i = 0; i < n; i++) B[i * n + i] += ridge;
      L = cholesky(B, n);
      if (L) return cholSolve(L, b, n);
    }
    return null;
  }

  function invSPD(A, n) {
    var L = cholesky(A, n);
    if (!L) return null;
    var inv = new Float64Array(n * n), e = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      e.fill(0); e[j] = 1;
      var col = cholSolve(L, e, n);
      for (var i = 0; i < n; i++) inv[i * n + j] = col[i];
    }
    return inv;
  }

  Y.linalg = { cholesky: cholesky, cholSolve: cholSolve, solveSPD: solveSPD, invSPD: invSPD };
});
