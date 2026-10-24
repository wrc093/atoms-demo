/* Poll durable job state instead of advancing a cosmetic progress timer. */
window.FormaBuild={
  async mount(id){
    const page=document.querySelector('.build-page');if(!page)return;
    let job;
    async function run(){
      if(!page.isConnected)return;
      try{
        const detail=await FormaAPI.request('/projects/'+id);
        job=detail.job;
        if(!job){if(detail.project.currentVersion){navigate('/workspace/'+id);return;}throw new Error('还没有构建任务，请返回方案页确认构建。');}
        if(!page.isConnected)return;
        const steps=page.querySelectorAll('[data-step]');
        steps.forEach((el,i)=>{const done=job.status==='completed'||i<job.step-1;el.classList.toggle('done',done);el.classList.toggle('active',!done&&i===job.step-1&&['queued','running'].includes(job.status));el.querySelector('span').innerHTML=done?icon('check'):i+1;el.querySelector('small').textContent=done?'已完成':i===job.step-1?'进行中':'等待中';});
        const progress=job.status==='completed'?100:Math.min(93,job.step*23);
        page.querySelector('.build-progress>span').style.width=progress+'%';page.querySelector('.build-progress').setAttribute('aria-valuenow',progress);page.querySelector('[data-progress-label]').textContent=job.status==='completed'?'4 / 4':Math.max(0,job.step-1)+' / 4';
        page.querySelector('.build-caption>span').textContent=job.events.at(-1)?.text||'任务排队中';
        const error=page.querySelector('.build-error');
        if(['failed','cancelled'].includes(job.status)){error.hidden=false;error.querySelector('p').textContent=job.error||'任务未完成';page.querySelector('h1').textContent=job.status==='cancelled'?'构建已取消。':'这次构建没有完成。';page.querySelector('[data-build-cancel]').hidden=true;refreshIcons();return;}
        if(job.status==='completed'){projects=projects.map(p=>p.id===id?detail.project:p);navigate('/workspace/'+id);return;}
        refreshIcons();buildTimer=setTimeout(run,900);
      }catch(error){if(!page.isConnected)return;const area=page.querySelector('.build-error');area.hidden=false;area.querySelector('p').textContent=error.message;}
    }
    page.querySelector('[data-build-cancel]').onclick=async event=>{if(!job)return;event.currentTarget.disabled=true;try{await FormaAPI.request('/jobs/'+job.id+'/cancel','POST',{});await run();}catch(error){toast(error.message);event.currentTarget.disabled=false;}};
    await run();
  }
};
