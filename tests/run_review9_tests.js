/* Run with: node tests/run_review9_tests.js. Regression checks of the 10 October 2026 review (item 4; items 2, 5, 6, 7 and 10 are in run_model_search_tests.js, 11 in browser_test.py). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f }); }
['core/namespace', 'io/writers'].forEach(load);
const Y = globalThis.Y;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

test('parameter file: the coefficient of determination is R^2, so R2 is only the parameter', () => {
  const ds = { name: 'a', p: { R1: 1, R2: 2 }, fit: { R1: true, R2: true }, stats: { r2: 0.99, chi2w: 1, chi2red: 1, se: { R1: 1, R2: 2 }, bound: {} } };
  const head = Y.writers.paramsText([ds], ['R1', 'R2'], { cdc: 'R1R2' }).split('\n')[2].split('\t');
  assert.deepEqual(head.slice(0, 4), ['Dataset', 'R^2', 'chi2_w', 'chi2_red']);
  assert.equal(head.filter(h => h === 'R2').length, 1);
});

console.log(checks + ' review 9 checks passed.');
