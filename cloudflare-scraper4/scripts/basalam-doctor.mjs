#!/usr/bin/env node
/**
 * Basalam connection doctor
 * =========================
 *
 * Run this ON THE MACHINE THAT FAILS (Termux, VPS, Render...). It talks to
 * Basalam directly with plain Node `fetch` and prints exactly what comes back,
 * so we stop guessing about a 401 we cannot reproduce from a sandbox.
 *
 *   node scripts/basalam-doctor.mjs                 # reads the token from the app database
 *   node scripts/basalam-doctor.mjs <token>         # or pass it explicitly
 *   BASALAM_VENDOR_ID=735703 node scripts/basalam-doctor.mjs
 *
 * It sends NOTHING anywhere except openapi.basalam.com, and it never prints the
 * token: only its length, shape and a short fingerprint.
 *
 * What each probe distinguishes:
 *   A/B  minimal vs browser-shaped headers  -> is the WAF rejecting our shape?
 *   C    curl-style headers (what PHP sends)
 *   D    the create-product endpoint itself (405/422 = auth OK, 401 = auth bad)
 */

const API = (process.env.BASALAM_API || 'https://openapi.basalam.com/v1').replace(/\/$/, '');
const VENDOR = process.env.BASALAM_VENDOR_ID || '';

function fingerprint(token) {
  // Non-reversible: enough to compare two tokens without revealing either.
  let hash = 0;
  for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function describe(token) {
  const parts = token.split('.');
  const out = {
    length: token.length,
    fingerprint: fingerprint(token),
    looksLikeJwt: parts.length === 3,
    hasWhitespace: /\s/.test(token),
    nonAscii: [...token].filter(c => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e).length,
    startsWith: token.slice(0, 6),
    endsWith: token.slice(-4),
  };
  if (parts.length === 3) {
    try {
      const pad = (s) => s + '='.repeat((4 - s.length % 4) % 4);
      const payload = JSON.parse(Buffer.from(pad(parts[1].replace(/-/g, '+').replace(/_/g, '/')), 'base64').toString('utf8'));
      out.jwt = {
        sub: payload.sub ?? null,
        exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        expired: payload.exp ? payload.exp * 1000 < Date.now() : null,
        scopes: payload.scopes || (typeof payload.scope === 'string' ? payload.scope.split(' ') : null),
      };
    } catch { out.jwt = 'payload not decodable'; }
  }
  return out;
}

async function probe(label, url, headers, init = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    const text = await response.text();
    let body = text;
    try { body = JSON.stringify(JSON.parse(text)).slice(0, 220); } catch { body = text.slice(0, 220); }
    console.log(`\n[${label}]`);
    console.log(`  ${init.method || 'GET'} ${url}`);
    console.log(`  headers sent : ${Object.keys(headers).join(', ')}`);
    console.log(`  HTTP ${response.status} ${response.statusText}  (${Date.now() - started} ms)`);
    const location = response.headers.get('location');
    if (location) console.log(`  redirect to  : ${location}`);
    const server = response.headers.get('server');
    const cfRay = response.headers.get('cf-ray');
    if (server) console.log(`  server       : ${server}`);
    if (cfRay) console.log(`  cf-ray       : ${cfRay}   <-- behind Cloudflare`);
    console.log(`  body         : ${body}`);
    return response.status;
  } catch (error) {
    console.log(`\n[${label}]  NETWORK ERROR: ${error?.message || error}`);
    return 0;
  }
}

/**
 * Reads the saved token from a RUNNING instance instead of importing the server
 * entrypoint (which would boot a second copy of the app and bind a port).
 * Point SCRAPER_URL / ADMIN_TOKEN at your instance, or just pass the token in.
 */
async function readTokenFromRunningApp() {
  const base = (process.env.SCRAPER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const admin = process.env.ADMIN_TOKEN || '';
  try {
    const response = await fetch(`${base}/api/connections`, {
      headers: admin ? { authorization: `Bearer ${admin}` } : {},
    });
    if (!response.ok) return { token: '', vendorId: '', note: `${base} answered HTTP ${response.status}` };
    const data = await response.json();
    const basalam = (data.connections || data)?.basalam || {};
    return { token: basalam.token || '', vendorId: String(basalam.vendorId || ''), note: `read from ${base}` };
  } catch (error) {
    return { token: '', vendorId: '', note: `could not reach ${base}: ${error?.message || error}` };
  }
}

const argToken = process.argv[2] || process.env.BASALAM_TOKEN || '';
let token = argToken, vendorId = VENDOR;
if (!token) {
  const found = await readTokenFromRunningApp();
  token = found.token; vendorId = vendorId || found.vendorId;
  console.log('token source:', found.note);
}

if (!token) {
  console.error('No token found. Pass it directly:\n  node scripts/basalam-doctor.mjs <token>\nor point the doctor at your running app:\n  SCRAPER_URL=http://127.0.0.1:3000 ADMIN_TOKEN=xxx node scripts/basalam-doctor.mjs');
  process.exit(1);
}

console.log('Basalam doctor');
console.log('==============');
console.log('api base   :', API);
console.log('vendor id  :', vendorId || '(not set)');
console.log('token      :', JSON.stringify(describe(token), null, 2).replace(/\n/g, '\n             '));

// A: exactly what scraper4.php sends.
const a = await probe('A · minimal (PHP-style) headers', `${API}/users/me`, {
  Accept: 'application/json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// B: with the browser headers we used to send, to prove whether they matter.
const b = await probe('B · with a browser user-agent', `${API}/users/me`, {
  Accept: 'application/json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6',
});

// C: bare minimum, no Content-Type on a GET.
const c = await probe('C · Authorization only', `${API}/users/me`, {
  Authorization: `Bearer ${token}`,
});

// D: the endpoint that actually matters. 401 here but 200 above = scope problem.
if (vendorId) {
  await probe('D · vendor products (read)', `${API}/vendors/${encodeURIComponent(vendorId)}/products?per_page=1`, {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  });
}

console.log('\n--- what the result means -------------------------------------');
if (a === 200) {
  console.log('A returned 200: the token and the header shape are BOTH fine.');
  console.log('If the app still fails, the difference is in the app, not the token.');
} else if (a === 401 && b === 401 && c === 401) {
  console.log('Every shape returns 401, including plain curl-style headers.');
  console.log('The token itself is being refused by Basalam. Create a new personal');
  console.log('access token at developers.basalam.com/panel/tokens and make sure it');
  console.log('belongs to the same account as the vendor id above.');
} else if (a === 200 && b !== 200) {
  console.log('Minimal headers work, browser headers do not: a WAF is rejecting the');
  console.log('browser disguise. This is what v1.111.0 fixes.');
} else {
  console.log('Mixed result — send this whole output and it can be diagnosed exactly.');
}
console.log('---------------------------------------------------------------');
