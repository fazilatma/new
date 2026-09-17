import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

/**
 * Reconciliation ("مغایرت‌گیری") audit pins, Worker vs Node.
 *
 * Found by re-reading both runtimes side by side:
 * - summarize() ignored the unreachable bucket, so the table could show a
 *   green all-clear above rows whose destination never answered.
 * - the Worker's unified comparison fed Toman prices against Rial expectations
 *   (every Basalam product a false priceDiff); Node fed Rial. Both are Rial now.
 * - recon price fixes PATCHed Basalam with `{price}`, but the vendor API field
 *   is `primary_price` (see worker-src/sync.ts) — fixes silently did nothing.
 * - the per-target table ran two different algorithms (legacy on the Worker,
 *   shared-core on Node); both run the legacy PHP-parity scope now.
 * - the Worker's preview action-count ignored the configured suffix formats
 *   the apply path uses, so preview and apply could disagree.
 * - the matrix labelled unreachable cells "no source price" and omitted the
 *   bucket from its legend and counts.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-recon-audit-'));
await build({ entryPoints: { core: new URL('../worker-src/recon-core.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const core = await import(pathToFileURL(join(temporary, 'core.mjs')));
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const row = (bucket) => ({ bucket });

test('summarize counts the unreachable bucket', () => {
  const summary = core.summarize([row('matched'), row('unreachable'), row('unreachable')]);
  assert.equal(summary.unreachable, 2);
  assert.equal(summary.total, 3);
});

test('inSync is false while any destination is unreachable', () => {
  assert.equal(core.summarize([row('matched')]).inSync, true);
  assert.equal(core.summarize([row('matched'), row('unreachable')]).inSync, false);
  assert.equal(core.summarize([row('unreachable')]).inSync, false);
});

test('unreachable rows normalize prices exactly like compared rows', () => {
  const account = { target: 'basalam', accountKey: 'v1', name: 'stall', pricePercent: 0, toRial: true };
  const rows = core.unreachableAccountRows([
    { profile_id: 'p', source_key: 'a', title: 'x (کد 1)', price: 100.6 },
    { profile_id: 'p', source_key: 'b', title: 'y (کد 2)', price: 0 },
    { profile_id: 'p', source_key: 'c', title: 'z (کد 3)', price: -5 },
  ], account, {}, '', 'boom');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sourcePrice, 101);
  assert.equal(rows[1].sourcePrice, null);
  assert.equal(rows[2].sourcePrice, null);
  assert.equal(rows[0].bucket, 'unreachable');
});

test('stored destination_map ids win over the legacy columns', () => {
  const account = { target: 'basalam', accountKey: 'v9', name: 'stall', pricePercent: 0 };
  assert.equal(core.mappedRemoteId({
    remote_basalam_id: 3,
    maps: [{ target: 'basalam', account_key: 'v9', remote_id: 7 }],
  }, account), 7);
  assert.equal(core.mappedRemoteId({ remote_basalam_id: 3, maps: [] }, account), 3);
});

test('worker unified comparison reads Rial prices on both targets', async () => {
  const src = await read('../worker-src/maintenance.ts');
  assert.ok(src.includes('price:x.priceRaw,status:x.status,shopId:'), 'basalam leg must use priceRaw (Rial)');
  assert.ok(src.includes('destinationCatalog(account.target,'), 'both destinations share the complete ledger scan and use priceRaw');
  assert.doesNotMatch(src, /remoteForAccount[\s\S]{0,400}price:x\.price,/);
});

test('both runtimes PATCH Basalam prices via primary_price', async () => {
  for (const file of ['../worker-src/maintenance.ts', '../render-src/maintenance.ts']) {
    const src = await read(file);
    assert.ok(/\{ ?primary_price: ?action\.toPrice ?\}/.test(src), `${file} must send primary_price`);
    assert.ok(!/\{ ?price: ?action\.toPrice ?\}/.test(src), `${file} must not send the wrong price field`);
  }
});

test('both per-target tables share the legacy PHP-parity scope', async () => {
  for (const file of ['../worker-src/maintenance.ts', '../render-src/maintenance.ts']) {
    const src = await read(file);
    assert.ok(src.includes('matchedByTitle'), `${file} reconTable must keep the legacy match-origin counts`);
    assert.ok(src.includes('fromMapId'), `${file} reconTable must consult destination_map before the legacy columns`);
  }
  const node = await read('../render-src/maintenance.ts');
  assert.ok(!node.includes('accountsBreakdown: byAccount(rows), rows };\n  await setState(`recon_table_'),
    'node reconTable must not run the filtered unified algorithm');
});

test('node listing prices match the worker Toman normalization', async () => {
  const src = await read('../render-src/maintenance.ts');
  assert.ok(src.includes('price:Math.round(Number(x.price||0)/10)'), 'node basalamProducts must convert Rial to Toman');
});

test('worker preview action-count uses the configured suffix formats', async () => {
  const src = await read('../worker-src/maintenance.ts');
  assert.ok(src.includes('actions:planActions(rows,suffixFormats).length'), 'preview and apply must plan identically');
});

test('per-target renderer shares the bucket legend with the unified table', async () => {
  const dash = await read('../worker-src/dashboard.ts');
  assert.ok(dash.includes('function renderReconTable(d)') && dash.includes('const meta=reconBucketMeta();'),
    'renderReconTable must reuse reconBucketMeta (unreachable included)');
});

test('matrix cells, legend and counts cover the unreachable bucket', async () => {
  const dash = await read('../worker-src/dashboard.ts');
  assert.ok(dash.includes("row.bucket==='unreachable'){main='—';sub='مقصد پاسخ نداد';}"),
    'unreachable cells need their own label, not "no source price"');
  assert.ok(dash.includes("['unreachable','مقصد پاسخ نداد']"), 'legend must list the bucket');
  assert.ok(dash.includes("['unreachable','پاسخ نداد',d.unreachable]"), 'counts must list the bucket');
});

for(const keep of ['expensive','cheapest'])test('Basalam duplicate planning is stall-local even with mixed ledger rows: '+keep,()=>{
 const accounts=['100','200'].map(accountKey=>({target:'basalam',accountKey,name:'Stall '+accountKey}));
 const rows=[{id:1,shopId:'100',name:'کیف (کد 11)',price:100},{id:2,shopId:'200',name:'کیف (کد 22)',price:500}];
 for(const account of accounts)assert.deepEqual(core.planDuplicateDeletions(rows,account,'',keep),[]);
 rows.push({id:3,shopId:'100',name:'کیف (کد 33)',price:200});
 const actions=core.planDuplicateDeletions(rows,accounts[0],'',keep);
 assert.equal(actions.length,1);assert.equal(actions[0].accountKey,'100');
 assert.equal(actions[0].remoteId,keep==='expensive'?1:3);assert.equal(actions[0].keepId,keep==='expensive'?3:1);
 assert.deepEqual(core.planDuplicateDeletions(rows,accounts[1],'',keep),[]);
});
