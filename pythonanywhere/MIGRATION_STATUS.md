# scraper4 PythonAnywhere port — migration status

**This is an in-progress port, not a deployable replacement yet.** The requested acceptance criterion is full feature/endpoint parity; do not switch production traffic to this project until the parity gate is cleared.

## Source pinned for this port

- Source branch: `arena/01a0ebf7-new`
- Source commit: `b6d04d32a41eff859f518ec085ec2ad97b3f0b48`
- Source app version: `10.599`
- Source file: `scraper4.php` (122,979 lines; 8,577,687 UTF-8 bytes)
- Inventory: `migration/source_manifest.json`

The inventory currently records 2,876 PHP function declarations and 711 distinct request-variable keys (1,752 source references). These are an initial mechanical inventory, not a claim that every key is an HTTP endpoint. Each route must be classified from its surrounding control flow before porting.

## Completed slices

- Compatibility implementations for custom pagination URL construction, Persian/Arabic digits and price parsing, URL/profile identity, and product identity.
- Initial Persian, mobile-friendly dashboard at `/` with source-status display and an interactive pagination preview. This is a staging UI only; it does not scrape products.
- Python unit tests for compatibility helpers, the WSGI feature gates, and the initial UI (20 tests currently pass).

## Not yet ported

Everything else: scraping orchestration and SSE behavior, profile/product persistence and import/export, selector UI and parser fallbacks, detail extraction, Basalam/WooCommerce APIs, two-lane queue ownership and worker locks, progress/resume/watchdogs, matrices, AI providers, chat/notifications, task manager, updater/deployment flows, all remaining UI actions, and operational scheduling.

## PythonAnywhere constraints to address before release

- Serve the finished application through PythonAnywhere's WSGI configuration; no PHP runtime will be assumed.
- Move durable state to a transactional database and a persistent media directory. Do not use process memory as queue state.
- Replace PHP background workers/cron assumptions with a PythonAnywhere-compatible worker/scheduled-task design and test stop/resume after WSGI reloads.
- Keep secrets in environment/configuration, never in source or a committed `.env`.
- Finish a route-by-route parity matrix and fixture-based tests against the pinned v10.599 behavior before marking the app deployable.

## Gate

`PORT_PARITY_COMPLETE` remains false until all source route families and user-visible flows are ported and tested. The WSGI template deliberately reports the project as incomplete rather than pretending that a partial port is production-ready.
