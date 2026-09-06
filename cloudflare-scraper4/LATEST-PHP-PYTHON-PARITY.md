# Latest PHP/Python parity audit

Date: 2026-09-06

Compared upstream repositories:

- `fazilatma/amphp` latest active branch by commit date: `arena/01a06ac3-amphp`
  - PHP `scraper4.php`: `APP_VERSION = 10.123`
  - Python `scraper4.py`: `APP_VERSION = 10.149`
- `fazilatma/code` latest active branch by commit date: `arena/01a0425a-code`
  - PHP `scraper4.php`: `APP_VERSION = 10.91`
  - Cloudflare single-file `scraper4.ts`: older single-file Worker edition

## Ported into this TypeScript/Cloudflare project

### Python/PHP v10.149 — per-site master extraction engine

The Python edition learns the fastest successful engine for a profile/site and tries it first on later pages/runs.

Port added here:

- `Profile.extractionEngineMaster`
- `Profile.extractionEngineHost`
- `Profile.extractionEngineMs`
- compatibility import aliases from PHP/Python profiles:
  - `fetch_engine_master`
  - `fetch_engine_host`
  - `fetch_engine_ms`
- Worker extraction engine ordering now tries the learned master before fallback engines in `auto` mode.
- Render/Node extraction engine ordering does the same and can include browser engines.
- Scrape processors persist the winning engine after successful extraction.

### Python/PHP v10.148 — Basalam price unit safety

The Python edition sends Basalam prices in rial by multiplying toman prices by 10, unless the source text already says rial/IRR.

Port added here:

- Worker `syncBasalam()` now calls `basalamPrice()`.
- Render `syncBasalam()` now calls `basalamPrice()`.
- If `product.priceText` contains `ریال`, `rial`, or `IRR`, the numeric price is kept.
- Otherwise the final Basalam payload price is multiplied by 10 after per-shop percentage adjustment.

## Already covered before this audit

Many earlier PHP/Python items were already present in this project before this pass, including:

- multi-shop Basalam settings and destination mapping
- AI provider candidates and master model selection
- category-learning / tried-category memory
- backup/restore and import/export
- visual selector tooling
- detail extraction, gallery extraction, variations, JSON-LD, `__NEXT_DATA__`, metadata, script JSON, heuristic extraction
- Cloudflare-safe Worker engines and Render/Node-only browser engines
- safe zero-product handling that avoids retiring products after an unreliable scan

## Not copied directly

Some PHP/Python items are runtime-specific and are intentionally not copied into the Cloudflare Worker runtime:

- PythonAnywhere/VPS `systemd`, Gunicorn, Apache `/put`, and Python virtualenv installers
- Python engines such as `httpx`, `cloudscraper`, `curl_cffi`, and Selenium inside Cloudflare Workers
- direct anti-bot bypass behavior

Those belong in Python/VPS or Render/Node deployments, not Cloudflare Workers.
