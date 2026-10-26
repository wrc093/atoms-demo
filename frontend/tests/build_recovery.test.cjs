/* Exercise failed -> resume -> completed -> fresh workbench navigation. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(status='completed'){
  const nodes=new Map(),timers=new Map(),routes=[],requests=[];let serial=0;
  function node(selector){
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',style:{},dataset:{},hidden:false,disabled:false,
      classList:{add(){},toggle(){}},setAttribute(){},querySelector:part=>node(selector+' '+part)});
    return nodes.get(selector);
  }
  const root={isConnected:true,dataset:{},classList:{add(){},toggle(){}},querySelector:node,querySelectorAll:()=>[]};
  const detail=()=>({project:{id:'p_fixture',currentVersion:status==='completed'?1:0},job:{id:'j_fixture',status,step:status==='completed'?4:2,
    canResume:true,checkpoint:'requirements',error:'模拟模型失败',events:[],created:1,updated:2}});
  const win={addEventListener(){}};
  const context={window:win,document:{querySelector:()=>root,addEventListener(){},removeEventListener(){},hidden:false},
    matchMedia:()=>({matches:false}),AbortController,URL,Date,icon:()=>'',refreshIcons(){},escapeText:value=>value,
    projects:[{id:'p_fixture'}],toast(){},navigate(){throw Error('Must enter a fresh workbench document');},
    location:{href:'http://127.0.0.1:8872/#/build/p_fixture',assign:url=>routes.push(url)},
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++serial,clearInterval(){},
    FormaAPI:{request:async(url,method)=>{requests.push({url,method});if(url.endsWith('/resume'))status='completed';return detail();}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/build/build.js'),'utf8'),context);
  return {root,nodes,timers,routes,requests,build:win.FormaBuild};
}
test('completed generation enters a fresh document without issuing a second generation request',async()=>{
  const flow=setup();await flow.build.mount('p_fixture');
  assert.equal(flow.routes.length,0);assert.equal(flow.timers.size,1);
  [...flow.timers.values()][0]();
  assert.deepEqual(flow.routes,['http://127.0.0.1:8872/index.html#/workspace/p_fixture']);
  assert.equal(flow.requests.length,1);assert.equal(flow.requests[0].method,undefined);
});
test('failed ordinary request resumes through the job endpoint then opens the saved version',async()=>{
  const flow=setup('failed');await flow.build.mount('p_fixture');
  const button=flow.nodes.get('[data-build-resume]');assert.equal(button.hidden,false);
  await button.onclick();assert.equal(button.disabled,false);
  assert.deepEqual(flow.requests.filter(call=>call.method==='POST'),[{url:'/jobs/j_fixture/resume',method:'POST'}]);
  assert.equal(flow.timers.size,1);[...flow.timers.values()][0]();
  assert.equal(flow.routes[0],'http://127.0.0.1:8872/index.html#/workspace/p_fixture');
});
test('leaving the generation page prevents a delayed completion redirect from taking over navigation',async()=>{
  const flow=setup();await flow.build.mount('p_fixture');const finish=[...flow.timers.values()][0];
  flow.build.dispose();finish();assert.deepEqual(flow.routes,[]);assert.equal(flow.timers.size,0);
});
