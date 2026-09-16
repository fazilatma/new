import { config, runtimeEnvironment } from './config.js';
import { connectionStatus, loadConnections } from './connections.js';
import { databaseDriver, databaseLabel, pool } from './db.js';

type DiagnosticCheck = { name: string; ok: boolean; severity: 'error' | 'warning' | 'info'; detail: string; data?: unknown };

const msg = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Read-only installation diagnostics for the Node runtime (Termux, VPS, Render,
 * Windows, Codespaces). No secret or connection value is returned.
 *
 * The dashboard's "دیباگ جامع" button calls GET /api/debug, which only existed
 * on the Worker; on Node it returned 404. The Worker's own diagnostics are
 * D1/queue-binding specific and meaningless here, so this reports the things
 * that actually break on a phone or a VPS: the database that is really in use,
 * the required tables, orphan rows, stalled jobs and the browser engines that
 * are simply not installable on Android.
 */
export async function runDiagnostics() {
  const checks: DiagnosticCheck[] = [], start = Date.now();
  const add = (name: string, ok: boolean, detail: string, severity: DiagnosticCheck['severity'] = 'error', data?: unknown) =>
    checks.push({ name, ok, severity, detail, ...(data === undefined ? {} : { data })});

  const envId = (runtimeEnvironment as any)?.id || 'local', envLabel = (runtimeEnvironment as any)?.label || envId;
  add('runtime', typeof fetch === 'function', `Node ${process.version} on ${process.platform}/${process.arch}; environment=${envLabel} (${envId}).`, 'error', {
    node: process.version, platform: process.platform, arch: process.arch, environment: runtimeEnvironment
  });
  add('admin-token', true, config.adminToken
    ? 'ADMIN_TOKEN is set; the dashboard and API require it.'
    : 'ADMIN_TOKEN is empty, so the dashboard and API are open to anyone who can reach this port. That is normal on a phone, but do not expose the port publicly.',
    config.adminToken ? 'info' : 'warning');

  let databaseReady = false;
  try {
    await pool.query('SELECT 1');
    databaseReady = true;
    add('database', true, `${databaseLabel} (${databaseDriver}) responded to a test query.`, 'info', { driver: databaseDriver });
  } catch (error) {
    add('database', false, `${databaseLabel} (${databaseDriver}) is not reachable: ${msg(error)}`, 'error', { driver: databaseDriver });
  }

  if (databaseReady) {
    const required = ['profiles', 'products', 'jobs', 'app_state', 'destination_map', 'category_learning', 'autoreply_log'];
    try {
      const { rows } = databaseDriver === 'sqlite'
        ? await pool.query(`SELECT name FROM sqlite_master WHERE type='table'`)
        : await pool.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`);
      const present = new Set(rows.map((row: any) => String(row.name)));
      const missing = required.filter(table => !present.has(table));
      add('schema', missing.length === 0, missing.length
        ? `${required.length - missing.length}/${required.length} required tables found; missing: ${missing.join(', ')}.`
        : `${required.length}/${required.length} required tables found.`, 'error', { missing });
    } catch (error) { add('schema', false, msg(error)); }

    try {
      const { rows } = await pool.query(`SELECT
        (SELECT count(*) FROM profiles) AS profiles,
        (SELECT count(*) FROM products) AS products,
        (SELECT count(*) FROM jobs) AS jobs,
        (SELECT count(*) FROM jobs WHERE status IN ('queued','running')) AS active_jobs,
        (SELECT count(*) FROM jobs WHERE status='failed') AS failed_jobs,
        (SELECT count(*) FROM products p LEFT JOIN profiles r ON r.id=p.profile_id WHERE r.id IS NULL) AS orphan_products`);
      const counts = rows[0] || {};
      const orphans = Number(counts.orphan_products || 0);
      add('relations', orphans === 0, orphans ? `${orphans} orphan product row(s) found.` : 'No orphan product rows found.', orphans ? 'warning' : 'info', counts);
    } catch (error) { add('relations', false, msg(error)); }

    try {
      const { rows } = databaseDriver === 'sqlite'
        ? await pool.query(`SELECT count(*) AS n FROM jobs WHERE status='running' AND updated_at < datetime('now','-30 minutes')`)
        : await pool.query(`SELECT count(*) AS n FROM jobs WHERE status='running' AND updated_at < now() - interval '30 minutes'`);
      const stalled = Number(rows[0]?.n || 0);
      add('queue-stalled', stalled === 0, `${stalled} running job(s) have been inactive for more than 30 minutes.`, stalled ? 'warning' : 'info');
    } catch (error) { add('queue-stalled', false, msg(error)); }

    try {
      const status = connectionStatus(await loadConnections());
      add('connections', true, 'Connection vault decrypted successfully.', 'info', status);
    } catch (error) { add('connections', false, `Connection vault could not be read: ${msg(error)}`); }
  }

  add('worker-loop', config.runWorkerInWeb,
    config.runWorkerInWeb ? 'RUN_WORKER_IN_WEB is on, so this process also drains the job queue.' : 'RUN_WORKER_IN_WEB is off; queued jobs will not run unless a separate worker process is started.',
    config.runWorkerInWeb ? 'info' : 'warning');

  // Browser engines cannot be installed on Android/Termux. Say so plainly here
  // rather than letting a scrape fail later with a confusing launch error.
  const browserPath = process.env.BROWSER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  add('browser-engines', true, browserPath
    ? `A browser executable is configured: ${browserPath}`
    : runtimeEnvironment === 'termux'
      ? 'No browser executable configured. On Termux install it with: pkg install chromium, then set BROWSER_EXECUTABLE_PATH. Extraction still works without it: the auto chain uses jsonld/next_data/script_json/heuristic/metadata/htmlrewriter first.'
      : 'No browser executable configured; playwright/puppeteer engines will be skipped. The HTML engines still work.',
    browserPath ? 'info' : 'warning', { browserPath: browserPath || null });

  const failed = checks.filter(check => !check.ok);
  return {
    ok: failed.filter(check => check.severity === 'error').length === 0,
    runtime: 'node', environment: runtimeEnvironment, environmentId: envId, database: databaseDriver,
    generatedAt: new Date().toISOString(), durationMs: Date.now() - start, checks,
    summary: {
      passed: checks.filter(check => check.ok).length,
      failed: failed.length,
      warnings: failed.filter(check => check.severity === 'warning').length
    }
  };
}
