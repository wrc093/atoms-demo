/* A live build session. Activity comes only from durable server job events. */
(() => {
  let dispose=()=>{};
  const stages=['理解你的想法','生成应用代码','检查页面与交互','保存版本，准备见面'];
  const descriptions=['整理这次构建的目标与现有内容。','正在把需求写成可以运行的页面。','校验入口、资源引用和 JavaScript 语法。','写入完整源码与版本，准备打开工作台。'];
  function page(project,id){
    const name=escapeText(project?.name||'新的想法');
    return `<main class="build-page build-session" data-phase="0" data-status="connecting">
      <header class="build-nav">${brand()}<div class="build-project-label">${icon('circle-dashed')}<span>${name}</span><span class="build-nav-divider">/</span><span>${project?.currentVersion?'让作品，再进一步':'第一版，从这里开始'}</span></div><div class="build-nav-actions">${appearance()}<a href="#/projects">稍后回来${icon('arrow-up-right')}</a></div></header>
      <div class="build-layout">
        <section class="build-content" aria-labelledby="build-heading">
          <div class="build-kicker"><span class="build-live-dot"></span><span data-build-status>连接构建任务</span><span class="build-elapsed" data-build-elapsed>00:00</span></div>
          <h1 id="build-heading">让想法，<br>一点点<span>成形。</span></h1>
          <p class="build-intro">${name}<span>你负责想象，我们负责让它发生。</span></p>
          <div class="build-steps" aria-label="真实构建阶段">${stages.map((text,i)=>`<div class="build-step" data-step="${i}"><span class="build-step-marker">${String(i+1).padStart(2,'0')}</span><div><strong>${text}</strong><p>${descriptions[i]}</p></div><small>等待中</small></div>`).join('')}</div>
          <div class="build-caption" aria-live="polite"><span data-build-message>正在读取服务器上的任务状态…</span><span data-progress-label>0 / 4</span></div>
          <div class="build-progress" role="progressbar" aria-label="已完成的构建阶段" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"><span></span></div>
          <details class="build-log"><summary>${icon('list-tree')}构建记录<span data-build-event-count>0 条</span>${icon('chevron-down')}</summary><ol data-build-events></ol></details>
          <div class="build-error" hidden><p role="alert"></p><div><button class="btn btn-outline" type="button" data-build-reconnect hidden>重新连接</button><button class="btn btn-dark" type="button" data-build-resume hidden>恢复生成</button><a class="btn btn-outline" href="#/plan/${escapeText(id)}">返回方案</a></div><small data-build-checkpoint></small></div>
          <div class="build-side-foot"><span>${icon('shield-check')}进度会保留，随时可以回来</span><button type="button" data-build-cancel>取消任务</button></div>
        </section>
        <section class="build-atelier" aria-label="等待时的分层构形展示">
          <div class="build-atelier-top"><span><span class="build-tiny-cross">+</span>THE MAKING OF AN IDEA</span><button type="button" class="build-motion-toggle" data-build-motion aria-pressed="false" aria-label="暂停画布动画">${icon('pause')}</button></div>
          <div class="build-art-halo" aria-hidden="true"></div><div class="build-art-grid" aria-hidden="true"></div>
          <div class="build-scene">
            <div class="build-orbit build-orbit-one" aria-hidden="true"></div><div class="build-orbit build-orbit-two" aria-hidden="true"></div>
            <div class="build-shape" aria-hidden="true"><div class="build-sheet build-sheet-back"><span>THE POSSIBILITY</span></div><div class="build-sheet build-sheet-middle"><i></i><i></i><i></i><b></b></div><div class="build-sheet build-sheet-front"><div class="build-sheet-bar"><span><i></i><i></i><i></i></span><small>${name}</small>${icon('arrow-up-right')}</div><div class="build-sheet-body"><aside><b></b><i></i><i></i><i></i><i></i></aside><div class="build-sheet-main"><small>A SPACE FOR WHAT'S NEXT</small><strong>从一个念头，<br>到无限可能<span>。</span></strong><div class="build-sheet-rule"></div><div class="build-sheet-cards"><span><i></i><b></b><em></em></span><span><i></i><b></b><em></em></span><span><i></i><b></b><em></em></span></div></div></div><div class="build-scanline"></div></div></div>
            <div class="build-floating-label build-float-one" aria-hidden="true">${icon('sparkle')}一个想法，正在成形</div><div class="build-floating-label build-float-two" aria-hidden="true">${icon('layers-2')}从结构，到细节</div>
          </div>
          <div class="build-art-note"><div><span data-build-chapter>01 — THE BEGINNING</span><p data-build-art-copy>好的作品，从一个想法开始。</p></div><small>动态示意 · 最终界面由你的想法决定</small></div>
        </section>
      </div>
      <footer class="build-session-footer"><span>MADE WITH INTENTION.</span><p>构建完成后，自动进入你的工作台。</p><span>${icon('circle-dot')}FORMA STUDIO</span></footer>
    </main>`;
  }

  async function mount(id){
    dispose();
    const root=document.querySelector('.build-session');if(!root)return;
    let job,poll,ticker,stopped=false,fetching=false,redirecting=false,paused=false,liveMessage='',lastEventSignature='';
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    // Enter from a fresh document after saving a version. This also refreshes
    // bootstrap state and avoids leaving a newly mounted workbench iframe blank.
    function enterWorkspace(){
      const url=new URL('index.html',location.href);url.hash='/workspace/'+encodeURIComponent(id);
      location.assign(url.href);
    }

    const motion=root.querySelector('[data-build-motion]');
    const select=selector=>root.querySelector(selector);
    const errorBox=select('.build-error');
    const cancel=select('[data-build-cancel]');
    const chapters=['01 — THE BEGINNING','02 — TAKING SHAPE','03 — IN THE DETAILS','04 — ALMOST YOURS'];
    const artCopy=['好的作品，从一个想法开始。','每一个细节，都在慢慢找到位置。','让好看的界面，也有好用的体验。','属于你的第一版，就要见面了。'];
    const formatElapsed=()=>{
      if(!job)return;
      const end=['completed','failed','cancelled'].includes(job.status)?job.updated:Date.now();
      const seconds=Math.max(0,Math.floor((end-job.created)/1000));
      select('[data-build-elapsed]').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
      if(seconds>=45&&job.status==='running'&&job.step===2&&job.mode!=='starter')select('[data-build-message]').textContent='仍在等待模型返回。你可以离开，稍后继续查看。';
      else select('[data-build-message]').textContent=liveMessage;
    };
    function setPaused(value){paused=value;root.classList.toggle('build-paused',paused);motion.setAttribute('aria-pressed',String(paused));motion.setAttribute('aria-label',paused?'播放画布动画':'暂停画布动画');motion.innerHTML=icon(paused?'play':'pause');refreshIcons();}
    setPaused(reduced.matches);
    motion.onclick=()=>setPaused(!paused);
    const aborter=new AbortController();
    function stop(){stopped=true;clearTimeout(poll);clearInterval(ticker);aborter.abort();document.removeEventListener('visibilitychange',visibility);}
    function visibility(){root.classList.toggle('build-background',document.hidden);if(!document.hidden&&!stopped){formatElapsed();if(!redirecting)run();}}
    document.addEventListener('visibilitychange',visibility);dispose=stop;
    window.addEventListener('pagehide',stop,{once:true,signal:aborter.signal});
    function render(detail){
      job=detail.job;
      projects=projects.map(project=>project.id===id?detail.project:project);
      const terminal=['failed','cancelled'].includes(job.status),complete=job.status==='completed';
      const phase=Math.max(0,Math.min(3,job.step-1));
      root.dataset.phase=phase;root.dataset.status=job.status;
      select('[data-build-status]').textContent=complete?'新版本已就绪':terminal?(job.status==='failed'?'生成遇到问题 · 进度已保留':'任务已中断 · 可稍后恢复'):job.status==='queued'?'任务已入队':'正在构建';
      select('[data-build-chapter]').textContent=chapters[phase];
      select('[data-build-art-copy]').textContent=terminal?'想法还在，可以随时重新出发。':complete?'准备好了，去体验你的作品。':artCopy[phase];
      root.querySelectorAll('[data-step]').forEach((element,index)=>{
        const done=complete||index<job.step-1,active=!terminal&&!complete&&job.status==='running'&&index===job.step-1;
        if(element.classList.contains('done')!==done)element.querySelector('.build-step-marker').innerHTML=done?icon('check'):String(index+1).padStart(2,'0');
        element.classList.toggle('done',done);element.classList.toggle('active',active);
        if(active)element.setAttribute('aria-current','step');else element.removeAttribute('aria-current');
        element.querySelector('small').textContent=done?'已完成':active?'进行中':terminal&&index===job.step-1?(job.status==='failed'?'未完成':'已中断'):'等待中';
      });
      const done=complete?4:Math.max(0,job.step-1);
      select('.build-progress>span').style.width=done*25+'%';select('.build-progress').setAttribute('aria-valuenow',done);
      select('[data-progress-label]').textContent=done+' / 4';
      liveMessage=terminal?(job.error||'任务已停止。'):job.events.at(-1)?.text||'等待构建资源，任务已保存在服务器。';
      const events=JSON.stringify(job.events);
      if(events!==lastEventSignature){lastEventSignature=events;select('[data-build-event-count]').textContent=job.events.length+' 条';select('[data-build-events]').innerHTML=job.events.map(event=>`<li><time>${new Date(event.created).toLocaleTimeString('zh-CN',{hour12:false})}</time><span>${escapeText(event.text)}</span></li>`).join('');}
      cancel.hidden=complete||terminal;
      errorBox.hidden=!terminal;
      select('[data-build-reconnect]').hidden=true;
      select('[data-build-resume]').hidden=!terminal||!job.canResume;
      if(terminal){errorBox.querySelector('p').textContent=job.error||'任务未完成，可以恢复生成。';select('[data-build-checkpoint]').textContent=!job.canResume?'源码已有新修改，请返回方案基于最新内容生成。':job.checkpoint==='requirements'?'需求与生成会话已保留，将继续原任务。':'已保留生成源码，将从校验阶段继续。';setPaused(true);clearInterval(ticker);}
      formatElapsed();refreshIcons();
      if(complete&&!redirecting){redirecting=true;root.classList.add('build-complete');projects=projects.map(project=>project.id===id?detail.project:project);clearInterval(ticker);poll=setTimeout(()=>{if(root.isConnected&&!stopped)enterWorkspace();},reduced.matches?0:850);}
      return terminal||complete;
    }
    async function run(){
      if(stopped||!root.isConnected||fetching||redirecting)return;
      clearTimeout(poll);fetching=true;
      try{
        const detail=await FormaAPI.request('/projects/'+encodeURIComponent(id));
        if(stopped||!root.isConnected)return;
        if(!detail.job){if(detail.project.currentVersion){enterWorkspace();return;}throw new Error('还没有构建任务，请返回方案页确认构建。');}
        if(!render(detail))poll=setTimeout(run,document.hidden?5000:1600);
      }catch(error){if(stopped||!root.isConnected)return;root.dataset.status='disconnected';errorBox.hidden=false;errorBox.querySelector('p').textContent='暂时无法获取进度：'+error.message;select('[data-build-reconnect]').hidden=false;select('[data-build-status]').textContent='进度连接中断';setPaused(true);}
      finally{fetching=false;}
    }
    select('[data-build-reconnect]').onclick=()=>{errorBox.hidden=true;setPaused(reduced.matches);run();};
    select('[data-build-resume]').onclick=async()=>{
      if(!job)return;const button=select('[data-build-resume]');button.disabled=true;
      try{
        if(job.requiresKey&&!await FormaModel.open())return;
        await FormaAPI.request('/jobs/'+encodeURIComponent(job.id)+'/resume','POST',{});
        errorBox.hidden=true;setPaused(reduced.matches);clearInterval(ticker);ticker=setInterval(()=>{if(!document.hidden)formatElapsed();},1000);await run();
      }catch(error){if(error.code==='MODEL_KEY_REQUIRED')await FormaModel.open();else toast(error.message);}finally{button.disabled=false;}
    };
    cancel.onclick=async()=>{if(!job||fetching)return;cancel.disabled=true;try{await FormaAPI.request('/jobs/'+encodeURIComponent(job.id)+'/cancel','POST',{});await run();}catch(error){toast(error.message);}finally{cancel.disabled=false;}};
    ticker=setInterval(()=>{if(!document.hidden)formatElapsed();},1000);
    await run();
  }
  window.FormaBuild={page,mount,dispose:()=>dispose()};
})();
