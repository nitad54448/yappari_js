/* Regression tests for the fifth review: fit statistics and dataset names read from a project, the step cap of the
 * global fit, the range of the DRT slider, 9 significant digits in text files, the iterations of Nelder-Mead, and the
 * trust-region dogleg (TRDL) with a parameter held on a limit; called from run_core_tests.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function (Y, ok, close) {
  const sim = (cdc, p, f) => Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), f, Float64Array.from(p));

  // ---------- 1. a project cannot put HTML into the page through its fit statistics; dataset names are one line
  {
    const evil = '<img src=x onerror=alert(1)>';
    const doc = { format: 'yappari-js-project', version: 1, model: { cdc: 'R' },
      datasets: [{ name: 'a\r\nb\tc', f: [1, 2, 3], zr: [1, 1, 1], zi: [0, 0, 0], p: { R1: 1 }, fit: { R1: true },
        stats: { chi2w: 1, chi2red: null, r2: 'x', iter: evil, tol: evil, maxIter: 7, n: '<b>3</b>', msg: 'converged: ' + evil,
                 ok: 'yes', global: true, se: { R1: 2.5, R2: evil }, bound: { R1: true, R2: 'true' }, extra: evil, weight: 'mod' } }] };
    const raw = Y.state.prepareProject(JSON.parse(JSON.stringify(doc))).raws[0], st = raw.stats;
    ok(!('iter' in st) && !('tol' in st) && !('n' in st) && !('extra' in st) && !('ok' in st) && st.maxIter === 7 && st.global === true,
       'project statistics: numbers that are not numbers, unknown fields and flags that are not true or false are dropped');
    ok(st.chi2w === 1 && Number.isNaN(st.chi2red) && Number.isNaN(st.r2), 'project statistics: χ² kept, null and text become NaN');
    ok(st.se.R1 === 2.5 && !('R2' in st.se) && st.bound.R1 === true && !('R2' in st.bound), 'project statistics: standard errors and limit marks keep their types');
    ok(st.msg === 'converged: ' + evil && st.weight === 'mod', 'project statistics: texts stay texts (escaped where they are shown)');
    ok(Y.state.makeDataset(raw).name === 'a b c' && Y.state.makeDataset({ name: '\t\n', f: [1], zr: [1], zi: [0] }).name === 'data',
       'dataset names: line breaks and tabs become spaces, an empty name becomes "data"');
    const d = Y.state.addDatasets([{ name: 'r', f: [1, 2, 3], zr: [1, 1, 1], zi: [0, 0, 0] }], { select: false })[0];
    Y.state.rename(d.id, 'x\ty');
    const tabbed = d.name;
    Y.state.rename(d.id, ' \n ');
    ok(tabbed === 'x y' && d.name === 'x y', 'rename: a tab becomes a space, a name of only line breaks is refused');
    Y.state.removeDatasets([d.id]);
  }

  // ---------- 2. global fit: the step, projected into the limits, is capped as in a single fit (a factor e³)
  {
    const f = Y.dataops.logspace(1e6, 1e-1, 41), sets = [];
    for (let i = 0; i < 3; i++) {
      const z = sim('R(RC)', [50, 1e4 * (1 + 0.1 * i), 1e-9], f);
      sets.push({ id: i + 1, f, zr: z.re, zi: z.im, p: Float64Array.from([50, 30, 1e-9]) });
    }
    const job = { cdc: 'R1(R2C1)', sets, fit: Uint8Array.from([1, 1, 1]), shared: Uint8Array.from([0, 0, 1]), lo: Float64Array.from([1e-3, 1e-3, 1e-16]),
                  hi: Float64Array.from([1e10, 1e10, 1e3]), weight: 'mod', method: 'LMB', maxIter: 1, tol: 1e-12 };
    const g1 = Y.globalFit.run(job), moves = [];
    g1.sets.forEach(s => [50, 30, 1e-9].forEach((v, j) => moves.push(Math.abs(Math.log(s.p[j] / v)))));
    ok(g1.ok && moves.every(v => v <= 3 + 1e-9) && moves.some(v => v > 0.5),
       'one step of a global fit from a poor start: taken, and no parameter changes by more than a factor e³ (largest ' + Math.max.apply(null, moves).toFixed(2) + ')');
    const g = Y.globalFit.run(Object.assign({}, job, { maxIter: 2500 }));
    ok(g.ok && /^converged/.test(g.msg), 'the capped global fit converges (' + g.iter + ' iterations, ' + g.msg + ')');
    g.sets.forEach((s, i) => close(s.p[1], 1e4 * (1 + 0.1 * i), 1e-6, 'capped global fit, R2 of set ' + (i + 1)));
  }

  // ---------- 3. DRT slider: a value outside its range widens it to whole decades, within the limits of the setting
  {
    if (!Y.drtTab) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'drt_tab.js'), 'utf8'), { filename: 'js/ui/drt_tab.js' });
    const w = Y.drtTab._widen, L = Y.state.LIMITS.lambdaLog;
    ok(w([-6, 0], -8.3, L).join() === '-9,0' && w([-6, 0], 1.2, L).join() === '-6,2' && w([-6, 0], -3, L).join() === '-6,0',
       'λ slider widened to a typed λ outside it, unchanged for a λ inside it');
    ok(w([-9, 0], -2, L).join() === '-9,0' && w([-6, 0], -20, L).join() === '-12,0', 'a widened slider stays widened, never beyond the limits');
    ok(w([2, 5], 0, [0, 5]).join() === '0,5' && w([-6, 0], NaN, L).join() === '-6,0', 'Gold slider down to 1 iteration; no value, no change');
  }

  // ---------- 4. text files: numbers with 9 significant digits
  {
    ok(Y.writers.e(Math.PI) === '3.14159265E+0' && Y.writers.e(-1234567.891234) === '-1.23456789E+6' && Y.writers.e(NaN) === 'NaN', 'numbers written with 9 significant digits');
    const ds = { name: 'd', mask: new Uint8Array(3), f: Float64Array.from([1234.56789012, 98765.4321098, 0.0123456789012]),
                 zr: Float64Array.from([0.000123456789012, 1.23456789012e7, 5.5]), zi: Float64Array.from([-98765.4321098, -3.14159265359, -2.71828182846]) };
    const back = Y.readers.headerTable(Y.writers.dataText([ds], { sep: 'tab' }, () => null), 'd.txt')[0];
    let worst = 0;
    ['f', 'zr', 'zi'].forEach(k => ds[k].forEach((v, i) => { worst = Math.max(worst, Math.abs(back[k][i] / v - 1)); }));
    ok(worst <= 5e-9, 'Save data reads back to 9 significant digits (largest relative difference ' + worst.toExponential(1) + ')');
  }

  // ---------- 5. Nelder-Mead: one iteration is n simplex steps, so the iterations reported never exceed the maximum
  {
    const f = Y.dataops.logspace(1e6, 1e-1, 41), z = sim('R(RC)', [50, 1e4, 1e-9], f);
    const job = it => ({ id: 1, cdc: 'R1(R2C1)', f, zr: z.re, zi: z.im, p: Float64Array.from([80, 3e3, 5e-9]), fit: Uint8Array.from([1, 1, 1]),
      lo: Float64Array.from([1e-3, 1e-3, 1e-16]), hi: Float64Array.from([1e10, 1e10, 1e3]), method: 'NM', weight: 'mod', maxIter: it, tol: 1e-12 });
    const r5 = Y.fit.run(job(5)), r = Y.fit.run(job(2500));
    ok(r5.iter === 5 && /iteration limit/.test(r5.msg), 'Nelder-Mead stopped by a maximum of 5 iterations reports 5 (' + r5.iter + ', ' + r5.msg + ')');
    ok(/^converged/.test(r.msg) && r.iter <= 2500, 'Nelder-Mead converged within the maximum (' + r.iter + ' iterations)');
  }

  // ---------- 6. TRDL: a CPE exponent held on its limit (true n 1.3, limit 1.2) no longer makes the fit crawl
  {
    const f = Y.dataops.logspace(1e-2, 1e6, 61), z = sim('R(RQ)(RQ)', [50, 1e4, 1e-9, 1.3, 2e3, 1e-6, 0.8], f);
    let s = 3;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, zr = Float64Array.from(z.re), zi = Float64Array.from(z.im);
    for (let k = 0; k < 61; k++) { const m = Math.hypot(zr[k], zi[k]); zr[k] += 0.002 * m * (2 * rnd() - 1); zi[k] += 0.002 * m * (2 * rnd() - 1); }
    const job = p => ({ id: 1, cdc: 'R1(R2Q1)(R3Q2)', f, zr, zi, p: Float64Array.from(p), fit: Uint8Array.from([1, 1, 1, 1, 1, 1, 1]),
      lo: Float64Array.from([1e-3, 1e-3, 1e-16, 0, 1e-3, 1e-16, 0]), hi: Float64Array.from([1e10, 1e10, 1e3, 1.2, 1e10, 1e3, 1.2]),
      method: 'TRDL', weight: 'mod', maxIter: 2500, tol: 1e-12 });
    const t = Y.fit.run(job([80, 3e3, 5e-9, 1.0, 5e3, 3e-7, 0.9])), again = Y.fit.run(job(t.p));
    ok(/^converged/.test(t.msg) && t.iter < 200 && t.atBound[3] === 1,
       'TRDL with n on its limit converges (' + t.iter + ' iterations, ' + t.msg + '; it crawled to the 2500-iteration limit before)');
    ok(again.chi2w >= t.chi2w * (1 - 1e-9), 'and ends at a minimum: a new TRDL fit from there does not lower χ²');
  }
};
