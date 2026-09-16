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
export async function renderBrowserSnapshot(url:string,engine:string,indirect=false,session?:{prepare(page:any):void;collect(page:any):Promise<any>}) {
  const driver=visualDriver(engine);
  await assertPublicUrl(url);
  return withBrowserSlot(async()=>{
    const initial=await safeText(url,6_000_000,{indirect});
    const args=['--disable-dev-shm-usage','--disable-gpu','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if(process.env.VISUAL_BROWSER_NO_SANDBOX==='true')args.push('--no-sandbox','--disable-setuid-sandbox');
    let browser:any;
    try{
      browser=driver==='playwright'
        ? await (await import('playwright')).chromium.launch({headless:true,executablePath:browserExecutable(driver),args,timeout:20_000})
        : await (await import('puppeteer')).default.launch({headless:true,executablePath:browserExecutable(driver),args,timeout:20_000});
    }catch{throw Error('مرورگر انتخاب‌شده راه‌اندازی نشد. npm run browsers:install و BROWSER_EXECUTABLE_PATH را بررسی کنید؛ سرویس را با کاربر غیر root اجرا کنید.');}
    let timeout:ReturnType<typeof setTimeout>|undefined,requests=0,bytes=0,blocked=0,expired=false;
    try{
      const page=driver==='playwright'?await browser.newPage({locale:'fa-IR',serviceWorkers:'block',acceptDownloads:false}):await browser.newPage();
      page.on('popup',(popup:any)=>{void popup.close()});
      session?.prepare(page);
      const resource=async(request:any)=>{
        if(expired||++requests>(session?2000:200))throw Error('Visual resource budget exceeded');
        if(session&&['image','media','font'].includes(request.resourceType()))throw Error('Unneeded scroll resource');
        const target=request.url(),method=request.method();
        if(!['GET','HEAD','POST'].includes(method))throw Error('Read-only visual snapshot');
        await assertPublicUrl(target);
        if(target===initial.url&&request.isNavigationRequest()&&method==='GET')return {status:200,headers:{'content-type':'text/html; charset=utf-8'},body:Buffer.from(initial.text)};
        const input=request.headers(),headers:Record<string,string>={};
        for(const name of ['accept','content-type','user-agent','accept-language','origin','referer'])if(input[name])headers[name]=input[name];
        // Never copy dashboard credentials, browser cookies or bearer tokens into another hop.
        const response=await safeFetch(target,{method,headers,body:method==='POST'?request.postData():undefined,indirect},6_000_000);
        const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
        if(reader){let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>undefined)},10_000);try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;bytes+=chunk.value.length;if(size>6_000_000||bytes>(session?128_000_000:40_000_000)||expired)throw Error('Visual resource budget exceeded');chunks.push(chunk.value)}if(timedOut)throw Error('Visual resource timed out')}finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined)}}
        const out:Record<string,string>={};response.headers.forEach((value,name)=>{if(!['content-encoding','content-length','transfer-encoding','set-cookie'].includes(name))out[name]=value});
        return {status:response.status,headers:out,body:Buffer.concat(chunks)};
      };
      if(driver==='playwright'){
        await page.context().route('**/*',async(route:any)=>{try{await route.fulfill(await resource(route.request()))}catch{blocked++;await route.abort().catch(()=>undefined)}});
        if(page.routeWebSocket)await page.routeWebSocket('**/*',(socket:any)=>socket.close());
      }else{
        await page.setBypassServiceWorker(true);await page.setRequestInterception(true);
        page.on('request',async(request:any)=>{try{await request.respond(await resource(request))}catch{blocked++;await request.abort().catch(()=>undefined)}});
      }
      const run=async()=>{
        await page.goto(initial.url,{waitUntil:'domcontentloaded',timeout:30_000});
        if(driver==='playwright')await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>undefined);
        else await page.waitForNetworkIdle({timeout:5000}).catch(()=>undefined);
        const collected=session?await session.collect(page):undefined;
        const finalUrl=page.url();await assertPublicUrl(finalUrl);
        const text=await page.content();if(Buffer.byteLength(text)>6_000_000)throw Error('Rendered HTML exceeds visual limit');
        return {text,url:finalUrl,engine,driver,blockedResources:blocked,...(session?{collected}:{})};
      };
      return await Promise.race([run(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(Error('مهلت رندر انتخاب بصری تمام شد.'))},session?240_000:45_000)})]);
    }finally{expired=true;clearTimeout(timeout);await browser.close().catch(()=>undefined)}
  });
}
