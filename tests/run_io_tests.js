/* Readers / writers / data operations tests, called from run_core_tests.js */
'use strict';
module.exports = function (Y, ok, close) {
  const R = Y.readers;

  // 3 columns, several separators and decimal commas
  let d = R.threeColumns('Freq /Hz, Zr , Zi ; Name: sim_\n1.0E+3\t1.5E+2\t-2.0E+1\n1.0E+2\t2.5E+2\t-3.0E+1\n', 'a.dat', 'auto');
  ok(d.length === 1 && d[0].f.length === 2 && d[0].zi[1] === -30 && d[0].name === 'a', '3 columns, tab, header line skipped');
  d = R.threeColumns('1000 150,5 -20,25\n100 250,5 -30\n', 'b.txt', 'auto');
  ok(d[0].zr[0] === 150.5 && d[0].zi[0] === -20.25, '3 columns, spaces with decimal commas');
  d = R.threeColumns('1000;150,5;-20,25\n100;250;-30\n', 'c.csv', 'auto');
  ok(d[0].zr[0] === 150.5 && d[0].f[1] === 100, '3 columns, semicolons with decimal commas');
  d = R.threeColumns('1000,150.5,-20.25\n100,250,-30\n', 'd.csv', 'auto');
  ok(d[0].zr[0] === 150.5, '3 columns, commas');

  // Presentation tabs in a three-column header must not become data columns.
  const padded = 'Frequency\t\tReal_Z\t\t\tImag_Z\n';
  d = R.headerTable(padded + '1000000.000000000000\t1002.533025707866\t-1593.136948918278\n831763.771103000034\t1003.661331967358\t-1915.369734188152\n', 'example_3_columns_datafile.txt');
  ok(d.length === 1 && d[0].f.length === 2 && d[0].f[0] === 1000000 && d[0].zr[0] === 1002.533025707866 && d[0].zi[1] === -1915.369734188152, 'padded three-column header, single-tab data');
  d = R.headerTable(padded + '1000\t\t10\t\t\t-5\n100\t\t20\t\t\t-8\n', 'aligned.txt');
  ok(d[0].zr[0] === 10 && d[0].zi[1] === -8, 'matching empty header and data columns retain their positions');
  d = R.headerTable(padded + '1000\t10\t-5\n100\t\t-8\n10\t30\t-9\n', 'missing.txt');
  ok(d[0].f.length === 2 && d.skipped === 1 && d[0].zr[1] === 30, 'padded heading does not collapse missing numeric fields');
  d = R.headerTable('Frequency\tReal_Z\tImag_Z\n1000\t10\t\t-5\n100\t20\t-8\n', 'missing-extra.txt');
  ok(d[0].f.length === 1 && d.skipped === 1 && d[0].zi[0] === -8, 'separator inference does not collapse empty tab fields');

  // LabOne-like csv with chunks
  d = R.headerTable('chunk;timestamp;size;frequency;realz;imagz\n0;1;3;1000;10;-5\n0;2;3;100;20;-8\n1;3;3;1000;11;-6\n1;4;3;100;21;-9\n', 'dev3221_imps_0.csv');
  ok(d.length === 2 && d[1].zr[1] === 21 && d[0].name === 'dev3221_imps_0_0', 'MFLI-like csv split by chunk');

  // BioLogic-like, -Im(Z) column
  d = R.headerTable('EC-Lab ASCII FILE\nfreq/Hz\tRe(Z)/Ohm\t-Im(Z)/Ohm\t|Z|/Ohm\n1000\t10\t5\t11.2\n10\t30\t12\t32\n', 'bio.txt');
  ok(d[0].zi[0] === -5 && d[0].zi[1] === -12, 'BioLogic-like, -Im(Z) negated');

  // Gamry-like with units line
  d = R.headerTable('ZCURVE\tTABLE\n\tPt\tTime\tFreq\tZreal\tZimag\tZsig\n\t#\ts\tHz\tohm\tohm\tV\n\t0\t1\t100000\t10\t-2\t1\n\t1\t2\t1000\t15\t-4\t1\n', 'g.dta');
  ok(d.length === 1 && d[0].f[0] === 100000 && d[0].zi[1] === -4, 'Gamry-like table with units line');

  // round trip through our own export
  const mk = (name, n) => ({ name, f: Float64Array.from({ length: n }, (_, k) => 10 ** (5 - k)), zr: Float64Array.from({ length: n }, (_, k) => 100 + k),
                             zi: Float64Array.from({ length: n }, (_, k) => -k * 1.5), mask: new Uint8Array(n) });
  const a = mk('first set', 5), b = mk('second', 4);
  b.mask[2] = 1;
  const txt = Y.writers.dataText([a, b], { sep: 'tab', calc: true }, ds => ({ re: ds.zr.map(v => v + 1), im: ds.zi.map(v => v - 1) }));
  d = R.headerTable(txt, 'export.txt');
  ok(d.length === 2 && d[0].name === 'first set' && d[1].name === 'second' && d[1].f.length === 4 && d[1].mask && d[1].mask[2] === 1 &&
     d[1].mask.reduce((a, m) => a + m, 0) === 1 && !d[0].mask && d[0].zi[2] === -3, 'Save data export reads back (names, masked point kept and marked)');

  // custom: Z-MFLI example from the Yappari README
  const zm = 'Temp /K before measurement : 449.810\nmeasure started : 26/07/2023 18:33:58\nT34B descente\ntemp /K : 0.000\nfrequency /Hz, Real Z /Ohm, Im Z /Ohm\n1.000000E+6\t9.414706E+5\t-2.383074E+5\n8.154407E+5\t1.130474E+5\t-6.121182E+4\n\nend of measure : 26/07/2023 18:35:34\nTemp /K after measurement : 449.670 K\n----------\nTemp /K before measurement : 449.660\nmeasure started : 26/07/2023 18:36:07\nT34B descente\ntemp /K : 0.000\nfrequency /Hz, Real Z /Ohm, Im Z /Ohm\n1.000000E+6\t9.664908E+5\t-2.747448E+5\n8.154407E+5\t1.126409E+5\t-6.080259E+4\n6.649436E+5\t9.169096E+4\t-5.206284E+4\n\nend of measure : 26/07/2023 18:37:34\nTemp /K after measurement : 449.600 K\n----------\n';
  const tdef = o => R.normalizeModern(Object.assign({}, R.modernDefaults, { mode: 'repeatedHeader', label_source: 'afterHeader' }, o));
  d = R.custom(zm, 'ZMFLI_datafile_example.dat', tdef({ header: 'Temp /K before measurement : ', label_length: 6, separator: 'tab', ignore_first: 4, ignore_last: 4 }));
  ok(d.length === 2 && d[0].name === 'ZMFLI_datafile_example_449.81' && d[1].f.length === 3 && d[1].zi[2] === -5.206284E+4, 'custom Z-MFLI definition: ' + d.map(x => x.name + ':' + x.f.length).join(','));

  // custom: 5-column export, reading calculated columns
  const five = 'dev3221_imps_34, freq /Hz, Zr , Zi, Zr calc, Zi calc\n5.000000E+6;2.308040E+3;-4.358320E+3;2.656137E+3;-6.062695E+3\n4.304039E+6;2.506840E+3;-5.120760E+3;3.017911E+3;-6.767093E+3\ndev3221_imps_33, freq /Hz, Zr , Zi, Zr calc, Zi calc\n5.000000E+6;2.302790E+3;-4.372530E+3;2.825870E+3;-6.215076E+3\n';
  d = R.custom(five, 'example_custom_5_columns.dat', tdef({ header: 'dev3221_imps_', label_length: 2, separator: 'semicolon', column_zr: 4, column_zi: 5 }));
  ok(d.length === 2 && d[0].name.endsWith('_34') && d[0].zr[1] === 3.017911E+3 && d[1].zi[0] === -6.215076E+3, 'custom 5-column definition');

  // ZView .z
  d = R.zview('"ZPlot2 ASCII"\nSoftware: ZPlot\nEnd Comments\n1.0000E+05,  0.0000E+00,  0.0000E+00,  1.0,  1.2E+01, -3.4E+00, 0, 0, 1\n1.0000E+03,  0.0000E+00,  0.0000E+00,  2.0,  2.2E+01, -5.4E+00, 0, 0, 1\n', 'cell.z');
  ok(d.length === 1 && d[0].zr[1] === 22 && d[0].zi[0] === -3.4, 'ZView columns Z\', Z\'\'');

  // VersaStudio
  d = R.versa('<Application>x</Application>\n<Segment1>\nDefinition=Segment #, Point #, E(V), I(A), Frequency(Hz), Z Real, Z Imag\n1,0,0,0,1000,12.5,-3.5\n1,1,0,0,100,22.5,-8\n</Segment1>\n', 'v.par');
  ok(d.length === 1 && d[0].zr[0] === 12.5 && d[0].zi[1] === -8, 'VersaStudio segment');

  // Explicit File-menu vendor readers: no positional fallback.
  const gdta = 'EXPLAIN\nTAG\tEIS\nZCURVE\tTABLE\t2\n\tPt\tTime\tFreq\tZreal\tZimag\n\t#\ts\tHz\tohm\tohm\n\t0\t0\t1000\t12\t-3\n\t1\t1\t100\t20\t-8\n';
  d = R.gamryDTA(gdta, 'gamry.DTA');
  ok(d.length === 1 && d[0].f.length === 2 && d[0].zr[0] === 12 && d[0].zi[1] === -8, 'Gamry DTA reads heading and units rows');
  d = R.gamryDTA(gdta + gdta.replace('ZCURVE', 'ZCURVE1'), 'gamry.DTA');
  ok(d.length === 2 && d[1].name === 'gamry_1', 'Gamry multiple ZCURVE sections');
  let rejected = false;
  try { R.gamryDTA('1000 12 -3', 'bad.DTA'); } catch (e) { rejected = /ZCURVE/.test(e.message); }
  ok(rejected, 'Gamry rejects non-impedance input');
  const mpt = 'EC-Lab ASCII FILE\nNb header lines : 4\nPEIS\nfreq/Hz\tRe(Z)/Ohm\t-Im(Z)/Ohm\tcycle number\n1000\t12\t3\t1\n100\t20\t8\t1\n1000\t15\t4\t2\n100\t25\t9\t2\n';
  d = R.biologicMPT(mpt, 'bio.mpt');
  ok(d.length === 2 && d[0].f.length === 2 && d[1].zr[0] === 15 && d[1].zi[1] === -9, 'BioLogic header count, negative imaginary and cycle grouping');
  d = R.biologicMPT(mpt.replace('12\t3', '12,5\t3,5'), 'bio.mpt');
  ok(d[0].zr[0] === 12.5 && d[0].zi[0] === -3.5, 'BioLogic decimal commas');
  rejected = false;
  try { R.biologicMPT(mpt.replace('lines : 4', 'lines : 3'), 'bad.mpt'); } catch (e) { rejected = /header/.test(e.message); }
  ok(rejected, 'BioLogic rejects invalid header count');
  rejected = false;
  try { R.biologicMPT('BIO-LOGIC MODULAR FILE', 'bad.mpr'); } catch (e) { rejected = /binary/.test(e.message); }
  ok(rejected, 'BioLogic rejects binary MPR');

  // auto
  ok(R.auto('1 2 3\n4 5 6\n', 'x.txt', 'auto')[0].f.length === 2, 'auto falls back to 3 columns');

  // ---------- data operations ----------
  const O = Y.dataops;
  const fl = O.logspace(1e-2, 1e5, 71), ds = { name: 's', f: fl, zr: new Float64Array(71), zi: new Float64Array(71), mask: new Uint8Array(71) };
  fl.forEach((f, k) => { const x = Math.log10(f); ds.zr[k] = 100 / (1 + x * x * 0.1); ds.zi[k] = -10 * Math.exp(-((x - 1.5) ** 2)); });
  const sp = O.spline(ds, 200);
  let maxErr = 0;
  sp.f.forEach((f, k) => { const x = Math.log10(f); maxErr = Math.max(maxErr, Math.abs(sp.zr[k] - 100 / (1 + x * x * 0.1))); });
  ok(sp.f.length === 200 && maxErr < 0.05, 'log spline reproduces a smooth curve (max err ' + maxErr.toExponential(2) + ')');
  const q = { name: 'q', f: O.logspace(1, 1e4, 25), zr: new Float64Array(25), zi: new Float64Array(25), mask: new Uint8Array(25) };
  for (let k = 0; k < 25; k++) { q.zr[k] = 3 + 2 * k + 0.5 * k * k; q.zi[k] = -k; }
  const sm = O.smooth(q, 5, 2);
  ok(sm.zr.every((v, k) => Math.abs(v - (3 + 2 * k + 0.5 * k * k)) < 1e-8), 'Savitzky-Golay keeps a quadratic unchanged (edges included)');
  const av = O.average([q, { name: 'q2', f: q.f, zr: q.zr.map(v => v + 2), zi: q.zi, mask: q.mask }]);
  ok(av.zr[3] === q.zr[3] + 1, 'average');
  const iv = O.inView(q, 'zr', { x0: 10, x1: 100, y0: -1e9, y1: 1e9 });
  ok(iv.count === 7, 'points inside a view (' + iv.count + ')');
  const q2 = { f: Float64Array.from(q.f), zr: Float64Array.from(q.zr), zi: Float64Array.from(q.zi), mask: new Uint8Array(25) };
  O.removePoints(q2, iv);
  ok(q2.f.length === 18 && q2.mask.length === 18, 'remove points');

  // ---------- example files shipped in files/ (from the LabVIEW Yappari) ----------
  const fs = require('fs'), path = require('path'), FILES = path.join(__dirname, '..', 'files');
  const rd = f => fs.readFileSync(path.join(FILES, f), 'utf8'), counts = d => d.map(x => x.f.length).join(',');
  // sample files that are not in files/ are skipped (named in the output), the other checks still run
  const has = f => { const yes = fs.existsSync(path.join(FILES, f)); if (!yes) console.log('  skipped, not in files/: ' + f); return yes; };
  const mfli = 'MFLI_Zview_txt_imps_0_sample_00000.txt';
  if (has(mfli)) ['zview', 'threeColumns', 'headerTable', 'auto'].forEach(k => {
    const m = R[k](rd(mfli), mfli, 'auto');
    ok(m.length === 1 && m[0].f.length === 120 && m[0].zr[0] === 2623.363 && m[0].zi[119] === -867096.8, 'MFLI ZView file via ' + k);
  });
  const DEFS = path.join(__dirname, '..', 'config', 'definitions'), rdef = f => fs.readFileSync(path.join(DEFS, f), 'utf8');
  if (typeof DOMParser === 'undefined') require('./xml_shim.js');
  const dz = R.parseDefinition(rdef('SP2M_ZHT_Mfli.xml')), dh = R.parseDefinition(rdef('SP2M_HP4192a.xml'));
  ok(dz.header === 'Temp /K before measurement : ' && dz.label_length === 6 && dz.separator === 'tab' && dz.ignore_first === 4 && dz.ignore_last === 4, 'Z-MFLI XML definition');
  ok(dh.header === 'Frequency /Hz, Z_r, Z_im, cycle :' && dh.label_length === 4 && dh.column_zi === 3, 'HP 4192A XML definition');
  ok(Y.writers.definitionXML(dz).includes('<impedanceFormat version="3">') && Y.writers.definitionXML(dh).includes('<frequency column="1" unit="Hz"/>'), 'definitions export as native XML version 3');
  if (has('Z_MFLI.txt')) {
    const zmf = R.custom(rd('Z_MFLI.txt'), 'Z_MFLI.txt', dz);
    ok(zmf.map(x => x.name).join() === 'Z_MFLI_449.81,Z_MFLI_449.66' && counts(zmf) === '19,14' && zmf[1].zi[13] === -9479.804, 'Z_MFLI with its definition, cut-short last dataset kept whole');
    ok(counts(R.auto(rd('Z_MFLI.txt'), 'Z_MFLI.txt')) === '19,14', 'Z_MFLI dropped without definition');
  }
  if (has('hp4192a.txt')) {
    const hp = R.custom(rd('hp4192a.txt'), 'hp4192a.txt', dh);
    ok(hp.map(x => x.name).join() === 'hp4192a_0,hp4192a_1,hp4192a_2' && counts(hp) === '14,9,9', 'hp4192a with its definition');
    ok(counts(R.auto(rd('hp4192a.txt'), 'hp4192a.txt')) === '14,9,9', 'hp4192a dropped without definition');
  }
  let legacy = false; try { R.parseDefinition('[header]=Freq /Hz\n'); } catch (e) { legacy = true; }
  ok(legacy, 'old .ini definitions are rejected');
  ok(R.lines('a\r\r\nb\r\nc\rd').join('|') === 'a|b|c|d', 'line endings \\r\\r\\n, \\r\\n and \\r');

  // VersaStudio: a real file; Z Real, Z Imag must equal E/I
  if (has('type_VersaStudio.par')) {
    const par = rd('type_VersaStudio.par'), vp = R.versa(par, 'type_VersaStudio.par');
    const segRows = par.split('<Segment1>')[1].split('</Segment1>')[0].split(/\r?\n/).filter(l => /^-?\d/.test(l.trim())).map(l => l.split(',').map(Number));
    ok(vp.length === 1 && vp[0].name === 'type_VersaStudio' && vp[0].f.length === segRows.filter(v => v[9] > 0).length && vp[0].f[0] === 100000 &&
       vp[0].zr[0] === 55.31571 && vp[0].zi[0] === 4.575431, 'VersaStudio .par, ' + vp[0].f.length + ' points');
    let worst = 0;
    segRows.forEach(v => { const d = v[12] ** 2 + v[13] ** 2, zr = (v[10] * v[12] + v[11] * v[13]) / d, zi = (v[11] * v[12] - v[10] * v[13]) / d, m = Math.hypot(v[14], v[15]);
                           worst = Math.max(worst, Math.abs(zr - v[14]) / m, Math.abs(zi - v[15]) / m); });
    ok(worst < 1e-4, 'VersaStudio Z columns equal E/I, same sign convention (max rel. diff ' + worst.toExponential(1) + ')');
    ok(counts(R.auto(par, 'type_VersaStudio.par')) === String(vp[0].f.length), 'VersaStudio recognised automatically');
  }
  // MFLI csv: the sample stops before the frequency, realz and imagz lines -> a message naming what is there
  if (has('mfli_imps_csv.txt')) {
    let msg = '';
    try { R.mfliCsv(rd('mfli_imps_csv.txt'), 'mfli_imps_csv.txt'); } catch (e) { msg = e.message; }
    ok(/abszpwr/.test(msg) && /frequency/.test(msg), 'MFLI csv sample without frequency lines explains why');
  }
  // the same layout, complete (generated): 3 sweeps of 12 points, the last 2 still nan
  const mkCsv = (sep, withZ) => {
    const n = 12, out = ['chunk' + sep + 'timestamp' + sep + 'size' + sep + 'fieldname' + sep.repeat(n)];
    for (let c = 0; c < 3; c++) {
      const f = [...Array(n)].map((_, k) => 10 ** (6 - 7 * k / (n - 1)));
      const z = f.map(fk => { const wt = 2 * Math.PI * fk * 1e-4, R2 = 1000 * (1 + 0.1 * c), d = 1 + wt * wt; return [100 + R2 / d, -R2 * wt / d]; });
      const row = (name, v) => [c, 11257490332120 + c, n, name].concat(v.map((x, k) => k >= n - 2 ? 'nan' : String(x))).join(sep);
      out.push(row('absz', z.map(q => Math.hypot(q[0], q[1]))), row('frequency', f), row('grid', f));
      if (withZ) out.push(row('imagz', z.map(q => q[1])));
      out.push(row('phasez', z.map(q => Math.atan2(q[1], q[0]))));
      if (withZ) out.push(row('realz', z.map(q => q[0])));
    }
    return out.join('\r\n') + '\r\n';
  };
  [[';', true], [',', true], [';', false]].forEach(([sep, withZ]) => {
    const d = R.mfliCsv(mkCsv(sep, withZ), 'imps.csv'), wt = 2 * Math.PI * 1e6 * 1e-4;
    ok(d.map(x => x.name).join() === 'imps_0,imps_1,imps_2' && counts(d) === '10,10,10' &&
       Math.abs(d[2].zr[0] - (100 + 1200 / (1 + wt * wt))) < 1e-9 && Math.abs(d[2].zi[9] - (-1200 * (2 * Math.PI * d[2].f[9] * 1e-4) / (1 + (2 * Math.PI * d[2].f[9] * 1e-4) ** 2))) < 1e-9,
       'MFLI csv, separator ' + sep + (withZ ? ', realz/imagz' : ', from absz/phasez'));
  });
  ok(counts(R.auto(mkCsv(';', true), 'imps.csv')) === '10,10,10' && counts(R.headerTable(mkCsv(';', true), 'imps.csv')) === '10,10,10', 'MFLI csv recognised automatically and by the table reader');
};
