/* Run with: node tests/run_review8_tests.js. Reproductions of the six October review issues. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f }); }
['core/namespace', 'core/elements', 'core/circuit', 'core/linalg', 'core/fit', 'core/globalfit',
 'core/dataops', 'io/readers', 'io/writers', 'state'].forEach(load);
const Y = globalThis.Y;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function near(a, b) { assert(Number.isFinite(a) && Math.abs(a - b) <= 1e-11 * Math.max(Math.abs(b), 1e-30), `${a} != ${b}`); }
function table(head, row) { return Y.readers.headerTable(head.join('\t') + '\n' + row.join('\t'), 'units.txt')[0]; }
for (const [unit, scale] of [['Hz', 1], ['kHz', 1e3], ['KHz', 1e3], ['KHZ', 1e3], ['MHz', 1e6],
  ['mHz', 1e-3], ['GHz', 1e9], ['kiloHertz', 1e3], ['K Hertz', 1e3], ['unknown', 1], ['', 1]]) {
  test('frequency unit ' + unit, () => near(table(['freq/' + unit, 'Zr', 'Zi'], [2, 3, -4]).f[0], 2 * scale));
}
for (const [unit, scale] of [['Ohm', 1], ['ohms', 1], ['Kohm', 1e3], ['KOHM', 1e3], ['kOhm', 1e3],
  ['MOhm', 1e6], ['mOhm', 1e-3], ['Ω', 1], ['kΩ', 1e3], ['MΩ', 1e6], ['µOhm', 1e-6], ['μΩ', 1e-6],
  ['uOhm', 1e-6], ['MegaOhms', 1e6], ['milliOhm', 1e-3], ['unknown', 1], ['', 1]]) {
  test('impedance unit ' + unit, () => {
    const d = table(['freq/Hz', 'Zr/' + unit, '-Zi/' + unit], [2, 3, 4]);
    near(d.zr[0], 3 * scale); near(d.zi[0], -4 * scale);
  });
}
test('brackets, quotes, per-column units and sigma', () => {
  const d = table(['"Frequency (KHz)"', 'Re(Z) [MOhm]', '-Im(Z)/mOhm', 'sigma_Zr/MOhm', 'sigma_Zi/mOhm'], [2, 3, 4, 0.1, 0.2]);
  near(d.f[0], 2000); near(d.zr[0], 3e6); near(d.zi[0], -0.004); near(d.sr[0], 1e5); near(d.si[0], 0.0002);
});
test('polar units with degrees and radians', () => {
  for (const [unit, angle] of [['deg', -90], ['rad', -Math.PI / 2]]) {
    const d = table(['freq/KHz', '|Z|/Kohm', 'phase/' + unit], [1, 2, angle]);
    near(d.f[0], 1000); near(d.zi[0], -2000); assert(Math.abs(d.zr[0]) < 1e-10);
  }
});
test('compact padded headings keep their units', () => {
  const d = Y.readers.headerTable('freq/KHz\t\tZr/Kohm\t\tZi/Kohm\n1\t2\t-3', 'padded.txt')[0];
  near(d.f[0], 1000); near(d.zr[0], 2000); near(d.zi[0], -3000);
});
test('calculated-only columns and comma decimals', () => {
  const d = Y.readers.headerTable('freq/KHz;Zr_calc/Kohm;Zi_calc/Kohm\n1,5;2,5;-3,5', 'calc.txt')[0];
  near(d.f[0], 1500); near(d.zr[0], 2500); near(d.zi[0], -3500);
});
test('MFLI prototype-like chunk and field names are inert', () => {
  const names = ['constructor', '__proto__', 'toString', 'ordinary'];
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const text = 'chunk;timestamp;size;fieldname;values\n' + names.flatMap((ch, i) =>
    ['frequency;1;2', `realz;${10 + i};${20 + i}`, 'imagz;-1;-2', '__proto__;99;98', 'constructor;97;96']
      .map(row => ch + ';0;2;' + row)).join('\n');
  const ds = Y.readers.mfliCsv(text, 'chunks.csv');
  assert.deepStrictEqual(ds.map(d => d.name), names.map(n => 'chunks_' + n));
  ds.forEach((d, i) => assert.deepStrictEqual(Array.from(d.zr), [10 + i, 20 + i]));
  assert.deepStrictEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  assert(!Object.hasOwn(Object, 'frequency'));
});
for (const kind of ['Wo', 'Ws']) {
  for (const B of [1e-4, 1, 20, 1000]) test(kind + ' is odd in B=' + B, () => {
    const pr = Y.circuit.compile(Y.circuit.parse(kind));
    const plus = Y.circuit.impedance(pr, [0.001, 1, 1e6], [100, B]);
    const minus = Y.circuit.impedance(pr, [0.001, 1, 1e6], [100, -B]);
    plus.re.forEach((v, i) => near(minus.re[i], -v)); plus.im.forEach((v, i) => near(minus.im[i], -v));
  });
}
test('unbounded Warburg fit accepts a large negative B', () => {
  const pr = Y.circuit.compile(Y.circuit.parse('Ws')), f = [1, 10, 100], z = Y.circuit.impedance(pr, f, [100, -1000]);
  const r = Y.fit.run({ cdc: pr.cdc, f, zr: z.re, zi: z.im, p: [80, -1000], fit: [1, 0],
    lo: [1e-6, 1e-6], hi: [1e10, 1e6], method: 'LM', weight: 'unit', maxIter: 200, tol: 1e-12 });
  assert(r.ok); assert(Math.abs(r.p[0] - 100) < 1e-6);
});
test('unsafe element numbers are rejected before canonicalisation', () => {
  for (const s of ['R1000000000000000000000', 'R9007199254740992', 'R' + '9'.repeat(400)]) {
    assert.throws(() => Y.circuit.parse(s), /Element number/);
    assert.throws(() => Y.circuit.parse(s, { number: false }), /Element number/);
  }
  assert.throws(() => Y.circuit.number({ t: 'e', k: 'R', n: 1e21 }), /Element number/);
});
test('safe element numbers round trip and fit', () => {
  const cdc = 'R9007199254740991', pr = Y.circuit.compile(Y.circuit.parse(cdc));
  assert.equal(Y.circuit.toCDC(Y.circuit.parse(pr.cdc)), cdc);
  const r = Y.fit.run({ cdc, f: [1, 2], zr: [10, 10], zi: [0, 0], p: [5], fit: [1],
    lo: [0.001], hi: [1e10], method: 'LMB', weight: 'unit', maxIter: 100, tol: 1e-12 });
  assert(r.ok); assert(Math.abs(r.p[0] - 10) < 1e-6);
});
// Minimal DOM double exercises actual editor/history entry points, including the Undo button.
const nodes = new Map();
function node(s) {
  if (!nodes.has(s)) nodes.set(s, { value: '', textContent: '', className: '', innerHTML: '', clientWidth: 0,
    classList: { toggle() {} }, addEventListener(e, fn) { this[e] = fn; }, focus() {}, setSelectionRange() {} });
  return nodes.get(s);
}
global.document = { querySelector: s => s.startsWith('#log-list ') ? null : node(s), querySelectorAll: () => [],
  getElementById: s => node('#' + s), activeElement: null };
global.window = {};
Y.ui = { toast() {}, able() {} }; Y.schematic = { render() {}, icon: () => '' }; Y.theme = { partVars: () => [] };
load('history'); load('ui/model_editor'); Y.modelEditor.init();
Y.state.setModel(Y.circuit.parse('R'));
Y.history.take('import');
Y.state.addDatasets([{ name: 'measured', f: [1, 2, 3], zr: [9, 10, 11], zi: [0, 0, 0] }]);
const ds = Y.state.first(); Y.state.applyResult(ds, Y.fit.run(Y.state.jobFor(ds, Y.state.bounds())));
const original = { p: { ...ds.p }, stats: ds.stats };
test('main Undo restores circuit edit, dataset, parameters and statistics', () => {
  node('#cdc').value = 'RC'; Y.modelEditor.applyCode();
  assert.equal(Y.history.count(), 2); assert.equal(Y.state.S.model.cdc, 'R1C1');
  Y.history.undo();
  assert.equal(Y.state.S.datasets.length, 1); assert.equal(Y.state.S.model.cdc, 'R1');
  assert.deepStrictEqual(Y.state.first().p, original.p); assert.deepStrictEqual(Y.state.first().stats, original.stats);
});
test('editor Undo and main Undo share chronological history', () => {
  node('#cdc').value = 'RC'; Y.modelEditor.applyCode();
  Y.history.take('parameter edit'); Y.state.setParam('R1', 42);
  node('#node-undo').click();
  assert.equal(Y.state.S.model.cdc, 'R1C1'); near(Y.state.first().p.R1, original.p.R1);
  node('#node-undo').click();
  assert.equal(Y.state.S.model.cdc, 'R1'); assert.deepStrictEqual(Y.state.first().stats, original.stats);
  assert.equal(Y.state.S.datasets.length, 1);
});
test('clear circuit is fully undoable', () => {
  node('#node-clear').click(); assert.equal(Y.state.S.model.cdc, '');
  node('#node-undo').click(); assert.equal(Y.state.S.model.cdc, 'R1');
  assert.deepStrictEqual(Y.state.first().stats, original.stats);
});
test('changing fit flags clears stale statistics and undo restores them', () => {
  const d = Y.state.first(); const st = d.stats;
  Y.state.setFit('R1', true); assert.strictEqual(d.stats, st);
  Y.history.take('fit flags'); Y.state.setFit('R1', false);
  assert.strictEqual(d.stats, null);
  assert(!Y.writers.paramsText([d], ['R1'], { cdc: 'R1' }).includes(Y.writers.e(st.se.R1)));
  const pj = Y.state.prepareProject(JSON.parse(Y.writers.projectJSON(Y.state.S, [])));
  assert.strictEqual(pj.raws[0].stats, null);
  Y.history.undo(); assert(Y.state.first().fit.R1); assert.deepStrictEqual(Y.state.first().stats, st);
});
console.log(`${checks} regression checks passed.`);
