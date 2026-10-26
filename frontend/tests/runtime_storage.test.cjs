const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const fixture=JSON.parse(execFileSync('python3',['-c',`
import json
from backend.compiler import compile_preview
from backend.runtime_storage import RULES
print(json.dumps({'rules':RULES,'html':compile_preview([],{'todo.tasks.v1':[]},'fixture-token'),
                  'readonly':compile_preview([],{},'fixture-token',True)}))
`],{cwd:root,encoding:'utf8'}));
const hostScript=fs.readFileSync(path.join(root,'frontend/src/components/runtime-storage/storage.js'),'utf8');
const bridgeScript=html=>html.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<4;i++)await flush();}
function setup(request,readonly=false){
  const hostListeners=new Map(),appListeners=new Map(),saved=new Map(),states=[],calls=[];
  let token='fixture-token';
  const eventTarget={addEventListener:(name,fn)=>hostListeners.set(name,fn),removeEventListener:name=>hostListeners.delete(name)};
  const source={postMessage:message=>appListeners.get('message')?.({source:parent,data:message})};
  const parent={postMessage:message=>hostListeners.get('message')?.({source,data:message})};
  const hostWindow={};vm.runInNewContext(hostScript,{window:hostWindow,performance,AbortController,TextEncoder,structuredClone,setTimeout,clearTimeout});
  const host=hostWindow.FormaRuntimeStorage.mount({frame:{contentWindow:source},getToken:()=>token,getRules:()=>fixture.rules,eventTarget,
    request:async(data,signal)=>{calls.push(structuredClone(data));if(request)await request(data,signal);saved.set(data.key,structuredClone(data.value));},
    onStatus:state=>states.push(structuredClone(state))});
  const app={addEventListener:(name,fn)=>appListeners.set(name,fn)};
  vm.runInNewContext(bridgeScript(readonly?fixture.readonly:fixture.html),{window:app,parent,structuredClone,TextEncoder,setTimeout,clearTimeout});
  return {store:app.FormaStore,host,calls,saved,states,source,parent,hostListeners,appListeners,
    token:value=>token=value,send:(data,origin=source)=>hostListeners.get('message')?.({source:origin,data:{token,...data}})};
}

test('namespaced keys traverse preview bridge and host, and become readable only after acknowledgement',async()=>{
  let release;const flow=setup(data=>data.key==='todo.tasks.v1'?new Promise(resolve=>release=resolve):undefined);
  const value=[{id:'one',text:'验收任务',done:true}],pending=flow.store.set('todo.tasks.v1',value);
  value[0].done=false;
  assert.equal(flow.store.get('todo.tasks.v1',[]).length,0);
  await settle();assert.equal(flow.host.status().pending,1);
  release();await pending;await settle();
  assert.equal(flow.saved.get('todo.tasks.v1')[0].done,true);
  assert.equal(flow.store.get('todo.tasks.v1',[])[0].done,true);
  assert.equal(flow.host.status().failed,0);
  await flow.store.set('todo:filter-v1','done');await settle();
  assert.equal(flow.saved.get('todo:filter-v1'),'done');flow.host.destroy();
});

test('a swallowed application error remains visible to the host and retains an exact retry snapshot',async()=>{
  let fail=true;const flow=setup(()=>{if(fail)throw Error('网络暂不可用');});
  await flow.store.set('todo.tasks.v1',[{text:'不能丢失',done:true}]).catch(()=>{});await settle();
  assert.equal(flow.store.get('todo.tasks.v1',[]).length,0);
  assert.equal(flow.saved.size,0);assert.equal(flow.host.status().retryable,1);
  assert.match(flow.host.status().error,/网络暂不可用/);
  await settle();assert.equal(flow.host.status().failed,1);
  fail=false;flow.host.retry();await settle();
  assert.equal(flow.host.status().failed,0);
  assert.equal(flow.saved.get('todo.tasks.v1')[0].done,true);
  assert.equal(flow.store.get('todo.tasks.v1',[])[0].done,true);flow.host.destroy();
});

test('same-key writes are serial and an older failure cannot replace or retry over the newer value',async()=>{
  let release;const flow=setup(async data=>{if(data.value==='old')await new Promise((_,reject)=>release=()=>reject(Error('旧请求失败')));});
  const first=flow.store.set('todo.filter.v1','old').catch(()=>{});
  const second=flow.store.set('todo.filter.v1','new');
  await settle();assert.equal(flow.calls.length,1);release();
  await Promise.all([first,second]);await settle();
  assert.equal(flow.store.get('todo.filter.v1'),'new');assert.equal(flow.host.status().failed,0);
  flow.host.retry();await settle();assert.equal(flow.calls.length,2);flow.host.destroy();
});

test('reserved and malformed keys report a persistent error even when the application catches rejection',async()=>{
  for(const key of ['__proto__','constructor','prototype','bad/key','含中文','x'.repeat(81),'x\n']){
    const flow=setup();await flow.store.set(key,[]).catch(()=>{});await settle();
    assert.equal(flow.calls.length,0,key);assert.equal(flow.host.status().failed,1,key);flow.host.destroy();
  }
});

test('host independently rejects invalid keys and spoofed iframe sources or tokens',async()=>{
  const flow=setup();
  flow.send({type:'forma-runtime-set',id:1,key:'tasks',value:1},{});
  flow.send({type:'forma-runtime-set',token:'forged',id:1,key:'tasks',value:1});
  await settle();assert.equal(flow.calls.length,0);assert.equal(flow.host.status().failed,0);
  flow.send({type:'forma-runtime-set',id:1,key:'__proto__',value:{}});
  await settle();assert.equal(flow.calls.length,0);assert.equal(flow.host.status().failed,1);flow.host.destroy();
});

test('UTF-8 byte limits and readonly previews reject rather than claim successful persistence',async()=>{
  const large=setup();await large.store.set('tasks','字'.repeat(170000)).catch(()=>{});await settle();
  assert.equal(large.calls.length,0);assert.match(large.host.status().error,/500 KB/);large.host.destroy();
  const readonly=setup(null,true);await assert.rejects(readonly.store.set('tasks',[]),/只读/);await settle();
  assert.equal(readonly.calls.length,0);readonly.host.destroy();
});

test('navigation warns about failed writes until retry succeeds and listeners are cleaned up',async()=>{
  let fail=true;const flow=setup(()=>{if(fail)throw Error('保存失败');});
  await flow.store.set('tasks',[1]).catch(()=>{});await settle();
  const event={preventDefault(){this.prevented=true;}};flow.hostListeners.get('beforeunload')(event);
  assert.equal(event.prevented,true);
  fail=false;flow.host.retry();await settle();
  const clean={preventDefault(){this.prevented=true;}};flow.hostListeners.get('beforeunload')(clean);
  assert.equal(clean.prevented,undefined);flow.host.destroy();assert.equal(flow.hostListeners.size,0);
});


test('host throttling retains the newest valid snapshot for an explicit retry',async()=>{
  const flow=setup();
  const requests=[];
  for(let i=0;i<21;i++){
    flow.send({type:'forma-runtime-set',id:i+1,key:'tasks',value:[i]});
  }
  await settle();assert.equal(flow.host.status().retryable,1);
  assert.equal(flow.saved.get('tasks')[0],19);
  flow.host.retry();await settle();
  assert.equal(flow.saved.get('tasks')[0],20);assert.equal(flow.host.status().failed,0);flow.host.destroy();
});
