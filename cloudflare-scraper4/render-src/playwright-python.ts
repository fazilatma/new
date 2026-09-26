import {browserLaunchArguments,playwrightSandboxOptions} from '../scripts/browser-defaults.mjs';
/** Playwright-only adaptation of render_playwright from fazilatma/new
 * arena/01a0c9ea-new @ fa0a3c3b486c0e3930c9e6a6283f0a1501e79511.
 * Does not import Python settings, installer, cache discovery, relay or parsers.
 */
import {existsSync} from 'node:fs';
import {config} from './config.js';
import {assertPublicUrl} from './network.js';
export const PYTHON_PLAYWRIGHT_INIT="Object.defineProperty(navigator,'webdriver',{get:()=>undefined});Object.defineProperty(navigator,'languages',{get:()=>['fa-IR','fa','en-US','en']});Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});window.chrome=window.chrome||{runtime:{}};window.open=function(){return null};";
export function pythonPlaywrightPlan(url:string){
 const host=new URL(url).hostname.toLowerCase();
 const matches=(base:string)=>host===base||host.endsWith('.'+base);
 const snapp=matches('snappshop.ir'),digi=matches('digikala.com')||matches('digikala.ir'),spa=snapp||digi;
 return {
  launch:{...playwrightSandboxOptions(),headless:true,args:browserLaunchArguments({},['--disable-blink-features=AutomationControlled']),timeout:30000},
  context:{userAgent:config.userAgent,locale:'fa-IR',viewport:{width:1366,height:768},timezoneId:'Asia/Tehran',serviceWorkers:'block'},
  timeout:Math.min(snapp?20000:35000,Math.max(8000,config.requestTimeoutMs)),
  initialWait:spa?1800:500,scrolls:spa?8:4,scrollWait:spa?850:600,
  selector:snapp?'a[href*="/product/"],a[href*="/snp-"],article, [class*="product"]':digi?'[data-testid="product-card"], div[data-cro-id], a[href*="/product/"]':'',
  selectorTimeout:snapp?12000:15000,digi
 };
}
export async function renderPythonPlaywright(url:string,executablePath?:string,stopped?:()=>Promise<boolean>){
 await assertPublicUrl(url);
 const {chromium}=await import('playwright'),plan=pythonPlaywrightPlan(url);
 const expected=chromium.executablePath();
 // Python chooses the installed full Chromium executable when available; Node's
 // implicit headless launch would otherwise choose chromium-headless-shell.
 const selected=executablePath||(expected&&existsSync(expected)?expected:undefined);
 const browser=await chromium.launch({...plan.launch,executablePath:selected});
 const checkStop=async()=>{if(await stopped?.())throw Error('Playwright extraction cancelled');};
 try{
  await checkStop();
  const page=await browser.newPage(plan.context);
  page.context().on('page',popup=>{void popup.close().catch(()=>undefined)});
  page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>undefined)});
  // Port Python's public-URL request guard; block service workers so routing applies.
  await page.context().route('**/*',async route=>{
   try{const target=route.request().url();if(/^https?:/i.test(target))await assertPublicUrl(target);else if(/^wss?:/i.test(target))await assertPublicUrl(target.replace(/^ws/i,'http'));await route.continue();}
   catch{await route.abort().catch(()=>undefined)}
  });
  await page.addInitScript(PYTHON_PLAYWRIGHT_INIT);
  let httpStatus=0,navigated=false;
  for(const waitUntil of ['load','domcontentloaded','commit'] as const){
   await checkStop();
   try{const response=await page.goto(url,{waitUntil,timeout:plan.timeout});httpStatus=response?.status()||0;if(['','about:blank','chrome://newtab/'].includes(page.url()))continue;navigated=true;break;}
   catch(error){
    const message=String(error);
    if(/ERR_ABORTED/i.test(message)){
     // Preserve the Node engine's redirect/reload recovery instead of regressing it.
     await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>undefined);
     if(!['','about:blank','chrome://newtab/'].includes(page.url())){navigated=true;break;}
    }
    if(!/timeout|ERR_ABORTED/i.test(message)||waitUntil==='commit')throw error;
   }
  }
  if(!navigated||['','about:blank','chrome://newtab/'].includes(page.url()))throw Error('Playwright navigation did not reach the requested page');
  await checkStop();await page.waitForTimeout(plan.initialWait);
  for(let i=0;i<plan.scrolls;i++){
   await checkStop();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(plan.scrollWait);
  }
  if(plan.selector)await page.waitForSelector(plan.selector,{timeout:plan.selectorTimeout}).catch(()=>undefined);
  if(plan.digi){
   await page.waitForTimeout(1800);
   await page.evaluate(()=>document.querySelectorAll('img[data-src],img[data-lazy-src],img[data-original]').forEach(img=>{const value=img.getAttribute('data-src')||img.getAttribute('data-lazy-src')||img.getAttribute('data-original');if(value)img.setAttribute('src',value)})).catch(()=>undefined);
  }
  await checkStop();
  let html=await page.content();
  // Carry the Python renderer's in-memory hydration data into the existing Node parsers.
  if(!html.includes('__NEXT_DATA__')&&!html.includes('__NUXT__')){
   const blob=await page.evaluate(()=>{try{const w=window as any;const value=w.__NEXT_DATA__||w.__NUXT__||w.__NUXT_DATA__;return value?JSON.stringify(value):'';}catch{return '';}}).catch(()=>'');
   if(blob)html+='<script id="__NEXT_DATA__" type="application/json">'+blob.replace(/</g,'\\u003c')+'</script>';
  }
  return {html,finalUrl:page.url(),httpStatus};
 }finally{await browser.close().catch(()=>undefined)}
}
