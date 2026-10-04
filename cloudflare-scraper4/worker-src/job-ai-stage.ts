/** Per-job, per-substage circuit breaker. Products are processed in order so
 * 'consecutive' is deterministic. Detached late responses never mutate Results. */
export function createAiStageRunner(io:{settings:any;states:Record<string,{failures:number;skipped:boolean}>;persist():Promise<void>;log(stage:string,text:string):void;progress():Promise<void>}){
 const timeoutMs=Math.max(1,Math.min(300,Number(io.settings?.general?.aiStageTimeoutSeconds)||30))*1000;
 const limit=Math.max(1,Math.min(50,Math.trunc(Number(io.settings?.general?.aiStageFailureLimit)||3)));
 return async function run(stage:string,product:any,work:(copy:any,timeoutMs:number)=>Promise<any>):Promise<any>{
  const state=io.states[stage]||(io.states[stage]={failures:0,skipped:false});
  if(state.skipped)return {ok:false,changed:false,skipped:true,error:'زیرمرحله پس از خطاهای متوالی رد شد.'};
  const copy=structuredClone(product);let timer:ReturnType<typeof setTimeout>|undefined;
  let heartbeatPending=Promise.resolve();
  const heartbeat=setInterval(()=>{heartbeatPending=heartbeatPending.then(()=>io.progress()).catch(()=>{})},15000);
  try{
   const result=await Promise.race([Promise.resolve().then(()=>work(copy,timeoutMs)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(`مهلت ${timeoutMs/1000} ثانیه‌ای زیرمرحله تمام شد.`)),timeoutMs)})]);
   if(!result?.ok)throw Error(result?.error||'پاسخ نامعتبر هوش مصنوعی');
   Object.assign(product,copy);
   if(state.failures){state.failures=0;await io.persist()}
   return result;
  }catch(error){
   state.failures++;state.skipped=state.failures>=limit;
   const text=error instanceof Error?error.message:String(error);
   io.log(stage,`${stage}: ${text} (${state.failures}/${limit})${state.skipped?'؛ ادامهٔ این زیرمرحله رد شد؛ مرحلهٔ بعد ادامه می‌یابد.':''}`);
   await io.persist();await io.progress();return {ok:false,changed:false,skipped:state.skipped,error:text};
  }finally{clearTimeout(timer);clearInterval(heartbeat);await heartbeatPending}
 };
}
