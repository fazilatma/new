import os from 'node:os';
import {reportRedactor} from './browser-repair-report.mjs';

/** One explicit diagnostic browser, not the extractor's browser pool. No idle expiry. */
export function createBrowserRuntime({launch,uid=process.getuid?.(),redact=reportRedactor(process.env),now=()=>new Date().toISOString()}={}){
 let browser=null,page=null,task=null,closing=null,disposal=null,cancelled=false,sequence=0;
 let state={phase:'idle',engine:null,startedAt:null,openedAt:null,closedAt:null,pageLoaded:false,connected:false,browserVersion:null,pid:null,lastFailure:null,events:[]};
 const log=(kind,message)=>{state.events.push({at:now(),kind,message:redact(message).slice(0,6000)});state.events=state.events.slice(-60)};
 const snapshot=()=>structuredClone({...state,running:['starting','open','closing'].includes(state.phase),persistent:true,headless:true,target:'local data URL — no external website',scope:'One diagnostic browser stays open until explicitly closed, crashed/disconnected, or the service stops. No target-site access is tested.'});
 function errorText(error){const seen=new Set(),parts=[];for(let e=error;e&&!seen.has(e)&&parts.length<5;e=e.cause){seen.add(e);parts.push(String(e.message||e))}return redact(parts.join('\nCause: ')).slice(0,16000)}
 async function dispose(){if(disposal)return disposal;const b=browser;browser=null;page=null;state.connected=false;if(!b)return;disposal=Promise.resolve().then(()=>b.close()).catch(e=>{log('close-error',errorText(e));state.lastFailure={at:now(),stage:'close',error:errorText(e)};if(b.isConnected?.()!==false){browser=b;state.connected=true;state.phase='failed'}}).finally(()=>{disposal=null});return disposal}
 async function fail(error,stage){if(cancelled)return;state.lastFailure={at:now(),stage,error:errorText(error),memory:{totalBytes:os.totalmem(),freeBytes:os.freemem(),processRssBytes:process.memoryUsage().rss}};state.phase='failed';state.pageLoaded=false;log('error',stage+': '+state.lastFailure.error);await dispose();if(!browser)state.closedAt=now()}
 function start(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['engine','allowRoot'].includes(k))||!['playwright','puppeteer'].includes(options.engine)||('allowRoot'in options&&typeof options.allowRoot!=='boolean'))throw Error('Only engine playwright/puppeteer and boolean allowRoot are accepted.');
  if(uid===0&&options.allowRoot!==true)throw Error('اجرای سرویس با root است؛ ابتدا تأیید اجرای آزمون با دسترسی root را فعال کنید.');
  if(task||closing||disposal||browser||['starting','closing'].includes(state.phase))return snapshot();
  cancelled=false;const id=++sequence;state={...state,phase:'starting',engine:options.engine,startedAt:now(),openedAt:null,closedAt:null,pageLoaded:false,connected:false,browserVersion:null,pid:null};log('start','Launching '+options.engine+'; local page only; browser retained after success.');
  task=(async()=>{
   let stage='launch';
   try{
    const b=await launch(options.engine,{allowRoot:options.allowRoot===true});browser=b;
    if(cancelled){await dispose();return}
    state.connected=true;log('launch','Browser process connected.');
    b.on?.('disconnected',()=>{if(browser!==b||cancelled||id!==sequence)return;void fail(Error('Browser disconnected unexpectedly'),'disconnected')});
    try{state.browserVersion=typeof b.version==='function'?await b.version():null;state.pid=b.process?.()?.pid||null}catch(e){log('metadata',errorText(e))}
    stage='new-page';page=await b.newPage();if(cancelled){await dispose();return}
    const current=page;
    page.on?.(options.engine==='playwright'?'crash':'error',e=>{if(page===current&&!cancelled)void fail(e||Error('Page crashed'),'page-crash')});
    page.on?.('close',()=>{if(page===current&&!cancelled)void fail(Error('Diagnostic page closed unexpectedly'),'page-close')});
    page.on?.('pageerror',e=>log('pageerror',errorText(e)));
    stage='navigation';
    await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Scraper4 browser runtime OK</title><h1>Browser runtime OK</h1>'),{waitUntil:'domcontentloaded',timeout:20000});
    if(cancelled||state.phase==='failed'){await dispose();return}
    stage='page-check';if(await page.title()!=='Scraper4 browser runtime OK')throw Error('Local page title verification failed');
    if(cancelled||state.phase==='failed'){await dispose();return}
    state.pageLoaded=true;state.phase='open';state.openedAt=now();log('ready','Local navigation and title check passed. Browser remains open until Close browser is pressed.');
   }catch(error){if(!cancelled&&state.phase!=='failed')await fail(error,stage)}
   finally{if(cancelled){await dispose();state.phase=browser?'failed':'closed';if(!browser)state.closedAt=now();state.pageLoaded=false}task=null}
  })();
  return snapshot();
 }
 function close(){if(closing)return closing;cancelled=true;state.phase='closing';log('close-request','Explicit close requested.');closing=(async()=>{await dispose();if(task)await task;state.phase=browser?'failed':'closed';if(!browser)state.closedAt=now();state.pageLoaded=false;log(browser?'close-error':'closed',browser?'Browser close failed; retry Close browser.':'Diagnostic browser closed; launch errors retained in report.');return snapshot()})().finally(()=>{closing=null});return closing}
 return {start,close,status:snapshot,settled:async()=>{if(task)await task;return snapshot()}};
}
