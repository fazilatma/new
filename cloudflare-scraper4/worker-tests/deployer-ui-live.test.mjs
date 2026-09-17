// The 1.181.0+ redesign of the deployer page added a live status rail, an in-page text-size step,
// tab badges, a toast, log follow-up and two filters. Those are behaviours, not markup, so this
// file runs the page's own client script against a parsed DOM (linkedom, as the results-list test
// does) and checks what it does — against the payload shape /api/status really returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { parseHTML } = require_('linkedom');

const source = await readFile(new URL('../scripts/local-deployer-ui.mjs', import.meta.url), 'utf8');
const pageStart = source.indexOf('return String.raw`<!doctype html>');
assert.ok(pageStart > 0, 'the deployer must keep serving one inline template');
const page = source.slice(pageStart);
const scriptAt = page.indexOf('<script>');
const html = page.slice(page.indexOf('<!doctype html>'), scriptAt) + '</body></html>';
const rawScript = page.slice(scriptAt + 8, page.indexOf('</script>'));
assert.ok(rawScript.length > 2000, 'the client script must live in the same template as its markup');

const COMMANDS = {
  'Termux / Android': 'pkg update\nnpm run worker:deploy',
  'Windows PowerShell': 'npm run worker:deploy',
  'VPS (Ubuntu)': 'git pull\nnpm ci'
};

// The payload shape scripts/local-deployer-ui.mjs status() returns, trimmed to what the rail reads.
const STATUS = {
  ok: true,
  projectDir: '/home/user/new/cloudflare-scraper4',
  package: { name: 'scraper4-cloudflare', version: '1.181.0+' },
  code: { stale: true, running: '1.180.0+', onDisk: '1.181.0+' },
  node: process.version,
  autoUpdate: { enabled: true, intervalMs: 60000, running: false, last: null, autoInstallLatest: true },
  environment: { id: 'termux', label: 'Termux / Android', canInstallDatabase: true },
  libraries: [],
  branches: {
    enabled: true, scanning: false, intervalMs: 60000, autoInstallLatestEnabled: true,
    lastScanAt: new Date(Date.now() - 90_000).toISOString(), lastScanError: null, count: 2,
    latest: { name: 'arena/01a09468-new', version: '1.181.0' },
    current: { name: 'arena/01a0a647-new', version: '1.181.0+' }
  },
  database: {
    configured: true, method: 'sqlite', methodLabel: 'SQLite built-in (no Docker/PostgreSQL)',
    maskedUrl: 'sqlite:data/scraper4.sqlite', rawHasPlaceholder: false, instructions: ''
  },
  git: {
    branch: 'arena/01a0a647-new', commit: 'abc1234 Release 1.181.0+',
    dirty: ' M cloudflare-scraper4/worker-src/dashboard.ts\n?? scratch.txt', ok: true
  },
  files: { wrangler: true, packageLock: true, staticHtmlDeployer: true },
  jobs: [{ name: 'localBuild', running: true, ok: null, command: 'npm run render:build', log: 'building' }],
  scraper: {
    running: true, pid: 4242, port: 3000,
    serving: { stale: true, version: '1.180.0+', onDisk: '1.181.0+', head: 'aaaa111', diskHead: 'bbbb222' }
  }
};

const BRANCHES = {
  ok: true, cached: false, scanning: false, intervalMs: 60000, autoInstallLatestEnabled: true,
  lastScanAt: '2026-09-16T00:12:00.000Z', lastScanError: null,
  current: { branch: 'arena/01a0a647-new' },
  installed: { version: '1.181.0+' },
  latest: { name: 'arena/01a09468-new', version: '1.181.0' },
  repair: {}, origin: { present: true },
  branches: [
    { name: 'arena/01a0a647-new', version: '1.181.0+', sha: 'abc1234def5678', date: '2026-09-16', hasCode: true, status: 'newer', isCurrent: true },
    { name: 'arena/01a09468-new', version: '1.181.0', sha: '99998888777766', date: '2026-09-16', hasCode: true, status: 'equal', isCurrent: false },
    { name: 'main', version: '1.174.0', sha: '11112222333344', date: '2026-09-10', hasCode: true, status: 'older', isCurrent: false }
  ]
};

function boot() {
  const { window, document } = parseHTML(html);
  const store = {};
  const sandbox = {
    window,
    document,
    location: { hash: '', hostname: 'localhost', pathname: '/' },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); }
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    alert: () => { throw new Error('the deployer page must not use blocking dialogs'); },
    COMMANDS_FIXTURE: COMMANDS,
    fetch: async path => ({
      ok: true,
      status: 200,
      json: async () => String(path).includes('/api/branches') ? BRANCHES
        : String(path).includes('/api/libraries') ? { ok: true, groups: [], dynamic: false, environment: 'termux' }
        : String(path).includes('/api/py/status') ? { ok: true, status: { python: true, version: '3.11.2', hasBs4: true, hasLxml: true, hasRequests: true, scriptExists: true } }
        : { ...STATUS }
    })
  };
  // `${JSON.stringify(...)}` is resolved by the server; COMMANDS is swapped for a fixture so the
  // guide cards render, and the remaining interpolations collapse to numbers.
  const script = rawScript
    .replace(/\$\{JSON\.stringify\(commands\)\}/g, 'COMMANDS_FIXTURE')
    .replace(/\$\{JSON\.stringify\([^)]*\)\}/g, '{}')
    .replace(/\$\{[^}]*\}/g, '0');
  const exports_ = '{ updateRail, tickUpdated, refresh, renderGuides, renderBranchesData, filterGuides, toggleCmd, followLog, badge, toast, bumpFont, applyTextSize, logError, escHtml, renderResources, resourcePath, toggleResources }';
  const keys = Object.keys(sandbox);
  const api = new Function(...keys, script + '\nreturn ' + exports_ + ';')(...keys.map(key => sandbox[key]));
  return { window, document, api, store };
}

const text = (document, id) => (document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
const kind = (document, id) => (document.getElementById(id)?.className || '').replace('stat', '').trim();

test('rail: the header reads the real /api/status payload', () => {
  const { document, api } = boot();
  api.updateRail(STATUS);
  assert.match(text(document, 'railDb'), /SQLite built-in/, 'the database chip must name the method');
  assert.equal(kind(document, 'railDb'), 'ok');
  assert.match(text(document, 'railScraper'), /stale build on :3000/, 'the headline fact is a stale build, not "running"');
  assert.equal(kind(document, 'railScraper'), 'warn', 'a stale scraper is a warning, never green');
  assert.match(text(document, 'railGit'), /arena\/01a0a647-new/, 'the git chip must name the branch');
  assert.match(text(document, 'railGit'), /2 changed/, 'a dirty worktree is counted: that is exactly when auto-update refuses');
  assert.match(text(document, 'railBranch'), /arena\/01a09468-new v1\.181\.0/, 'the newest branch must be readable without opening the tab');
  assert.match(text(document, 'servingPill'), /running v1\.180\.0\+, disk has v1\.181\.0\+/, 'the Overview card must show the version drift');
  assert.match(text(document, 'scraperPill'), /pid 4242 · port 3000/);
  assert.match(text(document, 'branchPill'), /2 branches/, 'the scan summary must survive the redesign');
});

test('rail: a half-empty payload says unknown instead of a green dot', () => {
  const { document, api } = boot();
  api.updateRail({ ok: true, database: {}, git: {}, scraper: {}, branches: {}, code: {}, jobs: [] });
  assert.equal(text(document, 'railDb'), 'database missing', 'unknown has to be worded, not left blank');
  assert.equal(kind(document, 'railDb'), 'warn');
  assert.equal(text(document, 'railScraper'), 'scraper stopped');
  assert.equal(kind(document, 'railScraper'), 'bad');
  assert.equal(text(document, 'railBranch'), 'newest branch not scanned yet');
  assert.equal(kind(document, 'railBranch'), 'warn');
});

test('rail: the stamp counts seconds since the last successful refresh', async () => {
  const { document, api } = boot();
  assert.equal(text(document, 'updated'), 'not updated yet', 'before the first poll the page must not claim freshness');
  await api.refresh();
  api.tickUpdated();
  assert.match(text(document, 'updated'), /^updated \d+s ago$/, 'after one poll it must age in seconds');
});

test('badges: the tab that needs attention is marked, and the count travels with it', () => {
  const { document, api } = boot();
  api.updateRail(STATUS);
  const tab = id => document.querySelector('.tabs button[aria-controls="' + id + '"]');
  assert.ok(tab('scraper'), 'every panel must have a tab button to mark');
  assert.equal(text(document, 'badgeScraper'), '!', 'a stale scraper flags its own tab');
  assert.ok(tab('scraper').querySelector('.attn'), 'and shows a dot beside the label');
  assert.equal(text(document, 'badgeJobs'), 'running', 'a running job is visible from every tab');
  api.badge('scraper', 'live');
  assert.equal(tab('scraper').querySelector('.attn'), null, 'a healthy state removes the dot');
  api.badge('guide', String(Object.keys(COMMANDS).length));
  assert.equal(text(document, 'badgeGuide'), '3', 'counts are badges too, so a list is never silently empty');
});

test('text size: the stepper rescales the root, clamps, and persists', () => {
  const { document, api, store } = boot();
  assert.equal(document.documentElement.style.fontSize, '100%', 'the page starts at the browser default');
  api.bumpFont(1);
  assert.equal(document.documentElement.style.fontSize, '112.5%', 'one step must move rem/em/rem-based breakpoints together');
  assert.match(text(document, 'fontVal'), /112\.5%/);
  for (let i = 0; i < 4; i++) api.bumpFont(1);
  assert.equal(document.documentElement.style.fontSize, '137.5%', 'it must clamp at the top step');
  api.bumpFont(-1);
  assert.equal(document.documentElement.style.fontSize, '125%', 'and step back down');
  assert.equal(store['scraper4-deployer-text'], '2', 'the step has to survive a reload');
  api.applyTextSize(-99);
  assert.equal(document.documentElement.style.fontSize, '100%', 'and it clamps at the bottom too');
});

test('feedback: toasts and inline confirmations replace blocking dialogs', () => {
  const { document, api } = boot();
  api.toast('Rebuild queued', 'ok');
  const el = document.getElementById('toast');
  assert.ok(el.classList.contains('show'), 'the message must actually appear');
  assert.equal(el.querySelector('.msg').textContent, 'Rebuild queued');
  assert.equal(el.dataset.kind, 'ok');
  api.toast('quiet');
  assert.equal(el.dataset.kind, '', 'and the kind must not leak into the next message');
  api.logError(new Error('branch scan failed'));
  assert.equal(text(document, 'log'), 'UI/API error: branch scan failed', 'errors still land in the job log');
  assert.match(el.querySelector('.msg').textContent, /branch scan failed/, 'and always surface, whichever tab the user is on');
  assert.equal(el.dataset.kind, 'bad');
  assert.ok(!/[^.\w]alert\(|[^.\w]confirm\(/.test(rawScript), 'a stuck modal is unrecoverable at high zoom, so none may be used');
});

test('branches: filtering re-renders from the cached payload and admits an empty result', () => {
  const { document, api } = boot();
  api.renderBranchesData(BRANCHES, true);
  assert.equal(document.querySelectorAll('#branchRows tr').length, 3, 'unfiltered, every branch renders');
  assert.match(text(document, 'branchSummary'), /Newest version: 1\.181\.0 on branch arena\/01a09468-new/);
  assert.match(text(document, 'branchSummary'), /Auto-install newest: ON/);
  assert.equal(text(document, 'branchCount'), '3 branches');
  document.getElementById('branchFilter').value = 'main';
  api.renderBranchesData(BRANCHES, true);
  assert.equal(document.querySelectorAll('#branchRows tr').length, 1, 'typing narrows the list to the matches');
  assert.equal(text(document, 'branchCount'), '1 of 3 branches match', 'and the summary says so');
  const rowsText = document.getElementById('branchRows').textContent;
  assert.match(rowsText, /main/, 'the surviving row is the one whose name matches');
  assert.match(rowsText, /1\.174\.0/, 'and it carries the version of that branch, not of another');
  assert.ok(!rowsText.includes('99998888777766'), 'the rows that stopped matching are gone from the table, not just hidden');
  document.getElementById('branchFilter').value = 'nothing-matches-this';
  api.renderBranchesData(BRANCHES, true);
  assert.match(document.getElementById('branchRows').textContent, /No branch name or version contains/, 'an empty filter result must read as empty, not as a failure');
  document.getElementById('branchFilter').value = '';
  api.renderBranchesData(BRANCHES, true);
  assert.equal(document.querySelectorAll('#branchRows tr').length, 3, 'clearing the box restores the list');
});

test('guides: cards render, fold, count and filter without losing the copy targets', () => {
  const { document, api } = boot();
  api.renderGuides();
  const cards = document.querySelectorAll('#guideCards .guide-card');
  assert.equal(cards.length, Object.keys(COMMANDS).length, 'one card per environment');
  assert.equal(cards[0].querySelector('pre').id, 'cmd0', 'the copy handler must still find each script by id');
  assert.equal(cards[0].querySelector('pre').textContent, COMMANDS['Termux / Android'], 'and the script text must be there');
  assert.ok(cards[0].querySelector('.copy-ok'), 'the inline "Copied" slot must exist');
  assert.ok(cards[0].querySelector('.twist'), 'and a fold control');
  api.toggleCmd(cards[0].querySelector('.twist').closest('button') || cards[0].querySelector('.twist'));
  assert.ok(cards[0].classList.contains('tall'), 'tapping the fold must expand the script');
  api.toggleCmd(cards[0].querySelector('.twist').closest('button') || cards[0].querySelector('.twist'));
  assert.ok(!cards[0].classList.contains('tall'), 'and tap again folds it back');
  document.getElementById('guideFilter').value = 'termux';
  api.filterGuides();
  const hidden = Array.prototype.filter.call(cards, card => card.hidden).length;
  assert.equal(hidden, cards.length - 1, 'filtering hides the other environments');
  assert.equal(text(document, 'guideCount'), '1 of 3 environments match');
  document.getElementById('guideFilter').value = '';
  api.filterGuides();
  assert.equal(text(document, 'guideCount'), '3 environments', 'and clearing restores the count');
});

test('log: it follows its tail only while asked to', () => {
  const { document, api } = boot();
  const box = document.getElementById('log');
  let scrolls = 0;
  Object.defineProperty(box, 'scrollTop', {
    configurable: true,
    get() { return 0; },
    set() { scrolls++; }
  });
  const box2 = document.getElementById('logFollow');
  assert.ok(box2.hasAttribute('checked'), 'following starts on, which is what a running job needs');
  // linkedom does not reflect the checked attribute into the property, so drive the property.
  const setChecked = value => Object.defineProperty(box2, 'checked', { configurable: true, value });
  setChecked(true);
  api.followLog(box, false);
  assert.equal(scrolls, 1, 'ticked, a plain refresh scrolls the tail back down');
  setChecked(false);
  api.followLog(box, false);
  assert.equal(scrolls, 1, 'unticked, the log stays exactly where the reader left it');
  api.followLog(box, true);
  assert.equal(scrolls, 2, 'the forced path (just ticked, or a running job) scrolls it back down anyway');
  api.followLog(null, true);
  assert.equal(scrolls, 2, 'a missing box must be a no-op, not a thrown error inside the poll loop');
});

test('resource charts render real percentages, preserve gaps and label host/process scope',()=>{
 const {document,api}=boot();
 api.renderResources({platform:'linux',termux:true,samples:[{at:Date.now()-2000,cpuPercent:null,memory:null},{at:Date.now(),cpuPercent:25,memory:{percent:60,used:600,total:1000,source:'MemAvailable'},rss:100,processCpuPercent:150,containerMemory:null}]});
 assert.equal(text(document,'resourceCpu'),'25.0%');assert.equal(text(document,'resourceMemory'),'60.0%');
 assert.match(text(document,'resourceStatus'),/Termux/);assert.match(text(document,'resourceProcess'),/process only.*150.0%/);
 assert.equal(document.getElementById('resourceCpuPath').getAttribute('d').trim(),'M600.0 75.0');
 api.renderResources({samples:[{at:Date.now(),cpuPercent:null,memory:null,rss:123}]});
 assert.equal(text(document,'resourceCpu'),'Unavailable');assert.equal(document.getElementById('resourceCpuPath').getAttribute('d'),'');
 api.toggleResources();assert.equal(document.getElementById('resourcePause').getAttribute('aria-pressed'),'true');assert.equal(text(document,'resourceStatus'),'Charts paused');
});

test('scraper charts show independent CPU above 100 percent and RSS, with stopped gaps',()=>{
 const {document,api}=boot();
 api.renderResources({samples:[{at:Date.now(),cpuPercent:10,rss:1,memory:null,scraper:{status:'available',pid:42,cpuPercent:250,rss:1073741824}}]});
 assert.equal(text(document,'resourceScraperCpu'),'250.0%');assert.equal(text(document,'resourceScraperRam'),'1.00 GiB');
 assert.match(text(document,'resourceScraperCpuScale'),/250.0%/);assert.match(text(document,'resourceScraperStatus'),/PID 42/);
 api.renderResources({samples:[{at:Date.now(),scraper:{status:'unavailable',reason:'Scraper stopped',cpuPercent:null,rss:null}}]});
 assert.equal(text(document,'resourceScraperCpu'),'Unavailable');assert.equal(text(document,'resourceScraperStatus'),'Scraper stopped');
 assert.equal(document.getElementById('resourceScraperCpuPath').getAttribute('d'),'');
});
