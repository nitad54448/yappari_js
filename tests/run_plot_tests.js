/* Run with: node tests/run_plot_tests.js. Real state, circuit and plotting modules with a minimal canvas/DOM. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = new Proxy({}, {
  get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; }
});
function element() {
  return { clientWidth: 600, clientHeight: 400, style: {}, events: {},
    appendChild() {}, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener(k, fn) { this.events[k] = fn; } };
}
const elements = new Map(), frames = [], storage = new Map();
const theme = { fontSize: 11, titleSize: 12, ms: 1, ls: 1, font: 'sans-serif', series: ['#00f'], parts: ['#f00'] };
const sb = vm.createContext({ console, setTimeout(fn) { frames.push(fn); return frames.length; }, clearTimeout() {},
  document: { createElement: element, querySelectorAll: () => [], querySelector(s) {
    if (!elements.has(s)) elements.set(s, element());
    return elements.get(s);
  } },
  localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) || null },
  window: { addEventListener() {}, devicePixelRatio: 1 },
  requestAnimationFrame(fn) { frames.push(fn); return frames.length; }
});
function load(f) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f }); }
load('core/namespace'); sb.Y = sb.window.Y;
['core/elements', 'core/circuit', 'core/linalg', 'core/fit', 'core/dataops', 'state'].forEach(load);
const Y = sb.Y, S = Y.state.S;
Y.theme = { get: () => theme };
Y.drtTab = { plots: () => [] };
['ui/plot2d', 'ui/plot3d', 'ui/plots'].forEach(load);
function flush() { while (frames.length) frames.shift()(); }
function choose(value) {
  const el = elements.get('#plot-scale'); el.value = value; el.events.change(); flush();
}
function automatic(value) {
  const el = elements.get('#plot-auto'); el.checked = value; el.events.change(); flush();
}
function show(tab) { Y.plots.show(tab); flush(); }
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

Y.plots.init();
Y.state.setModel(Y.circuit.parse('C(RQ)'));
const ds = Y.state.addDatasets([{ name: 'measured', f: [1, 10, 1000], zr: [10, 20, 30], zi: [-1, -2, -3], p: { C1: 1e-14 } }])[0];
flush();
const P = Y.plots._plots;

test('large blocking capacitor and contributions cannot squash data in the default mode', () => {
  assert.equal(S.settings.plotScale, 'data'); assert.equal(S.settings.plotAuto, true);
  Y.state.setSetting('contrib', true); flush();
  assert(P.nyq.series.some(s => s.scaleRole === 'model' && Math.max(...s.y) > 1e12));
  assert(P.nyq.view.x1 < 100 && P.nyq.view.y1 < 100);
});
test('model and both modes include the large model; data mode restores the data limits', () => {
  choose('model'); assert(P.nyq.view.y1 > 1e12);
  choose('both'); assert(P.nyq.view.y1 > 1e12 && P.nyq.view.y0 < 0);
  choose('data'); assert(P.nyq.view.y1 < 100);
});
test('both includes disjoint data and model ranges; log plots fall back when the source is unusable', () => {
  const p = new Y.Plot2D(null, { width: 400, height: 300, scaleTo: 'data' });
  p.setSeries([{ x: [-30, -20], y: [1, 2], scaleRole: 'data' },
    { x: [100, 200], y: [1e14, 2e14], scaleRole: 'model' }]);
  assert(p.view.x1 < 0);
  p.o.scaleTo = 'model'; p.autoscale(true); assert(p.view.x0 > 0);
  p.o.scaleTo = 'both'; p.autoscale(true); assert(p.view.x0 < -30 && p.view.x1 > 200);
  p.o.scaleTo = 'data'; p.o.xlog = true; p.autoscale(true);
  assert(p.view.x0 > 0 && p.view.y1 > 1e14);
});
test('all spectrum views honor the source while residuals use their own values', () => {
  for (const [tab, key] of [['zr', 'zr'], ['zi', 'zi'], ['bode', 'mod']]) {
    show(tab); choose('data'); const data = { ...P[key].view };
    choose('model'); assert.notDeepStrictEqual({ ...P[key].view }, data);
    choose('data'); assert.deepStrictEqual({ ...P[key].view }, data);
  }
  assert(P.ziRes.view.y1 > 1e12);
});
test('Autoscale off holds both linked panels through parameter, data and source changes', () => {
  show('zi'); automatic(false);
  const main = { ...P.zi.view }, res = { ...P.ziRes.view };
  Y.state.setParam('C1', 1e-13); ds.zi[0] = -50; Y.bus.emit('data'); flush();
  choose('both');
  assert.deepStrictEqual({ ...P.zi.view }, main);
  assert.deepStrictEqual({ ...P.ziRes.view }, res);
  automatic(true); assert.notDeepStrictEqual({ ...P.zi.view }, main);
});
test('wheel zoom turns Autoscale off and double-click turns it back on for linked plots', () => {
  P.zi.canvas.events.wheel({ clientX: 200, clientY: 200, deltaY: 100, preventDefault() {} }); flush();
  assert.equal(S.settings.plotAuto, false); assert.equal(elements.get('#plot-auto').checked, false);
  assert.equal(P.ziRes.view.x0, P.zi.view.x0);
  P.ziRes.canvas.events.dblclick(); flush();
  assert.equal(S.settings.plotAuto, true); assert.equal(elements.get('#plot-auto').checked, true);
  assert.equal(P.zi.auto, true); assert.equal(P.ziRes.auto, true);
});
test('drag zoom and pan disable Autoscale immediately and retain the manual view on updates', () => {
  show('nyq');
  for (const button of [0, 2]) {
    automatic(true);
    P.nyq.canvas.events.mousedown({ clientX: 150, clientY: 150, button, preventDefault() {} });
    P.nyq._winMove({ clientX: 280, clientY: 280 }); P.nyq._winUp(); flush();
    assert.equal(S.settings.plotAuto, false);
    const held = { ...P.nyq.view };
    Y.state.setParam('C1', button === 0 ? 1e-12 : 1e-11); flush();
    assert.deepStrictEqual({ ...P.nyq.view }, held);
  }
  automatic(true);
});
test('missing or hidden model falls back to data, and masked points do not set limits', () => {
  Y.state.setSetting('contrib', false); choose('model');
  show('nyq'); P.nyq.hidden.add('fit'); P.nyq.autoscale(true);
  assert(P.nyq.view.y1 < 200);
  Y.state.setModel(null); flush(); assert(P.nyq.view.y1 < 200);
  choose('data'); ds.zr[0] = 1e20; ds.mask[0] = 1; Y.bus.emit('data'); flush();
  assert(P.nyq.view.x1 < 100);
});
test('initial data are framed even if Autoscale was disabled before loading', () => {
  automatic(false); Y.state.clearAll(); flush();
  Y.state.addDatasets([{ name: 'new', f: [1, 2], zr: [1e6, 2e6], zi: [-1e6, -2e6] }]); flush();
  assert(P.nyq.view.x1 > 2e6); assert.equal(P.nyq.auto, false);
});
test('settings persist and are validated, but startup always selects data', () => {
  choose('both'); automatic(false);
  const saved = JSON.parse(storage.get('yappari.settings'));
  assert.equal(saved.plotScale, 'both'); assert.equal(saved.plotAuto, false);
  const old = Y.state.cleanSettings({ nyqEqual: false });
  assert.equal(old.plotScale, 'data'); assert.equal(old.plotAuto, true);
  const invalid = Y.state.cleanSettings({ plotScale: 'other', plotAuto: 'false' });
  assert.equal(invalid.plotScale, 'data'); assert.equal(invalid.plotAuto, true);
  Y.state.restore();
  assert.equal(S.settings.plotScale, 'data'); assert.equal(S.settings.plotAuto, false);
});
console.log(checks + ' plot scaling checks passed.');
