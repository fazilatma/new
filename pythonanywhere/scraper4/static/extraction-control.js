/* Authenticated extraction-only progress: no cron opt-in or destination sends. */
(() => {
  'use strict';
  const panel=document.querySelector('#extraction-control'); if(!panel) return;
  const status=document.querySelector('#extraction-status'), output=document.querySelector('#extraction-action-status');
  const button=document.querySelector('#extraction-step'); let pending=false, generation=0;const rowMessages=new Map();let activeRow='';
  const number=value=>Number(value||0).toLocaleString('fa-IR');
  const names={waiting:'در انتظار اجرا',running:'در حال اجرا',paused:'مکث‌شده',failed:'ناموفق',done:'پایان‌یافته',cancelled:'لغوشده'};
  function text(tag,value){const el=document.createElement(tag);el.textContent=String(value);return el;}
  async function read(path,post=false,body={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(path,{method:post?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal,
        ...(post?{headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf"]').content},body:JSON.stringify(body)}:{})});
      const data=await response.json();if(!response.ok)throw Error(response.status===401?'نشست پایان یافته است؛ دوباره وارد شوید.':data.error||'بررسی استخراج ناموفق بود.');return data;
    } catch(error) {
      if(error.name==='AbortError')throw Error(post?'مهلت پاسخ تمام شد؛ ممکن است اجرا سمت سرور ادامه داشته باشد. قبل از تلاش بعدی «بررسی وضعیت» را بزنید.':'مهلت دریافت وضعیت تمام شد؛ دوباره بررسی کنید.');
      throw error;
    } finally {clearTimeout(timer);}
  }
  async function refresh(){
    const ticket=++generation;
    try{
      const data=await read('/api/extraction/status');if(ticket!==generation)return;
      status.textContent=`در انتظار: ${number(data.counts.waiting)} · در حال اجرا: ${number(data.counts.running)} · ناموفق: ${number(data.counts.failed)} · GET عمومی کران: ${data.public_cron?'روشن':'خاموش'} · آخرین تماس کران: ${data.last_cron_at||'ثبت نشده'}\n${data.note}`;
      const rows=document.querySelector('#extraction-jobs');rows.replaceChildren();
      for(const job of data.jobs){
        const c=job.counters,row=document.createElement('tr');
        for(const value of [`#${job.id} · ${job.profile_name}`,names[job.status]||job.status,number(c.found),c.last_page_products===undefined?'—':number(c.last_page_products),c.error_hint||job.error||c.warning||'—'])row.append(text('td',value));
        if(c.last_http_status) row.lastElementChild.append(text('p',`HTTP ${c.last_http_status} · HTML: ${number(c.last_html_chars)} نویسه`));
        if(c.js_shell)row.lastElementChild.append(text('p','نشانهٔ صفحهٔ JavaScript دیده شده است؛ این تشخیص احتمالی است.'));
        row.dataset.extractId=String(job.id);const actions=row.lastElementChild;
        if(job.profile_key&&!['done','cancelled'].includes(job.status)){
          const b=text('button',job.status==='waiting'?'▶ مرحلهٔ بعد همین ردیف':'▶ ادامهٔ استخراج گیرکرده');b.type='button';b.dataset.extractResume=String(job.id);b.disabled=pending;b.onclick=()=>resume(job);actions.append(b);
        }
        if(rowMessages.has(String(job.id))){const note=text('p',rowMessages.get(String(job.id)));note.dataset.extractRowMessage=String(job.id);note.setAttribute('role','status');note.style.whiteSpace='pre-wrap';actions.append(note);}
        rows.append(row);
      }
      if(!data.jobs.length){const row=document.createElement('tr'),cell=text('td','هنوز استخراجی ثبت نشده است.');cell.colSpan=5;row.append(cell);rows.append(row);}
    }catch(error){if(ticket===generation)status.textContent=error.message;}
  }
  async function resume(job){if(pending||!confirm(`ادامهٔ استخراج #${job.id} از checkpoint ذخیره‌شده و اجرای فقط یک مرحله؟ کار تازه یا ارسال اجرا نمی‌شود.`))return;
    pending=true;activeRow=String(job.id);button.disabled=true;rowMessages.set(activeRow,'در حال ادامهٔ همین ردیف…');window.S4Refresh?.beginMutation();await refresh();
    try{const d=await read('/api/php-ui/write',true,{action:'python_extract_resume',query:{},fields:{profile:job.profile_key,id:String(job.id)}});rowMessages.set(activeRow,d.message);}
    catch(error){rowMessages.set(activeRow,error.message);}
    finally{pending=false;activeRow='';button.disabled=false;await refresh();window.dispatchEvent(new Event('s4:extraction-updated'));window.S4Refresh?.endMutation();}
  }
  document.querySelector('#extraction-refresh').onclick=refresh;
  button.onclick=async()=>{
    if(pending||!confirm('یک مرحله از قدیمی‌ترین استخراجِ در انتظار اجرا و محصولات آن ذخیره شود؟ هیچ ارسال به مقصدی انجام نمی‌شود.'))return;
    pending=true;button.disabled=true;output.textContent='در حال اجرای یک مرحله؛ این صفحه را تا دریافت نتیجه باز نگه دارید…';window.S4Refresh?.beginMutation();
    try{const data=await read('/api/extraction/step',true);output.textContent=data.message;}
    catch(error){output.textContent=error.message;}
    finally{await refresh();window.dispatchEvent(new Event('s4:extraction-updated'));pending=false;button.disabled=false;window.S4Refresh?.endMutation();}
  };
  window.addEventListener('s4:extraction-enqueued',refresh);
  setInterval(()=>{if(!document.hidden&&(document.querySelector('#pane-start')?.classList.contains('active')||document.querySelector('#settings-menu')?.open))refresh();},15000);
  refresh();
})();
