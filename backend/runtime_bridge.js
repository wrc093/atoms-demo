/* Injected into the sandbox before application code. No network access here. */
(() => {
  const state=Object.assign(Object.create(null),__FORMA_INITIAL__);
  const token=__FORMA_TOKEN__,rules=__FORMA_RULES__,readOnly=__FORMA_READONLY__;
  const pending=new Map(),keyPattern=new RegExp(rules.keyPattern);
  let serial=0;
  function keyError(key){
    return typeof key!=='string'||keyPattern.exec(key)?.[0]!==key||rules.reservedKeys.includes(key)
      ? '数据键名无效：请使用 1–80 位字母、数字、点号、冒号、下划线或短横线，且不能使用保留名称。' : '';
  }
  function report(key,error){
    parent.postMessage({type:'forma-runtime-error',token,key:typeof key==='string'?key.slice(0,80):'',message:error.message,storage:true},'*');
    return error;
  }
  window.FormaStore={
    get(key,fallback){
      const error=keyError(key);
      if(error)throw report(key,new Error(error));
      return Object.hasOwn(state,key)?structuredClone(state[key]):fallback;
    },
    set(key,value){
      let snapshot;
      try{
        const error=keyError(key);
        if(error)throw new Error(error);
        if(readOnly)throw new Error('历史版本预览为只读，应用数据未保存。');
        if(pending.size>=rules.maxPending)throw new Error('保存请求过多，请稍后重试。');
        const json=JSON.stringify(value);
        if(json===undefined)throw new Error('应用数据必须是有效的 JSON。');
        if(new TextEncoder().encode(json).length>rules.maxValueBytes)throw new Error('单项应用数据超过 500 KB。');
        snapshot=JSON.parse(json);
      }catch(error){return Promise.reject(report(key,error));}
      const id=++serial;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{
          pending.delete(id);
          reject(report(key,new Error('保存结果尚未确认，请检查工作台提示后重试。')));
        },12000);
        pending.set(id,{key,value:snapshot,resolve,reject,timer});
        parent.postMessage({type:'forma-runtime-set',token,id,key,value:snapshot},'*');
      });
    }
  };
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.data?.token!==token)return;
    if(event.data.type==='forma-runtime-committed'){
      if(!keyError(event.data.key))state[event.data.key]=structuredClone(event.data.value);
      return;
    }
    if(event.data.type!=='forma-runtime-result')return;
    const task=pending.get(event.data.id);
    if(!task)return;
    clearTimeout(task.timer);pending.delete(event.data.id);
    if(event.data.error)task.reject(new Error(event.data.error));
    else{state[task.key]=task.value;task.resolve();}
  });
  window.addEventListener('error',event=>parent.postMessage({type:'forma-runtime-error',token,message:String(event.message).slice(0,250)},'*'));
})();
