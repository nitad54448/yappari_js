/*  Writers: text builders are DOM-free; download() uses the browser.
 *  Data export layout (read back by "Read data > Table with column headers"):
 *    #dataset <name>
 *    freq/Hz <sep> Zr <sep> Zi [<sep> sigma_Zr <sep> sigma_Zi] [<sep> Zr_calc <sep> Zi_calc] [<sep> masked]
 *    rows ...   (every point; masked ones have 1 in the masked column, which reading restores)
 */
Y.writers = (function () {
  'use strict';
  var SEP = { tab: '\t', comma: ',', semicolon: ';', space: ' ', auto: '\t' };

  // unit of Z in ASCII for text files, from the dataset normalization
  var NU = { area: 'Ohm.cm2', resist: 'Ohm.cm' }, NC = { area: 'F.cm-2', resist: 'F.cm-1' };
  function zu(norm) { return (norm && NU[norm.type]) || 'Ohm'; }
  function cu(norm) { return (norm && NC[norm.type]) || 'F'; }
  function normLine(norm) {
    return '#normalization ' + norm.type + ' k=' + e(norm.k) + (norm.A != null ? ' A=' + e(norm.A) : '') + (norm.L != null ? ' L=' + e(norm.L) : '') + ' unit=' + zu(norm);
  }
  function e(v) { return (typeof v === 'number' && isFinite(v)) ? v.toExponential(6).toUpperCase() : 'NaN'; }
  function stamp(d) {
    d = d || new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  function fileStamp() { return stamp().replace(/[-: ]/g, '').slice(0, 12); }

  // list: datasets; calcFor(ds) -> {re, im} at the data frequencies or null
  // opts: {sep, exp, calc, drt}; standard deviations are written when a dataset has them
  function dataText(list, opts, calcFor) {
    var s = SEP[opts.sep] || '\t', out = [], exp = opts.exp !== false;
    var anySig = exp && list.some(function (d) { return d.sr && d.si; });
    var anyMask = list.some(function (d) { return d.mask && d.mask.some(function (m) { return m; }); });
    list.forEach(function (ds) {
      var calc = opts.calc ? calcFor(ds) : null, sig = anySig && ds.sr && ds.si;
      out.push('#dataset ' + ds.name);
      if (ds.norm) out.push(normLine(ds.norm));
      var head = ['freq/Hz'];
      if (exp) head.push('Zr', 'Zi');
      // one token per column name, so a space-separated file reads back with the same columns
      if (anySig) head.push('sigma_Zr', 'sigma_Zi');
      if (calc) head.push('Zr_calc', 'Zi_calc');
      if (anyMask) head.push('masked');
      out.push(head.join(s));
      for (var k = 0; k < ds.f.length; k++) {
        var row = [e(ds.f[k])];
        if (exp) row.push(e(ds.zr[k]), e(ds.zi[k]));
        if (anySig) row.push(sig ? e(ds.sr[k]) : 'NaN', sig ? e(ds.si[k]) : 'NaN');
        if (calc) row.push(e(calc.re[k]), e(calc.im[k]));
        if (anyMask) row.push(ds.mask && ds.mask[k] ? '1' : '0');
        out.push(row.join(s));
      }
      out.push('');
      if (opts.drt && ds.drt) {
        var r = ds.drt;
        out.push('#drt ' + ds.name + ': ' + r.method + (r.method === 'gold' ? ', ' + r.iterations + ' iterations' : ', lambda ' + e(r.lambda)) +
                 ', data ' + r.source + ', Rinf ' + e(r.rinf) + ' Ohm, Rpol ' + e(r.rpol) + ' Ohm');
        out.push(['tau/s', 'f_tau/Hz', 'g(tau)', 'freq/Hz', 'drt_Zr', 'drt_Zi'].join(s));
        var nt = r.tau.length, nf = r.f.length;
        for (var j = 0; j < Math.max(nt, nf); j++) {
          out.push([j < nt ? e(r.tau[j]) : '', j < nt ? e(1 / (2 * Math.PI * r.tau[j])) : '', j < nt ? e(r.g[j]) : '',
                    j < nf ? e(r.f[j]) : '', j < nf ? e(r.zr[j]) : '', j < nf ? e(r.zi[j]) : ''].join(s));
        }
        out.push('');
      }
    });
    return out.join('\n');
  }

  // one line per dataset: name, R2, chi2_w, chi2_red, then value and SE% of every parameter
  function paramsText(list, names, info) {
    var out = ['Yappari JS - parameters saved : ' + stamp(),
               '# circuit: ' + info.cdc + '   method: ' + info.method + '   weight: ' + info.weight +
               (info.iter ? '   iterations, tolerance: ' + info.iter : '') + '   SE in % of the value'];
    var units = list.some(function (d) { return d.norm && NU[d.norm.type]; });
    var head = ['Dataset'].concat(units ? ['Z unit'] : [], ['R2', 'chi2_w', 'chi2_red']);
    names.forEach(function (n) { head.push(n, 'SE%_' + n); });
    out.push(head.join('\t'));
    list.forEach(function (ds) {
      var st = ds.stats, row = [ds.name].concat(units ? [zu(ds.norm)] : [], [st ? e(st.r2) : '', st ? e(st.chi2w) : '', st ? e(st.chi2red) : '']);
      names.forEach(function (n) {
        row.push(e(ds.p[n]));
        var se = st && st.se ? st.se[n] : undefined;
        row.push(st ? (st.bound && st.bound[n] ? 'at limit' : (se != null && isFinite(se) ? e(se) : (ds.fit[n] ? 'NaN' : 'fixed'))) : '');
      });
      out.push(row.join('\t'));
    });
    return out.join('\n') + '\n';
  }

  function arr(a) { return Array.prototype.slice.call(a); }

  // log: the lines of the Log kept for the project ({ t, kind, msg }, Y.ui.logEntries), without Restore buttons
  function projectJSON(state, log) {
    var m = state.model;
    var doc = {
      format: 'yappari-js-project', version: 1, saved: stamp(),
      settings: state.settings,
      model: { cdc: m.prog ? m.prog.cdc : '', limits: m.limits, shared: m.shared },
      datasets: state.datasets.map(function (ds) {
        return { name: ds.name, f: arr(ds.f), zr: arr(ds.zr), zi: arr(ds.zi), mask: arr(ds.mask),
                 sr: ds.sr ? arr(ds.sr) : null, si: ds.si ? arr(ds.si) : null, notes: ds.notes || [],
                 p: ds.p, fit: ds.fit, stats: ds.stats || null, norm: ds.norm || null };
      }),
      log: log || []
    };
    return JSON.stringify(doc);
  }

  // DRT of several datasets: a summary line per dataset (peaks side by side), then for each dataset the
  // distribution g(tau), the spectrum rebuilt from it and its peaks. items: [{name, r}]
  function drtText(items, sep, how) {
    var s = SEP[sep] || '\t', out = ['Yappari JS - DRT saved : ' + stamp(), '# ' + how + '; Rinf fitted with g (with Zi alone: mean of what remains of Zr), Rpol = area of g; peak R = Rpol x area of the peak, C = tau/R'], most = 0;
    items.forEach(function (it) { most = Math.max(most, it.r.peaks.length); });
    var U = zu(items[0] && items[0].norm), same = items.every(function (it) { return zu(it.norm) === U; }), ru = same ? '/' + U : '', fu = same ? '/' + cu(items[0] && items[0].norm) : '';
    var head = ['Dataset'].concat(same ? [] : ['Z unit'], ['Rinf' + ru, 'Rpol' + ru, 'misfit_rms', 'peaks']);
    for (var q = 1; q <= most; q++) head.push('f' + q + '/Hz', 'R' + q + ru, 'C' + q + fu);
    out.push('', '#summary', head.join(s));
    items.forEach(function (it) {
      var r = it.r, row = [it.name].concat(same ? [] : [zu(it.norm)], [e(r.rinf), e(r.rpol), e(r.err), String(r.peaks.length)]);
      r.peaks.forEach(function (p) { row.push(e(p.f), e(p.R), e(p.C)); });
      out.push(row.join(s));
    });
    items.forEach(function (it) {
      var r = it.r, j;
      out.push('', '#drt ' + it.name, ['tau/s', 'f_tau/Hz', 'g(tau)'].join(s));
      for (j = 0; j < r.tau.length; j++) out.push([e(r.tau[j]), e(1 / (2 * Math.PI * r.tau[j])), e(r.g[j])].join(s));
      out.push('', '#drt spectrum ' + it.name, ['freq/Hz', 'Zr', 'Zi', 'drt_Zr', 'drt_Zi'].join(s));
      for (j = 0; j < r.f.length; j++) out.push([e(r.f[j]), e(r.zrExp[j]), e(r.ziExp[j]), e(r.zr[j]), e(r.zi[j])].join(s));
      out.push('', '#drt peaks ' + it.name, ['f/Hz', 'tau/s', 'R/' + zu(it.norm), 'C/' + cu(it.norm), 'share_of_Rpol'].join(s));
      r.peaks.forEach(function (p) { out.push([e(p.f), e(p.tau), e(p.R), e(p.C), e(p.share)].join(s)); });
    });
    return out.join('\n') + '\n';
  }

  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // custom-format definition in the Yappari 5.1 (LabVIEW) XML layout, so one file serves both programs
  function definitionXML(def) {
    var si = ['space', 'comma', 'semicolon', 'tab'].indexOf(def.separator);
    function u8(name, v) { v = Math.max(0, Math.min(255, Math.round(+v || 0))); return ['<U8>', '<Name>' + name + '</Name>', '<Val>' + v + '</Val>', '</U8>']; }
    return ["<?xml version='1.0' standalone='yes' ?>", '<LVData xmlns="http://www.ni.com/LVData">', '<Version>23.1f276</Version>', '<Cluster>',
            '<Name>' + xmlEsc(def.cluster || 'custom datafile format') + '</Name>', '<NumElts>8</NumElts>',
            '<String>', '<Name>header</Name>', '<Val>' + xmlEsc(def.header) + '</Val>', '</String>']
      .concat(u8('label length', def.label_length),
              ['<EW>', '<Name>data_separator</Name>', '<Choice>space</Choice>', '<Choice>comma</Choice>', '<Choice>semicolon</Choice>',
               '<Choice>tab</Choice>', '<Val>' + (si < 0 ? 3 : si) + '</Val>', '</EW>'],
              u8('ignore first', def.ignore_first), u8('column_freq', def.column_freq), u8('column_Zr', def.column_zr),
              u8('column_Zi', def.column_zi), u8('ignore last', def.ignore_last), ['</Cluster>', '</LVData>'])
      .join('\r\n');
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  return { dataText: dataText, paramsText: paramsText, projectJSON: projectJSON, definitionXML: definitionXML, drtText: drtText, download: download,
           stamp: stamp, fileStamp: fileStamp, e: e };
})();
