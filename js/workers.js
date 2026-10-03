/*  Worker pool. Workers are created from a Blob that contains the core modules (Y.coreSources), so no
 *  separate worker file has to be fetched: this works from file:// as well as from a web server.
 *  If workers cannot be created, jobs run on the main thread in small time slices.
 *
 *  Y.pool.fitMany(jobs, onResult, onProgress) -> { promise, cancel }
 *  Y.pool.globalFit(job) -> promise
 */
Y.pool = (function () {
  'use strict';
  var workers = [], url = null, broken = false;

  function workerMain() {
    /* global self */
    self.onmessage = function (e) {
      var m = e.data, out = [];
      if (m.type === 'fit') for (var i = 0; i < m.jobs.length; i++) out.push(Y.fit.run(m.jobs[i]));
      else if (m.type === 'global') out.push(Y.globalFit.run(m.job));
      self.postMessage({ results: out });
    };
  }

  function size() { return Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1)); }

  function init() {
    if (url || broken) return;
    try {
      var src = 'var Y = {}; Y.defineCore = function (n, f) { f(Y); };\n' + Y.coreSources.join('\n') +
                '\n(' + workerMain.toString() + ')();';
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      for (var i = 0; i < size(); i++) workers.push({ w: new Worker(url), busy: false });
    } catch (e) {
      broken = true; workers = [];
      console.warn('Web Workers unavailable, fitting on the main thread:', e);
    }
  }

  function terminateAll() {
    workers.forEach(function (wk) { try { wk.w.terminate(); } catch (e) { /* */ } });
    workers = []; url = null;
  }

  // run the jobs listed in idx on the main thread, in ~25 ms slices
  function mainThread(jobs, idx, results, onResult, onProgress, state, done) {
    var i = 0;
    (function slice() {
      var t0 = performance.now();
      while (i < idx.length && !state.cancelled && performance.now() - t0 < 25) {
        var k = idx[i++], r = Y.fit.run(jobs[k]);
        results[k] = r; onResult(r, k); state.done++;
      }
      onProgress(state.done, jobs.length);
      if (i < idx.length && !state.cancelled) setTimeout(slice, 0); else done();
    })();
  }

  function fitMany(jobs, onResult, onProgress) {
    onResult = onResult || function () {};
    onProgress = onProgress || function () {};
    var state = { cancelled: false, done: 0 }, results = new Array(jobs.length);
    var promise = new Promise(function (resolve) {
      init();
      var all = jobs.map(function (_, k) { return k; });
      if (broken || !workers.length) { mainThread(jobs, all, results, onResult, onProgress, state, function () { resolve(results); }); return; }
      var next = 0, inflight = 0, failed = false;
      var chunk = Math.max(1, Math.min(16, Math.ceil(jobs.length / (workers.length * 6))));
      function feed(wk) {
        if (failed) return;
        if (state.cancelled || next >= jobs.length) { wk.busy = false; if (!inflight) resolve(results); return; }
        var start = next, end = Math.min(jobs.length, next + chunk);
        next = end; inflight++; wk.busy = true;
        wk.w.onmessage = function (e) {
          if (failed) return;
          inflight--;
          e.data.results.forEach(function (r, k) { results[start + k] = r; onResult(r, start + k); });
          state.done += end - start;
          onProgress(state.done, jobs.length);
          feed(wk);
        };
        wk.w.onerror = function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (failed) return;
          failed = true; broken = true;
          console.warn('worker failed, continuing on the main thread', ev && ev.message);
          terminateAll();
          var todo = all.filter(function (k) { return !results[k]; });
          mainThread(jobs, todo, results, onResult, onProgress, state, function () { resolve(results); });
        };
        wk.w.postMessage({ type: 'fit', jobs: jobs.slice(start, end) });
      }
      workers.slice().forEach(feed);
    });
    return { promise: promise, cancel: function () { state.cancelled = true; } };
  }

  function globalFit(job) {
    return new Promise(function (resolve) {
      init();
      var wk = workers[0];
      if (broken || !wk) { setTimeout(function () { resolve(Y.globalFit.run(job)); }, 0); return; }
      wk.w.onmessage = function (e) { resolve(e.data.results[0]); };
      wk.w.onerror = function (ev) { ev.preventDefault(); broken = true; terminateAll(); resolve(Y.globalFit.run(job)); };
      wk.w.postMessage({ type: 'global', job: job });
    });
  }

  return { fitMany: fitMany, globalFit: globalFit, size: size, usingWorkers: function () { init(); return !broken && workers.length > 0; } };
})();
