// The deployer page is opened on phones (Termux users forward the port and read it in a phone
// browser) with the OS font slider at maximum and browser zoom far past 100%. The 1.178.0+
// redesign made that the primary layout instead of an afterthought, and this file is what keeps
// it that way: a stylesheet that sets type in px, or media queries measured in px, silently
// ignores text zoom, and a px-wide layout column overflows a 320px screen.
//
// Everything here reads the page the deployer actually serves (its template lives in one
// String.raw block) plus the client script that drives it, so a markup rewrite that drops an id
// the script queries fails here instead of in the field with dead buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/local-deployer-ui.mjs', import.meta.url), 'utf8');
const start = source.indexOf('return String.raw`<!doctype html>');
assert.ok(start > 0, 'the deployer must keep serving one inline template (no build step to hide behind)');
const page = source.slice(start);
const css = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>'));
const head = page.slice(0, page.indexOf('<style>'));
const body = page.slice(page.indexOf('</style></head><body>'), page.indexOf('<script>', start));
const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'));

const idsOf = text => new Set([...text.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));

test('deployer markup: every element the client script reaches for exists', () => {
  const inMarkup = idsOf(body);
  // Concatenated ids ($('copied' + i)) are created together with their markup, so only literal
  // lookups can be checked against the static page.
  const queried = [...script.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  assert.ok(queried.length >= 20, `the script must keep driving the page by id, saw ${queried.length}`);
  const missing = [...new Set(queried)].filter(id => !inMarkup.has(id));
  assert.deepEqual(missing, [], `ids the client script queries but the page never renders: ${missing.join(', ')}`);
});

test('deployer markup: all seven panels and their tabs survive a redesign', () => {
  const order = ['dash', 'database', 'scraper', 'guide', 'branches', 'jobs', 'pyextract'];
  const tabs = [...body.matchAll(/onclick="tab\('([a-z]+)',this\)"/g)].map(m => m[1]);
  // tabByIndex() and the #branches deep link address tabs positionally, so the order is load-bearing.
  assert.deepEqual(tabs, order, 'the tab strip must keep its panel order');
  for (const id of order) {
    assert.match(body, new RegExp(`<div id="${id}" class="panel( active)?" role="tabpanel">`), `${id} must stay a tabpanel`);
  }
  assert.equal((body.match(/aria-selected="true"/g) || []).length, 1, 'exactly one tab may start selected');
  assert.ok((body.match(/aria-live="polite"/g) || []).length >= 6,
    'async output slots (status, logs, banners) must announce themselves');
});

test('deployer stylesheet zooms: type, spacing and breakpoints never use px', () => {
  assert.ok(!/font(-size)?:\s*[\d.]+px/.test(css), 'font sizes in px do not follow the OS font slider or browser zoom');
  assert.ok(!/(?:max-width|min-width):\s*[\d.]+px/.test(css), 'px media queries measure the window, not the text');
  assert.ok(!/[^-a-z](?:width|padding|margin|gap|row-gap|column-gap|line-height|inset):\s*(?!0\b|auto\b)[\d.]+px/.test(css),
    'layout lengths must be rem/em so a zoomed page keeps its proportions (1px hairlines and shadows are fine)');
  assert.match(css, /-webkit-text-size-adjust:100%|text-size-adjust:100%/, 'mobile browsers must not inflate text on their own');
  assert.match(css, /--tap:2\.7rem|--tap:2\.[5-9]\d*rem/, 'tap targets need a shared minimum height (44px is the floor)');
  assert.equal((css.match(/env\(safe-area-inset/g) || []).length >= 3, true, 'notch and gesture-bar insets are required');
  assert.match(head, /viewport-fit=cover/, 'viewport-fit=cover is what makes the safe-area insets real');
});

test('deployer stylesheet: grids cannot create a horizontal scrollbar', () => {
  assert.ok((css.match(/minmax\(min\(100%,/g) || []).length >= 3,
    'each auto-fit grid needs minmax(min(100%,X),1fr) so one narrow column is never wider than the screen');
  assert.ok((css.match(/minmax\(0,/g) || []).length >= 4, 'flex/grid children need min-width:0 to be allowed to shrink');
  assert.match(css, /pre\{[^}]*overflow-wrap:anywhere/, 'long paths and URLs must wrap inside code blocks');
  assert.match(css, /max-height:max\(14rem/, 'a log box capped in vh alone shrinks to a few lines once the page is zoomed');
});

test('deployer markup: tables read as cards on a narrow screen', () => {
  const stacked = css.slice(css.indexOf('@media(max-width:47em)'));
  assert.ok(stacked.length > 40, 'the narrow-screen block must exist');
  assert.match(stacked, /\.tbl[^{]*\{display:block/, 'the table must stop being a table sideways');
  assert.match(stacked, /content:attr\(data-label\)/, 'stacked cells are meaningless without their column name');
  assert.match(script, /data-label="Branch"/, 'the branch rows must label themselves');
  assert.match(script, /data-label="Title"/, 'the python extract results must label themselves');
});

test('deployer markup: one-hand use on a phone', () => {
  assert.match(body, /<nav class="dock"/, 'the primary actions belong at the thumb edge, not after 400 lines of scroll');
  assert.match(body, /class="skip" href="#main"/, 'keyboard and screen-reader users get a skip link');
  assert.match(body, /<noscript>/, 'a page whose every button calls an API must say so without JavaScript');
  assert.match(css, /\.dock\{position:fixed/, 'the action bar must be pinned');
  assert.match(css, /@media\(min-width:62em\)\{\.dock\{display:none\}\}/, 'and must not steal space on a desktop');
  assert.match(css, /@media\(max-width:61\.99em\)\{body\{padding-bottom:8\.5rem\}\}/, 'content must not hide behind the pinned bar');
});

test('deployer markup: the palette follows the system and the user, never fights them', () => {
  assert.match(css, /@media\(prefers-color-scheme:light\)\{:root:not\(\[data-theme=dark\]\)/,
    'light mode must be automatic unless the user overrode it');
  assert.match(css, /:root\[data-theme=light\]/, 'and an explicit override must win both ways');
  assert.match(css, /color-scheme:dark/, 'the root must still declare a default color-scheme for form controls');
  assert.match(head, /name="color-scheme" content="dark light"/, 'so native widgets match the page');
  assert.match(body, /id="themeBtn" onclick="toggleTheme\(\)"/, 'a phone in sunlight needs the switch at the top of the page');
  assert.match(script, /scraper4-deployer-theme/, 'the choice must persist across reloads');
  assert.ok(!/style="[^"]*color:/.test(body), 'no inline colors, or the light palette cannot be complete');
});

test('deployer markup: long explanations are collapsed, the actions are not', () => {
  const notes = [...body.matchAll(/<details class="note"><summary>([^<]+)<\/summary>/g)].map(m => m[1]);
  assert.ok(notes.length >= 4, `the reading material must be behind a tap, saw ${notes.length} notes`);
  assert.match(body, /LOCAL_SCRAPER_PROXY_WAIT_MS[\s\S]{0,80}180000/, 'the slow-device knob stays documented inside its note');
  assert.match(body, /no token needed, and it stays up after you close this page/, 'the two facts a first-timer needs stay visible');
  for (const label of ['Build &amp; start local scraper', 'Install / retry npm', 'Install / connect database', 'Update from GitHub']) {
    assert.ok(body.includes(label), `primary action "${label}" must stay outside any collapse`);
  }
});

// 1.181.0+ made the same page comfortable at a distance: a status rail that is always true, a
// text-size step for the one notch the OS slider does not give, badges that count the panels,
// skeletons while data loads, toasts instead of dialogs, filters for the two long lists, folded
// command blocks, and polling that pauses when the tab is hidden. All of it is additive: the ids,
// handlers, /api routes and the token flow pinned above are untouched, and the behaviour itself is
// exercised against a live DOM in worker-tests/deployer-ui-live.test.mjs.

test('deployer markup: the status rail is part of the page, not of a tab', () => {
  assert.match(body, /<div class="rail" id="rail">/,
    'the rail sits in the header, above the tabs, so it is true whichever tab is open');
  assert.ok(!/<div class="rail" id="rail"[^>]*aria-live/.test(body),
    'and it is deliberately not a live region: four chips rewritten every five seconds is noise, not news');
  for (const chip of ['railDb', 'railScraper', 'railGit', 'railBranch']) {
    assert.match(body, new RegExp(`<span class="stat" id="${chip}"><span class="dot"></span>`),
      `${chip} must ship a neutral dot, so the first paint claims nothing`);
    assert.match(body, new RegExp(`id="${chip}"><span class="dot"></span>[^<]*<b>checking…</b>`),
      `${chip} must say it is checking, not show a stale value`);
  }
  assert.match(body, /<span class="upd" id="updated">not updated yet<\/span>/,
    'before the first poll the page must not imply freshness');
  assert.match(css, /\.rail\{display:flex;flex-wrap:wrap/, 'the chips wrap onto a second line instead of scrolling sideways');
  assert.match(css, /\.stat\{[^}]*min-width:0/, 'and each chip can shrink below its content, or a long branch name overflows');
  assert.match(css, /\.stat b\{font-weight:720;overflow-wrap:anywhere\}/, 'values break mid-word rather than push the page wide');
  assert.match(css, /\.stat\.ok\{border-color:color-mix\(in srgb,var\(--ok\)/, 'green means verified, and is its own state');
  assert.match(css, /\.stat\.warn\{border-color:color-mix\(in srgb,var\(--warn\)/);
  assert.match(css, /\.dot\.bad\{background:var\(--bad\)/, 'updateRail calls the third state "bad", the rest of the page "err" — both must be red');
  assert.match(script, /function updateRail\(d\) \{[\s\S]*?statChip\('railDb'/, 'the rail is filled from the /api/status payload');
  assert.match(script, /updateRail\(d\);\n\s*lastRefreshAt = Date\.now\(\);\n\s*tickUpdated\(\);/,
    'refresh() must update the rail and its age stamp together, or "updated 3s ago" is a lie');
  assert.match(script, /code\.running \|\| \(d\.package && d\.package\.version\)/,
    'a thin status payload must degrade, not throw inside the poll loop');
});

test('deployer markup: text size is a control on the page, in percent, never px', () => {
  assert.match(body, /<span class="stepper" role="group" aria-label="Text size">/, 'the step must read as one control');
  assert.match(body, /onclick="bumpFont\(-1\)" title="Smaller text" aria-label="Smaller text">A−<\/button>/,
    '"A−" is not an accessible name, so the button carries one');
  assert.match(body, /onclick="bumpFont\(1\)" title="Larger text" aria-label="Larger text">A\+<\/button>/);
  assert.match(body, /<span class="val" id="fontVal" role="status">100%<\/span>/,
    'the current step is shown where it is changed, and announced');
  assert.match(script, /const TEXT_STEPS = \[100, 112\.5, 125, 137\.5\];/,
    'four notches: enough for a phone already at maximum OS text, short enough to find the right one');
  assert.match(script, /document\.documentElement\.style\.fontSize = TEXT_STEPS\[textStep\] \+ '%'/,
    'it scales the root in percent, so rem/em type, padding, tap targets and the em breakpoints move together');
  assert.match(script, /const TEXT_KEY = 'scraper4-deployer-text';/, 'the step must be remembered across reloads');
  assert.match(script, /function bumpFont\(delta\) \{ applyTextSize\(textStep \+ \(delta > 0 \? 1 : -1\)\); toast\(/,
    'stepping confirms in the toast as well as in the label');
  assert.match(css, /\.stepper button\{[^}]*min-height:var\(--tap\)/, 'even the compact header control keeps the tap minimum');
  assert.ok(!/\bfont-size:\s*[\d.]+px/.test(css) && !/\bfont:\s*[\d.]+px/.test(css), 'nothing in this page may set type in px');
});

test('deployer markup: badges count the panels that can be empty', () => {
  const badgeIds = [...body.matchAll(/<span class="badge" id="(badge[A-Za-z]+)"><\/span>/g)].map(m => m[1]);
  assert.deepEqual(badgeIds, ['badgeScraper', 'badgeGuide', 'badgeBranches', 'badgeJobs'],
    'one badge per list-carrying tab; Overview and Database report through the rail instead');
  assert.match(css, /\.tabs \.badge\{[^}]*min-width:1\.4rem[^}]*font-variant-numeric:tabular-nums/, 'a badge must not jiggle when the count changes');
  assert.match(css, /\.tabs button\.active \.badge\{background:/, 'and stay readable on the selected tab');
  assert.match(css, /\.tabs \.attn\{width:\.45rem;height:\.45rem[^}]*background:var\(--bad\)/, 'the attention dot is colour plus shape, not colour alone');
  assert.match(script, /badge\('scraper', scraper\.running \? \(serving\.stale \? '!' : 'live'\) : ''\)/,
    'the scraper tab flags exactly one thing: a stale build serving localhost');
  assert.match(script, /badge\('branches', String\(all\.length\)\)/, 'the branch list carries its length');
  assert.match(script, /badge\('guide', String\(names\.length\)\)/, 'so does the command guide');
  assert.match(script, /function badge\(panelId, text\) \{[\s\S]*?tabBtn\.appendChild\(dot\);[\s\S]*?tabBtn\.querySelector\('\.attn'\)\.remove\(\);/,
    'the dot is added and removed by the same call that sets the text, so it can never outlive the state');
});

test('deployer markup: loading, empty and error states are designed, not absent', () => {
  assert.match(body, /<div class="metric skel">/, 'the metric tiles start skeletoned, so a slow first poll reads as loading');
  assert.match(body, /<div class="lib-card skel"><h3>Loading<\/h3>/, 'same for the library grid');
  const skelBlocks = [...body.matchAll(/<div class="[^"]*\bskel\b[^"]*">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.ok(skelBlocks.length >= 6, `the first paint must be skeletoned where the data lands, saw ${skelBlocks.length}`);
  assert.ok(!skelBlocks.some(block => /<button|<input|<a /.test(block)),
    'a skeleton must not offer a control the data has not earned yet');
  assert.match(css, /@keyframes shimmer\{/, 'a shimmer marks waiting; a spinner would imply an action is running');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.skel::after\{animation:none\}/, 'and it stops for people who asked it to');
  assert.match(body, /<output class="toast" id="toast" aria-live="polite">/,
    'feedback is a polite toast, never a dialog; output is the element for a status message');
  assert.match(css, /\.toast\{[^}]*bottom:calc\(\.7rem \+ env\(safe-area-inset-bottom\)\)/, 'it clears the gesture bar on a phone');
  assert.match(css, /\.toast\.show\{opacity:1;transform:translate\(-50%,0\)\}/, 'and is fully off the edge when hidden');
  assert.match(css, /\.toast\[data-kind=bad\]\{border-color:color-mix\(in srgb,var\(--bad\)/, 'an error toast is marked as one');
  assert.match(script, /const logError = err => \{[\s\S]*?toast\(msg, 'bad'\);/, 'an error surfaces even when its own panel is hidden');
});

test('deployer markup: both long lists are filterable and foldable', () => {
  for (const id of ['branchFilter', 'guideFilter']) {
    assert.match(body, new RegExp(`<input id="${id}" type="text"[^>]*dir="ltr"[^>]*aria-label="`),
      `${id} must be a labelled search field, ltr even under an rtl shell`);
    assert.match(script, new RegExp(`\\$\\('${id}'\\)\\?\\.addEventListener\\('input'`), `${id} must actually be wired`);
  }
  assert.match(script, /\$\('guideFilter'\)\?\.addEventListener\('input', filterGuides\);/,
    'the environment filter was wired in review: a search box that filters nothing is worse than none');
  assert.match(script, /\$\('branchFilter'\)\?\.addEventListener\('input', function \(\) \{ if \(lastBranchPayload\) renderBranchesData\(lastBranchPayload, true\); \}\);/,
    'branch filtering re-renders from the cached payload, so it costs no request');
  assert.match(body, /<span class="small" id="branchCount"><\/span>/, 'the branch list states how many rows it shows');
  assert.match(body, /<span class="small" id="guideCount"><\/span>/, 'so does the guide list');
  assert.match(script, /card\.hidden = !hit;[\s\S]*?of ' \+ cards\.length \+ ' environments match/,
    'filtering hides cards and reports the fraction instead of looking broken');
  assert.match(script, /list\.length \+ ' of ' \+ all\.length \+ ' branches match'/);
  assert.match(script, /No branch name or version contains/, 'an empty result must be worded as empty, not as a failure');
  assert.match(css, /\.tbl tr\[hidden\],\.guide-card\[hidden\]\{display:none\}/,
    'the UA hidden rule loses to display:grid, so it has to be restated or the filter does nothing');
  assert.match(script, /function toggleCmd\(btn\) \{[\s\S]*?card\.classList\.toggle\('tall'\)/, 'every long script starts folded');
  assert.match(css, /\.guide-card pre\{max-height:max\(9rem,34vh\)/, 'folded means a third of a screen, not one line');
  assert.match(css, /\.guide-card\.tall pre\{max-height:none\}/);
  assert.match(css, /\.guide-card \.twist\{display:inline-block/, 'with a visible fold control');
});

test('deployer markup: polling is polite about the phone it runs on', () => {
  assert.match(script, /setInterval\(function \(\) \{ if \(!document\.hidden\) refresh\(\); \}, 5000\);/,
    'a backgrounded tab must not keep repainting on a metered connection');
  assert.match(script, /window\.addEventListener\('focus', function \(\) \{ refresh\(\); \}\);/,
    'and the rail must be true the moment the tab is looked at');
  assert.match(script, /setInterval\(tickUpdated, 1000\);/, 'the age stamp ticks on its own, between polls');
  assert.match(script, /function tickUpdated\(\) \{[\s\S]*?'updated ' \+ Math\.max\(0, Math\.round\(\(Date\.now\(\) - lastRefreshAt\) \/ 1000\)\) \+ 's ago'/,
    'it counts real seconds and never goes negative');
  assert.match(body, /<input type="checkbox" id="logFollow" checked>/, 'the log follows its tail by default, which is what a running job needs');
  assert.match(script, /function followLog\(el, force\) \{\n  if \(!el\) return;\n  if \(!force\) \{\n    const cb = \$\('logFollow'\);\n    if \(cb && !cb\.checked\) return;/,
    'the shared helper refuses to scroll unless the box is ticked, so reading backwards is possible');
  assert.match(script, /if \(job\) \$\('log'\)\.textContent = [^\n]+\n    followLog\(\$\('log'\), false\);/,
    'and the job log paints through it on every poll');
  assert.match(script, /followLog\(\$\('scraperLog'\), Boolean\(d\.scraper\?\.running\)\);/,
    'the scraper log forces follow while the process is running, because a live tail is the point');
});

test('deployer markup: the off switches accept the words people actually type', async () => {
  // Both auto-updaters rewrite files in the working tree, so "I turned them off" has to mean 0, no,
  // off as well as false. Only `false` used to work in each of them, and neither was pinned — which
  // is how the Node one quietly reverted during the 1.182.0+ rebase onto the production branch.
  const serverSource = await readFile(new URL('../render-src/server.ts', import.meta.url), 'utf8');
  const pair = "const localScraperAutoUpdate = !/^(?:false|0|no|off)$/i.test(String(process.env.LOCAL_SCRAPER_AUTO_UPDATE ?? 'true').trim()) && process.env.RENDER !== 'true';";
  assert.ok(serverSource.includes(pair), 'the Node scraper auto-update must honour 0 / no / off');
  assert.ok(source.includes("const autoUpdateEnabled = !/^(?:false|0|no|off)$/i.test(String(startupEnv.LOCAL_DEPLOYER_AUTO_UPDATE ?? 'true').trim());"),
    'the deployer branch scanner must honour the same words');
  assert.match(source, /LOCAL_DEPLOYER_AUTO_UPDATE=false\s+disable the automatic branch scanner/,
    'and the documented value has to stay what the printed guide shows');
});

test('deployer markup: nothing on the first paint claims a state it has not read', () => {
  // The pills are filled by the first refresh(), so their static text must be a question, not an
  // answer - otherwise a page that never reaches the API still looks healthy.
  assert.match(body, /id="autoPill" aria-live="polite">Auto-update: checking…<\/span>/,
    'the auto-update pill must not open by promising it is on');
  assert.match(body, /id="servingPill">serving: checking…<\/span>/, 'same for the serving pill');
  for (const chip of ['railDb', 'railScraper', 'railGit', 'railBranch']) {
    assert.match(body, new RegExp(`id="${chip}">[\\s\\S]{0,80}?<b>checking…</b>`), `${chip} must start unknown`);
  }
  assert.match(script, /if \(autoPill\) autoPill\.textContent = 'Auto-update: '/, 'and one line owns that text afterwards');
});
