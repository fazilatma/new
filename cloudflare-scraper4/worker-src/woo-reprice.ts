/** Durable, retryable fan-out. Only Woo prices change; stored source/profile prices do not. */
const KEY='woo_price_sync_pending';
type IO={loadConnections(fresh?:boolean):Promise<any>;saveConnections(input:unknown):Promise<any>;mergeConnections(before:any,input:any):any;listProfiles():Promise<any[]>;getState<T>(key:string,fallback:T):Promise<T>;setState(key:string,value:any):Promise<void>;createJob(profileId:string,kind:'sync',target:'woo',options:{priceSync:boolean}):Promise<any>;dispatch(job:any):Promise<void>};
let writes=Promise.resolve();
async function drainPending(io:IO):Promise<any[]>{
 const pending=await io.getState<{percent:number;ids:string[]}|null>(KEY,null);if(!pending?.ids.length)return [];
 const c=(await io.loadConnections(true)).woo;if(!c.url||!c.key||!c.secret||Number(c.pricePercent||0)!==pending.percent)return [];
 const active=new Set((await io.listProfiles()).filter(p=>p.enabled).map(p=>p.id)),jobs=[];
 while(pending.ids.length){const id=pending.ids[0];if(active.has(id)){const job=await io.createJob(id,'sync','woo',{priceSync:true});if(!job)throw Error('WooCommerce price job could not be queued');await io.dispatch(job);jobs.push(job)}pending.ids.shift();await io.setState(KEY,pending)}
 return jobs;
}
export function saveConnectionsAndReprice(input:unknown,io:IO):Promise<{connections:any;priceSyncJobs:any[]}>{
 const work=writes.catch(()=>{}).then(async()=>{
  const before=await io.loadConnections(true),next=io.mergeConnections(before,input);
  if(Number(before.woo.pricePercent||0)!==Number(next.woo.pricePercent||0)){
   const ids=(await io.listProfiles()).filter(p=>p.enabled).map(p=>p.id);
   // Intent precedes the setting write: a failed queue fan-out can be retried.
   await io.setState(KEY,{percent:Number(next.woo.pricePercent)||0,ids});
  }
  const connections=await io.saveConnections(input),priceSyncJobs=await drainPending(io);return {connections,priceSyncJobs};
 });writes=work.then(()=>{},()=>{});return work;
}

export function drainWooReprice(io:IO):Promise<any[]>{const work=writes.then(()=>drainPending(io));writes=work.then(()=>{},()=>{});return work}
