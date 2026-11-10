/* Same trusted controller in both UIs. No automatic reads, probes or writes. */
(()=>{'use strict';
const root=document.getElementById('shared-php-workspace');if(!root)return;
const $=id=>document.getElementById('shared-php-'+id),select=$('profile'),out=$('status'),preview=$('preview'),download=$('download'),pipeline=$('pipeline');
let ticket=0,busy=false,blob='',lastProbe=null,stopping=false,groupRunning=false;
const states={waiting:'در انتظار',running:'در حال اجرا',paused:'مکث',failed:'ناموفق',cancelled:'لغوشده',done:'پایان‌یافته',incomplete:'زنجیرهٔ ناقص',completed_with_errors:'پایان با خطای محصول'};
function revoke(){if(blob)URL.revokeObjectURL(blob);blob='';download.hidden=true;download.removeAttribute('href');}
function clear(){ticket++;lastProbe=null;revoke();preview.value='';pipeline.replaceChildren();out.textContent='انتخاب تغییر کرد؛ گزارش قبلی پاک شد. هیچ کاری اجرا نشده است.';}
select.onchange=clear;window.addEventListener('pagehide',revoke);
window.addEventListener('s4:profile-selected',e=>{if(groupRunning)return;const id=String(e.detail?.id||'');if(select.value!==id){clear();select.value=Array.from(select.options).some(o=>o.value===id)?id:'';}});
async function api(path,data){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify(data)})});let d;try{d=await r.json();}catch{throw Error('پاسخ سرور JSON معتبر نیست؛ وضعیت سرور را بررسی کنید.');}if(!r.ok||d.ok===false)throw Error(r.status===401?'نشست پایان یافته است؛ دوباره وارد شوید.':d.error||'خطای درخواست');return d;}
function show(d,id,kind){revoke();preview.value=JSON.stringify(d,null,2)+'\n';blob=URL.createObjectURL(new Blob([preview.value],{type:'application/json'}));download.href=blob;download.download='scraper4-'+kind+'-'+(id||'all')+'.json';download.hidden=false;pipeline.replaceChildren();
 if(d.runtime){const info=document.createElement('p');info.textContent='worker مشاهده‌شده: '+(d.runtime.worker_observed_running?'بله':'خیر')+' · سن آخرین کران: '+(d.runtime.cron_last_age_seconds??'نامشخص')+' ثانیه · '+d.runtime.note;pipeline.append(info);}
 for(const p of d.profiles||[]){const card=document.createElement('details'),summary=document.createElement('summary');summary.textContent='#'+p.id+' · '+p.name+' · '+(p.needs_review?'نیازمند بررسی':'بررسی محلی؛ نه تأیید زنده');card.append(summary);for(const c of p.checks||[]){const line=document.createElement('p');line.textContent=c.stage+' · '+c.status+' · '+c.message+' · '+JSON.stringify(c.counts||{});card.append(line);}if(p.live_probe){const line=document.createElement('p');line.textContent='آزمایش زنده: '+p.live_probe.status+' · '+(p.live_probe.count||0)+' محصول';card.append(line);}pipeline.append(card);}
 for(const run of d.pipeline?.rows||[]){const card=document.createElement('details'),summary=document.createElement('summary');summary.textContent='#'+run.id+' · '+(states[run.status]||run.status)+' · '+run.message;card.append(summary);for(const e of run.entries){const p=document.createElement('p');p.textContent='#'+e.id+' · '+e.kind+' · '+(states[e.status]||e.status)+' · '+JSON.stringify(e.counts);card.append(p);}pipeline.append(card);}}
async function run(kind){if(busy)return;const id=select.value;if(kind!=='contracts'&&!id){out.textContent='ابتدا پروفایل را انتخاب کنید.';return;}
 if(kind==='probe'&&!confirm('فقط یک صفحه از مبدأ پروفایل انتخاب‌شده با موتور ذخیره‌شده از میزبان خوانده و گزارش آزمایش ذخیره شود؟ محصولات، صف و مقصد تغییر نمی‌کنند.'))return;
 const seq=++ticket;busy=true;revoke();preview.value='';pipeline.replaceChildren();out.textContent=kind==='probe'?'آزمایش زندهٔ مبدأ…':'خواندن اطلاعات واقعی…';
 const buttons=Array.from(root.querySelectorAll('button:not(#shared-php-stop-all)'));buttons.forEach(b=>b.disabled=true);select.disabled=true;
 try{if(kind==='contracts'){const d=await api('/api/php-ui/endpoint-inventory');if(seq!==ticket)return;show(d,'','contracts');out.textContent=d.inventory.unique_keys+' کلید ثابت منبع (نه تعداد endpoint) · '+d.connected.read_actions.length+' قرارداد خواندن و '+d.connected.write_actions.length+' قرارداد نوشتن متصل؛ انتقال کامل نیست.';return;}
 if(kind==='probe'){const d=await api('/api/extraction/probe',{profile_id:Number(id)});if(seq!==ticket)return;const r=d.report;
 // Never export continuation signatures, samples, raw URLs or engine error text.
 lastProbe={};for(const k of ['profile_id','name','engine','used_engine','tested_at','status','page','count','priced','linked','imaged','elapsed_ms','http_status','products_changed','queue_changed'])if(['string','number','boolean'].includes(typeof r[k]))lastProbe[k]=r[k];}
 const d=await api('/api/php-ui/diagnostic-export?profile_id='+encodeURIComponent(id));if(seq!==ticket||id!==select.value)return;
 if(lastProbe)d.live_probe=lastProbe;show(d,id,'diagnostic');out.textContent=lastProbe?'آخرین آزمایش صریح: '+({passed:'دارای محصول',empty:'صفر محصول؛ موفقیت نیست',failed:'دریافت/پردازش ناموفق'}[lastProbe.status]||lastProbe.status)+' · '+(lastProbe.count||0)+' محصول · گزارش صف فقط snapshot است.':'گزارش محلی خوانده شد؛ دسترسی مبدأ آزمایش نشده است. فایل را قبل از ارسال بازبینی کنید.';
 }catch(e){if(seq===ticket)out.textContent=e.message;}finally{busy=false;select.disabled=false;buttons.forEach(b=>b.disabled=false);}}
for(const [id,kind]of [['report','report'],['probe','probe'],['contracts','contracts']])$(id).onclick=()=>run(kind);
function safeProbe(r){const d={};for(const k of ['profile_id','name','engine','used_engine','tested_at','status','page','count','priced','linked','imaged','elapsed_ms','http_status','products_changed','queue_changed'])if(['string','number','boolean'].includes(typeof r[k]))d[k]=r[k];return d;}
$('stop-all').onclick=()=>{stopping=true;$('stop-all').disabled=true;out.textContent='درخواست جاری پایان می‌یابد؛ پروفایل دیگری آزمایش نمی‌شود.';};
async function auditAll(live=false){if(busy)return;if(live&&!confirm('برای همهٔ پروفایل‌ها، حتی غیرفعال‌ها، فقط یک صفحه با موتور ذخیره‌شده به‌ترتیب از مبدأ خوانده شود؟ هر درخواست گزارش ذخیره می‌کند؛ هیچ محصول/صف/قیمت/شناسهٔ مقصد تغییر نمی‌کند و هیچ ارسالی اجرا نمی‌شود. منابع GitHub در این آزمون شبکهٔ HTML آزمایش نمی‌شوند.'))return;
 busy=true;groupRunning=true;stopping=false;const seq=++ticket,buttons=Array.from(root.querySelectorAll('button:not(#shared-php-stop-all)'));buttons.forEach(b=>b.disabled=true);select.disabled=true;$('stop-all').disabled=false;
 revoke();preview.value='';pipeline.replaceChildren();const report={ok:true,format:'scraper4-all-profile-audit-v1',profiles:[],complete:false,local_audit_complete:false,live_requested:live,live_probe_count:0,source_reachability_tested:false,destination_reachability_tested:false,processed:false,point_in_time_snapshot:false,started_at:new Date().toISOString()};let after=0,through=null;
 try{do{out.textContent='بررسی مرحله‌ای همهٔ پروفایل‌ها: '+report.profiles.length+' مورد…';const d=await api('/api/php-ui/read',{action:'python_sync_audit',query:{},fields:{after_id:String(after),...(through===null?{}:{through_id:String(through)})}});if(seq!==ticket)return;
 if(through===null){through=d.through_id;report.through_id=through;report.total_profiles=d.total_profiles;report.runtime=d.runtime;report.version=d.version;report.note=d.note;}
 report.profiles.push(...d.profiles);show(report,'all','synchronization');const next=d.next_after_id;
 if(next===null){report.local_audit_complete=true;break;}if(!Number.isSafeInteger(next)||next<=after||next>through)throw Error('ادامهٔ صفحه‌بندی معتبر نیست؛ گزارش ناقص است.');after=next;
 }while(!stopping);
 if(live&&report.local_audit_complete&&!stopping){for(const p of report.profiles){if(stopping)break;out.textContent='آزمایش زندهٔ ترتیبی: '+(report.live_probe_count+1)+' از '+report.profiles.length+' · '+p.name;
 if(p.source==='github'||!p.engine){p.live_probe={status:'skipped',reason:'not_a_direct_source_or_invalid_configuration'};continue;}
 try{const d=await api('/api/extraction/probe',{profile_id:p.id});p.live_probe=safeProbe(d.report);report.live_probe_count++;}
 catch(e){p.live_probe={status:'request_failed',reason:'http_or_session_failure'};throw e;}
 if(seq!==ticket)return;show(report,'all','synchronization');}}
 report.complete=report.local_audit_complete&&!stopping;report.stopped=stopping;
 }catch(e){report.error='audit_request_failed';out.textContent='بررسی متوقف شد: '+e.message+' · فایل ناقص است.';}
 finally{if(seq===ticket){report.finished_at=new Date().toISOString();report.source_reachability_tested=report.live_probe_count>0;show(report,'all','synchronization');if(!report.error)out.textContent=(report.complete?'پایان بررسی':'گزارش ناقص / متوقف‌شده')+' · '+report.profiles.length+' پروفایل · '+report.live_probe_count+' آزمایش مبدأ؛ هیچ ارسال یا بازسازی صفی انجام نشد.';}busy=false;groupRunning=false;select.disabled=false;buttons.forEach(b=>b.disabled=false);$('stop-all').disabled=true;}}
$('audit-all').onclick=()=>auditAll(false);$('probe-all').onclick=()=>auditAll(true);
download.onclick=e=>{if(!confirm('این فایل شامل نام پروفایل و نتیجهٔ آزمایش/صف است. پس از بازبینی دانلود شود؟'))e.preventDefault();};
})();
