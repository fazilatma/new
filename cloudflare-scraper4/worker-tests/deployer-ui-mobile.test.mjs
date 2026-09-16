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
