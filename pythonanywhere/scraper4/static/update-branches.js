/* Local fixed-repository update sources; no GitHub mutations or automatic install. */
(()=>{'use strict';const form=document.getElementById('update-branches-form');if(!form)return;
const list=document.getElementById('update-branch-list'),name=document.getElementById('update-branch-name'),status=document.getElementById('update-branch-status');let config=null,busy=false,revision=0;
const controls=Array.from(form.querySelectorAll('button,input,select'));
function lock(value){busy=value;for(const c of controls)c.disabled=value||(!config&&c.id!=='update-branch-reload');}
function render(){const selected=config.selected;list.replaceChildren(...config.branches.map(b=>{const option=document.createElement('option');option.value=b;option.textContent=b;return option;}));list.value=selected;}
async function api(data){const mutation=data!==undefined;if(mutation)window.S4Refresh?.beginMutation();try{const r=await fetch('/api/updates/branches',{credentials:'same-origin',cache:'no-store',...(mutation?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},body:JSON.stringify(data)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'دریافت فهرست شاخه‌ها ناموفق');return d.config;}finally{if(mutation)window.S4Refresh?.endMutation();}}
function changed(){revision++;window.S4Refresh?.changed(form);status.textContent='پیش‌نویس تغییر کرد؛ تا ذخیره، شاخهٔ نصب تغییر نمی‌کند.';}
list.onchange=()=>{config.selected=list.value;changed();};name.oninput=changed;
for(const action of ['add','rename','delete'])document.getElementById('update-branch-'+action).onclick=()=>{if(busy||!config)return;const value=name.value.trim(),old=list.value;
if(action!=='delete'&&(!value||config.branches.includes(value))){status.textContent='نام تازه و غیرتکراری وارد کنید.';return;}
if(action==='add'){if(config.branches.length>=30){status.textContent='حداکثر۳۰شاخه.';return;}config.branches.push(value);config.selected=value;}
if(action==='rename'){config.branches=config.branches.map(b=>b===old?value:b);config.selected=value;}
if(action==='delete'){if(config.branches.length===1){status.textContent='آخرین شاخه قابل حذف نیست.';return;}if(!confirm('فقط از فهرست محلی حذف شود؟ شاخهٔ GitHub حذف نمی‌شود.'))return;config.branches=config.branches.filter(b=>b!==old);config.selected=config.branches[0];}
render();changed();};
async function load(){if(busy)return;const v=revision;lock(true);try{const d=await api();if(v===revision){config=d;render();window.S4Refresh?.clean(form);status.textContent='شاخهٔ ذخیره‌شده: '+d.selected+'؛ هیچ بررسی یا نصبی اجرا نشد.';}}catch(e){status.textContent=e.message;}finally{lock(false);}}
form.onsubmit=async e=>{e.preventDefault();if(busy||!config)return;if(!confirm('فهرست و منبع آپدیت ذخیره شود؟ شاخهٔ انتخابی: '+config.selected+' — نصب فقط با درخواست جداگانه/Task انجام می‌شود.'))return;const stamp=window.S4Refresh?.revision(form);lock(true);try{config=await api(config);render();window.S4Refresh?.clean(form,stamp);status.textContent='ذخیره شد: '+config.selected+'؛ اکنون می‌توانید بررسی نسخه را ثبت کنید. هیچ کدی نصب نشد.';}catch(e){status.textContent=e.message;}finally{lock(false);}};
document.getElementById('update-branch-reload').onclick=()=>{if(window.S4Refresh?.isDirty(form)&&!confirm('پیش‌نویس کنار گذاشته شود؟'))return;load();};
load();})();
