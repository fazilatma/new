/**
 * The browser-side API-base fallback must recover on every host shape.
 *
 * The server (Request::capture) understands three URL shapes; a host may
 * support any subset. This extracts the real bootstrap IIFE out of
 * public/index.html and drives it against fake hosts.
 *
 *   node tools/tests/ui-selfheal.mjs
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '../..');
const src = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const start = src.indexOf("(function () {\n  var KEY = 'arena_api_base';");
if (start === -1) throw new Error('API-base bootstrap block not found in index.html');
const boot = src.slice(start, src.indexOf('})();', start) + 5);

let failed = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };

function makeHost({ rewrite, pathinfo, dir = '' }) {
  const json = () => ({ ok: true, status: 200, headers: { get: () => 'application/json' } });
  const html404 = () => ({ ok: false, status: 404, headers: { get: () => 'text/html' },
                           text: async () => '<html><body>برگه پیدا نشد</body></html>' });
  return (url) => {
    const [p, q = ''] = url.split('?');
    if (new URLSearchParams(q).get('__path')) return p === dir + '/index.php' ? json() : html404();
    if (p.startsWith(dir + '/index.php/')) return pathinfo ? json() : html404();
    if (p.startsWith(dir + '/api/')) return rewrite ? json() : html404();
    return html404();
  };
}

async function run(cfg, label, expectMode, expectTries) {
  const host = makeHost(cfg);
  const calls = [];
  const store = {};
  const win = { __API_BASE__: cfg.dir || '', fetch: async (u) => { calls.push(u); return host(u); } };
  new Function('window', 'sessionStorage', boot)(
    win, { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } });

  const res = await win.fetch(win.apiUrl('/api/providers/import-text'));
  ok(res.ok, `${label}: request succeeded after ${calls.length} attempt(s)`);
  ok(win.__API_MODE__ === expectMode, `${label}: settled on mode='${win.__API_MODE__}'`);
  ok(calls.length === expectTries, `${label}: took ${calls.length} attempt(s), expected ${expectTries}`);
  ok(store['arena_api_mode'] === (expectTries > 1 ? expectMode : undefined) || expectTries === 1,
    `${label}: working shape persisted for later calls`);
  return calls;
}

console.log('--- host recovery ---');
await run({ rewrite: true,  pathinfo: true  }, 'rewrite on',            'path',  1);
await run({ rewrite: false, pathinfo: true  }, 'PATH_INFO only',        'path',  2);
await run({ rewrite: false, pathinfo: false }, 'neither (regression)',  'query', 3);
await run({ rewrite: false, pathinfo: false, dir: '/agent' }, 'neither + subdir', 'query', 3);

// --- URL construction in query mode -------------------------------------
console.log('\n--- query-mode URL construction ---');
{
  const store = {};
  const win = { __API_BASE__: '/agent/index.php', __API_MODE__: 'query', fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' } }) };
  new Function('window', 'sessionStorage', boot)(
    win, { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } });

  ok(win.apiUrl('/api/providers') === '/agent/index.php?__path=/api/providers',
    'plain path  -> ' + win.apiUrl('/api/providers'));
  ok(win.apiUrl('/api/observability/export?format=csv') === '/agent/index.php?__path=/api/observability/export&format=csv',
    "caller's own query survives -> " + win.apiUrl('/api/observability/export?format=csv'));
  ok(win.apiUrl('/api/auth/login').includes('/auth/login'),
    'slashes stay unescaped so path checks still match');
  ok(win.apiUrl('https://example.com/x') === 'https://example.com/x',
    'absolute URLs are passed through untouched');
}

console.log(failed ? `\n${failed} FAILED` : '\nall self-heal assertions passed');
process.exit(failed ? 1 : 0);
