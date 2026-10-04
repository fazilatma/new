# Bootstrap restore — survive Render deploys

Render's free plan wipes the local database on **every deploy**. The bootstrap
restore re-imports all of your settings automatically on boot — but only when
the database is completely fresh, so a configured instance is never
overwritten.

## What is restored

The bootstrap file is a full settings export (`render-bootstrap.json`): all
profiles, products, connections (WooCommerce / Basalam / AI providers, models,
candidates, master), notifications, category learning, autoreply history, and
every other stored setting.

## Recommended setup (Render Secret File)

1. In the dashboard go to **Version → Backup** (or the side menu) and press
   **«دانلود بوت‌استرپ رندر»**. The file downloads with the exact name
   `render-bootstrap.json`.
2. In the Render dashboard open your service → **Environment** → **Secret
   Files** → add a secret file named `render-bootstrap.json` and paste the
   whole file content into it.
3. Redeploy (or just wait for the next deploy). On Render the restore is **on
   by default**; no environment variable is needed.
4. After boot, the dashboard backup panel shows when the restore happened, and
   `GET /api/bootstrap/status` reports the full state.

Re-download and update the secret file whenever you change important settings,
otherwise a later deploy restores the older snapshot.

## VPS / Termux / local

Copy `render-bootstrap.json` into this directory (next to the code) and set:

```sh
BOOTSTRAP_RESTORE=1
```

Alternatively point `BOOTSTRAP_PATH` at any JSON file; setting it also enables
the restore. Disable anywhere with `BOOTSTRAP_RESTORE=0`.

## Safety rules

- **Secrets warning:** the bundle contains API keys and tokens. Never commit a
  real `render-bootstrap.json` to git — `bootstrap/*.json` is git-ignored on
  purpose.
- The restore runs **only on a fresh database** (zero profiles, zero stored
  state). It never overwrites existing configuration.
- Failures never crash the boot; they are logged and shown in the status
  endpoint.
- Cloudflare Workers do not need this: KV storage survives deploys, so the
  status endpoint there simply reports `supported:false`.
