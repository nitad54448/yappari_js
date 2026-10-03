/*  Circuit = nested series/parallel tree, written as a Boukamp circuit description code (CDC):
 *    juxtaposition at the top level or inside [ ] = series,  inside ( ) = parallel.
 *    R(RQ)(Q[RW])  =  R  +  (R || Q)  +  (Q || (R + W))
 *  Elements: R C L Q W Wo Ws G HN, optionally numbered (R1, Q2 ...). Unnumbered elements get the
 *  smallest free number, so the canonical code is always numbered: R1(R2Q1)(Q2[R3W1]).
 *  Element numbers give stable parameter names (R2, Q1, Q1_n ...): editing the circuit keeps the
 *  values of the parameters whose element still exists.
 *
 *  Tree nodes:  {t:'s', c:[...]} series   {t:'p', c:[...]} parallel   {t:'e', k:'Q', n:1} element
 *  Paths: arrays of child indices from the root ([] = root).
 */
Y.defineCore('circuit', function (Y) {
  'use strict';
  var KIND_RE = /^(HN|WO|WS|R|C|L|Q|W|G)(\d*)/i;
  var KIND_NORM = { HN: 'HN', WO: 'Wo', WS: 'Ws', R: 'R', C: 'C', L: 'L', Q: 'Q', W: 'W', G: 'G' };

  function err(msg, pos) { var e = new Error(msg); e.pos = pos; return e; }

  // ---------- parsing / printing ----------
  function parse(src, opts) {
    opts = opts || {};
    var s = String(src == null ? '' : src), i = 0;
    function skip() { while (i < s.length && /[\s,\-–—+]/.test(s[i])) i++; }
    function seq(close) {
      var items = [];
      for (;;) {
        skip();
        if (i >= s.length) {
          if (close) throw err('Missing "' + close + '"', i);
          return items;
        }
        var ch = s[i];
        if (ch === ')' || ch === ']') {
          if (ch !== close) throw err('Unexpected "' + ch + '" at position ' + (i + 1), i);
          i++; return items;
        }
        if (ch === '(' || ch === '[') {
          var at = i; i++;
          var kids = seq(ch === '(' ? ')' : ']');
          if (!kids.length) throw err('Empty group "' + ch + (ch === '(' ? ')' : ']') + '" at position ' + (at + 1), at);
          items.push({ t: ch === '(' ? 'p' : 's', c: kids });
          continue;
        }
        var m = KIND_RE.exec(s.slice(i));
        if (!m) throw err('Unknown element "' + s.slice(i, i + 4) + '" at position ' + (i + 1) +
          ' (use R C L Q W Wo Ws G HN)', i);
        items.push({ t: 'e', k: KIND_NORM[m[1].toUpperCase()], n: m[2] ? parseInt(m[2], 10) : null });
        i += m[0].length;
      }
    }
    var items = seq(null);
    if (!items.length) throw err('The circuit is empty', 0);
    var tree = normalize({ t: 's', c: items });
    if (opts.number !== false) number(tree);
    return tree;
  }

  // flatten series-in-series / parallel-in-parallel, unwrap single-child groups, drop empty groups
  function normalize(node) {
    if (!node) return null;
    if (node.t === 'e') return node;
    var kids = [];
    for (var j = 0; j < node.c.length; j++) {
      var nc = normalize(node.c[j]);
      if (!nc) continue;
      if (nc.t === node.t) Array.prototype.push.apply(kids, nc.c); else kids.push(nc);
    }
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    node.c = kids;
    return node;
  }

  function elements(tree, out) {
    out = out || [];
    if (!tree) return out;
    if (tree.t === 'e') out.push(tree); else tree.c.forEach(function (ch) { elements(ch, out); });
    return out;
  }

  // give every unnumbered element the smallest unused number of its kind
  function number(tree) {
    var used = {}, els = elements(tree);
    els.forEach(function (e) {
      if (e.n != null) {
        var key = e.k + e.n;
        if (used[key]) throw err('Element name ' + key + ' is used twice', -1);
        used[key] = true;
      }
    });
    els.forEach(function (e) {
      if (e.n == null) { var n = 1; while (used[e.k + n]) n++; e.n = n; used[e.k + n] = true; }
    });
    return tree;
  }

  function toCDC(node, nested) {
    if (!node) return '';
    if (node.t === 'e') return node.k + (node.n != null ? node.n : '');
    var inner = node.c.map(function (ch) { return toCDC(ch, true); }).join('');
    if (node.t === 'p') return '(' + inner + ')';
    return nested ? '[' + inner + ']' : inner;
  }

  function name(e) { return e.k + e.n; }

  // ordered parameter list: [{name, elem, kind, pi, scale, unit, label}]
  function paramList(tree) {
    var out = [];
    elements(tree).forEach(function (e) {
      Y.elements[e.k].params.forEach(function (pd, pi) {
        out.push({ name: name(e) + pd.suffix, elem: name(e), kind: e.k, pi: pi,
                   scale: pd.scale, unit: pd.unit, label: pd.label });
      });
    });
    return out;
  }

  // ---------- compiling / evaluating ----------
  function compile(tree) {
    if (!tree) throw err('The circuit is empty', 0);
    var params = paramList(tree), offsets = {}, ops = [], nslots = 0;
    params.forEach(function (pp, j) { if (!(pp.elem in offsets)) offsets[pp.elem] = j; });
    function walk(node) {
      var out;
      if (node.t === 'e') {
        out = nslots++;
        ops.push({ t: 0, kind: node.k, o: offsets[name(node)], out: out });
        return out;
      }
      var ins = node.c.map(walk);
      out = nslots++;
      ops.push({ t: node.t === 's' ? 1 : 2, ins: ins, out: out });
      return out;
    }
    var root = walk(tree);
    return { cdc: toCDC(tree), ops: ops, nslots: nslots, root: root, params: params,
             names: params.map(function (pp) { return pp.name; }) };
  }

  // returns ev(p, outRe, outIm) computing Z at all angular frequencies w
  function makeEvaluator(prog, w) {
    var n = w.length, SR = [], SI = [], E = Y.elements, ops = prog.ops;
    for (var s = 0; s < prog.nslots; s++) { SR.push(new Float64Array(n)); SI.push(new Float64Array(n)); }
    var rootR = SR[prog.root], rootI = SI[prog.root];
    return function (p, outRe, outIm) {
      for (var q = 0; q < ops.length; q++) {
        var op = ops[q], oR = SR[op.out], oI = SI[op.out], k, j;
        if (op.t === 0) {
          E[op.kind].z(w, p, op.o, oR, oI);
        } else if (op.t === 1) {                         // series: sum
          var a0 = op.ins;
          for (k = 0; k < n; k++) {
            var sr = 0, si = 0;
            for (j = 0; j < a0.length; j++) { sr += SR[a0[j]][k]; si += SI[a0[j]][k]; }
            oR[k] = sr; oI[k] = si;
          }
        } else {                                         // parallel: 1 / sum(1/Z)
          var a1 = op.ins;
          for (k = 0; k < n; k++) {
            var yr = 0, yi = 0, shortc = false;
            for (j = 0; j < a1.length; j++) {
              var zr = SR[a1[j]][k], zi = SI[a1[j]][k], d = zr * zr + zi * zi;
              if (d === 0) { shortc = true; break; }
              if (d === Infinity) continue;              // open branch
              yr += zr / d; yi -= zi / d;
            }
            if (shortc) { oR[k] = 0; oI[k] = 0; }
            else {
              var dd = yr * yr + yi * yi;
              if (dd === 0) { oR[k] = Infinity; oI[k] = 0; } else { oR[k] = yr / dd; oI[k] = -yi / dd; }
            }
          }
        }
      }
      for (var k2 = 0; k2 < n; k2++) { outRe[k2] = rootR[k2]; outIm[k2] = rootI[k2]; }
    };
  }

  // convenience: Z(f) for frequencies in Hz
  function impedance(prog, f, p) {
    var n = f.length, w = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
    for (var k = 0; k < n; k++) w[k] = 2 * Math.PI * f[k];
    makeEvaluator(prog, w)(p, re, im);
    return { re: re, im: im };
  }

  // ---------- editing helpers (used by the Model tab) ----------
  function clone(node) { return node ? JSON.parse(JSON.stringify(node)) : null; }
  function nodeAt(tree, path) { var nd = tree; for (var i = 0; i < path.length; i++) nd = nd.c[path[i]]; return nd; }
  function findPath(tree, target) {
    if (!tree) return null;
    if (tree === target) return [];
    if (tree.t === 'e') return null;
    for (var i = 0; i < tree.c.length; i++) {
      var sub = findPath(tree.c[i], target);
      if (sub) return [i].concat(sub);
    }
    return null;
  }
  function finish(tree) { tree = normalize(tree); if (tree) number(tree); return tree; }

  // put `sub` in series ('s') or in parallel ('p') with the node at `path`
  function insert(tree, path, sub, how) {
    if (!tree) return finish(sub);
    var target = nodeAt(tree, path);
    if (!path.length) return finish({ t: how, c: [target, sub] });
    var parent = nodeAt(tree, path.slice(0, -1)), idx = path[path.length - 1];
    if (parent.t === how) parent.c.splice(idx + 1, 0, sub);
    else parent.c[idx] = { t: how, c: [target, sub] };
    return finish(tree);
  }
  function replace(tree, path, sub) {
    if (!tree || !path.length) return finish(sub);
    var parent = nodeAt(tree, path.slice(0, -1));
    parent.c[path[path.length - 1]] = sub;
    return finish(tree);
  }
  function remove(tree, path) {
    if (!tree || !path.length) return null;
    var parent = nodeAt(tree, path.slice(0, -1));
    parent.c.splice(path[path.length - 1], 1);
    return finish(tree);
  }

  Y.circuit = {
    parse: parse, toCDC: toCDC, normalize: normalize, number: number, elements: elements,
    paramList: paramList, compile: compile, makeEvaluator: makeEvaluator, impedance: impedance,
    clone: clone, nodeAt: nodeAt, findPath: findPath, insert: insert, replace: replace, remove: remove,
    elementName: name
  };
});
