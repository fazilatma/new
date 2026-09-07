export { DASHBOARD, DASHBOARD_JS } from '../worker-src/dashboard.js';

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}

export function setupPage(error: string): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scraper4 database setup</title><style>body{margin:0;background:#07111f;color:#e5edf7;font-family:Tahoma,system-ui,sans-serif}.wrap{max-width:900px;margin:40px auto;padding:20px}.card{background:#0f172a;border:1px solid #334155;border-radius:18px;padding:20px}.err{color:#fca5a5;direction:ltr;text-align:left;white-space:pre-wrap;background:#020617;border-radius:12px;padding:12px}.cmd{direction:ltr;text-align:left;white-space:pre-wrap;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px}</style></head><body><main class="wrap"><section class="card"><h1>پایگاه داده هنوز متصل نیست</h1><p>رابط اصلی Termux/Render اکنون همان رابط Cloudflare Worker است. برای استفاده کامل باید PostgreSQL وصل باشد.</p><div class="err">${escapeHtml(error)}</div><h2>Termux</h2><div class="cmd">pkg install -y postgresql
mkdir -p "$PREFIX/var/lib/postgresql"
[ -f "$PREFIX/var/lib/postgresql/PG_VERSION" ] || initdb "$PREFIX/var/lib/postgresql"
pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$HOME/scraper4-postgres.log" start || true
createdb scraper4 || true
printf "DATABASE_URL=postgresql://$(whoami)@localhost:5432/scraper4\\nRUN_WORKER_IN_WEB=true\\n" &gt; .env.local</div><p>اگر خطای role &quot;postgres&quot; does not exist دارید، از postgres:postgres استفاده نکنید؛ در Termux مقدار درست معمولاً <b>$(whoami)</b> است.</p></section></main></body></html>`;
}
