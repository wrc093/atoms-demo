/* Real project controller: jobs, compiled previews, source versions and runtime data. */
(() => {
  const product=document.querySelector('.fm-product'),params=new URLSearchParams(location.search),id=params.get('id');
  const api=path=>'/projects/'+encodeURIComponent(id)+path;
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons=()=>window.lucide?.createIcons();
  const thread=product.querySelector('.fm-thread'),target=product.querySelector('.fm-preview-target'),overlay=product.querySelector('.fm-overlay');
  let threadSignature='',detail,loadedVersion=0,previewToken='',pollTimer,toastTimer,opener,selectedVersion,reviewRequest=0;
  const runtimeQueues=new Map();
  let runtimePending=0,runtimeWindow=0,runtimeCount=0;
  target.innerHTML='<iframe class="fm-running-app" title="生成应用的交互预览" sandbox="allow-scripts allow-forms allow-modals"></iframe>';
  const frame=target.querySelector('iframe');
  thread.innerHTML='<p class="fm-response">正在读取服务端项目…</p>';
  product.querySelector('.fm-prototype').textContent='创作空间';
  product.querySelector('[data-action="share"]').innerHTML='导出源码'+icon('download');product.querySelector('[data-action="share"]').dataset.action='export';
  product.querySelector('.fm-input-note').textContent='修改会生成新源码版本 · ⌘ / Ctrl + Enter 发送';
  const mode=document.createElement('select');mode.className='fm-generation-mode';mode.setAttribute('aria-label','生成方式');
  product.querySelector('.fm-composer>div>span').replaceWith(mode);
  const modelPicker=FormaModelPicker.mount(mode,{compact:true});
  let suggestionsInitialized=false;
  const projectSuggestions=FormaSuggestions.mount(product.querySelector('.fm-suggestions'),{
    request:(method,data)=>FormaAPI.request(api('/suggestions'),method,data),
    input:product.querySelector('.fm-composer textarea'),
    onConnect:()=>FormaModel.open(),
  });
  function syncSuggestions(){
    if(!suggestionsInitialized||!detail)return;
    projectSuggestions.update({version:detail.project.currentVersion,busy:!!active()||sending,
      mode:mode.value,available:mode.value==='ai'?!!FormaAPI.settings?.modelReady:mode.value==='byok'&&!!FormaAPI.settings?.userModel?.ready,
      state:detail.suggestions});
  }
  const planButton=document.createElement('button');planButton.dataset.action='plan';planButton.className='fm-quiet fm-plan-button';planButton.innerHTML=icon('notebook-pen')+'方案';
  const buildButton=document.createElement('button');buildButton.dataset.action='build';buildButton.className='fm-quiet';buildButton.innerHTML=icon('play')+'更新预览';
  product.querySelector('.fm-project-actions').prepend(planButton,buildButton);
  const header=product.querySelector('.fm-header'),projectName=product.querySelector('.fm-project-name'),actions=product.querySelector('.fm-project-actions');
  header.querySelector('.fm-project-button').remove();
  header.querySelector('.fm-slash').after(projectName);
  header.querySelector('.fm-avatar').remove();header.querySelector('.fm-prototype').remove();
  header.append(actions);product.querySelector('.fm-projectbar').remove();
  const brand=header.querySelector('.fm-brand');brand.setAttribute('role','button');brand.tabIndex=0;brand.setAttribute('aria-label','返回我的项目');brand.addEventListener('click',()=>go('/projects'));brand.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go('/projects');}});
  const themeButton=document.createElement('button');themeButton.className='fm-iconbutton fm-theme-toggle';themeButton.dataset.action='theme';themeButton.setAttribute('aria-label','切换深色模式');themeButton.innerHTML=icon('sun-moon');
  const menu=document.createElement('details');menu.className='fm-more-menu';menu.innerHTML='<summary aria-label="更多项目操作">'+icon('ellipsis')+'</summary><div class="fm-more-items"></div>';
  const menuItems=menu.querySelector('div');menuItems.append(buildButton,actions.querySelector('[data-action="new"]'),actions.querySelector('[data-action="export"]'));
  menuItems.querySelector('[data-action="new"]').innerHTML=icon('plus')+'新建项目';menuItems.querySelector('[data-action="new"]').className='fm-quiet';
  menuItems.querySelectorAll('button').forEach(button=>button.setAttribute('aria-label',button.textContent.trim()));
  actions.append(themeButton,menu);
  document.addEventListener('click',e=>{if(!menu.contains(e.target)||e.target.closest('button'))menu.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
  const connectionButton=document.createElement('button');connectionButton.type='button';connectionButton.className='fm-quiet';connectionButton.dataset.action='model-settings';connectionButton.setAttribute('aria-label','模型与 API Key');connectionButton.innerHTML=icon('key-round')+'模型与 API Key';menuItems.append(connectionButton);

  const skillButton=document.createElement('button');skillButton.type='button';skillButton.className='fm-quiet';skillButton.dataset.action='skills';skillButton.setAttribute('aria-label','Skill 扩展');skillButton.innerHTML=icon('puzzle')+'Skill 扩展';menuItems.append(skillButton);
  const ready=FormaAPI.ready;
  window.FormaWorkspace={id,ready,build,refresh:load,toast};
  function toast(text){const node=product.querySelector('.fm-toast');node.textContent=text;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,4300);}
  function go(route){if(parent!==window)parent.location.hash=route;else location.href='index.html#'+route;}
  function close(){overlay.hidden=true;overlay.classList.remove('fm-review-overlay');opener?.isConnected&&opener.focus();}
  function modal(html,review=false){if(overlay.hidden)opener=document.activeElement;overlay.classList.toggle('fm-review-overlay',review);overlay.innerHTML=`<section class="fm-modal${review?' fm-review':''}" role="dialog" aria-modal="true" aria-labelledby="fm-dialog-title"><button class="fm-close" data-action="close" aria-label="关闭">${icon('x')}</button>${html}</section>`;overlay.hidden=false;icons();overlay.querySelector('input,button:not(.fm-close)')?.focus();}
  const active=()=>detail?.job&&['queued','running'].includes(detail.job.status);
  function renderThread(scroll=false){
    if(!detail)return;
    const messages=detail.messages.length?detail.messages:[{role:'user',text:detail.project.prompt},{role:'assistant',text:detail.project.currentVersion?'初始项目已准备好。直接使用预览，或者通过对话与编辑器继续修改。':'确认方案后，即可开始构建。',version:detail.project.currentVersion}];
    const job=detail.job;
    const signature=JSON.stringify([messages,job]);
    const previousScroll=thread.scrollTop;
    if(signature!==threadSignature){threadSignature=signature;thread.innerHTML=messages.map(message=>message.role==='user'?`<div class="fm-user-message">${esc(message.text)}</div>`:`<div class="fm-server-response"><div class="fm-agent-title"><span class="fm-agent-mark">f</span>Forma<span>构建助手</span></div><p class="fm-response">${esc(message.text)}</p>${message.version?`<button class="fm-change-link" data-review="${message.version}">${icon('git-commit-horizontal')}查看源码版本<span>V${message.version}</span>${icon('arrow-up-right')}</button>`:''}</div>`).join('');
    if(job&&active())thread.insertAdjacentHTML('beforeend',`<div class="fm-server-job" role="status"><strong><i class="fm-job-spinner"></i>${job.mode!=='starter'?'模型正在构建':'示例构建'}</strong>${job.events.map(event=>`<p>${icon('check')}${esc(event.text)}</p>`).join('')}<button class="fm-quiet" data-action="cancel">取消任务</button></div>`);
    if(job&&['failed','cancelled'].includes(job.status))thread.insertAdjacentHTML('beforeend',`<div class="fm-server-job fm-job-error" role="alert"><strong>${job.status==='failed'?'本次任务未完成':'任务已取消'}</strong><p>${esc(job.error)}</p>${job.canResume?`<button class="fm-quiet" data-action="resume">${icon('play')}恢复生成</button>`:'<p>源码已有新修改，请基于当前内容发起新任务。</p>'}</div>`);
    thread.scrollTop=previousScroll;}
    buildButton.disabled=!!active()||!detail.project.dirty;
    buildButton.title=detail.project.dirty?'校验并运行已保存的源码':'预览已是最新版本';
    product.querySelector('.fm-live').innerHTML=`<span></span>${active()?'构建中':job&&['failed','cancelled'].includes(job.status)?'可恢复生成':'已就绪'}`;
    product.querySelector('.fm-composer [type=submit]').disabled=!!active()||sending;mode.disabled=!!active()||sending;
    product.querySelector('.fm-canvas-footer>span:first-child').innerHTML=`<span class="fm-tiny-dot"></span>${detail.project.currentVersion?'运行 V'+detail.project.currentVersion:'等待首次构建'}${detail.project.dirty?' · 有未构建草稿':''}`;
    product.querySelector('.fm-canvas-footer>span:last-child').textContent=detail.project.dirty?'草稿已保存 · 等待更新预览':'所有更改已保存';
    syncSuggestions();
    icons();if(scroll)thread.scrollTo({top:thread.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  async function preview(){
    if(!detail?.project.currentVersion)return;
    const result=await FormaAPI.request(api('/preview'));previewToken=result.token;loadedVersion=result.version;frame.srcdoc=result.html;
  }
  async function load(refreshFiles=false,scroll=false,preserveSource=false){
    clearTimeout(pollTimer);
    detail=await FormaAPI.request(api(''));
    window.FormaWorkspace.detail=detail;
    product.querySelector('.fm-project-name>span:last-child').firstChild.textContent=detail.project.name;
    product.querySelector('.fm-project-name small').textContent=active()?'正在构建…':detail.project.dirty?'草稿待预览':detail.project.currentVersion?'V'+detail.project.currentVersion+' · 已保存':'等待构建';
    renderThread(scroll);
    const changed=detail.project.currentVersion!==loadedVersion;const wasLoaded=loadedVersion>0;
    if(changed)await preview();
    if(!preserveSource&&(refreshFiles||(changed&&wasLoaded)))window.dispatchEvent(new Event('forma-source-changed'));
    if(active())pollTimer=setTimeout(()=>load(false,true).catch(error=>toast(error.message)),1000);
  }
  function hasDrafts(){if(window.FormaFiles?.dirty()){toast('编辑器还有未保存的草稿，请先保存，再生成或恢复版本。');return true;}return false;}
  let sending=false;
  async function generate(prompt,options={}){
    if(!prompt.trim()||active()||sending||hasDrafts())return;
    sending=true;renderThread();
    const textarea=product.querySelector('.fm-composer textarea'),draft=textarea.value;
    try{
      if((options.mode||mode.value)==='byok'&&!FormaAPI.settings?.userModel?.ready){if(!await FormaModel.open())return;}
      await FormaAPI.request(api('/generate'),'POST',{prompt,mode:options.mode||mode.value,operation:options.operation||'modify'});
      if(textarea.value===draft)textarea.value='';await load(false,true);
    }catch(error){toast(error.message);}
    finally{sending=false;renderThread();}
  }
  let building=false;
  async function build(options={}){
    if(building)throw new Error('正在检查代码，请稍候。');
    if(active())throw new Error('项目正在构建，请等待完成。');
    if(window.FormaFiles?.dirty())throw new Error('编辑器还有未保存的修改，请先保存所有修改。');
    const sourceRevision=options.sourceRevision??window.FormaFiles?.revision();
    building=true;
    try{
      await load(false,false,true);if(active())throw new Error('项目正在构建，请等待完成。');
      if(sourceRevision!=null&&sourceRevision!==detail.project.sourceRevision)throw new Error('服务器源码已更新，请刷新并合并后再更新预览。');
      if(!detail.project.dirty&&detail.project.currentVersion){window.FormaFiles?.clearBuildIssue();toast('草稿已保存，当前预览为 V'+detail.project.currentVersion+'。');return;}
      const result=await FormaAPI.request(api('/build'),'POST',{sourceRevision});
      await load(false,true,true);window.FormaFiles?.clearBuildIssue();
      toast('静态检查通过，已更新本机预览 V'+result.version+'。'+(window.FormaFiles?.dirty()?'还有新修改未保存。':''));
    }catch(error){window.FormaFiles?.showBuildIssue(error);throw error;}
    finally{building=false;}
  }
  const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  async function history(number=detail.project.currentVersion){
    selectedVersion=Number(number);const request=++reviewRequest;
    const {version}=await FormaAPI.request(api('/versions?number='+selectedVersion));if(request!==reviewRequest)return;
    const current=version.number===detail.project.currentVersion;
    modal(`<header class="fm-review-head"><div class="fm-modal-eyebrow">SOURCE HISTORY / SERVER SNAPSHOTS</div><h2 id="fm-dialog-title">每次构建，都有迹可循。</h2><p>这里保存的是每次预览使用的完整源码快照。</p></header><div class="fm-review-body"><nav class="fm-version-list" aria-label="源码版本"><span class="fm-version-list-label">${detail.versions.length} 个源码版本</span>${detail.versions.map(v=>`<button class="fm-version-item ${v.number===version.number?'selected':''}" data-review="${v.number}" aria-pressed="${v.number===version.number}"><span class="fm-version-node"></span><span><b>V${v.number}${v.number===detail.project.currentVersion?'<em>当前</em>':''}</b><strong>${esc(v.summary)}</strong><small>${time(v.created)} · ${esc(v.provider)}</small></span></button>`).join('')}</nav><section class="fm-version-detail"><div class="fm-version-detail-heading"><span>V${version.number} / 完整源码快照</span><span>${time(version.created)}</span></div><iframe class="fm-version-live" title="版本 ${version.number} 的界面快照" sandbox="allow-scripts" tabindex="-1"></iframe><div class="fm-diff-heading">${version.changes.length} 个文件变化 · 展开查看前后源码</div><div class="fm-server-diffs">${version.changes.map(change=>`<details><summary>${icon('file-code-2')}${esc(change.path)}<small>${({added:'新增',removed:'移除',modified:'修改'})[change.kind]}</small></summary><div class="fm-source-compare"><div><span>之前</span><pre>${esc(change.before.split('\n').slice(0,80).join('\n')||'（不存在）')}</pre></div><div><span>之后</span><pre>${esc(change.after.split('\n').slice(0,80).join('\n')||'（已移除）')}</pre></div></div><small>每侧展示前 80 行；完整文件保存在版本快照中。</small></details>`).join('')}</div><div class="fm-version-restore"><p>${current?'此版本正在工作台运行。':'恢复会创建新的源码版本，保留现有历史。'}</p><button class="fm-primary" data-restore-version="${version.number}" ${current?'disabled':''}>${icon(current?'check':'rotate-ccw')}${current?'当前版本':'恢复此源码版本'}</button></div></section></div><footer class="fm-review-foot">${icon('database')}源码快照保存在服务端；应用数据和上传素材不随版本恢复覆盖。</footer>`,true);
    overlay.querySelector('.fm-version-item.selected')?.focus();
    const result=await FormaAPI.request(api('/preview?version='+version.number));
    if(!overlay.hidden&&selectedVersion===version.number)overlay.querySelector('.fm-version-live').srcdoc=result.html;
  }
  product.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.dataset.review){await history(Number(button.dataset.review));return;}
      if(button.dataset.restoreVersion){if(hasDrafts())return;button.disabled=true;await FormaAPI.request(api('/restore'),'POST',{version:Number(button.dataset.restoreVersion)});close();await load(true,true);toast('源码已恢复为新版本。');return;}
      switch(button.dataset.action){
        case 'close':close();break;
        case 'history':case 'current':await history();break;
        case 'build':button.disabled=true;try{await build();}finally{renderThread();}break;
        case 'resume':if(hasDrafts())break;if(detail.job.requiresKey&&!await FormaModel.open())break;await FormaAPI.request('/jobs/'+encodeURIComponent(detail.job.id)+'/resume','POST',{});await load(false,true);break;
        case 'cancel':await FormaAPI.request('/jobs/'+detail.job.id+'/cancel','POST',{});await load(false,true);break;
        case 'mobile':case 'desktop':target.classList.toggle('fm-mobile',button.dataset.action==='mobile');product.querySelectorAll('.fm-device button').forEach(b=>b.classList.toggle('fm-selected',b===button));break;
        case 'theme':{const value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=value;try{localStorage.setItem('forma-theme',value);}catch{}themeButton.setAttribute('aria-label',value==='dark'?'切换浅色模式':'切换深色模式');if(parent!==window)parent.postMessage({type:'forma-workspace-theme',value},location.origin);break;}
        case 'skills':await FormaSkills.open(id);break;
        case 'model-settings':await FormaModel.open();break;
        case 'plan':go('/plan/'+id);break;
        case 'new':go('/projects?create=1');break;
        case 'projects':go('/projects');break;
        case 'export':{const link=document.createElement('a');link.href='/api/projects/'+encodeURIComponent(id)+'/export';link.download='forma-project.zip';link.click();break;}
      }
    }catch(error){toast(error.message);}
  });
  product.addEventListener('submit',async event=>{
    const form=event.target;event.preventDefault();
    if(form.classList.contains('fm-composer'))await generate(form.querySelector('textarea').value.trim());
  });
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  product.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!overlay.hidden)close();
    if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&event.target.closest('.fm-composer')){event.preventDefault();generate(event.target.value.trim());}
    if(event.key==='Tab'&&!overlay.hidden){const items=[...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled);if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  });
  window.addEventListener('message',async event=>{
    const message=event.data;if(event.source!==frame.contentWindow||!previewToken||message?.token!==previewToken)return;
    if(message.type==='forma-runtime-error'){toast('应用运行提示：'+message.message);return;}
    if(message.type!=='forma-runtime-set')return;
    const token=previewToken;const source=event.source;
    const now=performance.now();if(now-runtimeWindow>1000){runtimeWindow=now;runtimeCount=0;}
    if(!Number.isSafeInteger(message.id)||message.id<1||typeof message.key!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(message.key)||['__proto__','constructor','prototype'].includes(message.key)||runtimePending>=24||++runtimeCount>20){source.postMessage({type:'forma-runtime-result',token,id:message.id,error:'保存请求无效或过于频繁，请稍后重试'},'*');return;}
    runtimePending++;
    let task;
    try{if(JSON.stringify(message.value)?.length>500000)throw new Error('单项应用数据超过限制');task=(runtimeQueues.get(message.key)||Promise.resolve()).catch(()=>{}).then(()=>{if(token!==previewToken)throw new Error('预览版本已更新，请重试');return FormaAPI.request(api('/runtime'),'PUT',{key:message.key,value:message.value});});runtimeQueues.set(message.key,task);await task;source.postMessage({type:'forma-runtime-result',token,id:message.id},'*');}
    catch(error){source.postMessage({type:'forma-runtime-result',token,id:message.id,error:error.message},'*');toast('应用数据未能保存：'+error.message);}
    finally{runtimePending--;if(task&&runtimeQueues.get(message.key)===task)runtimeQueues.delete(message.key);}
  });
  window.addEventListener('forma-user-model-selected',()=>{mode.value='byok';modelPicker.sync();syncSuggestions();});
  window.addEventListener('forma-model-connection-change',()=>{mode.innerHTML=FormaModel.options(mode.value||'byok');syncSuggestions();});
  mode.addEventListener('change',()=>{if(mode.value==='byok'&&!FormaAPI.settings?.userModel?.ready)FormaModel.open();syncSuggestions();});
  window.addEventListener('pagehide',()=>{clearTimeout(pollTimer);projectSuggestions.destroy();});
  ready.then(async data=>{
    if(!data.user||data.user.guest){go('/login?next='+encodeURIComponent('/workspace/'+id));return;}
    await load();
    mode.innerHTML=FormaModel.options(detail.project.plan.mode|| (data.settings.modelReady?'ai':'byok'));
    suggestionsInitialized=true;syncSuggestions();
    icons();
  }).catch(error=>{thread.innerHTML='<p class="fm-response" role="alert">'+esc(error.message)+'</p>';toast(error.message);});
})();
