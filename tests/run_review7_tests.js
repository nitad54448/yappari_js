/* Run with: node tests/run_review7_tests.js. Regression checks for the five review fixes. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f }); }
['core/namespace', 'core/elements', 'core/circuit', 'core/linalg', 'core/fit', 'core/globalfit',
 'core/dataops', 'io/readers', 'io/writers', 'state'].forEach(load);
const Y = globalThis.Y;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function near(a, b) { assert(Number.isFinite(a) && Math.abs(a / b - 1) < 1e-12, `${a} != ${b}`); }
function z(cdc, p) { return Y.circuit.impedance(Y.circuit.compile(Y.circuit.parse(cdc)), [1], p); }
for (const v of [1e200, 1e-200, 1e-310, 100]) {
  test('parallel resistors at ' + v, () => { const a = z('(RR)', [v, v]); near(a.re[0], v / 2); assert(a.im[0] === 0); });
}
test('extreme complex branches', () => {
  for (const v of [1e200, 1e-200]) {
    const a = z('([RC][RC])', [v, 1 / (2 * Math.PI * v), v, 1 / (2 * Math.PI * v)]);
    near(a.re[0], v / 2); near(a.im[0], -v / 2);
  }
});
test('short and open branches', () => {
  assert(z('(RR)', [0, 100]).re[0] === 0); near(z('(RC)', [100, 0]).re[0], 100);
  assert(z('(CC)', [0, 0]).re[0] === Infinity);
});
test('Gerischer conjugate for negative tau and R for zero tau', () => {
  const a = z('G', [100, 1]), b = z('G', [100, -1]), c = z('G', [100, 0]);
  near(a.re[0], 30.15636321818726); near(a.im[0], -25.73637527369892);
  near(b.re[0], a.re[0]); near(b.im[0], -a.im[0]); assert(c.re[0] === 100 && c.im[0] === 0);
});
test('prototype-like chunk names import separately', () => {
  const text = 'freq/Hz\tZr\tZi\tchunk\n' + ['constructor', '__proto__', 'toString', 'ordinary'].flatMap((n, i) => [
    `1\t${10 + i}\t-1\t${n}`, `2\t${20 + i}\t-2\t${n}`]).join('\n');
  const ds = Y.readers.headerTable(text, 'chunks.txt'); assert(ds.length === 4);
  ds.forEach((d, i) => assert.deepStrictEqual(Array.from(d.zr), [10 + i, 20 + i]));
});
const storage = {};
global.localStorage = { getItem: k => storage[k] || null, setItem: (k, v) => { storage[k] = v; } };
global.document = { getElementById: () => null, querySelector: () => null };
Y.ui = { toast: () => {} }; load('history');
test('undo persists restored limits and shared flags', () => {
  Y.state.setModel(Y.circuit.parse('R')); Y.history.take('before edits');
  Y.state.setLimit('R1', 'max', 500); Y.state.setShared('R1', false); Y.history.undo();
  assert(Y.state.S.model.limits.R1.max === 1e10 && Y.state.S.model.shared.R1);
  const saved = JSON.parse(storage['yappari.model']);
  assert.deepStrictEqual(saved.limits, Y.state.S.model.limits); assert(saved.shared.R1);
  Y.state.restore(); assert(Y.state.S.model.limits.R1.max === 1e10 && Y.state.S.model.shared.R1);
});
let messages = [], downloads = 0;
Y.ui = { toast: (msg, kind) => messages.push({ msg, kind }), logEntries: () => [] };
Y.plots = { fmtF: String }; load('ui/commands');
test('invalid simulation leaves datasets, history and counter unchanged', () => {
  Y.state.setModel(Y.circuit.parse('C')); Y.state.S.settings.method = 'LM';
  Y.state.addDatasets([{ name: 'measured', f: [1, 2, 3], zr: [1, 1, 1], zi: [-1, -1, -1], p: { C1: 0 } }]);
  const count = Y.state.S.datasets.length, counter = Y.state.S.simCount, history = Y.history.count();
  Y.cmd.simulate();
  assert(Y.state.S.datasets.length === count && Y.state.S.simCount === counter && Y.history.count() === history);
  assert(messages.at(-1).kind === 'err');
});
test('valid simulation round trips with missing sigma and undefined statistics', () => {
  Y.state.setParam('C1', 1e-6); Y.cmd.simulate(); const ds = Y.state.first();
  ds.sr = Float64Array.from(ds.f, () => NaN); ds.si = Float64Array.from(ds.f, () => 1);
  ds.stats = { chi2w: NaN, r2: NaN };
  const pj = Y.state.prepareProject(JSON.parse(Y.writers.projectJSON(Y.state.S, [])));
  assert(pj.raws.length === 2 && pj.raws[0].f.length === ds.f.length);
});
test('invalid save is rejected with an error; valid save downloads', () => {
  const ds = Y.state.first(), old = ds.zi[0]; ds.zi[0] = Infinity;
  assert.throws(() => Y.writers.projectJSON(Y.state.S, []), /invalid zi/);
  Y.writers.download = () => { downloads++; }; Y.cmd.saveProject();
  assert(downloads === 0 && messages.at(-1).kind === 'err');
  ds.zi[0] = old; Y.cmd.saveProject(); assert(downloads === 1 && messages.at(-1).kind === 'ok');
});
console.log(`${checks} regression checks passed.`);
