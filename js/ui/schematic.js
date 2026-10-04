/*  Draws the circuit tree as an SVG schematic. Series children are placed left to right on a common
 *  rail, parallel children are stacked between two vertical buses. Every element and group carries
 *  data-path (child indices joined by '.') so that clicks can select it.
 */
Y.schematic = (function () {
  'use strict';
  var EW = 64, EH = 54, RAIL = 21, GAP = 12, VGAP = 10, BUS = 14, PAD = 16, LEAD = 22;

  function r1(v) { return Math.round(v * 10) / 10; }
  function wire(x1, y1, x2, y2) { return '<line class="w" x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '"/>'; }

  function lay(node, L) {
    var o;
    if (node.t === 'e') o = { w: EW, h: EH, r: RAIL };
    else {
      var ks = node.c.map(function (k) { return lay(k, L); });
      if (node.t === 's') {
        var r = 0, below = 0, w = 0;
        ks.forEach(function (k, i) { r = Math.max(r, k.r); below = Math.max(below, k.h - k.r); w += k.w + (i ? GAP : 0); });
        o = { w: w, h: r + below, r: r };
      } else {
        var inner = 0, hh = 0, last = ks[ks.length - 1];
        ks.forEach(function (k, i) { inner = Math.max(inner, k.w); hh += k.h + (i ? VGAP : 0); });
        o = { w: inner + 2 * BUS, h: hh, inner: inner, r: (ks[0].r + (hh - last.h + last.r)) / 2 };
      }
    }
    L.set(node, o);
    return o;
  }

  // element symbol inside the box [x, x+EW], centred on (cx, cy)
  function symbol(k, x, cx, cy) {
    switch (k) {
      case 'R': return wire(x, cy, cx - 16, cy) + wire(cx + 16, cy, x + EW, cy) +
        '<rect class="sym" x="' + (cx - 16) + '" y="' + (cy - 6) + '" width="32" height="12" rx="1"/>';
      case 'C': return wire(x, cy, cx - 4, cy) + wire(cx + 4, cy, x + EW, cy) +
        '<path class="sym-line" d="M' + (cx - 4) + ' ' + (cy - 11) + 'V' + (cy + 11) + 'M' + (cx + 4) + ' ' + (cy - 11) + 'V' + (cy + 11) + '"/>';
      case 'L': return wire(x, cy, cx - 16, cy) + wire(cx + 16, cy, x + EW, cy) +
        '<path class="sym-line" d="M' + (cx - 16) + ' ' + cy + 'a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0"/>';
      case 'Q': return wire(x, cy, cx - 10, cy) + wire(cx + 6, cy, x + EW, cy) +
        '<path class="sym-line" d="M' + (cx - 10) + ' ' + (cy - 8) + 'l7 8l-7 8M' + (cx - 1) + ' ' + (cy - 8) + 'l7 8l-7 8"/>';
      default: return wire(x, cy, cx - 16, cy) + wire(cx + 16, cy, x + EW, cy) +
        '<rect class="sym-box" x="' + (cx - 16) + '" y="' + (cy - 9) + '" width="32" height="18" rx="2"/>' +
        '<text class="sym-txt" x="' + cx + '" y="' + (cy + 4) + '">' + k + '</text>';
    }
  }

  function draw(node, x, y, path, selKey, L, out, pcs) {
    var o = L.get(node), key = path.join('.'), on = selKey === key ? ' sel' : '';
    if (node.t === 'e') {
      var cy = y + o.r, cx = x + EW / 2;
      out.push('<g class="el' + on + '" data-path="' + key + '"><rect class="hit" x="' + x + '" y="' + (y + 1) + '" width="' + EW +
        '" height="' + (EH - 2) + '" rx="3"/>' + symbol(node.k, x, cx, cy) + '<text class="lbl" x="' + cx + '" y="' + (cy + 27) + '">' +
        node.k + node.n + '</text></g>');
      return;
    }
    out.push('<rect class="grp' + on + '" data-path="' + key + '" x="' + (x - 5) + '" y="' + (y - 5) + '" width="' + (o.w + 10) +
      '" height="' + (o.h + 10) + '" rx="4"/>');
    if (node.t === 's') {
      var xx = x, ry = y + o.r, wrap = pcs && !path.length;
      node.c.forEach(function (k, i) {
        var ko = L.get(k);
        if (i) out.push(wire(xx - GAP, ry, xx, ry));
        if (wrap) out.push('<g class="part" style="--pc:' + pcs[i % pcs.length] + '">');
        draw(k, xx, ry - ko.r, path.concat(i), selKey, L, out);
        if (wrap) out.push('</g>');
        xx += ko.w + GAP;
      });
      return;
    }
    var lb = x + BUS / 2, rb = x + o.w - BUS / 2, yy = y, rails = [];
    node.c.forEach(function (k, i) {
      var ko = L.get(k), kx = x + BUS + (o.inner - ko.w) / 2, kr = yy + ko.r;
      rails.push(kr);
      out.push(wire(lb, kr, kx, kr), wire(kx + ko.w, kr, rb, kr));
      draw(k, kx, yy, path.concat(i), selKey, L, out);
      yy += ko.h + VGAP;
    });
    var r = y + o.r;
    out.push(wire(lb, rails[0], lb, rails[rails.length - 1]), wire(rb, rails[0], rb, rails[rails.length - 1]),
             wire(x, r, lb, r), wire(rb, r, x + o.w, r),
             '<circle class="node" cx="' + lb + '" cy="' + r1(r) + '" r="2.6"/><circle class="node" cx="' + rb + '" cy="' + r1(r) + '" r="2.6"/>');
  }

  function markup(tree, selKey, pcs) {
    if (!tree) return null;
    var L = new Map(), o = lay(tree, L), out = [];
    var x0 = PAD + LEAD, y0 = PAD + 6, r = y0 + o.r, xe = x0 + o.w + LEAD;
    out.push(wire(PAD + 4, r, x0, r), wire(x0 + o.w, r, xe - 4, r));
    var whole = pcs && tree.t !== 's';
    if (whole) out.push('<g class="part" style="--pc:' + pcs[0] + '">');
    draw(tree, x0, y0, [], selKey, L, out, pcs);
    if (whole) out.push('</g>');
    out.push('<circle class="term" cx="' + (PAD + 4) + '" cy="' + r1(r) + '" r="4"/><circle class="term" cx="' + (xe - 4) + '" cy="' + r1(r) + '" r="4"/>');
    return { w: xe + PAD, h: o.h + 2 * PAD + 12, body: out.join('') };
  }

  function render(svg, tree, selKey, pcs) {
    var m = markup(tree, selKey, pcs);
    if (!m) {
      svg.setAttribute('viewBox', '0 0 560 80'); svg.setAttribute('width', 560); svg.setAttribute('height', 80);
      svg.innerHTML = '<text class="empty" x="280" y="45">The circuit is empty. Pick an element above or type a circuit code.</text>';
      return;
    }
    // enlarge small circuits to the space available (up to 1.8x); large ones scroll at 1:1
    var box = svg.parentNode, s = 1;
    if (box && box.clientWidth) s = Math.max(1, Math.min(1.8, (box.clientWidth - 64) / m.w, (box.clientHeight - 64) / m.h));
    svg.setAttribute('viewBox', '0 0 ' + m.w + ' ' + m.h);
    svg.setAttribute('width', Math.round(m.w * s)); svg.setAttribute('height', Math.round(m.h * s));
    svg.innerHTML = m.body;
  }

  // styles of the standalone SVG in the report, from the light theme of style.css
  function reportCSS() {
    var T = Y.theme.get('light'), s = T.schematic;
    return '.w{stroke:' + T.ink2 + ';stroke-width:' + s.wire + '}.sym{fill:' + T.blue + '}.sym-line{stroke:' + T.blue + ';stroke-width:' + s.line +
      ';fill:none;stroke-linecap:round;stroke-linejoin:round}.sym-box{fill:' + T.panel + ';stroke:' + T.blue + ';stroke-width:' + s.box +
      '}.sym-txt{fill:' + T.blue + ';font:600 ' + s.symbol + ' ' + T.font + ';text-anchor:middle}.lbl{fill:' + T.ink + ';font:' + s.font + ' ' + T.font +
      ';text-anchor:middle}.hit,.grp{fill:none;stroke:none}.node{fill:' + T.ink2 + '}.term{fill:' + T.panel + ';stroke:' + T.ink2 + ';stroke-width:' + s.wire + '}';
  }

  // standalone SVG (report)
  function svgString(tree) {
    var m = markup(tree, null);
    if (!m) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + m.w + '" height="' + m.h + '" viewBox="0 0 ' + m.w + ' ' + m.h + '"><style>' + reportCSS() + '</style>' + m.body + '</svg>';
  }
  // palette icon
  function icon(k) { return '<svg viewBox="0 0 64 28" width="40" height="18" aria-hidden="true">' + symbol(k, 0, 32, 14) + '</svg>'; }

  return { render: render, svgString: svgString, icon: icon };
})();
