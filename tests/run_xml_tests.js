/* Run: node tests/run_xml_tests.js   (no dependencies; tests/xml_shim.js supplies DOMParser)
 * Checks against sample data in files/ are skipped when that folder is absent. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
require('./xml_shim.js');
const root=path.join(__dirname,'..');
for(const f of ['js/core/namespace.js','js/io/readers.js','js/io/writers.js']) vm.runInThisContext(fs.readFileSync(path.join(root,f),'utf8'));
const R=Y.readers, W=Y.writers, read=f=>fs.readFileSync(path.join(root,f),'utf8'), has=f=>fs.existsSync(path.join(root,f));
let checks=0;
function test(name, fn){fn(); checks++; console.log('PASS '+name);}
function testFile(name, file, fn){ if(!has(file)) { console.log('SKIP '+name+' (no '+file+')'); return; } test(name, fn); }
const files=JSON.parse(read('config/definitions/index.json')).definitions;
const defs={};
test('all indexed presets parse, are version 3 and have detection rules',()=>{assert.equal(files.length,8);for(const f of files){defs[f]=R.parseDefinition(read('config/definitions/'+f));assert.equal(defs[f].format_version,3);assert(defs[f].detect,f);}});
test('all presets round-trip through XML',()=>{for(const d of Object.values(defs))assert.deepStrictEqual(R.parseDefinition(W.definitionXML(d)),d);});
test('legacy LabVIEW XML, INI and JSON definitions are rejected',()=>{for(const t of ['<LVData><Cluster/></LVData>','[header]=x','{"header":"x"}'])assert.throws(()=>R.parseDefinition(t),/impedanceFormat/);});
test('version 1 and 2 definitions still read',()=>{const v1=R.parseDefinition('<impedanceFormat version="1"><columns><frequency column="1"/><real column="2"/><imaginary column="3"/></columns></impedanceFormat>');assert.equal(v1.reader,'table');const v2=R.parseDefinition('<impedanceFormat version="2" reader="zview"><description>z</description></impedanceFormat>');assert.equal(v2.reader,'zview');});
test('detect and new readers require version 3',()=>{assert.throws(()=>R.parseDefinition('<impedanceFormat version="2" reader="gamryDTA"/>'),/version 3/);assert.throws(()=>R.parseDefinition('<impedanceFormat version="2" reader="zview"><detect><contains>x</contains></detect></impedanceFormat>'),/version 3/);});
test('detect validation: empty rules, bad regex, unknown children',()=>{for(const det of ['<detect/>','<detect><matches>(</matches></detect>','<detect><bogus>x</bogus></detect>','<detect priority="1.5"><contains>x</contains></detect>'])assert.throws(()=>R.parseDefinition('<impedanceFormat version="3" reader="zview">'+det+'</impedanceFormat>'),undefined,det);});

// ---------- detection and File, Auto
const presets=files.map(f=>({label:defs[f].description,name:f,def:defs[f]}));
const zm='Temp /K before measurement : 449.810\nmeasure started : 26/07/2023 18:33:58\nT34B descente\ntemp /K : 0.000\nfrequency /Hz, Real Z /Ohm, Im Z /Ohm\n1.000000E+6\t9.414706E+5\t-2.383074E+5\n8.154407E+5\t1.130474E+5\t-6.121182E+4\n\nend of measure : 26/07/2023 18:35:34\nTemp /K after measurement : 449.670 K\n----------\nTemp /K before measurement : 449.660\nmeasure started : 26/07/2023 18:36:07\nT34B descente\ntemp /K : 0.000\nfrequency /Hz, Real Z /Ohm, Im Z /Ohm\n1.000000E+6\t9.664908E+5\t-2.747448E+5\n8.154407E+5\t1.126409E+5\t-6.080259E+4\n6.649436E+5\t9.169096E+4\t-5.206284E+4\n\nend of measure : 26/07/2023 18:37:34\nTemp /K after measurement : 449.600 K\n----------\n';
test('Auto picks the SP2M Z-MFLI preset (labels from the header)',()=>{const d=R.autoRead(zm.replace(/\n/g,'\r\n'),'run.dat',presets);assert.equal(d.format,defs['SP2M_ZHT_Mfli.xml'].description);assert.deepStrictEqual(d.map(x=>x.name),['run_449.81','run_449.66']);assert.equal(d[1].zi[2],-5.206284E+4);});
const hp='Frequency /Hz, Z_r, Z_im, cycle :0001\n1000\t10\t-5\n100\t20\t-8\nFrequency /Hz, Z_r, Z_im, cycle :0002\n1000\t11\t-6\n100\t21\t-9\n';
test('Auto picks the HP 4192A preset',()=>{const d=R.autoRead(hp,'hp.txt',presets);assert.equal(d.format,defs['SP2M_HP4192a.xml'].description);assert.deepStrictEqual(d.map(x=>x.name),['hp_0001','hp_0002']);});
const mf='chunk;timestamp;size;fieldname;v1;v2\n0;0;2;frequency;100;10\n0;0;2;realz;20;30\n0;0;2;imagz;-2;-3\n';
test('Auto picks MFLI CSV',()=>{const d=R.autoRead(mf,'m.csv',presets);assert.equal(d.format,defs['MFLI_csv.xml'].description);assert.equal(d[0].zr[1],30);});
const sample={name:'my cell',f:[100,10],zr:[20,30],zi:[-2,-3],sr:[1,2],si:[3,4],mask:[0,1],norm:{type:'area',k:2,A:2}};
const calc=()=>({re:[40,60],im:[-4,-6]});
test('Auto picks Yappari JS Save data, all delimiters',()=>{for(const sep of ['tab','space','comma','semicolon']){const d=R.autoRead(W.dataText([sample],{sep,calc:true},calc),'s.txt',presets);assert.equal(d.format,defs['Yappari_JS.xml'].description,sep);assert.equal(d[0].zr[0],20);}});
const gamry='EXPLAIN\nTAG\tEISPOT\nZCURVE\tTABLE\n\tPt\tTime\tFreq\tZreal\tZimag\tZsig\n\t#\ts\tHz\tohm\tohm\tV\n\t0\t1\t100000\t10\t-2\t1\n\t1\t2\t1000\t15\t-4\t1\n';
test('Auto picks Gamry DTA',()=>{const d=R.autoRead(gamry,'g.DTA',presets);assert.equal(d.format,defs['Gamry_DTA.xml'].description);assert.equal(d[0].zi[1],-4);});
const bio='EC-Lab ASCII FILE\nNb header lines : 3\nfreq/Hz\tRe(Z)/Ohm\t-Im(Z)/Ohm\n1000\t10\t5\n10\t30\t12\n';
test('Auto picks BioLogic MPT',()=>{const d=R.autoRead(bio,'b.mpt',presets);assert.equal(d.format,defs['BioLogic_MPT.xml'].description);assert.equal(d[0].zi[1],-12);});
const versa='<Application>x</Application>\n<Segment1>\nDefinition=Segment #, Point #, E(V), I(A), Frequency(Hz), Z Real, Z Imag\n1,0,0,0,1000,12.5,-3.5\n1,1,0,0,100,22.5,-8\n</Segment1>\n';
test('Auto picks VersaStudio',()=>{const d=R.autoRead(versa,'v.par',presets);assert.equal(d.format,defs['VersaStudio_par.xml'].description);assert.equal(d[0].zr[1],22.5);});
test('Without presets the built-in recognisers name the same layouts',()=>{for(const [t,n,fmt] of [[gamry,'g','Gamry DTA'],[bio,'b','BioLogic MPT'],[versa,'v','VersaStudio .par'],[mf,'m','MFLI CSV (LabOne)'],[W.dataText([sample],{sep:'tab'},calc),'s','Yappari JS Save data']])assert.equal(R.autoRead(t,n,[]).format,fmt);});
test('Plain tables fall back to column headers, then numeric columns',()=>{assert.equal(R.autoRead('Frequency\tReal_Z\tImag_Z\n1000\t10\t-5\n100\t20\t-8\n','a',presets).format,'table with column headers');assert.equal(R.autoRead('1000 10 -5\n100 20 -8\n','b',presets).format,'numeric columns f, Zr, Zi');});
test('Higher priority wins; a failing match falls back with a warning',()=>{
  const lo={label:'low',def:R.normalizeModern({...R.modernDefaults,format_version:3,mode:'single',detect:{priority:1,file_names:['*.abc']}})};
  const hi={label:'high',def:R.normalizeModern({...R.modernDefaults,format_version:3,mode:'single',column_zr:3,column_zi:2,detect:{priority:9,file_names:['*.ABC']}})};
  const d=R.autoRead('1\t2\t3\n','x.abc',[lo,hi]);assert.equal(d.format,'high');assert.equal(d[0].zr[0],3);
  const broken={label:'broken',def:R.normalizeModern({...R.modernDefaults,format_version:3,mode:'repeatedHeader',header:'NOPE',detect:{contains:['1']}})};
  const e=R.autoRead('1\t2\t3\n2\t3\t4\n','y.txt',[broken]);assert.equal(e.format,'numeric columns f, Zr, Zi');assert(/broken/.test(e.warning));
});
test('detect rules: fileName glob, excludes, (?i) patterns',()=>{const d=R.normalizeModern({...R.modernDefaults,format_version:3,mode:'single',detect:{file_names:['*.dat','run_??.txt'],matches:['(?i)^hello$'],excludes:['skip']}});
  assert(R.detects('x\r\nHELLO\r\n','a.DAT',d));assert(R.detects('hello','run_01.txt',d));assert(!R.detects('hello','run_1.txt',d));assert(!R.detects('hello\nskip','a.dat',d));assert(!R.detects('hi','a.dat',d));});
testFile('Z_MFLI.txt via Auto','files/Z_MFLI.txt',()=>{const d=R.autoRead(read('files/Z_MFLI.txt'),'Z_MFLI.txt',presets);assert.equal(d.map(x=>x.f.length).join(),'19,14');assert.equal(d[0].name,'Z_MFLI_449.81');});
testFile('hp4192a.txt via Auto','files/hp4192a.txt',()=>{const d=R.autoRead(read('files/hp4192a.txt'),'hp4192a.txt',presets);assert.equal(d.map(x=>x.f.length).join(),'14,9,9');});
const base={...R.modernDefaults,mode:'single'};
test('polar kHz/kohm/degrees conversion',()=>{const d=R.custom('1\t2\t-90','x',{...base,representation:'polar',frequency_unit:'kHz',impedance_unit:'kohm'});assert.equal(d[0].f[0],1000);assert(Math.abs(d[0].zr[0])<1e-9);assert.equal(d[0].zi[0],-2000);});
test('angular frequency, sign reversal, milliohms',()=>{const d=R.custom((2*Math.PI)+'\t2000\t3000','x',{...base,frequency_unit:'rad/s',impedance_unit:'mohm',negate_zi:true});assert.equal(d[0].f[0],1);assert.equal(d[0].zr[0],2);assert.equal(d[0].zi[0],-3);});
test('quoted decimal commas and malformed row reporting',()=>{const d=R.custom('#comment\n"1,5","2,5","-3,5"\n2,NA,4','x',{...base,separator:'comma',decimal_separator:',',comment_prefix:'#'});assert.equal(d[0].zr[0],2.5);assert.equal(d.skipped,1);assert(d.warning.includes('3'));});
test('strict invalid row policy',()=>assert.throws(()=>R.custom('1\t2\t3\n2\tNA\t4','x',{...base,invalid_rows:'error'}),/line 2/));
test('full labels and explicit end markers',()=>{const d=R.custom('preamble\nSet:full label\n1\t2\t3\nEND\n2\t3\t4\nSet:next label\n2\t4\t5','x',{...base,mode:'repeatedHeader',header:'Set:',header_match:'startsWith',end_marker:'END'});assert.equal(d.length,2);assert.equal(d[0].name,'x_full label');assert.equal(d[0].f.length,1);});
test('blank-line datasets and unconditional footer skipping',()=>{const d=R.custom('1\t2\t3\n2\t3\t4\n\n3\t4\t5\n4\t5\t6','x',{...base,mode:'blankLines',ignore_last:1,footer_policy:'always'});assert.equal(d.length,2);assert.equal(d[1].f.length,1);});
test('numeric fields above 255 and XML special characters',()=>{const d={...base,column_freq:300,column_zr:301,column_zi:302,ignore_first:500,description:'A & B <C> "D"',comment_prefix:'"&'};assert.deepStrictEqual(R.parseDefinition(W.definitionXML(d)),R.normalizeModern(d));});
test('unknown attributes, version and malformed XML rejected',()=>{const xml=W.definitionXML(base);for(const bad of [xml.replace('<impedanceFormat version="3">','<impedanceFormat version="99">'),xml.replace('<table ','<table typo="1" '),xml.replace('</impedanceFormat>','')])assert.throws(()=>R.parseDefinition(bad), undefined, bad);});
test('mixed representations and invalid columns rejected',()=>{assert.throws(()=>R.normalizeModern({...base,column_zr:1}));assert.throws(()=>R.parseDefinition(W.definitionXML(base).replace('</columns>','<phase column="4"/></columns>')));});

test('MFLI CSV profile preserves former reader output',()=>{const text='chunk;timestamp;size;fieldname;v1;v2\n0;0;2;frequency;100;10\n0;0;2;realz;20;30\n0;0;2;imagz;-2;-3\n';assert.deepStrictEqual(R.custom(text,'mfli.txt',defs['MFLI_csv.xml']),R.mfliCsv(text,'mfli.txt'));});
testFile('incomplete supplied MFLI CSV gives a useful error','files/mfli_imps_csv.txt',()=>assert.throws(()=>R.custom(read('files/mfli_imps_csv.txt'),'mfli.txt',defs['MFLI_csv.xml']),/no sweep with a frequency/));
testFile('MFLI ZView profile preserves former reader output','files/MFLI_Zview_txt_imps_0_sample_00000.txt',()=>assert.deepStrictEqual(R.custom(read('files/MFLI_Zview_txt_imps_0_sample_00000.txt'),'z.txt',defs['MFLI_ZView.xml']),R.zview(read('files/MFLI_Zview_txt_imps_0_sample_00000.txt'),'z.txt')));
for(const sep of ['tab','space','comma','semicolon'])test('Yappari measured/model with optional sigma, masks, normalization; '+sep,()=>{
  const text=W.dataText([sample],{sep,calc:true},calc),def=defs['Yappari_JS.xml'];
  const measured=R.custom(text,'data', {...def,data_source:'measured'})[0],model=R.custom(text,'data',{...def,data_source:'model'})[0];
  assert.equal(measured.zr[0],20);assert.equal(model.zr[0],40);assert.equal(model.zi[1],-6);assert.equal(measured.sr[1],2);assert(!model.sr);
  assert.equal(model.mask[1],1);assert.equal(model.norm.type,'area');assert.equal(model.name,'my cell');
});
test('Yappari source missing rejects instead of silently substituting',()=>{
  const def=defs['Yappari_JS.xml'];
  const measured=W.dataText([sample],{sep:'tab'},calc),model=W.dataText([sample],{sep:'tab',exp:false,calc:true},calc);
  assert.throws(()=>R.custom(measured,'x',{...def,data_source:'model'}),/model/);
  assert.throws(()=>R.custom(model,'x',{...def,data_source:'measured'}),/measured/);
  assert.equal(R.custom(model,'x',def)[0].zr[0],40);
});
test('Yappari DRT sections excluded and multiple datasets retained',()=>{
  const ds={...sample,drt:{method:'x',lambda:1,source:'data',rinf:1,rpol:2,tau:[1],g:[2],f:[10],zr:[99],zi:[-99]}};
  const text=W.dataText([ds,{...sample,name:'second'}],{sep:'tab',calc:true,drt:true},calc);
  const got=R.custom(text,'x',defs['Yappari_JS.xml']);assert.equal(got.length,2);assert.equal(got[0].f.length,2);assert.equal(got[1].name,'second');
});
test('Save data with contributions reads back unchanged (Yappari JS, table, Auto), all delimiters',()=>{
  const parts=()=>[{label:'R',re:[50,50],im:[-1e-30,0]},{label:'(RQ)',re:[80,1e-40],im:[-30,-2e-3]}];
  for(const sep of ['tab','space','comma','semicolon']){
    const text=W.dataText([sample,{...sample,name:'second'}],{sep,calc:true,contrib:true},calc,parts),def=defs['Yappari_JS.xml'];
    assert(/#contributions part1=R part2=\(RQ\)/.test(text),sep);
    const lines=text.split('\n'),h=lines.findIndex(l=>l.startsWith('freq/Hz')),cols=lines[h].split({tab:'\t',space:' ',comma:',',semicolon:';'}[sep]);
    assert.deepStrictEqual(cols.slice(-6),['part1_freq/Hz','part1_Zr','part1_Zi','part2_freq/Hz','part2_Zr','part2_Zi']);
    const row=lines[h+1].split({tab:'\t',space:' ',comma:',',semicolon:';'}[sep]).slice(-6).map(Number);
    assert.deepStrictEqual(row,[100,50,0,100,80,-30]);
    const row2=lines[h+2].split({tab:'\t',space:' ',comma:',',semicolon:';'}[sep]).slice(-6).map(Number);
    assert.deepStrictEqual(row2,[10,50,0,10,0,-2e-3]);
    for(const got of [R.custom(text,'d',def),R.custom(text,'d',{...def,data_source:'measured'}),R.headerTable(text,'d'),R.autoRead(text,'d.txt',presets)]){
      assert.equal(got.length,2,sep);assert.deepStrictEqual(Array.from(got[0].zr),[20,30]);assert.deepStrictEqual(Array.from(got[0].zi),[-2,-3]);
      assert.equal(got[0].name,'my cell');assert.equal(got[0].mask[1],1);assert.equal(got[0].norm.type,'area');}
    const model=R.custom(text,'d',{...def,data_source:'model'});assert.deepStrictEqual(Array.from(model[1].zr),[40,60]);
    const onlyModel=W.dataText([sample],{sep,exp:false,calc:true,contrib:true},calc,parts);
    assert.deepStrictEqual(Array.from(R.headerTable(onlyModel,'d')[0].zi),[-4,-6]);assert.deepStrictEqual(Array.from(R.custom(onlyModel,'d',def)[0].zr),[40,60]);
  }
});
test('contributions off by default',()=>assert(!/part1/.test(W.dataText([sample],{sep:'tab',calc:true},calc,()=>[{label:'R',re:[1,1],im:[0,0]}]))));
test('specialized XML rejects misleading table settings',()=>assert.throws(()=>R.parseDefinition(W.definitionXML(defs['MFLI_csv.xml']).replace('</impedanceFormat>','<table delimiter="comma"/></impedanceFormat>'))));
console.log(checks+' XML checks passed.');
