// String.raw keeps every backslash exactly as written, so the seeded profile JSON
// stays byte-identical to the .sql migrations. A plain template literal would turn
// each \" inside the JSON payloads into a bare ", producing invalid JSON that
// db.ts's json() helper silently swallows - every seeded profile then loaded with
// no selectors at all and extracted nothing.
export const SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS products (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  data TEXT NOT NULL,
  title TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL DEFAULT '',
  remote_woo_id INTEGER,
  remote_basalam_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  missing_since TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(profile_id, source_key)
);
CREATE INDEX IF NOT EXISTS products_profile_updated_idx ON products(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS products_title_idx ON products(profile_id, title);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('scrape','sync')),
  target TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'waiting',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_idx ON jobs(profile_id,kind) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS destination_map (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  target TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT 'default',
  remote_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(profile_id, source_key, target, account_key)
);
CREATE TABLE IF NOT EXISTS category_learning (
  phrase TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  category_name TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(phrase, category_id)
);
CREATE TABLE IF NOT EXISTS autoreply_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  customer TEXT NOT NULL DEFAULT '',
  input_text TEXT NOT NULL,
  output_text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS agent_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]',
  schedule_minutes INTEGER NOT NULL DEFAULT 0,
  model_key TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  max_steps INTEGER NOT NULL DEFAULT 6,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  prompt_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'starting',
  prompt TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  messages TEXT NOT NULL DEFAULT '[]',
  logs TEXT NOT NULL DEFAULT '[]',
  steps INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 6,
  result TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS agent_runs_created_idx ON agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS agent_prompts_schedule_idx ON agent_prompts(enabled, schedule_minutes);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'snappshop-kitchen-auto',
  '{"id":"snappshop-kitchen-auto","name":"SnappShop Kitchen Appliances — Auto","url":"https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=1","enabled":true,"pages":3,"pagination":"query_page","extractionEngine":"auto","paginationValue":"page","selectors":{"container":"a[href*=\"/product/\"], [data-testid*=\"product\"], article, li","title":"[data-testid*=\"title\"], [class*=\"title\"], [class*=\"name\"], h2, h3","price":"[data-testid*=\"price\"], [class*=\"price\"], [class*=\"amount\"]","link":"a[href]","image":"img"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"titleSuffix":"","priceMode":"none","priceValue":0,"roundPrice":0,"minPrice":0,"wooCategoryId":0,"basalamCategoryId":0,"basalamFallbackCategoryIds":[],"networkIndirect":false,"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"lastRunAt":null,"createdAt":"2026-09-06T00:00:00.000Z","updatedAt":"2026-09-06T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'snappshop-kitchen-next-data',
  '{"id":"snappshop-kitchen-next-data","name":"SnappShop Kitchen Appliances — Next.js Data","url":"https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=1","enabled":true,"pages":3,"pagination":"query_page","extractionEngine":"next_data","paginationValue":"page","selectors":{"container":"a[href*=\"/product/\"], [data-testid*=\"product\"], article, li","title":"[data-testid*=\"title\"], [class*=\"title\"], [class*=\"name\"], h2, h3","price":"[data-testid*=\"price\"], [class*=\"price\"], [class*=\"amount\"]","link":"a[href]","image":"img"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"titleSuffix":"","priceMode":"none","priceValue":0,"roundPrice":0,"minPrice":0,"wooCategoryId":0,"basalamCategoryId":0,"basalamFallbackCategoryIds":[],"networkIndirect":false,"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"lastRunAt":null,"createdAt":"2026-09-06T00:00:00.000Z","updatedAt":"2026-09-06T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'snappshop-kitchen-heuristic',
  '{"id":"snappshop-kitchen-heuristic","name":"SnappShop Kitchen Appliances — Heuristic Cards","url":"https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=1","enabled":true,"pages":3,"pagination":"query_page","extractionEngine":"heuristic","paginationValue":"page","selectors":{"container":"a[href*=\"/product/\"], [data-testid*=\"product\"], article, li","title":"[data-testid*=\"title\"], [class*=\"title\"], [class*=\"name\"], h2, h3","price":"[data-testid*=\"price\"], [class*=\"price\"], [class*=\"amount\"]","link":"a[href]","image":"img"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"titleSuffix":"","priceMode":"none","priceValue":0,"roundPrice":0,"minPrice":0,"wooCategoryId":0,"basalamCategoryId":0,"basalamFallbackCategoryIds":[],"networkIndirect":false,"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"lastRunAt":null,"createdAt":"2026-09-06T00:00:00.000Z","updatedAt":"2026-09-06T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'mantoopatris-products',
  '{"id":"mantoopatris-products","name":"Mantoopatris Products — In Stock New","url":"https://mantoopatris.com/product?keyword=&price_from=&price_to=&order=new&stock=1","enabled":true,"pages":3,"pagination":"query_page","extractionEngine":"heuristic","paginationValue":"page","selectors":{"container":"a[href*=\"/product/\"], [class*=\"product\"], article, li","title":"a[href*=\"/product/\"], [class*=\"title\"], [class*=\"name\"], h2, h3","price":"[class*=\"price\"], [class*=\"amount\"], [class*=\"cost\"]","link":"a[href*=\"/product/\"]","image":"img","category":"a[href*=\"/product-category/\"]"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"titleSuffix":"","priceMode":"none","priceValue":0,"roundPrice":0,"minPrice":0,"wooCategoryId":0,"basalamCategoryId":0,"basalamFallbackCategoryIds":[],"networkIndirect":false,"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"lastRunAt":null,"createdAt":"2026-09-06T00:00:00.000Z","updatedAt":"2026-09-06T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'us-nextjs-commerce-shirts',
  '{"id":"us-nextjs-commerce-shirts","name":"US Next.js Commerce Demo — Shirts","url":"https://demo.vercel.store/search/shirts","enabled":true,"pages":1,"pagination":"none","extractionEngine":"auto","paginationValue":"page","selectors":{"container":"a[href^=\"/product/\"], [data-testid*=\"product\"], article, li, div[class*=\"product\"]","title":"[data-testid*=\"title\"], [class*=\"title\"], [class*=\"name\"], h2, h3, img[alt]","price":"[data-testid*=\"price\"], [class*=\"price\"], [class*=\"amount\"], [class*=\"money\"]","link":"a[href^=\"/product/\"]","image":"img, source"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"createdAt":"2026-09-08T00:00:00.000Z","updatedAt":"2026-09-08T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'us-apple-buy-iphone',
  '{"id":"us-apple-buy-iphone","name":"US Apple Store — Buy iPhone","url":"https://www.apple.com/shop/buy-iphone","enabled":true,"pages":1,"pagination":"none","extractionEngine":"auto","paginationValue":"page","selectors":{"container":"article, div[class*=\"product\"], div[class*=\"rf-hcard\"], div[class*=\"rf-flagship\"], section li","title":"h2, h3, [class*=\"title\"], [class*=\"name\"], img[alt]","price":"[class*=\"price\"], [class*=\"payment\"], [data-autom*=\"price\"]","link":"a[href*=\"/shop/buy-iphone\"], a[href*=\"/us/shop/goto/buy_iphone\"]","image":"img, source"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"createdAt":"2026-09-08T00:00:00.000Z","updatedAt":"2026-09-08T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
UPDATE profiles
SET data = '{"id":"us-apple-buy-iphone","name":"US Apple Store — Buy iPhone","url":"https://www.apple.com/shop/buy-iphone","enabled":true,"pages":1,"pagination":"none","extractionEngine":"htmlrewriter","paginationValue":"page","selectors":{"container":"article[class*=\"rf-\"], div[class*=\"rf-hcard\"], li[class*=\"rf-hcard\"], div[class*=\"rf-flagship\"], li[class*=\"rf-flagship\"], div[class*=\"rc-card\"], li[class*=\"rc-card\"], div[class*=\"product-card\"], li[class*=\"product-card\"], div[class*=\"rf-productcard\"], li[class*=\"rf-productcard\"]","title":"h2, h3, [class*=\"title\"], [class*=\"name\"], img[alt]","price":"[class*=\"price\"], [class*=\"payment\"], [data-autom*=\"price\"]","link":"a[href*=\"/shop/buy-iphone/\"], a[href*=\"/us/shop/goto/buy_iphone/\"]","image":"img, source"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"createdAt":"2026-09-08T00:00:00.000Z","updatedAt":"2026-09-09T00:00:00.000Z"}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'us-apple-buy-iphone' AND data LIKE '%section li%';
`;
