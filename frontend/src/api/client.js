/* The session lives in an HttpOnly cookie. Credentials never enter client storage. */
(() => {
  const queues=new Map();
  async function request(path,method='GET',data,options={}){
    const response=await fetch('/api'+path,{method,credentials:'same-origin',signal:options.signal,headers:{'Content-Type':'application/json','X-Forma-Request':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
    let result;try{result=await response.json();}catch{throw new Error('后端服务未启动，请使用 python3 -m backend 启动项目。');}
    if(!response.ok){if(response.status===401&&!path.startsWith('/auth/')){api.user=null;api.settings={requiresLogin:true};window.dispatchEvent(new Event('forma-auth-required'));if(parent!==window)parent.postMessage({type:'forma-auth-required'},location.origin);}const error=new Error(result.error||'请求失败');error.status=response.status;error.code=result.code;error.diagnostics=result.diagnostics||[];if(result.code==='USER_CONCURRENCY_LIMIT')showCapacity(result);throw error;}
    return result;
  }
  const api={request,user:null,settings:null,ready:null,
    patch(id,data){const payload=structuredClone(data);const next=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>request('/projects/'+encodeURIComponent(id),'PATCH',payload));queues.set(id,next);next.finally(()=>{if(queues.get(id)===next)queues.delete(id);}).catch(()=>{});return next;},
    async bootstrap(){const data=await request('/bootstrap','POST',{});api.settings=data.settings;api.user=data.user;if(!data.user&&parent!==window)parent.postMessage({type:'forma-auth-required'},location.origin);return data;}
  };
  api.ready=api.bootstrap();api.ready.catch(()=>{});window.FormaAPI=api;
  function showCapacity(result){
    document.querySelector('.forma-capacity-dialog')?.remove();
    const previous=document.activeElement,dialog=document.createElement('dialog');
    dialog.className='forma-capacity-dialog';dialog.setAttribute('aria-labelledby','forma-capacity-title');
    const title=document.createElement('h2');title.id='forma-capacity-title';title.textContent=result.error;
    const note=document.createElement('p');note.textContent=result.hint;
    const list=document.createElement('div');list.className='forma-capacity-tasks';
    for(const task of result.tasks||[]){
      const row=document.createElement('div'),name=document.createElement('strong'),view=document.createElement('button'),cancel=document.createElement('button');
      name.textContent=task.name;view.textContent='查看';cancel.textContent='中断任务';
      view.onclick=()=>{dialog.close();if(parent!==window)parent.location.hash='/build/'+encodeURIComponent(task.project);else location.hash='/build/'+encodeURIComponent(task.project);};
      cancel.onclick=async()=>{cancel.disabled=true;try{await request('/jobs/'+encodeURIComponent(task.id)+'/cancel','POST',{});row.remove();title.textContent='任务已中断，已释放一个名额';note.textContent='可以关闭弹窗，继续发起刚才的任务。中断的项目之后可以恢复生成。';}catch(error){note.textContent=error.message;cancel.disabled=false;}};
      row.append(name,view,cancel);list.append(row);
    }
    const close=document.createElement('button');close.className='forma-capacity-close';close.textContent='知道了';close.onclick=()=>dialog.close();
    dialog.append(title,note,list,close);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus();},{once:true});dialog.showModal();close.focus();
  }
})();
