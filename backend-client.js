/* The session lives in an HttpOnly cookie. Credentials never enter client storage. */
(() => {
  const queues=new Map();
  async function request(path,method='GET',data){
    const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Forma-Request':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
    let result;try{result=await response.json();}catch{throw new Error('后端服务未启动，请使用 python3 server.py 启动项目。');}
    if(!response.ok){if(response.status===401&&!path.startsWith('/auth/')){api.user=null;api.settings={requiresLogin:true};window.dispatchEvent(new Event('forma-auth-required'));if(parent!==window)parent.postMessage({type:'forma-auth-required'},location.origin);}const error=new Error(result.error||'请求失败');error.status=response.status;throw error;}
    return result;
  }
  const api={request,user:null,settings:null,ready:null,
    patch(id,data){const payload=structuredClone(data);const next=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>request('/projects/'+encodeURIComponent(id),'PATCH',payload));queues.set(id,next);next.finally(()=>{if(queues.get(id)===next)queues.delete(id);}).catch(()=>{});return next;},
    async bootstrap(){const data=await request('/bootstrap','POST',{});api.settings=data.settings;api.user=data.user;if(!data.user&&parent!==window)parent.postMessage({type:'forma-auth-required'},location.origin);return data;}
  };
  api.ready=api.bootstrap();api.ready.catch(()=>{});window.FormaAPI=api;
})();
