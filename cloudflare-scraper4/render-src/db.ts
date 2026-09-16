import { isoDateTime, normalizeDbValue, normalizePersianText, toRemoteId } from '../worker-src/utils.js';
import pg from 'pg';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config } from './config.js';
import type { Job, Product, Profile } from './types.js';

const { Pool } = pg;
// Mutable: a loopback PostgreSQL that refuses connections (no server installed,
// the usual case on Termux/Android) self-heals to the built-in SQLite file
// instead of leaving the app permanently unusable. See fallbackToSqlite below.
let useSqlite = !config.databaseUrl || config.databaseUrl.startsWith('sqlite:') || config.databaseUrl.startsWith('file:');
let pgPool = useSqlite ? null : new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: Math.max(2, Number(process.env.DB_POOL_SIZE || 10)),
  idleTimeoutMillis: 30_000
});
let sqliteDb: any = null;
export let databaseDriver = useSqlite ? 'sqlite' : 'postgres';
export let databaseLabel = useSqlite ? 'local SQLite' : 'PostgreSQL';
export let sqliteFallbackReason = '';

/** True when the configured PostgreSQL server lives on this device. */
export function isLoopbackPostgres(): boolean {
  if (useSqlite) return false;
  try {
    const host = new URL(config.databaseUrl.replace(/^postgres(ql)?:/i, 'http:')).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch { return false; }
}

/**
 * Switch to the built-in SQLite database at runtime. Only ever called for a
 * loopback PostgreSQL: a REMOTE database that is merely down must keep failing
 * loudly, because silently serving an empty local file would hide real data.
 */
export function fallbackToSqlite(reason: string): boolean {
  if (useSqlite || !isLoopbackPostgres()) return false;
  const dying = pgPool;
  useSqlite = true;
  pgPool = null;
  databaseDriver = 'sqlite';
  databaseLabel = 'local SQLite';
  sqliteFallbackReason = reason;
  void dying?.end().catch(() => {});
  return true;
}
function sqlitePath(): string {
  // Accept sqlite:path, file:path, sqlite:///abs/path and bare paths. Windows
  // drive letters (sqlite:C:\dir\db.sqlite) must survive the prefix stripping.
  const fromConfig = /^(postgres|postgresql|mysql|mariadb):/i.test(config.databaseUrl) ? '' : config.databaseUrl;
  const configured = String(process.env.SCRAPER4_SQLITE_PATH || fromConfig || '').trim();
  const raw = configured.replace(/^sqlite:(\/\/)?/i, '').replace(/^file:(\/\/)?/i, '').trim();
  return resolve(raw || 'data/scraper4.sqlite');
}
async function getSqliteDb(): Promise<any> {
  if (sqliteDb) return sqliteDb;
  const file = sqlitePath();
  mkdirSync(dirname(file), { recursive: true });
  let mod: any;
  try {
    mod = await import('node:sqlite');
  } catch (error) {
    // node:sqlite ships with Node.js >= 22.5. Older Node (e.g. v20) cannot run
    // the local SQLite mode; explain the fix instead of failing cryptically.
    const [nodeMajor, nodeMinor] = String(process.versions.node || '').split('.').map(Number);
    if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
      throw new Error(
        `SQLite mode needs Node.js 22.5+ (you are running Node ${process.versions.node}). ` +
        'On Windows install the current Node.js LTS (winget install OpenJS.NodeJS.LTS) and restart, ' +
        'or set DATABASE_URL to a PostgreSQL connection string in .env.local. ' +
        `(node:sqlite import failed: ${error instanceof Error ? error.message : String(error)})`
      );
    }
    throw new Error(`node:sqlite could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  // readBigInts: without it node:sqlite THROWS `RangeError: Value is too large
  // to be represented as a JavaScript number` on any INTEGER above 2^53
  // (real case: Basalam remote id 3838404244461599744), failing the whole
  // operation. With it every integer arrives as a BigInt and query()
  // normalizes safe ones back to numbers, huge ones to exact strings.
  sqliteDb = new mod.DatabaseSync(file, { readBigInts: true });
  sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return sqliteDb;
}
/**
 * Snapshot the live SQLite database into a clean standalone file and return
 * it base64-encoded for the branch backup. VACUUM INTO (not a raw file copy)
 * because the live database runs in WAL mode, so the .sqlite file alone is
 * incomplete. Never throws: anything unexpected becomes an honest skip note
 * and the JSON backup parts still go up.
 */
export async function snapshotSqliteDatabase(): Promise<{ b64: string; bytes: number } | { skipped: string }> {
  if (!useSqlite) return { skipped: 'not-sqlite' };
  let dir = '';
  try {
    const db = await getSqliteDb();
    dir = mkdtempSync(join(tmpdir(), 'scraper4-dbsnap-'));
    const file = join(dir, 'database.sqlite');
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = readFileSync(file);
    if (bytes.length > 48 * 1024 * 1024) return { skipped: 'too-large' };
    return { b64: bytes.toString('base64'), bytes: bytes.length };
  } catch {
    return { skipped: 'unavailable' };
  } finally {
    try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
function normalizeSqliteParam(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value;
}
function sqliteSql(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const ordered: unknown[] = [];
  const converted = sql
    .replace(/\$(\d+)(::text\[\])?/g, (_m, n) => { ordered.push(normalizeSqliteParam(params[Number(n) - 1])); return '?'; })
    .replace(/now\(\)/g, "datetime('now')")
    .replace(/EXCLUDED\./g, 'excluded.');
  return { sql: converted, params: ordered.length ? ordered : params.map(normalizeSqliteParam) };
}
async function query(sql: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
  if (!useSqlite) return pgPool!.query(sql, params) as any;
  const db = await getSqliteDb();
  const tx = sqliteSql(sql, params);
  const text = tx.sql.trim();
  if (!text) return { rows: [], rowCount: 0 };
  if (/^(select|pragma)\b/i.test(text) || /\breturning\b/i.test(text)) {
    const rows = db.prepare(text).all(...tx.params) as Record<string, unknown>[];
    // node:sqlite returns every integer as BigInt (see readBigInts above);
    // JSON.stringify rejects BigInt, so normalize before anything can leak.
    for (const row of rows) for (const key of Object.keys(row)) row[key] = normalizeDbValue(row[key]);
    return { rows, rowCount: rows.length };
  }
  const info = db.prepare(text).run(...tx.params);
  return { rows: [], rowCount: Number(info.changes || 0) };
}
export const pool = {
  query,
  async connect() {
    if (!useSqlite) return pgPool!.connect();
    return { query, release() {} };
  },
  async end() { if (!useSqlite) await pgPool!.end(); else if (sqliteDb) { sqliteDb.close(); sqliteDb = null; } }
};
function now(): string { return new Date().toISOString(); }
function parseJson<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return (value ?? fallback) as T; try { return JSON.parse(value) as T; } catch { return fallback; } }
function sqliteCutoff(minutes: number): string { return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' '); }

export async function migrate(): Promise<void> {
  if (useSqlite) {
    const db = await getSqliteDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (id text PRIMARY KEY,data text NOT NULL,enabled integer NOT NULL DEFAULT 1,interval_minutes integer NOT NULL DEFAULT 0,last_run_at text,created_at text NOT NULL DEFAULT (datetime('now')),updated_at text NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS products (profile_id text NOT NULL,source_key text NOT NULL,data text NOT NULL,title text NOT NULL,price integer NOT NULL DEFAULT 0,source_url text NOT NULL DEFAULT '',remote_woo_id integer,remote_basalam_id integer,created_at text NOT NULL DEFAULT (datetime('now')),updated_at text NOT NULL DEFAULT (datetime('now')),active integer NOT NULL DEFAULT 1,missing_since text,PRIMARY KEY(profile_id,source_key));
      CREATE INDEX IF NOT EXISTS products_profile_updated_idx ON products(profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS products_title_idx ON products(title);
      CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY,profile_id text NOT NULL,kind text NOT NULL,target text NOT NULL DEFAULT 'none',status text NOT NULL DEFAULT 'queued',phase text NOT NULL DEFAULT 'waiting',total integer NOT NULL DEFAULT 0,processed integer NOT NULL DEFAULT 0,added integer NOT NULL DEFAULT 0,updated integer NOT NULL DEFAULT 0,failed integer NOT NULL DEFAULT 0,stop_requested integer NOT NULL DEFAULT 0,error text,log text NOT NULL DEFAULT '[]',created_at text NOT NULL DEFAULT (datetime('now')),started_at text,finished_at text,updated_at text NOT NULL DEFAULT (datetime('now')));
      CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS destination_map (profile_id text NOT NULL,source_key text NOT NULL,target text NOT NULL,account_key text NOT NULL DEFAULT 'default',remote_id integer NOT NULL,updated_at text NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(profile_id,source_key,target,account_key));
      CREATE TABLE IF NOT EXISTS category_learning (phrase text NOT NULL, category_id integer NOT NULL, category_name text NOT NULL DEFAULT '', hits integer NOT NULL DEFAULT 1, updated_at text NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(phrase,category_id));
      CREATE TABLE IF NOT EXISTS autoreply_log (id integer PRIMARY KEY AUTOINCREMENT, chat_id integer, customer text NOT NULL DEFAULT '', input_text text NOT NULL, output_text text NOT NULL, source text NOT NULL, created_at text NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY,value text NOT NULL,updated_at text NOT NULL DEFAULT (datetime('now')));
    `);
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      interval_minutes integer NOT NULL DEFAULT 0,
      last_run_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS products (
      profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source_key text NOT NULL,
      data jsonb NOT NULL,
      title text NOT NULL,
      price bigint NOT NULL DEFAULT 0,
      source_url text NOT NULL DEFAULT '',
      remote_woo_id bigint,
      remote_basalam_id bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(profile_id, source_key)
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS missing_since timestamptz;
    CREATE INDEX IF NOT EXISTS products_profile_updated_idx ON products(profile_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS products_title_idx ON products USING gin(to_tsvector('simple', title));
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY,
      profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('scrape','sync')),
      target text NOT NULL DEFAULT 'none',
      status text NOT NULL DEFAULT 'queued',
      phase text NOT NULL DEFAULT 'waiting',
      total integer NOT NULL DEFAULT 0,
      processed integer NOT NULL DEFAULT 0,
      added integer NOT NULL DEFAULT 0,
      updated integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      stop_requested boolean NOT NULL DEFAULT false,
      error text,
      log jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS destination_map (
      profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source_key text NOT NULL,
      target text NOT NULL,
      account_key text NOT NULL DEFAULT 'default',
      remote_id bigint NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(profile_id,source_key,target,account_key)
    );
    CREATE TABLE IF NOT EXISTS category_learning (
      phrase text NOT NULL, category_id bigint NOT NULL, category_name text NOT NULL DEFAULT '', hits integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(phrase,category_id)
    );
    CREATE TABLE IF NOT EXISTS autoreply_log (
      id bigserial PRIMARY KEY, chat_id bigint, customer text NOT NULL DEFAULT '', input_text text NOT NULL, output_text text NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

function dateValue(value: any): string { return isoDateTime(value) || now(); }
function profileFromRow(row: any): Profile {
  const data = parseJson<Partial<Profile>>(row.data, row.data || {});
  return { ...data, lastRunAt: isoDateTime(row.last_run_at), createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at) } as Profile;
}

export async function listProfiles(): Promise<Profile[]> {
  const { rows } = await pool.query('SELECT * FROM profiles ORDER BY updated_at DESC');
  return rows.map(profileFromRow);
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { rows } = await pool.query('SELECT * FROM profiles WHERE id=$1', [id]);
  return rows[0] ? profileFromRow(rows[0]) : null;
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const { rows } = await pool.query(`
    INSERT INTO profiles(id,data,enabled,interval_minutes,created_at,updated_at)
    VALUES($1,$2,$3,$4,now(),now())
    ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,enabled=EXCLUDED.enabled,
      interval_minutes=EXCLUDED.interval_minutes,updated_at=now()
    RETURNING *`, [profile.id, JSON.stringify(profile), profile.enabled, profile.intervalMinutes]);
  return profileFromRow(rows[0]);
}

export async function deleteProfile(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM profiles WHERE id=$1', [id]);
  return Boolean(result.rowCount);
}

export async function createJob(profileId: string, kind: Job['kind'], target: Job['target'], _options: { forceNew?: boolean } = {}): Promise<Job> {
  const settings=await getState<any>('settings',{}),staleMin=Math.max(1,Number(settings?.general?.queueDedupStale)||120);
  const active=await pool.query("SELECT * FROM jobs WHERE profile_id=$1 AND status IN ('queued','running') ORDER BY created_at LIMIT 1",[profileId]);
  if(active.rows[0]){
    const job=jobFromRow(active.rows[0]),age=Date.now()-new Date(job.updatedAt).getTime();
    if(age>=staleMin*60_000) await updateJob(job.id,{status:'failed',phase:'stale-replaced',error:'Previous active job for this profile was stale and was replaced.',finishedAt:new Date().toISOString(),stopRequested:true});
    else return job;
  }
  const id = crypto.randomUUID();
  const { rows } = await pool.query(`INSERT INTO jobs(id,profile_id,kind,target) VALUES($1,$2,$3,$4) RETURNING *`, [id, profileId, kind, target]);
  return jobFromRow(rows[0]);
}

export async function stopJob(id:string):Promise<Job|null>{await deleteState(`job_checkpoint:${id}`);const {rows}=await pool.query(`UPDATE jobs SET status='stopped',phase='finished',stop_requested=true,error='Stopped manually',finished_at=now(),updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING *`,[id]);return rows[0]?jobFromRow(rows[0]):null}
export async function retryJob(id:string):Promise<Job|null>{const {rows}=await pool.query(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=false,error=NULL,started_at=NULL,finished_at=NULL,processed=0,added=0,updated=0,failed=0,updated_at=now() WHERE id=$1 AND status IN ('failed','stopped','done') RETURNING *`,[id]);return rows[0]?jobFromRow(rows[0]):null}
export async function deleteJob(id:string):Promise<boolean>{const result=await pool.query(`DELETE FROM jobs WHERE id=$1 AND status NOT IN ('running')`,[id]);return Boolean(result.rowCount)}
export async function clearFinishedJobs():Promise<number>{const result=await pool.query(`DELETE FROM jobs WHERE status IN ('done','failed','stopped')`);return result.rowCount||0}

export async function getJob(id: string): Promise<Job | null> {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id=$1', [id]);
  return rows[0] ? jobFromRow(rows[0]) : null;
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const { rows } = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(jobFromRow);
}

export async function claimJob(): Promise<Job | null> {
  if (useSqlite) {
    // A single UPDATE is atomic across processes and does not leave a shared
    // SQLite connection in an open transaction across JavaScript awaits.
    const result = await query(`UPDATE jobs SET status='running',phase='starting',started_at=datetime('now'),updated_at=datetime('now')
      WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1) AND status='queued' RETURNING *`);
    return result.rows[0] ? jobFromRow(result.rows[0]) : null;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!rows[0]) { await client.query('COMMIT'); return null; }
    const result = await client.query(`UPDATE jobs SET status='running',phase='starting',started_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [rows[0].id]);
    await client.query('COMMIT');
    return jobFromRow(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<void> {
  const allowed: Record<string, string> = { status: 'status', phase: 'phase', total: 'total', processed: 'processed', added: 'added', updated: 'updated', failed: 'failed', stopRequested: 'stop_requested', error: 'error', log: 'log', finishedAt: 'finished_at' };
  const entries = Object.entries(patch).filter(([key]) => allowed[key]);
  if (!entries.length) return;
  const sets = entries.map(([key], i) => `${allowed[key]}=$${i + 2}`);
  const values = entries.map(([key, value]) => key === 'log' ? JSON.stringify(value) : value);
  await pool.query(`UPDATE jobs SET ${sets.join(',')},updated_at=now() WHERE id=$1`, [id, ...values]);
}

export async function stopRequested(id: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT stop_requested FROM jobs WHERE id=$1', [id]);
  return Boolean(rows[0]?.stop_requested);
}

function validProductRow(p: any): p is Product { return !!p && typeof p === 'object' && !Array.isArray(p); }

export async function upsertProduct(profileId: string, product: Product): Promise<'added' | 'updated'> {
  if (!validProductRow(product)) throw new Error('upsertProduct refused a non-object product');
  const { rows } = await pool.query('SELECT 1 FROM products WHERE profile_id=$1 AND source_key=$2', [profileId, product.sourceKey]);
  await pool.query(`INSERT INTO products(profile_id,source_key,data,title,price,source_url) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(profile_id,source_key) DO UPDATE SET data=EXCLUDED.data,title=EXCLUDED.title,price=EXCLUDED.price,source_url=EXCLUDED.source_url,active=true,missing_since=NULL,updated_at=now()`,
    [profileId, product.sourceKey, JSON.stringify(product), product.title, product.price, product.url]);
  return rows[0] ? 'updated' : 'added';
}

export async function listProducts(profileId: string, limit = 100, offset = 0, q = ''): Promise<{ products: Product[]; total: number }> {
  if (useSqlite) {
    const like = `%${q}%`;
    const where = (q ? 'profile_id=? AND title LIKE ?' : 'profile_id=?') + ` AND data IS NOT NULL AND data<>'null'`;
    const params = q ? [profileId, like] : [profileId];
    const count = await query(`SELECT count(*) total FROM products WHERE ${where}`, params);
    const { rows } = await query(`SELECT data FROM products WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { products: rows.map(row => parseJson<Product>(row.data, row.data)).filter(validProductRow), total: Number(count.rows[0]?.total || 0) };
  }
  const params: unknown[] = [profileId]; let where = `profile_id=$1 AND data IS NOT NULL AND data::text<>'null'`;
  if (q) { params.push(`%${q}%`); where += ` AND title ILIKE $${params.length}`; }
  const count = await pool.query(`SELECT count(*)::int total FROM products WHERE ${where}`, params);
  params.push(limit, offset);
  const { rows } = await pool.query(`SELECT data FROM products WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { products: rows.map(row => parseJson<Product>(row.data, row.data)).filter(validProductRow), total: Number(count.rows[0].total || 0) };
}

export async function allProducts(profileId: string): Promise<Product[]> {
  // The sync queue also runs on SQLite; PostgreSQL's ::text cast is invalid there.
  const dataText = useSqlite ? 'data' : 'data::text';
  const { rows } = await pool.query(`SELECT data FROM products WHERE profile_id=$1 AND data IS NOT NULL AND ${dataText}<>'null' ORDER BY updated_at`, [profileId]);
  return rows.map(row => parseJson<Product>(row.data, row.data)).filter(validProductRow);
}
export async function listStalestProducts(profileId: string, limit = 5): Promise<Product[]> {
  const n = Math.max(1, Math.min(20, limit));
  if (useSqlite) {
    const { rows } = await query(`SELECT data FROM products WHERE profile_id=? AND data IS NOT NULL AND data<>'null' ORDER BY updated_at ASC LIMIT ?`, [profileId, n]);
    return rows.map(row => parseJson<Product>(row.data, row.data)).filter(validProductRow);
  }
  const { rows } = await pool.query(`SELECT data FROM products WHERE profile_id=$1 AND data IS NOT NULL AND data::text<>'null' ORDER BY updated_at ASC LIMIT $2`, [profileId, n]);
  return rows.map(row => parseJson<Product>(row.data, row.data)).filter(validProductRow);
}
export async function getProduct(profileId:string,sourceKey:string):Promise<Product|null>{const {rows}=await pool.query('SELECT data FROM products WHERE profile_id=$1 AND source_key=$2',[profileId,sourceKey]);return rows[0]?.data ? parseJson<Product>(rows[0].data, rows[0].data) : null}
export async function deleteProduct(profileId:string,sourceKey:string):Promise<boolean>{
  if(useSqlite){await query('DELETE FROM destination_map WHERE profile_id=? AND source_key=?',[profileId,sourceKey]);const result=await query('DELETE FROM products WHERE profile_id=? AND source_key=?',[profileId,sourceKey]);return Boolean(result.rowCount)}
  await pool.query('DELETE FROM destination_map WHERE profile_id=$1 AND source_key=$2',[profileId,sourceKey]);const result=await pool.query('DELETE FROM products WHERE profile_id=$1 AND source_key=$2',[profileId,sourceKey]);return Boolean(result.rowCount)
}
export async function clearProducts(profileId:string):Promise<number>{
  if(useSqlite){await query('DELETE FROM destination_map WHERE profile_id=?',[profileId]);const result=await query('DELETE FROM products WHERE profile_id=?',[profileId]);return result.rowCount||0}
  await pool.query('DELETE FROM destination_map WHERE profile_id=$1',[profileId]);const result=await pool.query('DELETE FROM products WHERE profile_id=$1',[profileId]);return result.rowCount||0
}

export async function markMissingProducts(profileId:string,seenKeys:string[]):Promise<number>{
  if(!seenKeys.length)return 0;
  if(useSqlite){const placeholders=seenKeys.map(()=>'?').join(',');const result=await query(`UPDATE products SET active=0,missing_since=COALESCE(missing_since,datetime('now')),updated_at=datetime('now') WHERE profile_id=? AND active=1 AND source_key NOT IN (${placeholders})`,[profileId,...seenKeys]);return result.rowCount||0}
  const result=await pool.query(`UPDATE products SET active=false,missing_since=COALESCE(missing_since,now()),updated_at=now() WHERE profile_id=$1 AND active=true AND NOT(source_key=ANY($2::text[]))`,[profileId,seenKeys]);return result.rowCount||0}
export async function maintenanceRows(profileId=''):Promise<any[]>{
  if(useSqlite){const products=(await query(`SELECT * FROM products WHERE (?='' OR profile_id=?) ORDER BY updated_at DESC`,[profileId,profileId])).rows;const maps=(await query('SELECT * FROM destination_map')).rows;return products.map(p=>({...p,data:parseJson<Product>(p.data,p.data),active:Boolean(p.active),maps:maps.filter(m=>m.profile_id===p.profile_id&&m.source_key===p.source_key)}))}
  const {rows}=await pool.query(`SELECT p.profile_id,p.source_key,p.data,p.title,p.price,p.source_url,p.remote_woo_id,p.remote_basalam_id,p.active,p.missing_since,COALESCE(json_agg(dm) FILTER(WHERE dm.remote_id IS NOT NULL),'[]') maps FROM products p LEFT JOIN destination_map dm ON dm.profile_id=p.profile_id AND dm.source_key=p.source_key WHERE ($1='' OR p.profile_id=$1) GROUP BY p.profile_id,p.source_key ORDER BY p.updated_at DESC`,[profileId]);return rows}

export async function setRemoteId(profileId: string, sourceKey: string, target: 'woo'|'basalam', id: number | string): Promise<void> {
  const column = target === 'woo' ? 'remote_woo_id' : 'remote_basalam_id';
  await pool.query(`UPDATE products SET ${column}=$3,updated_at=now() WHERE profile_id=$1 AND source_key=$2`, [profileId, sourceKey, id]);
}

export async function getRemoteId(profileId: string, sourceKey: string, target: 'woo'|'basalam'): Promise<number | string | null> {
  const column = target === 'woo' ? 'remote_woo_id' : 'remote_basalam_id';
  const { rows } = await pool.query(`SELECT ${column} id FROM products WHERE profile_id=$1 AND source_key=$2`, [profileId, sourceKey]);
  return toRemoteId(rows[0]?.id);
}

export async function getDestinationId(profileId:string,sourceKey:string,target:string,accountKey='default'):Promise<number|string|null>{const {rows}=await pool.query('SELECT remote_id FROM destination_map WHERE profile_id=$1 AND source_key=$2 AND target=$3 AND account_key=$4',[profileId,sourceKey,target,accountKey]);return toRemoteId(rows[0]?.remote_id)}
export async function setDestinationId(profileId:string,sourceKey:string,target:string,accountKey:string,remoteId:number|string):Promise<void>{await pool.query(`INSERT INTO destination_map(profile_id,source_key,target,account_key,remote_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(profile_id,source_key,target,account_key) DO UPDATE SET remote_id=EXCLUDED.remote_id,updated_at=now()`,[profileId,sourceKey,target,accountKey,remoteId])}

export async function markProfileRun(id: string): Promise<void> { await pool.query('UPDATE profiles SET last_run_at=now() WHERE id=$1', [id]); }

export async function learnCategory(title:string,categoryId:number,categoryName='',maxWords=5):Promise<number>{const words=normalizeLearning(title).split(' ').filter(Boolean).slice(0,Math.max(1,Math.min(5,maxWords)));let saved=0;for(let n=1;n<=words.length;n++){const phrase=words.slice(0,n).join(' ');await pool.query(`INSERT INTO category_learning(phrase,category_id,category_name,hits,updated_at) VALUES($1,$2,$3,1,now()) ON CONFLICT(phrase,category_id) DO UPDATE SET hits=category_learning.hits+1,category_name=EXCLUDED.category_name,updated_at=now()`,[phrase,categoryId,categoryName]);saved++}return saved}
export async function findLearnedCategory(title:string,maxWords=5):Promise<{categoryId:number;categoryName:string;phrase:string;hits:number}|null>{const words=normalizeLearning(title).split(' ').filter(Boolean).slice(0,Math.max(1,Math.min(5,maxWords)));for(let n=words.length;n>=1;n--){const phrase=words.slice(0,n).join(' '),{rows}=await pool.query(`SELECT category_id,category_name,phrase,hits FROM category_learning WHERE phrase=$1 ORDER BY hits DESC,updated_at DESC LIMIT 1`,[phrase]);if(rows[0])return{categoryId:Number(rows[0].category_id),categoryName:rows[0].category_name,phrase:rows[0].phrase,hits:rows[0].hits}}return null}
export async function importCategoryLearning(raw:any):Promise<number>{const items=Array.isArray(raw)?raw:Object.entries(raw||{}).map(([phrase,value]:any)=>({phrase,...(typeof value==='object'?value:{category_id:value})}));let count=0;for(const item of items){const phrase=normalizeLearning(String(item.phrase||item.key||'')),categoryId=Number(item.category_id||item.categoryId||item.cat_id||item.id);if(!phrase||!categoryId)continue;await pool.query(`INSERT INTO category_learning(phrase,category_id,category_name,hits,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(phrase,category_id) DO UPDATE SET category_name=EXCLUDED.category_name,hits=GREATEST(category_learning.hits,EXCLUDED.hits),updated_at=now()`,[phrase,categoryId,String(item.category_name||item.categoryName||item.cat_name||item.name||''),Math.max(1,Number(item.hits||item.count||1))]);count++}return count}
export async function listCategoryLearning(limit=1000):Promise<any[]>{const {rows}=await pool.query('SELECT phrase,category_id,category_name,hits,updated_at FROM category_learning ORDER BY hits DESC,updated_at DESC LIMIT $1',[limit]);return rows}

// ─── Basalam category bulk-fix: tried-category memory ─────────────────────────
// Mirrors worker-src/db.ts byte-for-byte in behavior: same app_state key, same
// 50-id cap per shop:product, so Worker and Node never retry a failed suggestion.
export async function getTriedBasalamCategories(shopId:string,id:number):Promise<number[]>{
  const data=await getState<Record<string,number[]>>('basalam_tried_categories_v1',{});
  return Array.isArray(data[`${shopId}:${id}`])?data[`${shopId}:${id}`]:[];
}
export async function markBasalamCategoriesTried(shopId:string,id:number,ids:Array<number|string>):Promise<number[]>{
  const data=await getState<Record<string,number[]>>('basalam_tried_categories_v1',{}),key=`${shopId}:${id}`,set=new Set(Array.isArray(data[key])?data[key]:[]);
  for(const raw of ids||[]){const n=Number(raw);if(Number.isInteger(n)&&n>0)set.add(n)}
  data[key]=[...set].slice(-50);
  await setState('basalam_tried_categories_v1',data);
  return data[key];
}
export async function addAutoreplyLog(row:{chatId:number;customer:string;input:string;output:string;source:string}):Promise<void>{await pool.query('INSERT INTO autoreply_log(chat_id,customer,input_text,output_text,source) VALUES($1,$2,$3,$4,$5)',[row.chatId,row.customer,row.input,row.output,row.source])}
export async function importAutoreplyLog(raw:any):Promise<number>{if(!Array.isArray(raw))return 0;let count=0;for(const row of raw.slice(-5000)){const created=row.created_at?new Date(row.created_at):row.at?new Date(Number(row.at)*1000):null;await pool.query('INSERT INTO autoreply_log(chat_id,customer,input_text,output_text,source,created_at) VALUES($1,$2,$3,$4,$5,COALESCE($6,now()))',[toRemoteId(row.chat_id)||null,String(row.customer||row.who||''),String(row.input_text||row.in||''),String(row.output_text||row.out||''),String(row.source||row.rule||''),created]);count++}return count}
export async function listAutoreplyLog(limit=100):Promise<any[]>{const {rows}=await pool.query('SELECT * FROM autoreply_log ORDER BY created_at DESC LIMIT $1',[limit]);return rows}
function normalizeLearning(value:string){return normalizePersianText(value).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim()}

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const { rows } = await pool.query('SELECT value FROM app_state WHERE key=$1', [key]);
  return rows[0] ? parseJson<T>(rows[0].value, fallback) : fallback;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await pool.query(`INSERT INTO app_state(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [key, JSON.stringify(value)]);
}
export async function deleteState(key: string): Promise<void> { await pool.query('DELETE FROM app_state WHERE key=$1', [key]); }

/** True only when nothing was ever configured: no profiles and no stored state. */
export async function isFreshDatabase(): Promise<boolean> {
  const profiles = await pool.query('SELECT COUNT(*) AS n FROM profiles');
  if (Number(profiles.rows[0]?.n || 0) > 0) return false;
  const states = await pool.query('SELECT COUNT(*) AS n FROM app_state');
  return Number(states.rows[0]?.n || 0) === 0;
}

export async function createBackup(): Promise<Record<string, unknown>> {
  const [profiles,products,jobs,states,maps,learning,autoreply] = await Promise.all([
    pool.query('SELECT * FROM profiles ORDER BY created_at'),pool.query('SELECT * FROM products ORDER BY profile_id,created_at'),pool.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1000'),pool.query('SELECT * FROM app_state ORDER BY key'),pool.query('SELECT * FROM destination_map ORDER BY profile_id,target,account_key'),pool.query('SELECT * FROM category_learning ORDER BY hits DESC'),pool.query('SELECT * FROM autoreply_log ORDER BY created_at DESC LIMIT 5000')
  ]);
  return {app:'scraper4-backup',version:1,createdAt:new Date().toISOString(),profiles:profiles.rows,products:products.rows,jobs:jobs.rows,states:states.rows,destinationMap:maps.rows,categoryLearning:learning.rows,autoreplyLog:autoreply.rows};
}

export async function restoreBackup(bundle: any): Promise<{ profiles: number; products: number; states: number }> {
  const ACCEPTED_BACKUP_IDS = ['scraper4-backup', 'scraper4-render'];
  if (!bundle || !ACCEPTED_BACKUP_IDS.includes(bundle.app) || bundle.version !== 1) throw new Error('فایل بکاپ معتبر Scraper 4 نیست.');
  const client = await pool.connect(); let pCount=0, productCount=0, stateCount=0;
  try {
    await client.query('BEGIN');
    for (const row of bundle.profiles || []) { await client.query(`INSERT INTO profiles(id,data,enabled,interval_minutes,last_run_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,COALESCE($6,now()),now()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,enabled=EXCLUDED.enabled,interval_minutes=EXCLUDED.interval_minutes,last_run_at=EXCLUDED.last_run_at,updated_at=now()`, [row.id,row.data,row.enabled,row.interval_minutes,row.last_run_at,row.created_at]); pCount++; }
    for (const row of bundle.products || []) { await client.query(`INSERT INTO products(profile_id,source_key,data,title,price,source_url,remote_woo_id,remote_basalam_id,created_at,updated_at,active,missing_since) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()),now(),COALESCE($10,true),$11) ON CONFLICT(profile_id,source_key) DO UPDATE SET data=EXCLUDED.data,title=EXCLUDED.title,price=EXCLUDED.price,source_url=EXCLUDED.source_url,remote_woo_id=EXCLUDED.remote_woo_id,remote_basalam_id=EXCLUDED.remote_basalam_id,active=EXCLUDED.active,missing_since=EXCLUDED.missing_since,updated_at=now()`, [row.profile_id,row.source_key,row.data,row.title,row.price,row.source_url,row.remote_woo_id,row.remote_basalam_id,row.created_at,row.active,row.missing_since]); productCount++; }
    for (const row of bundle.destinationMap || []) { await client.query(`INSERT INTO destination_map(profile_id,source_key,target,account_key,remote_id,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(profile_id,source_key,target,account_key) DO UPDATE SET remote_id=EXCLUDED.remote_id,updated_at=now()`,[row.profile_id,row.source_key,row.target,row.account_key,row.remote_id]); }
    for(const row of bundle.categoryLearning||[]){await client.query(`INSERT INTO category_learning(phrase,category_id,category_name,hits,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(phrase,category_id) DO UPDATE SET category_name=EXCLUDED.category_name,hits=EXCLUDED.hits,updated_at=now()`,[row.phrase,row.category_id,row.category_name,row.hits])}
    for(const row of bundle.autoreplyLog||[]){await client.query(`INSERT INTO autoreply_log(chat_id,customer,input_text,output_text,source,created_at) VALUES($1,$2,$3,$4,$5,COALESCE($6,now()))`,[row.chat_id,row.customer,row.input_text,row.output_text,row.source,row.created_at])}
    for (const row of bundle.states || []) { await client.query(`INSERT INTO app_state(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [row.key,row.value]); stateCount++; }
    await client.query('COMMIT'); return { profiles:pCount,products:productCount,states:stateCount };
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function profileStats(): Promise<any[]> {
  if(useSqlite){const {rows}=await query(`SELECT p.id,p.data,count(pr.source_key) products,count(pr.remote_woo_id) woo_mapped,count(pr.remote_basalam_id) basalam_mapped,max(pr.updated_at) last_product_at FROM profiles p LEFT JOIN products pr ON pr.profile_id=p.id GROUP BY p.id,p.data ORDER BY p.id`);return rows.map(r=>({...r,name:parseJson<Partial<Profile>>(r.data,{}).name||r.id}))}
  const { rows } = await pool.query(`SELECT p.id,p.data->>'name' name,count(pr.*)::int products,count(pr.remote_woo_id)::int woo_mapped,count(pr.remote_basalam_id)::int basalam_mapped,max(pr.updated_at) last_product_at FROM profiles p LEFT JOIN products pr ON pr.profile_id=p.id GROUP BY p.id,p.data ORDER BY name`);
  return rows;
}

export async function reapStalledJobs(minutes = 30): Promise<number> {
  if(useSqlite){const cutoff=sqliteCutoff(Math.max(5,minutes));const result=await query(`UPDATE jobs SET status='failed',phase='watchdog',error='Job was inactive and closed by watchdog',finished_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND updated_at < ?`,[cutoff]);return result.rowCount||0}
  const result = await pool.query(`UPDATE jobs SET status='failed',phase='watchdog',error='Job was inactive and closed by watchdog',finished_at=now(),updated_at=now() WHERE status='running' AND updated_at < now()-make_interval(mins=>$1)`, [Math.max(5,minutes)]);
  return result.rowCount || 0;
}
export async function recoverFailedAndStalledJobs(minutes = 30): Promise<number> {
  if(useSqlite){const cutoff=sqliteCutoff(Math.max(1,minutes));const result=await query(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=0,error=NULL,finished_at=NULL,updated_at=datetime('now') WHERE status='failed' OR (status='running' AND updated_at < ?)`,[cutoff]);return result.rowCount||0}
  const result = await pool.query(`UPDATE jobs SET status='queued',phase='waiting',stop_requested=false,error=NULL,finished_at=NULL,updated_at=now() WHERE status='failed' OR (status='running' AND updated_at < now()-make_interval(mins=>$1))`, [Math.max(1, minutes)]);
  return result.rowCount || 0;
}

export async function enqueueDueProfiles(): Promise<number> {
  if(useSqlite){const {rows}=await query(`SELECT id,data FROM profiles p WHERE enabled=1 AND interval_minutes>0 AND (last_run_at IS NULL OR last_run_at < datetime('now','-'||interval_minutes||' minutes')) AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.profile_id=p.id AND j.status IN ('queued','running'))`);for(const row of rows){const p=parseJson<Profile>(row.data,row.data);await createJob(row.id,'scrape',p.syncWoo&&p.syncBasalam?'both':p.syncWoo?'woo':p.syncBasalam?'basalam':'none');await markProfileRun(row.id)}return rows.length}
  const { rows } = await pool.query(`SELECT id,data FROM profiles p WHERE enabled=true AND interval_minutes>0
    AND (last_run_at IS NULL OR last_run_at < now() - make_interval(mins => interval_minutes))
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.profile_id=p.id AND j.status IN ('queued','running'))`);
  for (const row of rows) {
    const p = row.data as Profile; await createJob(row.id, 'scrape', p.syncWoo && p.syncBasalam ? 'both' : p.syncWoo ? 'woo' : p.syncBasalam ? 'basalam' : 'none');
    await markProfileRun(row.id);
  }
  return rows.length;
}

function jobFromRow(row: any): Job {
  return { id: row.id, profileId: row.profile_id, kind: row.kind, target: row.target, status: row.status, phase: row.phase,
    total: Number(row.total || 0), processed: Number(row.processed || 0), added: Number(row.added || 0), updated: Number(row.updated || 0), failed: Number(row.failed || 0),
    stopRequested: Boolean(row.stop_requested), error: row.error, log: parseJson(row.log, row.log || []), createdAt: dateValue(row.created_at),
    startedAt: isoDateTime(row.started_at), finishedAt: isoDateTime(row.finished_at), updatedAt: dateValue(row.updated_at) };
}

// Queue/run ordering, ported from the Worker so the dashboard's drag-to-reorder
// and priority controls stop returning 404 on the Node runtime.
const JOB_PRIORITY_KEY = 'job_priorities_v1';
const RUN_PRIORITY_KEY = 'run_priorities_v1';

export async function getJobPriorities(): Promise<Record<string, number>> { return getState<Record<string, number>>(JOB_PRIORITY_KEY, {}); }
export async function setJobPriorities(ids: string[]): Promise<Record<string, number>> {
  const valid = [...new Set(ids.map(String).filter(Boolean))], map: Record<string, number> = {};
  valid.forEach((id, index) => { map[id] = valid.length - index; });
  await setState(JOB_PRIORITY_KEY, map);
  return map;
}
export async function getRunPriorities(): Promise<Record<string, number>> { return getState<Record<string, number>>(RUN_PRIORITY_KEY, {}); }
export async function setRunPriorities(kinds: string[]): Promise<Record<string, number>> {
  const valid = [...new Set(kinds.map(String).filter(Boolean))], map: Record<string, number> = {};
  valid.forEach((kind, index) => { map[kind] = valid.length - index; });
  await setState(RUN_PRIORITY_KEY, map);
  return map;
}

/** Import history, capped like the Worker so the log cannot grow without bound. */
export async function getImportHistory(): Promise<any[]> {
  const items = await getState<any[]>('import_history', []);
  return Array.isArray(items) ? items.slice(-60) : [];
}
export async function clearImportHistory(): Promise<void> { await setState('import_history', []); }
