import { browserExecutable, withBrowserSlot } from './scraper.js';
import { assertPublicUrl, safeFetch, safeText } from './network.js';

export const VISUAL_BROWSER_ENGINES = new Set(['playwright','puppeteer','crawlee_playwright','network_api']);
export function visualDriver(engine:string): 'playwright'|'puppeteer' {
  if(!VISUAL_BROWSER_ENGINES.has(engine))throw Error('Unknown visual browser engine.');
  return engine==='puppeteer'?'puppeteer':'playwright';
}
/** All browser HTTP traffic is fulfilled through the existing guarded source transport.
 * Native browser networking is sent to a closed proxy so WebSockets/extra workers cannot
 * bypass URL guards. This is a public-page snapshot, not an authenticated browser session.
 */
export async function renderBrowserSnapshot(url:string,engine:string,indirect=false,session?:{initial?:{text:string;url:string};prepare(page:any):void;collect(page:any):Promise<any>}) {
  const driver=visualDriver(engine);
  await assertPublicUrl(url);
  return withBrowserSlot(async()=>{
    const initial=session?.initial||await safeText(url,6_000_000,{indirect});await assertPublicUrl(initial.url);
    const args=['--disable-dev-shm-usage','--disable-gpu','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if(process.env.VISUAL_BROWSER_NO_SANDBOX==='true')args.push('--no-sandbox','--disable-setuid-sandbox');
    let browser:any;
    try{
      browser=driver==='playwright'
        ? await (await import('playwright')).chromium.launch({headless:true,executablePath:browserExecutable(driver),args,timeout:20_000})
        : await (await import('puppeteer')).default.launch({headless:true,executablePath:browserExecutable(driver),args,timeout:20_000});
    }catch{throw Error('مرورگر انتخاب‌شده راه‌اندازی نشد. npm run browsers:install و BROWSER_EXECUTABLE_PATH را بررسی کنید؛ سرویس را با کاربر غیر root اجرا کنید.');}
    let timeout:ReturnType<typeof setTimeout>|undefined,requests=0,bytes=0,blocked=0,expired=false,documentServed=false,navigationRecovered=false,navigationRetried=false,skipped=0,criticalResourceFailed=false;
    const controllers=new Set<AbortController>(),failures:any[]=[];
    const canonical=(raw:string)=>{const u=new URL(raw);u.hash='';return u.href.replace(/%[a-f0-9]{2}/gi,x=>x.toUpperCase())};
    const bootstrap=(r:any)=>r.isNavigationRequest()&&r.method()==='GET'&&canonical(r.url())===canonical(initial.url);
    const safePath=(raw:string)=>{try{const u=new URL(raw);return u.origin+u.pathname}catch{return ''}};
    const failed=(r:any,e:any)=>{if(e?.expectedSkip)return;if(['script','document','xhr','fetch'].includes(r.resourceType?.()))criticalResourceFailed=true;if(failures.length<20)failures.push({url:safePath(r.url()),type:r.resourceType?.()||'unknown',reason:String(e?.message||e).replace(/https?:\/\/[^\s]+/g,safePath).slice(0,200)})};
    const diagnostics=()=>({indirect,transport:'guarded-source',documentServed,navigationRecovered,navigationRetried,requests,skippedResources:skipped,blockedResources:blocked,criticalResourceFailed,failedResources:failures});
    try{
      const page=driver==='playwright'?await browser.newPage({locale:'fa-IR',serviceWorkers:'block',acceptDownloads:false}):await browser.newPage();
      page.on('popup',(popup:any)=>{void popup.close()});
      session?.prepare(page);
      const resource=async(request:any)=>{
        if(expired||++requests>(session?2000:200))throw Error('Visual resource budget exceeded');
        if(session&&['image','media','font'].includes(request.resourceType())){skipped++;throw Object.assign(Error('Unneeded scroll resource'),{expectedSkip:true})}
        const target=request.url(),method=request.method();
        if(!['GET','HEAD','POST'].includes(method))throw Error('Read-only visual snapshot');
        await assertPublicUrl(target);
        if(bootstrap(request))return {status:200,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from(initial.text)};
        const input=request.headers(),headers:Record<string,string>={};
        for(const name of ['accept','content-type','user-agent','accept-language','origin','referer'])if(input[name])headers[name]=input[name];
        // Never copy dashboard credentials, browser cookies or bearer tokens into another hop.
        const controller=new AbortController();controllers.add(controller);const resourceTimer=setTimeout(()=>controller.abort(),12000);
        try{
        const response=await safeFetch(target,{method,headers,body:method==='POST'?request.postData():undefined,indirect,signal:controller.signal},6_000_000);
        if(!response.ok)failed(request,Error('HTTP '+response.status));
        const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
        if(reader){let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>undefined)},10_000);try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;bytes+=chunk.value.length;if(size>6_000_000||bytes>(session?128_000_000:40_000_000)||expired)throw Error('Visual resource budget exceeded');chunks.push(chunk.value)}if(timedOut)throw Error('Visual resource timed out')}finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined)}}
        const out:Record<string,string>={};response.headers.forEach((value,name)=>{if(!['content-encoding','content-length','transfer-encoding','set-cookie'].includes(name))out[name]=value});
        return {status:response.status,headers:out,body:Buffer.concat(chunks)};
        }finally{clearTimeout(resourceTimer);controllers.delete(controller)}
      };
      if(driver==='playwright'){
        await page.context().route('**/*',async(route:any)=>{try{await route.fulfill(await resource(route.request()));if(bootstrap(route.request()))documentServed=true}catch(error){failed(route.request(),error);blocked++;await route.abort().catch(()=>undefined)}});
        if(page.routeWebSocket)await page.routeWebSocket('**/*',(socket:any)=>socket.close());
      }else{
        await page.setBypassServiceWorker(true);await page.setRequestInterception(true);
        page.on('request',async(request:any)=>{try{await request.respond(await resource(request));if(bootstrap(request))documentServed=true}catch(error){failed(request,error);blocked++;await request.abort().catch(()=>undefined)}});
      }
      const run=async()=>{
        try{await page.goto(initial.url,{waitUntil:'domcontentloaded',timeout:30_000})}
        catch(error){
          // Preserve the old renderer's blank-page ERR_ABORTED retry. Never
          // switch transport or accept initial HTML as a completed scroll.
          if(session&&!documentServed&&requests===0&&/ERR_ABORTED/i.test(String(error))){
            if(driver==='playwright')await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>undefined);
            else if(page.waitForNavigation)await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:5000}).catch(()=>undefined);
            if(!documentServed&&requests===0&&['','about:blank','chrome://newtab/'].includes(page.url())){
              navigationRetried=true;
              try{await page.goto(initial.url,{waitUntil:'domcontentloaded',timeout:30_000});error=null}catch(retryError){error=retryError}
            }
          }
          if(error){
          // A slow iframe/ancillary load can time out goto after the main DOM is ready.
          // Never substitute the fetched HTML for a browser that did not navigate.
          let dom:any=null;try{if(session&&documentServed&&/Timeout|ERR_ABORTED/i.test(String(error)))dom=await page.evaluate(()=>({readyState:document.readyState,textLength:document.body?.innerText?.length||0,htmlLength:document.documentElement?.outerHTML?.length||0}))}catch{}
          if(!dom||!['interactive','complete'].includes(dom.readyState)||dom.textLength<20||dom.htmlLength<200||canonical(page.url())!==canonical(initial.url))throw error;
          navigationRecovered=true;
          }
        }
        if(driver==='playwright')await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>undefined);
        else await page.waitForNetworkIdle({timeout:5000}).catch(()=>undefined);
        const collected=session?await session.collect(page):undefined;
        if(session&&criticalResourceFailed)throw Error('بارگذاری منابع مرورگر ناقص بود؛ کامل‌شدن اسکرول تأیید نشد. گزارش browserDiagnostics را بررسی کنید.');
        const finalUrl=page.url();await assertPublicUrl(finalUrl);
        const text=await page.content();if(Buffer.byteLength(text)>6_000_000)throw Error('Rendered HTML exceeds visual limit');
        return {text,url:finalUrl,engine,driver,blockedResources:blocked,browserDiagnostics:diagnostics(),...(session?{collected}:{})};
      };
      return await Promise.race([run(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(Error('مهلت رندر انتخاب بصری تمام شد.'))},session?240_000:45_000)})]);
    }catch(error){const failure=error instanceof Error?error:Error(String(error));failure.message=failure.message.replace(/\u001b\[[0-9;]*m/g,'');if(session&&!documentServed&&requests===0)failure.message+='\nمرورگر پیش از تحویل درخواست به رهگیر امن متوقف شد؛ سند بارگذاری نشده است. تلاش مجدد: '+String(navigationRetried)+'. اتصال مستقیم جایگزین نشده است.';throw Object.assign(failure,{browserDiagnostics:diagnostics()})}finally{expired=true;for(const c of controllers)c.abort();clearTimeout(timeout);await browser.close().catch(()=>undefined)}
  });
}
