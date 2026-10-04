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

/** Shared layout overrides: essential actions stay visible; secondary tools fold away. */
export const SNAPSHOT_LAYOUT_CSS=String.raw`
#__s4bar{display:block!important;box-sizing:border-box!important;min-height:0!important;max-height:var(--s4-height,30vh)!important;overflow:auto!important;overscroll-behavior:contain!important;width:100%!important;margin:0!important}
#__s4bar.__s4flow{position:relative!important;top:auto!important;left:auto!important;right:auto!important}
#__s4bar .__s4primary,#__s4bar .__s4extras{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:6px!important}
#__s4bar .__s4primary{padding-bottom:4px!important}
#__s4bar details{display:block!important;margin:0!important;padding:0!important;color:#e2e8f0!important;background:#111827!important;border:0!important}
#__s4bar details>summary{display:list-item!important;cursor:pointer!important;padding:5px 8px!important;font:inherit!important;color:#fde68a!important}
#__s4bar details:not([open])>:not(summary){display:none!important}
#__s4bar .__s4extras{padding:6px!important}
#__s4bar #__s4warnings span{display:block!important;padding:5px 8px!important;overflow-wrap:anywhere!important}
#__s4bar label{display:inline-flex!important;align-items:center!important;gap:4px!important;color:#fff!important;font:inherit!important;margin:0!important}
#__s4bar input[type=checkbox]{appearance:auto!important;position:static!important;opacity:1!important;width:16px!important;height:16px!important;margin:0!important}
#__s4bar input[type=range]{appearance:auto!important;position:static!important;opacity:1!important;width:110px!important;height:24px!important}
#__s4bar #__s4interaction{flex-basis:100%!important;overflow-wrap:anywhere!important}
@supports(height:1dvh){#__s4bar{max-height:var(--s4-height-dynamic,30dvh)!important}}
`;

export const SNAPSHOT_LAYOUT_JS=String.raw`
const s4Bar=document.getElementById('__s4bar');
const s4Tools=document.createElement('details');s4Tools.id='__s4tools';
s4Tools.innerHTML='<summary>ابزارها و تنظیم ارتفاع</summary><div class="__s4extras"></div>';
const s4Extras=s4Tools.lastElementChild;
const s4Warnings=document.getElementById('__s4warnings');
s4Bar.appendChild(s4Tools);
Array.from(s4Bar.childNodes).forEach(node=>{if(node!==s4Warnings&&node!==s4Tools)s4Extras.appendChild(node);});
const s4Primary=document.createElement('div');s4Primary.className='__s4primary';
['__s4mode','__s4save','__s4pause'].forEach(id=>{const el=document.getElementById(id);if(el)s4Primary.appendChild(el);});
const s4PinLabel=document.createElement('label');s4PinLabel.innerHTML='<input id="__s4pin" type="checkbox" checked> چسبان';s4Primary.appendChild(s4PinLabel);
const s4HeightLabel=document.createElement('label');s4HeightLabel.innerHTML='حداکثر ارتفاع <input id="__s4height" type="range" min="15" max="50" value="30" step="5" aria-label="حداکثر ارتفاع نوار، درصد پنجره"><output id="__s4heightValue">30%</output>';s4Extras.appendChild(s4HeightLabel);
s4Bar.prepend(s4Primary);s4Bar.appendChild(s4Tools);if(s4Warnings)s4Bar.appendChild(s4Warnings);
// The Worker originally appends its toolbar. Flow mode must start above the page.
document.body.prepend(s4Bar);
const s4Pin=document.getElementById('__s4pin'),s4Height=document.getElementById('__s4height');
s4Pin.checked=true;
function s4Offset(){const height=s4Pin.checked?Math.ceil(s4Bar.getBoundingClientRect().height):0;document.body.style.setProperty('padding-top',height+'px','important');}
s4Pin.onchange=()=>{s4Bar.classList.toggle('__s4flow',!s4Pin.checked);s4Offset();};
s4Height.oninput=()=>{const height=Math.max(15,Math.min(50,Number(s4Height.value)||30));s4Bar.style.setProperty('--s4-height',height+'vh');s4Bar.style.setProperty('--s4-height-dynamic',height+'dvh');document.getElementById('__s4heightValue').textContent=height+'%';s4Offset();};
s4Tools.addEventListener('toggle',s4Offset);s4Warnings?.addEventListener('toggle',s4Offset);window.addEventListener('resize',s4Offset);
if(window.ResizeObserver)new window.ResizeObserver(s4Offset).observe(s4Bar);
s4Offset();
`;
