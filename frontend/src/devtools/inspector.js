/* Local visual feedback aid. Reads layout and selectors, never field values. */
(() => {
  if (window !== window.top) return;
  const host = document.createElement('div');
  host.id = 'forma-dev-inspector';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<link rel="stylesheet" href="/src/devtools/inspector.css">
    <div class="highlight" hidden></div>
    <div class="tooltip" hidden aria-hidden="true"><div class="tag"></div><strong class="identity"></strong><code class="selector"></code><small class="geometry"></small></div>
    <aside class="dock" aria-label="前端开发者工具">
      <button class="toggle" type="button" aria-pressed="false" aria-label="开启开发者模式" title="拖动移动 · Alt + 方向键微调 · Alt + Shift + D 开关"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 4H4v3m9-3h3v3M4 13v3h3m9-3v3h-3M7 10h6m-3-3v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>开发者模式</span><i></i></button>
      <section class="controls" hidden><p>悬停查看 · Alt + 点击固定 · Esc 退出</p><div class="actions"><button class="copy" type="button" disabled>复制定位</button><button class="freeze" type="button" disabled aria-pressed="false">固定元素</button></div><span class="status" role="status" aria-live="polite">移动鼠标，查看任意界面元素。</span><textarea class="manual-copy" readonly aria-label="元素定位信息，复制失败时可手动选择" hidden></textarea></section>
    </aside>`;
  document.body.append(host);
  const $ = selector => shadow.querySelector(selector);
  const highlight=$('.highlight'), tip=$('.tooltip'), toggle=$('.toggle'), controls=$('.controls');
  const copy=$('.copy'), freeze=$('.freeze'), status=$('.status'), manual=$('.manual-copy');
  const dock=$('.dock'),positionKey='forma-dev-inspector-position';
  let position=null,drag=null,dragged=false;
  try{const saved=JSON.parse(localStorage.getItem(positionKey));if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))position=saved;}catch{}
  function placeDock(x,y,persist=false){
    if(!dock.offsetWidth||!dock.offsetHeight||getComputedStyle(dock).position==='static')return;
    const margin=8;
    position={x:Math.max(margin,Math.min(x,innerWidth-dock.offsetWidth-margin)),y:Math.max(margin,Math.min(y,innerHeight-dock.offsetHeight-margin))};
    Object.assign(dock.style,{left:position.x+'px',top:position.y+'px',bottom:'auto'});
    if(persist)try{localStorage.setItem(positionKey,JSON.stringify(position));}catch{}
  }
  function keepDockInView(){const box=dock.getBoundingClientRect();placeDock(position?.x??box.left,position?.y??box.top);}
  toggle.addEventListener('pointerdown',event=>{
    if(event.button!==0||!event.isPrimary)return;
    const box=dock.getBoundingClientRect();
    dragged=false;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top};
    toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!dragged&&Math.hypot(dx,dy)<5)return;
    dragged=true;dock.classList.add('dragging');event.preventDefault();
    placeDock(drag.left+dx,drag.top+dy);
  });
  function finishDrag(event){
    if(!drag||event.pointerId!==drag.id)return;
    const pointer=drag.id;drag=null;dock.classList.remove('dragging');
    if(dragged&&position)placeDock(position.x,position.y,true);
    if(toggle.hasPointerCapture(pointer))toggle.releasePointerCapture(pointer);
  }
  toggle.addEventListener('pointerup',finishDrag);
  toggle.addEventListener('pointercancel',finishDrag);
  toggle.addEventListener('lostpointercapture',finishDrag);
  toggle.addEventListener('keydown',event=>{
    const offset={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[event.key];
    if(!event.altKey||!offset)return;
    event.preventDefault();event.stopPropagation();const box=dock.getBoundingClientRect();placeDock(box.left+offset[0],box.top+offset[1],true);
  });
  const dockObserver=new ResizeObserver(keepDockInView);dockObserver.observe(dock);
  window.addEventListener('resize',keepDockInView);
  const documents=new Map();
  let enabled=false, pinned=false, current=null, info=null, paintFrame=0, scanFrame=0, clipboardTimer;
  const escape=value=>CSS.escape(String(value));
  function selectorFor(element) {
    const doc=element.ownerDocument, parts=[];
    for(let node=element;node&&node.nodeType===1;node=node.parentElement){
      let part;
      if(node.id) part='#'+escape(node.id);
      else if(node.dataset.ui) part='[data-ui="'+escape(node.dataset.ui)+'"]';
      else {
        part=node.localName;
        const attribute=['name','data-action','data-fs-action'].find(name=>node.hasAttribute(name));
        if(attribute) part+='['+attribute+'="'+escape(node.getAttribute(attribute))+'"]';
        else part += [...node.classList].filter(name=>!/^(active|selected|is-|fm-selected|fs-chat-collapsed)/.test(name)).slice(0,2).map(name=>'.'+escape(name)).join('');
        const siblings=node.parentElement?[...node.parentElement.children].filter(item=>item.localName===node.localName):[];
        if(siblings.length>1&&siblings.filter(item=>item.matches(part)).length>1)part+=':nth-of-type('+(siblings.indexOf(node)+1)+')';
      }
      parts.unshift(part);
      const result=parts.join(' > ');
      if(doc.querySelectorAll(result).length===1)return result;
    }
    return parts.join(' > ');
  }
  function hash(text){let value=2166136261;for(const char of text){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}return (value>>>0).toString(36);}
  function describe(element){
    const selector=selectorFor(element), chain=[];
    let view=element.ownerDocument.defaultView;
    while(view&&view!==window){const frame=view.frameElement;if(!frame)break;chain.unshift(selectorFor(frame));view=frame.ownerDocument.defaultView;}
    const path=[...chain,selector].join(' >> ');
    const id=element.id||element.dataset.ui||'ui-'+hash(element.ownerDocument.location.pathname+'|'+path);
    element.dataset.inspectId=id;
    return {id,selector:path,tag:element.localName,kind:element.id?'DOM ID':element.dataset.ui?'UI ID':'自动 ID',boundary:element.localName==='iframe'};
  }
  function rectFor(element){
    const rect=element.getBoundingClientRect();
    let box={left:rect.left,top:rect.top,width:rect.width,height:rect.height},view=element.ownerDocument.defaultView;
    while(view&&view!==window){
      const frame=view.frameElement;if(!frame)break;
      const parent=frame.getBoundingClientRect(),sx=frame.offsetWidth?parent.width/frame.offsetWidth:1,sy=frame.offsetHeight?parent.height/frame.offsetHeight:1;
      box={left:parent.left+(frame.clientLeft+box.left)*sx,top:parent.top+(frame.clientTop+box.top)*sy,width:box.width*sx,height:box.height*sy};
      view=frame.ownerDocument.defaultView;
    }
    return box;
  }
  function clear(){current=null;info=null;highlight.hidden=true;tip.hidden=true;copy.disabled=true;freeze.disabled=true;manual.hidden=true;}
  function paint(){
    paintFrame=0;
    if(!enabled||!current?.isConnected){clear();return;}
    const rect=rectFor(current);
    if(rect.width<=0||rect.height<=0){highlight.hidden=true;tip.hidden=true;return;}
    highlight.hidden=false;tip.hidden=false;
    Object.assign(highlight.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    $('.geometry').textContent=Math.round(rect.width)+' × '+Math.round(rect.height)+' px'+(pinned?' · 已固定':'');
    const width=tip.offsetWidth,height=tip.offsetHeight;
    const left=Math.max(8,Math.min(innerWidth-width-8,rect.left));
    let top=rect.top-height-10;
    if(top<8)top=rect.top+rect.height+10;
    top=Math.max(8,Math.min(innerHeight-height-8,top));
    Object.assign(tip.style,{left:left+'px',top:top+'px'});
  }
  function schedulePaint(){if(enabled&&!paintFrame)paintFrame=requestAnimationFrame(paint);}
  function show(element){
    if(element===current){schedulePaint();return;}
    current=element;info=describe(element);
    $('.tag').textContent='<'+info.tag+'> · '+info.kind;
    $('.identity').textContent=info.id;
    $('.selector').textContent=info.selector;
    copy.disabled=false;freeze.disabled=false;manual.hidden=true;
    status.textContent=info.boundary?'隔离预览：此处标记预览容器，内部源码请在编辑器定位。':'可直接截图，或复制定位信息发给我。';
    schedulePaint();
  }
  function pick(event){
    let element=event.target;
    if(!element||element.nodeType!==1||element===host)return null;
    // Inert visual chevrons still need their own inspectable identity.
    const arrow=element.closest('.plan-select')?.querySelector('svg[data-ui]');
    if(arrow){const rect=arrow.getBoundingClientRect();if(event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom)return arrow;}
    if(element.namespaceURI==='http://www.w3.org/2000/svg')element=element.closest('svg')||element;
    return element;
  }
  function move(event){if(!enabled||pinned||drag)return;const target=pick(event);if(target)show(target);}
  function setPinned(value){pinned=!!value&&!!current;freeze.textContent=pinned?'继续跟随':'固定元素';freeze.setAttribute('aria-pressed',String(pinned));schedulePaint();}
  function click(event){if(!enabled||!event.altKey)return;const target=pick(event);if(!target)return;event.preventDefault();event.stopImmediatePropagation();show(target);setPinned(true);}
  function key(event){
    if(event.altKey&&event.shiftKey&&event.code==='KeyD'){event.preventDefault();event.stopImmediatePropagation();setEnabled(!enabled);}
    else if(event.key==='Escape'&&enabled){event.preventDefault();setEnabled(false);}
  }
  function scan(){
    scanFrame=0;
    const found=new Set();
    function visit(doc){
      if(found.has(doc))return;found.add(doc);
      if(!documents.has(doc)){
        const observer=new MutationObserver(records=>{if(records.some(record=>record.target!==host&&!host.contains(record.target)))scheduleScan();});
        observer.observe(doc.documentElement,{childList:true,subtree:true});
        doc.addEventListener('pointermove',move,{passive:true,capture:true});doc.addEventListener('pointerover',move,{passive:true,capture:true});
        doc.addEventListener('pointerdown',click,true);doc.addEventListener('click',click,true);doc.addEventListener('keydown',key,true);doc.addEventListener('scroll',schedulePaint,true);doc.addEventListener('load',scheduleScan,true);
        doc.defaultView.addEventListener('resize',schedulePaint);
        documents.set(doc,()=>{observer.disconnect();doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerover',move,true);doc.removeEventListener('pointerdown',click,true);doc.removeEventListener('click',click,true);doc.removeEventListener('keydown',key,true);doc.removeEventListener('scroll',schedulePaint,true);doc.removeEventListener('load',scheduleScan,true);doc.defaultView?.removeEventListener('resize',schedulePaint);});
      }
      for(const frame of doc.querySelectorAll('iframe')){try{if(frame.contentDocument?.documentElement)visit(frame.contentDocument);}catch{/* Preserve sandbox isolation. */}}
    }
    visit(document);
    for(const [doc,cleanup] of documents)if(!found.has(doc)){cleanup();documents.delete(doc);}
    if(current&&!current.isConnected){setPinned(false);clear();}
    schedulePaint();
  }
  function scheduleScan(){if(enabled&&!scanFrame)scanFrame=requestAnimationFrame(scan);}
  function setEnabled(value){
    enabled=!!value;setPinned(false);clear();
    host.toggleAttribute('data-enabled',enabled);controls.hidden=!enabled;
    toggle.setAttribute('aria-pressed',String(enabled));toggle.setAttribute('aria-label',enabled?'关闭开发者模式':'开启开发者模式');
    toggle.querySelector('span').textContent=enabled?'开发者模式已开启':'开发者模式';
    status.textContent='移动鼠标，查看任意界面元素。';
    try{sessionStorage.setItem('forma-dev-inspector',String(enabled));}catch{}
    if(enabled)scan();else{cancelAnimationFrame(scanFrame);scanFrame=0;for(const cleanup of documents.values())cleanup();documents.clear();}
  }
  toggle.addEventListener('click',event=>{if(dragged&&event.detail!==0){dragged=false;event.preventDefault();event.stopPropagation();return;}setEnabled(!enabled);});
  freeze.addEventListener('click',()=>setPinned(!pinned));
  copy.addEventListener('click',async()=>{
    if(!current||!info)return;
    const rect=rectFor(current),report=['Forma 界面定位','页面：'+location.pathname+location.hash,'元素 ID：'+info.id+' ('+info.kind+')','定位：'+info.selector,'尺寸：'+Math.round(rect.width)+' × '+Math.round(rect.height)+' px',info.boundary?'范围：预览容器':''].filter(Boolean).join('\n');
    try{await navigator.clipboard.writeText(report);status.textContent='定位已复制，可以粘贴到聊天中。';copy.textContent='已复制';clearTimeout(clipboardTimer);clipboardTimer=setTimeout(()=>copy.textContent='复制定位',1800);}
    catch{manual.hidden=false;manual.value=report;manual.focus();manual.select();status.textContent='请按 ⌘ / Ctrl + C 复制下方定位信息。';}
  });
  // Keep the shortcut available when no document observers are attached.
  window.addEventListener('keydown',event=>{if(!enabled)key(event);},true);
  window.addEventListener('hashchange',()=>{setPinned(false);clear();scheduleScan();});
  window.addEventListener('blur',()=>{if(!pinned){highlight.hidden=true;tip.hidden=true;}});
  window.addEventListener('pagehide',()=>{for(const cleanup of documents.values())cleanup();documents.clear();});
  try{setEnabled(sessionStorage.getItem('forma-dev-inspector')==='true');}catch{setEnabled(false);}
})();
