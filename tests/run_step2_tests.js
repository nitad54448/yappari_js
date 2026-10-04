/* measured-error weights, stop messages, DRT, Z-HIT; called from run_core_tests.js */
'use strict';
module.exports = function (Y, ok, close) {
  const lcg = s => () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
  const sim = (cdc, pv, f) => Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), f, Float64Array.from(pv));
  const bnd = pr => ({ lo: Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).min)), hi: Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).max)) });

  // ---------- fit with measured standard deviations: points with a huge sigma are ignored
  const pr = Y.circuit.compile(Y.circuit.parse('R(RQ)')), f2 = Y.dataops.logspace(1e5, 1e-1, 61), tv = [20, 1000, 2e-6, 0.85];
  const z2 = sim('R(RQ)', tv, f2), zr = Float64Array.from(z2.re), zi = Float64Array.from(z2.im), sr = new Float64Array(61), si = new Float64Array(61);
  for (let k = 0; k < 61; k++) { const m = Math.hypot(zr[k], zi[k]); sr[k] = si[k] = 1e-3 * m; if (k % 5 === 0) { zr[k] *= 1.5; zi[k] *= 0.5; sr[k] = si[k] = 1e6 * m; } }
  const b = bnd(pr), base = { id: 1, cdc: pr.cdc, f: f2, zr, zi, p: Float64Array.from([30, 800, 3e-6, 0.8]), fit: Uint8Array.from([1, 1, 1, 1]), lo: b.lo, hi: b.hi, method: 'TRDL', weight: 'mod', maxIter: 500, tol: 1e-12 };
  const rs = Y.fit.run(Object.assign({}, base, { sr, si })), ru = Y.fit.run(base);
  [0, 1, 2, 3].forEach(j => close(rs.p[j], tv[j], 1e-4, 'sigma-weighted fit ignores outliers, ' + pr.names[j]));
  ok(Math.abs(ru.p[1] / tv[1] - 1) > 0.01, 'without sigma the outliers bias the fit (R2 ' + ru.p[1].toFixed(1) + ')');
  ok(/^converged: /.test(rs.msg) && /^converged: /.test(ru.msg), 'stop messages start with "converged:" (' + rs.msg + ')');

  // ---------- missing standard deviations take the median relative error of the others
  Y.state.S.settings.useSigma = true;
  Y.state.setModel(Y.circuit.parse('R(RQ)'), { quiet: true });
  const half = Float64Array.from(sr, (v, k) => k < 30 ? NaN : 0.002 * Math.hypot(zr[k], zi[k]));
  const ds = Y.state.makeDataset({ name: 't', f: f2, zr, zi, sr: half, si: half });
  const fd = Y.state.fitData(ds);
  ok(fd.sr && Math.abs(fd.sr[3] / Math.hypot(zr[3], zi[3]) - 0.002) < 1e-12 && /31 of 61/.test(fd.sigma), 'sigma filled from the median relative error (' + fd.sigma + ')');
  Y.state.S.settings.useSigma = false;
  ok(!Y.state.fitData(ds).sr, 'measured errors not used when the setting is off');

  // ---------- readers keep standard deviations
  const csv = ['chunk;timestamp;size;fieldname'];
  const fq = [1e5, 1e4, 1e3, 1e2, 10], zz = fq.map(v => [100 + v * 1e-3, -v * 1e-2]);
  const row = (name, vals) => ['0', '1', '5', name].concat(vals.map(String)).join(';');
  csv.push(row('frequency', fq), row('imagz', zz.map(q => q[1])), row('imagzstddev', ['nan', 'nan', 0.2, 0.3, 0.4]), row('realz', zz.map(q => q[0])), row('realzstddev', ['nan', 'nan', 0.1, 0.1, 0.1]));
  const m1 = Y.readers.mfliCsv(csv.join('\n'), 'm.csv')[0];
  ok(m1.sr && isNaN(m1.sr[0]) && m1.si[4] === 0.4, 'MFLI csv realzstddev / imagzstddev read');
  const back = Y.readers.headerTable(Y.writers.dataText([Object.assign({ mask: new Uint8Array(5) }, m1)], { sep: 'tab' }, () => null), 'x.txt')[0];
  ok(back.sr[3] === 0.1 && back.si[2] === 0.2 && isNaN(back.sr[1]), 'sigma columns written by Save data and read back');

  // ---------- DRT of three RC in series (Simulate_and_drt tutorial values)
  const f = Y.dataops.logspace(1e-1, 1e7, 81), rc = [[200, 48e-9], [100, 1e-6], [56, 22e-9]];
  const z = sim('(RC)(RC)(RC)', rc.flat(), f), d3 = { name: 'rc3', f, zr: z.re, zi: z.im, mask: new Uint8Array(81) };
  const expect = rc.map(([R, C]) => ({ R, tau: R * C })).sort((a, b) => a.tau - b.tau);   // high frequency first
  for (const [method, extra] of [['tikhonov', {}], ['fisk', {}], ['gold', { iterations: 3e5 }]]) {
    const t0 = Date.now(), r = Y.drt.compute(d3, Object.assign({ method, source: 'both', lambda: 1e-3 }, extra));
    const big = r.peaks.filter(p => p.share > 0.05);
    console.log(`  DRT ${method}: ${Date.now() - t0} ms, misfit ${(100 * r.err).toFixed(3)} %, area ${r.area.toFixed(3)}, peaks ` +
                big.map(p => `R=${p.R.toFixed(1)} tau=${p.tau.toExponential(2)}`).join('; '));
    ok(big.length === 3, method + ': three peaks');
    if (big.length === 3) big.forEach((p, k) => { close(p.R, expect[k].R, 0.15, method + ' peak R' + k); close(p.tau, expect[k].tau, 0.25, method + ' peak tau' + k); });
    ok(r.err < 0.02, method + ': DRT reproduces Z within 2 %');
  }
  // lambda search on noisy data: the cross-validation minimum is inside the range
  const rnd = lcg(3), zn = { name: 'noisy', f, zr: Float64Array.from(z.re), zi: Float64Array.from(z.im), mask: new Uint8Array(81) };
  for (let k = 0; k < 81; k++) { const m = Math.hypot(zn.zr[k], zn.zi[k]); zn.zr[k] += 0.01 * m * (2 * rnd() - 1); zn.zi[k] += 0.01 * m * (2 * rnd() - 1); }
  const vals = Y.drt.scanValues('tikhonov', 31), sc = Y.drt.scanner(zn, { method: 'tikhonov', source: 'both' }, vals);
  const t1 = Date.now();
  for (let k = 0; k < sc.total; k++) sc.step(k);
  const bi = Y.drt.bestIndex(sc.result, 'tikhonov'), atBest = Y.drt.compute(zn, { method: 'tikhonov', source: 'both', lambda: vals[bi] });
  const pk = atBest.peaks.filter(p => p.share > 0.05);
  console.log(`  lambda search: ${Date.now() - t1} ms, suggested lambda ${vals[bi].toExponential(2)}, peaks ` + pk.map(p => p.R.toFixed(0)).join(', '));
  ok(bi > 0 && bi < vals.length - 1, 'suggested lambda inside the scanned range');
  ok(pk.length === 3 && pk.every((p, k) => Math.abs(p.R / expect[k].R - 1) < 0.1), 'the suggested lambda resolves the three RC of noisy data');
  const gv = Y.drt.scanValues('gold', 13), gs = Y.drt.scanner(zn, { method: 'gold', source: 'both' }, gv);
  for (let k = 0; k < gs.total; k++) gs.step(k);                 // each step continues the iterations of the one before
  ok(Y.drt.bestIndex(gs.result, 'gold') >= 0 && gs.result.cv.every(v => v === v), 'Gold iteration scan');

  // ---------- Z-HIT on a smooth spectrum and on noisy data
  const zd = sim('R(RQ)(RQ)', [50, 1.2e4, 2e-10, 0.93, 4e4, 6e-7, 0.82], Y.dataops.logspace(1e6, 1e-2, 81));
  const zh = Y.drt.zhit({ name: 'r', f: Y.dataops.logspace(1e6, 1e-2, 81), zr: zd.re, zi: zd.im, mask: new Uint8Array(81) });
  console.log(`  Z-HIT: rms ${(100 * zh.rms).toFixed(3)} %, max ${(100 * zh.max).toFixed(2)} % at ${zh.fmax.toPrecision(3)} Hz`);
  ok(zh.rms < 0.005 && zh.max < 0.05, 'Z-HIT reproduces |Z| of a valid spectrum');
  const noisy2 = { name: 'n', f: Y.dataops.logspace(1e6, 1e-2, 81), zr: Float64Array.from(zd.re), zi: Float64Array.from(zd.im), mask: new Uint8Array(81) };
  Y.dataops.addNoise(noisy2, 1, 'z', lcg(9));
  const zhn = Y.drt.zhit(noisy2);
  console.log(`  Z-HIT with 1 % noise: rms ${(100 * zhn.rms).toFixed(2)} %`);
  ok(zhn.rms < 0.02, 'Z-HIT of valid data with 1 % noise stays at the noise level');
  const bad = { name: 'drift', f: Y.dataops.logspace(1e6, 1e-2, 81), zr: Float64Array.from(zd.re), zi: Float64Array.from(zd.im), mask: new Uint8Array(81) };
  for (let k = 60; k < 81; k++) { bad.zr[k] *= 1.1; bad.zi[k] *= 1.1; }               // |Z| changes, phase does not
  ok(Y.drt.zhit(bad).max > 0.03, 'Z-HIT flags a drift of |Z| that the phase does not follow');
  // a gap in the frequencies (points deleted): Z-HIT reports it, the DRT keeps a regular tau grid
  const gapped = { name: 'g', f: Y.dataops.logspace(1e6, 1e-2, 81), zr: Float64Array.from(zd.re), zi: Float64Array.from(zd.im), mask: new Uint8Array(81) };
  Y.dataops.removePoints(gapped, Uint8Array.from({ length: 81 }, (_, k) => k >= 40 && k < 60 ? 1 : 0));
  const zg = Y.drt.zhit(gapped);
  ok(zg.gap && zg.gap.decades > 2, 'Z-HIT reports a gap in the frequencies (' + (zg.gap ? zg.gap.decades.toFixed(1) + ' decades' : 'none') + ')');
  ok(zg.ranges === 2 && zg.rms < 0.01, 'Z-HIT checks each side of the gap on its own (' + (100 * zg.rms).toFixed(2) + ' % rms)');
  const dg = Y.drt.compute(gapped, { method: 'tikhonov', source: 'both', lambda: 1e-3 });
  ok(dg.tau.length === 81 && Math.abs(Math.log(dg.tau[1] / dg.tau[0]) - Math.log(dg.tau[50] / dg.tau[49])) < 1e-9 && dg.f.length === 61, 'DRT across a gap: regular tau grid, 61 data points');
  // masked points are used by Z-HIT and the DRT (masks apply to fits only): no gap
  const masked = { name: 'm', f: Y.dataops.logspace(1e6, 1e-2, 81), zr: zd.re, zi: zd.im, mask: new Uint8Array(81) };
  for (let k = 40; k < 60; k++) masked.mask[k] = 1;
  const zm = Y.drt.zhit(masked);
  ok(!zm.gap && zm.ranges === 1 && zm.checked === 81 && Y.drt.compute(masked, { method: 'tikhonov', source: 'both', lambda: 1e-3 }).f.length === 81, 'Z-HIT and DRT use masked points');
};
