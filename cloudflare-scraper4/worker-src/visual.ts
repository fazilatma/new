import {SNAPSHOT_INTERACTION_JS,SNAPSHOT_LAYOUT_JS,SNAPSHOT_LAYOUT_CSS} from './visual-interactions.js';
import { getState, setState } from './db.js';
import { assertPublicUrl } from './network.js';
import { sourceText } from './scraper.js';

const TICKET_TTL_MS=10*60*1000;
type VisualContext='list'|'detail';
type Ticket={url:string;createdAt:number;indirect?:boolean};
const ticketKey=(id:string)=>`visual_ticket:${id}`;
export async function createVisualTicket(url:string,indirect=false):Promise<string>{assertPublicUrl(url);const id=crypto.randomUUID();await setState(ticketKey(id),{url,createdAt:Date.now(),indirect});return id}
async function consumeTicket(id:string):Promise<Ticket>{const ticket=await getState<Ticket|null>(ticketKey(id),null);if(!ticket||Date.now()-ticket.createdAt>TICKET_TTL_MS)throw new Error('لینک انتخاب بصری منقضی یا نامعتبر است.');await setState(ticketKey(id),null);return ticket}

const LIST_OPTIONS=`<option value="container">📦 کانتینر محصول</option><option value="title">📝 عنوان</option><option value="price">💰 قیمت</option><option value="link">🔗 لینک</option><option value="image">🖼 تصویر فهرست</option>`;
const DETAIL_OPTIONS=`<option value="price">💰 قیمت</option><option value="shortDesc">📝 توضیحات کوتاه</option><option value="longDesc">📄 توضیحات بلند</option><option value="sku">🏷️ SKU</option><option value="category">📂 دسته‌بندی</option><option value="tags">🔖 برچسب‌ها</option><option value="weight">⚖️ وزن</option><option value="stock">📦 موجودی</option><option value="brand">🏭 برند</option><option value="detailImage">🌆 عکس اصلی</option><option value="variations">🎨 تنوع‌ها</option><option value="galleryBox">📦 باکس گالری</option><option value="galleryOne">🖼 تک‌عکس گالری</option>`;

function toolbar(context:VisualContext,full=false){
  const detail=context==='detail';
  return `<div id="__s4bar" data-context="${context}" data-full="${full?'1':'0'}"><div id="__s4bprog" class="__s4bprog"><i id="__s4bprogBar"></i></div><div class="__s4row"><select id="__s4mode" aria-label="فیلد در حال انتخاب">${detail?DETAIL_OPTIONS:LIST_OPTIONS}</select><button id="__s4up" title="والد (↑)">⬆ والد</button><button id="__s4down" title="فرزند (↓)">⬇ فرزند</button><button id="__s4prev" title="هم‌سطح قبلی (→)">→ قبلی</button><button id="__s4next" title="هم‌سطح بعدی (←)">← بعدی</button><code id="__s4selector">روی عنصر مورد نظر کلیک کنید</code><span id="__s4count">۰ مورد</span><button id="__s4pause" title="موقتاً انتخاب را خاموش کن تا بتوانی تب‌ها و کشویی‌های صفحه را باز کنی">⏸ توقف</button><button id="__s4refresh" title="دریافت دوبارهٔ صفحه؛ انتخاب‌های ثبت‌شده حفظ می‌شوند">↻</button><button id="__s4full" title="حالت کامل JS برای سایت‌های مثل ایمالز/اسنپ‌شاپ">${full?'🧹 ساده':'🌐 کامل'}</button><span id="__s4interaction" role="status">تصویر ${full?'کامل JS':'ثابت'}؛ ثبت و رفتن به بعدی</span><button id="__s4save">✓ ثبت و بعدی</button>${detail?'<button id="__s4done">✅ اتمام و اعمال همه</button>':''}</div><div class="__s4meta"><b id="__s4field">${detail?'قیمت':'کانتینر محصول'}</b><span id="__s4preview">هنوز عنصری انتخاب نشده است.</span><span id="__s4progress">۰ فیلد ثبت‌شده</span></div></div><div class="__s4pop" id="__s4pop"><div class="__s4prow"><button class="__s4pb" id="__s4pup" title="والد (↑)">⬆</button><button class="__s4pb" id="__s4pdn" title="فرزند (↓)">⬇</button><button class="__s4pb" id="__s4pprv" title="قبلی (→)">⬅</button><button class="__s4pb" id="__s4pnxt" title="بعدی (←)">➡</button><span class="__s4psep"></span><button class="__s4pb" id="__s4pfprev" title="فیلد قبلی (Shift+Tab)">‹</button><button class="__s4pb __s4pfld" id="__s4pfld">—</button><button class="__s4pb" id="__s4pfnext" title="فیلد بعدی (Tab)">›</button><span class="__s4psep"></span><i id="__s4pcnt"></i><button class="__s4pb __s4okb" id="__s4pok" title="ثبت (Enter)">✓</button></div><div class="__s4prow2"><b id="__s4psel">—</b><em id="__s4ppv"></em></div></div>`;
}

const STYLE=`<style>
#__s4bar{position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#111827;color:#fff;padding:8px;font:12px Tahoma,sans-serif;box-shadow:0 3px 14px #0008;direction:rtl}#__s4bar .__s4row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}#__s4bar .__s4meta{display:flex;gap:8px;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid #334155}#__s4bar select,#__s4bar button{font:inherit;border:1px solid #475569;border-radius:7px;padding:7px;background:#1f2937;color:white}#__s4bar button{cursor:pointer}#__s4bar button:disabled{opacity:.45;cursor:default}#__s4bar button:hover{background:#334155}#__s4bar #__s4save{background:#166534;border-color:#22c55e}#__s4bar #__s4done{background:#075985;border-color:#38bdf8}#__s4selector{direction:ltr;background:#020617;color:#67e8f9;padding:7px;border-radius:6px;min-width:160px;max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}#__s4count{background:#422006;color:#fde68a;border-radius:999px;padding:5px 9px;white-space:nowrap}#__s4field{color:#bfdbfe}#__s4preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#bbf7d0}#__s4progress{color:#cbd5e1;white-space:nowrap}.__s4hover{outline:3px solid #38bdf8!important;outline-offset:2px!important}.__s4picked{outline:3px solid #22c55e!important;outline-offset:3px!important;background-color:#22c55e18!important}.__s4gal{outline:3px solid #ec4899!important;outline-offset:2px!important;box-shadow:0 0 0 3px #ec489955!important}
#__s4bar button.__s4on{background:#f59e0b;color:#111827;font-weight:bold}body.__s4paused #__s4bar{opacity:.92}body.__s4paused{cursor:auto}
.__s4pop{position:fixed;z-index:2147483647;display:none;flex-direction:column;gap:2px;background:#0b1220;border:1px solid #3b82f6;border-radius:7px;padding:3px 4px;box-shadow:0 4px 14px rgba(0,0,0,.55);font:12px Tahoma,sans-serif;direction:rtl;white-space:nowrap;cursor:default}.__s4pop.__s4on{display:flex}.__s4pop.__s4off{display:none!important}.__s4prow{display:flex;gap:3px;align-items:center}.__s4prow2{display:flex;gap:4px;align-items:center;max-width:430px}.__s4psep{width:1px;height:15px;background:#1e40af;margin:0 2px;flex:0 0 auto}.__s4pb{background:#1e3a5f;color:#fff;border:1px solid #3b82f6;border-radius:5px;padding:3px 7px;font:12px Tahoma,sans-serif;cursor:pointer;line-height:1.4}.__s4pb:hover{background:#3b82f6}.__s4pb:disabled{opacity:.3;cursor:not-allowed}.__s4pb.__s4okb{background:#22c55e;border-color:#22c55e;color:#04210f;font-weight:700}.__s4pfld{background:#1d4ed8!important;color:#fff!important;min-width:70px;text-align:center;font-weight:700!important;max-width:150px}.__s4pfld.__s4fdone{background:#166534!important;color:#bbf7d0!important}.__s4pop b{background:#1e293b;color:#bfdbfe;padding:2px 6px;border-radius:4px;font:11px ui-monospace,monospace;font-weight:400;max-width:190px;overflow:hidden;text-overflow:ellipsis}.__s4pop i{font-style:normal;color:#93c5fd;font-size:11px;padding:0 3px}.__s4pop em{font-style:normal;color:#86efac;font-size:10.5px;max-width:235px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#052e16;border:1px solid #14532d;border-radius:4px;padding:1px 5px}.__s4pop em.__s4warn{color:#fbbf24;background:#3f2d05;border-color:#78350f}
@media(max-width:720px){#__s4bar{padding:6px;font-size:11px}#__s4bar .__s4row{gap:4px}#__s4bar button,#__s4bar select{padding:6px 7px}#__s4selector{order:8;min-width:55%;max-width:none}#__s4bar .__s4meta{align-items:flex-start;flex-wrap:wrap}#__s4preview{flex-basis:70%}body{padding-top:120px!important} .__s4pop{max-width:92vw}}body{padding-top:104px!important}${SNAPSHOT_LAYOUT_CSS}@keyframes __s4progIndef{0%{transform:translateX(-100%)}50%{transform:translateX(30%)}100%{transform:translateX(100%)}}
</style>`;

function fullModeJs(indirect=false):string{
  const proxy = indirect ? '/api/rp?indirect=1&url=' : '/api/rp?url=';
  const indirectFlag = indirect ? 'true' : 'false';
  // PHP 10.170 parity + Emalls fix: baseURI, property setters, document.write override, frame-busting block
  return `<script>window.__S4_INDIRECT__=${indirectFlag};(function(){
var proxy='${proxy}';
var proxyBase='/api/rp?url=';
var proxyIndirect='/api/rp?indirect=1&url=';
var useIndirect=${indirectFlag};
var originHost=(function(){try{return new URL(document.baseURI||location.href).hostname;}catch(e){return '';}})();
function isSameHost(abs){
  try{
    var h=new URL(abs).hostname;
    return h===originHost || h==='www.'+originHost || originHost==='www.'+h;
  }catch(e){return false;}
}
function toProxy(u){
  if(!u||typeof u!=='string') return u;
  u=u.trim();
  if(!u) return u;
  if(u.indexOf('/api/rp')!==-1) return u;
  if(u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('#')||u.startsWith('javascript:')||u.startsWith('mailto:')||u.startsWith('about:')) return u;
  try{
    var base=document.baseURI||location.href;
    var abs=new URL(u, base).href;
    if(abs.indexOf(location.origin+'/api/rp')===0) return abs;
    if(abs.indexOf(location.origin+'/visual')===0) return abs;
    if(abs.indexOf(location.origin+'/api/')===0 && abs.indexOf('/api/rp')===-1) return abs;
    // For same-host static resources, load directly (PHP 10.170 did absolutize, not proxy)
    // Only proxy cross-origin or API/XHR
    var p=useIndirect?proxyIndirect:proxyBase;
    if(abs.startsWith('http://')||abs.startsWith('https://')){
      // If same host, return absolute directly to avoid proxy loop for JS/CSS
      // Dynamic fetch/XHR will still be proxied via fetch/XHR patch below when needed
      // For Emalls, we want direct load for static, proxied for API - detect API pattern
      var isApi=/\\/(api|graphql|search|ajax|_next\\/data|wp-json)\\//i.test(abs) || /\\.(json)(\\?|$)/i.test(abs);
      if(!isApi && isSameHost(abs)){
        return abs;
      }
      return p+encodeURIComponent(abs);
    }
    return abs;
  }catch(e){return u;}
}
function toProxyForce(u){
  // Force proxy even for same-host (for API calls)
  if(!u||typeof u!=='string') return u;
  u=u.trim();
  if(!u) return u;
  if(u.indexOf('/api/rp')!==-1) return u;
  if(u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('#')||u.startsWith('javascript:')||u.startsWith('mailto:')||u.startsWith('about:')) return u;
  try{
    var base=document.baseURI||location.href;
    var abs=new URL(u, base).href;
    if(abs.indexOf(location.origin+'/api/rp')===0) return abs;
    if(abs.indexOf(location.origin+'/visual')===0) return abs;
    if(abs.indexOf(location.origin+'/api/')===0 && abs.indexOf('/api/rp')===-1) return abs;
    var p=useIndirect?proxyIndirect:proxyBase;
    if(abs.startsWith('http://')||abs.startsWith('https://')){
      return p+encodeURIComponent(abs);
    }
    return abs;
  }catch(e){return u;}
}
function toProxySrcset(v){
  if(!v||typeof v!=='string') return v;
  try{
    return v.split(',').map(function(p){
      var t=p.trim();
      if(!t) return t;
      var parts=t.split(/\\s+/);
      if(!parts[0]) return t;
      parts[0]=toProxy(parts[0]);
      return parts.join(' ');
    }).join(', ');
  }catch(e){return v;}
}
var _fetch=window.fetch;
window.fetch=function(u,o){
  try{
    if(typeof u==='string'){
      u=toProxyForce(u);
    }else if(u && typeof u.url==='string'){
      var nu=toProxyForce(u.url);
      if(nu!==u.url){
        try{u=new Request(nu, u);}catch(e){u=new Request(nu);}
      }
    }
  }catch(e){}
  return _fetch.call(this,u,o);
};
try{
  var _Request=window.Request;
  if(_Request){
    var _OrigRequest=_Request;
    window.Request=function(input, init){
      try{
        if(typeof input==='string'){
          input=toProxyForce(input);
        }else if(input && typeof input.url==='string'){
          var nurl=toProxyForce(input.url);
          if(nurl!==input.url){
            try{input=new _OrigRequest(nurl, input);}catch(e){input=new _OrigRequest(nurl);}
          }
        }
      }catch(e){}
      return new _OrigRequest(input, init);
    };
    window.Request.prototype=_OrigRequest.prototype;
    Object.setOwnPropertyDescriptors(window.Request, Object.getOwnPropertyDescriptors(_OrigRequest));
  }
}catch(e){}
var _open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
  try{
    if(typeof u==='string'){
      arguments[1]=toProxyForce(u);
    }
  }catch(e){}
  return _open.apply(this,arguments);
};
var _setAttr=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){
  try{
    if(typeof v==='string'){
      var ln=n.toLowerCase();
      if(ln==='src'||ln==='href'||ln==='action'||ln==='srcset'||ln==='data-src'||ln==='data-lazy-src'||ln==='data-original'||ln==='data-lazy'||ln==='data-thumb'||ln==='data-image'||ln==='data-zoom'||ln==='data-zoom-image'||ln==='data-large_image'||ln==='data-large-image'||ln==='data-full'||ln==='data-srcset'||ln==='data-lazy-srcset'){
        if(ln==='srcset'||ln==='data-srcset'||ln==='data-lazy-srcset'){
          v=toProxySrcset(v);
        }else{
          v=toProxy(v);
        }
      }
    }
  }catch(e){}
  return _setAttr.call(this,n,v);
};
function patchProp(proto, prop, isSrcset){
  try{
    var desc=Object.getOwnPropertyDescriptor(proto, prop);
    if(!desc || !desc.set) return;
    var origSet=desc.set;
    var origGet=desc.get;
    Object.defineProperty(proto, prop, {
      set:function(v){
        try{
          if(typeof v==='string'){
            if(isSrcset) v=toProxySrcset(v);
            else v=toProxy(v);
          }
        }catch(e){}
        return origSet.call(this, v);
      },
      get:origGet,
      configurable:true
    });
  }catch(e){}
}
try{
  patchProp(HTMLImageElement.prototype,'src',false);
  patchProp(HTMLScriptElement.prototype,'src',false);
  patchProp(HTMLLinkElement.prototype,'href',false);
  patchProp(HTMLIFrameElement.prototype,'src',false);
  patchProp(HTMLAnchorElement.prototype,'href',false);
  patchProp(HTMLFormElement.prototype,'action',false);
  patchProp(HTMLSourceElement.prototype,'src',false);
  patchProp(HTMLSourceElement.prototype,'srcset',true);
  patchProp(HTMLImageElement.prototype,'srcset',true);
  if(window.HTMLVideoElement) patchProp(HTMLVideoElement.prototype,'src',false);
  if(window.HTMLAudioElement) patchProp(HTMLAudioElement.prototype,'src',false);
}catch(e){}
// --- Emalls / JS-heavy sites: block frame-busting, document.write wipe, etc (PHP 10.170 had no protection, but sandbox blocks top nav)
try{
  // Prevent document.write from wiping our toolbar/picker (common in Iranian shops)
  var _write=document.write.bind(document);
  var _writeln=document.writeln.bind(document);
  document.write=function(){
    try{
      var html=Array.prototype.join.call(arguments,'');
      if(html && html.indexOf('__s4bar')===-1){
        var div=document.createElement('div');
        div.innerHTML=html;
        // Append scripts/styles safely, ignore if it tries to replace whole doc
        while(div.firstChild){
          var node=div.firstChild;
          if(node.tagName==='SCRIPT'){
            var s=document.createElement('script');
            if(node.src) s.src=toProxy(node.src);
            else s.textContent=node.textContent;
            document.head.appendChild(s);
            div.removeChild(node);
          }else{
            document.body.appendChild(node);
          }
        }
      }
    }catch(e){try{_write.apply(document,arguments);}catch(e2){}}
  };
  document.writeln=function(){try{document.write.apply(document,arguments);}catch(e){}};
}catch(e){}
document.addEventListener('click',function(e){
  var a=e.target.closest('a');
  if(a&&!a.closest('#__s4bar')&&!a.closest('.__s4pop')){
    e.preventDefault();
    e.stopPropagation();
  }
},true);
window.open=function(){return null;};
// Block frame-busting attempts but preserve real parent for picker messaging
try{
  var __s4_realParent = window.parent;
  var __s4_realTop = window.top;
  window.__s4_realParent = __s4_realParent;
  window.__s4_realTop = __s4_realTop;
  try{Object.defineProperty(window,'top',{get:function(){return window;},configurable:false});}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window;},configurable:false});}catch(e){}
  if(window.__s4_realParent && window.__s4_realParent!==window){console.log('[S4] Real parent preserved for picker messaging');}
}catch(e){}
try{
  window.addEventListener('beforeunload',function(e){e.stopPropagation();e.preventDefault();},true);
}catch(e){}
try{
  var _createElement=document.createElement.bind(document);
  document.createElement=function(tag, opts){
    var el=_createElement(tag, opts);
    if(tag.toLowerCase()==='base'){
      setTimeout(function(){},0);
    }
    return el;
  };
}catch(e){}
console.log('[S4] Visual full mode active, originHost='+originHost+', indirect='+useIndirect);
})();</script>`;
}

const PICKER_JS=String.raw`<script>(function(){
${SNAPSHOT_LAYOUT_JS}
${SNAPSHOT_INTERACTION_JS}
const __s4post=(msg)=>{try{var rp=window.__s4_realParent||parent; rp.postMessage(msg,'*'); console.log('[S4] posted',msg.type,msg.mode||'');}catch(e){console.error('[S4] postMessage failed',e,msg); try{parent.postMessage(msg,'*');}catch(e2){console.error('[S4] fallback postMessage failed',e2);}}};
const context='__S4_CONTEXT__',bar=document.getElementById('__s4bar'),pop=document.getElementById('__s4pop'),modeSelect=document.getElementById('__s4mode'),selectorText=document.getElementById('__s4selector'),countText=document.getElementById('__s4count'),previewText=document.getElementById('__s4preview'),fieldText=document.getElementById('__s4field'),progressText=document.getElementById('__s4progress'),selections={};let selected=null,hovered=null;let GAL=[];let picking=true;
const labels={container:'کانتینر محصول',title:'عنوان',price:'قیمت',link:'لینک',image:'تصویر فهرست',shortDesc:'توضیحات کوتاه',longDesc:'توضیحات بلند',sku:'SKU',category:'دسته‌بندی',tags:'برچسب‌ها',weight:'وزن',stock:'موجودی',brand:'برند',detailImage:'عکس اصلی محصول',variations:'تنوع‌ها',galleryBox:'باکس گالری',galleryOne:'عکس‌های گالری'};
const fields=Array.from(modeSelect.options).map(o=>o.value);
const cssEscape=v=>window.CSS&&CSS.escape?CSS.escape(v):String(v).replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c.charCodeAt(0).toString(16)+' ');
function validId(v){return v&&v.length<64&&!/^(__|\d)/.test(v)&&!/^[a-f\d]{16,}$/i.test(v)}
function stableClass(v){return v&&v.length>1&&v.length<48&&!/^(__|active$|open$|show$|hide$|hidden$|selected$|current$|is-|js-|has-)/i.test(v)&&!/[a-f\d]{18,}/i.test(v)}
function matches(v){if(!v)return 0;try{return document.querySelectorAll(v).length}catch{return 0}}
function classCandidates(el){const tag=el.tagName.toLowerCase(),cls=Array.from(el.classList).filter(stableClass).slice(0,5),out=[];for(let s=Math.min(3,cls.length);s>=1;s--)out.push(tag+cls.slice(0,s).map(c=>'.'+cssEscape(c)).join(''));for(const c of cls)out.push(tag+'.'+cssEscape(c));return Array.from(new Set(out))}
function selector(el){
  if(!el||['BODY','HTML'].includes(el.tagName))return'';
  const tag=el.tagName.toLowerCase(),cands=classCandidates(el),repeat=context==='list'||modeSelect.value==='container';
  // Prefer selectors that are actually reusable for list/container fields. A unique class is
  // deliberately rejected there because it usually points at one arbitrary card rather than the field across cards.
  if(repeat){
    const rep=cands.find(v=>matches(v)>1);if(rep)return rep;
  }else{
    if(validId(el.id))return tag+'#'+cssEscape(el.id);
    const stable=cands[0];if(stable)return stable;
  }
  for(const attr of ['itemprop','data-testid','data-test','role']){
    const val=el.getAttribute(attr);
    if(val&&val.length<80){
      const cand=tag+'['+attr+'="'+String(val).replace(/["\\]/g,'\\$&')+'"]';
      if(!repeat||matches(cand)>1)return cand;
    }
  }
  if(validId(el.id))return tag+'#'+cssEscape(el.id);
  let p=el.parentElement,d=0;
  while(p&&d++<6){
    const pc=classCandidates(p);
    for(const base of pc){
      const cand=base+' '+tag;
      if(matches(cand)>1)return cand;
      if(!repeat&&matches(cand)===1)return cand;
    }
    if(validId(p.id))return p.tagName.toLowerCase()+'#'+cssEscape(p.id)+' '+tag;
    p=p.parentElement;
  }
  // Last resort: nth-of-type path makes a single element selectable instead of returning an unstable bare tag.
  const parts=[];let n=el;
  while(n&&n.nodeType===1&&n!==document.body&&parts.length<6){
    let idx=1;for(let x=n;x.previousElementSibling;x=x.previousElementSibling)if(x.tagName===n.tagName)idx++;
    parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+idx+')');n=n.parentElement;
  }
  return parts.join(' > ')||tag;
}
function getImageUrl(el){
  if(!el)return'';const attrs=['data-zoom-image','data-large_image','data-large-image','data-full','data-original','data-lazy-src','data-lazy','data-src','data-thumb','data-image','data-zoom','src'];
  if(el.tagName==='IMG'){for(const a of attrs){const v=el.getAttribute(a);if(v&&v.indexOf('placeholder')<0&&v.indexOf('1x1')<0)return v;}const ss=el.getAttribute('data-srcset')||el.getAttribute('srcset');if(ss){const first=ss.split(',')[0]?.trim().split(/\s+/)[0];if(first)return first;}}
  const img=el.querySelector('img');if(img){for(const a of attrs){const v=img.getAttribute(a);if(v&&v.indexOf('placeholder')<0&&v.indexOf('1x1')<0)return v;}const ss=img.getAttribute('data-srcset')||img.getAttribute('srcset');if(ss){const first=ss.split(',')[0]?.trim().split(/\s+/)[0];if(first)return first;}}
  return '';
}
function countImgs(el){if(!el)return 0;if(el.tagName==='IMG')return 1;try{return el.querySelectorAll('img,source,[data-src],[data-lazy-src],[data-original],[data-large_image],[data-zoom-image],[data-full],[data-thumb],[data-image]').length}catch{return 0}}
function countGalImgs(list){const seen={};let n=0;(list||[]).forEach(sel=>{try{document.querySelectorAll(sel).forEach(x=>{const els=x.tagName==='IMG'?[x]:Array.from(x.querySelectorAll('img'));els.forEach(im=>{const u=getImageUrl(im)||im.getAttribute('src')||'';if(u&&!seen[u]){seen[u]=1;n++;}});});}catch{}});return n;}
function __varNoise(v){if(!v)return true;if(v.length>60)return true;const bad=['انتخاب کنید','یک گزینه را انتخاب کنید','choose an option','select option','انتخاب گزینه','---','--','select'];const lv=v.toLowerCase();for(const b of bad)if(lv===b.toLowerCase())return true;return false;}
function __varValueOf(n){if(!n||n.nodeType!==1)return'';const tag=n.tagName.toLowerCase();if(tag==='input'||tag==='option'){for(const a of ['data-value','value','title','aria-label']){const v=(n.getAttribute(a)||'').trim();if(v&&v.toLowerCase()!=='choose an option')return v;}}for(const a of ['data-value','data-title','data-slug','data-color','data-colour','data-name','data-option','data-original-title','title','aria-label','alt']){const v=(n.getAttribute(a)||'').trim();if(v)return v;}const t=(n.textContent||'').replace(/\s+/g,' ').trim();if(t)return t;const img=tag==='img'?n:n.querySelector('img');if(img){for(const a of ['alt','title','data-title']){const v=(img.getAttribute(a)||'').trim();if(v)return v;}for(const a of ['src','data-src','data-lazy-src']){const src=(img.getAttribute(a)||'').trim();if(!src)continue;const b=src.replace(/[?#].*$/,'').split('/').pop().replace(/\.(png|jpe?g|gif|webp|svg|avif)$/i,'').replace(/[-_]|%20/g,' ').trim();if(b&&!/^\d+$/.test(b)&&b.length<=40)return b;}}const st=n.getAttribute('style')||'';const m=st.match(/background(?:-color)?\s*:\s*([^;]+)/i);if(m&&m[1].indexOf('url(')<0)return m[1].trim();const cm=(n.getAttribute('class')||'').match(/(?:color|colour|swatch)[-_]([a-z]{3,20})/i);if(cm)return cm[1];return'';}
function __varValues(box){if(!box)return[];const out=[],seen={};function push(v){v=(v||'').trim();if(__varNoise(v))return;const k=v.toLowerCase();if(seen[k])return;seen[k]=1;out.push(v);}['option','input[type=radio]','input[type=checkbox]'].forEach(q=>{box.querySelectorAll(q).forEach(n=>push(__varValueOf(n)));});if(out.length)return out;const sels=['li','label','button','a','span[data-value]','[class*=swatch]','[class*=variation]','[class*=color]','[class*=colour]','[class*=attribute]','[data-attribute_name]','img'];for(const s of sels){box.querySelectorAll(s).forEach(n=>push(__varValueOf(n)));if(out.length>1)return out;}if(out.length<=1){const kids=Array.from(box.children).filter(c=>!['SCRIPT','STYLE','BR'].includes(c.tagName));if(kids.length>1){const multi=[];kids.forEach(c=>{const v=(__varValueOf(c)||'').trim();if(v&&!__varNoise(v))multi.push(v);});const uniq={};let nu=0;multi.forEach(v=>{if(!uniq[v]){uniq[v]=1;nu++;}});if(nu>1){out.length=0;for(const k in seen)delete seen[k];multi.forEach(push);if(out.length>1)return out;}}}if(!out.length)push(__varValueOf(box));return out;}
function fieldLabel(m){return labels[m]||m;}
function fieldNext(dir){
  const cur=fields.indexOf(modeSelect.value);let idx=cur+dir;
  if(dir>0){
    for(let i=0;i<fields.length;i++){
      const j=(cur+1+i)%fields.length;
      if(!selections[fields[j]]?.selector){idx=j;break;}
    }
  }else{
    if(idx<0)idx=fields.length-1;
    if(idx>=fields.length)idx=0;
  }
  return fields[idx]||fields[0];
}
function preview(el,mode){
  if(!el)return'';if(mode==='link'){const a=el.closest('a[href]')||el.querySelector('a[href]');return a?.href||''}
  if(['image','detailImage','galleryOne'].includes(mode)){const u=getImageUrl(el);return u?('تک‌عکس: '+u.split('/').pop().substring(0,60)+' — مجموع '+countGalImgs(GAL.concat([selector(el)]))+' عکس یکتا'):'';}
  if(mode==='galleryBox'){const c=countImgs(el);if(!c)return'';const first=getImageUrl(el);return c+' عکس داخل این ظرف'+(first?(' — نمونه: '+first.split('/').pop().substring(0,40)):'');}
  if(mode==='variations'){const vv=__varValues(el);let ni=0;try{ni=el.querySelectorAll('img').length||el.querySelectorAll('[style*="background"],[data-image],[data-img],[data-src]').length}catch{}if(!vv.length){const t=(el.textContent||'').replace(/\s+/g,' ').trim();return t?('چیزی پیدا نشد — متن ظرف: '+t.substring(0,60)):(ni?('🖼 '+ni+' تصویر سواچ'):'(خالی)');}return vv.length+' گزینه'+(ni?(' · 🖼 '+ni+' عکس → گالری'):'')+' ← '+vv.join(' · ');}
  if(mode==='price'){const t=(el.textContent||'').replace(/\s+/g,' ').trim();const m=t.match(/[\d۰-۹٠-٩][,،٬\s\d۰-۹٠-٩]*[\d۰-۹٠-٩]/);return m?('💰 '+m[0].trim()):'(قیمتی پیدا نشد)';}
  return (el.textContent||'').replace(/\s+/g,' ').trim().substring(0,150);
}
function paintGallery(mode){
  document.querySelectorAll('.__s4gal').forEach(x=>x.classList.remove('__s4gal'));
  try{
    if(mode==='galleryBox'&&selected){
      selected.querySelectorAll('img').forEach(im=>im.classList.add('__s4gal'));
      if(selected.tagName==='IMG')selected.classList.add('__s4gal');
    }else if(mode==='galleryOne'){
      GAL.forEach(sel=>{document.querySelectorAll(sel).forEach(x=>{if(x.tagName==='IMG')x.classList.add('__s4gal');else x.querySelectorAll('img').forEach(im=>im.classList.add('__s4gal'));});});
    }
  }catch{}
}
function updateProgress(){const filled=Object.keys(selections).filter(k=>selections[k]?.selector).length;const extra=GAL.length?1:0;progressText.textContent=(filled+extra).toLocaleString('fa-IR')+' از '+fields.length.toLocaleString('fa-IR')+' فیلد ثبت‌شده'+(GAL.length?' — '+GAL.length+' سلکتور گالری تکی':'');}
function placePop(el,sel,count,mode){
  if(!pop||!el)return;const r=el.getBoundingClientRect(),vw=window.innerWidth||800,vh=window.innerHeight||600;pop.classList.add('__s4on');const pw=pop.offsetWidth||300,ph=pop.offsetHeight||60;let top=r.bottom+8,left=r.left;if(top+ph>vh)top=r.top-ph-8;if(left+pw>vw)left=vw-pw-8;if(left<4)left=4;if(top<4)top=4;pop.style.top=Math.round(top)+'px';pop.style.left=Math.round(left)+'px';
  const set=(id,on)=>{const b=document.getElementById(id);if(b)b.disabled=!on;};
  set('__s4pup',!!(el.parentElement&&el.parentElement.tagName!=='BODY'));set('__s4pdn',!!el.firstElementChild);set('__s4pprv',!!el.previousElementSibling);set('__s4pnxt',!!el.nextElementSibling);
  const psel=document.getElementById('__s4psel');if(psel)psel.textContent=sel||'—';
  const ppv=document.getElementById('__s4ppv');if(ppv){ppv.textContent=preview(el,mode)||'';ppv.className=preview(el,mode)?'':'__s4warn';}
  const pcnt=document.getElementById('__s4pcnt');if(pcnt)pcnt.textContent=count>1?count+' تطبیق':'';const pfld=document.getElementById('__s4pfld');if(pfld)pfld.textContent=fieldLabel(mode);
}
function paint(el){
  try{if(el&&el.nodeType!==1)el=el.parentElement;}catch{}
  console.log('[S4] paint try',el?.tagName, el?.className?.toString?.().slice(0,100)); if(!el||el===bar||el.closest('#__s4bar')||el.closest('.__s4pop')){console.log('[S4] paint blocked by bar/pop');return;}
  const mode=modeSelect.value;const target=(()=>{if(mode==='link')return el.closest('a[href]')||el.querySelector('a[href]')||el;if(['image','detailImage','galleryOne'].includes(mode))return(el.tagName==='IMG'?el:el.querySelector('img'))||el;return el;})();
  if(selected)selected.classList.remove('__s4picked');selected=target;selected.classList.add('__s4picked');
  const val=selector(target),cnt=matches(val),prev=preview(target,mode);
  if(mode==='galleryOne'){
    if(!GAL.includes(val))GAL.push(val);
    selections[mode]={selector:GAL.join('\\n'),count:countGalImgs(GAL),preview:GAL.length+' سلکتور — '+countGalImgs(GAL)+' عکس یکتا'};
    selectorText.textContent=GAL.join(' | ')+' | '+val;countText.textContent=countGalImgs(GAL.concat([val])).toLocaleString('fa-IR')+' عکس یکتا';previewText.textContent=prev;fieldText.textContent=fieldLabel(mode)+' — '+GAL.length+' انتخاب شده';
  }else{
    selections[mode]={selector:val,count:cnt,preview:prev};
    selectorText.textContent=val;countText.textContent=cnt.toLocaleString('fa-IR')+' مورد';previewText.textContent=prev||'پیش‌نمایشی پیدا نشد.';fieldText.textContent=fieldLabel(mode)||mode;
  }
  paintGallery(mode);placePop(target,val,cnt,mode);updateProgress();
  __s4post({type:'scraper4-picker-state',channel:'__S4_CHANNEL__',mode,val,cnt,prev,all:selections,gal:GAL},'*');
}
function restoreMode(){
  const mode=modeSelect.value;const stored=selections[mode];fieldText.textContent=fieldLabel(mode)+(mode==='galleryOne'&&GAL.length?' — '+GAL.length+' انتخاب':'');
  if(selected)selected.classList.remove('__s4picked');selected=null;document.querySelectorAll('.__s4gal').forEach(x=>x.classList.remove('__s4gal'));
  if(stored?.selector){
    if(mode==='galleryOne'&&GAL.length){
      selectorText.textContent=GAL.join('\\n');countText.textContent=countGalImgs(GAL).toLocaleString('fa-IR')+' عکس یکتا';previewText.textContent=GAL.length+' سلکتور تکی ثبت شده';
      try{GAL.forEach(sel=>{const el=document.querySelector(sel);if(el){el.classList.add('__s4picked');if(!selected)selected=el;}});}catch{}
      paintGallery(mode);
    }else{
      try{selected=document.querySelector(stored.selector);selected?.classList.add('__s4picked');}catch{}
      selectorText.textContent=stored.selector;countText.textContent=matches(stored.selector).toLocaleString('fa-IR')+' مورد';previewText.textContent=stored.preview||'ثبت شده است.';
      paintGallery(mode);
    }
  }else{
    selectorText.textContent='روی عنصر مربوط به «'+(fieldLabel(mode)||mode)+'» کلیک کنید';countText.textContent='۰ مورد';previewText.textContent='هنوز عنصری برای این فیلد انتخاب نشده است.';
  }
  updateProgress();
}
function sendOne(){
  const mode=modeSelect.value;if(mode==='galleryOne'){
    if(!GAL.length){previewText.textContent='ابتدا حداقل یک عکس تکی را انتخاب کنید.';return;}
    const sel=GAL.join('\\n');const cnt=countGalImgs(GAL);
    __s4post({type:'scraper4-selector',channel:'__S4_CHANNEL__',mode:'galleryOne',selector:sel,count:cnt,preview:GAL.length+' سلکتور — '+cnt+' عکس یکتا'},'*');
    return;
  }
  const item=selections[mode];if(!item?.selector){previewText.textContent='ابتدا یک عنصر را انتخاب کنید.';return;}
  __s4post({type:'scraper4-selector',channel:'__S4_CHANNEL__',mode,...item},'*');
  const next=fieldNext(1);modeSelect.value=next;restoreMode();
}
function move(dir){
  console.log('[S4] move',dir,'selected',selected?.tagName); if(!selected)return;let next=null;
  if(dir==='up')next=selected.parentElement;
  else if(dir==='down')next=selected.firstElementChild;
  else if(dir==='prev')next=selected.previousElementSibling;
  else if(dir==='next')next=selected.nextElementSibling;
  while(next&&next.closest&&(next.closest('#__s4bar')||next.closest('.__s4pop')))next=dir==='prev'?next.previousElementSibling:next.nextElementSibling;
  if(!next||['BODY','HTML'].includes(next.tagName))return;
  paint(next);
  try{const r=next.getBoundingClientRect(),vh=window.innerHeight||600;if(r.top<60||r.bottom>vh-20)next.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>placePop(next,selector(next),matches(selector(next)),modeSelect.value),300);}catch{}
}
function fieldStep(dir){const next=fieldNext(dir);modeSelect.value=next;restoreMode();const stored=selections[next];if(stored?.selector){try{const el=document.querySelector(stored.selector.split('\\n')[0]);if(el){if(selected)selected.classList.remove('__s4picked');selected=el;el.classList.add('__s4picked');placePop(el,stored.selector,matches(stored.selector),next);}}catch{}}}
const pauseBtn=document.getElementById('__s4pause');
function setPicking(v){picking=!!v;try{s4InteractionMode(picking);}catch(e){}if(pauseBtn){pauseBtn.textContent=picking?'⏸ توقف انتخاب':'▶ ادامه انتخاب';pauseBtn.setAttribute('aria-pressed',String(!picking));pauseBtn.classList.toggle('__s4on',!picking);}document.body.classList.toggle('__s4paused',!picking);if(!picking)document.querySelectorAll('.__s4hover').forEach(n=>n.classList.remove('__s4hover'));pop?.classList.remove('__s4on');}
// The picker always starts in selection mode. Keep the control label/state synchronized
// after the shared interaction/layout bootstrap so source-page scripts cannot leave the UI
// looking paused while the picker is expected to accept element clicks.
if(pauseBtn){pauseBtn.type='button';pauseBtn.setAttribute('aria-pressed','false');}

function __s4bind(id,fn){
  try{
    var el=document.getElementById(id);
    if(!el){console.warn('[S4] bind missing',id);return;}
    el.addEventListener('click',function(e){
      try{e.preventDefault();e.stopPropagation();}catch{}
      try{fn(e);}catch(err){console.error('[S4] handler error',id,err);}
    });
  }catch(err){console.error('[S4] bind error',id,err);}
}
if(pauseBtn)__s4bind('__s4pause',()=>setPicking(!picking));
window.addEventListener('mouseover',e=>{if(!picking)return;const t=e.target;if(!(t instanceof Element)||t.closest('#__s4bar')||t.closest('.__s4pop'))return;if(hovered&&hovered!==selected)hovered.classList.remove('__s4hover');hovered=t;if(t!==selected)t.classList.add('__s4hover');},true);
window.addEventListener('mouseout',e=>{if(!picking)return;const t=e.target;if(t instanceof Element&&t!==selected)t.classList.remove('__s4hover');},true);
window.addEventListener('click',e=>{const t=e.target;if(!(t instanceof Element)||t.closest('#__s4bar')||t.closest('.__s4pop'))return;if(!picking){try{s4SnapshotClick(e);}catch{}return;}e.preventDefault();e.stopPropagation();paint(t);},true);
modeSelect.addEventListener('change',restoreMode);
__s4bind('__s4up',()=>move('up'));__s4bind('__s4down',()=>move('down'));__s4bind('__s4prev',()=>move('prev'));__s4bind('__s4next',()=>move('next'));
__s4bind('__s4pup',()=>move('up'));__s4bind('__s4pdn',()=>move('down'));__s4bind('__s4pprv',()=>move('prev'));__s4bind('__s4pnxt',()=>move('next'));
__s4bind('__s4pfprev',()=>fieldStep(-1));__s4bind('__s4pfnext',()=>fieldStep(1));__s4bind('__s4pfld',()=>fieldStep(1));
__s4bind('__s4save',sendOne);__s4bind('__s4pok',sendOne);
const done=document.getElementById('__s4done');if(done)__s4bind('__s4done',()=>{if(GAL.length)selections['galleryOne']={selector:GAL.join('\\n'),count:countGalImgs(GAL),preview:GAL.length+' سلکتور تکی'};__s4post({type:'scraper4-detail-selectors',channel:'__S4_CHANNEL__',selections},'*');});
__s4bind('__s4refresh',()=>__s4post({type:'scraper4-refresh',channel:'__S4_CHANNEL__'},'*'));
__s4bind('__s4full',()=>__s4post({type:'scraper4-toggle-full',channel:'__S4_CHANNEL__'},'*'));
(function(){
  try{
    var prog=document.getElementById('__s4bprog');
    var bar=document.getElementById('__s4bprogBar');
    if(!prog||!bar)return;
    var progress=0;
    function show(){prog.style.display='block';prog.classList.add('__s4loading');prog.classList.remove('__s4done');bar.style.width='0%';progress=0;}
    function setP(p){progress=Math.max(progress,p);bar.style.width=progress+'%';}
    function doneP(){prog.classList.remove('__s4loading');prog.classList.add('__s4done');bar.style.width='100%';setTimeout(function(){prog.style.display='none';},600);}
    show();
    var iv=setInterval(function(){if(progress<85){setP(progress+Math.random()*12);}else{clearInterval(iv);}},300);
    window.addEventListener('load',function(){clearInterval(iv);setP(100);doneP();});
    try{
      var imgs=document.querySelectorAll('img');
      var imgCount=imgs.length;
      var loaded=0;
      if(imgCount===0){setP(60);}
      imgs.forEach(function(img){
        if(img.complete){loaded++;}else{
          img.addEventListener('load',function(){loaded++;setP(30+ (loaded/Math.max(1,imgCount))*60);});
          img.addEventListener('error',function(){loaded++;setP(30+ (loaded/Math.max(1,imgCount))*60);});
        }
      });
    }catch{}
    setTimeout(function(){clearInterval(iv);setP(100);doneP();},7000);
    window.__s4setProgress=setP;
    window.__s4doneProgress=doneP;
  }catch(e){console.error('[S4] progress error',e);}
})();
document.addEventListener('keydown',e=>{
  if(e.target?.closest?.('#__s4bar'))return;
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement)return;
  if(e.key==='Tab'){e.preventDefault();fieldStep(e.shiftKey?-1:1);return;}
  if(!picking&&e.key!=='Escape')return;
  if(e.key==='ArrowUp'){e.preventDefault();move('up');}
  else if(e.key==='ArrowDown'){e.preventDefault();move('down');}
  else if(e.key==='ArrowRight'){e.preventDefault();move('prev');}
  else if(e.key==='ArrowLeft'){e.preventDefault();move('next');}
  else if(e.key===' '||e.key==='Spacebar'){e.preventDefault();fieldStep(1);}
  else if(e.key==='Enter'){e.preventDefault();done?done.click():sendOne();}
  else if(e.key==='Escape'){e.preventDefault();if(modeSelect.value==='galleryOne'){GAL=[];delete selections['galleryOne'];document.querySelectorAll('.__s4gal').forEach(x=>x.classList.remove('__s4gal'));}else delete selections[modeSelect.value];if(selected)selected.classList.remove('__s4picked');selected=null;pop?.classList.remove('__s4on');restoreMode();__s4post({type:'scraper4-picker-hint',channel:'__S4_CHANNEL__',msg:'انتخاب پاک شد.'},'*');}
},true);
let _rp=null;function repos(){if(!selected)return;clearTimeout(_rp);_rp=setTimeout(()=>{try{placePop(selected,selector(selected),matches(selector(selected)),modeSelect.value);}catch{}},40);}
window.addEventListener('scroll',repos,true);window.addEventListener('resize',repos);
window.addEventListener('message',e=>{if((e.source!==(window.__s4_realParent||parent))&&e.source!==parent||e.data?.channel!=='__S4_CHANNEL__')return;const d=e.data;if(d.type==='scraper4-mode'&&fields.includes(d.mode)){modeSelect.value=d.mode;restoreMode();}else if(d.type==='picker_clear_gal'){GAL=[];delete selections['galleryOne'];document.querySelectorAll('.__s4gal').forEach(x=>x.classList.remove('__s4gal'));restoreMode();}else if(d.type==='scraper4-container'){try{const el=document.querySelector(d.selector);if(el)paint(el);}catch{}}});
restoreMode();\nsetPicking(true);\nwindow.addEventListener('error',e=>{try{__s4post({type:'scraper4-picker-error',channel:'__S4_CHANNEL__',msg:String(e?.message||'خطای JavaScript'),source:String(e?.filename||'').slice(-180),line:Number(e?.lineno)||0});}catch{}});\nwindow.addEventListener('unhandledrejection',e=>{try{__s4post({type:'scraper4-picker-error',channel:'__S4_CHANNEL__',msg:String(e?.reason?.message||e?.reason||'Promise rejection')});}catch{}});\n__s4post({type:'scraper4-picker-ready',channel:'__S4_CHANNEL__'},'*');
})();</script>`;

function pickerScript(context:VisualContext,channel:string){return PICKER_JS.replace('__S4_CONTEXT__',context).replaceAll('__S4_CHANNEL__',channel.replace(/[^a-z0-9-]/gi,''))}
function escapeAttr(value:string):string{return value.replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
function absolutize(value:string,base:string):string{try{return new URL(value,base).href}catch{return value}}
function proxyUrl(value:string,base:string,indirect=false):string{
  try{
    const abs=absolutize(value,base);
    if(!abs||/^(data:|blob:|javascript:|#|mailto:|about:)/i.test(abs))return abs;
    const prefix = indirect ? '/api/rp?indirect=1&url=' : '/api/rp?url=';
    return `${prefix}${encodeURIComponent(abs)}`;
  }catch{return value}
}
// For static HTML rewriting we now ABSOLUTIZE to finalUrl (like PHP 10.170 did),
// NOT proxy via /api/rp. Static resources load directly from origin (works on same server).
// Dynamic JS loads (fetch/XHR/setAttribute/property) are still proxied via fullModeJs toProxy.
function absolutizeUrl(value:string,base:string):string{
  try{
    const abs=absolutize(value,base);
    if(!abs||/^(data:|blob:|javascript:|#|mailto:|about:)/i.test(abs))return abs;
    return abs;
  }catch{return value}
}

function rewriteHtml(html:string,baseUrl:string,full=false,indirect=false):string{
  // PHP 10.170 parity: remove base/CSP/refresh, keep scripts when full=1
  html=html.replace(/<base\b[^>]*>/gi,'').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,'').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,'');
  if(!full){
    html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<script\b[^>]*\/?>/gi,'').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\s+(href|src|action)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi,'');
  }
  // Rewrite to ABSOLUTE URLs (not proxy) for static resources - direct load from origin
  const attrs=['src','href','data-src','data-lazy-src','data-original','data-lazy','data-thumb','data-image','data-zoom','data-large_image','data-large-image','data-zoom-image','data-full','data-srcset','data-lazy-srcset'];
  for(const attr of attrs){
    const re=new RegExp(`(<(?:img|source|video|audio|link|script|iframe|a)\\b[^>]*?\\s${attr}\\s*=\\s*)(["'])(.*?)\\2`,'gi');
    html=html.replace(re,(m,pre,q,url)=>{
      if(!url||/^(data:|blob:|#|mailto:|javascript:|about:)/i.test(url)||url.startsWith('/api/rp'))return m;
      return `${pre}${q}${escapeAttr(absolutizeUrl(url,baseUrl))}${q}`;
    });
  }
  html=html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi,(m,q,content)=>{
    const parts=content.split(',').map((p:string)=>{
      const trimmed=p.trim();
      if(!trimmed)return trimmed;
      const [url,...rest]=trimmed.split(/\s+/);
      if(!url||/^(data:|blob:)/i.test(url)||url.startsWith('/api/rp'))return trimmed;
      return [absolutizeUrl(url,baseUrl),...rest].join(' ');
    });
    return `srcset=${q}${parts.join(', ')}${q}`;
  });
  html=html.replace(/\bdata-srcset\s*=\s*(["'])(.*?)\1/gi,(m,q,content)=>{
    const parts=content.split(',').map((p:string)=>{
      const trimmed=p.trim();
      if(!trimmed)return trimmed;
      const [url,...rest]=trimmed.split(/\s+/);
      if(!url||/^(data:|blob:)/i.test(url)||url.startsWith('/api/rp'))return trimmed;
      return [absolutizeUrl(url,baseUrl),...rest].join(' ');
    });
    return `data-srcset=${q}${parts.join(', ')}${q}`;
  });
  html=html.replace(/style\s*=\s*(["'])(.*?)\1/gi,(m,q,style)=>{
    const rewritten=style.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(mm: string, qq: string, url: string)=>{
      if(!url||/^(data:|blob:)/i.test(url)||url.startsWith('/api/rp'))return mm;
      return `url(${qq}${absolutizeUrl(url,baseUrl)}${qq})`;
    });
    return `style=${q}${rewritten}${q}`;
  });
  html=html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi,(m,css)=>{
    const rewritten=css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(mm: string, qq: string, url: string)=>{
      if(!url||/^(data:|blob:)/i.test(url)||url.startsWith('/api/rp'))return mm;
      return `url(${qq}${absolutizeUrl(url,baseUrl)}${qq})`;
    });
    return `<style>${rewritten}</style>`;
  });
  // Ensure img with data-src gets src if missing - absolutize
  html=html.replace(/<(img|source)\b([^>]*?)>/gi,(m,tag,attrsStr)=>{
    const hasSrc=/\ssrc\s*=/i.test(attrsStr);
    const dataMatch=attrsStr.match(/\sdata-(?:src|lazy-src|original|thumb|image|zoom|large_image|large-image|zoom-image|full)\s*=\s*(["'])(.*?)\1/i);
    if(!hasSrc&&dataMatch){
      const url=dataMatch[2];
      if(url&&!/^(data:|blob:)/i.test(url)){
        return `<${tag} ${attrsStr} src="${escapeAttr(absolutizeUrl(url,baseUrl))}">`;
      }
    }
    if(dataMatch){
      const url=dataMatch[2];
      if(url){
        return m.replace(/\ssrc\s*=\s*(["']).*?\1/i,` src="${escapeAttr(absolutizeUrl(url,baseUrl))}"`);
      }
    }
    return m;
  });
  return html;
}

export async function renderVisualSelector(ticketId:string,context:VisualContext='list',full=false):Promise<Response>{
  const ticket=await consumeTicket(ticketId),page=await sourceText(ticket.url,Boolean(ticket.indirect),5_000_000),finalUrl=page.url,contentType=page.contentType||'';
  if(!contentType.includes('text/html'))throw new Error('صفحهٔ انتخاب‌شده HTML نیست.');
  let html=page.text;
  const baseTag=`<base href="${escapeAttr(finalUrl)}">`;
  html=rewriteHtml(html,finalUrl,full,Boolean(ticket.indirect));
  const fmJs = full ? fullModeJs(Boolean(ticket.indirect)) : '';
  const head=`${baseTag}${STYLE}${fmJs}`,body=`${toolbar(context,full)}${pickerScript(context,ticketId)}`;
  html=/<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,match=>match+head):`<head>${head}</head>${html}`;
  html=/<\/body\s*>/i.test(html)?html.replace(/<\/body\s*>/i,body+'</body>'):html+body;
  const trusted=pickerScript(context,ticketId).replace(/^<script>/,'').replace(/<\/script>$/,'');
  const fullTrusted=full?fmJs.replace(/^<script>/,'').replace(/<\/script>$/,''):'';
  const combined=trusted+fullTrusted;
  const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(combined)))));
  const hash2=full?btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fullTrusted))))):'';
  // PHP 10.170 parity: full mode must be permissive for Emalls/Snappshop. PHP had no CSP at all.
  const csp=full
    ? `sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads; default-src * data: blob: https: http:; script-src * data: blob: https: http: 'unsafe-inline' 'unsafe-eval' 'sha256-${hash}' ${hash2?`'sha256-${hash2}'`:''}; style-src * data: blob: https: http: 'unsafe-inline'; img-src * data: blob: https: http:; font-src * data: blob: https: http:; connect-src * data: blob: https: http: ws: wss:; frame-src * data: blob: https: http:; object-src * data: blob: https: http:; base-uri * data: blob: https: http:; form-action * data: blob: https: http:;`
    : `sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline' https:; img-src data: blob: https: http:; font-src data: https:; script-src 'sha256-${hash}'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri https:;`;
  return new Response(html,{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','content-security-policy':csp,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}})
}
