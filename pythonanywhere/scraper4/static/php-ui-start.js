/* Original Start commands. Explicit actions only; polling can never run work. */
(()=>{'use strict';
const pane=document.getElementById('pane-start');if(!pane)return;
const box=document.createElement('section');box.className='card';box.id='python-start-control';
const title=document.createElement('h2');title.textContent='اجرای واقعی و عیب‌یابی استخراج';title.style.fontSize='15px';
const note=document.createElement('p');note.textContent='شروع، پس از تأیید ذخیرهٔ تنظیمات، یک مرحلهٔ واقعی از همین استخراج را اجرا می‌کند. برای صفحات/جزئیات بعدی worker/کران یا «مرحلهٔ بعد» لازم است. بستن صفحه کار ذخیره‌شده را حذف نمی‌کند؛ این دکمه‌ها هیچ صف ارسالی را اجرا نمی‌کنند.';
const message=document.createElement('p');message.id='python-start-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
const rows=document.createElement('div');rows.id='python-start-jobs';rows.style.cssText='display:grid;gap:8px;overflow-wrap:anywhere';
box.append(title,note,rows);document.getElementById('directExtractRunCard').after(box);
// An early save/queue error must be visible beside the clicked Start button,
// not below all of the original run cards and off the current screen.
document.getElementById('startBackendBtn').closest('.row').after(message);
const showJobs=document.createElement('button');showJobs.type='button';showJobs.id='python-start-show-jobs';showJobs.className='btn btn-cyan';showJobs.textContent='نمایش کارها و عیب‌یابی همین پروفایل';message.after(showJobs);
showJobs.onclick=async()=>{await refresh();box.scrollIntoView?.({block:'start',behavior:'smooth'});};
let pending=false,statusTicket=0,catalogEnabled=false;
const originalLoad=window.loadProfileFromServer;
window.loadProfileFromServer=(key,silent,...rest)=>{if(silent&&isDirty)return;catalogEnabled=false;return originalLoad(key,silent,...rest);};
// User edits invalidate already-in-flight hydration; a delayed read must not
// overwrite a draft. If hydration was incomplete, an explicit reselect is needed.
pane.addEventListener('input',()=>{profileLoadSeq++;});
const names={waiting:'در انتظار مرحلهٔ بعد',running:'در حال اجرا',paused:'مکث‌شده',failed:'ناموفق؛ ابتدا علت را بررسی کنید',done:'پایان‌یافته',cancelled:'لغوشده'};
const say=(text,bad=false)=>{message.textContent=String(text);message.style.color=bad?'#fca5a5':'#a5f3fc';};
async function call(action,fields={}){const fd=new FormData();fd.set('action',action);for(const[k,v]of Object.entries(fields))fd.set(k,String(v));const d=await(await fetch('',{method:'POST',body:fd})).json();if(!d.ok)throw Error(d.error||'عملیات انجام نشد.');return d;}
function saved(){if(!currentProfileKey||!profileFormReady)throw Error('ابتدا پروفایل را انتخاب کنید و منتظر تکمیل بارگذاری فرم بمانید.');return currentProfileKey;}
async function exclusive(work){if(pending)return;say('در حال بررسی/اجرا؛ لطفاً تا دریافت نتیجه صبر کنید…');pending=true;
 const buttons=[...pane.querySelectorAll('#startBtn,#startBackendBtn,#startManualBtn,#startVisBtn,#ghImportBtn,#python-start-jobs button,[onclick="saveProfile()"]')],disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
 try{return await work();}catch(e){say(e.message,true);showToast(e.message,true);message.scrollIntoView?.({block:'center'});}finally{pending=false;buttons.forEach((b,i)=>b.disabled=disabled[i]);await refresh();}}
function snapshot(){return collectProfileData(false);}
async function save(){
 if(currentProfileKey&&!profileFormReady)throw Error('فرم هنوز بارگذاری نشده است؛ برای جلوگیری از ذخیرهٔ سلکتور قدیمی دوباره پروفایل را انتخاب کنید.');
 clearTimeout(saveTimer);const data=snapshot(),seq=profileLoadSeq,key=currentProfileKey,signature=JSON.stringify(data);
 if(!data.url)throw Error('آدرس مبدأ را وارد کنید.');data.name=data.name||parseUrlHost(data.url);
 const fields={};for(const[k,v]of Object.entries(data))fields[k]=v&&typeof v==='object'?JSON.stringify(v):typeof v==='boolean'?(v?'1':'0'):String(v??'');
 if(key)fields.target_key=key;
 const d=await call('save_profile',fields);
 if(seq!==profileLoadSeq||key!==currentProfileKey||signature!==JSON.stringify(snapshot()))throw Error('تنظیمات قبلی ذخیره شد، ولی فرم در حین ذخیره عوض شد؛ برای جلوگیری از اجرای پروفایل اشتباه دوباره بررسی کنید.');
 markClean(d.key);currentProfileUrl=data.url;currentProfileUpdatedAt=d.updated_at;profileFormReady=true;document.getElementById('profileName').value=data.name;
 const entry={key:d.key,name:d.name||data.name,url:data.url,updatedAt:d.updated_at,productCount:d.product_count};const index=profiles.findIndex(p=>p.key===d.key);if(index<0)profiles.unshift(entry);else profiles[index]=entry;
 renderProfileDropdown();setProfileSelectValue(d.key);rememberProfile(data.url,d.key);scheduleStartBreakdownRefresh();
 // Read hydrates the trusted parent's selected profile, including a new save.
 await(await fetch('?load_profile='+encodeURIComponent(d.key))).json();say('تنظیمات ذخیره شد؛ محصولات و شناسه‌های مقصد تغییر نکردند.');return d;
}
async function prepare(){if(!currentProfileKey||isDirty)await save();return saved();}
function showStep(d){say((d.job?(d.reused?'ادامهٔ کار در انتظار #':'کار #')+d.id+' · '+(names[d.job.status]||d.job.status)+' · ':'')+(d.message||'')+(d.throttled?' · '+d.retry_after_seconds+' ثانیه تا اجرای دستی بعدی':''));}
async function begin(){const profile=await prepare(),d=await call('python_extract_start',{profile,pages:document.getElementById('pages').value});showStep(d);if(currentProfileKey===profile&&!isDirty)loadProfileFromServer(profile,true);refreshExtractQueue();return d;}
window.saveProfile=()=>exclusive(save);
window.startAutoExtract=window.startBackendSync=window.backendExtractFor=()=>exclusive(begin);
window.startManualSync=()=>exclusive(async()=>{
 const profile=await prepare(),target=document.getElementById('profileSyncTarget').value,noExtract=document.getElementById('profileSyncNoExtract').checked,fields={profile,target};
 if(target==='woo'||target==='both')fields.status=document.getElementById('wcSt').value;
 if(target==='bsl'||target==='both'){const selected=bslGetSelectedVids();fields.vendor_ids=JSON.stringify((selected===null?bslAllShopEntries().map(s=>String(s.vid)):selected).map(String));}
 if(!noExtract)fields.pages=document.getElementById('pages').value;
 const d=await call(noExtract?'python_send_enqueue':'python_manual_sync',fields);
 if(noExtract)say('صف ارسال ثبت شد؛ اجرای HTTP مقصد فقط با worker/کران است و این دکمه صف ارسال را اجرا نمی‌کند.');
 else {showStep(await call('python_extract_step',{profile,id:d.ids[0]}));if(currentProfileKey===profile&&!isDirty)loadProfileFromServer(profile,true);}
 refreshExtractQueue();return d;
});
window.ghImportProducts=()=>exclusive(async()=>{if(document.getElementById('profileProductSource').value!=='github')throw Error('ابتدا روش دریافت GitHub و فایل عمومی CSV/XLSX را انتخاب کنید.');return begin();});
async function test(key){await prepare();return pythonOpenPanel(key);}
window.openStartProductOverviewDetail=metric=>pythonOpenPanel('metric:'+metric);
const breakdown=window.renderStartProfileBreakdown;
window.renderStartProfileBreakdown=d=>{breakdown(d);if(!d.remote_inventory){document.querySelector('#startProfileBreakdownBody .spb-misc-row')?.remove();document.getElementById('startProfileBreakdownMeta').textContent='تعداد محصولات و پوشش جزئیات، دادهٔ ذخیره‌شدهٔ محلی است؛ موجودی/مغایرت زندهٔ مقصد و محصولات متفرقهٔ فروشگاه هنوز متصل نیست.';}};
window.openStartMiscProducts=()=>{say('خواندن/ویرایش محصولات متفرقهٔ مقصد هنوز متصل نیست؛ شمارش محلی جای موجودی زندهٔ فروشگاه نیست.',true);return pythonOpenPanel('help');};
window.start=()=>exclusive(()=>test('trial'));
window.pagProbe=()=>exclusive(()=>test('audit-pages'));
window.comprehensiveTestStart=()=>exclusive(()=>pythonOpenPanel('audit-all'));
window.startVisual=()=>exclusive(begin);
const oldVisualMode=window.setMode;window.setMode=mode=>{oldVisualMode(mode);if(mode==='visual')say('انتخابگر بصری با iframe مبدأ هنوز متصل نیست؛ سلکتور را در تب سلکتورها وارد و آزمایش کنید. «شروع» از موتور و تنظیمات ذخیره‌شده استفاده می‌کند.');};
window.reset=()=>{if(pending)return;if(isDirty&&!confirm('پیش‌نویس ذخیره‌نشده کنار گذاشته شود؟ محصولات و کارهای سرور حذف یا متوقف نمی‌شوند.'))return;newBlankProfile();say('فرم تازه آماده است؛ کارها و محصولات ذخیره‌شده تغییر نکردند.');rows.replaceChildren();};
window.srLoad=()=>exclusive(async()=>{await refresh();say('گزارش واقعی همین پروفایل (تا ۱۰۰ کار؛ کارهای فعال/ناموفق در اولویت‌اند). «آزمایش مبدأ» فقط با انتخاب شما شبکه را بررسی می‌کند.');});
window.syncDiagnose=()=>exclusive(async()=>{const d=await call('sync_diagnose',{profile:saved()});say(d.checks.map(c=>c.msg).concat(d.profiles.map(p=>p.name+': '+p.msg+' · '+p.active_extracts+' کار فعال/ناموفق')).join('\n'));});
const exportButton=document.createElement('button');exportButton.type='button';exportButton.id='python-start-diagnostic-export';exportButton.className='btn btn-cyan';exportButton.textContent='گزارش امن برای بررسی / دانلود';exportButton.onclick=()=>pythonOpenPanel('diagnostics');showJobs.after(exportButton);
window.syncPipelineClearDone=()=>exclusive(async()=>{const d=await call('python_queue_clear',{kind:'extract'});say(d.removed+' ردِ استخراج تمام‌شده/لغوشده پاک شد؛ ناموفق‌ها و کارهای فعال حفظ شدند.');refreshExtractQueue();});
window.stopManualSync=()=>exclusive(async()=>{await call('python_queue_control',{profile:saved(),kind:'extract',control:'pause'});say('استخراج همین پروفایل مکث شد؛ صف‌های ارسال مستقل تغییر نکردند و درخواست درحال پرواز ممکن است تمام شود.');});
// Do not leave old UI implying this extraction-only control stops a sender.
const manualStop=document.getElementById('manualSyncStopBtn');if(manualStop){manualStop.textContent='⏹ مکث استخراج';manualStop.classList.remove('hidden');}
const stop=document.getElementById('stopBtn');if(stop)stop.classList.remove('hidden');
const button=(text,work)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-cyan';b.textContent=text;b.onclick=()=>exclusive(work);return b;};
async function refresh(){const ticket=++statusTicket,profile=currentProfileKey;if(!profile){rows.replaceChildren();return;}
 try{const d=await call('python_start_status',{profile});if(ticket!==statusTicket||profile!==currentProfileKey)return;rows.replaceChildren();
 for(const j of d.jobs){const row=document.createElement('article');row.style.cssText='border:1px solid #475569;border-radius:8px;padding:10px';const text=document.createElement('p');text.textContent=`#${j.id} · ${names[j.status]||j.status} · مرحله ${j.counts.current||0} · محصول ${j.counts.found||0}`+(j.counts.last_http_status?' · HTTP '+j.counts.last_http_status:'')+(j.empty?' · صفر محصول؛ سلکتور/موتور/آدرس را بررسی کنید.':'')+(j.hint?' · '+j.hint:'');row.append(text);
 const same=()=>{if(profile!==saved()||isDirty)throw Error('پروفایل/تنظیمات عوض شده است؛ ابتدا ذخیره و گزارش را تازه کنید.');};
 if(j.status==='waiting')row.append(button('▶ مرحلهٔ بعد',async()=>{same();showStep(await call('python_extract_step',{profile,id:j.id}));if(currentProfileKey===profile&&!isDirty)loadProfileFromServer(profile,true);}));
 if(j.status==='paused'||j.status==='failed')row.append(button('ادامه پس از بررسی',async()=>{same();await call('python_queue_control',{profile,id:j.id,control:'resume'});say('ادامه تأیید شد؛ برای اجرای واقعی «مرحلهٔ بعد» را بزنید.');}));
 if(j.status==='running'||j.status==='waiting')row.append(button('مکث',async()=>{same();await call('python_queue_control',{profile,id:j.id,control:'pause'});say('مکث ثبت شد؛ درخواست درحال پرواز ممکن است تمام شود.');}));
 if(!['done','cancelled'].includes(j.status))row.append(button('لغو',async()=>{same();await call('python_queue_control',{profile,id:j.id,control:'cancel'});say('لغو ذخیره شد؛ محصولات و شناسه‌های مقصد حذف نشدند.');}));
 row.append(button('آزمایش مبدأ / عیب‌یابی',()=>test('audit-one')));rows.append(row);
 }
 if(!d.jobs.length){const p=document.createElement('p');p.textContent='هنوز استخراجی برای این پروفایل در ۱۰۰ کار اخیر نیست.';rows.append(p);}
 }catch(e){if(ticket===statusTicket)say(e.message,true);}}
// Public GitHub catalogue is opt-in. Hydrating a profile never contacts GitHub.
const ghStatus=text=>{document.getElementById('ghSourceStatus').textContent=text;};
function repo(){return document.getElementById('ghRepoCustom').style.display!=='none'?document.getElementById('ghRepoCustom').value:document.getElementById('ghRepoSelect').value;}
function options(id,values,selected){const s=document.getElementById(id);s.replaceChildren(...values.map(v=>new Option(v,v)));if(values.includes(selected))s.value=selected;}
window.ghSourceLoadFiles=async()=>{if(!catalogEnabled){ghStatus('برای خواندن مخزن عمومی دکمهٔ جستجو/تازه‌سازی را بزنید.');return;}
 const r=repo(),branch=document.getElementById('ghBranchSelect').value,previous=document.getElementById('ghFileSelect').value;ghStatus('در حال جستجوی فایل عمومی CSV/XLSX…');
 try{const d=await call('python_github_catalog',{kind:'files',repo:r,branch});if(repo()!==r||document.getElementById('ghBranchSelect').value!==branch)return;options('ghFileSelect',d.files,previous);ghSourceState.loaded=true;productSourceChanged(true);ghStatus(d.files.length+' فایل عمومی تا یک مگابایت'+(d.truncated?'؛ فهرست محدود شده است.':''));}catch(e){ghStatus(e.message);}};
window.ghSourceRefresh=async()=>{if(!catalogEnabled){ghStatus('خواندن خودکار مخزن غیرفعال است؛ برای جستجو دکمه را بزنید.');return;}
 const r=repo(),branch=document.getElementById('ghBranchSelect').value;try{const d=await call('python_github_catalog',{kind:'branches',repo:r});if(repo()!==r)return;options('ghBranchSelect',d.branches,branch);await ghSourceLoadFiles();}catch(e){ghStatus(e.message);}};
for(const b of pane.querySelectorAll('[onclick="ghSourceRefresh()"]'))b.onclick=()=>{catalogEnabled=true;return ghSourceRefresh();};
window.ghSourceRepoChanged=window.ghSourceRepoCustomChanged=()=>{catalogEnabled=false;ghSourceState.loaded=false;ghStatus('مخزن عوض شد؛ برای خواندن مخزن عمومی جستجو را بزنید.');};
setInterval(()=>{if(!document.hidden&&pane.classList.contains('active')&&!pending)refresh();},15000);
})();
