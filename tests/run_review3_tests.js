/* Regression tests for the third review: lower limit 0 of 'log' parameters, global fit with parameters on their
 * limits, size of the DRT τ grid, typographic minus signs and |Z|-phase columns in headings, a warning for
 * headings read by position, one restore point for a burst of wheel steps, range checks of settings (files, the
 * browser, setSetting) and of stored limits (Stop of running fits is checked by browser_test.py); called from
 * run_core_tests.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function (Y, ok, close) {
  const sim = (cdc, p, f) => Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), f, Float64Array.from(p));
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- 1. a lower limit of 0 keeps the ln p scaling; negative limits fit the parameter linearly, scaled
  {
    const f = Y.dataops.logspace(1e6, 1e-1, 61), z = sim('R(RC)', [50, 1e4, 1e-9], f);
    const job = (method, lo) => ({ id: 1, cdc: 'R1(R2C1)', f, zr: z.re, zi: z.im, p: Float64Array.from([30, 3e3, 3e-9]),
      fit: Uint8Array.from([1, 1, 1]), lo: Float64Array.from(lo), hi: Float64Array.from([1e10, 1e10, 1e3]), method, weight: 'mod', maxIter: 2500, tol: 1e-12 });
    for (const m of ['TRDL', 'LMB', 'NM']) for (const lo of [[0, 0, 0], [-100, -1e3, -1e-6]]) {
      const r = Y.fit.run(job(m, lo));
      ok(r.ok && /^converged/.test(r.msg), m + ', limits ' + lo + ': converged');
      [50, 1e4, 1e-9].forEach((v, j) => close(r.p[j], v, 1e-6, m + ', limits ' + lo + ', parameter ' + j));
    }
    const d = { f, zr: Float64Array.from(z.re), zi: Float64Array.from(z.im) };
    Y.dataops.addNoise(d, 1, 'z', rnd);
    const noisy = lo => Y.fit.run(Object.assign(job('TRDL', lo), { zr: d.zr, zi: d.zi }));
    const a = noisy([1e-3, 1e-3, 1e-16]), b = noisy([-100, -1e3, -1e-6]);
    [0, 1, 2].forEach(j => close(b.se[j], a.se[j], 1e-3, 'SE of a linearly fitted parameter = SE with ln p, parameter ' + j));
  }

  // ---------- 2. global fit: parameters that end on a limit are held (active set), the fit converges
  {
    const f = Y.dataops.logspace(1e6, 1e-2, 71), sets = [];
    for (let i = 0; i < 6; i++) {
      const z = sim('R(RQ)(RQ)', [50 * (1 + 0.01 * i), 1.2e4 * Math.exp(-0.07 * i), 2e-10, 0.93, 4e4 * Math.exp(-0.05 * i), 6e-7, 0.82], f);
      const d = { f, zr: z.re, zi: z.im };
      Y.dataops.addNoise(d, 1, 'z', rnd);
      sets.push({ id: i + 1, f, zr: d.zr, zi: d.zi, p: Float64Array.from([45, 1e4, 3e-10, 0.9, 3e4, 5e-7, 0.8]) });
    }
    const lo = Float64Array.from([1e-3, 1e-3, 1e-16, 0, 1e-3, 1e-16, 0]), hi = Float64Array.from([1e10, 1e10, 1e3, 0.9, 1e10, 1e3, 0.8]);
    const fit = Uint8Array.from([1, 1, 1, 1, 1, 1, 1]), cdc = 'R1(R2Q1)(R3Q2)';
    const g = Y.globalFit.run({ cdc, sets, fit, shared: new Uint8Array(7), lo, hi, weight: 'mod', method: 'LMB', maxIter: 2500, tol: 1e-12 });
    const single = sets.reduce((s, st) => s + Y.fit.run({ id: st.id, cdc, f, zr: st.zr, zi: st.zi, p: st.p, fit, lo, hi,
      method: 'TRDL', weight: 'mod', maxIter: 2500, tol: 1e-12 }).chi2w, 0);
    ok(g.ok && /^converged/.test(g.msg) && g.iter < 200, 'global fit with n on its limits converges (' + g.iter + ' iterations, ' + g.msg + ')');
    close(g.chi2w, single, 1e-6, 'all-local global fit on limits = sum of single fits');
    ok(g.sets.every(s => s.atBound[3] && s.atBound[6]), 'the n on their limits are reported at the limit');
    const gs = Y.globalFit.run({ cdc, sets, fit, shared: Uint8Array.from([1, 0, 1, 1, 0, 1, 1]), lo, hi, weight: 'mod', method: 'LMB', maxIter: 2500, tol: 1e-12 });
    ok(gs.ok && /^converged/.test(gs.msg) && gs.iter < 200, 'shared parameters on their limits: converges (' + gs.iter + ' iterations)');
  }

  // ---------- 3. DRT: at most 20 τ per decade, so dense spectra stay fast; sparse ones keep their grid
  {
    const dens = n => { const f = Y.dataops.logspace(1e6, 1e-2, n), z = sim('R(RQ)(RQ)', [50, 1.2e4, 2e-10, 0.93, 4e4, 6e-7, 0.82], f); return { f, zr: z.re, zi: z.im, mask: new Uint8Array(n) }; };
    const t0 = Date.now(), r = Y.drt.compute(dens(1000), { method: 'tikhonov', source: 'both', lambda: 1e-3 }), ms = Date.now() - t0;
    ok(r.tau.length === 161 && ms < 3000, 'DRT of 1000 points over 8 decades: ' + r.tau.length + ' τ values, ' + ms + ' ms');
    ok(Y.drt.compute(dens(71), { method: 'tikhonov', source: 'both', lambda: 1e-3 }).tau.length === 81, 'sparse data: 10 τ per decade as before');
    ok(Y.drt.compute(dens(130), { method: 'tikhonov', source: 'both', lambda: 1e-3 }).tau.length === 130, 'between 10 and 20 per decade: the density of the data');
  }

  // ---------- 4, 5. headings: typographic minus and primes; |Z| and phase columns; headings read by position are reported
  {
    const R = Y.readers, rows = '1000\t10\t5\n100\t12\t6\n10\t15\t4\n';
    ['freq/Hz\tRe(Z)/Ohm\t\u2212Im(Z)/Ohm', "Freq\tZ\u2032\t\u2212Z\u2033", 'Freq\tZ\u2019\t\u2013Z\u2019\u2019'].forEach(h => {
      const d = R.auto(h + '\n' + rows, 'u.txt', 'auto')[0];
      ok(d.zr[0] === 10 && d.zi[0] === -5 && d.zi[2] === -4, 'heading "' + h.replace(/\t/g, ' | ') + '": Zi negated');
    });
    const pol = (h, body) => R.headerTable(h + '\n' + body, 'p.txt')[0];
    const deg = pol('Freq\t|Z|\tPhase', '1000\t2\t-30\n100\t4\t-60\n');
    ok(Math.abs(deg.zr[0] - Math.sqrt(3)) < 1e-12 && Math.abs(deg.zi[0] + 1) < 1e-12 && Math.abs(deg.zi[1] + 2 * Math.sqrt(3)) < 1e-12, '|Z| and phase in degrees');
    const rad = pol('frequency;Zmod (ohm);Zphz / rad', '1000;2;' + (-Math.PI / 6) + '\n');
    ok(Math.abs(rad.zr[0] - Math.sqrt(3)) < 1e-12 && Math.abs(rad.zi[0] + 1) < 1e-12, '|Z| and phase in radians (heading says rad)');
    const ng = pol('f\t|Z| /Ohm\t-Phase /deg', '1000\t2\t30\n');
    ok(Math.abs(ng.zi[0] + 1) < 1e-12, '"-Phase" column negated');
    const both = R.headerTable('freq/Hz\tRe(Z)/Ohm\t-Im(Z)/Ohm\t|Z|/Ohm\tPhase(Z)/deg\n1000\t10\t5\t11.18\t-26.6\n', 'b.txt')[0];
    ok(both.zr[0] === 10 && both.zi[0] === -5, 'Zr and Zi columns take precedence over |Z| and phase');
    const adm = R.auto("Freq\tY'\tY''\n1000\t0.1\t0.05\n100\t0.08\t0.02\n10\t0.07\t0.01\n", 'adm.txt', 'auto');
    ok(adm.length === 1 && /not recognised/.test(adm.warning || ''), 'headings that name no Z columns: read by position with a warning');
    ok(!R.auto('Sample A\n' + rows, 't.txt', 'auto').warning, 'a title line above f, Zr, Zi: no warning');
    const dir = path.join(__dirname, '..', 'files');
    if (fs.existsSync(dir)) {
      const warned = fs.readdirSync(dir).filter(fn => !/\.xml$/.test(fn)).filter(fn => {
        try { return !!R.auto(fs.readFileSync(path.join(dir, fn), 'utf8'), fn, 'auto').warning; } catch (e) { return false; }
      });
      ok(!warned.length, 'no warning for the example files' + (warned.length ? ': ' + warned.join(', ') : ''));
    }
  }

  // ---------- 6. one restore point for a burst of wheel or arrow steps on one parameter
  {
    const stub = !globalThis.document;
    if (stub) globalThis.document = { getElementById: () => null, querySelector: () => null };
    if (!Y.history) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'history.js'), 'utf8'), { filename: 'js/history.js' });
    const H = Y.history, now0 = Date.now, n0 = H.count();
    let t = now0();
    Date.now = () => t;
    try {
      const a = H.take('parameter R1', { merge: 'step R1 1' });
      t += 500; const b = H.take('parameter R1', { merge: 'step R1 1' });
      t += 1400; const c = H.take('parameter R1', { merge: 'step R1 1' });          // 1.4 s after the last step
      ok(a === b && b === c && H.count() === n0 + 1, 'wheel steps that follow each other: one restore point');
      t += 1600; const d = H.take('parameter R1', { merge: 'step R1 1' });          // 1.6 s pause: a new burst
      const e = H.take('parameter R2', { merge: 'step R2 1' }), g = H.take('mask');
      ok(d !== c && e !== d && g !== e && H.count() === n0 + 4, 'a pause, another parameter or another action: new restore points');
    } finally { Date.now = now0; if (stub) delete globalThis.document; }
  }

  // ---------- 8. version string
  ok(/^\d+\.\d+\.\d+ /.test(Y.version), 'version string ' + Y.version);

  // ---------- 10. settings from files and from the browser: values out of range are not used
  {
    const st = Y.state, d0 = st.defaults(), bad = { simStart: 0, simEnd: -5, simPoints: 1e9, drtIter: 9, drtLambda: -20, sep: 'pipe',
      theme: 'neon', method: 'toString', weight: 'constructor', drtMethod: 'x', drtSource: 'y', drtX: 'z', view3d: 'w', resid: 'r',
      phase: 'p', maxPlots: 0, legendMax: -1, tol: -1, maxIter: 1e6 };
    const c = st.cleanSettings(bad);
    ok(Object.keys(bad).every(k => c[k] === d0[k]), 'settings file: every value out of range falls back to the default');
    const good = { simStart: 0.1, simEnd: 1e5, simPoints: 500, drtIter: 3, drtLambda: -8, sep: 'semicolon', theme: 'dark', method: 'NM',
      weight: 'unit', drtMethod: 'fisk', drtSource: 'im', drtX: 'tau', view3d: 'zidiff', resid: 'rel', phase: 'rad', maxPlots: 5, legendMax: 0, tol: 1e-9, maxIter: 100 };
    const g = st.cleanSettings(good);
    ok(Object.keys(good).every(k => g[k] === good[k]), 'settings file: values in range are kept');
    const over = st.cleanSettings({ simPoints: 1e9, sep: 'tab', drtIter: 1.5 }, Object.assign({}, d0, { simPoints: 300 }));
    ok(over.simPoints === 300 && over.sep === 'tab' && over.drtIter === 1.5, 'settings file over the current settings: a bad value keeps the current one');
    const old = st.cleanSettings({}, Object.assign({}, d0, { simStart: -1, theme: 'neon', simPoints: 2.5 }));
    ok(old.simStart === d0.simStart && old.theme === d0.theme && old.simPoints === d0.simPoints, 'bad stored values fall back to the defaults');
    const odd = st.cleanSettings(JSON.parse('{"__proto__": {"polluted": 1}, "constructor": "x", "hasOwnProperty": 1}'));
    ok(odd.polluted === undefined && odd.constructor === Object && typeof odd.hasOwnProperty === 'function', 'keys of a file that are not settings are ignored');
    const keep = st.S.settings.simPoints;
    st.setSetting('simPoints', 1e9); const a1 = st.S.settings.simPoints;
    st.setSetting('drtIter', 9); const a2 = st.S.settings.drtIter;
    st.setSetting('simPoints', 777); const a3 = st.S.settings.simPoints;
    st.setSetting('simPoints', keep);
    ok(a1 === keep && a2 !== 9 && a3 === 777, 'setSetting ignores values out of range');
  }

  // ---------- 11. limits of the circuit: values that cannot be used fall back to those of the element
  {
    const st = Y.state, S = st.S, saved = { cdc: S.model.cdc, limits: JSON.parse(JSON.stringify(S.model.limits)), shared: Object.assign({}, S.model.shared) };
    const dR = Y.paramDefault('R', 0), dQn = Y.paramDefault('Q', 1);
    st.setModel(Y.circuit.parse('R(RQ)'), { limits: { R1: { min: 'a', max: 5 }, R2: { min: 5, max: 1 }, Q1: { min: 1e-12, max: 1e-6 }, Q1_n: null }, shared: 'x', quiet: true });
    let L = S.model.limits;
    ok(L.R1.min === dR.min && L.R1.max === dR.max && L.R2.min === dR.min && L.Q1.min === 1e-12 && L.Q1.max === 1e-6 && L.Q1_n.max === dQn.max,
       'setModel: bad limits replaced by the element defaults, good ones kept');
    ok(Object.keys(S.model.shared).every(k => S.model.shared[k] === true), 'setModel: shared flags that are not an object give the default');
    // the browser storage (localStorage) holding a circuit with bad limits and bad settings
    const store = { 'yappari.model': JSON.stringify({ cdc: 'R(RC)', limits: { R1: { min: null, max: 10 }, R2: { min: 1, max: 1e4 }, C1: 'x' }, shared: { R1: false } }),
                    'yappari.settings': JSON.stringify({ simStart: -1, simPoints: 64, theme: 'neon' }) };
    const hadLS = 'localStorage' in globalThis, oldLS = globalThis.localStorage, settings0 = S.settings;
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: () => {} };
    try {
      st.restore();
      L = S.model.limits;
      ok(S.model.cdc === 'R1(R2C1)' && L.R1.min === dR.min && L.R2.min === 1 && L.R2.max === 1e4 && L.C1.min === Y.paramDefault('C', 0).min && S.model.shared.R1 === false,
         'restore from the browser: bad limits fall back, good limits and shared flags kept');
      ok(S.settings.simStart === st.defaults().simStart && S.settings.simPoints === 64 && S.settings.theme === 'system', 'restore from the browser: bad settings fall back');
    } finally {
      if (hadLS) globalThis.localStorage = oldLS; else delete globalThis.localStorage;
      S.settings = settings0;
      st.setModel(saved.cdc ? Y.circuit.parse(saved.cdc) : null, { limits: saved.limits, shared: saved.shared, quiet: true });
    }
  }
};
