/* Regression tests for zero-modulus weights, non-finite fixed models and the
 * low-frequency open Warburg. Called by run_core_tests.js. */
'use strict';
const vm = require('vm');
module.exports = function (Y, ok, close) {
  const base = { id: 1, cdc: 'R', f: [1, 2, 3], zr: [0, 0, 0], zi: [0, 0, 0],
    p: [100], fit: [1], lo: [0], hi: [1000], method: 'LMB', weight: 'mod', maxIter: 100, tol: 1e-12 };
  for (const weight of ['mod', 'mod2']) {
    for (const method of ['TRDL', 'LMB', 'LM', 'NM']) {
      const r = Y.fit.run(Object.assign({}, base, { weight, method }));
      ok(!r.ok && /nonzero/.test(r.msg) && !r.p, 'zero modulus rejected: ' + method + ', ' + weight);
    }
    const mixed = Object.assign({}, base, { weight, zr: [10, 0, 20] });
    const r = Y.fit.run(mixed);
    ok(!r.ok && /point 2/.test(r.msg), 'a zero point among nonzero data is not silently omitted: ' + weight);
    const global = Y.globalFit.run(Object.assign({}, mixed, { shared: [1], sets: [mixed, Object.assign({}, mixed, { id: 2 })] }));
    ok(!global.ok && /nonzero/.test(global.msg), 'global fit rejects zero modulus: ' + weight);
    const sigma = Y.fit.run(Object.assign({}, base, { weight, fit: [0], sr: [2, 2, 2], si: [2, 2, 2] }));
    ok(sigma.ok && sigma.chi2w === 7500, 'valid sigma weights override modulus weights even for zero data: ' + weight);
  }
  const equal = Y.fit.run(Object.assign({}, base, { weight: 'unit', fit: [0] }));
  ok(equal.ok && equal.chi2w === 30000, 'equal weights retain the residual of zero-impedance points');
  // Squaring |Z| first used to overflow/underflow for these finite values.
  close(Y.fit.weights([1e200], [0], 'mod')[0], 1e-200, 1e-14, 'large finite modulus retains a positive weight');
  close(Y.fit.weights([1e-200], [0], 'mod')[0], 1e200, 1e-14, 'small finite modulus retains a finite weight');
  for (const z of [1e200, 1e-200]) {
    let rejected = false;
    try { Y.fit.weights([z], [0], 'mod2'); } catch (e) { rejected = /numeric range/.test(e.message); }
    ok(rejected, 'unrepresentable squared weight is rejected rather than zeroed: ' + z);
  }
  const fixed = Object.assign({}, base, { cdc: 'C', p: [0], fit: [0], hi: [1], weight: 'unit', zr: [1, 1, 1], zi: [-1, -1, -1] });
  const invalid = Y.fit.run(fixed);
  ok(!invalid.ok && /non-finite/.test(invalid.msg) && !invalid.p, 'fixed C=0 is a failure, not successful infinite statistics');
  const valid = Y.fit.run(Object.assign({}, fixed, { p: [1] }));
  ok(valid.ok && Number.isFinite(valid.chi2w) && /statistics only/.test(valid.msg), 'valid fixed models still return statistics');
  // The same guards must be present in the generated worker source.
  const ctx = vm.createContext({});
  vm.runInContext('var Y = {}; Y.defineCore = function(n, f) { f(Y); };\n' + Y.coreSources.join('\n'), ctx);
  ctx.job = fixed;
  ok(!vm.runInContext('Y.fit.run(job).ok', ctx), 'worker rejects invalid fixed models');
  ctx.job = base;
  ok(!vm.runInContext('Y.fit.run(job).ok', ctx), 'worker rejects zero-modulus weights');

  const wo = Y.fit.getProg('Wo');
  for (const f of [1e-6, 1e-4, 0.01, 1]) {
    const z = Y.circuit.impedance(wo, [f], [100, 1e-6]);
    close(z.re[0], 100e-6 / 3, 1e-12, 'Wo low-frequency real part, f=' + f);
    close(z.im[0], -100 / (2 * Math.PI * f * 1e-6), 1e-12, 'Wo low-frequency imaginary part, f=' + f);
  }
  // Independent 75-digit decimal sinh/cosh/sin/cos series references for
  // coth(sqrt(j*x))/sqrt(j*x) on both sides
  // of the series/direct-formula boundary (A=B=1 and x=2*pi*f).
  const refs = [
    [0.009999, 0.3333331217356613, -100.01022319988843],
    [0.01, 0.33333312169333545, -100.00022222201058],
    [0.010001, 0.33333312165100537, -99.99022324413275]
  ];
  refs.forEach(([x, re, im]) => {
    const z = Y.circuit.impedance(wo, [x / (2 * Math.PI)], [1, 1]);
    close(z.re[0], re, 1e-11, 'Wo boundary real, x=' + x);
    close(z.im[0], im, 1e-11, 'Wo boundary imaginary, x=' + x);
  });
};
