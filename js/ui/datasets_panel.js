/*  Dataset list: click selects, Ctrl+click toggles, Shift+click selects a range, Ctrl+A all,
 *  arrows move, Delete removes, double-click or F2 renames, drag a row to reorder.
 *  The dot on the right shows the fit state (green fitted, amber iteration limit, red failed).
 */
Y.datasetsPanel = (function () {
  'use strict';
  var S = Y.state.S, esc = Y.ui.esc, list = null, dragId = null, cursor = null;
  function $(s) { return document.querySelector(s); }
  function fmt(v) { return (typeof v === 'number' && isFinite(v)) ? v.toExponential(3) : '—'; }

  function rowHTML(d) {
    var st = d.stats, on = S.sel.has(d.id);
    var cls = st ? (st.chi2w == null || st.ok === false ? 'bad' : (/iteration limit/.test(st.msg || '') ? 'warn' : 'ok')) : '';
    var tip = st ? (st.chi2w == null ? 'fit failed: ' + (st.msg || '') : 'χ²red ' + fmt(st.chi2red) + ', R² ' + (isFinite(st.r2) ? st.r2.toFixed(5) : '—')) : 'not fitted';
    return '<div class="ds' + (on ? ' on' : '') + '" data-id="' + d.id + '" draggable="true" role="option" aria-selected="' + on + '">' +
      '<i class="sw" style="background:' + Y.plots.color(d) + '"></i><span class="nm" title="' + esc(d.name) + ', ' + d.f.length + ' points">' + esc(d.name) + '</span>' +
      (d.norm ? '<small class="du" title="Normalized: ' + esc(Y.state.normText(d.norm)) + '">' + (d.norm.type === 'factor' ? '×' + (+d.norm.k.toPrecision(4)) : Y.state.zUnit(d)) + '</small>' : '') +
      '<span class="st ' + cls + '" title="' + esc(tip) + '"></span></div>';
  }
  function render() {
    if (!S.datasets.length) {
      list.innerHTML = '<div class="empty-list"><p>No datasets yet.</p><p>Use File, drop files on this window, or ' +
        '<button type="button" class="link" data-act="demo">load 24 demo spectra</button>.</p></div>';
    } else list.innerHTML = S.datasets.map(rowHTML).join('');
    count();
  }
  function count() { $('#ds-count').textContent = S.datasets.length ? S.sel.size + ' of ' + S.datasets.length + ' selected' : ''; }
  function updateSel() {
    var rows = list.children;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], id = +r.getAttribute('data-id');
      if (!id) continue;
      var on = S.sel.has(id);
      if (r.classList.contains('on') !== on) { r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); }
    }
    count();
  }
  function rowOf(id) { return list.querySelector('.ds[data-id="' + id + '"]'); }

  function rename(id) {
    var row = rowOf(id), d = Y.state.byId(id);
    if (!row || !d) return;
    var nm = row.querySelector('.nm'), inp = document.createElement('input'), done = false;
    inp.className = 'rename'; inp.value = d.name; inp.setAttribute('aria-label', 'New name');
    nm.replaceWith(inp); inp.focus(); inp.select();
    function end(save) {
      if (done) return;
      done = true;
      if (save && inp.value.trim() && inp.value.trim() !== d.name) Y.state.rename(id, inp.value.trim()); else render();
      list.focus();
    }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
    inp.addEventListener('blur', function () { end(true); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  function moveSel(dir, extend) {
    var arr = S.datasets;
    if (!arr.length) return;
    var i = arr.findIndex(function (d) { return d.id === (cursor != null ? cursor : S.anchor); });
    var j = Math.max(0, Math.min(arr.length - 1, i < 0 ? 0 : i + dir));
    cursor = arr[j].id;
    if (extend) Y.state.range(cursor); else Y.state.selectIds([cursor]);
    var r = rowOf(cursor);
    if (r) r.scrollIntoView({ block: 'nearest' });
  }

  function init() {
    list = $('#ds-list');
    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="demo"]')) { Y.cmd.demo(); return; }
      var row = e.target.closest('.ds');
      if (!row) return;
      var id = +row.getAttribute('data-id');
      cursor = id;
      if (e.shiftKey) Y.state.range(id);
      else if (e.ctrlKey || e.metaKey) Y.state.toggle(id);
      else Y.state.selectIds([id]);
    });
    list.addEventListener('dblclick', function (e) { var row = e.target.closest('.ds'); if (row) rename(+row.getAttribute('data-id')); });
    list.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); Y.state.selectAll(); }
      else if (e.key === 'Delete') { e.preventDefault(); Y.cmd.deleteDatasets(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey); }
      else if (e.key === 'F2') { e.preventDefault(); var f = Y.state.first(); if (f) rename(f.id); }
    });
    list.addEventListener('dragstart', function (e) {
      var row = e.target.closest('.ds');
      if (!row) return;
      dragId = +row.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-yappari-dataset', String(dragId));
    });
    list.addEventListener('dragover', function (e) {
      if (dragId == null) return;
      e.preventDefault();
      var row = e.target.closest('.ds');
      list.querySelectorAll('.drop').forEach(function (r) { if (r !== row) r.classList.remove('drop'); });
      if (row) row.classList.add('drop');
    });
    list.addEventListener('drop', function (e) {
      if (dragId == null) return;
      e.preventDefault(); e.stopPropagation();
      var row = e.target.closest('.ds');
      Y.state.move(dragId, row ? +row.getAttribute('data-id') : null);
      dragId = null;
    });
    list.addEventListener('dragend', function () {
      dragId = null;
      list.querySelectorAll('.drop').forEach(function (r) { r.classList.remove('drop'); });
    });
    Y.bus.on('datasets', render);
    Y.bus.on('selection', updateSel);
    Y.bus.on('stats', render);
    render();
  }

  return { init: init };
})();
