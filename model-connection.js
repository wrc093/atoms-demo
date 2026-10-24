/* Shared user-owned model connection. Never persist the key in client storage. */
(() => {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dialog=document.createElement('dialog');dialog.className='mc-dialog';dialog.setAttribute('aria-labelledby','mc-title');
  dialog.innerHTML=`<button class="mc-close" type="button" aria-label="关闭 API 连接设置">×</button><div class="mc-eyebrow">YOUR KEY. YOUR CHOICE.</div><h2 id="mc-title">用自己的模型，<br>构建自己的想法。</h2><p class="mc-intro">连接你正在使用的模型服务，构建费用由该服务按你的账号计费。</p>
    <form id="model-connection-form" autocomplete="off"><label>模型服务<select name="provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">其他兼容服务</option></select></label><label>模型名称<input name="model" required maxlength="160" placeholder="例如 deepseek-flash" spellcheck="false"></label><label>API Key<input name="apiKey" type="password" maxlength="4096" autocomplete="off" spellcheck="false" placeholder="粘贴你的 API Key"></label><details class="mc-advanced"><summary>连接选项 <span>Base URL / 协议</span></summary><label>Base URL<input name="baseUrl" type="url" required maxlength="512" placeholder="https://api.deepseek.com" spellcheck="false"></label><label>接口协议<select name="api"><option value="chat_completions">Chat Completions · OpenAI 兼容</option><option value="responses">Responses</option></select></label></details><p class="mc-retention">Key 仅暂存在本机服务内存中，退出账号或重启服务后清除。开始构建时，需求和源码会发送至你填写的服务。</p><p class="mc-error" role="alert" hidden></p><div class="mc-actions"><button class="mc-remove" type="button" hidden>移除连接</button><button class="mc-submit" type="submit">保存并使用 <span>↗</span></button></div><p class="mc-caption">保存连接不调用模型，首次构建时验证 Key 是否可用。</p></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),error=dialog.querySelector('.mc-error'),submit=dialog.querySelector('[type=submit]'),remove=dialog.querySelector('.mc-remove');
  let resolveOpen,opener,pending=false,opening=false;
  const presets={deepseek:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',api:'chat_completions'},openai:{baseUrl:'https://api.openai.com/v1',model:'gpt-4.1-mini',api:'chat_completions'}};
  function apply(settings,notify=false){FormaAPI.settings=settings;window.dispatchEvent(new CustomEvent('forma-model-connection-change',{detail:settings}));if(notify&&parent!==window)parent.postMessage({type:'forma-model-settings-changed'},location.origin);return settings;}
  async function refresh(){const data=await FormaAPI.request('/model-connection');return apply(data.settings);}
  function markDialog(open){document.documentElement.toggleAttribute('data-model-dialog-open',open);if(parent!==window)parent.postMessage({type:'forma-model-dialog-state',open},location.origin);}
  function finish(saved=false){if(pending)return;form.elements.apiKey.value='';dialog.close();markDialog(false);const inspector=dialog.querySelector('#forma-dev-inspector');if(inspector)document.body.append(inspector);resolveOpen?.(saved);resolveOpen=null;opener?.isConnected&&opener.focus();}
  async function open(){
    if(opening||dialog.open){if(dialog.open)dialog.focus();return false;}
    opening=true;opener=document.activeElement;
    try{await refresh();}catch(failure){if(failure.status===401){opening=false;return false;}}
    const saved=FormaAPI.settings?.userModel,connection=saved?.ready?saved:presets.deepseek;
    form.reset();error.hidden=true;pending=false;submit.disabled=false;
    form.elements.provider.value=connection.baseUrl===presets.deepseek.baseUrl?'deepseek':connection.baseUrl===presets.openai.baseUrl?'openai':'custom';
    ['model','baseUrl','api'].forEach(key=>form.elements[key].value=connection[key]);
    form.elements.apiKey.required=!saved?.ready;form.elements.apiKey.placeholder=saved?.ready?'已配置 · 留空保留当前 Key':'粘贴你的 API Key';remove.hidden=!saved?.ready;
    dialog.querySelector('details').open=form.elements.provider.value==='custom';dialog.showModal();markDialog(true);const inspector=document.getElementById('forma-dev-inspector');if(inspector)dialog.append(inspector);opening=false;
    form.elements.apiKey.focus();
    return new Promise(resolve=>resolveOpen=resolve);
  }
  function options(selected){const settings=FormaAPI.settings||{};return `<option value="ai" ${!settings.modelReady?'disabled':''} ${selected==='ai'?'selected':''}>平台模型${settings.modelReady?' · '+escape(settings.model):' · 暂未配置'}</option><option value="byok" ${selected==='byok'?'selected':''}>使用自己的 API Key${settings.userModel?.ready?' · '+escape(settings.userModel.model):''}</option><option value="starter" ${selected==='starter'?'selected':''}>体验示例 · 无需 API Key</option>`;}
  function label(mode){return mode==='byok'?'自己的模型':mode==='starter'?'示例构建':'平台模型';}
  form.elements.provider.addEventListener('change',()=>{
    const preset=presets[form.elements.provider.value];
    form.elements.apiKey.value='';form.elements.apiKey.required=true;form.elements.apiKey.placeholder='粘贴这个服务的 API Key';
    if(preset)['model','baseUrl','api'].forEach(key=>form.elements[key].value=preset[key]);
    else{form.elements.baseUrl.value='';form.elements.model.value='';}
    dialog.querySelector('details').open=!preset;
  });
  form.elements.baseUrl.addEventListener('input',()=>{form.elements.apiKey.required=form.elements.baseUrl.value.replace(/\/$/,'')!==FormaAPI.settings?.userModel?.baseUrl;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();if(pending)return;
    pending=true;submit.disabled=true;submit.textContent='保存中…';remove.disabled=true;error.hidden=true;
    const data=Object.fromEntries(new FormData(form));delete data.provider;
    try{const result=await FormaAPI.request('/model-connection','PUT',data);form.elements.apiKey.value='';apply(result.settings,true);window.dispatchEvent(new Event('forma-user-model-selected'));pending=false;finish(true);}
    catch(failure){error.textContent=failure.message;error.hidden=false;}
    finally{pending=false;submit.disabled=false;submit.innerHTML='保存并使用 <span>↗</span>';remove.disabled=false;}
  });
  remove.addEventListener('click',async()=>{if(pending)return;pending=true;remove.disabled=true;error.hidden=true;try{const result=await FormaAPI.request('/model-connection','DELETE',{});apply(result.settings,true);pending=false;finish(false);}catch(failure){error.textContent=failure.message;error.hidden=false;}finally{pending=false;remove.disabled=false;}});
  dialog.querySelector('.mc-close').addEventListener('click',()=>finish());
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)finish();}});
  window.addEventListener('message',event=>{const frame=document.querySelector('.workspace-page>iframe');if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;if(event.data?.type==='forma-model-settings-changed')refresh().catch(()=>{});if(event.data?.type==='forma-model-dialog-state'&&typeof event.data.open==='boolean')document.documentElement.toggleAttribute('data-model-dialog-open',event.data.open);});
  window.addEventListener('hashchange',()=>{if(dialog.open)finish();else markDialog(false);});
  window.addEventListener('forma-auth-required',()=>{pending=false;opening=false;if(dialog.open)finish();form.elements.apiKey.value='';});
  window.addEventListener('pagehide',()=>form.elements.apiKey.value='');
  window.FormaModel={open,refresh,options,label};
})();
