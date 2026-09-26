export type VisualReadinessOptions={context?:'list'|'detail'|'page';container?:string};
/** Executed in the browser: self-contained and read-only. Not a completeness test. */
export function visualDomState(options:VisualReadinessOptions={}){
 const text=(document.body?.innerText||'').trim(),compact=text.replace(/\s+/g,' ').trim();
 const loadingOnly=/^(?:(?:loading|please wait|در حال (?:بارگذاری|لود)|لطفا صبر کنید|لطفاً صبر کنید)[\s.…!،]*)+$/i.test(compact);
 const visible=(el:any)=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;for(let at=el;at;at=at.parentElement){if(at.hidden||at.getAttribute?.('aria-hidden')==='true')return false;if(typeof getComputedStyle==='function'){const s=getComputedStyle(at);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}}return true;};
 const images=Array.from(document.querySelectorAll('img')).filter(img=>visible(img)&&img.complete&&img.naturalWidth>0).length;
 if(options.context!=='list')return {textLength:text.length,images,loadingOnly,ready:!loadingOnly&&(text.length>=20||images>0),context:options.context||'page'};
 const outsideChrome=(el:Element)=>!el.closest('header,nav,footer,[role="navigation"]');
 const title=(el:Element)=>(el as HTMLElement).innerText?.trim()||el.textContent?.trim()||'';
 const card=(el:Element)=>!['HTML','BODY'].includes(el.tagName)&&outsideChrome(el)&&visible(el)&&title(el).length>=3&&!/^(loading|please wait|در حال بارگذاری)[\s.…]*$/i.test(title(el));
 const all=(selector:string)=>Array.from(document.querySelectorAll(selector)).slice(0,500);
 const links=all('a[href*="/product/"],a[href*="/product?"],a[href*="/snp-"],a[href*="/p/"]').filter(card);
 const generic=all('article,li.product,[class*="ProductCard"],[class*="product-card"],[data-product-id]').filter(el=>card(el)&&!!el.querySelector('a[href]')&&!!el.querySelector('h2,h3,[class*="title"],[class*="Title"],[class*="price"],[class*="Price"]'));
 let configured=0,selectorError='';
 if(options.container){try{
  let nodes:Element[]=[];
  if(/^\/?\//.test(options.container)){const result=document.evaluate(options.container,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(let i=0;i<Math.min(result.snapshotLength,500);i++){const node=result.snapshotItem(i);if(node?.nodeType===1)nodes.push(node as Element);}}
  else nodes=all(options.container);
  configured=nodes.filter(el=>card(el)&&(el.matches('a[href]')||Array.from(el.querySelectorAll('h2,h3,[class*="title"],[class*="Title"],[class*="price"],[class*="Price"]')).some(field=>outsideChrome(field)&&visible(field)&&title(field).length>2))).length;
 }catch{selectorError='Configured container selector is invalid or unsupported; generic catalogue evidence was checked separately.';}}
 const blockers=all('[aria-busy="true"],[role="progressbar"],[class*="splash"],[id*="splash"],[class*="loading-overlay"],[class*="LoadingOverlay"],[class*="Splash"],[id*="Splash"],[class*="preloader"],[id*="preloader"],[class*="loading"],[class*="Loading"],[id*="loader"]').filter(el=>{
  if(!visible(el))return false;const r=el.getBoundingClientRect();
  // Small price spinners must not invalidate a usable catalogue.
  return typeof innerWidth==='number'&&typeof innerHeight==='number'&&r.width>=innerWidth*.6&&r.height>=innerHeight*.6;
 }).length;
 const candidates=Math.max(configured,generic.length,links.length);
 return {textLength:text.length,images,loadingOnly,context:'list',configuredMatches:configured,genericCards:generic.length,productLinks:links.length,candidates,blockingOverlays:blockers,selectorError,selectorMismatch:!!options.container&&!configured,ready:!loadingOnly&&!blockers&&candidates>0};
}
export async function waitForVisualContent(page:any,driver:string,options:VisualReadinessOptions={}){
 if(typeof page.waitForFunction!=='function'||typeof page.evaluate!=='function')return null;
 let state=await page.evaluate(visualDomState,options);if(state.ready)return state;
 let position:any;
 if(options.context==='list'){
  // A single small, reversible viewport move triggers initial lazy loading, not
  // full-catalogue scrolling. No clicks, URL changes, or consent dismissal.
  position=await page.evaluate(()=>({x:window.scrollX,y:window.scrollY}));
  await page.evaluate(()=>window.scrollBy(0,Math.min(600,window.innerHeight*.75))).catch(()=>undefined);
 }
 try{
  const ready='('+visualDomState.toString()+')('+JSON.stringify(options)+').ready';
  const timeout=options.context==='list'?20000:12000;
  if(driver==='playwright')await page.waitForFunction(ready,undefined,{timeout}).then((h:any)=>h.dispose?.()).catch(()=>undefined);
  else await page.waitForFunction(ready,{timeout}).then((h:any)=>h.dispose?.()).catch(()=>undefined);
 }finally{if(position)await page.evaluate((p:any)=>window.scrollTo(p.x||0,p.y||0),position).catch(()=>undefined);}
 state=await page.evaluate(visualDomState,options);
 if(!state.ready)throw Object.assign(Error(options.context==='list'?'فهرست محصولات هنوز آماده نیست؛ فقط پوسته، لوگو، صفحهٔ بارگذاری یا پوشش انتظار دیده شد. این تصویر به‌عنوان فهرست آماده نمایش داده نشد. خطاهای JavaScript و منابع script / XHR / fetch را بررسی کنید.':'مرورگر فقط صفحهٔ خالی یا پیام بارگذاری تحویل داد؛ انتخاب‌گر روی این صفحه قابل استفاده نیست. اجرای JavaScript و درخواست‌های script / XHR / fetch را بررسی کنید.'),{visualReadiness:state});
 return state;
}
