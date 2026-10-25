const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

class Node {
  constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.value='';}
  set textContent(text){this.text=text;this.children=[];}
  get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  addEventListener(type,handler){this.handlers[type]=handler;}
  setAttribute(key,value){this[key]=value;}
  dispatchEvent(event){this.event=event;}
  focus(){this.focused=true;}
  setSelectionRange(start,end){this.selection=[start,end];}
  click(){this.handlers.click();}
}
const items=[{title:'阅读目标',reason:'让收藏变成阅读',prompt:'为本周待读文章增加阅读目标。'},{title:'重复提醒',reason:'避免重复收藏',prompt:'在收藏前检查重复链接。'}];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(request){
  const root=new Node('div'),input=new Node('textarea'),timers=new Map(),calls=[];
  let serial=0,connections=0;
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/components/project-suggestions/suggestions.js'),'utf8'),{
    window,document:{createElement:tag=>new Node(tag)},Event,
    setTimeout:callback=>{timers.set(++serial,callback);return serial;},clearTimeout:id=>timers.delete(id)
  });
  const component=window.FormaSuggestions.mount(root,{input,onConnect:()=>connections++,request:async(method,data)=>{calls.push({method,data});return request(method,data);}});
  const update=(overrides={})=>component.update({version:1,mode:'ai',available:true,busy:false,state:{version:1,status:'ready',items},...overrides});
  return {root,input,component,update,calls,timers,connections:()=>connections};
}

test('choosing an idea appends editable text, preserves existing input and never sends it',()=>{
  const flow=setup(()=>{throw Error('No request expected');});flow.update();
  flow.input.value='我的补充要求';flow.root.children[1].click();
  assert.equal(flow.input.value,'我的补充要求\n\n'+items[0].prompt);
  assert.equal(flow.input.event.type,'input');assert.equal(flow.input.focused,true);
  assert.equal(flow.calls.length,0);
});
test('model text stays DOM text and ready suggestions do not cause extra calls on refresh',()=>{
  const flow=setup(()=>{throw Error('No request expected');});
  const malicious=[{title:'<img src=x onerror=alert(1)>',reason:'<script>bad()</script>',prompt:'可编辑文本'},items[1]];
  flow.update({state:{status:'ready',items:malicious}});flow.update();
  const button=flow.root.children[1];assert.equal(button.children[0].children[0].textContent,malicious[0].title);
  assert.equal(button.children[1].textContent,malicious[0].reason);assert.equal(flow.calls.length,0);
});
test('missing ideas start once, pending ideas poll, and navigation destroys timers',async()=>{
  const flow=setup(method=>method==='POST'?{version:1,status:'pending',items:[]}:{version:1,status:'ready',items});
  flow.update({state:{version:1,status:'missing',items:[]}});flow.update({state:{status:'missing'}});await flush();
  assert.equal(flow.calls.length,1);assert.equal(flow.calls[0].data.version,1);
  await [...flow.timers.values()][0]();assert.equal(flow.root.children[1].title,items[0].prompt);
  flow.component.destroy();assert.equal(flow.timers.size,0);
});
test('old in-flight responses cannot display suggestions for a newer project version',async()=>{
  let finish;
  const flow=setup(()=>new Promise(resolve=>finish=resolve));
  flow.update({state:{status:'missing'}});
  flow.update({version:2,state:{version:2,status:'ready',items:[{...items[0],title:'新版本方向'},items[1]]}});
  finish({version:1,status:'ready',items});await flush();
  assert.equal(flow.root.children[1].children[0].children[0].textContent,'新版本方向');
  assert.equal(flow.calls.length,1);
});
test('no model and active builds never start automatic paid suggestion requests',()=>{
  const flow=setup(()=>{throw Error('No request expected');});
  flow.update({available:false,mode:'starter',state:{status:'missing'}});flow.root.children[0].click();
  assert.equal(flow.connections(),1);assert.equal(flow.calls.length,0);
  flow.update({busy:true,state:{status:'missing'}});assert.equal(flow.root.hidden,true);assert.equal(flow.calls.length,0);
});
