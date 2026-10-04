/*  Yappari JS - global namespace.
 *
 *  Every file attaches its functions to the global object `Y`.
 *  DOM-free "core" modules (elements, circuit, linalg, fit, globalfit) register through
 *  Y.defineCore(name, factory): the factory runs immediately in the page, and its source text
 *  is kept so that workers.js can rebuild the same code inside Web Workers (Blob URL), which
 *  keeps the program runnable from file:// without a web server.
 *  Rule for core factories: use only their argument `Y` and standard JS globals (Math, typed arrays).
 */
(function (root) {
  'use strict';
  var Y = root.Y || (root.Y = {});
  Y.version = '1.0.9 (04 oct 2026)';
  Y.coreSources = Y.coreSources || [];
  Y.defineCore = function (name, factory) {
    Y.coreSources.push('/* ' + name + ' */\n(' + factory.toString() + ')(Y);');
    factory(Y);
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
