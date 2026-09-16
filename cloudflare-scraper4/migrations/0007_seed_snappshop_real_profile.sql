-- Seed the real-structure SnappShop profile from the user's 2026-09-13 DevTools dump.
-- The three 0003 seeds still carry guessed selectors; this one encodes the actual PLP:
-- each card is a classless A[href*="/product/snp-"] wrapping ARTICLE.ProductCard_product-card,
-- titles in H3, the sale price isolated in [class*="productPrice__new"] (both engines take
-- the MAXIMUM number in the price text, so a card-level price selector would return the
-- crossed-out old price on every discounted row). INSERT OR IGNORE so a user-edited
-- profile with this id is never overwritten.

INSERT OR IGNORE INTO profiles (id, data, enabled, interval_minutes, last_run_at, created_at, updated_at)
VALUES (
  'snappshop-kitchen-real',
  '{"id":"snappshop-kitchen-real","name":"SnappShop Kitchen Appliances — Real PLP","url":"https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=1","enabled":true,"pages":3,"pagination":"query_page","extractionEngine":"cheerio","paginationValue":"page","selectors":{"container":"a[href*=\"/product/snp-\"]","title":"h3","price":"[class*=\"productPrice__new\"]","link":"a[href]","image":"img"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"titleSuffix":"","priceMode":"none","priceValue":0,"roundPrice":0,"minPrice":0,"wooCategoryId":0,"basalamCategoryId":0,"basalamFallbackCategoryIds":[],"networkIndirect":false,"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"lastRunAt":null,"createdAt":"2026-09-13T00:00:00.000Z","updatedAt":"2026-09-13T00:00:00.000Z"}',
  1,
  0,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
