/*  Plot3D - orthographic 3D scatter on a canvas, points coloured by their z value (jet colour map).
 *  setData({ x, y, z: arrays, labels: {x, y, z}, xlog })   y is usually the dataset index.
 *  Drag = rotate, wheel = zoom, double-click = reset view.
 */
Y.Plot3D = (function () {
  'use strict';

  function jet(t) {
    t = Math.max(0, Math.min(1, t));
    var r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3))), g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2))),
        b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
    return 'rgb(' + Math.round(255 * r) + ',' + Math.round(255 * g) + ',' + Math.round(255 * b) + ')';
  }
  var JET = []; for (var i = 0; i < 64; i++) JET.push(jet(i / 63));

  function ticks(a, b, n) {
    var span = b - a || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var st = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, out = [];
    for (var v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
    return out;
  }
  function fmt(v) {
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e4 || a < 1e-2)) return v.toExponential(1).replace('e+', 'e');
    return String(+v.toPrecision(3));
  }

  function Plot3D(host) {
    this.host = host; this.data = null;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'plot-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.reset();
    var self = this;
    if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self.resize(); }); this.ro.observe(host); }
    this._bind();
    this.resize();
  }
  var P = Plot3D.prototype;

  P.reset = function () { this.az = -0.95; this.el = 0.42; this.zoom = 1; };

  P.resize = function () {
    var w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.draw();
  };

  P.setData = function (d) {
    this.data = d;
    if (!d || !d.x.length) { this.draw(); return; }
    var n = d.x.length, X = new Float64Array(n), rng = function () { return { lo: Infinity, hi: -Infinity }; };
    var rx = rng(), ry = rng(), rz = rng();
    for (var k = 0; k < n; k++) {
      X[k] = d.xlog ? (d.x[k] > 0 ? Math.log10(d.x[k]) : NaN) : d.x[k];
      if (isFinite(X[k]) && isFinite(d.z[k])) {
        rx.lo = Math.min(rx.lo, X[k]); rx.hi = Math.max(rx.hi, X[k]);
        ry.lo = Math.min(ry.lo, d.y[k]); ry.hi = Math.max(ry.hi, d.y[k]);
        rz.lo = Math.min(rz.lo, d.z[k]); rz.hi = Math.max(rz.hi, d.z[k]);
      }
    }
    [rx, ry, rz].forEach(function (r) { if (!isFinite(r.lo)) { r.lo = 0; r.hi = 1; } if (r.lo === r.hi) { r.lo -= 0.5; r.hi += 0.5; } });
    this.X = X; this.rx = rx; this.ry = ry; this.rz = rz;
    this.draw();
  };

  // normalised coordinates in [-1, 1]
  P._n = function (v, r) { return -1 + 2 * (v - r.lo) / (r.hi - r.lo); };
  // projection: returns [screenX, screenY, depth] (larger depth = farther away)
  P._p = function (u, v, w) {
    var ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
    var x1 = u * ca - v * sa, y1 = u * sa + v * ca;
    var s = this.scale;
    return [this.cx + s * x1, this.cy - s * (w * ce + y1 * se), y1 * ce - w * se];
  };

  P.draw = function () {
    if (!this.W) return;
    var c = this.ctx, T = Y.theme.get(), self = this;                     // colours, fonts and sizes from style.css
    var bg = T.bg, grid = T.grid, ink = T.ink, ink2 = T.ink2, font = T.font, fs = T.fontSize + 'px ', ts = T.titleSize + 'px ';
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = bg; c.fillRect(0, 0, this.W, this.H);
    c.font = fs + font;
    if (!this.data || !this.data.x.length) {
      c.fillStyle = ink2; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('Select datasets to see them in 3D', this.W / 2, this.H / 2);
      return;
    }
    var plotW = this.W - 90;
    this.cx = plotW / 2 + 10; this.cy = this.H / 2 + 10;
    this.scale = Math.min(plotW, this.H) * 0.3 * this.zoom;

    // box: back faces with grid
    var faces = [
      { axis: 0, val: -1 }, { axis: 0, val: 1 }, { axis: 1, val: -1 }, { axis: 1, val: 1 }
    ].map(function (f) { var p = f.axis === 0 ? self._p(f.val, 0, 0) : self._p(0, f.val, 0); f.depth = p[2]; return f; });
    var backU = faces[0].depth > faces[1].depth ? -1 : 1, backV = faces[2].depth > faces[3].depth ? -1 : 1;
    var floorW = Math.sin(this.el) >= 0 ? -1 : 1;
    var tx = ticks(this.rx.lo, this.rx.hi, 5), ty = ticks(this.ry.lo, this.ry.hi, 5), tz = ticks(this.rz.lo, this.rz.hi, 5);
    var line = function (a, b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); };
    c.strokeStyle = grid; c.lineWidth = 1; c.beginPath();
    tx.forEach(function (v) { var u = self._n(v, self.rx); line(self._p(u, -1, floorW), self._p(u, 1, floorW)); line(self._p(u, backV, -1), self._p(u, backV, 1)); });
    ty.forEach(function (v) { var w = self._n(v, self.ry); line(self._p(-1, w, floorW), self._p(1, w, floorW)); line(self._p(backU, w, -1), self._p(backU, w, 1)); });
    tz.forEach(function (v) { var w = self._n(v, self.rz); line(self._p(-1, backV, w), self._p(1, backV, w)); line(self._p(backU, -1, w), self._p(backU, 1, w)); });
    c.stroke();
    c.strokeStyle = T.axis; c.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q, k, arr) {
      var r = arr[(k + 1) % 4];
      line(self._p(q[0], q[1], floorW), self._p(r[0], r[1], floorW));
    });
    line(self._p(backU, backV, -1), self._p(backU, backV, 1));
    line(self._p(-backU, backV, -1), self._p(-backU, backV, 1));
    line(self._p(backU, -backV, -1), self._p(backU, -backV, 1));
    c.stroke();

    // points, far to near
    var d = this.data, n = d.x.length, sx = new Float32Array(n), sy = new Float32Array(n), dep = new Float32Array(n), ci = new Uint8Array(n), order = [];
    for (var k = 0; k < n; k++) {
      if (!isFinite(this.X[k]) || !isFinite(d.z[k])) continue;
      var w = this._n(d.z[k], this.rz), p = this._p(this._n(this.X[k], this.rx), this._n(d.y[k], this.ry), w);
      sx[k] = p[0]; sy[k] = p[1]; dep[k] = p[2]; ci[k] = Math.round((w + 1) / 2 * 63); order.push(k);
    }
    if (!this.dragging || order.length < 60000) order.sort(function (a, b) { return dep[b] - dep[a]; });
    var sz = (n > 50000 ? 1.6 : n > 8000 ? 2.2 : 3) * T.ms;
    order.forEach(function (k2) { c.fillStyle = JET[ci[k2]]; c.fillRect(sx[k2] - sz / 2, sy[k2] - sz / 2, sz, sz); });

    // tick labels on the front edges
    c.fillStyle = ink2; c.textBaseline = 'middle';
    var frontV = -backV, frontU = -backU;
    tx.forEach(function (v) { var p = self._p(self._n(v, self.rx), frontV * 1.12, floorW); c.textAlign = 'center'; c.fillText(fmt(d.xlog ? Math.pow(10, v) : v), p[0], p[1] + 4); });
    ty.forEach(function (v) { var p = self._p(frontU * 1.12, self._n(v, self.ry), floorW); c.textAlign = 'center'; c.fillText(fmt(v), p[0], p[1] + 4); });
    var zEdge = self._p(-backU, backV, 0)[0] < self._p(backU, -backV, 0)[0] ? [-backU, backV] : [backU, -backV];
    tz.forEach(function (v) { var p = self._p(zEdge[0], zEdge[1], self._n(v, self.rz)); c.textAlign = 'right'; c.fillText(fmt(v), p[0] - 6, p[1]); });
    c.fillStyle = ink; c.font = ts + font; c.textAlign = 'center';
    var lx = self._p(0, frontV * 1.35, floorW), ly = self._p(frontU * 1.35, 0, floorW), lz = self._p(zEdge[0], zEdge[1], 1.18);
    c.fillText(d.labels.x, lx[0], lx[1] + 6); c.fillText(d.labels.y, ly[0], ly[1] + 6); c.fillText(d.labels.z, lz[0], lz[1] - 6);

    // colour bar
    var bx = this.W - 64, by = 30, bh = this.H - 70;
    for (var j = 0; j < bh; j++) { c.fillStyle = JET[Math.round((1 - j / bh) * 63)]; c.fillRect(bx, by + j, 14, 1.5); }
    c.strokeStyle = T.axis; c.strokeRect(bx + 0.5, by + 0.5, 14, bh);
    c.fillStyle = ink2; c.font = fs + font; c.textAlign = 'left';
    c.fillText(fmt(this.rz.hi), bx + 18, by + 4); c.fillText(fmt((this.rz.hi + this.rz.lo) / 2), bx + 18, by + bh / 2); c.fillText(fmt(this.rz.lo), bx + 18, by + bh - 2);
  };

  P._bind = function () {
    var self = this, cv = this.canvas, last = null;
    cv.addEventListener('mousedown', function (e) { last = [e.clientX, e.clientY]; self.dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!last) return;
      self.az += (e.clientX - last[0]) * 0.01;
      self.el = Math.max(-1.5, Math.min(1.5, self.el + (e.clientY - last[1]) * 0.01));
      last = [e.clientX, e.clientY];
      if (!self._raf) self._raf = requestAnimationFrame(function () { self._raf = 0; self.draw(); });
    });
    window.addEventListener('mouseup', function () { if (last) { last = null; self.dragging = false; self.draw(); } });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoom = Math.max(0.3, Math.min(5, self.zoom * Math.exp(-e.deltaY * 0.001)));
      self.draw();
    }, { passive: false });
    cv.addEventListener('dblclick', function () { self.reset(); self.draw(); });
  };

  P.toDataURL = function () { return this.canvas.toDataURL('image/png'); };

  return Plot3D;
})();
