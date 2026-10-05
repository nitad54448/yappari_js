/*  Small UI toolkit: modal dialogs (prompt, confirm), drop-down menus, status messages and log,
 *  file picking, progress bar.
 */
Y.ui = (function () {
  'use strict';
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  // accepts 1,5 as well as 1.5
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(/\s+/g, '');
    if (/^[-+]?\d*,\d+([eE][-+]?\d+)?$/.test(s)) s = s.replace(',', '.');
    return s === '' ? NaN : Number(s);
  }

  // ---------------------------------------------------------------- modal
  // o: {title, body (html | Node), wide, buttons: [{label, value | fn(body), primary, danger, left, close:false, onClick(body) -> false keeps it open}]}
  // A dialog opened while another one is open replaces it; the one replaced resolves with null, as if cancelled,
  // so code waiting for it goes on.
  var closeOpen = null;
  function modal(o) {
    var dlg = $('#dlg');
    if (closeOpen) closeOpen(null);
    if (dlg.open) dlg.close();
    dlg.innerHTML = '';
    dlg.className = o.size === 'xl' ? 'xl' : (o.wide ? 'wide' : '');
    var box = h('div', { class: 'dlg' });
    box.appendChild(h('h2', { text: o.title || '' }));
    var body = h('div', { class: 'body' });
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    box.appendChild(body);
    var row = h('div', { class: 'btns' });
    box.appendChild(row);
    dlg.appendChild(box);
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; if (closeOpen === finish) closeOpen = null; dlg.close(); resolve(v); }
      closeOpen = finish;
      (o.buttons || [{ label: 'Close', value: null, primary: true }]).forEach(function (b) {
        var bt = h('button', { type: 'button', class: [b.primary ? 'primary' : '', b.danger ? 'danger' : '', b.left ? 'left' : ''].join(' ').trim(), text: b.label });
        bt.addEventListener('click', function () {
          if (b.onClick && b.onClick(body) === false) return;
          if (b.close === false) return;
          finish(typeof b.value === 'function' ? b.value(body) : (b.value === undefined ? null : b.value));
        });
        row.appendChild(bt);
      });
      dlg.oncancel = function (e) { e.preventDefault(); finish(null); };
      body.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          var prim = row.querySelector('.primary');
          if (prim) { e.preventDefault(); prim.click(); }
        }
      });
      dlg.showModal();
      var first = body.querySelector('input:not([type=checkbox]), select') || row.querySelector('.primary, .danger');
      if (first) { first.focus(); if (first.select) first.select(); }
      if (o.onOpen) o.onOpen(body);
    });
  }

  // fields: [{key, label, type: number|text|select|checkbox, value, options [[v, label]], hint}]
  function fieldHTML(f) {
    var id = 'f_' + f.key, v = f.value == null ? '' : f.value, ctl, w = f.when ? ' data-when="' + esc(f.when) + '"' : '';
    if (f.type === 'select') {
      ctl = '<select id="' + id + '" data-key="' + f.key + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'checkbox') {
      ctl = '<input type="checkbox" id="' + id + '" data-key="' + f.key + '"' + (v ? ' checked' : '') + '>';
    } else {
      ctl = '<input id="' + id + '" data-key="' + f.key + '" value="' + esc(v) + '"' + (f.type === 'number' ? ' inputmode="decimal"' : '') + ' autocomplete="off" spellcheck="false">';
    }
    return '<label for="' + id + '"' + w + '>' + esc(f.label) + '</label><div' + w + '>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
  }
  function collect(body, fields) {
    var out = {}, bad = false;
    fields.forEach(function (f) {
      var e = body.querySelector('[data-key="' + f.key + '"]');
      if (!e || e.closest('[hidden]')) return;
      if (f.type === 'checkbox') out[f.key] = e.checked;
      else if (f.type === 'number') {
        var v = parseNum(e.value);
        e.classList.toggle('invalid', !isFinite(v));
        if (!isFinite(v)) bad = true;
        out[f.key] = v;
      } else out[f.key] = e.value;
    });
    return bad ? null : out;
  }
  function showWhen(body) {
    body.querySelectorAll('[data-when]').forEach(function (el) {
      var w = el.getAttribute('data-when').split(':'), ctl = body.querySelector('[data-key="' + w[0] + '"]');
      el.hidden = !!ctl && w[1].split(',').indexOf(ctl.value) < 0;
    });
  }
  function prompt(title, fields, okLabel, intro) {
    var result = null;
    return modal({
      title: title,
      body: (intro ? '<p class="intro">' + intro + '</p>' : '') + '<div class="form-grid">' + fields.map(fieldHTML).join('') + '</div>',
      onOpen: function (body) { showWhen(body); body.addEventListener('change', function () { showWhen(body); }); },
      buttons: [{ label: 'Cancel', value: null },
                { label: okLabel || 'OK', primary: true, onClick: function (body) { result = collect(body, fields); return !!result; },
                  value: function () { return result; } }]
    });
  }
  function confirm(msg, okLabel, danger, title) {
    return modal({
      title: title || 'Please confirm', body: '<p>' + esc(msg) + '</p>',
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: !danger, danger: !!danger }]
    }).then(function (v) { return v === true; });
  }

  // ---------------------------------------------------------------- status line and log
  // snap: id of the restore point taken before the action this line reports (Restore button, js/history.js).
  // merge: key of a burst of small edits (see Y.history.take); with no new restore point, the newest line of the same
  // burst is updated in place instead of a new line being added
  function log(msg, kind, snap, merge) {
    var list = $('#log-list');
    if (!list) return;
    var top = list.firstChild;
    if (merge && !snap && top && top.getAttribute('data-merge') === merge) {
      top.querySelector('time').textContent = new Date().toLocaleTimeString();
      top.querySelector('span').textContent = msg;
      return;
    }
    var li = h('li', { class: kind || 'info' });
    if (merge) li.setAttribute('data-merge', merge);
    li.innerHTML = '<time>' + new Date().toLocaleTimeString() + '</time><span>' + esc(msg) + '</span>' +
      (snap ? '<button type="button" class="restore" data-restore="' + snap + '" title="Bring back the datasets, the selection and the circuit as they were just before this action">Restore before</button>' : '');
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 500) list.removeChild(list.lastChild);
  }
  function toast(msg, kind, merge) {
    var el = $('#status-msg');
    if (el) { el.textContent = msg; el.className = 'msg ' + (kind || 'info'); el.title = msg; }
    log(msg, kind, Y.history ? Y.history.takePending() : null, merge);
  }

  // ---------------------------------------------------------------- drop-down menus
  var openFor = null;
  function closeMenu() {
    var pop = $('#menu-pop');
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    if (openFor) openFor.setAttribute('aria-expanded', 'false');
    openFor = null;
  }
  // items: [{label, act, off}] or {sep: true}. off: why the item cannot run now. It is then greyed out with the reason
  // as tooltip, stays reachable with the arrow keys (aria-disabled, as in the WAI-ARIA menu pattern) and does nothing.
  function menu(anchor, items) {
    var pop = $('#menu-pop');
    if (openFor === anchor) { closeMenu(); return; }
    closeMenu();
    items.forEach(function (it) {
      if (it.sep) { pop.appendChild(h('hr')); return; }
      var b = h('button', { type: 'button', role: 'menuitem', text: it.label });
      if (it.off) { b.setAttribute('aria-disabled', 'true'); b.title = it.off; }
      b.addEventListener('click', function () { if (it.off) return; closeMenu(); it.act(); });
      pop.appendChild(b);
    });
    pop.hidden = false;
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 4) + 'px';
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - pw - 8, r.left))) + 'px';
    openFor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    var first = pop.querySelector('button:not([aria-disabled="true"])') || pop.querySelector('button');
    if (first) first.focus();
  }
  document.addEventListener('mousedown', function (e) {
    if (openFor && !e.target.closest('#menu-pop') && !openFor.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (!openFor) return;
    if (e.key === 'Escape') { var a = openFor; closeMenu(); a.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var bs = Array.prototype.slice.call($('#menu-pop').querySelectorAll('button'));
      var i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  });

  // a button that runs a command: enabled, or disabled with the reason as tooltip (its own tooltip comes back later)
  function able(el, reason) {
    if (!el) return;
    if (el.dataset.tip == null) el.dataset.tip = el.getAttribute('title') || '';
    el.disabled = !!reason;
    if (reason) el.title = reason; else if (el.dataset.tip) el.title = el.dataset.tip; else el.removeAttribute('title');
  }

  // ---------------------------------------------------------------- files
  function pickFiles(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = !!o.multiple; if (o.accept) inp.accept = o.accept;
      inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener('change', function () { var f = Array.prototype.slice.call(inp.files || []); inp.remove(); resolve(f); });
      inp.addEventListener('cancel', function () { inp.remove(); resolve([]); });
      inp.click();
    });
  }
  function readText(file) {
    if (file.text) return file.text();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); });
  }

  // ---------------------------------------------------------------- progress (total < 0: indeterminate)
  function progress(done, total) {
    var p = $('#fit-progress');
    if (!p) return;
    var bar = p.querySelector('i'), lab = p.querySelector('span');
    p.hidden = !total;                       // shown only while something runs
    p.classList.toggle('indet', total < 0);
    bar.style.width = total > 0 ? (100 * done / total).toFixed(1) + '%' : (total < 0 ? '' : '0');
    lab.textContent = total > 0 ? done + ' / ' + total : (total < 0 ? 'working' : '');
  }

  return { modal: modal, prompt: prompt, confirm: confirm, fieldHTML: fieldHTML, collect: collect, toast: toast, log: log,
           menu: menu, closeMenu: closeMenu, able: able, pickFiles: pickFiles, readText: readText, progress: progress,
           esc: esc, h: h, parseNum: parseNum };
})();
