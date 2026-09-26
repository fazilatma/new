/** Executes in the page. Read-only visible-content check, not proof of full hydration. */
export function visualDomState(){
 const text=(document.body?.innerText||'').trim(),compact=text.replace(/\s+/g,' ').trim();
 const loadingOnly=/^(?:(?:loading|please wait|در حال (?:بارگذاری|لود)|لطفا صبر کنید|لطفاً صبر کنید)[\s.…!،]*)+$/i.test(compact);
 const images=Array.from(document.querySelectorAll('img')).filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&img.complete&&img.naturalWidth>0}).length;
 return {textLength:text.length,images,loadingOnly,ready:!loadingOnly&&(text.length>=20||images>0)};
}
export async function waitForVisualContent(page:any,driver:string){
 // Both real drivers implement waitForFunction/evaluate. No URL changes or scrolling.
 if(typeof page.waitForFunction!=='function'||typeof page.evaluate!=='function')return null;
 let state=await page.evaluate(visualDomState);if(state.ready)return state;
 const ready=()=>{const text=(document.body?.innerText||'').trim().replace(/\s+/g,' ');return !/^(?:(?:loading|please wait|در حال (?:بارگذاری|لود)|لطفا صبر کنید|لطفاً صبر کنید)[\s.…!،]*)+$/i.test(text)&&(text.length>=20||Array.from(document.querySelectorAll('img')).some(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&img.complete&&img.naturalWidth>0}))};
 if(driver==='playwright')await page.waitForFunction(ready,undefined,{timeout:12000}).then((h:any)=>h.dispose?.()).catch(()=>undefined);
 else await page.waitForFunction(ready,{timeout:12000}).then((h:any)=>h.dispose?.()).catch(()=>undefined);
 state=await page.evaluate(visualDomState);
 if(!state.ready)throw Error('مرورگر فقط صفحهٔ خالی یا پیام بارگذاری تحویل داد؛ انتخاب‌گر روی این صفحه قابل استفاده نیست. اجرای JavaScript و درخواست‌های script / XHR / fetch را بررسی کنید.');
 return state;
}
