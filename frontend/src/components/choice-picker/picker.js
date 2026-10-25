/* Shared accessible choice panel. The native select remains the single form value. */
(() => {
  let serial=0;
  const mounted=new Map();
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(select,{compact=false,label='构建方式',hint='由你选择',footer='切换方式后，下一次构建生效',entries:customEntries,onReselect,variant='',side='auto'}={}){
    if(mounted.has(select))return mounted.get(select);
    const wrapper=document.createElement('div');wrapper.className='model-picker'+(compact?' model-picker-compact':'')+(variant?' model-picker-'+variant:'');
    const trigger=document.createElement('button');trigger.type='button';trigger.className='mp-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const menu=document.createElement('div');menu.className='model-picker-menu'+(variant?' model-picker-menu-'+variant:'');menu.id='model-picker-'+(++serial);menu.hidden=true;menu.setAttribute('popover','manual');
    menu.innerHTML=`<div class="mp-heading">${escape(label)}<span>${escape(hint)}</span></div><div class="mp-options" role="listbox" aria-label="${escape(label)}"></div><div class="mp-foot"></div>`;
    const list=menu.querySelector('.mp-options');trigger.setAttribute('aria-controls',menu.id+'-options');list.id=menu.id+'-options';
    const previousHidden=select.hidden,labels=[...(select.labels||[])];trigger.id=menu.id+'-trigger';
    select.before(wrapper);wrapper.append(select,trigger);select.hidden=true;labels.forEach(node=>node.htmlFor=trigger.id);
    wrapper.parentElement.querySelector('[data-ui="plan.mode.chevron"]')?.remove();
    const host=select.closest('dialog')||document.body;host.append(menu);
    let opened=false;
    const entries=()=>[...select.options].map(option=>{
      const own=FormaAPI.settings?.userModel;
      if(option.value==='ai')return {value:'ai',title:'平台模型',detail:option.disabled?'暂未配置，可使用自己的模型':FormaAPI.settings?.model||'由平台提供模型服务',badge:option.disabled?'未开通':'即用',icon:'sparkles',disabled:option.disabled};
      if(option.value==='byok')return {value:'byok',title:'自己的 API Key',detail:own?.ready?own.model:'连接你正在使用的模型服务',badge:own?.ready?'已连接':'可配置',icon:'key-round',disabled:option.disabled};
      return {value:option.value,title:'体验示例',detail:'无需 API Key，快速体验基本流程',badge:'免费',icon:'shapes',disabled:option.disabled};
    });
    function sync(){
      const items=customEntries?customEntries():entries(),chosen=items.find(item=>item.value===select.value)||items.find(item=>!item.disabled);
      if(!chosen)return;
      trigger.innerHTML=`${icon(chosen.icon)}<span class="mp-trigger-label">${escape(compact&&chosen.value==='ai'?chosen.detail:compact&&chosen.value==='byok'&&FormaAPI.settings?.userModel?.ready?chosen.detail:chosen.title)}</span>${icon('chevron-down')}`;
      trigger.setAttribute('aria-label',label+'：'+chosen.title);trigger.disabled=select.disabled;trigger.title=chosen.title+' · '+chosen.detail;
      list.innerHTML=items.map(item=>`<button type="button" class="mp-option" role="option" data-mode="${escape(item.value)}" aria-selected="${item.value===select.value}" ${item.disabled?'disabled':''} tabindex="-1"><span class="mp-option-icon">${icon(item.icon)}</span><span class="mp-option-copy"><strong>${escape(item.title)}${item.badge?`<small>${escape(item.badge)}</small>`:''}</strong><span>${escape(item.detail)}</span></span><span class="mp-check">${item.value===select.value?icon('check'):''}</span></button>`).join('');
      menu.querySelector('.mp-foot').textContent=typeof footer==='function'?footer():footer;
      window.lucide?.createIcons();if(opened){if(select.disabled)close();else position();}
    }
    function position(){
      const anchor=trigger.getBoundingClientRect(),width=Math.min(Math.max(304,variant==='skill'?anchor.width:0),window.innerWidth-24);
      menu.style.width=width+'px';menu.style.maxHeight=Math.max(120,window.innerHeight-24)+'px';
      const height=menu.getBoundingClientRect().height,above=anchor.top-height-10;
      const belowFits=anchor.bottom+10+height<=window.innerHeight-12;
      const useAbove=side==='below'?(belowFits?false:above>=12):above>=12;
      const top=useAbove?above:Math.min(anchor.bottom+10,window.innerHeight-height-12);
      menu.style.left=Math.max(12,Math.min(anchor.left,window.innerWidth-width-12))+'px';menu.style.top=Math.max(12,top)+'px';
      menu.dataset.side=useAbove?'above':'below';
    }
    function close(focus=false){
      if(!opened)return;opened=false;trigger.setAttribute('aria-expanded','false');
      if(menu.hidePopover)menu.hidePopover();menu.hidden=true;if(focus&&trigger.isConnected)trigger.focus();
    }
    function show(last=false){
      if(trigger.disabled)return;for(const item of mounted.values())item.close();
      opened=true;menu.hidden=false;if(menu.showPopover)menu.showPopover();trigger.setAttribute('aria-expanded','true');position();
      const options=[...list.querySelectorAll('button:not(:disabled)')];
      (last?options.at(-1):list.querySelector('[aria-selected=true]:not(:disabled)')||options[0])?.focus();
    }
    trigger.addEventListener('click',()=>opened?close(true):show());
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show(event.key==='ArrowUp');}});
    menu.addEventListener('click',event=>{
      const option=event.target.closest('[data-mode]');if(!option||option.disabled)return;
      const changed=select.value!==option.dataset.mode;select.value=option.dataset.mode;close(true);sync();
      // A button must never submit the surrounding brief or composer.
      if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
      else if(onReselect)onReselect(select.value);
      else if(!customEntries&&select.value==='byok'&&!FormaAPI.settings?.userModel?.ready)FormaModel.open();
    });
    menu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(event.key==='Tab'){event.preventDefault();close(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();const options=[...list.querySelectorAll('button:not(:disabled)')],index=options.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options[next]?.focus();
    });
    const outside=event=>{if(opened&&!menu.contains(event.target)&&!wrapper.contains(event.target))close();};
    const blur=event=>{if(opened&&!menu.contains(event.target)&&!wrapper.contains(event.target))close();};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',blur);
    const resize=()=>close(),scroll=event=>{if(!menu.contains(event.target))close();};
    window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,true);
    const hostClosed=()=>close();if(host!==document.body)host.addEventListener('close',hostClosed);
    select.addEventListener('change',sync);
    const observer=new MutationObserver(sync);observer.observe(select,{childList:true,subtree:true,attributes:true});
    const instance={sync,close,destroy(){close();observer.disconnect();select.removeEventListener('change',sync);if(host!==document.body)host.removeEventListener('close',hostClosed);menu.remove();if(wrapper.isConnected){wrapper.replaceWith(select);select.hidden=previousHidden;labels.forEach(node=>node.htmlFor=select.id);}document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',blur);window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll,true);mounted.delete(select);}};
    mounted.set(select,instance);sync();return instance;
  }
  window.addEventListener('hashchange',()=>queueMicrotask(()=>{for(const [select,item] of mounted)if(!select.isConnected)item.destroy();}));
  window.FormaModelPicker={mount};
})();
