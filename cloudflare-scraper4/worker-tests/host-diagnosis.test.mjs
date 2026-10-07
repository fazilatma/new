// Host environment feedback loop. The same build shows Persian fonts and reads the source fine on
// a VPS and fails on shared hosting; the loop has to say WHY in Persian instead of leaving the user
// with "fonts are not applied" and "403". Everything here runs offline with scripted answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { load } from 'cheerio';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
const temp = await mkdtemp(join(root, 'node_modules/.cache/host-diagnosis-'));
await build({ entryPoints: [join(root, 'worker-src/host-diagnosis.ts')], outfile: join(temp, 'host.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const host = await import(pathToFileURL(join(temp, 'host.mjs')));
const read = file => readFile(join(root, file), 'utf8');

const CSS_OK = '@font-face{font-family:"Vazir";src:url("./vazir-400.woff2") format("woff2")}';
const HOST_PAGE = '<!doctype html><html><head><title>فروشگاه</title></head><body>سایت اصلی</body></html>';

/** Scripted hosting: every probe URL gets the answer this environment would really give. */
function environment(routes) {
  const asked = [];
  const probe = async (url) => {
    asked.push(url);
    for (const [match, answer] of routes) if (url.includes(match)) return typeof answer === 'function' ? answer(url) : answer;
    return { status: 0, error: 'no route' };
  };
  return { asked, probe };
}

const VPS = [
  ['/assets/fonts/vazir.css', { status: 200, contentType: 'text/css; charset=utf-8', body: CSS_OK, bytes: CSS_OK.length }],
  ['/assets/fonts/vazir-400.woff2', { status: 200, contentType: 'font/woff2', body: '', bytes: 92000 }],
  ['example.com/list', { status: 200, contentType: 'text/html', body: '<html>' + 'x'.repeat(4000) + '</html>', bytes: 4100 }]
];

test('a healthy root mount answers ok and asks no CDN or mirror question', async () => {
  const env = environment(VPS);
  const report = await host.runHostDiagnosis({
    runtime: 'node', version: '1.330.0+', requestUrl: 'https://vps.example.com/api/diag/host',
    sourceUrl: 'https://example.com/list', appearance: { font: 'vazir', fontSize: 'large', writable: true }, probe: env.probe
  });
  assert.equal(report.ok, true);
  assert.equal(report.mount.atRoot, true);
  assert.equal(report.mount.prefix, '');
  assert.equal(report.probes.filter(p => p.verdict === 'ok').length, 3);
  assert.ok(!env.asked.some(url => url.includes('allorigins')), 'a working source must not be mirrored');
  assert.ok(!env.asked.some(url => url.includes('jsdelivr')), 'a working font must not trigger CDN probes');
  assert.match(report.summary, /سالم/);
});

test('the mount prefix is read from the request path or from X-Forwarded-Prefix', () => {
  assert.deepEqual(host.readMount('https://sabashopping.ir/app/api/diag/host'), {
    origin: 'https://sabashopping.ir', prefix: '/app', publicBase: 'https://sabashopping.ir/app', atRoot: false, source: 'path'
  });
  assert.equal(host.readMount('https://x.ir/api/diag/host', '/app/').prefix, '/app');
  assert.equal(host.readMount('https://x.ir/api/diag/host', '/app/').source, 'header');
  assert.equal(host.readMount('https://x.ir/api/diag/host').atRoot, true);
  assert.equal(host.readMount('https://x.ir/api/diag/host', '/').atRoot, true);
});

test('an asset request that escapes a subfolder mount is named, not guessed', async () => {
  // Shared host: the panel lives under /app, the absolute /assets/... request hits the main site.
  const env = environment([['/assets/fonts/vazir.css', { status: 200, contentType: 'text/html; charset=utf-8', body: HOST_PAGE, bytes: HOST_PAGE.length }]]);
  const report = await host.runHostDiagnosis({
    runtime: 'node', version: '1.330.0+', requestUrl: 'https://sabashopping.ir/app/api/diag/host', probe: env.probe
  });
  const css = report.probes.find(p => p.id === 'font-css');
  assert.equal(css.verdict, 'wrong-type');
  assert.equal(css.url, 'https://sabashopping.ir/app/assets/fonts/vazir.css');
  const file = report.probes.find(p => p.id === 'font-file');
  assert.equal(file.verdict, 'skipped', 'no point asking for the file when the sheet never arrived');
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(line => line.includes('/app')), 'the subfolder must be named: ' + report.findings.join(' | '));
  assert.ok(report.advice.some(line => line.includes('assets/fonts')), report.advice.join(' | '));
});

test('a 502 on our own font file turns into CDN questions and an honest offline verdict', async () => {
  const env = environment([
    ['/assets/fonts/vazir.css', { status: 200, contentType: 'text/css', body: CSS_OK, bytes: CSS_OK.length }],
    ['/assets/fonts/vazir-400.woff2', { status: 502, contentType: 'text/plain', body: 'Font upstream 403', bytes: 17 }],
    ['fontcdn.ir', { status: 0, error: 'connect ETIMEDOUT' }],
    ['jsdelivr.net', { status: 0, error: 'connect ETIMEDOUT' }],
    ['unpkg.com', { status: 403, contentType: 'text/html', body: 'blocked', bytes: 7 }]
  ]);
  const report = await host.runHostDiagnosis({ runtime: 'node', version: '1.330.0+', requestUrl: 'https://host.ir/api/diag/host', probe: env.probe });
  assert.equal(report.probes.find(p => p.id === 'font-file').verdict, 'blocked');
  assert.equal(report.probes.filter(p => p.id.startsWith('cdn:')).length, 3);
  assert.ok(env.asked.some(url => url.includes('fontcdn.ir')));
  assert.ok(report.advice.some(line => line.includes('data/fonts') && line.includes('خروجی اینترنت')), report.advice.join(' | '));
});

test('one reachable CDN moves the blame off the network', async () => {
  const env = environment([
    ['/assets/fonts/vazir.css', { status: 200, contentType: 'text/css', body: CSS_OK, bytes: CSS_OK.length }],
    ['/assets/fonts/vazir-400.woff2', { status: 502, body: 'upstream', bytes: 8 }],
    ['fontcdn.ir', { status: 200, contentType: 'font/woff2', bytes: 80000 }],
    ['jsdelivr.net', { status: 403, bytes: 10 }],
    ['unpkg.com', { status: 403, bytes: 10 }]
  ]);
  const report = await host.runHostDiagnosis({ runtime: 'node', version: '1.330.0+', requestUrl: 'https://host.ir/api/diag/host', probe: env.probe });
  assert.ok(report.advice.some(line => line.includes('cdn.fontcdn.ir') && line.includes('مسیر سرو فونت')), report.advice.join(' | '));
});

test('a source 403 is followed by a mirror question and the answer picks the advice', async () => {
  const blocked = [
    ['/assets/fonts/vazir.css', { status: 200, contentType: 'text/css', body: CSS_OK, bytes: CSS_OK.length }],
    ['/assets/fonts/vazir-400.woff2', { status: 200, contentType: 'font/woff2', bytes: 92000 }],
    ['emalls.ir', { status: 403, contentType: 'text/html', body: 'forbidden', bytes: 9 }]
  ];
  const mirrored = await host.runHostDiagnosis({
    runtime: 'node', version: '1.330.0+', requestUrl: 'https://host.ir/api/diag/host', sourceUrl: 'https://emalls.ir/search',
    probe: environment([['allorigins', { status: 200, contentType: 'text/html', body: 'y'.repeat(9000), bytes: 9000 }], ...blocked]).probe
  });
  assert.equal(mirrored.probes.find(p => p.id === 'source').verdict, 'blocked');
  assert.equal(mirrored.probes.find(p => p.id === 'source-mirror').verdict, 'ok');
  assert.ok(mirrored.advice.some(line => line.includes('IP این هاست')), mirrored.advice.join(' | '));

  const dark = await host.runHostDiagnosis({
    runtime: 'node', version: '1.330.0+', requestUrl: 'https://host.ir/api/diag/host', sourceUrl: 'https://emalls.ir/search',
    probe: environment([['allorigins', { status: 0, error: 'getaddrinfo EAI_AGAIN' }], ...blocked]).probe
  });
  assert.equal(dark.probes.find(p => p.id === 'source-mirror').verdict, 'offline');
  assert.ok(dark.advice.some(line => line.includes('Worker') && line.includes('VPS')), dark.advice.join(' | '));
});

test('settings that cannot be written explain why the font choice keeps reverting', async () => {
  const report = await host.runHostDiagnosis({
    runtime: 'node', version: '1.330.0+', requestUrl: 'https://host.ir/api/diag/host',
    appearance: { font: 'shabnam', fontSize: 'large', writable: false, error: 'SQLITE_READONLY' }, probe: environment(VPS).probe
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(line => line.includes('SQLITE_READONLY')), report.findings.join(' | '));
  assert.ok(report.advice.some(line => line.includes('بارگذاری دوباره برمی‌گردد')), report.advice.join(' | '));
});

test('every verdict keeps its Persian sentence and never leaks a bare status code alone', () => {
  const cases = [
    ['font-css', { status: 404 }, 'missing'],
    ['font-css', { status: 200, contentType: 'text/html', body: HOST_PAGE }, 'wrong-type'],
    ['font-file', { status: 502 }, 'blocked'],
    ['font-file', { status: 200, contentType: 'font/woff2', bytes: 20 }, 'empty'],
    ['mirror-cdn', { status: 451 }, 'blocked'],
    ['source', { status: 429 }, 'blocked'],
    ['source', { status: 0, error: 'ECONNRESET' }, 'offline'],
    ['source', { status: 200, body: 'tiny', bytes: 4 }, 'empty']
  ];
  for (const [kind, answer, verdict] of cases) {
    const result = host.classifyProbe(kind, answer);
    assert.equal(result.verdict, verdict, kind + ' ' + JSON.stringify(answer));
    assert.ok(/[\u0600-\u06FF]/.test(result.note), 'the note must be Persian prose: ' + result.note);
  }
});

test('the font stylesheet addresses the woff2 relatively so a subfolder mount keeps working', async () => {
  for (const file of ['worker-src/fonts.ts', 'render-src/fonts.ts']) {
    const source = await read(file);
    assert.ok(source.includes('const local=`./${lower}-${weight}.woff2`;'), file + ' must point at the sibling file');
    assert.ok(!source.includes('`/assets/fonts/${lower}-${weight}.woff2`'), file + ' must not use an absolute asset URL');
  }
  const { fontStylesheet } = await import(pathToFileURL(join(root, 'worker-src/fonts.ts')).href).catch(() => ({}));
  void fontStylesheet; // the compiled check lives in storefront.test.mjs; here we pin the source
});

test('the panel asks for its own assets relatively and both runtimes expose the diagnosis', async () => {
  const dashboard = await read('worker-src/dashboard.ts');
  assert.ok(dashboard.includes('<link rel="stylesheet" href="assets/fonts/vazirmatn.css">'), 'Vazirmatn link must be relative');
  assert.ok(dashboard.includes('<link rel="stylesheet" href="assets/fonts/vazir.css">'), 'Vazir link must be relative');
  assert.ok(!/href="\/assets\/fonts/.test(dashboard), 'no absolute asset URL may survive in the page');
  assert.ok(dashboard.includes("if(typeof appearanceLiveApply==='function')appearanceLiveApply(el);"), 'appearance must be applied the moment it is picked');
  assert.ok(dashboard.includes("if(action==='host-diag')return await openHostDiagnosis();"), 'the diagnosis needs a button');
  for (const [file, route] of [['worker-src/app.ts', "app.get('/api/diag/host'"], ['render-src/server.ts', "app.get('/api/diag/host'"]]) {
    const source = await read(file);
    assert.ok(source.includes(route), file + ' must expose the host diagnosis');
    assert.ok(source.includes("runHostDiagnosis"), file + ' must drive the shared loop');
    assert.ok(source.includes("path.startsWith(base+'/assets/fonts/')"), file + ' must serve fonts under the scraper folder too');
  }
});

/** The panel side of the same loop: the report has to become a readable Persian table. */
async function compile(source, names, io = {}) {
  const js = (await transform(source.replaceAll('export ', ''), { loader: 'ts' })).code;
  return new Function(...Object.keys(io), js + ';return {' + names + '};')(...Object.values(io));
}

test('the panel turns the host report into a Persian table with the advice on top', async () => {
  const dashboard = await read('worker-src/dashboard.ts');
  const start = dashboard.indexOf('const HOST_VERDICTS=');
  const end = dashboard.indexOf('async function openHostDiagnosis(');
  assert.ok(start > 0 && end > start, 'the renderer must stay sliceable for the lab');
  const { hostDiagnosisHtml } = await compile(dashboard.slice(start, end), 'hostDiagnosisHtml', {
    esc: value => String(value == null ? '' : value), fa: value => String(Number(value || 0)), faVersion: value => String(value)
  });
  const html = hostDiagnosisHtml({
    ok: false, runtime: 'node', version: '1.330.0+', scraperPath: 'scraper',
    mount: { prefix: '/app', atRoot: false },
    appearance: { font: 'vazir', fontSize: 'large', writable: false },
    probes: [
      { id: 'font-css', label: 'شیت فونت وزیر', url: 'https://x.ir/app/assets/fonts/vazir.css', status: 200, bytes: 120, verdict: 'wrong-type', note: 'HTML برگشت' },
      { id: 'source', label: 'منبع (مستقیم)', url: 'https://emalls.ir/x', status: 403, bytes: 9, verdict: 'blocked', note: 'رد شد' }
    ],
    findings: ['برنامه در زیرپوشهٔ «/app» سرو می‌شود'],
    advice: ['پراکسی این هاست باید assets/fonts را هم بدهد'],
    summary: 'تعداد بررسی‌های ناموفق: 2 از 2'
  });
  const $ = load(html);
  assert.equal($('.result-summary').hasClass('bad'), true);
  assert.equal($('.result-table tbody tr').length, 2);
  assert.match($('.result-table tbody tr').eq(0).text(), /🔀 پاسخ نامربوط/);
  assert.match($('.result-table tbody tr').eq(1).text(), /⛔ مسدود/);
  assert.match($.text(), /پراکسی این هاست/);
  assert.match($.text(), /\/app/);
  assert.match($.text(), /ناموفق/, 'a failed settings write must be visible');
});
