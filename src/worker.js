/* ═══════════════════════════════════════════════════════════════════
   حسابدار فروش — بک‌اند Cloudflare Worker
   • سرو فرانت‌اند (تک‌فایل، فارسی/راست‌چین، تقویم شمسی)
   • API سفارش‌ها / غرفه‌ها / تامین‌کنندگان / تنظیمات
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
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];

const ORDER_FIELDS = [
  'order_code', 'source', 'booth_id', 'customer_name', 'customer_phone', 'city',
  'product_name', 'quantity', 'supplier_id', 'supplier_name',
  'unit_sale', 'unit_cost', 'discount', 'shipping_cost', 'packaging_cost',
  'commission', 'ads_cost', 'other_cost', 'other_label',
  'status', 'payment_status', 'order_date', 'jdate', 'jy', 'jm', 'jd', 'notes',
];
const NUM_FIELDS = new Set([
  'quantity', 'unit_sale', 'unit_cost', 'discount', 'shipping_cost',
  'packaging_cost', 'commission', 'ads_cost', 'other_cost', 'jy', 'jm', 'jd', 'booth_id', 'supplier_id',
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
    globalThis.__MEM__ = { booths: [], suppliers: [], orders: [], settings: {}, seq: 1 };
  }
  const M = globalThis.__MEM__;
  const nextId = () => M.seq++;
  return {
    mode: 'memory',
    migrate: async () => {},
    list: async (t) => [...(M[t] || [])].reverse().slice(0, 5000),
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

/* ─── روتر ─── */
async function handleApi(req, store, url) {
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = parts[0]; // booths | suppliers | orders | settings | health | export | import
  const id = parts[1];

  const body = async () => {
    try { return await req.json(); } catch { return {}; }
  };

  /* health */
  if (resource === 'health') {
    return json({ ok: true, mode: store.mode, time: nowISO(), app: 'hesabdar-foroosh' });
  }

  /* export / import */
  if (resource === 'export' && method === 'GET') {
    const [orders, booths, suppliers, settings] = await Promise.all([
      store.list('orders'), store.list('booths'), store.list('suppliers'), store.allSettings(),
    ]);
    return json({ app: 'hesabdar-foroosh', exported_at: nowISO(), orders, booths, suppliers, settings });
  }
  if (resource === 'import' && method === 'POST') {
    const b = await body();
    for (const t of ['orders', 'booths', 'suppliers']) {
      if (Array.isArray(b[t])) {
        await store.clear(t);
        for (const row of b[t].slice(0, 5000)) {
          const c = { ...row };
          delete c.id;
          if (t === 'orders') await store.insert(t, pick(c, ORDER_FIELDS));
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
};
