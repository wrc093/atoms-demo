/* An editable local brief, shared by planning and the workbench. */
const planFeatures = [
  {id:'collect',icon:'plus',title:'收藏与整理',description:'添加文章，保留值得再读的内容。'},
  {id:'categories',icon:'list-filter',title:'分类筛选',description:'按设计、技术与生活找到收藏。'},
  {id:'bookmarks',icon:'bookmark',title:'待读清单',description:'标记想读的文章，留给下一次好奇。'}
];
function projectPlan(project) {
  return {appName:project.name.split(/[·｜|]/)[0].trim().slice(0,12)||'拾光',goal:project.prompt||'一个安静的阅读收藏夹，让好内容有一个可以回来的地方。',palette:'green',kind:project.type||'reading',mode:FormaAPI.settings?.modelReady?'ai':'starter',features:['collect','categories','bookmarks'],...project.plan};
}
function planPage(id) {
  const project=projects.find(item=>item.id===id);
  if(!project)return `<main class="plan-missing">${brand()}<h1>这个想法还没有创建。</h1><a class="btn btn-dark" href="#/projects">回到项目空间${icon('arrow-right')}</a></main>`;
  const plan=projectPlan(project);
  return `<main class="plan-page" data-project="${escapeText(id)}">
    <header class="plan-nav">${brand()}<a href="#/projects">${icon('arrow-left')}我的项目</a><div>${appearance()}<span>${icon('cloud-check')}自动保存草稿</span></div></header>
    <div class="plan-progress" aria-label="创建项目步骤"><span class="complete">${icon('check')}描述想法</span><i></i><span class="active"><b>02</b>确认方案</span><i></i><span><b>03</b>进入工作台</span></div>
    <section class="plan-heading"><div class="eyebrow">THE SHAPE OF YOUR IDEA</div><h1>好的作品，<span>从清晰开始。</span></h1><p>定义它要做的事，挑选属于它的气质。剩下的，我们一起完成。</p></section>
    <form id="plan-form" class="plan-layout" data-project="${escapeText(id)}"><section class="plan-brief"><div class="plan-section-title"><span class="plan-section-label"><b>01</b> 定义你的想法</span><span class="plan-save-state" role="status">${icon('check')}草稿已载入</span></div><label class="plan-field"><span>应用名称</span><input name="appName" maxlength="12" required value="${escapeText(plan.appName)}" placeholder="给应用起个名字"></label><label class="plan-field"><span>想解决什么问题</span><textarea name="goal" maxlength="500" required rows="3">${escapeText(plan.goal)}</textarea></label>
      <div class="plan-generation-options"><label class="plan-field"><span>应用类型</span><div class="plan-select" data-ui="plan.kind.control"><select id="plan-app-kind" name="kind">${[['reading','阅读收藏夹'],['todo','待办清单'],['portfolio','个人作品集'],['custom','自由应用']].map(([value,label])=>`<option value="${value}" ${plan.kind===value?'selected':''}>${label}</option>`).join('')}</select>${icon('chevron-down').replace('<i ', '<i data-ui="plan.kind.chevron" ')}</div></label><label class="plan-field"><span>构建方式</span><div class="plan-select" data-ui="plan.mode.control"><select id="plan-build-mode" name="mode"><option value="ai" ${!FormaAPI.settings?.modelReady?'disabled':''} ${plan.mode==='ai'?'selected':''}>模型生成 · ${escapeText(FormaAPI.settings?.model||'待配置')}</option><option value="starter" ${plan.mode!=='ai'?'selected':''}>本地模板 · 无模型调用</option></select>${icon('chevron-down').replace('<i ', '<i data-ui="plan.mode.chevron" ')}</div></label></div><details class="plan-capabilities" data-reading-only><summary><span>阅读能力</span><span class="plan-feature-count">3 项已选择</span>${icon('chevron-down')}</summary><div class="plan-feature-list">${planFeatures.map(feature=>`<label class="plan-feature"><input type="checkbox" name="features" value="${feature.id}" ${plan.features.includes(feature.id)?'checked':''}><span class="plan-feature-icon">${icon(feature.icon)}</span><span><strong>${feature.title}</strong><small>${feature.description}</small></span><span class="plan-check">${icon('check')}</span></label>`).join('')}</div></details>
      <div class="plan-section-title plan-divider"><span class="plan-section-label"><b>02</b> 选择视觉气质</span><span>让风格有迹可循</span></div><div class="plan-palettes">${[['green','苔绿','安静，自然。'],['warm','暖橙','温暖，松弛。']].map(([value,title,description])=>`<label class="plan-palette"><input type="radio" name="palette" value="${value}" ${plan.palette===value?'checked':''}><span class="plan-swatch ${value}"><i></i><i></i><i></i></span><span><strong>${title}</strong><small>${description}</small></span><span class="plan-check">${icon('check')}</span></label>`).join('')}</div>
    </section><aside class="plan-preview-column"><div class="plan-preview-sticky"><div class="plan-section-title"><span>一个想法，正在成形</span><span><i class="plan-preview-dot"></i>实时风格预览</span></div><div class="plan-preview-shell"><div class="plan-preview-chrome"><span><i></i><i></i><i></i></span><span>A GLIMPSE OF WHAT’S NEXT</span>${icon('arrow-up-right')}</div><div class="plan-mini-app" data-palette="${plan.palette}"><div class="plan-mini-nav"><b data-plan-name>${escapeText(plan.appName)}</b><span>◒</span></div><div class="plan-mini-intro"><span>MAKE ROOM FOR CURIOSITY</span><h2>好内容，<br>值得慢慢读。</h2><div class="plan-mini-art"><i></i><i></i></div><p>留住偶然遇见的灵感。</p></div><div class="plan-mini-tools"><b>我的收藏</b><span data-plan-collect>＋ 收藏文章</span></div><div class="plan-mini-filters" data-plan-categories>全部收藏 <span>设计灵感</span><span>技术观察</span></div><div class="plan-mini-cards"><div><strong>Less,<br>but better.</strong><p>好的设计，懂得留白</p><span data-plan-bookmark>♡</span></div><div><strong>Human<br>× AI</strong><p>把工具变成创作伙伴</p><span data-plan-bookmark>♡</span></div></div><footer>A SMALL SPACE FOR GOOD THINGS.</footer></div></div><div class="plan-delivery"><span>${icon('layers-2')}</span><div><strong>一个完整的小起点</strong><p>收藏页面 · 手机与桌面布局<br>本地数据保存 · 可继续调整</p></div></div><p class="plan-boundary">右侧用于说明视觉基调，实际界面由所选构建方式生成。模型会接收本项目的需求与源码；上传素材不会自动作为模型上下文发送。</p></div></aside>
    <footer class="plan-bottom"><span>${icon('corner-down-right')}<strong>准备好，赋予想法形状。</strong><small data-plan-summary>选择构建方式，开始你的第一版</small></span><div><a class="btn btn-plain" href="#/projects">保留草稿</a><button class="btn btn-dark" type="submit">${project.currentVersion?'构建新版本':'开始构建'}${icon('arrow-up-right')}</button></div></footer></form>
  </main>`;
}
function readPlanForm(form) {
  const data=new FormData(form);
  return {appName:data.get('appName').trim(),goal:data.get('goal').trim(),palette:data.get('palette')||'green',features:data.get('kind')==='reading'?data.getAll('features'):[],kind:data.get('kind')||'reading',mode:data.get('mode')||'starter'};
}
function updatePlanPreview(form) {
  const plan=readPlanForm(form);
  const reading=plan.kind==='reading';
  form.querySelector('.plan-feature-count').textContent=plan.features.length+' 项已选择';
  form.querySelector('[data-plan-summary]').textContent=(plan.mode==='ai'?'模型生成':'本地模板')+' · '+(plan.appName||'你的应用')+' · 可随时继续修改';form.querySelectorAll('[data-reading-only]').forEach(el=>el.hidden=!reading);
  const mini=form.querySelector('.plan-mini-app');mini.dataset.kind=plan.kind;
  const titles={reading:'好内容，<br>值得慢慢读。',todo:'把想法，<br>变成今天的小事。',portfolio:'让作品，<br>替你说话。',custom:'你的想法，<br>有了新的形状。'};mini.querySelector('h2').innerHTML=titles[plan.kind];
  mini.querySelector('.plan-mini-intro p').textContent=reading?'留住偶然遇见的灵感。':'一个可以继续打磨的起点。';
  mini.querySelector('.plan-mini-tools b').textContent=reading?'我的收藏':plan.kind==='todo'?'今日待办':'精选作品';
  mini.querySelector('.plan-mini-tools>span').textContent=reading?'＋ 收藏文章':plan.kind==='todo'?'＋ 添加事项':'探索更多';
  mini.querySelectorAll('.plan-mini-cards p').forEach((node,i)=>node.textContent=reading?['好的设计，懂得留白','把工具变成创作伙伴'][i]:plan.kind==='todo'?['完成一件重要的小事','给自己留一点专注时间'][i]:['第一个作品','新的创作方向'][i]);
  form.querySelector('.plan-delivery p').innerHTML=(reading?'收藏页面':plan.kind==='todo'?'待办页面':'应用页面')+' · 手机与桌面布局<br>服务端数据保存 · 可继续调整';
  form.querySelector('[data-plan-name]').textContent=plan.appName||'你的应用';
  form.querySelector('.plan-mini-app').dataset.palette=plan.palette;
  ['collect','categories','bookmark'].forEach(key=>form.querySelectorAll('[data-plan-'+key+']').forEach(el=>el.hidden=!reading||!plan.features.includes(key==='bookmark'?'bookmarks':key)));
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
document.addEventListener('submit',async event=>{
  const form=event.target;if(form.id!=='plan-form')return;event.preventDefault();
  const plan=readPlanForm(form);if(!plan.appName||!plan.goal){toast('请补充应用名称和目标。');return;}
  const project=projects.find(item=>item.id===form.dataset.project);if(!project)return;
  const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;clearTimeout(planSaveTimer);
  try{project.plan=plan;await persistPlan(project,form);await FormaAPI.request('/projects/'+project.id+'/generate','POST',{prompt:plan.goal,mode:plan.mode,operation:'build'});navigate('/build/'+project.id);}catch(error){toast(error.message);button.disabled=false;}
});
window.FormaPlan={mount(){const form=document.querySelector('#plan-form');if(form){updatePlanPreview(form);window.FormaUI?.animate(document.querySelector('.plan-preview-shell'),[{opacity:0,transform:'translateY(18px) rotate(1deg)'},{opacity:1,transform:'translateY(0) rotate(0)'}],{duration:750});}}};
