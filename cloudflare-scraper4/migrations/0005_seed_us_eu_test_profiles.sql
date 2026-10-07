-- Seed US/EU-style JavaScript-heavy storefront profiles for extraction testing.
-- They stay disabled for destination sync and never overwrite user-edited profiles.

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
