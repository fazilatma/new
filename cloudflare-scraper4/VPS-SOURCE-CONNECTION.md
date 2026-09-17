# VPS source-connection update and verification

This checklist accompanies the source-routing fix. Read the release version from
`package.json`; the release branch for this session is `arena/01a0aa17-new`.

## 1. Protect the existing installation

- Export a settings backup from the dashboard. It can contain tokens: keep it private.
- Back up the database separately. For SQLite, stop the processes before taking a
  file copy, or use SQLite's backup facility; do not copy a live database without
  accounting for its WAL. For PostgreSQL, use your existing database backup process.
- Keep `.env*`, `data/`, the database location and `ADMIN_TOKEN` unchanged. The
  existing token is needed to decrypt saved connection credentials.
- Record the currently running release and process-manager configuration.

## 2. Install and restart

The branch must first be available on GitHub or its release files transferred to
the VPS. A local Arena commit alone does not update the server.

If using the built-in deployer, select this session's branch after publication,
install it, and use its rebuild/restart action. Check the reported running version,
not only the selected branch name.

For a manually managed installation, put the release files in the existing checkout
without overwriting secrets or data. From `cloudflare-scraper4/`, run:

```bash
npm ci
npm run version:check
npm run render:build
```

Restart the existing service using its current process manager. There is no universal
systemd or PM2 service name in this repository: do not start another server alongside
the running one. The repository's entrypoints are:

- Web/API: `npm run render:start`
- Separate queue worker, if installed: `npm run render:worker`
- Separate cron invocation, if installed: `npm run render:cron`

When `RUN_WORKER_IN_WEB=true`, the web process already runs the embedded worker and
scheduler. Do not add a second scheduler during this update. Ensure separate queue
or cron processes use the same updated checkout, database and environment.

Check `/health` and the dashboard's version panel. Compare the running version with
`node -p "require('./package.json').version"`. A successful build alone does not
prove the old process was restarted.

## 3. Configure the Emalls source route

In the source-site connection panel (not the AI panel):

1. Select **Worker / reverse proxy** as the main method.
2. Enter `https://proxy.fazilat-ma.workers.dev` in the Worker field.
3. Leave the host restriction empty, or enter `emalls.ir`.
4. Run the source-access test using the saved women's-shoes profile.
5. Run extraction diagnosis on that same profile.

The default source contract matches the Worker runtime:

```text
https://proxy.fazilat-ma.workers.dev/https://emalls.ir/...
```

If the proxy actually expects a query parameter, use this Worker field instead:

```text
https://proxy.fazilat-ma.workers.dev/?url={url}
```

The placeholder encodes the target once. Do not paste an already wrapped Emalls
request into the Worker address field. The reverse proxy must permit `emalls.ir`.
An ordinary HTTP CONNECT proxy is a different protocol from a Worker reverse proxy.

The source panel takes precedence over legacy AI-network settings. In particular,
an explicitly saved `direct` source method does not inherit an AI gateway. Select
Worker explicitly; automatic fallback, DoH/IP overrides and SOCKS are not applied
by this source-routing implementation.

## 4. Interpret the results

| Result | Next check |
| --- | --- |
| `route: direct` when Worker was intended | Confirm the main source method, domain restriction and running version. |
| Missing `Worker URL` | Enter the address in the source panel, not only the AI panel. |
| `route: worker` with HTTP 403 | Check the proxy's URL contract and domain allowlist, then upstream rejection. Route identifies the attempted transport, not which hop produced 403. |
| HTTP 200 but a challenge page | The transport worked, but usable product HTML was not obtained. |
| HTML received but zero products | Inspect the extraction diagnosis and selectors; this is separate from transport. |
| Access test succeeds but browser engine fails | Browser engines use their own browser navigation; this fix covers source fetches, not a general browser-proxy implementation. |

A site's country and a VPS's country do not determine identical access. Their IPs,
network paths and request signatures can differ.

## 5. Evidence for a remaining failure

Keep the following together, redacting credentials, cookies and private proxy query
parameters before sharing:

- Running version, selected extraction engine, and whether the profile's indirect
  flag is enabled.
- Source-access test result, including route and HTTP status.
- Extraction-diagnosis network stage and recommendations.
- Whether the proxy's own textbox succeeds for exactly the same category URL.
- The proxy's expected target format (path or query), or its redacted source code.

Repository validation passed 706 tests with 6 skips and no failures; the service lab
passed 34/34. These are offline checks, not proof of live Emalls access from your VPS.


## Query-proxy compatibility follow-up

Browser-encoded placeholders (`%7Burl%7D`) and existing `?url=` parameters now resolve
to the current source URL. If a GET/HEAD request through an explicit query gateway
returns 403, the source transport retries that same gateway once with `X-Proxy-UA`
and `X-Proxy-Referer`, omitting duplicate target-control headers and browser-shaped
transport defaults. Explicit gateway credentials/control values are retained.
There is no switch to a direct route and no retry of POST requests. A persistent
failure includes `attempts: 403 → 403`; this still does not identify which hop
rejected the request. Offline tests exercise recovery and persistent failure on
both runtimes; live VPS recovery has not been verified.
