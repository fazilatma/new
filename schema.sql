-- ─── حسابدار فروش | اسکیمای D1 ───────────────────────────────────
-- نکته: ورکر به‌صورت خودکار این جدول‌ها را می‌سازد؛ این فایل برای ساخت دستی است.
-- اجرا: wrangler d1 execute hesabdar-db --file=schema.sql

CREATE TABLE IF NOT EXISTS booths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  ship_single REAL DEFAULT 0,
  ship_multi REAL DEFAULT 0,
  comm_pct REAL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT,
  source TEXT NOT NULL DEFAULT 'basalam',
  booth_id INTEGER,
  customer_name TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  city TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  quantity INTEGER DEFAULT 1,
  supplier_id INTEGER,
  supplier_name TEXT DEFAULT '',
  unit_sale REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  shipping_cost REAL DEFAULT 0,
  shipping_rev REAL DEFAULT 0,
  packaging_cost REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  ads_cost REAL DEFAULT 0,
  other_cost REAL DEFAULT 0,
  other_label TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  purchase_type TEXT DEFAULT 'cash',
  customer_ptype TEXT DEFAULT 'cash',
  order_date TEXT,
  jdate TEXT,
  jy INTEGER,
  jm INTEGER,
  jd INTEGER,
  notes TEXT DEFAULT '',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(order_code);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT DEFAULT '',
  token TEXT DEFAULT '',
  vendor_id INTEGER,
  vendor_title TEXT DEFAULT '',
  booth_id INTEGER,
  store_url TEXT DEFAULT '',
  consumer_key TEXT DEFAULT '',
  consumer_secret TEXT DEFAULT '',
  auto_sync INTEGER DEFAULT 0,
  sync_every_min INTEGER DEFAULT 60,
  last_sync_at TEXT,
  last_status TEXT DEFAULT '',
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
