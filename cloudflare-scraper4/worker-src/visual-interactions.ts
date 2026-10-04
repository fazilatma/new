/** Trusted local-only snapshot controls. Never execute source-site scripts. */
export const SNAPSHOT_INTERACTION_JS=String.raw`
let s4DismissArmed=false;
const s4Note=text=>{try{const el=document.getElementById('__s4interaction');if(el)el.textContent=text;}catch{}};
function s4Popup(target){
 try{
 const start=target.closest('button,[role="button"],a')?.parentElement||target;
 const known=start.closest('dialog,[role="dialog"],[aria-modal="true"],.modal,.popup,[class*="popup"],[class*="Popup"],[class*="modal"],[class*="Modal"],[id*="popup"],[id*="modal"]');
 if(known&&!known.contains(document.getElementById('__s4bar'))&&!['BODY','HTML'].includes(known.tagName))return known;
 for(let el=start;el&&el!==document.body;el=el.parentElement){if(el.closest('#__s4bar'))return null;if(typeof getComputedStyle==='function'&&getComputedStyle(el).position==='fixed')return el;}
 }catch{}
 return null;
}
function s4HidePopup(panel){
 try{
 panel.hidden=true;panel.setAttribute('aria-hidden','true');panel.style.setProperty('display','none','important');
 panel.parentElement?.querySelectorAll('.modal-backdrop,.popup-backdrop,[data-backdrop]').forEach(el=>{el.hidden=true;el.style.setProperty('display','none','important');});
 document.body.style.setProperty('overflow','auto','important');document.documentElement.style.setProperty('overflow','auto','important');s4DismissArmed=false;s4Note('پاپ‌آپ فقط در این تصویر پنهان شد؛ ریفرش آن را بازمی‌گرداند.');
 }catch(e){console.error('[S4] hidePopup',e);}
}
function s4SnapshotClick(event){
 try{
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
 }catch(e){console.error('[S4] snapshotClick',e);}
}
function s4InteractionMode(picking){
 try{
 s4DismissArmed=false;
 const button=document.getElementById('__s4dismiss');if(button)button.disabled=picking;
 // Only clear hover, keep picked when pausing to avoid losing selection visual? But clear hover always
 document.querySelectorAll('.__s4hover').forEach(el=>el.classList.remove('__s4hover'));
 if(picking){document.querySelectorAll('.__s4picked').forEach(el=>el.classList.remove('__s4picked'));}
 s4Note(picking?'انتخاب فعال است؛ ثبت، سپس فیلد بعدی.':'انتخاب متوقف است: بستن پاپ‌آپ و کنترل‌های HTML فعال‌اند؛ اسکریپت‌های سایت اجرا نمی‌شوند.');
 }catch(e){console.error('[S4] interactionMode',e);}
}
try{
 const _d=document.getElementById('__s4dismiss');
 if(_d)_d.addEventListener('click',()=>{s4DismissArmed=true;s4Note('داخل پاپ‌آپی که می‌خواهید فقط در این تصویر پنهان شود کلیک کنید.');});
}catch{}
try{
 const _r=document.getElementById('__s4refresh');
 if(_r)_r.addEventListener('click',()=>{try{(window.__s4_realParent||window.parent).postMessage({type:'scraper4-refresh',channel:'__S4_CHANNEL__'},'*');}catch{}});
}catch{}
`;

/** Visual Picker V2: stable UI shell.
 * The toolbar is deliberately kept in normal document flow. No DOM re-parenting,
 * details/summary widgets, or source-page dependent layout mutations are used.
 */
export const SNAPSHOT_LAYOUT_CSS=String.raw`
#__s4bar{
  position:fixed!important;top:0!important;left:0!important;right:0!important;
  z-index:2147483647!important;display:block!important;box-sizing:border-box!important;
  width:100%!important;margin:0!important;padding:8px!important;
  background:#111827!important;color:#fff!important;direction:rtl!important;
  font:12px Tahoma,sans-serif!important;isolation:isolate!important;
  pointer-events:auto!important;contain:layout paint style!important;
}
#__s4bar,#__s4bar *{box-sizing:border-box!important}
#__s4bar .__s4row{display:flex!important;gap:6px!important;align-items:center!important;flex-wrap:wrap!important}
#__s4bar .__s4meta{display:flex!important;gap:8px!important;align-items:center!important;margin-top:6px!important;padding-top:6px!important;border-top:1px solid #334155!important}
#__s4bar button,#__s4bar select{pointer-events:auto!important;touch-action:manipulation!important;user-select:none!important;font:inherit!important;border:1px solid #475569!important;border-radius:7px!important;padding:7px!important;background:#1f2937!important;color:#fff!important}
#__s4bar button{cursor:pointer!important}
#__s4bar button:disabled{opacity:.45!important;cursor:default!important}
#__s4bar button:hover{background:#334155!important}
#__s4bar #__s4pause{position:relative!important;z-index:2!important;min-width:92px!important}
#__s4bar #__s4save{background:#166534!important;border-color:#22c55e!important}
#__s4bar #__s4done{background:#075985!important;border-color:#38bdf8!important}
#__s4bar button.__s4on{background:#f59e0b!important;color:#111827!important;font-weight:bold!important}
#__s4selector{direction:ltr!important;background:#020617!important;color:#67e8f9!important;padding:7px!important;border-radius:6px!important;min-width:160px!important;max-width:34vw!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;flex:1!important}
#__s4count{background:#422006!important;color:#fde68a!important;border-radius:999px!important;padding:5px 9px!important;white-space:nowrap!important}
#__s4interaction{overflow-wrap:anywhere!important}
#__s4bprog{height:3px!important;overflow:hidden!important}
#__s4bprogBar{display:block!important;height:100%!important;width:0!important}
body.__s4paused #__s4bar{opacity:.96!important}
body{padding-top:104px!important}
@media(max-width:720px){
  #__s4bar{padding:6px!important;font-size:11px!important}
  #__s4bar .__s4row{gap:4px!important}
  #__s4bar button,#__s4bar select{padding:6px 7px!important}
  #__s4selector{order:8!important;min-width:55%!important;max-width:none!important}
  #__s4bar .__s4meta{align-items:flex-start!important;flex-wrap:wrap!important}
  #__s4preview{flex-basis:70%!important}
}
`;

export const SNAPSHOT_LAYOUT_JS=String.raw`
(function(){
  const bar=document.getElementById('__s4bar');
  if(!bar)return;
  bar.dataset.s4UiVersion='2';
  function syncOffset(){
    try{document.body.style.setProperty('padding-top',Math.ceil(bar.getBoundingClientRect().height)+'px','important');}catch{}
  }
  syncOffset();
  window.addEventListener('resize',syncOffset,{passive:true});
  if(window.ResizeObserver)new ResizeObserver(syncOffset).observe(bar);
  // Keep the UI alive if a source-page framework replaces body children.
  const ensure=()=>{
    try{
      if(document.body&&!document.body.contains(bar))document.body.prepend(bar);
      bar.style.setProperty('z-index','2147483647','important');
      bar.style.setProperty('pointer-events','auto','important');
    }catch{}
  };
  new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true});
  window.__s4EnsureUi=ensure;
  console.log('[S4] Visual Picker V2 shell ready');
})();
`;
