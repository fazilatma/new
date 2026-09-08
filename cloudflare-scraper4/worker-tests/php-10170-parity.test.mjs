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
