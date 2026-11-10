/* Trusted controls are reused, not cloned into the untrusted original client. */
(()=>{'use strict';
const about=document.getElementById('php-ui-about');let aboutReturnFocus=null;
const dialog=document.getElementById('php-tools'),frame=document.getElementById('php-original-ui');let selected=null,refreshTicket=0;
const keys=new Set(['woocommerce','basalam','backup','general','version','render','guardian','profile-stats']);
const labels={'shared-workspace':'ابزار مشترک دو رابط: گزارش و آزمایش زنده',diagnostics:'گزارش امن برای بررسی بدون رمز', 'endpoint-inventory':'فهرست درخواست‌های منبع PHP و اتصال‌های واقعی',profile:'تنظیمات و پاک‌سازی پروفایل انتخاب‌شده',selectors:'آزمایش واقعی سلکتورها',results:'تمام نتایج و جزئیات ذخیره‌شده',audit:'تست موتورهای استخراج با endpointهای واقعی'};
function changeSelection(p){if(!p)return;selected=p;window.dispatchEvent(new CustomEvent('s4:profile-selected',{detail:{id:p.id}}));}
function open(key){
 if(key==='sync-audit-all'){open('shared-workspace');document.getElementById('shared-php-audit-all').click();return true;}
 if(key==='help'){if(!about.open){aboutReturnFocus=document.activeElement;about.showModal();document.getElementById('php-ui-about-close').focus();}return true;}
 const metrics={total:'all',priced:'priced',no_price:'no_price',in_stock:'in_stock',out_stock:'out_stock',stock_unknown:'stock_unknown',with_image:'has_image',no_image:'no_image',gallery:'gallery',variations:'variations',linked:'web_link',sku:'sku',description:'description',category:'category',brand:'brand',ready:'ready'};
 if(typeof key==='string'&&key.startsWith('metric:')&&Object.hasOwn(metrics,key.slice(7))){open('results');window.S4Browse(metrics[key.slice(7)],'');return true;}
 const tests={'audit-one':['1','configured',false],'audit-pages':['2','configured',false],'audit-all':['5','configured',true],trial:['1','heuristic',false]};
 if(Object.hasOwn(tests,key)){
  const [pages,engine,all]=tests[key];if(!all&&!selected)throw Error('ابتدا پروفایل ذخیره‌شده را انتخاب کنید.');
  open('audit');const f=document.getElementById('extraction-audit-form');
  const pick=(name,value)=>{const s=f.elements[name];if(!Array.from(s.options).some(o=>o.value===String(value)))s.add(new Option(String(value),String(value)));s.value=String(value);};
  pick('profile_id',all?'all':selected.id);pick('pages',pages);pick('engine',engine);f.requestSubmit();return true;
 }
 if(keys.has(key)){window.S4Menu.open(key);if(key==='guardian')jobs();return true;}
 if(!Object.hasOwn(labels,key))return false;
 for(const section of dialog.querySelectorAll('[data-python-tool]'))section.hidden=section.dataset.pythonTool!==key;
 document.getElementById('php-tools-title').textContent=labels[key];
 if(!dialog.open)dialog.showModal();
 if(key==='diagnostics'&&selected){const s=document.getElementById('native-diagnostic-profile');if(!Array.from(s.options).some(o=>o.value===String(selected.id)))s.add(new Option(selected.name,String(selected.id)));if(s.value!==String(selected.id)){clearDiagnostic();s.value=String(selected.id);}}
 if(key==='endpoint-inventory')loadInventory();
 if(key==='results'&&selected)window.S4Browse?.('all',selected.id,selected.name);
 if(key==='selectors'&&selected){const form=document.getElementById('profile-form');if(!form.dataset.dirty){form.elements.url.value=selected.url;for(const [k,v]of Object.entries(selected.selectors||{}))if(form.elements[k])form.elements[k].value=v;for(const [k,v]of Object.entries(selected.detailSelectors||{}))if(form.elements['detail_'+k])form.elements['detail_'+k].value=v.selector||v;}}
 return true;
}
// Native dialogs are top-layer: dismiss help before opening the reused drawer.
document.getElementById('hamburgerBtn').addEventListener('click',()=>{if(about.open){aboutReturnFocus=null;about.close();}},{capture:true});
document.getElementById('php-ui-recovery').onclick=()=>open('help');
document.getElementById('php-ui-about-close').onclick=()=>about.close();
about.addEventListener('close',()=>{if(document.activeElement===document.body||about.contains(document.activeElement))aboutReturnFocus?.focus();aboutReturnFocus=null;});
document.getElementById('php-tools-close').onclick=()=>dialog.close();
window.S4NativeTools={open,select:changeSelection};
if(window.S4NativeSelection)changeSelection(window.S4NativeSelection);
document.getElementById('profile-form').addEventListener('input',e=>{e.currentTarget.dataset.dirty='1';});
async function api(action,fields={},read=false){const r=await fetch('/api/php-ui/'+(read?'read':'write'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({action,query:{},fields})});const d=await r.json();if(!r.ok)throw Error(d.error||'درخواست ناموفق');return d;}
async function jobs(){const ticket=++refreshTicket,out=document.getElementById('php-jobs'),message=document.getElementById('php-jobs-status');try{
 const data=await api('tasks_list',{},true);if(ticket!==refreshTicket)return;out.replaceChildren();
 for(const t of data.tasks){const tr=document.createElement('tr');for(const text of [t.key+' · '+t.title,t.profile_name,t.phase]){const td=document.createElement('td');td.textContent=text;tr.append(td);}const td=document.createElement('td');
  for(const [text,control]of [['مکث','pause'],['ادامه','resume'],['لغو','cancel'],['پاک‌کردن رد','delete']]){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=(control==='resume'&&!t.resumable)||(control==='delete'&&!t.clearable)||(control==='pause'&&!t.stoppable)||(control==='cancel'&&t.clearable);b.onclick=async()=>{const risk=control==='resume'?'اگر ارسال قبلی پاسخ مبهم داشته، ابتدا مقصد و شناسهٔ محصول را بررسی کنید. ادامه می‌تواند ارسال را تکرار کند.\n':'';if(!confirm(risk+`${text} کار ${t.key} تأیید می‌شود؟`))return;b.disabled=true;try{await api('python_queue_control',{id:t.key.slice(3),control,...(control==='resume'?{acknowledge_remote_reconciliation:'1'}:{})});message.textContent='وضعیت ذخیره شد؛ این کنترل صف را پردازش نمی‌کند.';await jobs();}catch(e){message.textContent=e.message;b.disabled=false;}};td.append(b);}tr.append(td);out.append(tr);}
 message.textContent=data.tasks.length+' کار اخیر (حداکثر ۱۰۰)؛ فقط وضعیت واقعی محلی.';
 }catch(e){message.textContent=e.message;}}
document.getElementById('php-jobs-refresh').onclick=jobs;
for(const name of ['s4:connections-saved','s4:basalam-vendors-changed','s4:profile-options-saved','s4:extraction-updated'])window.addEventListener(name,()=>{frame.contentWindow.postMessage({type:'s4-php-refresh-profile'},'*');});
// The file is a reviewed data snapshot, not a shared session/token or a public
// live diagnostic API. All reads/downloads still require the normal login.
let diagnosticTicket=0,diagnosticUrl='',inventoryRows=[];
function revokeDiagnostic(){if(diagnosticUrl)URL.revokeObjectURL(diagnosticUrl);diagnosticUrl='';}
window.addEventListener('pagehide',revokeDiagnostic);
const diagnosticSelect=document.getElementById('native-diagnostic-profile');
function clearDiagnostic(){diagnosticTicket++;revokeDiagnostic();document.getElementById('native-diagnostic-preview').value='';const a=document.getElementById('native-diagnostic-download');a.hidden=true;a.removeAttribute('href');document.getElementById('native-diagnostic-status').textContent='گزارش فقط پس از انتخاب شما خوانده می‌شود.';}
diagnosticSelect.onchange=clearDiagnostic;
async function diagnostic(){const id=diagnosticSelect.value;if(!id){clearDiagnostic();return;}const ticket=++diagnosticTicket,out=document.getElementById('native-diagnostic-status'),a=document.getElementById('native-diagnostic-download');a.hidden=true;revokeDiagnostic();document.getElementById('native-diagnostic-preview').value='';out.textContent='خواندن گزارش امن…';
 try{const path='/api/php-ui/diagnostic-export?profile_id='+encodeURIComponent(id),r=await fetch(path,{credentials:'same-origin',cache:'no-store'}),d=await r.json();if(ticket!==diagnosticTicket)return;if(!r.ok)throw Error(r.status===401?'نشست تمام شده است؛ از صفحهٔ ورود وارد شوید.':d.error||'خطای خواندن گزارش');const text=JSON.stringify(d,null,2)+'\n';document.getElementById('native-diagnostic-preview').value=text;diagnosticUrl=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=diagnosticUrl;a.download='scraper4-diagnostic-'+id+'.json';a.hidden=false;out.textContent=d.hint+' · این گزارش snapshot است؛ برای عامل فقط فایل بازبینی‌شده را بفرستید.';}
 catch(e){if(ticket===diagnosticTicket)out.textContent=e.message;}}
document.getElementById('native-diagnostic-refresh').onclick=diagnostic;
document.getElementById('native-diagnostic-download').onclick=e=>{if(!confirm('فایل شامل نام پروفایل و وضعیت صف است؛ پس از بازبینی، فقط همین فایل را برای بررسی ارسال کنید. رمز/کوکی/کلید اتصال داخل فایل نیست. دانلود انجام شود؟'))e.preventDefault();};
function paintInventory(){const query=document.getElementById('native-endpoints-search').value.trim().toLowerCase(),body=document.getElementById('native-endpoints-body');body.replaceChildren();for(const item of inventoryRows.filter(r=>r.key.toLowerCase().includes(query)).slice(0,100)){const row=document.createElement('tr');for(const text of [item.key,item.methods.join('/'),item.lines.join(', '),'ارجاع منبع؛ نیازمند بررسی معنایی handler']){const td=document.createElement('td');td.textContent=text;row.append(td);}body.append(row);}}
async function loadInventory(){const out=document.getElementById('native-endpoints-status');try{const r=await fetch('/api/php-ui/endpoint-inventory',{credentials:'same-origin',cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'خطای فهرست');inventoryRows=d.inventory.entries;out.textContent=d.inventory.unique_keys+' کلید ثابت منبع (نه تعداد endpoint) · '+d.connected.read_actions.length+' قرارداد خواندن و '+d.connected.write_actions.length+' قرارداد نوشتن متصل. جدول تا ۱۰۰ نتیجه؛ JSON کامل همهٔ موارد را دارد.';paintInventory();}catch(e){out.textContent=e.message;}}
document.getElementById('native-endpoints-refresh').onclick=loadInventory;document.getElementById('native-endpoints-search').oninput=paintInventory;
// An explicit human report link returns here after normal password login.
const reportName=new URLSearchParams(location.search).get('report');if(reportName){open('diagnostics');const normalize=s=>s.replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim(),matches=Array.from(diagnosticSelect.options).filter(o=>o.value&&normalize(o.textContent)===normalize(reportName));if(matches.length===1){diagnosticSelect.value=matches[0].value;diagnostic();}else document.getElementById('native-diagnostic-status').textContent='نام پروفایل پیدا نشد یا یکتا نیست؛ پروفایل را از فهرست انتخاب کنید.';}
})();
