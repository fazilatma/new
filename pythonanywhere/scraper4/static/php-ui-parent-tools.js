/* Trusted controls are reused, not cloned into the untrusted original client. */
(()=>{'use strict';
const about=document.getElementById('php-ui-about');let aboutReturnFocus=null;
const dialog=document.getElementById('php-tools'),frame=document.getElementById('php-original-ui');let selected=null,refreshTicket=0;
const keys=new Set(['woocommerce','basalam','backup','general','version','render','guardian','profile-stats']);
const labels={profile:'تنظیمات و پاک‌سازی پروفایل انتخاب‌شده',selectors:'آزمایش واقعی سلکتورها',results:'تمام نتایج و جزئیات ذخیره‌شده',audit:'تست موتورهای استخراج با endpointهای واقعی'};
function changeSelection(p){if(!p)return;selected=p;window.dispatchEvent(new CustomEvent('s4:profile-selected',{detail:{id:p.id}}));}
function open(key){
 if(key==='help'){if(!about.open){aboutReturnFocus=document.activeElement;about.showModal();document.getElementById('php-ui-about-close').focus();}return true;}
 if(keys.has(key)){window.S4Menu.open(key);if(key==='guardian')jobs();return true;}
 if(!Object.hasOwn(labels,key))return false;
 for(const section of dialog.querySelectorAll('[data-python-tool]'))section.hidden=section.dataset.pythonTool!==key;
 document.getElementById('php-tools-title').textContent=labels[key];
 if(!dialog.open)dialog.showModal();
 if(key==='results'&&selected)window.S4Browse?.('all',selected.id,selected.name);
 if(key==='selectors'&&selected){const form=document.getElementById('profile-form');if(!form.dataset.dirty){form.elements.url.value=selected.url;for(const [k,v]of Object.entries(selected.selectors||{}))if(form.elements[k])form.elements[k].value=v;for(const [k,v]of Object.entries(selected.detailSelectors||{}))if(form.elements['detail_'+k])form.elements['detail_'+k].value=v.selector||v;}}
 return true;
}
// Native dialogs are top-layer: dismiss help before opening the reused drawer.
document.getElementById('hamburgerBtn').addEventListener('click',()=>{if(about.open){aboutReturnFocus=null;about.close();}},{capture:true});
document.getElementById('php-ui-recovery').onclick=()=>open('help');
document.getElementById('php-ui-about-close').onclick=()=>about.close();
about.addEventListener('close',()=>{aboutReturnFocus?.focus();aboutReturnFocus=null;});
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
})();
