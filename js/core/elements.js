/*  Element library.
 *  Each element: kind, title, formula (text), params[], z(w, p, o, re, im)
 *    w      Float64Array of angular frequencies (rad/s)
 *    p      full parameter vector of the circuit, o = offset of this element's first parameter
 *    re,im  output arrays (same length as w)
 *  Parameter fields: suffix (appended to the element name, e.g. Q1 + '_n'), label, unit,
 *    def (default value), min/max (default limits), scale ('log' = fitted as ln p, 'lin'), fit (fitted by default).
 *  Equations follow help/theory.md of Yappari 5.1 (W, Wo, Ws, Zarc/CPE).
 */
Y.defineCore('elements', function (Y) {
  'use strict';
  var HALF_PI = Math.PI / 2;

  function P(suffix, label, unit, def, min, max, scale, fit) {
    return { suffix: suffix, label: label, unit: unit, def: def, min: min, max: max, scale: scale, fit: fit };
  }

  // tanh(c + i c): odd in c, including negative B allowed by custom bounds / unbounded fits.
  function tanhDiag(c, out) {
    if (Math.abs(c) > 20) { out[0] = c < 0 ? -1 : 1; out[1] = 0; return; } // error < 1e-17
    var c2 = 2 * c, den = Math.cosh(c2) + Math.cos(c2);
    out[0] = Math.sinh(c2) / den;
    out[1] = Math.sin(c2) / den;
  }

  var E = {};

  E.R = {
    kind: 'R', title: 'Resistor', formula: 'Z = R',
    params: [P('', 'R', 'Ω', 100, 1e-3, 1e10, 'log', true)],
    z: function (w, p, o, re, im) {
      var R = p[o];
      for (var k = 0; k < w.length; k++) { re[k] = R; im[k] = 0; }
    }
  };

  E.C = {
    kind: 'C', title: 'Capacitor', formula: 'Z = 1/(jωC)',
    params: [P('', 'C', 'F', 1e-9, 1e-16, 1e3, 'log', true)],
    z: function (w, p, o, re, im) {
      var C = p[o];
      for (var k = 0; k < w.length; k++) { re[k] = 0; im[k] = -1 / (w[k] * C); }
    }
  };

  E.L = {
    kind: 'L', title: 'Inductor', formula: 'Z = jωL',
    params: [P('', 'L', 'H', 1e-6, 1e-15, 1e3, 'log', true)],
    z: function (w, p, o, re, im) {
      var L = p[o];
      for (var k = 0; k < w.length; k++) { re[k] = 0; im[k] = w[k] * L; }
    }
  };

  E.Q = {
    kind: 'Q', title: 'Constant phase element (CPE)', formula: 'Z = 1/(Q·(jω)^n)',
    params: [P('', 'Q', 'F·s^(n−1)', 1e-9, 1e-16, 1e3, 'log', true),
             P('_n', 'n', '', 1, 0, 1.2, 'lin', false)],
    z: function (w, p, o, re, im) {
      var Q = p[o], n = p[o + 1], c = Math.cos(n * HALF_PI), s = Math.sin(n * HALF_PI);
      for (var k = 0; k < w.length; k++) {
        var m = 1 / (Q * Math.pow(w[k], n));
        re[k] = m * c; im[k] = -m * s;
      }
    }
  };

  E.W = {
    kind: 'W', title: 'Warburg, semi-infinite diffusion', formula: 'Z = Aw/√ω − j·Aw/√ω',
    params: [P('', 'Aw', 'Ω·s^−½', 100, 1e-6, 1e10, 'log', true)],
    z: function (w, p, o, re, im) {
      var A = p[o];
      for (var k = 0; k < w.length; k++) { var a = A / Math.sqrt(w[k]); re[k] = a; im[k] = -a; }
    }
  };

  // shared code for Wo (coth) and Ws (tanh): Z = Aw/sqrt(jw) * f(B sqrt(jw))
  function finiteWarburg(useCoth) {
    return function (w, p, o, re, im) {
      var A = p[o], B = p[o + 1], t = [0, 0];
      for (var k = 0; k < w.length; k++) {
        // coth(z)/z = 1/z² + 1/3 - z²/45 + 2z⁴/945 - z⁶/4725 + ...,
        // with z² = j*w*B². Avoid subtracting huge, nearly equal terms in Zr.
        var x = w[k] * B * B;
        if (useCoth && B !== 0 && Math.abs(x) < 0.01) {
          var x2 = x * x, ab = A * B;
          re[k] = ab * (1 / 3 - 2 * x2 / 945 + 2 * x2 * x2 / 93555);
          im[k] = -A / (w[k] * B) - ab * x * (1 / 45 - x2 / 4725);
          continue;
        }
        var sw = Math.sqrt(w[k] / 2);            // sqrt(j w) = sw (1 + j)
        var pr = A / (2 * sw), pi = -pr;         // A / sqrt(j w) = A (1 - j) / (2 sw)
        tanhDiag(B * sw, t);
        var fr = t[0], fi = t[1];
        if (useCoth) { var d = fr * fr + fi * fi; fr = fr / d; fi = -fi / d; }
        re[k] = pr * fr - pi * fi;
        im[k] = pr * fi + pi * fr;
      }
    };
  }

  E.Wo = {
    kind: 'Wo', title: 'Warburg open (finite length, reflective boundary)', formula: 'Z = Aw/√(jω) · coth(B·√(jω))',
    params: [P('_A', 'Aw', 'Ω·s^−½', 100, 1e-6, 1e10, 'log', true),
             P('_B', 'B', 's^½', 1, 1e-6, 1e6, 'log', true)],
    z: finiteWarburg(true)
  };

  E.Ws = {
    kind: 'Ws', title: 'Warburg short (finite length, transmissive boundary)', formula: 'Z = Aw/√(jω) · tanh(B·√(jω))',
    params: [P('_A', 'Aw', 'Ω·s^−½', 100, 1e-6, 1e10, 'log', true),
             P('_B', 'B', 's^½', 1, 1e-6, 1e6, 'log', true)],
    z: finiteWarburg(false)
  };

  E.G = {
    kind: 'G', title: 'Gerischer', formula: 'Z = R/√(1 + jωτ)',
    params: [P('_R', 'R', 'Ω', 100, 1e-3, 1e10, 'log', true),
             P('_tau', 'τ', 's', 1e-3, 1e-12, 1e6, 'log', true)],
    z: function (w, p, o, re, im) {
      var R = p[o], tau = p[o + 1];
      for (var k = 0; k < w.length; k++) {
        var x = w[k] * tau, m = Math.hypot(1, x);          // |1 + j x|
        var sr = Math.sqrt(m / 2 + 0.5), si = x / (2 * sr); // signed imaginary part of sqrt(1 + j x)
        re[k] = R * sr / m; im[k] = -R * si / m;
      }
    }
  };

  E.HN = {
    kind: 'HN', title: 'Havriliak–Negami', formula: 'Z = R/(1 + (jωτ)^α)^β',
    params: [P('_R', 'R', 'Ω', 100, 1e-3, 1e10, 'log', true),
             P('_tau', 'τ', 's', 1e-3, 1e-12, 1e6, 'log', true),
             P('_a', 'α', '', 1, 0.01, 1, 'lin', false),
             P('_b', 'β', '', 1, 0.01, 1, 'lin', false)],
    z: function (w, p, o, re, im) {
      var R = p[o], tau = p[o + 1], a = p[o + 2], b = p[o + 3];
      var ca = Math.cos(a * HALF_PI), sa = Math.sin(a * HALF_PI);
      for (var k = 0; k < w.length; k++) {
        var m = Math.pow(w[k] * tau, a), ur = 1 + m * ca, ui = m * sa;
        var mag = R * Math.pow(ur * ur + ui * ui, -b / 2), ang = -b * Math.atan2(ui, ur);
        re[k] = mag * Math.cos(ang); im[k] = mag * Math.sin(ang);
      }
    }
  };

  Y.elements = E;
  Y.elementKinds = ['R', 'C', 'L', 'Q', 'W', 'Wo', 'Ws', 'G', 'HN'];

  // user overrides of default value / limits / fit flag, per kind and parameter index:
  // Y.elementOverrides = { Q: [ {def:..,min:..,max:..,fit:..}, {...} ] }
  Y.elementOverrides = Y.elementOverrides || {};
  Y.paramDefault = function (kind, index) {
    var base = E[kind].params[index], ov = (Y.elementOverrides[kind] || [])[index] || {};
    return {
      def: ov.def != null ? ov.def : base.def,
      min: ov.min != null ? ov.min : base.min,
      max: ov.max != null ? ov.max : base.max,
      fit: ov.fit != null ? ov.fit : base.fit,
      scale: base.scale, unit: base.unit, label: base.label
    };
  };
});
