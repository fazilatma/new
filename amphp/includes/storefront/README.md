# Storefront assets (deploy fallback)

These files power the React shopfront:

- `storefront.js` / `storefront.css` — built UI
- `embedded-assets.php` — optional external pack (agent.php already embeds the same payload)

## Minimum deploy (easiest)

Upload **only** `agent.php` **v13.1.3+**.  
JS/CSS are embedded inside agent.php and served via:

```
https://yoursite.ir/?amphp_sf=storefront.js
https://yoursite.ir/?amphp_sf=storefront.css
```

## Recommended deploy

Copy the whole plugin folder so disk files take priority:

```
wp-content/plugins/tst/
  agent.php
  includes/storefront/storefront.js
  includes/storefront/storefront.css
  asset/js/storefront/   (optional duplicate)
```

## Verify after upload

Open: `https://yoursite.ir/?amphp_sf=storefront.js`  
Expect JavaScript body and response header `X-AMPHP-Asset: embedded` or `disk:...`.
