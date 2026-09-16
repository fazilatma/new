-- Repair the seeded US Apple Store profile.
-- The original container selector ended in "section li", which also matched apple.com's
-- global navigation and the Shopping guides / Ways to save lists, so an extraction run
-- returned priceless navigation rows next to the real iPhone cards. The link selector
-- now requires a product path segment and the engine is pinned to the configured CSS.
-- Profiles a user already edited (no longer containing "section li") stay untouched.

UPDATE profiles
SET data = '{"id":"us-apple-buy-iphone","name":"US Apple Store — Buy iPhone","url":"https://www.apple.com/shop/buy-iphone","enabled":true,"pages":1,"pagination":"none","extractionEngine":"htmlrewriter","paginationValue":"page","selectors":{"container":"article[class*=\"rf-\"], div[class*=\"rf-hcard\"], li[class*=\"rf-hcard\"], div[class*=\"rf-flagship\"], li[class*=\"rf-flagship\"], div[class*=\"rc-card\"], li[class*=\"rc-card\"], div[class*=\"product-card\"], li[class*=\"product-card\"], div[class*=\"rf-productcard\"], li[class*=\"rf-productcard\"]","title":"h2, h3, [class*=\"title\"], [class*=\"name\"], img[alt]","price":"[class*=\"price\"], [class*=\"payment\"], [data-autom*=\"price\"]","link":"a[href*=\"/shop/buy-iphone/\"], a[href*=\"/us/shop/goto/buy_iphone/\"]","image":"img, source"},"gallery":{"mode":"off","box":"","selectors":"","pattern":"","from":0,"to":10,"max":30,"skip_first":false},"syncWoo":false,"syncBasalam":false,"intervalMinutes":0,"createdAt":"2026-09-08T00:00:00.000Z","updatedAt":"2026-09-09T00:00:00.000Z"}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'us-apple-buy-iphone' AND data LIKE '%section li%';
