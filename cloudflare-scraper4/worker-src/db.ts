import { applyResultAdjustments } from './result-adjustments.js';
import { getEnv, type D1Database, type D1PreparedStatement } from './env.js';
import { SCHEMA } from './schema.js';
import { isWriteQuotaError, normalizeDbValue, normalizePersianText, toRemoteId } from './utils.js';
import type { Job, Product, Profile } from './types.js';

const ready = new WeakMap<object, Promise<void>>();
const now = () => new Date().toISOString();
const json = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const clean = (values: unknown[]) => values.map(value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value);
function statement(sql: string, values: unknown[] = []): D1PreparedStatement { return getEnv().DB.prepare(sql).bind(...clean(values)); }

// Best-effort D1 write-quota signal (isolate-local; resets with the isolate).
// A write that succeeds after a quota failure clears it, so the task manager can
// tell the user "write quota exhausted — background activity is paused until 00:00 UTC".
let writeQuotaAt: string | null = null;
export function getWriteQuotaState(): { writeExceeded: boolean; at: string | null } { return { writeExceeded: Boolean(writeQuotaAt), at: writeQuotaAt }; }

/**
 * Daily D1 usage meter.
 *
 * Cloudflare does not expose "remaining quota" to a Worker, but every query
 * returns meta.rows_read / meta.rows_written -- the exact units the free plan
 * limits (5,000,000 reads and 100,000 writes per UTC day). So we measure our
 * own consumption instead of waiting to be cut off.
 *
 * The counter itself must not become part of the problem: persisting it on
 * every query would roughly double our write cost. So it accumulates in memory
 * (free) and is flushed to app_state at most once per FLUSH_MS, or when the
 * pending delta gets large. The reported figure is persisted total + unflushed
 * delta, so it stays correct across isolates.
 */
export const D1_FREE_DAILY_ROWS_READ = 5_000_000;
export const D1_FREE_DAILY_ROWS_WRITTEN = 100_000;
const USAGE_KEY = 'd1_usage_daily';
const USAGE_FLUSH_MS = 60_000;
const USAGE_FLUSH_ROWS = 500;

export const WORKERS_FREE_DAILY_REQUESTS = 100_000;
/** Cloudflare caps outbound fetch() calls per invocation: 50 on Free, 1000 on Paid. */
export const WORKERS_FREE_SUBREQUESTS_PER_INVOCATION = 50;

export type D1Usage = { day: string; rowsRead: number; rowsWritten: number; queries: number;
  /** Worker invocations counted today (requests + cron). */
  requests: number;
  /** Outbound fetch() calls today: AI, Basalam, WooCommerce and scraping. */
  subrequests: number;
  /** Highest number of subrequests seen in a single invocation today. */
  peakSubrequests: number };
const utcDay = (at: Date = new Date()) => at.toISOString().slice(0, 10);
const emptyUsage = (): D1Usage => ({ day: utcDay(), rowsRead: 0, rowsWritten: 0, queries: 0, requests: 0, subrequests: 0, peakSubrequests: 0 });

let usageBase: D1Usage = emptyUsage();      // last value read from / written to D1
let usagePending: D1Usage = emptyUsage();   // measured in this isolate, not yet flushed
let usageLoaded = false;
let usageFlushedAt = 0;
let usageFlushing: Promise<void> | null = null;

/**
 * Workers-plan counters. AI model testing never touches D1, so it was invisible
 * in the quota panel while still consuming the limits that actually bite:
 * 100,000 invocations/day and 50 subrequests per invocation on the Free plan.
 */
let invocationSubrequests = 0;
/** Call once per Worker invocation (fetch handler and cron). */
export function meterInvocation(): void {
  try {
    if (usagePending.day !== utcDay()) usagePending = emptyUsage();
    usagePending.requests += 1;
    invocationSubrequests = 0;
  } catch { /* metering must never break a request */ }
}
/** Call for every outbound fetch(): AI, Basalam, WooCommerce, scraping. */
export function meterSubrequest(): void {
  try {
    if (usagePending.day !== utcDay()) usagePending = emptyUsage();
    usagePending.subrequests += 1;
    invocationSubrequests += 1;
    if (invocationSubrequests > usagePending.peakSubrequests) usagePending.peakSubrequests = invocationSubrequests;
  } catch { /* metering must never break a request */ }
}
/** Subrequests used so far in THIS invocation, for pre-flight checks. */
export function subrequestsUsed(): number { return invocationSubrequests; }

/** Fold one query's meta into the in-memory counters. Never throws: metering must not break queries. */
function meter(meta: { rows_read?: number; rows_written?: number } | undefined): void {
  try {
    const today = utcDay();
    // Free limits reset at 00:00 UTC; drop yesterday's numbers rather than carry them.
    if (usagePending.day !== today) usagePending = emptyUsage();
    if (usageBase.day !== today) usageBase = emptyUsage();
    usagePending.rowsRead += Number(meta?.rows_read || 0);
    usagePending.rowsWritten += Number(meta?.rows_written || 0);
    usagePending.queries += 1;
  } catch { /* metering is best-effort */ }
}

function usageTotal(): D1Usage {
  const today = utcDay();
  const base = usageBase.day === today ? usageBase : emptyUsage();
  const pending = usagePending.day === today ? usagePending : emptyUsage();
  return { day: today, rowsRead: base.rowsRead + pending.rowsRead, rowsWritten: base.rowsWritten + pending.rowsWritten, queries: base.queries + pending.queries,
    requests: base.requests + pending.requests, subrequests: base.subrequests + pending.subrequests,
    peakSubrequests: Math.max(base.peakSubrequests, pending.peakSubrequests) };
}

/** Persist the pending delta. Costs one write, so it is rate-limited by the caller. */
async function flushUsage(): Promise<void> {
  if (usagePending.rowsRead === 0 && usagePending.rowsWritten === 0 && usagePending.queries === 0
    && usagePending.requests === 0 && usagePending.subrequests === 0) return;
  const delta = usagePending;
  usagePending = emptyUsage();
  try {
    const stored = await getState<D1Usage>(USAGE_KEY, emptyUsage());
    const today = utcDay();
    const base = stored && stored.day === today ? stored : emptyUsage();
    const merged: D1Usage = { day: today, rowsRead: base.rowsRead + delta.rowsRead, rowsWritten: base.rowsWritten + delta.rowsWritten, queries: base.queries + delta.queries,
      requests: base.requests + delta.requests, subrequests: base.subrequests + delta.subrequests,
      peakSubrequests: Math.max(base.peakSubrequests || 0, delta.peakSubrequests || 0) };
    await setState(USAGE_KEY, merged);
    usageBase = merged; usageLoaded = true; usageFlushedAt = Date.now();
  } catch {
    // Put the delta back so nothing is lost (for example when the write quota is already gone).
    usagePending.rowsRead += delta.rowsRead; usagePending.rowsWritten += delta.rowsWritten; usagePending.queries += delta.queries;
    // Do not retry instantly; the usual cause is an exhausted write quota.
    usageFlushedAt = Date.now();
  }
}

function maybeFlushUsage(waitUntil?: (promise: Promise<unknown>) => void): void {
  const due = Date.now() - usageFlushedAt >= USAGE_FLUSH_MS || usagePending.rowsWritten >= USAGE_FLUSH_ROWS || usagePending.rowsRead >= USAGE_FLUSH_ROWS * 20;
  if (!due || usageFlushing) return;
  usageFlushing = flushUsage().finally(() => { usageFlushing = null; });
  if (waitUntil) waitUntil(usageFlushing);
}

/** Current-day D1 consumption measured by this Worker, with the free-plan limits applied. */
export async function getD1Usage(): Promise<{
  day: string; rowsRead: number; rowsWritten: number; queries: number;
  limits: { rowsRead: number; rowsWritten: number; requests: number; subrequestsPerInvocation: number };
  remaining: { rowsRead: number; rowsWritten: number };
  percent: { rowsRead: number; rowsWritten: number; requests: number; peakSubrequests: number };
  resetsAt: string; measured: 'this-worker-only';
}> {
  if (!usageLoaded) {
    try {
      const stored = await getState<D1Usage>(USAGE_KEY, emptyUsage());
      if (stored && stored.day === utcDay()) usageBase = stored;
      usageLoaded = true;
    } catch { /* fall back to whatever this isolate measured */ }
  }
  const total = usageTotal();
  const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
  const pct = (used: number, limit: number) => Math.min(100, Math.round((used / limit) * 1000) / 10);
  return {
    ...total,
    limits: { rowsRead: D1_FREE_DAILY_ROWS_READ, rowsWritten: D1_FREE_DAILY_ROWS_WRITTEN, requests: WORKERS_FREE_DAILY_REQUESTS, subrequestsPerInvocation: WORKERS_FREE_SUBREQUESTS_PER_INVOCATION },
    remaining: { rowsRead: Math.max(0, D1_FREE_DAILY_ROWS_READ - total.rowsRead), rowsWritten: Math.max(0, D1_FREE_DAILY_ROWS_WRITTEN - total.rowsWritten) },
    percent: { rowsRead: pct(total.rowsRead, D1_FREE_DAILY_ROWS_READ), rowsWritten: pct(total.rowsWritten, D1_FREE_DAILY_ROWS_WRITTEN),
      requests: pct(total.requests, WORKERS_FREE_DAILY_REQUESTS),
      peakSubrequests: pct(total.peakSubrequests, WORKERS_FREE_SUBREQUESTS_PER_INVOCATION) },
    resetsAt: reset.toISOString(),
    // Honest scope: this counts only what this Worker ran. Dashboard, wrangler
    // and other Workers on the same database are not visible from here.
    measured: 'this-worker-only'
  };
}

/** Flush pending usage at the end of a request/cron so the number survives isolate recycling. */
export function flushD1Usage(waitUntil?: (promise: Promise<unknown>) => void): void { maybeFlushUsage(waitUntil); }

async function rows<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await statement(sql, values).all<T>();
  meter(result.meta);
  if (!result.success) throw new Error(result.error || 'D1 query failed');
  const found = result.results || [];
  for (const row of found as Record<string, unknown>[]) for (const key of Object.keys(row)) row[key] = normalizeDbValue(row[key]);
  return found;
}
async function run(sql: string, values: unknown[] = []): Promise<number> {
  const result = await statement(sql, values).run();
  meter(result.meta);
  const errorText = String(result.error || '');
  if (errorText && isWriteQuotaError(errorText)) { writeQuotaAt = writeQuotaAt || now(); throw new Error(errorText); }
  if (!result.success) throw new Error(errorText || 'D1 query failed');
  // A successful write means the quota is (again) available — clear the stale flag.
  if (writeQuotaAt) writeQuotaAt = null;
  return Number(result.meta?.changes || 0);
}

export async function ensureSchema(db: D1Database = getEnv().DB): Promise<void> {
  const key = db as unknown as object;
  let promise = ready.get(key);
  if (!promise) {
    // Every statement in SCHEMA is idempotent. Running the full bootstrap once per
    // isolate also repairs a partially initialized D1 database; checking for only
    // one table could otherwise leave the remaining schema missing forever.
    promise = (async () => {
      const statements=SCHEMA.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql));
      await db.batch(statements);
    })().catch(error => { ready.delete(key); throw error; });
    ready.set(key, promise);
  }
  await promise;
}

function profileFromRow(row: any): Profile {
  const data = json<Profile>(row.data, {} as Profile);
  return { ...data, enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_minutes || 0), lastRunAt: row.last_run_at || null,
    createdAt: row.created_at || data.createdAt, updatedAt: row.updated_at || data.updatedAt };
}
function jobFromRow(row: any): Job {
  return { id:String(row.id),profileId:String(row.profile_id),kind:row.kind,target:row.target,status:row.status,phase:String(row.phase),
    total:Number(row.total||0),processed:Number(row.processed||0),added:Number(row.added||0),updated:Number(row.updated||0),failed:Number(row.failed||0),
    stopRequested:Boolean(row.stop_requested),error:row.error == null ? null : String(row.error),log:json(row.log,[]),createdAt:String(row.created_at),
    startedAt:row.started_at ? String(row.started_at) : null,finishedAt:row.finished_at ? String(row.finished_at) : null,updatedAt:String(row.updated_at) };
}
function productFromRow(row: any): Product { return json<Product>(row.data, {} as Product); }
function validProductRow(p: any): p is Product { return !!p && typeof p === 'object' && !Array.isArray(p); }

export async function listProfiles(): Promise<Profile[]> { return (await rows('SELECT * FROM profiles ORDER BY updated_at DESC')).map(profileFromRow); }
export async function getProfile(id: string): Promise<Profile | null> { const row = await statement('SELECT * FROM profiles WHERE id=?',[id]).first(); return row ? profileFromRow(row) : null; }
export async function saveProfile(profile: Profile): Promise<Profile> {
  const previous = await getProfile(profile.id); const timestamp = now();
  const value = { ...profile, createdAt: previous?.createdAt || profile.createdAt || timestamp, updatedAt: timestamp };
  await run(`INSERT INTO profiles(id,data,enabled,interval_minutes,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data,enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,updated_at=excluded.updated_at`,
    [value.id,JSON.stringify(value),value.enabled,value.intervalMinutes,value.createdAt,value.updatedAt]);
  return (await getProfile(value.id))!;
}
export async function deleteProfile(id: string): Promise<boolean> {
  const db=getEnv().DB; await db.batch([
    db.prepare("DELETE FROM app_state WHERE key IN (SELECT 'job_checkpoint:'||id FROM jobs WHERE profile_id=?)").bind(id),
    db.prepare('DELETE FROM destination_map WHERE profile_id=?').bind(id),db.prepare('DELETE FROM products WHERE profile_id=?').bind(id),
    db.prepare('DELETE FROM jobs WHERE profile_id=?').bind(id),db.prepare('DELETE FROM profiles WHERE id=?').bind(id)
  ]); return true;
}

export async function createJob(profileId: string, kind: Job['kind'], target: Job['target'], _options: { forceNew?: boolean; priceSync?:boolean } = {}): Promise<Job> {
  const settings = await getState<any>('settings', {}), dedup = settings?.general?.queueDedup !== false;
  const active = await statement("SELECT * FROM jobs WHERE profile_id=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1",[profileId]).first();
  if(_options.priceSync){const queued=await statement("SELECT * FROM jobs WHERE profile_id=? AND kind='sync' AND target=? AND status='queued' AND started_at IS NULL ORDER BY created_at LIMIT 1",[profileId,target]).first();if(queued)return jobFromRow(queued);}
  if (active && dedup && !_options.priceSync) {
    const job = jobFromRow(active), staleMin = Math.max(1, Number(settings?.general?.queueDedupStale) || 120), age = Date.now() - new Date(job.updatedAt).getTime();
    if (age >= staleMin * 60_000) await updateJob(job.id, {status:'failed', phase:'stale-replaced', error:'کار قبلی همین پروفایل به‌خاطر گیرکردن طولانی بسته شد تا کار تازه جایگزین شود.', finishedAt: now(), stopRequested:true});
    else return job;
  }
  const id=crypto.randomUUID(),timestamp=now();
  try { await run('INSERT INTO jobs(id,profile_id,kind,target,created_at,updated_at) VALUES(?,?,?,?,?,?)',[id,profileId,kind,target,timestamp,timestamp]); }
  catch (error) {
    const concurrent=await statement("SELECT * FROM jobs WHERE profile_id=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1",[profileId]).first();
    if (concurrent) return jobFromRow(concurrent); throw error;
  }
  return (await getJob(id))!;
}
export async function getJob(id:string):Promise<Job|null>{const row=await statement('SELECT * FROM jobs WHERE id=?',[id]).first();return row?jobFromRow(row):null;}
export async function listJobs(limit=50):Promise<Job[]>{return(await rows('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?',[Math.max(1,limit)])).map(jobFromRow);}
// ─── Job priority map (task-manager drag order) ─────────────────────────────
// Priorities live in app_state (no schema change): the first queued job in the
// user-defined order gets the highest number and is processed first. New jobs
// without an entry fall back to priority 0 (below every prioritized job).
const JOB_PRIORITY_KEY='job_priorities_v1';
export async function getJobPriorities():Promise<Record<string,number>>{return getState<Record<string,number>>(JOB_PRIORITY_KEY,{});}
export async function setJobPriorities(ids:string[]):Promise<Record<string,number>>{
  const valid=[...new Set(ids.map(String).filter(Boolean))],map:Record<string,number>={};
  valid.forEach((id,index)=>{map[id]=valid.length-index});
  await setState(JOB_PRIORITY_KEY,map);
  return map;
}
function jobPriority(map:Record<string,number>,job:Job):number{return Number(map[job.id])||0;}
export async function listQueuedJobs(limit=200):Promise<Job[]>{
  const jobs=(await rows(`SELECT * FROM jobs WHERE status='queued' ORDER BY started_at IS NULL,created_at LIMIT ?`,[Math.max(1,limit)])).map(jobFromRow);
  const map=await getJobPriorities();
  return jobs.sort((a,b)=>Number(Boolean(b.startedAt))-Number(Boolean(a.startedAt))||jobPriority(map,b)-jobPriority(map,a)||a.createdAt.localeCompare(b.createdAt));
}
// ─── Background-run priority map (task-manager drag order) ───────────────────
// Ranks run kinds ('ai-test' | 'dedup' | 'category-all' | 'agent'): the first
// kind in the user-defined order gets the highest number and is dispatched
// first when several background runs are queued. Unranked kinds get priority 0.
const RUN_PRIORITY_KEY='run_priorities_v1';
export async function getRunPriorities():Promise<Record<string,number>>{return getState<Record<string,number>>(RUN_PRIORITY_KEY,{});}
export async function setRunPriorities(kinds:string[]):Promise<Record<string,number>>{
  const valid=[...new Set(kinds.map(String).filter(Boolean))],map:Record<string,number>={};
  valid.forEach((kind,index)=>{map[kind]=valid.length-index});
  await setState(RUN_PRIORITY_KEY,map);
  return map;
}
export async function claimJob(id?:string):Promise<Job|null>{
  const settings=await getState<any>('settings',{}),limit=Math.max(1,Math.min(8,Math.trunc(Number(settings?.general?.maxConcurrentProfiles)||2)));
  const candidate=id?await statement("SELECT id FROM jobs WHERE id=? AND status='queued'",[id]).first<{id:string}>():await statement("SELECT id FROM jobs WHERE status='queued' ORDER BY started_at IS NULL,created_at LIMIT 1").first<{id:string}>();
  if(!candidate)return null;const timestamp=now();
  const changed=await run(`UPDATE jobs SET status='running',phase=CASE WHEN started_at IS NULL THEN 'starting' ELSE phase END,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued' AND NOT EXISTS (SELECT 1 FROM jobs busy WHERE busy.profile_id=jobs.profile_id AND busy.id<>jobs.id AND (busy.status='running' OR (busy.status='queued' AND busy.started_at IS NOT NULL AND (busy.created_at<jobs.created_at OR (busy.created_at=jobs.created_at AND busy.id<jobs.id))))) AND (SELECT count(DISTINCT profile_id) FROM jobs WHERE status='running') < ${limit} AND (started_at IS NOT NULL OR (SELECT count(DISTINCT profile_id) FROM jobs WHERE status='running' OR (status='queued' AND started_at IS NOT NULL)) < ${limit})`,[timestamp,timestamp,candidate.id]);
  return changed?getJob(candidate.id):null;
}

export async function updateJob(id:string,patch:Partial<Job>):Promise<void>{
  const allowed:Record<string,string>={status:'status',phase:'phase',total:'total',processed:'processed',added:'added',updated:'updated',failed:'failed',stopRequested:'stop_requested',error:'error',log:'log',finishedAt:'finished_at'};
  const entries=Object.entries(patch).filter(([key])=>allowed[key]);if(!entries.length)return;
  const sets=entries.map(([key])=>`${allowed[key]}=?`),values=entries.map(([key,value])=>key==='log'?JSON.stringify(value):value);
  await run(`UPDATE jobs SET ${sets.join(',')},updated_at=? WHERE id=?`,[...values,now(),id]);
}
export async function stopRequested(id:string):Promise<boolean>{const row=await statement('SELECT stop_requested FROM jobs WHERE id=?',[id]).first<{stop_requested:number}>();return Boolean(row?.stop_requested);}
export async function stopJob(id:string):Promise<Job|null>{const timestamp=now();await deleteState(`job_checkpoint:${id}`);const changed=await run(`UPDATE jobs SET status='stopped',phase='finished',stop_requested=1,error='Stopped manually',finished_at=?,updated_at=? WHERE id=? AND status IN ('queued','running')`,[timestamp,timestamp,id]);return changed?getJob(id):null;}
export async function retryJob(id:string):Promise<Job|null>{const timestamp=now(),changed=await run(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=0,error=NULL,started_at=NULL,finished_at=NULL,processed=0,added=0,updated=0,failed=0,log='[]',updated_at=? WHERE id=? AND status IN ('failed','stopped','done')`,[timestamp,id]);return changed?getJob(id):null;}
export async function deleteJob(id:string):Promise<boolean>{
  const deleted=await run("DELETE FROM jobs WHERE id=? AND status!='running'",[id]);
  if(deleted){
    await deleteState(`job_checkpoint:${id}`);
    const map=await getJobPriorities();
    if(Object.prototype.hasOwnProperty.call(map,id)){delete map[id];await setState(JOB_PRIORITY_KEY,map)}
  }
  return Boolean(deleted);
}
export async function clearFinishedJobs():Promise<number>{await run("DELETE FROM app_state WHERE key IN (SELECT 'job_checkpoint:'||id FROM jobs WHERE status IN ('done','failed','stopped'))");return run("DELETE FROM jobs WHERE status IN ('done','failed','stopped')");}
export async function pruneFinishedJobs(keep=20):Promise<number>{
  const limit=Math.max(1,Math.min(200,Math.trunc(Number(keep)||20))),finished=await rows<{id:string}>("SELECT id FROM jobs WHERE status IN ('done','failed','stopped') ORDER BY created_at DESC");
  let deleted=0;for(const row of finished.slice(limit))if(await deleteJob(row.id))deleted++;return deleted;
}

export async function upsertProduct(profileId:string,product:Product,options:{source?:boolean}={}):Promise<'added'|'updated'>{
  if(!validProductRow(product))throw new Error('upsertProduct refused a non-object product');
  const existing=await statement('SELECT 1 AS found FROM products WHERE profile_id=? AND source_key=?',[profileId,product.sourceKey]).first();const timestamp=now();
  if(options.source||(product as any).resultBase){const profile=await getProfile(profileId);if(profile){if(options.source)delete (product as any).resultBase;const settings=await getState<any>('settings',{});applyResultAdjustments(product,profile,String(settings?.dedup?.suffixFormats||''));}}
  await run(`INSERT INTO products(profile_id,source_key,data,title,price,source_url,active,missing_since,created_at,updated_at) VALUES(?,?,?,?,?,?,1,NULL,?,?)
    ON CONFLICT(profile_id,source_key) DO UPDATE SET data=excluded.data,title=excluded.title,price=excluded.price,source_url=excluded.source_url,active=1,missing_since=NULL,updated_at=excluded.updated_at`,
    [profileId,product.sourceKey,JSON.stringify(product),product.title,product.price,product.url,timestamp,timestamp]);return existing?'updated':'added';
}
export async function listProducts(profileId:string,limit=100,offset=0,q=''):Promise<{products:Product[];total:number}>{
  const filter=q?' AND title LIKE ? ESCAPE \'\\\'':'',pattern=`%${q.replace(/[\\%_]/g,'\\$&')}%`,params=q?[profileId,pattern]:[profileId];
  const count=await statement(`SELECT count(*) AS total FROM products WHERE profile_id=? AND data IS NOT NULL AND data<>'null'${filter}`,params).first<{total:number}>();
  const result=await rows(`SELECT data FROM products WHERE profile_id=? AND data IS NOT NULL AND data<>'null'${filter} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,[...params,limit,offset]);return{products:result.map(productFromRow).filter(validProductRow),total:Number(count?.total||0)};
}
export async function allProducts(profileId:string):Promise<Product[]>{return(await rows('SELECT data FROM products WHERE profile_id=? AND data IS NOT NULL AND data<>\'null\' ORDER BY updated_at',[profileId])).map(productFromRow).filter(validProductRow);}
export async function listStalestProducts(profileId:string,limit=5):Promise<Product[]>{return(await rows('SELECT data FROM products WHERE profile_id=? AND data IS NOT NULL AND data<>\'null\' ORDER BY updated_at ASC LIMIT ?',[profileId,Math.max(1,Math.min(20,limit))])).map(productFromRow).filter(validProductRow);}
export async function getProduct(profileId:string,sourceKey:string):Promise<Product|null>{const row=await statement('SELECT data FROM products WHERE profile_id=? AND source_key=?',[profileId,sourceKey]).first();const found=row?productFromRow(row):null;return validProductRow(found)?found:null;}
export async function deleteProduct(profileId:string,sourceKey:string):Promise<boolean>{await run('DELETE FROM destination_map WHERE profile_id=? AND source_key=?',[profileId,sourceKey]);return Boolean(await run('DELETE FROM products WHERE profile_id=? AND source_key=?',[profileId,sourceKey]));}
export async function clearProducts(profileId:string):Promise<number>{await run('DELETE FROM destination_map WHERE profile_id=?',[profileId]);return run('DELETE FROM products WHERE profile_id=?',[profileId]);}
export async function findMissingProducts(profileId:string,seenKeys:string[]):Promise<Product[]>{if(!seenKeys.length)return[];const seen=new Set(seenKeys),existing=await rows<{source_key:string;data:string}>('SELECT source_key,data FROM products WHERE profile_id=? AND active=1',[profileId]);return existing.filter(x=>!seen.has(x.source_key)).map(productFromRow).filter(validProductRow)}
export async function markMissingProducts(profileId:string,seenKeys:string[]):Promise<number>{
  if(!seenKeys.length)return 0;const seen=new Set(seenKeys),existing=await rows<{source_key:string}>('SELECT source_key FROM products WHERE profile_id=? AND active=1',[profileId]),missing=existing.filter(x=>!seen.has(x.source_key));
  if(!missing.length)return 0;const timestamp=now(),db=getEnv().DB;for(let i=0;i<missing.length;i+=50)await db.batch(missing.slice(i,i+50).map(x=>db.prepare('UPDATE products SET active=0,missing_since=COALESCE(missing_since,?),updated_at=? WHERE profile_id=? AND source_key=?').bind(timestamp,timestamp,profileId,x.source_key)));return missing.length;
}
export async function maintenanceRows(profileId=''):Promise<any[]>{
  const productRows=await rows<any>(`SELECT * FROM products ${profileId?'WHERE profile_id=?':''} ORDER BY updated_at DESC`,profileId?[profileId]:[]),maps=await rows<any>(`SELECT * FROM destination_map ${profileId?'WHERE profile_id=?':''}`,profileId?[profileId]:[]),by=new Map<string,any[]>();
  for(const map of maps){const key=`${map.profile_id}\u0000${map.source_key}`,items=by.get(key)||[];items.push(map);by.set(key,items)}
  return productRows.map(row=>({...row,data:json(row.data,{}),active:Boolean(row.active),maps:by.get(`${row.profile_id}\u0000${row.source_key}`)||[]}));
}
export async function setRemoteId(profileId:string,sourceKey:string,target:'woo'|'basalam',id:number|string):Promise<void>{const column=target==='woo'?'remote_woo_id':'remote_basalam_id';await run(`UPDATE products SET ${column}=?,updated_at=? WHERE profile_id=? AND source_key=?`,[id,now(),profileId,sourceKey]);}
export async function getRemoteId(profileId:string,sourceKey:string,target:'woo'|'basalam'):Promise<number|string|null>{const column=target==='woo'?'remote_woo_id':'remote_basalam_id',row=await statement(`SELECT CAST(${column} AS TEXT) AS id FROM products WHERE profile_id=? AND source_key=?`,[profileId,sourceKey]).first<{id:unknown}>();return toRemoteId(row?.id);}
export async function getDestinationId(profileId:string,sourceKey:string,target:string,accountKey='default'):Promise<number|string|null>{const row=await statement('SELECT CAST(remote_id AS TEXT) AS remote_id FROM destination_map WHERE profile_id=? AND source_key=? AND target=? AND account_key=?',[profileId,sourceKey,target,accountKey]).first<{remote_id:unknown}>();return toRemoteId(row?.remote_id);}
export async function setDestinationId(profileId:string,sourceKey:string,target:string,accountKey:string,remoteId:number|string):Promise<void>{await run(`INSERT INTO destination_map(profile_id,source_key,target,account_key,remote_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,source_key,target,account_key) DO UPDATE SET remote_id=excluded.remote_id,updated_at=excluded.updated_at`,[profileId,sourceKey,target,accountKey,remoteId,now()]);}
export async function markProfileRun(id:string):Promise<void>{await run('UPDATE profiles SET last_run_at=?,updated_at=? WHERE id=?',[now(),now(),id]);}

const normalizeLearning=(value:string)=>normalizePersianText(value).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export async function learnCategory(title:string,categoryId:number,categoryName='',maxWords=5):Promise<number>{const words=normalizeLearning(title).split(' ').filter(Boolean).slice(0,Math.max(1,Math.min(5,maxWords)));let saved=0;for(let n=1;n<=words.length;n++){const phrase=words.slice(0,n).join(' ');await run(`INSERT INTO category_learning(phrase,category_id,category_name,hits,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(phrase,category_id) DO UPDATE SET hits=category_learning.hits+1,category_name=excluded.category_name,updated_at=excluded.updated_at`,[phrase,categoryId,categoryName,now()]);saved++}return saved;}
export async function findLearnedCategory(title:string,maxWords=5):Promise<{categoryId:number;categoryName:string;phrase:string;hits:number}|null>{const words=normalizeLearning(title).split(' ').filter(Boolean).slice(0,Math.max(1,Math.min(5,maxWords)));for(let n=words.length;n>=1;n--){const phrase=words.slice(0,n).join(' '),row=await statement('SELECT * FROM category_learning WHERE phrase=? ORDER BY hits DESC,updated_at DESC LIMIT 1',[phrase]).first<any>();if(row)return{categoryId:Number(row.category_id),categoryName:String(row.category_name),phrase:String(row.phrase),hits:Number(row.hits)}}return null;}
export async function importCategoryLearning(raw:any):Promise<number>{const items=Array.isArray(raw)?raw:Object.entries(raw||{}).map(([phrase,value]:any)=>({phrase,...(typeof value==='object'?value:{category_id:value})}));let count=0;for(const item of items){const phrase=normalizeLearning(String(item.phrase||item.key||'')),categoryId=Number(item.category_id||item.categoryId||item.cat_id||item.id);if(!phrase||!categoryId)continue;await run(`INSERT INTO category_learning(phrase,category_id,category_name,hits,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(phrase,category_id) DO UPDATE SET category_name=excluded.category_name,hits=MAX(category_learning.hits,excluded.hits),updated_at=excluded.updated_at`,[phrase,categoryId,String(item.category_name||item.categoryName||item.cat_name||item.name||''),Math.max(1,Number(item.hits||item.count||1)),now()]);count++}return count;}
export async function listCategoryLearning(limit=1000):Promise<any[]>{return rows('SELECT * FROM category_learning ORDER BY hits DESC,updated_at DESC LIMIT ?',[limit]);}
export async function addAutoreplyLog(row:{chatId:number;customer:string;input:string;output:string;source:string}):Promise<void>{await run('INSERT INTO autoreply_log(chat_id,customer,input_text,output_text,source) VALUES(?,?,?,?,?)',[row.chatId||null,row.customer,row.input,row.output,row.source]);}
export async function importAutoreplyLog(raw:any):Promise<number>{if(!Array.isArray(raw))return 0;let count=0;for(const row of raw.slice(-5000)){await run('INSERT INTO autoreply_log(chat_id,customer,input_text,output_text,source,created_at) VALUES(?,?,?,?,?,?)',[toRemoteId(row.chat_id)||null,String(row.customer||row.who||''),String(row.input_text||row.in||''),String(row.output_text||row.out||''),String(row.source||row.rule||''),row.created_at||row.at?new Date(row.created_at||Number(row.at)*1000).toISOString():now()]);count++}return count;}
export async function listAutoreplyLog(limit=100):Promise<any[]>{return rows('SELECT * FROM autoreply_log ORDER BY created_at DESC LIMIT ?',[limit]);}

// ─── Basalam category bulk-fix: tried-category memory ─────────────────────────
const CATEGORY_NOTEBOOK_PREFIX='basalam_category_notebook_v2:';
const categoryNotebookKey=(shopId:string,id:number)=>CATEGORY_NOTEBOOK_PREFIX+encodeURIComponent(shopId)+':'+String(id);
export async function getTriedBasalamCategories(shopId:string,id:number):Promise<number[]>{
  const entry=await getState<{ids:number[]}|null>(categoryNotebookKey(shopId,id),null);
  if(entry)return entry.ids||[];
  const legacy=await getState<Record<string,number[]>>('basalam_tried_categories_v1',{});
  return legacy[`${shopId}:${id}`]||[];
}
export async function markBasalamCategoriesTried(shopId:string,id:number,ids:Array<number|string>):Promise<number[]>{
  const tried=new Set(await getTriedBasalamCategories(shopId,id));
  for(const raw of ids){const value=Number(raw);if(Number.isInteger(value)&&value>0)tried.add(value)}
  const values=[...tried];
  await setState(categoryNotebookKey(shopId,id),{ids:values,updatedAt:new Date().toISOString()});
  return values;
}
/** Only call after a complete, successful inventory of ALL unapproved pages/shops. */
export async function pruneBasalamCategoryNotebooks(products:Array<{shopId:string;id:number}>):Promise<number>{
  const keep=new Set(products.map(p=>categoryNotebookKey(p.shopId,p.id)));
  const removed=await run(`DELETE FROM app_state WHERE substr(key,1,${CATEGORY_NOTEBOOK_PREFIX.length})='${CATEGORY_NOTEBOOK_PREFIX}' AND key NOT IN (SELECT value FROM json_each(?))`,[JSON.stringify([...keep])]);
  const legacy=await getState<Record<string,number[]>>('basalam_tried_categories_v1',{}),legacyKeep=new Set(products.map(p=>`${p.shopId}:${p.id}`));
  const filtered=Object.fromEntries(Object.entries(legacy).filter(([key])=>legacyKeep.has(key)));
  if(Object.keys(filtered).length)await setState('basalam_tried_categories_v1',filtered);
  else await deleteState('basalam_tried_categories_v1');
  return removed;
}
export async function getState<T>(key:string,fallback:T):Promise<T>{const row=await statement('SELECT value FROM app_state WHERE key=?',[key]).first<{value:string}>();return row?json(row.value,fallback):fallback;}
export async function setState(key:string,value:unknown):Promise<void>{await run(`INSERT INTO app_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,[key,JSON.stringify(value),now()]);}
export async function deleteState(key:string):Promise<void>{await run('DELETE FROM app_state WHERE key=?',[key]);}

// ─── Agentic AI: prompts and runs ────────────────────────────────────────────
export type AgentPromptRow={id:string;name:string;description:string;prompt:string;tools:string;scheduleMinutes:number;modelKey:string;enabled:boolean;maxSteps:number;lastRunAt:string|null;createdAt:string;updatedAt:string};
export type AgentRunRow={id:string;promptId:string;name:string;provider:string;model:string;status:string;phase:string;prompt:string;tools:string;messages:string;logs:string;steps:number;maxSteps:number;result:string|null;error:string|null;startedAt:string|null;finishedAt:string|null;createdAt:string;updatedAt:string};

function agentPromptRow(row:any):AgentPromptRow{return{id:String(row.id),name:String(row.name),description:String(row.description||''),prompt:String(row.prompt),tools:String(row.tools||'[]'),scheduleMinutes:Number(row.schedule_minutes||0),modelKey:String(row.model_key||''),enabled:Boolean(row.enabled),maxSteps:Math.max(1,Number(row.max_steps||6)),lastRunAt:row.last_run_at?String(row.last_run_at):null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)}}
function agentRunRow(row:any):AgentRunRow{return{id:String(row.id),promptId:row.prompt_id?String(row.prompt_id):'',name:String(row.name||''),provider:String(row.provider||''),model:String(row.model||''),status:String(row.status||'queued'),phase:String(row.phase||'starting'),prompt:String(row.prompt||''),tools:String(row.tools||'[]'),messages:String(row.messages||'[]'),logs:String(row.logs||'[]'),steps:Number(row.steps||0),maxSteps:Math.max(1,Number(row.max_steps||6)),result:row.result==null?null:String(row.result),error:row.error==null?null:String(row.error),startedAt:row.started_at?String(row.started_at):null,finishedAt:row.finished_at?String(row.finished_at):null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)}}

export async function listAgentPrompts():Promise<AgentPromptRow[]>{return(await rows('SELECT * FROM agent_prompts ORDER BY updated_at DESC')).map(agentPromptRow)}
export async function getAgentPrompt(id:string):Promise<AgentPromptRow|null>{const row=await statement('SELECT * FROM agent_prompts WHERE id=?',[id]).first();return row?agentPromptRow(row):null}
export async function saveAgentPrompt(p:AgentPromptRow):Promise<void>{await run(`INSERT INTO agent_prompts(id,name,description,prompt,tools,schedule_minutes,model_key,enabled,max_steps,last_run_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,prompt=excluded.prompt,tools=excluded.tools,schedule_minutes=excluded.schedule_minutes,model_key=excluded.model_key,enabled=excluded.enabled,max_steps=excluded.max_steps,updated_at=excluded.updated_at`,[p.id,p.name,p.description,p.prompt,p.tools,p.scheduleMinutes,p.modelKey,p.enabled?1:0,p.maxSteps,p.lastRunAt||null,p.createdAt,p.updatedAt]);}
export async function deleteAgentPrompt(id:string):Promise<void>{await run('DELETE FROM agent_prompts WHERE id=?',[id]);}
export async function touchAgentPromptLastRun(id:string,at:string):Promise<void>{await run('UPDATE agent_prompts SET last_run_at=?,updated_at=? WHERE id=?',[at,at,id]);}

export async function saveAgentRun(p:AgentRunRow):Promise<void>{await run(`INSERT INTO agent_runs(id,prompt_id,name,provider,model,status,phase,prompt,tools,messages,logs,steps,max_steps,result,error,started_at,finished_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[p.id,p.promptId||null,p.name,p.provider,p.model,p.status,p.phase,p.prompt,p.tools,p.messages,p.logs,p.steps,p.maxSteps,p.result||null,p.error||null,p.startedAt||null,p.finishedAt||null,p.createdAt,p.updatedAt]);}
export async function updateAgentRun(p:AgentRunRow):Promise<void>{await run(`UPDATE agent_runs SET name=?,provider=?,model=?,status=?,phase=?,prompt=?,tools=?,messages=?,logs=?,steps=?,max_steps=?,result=?,error=?,started_at=?,finished_at=?,updated_at=? WHERE id=?`,[p.name,p.provider,p.model,p.status,p.phase,p.prompt,p.tools,p.messages,p.logs,p.steps,p.maxSteps,p.result||null,p.error||null,p.startedAt||null,p.finishedAt||null,now(),p.id]);}
export async function getAgentRun(id:string):Promise<AgentRunRow|null>{const row=await statement('SELECT * FROM agent_runs WHERE id=?',[id]).first();return row?agentRunRow(row):null}
export async function listAgentRuns(limit=30):Promise<AgentRunRow[]>{return(await rows('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?',[Math.max(1,Math.min(200,limit))])).map(agentRunRow)}
export async function deleteAgentRun(id:string):Promise<void>{await run('DELETE FROM agent_runs WHERE id=?',[id]);}
export async function deleteAgentRunsForPrompt(promptId:string):Promise<void>{await run('DELETE FROM agent_runs WHERE prompt_id=?',[promptId]);}

export async function createBackup():Promise<Record<string,unknown>>{const [profiles,products,jobs,states,destinationMap,categoryLearning,autoreplyLog]=await Promise.all([rows('SELECT * FROM profiles ORDER BY created_at'),rows('SELECT * FROM products ORDER BY profile_id,created_at'),rows('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1000'),rows('SELECT * FROM app_state ORDER BY key'),rows('SELECT * FROM destination_map ORDER BY profile_id,target,account_key'),rows('SELECT * FROM category_learning ORDER BY hits DESC'),rows('SELECT * FROM autoreply_log ORDER BY created_at DESC LIMIT 5000')]);return{app:'scraper4-cloudflare',version:1,createdAt:now(),profiles,products,jobs,states,destinationMap,categoryLearning,autoreplyLog};}
export async function restoreBackup(bundle:any):Promise<{profiles:number;products:number;states:number}>{
  if(!bundle||!['scraper4-cloudflare','scraper4-backup','scraper4-render'].includes(bundle.app)||bundle.version!==1)throw new Error('Invalid Scraper 4 backup');let profiles=0,products=0,states=0;
  for(const row of bundle.profiles||[]){const data=json<any>(row.data,row.data||{});await saveProfile({...data,id:row.id,enabled:Boolean(row.enabled),intervalMinutes:Number(row.interval_minutes||0),lastRunAt:row.last_run_at||null,createdAt:row.created_at||now(),updatedAt:now()});profiles++;}
  for(const row of bundle.products||[]){const product=json<any>(row.data,row.data);await upsertProduct(row.profile_id,product);if(row.remote_woo_id){const wooId=toRemoteId(row.remote_woo_id);if(wooId!=null)await setRemoteId(row.profile_id,row.source_key,'woo',wooId);}if(row.remote_basalam_id){const basalamId=toRemoteId(row.remote_basalam_id);if(basalamId!=null)await setRemoteId(row.profile_id,row.source_key,'basalam',basalamId);}products++;}
  for(const row of bundle.destinationMap||[]){const mapId=toRemoteId(row.remote_id);if(mapId!=null)await setDestinationId(row.profile_id,row.source_key,row.target,row.account_key,mapId);}
  await importCategoryLearning(bundle.categoryLearning||[]);await importAutoreplyLog(bundle.autoreplyLog||[]);
  for(const row of bundle.states||[]){await setState(row.key,json(row.value,row.value));states++;}return{profiles,products,states};
}
export async function profileStats():Promise<any[]>{const profiles=await listProfiles(),result:any[]=[];for(const profile of profiles){const row=await statement('SELECT count(*) products,count(remote_woo_id) woo_mapped,count(remote_basalam_id) basalam_mapped,max(updated_at) last_product_at FROM products WHERE profile_id=?',[profile.id]).first<any>();result.push({id:profile.id,name:profile.name,...row})}return result;}
export async function reapStalledJobs(minutes=30):Promise<number>{const cutoff=new Date(Date.now()-Math.max(0.5,Number(minutes)||30)*60_000).toISOString();return run(`UPDATE jobs SET status='failed',phase='watchdog',error='Job was inactive and closed by watchdog',finished_at=?,updated_at=? WHERE status='running' AND updated_at<?`,[now(),now(),cutoff]);}
export async function recoverFailedAndStalledJobs(minutes=30):Promise<number>{const cutoff=new Date(Date.now()-Math.max(0.5,Number(minutes)||30)*60_000).toISOString(),timestamp=now();return run(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=0,error=NULL,finished_at=NULL,updated_at=? WHERE status='failed' OR (status='running' AND updated_at<?)`,[timestamp,cutoff]);}
export async function enqueueDueProfiles():Promise<Job[]>{const timestamp=Date.now(),profiles=await listProfiles(),jobs:Job[]=[];for(const profile of profiles){if(!profile.enabled||!profile.intervalMinutes)continue;const due=!profile.lastRunAt||timestamp-new Date(profile.lastRunAt).getTime()>=profile.intervalMinutes*60_000;if(!due)continue;const job=await createJob(profile.id,profile.noExtract?'sync':'scrape',profile.syncWoo&&profile.syncBasalam?'both':profile.syncWoo?'woo':profile.syncBasalam?'basalam':'none');jobs.push(job);await markProfileRun(profile.id)}return jobs;}

/** Keyset pagination stays stable while updated_at changes. Conflicting edits are not overwritten. */
export async function applyStoredResultSettings(profile:Profile,after='',previousSuffix=profile.titleSuffix||''){
  const settings=await getState<any>('settings',{}),batch=await rows<{source_key:string;data:string}>('SELECT source_key,data FROM products WHERE profile_id=? AND source_key>? ORDER BY source_key LIMIT 20',[profile.id,after]);
  let changed=0,conflicts=0;
  for(const row of batch){
    const product=json<any>(row.data,row.data);
    if(!validProductRow(product))continue;
    const originalData=typeof row.data==='string'?row.data:JSON.stringify(row.data);
    if(!(product as any).resultBase&&previousSuffix&&product.title.endsWith(previousSuffix.trim())){(product as any).resultBase={title:product.title.slice(0,-previousSuffix.trim().length).trimEnd(),price:product.price,priceText:product.priceText};}
    applyResultAdjustments(product,profile,String(settings?.dedup?.suffixFormats||''));
    const result=await run('UPDATE products SET data=?,title=?,price=?,updated_at=? WHERE profile_id=? AND source_key=? AND data=?',[JSON.stringify(product),product.title,product.price,now(),profile.id,row.source_key,originalData]);
    if(result)changed++;else conflicts++;
  }
  return{changed,conflicts,next:batch.length===20?String(batch[batch.length-1].source_key):null};
}
