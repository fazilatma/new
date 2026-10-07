// Host repair loop: the second half of the host diagnosis. The shared host that started this
// (fonts not applied, size control dead, source 403 — all healthy on the VPS) failed in ways that
// are settings of this app, so the probe answers must end in an applied change and a SECOND round
// of probes that proves whether it helped. Offline: every diagnosis here is a hand-written answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
const temp = await mkdtemp(join(root, 'node_modules/.cache/host-repair-'));
const bundle = async (entry, name) => {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, name), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, name)));
};
const repair = await bundle('worker-src/host-repair.ts', 'repair.mjs');
const fonts = await bundle('worker-src/fonts.ts', 'fonts.mjs');
const read = file => readFile(join(root, file), 'utf8');

const probe = (id, verdict, note = '') => ({ id, label: id, url: 'https://x/' + id, status: verdict === 'ok' ? 200 : 502, contentType: '', bytes: 0, verdict, note });

function diagnosis(probes, extra = {}) {
  return {
    ok: probes.every(p => p.verdict === 'ok' || p.verdict === 'skipped'),
    runtime: 'node', version: '1.332.0+',
    mount: { origin: 'https://sabashopping.example', prefix: '/app', publicBase: 'https://sabashopping.example/app', atRoot: false, source: 'path' },
    scraperPath: 'scraper',
    appearance: { font: 'vazir', fontSize: 'medium', writable: true, error: '', ...(extra.appearance || {}) },
    probes, findings: [], advice: [], summary: ''
  };
}

const FONT_DEAD = [probe('font-css', 'wrong-type', 'به‌جای CSS، صفحهٔ HTML برگشت'), probe('font-file', 'skipped'), probe('source', 'ok')];
const FONT_OK = [probe('font-css', 'ok'), probe('font-file', 'ok'), probe('source', 'ok')];

test('writePath never mutates the settings it was given', () => {
  const before = { appearance: { font: 'vazir' }, source: { mirrors: false } };
  const after = repair.writePath(before, 'appearance.fontDelivery', 'cdn');
  assert.equal(before.appearance.fontDelivery, undefined, 'the original object must stay untouched');
  assert.equal(after.appearance.fontDelivery, 'cdn');
  assert.equal(after.appearance.font, 'vazir', 'siblings survive');
  assert.equal(after.source.mirrors, false, 'other branches survive');
  assert.equal(repair.readPath(after, 'appearance.fontDelivery'), 'cdn');
  assert.equal(repair.writePath(undefined, 'a.b', 1).a.b, 1, 'an empty settings object is still writable');
});

test('a font route that escapes the mount is answered by switching to CDN delivery', () => {
  const plan = repair.planHostRepair(diagnosis(FONT_DEAD), { appearance: { font: 'vazir' } });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 'font-cdn');
  assert.equal(plan[0].path, 'appearance.fontDelivery');
  assert.equal(plan[0].to, 'cdn');
  assert.match(plan[0].why, /مرورگر/, 'the reason says who fetches the font instead');
});

test('a blocked font proxy with open CDNs is still answered by CDN delivery', () => {
  const probes = [probe('font-css', 'ok'), probe('font-file', 'blocked', 'سرور نتوانست فایل را بیاورد (۵۰۲)'), probe('cdn:cdn.fontcdn.ir', 'ok'), probe('source', 'ok')];
  const plan = repair.planHostRepair(diagnosis(probes), {});
  assert.deepEqual(plan.map(s => s.id), ['font-cdn']);
  assert.match(plan[0].why, /فایل فونت/);
});

test('when no CDN answers the server either, the honest repair is the system font', () => {
  const probes = [probe('font-css', 'ok'), probe('font-file', 'blocked'), probe('cdn:a', 'blocked'), probe('cdn:b', 'offline'), probe('source', 'ok')];
  const plan = repair.planHostRepair(diagnosis(probes), { appearance: { font: 'vazir', fontDelivery: 'cdn' } });
  assert.deepEqual(plan.map(s => s.id), ['font-system']);
  assert.equal(plan[0].to, 'system');
  // and once the environment is healthy again the loop walks back to same-origin delivery
  const back = repair.planHostRepair(diagnosis(FONT_OK), { appearance: { font: 'vazir', fontDelivery: 'cdn' } });
  assert.deepEqual(back.map(s => s.id), ['font-local-restore']);
  assert.equal(back[0].to, 'local');
});

test('a 403 source with a working mirror turns the mirror switch on, but only when it is off', () => {
  const probes = [...FONT_OK.slice(0, 2), probe('source', 'blocked', 'منبع درخواست این سرور را رد کرد (۴۰۳)'), probe('source-mirror', 'ok')];
  const off = repair.planHostRepair(diagnosis(probes), { source: { mirrors: false } });
  assert.deepEqual(off.map(s => s.id), ['mirrors-on']);
  assert.equal(off[0].to, 'true');
  assert.deepEqual(repair.planHostRepair(diagnosis(probes), { source: {} }), [], 'mirrors are on by default, so nothing to change');
  const noMirror = [...FONT_OK.slice(0, 2), probe('source', 'blocked'), probe('source-mirror', 'blocked')];
  assert.deepEqual(repair.planHostRepair(diagnosis(noMirror), { source: { mirrors: false } }), [], 'a mirror that also failed proves nothing');
});

test('applying writes the settings once and re-asks the very same questions', async () => {
  const saved = [];
  const report = await repair.applyHostRepair({
    diagnosis: diagnosis(FONT_DEAD),
    settings: { appearance: { font: 'vazir' } },
    apply: true,
    saveSettings: async next => void saved.push(next),
    verify: async () => diagnosis(FONT_OK)
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].appearance.fontDelivery, 'cdn');
  assert.equal(report.ok, true);
  assert.equal(report.applied.length, 1);
  assert.equal(report.skipped.length, 0);
  assert.equal(report.verify.before, 1);
  assert.equal(report.verify.after, 0);
  assert.deepEqual(report.verify.healed, ['font-css']);
  assert.match(report.verify.summary, /همهٔ بررسی‌ها سالم شدند/);
  assert.match(repair.summarizeRepair(report), /✔ appearance.fontDelivery: local→cdn/);
});

test('a repair that did not help says so instead of claiming success', async () => {
  const report = await repair.applyHostRepair({
    diagnosis: diagnosis(FONT_DEAD),
    settings: {},
    apply: true,
    saveSettings: async () => {},
    verify: async () => diagnosis([probe('font-css', 'wrong-type'), probe('font-file', 'skipped'), probe('source', 'ok')])
  });
  assert.equal(report.applied.length, 1, 'the change was still written');
  assert.deepEqual(report.verify.remaining, ['font-css']);
  assert.equal(report.verify.healed.length, 0);
  assert.match(report.verify.summary, /هنوز باقی است/);
  assert.ok(report.advice.some(line => /موارد باقی‌مانده/.test(line)));
});

test('a host that cannot save settings is told that first, and nothing is written', async () => {
  let wrote = false;
  const report = await repair.applyHostRepair({
    diagnosis: diagnosis(FONT_DEAD, { appearance: { writable: false, error: 'readonly database' } }),
    settings: {}, apply: true,
    saveSettings: async () => { wrote = true; },
    verify: async () => diagnosis(FONT_OK)
  });
  assert.equal(wrote, false);
  assert.equal(report.ok, false);
  assert.equal(report.applied.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.match(report.advice[0], /readonly database/);
  assert.match(report.summary, /نوشتن تنظیمات/);
});

test('a failed write reports the error and keeps the old settings', async () => {
  const before = { appearance: { font: 'vazir' } };
  const report = await repair.applyHostRepair({
    diagnosis: diagnosis(FONT_DEAD), settings: before, apply: true,
    saveSettings: async () => { throw new Error('D1_ERROR: disk full'); }
  });
  assert.equal(report.ok, false);
  assert.equal(report.settings, before);
  assert.match(report.skipped[0].note, /disk full/);
  assert.equal(report.verify, null);
});

test('the preview mode changes nothing and a healthy host gets no busywork', async () => {
  let wrote = false;
  const preview = await repair.applyHostRepair({ diagnosis: diagnosis(FONT_DEAD), settings: {}, apply: false, saveSettings: async () => { wrote = true; } });
  assert.equal(wrote, false);
  assert.equal(preview.plan.length, 1);
  assert.equal(preview.applied.length, 0);
  assert.match(preview.skipped[0].note, /چیزی ذخیره نشد/);

  const healthy = await repair.applyHostRepair({ diagnosis: diagnosis(FONT_OK), settings: {}, apply: true, saveSettings: async () => { wrote = true; } });
  assert.equal(wrote, false);
  assert.equal(healthy.ok, true);
  assert.deepEqual(healthy.plan, []);
  assert.match(healthy.summary, /اصلاحی لازم نبود/);
});

test('both deliveries emit the same faces, one relative and one absolute', () => {
  const local = fonts.fontFaceCss('vazir', 'local');
  const cdn = fonts.fontFaceCss('vazir', 'cdn');
  assert.equal(local.split('@font-face').length, cdn.split('@font-face').length);
  assert.match(local, /url\("\.\/vazir-400\.woff2"\)/);
  assert.ok(!/https?:/.test(local), 'the local delivery must never name a third party host');
  assert.match(cdn, /url\("https:\/\/cdn\.fontcdn\.ir\/Fonts\/Vazir\/[0-9a-f]{64}\.woff2"\)/);
  assert.match(fonts.fontFaceCss('vazirmatn', 'cdn'), /Vazirmatn-Regular\.woff2/);
  assert.equal(fonts.fontFaceCss('nosuchfont', 'cdn'), '');
  assert.equal(fonts.fontFamilyOf('shabnam'), 'Shabnam');
  assert.equal(fonts.fontStylesheet('nosuchfont').status, 404);
});

test('the twins expose the repair and the faces route, and the panel can drive both', async () => {
  for (const [file, needle] of [['worker-src/app.ts', "'/api/diag/host/repair'"], ['render-src/server.ts', "'/api/diag/host/repair'"]]) {
    const source = await read(file);
    assert.ok(source.includes(needle), file + ' must expose the repair route');
    assert.ok(source.includes("'/api/fonts/:name/faces'"), file + ' must expose the font faces route');
    assert.ok(source.includes('applyHostRepair'), file + ' must drive the shared repair loop');
    assert.ok(source.includes("body?.confirm === 'APPLY'") || source.includes("body?.confirm==='APPLY'"), file + ' must not apply without an explicit confirm');
  }
  const dashboard = await read('worker-src/dashboard.ts');
  assert.ok(dashboard.includes('async function runHostRepair(apply)'), 'the panel needs the repair runner');
  assert.ok(dashboard.includes('data-modal-action="host-repair"'), 'the diagnosis modal needs the repair buttons');
  assert.ok(dashboard.includes("mSelect('روش تحویل فونت:','siteFontDelivery'"), 'the delivery is a visible setting, not a hidden flag');
  assert.ok(dashboard.includes("function fontDeliveryNow()"), 'the page must read the delivery it was repaired into');
  assert.ok(dashboard.includes("api('/api/fonts/'+encodeURIComponent(key)+'/faces?delivery=cdn')"), 'cdn delivery must come through /api, the route that demonstrably works');
});

test('worker and render fonts stay twins', async () => {
  const strip = text => text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  const a = strip(await read('worker-src/fonts.ts')), b = strip(await read('render-src/fonts.ts'));
  // Only the shared part: the render twin adds a Node-only fetchWithTimeout below it.
  const faces = text => text.slice(text.indexOf('exportfunctionfontFaceCss'), text.indexOf("returnnewResponse(css,{headers:{'content-type':'text/css"));
  assert.ok(faces(a).length > 200);
  assert.equal(faces(a), faces(b), 'fontFaceCss/fontStylesheet must be identical in both runtimes');
});
