/*  Worker pool. Workers are created from a Blob that contains the core modules (Y.coreSources), so no
 *  separate worker file has to be fetched: this works from file:// as well as from a web server.
 *  If workers cannot be created, jobs run on the main thread in small time slices.
 *
 *  Y.pool.fitMany(jobs, onResult, onProgress) -> { promise, cancel, stopped }
 *  Y.pool.globalFit(job) -> { promise, cancel }
 *  Stop (cancel) takes effect at once: the workers still fitting are terminated and replaced by fresh ones.
 */
Y.pool = (function () {
  'use strict';
  var workers = [], url = null, broken = false;

  function workerMain() {
    /* global self */
    self.onmessage = function (e) {
      var m = e.data;
      // one message per fit, so that a Stop loses only the fits still running
      if (m.type === 'fit') for (var i = 0; i < m.jobs.length; i++) self.postMessage({ k: m.first + i, result: Y.fit.run(m.jobs[i]), last: i === m.jobs.length - 1 });
      else if (m.type === 'global') self.postMessage({ results: [Y.globalFit.run(m.job)] });
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
  // a worker whose work is abandoned (Stop): terminated, and a fresh one takes its place in the pool
  function restart(wk) {
    try { wk.w.terminate(); } catch (e) { /* */ }
    wk.busy = false;
    var at = workers.indexOf(wk);
    if (at < 0) return;
    try { wk.w = new Worker(url); } catch (e) { workers.splice(at, 1); }
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
    var state = { cancelled: false, done: 0 }, results = new Array(jobs.length), settle = null;
    var promise = new Promise(function (resolve) {
      settle = resolve;
      init();
      var all = jobs.map(function (_, k) { return k; });
      if (broken || !workers.length) { mainThread(jobs, all, results, onResult, onProgress, state, function () { resolve(results); }); return; }
      var next = 0, inflight = 0, failed = false;
      var chunk = Math.max(1, Math.min(16, Math.ceil(jobs.length / (workers.length * 6))));
      function feed(wk) {
        if (failed || state.cancelled) return;
        if (next >= jobs.length) { wk.busy = false; if (!inflight) resolve(results); return; }
        var start = next, end = Math.min(jobs.length, next + chunk);
        next = end; inflight++; wk.busy = true;
        wk.w.onmessage = function (e) {
          if (failed || state.cancelled) return;
          var d = e.data;
          results[d.k] = d.result; onResult(d.result, d.k);
          state.done++;
          onProgress(state.done, jobs.length);
          if (d.last) { inflight--; feed(wk); }
        };
        wk.w.onerror = function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (failed || state.cancelled) return;
          failed = true; broken = true;
          console.warn('worker failed, continuing on the main thread', ev && ev.message);
          terminateAll();
          var todo = all.filter(function (k) { return !results[k]; });
          mainThread(jobs, todo, results, onResult, onProgress, state, function () { resolve(results); });
        };
        wk.w.postMessage({ type: 'fit', first: start, jobs: jobs.slice(start, end) });
      }
      workers.slice().forEach(feed);
    });
    // Stop: no new fit starts, the workers still fitting are terminated (and replaced), and the promise resolves at
    // once with the results so far; the datasets whose fits were abandoned keep their values. On the main thread
    // (no workers) the fit that is running ends first.
    function cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      workers.slice().forEach(function (wk) { if (wk.busy) restart(wk); });
      settle(results);
    }
    return { promise: promise, cancel: cancel, stopped: function () { return state.cancelled; } };
  }

  // A global fit is one long job: Stop terminates its worker (a fresh one replaces it) and the promise
  // resolves with { ok: false, cancelled: true }. On the main thread (no workers) it cannot be stopped.
  function globalFit(job) {
    var settle = null, wk = null, finished = false;
    function finish(r) { if (finished) return; finished = true; if (wk) wk.busy = false; settle(r); }
    var promise = new Promise(function (resolve) {
      settle = resolve;
      init();
      wk = workers[0] || null;
      if (broken || !wk) { wk = null; setTimeout(function () { if (!finished) finish(Y.globalFit.run(job)); }, 0); return; }
      wk.busy = true;
      wk.w.onmessage = function (e) { finish(e.data.results[0]); };
      wk.w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (finished) return;
        broken = true; terminateAll(); wk = null;
        finish(Y.globalFit.run(job));
      };
      wk.w.postMessage({ type: 'global', job: job });
    });
    function cancel() {
      if (finished || !wk) return false;
      try { wk.w.terminate(); } catch (e) { /* */ }
      var at = workers.indexOf(wk);
      if (at >= 0) {
        try { wk.w = new Worker(url); } catch (e) { workers.splice(at, 1); }
      }
      finish({ ok: false, cancelled: true, msg: 'stopped by the user' });
      return true;
    }
    return { promise: promise, cancel: cancel, global: true };
  }

  return { fitMany: fitMany, globalFit: globalFit, size: size, usingWorkers: function () { init(); return !broken && workers.length > 0; } };
})();
