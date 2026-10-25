/* A personal library plus registry-driven project insertion points. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons=()=>window.lucide?.createIcons();
  const dialog=document.createElement('dialog');dialog.className='sk-dialog';dialog.setAttribute('aria-labelledby','sk-title');
  document.body.append(dialog);
  const preview=document.createElement('dialog');preview.className='sk-preview';preview.setAttribute('aria-labelledby','sk-preview-title');document.body.append(preview);
  let pointPickers=[],previewPicker=null;
  const clearPointPickers=()=>{pointPickers.forEach(picker=>picker.destroy());pointPickers=[];};
  let projectId=null,library=[],catalog,selected=new Map(),opener,pending=false,opening=false,revision=0,previewRevision=0;
  function mark(open){document.documentElement.toggleAttribute('data-skills-dialog-open',open);if(parent!==window)parent.postMessage({type:'forma-skills-dialog-state',open},location.origin);}
  function error(message){const node=dialog.querySelector('[data-sk-error]');if(node){node.textContent=message;node.hidden=!message;}}
  function close(){if(pending)return;clearPointPickers();previewPicker?.destroy();previewPicker=null;revision++;previewRevision++;if(preview.open)preview.close();if(dialog.open)dialog.close();mark(false);const inspector=dialog.querySelector('#forma-dev-inspector');if(inspector)document.body.append(inspector);if(opener?.isConnected)opener.focus();}
  function chosen(){return [...selected].filter(([,skillId])=>skillId).map(([point,skillId])=>({point,skillId}));}
  function options(point){return '<option value="">不使用，按需求自然生成</option>'+library.map(skill=>`<option value="${esc(skill.id)}" ${selected.get(point)===skill.id?'selected':''}>${esc(skill.name)} · v${esc(skill.version)} · ${skill.digest.slice(0,6)}</option>`).join('');}
  function pointCard(point){const main=point.id==='main';return `<div class="sk-point ${main?'sk-point-main':''}" data-ui="skills.point.${esc(point.id)}"><div class="sk-point-head"><span>${icon(main?'compass':point.id==='style'?'palette':point.id==='architecture'?'blocks':point.id==='interaction'?'mouse-pointer-2':'circle-check')}</span><div><label for="sk-point-${esc(point.id)}">${esc(point.label)}</label><p>${esc(point.scope)}</p></div>${main?'<small>LEAD</small>':''}</div><div class="sk-select"><select id="sk-point-${esc(point.id)}" data-sk-point="${esc(point.id)}">${options(point.id)}</select></div><p class="sk-selected-note" data-sk-note="${esc(point.id)}"></p></div>`;}
  function render(){
    clearPointPickers();
    const inspector=dialog.querySelector('#forma-dev-inspector');if(inspector)document.body.append(inspector);
    dialog.innerHTML=`<header class="sk-head"><div><span class="sk-eyebrow">YOUR METHODS. YOUR SIGNATURE.</span><h2 id="sk-title">让方法，成为你的延伸<span>。</span></h2><p>${projectId?'用一个 Skill 主导方向，再在细节处加入自己的方法。':'把常用的方法收进个人 Skill 库，在任何项目中复用。'}</p></div><button class="sk-icon" type="button" data-sk-close aria-label="关闭 Skill 设置">${icon('x')}</button></header>
      <div class="sk-layout"><section class="sk-insertion" aria-label="项目 Skill 插入点"><div class="sk-section-label"><span>${projectId?'这个项目的创作方法':'从方法，到每一个细节'}</span><small>${projectId?'PROJECT INSTRUCTIONS':'REUSABLE BY DESIGN'}</small></div>${projectId?catalog.points.filter(p=>p.id==='main').map(pointCard).join(''):`<div class="sk-library-intro">${icon('puzzle')}<h3>为你的工作流，留一些可能。</h3><p>在项目方案或工作台打开「Skill 扩展」，即可把这里的方法用于整体创作、视觉风格、架构和交互。</p></div>`}
      ${projectId?`<div class="sk-local-heading"><span>局部插入点</span><small>只影响对应范围</small></div><div class="sk-local-points">${catalog.points.filter(p=>p.id!=='main').map(pointCard).join('')}</div>`:''}<details class="sk-rules"><summary>这些方法如何一起工作 ${icon('chevron-down')}</summary><p>${esc(catalog.precedence)}</p><p>配置用于下一次模型生成与修复。恢复原任务时，沿用该任务启动时的 Skill 快照。</p><p>当前支持指令与文本参考资料。包内脚本和二进制附件保留供下载，不会在服务器执行，也不会直接嵌入生成页面。</p></details></section>
      <section class="sk-library" aria-label="我的 Skill 库"><div class="sk-section-label"><span>我的 Skill 库 <b>${library.length}</b></span><button type="button" class="sk-text-button" data-sk-upload>${icon('upload')}上传 Skill</button></div><input type="file" accept=".md,.zip" multiple hidden data-sk-file aria-label="上传 Markdown 或 ZIP Skill"><label class="sk-search">${icon('search')}<input type="search" placeholder="找一个创作方法…" aria-label="搜索 Skill"></label><div class="sk-library-items"></div><div class="sk-import-note"><span>.md / .zip · 单包 2 MB</span><a href="assets/skills/SKILL.md" download="SKILL.md">下载 Skill 模板 ${icon('arrow-down-to-line')}</a></div></section></div>
      <footer class="sk-foot"><div><p class="sk-error" role="alert" data-sk-error hidden></p><span>${icon('layers-2')}<span data-sk-count>${chosen().length?chosen().length+' 个插入点已选择':'留白也可以，随时添加你的方法'}</span></span><small>启用的 Skill 和文本参考资料会随需求发送给你选择的模型。</small></div><div><button type="button" class="sk-secondary" data-sk-close>${projectId?'取消':'关闭'}</button><button type="button" class="sk-primary" data-sk-save>${projectId?'应用到项目':'完成'}${icon('arrow-up-right')}</button></div></footer>`;
    dialog.querySelectorAll('[data-sk-point]').forEach(select=>{
      const point=catalog.points.find(item=>item.id===select.dataset.skPoint);
      pointPickers.push(FormaModelPicker.mount(select,{
        label:point.label,hint:point.id==='main'?'整体创作':'局部插入',variant:'skill',side:'below',
        footer:()=>library.length?'选择后，点击「应用到项目」保存':'上传一个 Skill，就可以在这里选择自己的方法。',
        entries:()=>[{value:'',title:'按需求自然生成',detail:'由你的想法决定，不额外指定 Skill。',icon:'sparkles',badge:'默认'},
          ...library.map(skill=>({value:skill.id,title:skill.name,detail:skill.description,icon:'file-text',badge:'v'+skill.version}))]
      }));
    });
    renderLibrary();updateNotes();icons();if(inspector)dialog.append(inspector);
  }
  function renderLibrary(search=''){
    const rows=library.filter(item=>(item.name+' '+item.description).toLowerCase().includes(search.toLowerCase()));
    dialog.querySelector('.sk-library-items').innerHTML=rows.length?rows.map(skill=>`<article class="sk-card"><div class="sk-card-top"><span class="sk-card-mark">${icon('file-text')}</span><h3>${esc(skill.name)}</h3><small>v${esc(skill.version)}</small></div><p>${esc(skill.description)}</p><div class="sk-card-bottom"><span>${(skill.bytes/1024).toFixed(1)} KB · ${skill.digest.slice(0,6)}</span><button type="button" class="sk-text-button" data-sk-preview="${esc(skill.id)}">查看内容 ${icon('arrow-up-right')}</button></div></article>`).join(''):`<div class="sk-empty">${icon(search?'search':'file-plus-2')}<strong>${search?'还没找到这个方法':'你习惯的方法，值得被记住。'}</strong><p>${search?'换个关键词试试。':'上传一个 SKILL.md，或包含参考文件的 ZIP 包。之后就能在不同项目里重复使用。'}</p>${search?'':'<button type="button" class="sk-secondary" data-sk-upload>上传第一个 Skill</button>'}</div>`;
    icons();
  }
  function updateNotes(){
    dialog.querySelectorAll('[data-sk-note]').forEach(node=>{const skill=library.find(item=>item.id===selected.get(node.dataset.skNote));node.textContent=skill?.description||'';node.hidden=!skill;});
    const count=chosen().length;dialog.querySelector('[data-sk-count]').textContent=count?count+' 个插入点已选择':'留白也可以，随时添加你的方法';
  }
  async function open(id=null){
    if(opening||dialog.open)return;opening=true;opener=document.activeElement;projectId=id;const request=++revision;
    try{
      const [personal,project]=await Promise.all([FormaAPI.request('/skills'),id?FormaAPI.request('/projects/'+encodeURIComponent(id)+'/skills'):Promise.resolve({bindings:[]})]);
      if(request!==revision)return;library=personal.skills;catalog=personal.catalog;selected=new Map(project.bindings.map(b=>[b.point,b.skillId]));render();dialog.showModal();mark(true);const inspector=document.getElementById('forma-dev-inspector');if(inspector)dialog.append(inspector);dialog.querySelector('[data-sk-close]').focus();
    }finally{opening=false;}
  }
  function setPending(value,label){pending=value;dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=value);const button=dialog.querySelector('[data-sk-save]');if(button)button.innerHTML=value?esc(label):`${projectId?'应用到项目':'完成'}${icon('arrow-up-right')}`;icons();}
  function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('无法读取这个文件'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
  async function upload(files){
    if(pending)return;if(files.length>8){error('每次最多上传 8 个 Skill');return;}
    setPending(true,'正在导入…');error('');let imported=0,failures=[];
    try{
      for(const file of files){
        try{if(file.size>2_000_000)throw new Error('文件超过 2 MB');const {skill}=await FormaAPI.request('/skills','POST',{filename:file.name,base64:await readFile(file)});library=[skill,...library.filter(item=>item.id!==skill.id)];imported++;}
        catch(failure){failures.push(file.name+'：'+failure.message);}
      }
      const preserved=selected;render();selected=preserved;
      const notice=dialog.querySelector('.sk-import-note>span');notice.textContent=imported?`已导入 ${imported} 个 Skill，${projectId?'可在左侧选择插入点':'可在项目中复用'}`:' .md / .zip · 单包 2 MB';
      if(failures.length)error(failures.join('；'));
    }finally{setPending(false);}
  }
  async function view(id){
    const request=++previewRevision;const {skill}=await FormaAPI.request('/skills/'+encodeURIComponent(id));if(request!==previewRevision||!dialog.open)return;
    previewPicker?.destroy();previewPicker=null;
    preview.innerHTML=`<header><div><span class="sk-eyebrow">SKILL PACKAGE / v${esc(skill.version)}</span><h2 id="sk-preview-title">${esc(skill.name)}</h2><p>${esc(skill.description)}</p></div><button type="button" class="sk-icon" data-sk-preview-close aria-label="关闭 Skill 内容">${icon('x')}</button></header><label class="sk-file-select">包内文件<select aria-label="选择 Skill 文件">${skill.files.map(file=>`<option value="${esc(file.path)}" ${file.path===skill.entry?'selected':''}>${esc(file.path)}${file.path===skill.entry?' · 入口':''}</option>`).join('')}</select></label><pre class="sk-source" tabindex="0"></pre><footer><span>${skill.digest.slice(0,12)} · ${skill.files.length} 个文件</span><button type="button" class="sk-text-button" data-sk-archive="${esc(id)}">移出 Skill 库</button><a class="sk-secondary" href="/api/skills/${encodeURIComponent(id)}/export" download="forma-skill.zip">下载 Skill 包 ${icon('download')}</a></footer>`;
    function source(){const file=skill.files.find(f=>f.path===preview.querySelector('select').value);preview.querySelector('pre').textContent=file?.text??'二进制附件，保留在包内，可下载查看。';}
    const fileSelect=preview.querySelector('select');fileSelect.onchange=source;
    previewPicker=FormaModelPicker.mount(fileSelect,{label:'包内文件',hint:'Skill 内容',variant:'skill',side:'below',footer:'选择文件查看内容，不会执行包内代码。',
      entries:()=>skill.files.map(file=>({value:file.path,title:file.path,detail:file.text==null?'二进制附件 · 可下载查看':'文本文件 · 可直接查看',icon:'file-text',badge:file.path===skill.entry?'入口':''}))});
    source();icons();preview.showModal();preview.querySelector('[data-sk-preview-close]').focus();
  }
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||pending)return;
    if(button.hasAttribute('data-sk-close')){close();return;}
    if(button.hasAttribute('data-sk-upload')){dialog.querySelector('[data-sk-file]').click();return;}
    try{
      if(button.dataset.skPreview){await view(button.dataset.skPreview);return;}
      if(button.hasAttribute('data-sk-save')){
        if(!projectId){close();return;}setPending(true,'正在保存…');error('');
        try{const result=await FormaAPI.request('/projects/'+encodeURIComponent(projectId)+'/skills','PUT',{bindings:chosen()});window.dispatchEvent(new CustomEvent('forma-skills-changed',{detail:{projectId,bindings:result.bindings}}));pending=false;close();}finally{setPending(false);}
      }
    }catch(failure){error(failure.message);}
  });
  dialog.addEventListener('change',event=>{
    if(event.target.matches('[data-sk-file]')){const files=[...event.target.files];event.target.value='';if(files.length)upload(files);}
    if(event.target.dataset.skPoint){selected.set(event.target.dataset.skPoint,event.target.value);updateNotes();}
  });
  dialog.addEventListener('input',event=>{if(event.target.matches('.sk-search input'))renderLibrary(event.target.value);});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  preview.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-sk-preview-close')){previewPicker?.close();preview.close();return;}
    if(button.dataset.skArchive){
      if(button.dataset.confirm!=='true'){button.dataset.confirm='true';button.textContent='确认移出（解绑后续任务）';return;}
      button.disabled=true;
      try{await FormaAPI.request('/skills/'+encodeURIComponent(button.dataset.skArchive),'DELETE',{});library=library.filter(s=>s.id!==button.dataset.skArchive);selected=new Map([...selected].filter(([,id])=>id!==button.dataset.skArchive));preview.close();render();window.dispatchEvent(new CustomEvent('forma-skills-changed',{detail:{projectId,bindings:chosen()}}));}
      catch(failure){button.disabled=false;button.textContent=failure.message;}
    }
  });
  window.addEventListener('hashchange',()=>{if(!pending)close();});
  window.addEventListener('forma-auth-required',()=>{revision++;opening=false;pending=false;close();library=[];selected.clear();});
  window.addEventListener('message',event=>{const frame=document.querySelector('.workspace-page>iframe');if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==='forma-skills-dialog-state')document.documentElement.toggleAttribute('data-skills-dialog-open',event.data.open===true);});
  window.FormaSkills={open,async count(id){const data=await FormaAPI.request('/projects/'+encodeURIComponent(id)+'/skills');return data.bindings.length;}};
})();
