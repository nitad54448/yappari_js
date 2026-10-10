'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
Object.defineProperty(global,'navigator',{value:{hardwareConcurrency:16},configurable:true});
global.Y={coreSources:[],fit:{run:()=>({ok:true})}};
let live=0,peak=0,created=0,running=0,maxRunning=0;
class Worker {
 constructor(){created++;live++;peak=Math.max(peak,live);this.dead=false;}
 postMessage(m){running++;maxRunning=Math.max(maxRunning,running);this.timer=setTimeout(()=>{
  if(this.dead)return;running--;m.jobs.forEach((job,i)=>this.onmessage({data:{k:m.first+i,result:{ok:true,id:job.id},last:i===m.jobs.length-1}}));
 },20);}
 terminate(){if(this.dead)return;this.dead=true;live--;if(this.timer){clearTimeout(this.timer);this.timer=null;}}
}
global.Worker=Worker;
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/workers.js'),'utf8'));
(async()=>{
 const jobs=Array.from({length:12},(_,id)=>({id})),seen=[];
 await Y.pool.fitMany(jobs,(r,i)=>seen.push([r.id,i]),null,{workerCount:8}).promise;
 assert.equal(live,8);assert.equal(peak,8);assert.equal(maxRunning,8);assert.equal(seen.length,12);assert(seen.every(([id,i])=>id===i));
 seen.length=0;await Y.pool.fitMany(jobs,(r,i)=>seen.push([r.id,i]),null,{workerCount:1}).promise;
 assert.equal(live,1);assert.equal(seen.length,12);
 const p=Y.pool.fitMany(jobs,()=>{throw Error('cancelled fit delivered')},null,{workerCount:8});p.cancel();await p.promise;
 assert(p.stopped());console.log('PASS worker budgets, parallel dispatch, indexed results, resize and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
