/* Run: node tests/run_xml_tests.js
 * Browser XML parsing uses DOMParser. In Node, install xml-js and set NODE_PATH if needed.
 * The adapter below supplies DOM traversal only; XML syntax is parsed by xml-js/sax.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const {xml2js} = require('xml-js');
class Element {
  constructor(n) {
    this.tagName = n.name;
    this.attributes = Object.entries(n.attributes || {}).map(([name,value]) => ({name,value}));
    this.children = (n.elements || []).filter(e => e.type === 'element').map(e => new Element(e));
    this.textContent = (n.elements || []).map(e => e.type === 'text' ? e.text : e.type === 'cdata' ? e.cdata : e.type === 'element' ? new Element(e).textContent : '').join('');
  }
  hasAttribute(n) { return this.attributes.some(a=>a.name===n); }
  getAttribute(n) { return this.attributes.find(a=>a.name===n)?.value ?? null; }
  querySelector(q) {
    const names=q.split(',').map(s=>s.trim());
    for(const c of this.children) { if(names.includes(c.tagName)) return c; const found=c.querySelector(q); if(found)return found; }
    return null;
  }
}
globalThis.DOMParser = class {
  parseFromString(text) {
    try {
      const syntax = require('sax').parser(true); let depth = 0;
      syntax.onopentag = () => depth++; syntax.onclosetag = () => depth--;
      syntax.write(text).close(); if (depth !== 0) throw Error('Unclosed XML element');
      const parsed = xml2js(text, {compact:false, alwaysChildren:true});
      const roots=parsed.elements.filter(e=>e.type==='element');
      if(roots.length!==1) throw Error('Invalid root');
      const root=new Element(roots[0]);
      return {documentElement:root, doctype:parsed.elements.some(e=>e.type==='doctype'), querySelector:q=>root.tagName===q?root:root.querySelector(q)};
    } catch(e) { return {querySelector:()=>({}), doctype:null}; }
  }
};
const root=path.join(__dirname,'..');
for(const f of ['js/core/namespace.js','js/io/readers.js','js/io/writers.js']) vm.runInThisContext(fs.readFileSync(path.join(root,f),'utf8'));
const R=Y.readers, W=Y.writers, read=f=>fs.readFileSync(path.join(root,f),'utf8');
let checks=0;
function test(name, fn){fn(); checks++; console.log('PASS '+name);}
const files=JSON.parse(read('config/definitions/index.json')).definitions;
const defs={};
test('seven file-based presets, no hardcoded preset export',()=>{assert.equal(files.length,7);assert.equal(R.presets,undefined);for(const f of files)defs[f]=R.parseDefinition(read('config/definitions/'+f));});
test('all seven presets round-trip through new XML',()=>{for(const d of Object.values(defs))assert.deepStrictEqual(R.parseDefinition(W.definitionXML(d)),d);});
for(const [name,file] of [['zmfli.xml','Z_MFLI.txt'],['hp4192a.xml','hp4192a.txt']]) {
  // Legacy controls below reproduce the former hardcoded presets exactly.
  const old=name==='zmfli.xml'?{header:'Temp /K before measurement : ',label_length:6,separator:'tab',ignore_first:4,column_freq:1,column_zr:2,column_zi:3,ignore_last:4}:{header:'Frequency /Hz, Z_r, Z_im, cycle :',label_length:4,separator:'tab',ignore_first:0,column_freq:1,column_zr:2,column_zi:3,ignore_last:0};
  test(name+' matches original preset on shipped data',()=>{const a=R.custom(read('files/'+file),file,old),b=R.custom(read('files/'+file),file,defs[name]);assert.deepStrictEqual(Array.from(b),Array.from(a));});
}
test('multiple-dataset preset',()=>{const d=R.custom('Freq /Hz, Zr , Zi ; Name: first\n100\t20\t-5\nFreq /Hz, Zr , Zi ; Name: second\n10\t30\t-8','x',defs['yappari_multiple_datasets.xml']);assert.equal(d.length,2);assert.equal(d[1].name,'x_second');});
test('calculated columns preset',()=>{const d=R.custom('dev3221_imps_34, headings\n100;1;2;30;-40\ndev3221_imps_33, headings\n10;1;2;50;-60','x',defs['yappari_5_columns_calculated.xml']);assert.equal(d[0].zr[0],30);assert.equal(d[1].zi[0],-60);assert.equal(d[0].name,'x_34');});
const base={...R.modernDefaults,mode:'single'};
test('polar kHz/kohm/degrees conversion',()=>{const d=R.custom('1\t2\t-90','x',{...base,representation:'polar',frequency_unit:'kHz',impedance_unit:'kohm'});assert.equal(d[0].f[0],1000);assert(Math.abs(d[0].zr[0])<1e-9);assert.equal(d[0].zi[0],-2000);});
test('angular frequency, sign reversal, milliohms',()=>{const d=R.custom((2*Math.PI)+'\t2000\t3000','x',{...base,frequency_unit:'rad/s',impedance_unit:'mohm',negate_zi:true});assert.equal(d[0].f[0],1);assert.equal(d[0].zr[0],2);assert.equal(d[0].zi[0],-3);});
test('quoted decimal commas and malformed row reporting',()=>{const d=R.custom('#comment\n"1,5","2,5","-3,5"\n2,NA,4','x',{...base,separator:'comma',decimal_separator:',',comment_prefix:'#'});assert.equal(d[0].zr[0],2.5);assert.equal(d.skipped,1);assert(d.warning.includes('3'));});
test('strict invalid row policy',()=>assert.throws(()=>R.custom('1\t2\t3\n2\tNA\t4','x',{...base,invalid_rows:'error'}),/line 2/));
test('full labels and explicit end markers',()=>{const d=R.custom('preamble\nSet:full label\n1\t2\t3\nEND\n2\t3\t4\nSet:next label\n2\t4\t5','x',{...base,mode:'repeatedHeader',header:'Set:',header_match:'startsWith',end_marker:'END'});assert.equal(d.length,2);assert.equal(d[0].name,'x_full label');assert.equal(d[0].f.length,1);});
test('blank-line datasets and unconditional footer skipping',()=>{const d=R.custom('1\t2\t3\n2\t3\t4\n\n3\t4\t5\n4\t5\t6','x',{...base,mode:'blankLines',ignore_last:1,footer_policy:'always'});assert.equal(d.length,2);assert.equal(d[1].f.length,1);});
test('numeric fields above 255 and XML special characters',()=>{const d={...base,column_freq:300,column_zr:301,column_zi:302,ignore_first:500,description:'A & B <C> "D"',comment_prefix:'"&'};assert.deepStrictEqual(R.parseDefinition(W.definitionXML(d)),R.normalizeModern(d));});
test('unknown attributes, version and malformed XML rejected',()=>{const xml=W.definitionXML(base);for(const bad of [xml.replace('<impedanceFormat version="1">','<impedanceFormat version="99">'),xml.replace('<table ','<table typo="1" '),xml.replace('</impedanceFormat>','')])assert.throws(()=>R.parseDefinition(bad), undefined, bad);});
test('mixed representations and invalid columns rejected',()=>{assert.throws(()=>R.normalizeModern({...base,column_zr:1}));assert.throws(()=>R.parseDefinition(W.definitionXML(base).replace('</columns>','<phase column="4"/></columns>')));});

test('MFLI CSV profile preserves former reader output',()=>{const text='chunk;timestamp;size;fieldname;v1;v2\n0;0;2;frequency;100;10\n0;0;2;realz;20;30\n0;0;2;imagz;-2;-3\n';assert.deepStrictEqual(R.custom(text,'mfli.txt',defs['MFLI_csv.xml']),R.mfliCsv(text,'mfli.txt'));});
test('incomplete supplied MFLI CSV gives a useful error',()=>assert.throws(()=>R.custom(read('files/mfli_imps_csv.txt'),'mfli.txt',defs['MFLI_csv.xml']),/no sweep with a frequency/));
test('MFLI ZView profile preserves former reader output',()=>assert.deepStrictEqual(R.custom(read('files/MFLI_Zview_txt_imps_0_sample_00000.txt'),'z.txt',defs['MFLI_ZView.xml']),R.zview(read('files/MFLI_Zview_txt_imps_0_sample_00000.txt'),'z.txt')));
const sample={name:'my cell',f:[100,10],zr:[20,30],zi:[-2,-3],sr:[1,2],si:[3,4],mask:[0,1],norm:{type:'area',k:2,A:2}};
const calc=()=>({re:[40,60],im:[-4,-6]});
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
test('specialized XML rejects misleading table settings',()=>assert.throws(()=>R.parseDefinition(W.definitionXML(defs['MFLI_csv.xml']).replace('</impedanceFormat>','<table delimiter="comma"/></impedanceFormat>'))));
console.log(checks+' XML checks passed.');
