/* Same trusted controller in both UIs. No automatic reads, probes or writes. */
(()=>{'use strict';
const root=document.getElementById('shared-php-workspace');if(!root)return;
const $=id=>document.getElementById('shared-php-'+id),select=$('profile'),out=$('status'),preview=$('preview'),download=$('download'),pipeline=$('pipeline');
let ticket=0,busy=false,blob='',lastProbe=null;
const states={waiting:'در انتظار',running:'در حال اجرا',paused:'مکث',failed:'ناموفق',cancelled:'لغوشده',done:'پایان‌یافته',incomplete:'زنجیرهٔ ناقص',completed_with_errors:'پایان با خطای محصول'};
function revoke(){if(blob)URL.revokeObjectURL(blob);blob='';download.hidden=true;download.removeAttribute('href');}
function clear(){ticket++;lastProbe=null;revoke();preview.value='';pipeline.replaceChildren();out.textContent='انتخاب تغییر کرد؛ گزارش قبلی پاک شد. هیچ کاری اجرا نشده است.';}
select.onchange=clear;window.addEventListener('pagehide',revoke);
window.addEventListener('s4:profile-selected',e=>{const id=String(e.detail?.id||'');if(select.value!==id){clear();select.value=Array.from(select.options).some(o=>o.value===id)?id:'';}});
async function api(path,data){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify(data)})});let d;try{d=await r.json();}catch{throw Error('پاسخ سرور JSON معتبر نیست؛ وضعیت سرور را بررسی کنید.');}if(!r.ok||d.ok===false)throw Error(r.status===401?'نشست پایان یافته است؛ دوباره وارد شوید.':d.error||'خطای درخواست');return d;}
function show(d,id,kind){revoke();preview.value=JSON.stringify(d,null,2)+'\n';blob=URL.createObjectURL(new Blob([preview.value],{type:'application/json'}));download.href=blob;download.download='scraper4-'+kind+'-'+(id||'all')+'.json';download.hidden=false;pipeline.replaceChildren();
 for(const run of d.pipeline?.rows||[]){const card=document.createElement('details'),summary=document.createElement('summary');summary.textContent='#'+run.id+' · '+(states[run.status]||run.status)+' · '+run.message;card.append(summary);for(const e of run.entries){const p=document.createElement('p');p.textContent='#'+e.id+' · '+e.kind+' · '+(states[e.status]||e.status)+' · '+JSON.stringify(e.counts);card.append(p);}pipeline.append(card);}}
async function run(kind){if(busy)return;const id=select.value;if(kind!=='contracts'&&!id){out.textContent='ابتدا پروفایل را انتخاب کنید.';return;}
 if(kind==='probe'&&!confirm('فقط یک صفحه از مبدأ پروفایل انتخاب‌شده با موتور ذخیره‌شده از میزبان خوانده و گزارش آزمایش ذخیره شود؟ محصولات، صف و مقصد تغییر نمی‌کنند.'))return;
 const seq=++ticket;busy=true;revoke();preview.value='';pipeline.replaceChildren();out.textContent=kind==='probe'?'آزمایش زندهٔ مبدأ…':'خواندن اطلاعات واقعی…';
 const buttons=Array.from(root.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);select.disabled=true;
 try{if(kind==='contracts'){const d=await api('/api/php-ui/endpoint-inventory');if(seq!==ticket)return;show(d,'','contracts');out.textContent=d.inventory.unique_keys+' کلید ثابت منبع (نه تعداد endpoint) · '+d.connected.read_actions.length+' قرارداد خواندن و '+d.connected.write_actions.length+' قرارداد نوشتن متصل؛ انتقال کامل نیست.';return;}
 if(kind==='probe'){const d=await api('/api/extraction/probe',{profile_id:Number(id)});if(seq!==ticket)return;const r=d.report;
 // Never export continuation signatures, samples, raw URLs or engine error text.
 lastProbe={};for(const k of ['profile_id','name','engine','used_engine','tested_at','status','page','count','priced','linked','imaged','elapsed_ms','http_status','products_changed','queue_changed'])if(['string','number','boolean'].includes(typeof r[k]))lastProbe[k]=r[k];}
 const d=await api('/api/php-ui/diagnostic-export?profile_id='+encodeURIComponent(id));if(seq!==ticket||id!==select.value)return;
 if(lastProbe)d.live_probe=lastProbe;show(d,id,'diagnostic');out.textContent=lastProbe?'آخرین آزمایش صریح: '+({passed:'دارای محصول',empty:'صفر محصول؛ موفقیت نیست',failed:'دریافت/پردازش ناموفق'}[lastProbe.status]||lastProbe.status)+' · '+(lastProbe.count||0)+' محصول · گزارش صف فقط snapshot است.':'گزارش محلی خوانده شد؛ دسترسی مبدأ آزمایش نشده است. فایل را قبل از ارسال بازبینی کنید.';
 }catch(e){if(seq===ticket)out.textContent=e.message;}finally{busy=false;select.disabled=false;buttons.forEach(b=>b.disabled=false);}}
for(const [id,kind]of [['report','report'],['probe','probe'],['contracts','contracts']])$(id).onclick=()=>run(kind);
download.onclick=e=>{if(!confirm('این فایل شامل نام پروفایل و نتیجهٔ آزمایش/صف است. پس از بازبینی دانلود شود؟'))e.preventDefault();};
})();
