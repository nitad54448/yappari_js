/* Regression tests for the review fixes (LM damping, project loading, missing fields, normalization of
 * remembered values, space-separated export, fit metadata, null statistics); called from run_core_tests.js */
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

  // ---------- 8. NaN statistics survive a project round trip as NaN
  {
    reset('R');
    const ds = S.datasets[0];
    ds.stats = { chi2w: 1, chi2red: NaN, r2: NaN, n: 3, se: {}, bound: {}, msg: 'converged: x', ok: true, method: 'TRDL', weight: 'mod' };
    Y.state.loadProject(JSON.parse(Y.writers.projectJSON(S)));
    const st = S.datasets[0].stats;
    ok(Number.isNaN(st.r2) && Number.isNaN(st.chi2red) && st.chi2w === 1, 'null statistics restored as NaN');
  }
};
