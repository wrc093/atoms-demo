/* Suggestions only compose a draft. Model work and caching belong to the API. */
(() => {
  window.FormaSuggestions={mount(root,{request,input,onConnect}){
    let current,sequence=0,timer,inflight=false,stopped=false;
    const clear=()=>{clearTimeout(timer);timer=undefined;};
    const element=(tag,text,className)=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
    function render(state){
      root.replaceChildren();root.hidden=!current?.version||current.busy;
      if(root.hidden)return;
      if(state?.status==='ready'&&state.items?.length){
        root.append(element('span','可以继续探索','fm-suggestion-label'));
        for(const item of state.items.slice(0,2)){
          const button=element('button','','fm-project-suggestion');button.type='button';button.title=item.prompt;
          const heading=element('span','','fm-suggestion-heading');
          heading.append(element('strong',item.title),element('span','+','fm-suggestion-plus'));
          button.append(heading,element('small',item.reason));
          button.addEventListener('click',()=>{
            input.value=input.value.trim()?input.value.trimEnd()+'\n\n'+item.prompt:item.prompt;
            input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(input.value.length,input.value.length);
          });root.append(button);
        }
      }else if(state?.status==='pending'){
        const note=element('span','正在想想这个项目还能怎样更好…','fm-suggestion-note');note.setAttribute('role','status');root.append(note);
      }else{
        const connected=current.available;
        const button=element('button',connected?'获取项目优化建议':'连接模型，探索项目的下一步','fm-suggestion-retry');button.type='button';
        if(state?.status==='failed'){
          const note=element('small',state.error||'暂时没能生成建议，可以重试。','fm-suggestion-note');root.append(note);
          if(connected)button.textContent='重新获取建议';
        }
        button.addEventListener('click',()=>connected?start():onConnect());root.append(button);
      }
    }
    function poll(token,version){
      clear();timer=setTimeout(async()=>{
        if(stopped||token!==sequence||current.busy)return;
        try{
          const state=await request('GET');
          if(token!==sequence||state.version!==version)return;
          current.state=state;render(state);
          if(state.status==='pending')poll(token,version);
        }catch(error){if(token===sequence){current.state={status:'failed',error:error.message};render(current.state);}}
      },1300);
    }
    async function start(){
      if(stopped||inflight||!current?.version||current.busy||!current.available)return;
      const token=sequence,version=current.version,mode=current.mode;
      inflight=true;clear();current.state={status:'pending'};render(current.state);
      try{
        const state=await request('POST',{version,mode});
        if(token!==sequence||state.version!==version)return;
        current.state=state;render(state);if(state.status==='pending')poll(token,version);
      }catch(error){if(token===sequence){current.state={status:'failed',error:error.message};render(current.state);}}
      finally{inflight=false;if(token!==sequence&&current?.state?.status==='missing')start();}
    }
    function update(next){
      if(stopped)return;
      const changed=!current||current.version!==next.version||current.mode!==next.mode||current.busy!==next.busy||current.available!==next.available;
      if(!changed)return;
      clear();sequence++;current={...next};render(current.state);
      if(!current.version||current.busy)return;
      if(current.state?.status==='pending')poll(sequence,current.version);
      else if(current.state?.status==='missing'&&current.available&&!inflight)start();
    }
    function destroy(){stopped=true;sequence++;clear();}
    return {update,destroy};
  }};
})();
