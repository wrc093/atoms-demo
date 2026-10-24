/* An open brief: describe the experience; classification stays out of the flow. */
function projectPlan(project) {
  const saved=project.plan||{};
  return {appName:saved.appName||project.name.split(/[·｜|]/)[0].trim().slice(0,32)||'我的应用',goal:saved.goal||project.prompt||'',mode:saved.mode|| (FormaAPI.settings?.modelReady?'ai':'byok')};
}
function planPage(id) {
  const project=projects.find(item=>item.id===id);
  if(!project)return `<main class="plan-missing">${brand()}<h1>这个想法还没有创建。</h1><a class="btn btn-dark" href="#/projects">回到项目空间${icon('arrow-right')}</a></main>`;
  const plan=projectPlan(project);
  return `<main class="plan-page plan-open" data-project="${escapeText(id)}">
    <header class="plan-nav">${brand()}<a href="#/projects">${icon('arrow-left')}我的项目</a><div>${appearance()}<span>${icon('cloud-check')}自动保存草稿</span></div></header>
    <div class="plan-progress" aria-label="创建项目步骤"><span class="complete">${icon('check')}描述想法</span><i></i><span class="active"><b>02</b>确认方案</span><i></i><span><b>03</b>进入工作台</span></div>
    <section class="plan-heading"><div class="eyebrow">ROOM FOR EVERY POSSIBILITY</div><h1>想法的边界，<span>由你决定。</span></h1><p>说说你想做什么、为谁而做。细节可以边构建，边打磨。</p></section>
    <form id="plan-form" class="plan-layout" data-project="${escapeText(id)}"><section class="plan-brief"><div class="plan-section-title"><span class="plan-section-label">你的创作简报</span><span class="plan-save-state" role="status">${icon('check')}草稿已载入</span></div>
      <label class="plan-field"><span>应用名称</span><input name="appName" maxlength="32" required value="${escapeText(plan.appName)}" placeholder="给想法起个名字"></label>
      <label class="plan-field"><span>描述你的想法</span><textarea name="goal" maxlength="6000" required rows="5" placeholder="你想为谁做一个怎样的体验？它需要实现什么？任何功能、布局和风格想法，都可以直接写在这里。">${escapeText(plan.goal)}</textarea></label>
      <div class="plan-generation-options"><label class="plan-field" for="plan-build-mode"><span>构建方式</span><div class="plan-select" data-ui="plan.mode.control"><select id="plan-build-mode" name="mode">${FormaModel.options(plan.mode)}</select>${icon('chevron-down').replace('<i ','<i data-ui="plan.mode.chevron" ')}</div></label></div>
      <div class="plan-connection" data-ui="plan.model.connection"><span class="plan-connection-icon">${icon('key-round')}</span><div><strong data-connection-title></strong><p data-connection-description></p></div><button class="btn btn-plain" type="button" data-model-connect>配置连接${icon('arrow-up-right')}</button></div>
      <div class="plan-skills-entry" data-ui="plan.skills"><span>${icon('puzzle')}</span><div><strong>Skill 扩展 <small>可选</small></strong><p data-plan-skills-summary>用自己的方法主导创作，或只打磨某个细节。</p></div><button type="button" data-plan-skills>配置 Skill${icon('arrow-up-right')}</button></div>
      <p class="plan-open-note">${icon('message-circle')}不需要先选模板或给想法分类，直接描述你希望它成为的样子。</p>
    </section>
    <aside class="plan-preview-column"><div class="plan-preview-sticky"><div class="plan-section-title"><span>从描述，走向可体验的作品</span><span>IDEA → EXPERIENCE</span></div>
      <div class="plan-open-stage" data-ui="plan.idea.stage"><div class="plan-open-stage-top"><span><i></i><i></i><i></i></span><small>EVERY IDEA DESERVES ITS OWN FORM</small></div><div class="plan-open-orbit" aria-hidden="true"><i></i><i></i><i></i><span>f.</span></div><div class="plan-idea-card"><span>YOUR IDEA</span><strong data-plan-name>${escapeText(plan.appName)}</strong><p data-plan-goal>${escapeText(plan.goal)}</p></div><div class="plan-open-result"><span>${icon('panels-top-left')}页面与布局</span><span>${icon('mouse-pointer-2')}功能与交互</span><span>${icon('code-2')}可继续编辑的源码</span></div></div>
      <div class="plan-delivery"><span>${icon('sparkles')}</span><div><strong>先做出来，再让它更像你。</strong><p>在工作台预览、对话修改，随时回到之前的版本。</p></div></div><p class="plan-boundary">构建以你的描述为准。这是一张创作简报，界面会在构建完成后呈现。</p></div></aside>
    <footer class="plan-bottom"><span>${icon('corner-down-right')}<strong>准备好，赋予想法形状。</strong><small data-plan-summary></small></span><div><a class="btn btn-plain" href="#/projects">保留草稿</a><button class="btn btn-dark" type="submit">${project.currentVersion?'构建新版本':'开始构建'}${icon('arrow-up-right')}</button></div></footer></form>
  </main>`;
}
function readPlanForm(form) {
  const data=new FormData(form);
  return {appName:String(data.get('appName')||'').trim(),goal:String(data.get('goal')||'').trim(),mode:data.get('mode')||'byok'};
}
function updatePlanPreview(form) {
  const plan=readPlanForm(form),settings=FormaAPI.settings||{},own=settings.userModel;
  form.querySelector('[data-plan-summary]').textContent=FormaModel.label(plan.mode)+' · '+(plan.appName||'你的应用')+' · 可随时继续修改';
  form.querySelector('[data-plan-name]').textContent=plan.appName||'你的下一个想法';
  form.querySelector('[data-plan-goal]').textContent=plan.goal||'一些大胆的可能，从你的一句话开始。';
  const title=form.querySelector('[data-connection-title]'),description=form.querySelector('[data-connection-description]'),button=form.querySelector('[data-model-connect]');
  button.hidden=plan.mode!=='byok';
  if(plan.mode==='byok'){title.textContent=own?.ready?'已配置 · '+own.model:'接入你的模型服务';description.textContent=own?.ready?'Key 仅在本次服务运行中保留。构建按你的模型账号计费。':'填入 API Key、服务地址和模型名称，使用自己的模型来构建。';button.innerHTML=(own?.ready?'管理连接':'导入 API Key')+icon('arrow-up-right');}
  else if(plan.mode==='starter'){title.textContent='先体验一个基础示例';description.textContent='此方式不调用模型；实现完整的自由需求，请使用平台模型或自己的 API Key。';}
  else{title.textContent='由平台模型来构建';description.textContent='根据你的需求生成页面、功能和交互，完成后可以继续对话修改。';}
  refreshIcons();
}
let planSaveTimer;
function persistPlan(project,form){return FormaAPI.patch(project.id,{plan:structuredClone(project.plan)}).then(()=>{if(form?.isConnected)form.querySelector('.plan-save-state').innerHTML=icon('check')+'所有更改已保存';refreshIcons();}).catch(error=>{if(form?.isConnected)form.querySelector('.plan-save-state').textContent='未保存：'+error.message;throw error;});}
document.addEventListener('input',event=>{
  const form=event.target.closest('#plan-form');if(!form)return;
  const project=projects.find(item=>item.id===form.dataset.project);if(!project)return;
  project.plan=readPlanForm(form);form.querySelector('.plan-save-state').textContent='正在保存…';
  clearTimeout(planSaveTimer);planSaveTimer=setTimeout(()=>persistPlan(project,form).catch(()=>{}),350);
  updatePlanPreview(form);
});
document.addEventListener('change',event=>{if(event.target.matches('#plan-form [name=mode]')&&event.target.value==='byok'&&!FormaAPI.settings?.userModel?.ready)FormaModel.open();});
document.addEventListener('click',event=>{if(event.target.closest('[data-model-connect]'))FormaModel.open();const skillButton=event.target.closest('[data-plan-skills]');if(skillButton)FormaSkills.open(skillButton.closest('#plan-form').dataset.project).catch(error=>toast(error.message));});
window.addEventListener('forma-user-model-selected',()=>{const form=document.querySelector('#plan-form');if(form){form.elements.mode.value='byok';form.elements.mode.dispatchEvent(new Event('input',{bubbles:true}));}});
window.addEventListener('forma-model-connection-change',()=>{const form=document.querySelector('#plan-form');if(!form)return;const selected=form.elements.mode.value;form.elements.mode.innerHTML=FormaModel.options(selected);updatePlanPreview(form);});
document.addEventListener('submit',async event=>{
  const form=event.target;if(form.id!=='plan-form')return;event.preventDefault();
  const plan=readPlanForm(form);if(!plan.appName||!plan.goal){toast('请补充应用名称和目标。');return;}
  const project=projects.find(item=>item.id===form.dataset.project);if(!project)return;
  const button=form.querySelector('[type=submit]');if(button.disabled)return;
  button.disabled=true;clearTimeout(planSaveTimer);
  try{
    if(plan.mode==='byok'&&!FormaAPI.settings?.userModel?.ready){const saved=await FormaModel.open();if(!saved)return;}
    project.plan=plan;await persistPlan(project,form);await FormaAPI.request('/projects/'+project.id+'/generate','POST',{prompt:plan.goal,mode:plan.mode,operation:'build'});navigate('/build/'+project.id);
  }catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}
});
function updatePlanSkills(id,count){const form=document.querySelector('#plan-form');if(form?.dataset.project===id)form.querySelector('[data-plan-skills-summary]').textContent=count?count+' 个插入点已配置 · 会用于模型生成与修复':'用自己的方法主导创作，或只打磨某个细节。';}
window.addEventListener('forma-skills-changed',event=>{if(event.detail.projectId)updatePlanSkills(event.detail.projectId,event.detail.bindings.length);});
window.FormaPlan={mount(){const form=document.querySelector('#plan-form');if(form){updatePlanPreview(form);FormaSkills.count(form.dataset.project).then(count=>updatePlanSkills(form.dataset.project,count)).catch(()=>{});FormaModel.refresh().catch(()=>{});window.FormaUI?.animate(document.querySelector('.plan-open-stage'),[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:650});}}};
