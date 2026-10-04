/* Regression tests for the review fixes (LM damping, project loading, missing fields, normalization of
 * remembered values, space-separated export, fit metadata, null statistics), and for the second review (MFLI csv
 * recursion, endless tick loops, global-fit standard errors, fit status, model-only export, masked points in
 * spline and smooth, DRT block in Save data, MFLI phase, element start values, Gold iterations);
 * called from run_core_tests.js */
'use strict';
module.exports = function (Y, ok, close) {
  const S = Y.state.S;
  const R1 = (lo, hi) => ({ lo: Float64Array.from([lo]), hi: Float64Array.from([hi]) });

  // ---------- 1. LM / LMB: damping no longer scales with the size of JᵀJ
  {
    const n = 20, f = Float64Array.from({ length: n }, (_, k) => 10 ** (k - 5));
    const zi = new Float64Array(n), s = new Float64Array(n).fill(1e-6);
    const base = { id: 1, cdc: 'R', f, zi, p: Float64Array.from([100]), fit: Uint8Array.from([1]), maxIter: 2500, tol: 1e-12 };
    for (const m of ['LM', 'LMB', 'TRDL']) {
      const r = Y.fit.run(Object.assign({}, base, R1(1e-3, 1e9), { zr: new Float64Array(n).fill(50), sr: s, si: s, method: m, weight: 'mod' }));
      close(r.p[0], 50, 1e-9, 'tiny sigma, ' + m + ' reaches 50 Ω');
      const u = Y.fit.run(Object.assign({}, base, R1(1e-3, 1e12), { zr: new Float64Array(n).fill(5e6), p: Float64Array.from([1e7]), method: m, weight: 'unit' }));
      close(u.p[0], 5e6, 1e-9, 'equal weights, 5 MΩ, ' + m);
    }
    for (const m of ['LM', 'LMB']) {
      const zr = new Float64Array(n).fill(50);
      const g = Y.globalFit.run(Object.assign({ cdc: 'R', fit: Uint8Array.from([1]), shared: Uint8Array.from([1]), weight: 'mod', method: m, maxIter: 2500, tol: 1e-12,
        sets: [{ id: 1, f, zr, zi, sr: s, si: s, p: Float64Array.from([100]) }, { id: 2, f, zr, zi, sr: s, si: s, p: Float64Array.from([100]) }] }, R1(1e-3, 1e9)));
      close(g.sets[0].p[0], 50, 1e-9, 'global fit, tiny sigma, ' + m);
    }
    // stagnation is not reported as convergence
    const P = new Y.fit.Problem(Object.assign({ f, zr: new Float64Array(n).fill(50), zi, sr: s, si: s, p: Float64Array.from([100]), fit: Uint8Array.from([1]), method: 'LMB', weight: 'mod' }, R1(1e-3, 1e9)), Y.fit.getProg('R'));
    ok(Y.fit.stalled(P, P.initialX(), 1e-12), 'a point away from the minimum is detected as stalled');
    const P2 = new Y.fit.Problem(Object.assign({ f, zr: new Float64Array(n).fill(50), zi, sr: s, si: s, p: Float64Array.from([50]), fit: Uint8Array.from([1]), method: 'LMB', weight: 'mod' }, R1(1e-3, 1e9)), Y.fit.getProg('R'));
    ok(!Y.fit.stalled(P2, P2.initialX(), 1e-12), 'the minimum is not reported as stalled');
    ok(Y.fit.status(Y.fit.STALL_MSG) === 'warn' && Y.fit.status('converged: x') === 'ok' && Y.fit.status('iteration limit reached') === 'warn', 'fit status from message');
  }

  // helpers for state tests
  const mk = name => ({ name, f: [1000, 100, 10], zr: [10, 20, 30], zi: [-1, -2, -3] });
  function reset(cdc) {
    S.datasets = []; S.sel.clear();
    Y.state.setModel(cdc ? Y.circuit.parse(cdc) : null, { quiet: true, limits: {}, shared: {} });
    Y.state.addDatasets([mk('a'), mk('b')]);
  }

  // ---------- 2. a malformed project leaves the current state untouched
  {
    reset('R(RC)');
    S.settings.method = 'LM';
    const good = JSON.parse(Y.writers.projectJSON(S));
    const cases = {
      'invalid circuit': Object.assign({}, good, { model: { cdc: 'R(R' } }),
      'short Zr': Object.assign({}, good, { datasets: [Object.assign({}, good.datasets[0], { zr: [1, 2] })] }),
      'non-numeric Zi': Object.assign({}, good, { datasets: [Object.assign({}, good.datasets[0], { zi: [1, 'x', 3] })] }),
      'negative frequency': Object.assign({}, good, { datasets: [Object.assign({}, good.datasets[0], { f: [1, -2, 3] })] }),
      'future version': Object.assign({}, good, { version: 99 }),
      'bad limits': Object.assign({}, good, { model: Object.assign({}, good.model, { limits: { R0: { min: 5, max: 1 } } }) })
    };
    Object.keys(cases).forEach(k => {
      const before = { n: S.datasets.length, cdc: S.model.cdc, method: S.settings.method, ids: S.datasets.map(d => d.id).join() };
      let threw = false;
      try { Y.state.loadProject(JSON.parse(JSON.stringify(Object.assign({}, cases[k], { settings: { method: 'NM' } })))); } catch (e) { threw = true; }
      ok(threw && S.datasets.length === before.n && S.model.cdc === before.cdc && S.settings.method === before.method &&
         S.datasets.map(d => d.id).join() === before.ids, 'bad project (' + k + ') is rejected and nothing changes');
    });
    const cdc0 = S.model.cdc;
    Y.state.loadProject(good);
    ok(S.datasets.length === 2 && S.model.cdc === cdc0 && S.settings.method === 'LM', 'a good project still loads');
    Y.state.loadProject(Object.assign({}, good, { settings: { method: 'nonsense', maxIter: 'x', tol: 1e-6 } }));
    ok(S.settings.method === 'TRDL' && S.settings.maxIter === 2500 && S.settings.tol === 1e-6, 'unknown setting values fall back to the defaults');
  }

  // ---------- 3. missing fields do not shift columns
  {
    for (const [sep, ch] of [['comma', ','], ['semicolon', ';'], ['tab', '\t']]) {
      const txt = ['1', '10', '-1', '7'].join(ch) + '\n' + ['2', '', '-3', '88'].join(ch) + '\n' + ['3', '30', '-4', '9'].join(ch) + '\n';
      const d = Y.readers.threeColumns(txt, 'x.csv', sep);
      ok(d[0].f.length === 2 && d[0].f[1] === 3 && d[0].zr[1] === 30 && d.skipped === 1, 'missing Zr rejected, ' + sep);
      const a = Y.readers.threeColumns(txt, 'x.csv', 'auto');
      ok(a[0].f.join() === '1,3' && a.skipped === 1, 'missing Zr rejected, auto separator for ' + sep);
      const b = Y.readers.numericBlocks(txt, 'x.csv', sep);
      ok(b[0].f.join() === '1,3' && b.skipped === 1, 'numeric blocks: missing Zr rejected, ' + sep);
    }
    const t = Y.readers.threeColumns('1,10,-1,\n2,20,-2,\n', 'x.csv', 'comma');
    ok(t[0].f.length === 2 && !t.skipped, 'trailing separators are fine');
  }

  // ---------- 4. normalization keeps remembered parameter values
  {
    reset('R(RC)');
    const ds = S.datasets[0];
    const C = Y.state.names().filter(n => /^C/.test(n))[0];
    ds.p[C] = 2e-6; ds.fit[C] = false;
    Y.state.setModel(Y.circuit.parse('R(RR)'), { quiet: true });
    const memBefore = ds.mem[C];
    Y.state.normalize(ds, { type: 'factor', k: 2 });
    ok(memBefore[0] === 2e-6, 'the old remembered pair (shared with undo records) is not modified');
    Y.state.setModel(Y.circuit.parse('R(RC)'), { quiet: true });
    close(ds.p[C], 1e-6, 1e-12, 'remembered capacitance scaled by 1/k');
    ok(ds.fit[C] === false, 'remembered fit flag kept');
  }

  // ---------- 6. every export separator reads back with its standard deviations
  {
    const ds = { name: 'sig', f: Float64Array.from([1000, 100, 10]), zr: Float64Array.from([10, 20, 30]), zi: Float64Array.from([-1, -2, -3]),
                 sr: Float64Array.from([0.1, 0.2, 0.3]), si: Float64Array.from([0.4, 0.5, 0.6]), mask: new Uint8Array(3), norm: null };
    const calc = () => ({ re: Float64Array.from([11, 21, 31]), im: Float64Array.from([-1, -2, -3]) });
    for (const sep of ['tab', 'comma', 'semicolon', 'space']) {
      const d = Y.readers.headerTable(Y.writers.dataText([ds], { sep, calc: true }, calc), 'x.txt');
      ok(d.length === 1 && d[0].zr[2] === 30 && d[0].sr && d[0].sr[1] === 0.2 && d[0].si[2] === 0.6, 'export and read back with sigma, ' + sep);
    }
  }

  // ---------- 7. results record the settings of the submitted job
  {
    reset('R');
    S.settings.method = 'TRDL'; S.settings.maxIter = 2500;
    const ds = S.datasets[0];
    Y.state.applyResult(ds, { p: Float64Array.from([5]), chi2w: 1, chi2red: 1, r2: 1, n: 3, iter: 4, msg: 'converged: x', ok: true },
      Object.assign(Y.state.jobMeta({ method: 'LMB', weight: 'unit', maxIter: 77, tol: 1e-5 }), { global: true }));
    ok(ds.stats.method === 'LMB' && ds.stats.weight === 'unit' && ds.stats.maxIter === 77 && ds.stats.tol === 1e-5, 'job settings stored with the result');
    const fs = Y.state.fitSummary([ds]);
    ok(/bounded/.test(fs.method) && /global/.test(fs.method) && /equal/.test(fs.weight) && fs.iter === '77, 0.00001', 'summary from stored settings, not current ones');
    ok(/method: Levenberg/.test(Y.writers.paramsText([ds], ['R0'], Object.assign({ cdc: 'R' }, fs))), 'parameter export heading uses the stored method');
  }

  // ---------- empty datasets (all points deleted) save and reopen
  {
    reset('R');
    Y.dataops.removePoints(S.datasets[0], Uint8Array.from([1, 1, 1]));
    ok(S.datasets[0].f.length === 0, 'all points of a dataset deleted');
    let err = null;
    try { Y.state.loadProject(JSON.parse(Y.writers.projectJSON(S))); } catch (e) { err = e.message; }
    ok(!err && S.datasets.length === 2 && S.datasets[0].f.length === 0 && S.datasets[1].f.length === 3, 'project with an empty dataset reopens' + (err ? ' (' + err + ')' : ''));
  }

  // ---------- rows missing their last required column are counted as skipped
  {
    for (const [sep, ch] of [['comma', ','], ['semicolon', ';'], ['tab', '\t']]) {
      const txt = ['1', '10', '-1'].join(ch) + '\n' + ['2', '20', ''].join(ch) + '\n' + ['3', '30', '-3'].join(ch) + '\n';
      const d = Y.readers.threeColumns(txt, 'x.csv', sep), b = Y.readers.numericBlocks(txt, 'x.csv', sep);
      ok(d[0].f.join() === '1,3' && d.skipped === 1 && b.skipped === 1, 'missing last column counted as skipped, ' + sep);
    }
  }

  // ---------- 8. NaN statistics survive a project round trip as NaN
  {
    reset('R');
    const ds = S.datasets[0];
    ds.stats = { chi2w: 1, chi2red: NaN, r2: NaN, n: 3, se: {}, bound: {}, msg: 'converged: x', ok: true, method: 'TRDL', weight: 'mod' };
    Y.state.loadProject(JSON.parse(Y.writers.projectJSON(S)));
    const st = S.datasets[0].stats;
    ok(Number.isNaN(st.r2) && Number.isNaN(st.chi2red) && st.chi2w === 1, 'null statistics restored as NaN');
  }

  // ---------- settings files: values of the wrong type are ignored, missing keys keep the current values
  {
    const d = Y.state.defaults();
    ok(d.nyqSquare === false, 'square Nyquist plot is off by default');
    const st = Y.state.cleanSettings({ maxIter: 'abc', nyqEqual: 'false', nyqSquare: true, tol: -1, method: 'XX', bogus: 1, simPoints: Infinity },
                                     Object.assign({}, d, { maxPlots: 7 }));
    ok(st.maxIter === d.maxIter && st.nyqEqual === d.nyqEqual && st.nyqSquare === true && st.tol === d.tol && st.method === d.method &&
       !('bogus' in st) && st.simPoints === d.simPoints && st.maxPlots === 7, 'settings file cleaned (wrong types ignored, other keys kept)');
    ok(Y.state.cleanSettings(null).method === d.method && Y.state.cleanSettings([1, 2]).maxIter === d.maxIter, 'no settings object: defaults');
  }

  // ======================================================================== second review
  const sim = (cdc, pv, f) => Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), f, Float64Array.from(pv));
  const lcg = s => () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
  const limits = pr => ({ lo: Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).min)), hi: Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).max)) });
  const noisy = (z, seed) => { const r = lcg(seed), zr = Float64Array.from(z.re), zi = Float64Array.from(z.im);
    for (let k = 0; k < zr.length; k++) { const m = Math.hypot(zr[k], zi[k]); zr[k] += 0.005 * m * (2 * r() - 1); zi[k] += 0.005 * m * (2 * r() - 1); } return { zr, zi }; };

  // ---------- 2. "fieldname" outside the chunk line: a one-column-per-field table, read without endless recursion
  {
    const t = '% LabOne, columns: chunk, timestamp, frequency, realz, imagz (no fieldname)\nchunk;timestamp;frequency;realz;imagz\n0;1;1000;10;-5\n0;2;100;20;-8\n';
    let d = null, err = '';
    try { d = Y.readers.auto(t, 'x.csv', 'auto'); } catch (e) { err = e.message; }
    ok(d && d.length === 1 && d[0].f.length === 2 && d[0].zi[1] === -8, 'one-column-per-field LabOne table with "fieldname" in a comment' + (err ? ' (' + err + ')' : ''));
    ok(Y.readers.mfliCsv(t, 'x.csv')[0].zr[0] === 10, 'MFLI csv menu on such a table reads it as a table');
  }

  // ---------- 3. tick loops end: a range below the floating-point resolution, a log axis zoomed far out
  {
    const vm = require('vm'), fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
    const ctx2d = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    const el = () => ({ getContext: () => ctx2d, style: {}, addEventListener() {}, appendChild() {}, toDataURL: () => '' });
    const T = { fontSize: 11, titleSize: 12, ms: 1, ls: 1, font: 'sans-serif', series: ['#00f'], parts: ['#f00'] };
    const sb = vm.createContext({ Y: { theme: { get: () => T } }, document: { createElement: el }, window: { addEventListener() {}, devicePixelRatio: 1 }, requestAnimationFrame: () => 0 });
    ['js/ui/plot2d.js', 'js/ui/plot3d.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f }));
    const run = code => { try { return vm.runInContext(code, sb, { timeout: 5000 }); } catch (e) { return 'error: ' + e.message; } };
    const flat = "[{ name: 'a', group: 1, x: [1, 2, 3], y: [100, 100.00000000000001, 100], mode: 'markers' }]";
    const span = run(`var p = new Y.Plot2D(null, { width: 400, height: 300 }); p.setSeries(${flat}); p.view.y1 - p.view.y0`);
    ok(Math.abs(span - 20) < 1e-9, 'values one ulp apart: plotted as one value, ±10 % (' + span + ')');
    ok(run(`var q = new Y.Plot2D(null, { width: 400, height: 300, ylog: true }); q.setSeries(${flat}); 'done'`) === 'done', 'same on a log axis');
    ok(run(`var z = new Y.Plot2D(null, { width: 400, height: 300, xlog: true }); z.setSeries([{ name: 'a', group: 1, x: [1, 10], y: [1, 2], mode: 'markers' }]);
            z.view = { x0: -1e12, x1: 1e12, y0: 0, y1: 3 }; z.draw(); 'done'`) === 'done', 'log axis zoomed out to 10^±1e12 draws at once');
    ok(run(`var d3 = new Y.Plot3D({ clientWidth: 600, clientHeight: 400, appendChild: function () {} });
            d3.setData({ x: [1, 2, 3], y: [0, 1, 2], z: [100, 100.00000000000001, 100], labels: { x: 'x', y: 'y', z: 'z' } }); 'done'`) === 'done', '3D plot of values one ulp apart');
  }

  // ---------- 5. global fit: standard errors with a singular local block, and with a parameter on its limit
  {
    const f = Y.dataops.logspace(1e5, 1e-1, 41), A = Y.circuit.compile(Y.circuit.parse('R(RC)(RL)')), B = Y.circuit.compile(Y.circuit.parse('R(RC)'));
    const setsA = [], setsB = [];
    for (let i = 0; i < 4; i++) {
      const z = noisy(sim('R(RC)', [20 + 10 * i, 1000, 1e-6], f), 10 + i);
      setsA.push({ id: i, f, zr: z.zr, zi: z.zi, p: Float64Array.from([25 + 5 * i, 800, 2e-6, 100, 1e-15]) });   // R3 ‖ 1 fH: no effect at all
      setsB.push({ id: i, f, zr: z.zr, zi: z.zi, p: Float64Array.from([25 + 5 * i, 800, 2e-6]) });
    }
    const ga = Y.globalFit.run(Object.assign({ cdc: A.cdc, sets: setsA, fit: Uint8Array.from([1, 1, 1, 1, 0]), shared: Uint8Array.from([0, 1, 1, 0, 1]), weight: 'mod', method: 'LMB', maxIter: 500, tol: 1e-12 }, limits(A)));
    const gb = Y.globalFit.run(Object.assign({ cdc: B.cdc, sets: setsB, fit: Uint8Array.from([1, 1, 1]), shared: Uint8Array.from([0, 1, 1]), weight: 'mod', method: 'LMB', maxIter: 500, tol: 1e-12 }, limits(B)));
    const ratio = j => (ga.sets[0].se[j] / Math.sqrt(ga.chi2red)) / (gb.sets[0].se[j] / Math.sqrt(gb.chi2red));
    ok(Math.abs(ratio(1) - 1) < 1e-3 && Math.abs(ratio(2) - 1) < 1e-3, 'parameter without effect in a local block: shared SE as without it (' + ratio(1).toFixed(4) + ', ' + ratio(2).toFixed(4) + ')');
    ok(ga.sets.every(s => isFinite(s.se[0]) && isNaN(s.se[3])), 'its own SE is missing, the other local SE of that dataset is kept');
    const pr = Y.circuit.compile(Y.circuit.parse('R(RQ)')), L = limits(pr), sets = [];
    L.hi[3] = 0.7;                                                          // n held against a limit below its true 0.88
    for (let i = 0; i < 4; i++) { const z = noisy(sim('R(RQ)', [20 + 5 * i, 1000 * (1 + i), 2e-6, 0.88], f), 30 + i); sets.push({ id: i, f, zr: z.zr, zi: z.zi, p: Float64Array.from([30, 1500, 3e-6, 0.7]) }); }
    const job = fit => Object.assign({ cdc: pr.cdc, sets, fit: Uint8Array.from(fit), shared: Uint8Array.from([0, 0, 1, 1]), weight: 'mod', method: 'LMB', maxIter: 2000, tol: 1e-12 }, L);
    const g1 = Y.globalFit.run(job([1, 1, 1, 1])), g2 = Y.globalFit.run(job([1, 1, 1, 0]));
    const rq = (g1.sets[1].se[2] / Math.sqrt(g1.chi2red)) / (g2.sets[1].se[2] / Math.sqrt(g2.chi2red));
    ok(g1.sets[0].atBound[3] === 1 && Math.abs(rq - 1) < 0.01, 'shared parameter on its limit is left out of the covariance, like a fixed one (Q1 SE ratio ' + rq.toFixed(4) + ')');
  }

  // ---------- 6. only convergence is green
  ok(Y.fit.status('singular system') === 'warn' && Y.fit.status('all fitted parameters are at their limits') === 'warn' &&
     Y.fit.status('no free parameters: statistics only') === 'ok', 'singular system and parameters at their limits are warnings');

  // ---------- 7. Save data with the model values only reads back
  {
    const ds = { name: 'm', f: Float64Array.from([1000, 100, 10]), zr: Float64Array.from([10, 20, 30]), zi: Float64Array.from([-1, -2, -3]), mask: new Uint8Array(3) };
    const calc = () => ({ re: Float64Array.from([11, 21, 31]), im: Float64Array.from([-4, -5, -6]) });
    for (const sep of ['tab', 'comma', 'semicolon', 'space']) {
      let d = null; try { d = Y.readers.headerTable(Y.writers.dataText([ds], { sep, exp: false, calc: true }, calc), 'model.txt'); } catch (e) { /* d stays null */ }
      ok(d && d[0].name === 'm' && d[0].zr[2] === 31 && d[0].zi[0] === -4, 'model-only export reads back, ' + sep);
    }
    const both = Y.readers.headerTable(Y.writers.dataText([ds], { sep: 'tab', calc: true }, calc), 'both.txt');
    ok(both[0].zr[0] === 10, 'with measured and model columns the measured ones are read');
  }

  // ---------- 8. spline and smooth use masked points (masks are for fits only); average already did
  {
    const n = 21, fq = Y.dataops.logspace(1e4, 1, n), ds = { name: 'x', f: fq, zr: Float64Array.from(fq, (v, k) => 100 + k), zi: Float64Array.from(fq, (v, k) => -k), mask: new Uint8Array(n) };
    ds.mask[0] = 1; ds.mask[10] = 1; ds.zr[10] = 500;
    const sp = Y.dataops.spline(ds, 30), sm = Y.dataops.smooth(ds, 2, 1), k10 = sm.f.findIndex(v => Math.abs(v / fq[10] - 1) < 1e-9);
    ok(Math.max(...sp.f) === 1e4 && sm.f.length === n && k10 >= 0 && sm.zr[k10] > 150, 'spline and smooth include masked points');
    ok(Y.dataops.average([ds, ds]).zr[10] === 500, 'average includes masked points');
    ok(Y.drt.compute(ds, { method: 'tikhonov', source: 'both', lambda: 1e-3 }).f.length === n && Y.drt.zhit(ds).f.length === n, 'the DRT and Z-HIT use masked points too');
    // Save data writes masked points with a "masked" column; reading it back restores the masks
    for (const sep of ['tab', 'comma', 'semicolon', 'space']) {
      const d = Y.readers.headerTable(Y.writers.dataText([ds], { sep, calc: true }, x => ({ re: x.zr, im: x.zi })), 'm.txt')[0];
      ok(d.f.length === n && d.mask && d.mask[0] === 1 && d.mask[10] === 1 && d.mask.reduce((a, m) => a + m, 0) === 2 && d.zr[10] === 500, 'masked points saved and read back as masked, ' + sep);
    }
    // in view: masking takes the unmasked points, deleting takes all of them
    const v = { x0: 0, x1: 1e9, y0: -1e9, y1: 1e9 };
    ok(Y.dataops.inView(ds, 'zr', v).count === n - 2 && Y.dataops.inView(ds, 'zr', v, true).count === n, 'points in view: unmasked ones to mask, all to delete');
  }

  // ---------- 9. Save data with the DRT of a dataset: the DRT tables are not read as more points
  {
    const ds = { name: 'd', f: Float64Array.from([1000, 100, 10]), zr: Float64Array.from([10, 20, 30]), zi: Float64Array.from([-1, -2, -3]), mask: new Uint8Array(3) };
    ds.drt = { method: 'tikhonov', lambda: 1e-3, source: 'both', rinf: 10, rpol: 20, tau: Float64Array.from([1e-4, 1e-3, 1e-2, 1e-1]), g: Float64Array.from([0.1, 0.5, 0.3, 0.1]), f: ds.f, zr: ds.zr, zi: ds.zi };
    const e = Object.assign({}, ds, { name: 'e' }), d = Y.readers.headerTable(Y.writers.dataText([ds, e], { sep: 'tab', drt: true }, () => null), 'drt.txt');
    ok(d.length === 2 && d.every(x => x.f.length === 3), 'data + DRT export reads back with 3 points per dataset (' + d.map(x => x.f.length).join(',') + ')');
  }

  // ---------- 10. MFLI phasez is in radians, also beyond ±2π
  {
    const fq = [1e4, 1e3, 1e2], Z = [[100, -10], [80, -60], [-30, -90]], ph = Z.map(z => Math.atan2(z[1], z[0]));
    ph[1] += 4 * Math.PI;
    const row = (name, v) => ['0', '1', '3', name].concat(v.map(String)).join(';');
    const m = Y.readers.mfliCsv(['chunk;timestamp;size;fieldname', row('frequency', fq), row('absz', Z.map(z => Math.hypot(z[0], z[1]))), row('phasez', ph)].join('\n'), 'p.csv')[0];
    ok(Z.every((z, k) => Math.abs(m.zr[k] - z[0]) < 1e-9 && Math.abs(m.zi[k] - z[1]) < 1e-9), 'absz and phasez (radians) give Zr and Zi');
  }

  // ---------- 11. start values of new elements: min < max and min <= start value <= max
  {
    const P = Y.state.elementDefaultProblem;
    ok(P('R', 0, { min: 10 }) === '' && P('R', 0, { min: 2e3, def: 1e4 }) === '' && P('R', 0, {}) === '', 'start values and limits that fit together are accepted');
    ok(P('R', 0, { min: 1e11 }) !== '' && P('R', 0, { def: 1e11 }) !== '' && P('Q', 1, { min: 0.8, max: 0.5 }) !== '', 'min >= max, or a start value outside the limits, refused');
    const c = Y.state.cleanElementOverrides({ R: [{ min: 1e11, fit: false }], Q: [{ def: 2e-9 }, { min: 0.5, max: 1 }], X: [{}] });
    ok(!('min' in c.R[0]) && c.R[0].fit === false && c.Q[0].def === 2e-9 && c.Q[1].max === 1 && !('X' in c), 'settings file: values that do not fit together are dropped, the others kept');
  }

  // ---------- 13. Gold: 50 000 iterations by default and at the top of the search, which runs step by step
  {
    const gv = Y.drt.scanValues('gold', 25);
    ok(gv[0] === 100 && gv[gv.length - 1] === 50000 && Math.round(10 ** Y.state.defaults().drtIter) === 50000, 'Gold iterations: search 100 to 50 000, default 50 000');
    const f = Y.dataops.logspace(1e-1, 1e7, 61), z = sim('(RC)(RC)', [200, 48e-9, 100, 1e-6], f), ds = { name: 'g', f, zr: z.re, zi: z.im, mask: new Uint8Array(61) };
    const vals = [300, 2000, 9000], sc = Y.drt.scanner(ds, { method: 'gold', source: 'both' }, vals);
    for (let k = 0; k < sc.total; k++) sc.step(k);
    ok(sc.total === 3 && vals.every((v, k) => Math.abs(sc.result.err[k] - Y.drt.compute(ds, { method: 'gold', source: 'both', iterations: v }).err) < 1e-12),
       'stepwise Gold scan gives the misfit of a DRT with that many iterations');
  }
};
