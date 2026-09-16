/** Collect every observed card, including virtualized lists that replace earlier DOM nodes.
 * Quiet-at-bottom is evidence of stability, not proof of the site's total inventory.
 * Safety limits fail explicitly; partial scans must never retire unseen products.
 */
export type ScrollState={height:number;top:number;atEnd:boolean;pending?:boolean};
export async function collectScrollProducts<T>(io:{snapshot():Promise<T[]>;step():Promise<ScrollState>;key(product:T):string;wait(ms:number):Promise<void>;now():number;stopped?():Promise<boolean>},limits:{quietMs?:number;timeoutMs?:number;intervalMs?:number;maxRounds?:number;maxProducts?:number}={}):Promise<T[]>{
 const quietMs=limits.quietMs??10000,timeoutMs=limits.timeoutMs??180000,intervalMs=limits.intervalMs??500,maxRounds=limits.maxRounds??500,maxProducts=limits.maxProducts??50000;
 const found=new Map<string,T>(),start=io.now();let quietSince=io.now(),lastGeometry='',lastVisible='';
 for(let round=0;round<maxRounds;round++){
  if(await io.stopped?.())throw Error('استخراج اسکرولی با درخواست توقف قطع شد؛ فهرست کامل نیست.');
  const products=await io.snapshot(),before=found.size,visible=products.map(p=>io.key(p)).filter(Boolean).sort().join('|');
  for(const p of products){const key=io.key(p);if(key)found.set(key,p)}
  if(found.size>=maxProducts)throw Error('سقف ایمنی تعداد محصولات اسکرولی رسید؛ فهرست کامل تأیید نشد.');
  const state=await io.step(),geometry=state.height+':'+state.top;
  if(!state.atEnd||state.pending||before!==found.size||lastGeometry!==geometry||visible!==lastVisible)quietSince=io.now();
  lastGeometry=geometry;lastVisible=visible;
  if(state.atEnd&&!state.pending&&io.now()-quietSince>=quietMs)return [...found.values()];
  if(io.now()-start>=timeoutMs)break;
  await io.wait(intervalMs);
 }
 throw Error('اسکرول به حد زمان/تلاش رسید؛ پایان فهرست تأیید نشد. محصولات غایب حذف یا ناموجود نمی‌شوند.');
}
