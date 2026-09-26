/** Trusted local-only snapshot controls. Never execute source-site scripts. */
export const SNAPSHOT_INTERACTION_JS=String.raw`
let s4DismissArmed=false;
const s4Note=text=>{const el=document.getElementById('__s4interaction');if(el)el.textContent=text;};
function s4Popup(target){
 const start=target.closest('button,[role="button"],a')?.parentElement||target;
 const known=start.closest('dialog,[role="dialog"],[aria-modal="true"],.modal,.popup,[class*="popup"],[class*="Popup"],[class*="modal"],[class*="Modal"],[id*="popup"],[id*="modal"]');
 if(known&&!known.contains(document.getElementById('__s4bar'))&&!['BODY','HTML'].includes(known.tagName))return known;
 for(let el=start;el&&el!==document.body;el=el.parentElement){if(el.closest('#__s4bar'))return null;if(typeof getComputedStyle==='function'&&getComputedStyle(el).position==='fixed')return el;}
 return null;
}
function s4HidePopup(panel){
 panel.hidden=true;panel.setAttribute('aria-hidden','true');panel.style.setProperty('display','none','important');
 panel.parentElement?.querySelectorAll('.modal-backdrop,.popup-backdrop,[data-backdrop]').forEach(el=>{el.hidden=true;el.style.setProperty('display','none','important');});
 document.body.style.setProperty('overflow','auto','important');document.documentElement.style.setProperty('overflow','auto','important');s4DismissArmed=false;s4Note('پاپ‌آپ فقط در این تصویر پنهان شد؛ ریفرش آن را بازمی‌گرداند.');
}
function s4SnapshotClick(event){
 const target=event.target instanceof Element?event.target:event.target?.parentElement;if(!target)return;
 if(s4DismissArmed){event.preventDefault();event.stopPropagation();const popup=s4Popup(target);if(popup)s4HidePopup(popup);else s4Note('پاپ‌آپ مشخصی پیدا نشد؛ داخل کادر پاپ‌آپ کلیک کنید.');return;}
 const control=target.closest('button,[role="button"],a'),label=((control?.getAttribute('aria-label')||'')+' '+(control?.getAttribute('title')||'')+' '+(control?.textContent||'')).trim();
 if(control&&(/(?:\bclose\b|\bdismiss\b|بستن|×|✕|✖)/i.test(label)||/(?:^|[\s_-])(?:close|dismiss)(?:$|[\s_-])/i.test(String(control.className||'')))){const popup=s4Popup(control);if(popup){event.preventDefault();event.stopPropagation();s4HidePopup(popup);return;}}
 const toggle=target.closest('[aria-controls]'),id=toggle?.getAttribute('aria-controls'),panel=id&&document.getElementById(id);
 if(panel&&panel!==document.body&&panel!==document.documentElement&&!panel.contains(document.getElementById('__s4bar'))){
  event.preventDefault();event.stopPropagation();
  if(toggle.getAttribute('role')==='tab'){
   toggle.closest('[role="tablist"]')?.querySelectorAll('[role="tab"][aria-controls]').forEach(tab=>{const content=document.getElementById(tab.getAttribute('aria-controls'));if(content&&content!==document.body&&content!==document.documentElement&&!content.contains(document.getElementById('__s4bar'))){content.hidden=true;content.style.setProperty('display','none','important');}tab.setAttribute('aria-selected','false');});
   toggle.setAttribute('aria-selected','true');panel.hidden=false;panel.style.setProperty('display','block','important');
  }else{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));panel.hidden=!open;panel.style.setProperty('display',open?'block':'none','important');}
  s4Note('بخش موجود در HTML باز/بسته شد؛ دادهٔ تازه از سایت دریافت نشد.');return;
 }
 if(target.closest('a')){event.preventDefault();s4Note('این تصویر ثابت است؛ رفتن به لینک یا عملیات سایت در این پنجره اجرا نمی‌شود.');}
}
function s4InteractionMode(picking){s4DismissArmed=false;const button=document.getElementById('__s4dismiss');if(button)button.disabled=picking;document.querySelectorAll('.__s4hover,.__s4picked').forEach(el=>el.classList.remove('__s4hover','__s4picked'));s4Note(picking?'انتخاب فعال است؛ ثبت، سپس فیلد بعدی.':'انتخاب متوقف است: بستن پاپ‌آپ و کنترل‌های HTML فعال‌اند؛ اسکریپت‌های سایت اجرا نمی‌شوند.');}
document.getElementById('__s4dismiss').onclick=()=>{s4DismissArmed=true;s4Note('داخل پاپ‌آپی که می‌خواهید فقط در این تصویر پنهان شود کلیک کنید.');};
document.getElementById('__s4refresh').onclick=()=>parent.postMessage({type:'scraper4-refresh',channel:'__S4_CHANNEL__'},'*');
`;
