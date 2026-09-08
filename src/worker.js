/* ═══════════════════════════════════════════════════════════════════
   حسابدار فروش — بک‌اند Cloudflare Worker
   • سرو فرانت‌اند (تک‌فایل، فارسی/راست‌چین، تقویم شمسی)
   • API سفارش‌ها / غرفه‌ها / تامین‌کنندگان / تنظیمات / اتصال‌ها
   • اتصال خودکار: باسلام (SalamAPI) + ووکامرس (WooCommerce REST API)
   • دیتابیس: D1 (اگر bind شده باشد) وگرنه حافظه موقت
   ═══════════════════════════════════════════════════════════════════ */

const FRONTEND_HTML = "__FRONTEND_HTML__";

/* ─── اسکیما (اجرای خودکار در اولین درخواست) ─── */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS booths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, phone TEXT DEFAULT '', description TEXT DEFAULT '', created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT, source TEXT NOT NULL DEFAULT 'basalam', booth_id INTEGER,
    customer_name TEXT DEFAULT '', customer_phone TEXT DEFAULT '', city TEXT DEFAULT '',
    product_name TEXT DEFAULT '', quantity INTEGER DEFAULT 1,
    supplier_id INTEGER, supplier_name TEXT DEFAULT '',
    unit_sale REAL DEFAULT 0, unit_cost REAL DEFAULT 0, discount REAL DEFAULT 0,
    shipping_cost REAL DEFAULT 0, packaging_cost REAL DEFAULT 0, commission REAL DEFAULT 0,
    ads_cost REAL DEFAULT 0, other_cost REAL DEFAULT 0, other_label TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'pending',
    order_date TEXT, jdate TEXT, jy INTEGER, jm INTEGER, jd INTEGER,
    notes TEXT DEFAULT '', created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(order_code)`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, name TEXT DEFAULT '',
    token TEXT DEFAULT '', vendor_id INTEGER, vendor_title TEXT DEFAULT '', booth_id INTEGER,
    store_url TEXT DEFAULT '', consumer_key TEXT DEFAULT '', consumer_secret TEXT DEFAULT '',
    auto_sync INTEGER DEFAULT 0, last_sync_at TEXT, last_status TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

const ORDER_FIELDS = [
  'order_code', 'source', 'booth_id', 'customer_name', 'customer_phone', 'city',
  'product_name', 'quantity', 'supplier_id', 'supplier_name',
  'unit_sale', 'unit_cost', 'discount', 'shipping_cost', 'packaging_cost',
  'commission', 'ads_cost', 'other_cost', 'other_label',
  'status', 'payment_status', 'order_date', 'jdate', 'jy', 'jm', 'jd', 'notes',
];
const INTEG_FIELDS = [
  'type', 'name', 'token', 'vendor_id', 'vendor_title', 'booth_id',
  'store_url', 'consumer_key', 'consumer_secret', 'auto_sync',
];
const INTEG_ALL = [...INTEG_FIELDS, 'last_sync_at', 'last_status'];
const NUM_FIELDS = new Set([
  'quantity', 'unit_sale', 'unit_cost', 'discount', 'shipping_cost',
  'packaging_cost', 'commission', 'ads_cost', 'other_cost', 'jy', 'jm', 'jd', 'booth_id', 'supplier_id',
  'vendor_id', 'auto_sync',
]);

/* ─── ابزارها ─── */
const nowISO = () => new Date().toISOString();
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
function pick(body, fields) {
  const o = {};
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null) continue;
    o[f] = NUM_FIELDS.has(f) ? (body[f] === '' ? null : num(body[f], f === 'quantity' ? 1 : 0)) : String(body[f]).slice(0, 2000);
  }
  return o;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

/* ─── استور D1 ─── */
function d1Store(db) {
  async function migrate() {
    if (globalThis.__MIGRATED__) return;
    for (const sql of SCHEMA) await db.prepare(sql).run();
    globalThis.__MIGRATED__ = true;
  }
  const all = async (sql, params = []) =>
    (await db.prepare(sql).bind(...params).all()).results || [];
  const get = async (sql, params = []) =>
    await db.prepare(sql).bind(...params).first();
  const run = async (sql, params = []) =>
    await db.prepare(sql).bind(...params).run();

  return {
    mode: 'd1',
    migrate,
    list: (t) => all(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 5000`),
    findBy: (t, f, v) => get(`SELECT * FROM ${t} WHERE ${f} = ? LIMIT 1`, [v]),
    insert: async (t, obj) => {
      const keys = Object.keys(obj);
      const placeholders = keys.map(() => '?').join(',');
      const r = await run(
        `INSERT INTO ${t} (${keys.join(',')}, created_at) VALUES (${placeholders}, ?)`,
        [...keys.map((k) => obj[k]), nowISO()]
      );
      return get(`SELECT * FROM ${t} WHERE id = ?`, [r.meta.last_row_id]);
    },
    update: async (t, id, obj) => {
      const keys = Object.keys(obj);
      if (!keys.length) return get(`SELECT * FROM ${t} WHERE id = ?`, [id]);
      await run(`UPDATE ${t} SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`,
        [...keys.map((k) => obj[k]), id]);
      return get(`SELECT * FROM ${t} WHERE id = ?`, [id]);
    },
    remove: async (t, id) => {
      await run(`DELETE FROM ${t} WHERE id = ?`, [id]);
      return { ok: true };
    },
    clear: async (t) => {
      await run(`DELETE FROM ${t}`);
      return { ok: true };
    },
    getSetting: async (k) => {
      const r = await get(`SELECT value FROM settings WHERE key = ?`, [k]);
      return r ? r.value : null;
    },
    setSetting: async (k, v) => {
      await run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]);
      return { ok: true };
    },
    allSettings: async () => {
      const rows = await all(`SELECT * FROM settings`);
      const o = {};
      for (const r of rows) o[r.key] = r.value;
      return o;
    },
  };
}

/* ─── استور حافظه (fallback بدون D1) ─── */
function memStore() {
  if (!globalThis.__MEM__) {
    globalThis.__MEM__ = { booths: [], suppliers: [], orders: [], integrations: [], settings: {}, seq: 1 };
  }
  const M = globalThis.__MEM__;
  if (!M.integrations) M.integrations = [];
  const nextId = () => M.seq++;
  return {
    mode: 'memory',
    migrate: async () => {},
    list: async (t) => [...(M[t] || [])].reverse().slice(0, 5000),
    findBy: async (t, f, v) => (M[t] || []).find((r) => String(r[f]) === String(v)) || null,
    insert: async (t, obj) => {
      const row = { id: nextId(), created_at: nowISO(), ...obj };
      M[t].push(row);
      return row;
    },
    update: async (t, id, obj) => {
      const row = M[t].find((r) => String(r.id) === String(id));
      if (!row) return null;
      Object.assign(row, obj);
      return row;
    },
    remove: async (t, id) => {
      M[t] = M[t].filter((r) => String(r.id) !== String(id));
      return { ok: true };
    },
    clear: async (t) => {
      M[t] = [];
      return { ok: true };
    },
    getSetting: async (k) => (M.settings[k] ?? null),
    setSetting: async (k, v) => {
      M.settings[k] = v;
      return { ok: true };
    },
    allSettings: async () => ({ ...M.settings }),
  };
}

/* ═══════════════════════════════════════════════════════════════════
   یکپارچه‌سازی‌ها: باسلام (SalamAPI) + ووکامرس
   مستندات: https://developers.basalam.com/docs/quick-start
   ═══════════════════════════════════════════════════════════════════ */
const BASALAM_BASE = 'https://openapi.basalam.com';

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status ?? 502;
  }
}

async function fetchJSON(url, options = {}, label = 'upstream') {
  let r;
  try {
    r = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new UpstreamError(`${label}: connection failed (${e && e.name === 'TimeoutError' ? 'timeout' : 'network/DNS error'})`, 0);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || (data.code && `${data.code}`))) || text.slice(0, 300) || `HTTP ${r.status}`;
    throw new UpstreamError(`${label}: ${msg}`, r.status);
  }
  return { data, headers: r.headers };
}

/* ─── باسلام ─── */
async function basalamGet(token, path, params = {}) {
  const u = new URL(BASALAM_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.append(k, v);
  }
  const { data } = await fetchJSON(u.toString(), {
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': 'hesabdar-foroosh/1.0' },
  }, 'Basalam');
  return data;
}

/* نگاشت وضعیت مرسوله باسلام به وضعیت داخلی (کدهای مستندات SDK) */
const BASALAM_STATUS = {
  3739: 'pending',    // NEW_ORDER
  3237: 'confirmed',  // PREPARATION_IN_PROGRESS
  5075: 'confirmed',  // OVERDUE_AGREEMENT_REQUEST_FROM_VENDOR
  4633: 'pending',    // CUSTOMER_CANCEL_REQUEST_FROM_CUSTOMER
  3238: 'shipped',    // POSTED
  5017: 'shipped',    // WRONG_TRACKING_CODE
  3740: 'shipped',    // PROBLEM_IS_REPORTED
  3195: 'delivered',  // SATISFIED
  3067: 'cancelled',  // CANCEL
  3572: 'returned',   // PRODUCT_IS_NOT_DELIVERED
  3233: 'returned',   // DEFINITIVE_DISSATISFACTION
};

/* ─── ووکامرس ─── */
function normStoreUrl(s) {
  let u = String(s || '').trim().replace(/\/+$/, '');
  const wj = u.indexOf('/wp-json');
  if (wj > -1) u = u.slice(0, wj);
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
async function wooGet(storeUrl, key, secret, path, params = {}) {
  let u;
  try {
    u = new URL(normStoreUrl(storeUrl) + '/wp-json/wc/v3' + path);
  } catch {
    throw new UpstreamError('WooCommerce: invalid store URL', 0);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.append(k, v);
  }
  let creds;
  try {
    creds = btoa(`${key}:${secret}`);
  } catch {
    throw new UpstreamError('WooCommerce: invalid credentials encoding', 0);
  }
  return fetchJSON(u.toString(), {
    headers: { Accept: 'application/json', Authorization: 'Basic ' + creds, 'User-Agent': 'hesabdar-foroosh/1.0' },
  }, 'WooCommerce');
}

const WOO_STATUS = {
  pending: 'pending', 'on-hold': 'pending', 'checkout-draft': 'pending',
  processing: 'confirmed', completed: 'delivered',
  cancelled: 'cancelled', failed: 'cancelled', refunded: 'returned',
};

/* ─── نگاشت به سفارش داخلی ─── */
function cleanDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
}
const int0 = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

function mapParcelToOrder(p, integ) {
  const items = Array.isArray(p.items) ? p.items : [];
  const qty = items.reduce((a, i) => a + (int0(i.quantity) || 1), 0) || 1;
  const total = int0(p.total_items_price) || items.reduce((a, i) => a + int0(i.price) * (int0(i.quantity) || 1), 0);
  const order = p.order || {};
  const cust = order.customer || {};
  const rec = cust.recipient || {};
  const user = cust.user || {};
  const city = cust.city || {};
  const status = BASALAM_STATUS[p.status && p.status.id] || 'pending';
  const receipt = p.post_receipt || {};
  const names = items.map((i) => `${i.title || 'کالا'} ×${int0(i.quantity) || 1}`).join('، ');
  return {
    order_code: `BL-${p.id}`,
    source: 'basalam',
    booth_id: integ.booth_id || null,
    customer_name: rec.name || user.name || '',
    customer_phone: rec.mobile || '',
    city: city.title || '',
    product_name: names || `مرسوله باسلام #${p.id}`,
    quantity: qty,
    unit_sale: Math.round(total / qty), unit_cost: 0, discount: 0,
    shipping_cost: int0(receipt.final_post_cost),
    packaging_cost: 0, commission: 0, ads_cost: 0, other_cost: 0, other_label: '',
    status,
    payment_status: status === 'cancelled' ? 'refunded' : 'paid',
    order_date: cleanDate(order.paid_at || p.created_at),
    jdate: '',
    notes: `باسلام — سفارش #${order.id || ''}، مرسوله #${p.id}` + (p.status && p.status.title ? ` (${p.status.title})` : ''),
  };
}

function mapWooToOrder(o) {
  const items = Array.isArray(o.line_items) ? o.line_items : [];
  const qty = items.reduce((a, i) => a + (int0(i.quantity) || 1), 0) || 1;
  const lineTotal = items.reduce((a, i) => a + (Number(i.total) || 0), 0);
  const billing = o.billing || {};
  const status = WOO_STATUS[o.status] || 'pending';
  const names = items.map((i) => `${i.name || 'کالا'} ×${int0(i.quantity) || 1}`).join('، ');
  return {
    order_code: `WC-${o.id}`,
    source: 'website',
    booth_id: null,
    customer_name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim(),
    customer_phone: billing.phone || '',
    city: billing.city || '',
    product_name: names || `سفارش سایت #${o.number || o.id}`,
    quantity: qty,
    unit_sale: Math.round(lineTotal / qty),
    unit_cost: 0,
    discount: int0(o.discount_total),
    shipping_cost: int0(o.shipping_total),
    packaging_cost: 0, commission: 0, ads_cost: 0, other_cost: 0, other_label: '',
    status,
    payment_status: (o.status === 'refunded' || o.status === 'cancelled') ? 'refunded' : (o.date_paid ? 'paid' : 'pending'),
    order_date: cleanDate(o.date_created),
    jdate: '',
    notes: `ووکامرس — سفارش #${o.number || o.id}` + (o.payment_method_title ? ` — ${o.payment_method_title}` : ''),
  };
}

/* درج/به‌روزرسانی هوشمند: هزینه‌ها و تامین‌کننده دستی کاربر حفظ می‌شود */
const SYNC_UPDATE_FIELDS = [
  'customer_name', 'customer_phone', 'city', 'product_name', 'quantity',
  'unit_sale', 'discount', 'status', 'payment_status', 'order_date', 'source', 'booth_id',
];
async function upsertExternalOrder(store, order) {
  const ex = await store.findBy('orders', 'order_code', order.order_code);
  if (!ex) {
    await store.insert('orders', pick(order, ORDER_FIELDS));
    return true; // جدید
  }
  const patch = {};
  for (const f of SYNC_UPDATE_FIELDS) patch[f] = order[f];
  if (!ex.notes) patch.notes = order.notes;
  await store.update('orders', ex.id, pick(patch, ORDER_FIELDS));
  return false; // به‌روزشده
}

/* ─── تست اتصال (بدون ذخیره‌سازی) ─── */
async function testIntegration(body) {
  const type = body.type;
  if (type === 'basalam') {
    const token = String(body.token || '').trim();
    if (!token) return { ok: false, error: 'Token is required', status: 0 };
    try {
      const me = await basalamGet(token, '/v1/users/me');
      return {
        ok: true,
        info: {
          user_name: me.name || me.username || '',
          user_id: me.id ?? null,
          vendor_id: (me.vendor && me.vendor.id) ?? null,
          vendor_title: (me.vendor && me.vendor.title) || '',
        },
      };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  }
  if (type === 'woo') {
    const storeUrl = String(body.store_url || '').trim();
    const key = String(body.consumer_key || '').trim();
    const secret = String(body.consumer_secret || '').trim();
    if (!storeUrl || !key || !secret) return { ok: false, error: 'Store URL, key and secret are required', status: 0 };
    try {
      const { data, headers } = await wooGet(storeUrl, key, secret, '/orders', { per_page: 1 });
      const total = headers.get('x-wp-total');
      let store_title = '', currency = '';
      try {
        const s = await wooGet(storeUrl, key, secret, '/system_status');
        store_title = (s.data && s.data.settings && s.data.settings.title) || '';
        currency = (s.data && s.data.settings && s.data.settings.currency) || '';
      } catch { /* اختیاری */ }
      return { ok: true, info: { orders_total: total ? num(total, 0) : (Array.isArray(data) ? data.length : 0), store_title, currency } };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  }
  return { ok: false, error: 'Unknown integration type', status: 0 };
}

/* ─── سینک سفارش‌ها ─── */
async function syncBasalam(store, integ, opts = {}) {
  const days = Math.min(Math.max(num(opts.days, 30) || 30, 1), 365);
  const cutoff = Date.now() - days * 864e5;
  let cursor = null, imported = 0, updated = 0, skipped = 0, pages = 0;
  const errors = [];
  for (let page = 0; page < 6; page++) {
    const params = { per_page: 50, sort: 'created_at:desc' };
    if (cursor) params.cursor = cursor;
    if (integ.vendor_id) params['items.vendor_ids'] = String(integ.vendor_id);
    let res;
    try {
      res = await basalamGet(integ.token, '/v1/vendor-parcels', params);
    } catch (e) {
      errors.push(e.message);
      break;
    }
    const items = Array.isArray(res) ? res : (res.data || res.parcels || res.items || res.results || []);
    if (!items.length) break;
    let hitOld = false;
    for (const p of items) {
      const ts = Date.parse((p.order && p.order.created_at) || p.created_at || '');
      if (Number.isFinite(ts) && ts < cutoff) { hitOld = true; continue; }
      try {
        if (await upsertExternalOrder(store, mapParcelToOrder(p, integ))) imported++;
        else updated++;
      } catch (e) {
        skipped++;
        if (errors.length < 5) errors.push(`parcel ${p.id}: ${e.message}`);
      }
    }
    pages++;
    cursor = res.next_cursor || res.nextCursor || null;
    if (!cursor || hitOld) break;
  }
  return { imported, updated, skipped, pages, errors };
}

async function syncWoo(store, integ, opts = {}) {
  const days = Math.min(Math.max(num(opts.days, 30) || 30, 1), 365);
  const after = new Date(Date.now() - days * 864e5).toISOString();
  let imported = 0, updated = 0, skipped = 0, page = 1;
  const errors = [];
  for (page = 1; page <= 6; page++) {
    let items;
    try {
      const res = await wooGet(integ.store_url, integ.consumer_key, integ.consumer_secret, '/orders',
        { per_page: 100, page, orderby: 'date', order: 'desc', after });
      items = Array.isArray(res.data) ? res.data : (res.data && res.data.orders) || [];
    } catch (e) {
      errors.push(e.message);
      break;
    }
    if (!items.length) break;
    for (const o of items) {
      try {
        if (await upsertExternalOrder(store, mapWooToOrder(o))) imported++;
        else updated++;
      } catch (e) {
        skipped++;
        if (errors.length < 5) errors.push(`order ${o.id}: ${e.message}`);
      }
    }
    if (items.length < 100) break;
  }
  return { imported, updated, skipped, pages: page - 1, errors };
}

/* حذف رمزها از خروجی لیست */
function sanitizeInteg(r) {
  const { token, consumer_key, consumer_secret, ...rest } = r;
  return {
    ...rest,
    has_token: !!token,
    token_hint: token ? '••••' + String(token).slice(-4) : '',
    consumer_key_hint: consumer_key ? String(consumer_key).slice(0, 9) + '…' : '',
    has_secret: !!consumer_secret,
  };
}

async function handleIntegrations(req, store, parts) {
  const method = req.method;
  const id = parts[1];
  const body = async () => {
    try { return await req.json(); } catch { return {}; }
  };

  /* تست اتصال */
  if (id === 'test' && method === 'POST') {
    return json(await testIntegration(await body()));
  }

  /* سینک یک اتصال */
  if (id && parts[2] === 'sync' && method === 'POST') {
    const rows = await store.list('integrations');
    const integ = rows.find((x) => String(x.id) === String(id));
    if (!integ) return json({ ok: false, error: 'not found' }, 404);
    const b = await body();
    try {
      const res = integ.type === 'basalam'
        ? await syncBasalam(store, integ, b)
        : await syncWoo(store, integ, b);
      await store.update('integrations', integ.id, { last_sync_at: nowISO(), last_status: `ok: +${res.imported} ~${res.updated}` });
      return json({ ok: true, ...res });
    } catch (e) {
      try { await store.update('integrations', integ.id, { last_status: 'error' }); } catch {}
      return json({ ok: false, error: e.message });
    }
  }

  /* لیست (بدون رمزها) */
  if (method === 'GET' && !id) {
    const rows = await store.list('integrations');
    return json({ ok: true, integrations: rows.map(sanitizeInteg) });
  }

  /* ساخت */
  if (method === 'POST' && !id) {
    const b = await body();
    if (b.type !== 'basalam' && b.type !== 'woo') return json({ ok: false, error: 'type must be basalam or woo' }, 400);
    if (b.type === 'basalam' && !String(b.token || '').trim()) return json({ ok: false, error: 'token is required' }, 400);
    if (b.type === 'woo' && (!String(b.store_url || '').trim() || !String(b.consumer_key || '').trim() || !String(b.consumer_secret || '').trim())) {
      return json({ ok: false, error: 'store_url, consumer_key and consumer_secret are required' }, 400);
    }
    if (b.type === 'woo') b.store_url = normStoreUrl(b.store_url);
    if (!b.name) b.name = b.type === 'basalam' ? (b.vendor_title || 'غرفه باسلام') : (b.store_url || 'فروشگاه اینترنتی');
    const row = await store.insert('integrations', pick(b, INTEG_FIELDS));
    return json({ ok: true, integration: sanitizeInteg(row) });
  }

  /* ویرایش (فیلد خالی = حفظ مقدار قبلی، مخصوص رمزها) */
  if (method === 'PUT' && id) {
    const b = await body();
    const patch = {};
    for (const f of INTEG_FIELDS) {
      if (b[f] === undefined || b[f] === null || b[f] === '') continue;
      patch[f] = b[f];
    }
    if (patch.store_url) patch.store_url = normStoreUrl(patch.store_url);
    const row = await store.update('integrations', id, pick(patch, INTEG_FIELDS));
    if (!row) return json({ ok: false, error: 'not found' }, 404);
    return json({ ok: true, integration: sanitizeInteg(row) });
  }

  /* حذف */
  if (method === 'DELETE' && id) {
    await store.remove('integrations', id);
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, 405);
}

/* سینک خودکار دوره‌ای (Cron) — فقط حالت D1 */
async function runAutoSync(env) {
  if (!env.DB) return;
  const store = d1Store(env.DB);
  await store.migrate();
  const all = await store.list('integrations');
  for (const integ of all.filter((i) => num(i.auto_sync, 0) === 1)) {
    try {
      const res = integ.type === 'basalam'
        ? await syncBasalam(store, integ, { days: 2 })
        : await syncWoo(store, integ, { days: 2 });
      await store.update('integrations', integ.id, { last_sync_at: nowISO(), last_status: `auto: +${res.imported} ~${res.updated}` });
    } catch (e) {
      try { await store.update('integrations', integ.id, { last_status: 'auto error' }); } catch {}
    }
  }
}

/* ─── روتر ─── */
async function handleApi(req, store, url) {
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = parts[0];
  const id = parts[1];

  const body = async () => {
    try { return await req.json(); } catch { return {}; }
  };

  /* health */
  if (resource === 'health') {
    return json({ ok: true, mode: store.mode, time: nowISO(), app: 'hesabdar-foroosh' });
  }

  /* اتصال‌ها */
  if (resource === 'integrations') {
    return handleIntegrations(req, store, parts);
  }

  /* export / import */
  if (resource === 'export' && method === 'GET') {
    const [orders, booths, suppliers, integrations, settings] = await Promise.all([
      store.list('orders'), store.list('booths'), store.list('suppliers'),
      store.list('integrations'), store.allSettings(),
    ]);
    return json({ app: 'hesabdar-foroosh', exported_at: nowISO(), orders, booths, suppliers, integrations, settings });
  }
  if (resource === 'import' && method === 'POST') {
    const b = await body();
    for (const t of ['orders', 'booths', 'suppliers', 'integrations']) {
      if (Array.isArray(b[t])) {
        await store.clear(t);
        for (const row of b[t].slice(0, 5000)) {
          const c = { ...row };
          delete c.id;
          if (t === 'orders') await store.insert(t, pick(c, ORDER_FIELDS));
          else if (t === 'integrations') await store.insert(t, pick(c, INTEG_ALL));
          else await store.insert(t, c.name ? { name: String(c.name), description: c.description || '', phone: c.phone || '' } : c);
        }
      }
    }
    if (b.settings && typeof b.settings === 'object') {
      for (const [k, v] of Object.entries(b.settings)) await store.setSetting(k, String(v));
    }
    return json({ ok: true });
  }

  /* settings */
  if (resource === 'settings') {
    if (method === 'GET') return json({ ok: true, settings: await store.allSettings() });
    if (method === 'POST' || method === 'PUT') {
      const b = await body();
      for (const [k, v] of Object.entries(b).slice(0, 50)) {
        await store.setSetting(String(k).slice(0, 100), String(v).slice(0, 5000));
      }
      return json({ ok: true, settings: await store.allSettings() });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  /* منابع CRUD */
  const config = {
    booths: { fields: ['name', 'description'] },
    suppliers: { fields: ['name', 'phone', 'description'] },
    orders: { fields: ORDER_FIELDS },
  };
  if (!config[resource]) return json({ error: 'یافت نشد' }, 404);

  if (method === 'GET' && !id) {
    const rows = await store.list(resource);
    return json({ ok: true, [resource]: rows });
  }
  if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
    const b = await body();
    if (resource === 'orders') {
      const obj = pick(b, ORDER_FIELDS);
      if (!obj.order_date) {
        const d = new Date();
        obj.order_date = d.toISOString().slice(0, 10);
      }
      const row = method === 'POST'
        ? await store.insert('orders', obj)
        : await store.update('orders', id, obj);
      return json({ ok: true, order: row });
    }
    const name = String(b.name || '').trim();
    if (!name && method === 'POST') return json({ error: 'نام الزامی است' }, 400);
    const obj = pick({ ...b, name: name || b.name }, config[resource].fields);
    const row = method === 'POST'
      ? await store.insert(resource, obj)
      : await store.update(resource, id, obj);
    return json({ ok: true, [resource.slice(0, -1)]: row });
  }
  if (method === 'DELETE' && id) {
    await store.remove(resource, id);
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

export default {
  async fetch(req, env = {}) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    /* API */
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        const store = env.DB ? d1Store(env.DB) : memStore();
        await store.migrate();
        return await handleApi(req, store, url);
      } catch (err) {
        return json({ error: 'خطای سرور', detail: String(err && err.message || err) }, 500);
      }
    }

    /* فرانت‌اند */
    return new Response(FRONTEND_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
  },

  /* سینک خودکار با Cron (فقط اتصال‌های auto_sync=1) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoSync(env));
  },
};
