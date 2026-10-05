/* Regression tests for the edge-case round: R∞ of the DRT fitted with the distribution, unwrapped phase in Z-HIT,
 * UTF-16 text files, the Log saved with a project, incremental restore points (Z-HIT in slices and worker failures
 * are checked by browser_test.py); called from run_core_tests.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function (Y, ok, close) {
  const sim = (cdc, p, f) => Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), f, Float64Array.from(p));
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- DRT: R∞ fitted with g, Rpol = area of g
  {
    const f = Y.dataops.logspace(1e6, 1e-2, 71), z = sim('R(RQ)(RQ)', [50, 1.2e4, 2e-10, 0.93, 4e4, 6e-7, 0.82], f);
    const d = { f, zr: Float64Array.from(z.re), zi: Float64Array.from(z.im), mask: new Uint8Array(71) };
    Y.dataops.addNoise(d, 1, 'z', rnd);             // demo spectrum: the high-frequency arc is not complete at 1 MHz
    for (const [m, o] of [['tikhonov', { lambda: 0.1 }], ['fisk', { lambda: 0.1 }], ['gold', { iterations: 3000 }]]) {
      const r = Y.drt.compute(d, Object.assign({ method: m, source: 'both' }, o));
      ok(r.rinf < 300 && Math.abs(r.rpol / 52000 - 1) < 0.02 && r.area === 1,
         m + ': R∞ ' + r.rinf.toFixed(0) + ' Ω (true 50, Zr at 1 MHz 705), Rpol ' + r.rpol.toFixed(0) + ' Ω (true 52 000)');
    }
    const t = Y.drt.compute(d, { method: 'tikhonov', source: 'both', lambda: 0.1 }), big = t.peaks.filter(p => p.share > 0.05);
    ok(big.length === 2 && Math.abs(big[0].R / 12000 - 1) < 0.05 && Math.abs(big[1].R / 40000 - 1) < 0.05,
       'the two arcs: ' + big.map(p => p.R.toFixed(0)).join(', ') + ' Ω (true 12 000, 40 000)');
    const im = Y.drt.compute(d, { method: 'tikhonov', source: 'im', lambda: 0.1 });
    ok(im.rinf > -500 && im.rinf < 500 && Math.abs(im.rpol / 52000 - 1) < 0.02, 'Zi alone: R∞ from what remains of Zr (' + im.rinf.toFixed(0) + ' Ω)');
    const fc = Y.dataops.logspace(1e7, 1e-3, 81), zc = sim('R(RC)(RC)', [50, 100, 1e-8, 200, 1e-3], fc);
    const c = Y.drt.compute({ f: fc, zr: zc.re, zi: zc.im, mask: new Uint8Array(81) }, { method: 'tikhonov', source: 'both', lambda: 1e-3 });
    close(c.rinf, 50, 0.02, 'complete arcs: fitted R∞');
    close(c.rpol, 300, 0.01, 'complete arcs: Rpol');
    const vals = Y.drt.scanValues('tikhonov', 13), sc = Y.drt.scanner(d, { method: 'tikhonov', source: 'both' }, vals);
    for (let k = 0; k < sc.total; k++) sc.step(k);
    ok(sc.result.err.every(v => v > 0 && v < 1) && sc.result.cv.every(v => v > 0 && v < 1), 'λ search: misfit and cross-validation finite');
  }

  // ---------- Z-HIT: the phase is unwrapped
  {
    const u = Array.from(Y.drt.unwrap(Float64Array.from([3.0, 3.1, -3.1, -3.0])));
    ok(Math.abs(u[2] - (2 * Math.PI - 3.1)) < 1e-12 && Math.abs(u[3] - (2 * Math.PI - 3.0)) < 1e-12, 'unwrap: a jump across ±π is removed');
    const plain = Float64Array.from([-0.1, -0.5, -1.2, -1.5, -0.4]), copy = Float64Array.from(plain);
    ok(Y.drt.unwrap(plain).every((v, k) => v === copy[k]), 'unwrap: a phase without jumps is left exactly as it is');
    const n = 121, f = Y.dataops.logspace(1e-4, 1e2, n), zr = new Float64Array(n), zi = new Float64Array(n);
    for (let k = 0; k < n; k++) {               // 1/(1 + jω)³: minimum phase, the phase goes from 0 to −270°
      const w = 2 * Math.PI * f[k], m = Math.pow(1 + w * w, -1.5), ph = -3 * Math.atan(w);
      zr[k] = m * Math.cos(ph); zi[k] = m * Math.sin(ph);
    }
    const r = Y.drt.zhit({ name: 'third order', f, zr, zi, mask: new Uint8Array(n) });
    ok(r.rms < 0.005 && r.max < 0.01, 'Z-HIT across a phase of −180°: rms ' + (100 * r.rms).toFixed(2) + ' % (195 % without unwrapping)');
  }

  // ---------- text files in UTF-16 (Excel or Notepad "Unicode text") and UTF-8
  {
    const text = "Freq\tZ'\tZ''\r\n1000\t10,5\t-5,2\r\n100\t12,1\t-6,3\r\n10\t15,7\t-4,1\r\n";
    const le = Buffer.from(text, 'utf16le'), be = Buffer.from(le).swap16();
    const variants = { 'UTF-16 LE with BOM': Buffer.concat([Buffer.from([0xff, 0xfe]), le]), 'UTF-16 BE with BOM': Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
      'UTF-16 LE without BOM': le, 'UTF-16 BE without BOM': be, 'UTF-8 with BOM': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), 'UTF-8': Buffer.from(text) };
    Object.keys(variants).forEach(k => ok(Y.readers.decode(new Uint8Array(variants[k])) === text, k + ' decoded'));
    const accents = 'f (Hz)\t|Z| (Ω)\tθ (°) µ\r\n';
    ok(Y.readers.decode(new Uint8Array(Buffer.from(accents))) === accents, 'UTF-8 with Ω, θ, °, µ kept as UTF-8');
  }

  // ---------- the Log saved with a project
  {
    const S = Y.state.S, log = [{ t: '2026-10-04T19:02:04.000Z', kind: 'ok', msg: 'Fitted 3 of 3 datasets' }, { t: '2026-10-04T19:03:00.000Z', kind: 'cmd', msg: '› fit' }];
    const doc = JSON.parse(Y.writers.projectJSON(S, log));
    ok(Array.isArray(doc.log) && doc.log.length === 2 && doc.log[0].msg === 'Fitted 3 of 3 datasets', 'Save project writes the Log');
    ok(Array.isArray(JSON.parse(Y.writers.projectJSON(S)).log), 'a project without a Log gets an empty one');
    const odd = [log[0], { t: 'not a date', kind: 'ok', msg: 'x' }, { t: log[0].t, kind: 'weird', msg: 'kind replaced' }, { t: log[0].t, kind: 'ok', msg: 7 }, null,
                 { t: log[0].t, kind: 'warn', msg: 'y'.repeat(3000) }];
    const pj = Y.state.prepareProject(Object.assign(JSON.parse(Y.writers.projectJSON(S)), { log: odd }));
    ok(pj.log.length === 3 && pj.log[1].kind === 'info' && pj.log[2].msg.length === 2000, 'opening: unreadable Log lines left out, the others checked');
    ok(Y.state.prepareProject(Object.assign(JSON.parse(Y.writers.projectJSON(S)), { log: 'x' })).log.length === 0, 'a Log that is not a list is ignored');
  }

  // ---------- incremental restore points: data that did not change are shared, and kept intact
  {
    const S = Y.state.S, hadDoc = !!globalThis.document, uiWas = Y.ui;
    if (!hadDoc) globalThis.document = { getElementById: () => null, querySelector: () => null };
    if (!Y.history) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'history.js'), 'utf8'), { filename: 'js/history.js' });
    Y.ui = { toast: () => {}, log: () => {} };
    const H = Y.history, saved = { datasets: S.datasets, sel: S.sel }, n = 100000, f = Y.dataops.logspace(1e6, 1e-2, n);
    try {
      S.datasets = [0, 1, 2].map(i => Y.state.makeDataset({ name: 'big' + i, f, zr: new Float64Array(n).fill(10 + i), zi: new Float64Array(n).fill(-5) }));
      S.sel = new Set();
      const MB = 1048576, b0 = H.bytes();
      H.take('first'); const b1 = H.bytes();
      for (let k = 0; k < 20; k++) { S.datasets[0].p.R1 = k; H.take('parameter ' + k); }
      const b2 = H.bytes();
      ok(b1 - b0 > 6 * MB && b2 - b1 < 0.1 * MB, '20 parameter changes: ' + ((b2 - b1) / 1024).toFixed(0) + ' kB more, data kept once (' + ((b1 - b0) / MB).toFixed(1) + ' MB)');
      const d = S.datasets[1];
      d.zr[5] = 999; H.take('noise'); const b3 = H.bytes();
      ok(Math.abs((b3 - b2) - 8 * n) < 0.05 * MB, 'a change in place of Zr: only that array copied again');
      d.zr[6] = 777;                                // changed after the restore point was taken
      H.undo();
      ok(S.datasets[1].zr[5] === 999 && S.datasets[1].zr[6] === 11, 'undo brings back the recorded data, not a later change in place');
      H.undo();
      ok(S.datasets[1].zr[5] === 11 && Math.abs(H.bytes() - b2) < 10240, 'undo again: the original data, and the copy of the changed array is freed');
      const old = H._testLimit(1 * MB), c0 = H.count(), id = H.take('too large');
      H._testLimit(old);
      ok(id === null && H.count() === c0, 'a restore point larger than the memory limit is not kept');
    } finally {
      S.datasets = saved.datasets; S.sel = saved.sel; Y.ui = uiWas;
      if (!hadDoc) delete globalThis.document;
    }
  }
};
