import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');

/**
 * The worker sources are TypeScript, so for behavioural tests we compile the one
 * self-contained helper we care about down to plain JS and import it as a data
 * URL. This runs the real shipped implementation rather than a copy of it.
 */
async function loadNormalizer() {
  const utils = await read('../worker-src/utils.ts');
  const start = utils.indexOf('const PERSIAN_FOLD_MAP');
  assert.ok(start > -1, 'PERSIAN_FOLD_MAP must exist in worker-src/utils.ts');
  const js = utils
    .slice(start)
    .replace(/: Record<string,string>/g, '')
    .replace(/: unknown/g, '')
    .replace(/: string/g, '')
    .replace(/export function/g, 'export function');
  const mod = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  return mod.normalizePersianText;
}

test('v10.170 parity: Persian normalizer folds Arabic letter forms (suffixTextNormalize)', async () => {
  const normalize = await loadNormalizer();
  // Each pair used to normalize to two different strings, so the same product
  // was learned/deduplicated twice.
  const pairs = [
    ['مانتو نسويّة', 'مانتو نسویه'],
    ['أحمد إيران', 'احمد ایران'],
    ['مؤسسه', 'موسسه'],
    ['خانۀ ما', 'خانه ما'],
    ['كِتابٌ', 'کتاب'],
  ];
  for (const [input, expected] of pairs) {
    assert.equal(normalize(input), expected, `normalize(${JSON.stringify(input)})`);
  }
});

test('v10.170 parity: normalizer treats zero-width joiners and NBSP as separators', async () => {
  const normalize = await loadNormalizer();
  assert.equal(normalize('تست\u200dمتن'), 'تست متن');
  assert.equal(normalize('تست\u00a0متن'), 'تست متن');
  assert.equal(normalize('\ufeffتست متن '), 'تست متن');
});

test('v10.170 parity: normalizer maps Persian and Arabic digits to ASCII', async () => {
  const normalize = await loadNormalizer();
  assert.equal(normalize('قیمت ۱۲۳'), 'قیمت 123');
  assert.equal(normalize('قیمت ٤٥٦'), 'قیمت 456');
});

test('v10.170 parity: normalizer keeps distinct words distinct', async () => {
  const normalize = await loadNormalizer();
  // Guard against over-folding: these must NOT collapse into each other.
  assert.notEqual(normalize('مسئول'), normalize('مسلول'));
  assert.notEqual(normalize('کتاب'), normalize('کباب'));
});

test('v10.170 parity: every Persian text call site uses the shared normalizer', async () => {
  const files = [
    '../worker-src/ai.ts', '../worker-src/app.ts', '../worker-src/automation.ts',
    '../worker-src/db.ts', '../worker-src/dedup.ts', '../worker-src/maintenance.ts',
    '../render-src/automation.ts', '../render-src/db.ts', '../render-src/maintenance.ts',
  ];
  for (const file of files) {
    const source = await read(file);
    assert.match(source, /normalizePersianText/, `${file} must use the shared normalizer`);
    // The old ad-hoc folds only handled ي/ى/ك and silently missed ة/أ/إ/ؤ.
    assert.doesNotMatch(source, /replace\(\/\[يى\]\/g/, `${file} must not re-implement Persian folding`);
  }
});

test('v10.125 parity: watchdog stops auto-resuming a run that makes no progress', async () => {
  const background = await read('../worker-src/background.ts');

  assert.match(background, /AUTO_RESUME_MAX_TRIES\s*=\s*5/);
  assert.match(background, /AUTO_RESUME_WINDOW_MS\s*=\s*3_600_000/);
  // The watchdog must consult the counter and park the run instead of looping.
  assert.match(background, /tries\s*>=\s*AUTO_RESUME_MAX_TRIES[\s\S]{0,200}phase\s*=\s*'no-progress'/);
  // A human resume and a reset both clear the counter, so the run is retryable.
  assert.match(background, /clearAutoResumeAttempts\(run\.kind,run\.id\)/);
  assert.match(background, /clearAutoResumeAttempts\(kind,id\)/);
});

test('v10.125 parity: progress fingerprint ignores timestamps', async () => {
  const background = await read('../worker-src/background.ts');
  const start = background.indexOf('export function taskProgressSig');
  const body = background.slice(start, background.indexOf('\n}', start));
  assert.ok(start > -1, 'taskProgressSig must exist');
  // If the signature included updatedAt/createdAt every stalled attempt would
  // look like fresh progress and the cap could never fire.
  for (const forbidden of ['updatedAt', 'createdAt', 'startedAt', 'Date.now']) {
    assert.ok(!body.includes(forbidden), `taskProgressSig must not include ${forbidden}`);
  }
  assert.match(body, /cursor/);
  assert.match(body, /processed/);
});

/** Loads reconTable with the data-access layer stubbed, so the real logic runs. */
async function loadReconTable(local, remote) {
  const src = await read('../worker-src/maintenance.ts');
  const start = src.indexOf('/**\n * PHP scraper4 v10.170 parity: reconciliation');
  const end = src.indexOf("export async function recon(target:Target,profileId=''){");
  assert.ok(start > -1 && end > start, 'reconTable block must exist in worker-src/maintenance.ts');
  const utils = await read('../worker-src/utils.ts');
  const helpers = utils
    .slice(utils.indexOf('const PERSIAN_FOLD_MAP'))
    .replace(/: Record<string,string>/g, '').replace(/: unknown/g, '').replace(/: string/g, '');
  const block = src.slice(start, end)
    .replace(/export type ReconRow=\{[\s\S]*?\};\n/, '')
    .replace(/export type ReconTable=[^\n]*\n/, '')
    .replace(/:ReconRow\['bucket'\]/g, '').replace(/:ReconRow\['matchedBy'\]/g, '')
    .replace(/:ReconRow\[\]/g, '').replace(/<string,any\[\]>/g, '').replace(/<string,any>/g, '')
    .replace(/<number,any>/g, '').replace(/<any>/g, '')
    .replace(/\(value:unknown\)/g, '(value)').replace(/:number\|null=>/g, '=>')
    .replace(/export function reconNormTitle\(value:string\):string/, 'export function reconNormTitle(value)')
    .replace(/export async function reconTable\(target:Target,profileId=''\)/, 'export async function reconTable(target,profileId="")');
  const code = `
    const LOCAL=${JSON.stringify(local)},REMOTE=${JSON.stringify(remote)};
    const maintenanceRows=async()=>LOCAL;const remoteProducts=async()=>REMOTE;const setState=async()=>{};
    ${helpers}
    ${block}`;
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}

test('v10.170 parity: reconciliation table buckets every product exactly once', async () => {
  const local = [
    { profile_id: 'p1', source_key: 'a', title: 'گوشی سامسونگ', price: 1000, active: true, data: {}, remote_woo_id: 11 },
    { profile_id: 'p1', source_key: 'b', title: 'کفش ورزشی', price: 2000, active: true, data: {}, remote_woo_id: 12 },
    { profile_id: 'p1', source_key: 'c', title: 'مانتو نسويّة', price: 3000, active: true, data: {}, remote_woo_id: 0 },
    { profile_id: 'p1', source_key: 'd', title: 'محصول بدون قیمت', price: 0, active: true, data: {}, remote_woo_id: 14 },
    { profile_id: 'p1', source_key: 'e', title: 'فقط در مبدأ', price: 500, active: true, data: {}, remote_woo_id: 0 },
    { profile_id: 'p1', source_key: 'f', title: 'بازنشسته', price: 900, active: false, data: {}, remote_woo_id: 0 },
  ];
  const remote = [
    { id: 11, name: 'گوشی سامسونگ', price: 1000, status: 'publish', shopId: 's', shopName: 'S', sku: '' },
    { id: 12, name: 'کفش ورزشی', price: 2500, status: 'publish', shopId: 's', shopName: 'S', sku: '' },
    { id: 13, name: 'مانتو نسویه', price: 3000, status: 'publish', shopId: 's', shopName: 'S', sku: '' },
    { id: 14, name: 'محصول بدون قیمت', price: 777, status: 'publish', shopId: 's', shopName: 'S', sku: '' },
    { id: 99, name: 'محصول ناشناخته', price: 100, status: 'publish', shopId: 's', shopName: 'S', sku: '' },
  ];
  const { reconTable } = await loadReconTable(local, remote);
  const report = await reconTable('woo');

  assert.equal(report.matched, 2, 'identical products (one only matches after Arabic folding)');
  assert.equal(report.priceDiff, 1);
  assert.equal(report.extra, 1);
  assert.equal(report.missing, 1, 'retired products must not count as missing');
  assert.equal(report.noPrice, 1);
  assert.equal(report.inSync, false);
  // Every remote row plus every unmatched active local row, counted once.
  assert.equal(report.rows.length, remote.length + report.missing);

  const diff = report.rows.find(row => row.bucket === 'priceDiff');
  assert.equal(diff.remotePrice, 2500);
  assert.equal(diff.sourcePrice, 2000);
  assert.equal(diff.delta, 500);
  // The Arabic-spelling variant must land in matched, not in extra+missing.
  assert.ok(report.rows.some(row => row.bucket === 'matched' && row.title === 'مانتو نسويّة'));
});

test('v10.170 parity: a fully synced shop reports inSync with no discrepancies', async () => {
  const local = [{ profile_id: 'p1', source_key: 'a', title: 'کالا', price: 100, active: true, data: {}, remote_woo_id: 1 }];
  const remote = [{ id: 1, name: 'کالا', price: 100, status: 'publish', shopId: 's', shopName: 'S', sku: '' }];
  const { reconTable } = await loadReconTable(local, remote);
  const report = await reconTable('woo');
  assert.equal(report.inSync, true);
  assert.equal(report.matched, 1);
  assert.equal(report.priceDiff + report.extra + report.missing, 0);
});

test('v10.170 parity: recon title key strips product-code suffixes', async () => {
  const { reconNormTitle } = await loadReconTable([], []);
  assert.equal(reconNormTitle('گوشی سامسونگ (کد: ۱۲۳)'), 'گوشی سامسونگ');
  assert.equal(reconNormTitle('کفش  ورزشی - مدل A'), 'کفش ورزشی مدل a');
});

test('AI model test reports which setting is missing instead of a generic error', async () => {
  const ai = await read('../worker-src/ai.ts');
  // The old opaque message must be gone from every call site.
  assert.doesNotMatch(ai, /تنظیمات ارائه‌دهنده\/مدل کامل نیست/);
  assert.match(ai, /export function aiConfigProblem/);
  // Base URL, model and API key each get their own message.
  assert.match(ai, /Base URL/);
  assert.match(ai, /کلید API برای/);
  assert.match(ai, /هیچ مدلی انتخاب نشده/);
  // Unconfigured providers are skipped up-front rather than failing mid-request.
  assert.match(ai, /unconfiguredAiTestResult/);
  assert.match(ai, /phase:'configuration'/);
  // Local runtimes legitimately have no key.
  assert.match(ai, /isKeylessAiProvider/);
  const render = await read('../render-src/ai.ts');
  assert.doesNotMatch(render, /تنظیمات ارائه‌دهنده\/مدل کامل نیست/);
  assert.match(render, /aiConfigProblem/);
});

test('a provider without its own key falls back to the shared AI key', async () => {
  // Regression: the hamburger menu saves one shared Base URL + API key, but
  // aiProviders() returned the provider rows untouched, so a key entered there
  // was ignored and EVERY model failed with "the API key is not set" even though
  // the user had entered one.
  for (const path of ['../worker-src/ai.ts', '../render-src/ai.ts']) {
    const source = await read(path);
    assert.match(source, /function sharedKeyFitsProvider/, `${path} must offer the shared key to keyless providers`);
    // Only when the shared credential belongs to the same service.
    assert.match(source, /new URL\(String\(value\)\)\.host\.toLowerCase\(\)/, `${path} must compare hosts before borrowing a key`);
    assert.match(source, /if\(!String\(ai\?\.apiKey\|\|''\)\.trim\(\)\)return false;/, `${path} must not borrow an empty shared key`);
    // The helper is useless unless it is actually applied to the provider list.
    assert.match(source, /sharedKeyFitsProvider\(ai,provider\)/, `${path} must apply the fallback when building providers`);
  }
  // worker: the key fallback happens while mapping ai.providers.
  const worker = await read('../worker-src/ai.ts');
  const mapper = worker.slice(worker.indexOf('function providersFromAi'), worker.indexOf('export function providerKeys'));
  assert.match(mapper, /apiKey=String\(ai\.apiKey\)/, 'the worker must adopt the shared key for a keyless provider');
  assert.match(mapper, /baseUrl:String\(provider\.baseUrl\|\|''\)\.trim\(\)\|\|\(sharedKeyFitsProvider/, 'the worker must adopt the shared base URL too');
  // render: same fallback, applied where aiProviders() maps the rows.
  const render = await read('../render-src/ai.ts');
  const renderMap = render.slice(render.indexOf('export async function aiProviders'), render.indexOf('export function aiConfigProblem'));
  assert.match(renderMap, /apiKey:String\(provider\.apiKey\|\|''\)\.trim\(\)\|\|\(borrow/, 'the render server must adopt the shared key');

  // Execute the real rule rather than trusting the shape of the source.
  const source = await read('../worker-src/ai.ts');
  const body = source
    .slice(source.indexOf('function sharedKeyFitsProvider'), source.indexOf('function providersFromAi'))
    .replace(/\(ai:any,provider:any\)/, '(ai,provider)')
    .replace(/\(value:string\)/, '(value)')
    .replace(/:boolean/g, '');
  const fits = new Function(`${body}; return sharedKeyFitsProvider;`)();
  const shared = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-shared' };
  assert.equal(fits(shared, { baseUrl: 'https://openrouter.ai/api/v1' }), true, 'same host must borrow the shared key');
  assert.equal(fits(shared, { baseUrl: '' }), true, 'a provider with no base URL falls back to the shared service');
  assert.equal(fits(shared, { baseUrl: 'https://api.openai.com/v1' }), false, 'a key must never leak to a different provider');
  assert.equal(fits({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: '   ' }, { baseUrl: 'https://openrouter.ai/api/v1' }), false, 'a blank shared key is not a key');
});

test('importing an AI provider file keeps the API keys whatever they are called', async () => {
  // Regression: importAiFile only looked at apiKey / api_key / keyValue, so a
  // catalogue that stores the credential as key, token, apiToken, a nested
  // credentials object, or a separate id -> key map imported every provider
  // with an empty key. Testing the models then failed for all of them with
  // "the API key for X is not set".
  const dashboard = await read('../worker-src/dashboard.ts');
  assert.match(dashboard, /function aiImportKeyFrom/, 'the importer needs a tolerant key reader');
  assert.match(dashboard, /function aiImportKeyList/);
  assert.match(dashboard, /keyBook/, 'a separate keys map must be consulted');
  assert.doesNotMatch(dashboard, /\(p\.apiKey\|\|p\.api_key\|\|p\.keyValue\)\?\[/, 'the old three-name extraction must be gone');

  // Execute the real helpers rather than trusting the source shape.
  const body = dashboard
    .slice(dashboard.indexOf('function aiImportKeyFrom'), dashboard.indexOf('async function importAiFile'))
    .replace(/:\s*string/g, '');
  const { aiImportKeyFrom, aiImportKeyList } = new Function(`${body}; return { aiImportKeyFrom, aiImportKeyList };`)();

  assert.equal(aiImportKeyFrom({ apiKey: 'a' }), 'a');
  assert.equal(aiImportKeyFrom({ key: 'b' }), 'b');
  assert.equal(aiImportKeyFrom({ token: 'c' }), 'c');
  assert.equal(aiImportKeyFrom({ apiToken: 'd' }), 'd');
  assert.equal(aiImportKeyFrom({ credentials: { secret: 'e' } }), 'e', 'nested credentials must be read');
  assert.equal(aiImportKeyFrom({ authorization: 'Bearer f' }), 'f', 'a Bearer prefix must be stripped');
  assert.equal(aiImportKeyFrom({ apiKey: '   ' }), '', 'blank keys are not keys');
  assert.equal(aiImportKeyFrom({}), '');

  // A key held only in a side map still reaches the provider.
  assert.deepEqual(aiImportKeyList({ id: 'groq' }, 'gsk-from-map'), ['gsk-from-map']);
  // Existing multi-key vaults keep working.
  assert.deepEqual(aiImportKeyList({ apiKeys: ['k1', 'k2'] }, ''), ['k1', 'k2']);
});

test('the import report names providers that arrived without a key', async () => {
  const dashboard = await read('../worker-src/dashboard.ts');
  assert.match(dashboard, /const keyless=providers\.filter/, 'the importer must collect keyless providers');
  assert.match(dashboard, /missingKey:keyless\.length/, 'the report must carry the count');
  assert.match(dashboard, /missingKeyProviders:keyless/, 'the report must name them');
  assert.match(dashboard, /بدون کلید API وارد شد/, 'the summary must warn in Persian');
  // Local runtimes need no key, so they must not be reported as broken.
  assert.match(dashboard, /keyless=providers\.filter\(p=>!String\(p\.apiKey\|\|''\)\.trim\(\)&&!\/\(\^\|\\\/\\\/\)\(localhost/, 'localhost providers are exempt');
});
