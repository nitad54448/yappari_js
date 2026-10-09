/*  History of restore points. Before every command or action that changes datasets, the datasets (data, masks,
 *  standard deviations, labels, parameters, fit results), the selection and the circuit are kept. Restore points are
 *  incremental: the data arrays of a dataset (f, Zr, Zi, mask, σ) are copied only when their content differs from the
 *  newest restore point that holds that dataset; otherwise that copy is shared (counted once). Restore points stay
 *  in memory up to 256 MB (at most 200); the oldest are dropped first, and none is kept when the datasets alone take
 *  more. The Log shows a "Restore before" button on the line of each action whose restore point is still kept;
 *  "undo" goes back one step.
 */
Y.history = (function () {
  'use strict';
  var S = Y.state.S, MAX_BYTES = 256 * 1024 * 1024, MAX_POINTS = 200, MERGE_MS = 1500;
  var points = [], nextId = 1, pending = null, bytes = 0, warned = false;
  // DATA: the arrays shared between restore points. latest: dataset id -> its newest record still kept (the copy to
  // compare with). refs: array -> { n: restore points holding it, size }; bytes counts each array once.
  var DATA = ['f', 'zr', 'zi', 'mask', 'sr', 'si'], latest = new Map(), refs = new Map();

  function same(a, b) {                                  // same content (NaN equals NaN)
    if (!a || !b || a.length !== b.length || a.constructor !== b.constructor) return false;
    for (var i = 0; i < a.length; i++) { var x = a[i], y = b[i]; if (x !== y && (x === x || y === y)) return false; }
    return true;
  }
  function hold(a) {
    var e = refs.get(a);
    if (e) e.n++; else { refs.set(a, { n: 1, size: a.byteLength }); bytes += a.byteLength; }
    return a;
  }
  function release(a) { var e = refs.get(a); if (e && !--e.n) { refs.delete(a); bytes -= e.size; } }
  // a record never shares an array with the live dataset (that one can be changed in place); it shares the copy of the
  // newest kept record of the same dataset when the content is the same
  function record(d) {
    var prev = latest.get(d.id), r = { id: d.id, name: d.name, notes: (d.notes || []).slice(), norm: d.norm ? Object.assign({}, d.norm) : null,
      p: Object.assign({}, d.p), fit: Object.assign({}, d.fit), mem: d.mem ? Object.assign({}, d.mem) : null, stats: d.stats };
    DATA.forEach(function (k) {
      var a = d[k];
      r[k] = !a ? null : hold(prev && same(prev[k], a) ? prev[k] : a.constructor.from(a));
    });
    r.over = 400 + 80 * Object.keys(r.p).length + 8 * r.notes.length;
    bytes += r.over;
    return r;
  }
  function forget(r) {
    DATA.forEach(function (k) { if (r[k]) release(r[k]); });
    bytes -= r.over;
    if (latest.get(r.id) === r) latest.delete(r.id);
  }
  // what one restore point holds when it is the only one kept
  function fullSize(pt) {
    return pt.recs.reduce(function (a, r) { return a + r.over + DATA.reduce(function (b, k) { return b + (r[k] ? r[k].byteLength : 0); }, 0); }, 0);
  }
  function relink() {                                    // newest kept record of each dataset
    latest.clear();
    for (var i = points.length - 1; i >= 0; i--) points[i].recs.forEach(function (r) { if (!latest.has(r.id)) latest.set(r.id, r); });
  }
  function info() {
    Y.bus.emit('history');
    var el = document.getElementById('history-info');
    if (!el) return;
    el.textContent = points.length ?
      'Restore points: ' + points.length + ' kept in memory, ' + (bytes / 1048576).toFixed(1) + ' MB of at most 256 MB (data that did not change are ' +
      'kept once for all of them; the oldest are dropped first). ' +
      '“Restore before” brings back the datasets, the selection and the circuit as they were just before that action; undo goes back one step.' :
      'A restore point is kept before every action that changes datasets; the line of that action then gets a “Restore before” button.';
  }
  function drop(pt) {
    pt.recs.forEach(forget);
    var b = document.querySelector('#log-list [data-restore="' + pt.id + '"]');
    if (b) b.remove();
    if (pending === pt.id) pending = null;
  }
  // opts.settings: also keep the settings (for actions that replace them, such as opening a project).
  // opts.merge: a key for a burst of small edits (mouse wheel or arrow keys on one parameter). While the newest restore
  // point has the same key and is less than MERGE_MS old (counted from the last edit), no new one is taken, so the
  // burst is one step of undo and older restore points are not pushed out.
  function take(label, opts) {
    var last = points[points.length - 1], now = Date.now(), merge = (opts && opts.merge) || null;
    if (merge && last && last.merge === merge && now - last.at < MERGE_MS) { last.at = now; pending = null; return last.id; }
    var recs = S.datasets.map(record);
    var pt = { id: nextId++, label: label, time: new Date(), cdc: S.model.cdc, limits: JSON.parse(JSON.stringify(S.model.limits)),
               settings: opts && opts.settings ? JSON.parse(JSON.stringify(S.settings)) : null,
               shared: Object.assign({}, S.model.shared), recs: recs, sel: Array.from(S.sel), simCount: S.simCount, merge: merge, at: now };
    if (fullSize(pt) > MAX_BYTES) {                      // the datasets alone take more than the memory for restore points
      recs.forEach(forget); relink(); pending = null;
      if (!warned && Y.ui) { warned = true; Y.ui.log('No restore point is kept: the datasets take more than 256 MB. Save the project to keep a state.', 'warn'); }
      info();
      return null;
    }
    recs.forEach(function (r) { latest.set(r.id, r); });
    points.push(pt); pending = pt.id;
    while (points.length > 1 && (bytes > MAX_BYTES || points.length > MAX_POINTS)) drop(points.shift());
    info();
    return pt.id;
  }
  // id of the restore point taken for the action now being reported (used once, by Y.ui.toast)
  function takePending() { var p = pending; pending = null; return p; }

  function apply(pt) {
    if (pt.settings) Y.state.replaceSettings(JSON.parse(JSON.stringify(pt.settings)));
    if (pt.cdc !== S.model.cdc) Y.state.setModel(pt.cdc ? Y.circuit.parse(pt.cdc) : null, { limits: pt.limits, shared: pt.shared, quiet: true });
    else {
      S.model.limits = JSON.parse(JSON.stringify(pt.limits)); S.model.shared = Object.assign({}, pt.shared);
      Y.state.store('model', { cdc: S.model.cdc, limits: S.model.limits, shared: S.model.shared });
    }
    S.datasets = pt.recs.map(function (r) { return Y.state.fromRecord(r); });
    S.simCount = pt.simCount;
    Y.bus.emit('model'); Y.bus.emit('datasets');
    Y.state.selectIds(pt.sel.filter(function (id) { return !!Y.state.byId(id); }));
    Y.bus.emit('data'); Y.bus.emit('params', {}); Y.bus.emit('stats');
  }
  function when(pt) { return pt.time.toLocaleTimeString(); }

  // from the Log: the restore itself gets a restore point, so it can be undone too
  function restore(id) {
    var pt = points.filter(function (p) { return p.id === id; })[0];
    if (!pt) { Y.ui.toast('That restore point is no longer kept in memory.', 'warn'); return; }
    if (S.busy) { Y.ui.toast('A fit is running. Wait for it to finish or press Stop.', 'warn'); return; }
    take('restoring the state before ' + pt.label, { settings: !!pt.settings });
    apply(pt);
    if (points.indexOf(pt) >= 0) pt.recs.forEach(function (r) { latest.set(r.id, r); });   // the datasets are now those of pt
    Y.ui.toast('Restored the state before ' + pt.label + ', as it was at ' + when(pt) + '.', 'ok');
  }
  // one step back: the newest restore point is used and removed, so repeated undo goes further back
  function undo() {
    var pt = points.pop();
    if (!pt) { Y.ui.toast('Nothing to undo.', 'info'); return; }
    drop(pt);
    relink();
    apply(pt);
    info();
    Y.ui.toast('Undone: ' + pt.label + ' (back to ' + when(pt) + ').', 'ok');
  }

  function init() {
    document.getElementById('log-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-restore]');
      if (b) restore(+b.getAttribute('data-restore'));
    });
    info();
  }

  return { init: init, take: take, takePending: takePending, restore: restore, undo: undo, count: function () { return points.length; },
           bytes: function () { return bytes; },
           _testLimit: function (b) { var old = MAX_BYTES; MAX_BYTES = b; return old; } };   // for tests/run_review3_tests.js only
})();
