/*  Worker pool. Workers are created from a Blob that contains the core modules (Y.coreSources), so no
 *  separate worker file has to be fetched: this works from file:// as well as from a web server.
 *  If workers cannot be created, jobs run on the main thread in small time slices.
 *
 *  Y.pool.fitMany(jobs, onResult, onProgress) -> { promise, cancel, stopped }
 *  Y.pool.globalFit(job) -> { promise, cancel }
 *  Stop (cancel) takes effect at once: the workers still fitting are terminated and replaced by fresh ones.
 *  A worker only stops by itself on an error outside the fit code, in practice when it runs out of memory: it is
 *  replaced, the job it was running is tried once more in a fresh worker, and a job that stops a worker twice is
 *  reported as failed. The main thread would run out of memory the same way and freeze the page, so jobs run there
 *  only when no worker can be made at all.
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

  var CRASH_MSG = 'the fit stopped its worker twice (out of memory?), so it was not done';
  // a worker whose work is abandoned (Stop) or that stopped by itself: terminated, and a fresh one takes its place
  function restart(wk) {
    try { wk.w.terminate(); } catch (e) { /* */ }
    wk.busy = false; wk.token = null;
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
      var next = 0, inflight = 0, fallback = false, retry = [], tries = new Uint8Array(jobs.length);
      var chunk = Math.max(1, Math.min(16, Math.ceil(jobs.length / (workers.length * 6))));
      function put(k, r) { results[k] = r; onResult(r, k); state.done++; onProgress(state.done, jobs.length); }
      // the next jobs for a worker: one to try again first, then the next chunk; token: handlers of earlier work ignored
      function feed(wk) {
        if (fallback || state.cancelled) return;
        var start, end;
        if (retry.length) { start = retry.shift(); end = start + 1; }
        else if (next < jobs.length) { start = next; end = Math.min(jobs.length, next + chunk); next = end; }
        else { wk.busy = false; if (!inflight) resolve(results); return; }
        var token = {};
        inflight++; wk.busy = true; wk.token = token;
        wk.w.onmessage = function (e) {
          if (wk.token !== token || fallback || state.cancelled) return;
          var d = e.data;
          put(d.k, d.result);
          if (d.last) { inflight--; feed(wk); }
        };
        wk.w.onerror = function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (wk.token !== token || fallback || state.cancelled) return;
          console.warn('a fit worker stopped:', ev && ev.message);
          inflight--;
          for (var k = start; k < end; k++) if (!results[k]) {
            if (tries[k]++) put(k, { id: jobs[k].id, ok: false, msg: CRASH_MSG }); else retry.push(k);
          }
          restart(wk);
          if (workers.length) workers.slice().forEach(function (w2) { if (!w2.busy) feed(w2); });
          else {                                         // no worker could be made: the rest on the main thread
            fallback = true; broken = true;
            mainThread(jobs, all.filter(function (k) { return !results[k]; }), results, onResult, onProgress, state, function () { resolve(results); });
          }
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
  // resolves with { ok: false, cancelled: true }. If its worker stops by itself, the fit is tried once more in a fresh
  // worker, then reported as failed. On the main thread (no workers at all) it cannot be stopped.
  function globalFit(job) {
    var settle = null, wk = null, finished = false, tries = 0;
    function finish(r) { if (finished) return; finished = true; if (wk) { wk.busy = false; wk.token = null; } settle(r); }
    function send() {
      var token = {};
      wk.busy = true; wk.token = token;
      wk.w.onmessage = function (e) { if (wk.token === token) finish(e.data.results[0]); };
      wk.w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (finished || wk.token !== token) return;
        console.warn('the global-fit worker stopped:', ev && ev.message);
        restart(wk);
        if (workers.indexOf(wk) < 0) wk = workers[0] || null;
        if (wk && !tries++) { send(); return; }                  // once more, in a fresh worker
        finish({ ok: false, msg: 'the global fit stopped its worker twice (out of memory?), so it was not done; the parameters are unchanged' });
      };
      wk.w.postMessage({ type: 'global', job: job });
    }
    var promise = new Promise(function (resolve) {
      settle = resolve;
      init();
      wk = workers[0] || null;
      if (broken || !wk) { wk = null; setTimeout(function () { if (!finished) finish(Y.globalFit.run(job)); }, 0); return; }
      send();
    });
    function cancel() {
      if (finished || !wk) return false;
      restart(wk);
      finish({ ok: false, cancelled: true, msg: 'stopped by the user' });
      return true;
    }
    return { promise: promise, cancel: cancel, global: true };
  }

  return { fitMany: fitMany, globalFit: globalFit, size: size, usingWorkers: function () { init(); return !broken && workers.length > 0; } };
})();
