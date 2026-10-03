/*  Plot2D - canvas plot for impedance data.
 *  new Y.Plot2D(hostElement | null, opts)   (null host = offscreen, give opts.width / opts.height)
 *  opts: xlog, ylog, equal (same scale on both axes), xlabel, ylabel, legend, tooltip(series, i) -> html,
 *        onView(view) called after the user changes the view, onInteract()
 *  series: { name, group, x, y (arrays, data units), color, mode 'markers'|'lines', size, width,
 *            legend (show entry), hover (tooltip on its points) }
 *  The view is stored in axis units (log10 for log axes).
 *  Mouse: drag = zoom box (thin box = one axis), shift-drag or right-drag = pan, wheel = zoom,
 *         double-click = autoscale, click on a legend entry = hide/show that dataset.
 */
Y.Plot2D = (function () {
  'use strict';
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sup(n) { return String(n).split('').map(function (c) { return SUP[c] || c; }).join(''); }

  function theme() {
    var cs = getComputedStyle(document.documentElement), g = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    return { bg: g('--plot-bg', '#fff'), grid: g('--plot-grid', '#e6eaed'), minor: g('--plot-minor', '#f1f3f5'),
             axis: g('--plot-axis', '#9aa5b1'), ink: g('--ink', '#1f2933'), ink2: g('--ink-2', '#52606d'),
             font: g('--font-ui', 'system-ui, sans-serif'), sel: g('--amber', '#f2b231') };
  }

  function niceStep(span, target) {
    var raw = span / Math.max(target, 1), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }

  // linear ticks with a shared power of ten for very large / small numbers
  function linTicks(v0, v1, target) {
    var step = niceStep(v1 - v0, target), t = [], s = Math.ceil(v0 / step) * step;
    for (var v = s; v <= v1 + step * 1e-9; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    var big = Math.max(Math.abs(v0), Math.abs(v1)), e = big > 0 ? Math.floor(Math.log10(big)) : 0, exp = 0;
    if (e >= 4 || e <= -3) exp = e;
    var sc = Math.pow(10, exp), dec = Math.max(0, Math.min(8, -Math.floor(Math.log10(step / sc) + 1e-9)));
    return { ticks: t, labels: t.map(function (v) { return (v / sc).toFixed(dec); }), exp: exp, minor: [] };
  }

  function logTicks(v0, v1, target) {
    var d0 = Math.ceil(v0 - 1e-9), d1 = Math.floor(v1 + 1e-9), span = v1 - v0, t = [], labels = [], minor = [];
    var stride = Math.max(1, Math.ceil((d1 - d0 + 1) / Math.max(target, 2)));
    for (var d = d0; d <= d1; d++) if ((d - d0) % stride === 0) { t.push(d); labels.push('10' + sup(d)); }
    if (span <= 8) for (var dd = Math.floor(v0); dd <= Math.ceil(v1); dd++) for (var k = 2; k <= 9; k++) {
      var v = dd + Math.log10(k);
      if (v > v0 && v < v1) minor.push(v);
    }
    if (t.length < 2 && span < 1.2) return linLabelsOnLog(v0, v1, target);
    return { ticks: t, labels: labels, exp: 0, minor: minor };
  }
  // narrow log range: plain numbers placed on the log axis
  function linLabelsOnLog(v0, v1, target) {
    var a = Math.pow(10, v0), b = Math.pow(10, v1), lt = linTicks(a, b, target), ticks = [], labels = [];
    lt.ticks.forEach(function (v, i) { if (v > 0) { ticks.push(Math.log10(v)); labels.push(lt.labels[i]); } });
    return { ticks: ticks, labels: labels, exp: lt.exp, minor: [] };
  }

  function Plot2D(host, opts) {
    this.o = Object.assign({ xlog: false, ylog: false, equal: false, xlabel: '', ylabel: '', legend: true, legendMax: 24,
                             tooltip: null, onView: null, onInteract: null, empty: '' }, opts || {});
    this.host = host; this.series = []; this.view = null; this.auto = true; this.hidden = new Set();
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.legendHits = []; this.drag = null;
    if (host) {
      this.canvas.className = 'plot-canvas';
      host.appendChild(this.canvas);
      this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.tip.hidden = true;
      host.appendChild(this.tip);
      this._bind();
      var self = this;
      if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self.resize(); }); this.ro.observe(host); }
    }
    this.resize();
  }
  var P = Plot2D.prototype;

  P.resize = function () {
    var w = this.host ? this.host.clientWidth : this.o.width, h = this.host ? this.host.clientHeight : this.o.height;
    if (!w || !h) return;
    var dpr = this.host ? (window.devicePixelRatio || 1) : (this.o.scale || 1);
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    if (this.host) { this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
    var m = this.o.margin || { l: 64, r: 14, t: 12, b: this.o.xlabel ? 40 : 24 };
    this.box = { x0: m.l, x1: w - m.r, y0: m.t, y1: h - m.b };
    if (this.view && this.auto) { this.autoscale(true); return; }
    if (this.view && this.o.equal) this._equalize('center');
    this.draw();
  };

  P.setOptions = function (o) { Object.assign(this.o, o); this.resize(); };
  P.setSeries = function (list, keep) {
    this.series = list || [];
    if (!keep || this.auto || !this.view) this.autoscale(true); else this.draw();
  };

  P.tx = function (v) { return this.o.xlog ? (v > 0 ? Math.log10(v) : NaN) : v; };
  P.ty = function (v) { return this.o.ylog ? (v > 0 ? Math.log10(v) : NaN) : v; };
  P.px = function (a) { var b = this.box, v = this.view; return b.x0 + (a - v.x0) / (v.x1 - v.x0) * (b.x1 - b.x0); };
  P.py = function (a) { var b = this.box, v = this.view; return b.y1 - (a - v.y0) / (v.y1 - v.y0) * (b.y1 - b.y0); };
  P.ix = function (p) { var b = this.box, v = this.view; return v.x0 + (p - b.x0) / (b.x1 - b.x0) * (v.x1 - v.x0); };
  P.iy = function (p) { var b = this.box, v = this.view; return v.y0 + (b.y1 - p) / (b.y1 - b.y0) * (v.y1 - v.y0); };

  P.visibleSeries = function () { var h = this.hidden; return this.series.filter(function (s) { return !h.has(s.group); }); };

  P.autoscale = function (silent) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, self = this;
    this.visibleSeries().forEach(function (s) {
      if (s.noAuto) return;
      for (var i = 0; i < s.x.length; i++) {
        var a = self.tx(s.x[i]), b = self.ty(s.y[i]);
        if (!isFinite(a) || !isFinite(b)) continue;
        if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
      }
    });
    if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    var pad = function (a, b, log) {
      if (a === b) { var d = log ? 0.5 : (Math.abs(a) * 0.1 || 1); return [a - d, b + d]; }
      var p = (b - a) * 0.04; return [a - p, b + p];
    };
    var X = pad(x0, x1, this.o.xlog), Yr = pad(y0, y1, this.o.ylog);
    this.view = { x0: X[0], x1: X[1], y0: Yr[0], y1: Yr[1] };
    this.auto = true;
    if (this.o.equal) this._equalize('low');
    this.draw();
    if (!silent && this.o.onView) this.o.onView(this.view);
  };

  // same data units per pixel on both axes; 'low' keeps the lower-left corner, 'center' the centre
  P._equalize = function (anchor) {
    if (!this.box || this.o.xlog || this.o.ylog) return;
    var b = this.box, v = this.view, pw = b.x1 - b.x0, ph = b.y1 - b.y0;
    if (pw <= 0 || ph <= 0) return;
    var sx = (v.x1 - v.x0) / pw, sy = (v.y1 - v.y0) / ph, s = Math.max(sx, sy);
    var w = s * pw, h = s * ph;
    if (anchor === 'center') {
      var cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
      this.view = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
    } else this.view = { x0: v.x0, x1: v.x0 + w, y0: v.y0, y1: v.y0 + h };
  };

  P.setXView = function (x0, x1) {
    if (!this.view) return;
    this.view.x0 = x0; this.view.x1 = x1; this.auto = false;
    var self = this, y0 = Infinity, y1 = -Infinity;
    this.visibleSeries().forEach(function (s) {            // fit y to the visible x range
      if (s.noAuto) return;
      for (var i = 0; i < s.x.length; i++) {
        var a = self.tx(s.x[i]), bb = self.ty(s.y[i]);
        if (a >= x0 && a <= x1 && isFinite(bb)) { if (bb < y0) y0 = bb; if (bb > y1) y1 = bb; }
      }
    });
    if (isFinite(y0)) { var p = (y1 - y0) * 0.06 || Math.abs(y0) * 0.1 || 1; this.view.y0 = y0 - p; this.view.y1 = y1 + p; }
    this.draw();
  };

  // current view in data units
  P.dataView = function () {
    var v = this.view, fx = this.o.xlog ? function (a) { return Math.pow(10, a); } : function (a) { return a; };
    var fy = this.o.ylog ? function (a) { return Math.pow(10, a); } : function (a) { return a; };
    return { x0: fx(v.x0), x1: fx(v.x1), y0: fy(v.y0), y1: fy(v.y1) };
  };

  // ---------------------------------------------------------------- drawing
  P.draw = function () {
    if (!this.W || !this.view) return;
    var c = this.ctx, T = theme(), b = this.box, self = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = T.bg; c.fillRect(0, 0, this.W, this.H);
    c.font = '11px ' + T.font; c.lineWidth = 1;

    var xt = this.o.xlog ? logTicks(this.view.x0, this.view.x1, Math.max(2, (b.x1 - b.x0) / 70)) : linTicks(this.view.x0, this.view.x1, Math.max(2, (b.x1 - b.x0) / 80));
    var yt = this.o.ylog ? logTicks(this.view.y0, this.view.y1, Math.max(2, (b.y1 - b.y0) / 40)) : linTicks(this.view.y0, this.view.y1, Math.max(2, (b.y1 - b.y0) / 45));
    // grid
    c.strokeStyle = T.minor; c.beginPath();
    xt.minor.forEach(function (v) { var p = Math.round(self.px(v)) + 0.5; c.moveTo(p, b.y0); c.lineTo(p, b.y1); });
    yt.minor.forEach(function (v) { var p = Math.round(self.py(v)) + 0.5; c.moveTo(b.x0, p); c.lineTo(b.x1, p); });
    c.stroke();
    c.strokeStyle = T.grid; c.beginPath();
    xt.ticks.forEach(function (v) { var p = Math.round(self.px(v)) + 0.5; if (p >= b.x0 && p <= b.x1) { c.moveTo(p, b.y0); c.lineTo(p, b.y1); } });
    yt.ticks.forEach(function (v) { var p = Math.round(self.py(v)) + 0.5; if (p >= b.y0 && p <= b.y1) { c.moveTo(b.x0, p); c.lineTo(b.x1, p); } });
    c.stroke();
    // zero line on linear axes
    c.strokeStyle = T.axis;
    if (!this.o.ylog && this.view.y0 < 0 && this.view.y1 > 0) { var zy = Math.round(this.py(0)) + 0.5; c.beginPath(); c.moveTo(b.x0, zy); c.lineTo(b.x1, zy); c.stroke(); }
    c.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
    // tick labels
    c.fillStyle = T.ink2; c.textAlign = 'center'; c.textBaseline = 'top';
    xt.ticks.forEach(function (v, i) { var p = self.px(v); if (p >= b.x0 - 1 && p <= b.x1 + 1) c.fillText(xt.labels[i], p, b.y1 + 5); });
    c.textAlign = 'right'; c.textBaseline = 'middle';
    yt.ticks.forEach(function (v, i) { var p = self.py(v); if (p >= b.y0 - 1 && p <= b.y1 + 1) c.fillText(yt.labels[i], b.x0 - 6, p); });
    if (xt.exp) { c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('×10' + sup(xt.exp), b.x1, b.y1 + 19); }
    if (yt.exp) { c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('×10' + sup(yt.exp), b.x0 + 2, b.y0 - 1 > 10 ? b.y0 - 1 : b.y0 + 12); }
    // axis titles
    c.fillStyle = T.ink; c.font = '12px ' + T.font;
    if (this.o.xlabel) { c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(this.o.xlabel, (b.x0 + b.x1) / 2, this.H - 4); }
    if (this.o.ylabel) {
      c.save(); c.translate(13, (b.y0 + b.y1) / 2); c.rotate(-Math.PI / 2);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(this.o.ylabel, 0, 0); c.restore();
    }
    // data
    c.save(); c.beginPath(); c.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); c.clip();
    var vis = this.visibleSeries();
    vis.forEach(function (s) { if (s.mode === 'area') self._area(c, s); });
    vis.forEach(function (s) { if (s.mode === 'lines') self._line(c, s); });
    vis.forEach(function (s) { if (s.mode !== 'lines' && s.mode !== 'area') self._markers(c, s); });
    c.restore();
    this._notes(c, T);
    if (this.hoverPt) {
      c.strokeStyle = T.ink; c.lineWidth = 1.5;
      c.strokeRect(this.hoverPt[0] - 4.5, this.hoverPt[1] - 4.5, 9, 9);
    }
    if (!this.series.length && this.o.empty) {
      c.fillStyle = T.ink2; c.font = '13px ' + T.font; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.o.empty, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    }
    this._legend(c, T);
    if (this.drag && this.drag.mode === 'zoom' && this.drag.moved) {
      var d = this.drag;
      c.fillStyle = 'rgba(36,87,166,0.08)'; c.strokeStyle = 'rgba(36,87,166,0.8)'; c.lineWidth = 1;
      var rx = Math.min(d.x, d.cx), ry = Math.min(d.y, d.cy), rw = Math.abs(d.cx - d.x), rh = Math.abs(d.cy - d.y);
      if (rh < 5) { ry = b.y0; rh = b.y1 - b.y0; } else if (rw < 5) { rx = b.x0; rw = b.x1 - b.x0; }
      c.fillRect(rx, ry, rw, rh); c.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    }
  };

  P._legend = function (c, T) {
    this.legendHits = [];
    if (!this.o.legend) return;
    var groups = [], seen = {}, self = this;
    this.series.forEach(function (s) {
      if (!s.legend || seen[s.group]) return;
      seen[s.group] = true;
      groups.push({ group: s.group, name: s.name, color: s.color, dash: s.dash, marker: s.mode !== 'lines' && s.mode !== 'area' });
    });
    if (!groups.length) return;
    var max = this.o.legendMax, more = groups.length - max;
    if (more > 0) groups = groups.slice(0, max);
    c.font = '11px ' + T.font;
    var wMax = 0;
    groups.forEach(function (g) { wMax = Math.max(wMax, c.measureText(g.name).width); });
    var lh = 15, w = Math.min(wMax + 30, 220), h = groups.length * lh + 8 + (more > 0 ? lh : 0);
    var x = this.box.x1 - w - 6, y = this.box.y0 + 6;
    if (h > this.box.y1 - this.box.y0 - 12) return;          // no room
    c.globalAlpha = 0.9; c.fillStyle = T.bg; c.fillRect(x, y, w, h); c.globalAlpha = 1;
    c.strokeStyle = T.grid; c.strokeRect(x + 0.5, y + 0.5, w, h);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    groups.forEach(function (g, i) {
      var yy = y + 4 + i * lh + lh / 2, off = self.hidden.has(g.group);
      c.globalAlpha = off ? 0.35 : 1;
      c.strokeStyle = g.color; c.lineWidth = 1.5; c.setLineDash(g.dash || []); c.beginPath(); c.moveTo(x + 6, yy); c.lineTo(x + 20, yy); c.stroke(); c.setLineDash([]);
      if (g.marker) { c.fillStyle = g.color; c.fillRect(x + 11.5, yy - 1.75, 3.5, 3.5); }
      c.fillStyle = T.ink;
      var name = g.name;
      while (c.measureText(name).width > w - 30 && name.length > 4) name = name.slice(0, -2);
      c.fillText(name === g.name ? name : name + '…', x + 25, yy);
      c.globalAlpha = 1;
      self.legendHits.push({ x0: x, x1: x + w, y0: yy - lh / 2, y1: yy + lh / 2, group: g.group });
    });
    if (more > 0) { c.fillStyle = T.ink2; c.fillText('+' + more + ' more', x + 25, y + 4 + groups.length * lh + lh / 2); }
  };

  // ---------------------------------------------------------------- interaction
  P._bind = function () {
    var self = this, cv = this.canvas;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function inBox(p) { var b = self.box; return p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1; }
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) {
      var p = pos(e);
      if (!self.view || !inBox(p)) return;
      if (self.o.onInteract) self.o.onInteract();
      var pan = e.button === 2 || e.shiftKey;
      self.drag = { mode: pan ? 'pan' : 'zoom', x: p[0], y: p[1], cx: p[0], cy: p[1], v: Object.assign({}, self.view), moved: false };
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      var d = self.drag;
      if (!d) return;
      var p = pos(e);
      d.cx = Math.max(self.box.x0, Math.min(self.box.x1, p[0])); d.cy = Math.max(self.box.y0, Math.min(self.box.y1, p[1]));
      if (Math.abs(p[0] - d.x) + Math.abs(p[1] - d.y) > 3) d.moved = true;
      if (d.mode === 'pan' && d.moved) {
        var b = self.box, v = d.v, dx = (p[0] - d.x) / (b.x1 - b.x0) * (v.x1 - v.x0), dy = (p[1] - d.y) / (b.y1 - b.y0) * (v.y1 - v.y0);
        self.view = { x0: v.x0 - dx, x1: v.x1 - dx, y0: v.y0 + dy, y1: v.y1 + dy };
        self.auto = false;
      }
      self.draw();
    });
    window.addEventListener('mouseup', function () {
      var d = self.drag;
      if (!d) return;
      self.drag = null;
      if (d.mode === 'zoom' && d.moved) {
        var w = Math.abs(d.cx - d.x), h = Math.abs(d.cy - d.y), v = self.view;
        var X0 = self.ix(Math.min(d.x, d.cx)), X1 = self.ix(Math.max(d.x, d.cx)), Y0 = self.iy(Math.max(d.y, d.cy)), Y1 = self.iy(Math.min(d.y, d.cy));
        if (w >= 5 && h >= 5) self.view = { x0: X0, x1: X1, y0: Y0, y1: Y1 };
        else if (w >= 5) self.view = { x0: X0, x1: X1, y0: v.y0, y1: v.y1 };
        else if (h >= 5) self.view = { x0: v.x0, x1: v.x1, y0: Y0, y1: Y1 };
        self.auto = false;
        if (self.o.equal) self._equalize('center');
        self.draw();
        if (self.o.onView) self.o.onView(self.view);
      } else if (d.mode === 'pan' && d.moved) {
        if (self.o.onView) self.o.onView(self.view);
      } else {
        var hit = self.legendHits.filter(function (h2) { return d.x >= h2.x0 && d.x <= h2.x1 && d.y >= h2.y0 && d.y <= h2.y1; })[0];
        if (hit) { if (self.hidden.has(hit.group)) self.hidden.delete(hit.group); else self.hidden.add(hit.group); self.draw(); }
        else if (self.o.onPointClick && (!self.o.pointClickActive || self.o.pointClickActive())) {
          var nb = self._nearest([d.x, d.y], 144);
          if (nb) self.o.onPointClick(nb.s, nb.i);
        } else if (self.o.onClick) { var dv = self.dataAt(d.x, d.y); self.o.onClick(dv[0], dv[1]); }
      }
    });
    cv.addEventListener('dblclick', function () { self.hidden.clear(); self.autoscale(); });
    cv.addEventListener('wheel', function (e) {
      if (!self.view) return;
      var p = pos(e);
      if (!inBox(p)) return;
      e.preventDefault();
      var k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))), ax = self.ix(p[0]), ay = self.iy(p[1]), v = self.view;
      self.view = { x0: ax + (v.x0 - ax) * k, x1: ax + (v.x1 - ax) * k, y0: ay + (v.y0 - ay) * k, y1: ay + (v.y1 - ay) * k };
      self.auto = false; self.draw();
      clearTimeout(self._wt);
      self._wt = setTimeout(function () { if (self.o.onView) self.o.onView(self.view); }, 120);
    }, { passive: false });
    cv.addEventListener('mousemove', function (e) {
      if (self.drag || !self.o.tooltip) return;
      var p = pos(e);
      if (self._raf) return;
      self._raf = requestAnimationFrame(function () { self._raf = 0; self._hover(p); });
    });
    cv.addEventListener('mouseleave', function () { self.tip.hidden = true; if (self.hoverPt) { self.hoverPt = null; self.draw(); } });
  };

  P._hover = function (p) {
    var best = this._nearest(p, 100);
    if (!best) { this.tip.hidden = true; if (this.hoverPt) { this.hoverPt = null; this.draw(); } return; }
    this.hoverPt = [best.X, best.Yp];
    this.draw();
    this.tip.innerHTML = this.o.tooltip(best.s, best.i);
    this.tip.hidden = false;
    var tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    var x = best.X + 12, y = best.Yp + 12;
    if (x + tw > this.W) x = best.X - tw - 12;
    if (y + th > this.H) y = best.Yp - th - 12;
    this.tip.style.left = Math.max(0, x) + 'px'; this.tip.style.top = Math.max(0, y) + 'px';
  };

  P._xy = function (s, i) {
    var a = this.tx(s.x[i]), b = this.ty(s.y[i]);
    return (isFinite(a) && isFinite(b)) ? [this.px(a), this.py(b)] : null;
  };
  P._area = function (c, s) {
    var y0 = this.ty(0), base = isFinite(y0) ? this.py(Math.max(this.view.y0, Math.min(this.view.y1, y0))) : this.box.y1, pts = [], i;
    for (i = 0; i < s.x.length; i++) { var p = this._xy(s, i); if (p) pts.push(p); }
    if (!pts.length) return;
    c.beginPath(); c.moveTo(pts[0][0], base);
    pts.forEach(function (q) { c.lineTo(q[0], q[1]); });
    c.lineTo(pts[pts.length - 1][0], base); c.closePath();
    c.globalAlpha = 0.3; c.fillStyle = s.color; c.fill(); c.globalAlpha = 1;
    c.beginPath();
    pts.forEach(function (q, k) { if (k) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
    c.strokeStyle = s.color; c.lineWidth = s.width || 1.4; c.stroke();
  };
  P._line = function (c, s) {
    var prev = null, pen = false, i, p;
    c.lineWidth = s.width || 1.5; c.setLineDash(s.dash || []);
    if (s.colors) {                                          // one colour per segment (contributions)
      for (i = 0; i < s.x.length; i++) {
        p = this._xy(s, i);
        if (!p) { prev = null; continue; }
        if (prev) { c.strokeStyle = s.colors[i]; c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); c.stroke(); }
        prev = p;
      }
    } else {
      c.strokeStyle = s.color; c.beginPath();
      for (i = 0; i < s.x.length; i++) {
        p = this._xy(s, i);
        if (!p) { pen = false; continue; }
        if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; }
      }
      c.stroke();
    }
    c.setLineDash([]);
  };
  P._markers = function (c, s) {
    var sz = s.size || 3.2, h = sz / 2, i, p;
    if (s.ex || s.ey) {                                      // error bars: plus or minus one standard deviation
      c.strokeStyle = s.color; c.lineWidth = 1; c.globalAlpha = 0.5; c.beginPath();
      for (i = 0; i < s.x.length; i++) {
        p = this._xy(s, i);
        if (!p) continue;
        var ey = s.ey ? s.ey[i] : 0, ex = s.ex ? s.ex[i] : 0, a1, a2;
        if (ey > 0) { a1 = this.ty(s.y[i] - ey); a2 = this.ty(s.y[i] + ey); if (isFinite(a1) && isFinite(a2)) { c.moveTo(p[0], this.py(a1)); c.lineTo(p[0], this.py(a2)); } }
        if (ex > 0) { a1 = this.tx(s.x[i] - ex); a2 = this.tx(s.x[i] + ex); if (isFinite(a1) && isFinite(a2)) { c.moveTo(this.px(a1), p[1]); c.lineTo(this.px(a2), p[1]); } }
      }
      c.stroke(); c.globalAlpha = 1;
    }
    if (s.hollow) {                                          // masked points: hollow and pale
      c.strokeStyle = s.color; c.lineWidth = 1; c.globalAlpha = s.alpha || 1;
      for (i = 0; i < s.x.length; i++) { p = this._xy(s, i); if (p) c.strokeRect(p[0] - h - 0.5, p[1] - h - 0.5, sz + 1, sz + 1); }
      c.globalAlpha = 1;
      return;
    }
    c.fillStyle = s.color;
    for (i = 0; i < s.x.length; i++) { p = this._xy(s, i); if (p) c.fillRect(p[0] - h, p[1] - h, sz, sz); }
  };
  // labels attached to data points (frequency labels on Nyquist plots): {x, y, text, color}
  P._notes = function (c, T) {
    if (!this.notes || !this.notes.length) return;
    var b = this.box, self = this;
    c.font = '11px ' + T.font; c.textBaseline = 'bottom'; c.textAlign = 'left'; c.lineJoin = 'round';
    this.notes.forEach(function (nt) {
      var a = self.tx(nt.x), bb = self.ty(nt.y);
      if (!isFinite(a) || !isFinite(bb)) return;
      var X = self.px(a), Yp = self.py(bb);
      if (X < b.x0 || X > b.x1 || Yp < b.y0 || Yp > b.y1) return;
      c.fillStyle = nt.color; c.beginPath(); c.arc(X, Yp, 3.2, 0, 2 * Math.PI); c.fill();
      var tw = c.measureText(nt.text).width, tx = X + 7 + tw > b.x1 ? X - 7 - tw : X + 7, ty = Yp - 17 < b.y0 ? Yp + 17 : Yp - 5;
      c.lineWidth = 3; c.strokeStyle = T.bg; c.strokeText(nt.text, tx, ty);
      c.fillStyle = nt.color; c.fillText(nt.text, tx, ty);
    });
  };
  P._nearest = function (p, maxD2) {
    var best = null, bd = maxD2, self = this;
    if (!this.view) return null;
    this.visibleSeries().forEach(function (s) {
      if (!s.hover) return;
      for (var i = 0; i < s.x.length; i++) {
        var q = self._xy(s, i);
        if (!q) continue;
        var dx = q[0] - p[0], dy = q[1] - p[1], d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { s: s, i: i, X: q[0], Yp: q[1] }; }
      }
    });
    return best;
  };
  P.dataAt = function (px, py) {
    var a = this.ix(px), b = this.iy(py);
    return [this.o.xlog ? Math.pow(10, a) : a, this.o.ylog ? Math.pow(10, b) : b];
  };

  P.toDataURL = function () { return this.canvas.toDataURL('image/png'); };

  // static helper for reports: render series offscreen and return a PNG data URL
  Plot2D.image = function (series, opts, w, h) {
    var pl = new Plot2D(null, Object.assign({ width: w, height: h, scale: 2 }, opts));
    pl.setSeries(series);
    return pl.toDataURL();
  };

  return Plot2D;
})();
