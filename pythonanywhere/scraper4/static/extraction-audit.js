(() => {
  'use strict';const form=document.querySelector('#extraction-audit-form');if(!form)return;
  const message=document.querySelector('#audit-message'),stop=document.querySelector('#audit-stop'),table=document.querySelector('#audit-results');let busy=false,stopping=false;
  async function api(url,data){const response=await fetch(url,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;}
  function show(report){const row=document.createElement('tr');row.className='audit-'+report.status;
    for(const value of [report.name,report.engine+(report.used_engine?' / '+report.used_engine:''),({passed:'دارای محصول',empty:'صفر محصول',failed:'خطا'})[report.status]||report.status,
      `صفحهٔ ${report.page||1} · ${report.count||0} محصول · قیمت ${report.priced||0} · لینک ${report.linked||0} · عکس ${report.imaged||0}`,`${report.elapsed_ms??'—'} ms · ${report.hint||''}`]){const td=document.createElement('td');td.textContent=value;row.append(td);}
    table.prepend(row);if(table.children.length>200)table.lastChild.remove();
  }
  stop.onclick=()=>{stopping=true;stop.disabled=true;message.textContent='درخواست جاری فرصت پایان دارد؛ تست جدیدی شروع نمی‌شود.';};
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!confirm(`تا ${form.elements.pages.value} صفحهٔ اول پروفایل‌ها خوانده و گزارش ذخیره شود؟ تست ۹ موتور ممکن است طولانی و مصرف‌کنندهٔ سهمیه باشد؛ محصول یا صف تغییر نمی‌کند و هیچ ارسالی انجام نمی‌شود.`))return;
    busy=true;stopping=false;stop.disabled=false;form.querySelector('[type=submit]').disabled=true;window.S4Refresh?.beginMutation();
    const choice=form.elements.profile_id.value,mode=form.elements.engine.value,pages=Number(form.elements.pages.value);const counts={done:0,passed:0,empty:0,failed:0};table.replaceChildren();for(const key of Object.keys(counts))document.querySelector('#audit-'+key).textContent=0;
    const progress=document.querySelector('#audit-progress');progress.value=0;
    try{const [{profiles},cap]=await Promise.all([api('/api/profiles'),api('/api/extraction/engines')]);
      const selected=profiles.filter(p=>choice==='all'||String(p.id)===choice);const tasks=selected.flatMap(p=>(mode==='all'?cap.engines.map(e=>e.id):[mode==='configured'?(p.extraction_engine||p.settings?.extractionEngine||p.settings?.legacy_profile_settings?.extractionEngine||'selectors'):mode]).map(engine=>({p,engine})));
      progress.max=Math.max(1,tasks.length);
      const readPages=[];for(const {p,engine} of tasks){if(stopping)break;message.textContent=`تست ${counts.done+1} از ${tasks.length}: ${p.name||p.key} · ${engine}`;
        let continuation;const taskReports=[];for(let page=1;page<=pages;page++){
          if(stopping)break;let report;try{({report}=await api('/api/extraction/probe',{profile_id:p.id,engine,...(continuation?{continuation}:{})}));}catch(error){report={name:p.name||p.key,engine,status:'failed',count:0,hint:error.message};}
          show(report);readPages.push(report);taskReports.push(report);continuation=report.next;
          if(!continuation||report.status!=='passed')break;
        }
        counts.done++;const reports=taskReports;const state=reports.some(r=>r.status==='failed')?'failed':reports.some(r=>r.status==='passed')?'passed':'empty';counts[state]++;
        for(const key of Object.keys(counts))document.querySelector('#audit-'+key).textContent=counts[key];progress.value=counts.done;
      }
      message.textContent=`${stopping?'متوقف شد':'پایان تست'}: ${counts.done} از ${tasks.length} · ${counts.passed} دارای محصول، ${counts.empty} خالی، ${counts.failed} خطا. تعداد درخواست صفحه ${readPages.length}؛ حداکثر ${pages} صفحه از هر پروفایل/موتور. صف و محصولات تغییر نکردند.`;
    }catch(error){message.textContent=error.message;}finally{busy=false;stop.disabled=true;form.querySelector('[type=submit]').disabled=false;window.S4Refresh?.endMutation();}
  });
})();
