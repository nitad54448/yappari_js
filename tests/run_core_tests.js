/* Run with:  node tests/run_core_tests.js
 * Loads the DOM-free modules into Node and checks them against independent reference code. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
['js/core/namespace.js', 'js/core/elements.js', 'js/core/circuit.js', 'js/core/linalg.js',
 'js/core/fit.js', 'js/core/globalfit.js', 'js/io/readers.js', 'js/io/writers.js', 'js/core/dataops.js', 'js/core/drt.js', 'js/state.js']
  .forEach(f => { if (fs.existsSync(path.join(root, f))) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }); });
const Y = globalThis.Y;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } }
function close(a, b, rel, msg) {
  const d = Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  ok(d <= rel, msg + ` (got ${a}, expected ${b}, rel err ${d.toExponential(2)})`);
}

// ---------- independent complex reference ----------
const C = (re, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cexp = a => C(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const clog = a => C(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re));
const cpow = (a, x) => cexp(mul(C(x), clog(a)));
const csqrt = a => cpow(a, 0.5);
const ctanh = a => { if (a.re > 20) return C(1, 0); const e2 = cexp(mul(C(2), a)); return div(add(e2, C(-1)), add(e2, C(1))); };
const inv = a => div(C(1), a);
const par = (...zs) => inv(zs.reduce((s, z) => add(s, inv(z)), C(0)));
const jw = w => C(0, w);

const refs = {
  R: (w, [R]) => C(R),
  C: (w, [Cc]) => inv(mul(jw(w), C(Cc))),
  L: (w, [L]) => mul(jw(w), C(L)),
  Q: (w, [Q, n]) => inv(mul(C(Q), cpow(jw(w), n))),
  W: (w, [A]) => C(A / Math.sqrt(w), -A / Math.sqrt(w)),
  Wo: (w, [A, B]) => mul(div(C(A), csqrt(jw(w))), inv(ctanh(mul(C(B), csqrt(jw(w)))))),
  Ws: (w, [A, B]) => mul(div(C(A), csqrt(jw(w))), ctanh(mul(C(B), csqrt(jw(w))))),
  G: (w, [R, t]) => div(C(R), csqrt(add(C(1), mul(jw(w), C(t))))),
  HN: (w, [R, t, a, b]) => div(C(R), cpow(add(C(1), cpow(mul(jw(w), C(t)), a)), b)),
};
const testPars = { R: [123], C: [2.2e-8], L: [3e-6], Q: [4e-7, 0.83], W: [55], Wo: [80, 0.3], Ws: [80, 0.3], G: [150, 2e-4], HN: [300, 1e-3, 0.8, 0.6] };
const ws = [1e-3, 0.37, 12, 513, 2.4e4, 9e5, 3e7].map(f => 2 * Math.PI * f);
for (const k of Y.elementKinds) {
  const p = Float64Array.from(testPars[k]), w = Float64Array.from(ws), re = new Float64Array(w.length), im = new Float64Array(w.length);
  Y.elements[k].z(w, p, 0, re, im);
  ws.forEach((wk, i) => {
    const z = refs[k](wk, testPars[k]);
    close(re[i], z.re, 1e-9, `${k} re at w=${wk.toPrecision(3)}`);
    close(im[i], z.im, 1e-9, `${k} im at w=${wk.toPrecision(3)}`);
  });
}

// ---------- parser ----------
const t1 = Y.circuit.parse('R(RQ)(Q[RW])');
ok(Y.circuit.toCDC(t1) === 'R1(R2Q1)(Q2[R3W1])', 'canonical numbering: ' + Y.circuit.toCDC(t1));
ok(Y.circuit.toCDC(Y.circuit.parse('r (r,q) - (q [r ws])')) === 'R1(R2Q1)(Q2[R3Ws1])', 'lenient syntax');
ok(Y.circuit.toCDC(Y.circuit.parse('R5([RQ]C)')) === 'R5([R1Q1]C1)', 'explicit numbers kept');
ok(Y.circuit.toCDC(Y.circuit.parse('((RC))')) === '(R1C1)', 'nested parallel flattened');
ok(Y.circuit.toCDC(Y.circuit.parse('[[R][C]]')) === 'R1C1', 'nested series flattened');
ok(Y.circuit.toCDC(Y.circuit.parse('(R)')) === 'R1', 'single child unwrapped');
for (const bad of ['', 'R(RQ', 'R)Q', 'R()', 'RX', 'R1R1']) {
  let threw = false; try { Y.circuit.parse(bad); } catch (e) { threw = true; }
  ok(threw, 'parse error expected for "' + bad + '"');
}
const prog = Y.circuit.compile(t1);
ok(prog.names.join(',') === 'R1,R2,Q1,Q1_n,Q2,Q2_n,R3,W1', 'parameter names ' + prog.names.join(','));

// ---------- evaluator vs reference ----------
{
  const pv = [10, 200, 3e-6, 0.85, 2e-5, 0.9, 50, 30];
  const f = Float64Array.from([0.01, 1, 100, 1e4, 1e6]);
  const z = Y.circuit.impedance(prog, f, Float64Array.from(pv));
  f.forEach((fk, i) => {
    const w = 2 * Math.PI * fk;
    const ref = add(add(C(pv[0]), par(C(pv[1]), refs.Q(w, [pv[2], pv[3]]))),
                    par(refs.Q(w, [pv[4], pv[5]]), add(C(pv[6]), refs.W(w, [pv[7]]))));
    close(z.re[i], ref.re, 1e-10, 'circuit re f=' + fk);
    close(z.im[i], ref.im, 1e-10, 'circuit im f=' + fk);
  });
}

// ---------- editing helpers ----------
{
  let t = Y.circuit.parse('R(RQ)');
  t = Y.circuit.insert(t, [1, 0], Y.circuit.parse('W', { number: false }), 's');   // R2 -> [R2 W1]
  ok(Y.circuit.toCDC(t) === 'R1([R2W1]Q1)', 'insert series in parallel: ' + Y.circuit.toCDC(t));
  t = Y.circuit.insert(t, [], Y.circuit.parse('L', { number: false }), 's');
  ok(Y.circuit.toCDC(t) === 'R1([R2W1]Q1)L1', 'append series at root: ' + Y.circuit.toCDC(t));
  t = Y.circuit.insert(t, [0], Y.circuit.parse('C', { number: false }), 'p');
  ok(Y.circuit.toCDC(t) === '(R1C1)([R2W1]Q1)L1', 'parallel on element: ' + Y.circuit.toCDC(t));
  t = Y.circuit.remove(t, [1]);
  ok(Y.circuit.toCDC(t) === '(R1C1)L1', 'remove: ' + Y.circuit.toCDC(t));
  t = Y.circuit.replace(t, [1], Y.circuit.parse('R', { number: false }));
  ok(Y.circuit.toCDC(t) === '(R1C1)R2', 'replace gets a fresh number: ' + Y.circuit.toCDC(t));
}

// ---------- fitting ----------
function lcg(seed) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296); }
function simulate(cdc, pv, nf, noise, seed) {
  const pr = Y.circuit.compile(Y.circuit.parse(cdc)), f = new Float64Array(nf);
  for (let k = 0; k < nf; k++) f[k] = Math.pow(10, 6 - 9 * k / (nf - 1));
  const z = Y.circuit.impedance(pr, f, Float64Array.from(pv)), rnd = lcg(seed || 1);
  const zr = new Float64Array(nf), zi = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    const m = Math.hypot(z.re[k], z.im[k]);
    zr[k] = z.re[k] + noise * m * (2 * rnd() - 1); zi[k] = z.im[k] + noise * m * (2 * rnd() - 1);
  }
  return { prog: pr, f, zr, zi };
}
function job(sim, p0, fitMask, method, weight) {
  const pr = sim.prog, np = pr.names.length, lo = new Float64Array(np), hi = new Float64Array(np);
  pr.params.forEach((pp, j) => { const d = Y.paramDefault(pp.kind, pp.pi); lo[j] = d.min; hi[j] = d.max; });
  return { id: 1, cdc: pr.cdc, f: sim.f, zr: sim.zr, zi: sim.zi, p: Float64Array.from(p0),
           fit: Uint8Array.from(fitMask), lo, hi, method, weight: weight || 'mod', maxIter: 2500, tol: 1e-12 };
}
{
  // quick_start-like case: R + (RQ) + (RQ), true values, start values off by up to a factor 3
  const truth = [1024, 1e5, 9e-10, 1, 3e5, 1e-9, 1];
  const sim = simulate('R(RQ)(RQ)', truth, 91, 0.0, 7);
  const start = [800, 3e4, 2e-9, 1, 9e5, 4e-10, 1];
  for (const method of ['TRDL', 'LMB', 'LM', 'NM']) {
    const t0 = Date.now();
    const res = Y.fit.run(job(sim, start, [1, 1, 1, 0, 1, 1, 0], method));
    const dt = Date.now() - t0;
    ok(res.ok, method + ' ok: ' + res.msg);
    [0, 1, 2, 4, 5].forEach(j => close(res.p[j], truth[j], method === 'NM' ? 1e-4 : 1e-6, method + ' noiseless param ' + sim.prog.names[j]));
    console.log(`  ${method}: ${res.iter} it, ${res.nev} evals, ${dt} ms, chi2w=${res.chi2w.toExponential(2)}, ${res.msg}`);
  }
  // with 1% noise: compare SE with the scatter of repeated fits
  const sims = [], vals = [];
  for (let s = 1; s <= 40; s++) {
    const sm = simulate('R(RQ)(RQ)', truth, 91, 0.01, s);
    const res = Y.fit.run(job(sm, truth, [1, 1, 1, 1, 1, 1, 1], 'LM', 'mod2'));
    vals.push(res); sims.push(sm);
  }
  const j = 2;   // Q1
  const v = vals.map(r => r.p[j]), mean = v.reduce((a, b) => a + b) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  const seMean = vals.reduce((a, r) => a + r.se[j], 0) / vals.length;
  const ratio = (100 * sd / mean) / seMean;
  console.log(`  SE check (Q1): scatter ${(100 * sd / mean).toFixed(3)} %, mean reported SE ${seMean.toFixed(3)} %, ratio ${ratio.toFixed(2)}`);
  ok(ratio > 0.6 && ratio < 1.6, 'reported SE consistent with Monte-Carlo scatter');
  ok(vals.every(r => r.r2 > 0.999), 'R2 close to 1 with 1% noise');
}
{
  // bounds respected and SE suppressed at a bound
  const sim = simulate('R(RQ)', [100, 1e4, 1e-6, 0.8], 61, 0.0, 3);
  const jb = job(sim, [100, 1e4, 1e-6, 0.8], [1, 1, 1, 1], 'TRDL');
  jb.hi[3] = 0.7;   // force n against its upper limit
  const res = Y.fit.run(jb);
  ok(Math.abs(res.p[3] - 0.7) < 1e-9, 'parameter clamped at upper bound: ' + res.p[3]);
  ok(res.atBound[3] === 1 && isNaN(res.se[3]), 'no SE for a parameter at its bound');
}
{
  // finite-length Warburg circuit (Randles with Ws)
  const truth = [20, 1e-5, 0.9, 150, 60, 0.5];
  const sim = simulate('R(Q[RWs])', truth, 81, 0.002, 11);
  const res = Y.fit.run(job(sim, [30, 3e-5, 0.9, 100, 100, 1], [1, 1, 1, 1, 1, 1], 'TRDL'));
  [0, 3, 4, 5].forEach(j => close(res.p[j], truth[j], 0.05, 'Randles-Ws ' + sim.prog.names[j]));
}

// ---------- global fit ----------
{
  // 6 spectra: shared Q1, Q1_n ; local R1, R2 ; fixed R... cdc R(RQ)
  const sets = [], Rs = [], Rp = [];
  for (let i = 0; i < 6; i++) {
    const r1 = 20 + 5 * i, r2 = 1000 * (1 + i);
    Rs.push(r1); Rp.push(r2);
    const sm = simulate('R(RQ)', [r1, r2, 2e-6, 0.88], 61, 0.003, 100 + i);
    sets.push({ id: i, f: sm.f, zr: sm.zr, zi: sm.zi, p: Float64Array.from([30, 2000, 5e-6, 0.8]) });
  }
  const pr = Y.circuit.compile(Y.circuit.parse('R(RQ)'));
  const lo = Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).min));
  const hi = Float64Array.from(pr.params.map(pp => Y.paramDefault(pp.kind, pp.pi).max));
  const t0 = Date.now();
  const res = Y.globalFit.run({ cdc: pr.cdc, sets, fit: Uint8Array.from([1, 1, 1, 1]), shared: Uint8Array.from([0, 0, 1, 1]),
                                lo, hi, weight: 'mod', method: 'TRDL', maxIter: 500, tol: 1e-12 });
  ok(res.ok, 'global fit ok: ' + res.msg);
  if (res.ok) {
    console.log(`  global fit: ${res.iter} it, ${Date.now() - t0} ms, chi2red=${res.chi2red.toExponential(2)}, ${res.msg}`);
    close(res.sets[0].p[2], 2e-6, 0.02, 'shared Q1');
    close(res.sets[3].p[3], 0.88, 0.01, 'shared n');
    res.sets.forEach((s, i) => { close(s.p[0], Rs[i], 0.05, 'local R1 set ' + i); close(s.p[1], Rp[i], 0.02, 'local R2 set ' + i); });
    ok(res.sets.every(s => s.se[2] === res.sets[0].se[2] && isFinite(s.se[2])), 'shared SE identical across sets');
    ok(res.sets.every(s => isFinite(s.se[0]) && isFinite(s.se[1])), 'local SE finite');
  }
  // all shared (Yappari behaviour): identical spectra -> same as single fit
  const same = [0, 1, 2].map(i => ({ id: i, f: sets[0].f, zr: sets[0].zr, zi: sets[0].zi, p: Float64Array.from([30, 2000, 5e-6, 0.8]) }));
  const g2 = Y.globalFit.run({ cdc: pr.cdc, sets: same, fit: Uint8Array.from([1, 1, 1, 1]), shared: Uint8Array.from([1, 1, 1, 1]),
                               lo, hi, weight: 'mod', method: 'LMB', maxIter: 500, tol: 1e-12 });
  const s1 = Y.fit.run({ id: 0, cdc: pr.cdc, f: sets[0].f, zr: sets[0].zr, zi: sets[0].zi, p: Float64Array.from([30, 2000, 5e-6, 0.8]),
                         fit: Uint8Array.from([1, 1, 1, 1]), lo, hi, method: 'LMB', weight: 'mod', maxIter: 500, tol: 1e-12 });
  [0, 1, 2, 3].forEach(j => close(g2.sets[0].p[j], s1.p[j], 1e-5, 'all-shared global = single fit, ' + pr.names[j]));
}

// ---------- worker source compiles and runs in a clean context ----------
{
  const workerMain = function () { self.onmessage = function (e) { self.postMessage(Y.fit.run(e.data)); }; };
  const src = 'var Y = {}; Y.defineCore = function (n, f) { f(Y); };\n' + Y.coreSources.join('\n') + '\n(' + workerMain.toString() + ')();';
  let got = null;
  const ctx = { self: { postMessage: m => { got = m; } }, Float64Array, Uint8Array, Math, Date, JSON, isFinite, Error, String, Array, Infinity, NaN };
  ctx.self.self = ctx.self;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const sim = simulate('R(RC)', [10, 500, 1e-7], 41, 0, 5);
  ctx.self.onmessage({ data: job(sim, [20, 300, 3e-7], [1, 1, 1], 'TRDL') });
  ok(got && got.ok && Math.abs(got.p[1] - 500) < 1e-3, 'fit inside isolated worker context');
}

if (Y.readers) require('./run_io_tests.js')(Y, ok, close);
if (Y.drt) require('./run_step2_tests.js')(Y, ok, close);
if (Y.state) require('./run_fix_tests.js')(Y, ok, close);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
