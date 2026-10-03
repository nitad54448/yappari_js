/*  History of restore points. Before every command or action that changes datasets, the datasets (data, masks,
 *  standard deviations, labels, parameters, fit results), the selection and the circuit are copied. Restore
 *  points stay in memory up to 256 MB (at most 200); the oldest are dropped first. The Log shows a
 *  "Restore before" button on the line of each action whose restore point is still kept; "undo" goes back one step.
 */
Y.history = (function () {
  'use strict';
  var S = Y.state.S, MAX_BYTES = 256 * 1024 * 1024, MAX_POINTS = 200;
  var points = [], nextId = 1, pending = null, bytes = 0;

  function record(d) {
    var r = { id: d.id, name: d.name, f: Float64Array.from(d.f), zr: Float64Array.from(d.zr), zi: Float64Array.from(d.zi), mask: Uint8Array.from(d.mask),
              sr: d.sr ? Float64Array.from(d.sr) : null, si: d.si ? Float64Array.from(d.si) : null, notes: (d.notes || []).slice(), norm: d.norm ? Object.assign({}, d.norm) : null,
              p: Object.assign({}, d.p), fit: Object.assign({}, d.fit), mem: d.mem ? Object.assign({}, d.mem) : null, stats: d.stats };
    r.bytes = 3 * r.f.byteLength + r.mask.byteLength + (r.sr ? 2 * r.sr.byteLength : 0) + 400 + 80 * Object.keys(r.p).length;
    return r;
  }
  function info() {
    var el = document.getElementById('history-info');
    if (!el) return;
    el.textContent = points.length ?
      'Restore points: ' + points.length + ' kept in memory, ' + (bytes / 1048576).toFixed(1) + ' MB of at most 256 MB (the oldest are dropped first). ' +
      '“Restore before” brings back the datasets, the selection and the circuit as they were just before that action; undo goes back one step.' :
      'A restore point is kept before every action that changes datasets; the line of that action then gets a “Restore before” button.';
  }
  function drop(pt) {
    bytes -= pt.bytes;
    var b = document.querySelector('#log-list [data-restore="' + pt.id + '"]');
    if (b) b.remove();
    if (pending === pt.id) pending = null;
  }
  function take(label) {
    var recs = S.datasets.map(record);
    var pt = { id: nextId++, label: label, time: new Date(), cdc: S.model.cdc, limits: JSON.parse(JSON.stringify(S.model.limits)),
               shared: Object.assign({}, S.model.shared), recs: recs, sel: Array.from(S.sel), simCount: S.simCount,
               bytes: recs.reduce(function (a, r) { return a + r.bytes; }, 0) };
    points.push(pt); bytes += pt.bytes; pending = pt.id;
    while (points.length > 1 && (bytes > MAX_BYTES || points.length > MAX_POINTS)) drop(points.shift());
    info();
    return pt.id;
  }
  // id of the restore point taken for the action now being reported (used once, by Y.ui.toast)
  function takePending() { var p = pending; pending = null; return p; }

  function apply(pt) {
    if (pt.cdc !== S.model.cdc) Y.state.setModel(pt.cdc ? Y.circuit.parse(pt.cdc) : null, { limits: pt.limits, shared: pt.shared, quiet: true });
    else { S.model.limits = JSON.parse(JSON.stringify(pt.limits)); S.model.shared = Object.assign({}, pt.shared); }
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
    take('restoring the state before ' + pt.label);
    apply(pt);
    Y.ui.toast('Restored the state before ' + pt.label + ', as it was at ' + when(pt) + '.', 'ok');
  }
  // one step back: the newest restore point is used and removed, so repeated undo goes further back
  function undo() {
    var pt = points.pop();
    if (!pt) { Y.ui.toast('Nothing to undo.', 'info'); return; }
    drop(pt);
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

  return { init: init, take: take, takePending: takePending, restore: restore, undo: undo, count: function () { return points.length; } };
})();
