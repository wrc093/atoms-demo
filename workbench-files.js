/* Local project explorer. Imported bytes stay in this browser's IndexedDB. */
(async () => {
  const product = document.querySelector('.fm-product');
  const zone = document.querySelector('.fm-canvas-zone');
  if (!product || !zone) return;
  const projectParams = new URLSearchParams(location.search);
  const legacyProject = projectParams.get('project') || 'demo';
  const project = projectParams.get('id') || legacyProject;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animate = (element, frames, options = {}) => { if (element && !reduced.matches) element.animate(frames, { duration: 350, easing: 'cubic-bezier(.16,1,.3,1)', ...options }); };
  let toastTimer, editor, currentLine, switching = false, requestVersion = 0, previousFocus;
  const files = new Map(), docs = new Map(), dirty = new Set(), objectURLs = new Map();
  const openFolders = new Set(['src','src/components','src/styles']);
  const state = { view: 'preview', active: 'index.html', tabs: ['index.html','styles.css','app.js'], folder: '', treeSearch: '', fileSearch: '', layout: 'list', wrap: true, marks: [] };
  const textExtensions = ['tsx','ts','jsx','js','css','html','md','txt','json','csv','yaml','yml','svg','xml','env'];
  const extension = path => path.split('.').pop().toLowerCase();
  const basename = path => path.split('/').pop();
  const parent = path => path.includes('/') ? path.slice(0,path.lastIndexOf('/')) : '';
  const cleanPath = path => String(path).replaceAll('\\','/').split('/').filter(part => part && part !== '.' && part !== '..').join('/');
  const textFile = file => file.mime?.startsWith('text/') || textExtensions.includes(extension(file.path)) || file.mime === 'application/json';
  const imageFile = file => file.mime?.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','avif'].includes(extension(file.path));
  const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`;
  const formatDate = value => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  function fileIcon(path) { const ext=extension(path);return `<span class="fs-file-icon ${['tsx','ts','jsx','js'].includes(ext)?'fs-typescript':ext==='css'?'fs-css':['svg','png','jpg','jpeg','webp','gif'].includes(ext)?'fs-image':''}">${icon(['tsx','ts','jsx','js'].includes(ext)?'file-code-2':ext==='css'?'braces':ext==='md'?'file-text':ext==='json'?'file-json':['svg','png','jpg','jpeg','webp','gif'].includes(ext)?'image':ext==='pdf'?'file-text':'file')}</span>`; }
  function toast(message) { const element=product.querySelector('.fm-toast');element.textContent=message;element.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.hidden=true,3400); }
  function url(file) { if (!objectURLs.has(file.path)) objectURLs.set(file.path,URL.createObjectURL(file.blob));return objectURLs.get(file.path); }
  function revoke(path) { if(objectURLs.has(path)){URL.revokeObjectURL(objectURLs.get(path));objectURLs.delete(path);} }
  function mode(path) { const ext=extension(path);return ext==='tsx'?{name:'jsx',base:{name:'javascript',typescript:true}}:ext==='jsx'?'jsx':ext==='ts'?{name:'javascript',typescript:true}:ext==='js'?'javascript':ext==='css'?'css':['html','svg','xml'].includes(ext)?'htmlmixed':ext==='md'?'markdown':ext==='json'?{name:'javascript',json:true}:'text/plain'; }
  function language(path) { return ({tsx:'TypeScript JSX',ts:'TypeScript',jsx:'JavaScript JSX',js:'JavaScript',css:'CSS',md:'Markdown',json:'JSON',html:'HTML',svg:'SVG'})[extension(path)] || '纯文本'; }

  const fromServer = file => {const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));return {...file,blob:new Blob([bytes],{type:file.mime})};};
  async function put(file) {
    const body={path:file.path,mime:file.mime,kind:file.kind||'asset',revision:file.revision};
    if(file.text!==undefined)body.text=file.text;
    else {const bytes=new Uint8Array(await file.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));body.base64=btoa(binary);}
    const result=await FormaAPI.request('/projects/'+encodeURIComponent(project)+'/files','PUT',body);const saved=fromServer(result.file);files.set(saved.path,saved);revoke(saved.path);return saved;
  }
  async function initialize() {
    await FormaAPI.ready;const result=await FormaAPI.request('/projects/'+encodeURIComponent(project)+'/files');
    result.files.forEach(file=>files.set(file.path,fromServer(file)));
    try {const saved=JSON.parse(localStorage.getItem('forma-editor-tabs-'+project));if(saved?.tabs?.length){state.tabs=saved.tabs.filter(path=>files.has(path));state.active=state.tabs.includes(saved.active)?saved.active:state.tabs[0];}}catch{}
    state.tabs=state.tabs.filter(path=>files.has(path));if(!files.has(state.active))state.active=state.tabs[0]||[...files.keys()][0]||'';
  }
  function rememberTabs() {try{localStorage.setItem('forma-editor-tabs-'+project,JSON.stringify({tabs:state.tabs,active:state.active}));}catch{}}

  const toolbar=zone.querySelector('.fm-canvas-toolbar');
  toolbar.innerHTML=`<div class="fm-view-tabs fs-view-tabs" role="tablist" aria-label="工作台视图"><button type="button" id="fs-preview-tab" role="tab" aria-controls="fs-preview-panel" aria-selected="true" data-fs-view="preview" class="fm-selected">${icon('app-window')}预览</button><button type="button" id="fs-editor-tab" role="tab" aria-controls="fs-editor-panel" aria-selected="false" data-fs-view="editor">${icon('code-2')}编辑器</button><button type="button" id="fs-files-tab" role="tab" aria-controls="fs-files-panel" aria-selected="false" data-fs-view="files">${icon('folder-closed')}文件</button></div><span class="fm-address"><span></span><span class="fs-toolbar-label">运行预览</span></span><div class="fs-preview-tools"><div class="fm-device"><button type="button" class="fm-selected" data-action="desktop" aria-label="桌面预览">${icon('monitor')}</button><button type="button" data-action="mobile" aria-label="手机预览">${icon('smartphone')}</button></div><button type="button" class="fs-shell-button" data-fs="chat" aria-label="收起对话栏" aria-pressed="false">${icon('panel-left-close')}</button></div>`;
  const preview=zone.querySelector('.fm-canvas');preview.id='fs-preview-panel';preview.setAttribute('role','tabpanel');preview.setAttribute('aria-labelledby','fs-preview-tab');
  preview.querySelector('.fm-files')?.remove();
  const surface=document.createElement('div');surface.className='fs-surface';surface.hidden=true;
  surface.innerHTML=`<section class="fs-editor" id="fs-editor-panel" role="tabpanel" aria-labelledby="fs-editor-tab" hidden><aside class="fs-explorer"><div class="fs-explorer-title"><span>${icon('folder-open')}项目资源</span><button class="fs-shell-button" data-fs="tree-collapse" aria-label="折叠文件夹">${icon('fold-vertical')}</button></div><label class="fs-search">${icon('search')}<input class="fs-tree-search" aria-label="搜索项目文件" placeholder="查找文件…"></label><div class="fs-tree" role="tree" aria-label="项目文件树"></div><div class="fs-explorer-foot">${icon('hard-drive')}<span class="fs-file-total">项目文件</span></div></aside><div class="fs-editor-main"><div class="fs-tabs" role="tablist" aria-label="打开的文件"></div><div class="fs-editor-toolbar"><div class="fs-file-breadcrumb"></div><div class="fs-editor-actions"><button class="fs-tool" data-fs="tree-toggle" aria-label="切换文件树">${icon('panel-left')}</button><button class="fs-tool" data-fs="find" aria-label="搜索当前文件">${icon('search')}</button><button class="fs-tool" data-fs="wrap" aria-label="自动换行" aria-pressed="true">${icon('wrap-text')}</button><button class="fs-tool" data-fs="download-active" aria-label="下载当前文件">${icon('download')}</button><button class="fs-tool fs-save" data-fs="save">${icon('check')}<span>保存</span><kbd>⌘S</kbd></button></div></div><div class="fs-findbar" hidden><label class="fs-search">${icon('search')}<input class="fs-find-input" aria-label="搜索代码" placeholder="在当前文件中查找"></label><span class="fs-find-count">输入关键词</span><button class="fs-tool" data-fs="find-previous" aria-label="上一个匹配">${icon('chevron-up')}</button><button class="fs-tool" data-fs="find-next" aria-label="下一个匹配">${icon('chevron-down')}</button><button class="fs-tool" data-fs="find-close" aria-label="关闭代码搜索">${icon('x')}</button></div><div class="fs-code-host" id="fs-code-panel" role="tabpanel"><div class="fs-loading">正在打开项目文件…</div></div><div class="fs-statusbar"><span>${icon('hard-drive')}服务端源码 · 保存后更新预览</span><span class="fs-status-right"><span class="fs-save-status">已保存</span><span>UTF-8</span><span class="fs-cursor">行 1，列 1</span><span class="fs-language">TypeScript JSX</span></span></div></div></section><section class="fs-manager" id="fs-files-panel" role="tabpanel" aria-labelledby="fs-files-tab" hidden><div class="fs-manager-head"><div class="fs-manager-crumbs"></div><div class="fs-manager-actions"><button class="fs-button" data-fs="upload-folder">${icon('folder-up')}上传文件夹</button><button class="fs-button fs-upload" data-fs="upload">${icon('upload')}上传文件</button></div></div><div class="fs-manager-tools"><label class="fs-search">${icon('search')}<input class="fs-file-search" aria-label="搜索当前文件夹" placeholder="查找名称…"></label><div class="fs-layout-toggle" role="group" aria-label="文件展示方式"><button data-fs-layout="list" aria-label="列表视图" aria-pressed="true">${icon('list')}</button><button data-fs-layout="grid" aria-label="缩略图视图" aria-pressed="false">${icon('layout-grid')}</button></div></div><div class="fs-manager-scroll"></div><div class="fs-upload-status" hidden><span class="fs-upload-message"></span><div class="fs-upload-track"><span></span></div></div><div class="fs-manager-foot"><span class="fs-manager-count">正在读取文件…</span><span>${icon('hard-drive')}文件上传至当前项目服务器</span></div><div class="fs-drop-shade" hidden>${icon('upload')}放开，添加到当前文件夹<small>支持图片、文档与代码文件</small></div><input type="file" class="fs-upload-input" multiple hidden><input type="file" class="fs-folder-input" webkitdirectory multiple hidden></section><div class="fs-viewer-backdrop" hidden></div>`;
  zone.insertBefore(surface,zone.querySelector('.fm-canvas-footer'));icons();
  const tree=surface.querySelector('.fs-tree'),tabs=surface.querySelector('.fs-tabs'),codeHost=surface.querySelector('.fs-code-host'),manager=surface.querySelector('.fs-manager'),viewer=surface.querySelector('.fs-viewer-backdrop');

  function view(value,notify=true) {
    state.view=['preview','editor','files'].includes(value)?value:'preview';
    zone.dataset.workspaceView=state.view;
    toolbar.querySelectorAll('[data-fs-view]').forEach(button=>{const active=button.dataset.fsView===state.view;button.classList.toggle('fm-selected',active);button.setAttribute('aria-selected',String(active));});
    preview.hidden=state.view!=='preview';surface.hidden=state.view==='preview';surface.querySelector('.fs-editor').hidden=state.view!=='editor';manager.hidden=state.view!=='files';
    toolbar.querySelector('.fm-device').hidden=state.view!=='preview';zone.querySelector('.fm-canvas-footer').hidden=state.view!=='preview';
    toolbar.querySelector('.fs-toolbar-label').textContent=state.view==='preview'?'运行预览':state.view==='editor'?'workspace / source':'workspace / files';
    if(state.view==='editor')requestAnimationFrame(()=>editor?.refresh());
    if(state.view==='files')renderManager();
    const active=state.view==='preview'?preview:state.view==='editor'?surface.querySelector('.fs-editor'):manager;
    animate(active,[{opacity:.15,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:300});
    const address=new URL(location.href);address.searchParams.set('view',state.view);history.replaceState(null,'',address);
    if(notify&&window.parent!==window)window.parent.postMessage({type:'forma-workspace-view',view:state.view},location.origin);
  }
  function treeNode(folder,depth) {
    const children=new Map();const prefix=folder?folder+'/':'';
    for(const file of files.values()){if(!file.path.startsWith(prefix))continue;const rest=file.path.slice(prefix.length);if(!rest)continue;const part=rest.split('/')[0],path=prefix+part;const isFolder=rest.includes('/');if(!children.has(path)||isFolder)children.set(path,{path,name:part,folder:isFolder});}
    return [...children.values()].sort((a,b)=>Number(b.folder)-Number(a.folder)||a.name.localeCompare(b.name)).map(item=>{
      const padding=7+depth*12;
      if(item.folder){const expanded=openFolders.has(item.path);return `<button type="button" class="fs-tree-row fs-folder" role="treeitem" aria-expanded="${expanded}" data-fs-folder="${escape(item.path)}" style="padding-left:${padding}px">${icon('chevron-right').replace('<i ','<i class="fs-tree-chevron" ')}${icon(expanded?'folder-open':'folder-closed')}<span>${escape(item.name)}</span></button>${expanded?treeNode(item.path,depth+1):''}`;}
      return `<button type="button" class="fs-tree-row ${state.active===item.path?'fs-active':''}" role="treeitem" aria-selected="${state.active===item.path}" data-fs-open="${escape(item.path)}" style="padding-left:${padding+16}px">${fileIcon(item.path)}<span>${escape(item.name)}</span>${dirty.has(item.path)?'<span class="fs-dirty-dot"></span>':''}</button>`;
    }).join('');
  }
  function renderTree() {
    const query=state.treeSearch.trim().toLowerCase();
    tree.innerHTML=query?[...files.values()].filter(file=>file.path.toLowerCase().includes(query)).map(file=>`<button class="fs-tree-row ${file.path===state.active?'fs-active':''}" data-fs-open="${escape(file.path)}" role="treeitem" aria-selected="${file.path===state.active}">${fileIcon(file.path)}<span>${escape(file.path)}</span></button>`).join(''):treeNode('',0);
    if(!tree.innerHTML)tree.innerHTML='<div class="fs-loading">没有找到文件</div>';
    surface.querySelector('.fs-file-total').textContent=`${files.size} 个文件 · 已保存在服务器`;icons();
  }
  function renderTabs() {
    tabs.innerHTML=state.tabs.map(path=>`<div class="fs-tab ${path===state.active?'is-active':''}"><button class="fs-tab-select" role="tab" id="fs-tab-${encodeURIComponent(path)}" aria-selected="${path===state.active}" aria-controls="fs-code-panel" data-fs-open="${escape(path)}">${fileIcon(path)}${escape(basename(path))}</button>${dirty.has(path)?'<span class="fs-dirty-dot" aria-label="未保存"></span>':''}<button class="fs-tab-close" data-fs-close="${escape(path)}" aria-label="关闭 ${escape(basename(path))}">${icon('x')}</button></div>`).join('');
    codeHost.setAttribute('aria-labelledby',`fs-tab-${encodeURIComponent(state.active||'')}`);icons();
  }
  function status() {
    const cursor=editor?.getCursor()||{line:0,ch:0};surface.querySelector('.fs-cursor').textContent=`行 ${cursor.line+1}，列 ${cursor.ch+1}`;surface.querySelector('.fs-language').textContent=state.active?language(state.active):'';surface.querySelector('.fs-save-status').textContent=dirty.has(state.active)?'未保存':'已保存';
  }
  function makeEditor() {
    codeHost.innerHTML='';
    if(!window.CodeMirror){codeHost.innerHTML='<div class="fs-empty-editor">编辑器暂时未加载，请刷新页面。</div>';return;}
    editor=CodeMirror(codeHost,{value:'',mode:'text/plain',theme:'forma',lineNumbers:true,lineWrapping:true,tabSize:2,indentUnit:2,viewportMargin:15,extraKeys:{'Cmd-S':()=>save(),'Ctrl-S':()=>save(),'Cmd-F':()=>findBar(),'Ctrl-F':()=>findBar(),Tab:cm=>cm.replaceSelection('  ')}});
    editor.on('changes',()=>{if(switching||!state.active)return;dirty.add(state.active);renderTabs();status();});
    editor.on('cursorActivity',()=>{status();if(currentLine!=null)editor.removeLineClass(currentLine,'background','CodeMirror-activeline-background');currentLine=editor.getCursor().line;editor.addLineClass(currentLine,'background','CodeMirror-activeline-background');});
  }
  async function open(path,forceView=true) {
    const file=files.get(path);if(!file)return;
    const version=++requestVersion;clearSearch();state.active=path;if(!state.tabs.includes(path))state.tabs.push(path);
    const folder=parent(path);if(folder)folder.split('/').forEach((_,i,parts)=>openFolders.add(parts.slice(0,i+1).join('/')));
    renderTabs();renderTree();rememberTabs();surface.querySelector('.fs-file-breadcrumb').innerHTML=`${icon('file-code-2')}<span>${escape(parent(path))}${parent(path)?' / ':''}<strong>${escape(basename(path))}</strong></span>`;
    if(forceView)view('editor');
    if(textFile(file)&&file.size<2*1048576){
      if(!docs.has(path)){const text=file.text??await file.blob.text();if(version!==requestVersion)return;docs.set(path,new CodeMirror.Doc(text,mode(path)));}
      if(version!==requestVersion)return;
      surface.querySelector('.fs-binary-editor')?.remove();if(!editor)makeEditor();if(!editor)return;editor.getWrapperElement().hidden=false;switching=true;editor.swapDoc(docs.get(path));editor.setOption('lineWrapping',state.wrap);switching=false;currentLine=null;status();requestAnimationFrame(()=>editor.refresh());
    }else{
      if(editor)editor.getWrapperElement().hidden=true;surface.querySelector('.fs-binary-editor')?.remove();const area=document.createElement('div');area.className='fs-binary-editor';area.innerHTML=await previewMarkup(file);if(version!==requestVersion)return;codeHost.append(area);status();icons();
    }
  }
  async function save() {
    const path=state.active;if(!path||!dirty.has(path)){toast('当前文件已保存到服务器');return;}
    const file=files.get(path),doc=docs.get(path);if(!file||!doc)return;
    try {const text=doc.getValue();const blob=new Blob([text],{type:file.mime});await put({...file,text,blob,size:blob.size,updated:Date.now()});if(doc.getValue()===text){dirty.delete(path);doc.markClean();}renderTabs();renderTree();status();if(file.kind==='source'){try{await window.FormaWorkspace.build();}catch(error){toast('草稿已保存，预览构建未通过：'+error.message);}}else toast('文件已保存到服务器。');}catch{toast('保存未完成，当前草稿仍保留在编辑器中。');}
  }
  function closeTab(path) {state.tabs=state.tabs.filter(item=>item!==path);if(state.active===path){state.active=state.tabs.at(-1)||'';if(state.active)open(state.active,false);else{if(editor)editor.getWrapperElement().hidden=true;surface.querySelector('.fs-binary-editor')?.remove();const area=document.createElement('div');area.className='fs-binary-editor';area.innerHTML='<div class="fs-empty-editor">'+icon('files')+'选择一个文件，继续构建。<small>从左侧文件树打开项目文件</small></div>';codeHost.append(area);status();}}renderTabs();rememberTabs();if(dirty.has(path))toast('未保存的草稿暂时保留在当前页面，重新打开文件可继续编辑。');}
  function download(path) {const file=files.get(path);if(!file)return;const blob=dirty.has(path)&&docs.has(path)?new Blob([docs.get(path).getValue()],{type:file.mime}):file.blob;const link=document.createElement('a');const address=URL.createObjectURL(blob);link.href=address;link.download=basename(path);document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(address),1000);}
  function clearSearch() {state.marks.forEach(mark=>mark.clear());state.marks=[];}
  function findBar() {const bar=surface.querySelector('.fs-findbar');bar.hidden=false;bar.querySelector('input').focus();editor?.refresh();}
  function searchCode(direction=0) {
    if(!editor)return;clearSearch();const query=surface.querySelector('.fs-find-input').value;const output=surface.querySelector('.fs-find-count');if(!query){output.textContent='输入关键词';return;}
    const cursor=editor.getSearchCursor(query,{line:0,ch:0},{caseFold:true});let count=0;while(cursor.findNext()&&count<1000){state.marks.push(editor.markText(cursor.from(),cursor.to(),{className:'cm-searching'}));count++;}output.textContent=count?`${count}${count===1000?'+':''} 个匹配`:'没有匹配';
    if(direction&&count){const next=editor.getSearchCursor(query,direction>0?editor.getCursor('to'):editor.getCursor('from'),{caseFold:true});let found=direction>0?next.findNext():next.findPrevious();if(!found){const wrapped=editor.getSearchCursor(query,direction>0?{line:0,ch:0}:{line:editor.lastLine(),ch:Infinity},{caseFold:true});found=direction>0?wrapped.findNext():wrapped.findPrevious();if(found){editor.setSelection(wrapped.from(),wrapped.to());editor.scrollIntoView(wrapped.from(),80);}}else{editor.setSelection(next.from(),next.to());editor.scrollIntoView(next.from(),80);}}
  }

  function folderEntries() {
    const entries=new Map(),prefix=state.folder?state.folder+'/':'';
    for(const file of files.values()){if(!file.path.startsWith(prefix))continue;const rest=file.path.slice(prefix.length),first=rest.split('/')[0],path=prefix+first;if(rest.includes('/')){if(!entries.has(path))entries.set(path,{path,name:first,folder:true,updated:file.updated});else entries.get(path).updated=Math.max(entries.get(path).updated,file.updated);}else entries.set(path,{...file,name:first,folder:false});}
    return [...entries.values()].filter(item=>item.name.toLowerCase().includes(state.fileSearch.toLowerCase())).sort((a,b)=>Number(b.folder)-Number(a.folder)||a.name.localeCompare(b.name));
  }
  function renderManager() {
    const crumbs=manager.querySelector('.fs-manager-crumbs');let path='';crumbs.innerHTML=`${icon('folder-open')}<button data-fs-path="">项目文件</button>`;
    for(const part of state.folder.split('/').filter(Boolean)){path=path?path+'/'+part:part;crumbs.innerHTML+=`${icon('chevron-right')}<button data-fs-path="${escape(path)}">${escape(part)}</button>`;}
    const entries=folderEntries(),container=manager.querySelector('.fs-manager-scroll');
    if(!entries.length)container.innerHTML=`<div class="fs-storage-empty">${icon(state.fileSearch?'search':'folder-open')}<span>${state.fileSearch?'没有找到匹配的文件':'这里还是空的'}</span><small>${state.fileSearch?'换一个关键词试试':'拖入文件，或使用右上角的上传按钮'}</small></div>`;
    else if(state.layout==='list')container.innerHTML=`<table class="fs-file-table"><thead><tr><th>名称</th><th>大小</th><th>最后更新</th><th>操作</th></tr></thead><tbody>${entries.map(item=>`<tr><td><button class="fs-file-name" ${item.folder?`data-fs-path="${escape(item.path)}"`:`data-fs-preview="${escape(item.path)}"`}>${item.folder?icon('folder-closed'):fileIcon(item.path)}<span>${escape(item.name)}</span></button></td><td>${item.folder?'—':formatSize(item.size)}</td><td>${formatDate(item.updated)}</td><td><div class="fs-row-actions">${item.folder?`<button data-fs-path="${escape(item.path)}" aria-label="打开 ${escape(item.name)}">${icon('arrow-up-right')}</button>`:`<button data-fs-open="${escape(item.path)}" aria-label="在编辑器中打开 ${escape(item.name)}">${icon('code-2')}</button><button data-fs-download="${escape(item.path)}" aria-label="下载 ${escape(item.name)}">${icon('download')}</button>`}</div></td></tr>`).join('')}</tbody></table>`;
    else container.innerHTML=`<div class="fs-asset-grid">${entries.map(item=>`<button class="fs-asset-card" ${item.folder?`data-fs-path="${escape(item.path)}"`:`data-fs-preview="${escape(item.path)}"`}><span class="fs-asset-image">${!item.folder&&imageFile(item)?`<img src="${url(item)}" alt="${escape(item.name)}">`:icon(item.folder?'folder-closed':extension(item.path)==='md'?'file-text':textFile(item)?'file-code-2':'file')}</span><span class="fs-asset-label"><strong>${escape(item.name)}</strong><small>${item.folder?'文件夹':formatSize(item.size)}</small></span></button>`).join('')}</div>`;
    manager.querySelector('.fs-manager-count').innerHTML=`${icon('files')}${entries.length} 个项目<span>·</span>项目共 ${files.size} 个文件`;
    icons();animate(container,[{opacity:.2,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:250});
  }
  function markdown(text) {
    const lines=escape(text).split('\n');let code=false,list=false;const output=[];
    for(const line of lines){if(line.startsWith('```')){if(list){output.push('</ul>');list=false;}output.push(code?'</pre>':'<pre>');code=!code;continue;}if(code){output.push(line+'\n');continue;}const inline=value=>value.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');if(line.startsWith('- ')){if(!list){output.push('<ul>');list=true;}output.push('<li>'+inline(line.slice(2))+'</li>');continue;}if(list){output.push('</ul>');list=false;}const heading=line.match(/^(#{1,3}) (.*)$/);if(heading)output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);else if(line.trim())output.push('<p>'+inline(line)+'</p>');}if(list)output.push('</ul>');if(code)output.push('</pre>');return output.join('');
  }
  async function previewMarkup(file) {
    if(imageFile(file))return `<div class="fs-image-preview"><img src="${url(file)}" alt="${escape(basename(file.path))}"></div>`;
    if(extension(file.path)==='pdf'||file.mime==='application/pdf')return `<iframe src="${url(file)}" title="${escape(basename(file.path))}" sandbox></iframe>`;
    if(file.mime?.startsWith('audio/'))return `<div class="fs-media-preview"><audio controls src="${url(file)}"></audio></div>`;
    if(file.mime?.startsWith('video/'))return `<div class="fs-media-preview"><video controls src="${url(file)}"></video></div>`;
    if(textFile(file)&&file.size<2*1048576){const text=dirty.has(file.path)&&docs.has(file.path)?docs.get(file.path).getValue():file.text??await file.blob.text();return `<article class="fs-document">${extension(file.path)==='md'?markdown(text):'<pre>'+escape(text)+'</pre>'}</article>`;}
    return `<div class="fs-empty-editor">${icon('file')}<span>${escape(basename(file.path))}</span><small>此格式可以下载后，使用本机应用打开。</small><button class="fs-button" data-fs-download="${escape(file.path)}">${icon('download')}下载文件</button></div>`;
  }
  async function previewFile(path) {
    const file=files.get(path);if(!file)return;previousFocus=document.activeElement;viewer.hidden=false;viewer.dataset.path=path;
    viewer.innerHTML=`<aside class="fs-viewer" role="dialog" aria-modal="true" aria-label="预览 ${escape(basename(path))}"><div class="fs-viewer-head">${fileIcon(path)}<h2 class="fs-viewer-title">${escape(basename(path))}</h2><button class="fs-tool" data-fs-download="${escape(path)}" aria-label="下载 ${escape(basename(path))}">${icon('download')}</button><button class="fs-tool" data-fs="viewer-close" aria-label="关闭文件预览">${icon('x')}</button></div><div class="fs-viewer-body"><div class="fs-loading">正在读取文件…</div></div><div class="fs-viewer-footer"><span>${escape(path)}</span><span>${formatSize(file.size)} · ${formatDate(file.updated)}</span></div></aside>`;
    icons();animate(viewer,[{opacity:0},{opacity:1}],{duration:180});animate(viewer.firstElementChild,[{transform:'translateX(35px)',opacity:.3},{transform:'translateX(0)',opacity:1}],{duration:450});viewer.querySelector('[data-fs="viewer-close"]').focus();const html=await previewMarkup(file);if(viewer.dataset.path===path){viewer.querySelector('.fs-viewer-body').innerHTML=html;icons();}
  }
  function closeViewer() {viewer.hidden=true;viewer.innerHTML='';viewer.dataset.path='';if(previousFocus?.isConnected)previousFocus.focus();}
  function uniquePath(path) {if(!files.has(path))return path;const dot=path.lastIndexOf('.'),slash=path.lastIndexOf('/');const base=dot>slash?path.slice(0,dot):path,suffix=dot>slash?path.slice(dot):'';let index=2;while(files.has(`${base} (${index})${suffix}`))index++;return `${base} (${index})${suffix}`;}
  let importing=false;
  async function importFiles(fileList) {
    const incoming=[...fileList];if(!incoming.length)return;if(importing){toast('正在添加文件，请稍候再试。');return;}importing=true;const importFolder=state.folder;const statusElement=manager.querySelector('.fs-upload-status');statusElement.hidden=false;let imported=0;
    try {for(const file of incoming){const relative=cleanPath(file.webkitRelativePath||file.name);const path=uniquePath((importFolder?importFolder+'/':'')+relative);const record={path,blob:file,mime:file.type||'application/octet-stream',size:file.size,updated:Date.now()};if(textFile(record)&&file.size<2*1048576)record.text=await file.text();manager.querySelector('.fs-upload-message').textContent=`添加 ${imported+1} / ${incoming.length} · ${file.name}`;await put(record);imported++;manager.querySelector('.fs-upload-track>span').style.width=(imported/incoming.length*100)+'%';}renderTree();renderManager();toast(`已上传 ${imported} 个文件，保存在项目服务器。`);}catch{renderTree();renderManager();toast(`已添加 ${imported} 个文件，其余文件暂未保存，请检查网络或项目文件大小限制。`);}finally{importing=false;setTimeout(()=>statusElement.hidden=true,700);manager.querySelectorAll('input[type=file]').forEach(input=>input.value='');}
  }

  zone.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.fsView){view(target.dataset.fsView);return;}
    if(target.dataset.fsOpen){closeViewer();open(target.dataset.fsOpen);return;}
    if(target.dataset.fsClose){closeTab(target.dataset.fsClose);return;}
    if(target.dataset.fsFolder){const path=target.dataset.fsFolder;openFolders.has(path)?openFolders.delete(path):openFolders.add(path);renderTree();return;}
    if(target.dataset.fsPath!==undefined){state.folder=target.dataset.fsPath;state.fileSearch='';manager.querySelector('.fs-file-search').value='';renderManager();return;}
    if(target.dataset.fsPreview){previewFile(target.dataset.fsPreview);return;}
    if(target.dataset.fsDownload){download(target.dataset.fsDownload);return;}
    if(target.dataset.fsLayout){state.layout=target.dataset.fsLayout;manager.querySelectorAll('[data-fs-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fsLayout===state.layout)));renderManager();return;}
    switch(target.dataset.fs){
      case 'chat':{const collapsed=product.querySelector('.fm-workspace').classList.toggle('fs-chat-collapsed');target.setAttribute('aria-pressed',String(collapsed));target.setAttribute('aria-label',collapsed?'展开对话栏':'收起对话栏');target.innerHTML=icon(collapsed?'panel-left-open':'panel-left-close');icons();setTimeout(()=>editor?.refresh(),0);break;}
      case 'tree-toggle':surface.querySelector('.fs-editor').classList.toggle('fs-tree-collapsed');editor?.refresh();break;
      case 'tree-collapse':openFolders.clear();renderTree();break;
      case 'save':save();break;
      case 'wrap':state.wrap=!state.wrap;target.setAttribute('aria-pressed',String(state.wrap));editor?.setOption('lineWrapping',state.wrap);break;
      case 'download-active':download(state.active);break;
      case 'find':findBar();break;
      case 'find-close':surface.querySelector('.fs-findbar').hidden=true;clearSearch();editor?.refresh();break;
      case 'find-next':searchCode(1);break;
      case 'find-previous':searchCode(-1);break;
      case 'upload':manager.querySelector('.fs-upload-input').click();break;
      case 'upload-folder':manager.querySelector('.fs-folder-input').click();break;
      case 'viewer-close':closeViewer();break;
    }
  });
  surface.addEventListener('input',event=>{if(event.target.matches('.fs-tree-search')){state.treeSearch=event.target.value;renderTree();}if(event.target.matches('.fs-file-search')){state.fileSearch=event.target.value;renderManager();}if(event.target.matches('.fs-find-input'))searchCode();});
  surface.addEventListener('change',event=>{if(event.target.matches('.fs-upload-input,.fs-folder-input'))importFiles(event.target.files);});
  let dragDepth=0;
  manager.addEventListener('dragenter',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;manager.querySelector('.fs-drop-shade').hidden=false;});
  manager.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
  manager.addEventListener('dragleave',event=>{event.preventDefault();if(--dragDepth<=0){dragDepth=0;manager.querySelector('.fs-drop-shade').hidden=true;}});
  manager.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;manager.querySelector('.fs-drop-shade').hidden=true;importFiles(event.dataTransfer.files);});
  viewer.addEventListener('click',event=>{if(event.target===viewer)closeViewer();});
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&state.view==='editor'){event.preventDefault();event.stopImmediatePropagation();save();}
    if(event.key==='Escape'&&!viewer.hidden){event.preventDefault();closeViewer();}
    if(event.key==='Enter'&&event.target.matches('.fs-find-input')){event.preventDefault();searchCode(event.shiftKey?-1:1);}
    if(event.key==='Tab'&&!viewer.hidden){const items=[...viewer.querySelectorAll('button,a[href],input,audio,video')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  },true);
  window.addEventListener('pagehide',()=>{objectURLs.forEach(address=>URL.revokeObjectURL(address));});
  let initialized=false;
  window.FormaFiles={dirty:()=>dirty.size};
  let resizeFrame;window.addEventListener('forma-layout-resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>editor?.refresh());});
  window.addEventListener('forma-source-changed',async()=>{if(!initialized)return;if(dirty.size){toast('服务器源码已更新，当前未保存草稿已保留，请刷新并合并。');return;}try{files.clear();docs.clear();await initialize();renderTree();renderTabs();renderManager();if(state.active)await open(state.active,false);}catch(error){toast(error.message);}});
  try {await initialize();initialized=true;makeEditor();renderTree();if(state.active&&files.has(state.active))await open(state.active,false);renderManager();view(new URLSearchParams(location.search).get('view')||'preview',false);}catch(error){toast('项目文件未能加载，请刷新后重试。');console.error(error);}
})();
