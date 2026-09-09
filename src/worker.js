/* ═══════════════════════════════════════════════════════════════════
   حسابدار فروش — بک‌اند Cloudflare Worker
   • سرو فرانت‌اند (تک‌فایل، فارسی/راست‌چین، تقویم شمسی)
   • API سفارش‌ها / غرفه‌ها / تامین‌کنندگان / تنظیمات / اتصال‌ها / بکاپ ابری
   • اتصال خودکار: باسلام (SalamAPI) + ووکامرس (WooCommerce REST API)
   • بکاپ خودکار: گوگل درایو + وان‌درایو (مایکروسافت)
   • دیتابیس: فقط D1 (دائمی) — بدون D1 هیچ API داده‌ای کار نمی‌کند
   ═══════════════════════════════════════════════════════════════════ */

const FRONTEND_HTML = "__FRONTEND_HTML__";

/* ─── اسکیما (اجرای خودکار در اولین درخواست) ─── */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS booths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT DEFAULT '',
    ship_single REAL DEFAULT 0, ship_multi REAL DEFAULT 0, comm_pct REAL DEFAULT 0, created_at TEXT
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
    shipping_cost REAL DEFAULT 0, shipping_rev REAL DEFAULT 0, packaging_cost REAL DEFAULT 0, commission REAL DEFAULT 0,
    ads_cost REAL DEFAULT 0, other_cost REAL DEFAULT 0, other_label TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'pending', purchase_type TEXT DEFAULT 'cash',
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
    auto_sync INTEGER DEFAULT 0, sync_every_min INTEGER DEFAULT 60, last_sync_at TEXT, last_status TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

/* مهاجرت ستون‌های جدید روی دیتابیس‌های قدیمی (خطای ستون تکراری نادیده گرفته می‌شود) */
const MIGRATIONS = [
  ['integrations', 'sync_every_min', 'INTEGER DEFAULT 60'],
  ['booths', 'ship_single', 'REAL DEFAULT 0'],
  ['booths', 'ship_multi', 'REAL DEFAULT 0'],
  ['booths', 'comm_pct', 'REAL DEFAULT 0'],
  ['orders', 'shipping_rev', 'REAL DEFAULT 0'],
  ['orders', 'purchase_type', "TEXT DEFAULT 'cash'"],
];
const ORDER_FIELDS = [
  'order_code', 'source', 'booth_id', 'customer_name', 'customer_phone', 'city',
  'product_name', 'quantity', 'supplier_id', 'supplier_name',
  'unit_sale', 'unit_cost', 'discount', 'shipping_cost', 'shipping_rev', 'packaging_cost',
  'commission', 'ads_cost', 'other_cost', 'other_label',
  'status', 'payment_status', 'purchase_type', 'order_date', 'jdate', 'jy', 'jm', 'jd', 'notes',
];
const INTEG_FIELDS = [
  'type', 'name', 'token', 'vendor_id', 'vendor_title', 'booth_id',
  'store_url', 'consumer_key', 'consumer_secret', 'auto_sync', 'sync_every_min',
];
const INTEG_ALL = [...INTEG_FIELDS, 'last_sync_at', 'last_status'];
const NUM_FIELDS = new Set([
  'quantity', 'unit_sale', 'unit_cost', 'discount', 'shipping_cost',
  'packaging_cost', 'commission', 'ads_cost', 'other_cost', 'jy', 'jm', 'jd', 'booth_id', 'supplier_id',
  'vendor_id', 'auto_sync', 'sync_every_min', 'shipping_rev', 'ship_single', 'ship_multi', 'comm_pct',
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

/* ─── استور D1 (تنها حافظه: دائمی) ─── */
function d1Store(db) {
  async function migrate() {
    if (globalThis.__MIGRATED__) return;
    for (const sql of SCHEMA) await db.prepare(sql).run();
    for (const [t, col, ddl] of MIGRATIONS) {
      try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${col} ${ddl}`).run(); } catch {}
    }
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
    removeMany: async (t, ids) => {
      const r = await run(`DELETE FROM ${t} WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      return (r.meta && (r.meta.changes ?? r.meta.rows_written)) || ids.length;
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

/* خلاصه خطاهای اعتبارسنجی لاراول: {field: [msg]} */
function detailErrors(errors) {
  if (!errors || typeof errors !== 'object') return '';
  const flat = (x) => {
    if (Array.isArray(x)) return x.map(flat).filter(Boolean).join('، ');
    if (x && typeof x === 'object') {
      if (typeof x.message === 'string' && x.message) return (x.field ? `${x.field}: ` : '') + x.message;
      try { return JSON.stringify(x).slice(0, 200); } catch { return ''; }
    }
    return String(x ?? '');
  };
  const parts = [];
  for (const [f, v] of Object.entries(errors).slice(0, 5)) {
    const m = flat(v).slice(0, 200);
    if (m) parts.push(/^\d+$/.test(f) ? m : `${f}: ${m}`);
  }
  return parts.join('؛ ').slice(0, 600);
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
    let msg = (data && (data.message || data.error || (data.code && `${data.code}`))) || text.slice(0, 300) || `HTTP ${r.status}`;
    const det = detailErrors(data && data.errors);
    if (det) msg += ` — ${det}`;
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
  6440: 'cancelled',  // VENDOR_CANCEL_REQUEST — درخواست لغو غرفه‌دار (تایید نشدن توسط غرفه)
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

function mapParcelToOrder(p, integ, pct = 0, ship = null) {
  const items = Array.isArray(p.items) ? p.items : [];
  const qty = items.reduce((a, i) => a + (int0(i.quantity) || 1), 0) || 1;
  const totalRial = int0(p.total_items_price) || items.reduce((a, i) => a + int0(i.price) * (int0(i.quantity) || 1), 0);
  const total = Math.round(totalRial / 10); // باسلام ریال می‌دهد؛ کتاب به تومان
  const order = p.order || {};
  const cust = order.customer || {};
  const rec = cust.recipient || {};
  const user = cust.user || {};
  const city = cust.city || {};
  const status = BASALAM_STATUS[p.status && p.status.id] || 'pending';
  const commission = (status === 'cancelled' || !(pct > 0) || !(total > 0)) ? undefined : Math.round(total * pct / 100); // API کارمزد نمی‌دهد؛ از ٪ پیش‌فرض
  const receipt = p.post_receipt || {};
  const receiptRial = int0(receipt.final_post_cost);
  const shipEst = qty > 1 ? num(ship && ship.multi, 0) : num(ship && ship.single, 0); // تعرفه ثابت غرفه (تومان)
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
    shipping_cost: status === 'cancelled' ? 0 : (receiptRial > 0 ? Math.round(receiptRial / 10) : (shipEst > 0 ? shipEst : 0)),
    shipping_rev: (status === 'cancelled' || !(shipEst > 0)) ? undefined : shipEst, // دریافتی از مشتری طبق تعرفه غرفه
    _shipSrc: status === 'cancelled' ? undefined : (receiptRial > 0 ? 'receipt' : (shipEst > 0 ? 'default' : undefined)),
    packaging_cost: 0, commission, ads_cost: 0, other_cost: 0, other_label: '',
    status,
    payment_status: status === 'cancelled' ? 'refunded' : 'paid',
    order_date: cleanDate(order.paid_at || p.created_at),
    jdate: '',
    notes: `باسلام — سفارش #${order.id || ''}، مرسوله #${p.id}` + (p.status && p.status.title ? ` (${p.status.title})` : ''),
  };
}

function mapWooToOrder(o, pct = 0) {
  const items = Array.isArray(o.line_items) ? o.line_items : [];
  const qty = items.reduce((a, i) => a + (int0(i.quantity) || 1), 0) || 1;
  const lineTotal = items.reduce((a, i) => a + (Number(i.total) || 0), 0);
  const billing = o.billing || {};
  const status = WOO_STATUS[o.status] || 'pending';
  const commission = (status === 'cancelled' || !(pct > 0) || !(lineTotal > 0)) ? undefined : Math.round(lineTotal * pct / 100);
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
    shipping_cost: 0, // هزینه واقعی پست سایت نامشخص است؛ دستی وارد شود (مقدار قبلی حفظ می‌شود)
    shipping_rev: int0(o.shipping_total) || undefined, // دریافتی از مشتری
    packaging_cost: 0, commission, ads_cost: 0, other_cost: 0, other_label: '',
    status,
    payment_status: (o.status === 'refunded' || o.status === 'cancelled') ? 'refunded' : (o.date_paid ? 'paid' : 'pending'),
    order_date: cleanDate(o.date_created),
    jdate: '',
    notes: `ووکامرس — سفارش #${o.number || o.id}` + (o.payment_method_title ? ` — ${o.payment_method_title}` : ''),
  };
}

/* درج/به‌روزرسانی هوشمند: هزینه‌های دستی کاربر حفظ می‌شود؛ هزینه ارسال از مرجع سینک تازه می‌شود */
const SYNC_UPDATE_FIELDS = [
  'customer_name', 'customer_phone', 'city', 'product_name', 'quantity',
  'unit_sale', 'discount', 'shipping_cost', 'shipping_rev', 'commission', 'status', 'payment_status', 'order_date', 'source', 'booth_id',
];
async function upsertExternalOrder(store, order) {
  const ex = await store.findBy('orders', 'order_code', order.order_code);
  if (!ex) {
    await store.insert('orders', pick(order, ORDER_FIELDS));
    return true; // جدید
  }
  const patch = {};
  for (const f of SYNC_UPDATE_FIELDS) {
    if ((f === 'commission' || f === 'shipping_rev') && num(ex[f], 0) !== 0) continue; // مقدار قبلی/دستی حفظ شود؛ فقط خانه خالی پر شود
    if (f === 'shipping_cost' && (!num(order[f], 0) || (order._shipSrc === 'default' && num(ex.shipping_cost, 0) !== 0))) continue; // بدون داده یا تخمین غرفه روی مقدار موجود → حفظ
    patch[f] = order[f];
  }
  if (!ex.notes) patch.notes = order.notes;
  await store.update('orders', ex.id, pick(patch, ORDER_FIELDS));
  return false; // به‌روزشده
}

/* ─── تازه‌سازی وضعیت سفارش‌های باز در هر سینک ─── */
// پنجرهٔ سینک (دستی ۳۰ روز، خودکار ۲ روز) لغو/ردِ دیرهنگامِ سفارش‌های قدیمی را نمی‌بیند؛
// پس هر سفارش بازی که در پنجره دیده نشده، تکی از API خوانده و وضعیتش تازه می‌شود.
const OPEN_STATUS = ['pending', 'confirmed', 'shipped']; // + تحویل‌شده‌های ۶۰ روز اخیر (مرجوعی بعد از تحویل)
async function refreshOpenOrders(store, cfg) {
  const all = await store.list('orders');
  const from60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const rx = new RegExp('^' + cfg.prefix + '(\\d+)$');
  const cands = all.filter((o) => {
    if (o.source !== cfg.source || (cfg.seen && cfg.seen.has(o.order_code))) return false;
    if (cfg.boothId ? String(o.booth_id) !== String(cfg.boothId) : o.booth_id) return false; // توکن هر غرفه فقط مرسوله خودش
    if (!OPEN_STATUS.includes(o.status) && !(o.status === 'delivered' && (o.order_date || '') >= from60)) return false;
    return rx.test(o.order_code || '');
  }).sort((a, b) => (OPEN_STATUS.includes(a.status) ? 0 : 1) - (OPEN_STATUS.includes(b.status) ? 0 : 1)
    || String(a.order_date || '').localeCompare(String(b.order_date || ''))).slice(0, cfg.cap || 40);
  let checked = 0, updated = 0, authFail = false;
  for (const o of cands) {
    if (authFail) break;
    const id = (o.order_code || '').match(rx)[1];
    try {
      const isNew = await upsertExternalOrder(store, cfg.mapOne(await cfg.fetchOne(id)));
      checked++;
      if (!isNew) updated++;
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) { authFail = true; cfg.errors.push('تازه‌سازی وضعیت متوقف شد: ' + e.message); }
      else if (e && e.status === 404) { checked++; } // در منبع حذف شده؛ رکورد محلی دست‌نخورده می‌ماند
      else if (cfg.errors.length < 5) cfg.errors.push(`refresh ${o.order_code}: ${e.message}`);
    }
  }
  return { checked, updated };
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
  const wantAll = opts.days === 'all' || Number(opts.days) === 0;
  const pct0 = num(await store.getSetting('comm_basalam').catch(() => null), 0); // ٪ پیش‌فرض کارمزد باسلام
  const booth = integ.booth_id ? await store.findBy('booths', 'id', integ.booth_id).catch(() => null) : null;
  const pct = num(booth && booth.comm_pct, 0) > 0 ? num(booth.comm_pct) : pct0; // ٪ غرفه بر ٪ سراسری اولویت دارد
  const ship = { single: num(booth && booth.ship_single, 0), multi: num(booth && booth.ship_multi, 0) }; // تعرفه ثابت ارسال غرفه
  const days = wantAll ? 0 : Math.min(Math.max(num(opts.days, 30) || 30, 1), 365);
  const cutoff = wantAll ? 0 : Date.now() - days * 864e5;
  let cursor = null, imported = 0, updated = 0, skipped = 0, pages = 0, perPage = 50;
  const seen = new Set(); // کدهای دیده‌شده در پنجره (برای گذر تازه‌سازی وضعیت)
  const errors = [];
  for (let page = 0; page < 20; page++) {
    const params = { per_page: perPage, sort: 'estimate_send_at:desc' };
    if (cursor) params.cursor = cursor;
    // نکته: فیلتر items.vendor_ids عمداً ارسال نمی‌شود — باسلام به توکن غرفه برای آن 403 می‌دهد
    // و توکن غرفه به‌هرحال فقط مرسوله‌های خودش را می‌بیند.
    let res;
    try {
      res = await basalamGet(integ.token, '/v1/vendor-parcels', params);
    } catch (e) {
      if (page === 0 && !cursor && perPage !== 10 && e && e.status === 422) {
        perPage = 10; // ۵۰ پذیرفته نشد → تلاش مجدد با پیش‌فرض SDK
        try {
          res = await basalamGet(integ.token, '/v1/vendor-parcels', { ...params, per_page: 10 });
        } catch (e2) { errors.push(e2.message); break; }
      } else { errors.push(e.message); break; }
    }
    const items = Array.isArray(res) ? res : (res.data || res.parcels || res.items || res.results || []);
    if (!items.length) break;
    let hitOld = false;
    for (const p of items) {
      const ts = Date.parse((p.order && p.order.created_at) || p.created_at || '');
      if (Number.isFinite(ts) && ts < cutoff) { hitOld = true; continue; }
      try {
        const mapped = mapParcelToOrder(p, integ, pct, ship);
        seen.add(mapped.order_code);
        if (await upsertExternalOrder(store, mapped)) imported++;
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
  // گذر دوم: تازه‌سازی وضعیت سفارش‌های بازِ بیرون از پنجره (لغو/ردِ دیرهنگام)
  let refreshed = 0;
  try {
    const r = await refreshOpenOrders(store, {
      source: 'basalam', boothId: integ.booth_id || null, seen, errors, cap: 40, prefix: 'BL-',
      fetchOne: (id) => basalamGet(integ.token, '/v1/vendor-parcels/' + id),
      mapOne: (p) => mapParcelToOrder(p, integ, pct, ship),
    });
    refreshed = r.checked; updated += r.updated;
  } catch (e) { if (errors.length < 5) errors.push(e.message); }
  return { imported, updated, skipped, pages, refreshed, errors };
}

async function syncWoo(store, integ, opts = {}) {
  const wantAll = opts.days === 'all' || Number(opts.days) === 0;
  const pct = num(await store.getSetting('comm_website').catch(() => null), 0); // ٪ پیش‌فرض کارمزد سایت
  const days = wantAll ? 0 : Math.min(Math.max(num(opts.days, 30) || 30, 1), 365);
  const after = wantAll ? undefined : new Date(Date.now() - days * 864e5).toISOString();
  let imported = 0, updated = 0, skipped = 0, page = 1;
  const seen = new Set();
  const errors = [];
  for (page = 1; page <= 20; page++) {
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
        const mapped = mapWooToOrder(o, pct);
        seen.add(mapped.order_code);
        if (await upsertExternalOrder(store, mapped)) imported++;
        else updated++;
      } catch (e) {
        skipped++;
        if (errors.length < 5) errors.push(`order ${o.id}: ${e.message}`);
      }
    }
    if (items.length < 100) break;
  }
  // گذر دوم: تازه‌سازی وضعیت سفارش‌های بازِ بیرون از پنجره
  let refreshed = 0;
  try {
    const r = await refreshOpenOrders(store, {
      source: 'website', boothId: null, seen, errors, cap: 40, prefix: 'WC-',
      fetchOne: (id) => wooGet(integ.store_url, integ.consumer_key, integ.consumer_secret, '/orders/' + id).then((x) => x.data),
      mapOne: (o) => mapWooToOrder(o, pct),
    });
    refreshed = r.checked; updated += r.updated;
  } catch (e) { if (errors.length < 5) errors.push(e.message); }
  return { imported, updated, skipped, pages: page - 1, refreshed, errors };
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

/* ═══════════════════════════════════════════════════════════════════
   بکاپ ابری: گوگل درایو + وان‌درایو (OAuth2)
   ═══════════════════════════════════════════════════════════════════ */
const CLOUD_PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/drive.file',
  },
  onedrive: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'offline_access Files.ReadWrite',
  },
};
const ck = (p, k) => `${p}_${k}`;

async function getCloudCfg(store, p) {
  const [client_id, client_secret, refresh_token, email, last_backup, last_file] = await Promise.all([
    store.getSetting(ck(p, 'client_id')), store.getSetting(ck(p, 'client_secret')),
    store.getSetting(ck(p, 'refresh_token')), store.getSetting(ck(p, 'email')),
    store.getSetting(ck(p, 'last_backup')), store.getSetting(ck(p, 'last_file')),
  ]);
  return {
    client_id: client_id || '', client_secret: client_secret || '',
    refresh_token: refresh_token || '', email: email || '',
    last_backup: last_backup || '', last_file: last_file || '',
  };
}

const redirectUri = (origin, p) => `${origin}/api/cloud/${p}/callback`;

async function cloudStatus(store, origin) {
  const out = { redirect_uris: {} };
  for (const p of ['google', 'onedrive']) {
    const c = await getCloudCfg(store, p);
    out[p] = {
      configured: !!(c.client_id && c.client_secret),
      connected: !!c.refresh_token,
      email: c.email, last_backup: c.last_backup, last_file: c.last_file,
      client_id_hint: c.client_id ? String(c.client_id).slice(0, 14) + '…' : '',
    };
    out.redirect_uris[p] = redirectUri(origin, p);
  }
  return out;
}

function randState() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function startCloudAuth(store, p, origin) {
  const cfg = await getCloudCfg(store, p);
  if (!cfg.client_id) throw new UpstreamError('OAuth client not configured — save Client ID/Secret first', 400);
  const meta = CLOUD_PROVIDERS[p];
  const state = randState();
  await store.setSetting(ck(p, 'oauth_state'), JSON.stringify({ state, ts: Date.now() }));
  const u = new URL(meta.authUrl);
  u.searchParams.set('client_id', cfg.client_id);
  u.searchParams.set('redirect_uri', redirectUri(origin, p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', meta.scopes);
  u.searchParams.set('state', state);
  if (p === 'google') {
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
  }
  return u.toString();
}

async function finishCloudAuth(store, p, code, state, origin) {
  let saved = null;
  try { saved = JSON.parse((await store.getSetting(ck(p, 'oauth_state'))) || 'null'); } catch {}
  if (!saved || saved.state !== state || Date.now() - saved.ts > 15 * 60e3) {
    return { ok: false, error: 'Invalid or expired state. Please try connecting again.' };
  }
  await store.setSetting(ck(p, 'oauth_state'), '');
  const cfg = await getCloudCfg(store, p);
  const meta = CLOUD_PROVIDERS[p];
  const form = new URLSearchParams();
  form.set('code', code);
  form.set('client_id', cfg.client_id);
  form.set('client_secret', cfg.client_secret);
  form.set('redirect_uri', redirectUri(origin, p));
  form.set('grant_type', 'authorization_code');
  try {
    const { data } = await fetchJSON(meta.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }, p);
    if (!data.refresh_token) {
      if (p === 'google') return { ok: false, error: 'Google did not return a refresh token. Remove app access at myaccount.google.com/permissions and retry.' };
      return { ok: false, error: 'No refresh token returned.' };
    }
    await store.setSetting(ck(p, 'refresh_token'), data.refresh_token);
    try {
      const at = data.access_token;
      if (p === 'google' && at) {
        const u = await fetchJSON('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + at } }, p);
        if (u.data && u.data.email) await store.setSetting(ck(p, 'email'), u.data.email);
      } else if (at) {
        const u = await fetchJSON('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + at } }, p);
        const em = (u.data && (u.data.mail || u.data.userPrincipalName)) || '';
        if (em) await store.setSetting(ck(p, 'email'), em);
      }
    } catch { /* اختیاری */ }
    const email = await store.getSetting(ck(p, 'email'));
    return { ok: true, email: email || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cloudAccessToken(store, p) {
  const cfg = await getCloudCfg(store, p);
  if (!cfg.refresh_token) throw new UpstreamError('Not connected', 400);
  const meta = CLOUD_PROVIDERS[p];
  const form = new URLSearchParams();
  form.set('refresh_token', cfg.refresh_token);
  form.set('client_id', cfg.client_id);
  form.set('client_secret', cfg.client_secret);
  form.set('grant_type', 'refresh_token');
  const { data } = await fetchJSON(meta.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, p);
  if (data.refresh_token) await store.setSetting(ck(p, 'refresh_token'), data.refresh_token);
  return data.access_token;
}

function backupFileName() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `hesabdar-backup-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.json`;
}

async function exportData(store) {
  const [orders, booths, suppliers, integrations, settings] = await Promise.all([
    store.list('orders'), store.list('booths'), store.list('suppliers'),
    store.list('integrations'), store.allSettings(),
  ]);
  return { app: 'hesabdar-foroosh', exported_at: nowISO(), orders, booths, suppliers, integrations, settings };
}

async function importData(store, b) {
  const counts = {};
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
      counts[t] = b[t].length;
    }
  }
  if (b.settings && typeof b.settings === 'object') {
    for (const [k, v] of Object.entries(b.settings)) await store.setSetting(k, String(v));
  }
  return counts;
}

async function uploadBackup(store, p) {
  const at = await cloudAccessToken(store, p);
  const payload = JSON.stringify(await exportData(store));
  const name = backupFileName();
  let file;
  if (p === 'google') {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('media', new Blob([payload], { type: 'application/json' }));
    const { data } = await fetchJSON('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: 'Bearer ' + at }, body: form,
    }, p);
    file = { id: data.id, name: data.name || name };
  } else {
    const { data } = await fetchJSON(`https://graph.microsoft.com/v1.0/me/drive/root:/Hesabdar/${encodeURIComponent(name)}:/content`, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: payload,
    }, p);
    file = { id: data.id, name: data.name || name };
  }
  await store.setSetting(ck(p, 'last_backup'), nowISO());
  await store.setSetting(ck(p, 'last_file'), file.name);
  return { file, at: nowISO() };
}

async function listCloudBackups(store, p) {
  const at = await cloudAccessToken(store, p);
  if (p === 'google') {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', "name contains 'hesabdar-backup' and trashed=false");
    u.searchParams.set('orderBy', 'createdTime desc');
    u.searchParams.set('pageSize', '20');
    u.searchParams.set('fields', 'files(id,name,createdTime,size)');
    const { data } = await fetchJSON(u.toString(), { headers: { Authorization: 'Bearer ' + at } }, p);
    return (data.files || []).map((f) => ({ id: f.id, name: f.name, created: f.createdTime, size: f.size }));
  }
  try {
    const { data } = await fetchJSON('https://graph.microsoft.com/v1.0/me/drive/root:/Hesabdar:/children?$top=20&$orderby=createdDateTime desc', { headers: { Authorization: 'Bearer ' + at } }, p);
    return (data.value || []).filter((f) => (f.name || '').includes('hesabdar-backup')).map((f) => ({ id: f.id, name: f.name, created: f.createdDateTime, size: f.size }));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

async function downloadBackup(store, p, fileId) {
  const at = await cloudAccessToken(store, p);
  const url = p === 'google'
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`;
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: 'Bearer ' + at }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new UpstreamError(`${p}: download failed`, 0);
  }
  if (!r.ok) throw new UpstreamError(`${p}: download failed (HTTP ${r.status})`, r.status);
  return r.text();
}

function oauthResultPage(ok, title, msg) {
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0b1020;color:#fff;margin:0">
<div style="text-align:center;background:#1e293b;padding:32px;border-radius:16px;max-width:420px">
<div style="font-size:48px">${ok ? '✅' : '❌'}</div>
<h2>${title}</h2><p style="color:#cbd5e1;line-height:2">${msg}</p>
<button onclick="window.close()" style="background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:15px;cursor:pointer;font-family:inherit">بستن این صفحه</button>
<p style="font-size:12px;color:#64748b;margin-top:12px">به برنامه برگردید و دکمه ↻ (به‌روزرسانی وضعیت) را بزنید</p>
</div></body></html>`;
}

async function handleCloud(req, store, url, parts) {
  const method = req.method;
  const sub = parts[1]; // status | config | google | onedrive
  const body = async () => {
    try { return await req.json(); } catch { return {}; }
  };
  const origin = url.origin;

  if (sub === 'status' && method === 'GET') return json({ ok: true, ...(await cloudStatus(store, origin)) });

  if (sub === 'config' && (method === 'POST' || method === 'PUT')) {
    const b = await body();
    const p = b.provider;
    if (p !== 'google' && p !== 'onedrive') return json({ ok: false, error: 'bad provider' }, 400);
    if (b.client_id) await store.setSetting(ck(p, 'client_id'), String(b.client_id).trim());
    if (b.client_secret) await store.setSetting(ck(p, 'client_secret'), String(b.client_secret).trim());
    return json({ ok: true, ...(await cloudStatus(store, origin)) });
  }

  if (sub === 'google' || sub === 'onedrive') {
    const p = sub, action = parts[2];
    if (action === 'auth' && method === 'GET') {
      try {
        return Response.redirect(await startCloudAuth(store, p, origin), 302);
      } catch (e) {
        return new Response(oauthResultPage(false, 'خطا', e.message), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }
    if (action === 'callback' && method === 'GET') {
      const code = url.searchParams.get('code'), state = url.searchParams.get('state'), err = url.searchParams.get('error');
      let html;
      if (err) html = oauthResultPage(false, 'اتصال لغو شد', 'در صفحه ارائه‌دهنده، دسترسی تایید نشد.');
      else if (!code) html = oauthResultPage(false, 'خطا', 'کد تایید دریافت نشد.');
      else {
        const r = await finishCloudAuth(store, p, code, state, origin);
        html = r.ok
          ? oauthResultPage(true, 'اتصال موفق شد', `حساب ${r.email ? '<b dir="ltr">' + r.email + '</b>' : ''} متصل شد. از این پس بکاپ‌ها به‌صورت خودکار ذخیره می‌شوند.`)
          : oauthResultPage(false, 'خطا در اتصال', r.error);
      }
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (action === 'backup' && method === 'POST') {
      try {
        return json({ ok: true, ...(await uploadBackup(store, p)) });
      } catch (e) { return json({ ok: false, error: e.message, status: e.status }); }
    }
    if (action === 'files' && method === 'GET') {
      try {
        return json({ ok: true, files: await listCloudBackups(store, p) });
      } catch (e) { return json({ ok: false, error: e.message, status: e.status }); }
    }
    if (action === 'restore' && method === 'POST') {
      try {
        const b = await body();
        if (!b.fileId) return json({ ok: false, error: 'fileId required' }, 400);
        const text = await downloadBackup(store, p, b.fileId);
        let d;
        try { d = JSON.parse(text); } catch { return json({ ok: false, error: 'Invalid backup file' }, 400); }
        if (!d || d.app !== 'hesabdar-foroosh' || !Array.isArray(d.orders)) return json({ ok: false, error: 'Not a Hesabdar backup' }, 400);
        const counts = await importData(store, d);
        return json({ ok: true, counts, exported_at: d.exported_at });
      } catch (e) { return json({ ok: false, error: e.message, status: e.status }); }
    }
    if (!action && method === 'DELETE') {
      for (const k of ['refresh_token', 'email', 'last_backup', 'last_file', 'oauth_state']) await store.setSetting(ck(p, k), '');
      return json({ ok: true });
    }
  }
  return json({ error: 'not found' }, 404);
}

/* کارهای دوره‌ای Cron: سینک خودکار + بکاپ ابری */
/* موعد سینک خودکار رسیده؟ (پیش‌فرض: هر ۶۰ دقیقه) */
const isSyncDue = (integ, now = Date.now()) => {
  if (num(integ.auto_sync, 0) !== 1) return false;
  const last = integ.last_sync_at ? Date.parse(integ.last_sync_at) : 0;
  return now - last >= num(integ.sync_every_min, 60) * 60e3;
};
async function runScheduled(env) {
  if (!env.DB) return;
  const store = d1Store(env.DB);
  await store.migrate();
  /* ۱) سینک اتصال‌های خودکار */
  const all = await store.list('integrations');
  for (const integ of all.filter((i) => isSyncDue(i))) {
    try {
      const res = integ.type === 'basalam'
        ? await syncBasalam(store, integ, { days: 2 })
        : await syncWoo(store, integ, { days: 2 });
      await store.update('integrations', integ.id, { last_sync_at: nowISO(), last_status: `auto: +${res.imported} ~${res.updated}` });
    } catch (e) {
      try { await store.update('integrations', integ.id, { last_status: 'auto error' }); } catch {}
    }
  }
  /* ۲) بکاپ ابری روزانه */
  for (const p of ['google', 'onedrive']) {
    try {
      const last = await store.getSetting(ck(p, 'last_backup'));
      if (last && Date.now() - Date.parse(last) < 20 * 3600e3) continue;
      const cfg = await getCloudCfg(store, p);
      if (!cfg.refresh_token) continue;
      await uploadBackup(store, p);
    } catch {}
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

  /* اتصال‌ها */
  if (resource === 'integrations') {
    return handleIntegrations(req, store, parts);
  }

  /* بکاپ ابری */
  if (resource === 'cloud') {
    return handleCloud(req, store, url, parts);
  }

  /* حذف گروهی */
  if ((resource === 'orders' || resource === 'booths' || resource === 'suppliers') && id === 'bulk-delete' && method === 'POST') {
    const b = await body();
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String).filter(Boolean))].slice(0, 500) : [];
    if (!ids.length) return json({ ok: false, error: 'ids required' }, 400);
    const deleted = await store.removeMany(resource, ids);
    return json({ ok: true, deleted });
  }

  /* export / import */
  if (resource === 'export' && method === 'GET') {
    return json(await exportData(store));
  }
  if (resource === 'import' && method === 'POST') {
    const counts = await importData(store, await body());
    return json({ ok: true, counts });
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
    booths: { fields: ['name', 'description', 'ship_single', 'ship_multi', 'comm_pct'] },
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

    /* سلامت (بدون نیاز به دیتابیس، برای تشخیص حالت) */
    if (url.pathname === '/api/health') {
      return json({ ok: true, mode: env.DB ? 'd1' : 'nodb', time: nowISO(), app: 'hesabdar-foroosh' });
    }

    /* API — فقط با D1 */
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.DB) {
        return json({ error: 'no_db', message: 'D1 database is not connected. Data APIs are disabled.' }, 503);
      }
      try {
        const store = d1Store(env.DB);
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

  /* Cron پایه (هر ۱۵ دقیقه): سینک خودکار سررسیده + بکاپ ابری */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};
