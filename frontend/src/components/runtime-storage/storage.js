/* Durable-save feedback belongs to the host, even when application code ignores errors. */
(() => {
  function mount({frame,getToken,getRules,request,onStatus,onRuntimeError=()=>{},eventTarget=window}){
    const latest=new Map(),queues=new Map(),notices=new Map();
    let pending=0,saved=0,windowStart=0,count=0,destroyed=false;
    function status(){
      const failures=[...latest.values()].filter(entry=>entry.error);
      return {pending,saved,failed:failures.length+notices.size,retryable:failures.length,
        error:failures.at(-1)?.error||[...notices.values()].at(-1)||''};
    }
    function emit(){if(!destroyed)onStatus(status());}
    function notice(key,error){
      if(notices.size>=24&&!notices.has(key))notices.delete(notices.keys().next().value);
      notices.set(key,error);emit();
    }
    function reply(source,token,id,error){
      source.postMessage({type:'forma-runtime-result',token,id,...(error?{error}:{})},'*');
    }
    function enqueue(entry){
      pending++;emit();
      const previous=queues.get(entry.key)||Promise.resolve();
      const task=previous.catch(()=>{}).then(async()=>{
        if(entry.token!==getToken())throw new Error('预览已更新，改动尚未保存，请重试保存。');
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),10000);
        try{await request({key:entry.key,value:entry.value},controller.signal);}
        catch(error){if(error.name==='AbortError')throw new Error('保存结果尚未确认，请重试；重复保存相同内容不会新增数据。');throw error;}
        finally{clearTimeout(timer);}
      });
      queues.set(entry.key,task);
      task.then(()=>{
        if(latest.get(entry.key)===entry){latest.delete(entry.key);notices.delete(entry.key);saved++;}
        if(entry.reply)reply(entry.source,entry.token,entry.id);
        // A host retry can succeed after the original application promise rejected.
        if(entry.token===getToken())entry.source.postMessage({type:'forma-runtime-committed',token:entry.token,key:entry.key,value:entry.value},'*');
      },error=>{
        if(latest.get(entry.key)===entry)entry.error=error.message||'保存失败，请重试。';
        if(entry.reply)reply(entry.source,entry.token,entry.id,error.message||'保存失败，请重试。');
      }).finally(()=>{
        pending--;if(queues.get(entry.key)===task)queues.delete(entry.key);emit();
      });
    }
    function receive(event){
      const message=event.data,token=getToken();
      if(destroyed||event.source!==frame.contentWindow||!token||message?.token!==token)return;
      if(message.type==='forma-runtime-error'){
        if(message.storage)notice(message.key||'invalid-key',String(message.message).slice(0,250));
        else onRuntimeError(String(message.message).slice(0,250));
        return;
      }
      if(message.type!=='forma-runtime-set')return;
      const rules=getRules();
      function deny(error){notice(typeof message.key==='string'?message.key.slice(0,80):'invalid-key',error);reply(event.source,token,message.id,error);}
      if(!Number.isSafeInteger(message.id)||message.id<1){deny('保存请求无效，应用数据未保存。');return;}
      if(!rules){deny('存储配置尚未就绪，请重新打开项目。');return;}
      if(typeof message.key!=='string'||new RegExp(rules.keyPattern).exec(message.key)?.[0]!==message.key||rules.reservedKeys.includes(message.key)){
        deny('数据键名无效：请使用 1–80 位字母、数字、点号、冒号、下划线或短横线，不能使用保留名称。');return;
      }
      if(!latest.has(message.key)&&latest.size>=rules.maxPending){deny('尚有多项数据未保存，请先重试保存后再继续。');return;}
      let value;
      try{
        const json=JSON.stringify(message.value);
        if(json===undefined)throw new Error('应用数据必须是有效的 JSON。');
        if(new TextEncoder().encode(json).length>rules.maxValueBytes)throw new Error('单项应用数据超过 500 KB。');
        value=JSON.parse(json);
      }catch(error){deny(error.message);return;}
      const entry={key:message.key,value,id:message.id,source:event.source,token,reply:true,error:''};
      latest.set(entry.key,entry);notices.delete(entry.key);
      const now=performance.now();if(now-windowStart>=1000){windowStart=now;count=0;}
      if(pending>=rules.maxPending||++count>rules.writesPerSecond){
        entry.error='保存请求过于频繁，应用数据未保存，请稍后重试。';
        reply(entry.source,token,entry.id,entry.error);emit();return;
      }
      enqueue(entry);
    }
    function beforeUnload(event){if(pending||status().failed){event.preventDefault();event.returnValue='';}}
    eventTarget.addEventListener('message',receive);eventTarget.addEventListener('beforeunload',beforeUnload);
    return {
      status,
      retry(){
        if(pending)return;
        // One latest snapshot per key: stale failed attempts never replace a newer edit.
        for(const entry of latest.values())if(entry.error){
          entry.error='';entry.token=getToken();entry.source=frame.contentWindow;entry.reply=false;enqueue(entry);
        }
      },
      destroy(){destroyed=true;eventTarget.removeEventListener('message',receive);eventTarget.removeEventListener('beforeunload',beforeUnload);},
    };
  }
  window.FormaRuntimeStorage={mount};
})();
