// Photo feedback loop. Basalam answered «422 fields:[photo] شناسهٔ تصویر الزامی است» for products
// of the برف‌باکس profile, and the panel blamed «this product has no image» even when the image URL
// was recorded and merely refused by the source CDN. Three causes, one misleading sentence.
// Everything here is offline: scripted sources and a scripted Basalam file service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
const temp = await mkdtemp(join(root, 'node_modules/.cache/photo-loop-'));
await build({ entryPoints: [join(root, 'worker-src/photo-loop.ts')], outfile: join(temp, 'photo.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const photo = await import(pathToFileURL(join(temp, 'photo.mjs')));
const read = file => readFile(join(root, file), 'utf8');

const IMAGE = { status: 200, contentType: 'image/jpeg', bytes: 48000, data: 'binary' };
const PRODUCT = { image: 'https://barfbox.example/img/p1.jpg', images: [], link: 'https://barfbox.example/p/1' };

function bag(initial = []) {
  const state = new Map(initial);
  return { state, getState: async (k, f) => (state.has(k) ? state.get(k) : f), setState: async (k, v) => void state.set(k, v) };
}

/** Scripted world: the source answers per download shape, Basalam answers per upload shape. */
function world({ source, files }) {
  const downloads = [], uploads = [];
  return {
    downloads, uploads,
    download: async (url, shape) => { downloads.push({ url, shape: shape.id, headers: shape.headers }); return source({ url, shape: shape.id }); },
    upload: async (url, shape, file) => { uploads.push({ url, shape: shape.id, file }); return files({ url, shape: shape.id, file }); }
  };
}

test('only usable image addresses become candidates', () => {
  assert.deepEqual(photo.photoCandidates({ image: 'https://a.ir/x.jpg', images: ['https://a.ir/x.jpg', 'https://a.ir/y.png'] }), ['https://a.ir/x.jpg', 'https://a.ir/y.png']);
  assert.deepEqual(photo.photoCandidates({ image: 'data:image/gif;base64,R0lGOD', images: ['/img/z.webp'], link: 'https://a.ir/p/5' }), ['https://a.ir/img/z.webp']);
  assert.deepEqual(photo.photoCandidates({ images: ['https://a.ir/logo.svg', 'https://a.ir/placeholder.png', 'https://a.ir/loading.gif'] }), []);
  assert.equal(photo.photoCandidates({ image: 'https://a.ir/1.jpg', images: ['https://a.ir/2.jpg', 'https://a.ir/3.jpg', 'https://a.ir/4.jpg'] }, 2).length, 2);
  assert.deepEqual(photo.photoCandidates({ images: ['../img/rel.jpg'] }), [], 'a relative URL without a product link cannot be resolved');
});

test('the happy path uploads the first candidate and learns both shapes', async () => {
  const io = bag(), w = world({ source: () => IMAGE, files: () => ({ status: 200, body: { id: 771 } }) });
  const report = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', referer: PRODUCT.link, limit: 1, ...w, getState: io.getState, setState: io.setState });
  assert.equal(report.ok, true);
  assert.deepEqual(report.ids, [771]);
  assert.equal(w.downloads.length, 1);
  assert.equal(w.uploads.length, 1);
  assert.equal(w.uploads[0].url, 'https://openapi.basalam.com/v1/files');
  assert.equal(io.state.get('photo.upload:basalam'), 'file+type');
  assert.equal(io.state.get('photo.download:barfbox.example'), 'plain');
});

test('a 403 image is re-asked as a browser with the product page as Referer', async () => {
  const w = world({
    source: ({ shape }) => (shape === 'plain' ? { status: 403, contentType: 'text/html' } : IMAGE),
    files: () => ({ status: 201, body: { data: { id: 9001 } } })
  });
  const io = bag();
  const report = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', referer: PRODUCT.link, ...w, getState: io.getState, setState: io.setState });
  assert.equal(report.ok, true);
  assert.deepEqual(report.ids, [9001], 'the id may arrive nested in data');
  assert.equal(w.downloads[1].shape, 'referer');
  assert.equal(w.downloads[1].headers.referer, PRODUCT.link);
  assert.equal(io.state.get('photo.download:barfbox.example'), 'referer', 'the winning disguise is remembered');
});

test('a hotlink-protected source is named as such instead of «this product has no image»', async () => {
  const w = world({ source: () => ({ status: 403, contentType: 'text/html', bytes: 900 }), files: () => ({ status: 200, body: { id: 1 } }) });
  const report = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', referer: PRODUCT.link, ...w });
  assert.equal(report.ok, false);
  assert.equal(report.cause, 'download-blocked');
  assert.equal(w.uploads.length, 0, 'nothing may be uploaded when nothing was downloaded');
  assert.equal(w.downloads.length, 3, 'all three disguises are tried before giving up');
  assert.match(report.advice, /هات‌لینک/);
  assert.ok(!/هیچ آدرس تصویری/.test(report.advice), 'a blocked download must not be reported as a missing image');
});

test('a product with no stored image says exactly that, and asks nothing', async () => {
  const w = world({ source: () => IMAGE, files: () => ({ status: 200, body: { id: 5 } }) });
  const report = await photo.runPhotoLoop({ image: '', images: [] }, { base: 'https://openapi.basalam.com/v1', ...w });
  assert.equal(report.cause, 'no-candidate');
  assert.equal(w.downloads.length + w.uploads.length, 0);
  assert.match(report.advice, /سلکتور تصویر/);
});

test('an upload 422 walks to the next multipart shape, 401 stops the loop at once', async () => {
  const w = world({ source: () => IMAGE, files: ({ shape }) => (shape === 'file+type' ? { status: 422, body: { message: 'file_type نامعتبر است' } } : { status: 200, body: { file: { id: 42 } } }) });
  const ok = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', ...w });
  assert.deepEqual(ok.ids, [42]);
  assert.deepEqual(w.uploads.map(u => u.shape), ['file+type', 'file']);

  const blocked = world({ source: () => IMAGE, files: () => ({ status: 401, body: { message: 'unauthenticated' } }) });
  const report = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', ...blocked });
  assert.equal(report.ok, false);
  assert.equal(report.cause, 'upload-auth');
  assert.equal(blocked.uploads.length, 1, 'a token problem is not re-asked with another shape');
  assert.match(report.advice, /دسترسی آپلود فایل/);
});

test('a dead image URL moves to the next candidate instead of retrying disguises', async () => {
  const product = { image: 'https://barfbox.example/img/gone.jpg', images: ['https://barfbox.example/img/ok.jpg'], link: PRODUCT.link };
  const w = world({
    source: ({ url }) => (url.includes('gone') ? { status: 404 } : IMAGE),
    files: () => ({ status: 200, body: { id: 12 } })
  });
  const report = await photo.runPhotoLoop(product, { base: 'https://openapi.basalam.com/v1', referer: product.link, limit: 1, ...w });
  assert.deepEqual(report.ids, [12]);
  assert.deepEqual(w.downloads.map(d => d.shape), ['plain', 'plain'], 'a 404 is about the address, not the disguise');
});

test('an HTML page served as an image never reaches Basalam', async () => {
  const w = world({ source: () => ({ status: 200, contentType: 'text/html; charset=utf-8', bytes: 4800 }), files: () => ({ status: 200, body: { id: 1 } }) });
  const report = await photo.runPhotoLoop(PRODUCT, { base: 'https://openapi.basalam.com/v1', ...w });
  assert.equal(w.uploads.length, 0);
  assert.equal(report.attempts.every(a => a.verdict === 'not-image'), true);
  assert.equal(report.ok, false);
});

test('ids are read from every shape Basalam has used, and verdicts stay Persian', () => {
  for (const body of [{ id: 3 }, { data: { id: 3 } }, { file: { id: 3 } }, { photo: { id: 3 } }, { result: { id: 3 } }, { data: { file: { id: 3 } } }]) {
    assert.equal(photo.readFileId(body), 3, JSON.stringify(body));
  }
  assert.equal(photo.readFileId({ id: 0 }), 0);
  assert.equal(photo.readFileId({}), 0);
  for (const [answer, verdict] of [[{ status: 413 }, 'too-large'], [{ status: 429 }, 'throttled'], [{ status: 503 }, 'server'], [{ status: 200, body: {} }, 'payload']]) {
    const result = photo.classifyUpload(answer);
    assert.equal(result.verdict, verdict);
    assert.ok(/[\u0600-\u06FF]/.test(result.note), result.note);
  }
  assert.match(photo.summarizePhotoAttempts([{ stage: 'download', shape: 'plain', status: 403, verdict: 'forbidden' }, { stage: 'upload', shape: 'file', status: 200, verdict: 'ok' }]), /⬇ plain → 403\/forbidden \| ⬆ file → 200\/ok/);
});

test('both syncs run the loop and refuse to create a photoless product blindly', async () => {
  for (const file of ['worker-src/sync.ts', 'render-src/sync.ts']) {
    const source = await read(file);
    assert.ok(source.includes('runPhotoLoop'), file + ' must drive the shared photo loop');
    assert.ok(source.includes('if(!existing&&!photoIds.length)throw new Error('), file + ' must stop a photoless create before the request');
    assert.ok(source.includes('summarizePhotoAttempts(photo.attempts)'), file + ' must report what was tried');
    assert.ok(!source.includes('lastPhotoFailure'), file + ' must not keep the old string-only failure note');
    assert.ok(source.includes('lastPhotoReport'), file + ' must keep the structured report for the 422 hint');
  }
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await read(file);
    assert.ok(source.includes('photoCandidates'), file + ' must expose photo readiness to the product modal');
  }
  const dashboard = await read('worker-src/dashboard.ts');
  assert.ok(dashboard.includes('function photoReadinessHtml(photos)'), 'the modal needs the readiness banner');
  assert.ok(dashboard.includes("renderPhotoReadiness(data&&data.photos)"), 'the banner must be filled from the destinations payload');
});

test('the readiness banner tells the three states apart', async () => {
  const { transform } = await import('esbuild');
  const { load } = await import('cheerio');
  const dashboard = await read('worker-src/dashboard.ts');
  const start = dashboard.indexOf('function photoReadinessHtml(photos)');
  const end = dashboard.indexOf('function renderPhotoReadiness(');
  const js = (await transform(dashboard.slice(start, end), { loader: 'ts' })).code;
  const { photoReadinessHtml } = new Function('fa', js + ';return {photoReadinessHtml};')(value => String(value));
  assert.equal(photoReadinessHtml(null), '');
  assert.match(load(photoReadinessHtml({ stored: 2, usable: 2 }))('.result-summary').attr('class'), /ok/);
  assert.match(load(photoReadinessHtml({ stored: 2, usable: 0 })).text(), /هیچ‌کدام قابل استفاده نیست/);
  assert.match(load(photoReadinessHtml({ stored: 0, usable: 0 })).text(), /هیچ آدرس تصویری ندارد/);
});
