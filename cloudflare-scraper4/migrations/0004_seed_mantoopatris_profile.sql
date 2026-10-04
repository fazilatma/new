-- Seed a starter profile for the Mantoopatris products URL.
-- INSERT OR IGNORE prevents overwriting any user-edited profile with the same id.

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
