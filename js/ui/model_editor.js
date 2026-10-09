/*  Model tab: circuit code field, element palette, templates, schematic with selection, undo.
 *  Insert modes: in series with the selection, in parallel with it, or replacing it.
 *  Without a selection, new elements are added at the end of the circuit.
 */
Y.modelEditor = (function () {
  'use strict';
  var S = Y.state.S, selKey = null, mode = 's';
  var TEMPLATES = [
    ['R‖C', '(RC)'], ['Zarc, R‖Q', '(RQ)'], ['R and Q in series', 'RQ'],
    ['Randles: Rs + Q‖(Rct + W)', 'R(Q[RW])'], ['Randles with short Warburg', 'R(Q[RWs])'], ['Randles with open Warburg', 'R(Q[RWo])'],
    ['Two Zarcs', '(RQ)(RQ)'], ['Rs + two Zarcs', 'R(RQ)(RQ)'], ['Rs + three Zarcs', 'R(RQ)(RQ)(RQ)'],
    ['Q‖(R + R‖Q)', '(Q[R(RQ)])'], ['Leads: L + R', 'LR'], ['R‖L', '(RL)'], ['R‖W', '(RW)'], ['R + Gerischer', 'RG'],
    ['Three RC in series (Voigt)', '(RC)(RC)(RC)']
  ];
  function $(s) { return document.querySelector(s); }
  function keyToPath(k) { return k === '' ? [] : k.split('.').map(Number); }
  function nodeFromKey(k) {
    if (k == null || !S.model.tree) return null;
    var nd = S.model.tree, p = keyToPath(k);
    for (var i = 0; i < p.length; i++) { if (!nd.c || !nd.c[p[i]]) return null; nd = nd.c[p[i]]; }
    return nd;
  }
  function msg(text, kind) { var m = $('#cdc-msg'); m.textContent = text || ''; m.className = 'cdc-msg ' + (kind || ''); }
  function describe(nd) {
    return nd.t === 'e' ? nd.k + nd.n : (nd.t === 's' ? 'the series group ' : 'the parallel group ') + Y.circuit.toCDC(nd, true);
  }
  function hint() {
    var h = $('#model-hint'), nd = nodeFromKey(selKey);
    if (!S.model.tree) h.textContent = 'Pick an element to start, or type a code such as R(RQ)(Q[RW]) and press Enter.';
    else if (!nd) h.textContent = 'Click an element or a group in the drawing to choose where the next element goes. With nothing selected, new elements are added at the end.';
    else h.textContent = 'Selected ' + describe(nd) + '. The next element goes ' + { s: 'in series with it', p: 'in parallel with it', r: 'in its place' }[mode] + '.';
  }
  function draw() {
    if (!nodeFromKey(selKey)) selKey = null;
    Y.schematic.render($('#schematic'), S.model.tree, selKey, S.settings.contrib ? Y.theme.partVars() : null);
    hint();
    syncButtons();
  }
  // Delete, Undo and Clear only when they have something to act on
  function syncButtons() {
    var busy = S.busy ? 'Not while a fit is running.' : '';
    Y.ui.able($('#node-del'), busy || (selKey != null ? '' : 'Click an element or a group in the drawing first.'));
    Y.ui.able($('#node-undo'), busy || (Y.history.count() ? '' : 'Nothing to undo.'));
    Y.ui.able($('#node-clear'), busy || (S.model.tree ? '' : 'No circuit to clear.'));
  }
  function sync() {
    var inp = $('#cdc');
    if (document.activeElement !== inp) inp.value = S.model.cdc;
    var led = $('#cdc-led');
    led.className = 'led ' + (S.model.prog ? 'on' : 'off');
    led.title = S.model.prog ? 'Valid circuit, ' + S.model.prog.names.length + ' parameters' : 'No circuit';
    draw();
  }
  function guard() {
    if (S.busy) { Y.ui.toast('The circuit cannot change while a fit is running.', 'warn'); return false; }
    return true;
  }
  function commit(tree, focus) {
    Y.history.take('circuit edit');
    Y.state.setModel(tree);
    var p = focus ? Y.circuit.findPath(S.model.tree, focus) : null;
    selKey = p ? p.join('.') : null;
    sync();
    Y.ui.toast('Circuit ' + (S.model.cdc ? 'set to ' + S.model.cdc : 'cleared') + '.', 'info');
  }
  function applyCode() {
    if (!guard()) return;
    var inp = $('#cdc'), src = inp.value.trim();
    if (!src) { if (S.model.tree) commit(null, null); msg('', ''); return; }
    try {
      var tree = Y.circuit.parse(src);
      if (Y.circuit.toCDC(tree) === S.model.cdc) { msg('No change.', ''); inp.value = S.model.cdc; return; }
      commit(tree, null);
      inp.value = S.model.cdc;
      msg('Circuit set: ' + S.model.prog.names.length + ' parameters.', 'ok');
    } catch (e) {
      msg(e.message, 'err');
      if (e.pos >= 0) { inp.focus(); inp.setSelectionRange(e.pos, Math.min(src.length, e.pos + 1)); }
    }
  }
  function insert(sub) {
    if (!guard()) return;
    var tree = S.model.tree ? Y.circuit.clone(S.model.tree) : null, path = selKey != null ? keyToPath(selKey) : [];
    var focus = Y.circuit.elements(sub)[0], out;
    if (mode === 'r') {
      if (tree && selKey == null) { Y.ui.toast('Select the element or group to replace first.', 'warn'); return; }
      out = Y.circuit.replace(tree, path, sub);
    } else out = Y.circuit.insert(tree, path, sub, mode);
    commit(out, focus);
    msg('', '');
  }
  function del() {
    if (!guard()) return;
    if (selKey == null) { Y.ui.toast('Select an element or group in the drawing first.', 'warn'); return; }
    commit(Y.circuit.remove(Y.circuit.clone(S.model.tree), keyToPath(selKey)), null);
    msg('', '');
  }
  function undo() {
    if (!guard()) return;
    if (!Y.history.count()) { Y.ui.toast('Nothing to undo.', 'info'); return; }
    Y.history.undo();
    selKey = null; sync(); msg('Undone.', '');
  }
  function clear() {
    if (!guard() || !S.model.tree) return;
    commit(null, null);
    msg('Circuit cleared. Undo brings it back.', '');
  }

  function init() {
    $('#palette').innerHTML = Y.elementKinds.map(function (k) {
      var E = Y.elements[k];
      return '<button type="button" data-kind="' + k + '" title="' + E.title + ': ' + E.formula + '">' + Y.schematic.icon(k) + '<span>' + k + '</span></button>';
    }).join('');
    $('#palette').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (b) insert({ t: 'e', k: b.getAttribute('data-kind'), n: null });
    });
    var tp = $('#templates');
    tp.innerHTML = '<option value="">Insert a template…</option>' + TEMPLATES.map(function (t, i) {
      return '<option value="' + i + '">' + t[0] + ':  ' + t[1] + '</option>';
    }).join('');
    tp.addEventListener('change', function () {
      if (tp.value === '') return;
      var t = TEMPLATES[+tp.value];
      tp.value = '';
      insert(Y.circuit.parse(t[1], { number: false }));
    });
    var seg = document.querySelectorAll('#mode-seg [data-mode]');
    seg.forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        seg.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        hint();
      });
    });
    $('#cdc').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });
    $('#cdc-apply').addEventListener('click', applyCode);
    $('#node-del').addEventListener('click', del);
    $('#node-undo').addEventListener('click', undo);
    $('#node-clear').addEventListener('click', clear);
    var box = $('#schematic-box');
    box.addEventListener('click', function (e) {
      var t = e.target.closest('[data-path]');
      selKey = t ? t.getAttribute('data-path') : null;
      draw();
      box.focus({ preventScroll: true });
    });
    if (window.ResizeObserver) {
      var last = '';
      new ResizeObserver(function () {
        var k = box.clientWidth + 'x' + box.clientHeight;
        if (k !== last && box.clientWidth) { last = k; draw(); }
      }).observe(box);
    }
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
      else if (e.key === 'Escape') { selKey = null; draw(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });
    $('#eq-table').innerHTML = '<table class="grid eq"><thead><tr><th>Code</th><th>Element</th><th>Impedance</th><th>Parameters, for element number 1</th></tr></thead><tbody>' +
      Y.elementKinds.map(function (k) {
        var E = Y.elements[k];
        return '<tr><td><b>' + k + '</b></td><td>' + E.title + '</td><td class="f">' + E.formula + '</td><td>' +
          E.params.map(function (p) { return '<span class="pname">' + k + '1' + p.suffix + '</span> ' + p.label + (p.unit ? ' /' + p.unit : ''); }).join(', ') +
          '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="note">Equations as in Yappari 5.1 (help/theory.md). For large B, Wo and Ws tend to W with an Aw larger by √2, because W is written with √ω and Wo, Ws with √(jω).</p>';
    Y.bus.on('model', sync);
    Y.bus.on('history', syncButtons);
    Y.bus.on('settings', function (k) { if (k === 'contrib' || k === '*') draw(); });
    Y.bus.on('busy', function (b) { $('#pane-model').classList.toggle('locked', !!b); syncButtons(); });
    sync();
  }

  return { init: init, applyCode: applyCode };
})();
