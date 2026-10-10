'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
for(const f of ['core/namespace','core/elements','core/circuit','core/linalg','core/fit','core/modelrank','ui/model_search'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js',f+'.js'),'utf8'));
const M=Y.modelSearch, allowed=Object.fromEntries(Object.keys(Y.elements).map(k=>[k,true]));
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('all nine types and exact multi-letter filtering',()=>{for(const k of Object.keys(Y.elements))assert(M.candidate(k,allowed,1));assert.equal(M.candidate('Wo',{W:true},1),null);assert.equal(M.candidate('RC',allowed,1),null);assert.throws(()=>M.candidate('evil',allowed,1));});
const c=M.candidate('R(Q[WoHN])',allowed,4),data={f:Float64Array.from([1,10,100]),zr:Float64Array.from([100,100,100]),zi:new Float64Array(3)};
test('requested number of starts; every Q/HN parameter fitted within bounds',()=>{let calls=0;const rnd=()=>{calls++;return .25};const j=M.jobs(c,data,{method:'TRDL',weight:'mod',maxIter:100,tol:1e-8},rnd,6);assert.equal(j.length,6);assert.equal(calls,6*5*c.elements);for(const job of j){assert(Array.from(job.fit).every(v=>v===1));assert(job.p.every((p,i)=>p>=job.lo[i]&&p<=job.hi[i]));assert.equal(job.maxIter,100);}assert.equal(M.jobs(c,data,{},()=>.5).length,4);assert(c.prog.names.includes('Q1_n'));assert(c.prog.names.includes('HN1_a'));});
test('starts make every element visible in the measured window',()=>{
 const d={f:Float64Array.from([1,10,100,1000]),zr:Float64Array.from([1e4,5e3,1e3,100]),zi:Float64Array.from([-1e3,-2e3,-500,-10])};
 const rg=M.dataRanges(d),cc=M.candidate('R(RC)L(QW)',allowed,6),z=(w,re,im)=>Math.hypot(re,im);
 assert(rg.wmin===2*Math.PI&&rg.wmax===2000*Math.PI);
 for(let s=0;s<50;s++){const st=M.startValues(cc,M.streamFor(s,cc.prog.cdc),rg),p=st.p,P=Object.fromEntries(cc.prog.names.map((n,i)=>[n,p[i]]));
  assert(P.R1>=rg.zmin&&P.R1<=rg.zmax&&P.R2>=rg.zmin&&P.R2<=rg.zmax);
  const wc=1/(P.R2*P.C1);assert(wc>=rg.wmin*rg.zmin/rg.zmax*0.999&&wc<=rg.wmax*rg.zmax/rg.zmin*1.001,'RC corner within the data window scaled by the |Z| range');
  assert(P.Q1_n>=0.6&&P.Q1_n<=1);
  for(const n of cc.prog.names){const i=cc.prog.names.indexOf(n);assert(p[i]>=st.lo[i]&&p[i]<=st.hi[i],n);}
 }
});
test('seeded starts are reproducible per circuit and differ between seeds',()=>{
 const a=M.jobs(c,data,{},M.streamFor(42,c.prog.cdc),4),b=M.jobs(c,data,{},M.streamFor(42,c.prog.cdc),4),e=M.jobs(c,data,{},M.streamFor(43,c.prog.cdc),4);
 assert.deepEqual(a.map(j=>Array.from(j.p)),b.map(j=>Array.from(j.p)));assert.notDeepEqual(a.map(j=>Array.from(j.p)),e.map(j=>Array.from(j.p)));
 const r=M.streamFor(7,'R1');for(let i=0;i<1000;i++){const v=r();assert(v>=0&&v<1);}
});
test('four randomized fits can recover known resistor',()=>{const r=M.candidate('R',allowed,1);const batch=M.jobs(r,data,{method:'TRDL',weight:'mod2',maxIter:300,tol:1e-10});const results=batch.map(Y.fit.run).map(result=>M.assess(r,result,data)).filter(Boolean);assert(results.length);assert(Math.min(...results.map(r=>r.rms))<1e-4);});
test('complexity penalty favors fewer elements for same impedance',()=>{const r=M.candidate('R',allowed,1),rr=M.candidate('RR',allowed,2);const a=M.assess(r,{ok:true,p:[90]},data),b=M.assess(rr,{ok:true,p:[45,45]},data);assert(a.score>b.score);assert.equal(a.rms,b.rms);assert.equal(M.assess(r,{ok:false,p:[100]},data),null);assert.equal(M.assess(r,{ok:true,p:[NaN]},data),null);});
test('top 100 classes replace the worst and keep the best fit of a circuit',()=>{const R=Y.modelRank,rows=[];const e=(cdc,lw)=>({cdc,lw,key:cdc,parameters:1,rms:1,curve:null});
 for(let i=0;i<120;i++)R.addEntry(rows,e('R'+i,i-120));assert.equal(rows.length,100);assert.equal(rows[0].lw,-1);assert.equal(rows[99].lw,-100);
 assert(!R.addEntry(rows,e('R119',-500)));R.addEntry(rows,e('R119',1));assert.equal(rows[0].lw,1);assert.equal(rows.length,100);});
test('availability individual exactly one dataset and idle',()=>{Y.state={S:{busy:false},selected:()=>[{}]};Y.app={fitMode:()=> 'single'};assert.equal(M.why(),'');Y.app.fitMode=()=> 'global';assert(M.why());Y.app.fitMode=()=> 'single';Y.state.selected=()=>[{},{}];assert(M.why());Y.state.selected=()=>[{}];Y.state.S.busy=true;assert(M.why());});
console.log(checks+' model search tests passed');
test('display sorting toggles without changing top-100 retention',()=>{
 const a={cdc:'Q1',score:10,lw:5,elements:1,parameters:2,rms:3,hits:1,starts:8,weight:2,notes:['at limit: Q1_n'],result:{msg:'converged'}},b={cdc:'R1',score:5,lw:2.5,elements:1,parameters:1,rms:1,hits:4,starts:4,weight:0.5,notes:[],result:{msg:'iteration limit'}};
 const rows=[{rep:a,members:[a],lw:5},{rep:b,members:[b,b],lw:2.5}];
 for(const key of ['rank','cdc','equiv','elements','parameters','prob','score','prior','rms','hits','status','notes','residuals']){const asc=M.displayRows(rows,key,true),desc=M.displayRows(rows,key,false);assert.equal(asc.length,2);assert.equal(desc.length,2);if(key!=='elements')assert.equal(asc[0],desc[1],key);}
 assert.equal(rows[0].lw,5);
});
test('scaled residual plot includes percent and frequency labels',()=>{
 let labels=[];const ctx={beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(t){labels.push(t)}};
 M.plot({getContext:()=>ctx},[[0,-.1,.2],[2,.3,-.4]]);assert(labels.some(t=>t.includes('%')));assert(labels.some(t=>t.includes('Frequency')));assert(labels.includes('0.0%'));
});
test('FOM follows fit weights; known sigma uses weighted SSE',()=>{
 const c=M.candidate('R',allowed,1), d={f:Float64Array.from([1,10]),zr:Float64Array.from([1,10]),zi:Float64Array.from([0,0])};
 const r={ok:true,p:[2]};
 for(const weight of ['unit','mod','mod2']){
  const metric=M.scoring(d,weight,0), entry=M.assess(c,r,d,metric), wt=Y.fit.weights(d.zr,d.zi,weight);
  const sse=wt[0]*1+wt[1]*64,energy=wt[0]+100*wt[1];
  assert(Math.abs(entry.score-(-4*Math.log(sse/energy)-Math.log(4)))<1e-10);
 }
 const sigma={...d,sr:Float64Array.from([2,4]),si:Float64Array.from([3,5])};
 const metric=M.scoring(sigma,'unit',1),entry=M.assess(c,r,sigma,metric);
 assert(Math.abs(entry.score-(-4.25-2*Math.log(4)))<1e-10);
 assert(M.assess(c,r,d,M.scoring(d,'unit',0)).score>M.assess(c,r,d,M.scoring(d,'unit',1)).score);
 assert.throws(()=>M.scoring({...d,sr:[0,1],si:[1,1]},'unit',1));
});
test('unknown-scale FOM invariant under impedance unit scaling',()=>{
 const c=M.candidate('R',allowed,1);
 for(const mode of ['unit','mod','mod2']){
  const a=M.assess(c,{ok:true,p:[90]},data,M.scoring(data,mode,1));
  const d={...data,zr:Float64Array.from(data.zr,v=>v*1000),zi:Float64Array.from(data.zi,v=>v*1000)};
  const b=M.assess(c,{ok:true,p:[90000]},d,M.scoring(d,mode,1));assert(Math.abs(a.score-b.score)<1e-10);
 }
});
test('quality: failures rejected; limits and large SE noted, discarded only on request',()=>{
 const c=M.candidate('R',allowed,1), good={ok:true,p:[100],msg:'converged',se:[2],atBound:[0]};
 assert.deepEqual(M.quality(c,good),{reject:'',notes:[]});
 for(const bad of [{ok:false},{msg:'iteration limit'},{msg:'stopped: no further progress'},{se:null},{atBound:null},{p:[NaN]},{p:[]}])assert(M.unreliable(c,{...good,...bad}));
 for(const weak of [{atBound:[1],se:[NaN]},{se:[NaN]},{se:[Infinity]},{se:[51]}]){const q=M.quality(c,{...good,...weak});assert.equal(q.reject,'');assert.equal(q.notes.length,1);}
 assert(/R1 51%/.test(M.quality(c,{...good,se:[51]}).notes[0]));
 assert.equal(M.unreliable(c,{...good,se:[51]},{se:true}),'standard error above 50%');
 assert.equal(M.unreliable(c,{...good,se:[51]},{se:true,maxSE:60}),'');
 assert.equal(M.unreliable(c,{...good,atBound:[1],se:[NaN]},{bounds:true}),'parameter at a limit');
 assert.equal(M.unreliable(c,{...good,se:[50]},{se:true}),'');
});
test('same minimum counted over independent starts only',()=>{
 const c=M.candidate('R',allowed,1),item=M.newItem(c,1),e=(chi2,lw)=>({chi2,lw});
 M.consider(item,e(2,1),{reject:'',notes:[]});M.consider(item,e(1,5),{reject:'',notes:[]});assert.equal(item.hits,1);
 M.consider(item,e(1*(1+1e-8),4.9),{reject:'',notes:[]});assert.equal(item.hits,2);assert.equal(item.best.lw,5);
 M.consider(item,e(1,5.1),{reject:'',notes:[]},true);assert.equal(item.hits,2,'refinement not counted');assert.equal(item.best.lw,5.1);
 M.consider(item,e(0.5,9),{reject:'too weak',notes:[]});assert.equal(item.kept.lw,5.1,'discarded fit not kept');assert.equal(item.best.lw,9);
});
test('final fit clones the best parameters and keeps user settings and all flags',()=>{
 const c=M.candidate('Q',allowed,1), job=M.jobs(c,{...data,sr:[1,1,1],si:[2,2,2]},{method:'LMB',weight:'unit',maxIter:900,tol:1e-9},()=>.5)[0];
 const result={p:Float64Array.from([1e-8,.8])}, final=M.refinementJob(job,result);
 assert.deepEqual(Array.from(final.p),[1e-8,.8]);final.p[0]=1;assert.equal(result.p[0],1e-8);
 for(const key of ['method','weight','maxIter','tol','fit','lo','hi','sr','si'])assert.equal(final[key],job[key]);
});
// Exercise both fit phases and cancellation with a controlled worker pool.
class Node {
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.className='';this.controls={'.search-penalty':{value:'1'}};}
 appendChild(n){this.children.push(n);return n;}
 setAttribute(){} getContext(){return null;} querySelector(s){return this.controls[s]||null;}
 querySelectorAll(s){return this.controls[s]||[];}
 closest(){return {querySelectorAll:()=>[{},{},{}],classList:{add(){}}};}
}
async function lifecycle(action){
 let ds={id:'test',fit:{},p:{}},busy=false,applied=0,history=0,cancelled=0,calls=0,modelOpts='unset',meta=null;
 const sdata={...data,sr:Float64Array.from([1,1,1]),si:Float64Array.from([1,1,1]),sigma:'measured'};
 let finished, finish=new Promise(r=>finished=r), progress;
 Object.defineProperty(global,'navigator',{value:{hardwareConcurrency:16},configurable:true});
 global.fetch=async url=>({ok:true,status:200,text:async()=>/priors/.test(url)?'default\t1\ncircuit\tR\t4\n':'R\nR2\nC\n'});
 global.document={createElement:tag=>new Node(tag)};
 Y.ui={toast:msg=>{throw Error(msg)},modal:async opts=>{
  const b=opts.body;
  if(opts.title==='Search models'){
   assert(opts.body.innerHTML.includes('type="range"'));assert(opts.body.innerHTML.includes('value="1"'));
   b.controls['.search-max']={value:'1'};b.controls['.search-kinds input[type=checkbox]:checked']=[{value:'R'}];
   b.controls['.search-starts']={value:'8'};b.controls['.search-seed']={value:'12345'};b.controls['.search-maxse']={value:'50'};
   b.controls['.search-drop-bounds']={checked:false};b.controls['.search-drop-se']={checked:action==='reject'};return true;
  }
  b.controls['.search-status']=new Node('p');b.controls['.search-progress']=new Node('progress');b.controls['.search-count']=new Node('p');b.controls['tbody']=new Node('tbody');opts.onOpen(b);
  progress=()=>{
   if(action==='cancel'){finished(null);return;}
   if(action==='stopApply'){opts.buttons[0].onClick();assert(busy);assert.equal(applied,0);}
   if(['completeApply','applySigma','reject','failedFinal','noSeed'].includes(action)){
    assert(b.controls['.search-count'].textContent.includes('2 / 2 models done'));
    assert.equal(b.controls['.search-progress'].value,2);assert.equal(b.controls['.search-progress'].max,2);
    if(action!=='noSeed')assert(b.controls['.search-status'].textContent.includes('2 stopped early'));
   }
   if(action==='reject'||action==='noSeed'){
    assert(b.controls['.search-status'].textContent.includes('2 rejected'));
    assert.equal(b.controls['tbody'].children.length,0);finished(null);return;
   }
   const row=b.controls['tbody'].children[0];assert(row,'reliable completed fit retained');row.onclick();
   opts.buttons[2].onClick();finished('apply');
  };return finish;
 }};
 Y.app={fitMode:()=> 'single'};
 Y.state={S:{busy:false,datasets:[ds],settings:{method:'TRDL',weight:'mod2',maxIter:50,tol:1e-8}},selected:()=>[ds],fitData:()=>action==='applySigma'?sdata:data,
  setBusy:v=>{busy=v;Y.state.S.busy=v},setModel:(t,o)=>{applied++;modelOpts=o},applyResult:(d,r,m)=>{ds.p.R1=r.p[0];meta=m}};
 Y.history={take:()=>history++};Y.bus={emit:()=>{}};
 function result(){return {ok:true,p:Float64Array.from([100]),msg:'converged',se:[action==='reject'?60:1],atBound:[0]};}
 Y.pool={fitMany:(batch,callback,_,options)=>{
  calls++;assert.equal(options.workerCount,12);const phase=calls;
  assert.equal(batch.length,phase===1||action==='noSeed'?8:2);
  if(phase===2&&action!=='noSeed')batch.forEach(j=>{assert.equal(j.p[0],100);assert.equal(j.weight,'mod2');assert.equal(j.method,'TRDL');assert.equal(j.fit[0],1);});
  let resolve;const promise=new Promise(r=>resolve=r);
  setTimeout(()=>{
   if(phase===1&&['cancel','stopApply'].includes(action)){callback(result(),0);setTimeout(progress,450);return;}
   if(phase===2&&action==='apply'){callback(result(),0);setTimeout(progress,450);return;}
   batch.forEach((_,i)=>callback(action==='noSeed'?{ok:false,msg:'failed'}:phase===2&&action==='failedFinal'?{ok:false,msg:'failed'}:result(),i));resolve([]);
   if(phase===2)setTimeout(progress,450);
  },0);
  return {promise,cancel:()=>{cancelled++;resolve([])}};
 }};
 await M.open();assert(!busy);
 const cancelledAction=['cancel','apply','stopApply'].includes(action);
 assert(cancelledAction?cancelled>=1:cancelled===0);
 if(['cancel','reject','noSeed'].includes(action)){assert.equal(applied,0);assert.equal(history,0);assert.deepEqual(ds.p,{});}
 else{assert.equal(applied,1);assert.equal(history,1);assert.equal(ds.p.R1,100);assert.equal(ds.fit.R1,true);
  assert.equal(modelOpts,undefined,'limits of the current circuit kept by name');assert.equal(meta.weight,action==='applySigma'?'sigma':'mod2');if(action==='applySigma')assert.equal(meta.sigma,'measured');}
 assert.equal(calls,['cancel','stopApply'].includes(action)?1:2);
 console.log('PASS lifecycle '+action);
}
(async()=>{for(const action of ['cancel','apply','stopApply','completeApply','applySigma','reject','failedFinal','noSeed'])await lifecycle(action);})().catch(e=>{console.error(e);process.exitCode=1});
