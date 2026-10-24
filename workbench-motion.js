(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.16,1,.3,1)';
  function appearance(value) { document.documentElement.dataset.theme = value;document.querySelector('.fm-theme-toggle')?.setAttribute('aria-label',value==='dark'?'切换浅色模式':'切换深色模式'); }
  try { appearance(localStorage.getItem('forma-theme') || 'light'); } catch { appearance('light'); }
  window.addEventListener('message', event => { if (event.origin === location.origin && event.data?.type === 'forma-theme') appearance(event.data.value); });
  const motion = (el, frames, options = {}) => { if (el && !reduced.matches) el.animate(frames, { duration: 420, easing: ease, ...options }); };
  document.querySelectorAll('.fm-thread > *,.fm-composer-area,.fm-preview-target').forEach((el,index) => motion(el,[{opacity:0,transform:'translateY(10px)',filter:'blur(2px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{delay:Math.min(index*55,300),duration:650}));
  const overlay = document.querySelector('.fm-overlay');
  let overlayVisible = false;
  const observation = new MutationObserver(records => {
    if (overlay.hidden) { overlayVisible = false; return; }
    if (!overlay.hidden && records.some(record => record.attributeName === 'hidden' || record.type === 'childList')) {
      const review = overlay.classList.contains('fm-review-overlay');
      if (review && overlayVisible) {
        motion(overlay.querySelector('.fm-version-detail'),[{opacity:.4,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:230});
      } else {
        motion(overlay,[{opacity:0},{opacity:1}],{duration:180});
        motion(overlay.querySelector('.fm-modal'),review?[{opacity:0,transform:'translateX(32px)'},{opacity:1,transform:'translateX(0)'}]:[{opacity:0,transform:'translateY(14px) scale(.97)',filter:'blur(2px)'},{opacity:1,transform:'translateY(0) scale(1)',filter:'blur(0)'}]);
      }
      overlayVisible = true;
    }
  });
  if(overlay)observation.observe(overlay,{attributes:true,attributeFilter:['hidden'],childList:true});
  const steps = document.querySelector('.fm-steps');
  if(steps)new MutationObserver(() => { if (!steps.hidden) steps.querySelectorAll('span').forEach((el,i)=>motion(el,[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{delay:i*40,duration:300})); }).observe(steps,{attributes:true,attributeFilter:['hidden']});
  const grid = document.querySelector('.rd-grid');
  if(grid)new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(el => {if(el.nodeType===1)motion(el,[{opacity:0,transform:'translateY(12px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:550});}))).observe(grid,{childList:true});
  document.querySelector('.fm-product')?.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.filter)document.querySelectorAll('.rd-article:not([hidden])').forEach((el,i)=>motion(el,[{opacity:.25,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,delay:i*35}));
    if(['warm','restore'].includes(button.dataset.action))motion(document.querySelector('.fm-preview-target'),[{opacity:.7},{opacity:1}],{duration:450});
  });
})();

/* A native-feeling split pane, with pointer and keyboard support. */
(() => {
  const workspace=document.querySelector('.fm-workspace');
  if(!workspace)return;
  const handle=document.createElement('div');handle.className='fm-chat-resizer';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','调整对话栏宽度，方向键调整，Home 重置');
  workspace.append(handle);
  let width=316;
  try{width=Number(localStorage.getItem('forma-conversation-width'))||316;}catch{}
  const limit=()=>Math.max(260,Math.min(460,workspace.clientWidth-360));
  function resize(value,remember=false){width=Math.round(Math.max(260,Math.min(limit(),value)));workspace.style.setProperty('--conversation-width',width+'px');handle.setAttribute('aria-valuemin','260');handle.setAttribute('aria-valuemax',String(limit()));handle.setAttribute('aria-valuenow',String(width));if(remember)try{localStorage.setItem('forma-conversation-width',String(width));}catch{}window.dispatchEvent(new Event('forma-layout-resize'));}
  resize(width);
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);workspace.classList.add('fm-resizing');});
  handle.addEventListener('pointermove',event=>{if(handle.hasPointerCapture(event.pointerId))resize(event.clientX-workspace.getBoundingClientRect().left);});
  function end(event){if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);workspace.classList.remove('fm-resizing');resize(width,true);}
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  handle.addEventListener('dblclick',()=>resize(316,true));
  handle.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();resize(event.key==='Home'?316:width+(event.key==='ArrowRight'?20:-20),true);}});
  window.addEventListener('resize',()=>resize(width));
})();
