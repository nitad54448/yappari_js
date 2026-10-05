/*  File readers. Each returns an array of { name, f, zr, zi } (Float64Arrays; Zi as measured, i.e.
 *  negative for capacitive behaviour), with mask (Uint8Array) when a table marks masked points. Decimal commas are accepted whenever the field separator is not a comma.
 *  Native XML v1 definitions use browser DOMParser. Legacy LabVIEW XML, INI and JSON
 *  remain readable; numerical readers are DOM-free. writers.definitionXML writes native XML.
 */
Y.readers = (function () {
  'use strict';
  var SEP_LABEL = { auto: 'auto', tab: 'TAB', space: 'space', comma: ',', semicolon: ';' };
  var SEPARATORS = ['space', 'comma', 'semicolon', 'tab'];            // order of the Yappari 5.1 enum

  // Text of a file from its bytes. UTF-16 ("Unicode text" of Excel or Notepad) when the file starts with its byte-order
  // mark FF FE or FE FF, or, without one, when every other byte of the start is 0 (plain text in UTF-16); UTF-8
  // otherwise (a UTF-8 byte-order mark is dropped).
  function decode(bytes) {
    var b = bytes, n = b.length, enc = 'utf-8';
    if (n >= 2 && b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
    else if (n >= 2 && b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
    else if (n >= 4) {
      var m = Math.min(n >> 1, 1000), z0 = 0, z1 = 0;
      for (var i = 0; i < m; i++) { if (!b[2 * i]) z0++; if (!b[2 * i + 1]) z1++; }
      if (z1 > 0.4 * m && !z0) enc = 'utf-16le'; else if (z0 > 0.4 * m && !z1) enc = 'utf-16be';
    }
    return new TextDecoder(enc).decode(b);
  }

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

  // Empty fields are kept (as NaN) for tab, comma and semicolon, so a missing value cannot shift the
  // columns after it; only trailing empty fields are dropped. Runs of spaces are one separator.
  function numericFields(line, sep) {
    var fl = splitter(sep)(line);
    while (fl.length && !fl[fl.length - 1].trim()) fl.pop();
    return fl.map(function (x) { return num(x, sep !== 'comma'); });
  }
  // a line that looks like a data row (starts with a number, >= 3 fields) but lacks a usable f, Zr or Zi
  // (fields counted before trailing empty ones are dropped, so "2,20," counts)
  function incomplete(line, sep) { return /^[-+.]?\d/.test(line.trim()) && splitter(sep)(line).length >= 3; }
  function goodRow(v) { return v.length >= 3 && v[0] > 0 && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2]); }

  // the separator that gives >= 3 numeric fields on most data-like lines
  function detectSeparator(L) {
    var cands = ['tab', 'semicolon', 'comma', 'space'], score = [0, 0, 0, 0], seen = 0;
    for (var i = 0; i < L.length && seen < 40; i++) {
      var t = L[i].trim();
      if (!/^[-+.]?\d/.test(t)) continue;
      seen++;
      var hasTab = L[i].indexOf('\t') >= 0;
      cands.forEach(function (c, j) {
        if (c === 'space' && hasTab) return;                // whitespace splitting would merge empty tab fields
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
    var L = lines(text), s = (!sep || sep === 'auto') ? detectSeparator(L) : sep, f = [], zr = [], zi = [], skipped = 0;
    L.forEach(function (line) {
      if (!line.trim()) return;
      var v = numericFields(line, s);
      if (goodRow(v)) { f.push(v[0]); zr.push(v[1]); zi.push(v[2]); }
      else if (incomplete(line, s)) skipped++;
    });
    if (!f.length) throw new Error(baseName(fileName) + ': no rows with three numbers (separator ' + SEP_LABEL[s] + ')');
    var out = [pack(baseName(fileName), f, zr, zi)];
    out.skipped = skipped;
    return out;
  }

  // ---------------------------------------------------------------- tables with a column header
  // a column heading reduced for matching: lower case, no quotes or spaces; typographic minus signs and dashes
  // (−, –) become -, primes (′, ″, ’) become ' and '', so "−Z″" and "-Z''" are the same heading
  function colName(c) {
    return String(c).trim().toLowerCase().replace(/^"|"$/g, '').replace(/\s+/g, '')
      .replace(/[\u2010-\u2014\u2212\ufe63\uff0d]/g, '-').replace(/\u2033/g, "''").replace(/[\u2032\u2019]/g, "'");
  }
  function isFreq(s) { return /freq/.test(s) || /^f($|[\/(\[_])/.test(s); }
  function isImag(s) { return /imag/.test(s) || /^-?im\(?z/.test(s) || /^-?z''/.test(s) || /^-?z_?i($|[\/(\[_])/.test(s) || /^-?z_?im/.test(s); }
  function isReal(s) { return /real/.test(s) || /^re\(?z/.test(s) || /^z'($|[^'])/.test(s) || /^z_?r($|[\/(\[_])/.test(s) || /^z_?re/.test(s); }
  // modulus and phase of Z (|Z|, Zmod, mod(Z), absz ...; phase, Zphz, θ ...), used when there are no Zr and Zi columns
  function isMod(s) { return /^\|z\|/.test(s) || /^(z_?)?mod(ulus)?($|[\/(\[_])/.test(s) || /^(abs\(?z|z_?abs)/.test(s); }
  function isPhase(s) { return /^-?(phase|phz|z_?ph|theta|θ|φ|phi|arg)/.test(s) && !/\(y\)|admit/.test(s); }

  function parseHeader(line, compact) {
    if (!/[A-Za-z]/.test(line)) return null;
    var sep = line.indexOf('\t') >= 0 ? 'tab' : line.indexOf(';') >= 0 ? 'semicolon' : line.indexOf(',') >= 0 ? 'comma' : 'space';
    var cols = splitter(sep)(line).map(colName);
    if (compact) cols = cols.filter(function (c) { return c !== ''; });
    var h = { sep: sep, n: cols.length, cf: -1, cr: -1, ci: -1, cc: -1, cm: -1, sr: -1, si: -1, neg: false, cmod: -1, cph: -1 }, calc = [];
    cols.forEach(function (s, k) {
      if (s && /calc/.test(s)) calc.push(k);
      if (!s || /calc|fit|sim|pwr/.test(s)) return;
      if (/stddev|sigma|^σ/.test(s)) {                         // standard deviation columns
        if (h.sr < 0 && /real|zr|z'(?!')/.test(s)) h.sr = k;
        else if (h.si < 0 && /imag|zi|z''/.test(s)) h.si = k;
        return;
      }
      if (h.cc < 0 && s === 'chunk') { h.cc = k; return; }
      if (h.cm < 0 && /^mask(ed)?$/.test(s)) { h.cm = k; return; }     // 1 = masked point (written by Save data)
      if (h.cf < 0 && isFreq(s)) { h.cf = k; return; }
      if (h.ci < 0 && isImag(s)) { h.ci = k; h.neg = s.charAt(0) === '-'; return; }
      if (h.cr < 0 && isReal(s)) { h.cr = k; return; }
      if (h.cmod < 0 && isMod(s)) { h.cmod = k; return; }
      if (h.cph < 0 && isPhase(s)) { h.cph = k; h.phNeg = s.charAt(0) === '-'; h.phRad = /rad/.test(s) && !/deg|°/.test(s); }
    });
    // no measured real and imaginary columns, but a modulus and a phase: Zr = |Z| cos θ, Zi = |Z| sin θ, θ in degrees
    // unless the heading says rad (tableRows converts them)
    if (h.cf >= 0 && (h.cr < 0 || h.ci < 0) && h.cmod >= 0 && h.cph >= 0) { h.cr = h.cmod; h.ci = h.cph; h.polar = true; h.neg = false; }
    // no measured real and imaginary columns: model columns (Save data with "Model Zr, Zi" only) are read instead
    else if (h.cf >= 0 && (h.cr < 0 || h.ci < 0) && calc.length) {
      var mr = -1, mi = -1;
      calc.forEach(function (k) {
        var s = cols[k].replace(/[_.\-]*calc\w*/, '');            // Zr_calc -> zr, Z''calc -> z''
        if (mi < 0 && isImag(s)) mi = k; else if (mr < 0 && isReal(s)) mr = k;
      });
      if (mr >= 0 && mi >= 0) { h.cr = mr; h.ci = mi; h.neg = cols[mi].charAt(0) === '-'; }
    }
    if (h.cf < 0 || h.cr < 0 || h.ci < 0) return null;
    h.maxCol = Math.max(h.cf, h.cr, h.ci, h.cc);
    return h;
  }

  // the separator that splits a data line into as many fields as the header has columns
  // (some programs write a comma-separated title above tab-separated numbers)
  function dataSep(line, h) {
    var c = [h.sep, 'tab', 'semicolon', 'comma', 'space'];
    for (var k = 0; k < c.length; k++) {
      if (c[k] === 'space' && line.indexOf('\t') >= 0) continue; // preserve missing tab fields
      if (splitter(c[k])(line).length === h.n) return c[k];
    }
    return h.sep;
  }

  function nameLine(t) { var m = /^#\s*dataset\s*[:=]?\s*(.+)$/i.exec(t); return m ? m[1].trim() : null; }
  // a line that opens another section of a file written by Yappari JS ends the dataset above it
  function sectionLine(t) { return /^#\s*(dataset|normali[sz]ation|drt|summary)\b/i.test(t); }

  // Every header line (frequency + real + imaginary columns) starts a dataset that runs to the next header;
  // text lines in between are skipped. A "chunk" column (Zurich Instruments LabOne) splits sweeps into datasets.
  // A line "#dataset name" just above a header names the dataset (format written by Save data).
  // "#normalization area k=... A=... unit=..." written by Save data under "#dataset name"
  function normLine(t) {
    var m = /^#\s*normali[sz]ation\s+(factor|area|resist)\b(.*)$/i.exec(t);
    if (!m) return null;
    var o = { type: m[1].toLowerCase() };
    m[2].replace(/\b(k|A|L)\s*=\s*([-+0-9.eE]+)/g, function (_, key, v) { o[key] = parseFloat(v); });
    return o.k > 0 ? o : null;
  }
  function headerTable(text, fileName) { return isMfliCsv(text) ? mfliCsv(text, fileName) : tableRows(text, fileName); }
  function tableRows(text, fileName, groupHeading) {
    var L = lines(text), out = [], base = baseName(fileName), i = 0, pendingName = null, pendingNorm = null, count = 0, skipped = 0;
    while (i < L.length) {
      var nm = nameLine(L[i].trim());
      if (nm) { pendingName = nm; i++; continue; }
      var nz = normLine(L[i].trim());
      if (nz) { pendingNorm = nz; i++; continue; }
      var h = parseHeader(L[i]);
      if (!h) { i++; continue; }
      if (groupHeading) {
        var groupCols = splitter(h.sep)(L[i]).map(colName), groupColumn = groupCols.indexOf(groupHeading);
        if (groupColumn >= 0) { h.cc = groupColumn; h.maxCol = Math.max(h.maxCol, groupColumn); }
      }
      var j, sep = h.sep;
      for (j = i + 1; j < L.length; j++) {
        var t0 = L[j].trim();
        if (/^[-+.]?\d/.test(t0)) {
          // Some three-column files pad only their headings with extra tabs.
          // Compact the HEADER only when the data row has exactly three fields;
          // never collapse empty numeric fields (a missing value must stay missing).
          var compact = parseHeader(L[i], true);
          if (h.sep === 'tab' && compact && compact.n === 3 && h.n > compact.n) {
            var candidate = dataSep(L[j], compact);
            if (splitter(candidate)(L[j]).length === compact.n) h = compact;
          }
          sep = dataSep(L[j], h); break;
        }
        if (sectionLine(t0) || parseHeader(L[j])) break;
      }
      var split = splitter(sep), dc = sep !== 'comma', rows = [];
      for (j = i + 1; j < L.length; j++) {
        var t = L[j].trim();
        if (!t) continue;
        var fields = split(L[j]), ok = fields.length > h.maxCol, fv, rv, iv;
        if (ok) {
          fv = num(fields[h.cf], dc); rv = num(fields[h.cr], dc); iv = num(fields[h.ci], dc);
          if (h.polar) { var th = (h.phNeg ? -iv : iv) * (h.phRad ? 1 : Math.PI / 180); iv = rv * Math.sin(th); rv = rv * Math.cos(th); }
          ok = fv > 0 && isFinite(fv) && isFinite(rv) && isFinite(iv);
        }
        if (!ok && /^[-+.]?\d/.test(t) && fields.length >= 3) skipped++;
        if (ok) {
          rows.push([fv, rv, h.neg ? -iv : iv, h.cc >= 0 ? String(fields[h.cc]).trim() : '',
                     h.sr >= 0 && fields.length > h.sr ? num(fields[h.sr], dc) : NaN, h.si >= 0 && fields.length > h.si ? num(fields[h.si], dc) : NaN,
                     h.cm >= 0 && fields.length > h.cm && num(fields[h.cm], dc) > 0 ? 1 : 0]);
          continue;
        }
        if (sectionLine(t) || parseHeader(L[j])) break;
      }
      if (rows.length) {
        var groups = [], byKey = {};
        rows.forEach(function (r) {
          if (!(r[3] in byKey)) { byKey[r[3]] = groups.length; groups.push([]); }
          groups[byKey[r[3]]].push(r);
        });
        groups.forEach(function (g) {
          var name = pendingName && groups.length === 1 ? pendingName : base + '_' + count;
          var o = pack(name, g.map(function (r) { return r[0]; }), g.map(function (r) { return r[1]; }), g.map(function (r) { return r[2]; }),
                        g.map(function (r) { return r[4]; }), g.map(function (r) { return r[5]; }));
          if (pendingNorm && groups.length === 1) o.norm = pendingNorm;
          if (g.some(function (r) { return r[6]; })) o.mask = Uint8Array.from(g, function (r) { return r[6]; });
          out.push(o);
          count++;
        });
      }
      pendingName = null; pendingNorm = null;
      i = j;
    }
    if (!out.length) throw new Error(base + ': no column header with frequency, real and imaginary impedance found');
    out.skipped = skipped;
    return out;
  }

  // Explicit vendor entries use heading-based text parsing, never positional fallback.
  function gamryDTA(text, fileName) {
    var src = String(text).replace(/^\uFEFF/, '');
    if (!/^\s*ZCURVE\d*\s+TABLE\b/im.test(src)) throw new Error(baseName(fileName) + ': no Gamry ZCURVE TABLE impedance section found.');
    var L = lines(src), out = [], skipped = 0;
    for (var i = 0; i < L.length; i++) {
      if (!/^\s*ZCURVE\d*\s+TABLE\b/i.test(L[i])) continue;
      var start = i + 1, end = start;
      while (end < L.length && !/^\s*\S+\s+TABLE\b/i.test(L[end])) end++;
      var spectra = tableRows(L.slice(start, end).join('\n'), fileName);
      skipped += spectra.skipped || 0; out = out.concat(spectra); i = end - 1;
    }
    if (!out.length) throw new Error(baseName(fileName) + ': no usable Gamry impedance data.');
    out.forEach(function (ds, k) { ds.name = baseName(fileName) + (out.length > 1 ? '_' + k : ''); });
    out.skipped = skipped; return out;
  }
  function biologicMPT(text, fileName) {
    var src = String(text).replace(/^\uFEFF/, ''), L = lines(src);
    if (!/^EC-Lab ASCII FILE\s*$/i.test((L[0] || '').trim())) throw new Error(baseName(fileName) + ': expected an EC-Lab ASCII .mpt export; binary .mpr files are not supported.');
    var count = /^Nb header lines\s*:\s*(\d+)\s*$/im.exec(src);
    if (count) {
      var n = Number(count[1]);
      if (n < 2 || n > L.length || !parseHeader(L[n - 1])) throw new Error(baseName(fileName) + ': invalid header-line count or missing impedance column headings.');
      src = L.slice(n - 1).join('\n');
    }
    return tableRows(src, fileName, 'cyclenumber');
  }

  // ---------------------------------------------------------------- Zurich Instruments MFLI / MFIA csv (LabOne)
  // Sweeper export with one line per field and sweep:  chunk;timestamp;size;fieldname;v1;v2;...  (';' or ',')
  // Each chunk is a dataset (name_0, name_1 ...); f from "frequency" (or "grid"), Z from "realz" and "imagz"
  // (or "absz" and "phasez", the phase in radians). Points still nan (sweep not finished) are skipped. A layout with one column
  // per field is read by the table reader instead. Only the "chunk" line itself decides: a "fieldname" written
  // anywhere else (a comment) does not make a one-column-per-field table an MFLI sweeper export.
  function isMfliCsv(text) {
    var L = lines(String(text).slice(0, 3000));
    for (var i = 0; i < L.length && i < 50; i++) if (/^\s*"?chunk"?\s*[;,\t]/i.test(L[i])) return /fieldname/i.test(L[i]);
    return false;
  }

  function mfliCsv(text, fileName) {
    var L = lines(text), base = baseName(fileName), h = -1, m = null;
    for (var i = 0; i < L.length && i < 50; i++) { m = /^\s*"?chunk"?\s*([;,\t])/i.exec(L[i]); if (m) { h = i; break; } }
    if (h < 0) throw new Error(base + ': not an MFLI csv file, the "chunk;timestamp;size;fieldname" line is missing');
    var sep = m[1], dc = sep !== ',';
    var head = L[h].split(sep).map(function (s) { return s.trim().replace(/^"|"$/g, '').toLowerCase(); });
    var iC = head.indexOf('chunk'), iS = head.indexOf('size'), iF = head.indexOf('fieldname');
    if (iF < 0) return tableRows(text, fileName);              // one column per field: an ordinary table
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
        var ph = c.phasez;                                      // LabOne writes the phase in radians
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
      if (goodRow(v)) {
        if (!cur) { cur = { f: [], zr: [], zi: [], skipped: 0 }; blocks.push(cur); }
        cur.f.push(v[0]); cur.zr.push(v[1]); cur.zi.push(v[2]);
      } else if (cur && incomplete(line, s)) cur.skipped++;          // inside a run: the row is dropped, the run goes on
      else if (/[A-Za-z]/.test(t)) cur = null;
    });
    var good = blocks.filter(function (b) { return b.f.length >= 2; });
    if (!good.length) throw new Error(base + ': no rows with three numbers');
    var out = good.map(function (b, k) { return pack(good.length > 1 ? base + '_' + k : base, b.f, b.zr, b.zi); });
    out.skipped = good.reduce(function (a, b) { return a + b.skipped; }, 0);
    return out;
  }

  // ---------------------------------------------------------------- ZView (.z) and MFLI ZView (.txt)
  // Each run of numeric lines is one dataset; with >= 6 columns the ZView layout is used
  // (Freq, Ampl, Bias, Time, Z', Z'' ...), otherwise f, Zr, Zi.
  function zview(text, fileName) {
    var blocks = [], cur = null, base = baseName(fileName), skipped = 0;
    lines(text).forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      // Explicit delimiters preserve missing columns; only spaces may be collapsed.
      var sep = line.indexOf('\t') >= 0 ? 'tab' : line.indexOf(';') >= 0 ? 'semicolon' : line.indexOf(',') >= 0 ? 'comma' : 'space';
      var vals = numericFields(line, sep);
      var numeric = vals.length >= 3 && vals.every(function (v) { return isFinite(v); });
      if (numeric) { if (!cur) { cur = []; blocks.push(cur); } cur.push(vals); }
      else if (incomplete(line, sep)) skipped++;     // a bad row must not split the sweep
      else cur = null;
    });
    var out = [];
    blocks.forEach(function (b) {
      var c = b.some(function (v) { return v.length >= 6; }) ? [0, 4, 5] : [0, 1, 2], f = [], zr = [], zi = [];
      b.forEach(function (v) {
        if (v[c[0]] > 0 && v.length > c[2]) { f.push(v[c[0]]); zr.push(v[c[1]]); zi.push(v[c[2]]); }
        else skipped++;
      });
      if (f.length >= 2) out.push(pack(blocks.length > 1 ? base + '_' + out.length : base, f, zr, zi));
    });
    if (!out.length) throw new Error(base + ': no numeric data block found');
    out.skipped = skipped;
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


  // The text before the first header is ignored; each header occurrence (it can sit inside a longer line)
  // starts a dataset. label_length characters after the header name the dataset. ignore_first lines are
  // skipped after the header line and ignore_last lines at the end of each dataset, except when those last
  // lines are all data: a dataset cut short (end of file) keeps all its points.
  function custom(text, fileName, def) {
    if (def && def.format_version != null) {
      var native = normalizeModern(def);
      if (native.reader === 'mfliCsv') return mfliCsv(text, fileName);
      if (native.reader === 'zview') return zview(text, fileName);
      if (native.reader === 'yappariJS') return yappariExport(text, fileName, native.data_source);
      return customModern(text, fileName, native);
    }
    if (!def || !def.header) throw new Error('the definition needs a header text that separates the datasets');
    var src = String(text), header = String(def.header), parts = src.split(header), base = baseName(fileName), out = [], skipped = 0;
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
        else if (/^[-+.]?\d/.test(line.trim()) && split(line).length > Math.max(cf, cr, ci)) skipped++;
      });
      if (f.length) out.push(pack(base + '_' + (label || idx), f, zr, zi));
    });
    if (!out.length) throw new Error(base + ': the header was found but no numeric rows in columns ' + (cf + 1) + ', ' + (cr + 1) + ', ' + (ci + 1));
    out.skipped = skipped;
    return out;
  }

  // Versioned, application-native definitions. Legacy readers remain available for imported files.
  var MODERN_DEFAULTS = {
    format_version: 1, reader: 'table', data_source: 'auto', description: '', mode: 'repeatedHeader', header: '', header_match: 'contains',
    label_source: 'afterHeader', label_length: 0, end_marker: '', ignore_first: 0, ignore_last: 0,
    footer_policy: 'keepNumeric', separator: 'tab', decimal_separator: 'auto', comment_prefix: '',
    missing_values: 'NA;NaN;N/A', representation: 'cartesian', column_freq: 1, column_zr: 2, column_zi: 3,
    frequency_unit: 'Hz', impedance_unit: 'ohm', phase_unit: 'deg', negate_zi: false, invalid_rows: 'skipAndReport'
  };
  function normalizeModern(input) {
    var d = Object.assign({}, MODERN_DEFAULTS, input);
    if ([1, 2].indexOf(Number(d.format_version)) < 0) throw new Error('Unsupported XML definition version: ' + d.format_version);
    d.format_version = Number(d.format_version);
    if (['table', 'mfliCsv', 'zview', 'yappariJS'].indexOf(d.reader) < 0) throw new Error('Unknown reader: ' + d.reader);
    if (['auto', 'measured', 'model'].indexOf(d.data_source) < 0) throw new Error('Unknown impedance source: ' + d.data_source);
    if (d.reader !== 'table') {
      if (d.format_version < 2) throw new Error('Specialized readers require XML version 2.');
      var profile = { format_version: 2, reader: d.reader, description: String(d.description) };
      if (d.reader === 'yappariJS') profile.data_source = d.data_source;
      return profile;
    }
    var choices = {
      mode: ['single', 'repeatedHeader', 'blankLines'], header_match: ['contains', 'startsWith', 'exact'],
      label_source: ['afterHeader', 'index'], footer_policy: ['keepNumeric', 'always'],
      separator: ['auto', 'tab', 'space', 'comma', 'semicolon'], decimal_separator: ['auto', '.', ','],
      representation: ['cartesian', 'polar'], frequency_unit: ['Hz', 'kHz', 'MHz', 'rad/s'],
      impedance_unit: ['ohm', 'kohm', 'Mohm', 'mohm'], phase_unit: ['deg', 'rad'], invalid_rows: ['skipAndReport', 'error']
    };
    Object.keys(choices).forEach(function (k) {
      if (choices[k].indexOf(d[k]) < 0) throw new Error('Unsupported ' + k + ': ' + d[k]);
    });
    ['ignore_first', 'ignore_last', 'label_length', 'column_freq', 'column_zr', 'column_zi'].forEach(function (k) {
      var n = Number(d[k]), min = k.indexOf('column_') === 0 ? 1 : 0;
      if (!Number.isSafeInteger(n) || n < min) throw new Error(k + ' must be an integer of at least ' + min);
      d[k] = n;
    });
    ['description', 'header', 'end_marker', 'comment_prefix', 'missing_values'].forEach(function (k) { d[k] = String(d[k]); });
    if (d.mode === 'repeatedHeader' && !d.header.trim()) throw new Error('Repeated-header mode needs a header.');
    if (new Set([d.column_freq, d.column_zr, d.column_zi]).size !== 3) throw new Error('Choose three different data columns.');
    if (typeof d.negate_zi !== 'boolean') throw new Error('negate_zi must be true or false.');
    if (d.representation === 'polar' && d.negate_zi) throw new Error('Imaginary sign reversal applies only to Cartesian data.');
    return d;
  }
  function upgradeDefinition(d) {
    if (d.format_version != null) return normalizeModern(d);
    // Old label_length=0 means index; new length=0 means the full label.
    return normalizeModern(Object.assign({}, d, { format_version: 1, label_source: d.label_length > 0 ? 'afterHeader' : 'index' }));
  }
  function customModern(text, fileName, d) {
    var base = baseName(fileName), blocks = [], cur = null, skipped = 0, examples = [];
    var start = function (label) { cur = { label: label || '', rows: [] }; blocks.push(cur); };
    if (d.mode === 'single') start('');
    lines(text).forEach(function (line, n) {
      var at = -1;
      if (d.mode === 'repeatedHeader') {
        if (d.header_match === 'contains') at = line.indexOf(d.header);
        else if (d.header_match === 'startsWith' && line.indexOf(d.header) === 0) at = 0;
        else if (d.header_match === 'exact' && line === d.header) at = 0;
        if (at >= 0) {
          var label = d.label_source === 'afterHeader' ? line.slice(at + d.header.length).replace(/^\s+/, '') : '';
          if (d.label_length > 0) label = label.slice(0, d.label_length);
          start(label.trim()); return;
        }
      }
      if (d.end_marker && line.indexOf(d.end_marker) >= 0) { cur = null; return; }
      if (d.mode === 'blankLines') {
        if (!line.trim()) { cur = null; return; }
        if (!cur) start('');
      }
      if (cur) cur.rows.push({ text: line, line: n + 1 });
    });
    if (!blocks.length) throw new Error(base + ': no dataset start found; check the header and matching rule.');
    var out = [], frequencyScale = { Hz: 1, kHz: 1e3, MHz: 1e6, 'rad/s': 1 / (2 * Math.PI) }[d.frequency_unit];
    var zScale = { ohm: 1, kohm: 1e3, Mohm: 1e6, mohm: 1e-3 }[d.impedance_unit];
    var missing = d.missing_values.split(';').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    blocks.forEach(function (block, idx) {
      var body = block.rows.slice(d.ignore_first);
      while (body.length && !body[body.length - 1].text.trim()) body.pop();
      var sep = d.separator === 'auto' ? detectSeparator(body.map(function (r) { return r.text; })) : d.separator;
      // Quotes protect delimiters; multiline quoted fields are intentionally unsupported.
      function fields(line) {
        if (sep === 'space') return line.trim().split(/\s+/);
        var delimiter = { tab: '\t', comma: ',', semicolon: ';' }[sep], values = [], v = '', quoted = false;
        for (var i = 0; i < line.length; i++) {
          var c = line[i];
          if (c === '"') {
            if (quoted && line[i + 1] === '"') { v += '"'; i++; } else quoted = !quoted;
          } else if (c === delimiter && !quoted) { values.push(v); v = ''; } else v += c;
        }
        if (quoted) return [];
        values.push(v); return values;
      }
      function value(s) {
        if (s == null || !s.trim() || missing.indexOf(s.trim().toLowerCase()) >= 0) return NaN;
        s = s.trim();
        if (d.decimal_separator === ',' || (d.decimal_separator === 'auto' && sep !== 'comma')) s = s.replace(',', '.');
        return Number(s);
      }
      function row(line) {
        var v = fields(line), f = value(v[d.column_freq - 1]) * frequencyScale,
          a = value(v[d.column_zr - 1]), b = value(v[d.column_zi - 1]), zr, zi;
        if (d.representation === 'polar') {
          if (a < 0) return null;
          var phase = b * (d.phase_unit === 'deg' ? Math.PI / 180 : 1);
          zr = a * zScale * Math.cos(phase); zi = a * zScale * Math.sin(phase);
        } else { zr = a * zScale; zi = b * zScale * (d.negate_zi ? -1 : 1); }
        return f > 0 && isFinite(f) && isFinite(zr) && isFinite(zi) ? [f, zr, zi] : null;
      }
      var nl = d.ignore_last;
      if (nl > 0 && !(d.footer_policy === 'keepNumeric' && body.length >= nl && body.slice(-nl).every(function (r) { return row(r.text); }))) {
        body = body.slice(0, Math.max(0, body.length - nl));
      }
      var f = [], zr = [], zi = [];
      body.forEach(function (r) {
        if (!r.text.trim() || (d.comment_prefix && r.text.trim().indexOf(d.comment_prefix) === 0)) return;
        var values = row(r.text);
        if (values) { f.push(values[0]); zr.push(values[1]); zi.push(values[2]); }
        else {
          if (d.invalid_rows === 'error') throw new Error(base + ': invalid data at line ' + r.line + '.');
          skipped++; if (examples.length < 5) examples.push(r.line);
        }
      });
      if (f.length) out.push(pack(d.mode === 'single' ? base : base + '_' + (block.label || idx), f, zr, zi));
    });
    if (!out.length) throw new Error(base + ': no valid data rows; check columns, separator, units and skipped lines.');
    out.skipped = skipped;
    if (skipped) out.warning = base + ': skipped ' + skipped + ' invalid row(s); first line numbers: ' + examples.join(', ') + '.';
    return out;
  }

  // Save data has optional sigma, calculated and mask columns. Resolve by heading per dataset.
  function yappariExport(text, fileName, source) {
    var blocks = [], cur = null, out = [], skipped = 0;
    lines(text).forEach(function (line) {
      if (/^#dataset\s+/.test(line)) { cur = [line]; blocks.push(cur); }
      else if (/^#drt\b/.test(line)) cur = null;
      else if (cur) cur.push(line);
    });
    if (!blocks.length) throw new Error('Not a Yappari JS Save data file: #dataset markers are missing.');
    blocks.forEach(function (block) {
      var h = block.findIndex(function (line) { return /^freq\/Hz(?:\s|,|;)/.test(line); });
      if (h < 0) throw new Error(block[0] + ': frequency/impedance column header is missing.');
      var line = block[h], sep = line.indexOf('\t') >= 0 ? 'tab' : line.indexOf(';') >= 0 ? 'semicolon' : line.indexOf(',') >= 0 ? 'comma' : 'space';
      var names = splitter(sep)(line), measured = names.indexOf('Zr') >= 0 && names.indexOf('Zi') >= 0,
        model = names.indexOf('Zr_calc') >= 0 && names.indexOf('Zi_calc') >= 0;
      var selected = source === 'auto' ? (measured ? 'measured' : 'model') : source;
      if (!(selected === 'measured' ? measured : model)) throw new Error(block[0] + ': requested ' + selected + ' Zr/Zi columns are missing.');
      names = names.map(function (name) {
        if (selected === 'model') {
          if (name === 'Zr_calc') return 'Zr'; if (name === 'Zi_calc') return 'Zi';
          if (['Zr', 'Zi', 'sigma_Zr', 'sigma_Zi'].indexOf(name) >= 0) return 'unused';
        } else if (name === 'Zr_calc' || name === 'Zi_calc') return 'unused';
        return name;
      });
      block[h] = names.join({ tab: '\t', comma: ',', semicolon: ';', space: ' ' }[sep]);
      var got = tableRows(block.join('\n'), fileName);
      skipped += got.skipped || 0;
      out = out.concat(got);
    });
    out.skipped = skipped;
    return out;
  }

  function fromModernXML(t) {
    if (typeof DOMParser === 'undefined') throw new Error('Reading the new XML format requires a browser DOMParser.');
    var doc = new DOMParser().parseFromString(t, 'application/xml');
    if (doc.querySelector('parsererror') || doc.doctype) throw new Error('Invalid XML, or unsupported DOCTYPE.');
    var root = doc.documentElement;
    if (root.tagName !== 'impedanceFormat') throw new Error('Expected <impedanceFormat>.');
    function check(el, attrs, children) {
      Array.from(el.attributes).forEach(function (a) { if (attrs.indexOf(a.name) < 0) throw new Error('Unknown attribute ' + a.name + ' on ' + el.tagName); });
      Array.from(el.children).forEach(function (c) { if (children.indexOf(c.tagName) < 0) throw new Error('Unknown element <' + c.tagName + '>.'); });
    }
    function child(el, tag, attrs, children, required) {
      var found = Array.from(el.children).filter(function (c) { return c.tagName === tag; });
      if (found.length > 1 || (required && !found.length)) throw new Error('Expected one <' + tag + '>.');
      var node = found[0]; if (node) check(node, attrs, children || []); return node;
    }
    function attr(el, name, fallback) { return el && el.hasAttribute(name) ? el.getAttribute(name) : fallback; }
    check(root, ['version', 'reader', 'source'], ['description', 'table', 'datasets', 'columns', 'invalidRows']);
    var d = { format_version: attr(root, 'version', ''), reader: attr(root, 'reader', 'table'), data_source: attr(root, 'source', 'auto') };
    var desc = child(root, 'description', [], []); d.description = desc ? desc.textContent : '';
    if (d.reader !== 'table') {
      if (Array.from(root.children).some(function (c) { return c.tagName !== 'description'; })) throw new Error('Specialized definitions accept description only; their layout is fixed.');
      if (d.reader !== 'yappariJS' && root.hasAttribute('source')) throw new Error('Source applies only to the Yappari JS reader.');
      return normalizeModern(d);
    }
    if (root.hasAttribute('source')) throw new Error('Source applies only to the Yappari JS reader.');
    var table = child(root, 'table', ['delimiter', 'decimalSeparator', 'commentPrefix', 'missingValues'], []);
    d.separator = attr(table, 'delimiter', 'tab'); d.decimal_separator = attr(table, 'decimalSeparator', 'auto');
    d.comment_prefix = attr(table, 'commentPrefix', ''); d.missing_values = attr(table, 'missingValues', MODERN_DEFAULTS.missing_values);
    var sets = child(root, 'datasets', ['mode'], ['header', 'label', 'endMarker', 'skipLines']);
    d.mode = attr(sets, 'mode', 'single');
    if (sets) {
      var h = child(sets, 'header', ['match'], []), label = child(sets, 'label', ['source', 'length'], []), end = child(sets, 'endMarker', [], []);
      var skip = child(sets, 'skipLines', ['afterHeader', 'beforeEnd', 'footerPolicy'], []);
      d.header = h ? h.textContent : ''; d.header_match = attr(h, 'match', 'contains');
      d.label_source = attr(label, 'source', 'afterHeader'); d.label_length = attr(label, 'length', 0);
      d.end_marker = end ? end.textContent : ''; d.ignore_first = attr(skip, 'afterHeader', 0);
      d.ignore_last = attr(skip, 'beforeEnd', 0); d.footer_policy = attr(skip, 'footerPolicy', 'keepNumeric');
    }
    var cols = child(root, 'columns', ['numbering', 'representation'], ['frequency', 'real', 'imaginary', 'magnitude', 'phase'], true);
    if (attr(cols, 'numbering', '1') !== '1') throw new Error('Columns must use numbering="1".');
    d.representation = attr(cols, 'representation', cols.querySelector('magnitude') ? 'polar' : 'cartesian');
    var polar = d.representation === 'polar';
    if (cols.querySelector(polar ? 'real, imaginary' : 'magnitude, phase')) throw new Error('Mixed Cartesian and polar columns.');
    var f = child(cols, 'frequency', ['column', 'unit'], [], true), a = child(cols, polar ? 'magnitude' : 'real', ['column', 'unit'], [], true);
    var b = child(cols, polar ? 'phase' : 'imaginary', polar ? ['column', 'unit'] : ['column', 'unit', 'sign'], [], true);
    d.column_freq = attr(f, 'column', ''); d.column_zr = attr(a, 'column', ''); d.column_zi = attr(b, 'column', '');
    d.frequency_unit = attr(f, 'unit', 'Hz'); d.impedance_unit = attr(a, 'unit', 'ohm');
    d.phase_unit = polar ? attr(b, 'unit', 'deg') : 'deg';
    if (!polar) {
      if (attr(b, 'unit', d.impedance_unit) !== d.impedance_unit) throw new Error('Real and imaginary units must match.');
      var sign = attr(b, 'sign', 'Zi'); if (['Zi', '-Zi'].indexOf(sign) < 0) throw new Error('Imaginary sign must be Zi or -Zi.');
      d.negate_zi = sign === '-Zi';
    }
    var invalid = child(root, 'invalidRows', ['action'], []); d.invalid_rows = attr(invalid, 'action', 'skipAndReport');
    return normalizeModern(d);
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
    if (t.charAt(0) === '<') {
      if (!/<LVData[\s>]/i.test(t)) return fromModernXML(t);
      d = fromXML(t);
    }
    else if (t.charAt(0) === '{') d = JSON.parse(t);
    else d = fromINI(t);
    return d.format_version != null ? normalizeModern(d) : normalizeDef(d);
  }

  // ---------------------------------------------------------------- automatic choice (files dropped on the window)
  // The line just above the first data row, when it looks like the column headings of the table: it names a
  // frequency and has as many columns as the data rows. null otherwise.
  function headingsAbove(text) {
    var L = lines(String(text).slice(0, 20000)), prev = null;
    for (var i = 0; i < L.length; i++) {
      var t = L[i].trim();
      if (!t) continue;
      if (!/^[-+.]?\d/.test(t)) { if (/[A-Za-z]/.test(t)) prev = t; continue; }
      if (!prev) return null;
      var hs = prev.indexOf('\t') >= 0 ? 'tab' : prev.indexOf(';') >= 0 ? 'semicolon' : prev.indexOf(',') >= 0 ? 'comma' : 'space';
      var cols = splitter(hs)(prev).map(colName).filter(Boolean), nData = numericFields(L[i], detectSeparator([L[i]])).length;
      return cols.length >= 3 && cols.length === nData && cols.some(isFreq) ? prev : null;
    }
    return null;
  }

  function auto(text, fileName, sep) {
    if (/<Segment\d*>/i.test(text)) return versa(text, fileName);
    if (looksZView(text)) return zview(text, fileName);
    if (isMfliCsv(text)) return mfliCsv(text, fileName);
    try { return headerTable(text, fileName); } catch (e) { /* no usable column header */ }
    var out = numericBlocks(text, fileName, sep), hl = headingsAbove(text);
    // columns read by position under headings that name other quantities (admittance, |Z| and phase in an unknown
    // form ...) would be wrong without a word: the caller shows this warning
    if (hl) out.warning = baseName(fileName) + ': the column headings "' + hl.slice(0, 60) + '" were not recognised, so columns 1, 2 and 3 ' +
      'were read as f, Zr and Zi. Check the plots; File, Table with column headers reads Zr and Zi, or |Z| and phase, by name.';
    return out;
  }

  return { gamryDTA: gamryDTA, biologicMPT: biologicMPT, threeColumns: threeColumns, headerTable: headerTable, mfliCsv: mfliCsv, zview: zview, versa: versa, custom: custom,
           numericBlocks: numericBlocks, auto: auto, parseDefinition: parseDefinition, normalizeDef: normalizeDef,
           detectSeparator: detectSeparator, parseHeader: parseHeader, colName: colName, modernDefaults: MODERN_DEFAULTS, normalizeModern: normalizeModern, upgradeDefinition: upgradeDefinition, separators: SEPARATORS,
           baseName: baseName, lines: lines, decode: decode };
})();
