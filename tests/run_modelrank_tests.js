/* Run with: node tests/run_modelrank_tests.js. Bayesian ranking of the model search (js/core/modelrank.js). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f }); }
['core/namespace', 'core/elements', 'core/circuit', 'core/linalg', 'core/fit', 'core/dataops', 'core/modelrank', 'ui/model_search'].forEach(load);
const Y = globalThis.Y, R = Y.modelRank, M = Y.modelSearch;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const allowed = Object.fromEntries(Object.keys(Y.elements).map(k => [k, true]));
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-300)) * Math.cos(2 * Math.PI * rnd());
function spectrum(cdc, p, f, noise) {
  const prog = Y.circuit.compile(Y.circuit.parse(cdc)), z = Y.circuit.impedance(prog, f, Float64Array.from(p));
  const m = k => Math.hypot(z.re[k], z.im[k]);
  return { f, zr: Float64Array.from(z.re, (v, k) => v + noise * m(k) * gauss()), zi: Float64Array.from(z.im, (v, k) => v + noise * m(k) * gauss()) };
}
// best of a few seeded searches of one circuit, ranked as in the dialog
function search(cdc, d, metric, n) {
  const c = M.candidate(cdc, allowed, Y.circuit.elements(Y.circuit.parse(cdc)).length), item = M.newItem(c, 99);
  for (const j of M.jobs(c, d, { method: 'TRDL', weight: 'mod2', maxIter: 2500, tol: 1e-12 }, item.rng, n || 8, metric.ranges))
    M.consider(item, M.assess(c, Y.fit.run(j), d, metric), { reject: '', notes: [] });
  return item.best;
}

test('canonical codes ignore numbering, order, grouping and reducible repeats', () => {
  const k = s => R.canon(Y.circuit.parse(s, { number: false }));
  assert.equal(k('R(RQ)'), k('(QR)R')); assert.equal(k('R(RQ)'), k('R1(Q1R2)'));
  assert.equal(k('R(RC)RR'), k('R(RC)')); assert.equal(k('(RR[RC])'), k('(R[RC])'));
  assert.notEqual(k('R(QQ)'), k('R(Q)')); assert.notEqual(k('R(RC)(RC)'), k('R(C[R(RC)])'));
  assert.equal(R.elementKey(Y.circuit.parse('R(C[R(RC)])')), R.elementKey(Y.circuit.parse('R(RC)(RC)')));
});

test('the shipped catalog/priors.txt reads without warnings', () => {
  const pr = R.parsePriors(fs.readFileSync(path.join(__dirname, '..', 'catalog', 'priors.txt'), 'utf8'));
  assert.deepEqual(pr.warnings, []);
  assert(pr.listed >= 80, pr.listed + ' circuits');
  assert.equal(pr.defaultWeight, 0.5);
  const w = s => R.weightOf(pr, R.canon(Y.circuit.parse(s)));
  assert(w('R(C[RW])') > w('R(RQ)') && w('R(RQ)') > pr.defaultWeight && w('(RQ)R') === w('R(RQ)'));
  assert.equal(w('R(LQ)(QW)(RC)'), 0.5);
  assert.equal(pr.params.Q_n.type, 'normal'); assert.equal(pr.params['*'].k, 2);
});

test('prior file: bad lines reported and skipped, weight 0 excludes', () => {
  const pr = R.parsePriors('default\t2\ncircuit\tR(RQ)\t0\ncircuit\tR(XQ)\t3\ncircuit  RC  -1\nparam\tQ_n\tnormal\t0.9\t0\nparam\tZ\twindow\t2\nfoo\tbar\n');
  assert.equal(pr.defaultWeight, 2); assert.equal(R.logPrior(pr, R.canon(Y.circuit.parse('(QR)R'))), -Infinity);
  assert.equal(pr.warnings.length, 5); assert.equal(pr.params.Q_n.sd, 0.15, 'built-in kept');
});

// Laplace evidence of a one-parameter model against direct integration over ln R (known σ, then unknown noise scale)
test('Laplace evidence matches numerical integration for one parameter', () => {
  const f = Y.dataops.logspace(1e4, 1, 30), d = spectrum('R', [100], f, 0.0), sr = new Float64Array(30).fill(2), si = new Float64Array(30).fill(2);
  for (let k = 0; k < 30; k++) { d.zr[k] += 2 * gauss(); d.zi[k] += 2 * gauss(); }
  const c = M.candidate('R', allowed, 1);
  for (const sigma of [true, false]) {
    const dd = sigma ? Object.assign({}, d, { sr, si }) : d, metric = M.scoring(dd, 'unit', 0, { mode: 'bayes', priors: R.builtin() });
    const res = Y.fit.run(Object.assign({ id: 0, cdc: 'R1', p: Float64Array.from([90]), fit: Uint8Array.from([1]), lo: Float64Array.from([1e-3]), hi: Float64Array.from([1e10]),
      method: 'TRDL', weight: 'unit', maxIter: 500, tol: 1e-14, hessian: true }, dd));
    const e = M.assess(c, res, dd, metric), m = 60;
    const pr = R.paramPrior(c.prog, res.p, 0, metric.priors, metric.ranges);
    let s = 0, h = 1e-4, peak = -Infinity; const vals = [];
    for (let x = Math.log(res.p[0]) - 0.2; x <= Math.log(res.p[0]) + 0.2; x += h) {
      let chi = 0; const Rv = Math.exp(x);
      for (let k = 0; k < 30; k++) { const a = (Rv - dd.zr[k]) * metric.wr[k], b = (0 - dd.zi[k]) * metric.wi[k]; chi += a * a + b * b; }
      const lnL = sigma ? -chi / 2 : -(m / 2) * Math.log(chi / metric.energy);
      const v = lnL - 0.5 * ((x - pr.mu) / pr.sd) ** 2 - Math.log(pr.sd) - 0.5 * Math.log(2 * Math.PI);
      vals.push(v); peak = Math.max(peak, v);
    }
    for (const v of vals) s += Math.exp(v - peak) * h;
    const direct = peak + Math.log(s);
    assert(Math.abs(e.lnZ - direct) < (sigma ? 0.01 : 0.03), (sigma ? 'known σ' : 'unknown scale (Student-t shape, Laplace error O(1/m))') + ': Laplace ' + e.lnZ + ' vs integral ' + direct);
  }
});

test('evidence prefers the true circuit to a simpler and a more complex one', () => {
  const f = Y.dataops.logspace(1e5, 1e-1, 51), d = spectrum('R(RC)(RC)', [20, 1000, 1e-6, 3000, 1e-3], f, 0.005);
  const metric = M.scoring(d, 'mod2', 0, { mode: 'bayes', priors: R.builtin() });
  const lw = {};
  for (const cdc of ['R(RC)', 'R(RC)(RC)', 'R(RC)(RC)(RC)', 'R(RQ)(RQ)']) lw[cdc] = search(cdc, d, metric).lw;
  console.log('  ln P:', Object.entries(lw).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', '));
  assert(lw['R(RC)(RC)'] > lw['R(RC)'] + 10, 'misses an arc');
  assert(lw['R(RC)(RC)'] > lw['R(RC)(RC)(RC)'], 'an arc too many');
  assert(lw['R(RC)(RC)'] > lw['R(RQ)(RQ)'], 'two needless exponents');
});

test('Voigt and ladder forms merge into one class; a different circuit does not', () => {
  const f = Y.dataops.logspace(1e5, 1e-1, 51), d = spectrum('R(RC)(RC)', [20, 1000, 1e-6, 3000, 1e-3], f, 0.005);
  const metric = M.scoring(d, 'mod2', 0, { mode: 'bayes', priors: R.builtin() }), rows = [];
  const a = search('R(RC)(RC)', d, metric), b = search('R(C[R(RC)])', d, metric), c = search('R(RQ)(RC)', d, metric);
  R.addEntry(rows, a); R.addEntry(rows, b); R.addEntry(rows, c);
  const cls = rows.find(cl => cl.members.some(m => m.cdc === a.cdc));
  assert(cls.members.some(m => m.cdc === b.cdc), 'ladder merged with Voigt');
  assert(!cls.members.some(m => m.cdc === c.cdc), 'different elements stay apart');
  const mean = R.logAddExp(a.lnZ, b.lnZ) - Math.log(2), wmax = Math.max(a.lw - a.lnZ, b.lw - b.lnZ);
  assert(Math.abs(cls.lw - (mean + wmax)) < 1e-9, 'class: highest prior, mean evidence');
  const dropped = []; const small = []; R.addEntry(small, a, 1, v => dropped.push(v)); R.addEntry(small, c, 1, v => dropped.push(v));
  assert(small.length === 1 && dropped.length === 1 && Math.abs(R.logTotal(small, dropped[0]) - R.logAddExp(a.lw, c.lw)) < 1e-9, 'classes leaving the table still count in the total');
  assert(R.addEntry(rows, Object.assign({}, a, { lw: a.lw + 1 })) && cls.rep.lw === a.lw + 1, 'better fit of a member replaces it');
});

test('a degenerate extra element costs evidence (Occam factor), BIC-like', () => {
  const f = Y.dataops.logspace(1e5, 1e-1, 51), d = spectrum('R(RQ)', [20, 1000, 1e-6, 0.85], f, 0.01);
  const metric = M.scoring(d, 'mod2', 0, { mode: 'bayes', priors: R.builtin() });
  const t = search('R(RQ)', d, metric), x = search('R(RQ)L', d, metric);
  assert(t.lw > x.lw + 1, 'R(RQ) ' + t.lw.toFixed(2) + ' vs R(RQ)L ' + x.lw.toFixed(2));
});

console.log(checks + ' model ranking checks passed.');
