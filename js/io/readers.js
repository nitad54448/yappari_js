/*  File readers. Each returns an array of { name, f, zr, zi } (Float64Arrays; Zi as measured, i.e.
 *  negative for capacitive behaviour). Decimal commas are accepted whenever the field separator is not a comma.
 *  Custom-format definitions are read from Yappari 5.1 XML files (LabVIEW; also written by
 *  writers.definitionXML), from the older .ini form, or from JSON.  DOM-free.
 */
Y.readers = (function () {
  'use strict';
  var SEP_LABEL = { auto: 'auto', tab: 'TAB', space: 'space', comma: ',', semicolon: ';' };
  var SEPARATORS = ['space', 'comma', 'semicolon', 'tab'];            // order of the Yappari 5.1 enum

  // \r\n, \r\r\n (MFLI ZView exports) and a lone \r all end a line
  function lines(text) { return String(text).replace(/\r+\n/g, '\n').replace(/\r/g, '\n').split('\n'); }
  function baseName(name) { return String(name || 'data').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, ''); }

  function num(s, decComma) {
    if (s == null) return NaN;
    s = String(s).trim().replace(/^"|"$/g, '');
    if (!s) return NaN;
    if (decComma) s = s.replace(',', '.');
    return Number(s);
  }

  function splitter(sep) {
    if (sep === 'tab') return function (l) { return l.split('\t'); };
    if (sep === 'comma') return function (l) { return l.split(','); };
    if (sep === 'semicolon') return function (l) { return l.split(';'); };
    return function (l) { return l.trim().split(/\s+/); };
  }

  function numericFields(line, sep) {
    return splitter(sep)(line).filter(function (x) { return x.trim() !== ''; })
      .map(function (x) { return num(x, sep !== 'comma'); });
  }

  // the separator that gives >= 3 numeric fields on most data-like lines
  function detectSeparator(L) {
    var cands = ['tab', 'semicolon', 'comma', 'space'], score = [0, 0, 0, 0], seen = 0;
    for (var i = 0; i < L.length && seen < 40; i++) {
      var t = L[i].trim();
      if (!/^[-+.]?\d/.test(t)) continue;
      seen++;
      cands.forEach(function (c, j) {
        var v = numericFields(L[i], c);
        if (v.length >= 3 && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2])) score[j]++;
      });
    }
    var best = 0;
    for (var j = 1; j < 4; j++) if (score[j] > score[best]) best = j;
    return cands[best];
  }

  // sr, si: standard deviations of Zr and Zi (NaN where unknown), kept when at least one is given
  function pack(name, f, zr, zi, sr, si) {
    var o = { name: name, f: Float64Array.from(f), zr: Float64Array.from(zr), zi: Float64Array.from(zi) };
    if (sr && si && (sr.some(function (v) { return v > 0; }) || si.some(function (v) { return v > 0; }))) { o.sr = Float64Array.from(sr); o.si = Float64Array.from(si); }
    return o;
  }

  function looksZView(text) { return /ZPLOT|^[ \t]*End Comments[ \t]*$/im.test(String(text).slice(0, 6000)); }

  // ---------------------------------------------------------------- 3 columns: f, Zr, Zi (one dataset per file)
  function threeColumns(text, fileName, sep) {
    if (looksZView(text)) return zview(text, fileName);   // ZView layout: f, then Z' and Z'' in columns 5 and 6
    var L = lines(text), s = (!sep || sep === 'auto') ? detectSeparator(L) : sep, f = [], zr = [], zi = [];
    L.forEach(function (line) {
      if (!line.trim()) return;
      var v = numericFields(line, s);
      if (v.length >= 3 && v[0] > 0 && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2])) { f.push(v[0]); zr.push(v[1]); zi.push(v[2]); }
    });
    if (!f.length) throw new Error(baseName(fileName) + ': no rows with three numbers (separator ' + SEP_LABEL[s] + ')');
    return [pack(baseName(fileName), f, zr, zi)];
  }

  // ---------------------------------------------------------------- tables with a column header
  function isFreq(s) { return /freq/.test(s) || /^f($|[\/(\[_])/.test(s); }
  function isImag(s) { return /imag/.test(s) || /^-?im\(?z/.test(s) || /^-?z''/.test(s) || /^-?z_?i($|[\/(\[_])/.test(s) || /^-?z_?im/.test(s); }
  function isReal(s) { return /real/.test(s) || /^re\(?z/.test(s) || /^z'($|[^'])/.test(s) || /^z_?r($|[\/(\[_])/.test(s) || /^z_?re/.test(s); }

  function parseHeader(line) {
    if (!/[A-Za-z]/.test(line)) return null;
    var sep = line.indexOf('\t') >= 0 ? 'tab' : line.indexOf(';') >= 0 ? 'semicolon' : line.indexOf(',') >= 0 ? 'comma' : 'space';
    var cols = splitter(sep)(line).map(function (c) { return c.trim().toLowerCase().replace(/^"|"$/g, '').replace(/\s+/g, ''); });
    var h = { sep: sep, n: cols.length, cf: -1, cr: -1, ci: -1, cc: -1, sr: -1, si: -1, neg: false };
    cols.forEach(function (s, k) {
      if (!s || /calc|fit|sim|pwr/.test(s)) return;
      if (/stddev|sigma|^σ/.test(s)) {                         // standard deviation columns
        if (h.sr < 0 && /real|zr|z'(?!')/.test(s)) h.sr = k;
        else if (h.si < 0 && /imag|zi|z''/.test(s)) h.si = k;
        return;
      }
      if (h.cc < 0 && s === 'chunk') { h.cc = k; return; }
      if (h.cf < 0 && isFreq(s)) { h.cf = k; return; }
      if (h.ci < 0 && isImag(s)) { h.ci = k; h.neg = s.charAt(0) === '-'; return; }
      if (h.cr < 0 && isReal(s)) { h.cr = k; }
    });
    if (h.cf < 0 || h.cr < 0 || h.ci < 0) return null;
    h.maxCol = Math.max(h.cf, h.cr, h.ci, h.cc);
    return h;
  }

  // the separator that splits a data line into as many fields as the header has columns
  // (some programs write a comma-separated title above tab-separated numbers)
  function dataSep(line, h) {
    var c = [h.sep, 'tab', 'semicolon', 'comma', 'space'];
    for (var k = 0; k < c.length; k++) if (splitter(c[k])(line).length === h.n) return c[k];
    return h.sep;
  }

  function nameLine(t) { var m = /^#\s*dataset\s*[:=]?\s*(.+)$/i.exec(t); return m ? m[1].trim() : null; }

  // Every header line (frequency + real + imaginary columns) starts a dataset that runs to the next header;
  // text lines in between are skipped. A "chunk" column (Zurich Instruments LabOne) splits sweeps into datasets.
  // A line "#dataset name" just above a header names the dataset (format written by Save data).
  function headerTable(text, fileName) {
    if (isMfliCsv(text)) return mfliCsv(text, fileName);
    var L = lines(text), out = [], base = baseName(fileName), i = 0, pendingName = null, count = 0;
    while (i < L.length) {
      var nm = nameLine(L[i].trim());
      if (nm) { pendingName = nm; i++; continue; }
      var h = parseHeader(L[i]);
      if (!h) { i++; continue; }
      var j, sep = h.sep;
      for (j = i + 1; j < L.length; j++) {
        var t0 = L[j].trim();
        if (/^[-+.]?\d/.test(t0)) { sep = dataSep(L[j], h); break; }
        if (nameLine(t0) || parseHeader(L[j])) break;
      }
      var split = splitter(sep), dc = sep !== 'comma', rows = [];
      for (j = i + 1; j < L.length; j++) {
        var t = L[j].trim();
        if (!t) continue;
        var fields = split(L[j]), ok = fields.length > h.maxCol, fv, rv, iv;
        if (ok) {
          fv = num(fields[h.cf], dc); rv = num(fields[h.cr], dc); iv = num(fields[h.ci], dc);
          ok = fv > 0 && isFinite(fv) && isFinite(rv) && isFinite(iv);
        }
        if (ok) {
          rows.push([fv, rv, h.neg ? -iv : iv, h.cc >= 0 ? String(fields[h.cc]).trim() : '',
                     h.sr >= 0 && fields.length > h.sr ? num(fields[h.sr], dc) : NaN, h.si >= 0 && fields.length > h.si ? num(fields[h.si], dc) : NaN]);
          continue;
        }
        if (nameLine(t) || parseHeader(L[j])) break;
      }
      if (rows.length) {
        var groups = [], byKey = {};
        rows.forEach(function (r) {
          if (!(r[3] in byKey)) { byKey[r[3]] = groups.length; groups.push([]); }
          groups[byKey[r[3]]].push(r);
        });
        groups.forEach(function (g) {
          var name = pendingName && groups.length === 1 ? pendingName : base + '_' + count;
          out.push(pack(name, g.map(function (r) { return r[0]; }), g.map(function (r) { return r[1]; }), g.map(function (r) { return r[2]; }),
                        g.map(function (r) { return r[4]; }), g.map(function (r) { return r[5]; })));
          count++;
        });
      }
      pendingName = null;
      i = j;
    }
    if (!out.length) throw new Error(base + ': no column header with frequency, real and imaginary impedance found');
    return out;
  }

  // ---------------------------------------------------------------- Zurich Instruments MFLI / MFIA csv (LabOne)
  // Sweeper export with one line per field and sweep:  chunk;timestamp;size;fieldname;v1;v2;...  (';' or ',')
  // Each chunk is a dataset (name_0, name_1 ...); f from "frequency" (or "grid"), Z from "realz" and "imagz"
  // (or "absz" and "phasez"). Points still nan (sweep not finished) are skipped. A layout with one column
  // per field is read by headerTable instead.
  function isMfliCsv(text) { var h = String(text).slice(0, 3000); return /^\s*"?chunk"?\s*[;,\t]/im.test(h) && /fieldname/i.test(h); }

  function mfliCsv(text, fileName) {
    var L = lines(text), base = baseName(fileName), h = -1, m = null;
    for (var i = 0; i < L.length && i < 50; i++) { m = /^\s*"?chunk"?\s*([;,\t])/i.exec(L[i]); if (m) { h = i; break; } }
    if (h < 0) throw new Error(base + ': not an MFLI csv file, the "chunk;timestamp;size;fieldname" line is missing');
    var sep = m[1], dc = sep !== ',';
    var head = L[h].split(sep).map(function (s) { return s.trim().replace(/^"|"$/g, '').toLowerCase(); });
    var iC = head.indexOf('chunk'), iS = head.indexOf('size'), iF = head.indexOf('fieldname');
    if (iF < 0) return headerTable(text, fileName);
    var chunks = {}, order = [];
    for (var j = h + 1; j < L.length; j++) {
      var p = L[j].split(sep);
      if (p.length <= iF + 1) continue;
      var ch = p[iC].trim(), field = p[iF].trim().replace(/^"|"$/g, '').toLowerCase();
      if (!(ch in chunks)) { chunks[ch] = {}; order.push(ch); }
      var vals = p.slice(iF + 1), size = iS >= 0 ? parseInt(p[iS], 10) : NaN;
      if (size > 0) vals = vals.slice(0, size);
      chunks[ch][field] = vals.map(function (x) { return num(x, dc); });
    }
    var out = [];
    order.forEach(function (ch) {
      var c = chunks[ch], f = c.frequency || c.grid, zr = c.realz, zi = c.imagz;
      if (!f) return;
      if (!zr || !zi) {
        if (!c.absz || !c.phasez) return;
        var deg = c.phasez.some(function (v) { return Math.abs(v) > 6.3; }), ph = c.phasez.map(function (v) { return deg ? v * Math.PI / 180 : v; });
        zr = c.absz.map(function (a, k) { return a * Math.cos(ph[k]); });
        zi = c.absz.map(function (a, k) { return a * Math.sin(ph[k]); });
      }
      var sR = c.realzstddev || c.abszstddev, sI = c.imagzstddev || c.abszstddev, F = [], R = [], I = [], SR = [], SI = [];
      for (var k = 0; k < f.length; k++) if (f[k] > 0 && isFinite(f[k]) && isFinite(zr[k]) && isFinite(zi[k])) {
        F.push(f[k]); R.push(zr[k]); I.push(zi[k]); SR.push(sR ? sR[k] : NaN); SI.push(sI ? sI[k] : NaN);
      }
      if (F.length) out.push(pack(base + '_' + ch, F, R, I, SR, SI));
    });
    if (!out.length) {
      var fields = order.length ? Object.keys(chunks[order[0]]).join(', ') : 'none';
      throw new Error(base + ': no sweep with a frequency line and realz, imagz (or absz, phasez) lines. Lines found: ' + fields + '.');
    }
    return out;
  }

  // ---------------------------------------------------------------- numeric blocks (automatic reading)
  // Runs of rows with f, Zr, Zi in the first three columns, separated by text lines. Blank lines and lines
  // without letters that are not numbers ("...", "-----") do not end a run.
  function numericBlocks(text, fileName, sep) {
    var L = lines(text), s = (!sep || sep === 'auto') ? detectSeparator(L) : sep, blocks = [], cur = null, base = baseName(fileName);
    L.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var v = numericFields(line, s);
      if (v.length >= 3 && v[0] > 0 && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2])) {
        if (!cur) { cur = { f: [], zr: [], zi: [] }; blocks.push(cur); }
        cur.f.push(v[0]); cur.zr.push(v[1]); cur.zi.push(v[2]);
      } else if (/[A-Za-z]/.test(t)) cur = null;
    });
    var good = blocks.filter(function (b) { return b.f.length >= 2; });
    if (!good.length) throw new Error(base + ': no rows with three numbers');
    return good.map(function (b, k) { return pack(good.length > 1 ? base + '_' + k : base, b.f, b.zr, b.zi); });
  }

  // ---------------------------------------------------------------- ZView (.z) and MFLI ZView (.txt)
  // Each run of numeric lines is one dataset; with >= 6 columns the ZView layout is used
  // (Freq, Ampl, Bias, Time, Z', Z'' ...), otherwise f, Zr, Zi.
  function zview(text, fileName) {
    var blocks = [], cur = null, base = baseName(fileName);
    lines(text).forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var vals = t.split(/[,;\t ]+/).filter(Boolean).map(function (x) { return num(x, false); });
      var numeric = vals.length >= 3 && vals.every(function (v) { return isFinite(v); });
      if (numeric) { if (!cur) { cur = []; blocks.push(cur); } cur.push(vals); } else cur = null;
    });
    var out = [];
    blocks.forEach(function (b) {
      var c = b[0].length >= 6 ? [0, 4, 5] : [0, 1, 2], f = [], zr = [], zi = [];
      b.forEach(function (v) { if (v[c[0]] > 0 && v.length > c[2]) { f.push(v[c[0]]); zr.push(v[c[1]]); zi.push(v[c[2]]); } });
      if (f.length >= 2) out.push(pack(blocks.length > 1 ? base + '_' + out.length : base, f, zr, zi));
    });
    if (!out.length) throw new Error(base + ': no numeric data block found');
    return out;
  }

  // ---------------------------------------------------------------- VersaStudio .par
  function versa(text, fileName) {
    var re = /<Segment(\d*)>([\s\S]*?)<\/Segment\1>/gi, m, out = [], base = baseName(fileName);
    while ((m = re.exec(text))) {
      var def = null, rows = [];
      lines(m[2]).forEach(function (line) {
        var t = line.trim();
        if (/^Definition\s*=/i.test(t)) {
          def = t.replace(/^Definition\s*=\s*/i, '').split(',').map(function (s) { return s.trim().toLowerCase().replace(/\s+/g, ''); });
        } else if (def && /^[-+.\d]/.test(t)) rows.push(t.split(',').map(function (x) { return num(x, false); }));
      });
      if (!def || !rows.length) continue;
      var find = function (rx) { for (var k = 0; k < def.length; k++) if (rx.test(def[k])) return k; return -1; };
      var cf = find(/freq/), cr = find(/^zreal|^z'$|^zre/), ci = find(/^zimag|^z''$|^zim/);
      var er = find(/^ereal/), ei = find(/^eimag/), ir = find(/^ireal/), ii = find(/^iimag/);
      if (cf < 0 || ((cr < 0 || ci < 0) && (er < 0 || ei < 0 || ir < 0 || ii < 0))) continue;
      var f = [], zr = [], zi = [];
      rows.forEach(function (v) {
        if (!(v[cf] > 0)) return;
        var a, b;
        if (cr >= 0 && ci >= 0) { a = v[cr]; b = v[ci]; }
        else {
          var d = v[ir] * v[ir] + v[ii] * v[ii];
          a = (v[er] * v[ir] + v[ei] * v[ii]) / d; b = (v[ei] * v[ir] - v[er] * v[ii]) / d;
        }
        if (isFinite(a) && isFinite(b)) { f.push(v[cf]); zr.push(a); zi.push(b); }
      });
      if (f.length) out.push(pack(base + '_' + out.length, f, zr, zi));
    }
    if (!out.length) throw new Error(base + ': no <Segment> with frequency and impedance columns found');
    if (out.length === 1) out[0].name = base;
    return out;
  }

  // ---------------------------------------------------------------- custom formats
  // Definition fields, as in the Yappari 5.1 XML: header, label_length, separator (space|comma|semicolon|tab),
  // ignore_first, column_freq, column_zr, column_zi (columns count from 1), ignore_last.
  var PRESETS = {
    'Z-MFLI (Z_MFLI_datafile_example_template.xml)': { header: 'Temp /K before measurement : ', label_length: 6, separator: 'tab', ignore_first: 4, column_freq: 1, column_zr: 2, column_zi: 3, ignore_last: 4 },
    'HP 4192A (custom_hp4192a.xml)': { header: 'Frequency /Hz, Z_r, Z_im, cycle :', label_length: 4, separator: 'tab', ignore_first: 0, column_freq: 1, column_zr: 2, column_zi: 3, ignore_last: 0 },
    'Yappari multiple datasets file (Freq /Hz, Zr , Zi ; Name:)': { header: 'Freq /Hz, Zr , Zi ; Name: ', label_length: 30, separator: 'tab', ignore_first: 0, column_freq: 1, column_zr: 2, column_zi: 3, ignore_last: 0 },
    'Yappari 5-column export, calculated Z (dev3221_imps_)': { header: 'dev3221_imps_', label_length: 2, separator: 'semicolon', ignore_first: 0, column_freq: 1, column_zr: 4, column_zi: 5, ignore_last: 0 }
  };

  // The text before the first header is ignored; each header occurrence (it can sit inside a longer line)
  // starts a dataset. label_length characters after the header name the dataset. ignore_first lines are
  // skipped after the header line and ignore_last lines at the end of each dataset, except when those last
  // lines are all data: a dataset cut short (end of file) keeps all its points.
  function custom(text, fileName, def) {
    if (!def || !def.header) throw new Error('the definition needs a header text that separates the datasets');
    var src = String(text), header = String(def.header), parts = src.split(header), base = baseName(fileName), out = [];
    if (parts.length < 2 && header.trim() && header.trim() !== header) { header = header.trim(); parts = src.split(header); }
    parts.shift();
    if (!parts.length) throw new Error(base + ': header "' + def.header + '" not found');
    var cf = (def.column_freq || 1) - 1, cr = (def.column_zr || 2) - 1, ci = (def.column_zi || 3) - 1, nl = def.ignore_last || 0;
    parts.forEach(function (block, idx) {
      var L = lines(block);
      var label = def.label_length > 0 ? L[0].replace(/^\s+/, '').slice(0, def.label_length).trim() : '';
      var body = L.slice(1);
      while (body.length && !body[body.length - 1].trim()) body.pop();
      body = body.slice(def.ignore_first || 0);
      var sep = (!def.separator || def.separator === 'auto') ? detectSeparator(body) : def.separator;
      var split = splitter(sep), dc = sep !== 'comma';
      var row = function (line) {
        var fl = split(line);
        if (sep === 'space') fl = fl.filter(Boolean);
        var a = num(fl[cf], dc), b = num(fl[cr], dc), c = num(fl[ci], dc);
        return a > 0 && isFinite(a) && isFinite(b) && isFinite(c) ? [a, b, def.negate_zi ? -c : c] : null;
      };
      if (nl > 0 && !(body.length >= nl && body.slice(body.length - nl).every(row))) body = body.slice(0, Math.max(0, body.length - nl));
      var f = [], zr = [], zi = [];
      body.forEach(function (line) {
        if (!line.trim()) return;
        var r = row(line);
        if (r) { f.push(r[0]); zr.push(r[1]); zi.push(r[2]); }
      });
      if (f.length) out.push(pack(base + '_' + (label || idx), f, zr, zi));
    });
    if (!out.length) throw new Error(base + ': the header was found but no numeric rows in columns ' + (cf + 1) + ', ' + (cr + 1) + ', ' + (ci + 1));
    return out;
  }

  // ---------------------------------------------------------------- definition files
  function decodeXML(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (m, x) { return String.fromCharCode(parseInt(x, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); }).replace(/&amp;/g, '&');
  }

  // Yappari 5.1 definition: LabVIEW XML of a cluster (header, label length, data_separator, ignore first,
  // column_freq, column_Zr, column_Zi, ignore last). Element names are matched loosely.
  function fromXML(t) {
    if (!/<LVData/i.test(t)) throw new Error('not a Yappari 5.1 definition (LabVIEW XML)');
    var f = {}, re = /<(String|U8|U16|U32|U64|I8|I16|I32|I64|DBL|SGL|EW|EB|EL|Boolean)>\s*<Name>([\s\S]*?)<\/Name>([\s\S]*?)<\/\1>/g, m;
    while ((m = re.exec(t))) {
      var vm = /<Val>([\s\S]*?)<\/Val>/.exec(m[3]);
      if (!vm) continue;
      var val = decodeXML(vm[1]);
      if (/^E[WBL]$/.test(m[1])) {
        var ch = [], cre = /<Choice>([\s\S]*?)<\/Choice>/g, c;
        while ((c = cre.exec(m[3]))) ch.push(decodeXML(c[1]).trim().toLowerCase());
        if (ch[+val] != null) val = ch[+val];
      }
      f[decodeXML(m[2]).toLowerCase().replace(/[^a-z]/g, '')] = val;
    }
    var cl = /<Cluster>\s*<Name>([\s\S]*?)<\/Name>/.exec(t);
    return { header: f.header, label_length: f.labellength, separator: f.dataseparator || f.separator,
             ignore_first: f.ignorefirst, ignore_last: f.ignorelast, column_freq: f.columnfreq,
             column_zr: f.columnzr, column_zi: f.columnzi, cluster: cl ? decodeXML(cl[1]) : undefined };
  }

  // older Yappari .ini definitions:  [header]=...  [label_length]=0  #data_columns=1,2,3
  function fromINI(t) {
    var d = {};
    lines(t).forEach(function (l) {
      var m = /^\s*(?:\[([^\]]+)\]|#?\s*([A-Za-z_ ]+?))\s*=(.*)$/.exec(l);
      if (!m) return;
      var key = (m[1] || m[2]).toLowerCase().replace(/[^a-z]/g, ''), val = m[3];
      if (key === 'header') d.header = val;
      else if (key === 'datacolumns' || key === 'columns') { var c = val.split(/[,;\s]+/).filter(Boolean).map(Number); d.column_freq = c[0]; d.column_zr = c[1]; d.column_zi = c[2]; }
      else if (key === 'labellength') d.label_length = val;
      else if (key === 'ignorefirst') d.ignore_first = val;
      else if (key === 'ignorelast') d.ignore_last = val;
      else if (key === 'separator' || key === 'dataseparator') d.separator = val;
    });
    return d;
  }

  function normalizeDef(d) {
    if (!d || d.header == null || String(d.header) === '') throw new Error('the definition has no header text');
    var raw = d.separator == null ? 'tab' : String(d.separator);
    var sep = { '\t': 'tab', ',': 'comma', ';': 'semicolon', ' ': 'space' }[raw] || raw.trim().toLowerCase();
    if (['space', 'comma', 'semicolon', 'tab', 'auto'].indexOf(sep) < 0) sep = 'tab';
    var int = function (v, dflt) { v = Number(v); return isFinite(v) && v >= 0 ? Math.round(v) : dflt; };
    return { header: String(d.header), label_length: int(d.label_length, 0), separator: sep, ignore_first: int(d.ignore_first, 0),
             column_freq: int(d.column_freq, 1) || 1, column_zr: int(d.column_zr, 2) || 2, column_zi: int(d.column_zi, 3) || 3,
             ignore_last: int(d.ignore_last, 0), negate_zi: !!d.negate_zi, cluster: d.cluster };
  }

  function parseDefinition(text) {
    var t = String(text).replace(/^\uFEFF/, '').trim(), d;
    if (t.charAt(0) === '<') d = fromXML(t);
    else if (t.charAt(0) === '{') d = JSON.parse(t);
    else d = fromINI(t);
    return normalizeDef(d);
  }

  // ---------------------------------------------------------------- automatic choice (files dropped on the window)
  function auto(text, fileName, sep) {
    if (/<Segment\d*>/i.test(text)) return versa(text, fileName);
    if (looksZView(text)) return zview(text, fileName);
    if (isMfliCsv(text)) return mfliCsv(text, fileName);
    try { return headerTable(text, fileName); } catch (e) { /* no usable column header */ }
    return numericBlocks(text, fileName, sep);
  }

  return { threeColumns: threeColumns, headerTable: headerTable, mfliCsv: mfliCsv, zview: zview, versa: versa, custom: custom,
           numericBlocks: numericBlocks, auto: auto, parseDefinition: parseDefinition, normalizeDef: normalizeDef,
           detectSeparator: detectSeparator, parseHeader: parseHeader, presets: PRESETS, separators: SEPARATORS,
           baseName: baseName, lines: lines };
})();
