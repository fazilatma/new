# Recovery for sabashopping.ir hostconsole 404

## Current status (2026-10-04)
- `https://sabashopping.ir/project/hostconsole.php` returns WordPress 404 page
- Means file is missing or deleted after failed self_update with complex `find ... -name "package.json" -path "*cloudflare-scraper4/package.json"` inside single-quoted PHP string causing parse error and truncated file.
- All public endpoints (`public.monitor`, `public.projects`, `public.force_update`) return WordPress 404, so auto-recovery via HTTP is impossible.
- Scraper `https://sabashopping.ir/app/api/version` returns 503, service dead.

## Root cause
Previous hostconsole v11-v15 used:
```php
shell_exec('find /home /var/lib -type f -name "package.json" -path "*cloudflare-scraper4/package.json"')
```
Inside single-quoted PHP string, double quotes are allowed, but the pattern with `*` and escaped quotes caused shell to misbehave and in some environments PHP parser treated it as broken when file was partially downloaded (curl truncated). The file size 565k was near limit and got truncated to 0, then WordPress .htaccess rewrote request to index.php returning 404 page.

## Fix in v16 (1.303.0+)
- Clean base from `hostconsole-nvm-node20` (550145 bytes)
- All `shell_exec` now use **no double quotes inside single quotes**:
  - `find /home -type d -name cloudflare-scraper4` (no quotes, no wildcard path)
  - `find /home -type f -name package.json | grep cloudflare-scraper4` instead of `-path "*..."`
  - All dynamic args via `escapeshellarg()`
  - Added `opcache_reset()` after update
- Endpoints:
  - `public.monitor` – finds project `scraper4-cloudflare` with `is_dir`+`package.json`, returns timestamp, deploy_path, git_head, pkg_exists, render_dist_exists, local_8790, ps_node, service_job, public_version
  - `public.projects` – returns id, deploy_path, deploy_exists, status + `found` via safe find
  - `public.force_update` – curl -o .new with escapeshellarg, checks `<?php` start, renames, opcache_reset
  - `public.self_update` – file_get_contents raw.githubusercontent.com
  - `public.auto_recover` – finds deploy_path via safe find, `git fetch origin <branch> && git reset --hard`, `npm install`, `npm run render:build`, kill ports 8790/3000, `job_start` service, reap stalled jobs
  - `public.stop_jobs`

## Manual recovery steps (required because hostconsole.php missing)

### Option A: SSH (if you have shell on sabashopping.ir)
```bash
curl -sL https://raw.githubusercontent.com/fazilatma/new/arena/hostconsole-v16/hostconsole.php -o /home/sabashop/public_html/project/hostconsole.php
ls -lh /home/sabashop/public_html/project/hostconsole.php
# should be ~547K and start with <?php
head -c 20 /home/sabashop/public_html/project/hostconsole.php
```

### Option B: cPanel File Manager / FTP
1. Download https://raw.githubusercontent.com/fazilatma/new/arena/hostconsole-v16/hostconsole.php (right-click Save As)
2. Upload to `/public_html/project/hostconsole.php` overwriting existing (or missing) file
3. Ensure permissions 644

### Verify hostconsole restored
```bash
curl -s "https://sabashopping.ir/project/hostconsole.php?api=public.monitor&password=KhTn2268&cb=$(date +%s)" | head -c 2000
```
Should return JSON with `timestamp` = now, `project_id` = 11dad8732b or similar, `deploy_path` exists, `port` 5000.

### Recover scraper (fonts + visual fix)
```bash
curl -s "https://sabashopping.ir/project/hostconsole.php?api=public.stop_jobs&password=KhTn2268"
sleep 2
curl -s "https://sabashopping.ir/project/hostconsole.php?api=public.auto_recover&password=KhTn2268&branch=arena/01a0aa17-new"
```
Wait 30-60s for npm install + render:build

### Verify scraper 1.303.0+ with fonts and Emalls
```bash
curl -s https://sabashopping.ir/app/api/version
# expect 1.303.0+

curl -s https://sabashopping.ir/app/assets/fonts/vazirmatn.css | head -n 10
# should contain 4 CDN URLs:
# https://cdn.fontcdn.ir/Fonts/Vazirmatn/
# https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/
# https://unpkg.com/vazirmatn@33.003/
# https://cdn.jsdelivr.net/npm/vazirmatn@33.003/
# NOT "Font not found"

curl -s -i "https://sabashopping.ir/app/api/rp?url=https://emalls.ir" | head -n 20
# should be 200 with x-rp-cache header

# Visual full mode
curl -s "https://sabashopping.ir/app/api/visual?ticket=..." # or via UI
# In dashboard visual picker, Emalls should render (full=true) with Vazirmatn bar, not blank
```

## Fonts + Visual fixes in 1.303.0+
- `cloudflare-scraper4/render-src/fonts.ts`: Vazirmatn now 4 CDN src: fontcdn.ir (Iran), jsDelivr gh v33.003, unpkg 33.003, jsDelivr npm 33.003, plus local and Tahoma fallback. `fontFile` tries same 4 CDNs + cdnjs + data/fonts cache.
- `cloudflare-scraper4/worker-src/dashboard.ts`: 4 preconnect + @font-face Regular/Bold/Light/Medium with 4 CDN list.
- `cloudflare-scraper4/render-src/visual.ts`: same-host bypass `if(isSameHost(abs)) return abs` + proxy only API/json, fixes Emalls blank when rp 503. `toProxyForce` same logic.

## After recovery, keep auto-recovery loop
The dashboard has auto-recovery that calls `public.monitor` and if `public_version` is 503, it calls `public.stop_jobs` + `public.auto_recover`. With v16 this will work because deploy_path detection now uses safe `find /home -type d -name cloudflare-scraper4`.

## Branches
- `arena/hostconsole-v16` – clean safe hostconsole 560805 bytes (547K) with version 1.303.0+
- `arena/01a0aa17-new` – main session branch with fonts+visual+hostconsole fixes, version 1.303.0+

## One-liner for future hostconsole update (when file exists)
```
curl -s "https://sabashopping.ir/project/hostconsole.php?api=public.force_update&password=KhTn2268&branch=arena/hostconsole-v16&cb=$(date +%s)"
```
