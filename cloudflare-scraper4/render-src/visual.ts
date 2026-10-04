import {SNAPSHOT_INTERACTION_JS,SNAPSHOT_LAYOUT_JS,SNAPSHOT_LAYOUT_CSS} from '../worker-src/visual-interactions.js';
import type {VisualReadinessOptions} from './visual-readiness.js';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as cheerio from 'cheerio';
import { config } from './config.js';
import { safeText } from './network.js';
import { renderBrowserSnapshot, VISUAL_BROWSER_ENGINES } from './visual-browser.js';

const ephemeralSecret = randomBytes(32).toString('hex');
const secret = () => config.adminToken || ephemeralSecret;

type Ticket = VisualReadinessOptions & { url: string; expires: number; engine?: string; indirect?: boolean; channel?: string; full?: boolean };
export type VisualOptions = VisualReadinessOptions & { engine?: string; indirect?: boolean; full?: boolean };

export function createVisualTicket(url: string, options: VisualOptions = {}): string {
  const payload: Ticket = { context:options.context==='detail'?'detail':'list',container:String(options.container||'').slice(0,2000),url, expires: Date.now() + 5 * 60_000, engine: String(options.engine||'auto'), indirect: Boolean(options.indirect), full: Boolean(options.full), channel: randomBytes(24).toString('hex') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function readVisualTicket(ticket: string): Ticket {
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature) throw new Error('Visual selector ticket is invalid');
  const expected = createHmac('sha256', secret()).update(encoded).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Visual selector ticket signature is invalid');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Ticket;
  if (!payload.url || payload.expires < Date.now()) throw new Error('Visual selector ticket has expired');
  return payload;
}

export async function renderVisualSelector(ticket: string, fullOverride?: boolean): Promise<string> {
  const { url, engine='auto', indirect=false, channel='',context='list',container='', full=false } = readVisualTicket(ticket);
  const useFull = fullOverride !== undefined ? fullOverride : Boolean(full);
  const page = VISUAL_BROWSER_ENGINES.has(engine) ? await renderBrowserSnapshot(url,engine,indirect,undefined,{context,container}) : await safeText(url, 6_000_000, {indirect});
  return sanitizeVisualSnapshot(page,engine,channel, useFull);
}

function fullModeJsNode(): string {
  // Enhanced Node full mode - parity with worker fullModeJs for Emalls/Snappshop
  // Includes proxy via /api/rp for cross-origin/API, frame-busting block, document.write override
  return `<script>(function(){
var proxy='/api/rp?url=';
var proxyBase='/api/rp?url=';
var originHost=(function(){try{return new URL(document.baseURI||location.href).hostname;}catch(e){return '';}})();
console.log('[S4] Visual full mode active (Node), originHost='+originHost);
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
    if(abs.startsWith('http://')||abs.startsWith('https://')){
      var isApi=/\\/(api|graphql|search|ajax|_next\\/data|wp-json)\\//i.test(abs) || /\\.(json)(\\?|$)/i.test(abs);
      if(!isApi && isSameHost(abs)){
        return abs;
      }
      return proxyBase+encodeURIComponent(abs);
    }
    return abs;
  }catch(e){return u;}
}
function toProxyForce(u){
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
    if(abs.startsWith('http://')||abs.startsWith('https://')){
      // Same host (emalls.ir) should NOT be proxied - direct fetch works and avoids 503 when rp is down
      if(isSameHost(abs)) return abs;
      // Only proxy API/json or cross-origin, not same-host static assets
      var isApi=/\/(api|graphql|search|ajax|_next\/data|wp-json)\//i.test(abs) || /\.(json)(\?|$)/i.test(abs);
      if(isApi) return proxyBase+encodeURIComponent(abs);
      // For Emalls/Snappshop: allow direct for images, css, js on same host
      return abs;
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
try{
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
}catch(e){}
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
    try{Object.setOwnPropertyDescriptors(window.Request, Object.getOwnPropertyDescriptors(_OrigRequest));}catch(e){}
  }
}catch(e){}
try{
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    try{
      if(typeof u==='string'){
        arguments[1]=toProxyForce(u);
      }
    }catch(e){}
    return _open.apply(this,arguments);
  };
}catch(e){}
try{
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
}catch(e){}
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
try{
  var _write=document.write.bind(document);
  var _writeln=document.writeln.bind(document);
  document.write=function(){
    try{
      var html=Array.prototype.join.call(arguments,'');
      if(html && html.indexOf('__s4bar')===-1){
        var div=document.createElement('div');
        div.innerHTML=html;
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
try{
  Object.defineProperty(window,'top',{get:function(){return window;},configurable:false});
  Object.defineProperty(window,'parent',{get:function(){return window;},configurable:false});
}catch(e){}
try{
  window.addEventListener('beforeunload',function(e){e.stopPropagation();e.preventDefault();},true);
}catch(e){}
try{
  window.open=function(){return null;};
}catch(e){}
document.addEventListener('click',function(e){
  var a=e.target.closest('a');
  if(a&&!a.closest('#__s4bar')&&!a.closest('.__s4pop')){
    e.preventDefault();
    e.stopPropagation();
  }
},true);
})();</script>`;
}

export function sanitizeVisualSnapshot(page:{text:string;url:string;browserDiagnostics?:{visualReadiness?:any;javascriptErrors?:string[];pendingCriticalResources?:number;crashRecovered?:boolean;urlWarning?:string;criticalResourceFailed?:boolean;failedResources?:any[]}},engine='auto',channel='', full=false): string {
  const $ = cheerio.load(page.text, { scriptingEnabled: false });
  if (full) {
    // Full mode for Emalls/Snappshop: keep scripts, remove only dangerous object/embed/form/noscript and CSP/refresh meta, keep base for rewriting then replace
    $('object,embed,form,noscript,meta[http-equiv="Content-Security-Policy"],meta[http-equiv="content-security-policy"],meta[http-equiv="refresh"]').remove();
  } else {
    $('script,iframe,object,embed,form,noscript,base,meta').remove();
  }
  $('[id]').each((_i,el)=>{if(String($(el).attr('id')).startsWith('__s4'))$(el).removeAttr('id')});
  $('meta[http-equiv="Content-Security-Policy"],meta[http-equiv="content-security-policy"],meta[http-equiv="refresh"],base').remove();
  $('a').each((_i,el)=>{const node=$(el);try{node.attr('data-s4-href',new URL(node.attr('href')||'',page.url).href)}catch{}node.attr('href','#').removeAttr('target')});
  $('*').each((_i, el) => {
    for (const name of Object.keys(('attribs' in el ? el.attribs : {}) || {})) {
      if (/^on/i.test(name) || ['srcdoc', 'nonce'].includes(name.toLowerCase())) $(el).removeAttr(name);
    }
  });
  // Resolve resources - include data-* lazy-load attrs (Emalls uses data-src)
  const DATA_ATTRS = ['src','href','poster','data-src','data-lazy-src','data-original','data-lazy','data-thumb','data-image','data-zoom','data-zoom-image','data-large_image','data-large-image','data-full','data-srcset','data-lazy-srcset'];
  $('*').each((_i, el) => {
    const node = $(el);
    for (const attr of DATA_ATTRS) {
      const raw = node.attr(attr); if (!raw || raw === '#') continue;
      if (attr.includes('srcset')) continue;
      try {
        const absolute = new URL(raw, page.url);
        if (!['http:','https:','data:'].includes(absolute.protocol) || privateLiteral(absolute.hostname)) {
          if (['src','href','poster'].includes(attr)) node.removeAttr(attr);
        } else {
          if (attr.startsWith('data-') && !node.attr('src') && (el as any).tagName === 'img') {
            node.attr('src', absolute.href);
          }
          node.attr(attr, absolute.href);
        }
      } catch { if (['src','href','poster'].includes(attr)) node.removeAttr(attr); }
    }
  });
  $('[srcset],[data-srcset],[data-lazy-srcset]').each((_i, el) => {
    const node = $(el);
    for (const attr of ['srcset','data-srcset','data-lazy-srcset']) {
      const raw = node.attr(attr); if (!raw) continue;
      const resolved = raw.split(',').map(part => { const [value, size=''] = part.trim().split(/\s+/,2); try { const absolute = new URL(value, page.url); return privateLiteral(absolute.hostname) ? '' : `${absolute.href} ${size}`.trim(); } catch { return ''; } }).filter(Boolean).join(', ');
      if (resolved) {
        node.attr(attr, resolved);
        if (attr !== 'srcset' && !node.attr('srcset')) node.attr('srcset', resolved);
      } else node.removeAttr(attr);
    }
  });
  if (full) {
    $('head').prepend(`<base href="${page.url.replace(/"/g,'&quot;')}">`);
  }
  $('head').prepend('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin><link rel="preconnect" href="https://cdn.fontcdn.ir" crossorigin><link rel="preconnect" href="https://unpkg.com" crossorigin><style>@font-face{font-family:Vazirmatn;src:url(https://cdn.fontcdn.ir/Fonts/Vazirmatn/Vazirmatn-Regular.woff2) format(woff2),url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2) format(woff2),url(https://unpkg.com/vazirmatn@33.003/fonts/webfonts/Vazirmatn-Regular.woff2) format(woff2),local(Vazirmatn),local(Vazir);font-weight:400;font-display:swap}@font-face{font-family:Vazirmatn;src:url(https://cdn.fontcdn.ir/Fonts/Vazirmatn/Vazirmatn-Bold.woff2) format(woff2),url(https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2) format(woff2),url(https://unpkg.com/vazirmatn@33.003/fonts/webfonts/Vazirmatn-Bold.woff2) format(woff2),local(Vazirmatn);font-weight:700;font-display:swap}</style><link rel="stylesheet" href="/assets/fonts/vazirmatn.css">');
  $('head').append(`<style>@font-face{font-family:Vazirmatn;src:local(Vazirmatn);font-display:swap}body{font-family:Vazirmatn,Vazir,Tahoma,sans-serif!important}${PICKER_CSS}${SNAPSHOT_LAYOUT_CSS}</style>`);
  if (full) {
    $('head').prepend(fullModeJsNode());
  }
  $('body').prepend(TOOLBAR);
  $('#__s4bar').prepend($('<span>').attr('id','__s4engine').text((full?'کامل JS · ':'')+(VISUAL_BROWSER_ENGINES.has(engine)?'DOM رندرشده · '+engine+' · تصویر ثابت صفحه، نه مرورگر تعاملی':'HTML مستقیم · '+engine)));
  const warnings=$('<details>').attr('id','__s4warnings');
  if(full) warnings.append($('<span>').text('حالت کامل JS فعال — برای سایت‌های مثل ایمالز/اسنپ‌شاپ که با JS لود می‌شوند. اسکریپت‌ها حفظ شدند.'));
  if(page.browserDiagnostics?.crashRecovered)warnings.append($('<span>').text('بازیابی پس از crash · بارگذاری سبک؛ تصویر، ویدیو و فونت در مرحلهٔ رندر دریافت نشدند.'));
  if(page.browserDiagnostics?.criticalResourceFailed)warnings.append($('<span>').text('هشدار: بعضی منابع JavaScript یا API ناموفق بودند؛ این تصویر ممکن است ناقص باشد. '+(page.browserDiagnostics.failedResources||[]).slice(0,3).map(f=>f.type+' '+f.reason).join(' · ')));
  if(page.browserDiagnostics?.visualReadiness?.context==='list')warnings.append($('<span>').text('کاندیدای محصول در DOM: '+String(page.browserDiagnostics.visualReadiness.candidates||0)+'؛ این عدد تضمین کامل‌بودن فهرست نیست.'));
  if(page.browserDiagnostics?.visualReadiness?.selectorError)warnings.append($('<span>').text(page.browserDiagnostics.visualReadiness.selectorError));
  if(page.browserDiagnostics?.pendingCriticalResources)warnings.append($('<span>').text('هشدار: درخواست‌های JavaScript/API هنوز کامل نشده‌اند؛ تصویر ممکن است ناقص باشد.'));
  if(page.browserDiagnostics?.visualReadiness?.selectorMismatch)warnings.append($('<span>').text('سلکتور ظرف فعلی پیدا نشد؛ محتوای محصول با نشانه‌های عمومی دیده شد. سلکتور ذخیره‌شده تغییر نکرد.'));
  if(page.browserDiagnostics?.javascriptErrors?.length)warnings.append($('<span>').text('هشدار خطای JavaScript: '+page.browserDiagnostics.javascriptErrors.join(' · ')));
  if(page.browserDiagnostics?.urlWarning)warnings.append($('<span>').text(page.browserDiagnostics.urlWarning));
  if(warnings.children().length){const count=warnings.children().length;warnings.prepend($('<summary>').text('هشدارها و وضعیت رندر ('+count+')'));$('#__s4bar').append(warnings);}
  $('body').append(`<script>${pickerSource(channel)}</script>`);
  return $.html();
}

function privateLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g,'');
  return h === 'localhost' || h === '::1' || h === '::' || h.startsWith('fc') && h.includes(':') || h.startsWith('fd') && h.includes(':') || h.startsWith('fe80:') || h.endsWith('.internal') || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

const TOOLBAR = `<div id="__s4bar"><select id="__s4mode"><option value="container">📦 کانتینر</option><option value="title">📝 عنوان</option><option value="price">💰 قیمت</option><option value="link">🔗 لینک</option><option value="image">🖼 تصویر</option><option value="shortDesc">توضیح کوتاه</option><option value="longDesc">توضیح کامل</option><option value="sku">SKU</option><option value="brand">برند</option><option value="stock">موجودی</option><option value="weight">وزن</option><option value="category">دسته‌بندی</option><option value="gallery">گالری</option><option value="specs">جدول مشخصات</option></select><button id="__s4up">⬆ والد</button><button id="__s4down">⬇ فرزند</button><code id="__s4selector">روی عنصر مورد نظر کلیک کنید</code><span id="__s4count">۰</span><button id="__s4pause" title="موقتاً انتخاب را خاموش کن">⏸ توقف انتخاب</button><button id="__s4refresh" title="دریافت دوبارهٔ صفحه؛ انتخاب‌های ثبت‌شده حفظ می‌شوند">↻ ریفرش</button><button id="__s4dismiss" disabled title="در حالت توقف، پاپ‌آپ را فقط از این تصویر پنهان کن">پنهان‌کردن پاپ‌آپ</button><span id="__s4interaction" role="status">تصویر ثابت؛ ثبت و رفتن به فیلد بعدی</span><button id="__s4save">✓ ثبت و بعدی</button></div>`;
const PICKER_CSS = `#__s4bar{position:fixed!important;z-index:2147483647!important;top:0!important;left:0!important;right:0!important;min-height:48px!important;background:#0f172af2!important;color:#fff!important;border-bottom:2px solid #a855f7!important;display:flex!important;align-items:center!important;gap:6px!important;padding:6px 9px!important;font:12px Vazirmatn,Vazir,Tahoma,sans-serif!important;direction:rtl!important;box-shadow:0 4px 18px #0008!important}#__s4bar select,#__s4bar button{width:auto!important;min-width:0!important;background:#334155!important;color:#fff!important;border:1px solid #64748b!important;border-radius:6px!important;padding:7px 9px!important;font:11px Vazirmatn,Vazir,Tahoma!important;cursor:pointer!important}#__s4bar #__s4save{background:#22c55e!important;color:#052e16!important;border-color:#22c55e!important;font-weight:bold!important}#__s4selector{flex:1!important;direction:ltr!important;text-align:left!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;background:#020617!important;color:#f0abfc!important;padding:7px!important;border-radius:5px!important}#__s4count{color:#67e8f9!important;white-space:nowrap!important}.__s4hover{outline:3px solid #a855f7!important;outline-offset:2px!important;cursor:crosshair!important}.__s4picked{outline:4px solid #22c55e!important;outline-offset:2px!important}body{padding-top:52px!important}@media(max-width:650px){#__s4bar{flex-wrap:wrap!important}#__s4selector{order:3;flex-basis:75%!important}body{padding-top:90px!important}}`;
const PICKER_JS = String.raw`(()=>{${SNAPSHOT_LAYOUT_JS}
${SNAPSHOT_INTERACTION_JS}
let current=null,hover=null,containerSel='';const bar=document.getElementById('__s4bar'),mode=document.getElementById('__s4mode'),label=document.getElementById('__s4selector'),count=document.getElementById('__s4count');const esc=v=>{try{return CSS.escape(v)}catch{return String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&')}};function selector(el){if(!el||el===document.body||el===document.documentElement)return el?.tagName?.toLowerCase()||'body';if(el.id){const s='#'+esc(el.id);if(document.querySelectorAll(s).length===1)return s}const parts=[];let node=el;while(node&&node!==document.body&&parts.length<5){let part=node.tagName.toLowerCase();const classes=[...node.classList].filter(x=>!x.startsWith('__s4')).slice(0,2);if(classes.length)part+='.'+classes.map(esc).join('.');let s=part;try{if(document.querySelectorAll(s).length===1){parts.unshift(part);break}}catch{}const siblings=node.parentElement?[...node.parentElement.children].filter(x=>x.tagName===node.tagName):[];if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(node)+1)+')';parts.unshift(part);node=node.parentElement}return parts.join(' > ')}function generalize(el,s){if(!s||s.indexOf(':nth-of-type(')<0)return s;const loose=s.replace(/:nth-of-type\(\d+\)/g,'');try{const hits=[...document.querySelectorAll(loose)];if(hits.length>1&&hits.indexOf(el)>=0)return loose}catch{}return s}function relative(el,s){if(!containerSel||!s)return s;try{const card=el.closest(containerSel);if(!card)return s;let node=el,parts=[];while(node&&node!==card&&parts.length<5){let part=node.tagName.toLowerCase();const classes=[...node.classList].filter(x=>!x.startsWith('__s4')).slice(0,2);if(classes.length)part+='.'+classes.map(esc).join('.');const sibs=node.parentElement?[...node.parentElement.children].filter(x=>x.tagName===node.tagName):[];if(sibs.length>1&&node.parentElement!==card)part+=':nth-of-type('+(sibs.indexOf(node)+1)+')';parts.unshift(part);node=node.parentElement}if(node!==card||!parts.length)return s;const rel=parts.join(' > ');if(card.querySelectorAll(rel).length)return rel}catch{}return s}function choose(el){if(current)current.classList.remove('__s4picked');current=el;current.classList.add('__s4picked');let s=selector(current);s=mode.value==='container'?generalize(current,s):relative(current,s);label.textContent=s;try{count.textContent=document.querySelectorAll(s).length+' مورد'}catch{count.textContent='نامعتبر'}}document.addEventListener('mouseover',e=>{if(!picking)return;if(bar.contains(e.target))return;if(hover)hover.classList.remove('__s4hover');hover=e.target;hover.classList.add('__s4hover')},true);document.addEventListener('mouseout',e=>{if(e.target?.classList)e.target.classList.remove('__s4hover')},true);let picking=true;const pauseBtn=document.getElementById('__s4pause');function setPicking(v){picking=v;s4InteractionMode(picking);pauseBtn.textContent=picking?'\u23f8 \u062a\u0648\u0642\u0641 \u0627\u0646\u062a\u062e\u0627\u0628':'\u25b6 \u0627\u062f\u0627\u0645\u0647 \u0627\u0646\u062a\u062e\u0627\u0628';pauseBtn.style.background=picking?'':'#f59e0b';pauseBtn.style.color=picking?'':'#111827';}pauseBtn.onclick=()=>setPicking(!picking);// Paused controls operate on this sanitized snapshot only.
document.addEventListener('click',e=>{if(bar.contains(e.target))return;if(!picking){s4SnapshotClick(e);return;}e.preventDefault();e.stopPropagation();choose(e.target)},true);document.getElementById('__s4up').onclick=()=>{if(current?.parentElement&&!bar.contains(current.parentElement))choose(current.parentElement)};document.getElementById('__s4down').onclick=()=>{if(current?.firstElementChild)choose(current.firstElementChild)};document.getElementById('__s4save').onclick=()=>{if(!current)return;let s=selector(current);if(mode.value==='container'){s=generalize(current,s);containerSel=s}else s=relative(current,s);const preview=(current.innerText||current.getAttribute('src')||current.getAttribute('data-s4-href')||current.getAttribute('href')||'').trim().replace(/\\s+/g,' ').slice(0,250);let n=0;try{n=(mode.value!=='container'&&containerSel)?document.querySelectorAll(containerSel).length:document.querySelectorAll(s).length}catch{}parent.postMessage({type:'scraper4-selector',channel:'__S4_CHANNEL__',mode:mode.value,selector:s,preview,count:n},'*');const fields=Array.from(mode.options).map(option=>option.value),index=fields.indexOf(mode.value);if(index>=0&&index<fields.length-1)mode.value=fields[index+1];if(current)current.classList.remove('__s4picked');current=null;label.textContent=index<fields.length-1?'فیلد بعدی را انتخاب کنید':'آخرین فیلد ثبت شد';count.textContent='۰ مورد'};mode.addEventListener('change',()=>{if(current)current.classList.remove('__s4picked');current=null;label.textContent='عنصر این فیلد را انتخاب کنید';count.textContent='۰ مورد'});window.addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!=='__S4_CHANNEL__')return;if(e.data?.type==='scraper4-mode'&&e.data.mode)mode.value=e.data.mode;if(e.data?.type==='scraper4-container'&&typeof e.data.selector==='string')containerSel=e.data.selector})})();`;

function pickerSource(channel:string){if(!/^[a-f0-9]{48}$/.test(channel)&&channel!=='')throw Error('Invalid visual channel');return PICKER_JS.replaceAll('__S4_CHANNEL__',channel)}
export function visualSelectorCsp(ticket:string, fullOverride?: boolean){
  const {channel='', full=false} = readVisualTicket(ticket);
  const useFull = fullOverride !== undefined ? fullOverride : Boolean(full);
  const hash=createHash('sha256').update(pickerSource(channel)).digest('base64');
  if (useFull) {
    // Full mode: permissive CSP for Emalls/Snappshop like worker version (PHP had no CSP)
    return `sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads; default-src * data: blob: https: http:; script-src * data: blob: https: http: 'unsafe-inline' 'unsafe-eval' 'sha256-${hash}'; style-src * data: blob: https: http: 'unsafe-inline'; img-src * data: blob: https: http:; font-src * data: blob: https: http:; connect-src * data: blob: https: http: ws: wss:; frame-src * data: blob: https: http:; object-src * data: blob: https: http:; base-uri * data: blob: https: http:; form-action * data: blob: https: http:;`;
  }
  return `sandbox allow-scripts; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'sha256-${hash}'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'`;
}
