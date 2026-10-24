/* A regression here can issue a second paid model call, so test the submit boundary. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup({localVersion=1,serverVersion=1,connected=false}={}){
  const handlers={},requests=[],saved=[],routes=[],button={disabled:false,isConnected:true};
  const project={id:'p_fixture',currentVersion:localVersion,plan:{}};
  const form={id:'plan-form',dataset:{project:project.id},querySelector:()=>button,isConnected:true};
  const brief={appName:'测试项目',goal:'最初的完整需求',mode:'byok'};
  let keyPrompts=0;
  const context={document:{addEventListener:(type,handler)=>handlers[type]=handler},window:{addEventListener:()=>{}},projects:[project],clearTimeout,structuredClone,
    FormaAPI:{settings:{userModel:{ready:connected}},request:async(url,method,data)=>{requests.push({url,method,data});return url.endsWith('/generate')?{job:{id:'job_test'}}:{project:{currentVersion:serverVersion}};}},
    FormaModel:{open:async()=>{keyPrompts++;return false;}},navigate:route=>routes.push(route),toast:()=>{}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../plan.js'),'utf8'),context);
  context.readPlanForm=()=>brief;context.persistPlan=async project=>saved.push(structuredClone(project.plan));
  return {requests,saved,routes,button,brief,keyPrompts:()=>keyPrompts,submit:()=>handlers.submit({target:form,preventDefault(){}})};
}
test('existing project saves and returns without any model call or key prompt',async()=>{
  const flow=setup();await flow.submit();
  assert.equal(flow.saved.length,1);assert.deepEqual(flow.routes,['/workspace/p_fixture']);
  assert.equal(flow.requests.filter(item=>item.url.endsWith('/generate')).length,0);assert.equal(flow.keyPrompts(),0);
});
test('server version prevents a stale plan page from repeating the original build',async()=>{
  const flow=setup({localVersion:0,serverVersion:2});await flow.submit();
  assert.deepEqual(flow.routes,['/workspace/p_fixture']);assert.equal(flow.requests.length,1);
});
test('first build still sends the brief once and enters the generation page',async()=>{
  const flow=setup({localVersion:0,serverVersion:0,connected:true});await flow.submit();
  const calls=flow.requests.filter(item=>item.url.endsWith('/generate'));
  assert.equal(calls.length,1);assert.equal(calls[0].data.prompt,flow.brief.goal);assert.equal(calls[0].data.operation,'build');
  assert.deepEqual(flow.routes,['/build/p_fixture']);
});
test('rapid repeated clicks cannot submit the first build twice',async()=>{
  const flow=setup({localVersion:0,serverVersion:0,connected:true});await Promise.all([flow.submit(),flow.submit()]);
  assert.equal(flow.requests.filter(item=>item.url.endsWith('/generate')).length,1);
});
