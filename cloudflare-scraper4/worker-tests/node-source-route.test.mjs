import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

/**
 * Per-profile «اتصال غیرمستقیم» on the Node runtime.
 *
 * The checkbox was stored but never read there: the Worker routes such a
 * profile's source fetches through the Worker gateway (sourceText(url,
 * indirect)) while Node fetched directly — so a shop that blocks the
 * device's egress IP answers 403 on Node and works on the Worker for the
 * very same profile. Node now forces the same gateway route, reports which
 * route a fetch took, and fails with the missing-gateway error instead of
 * silently going direct.
 */
const temporary = await mkdtemp(join(new URL('..', import.meta.url).pathname, '.tmp-source-route-'));
const outfile = join(temporary, 'network.mjs');
await build({ entryPoints: [new URL('../render-src/network.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'error' });
const network = await import(pathToFileURL(outfile));
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

function stubFetch(responder) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), headers: new Headers(init.headers || {}) });
    return responder(String(input), init);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const htmlPage = (text) => new Response(text, { status: 200, headers: { 'content-type': 'text/html' } });

test('indirect fetches go through the gateway with the target headers', async () => {
  network.configureSourceNetwork({ mode: 'direct', workerUrl: 'https://gw.example.com/fetch' });
  const stub = stubFetch(() => htmlPage('<html><body>via gateway</body></html>'));
  try {
    const page = await network.safeText('https://example.com/shop', 8_000_000, { indirect: true });
    assert.ok(page.text.includes('via gateway'));
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://gw.example.com/fetch/https://example.com/shop');
    assert.equal(stub.calls[0].headers.get('x-scraper-target'), 'https://example.com/shop');
    assert.equal(stub.calls[0].headers.get('x-target-url'), 'https://example.com/shop');
  } finally {
    stub.restore();
    network.configureSourceNetwork({ mode: 'direct' });
  }
});

test('plain fetches stay direct when the global mode is direct', async () => {
  network.configureSourceNetwork({ mode: 'direct', workerUrl: 'https://gw.example.com/fetch' });
  const stub = stubFetch(() => htmlPage('<html><body>direct</body></html>'));
  try {
    await network.safeText('https://example.com/shop');
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://example.com/shop');
    assert.equal(stub.calls[0].headers.get('x-scraper-target'), null);
  } finally {
    stub.restore();
    network.configureSourceNetwork({ mode: 'direct' });
  }
});

test('indirect without a gateway fails loudly instead of going direct', async () => {
  network.configureSourceNetwork({ mode: 'direct' });
  const stub = stubFetch(() => htmlPage('<html></html>'));
  try {
    await assert.rejects(network.safeText('https://example.com/shop', 8_000_000, { indirect: true }), /Worker URL/);
    assert.equal(stub.calls.length, 0, 'no direct request may leak out');
  } finally {
    stub.restore();
    network.configureSourceNetwork({ mode: 'direct' });
  }
});

test('indirect over a configured proxy tunnels instead of failing', async () => {
  const http = await import('node:http');
  const nodeNet = await import('node:net');
  const BODY = '<html><body><h1>through the proxy</h1></body></html>';
  const origin = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(BODY); });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = origin.address().port;
  const proxy = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(BODY); });
  const tunnels = [];
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(request.url);
    const upstream = nodeNet.connect(originPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    network.configureSourceNetwork({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:' + proxy.address().port });
    const page = await network.safeText('http://example.com/shop/', 8_000_000, { indirect: true });
    assert.ok(page.text.length > 0);
    assert.deepEqual(tunnels, ['example.com:80']);
  } finally {
    network.configureSourceNetwork({ mode: 'direct' });
    origin.close(); proxy.close();
  }
});

test('sourceRoute reports the route the diagnostic shows', () => {
  network.configureSourceNetwork({ mode: 'direct' });
  assert.equal(network.sourceRoute(false), 'direct');
  assert.equal(network.sourceRoute(true), 'direct');
  network.configureSourceNetwork({ mode: 'direct', workerUrl: 'https://gw.example.com' });
  assert.equal(network.sourceRoute(false), 'direct');
  assert.equal(network.sourceRoute(true), 'worker');
  network.configureSourceNetwork({ mode: 'worker', workerUrl: 'https://gw.example.com' });
  assert.equal(network.sourceRoute(false), 'worker');
  network.configureSourceNetwork({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:9' });
  assert.equal(network.sourceRoute(false), 'proxy');
  assert.equal(network.sourceRoute(true), 'proxy');
  network.configureSourceNetwork({ mode: 'direct' });
});

test('node extraction paths pass the per-profile indirect flag', async () => {
  const scraper = await read('../render-src/scraper.ts');
  assert.ok(scraper.includes('safeText(url, 4_000_000, { indirect: Boolean(profile.networkIndirect) })'),
    'diagnostic network stage must route like the profile asks');
  assert.ok(scraper.includes('route: sourceRoute(Boolean(profile.networkIndirect))'),
    'diagnostic must report the route taken');
  assert.ok(scraper.includes("profile.extractionEngineMaster, true, '', true, Boolean(profile.networkIndirect),"),
    'diagnostic list extraction must route like the profile asks');
  assert.ok(scraper.includes('scrapeDetails(candidate, profile.selectors, Boolean(profile.networkIndirect))'),
    'diagnostic detail extraction must route like the profile asks');
  assert.ok(scraper.includes('safeText(url,8_000_000,{indirect})'),
    'the shared list source must honour the flag');
  const processor = await read('../render-src/processor.ts');
  assert.equal((processor.match(/Boolean\(profile\.networkIndirect\)/g) || []).length, 6,
    'processor list/detail/probe paths must all route like the profile asks');
  const server = await read('../render-src/server.ts');
  assert.ok(server.includes('safeText(pageUrl(probe,1),1_000_000,{indirect:Boolean(profile.networkIndirect)})'),
    'benchmark diagnosis fetch must route like the profile asks');
  assert.ok(server.includes("engine,undefined,false,nextSelector,true,Boolean(profile.networkIndirect)"),
    'benchmark engines must route like the profile asks');
  assert.ok(server.includes('scrapeDetails(product,profile.selectors,Boolean(profile.networkIndirect))'),
    'direct extract details must route like the profile asks');
});

test('node profiles persist the indirect flag and its neighbours', async () => {
  const types = await read('../render-src/types.ts');
  for (const field of ['networkIndirect?: boolean', 'noExtract?: boolean', 'basalamFallbackCategoryIds?: number[]', 'gallery?: GalleryConfig']) {
    assert.ok(types.includes(field), `render Profile needs ${field}`);
  }
  const server = await read('../render-src/server.ts');
  assert.ok(server.includes('networkIndirect: Boolean(raw.networkIndirect ?? raw.net_indirect)'),
    'normalizer must keep the indirect flag (Worker reads net_indirect too)');
  assert.ok(server.includes('noExtract: Boolean(raw.noExtract'),
    'normalizer must keep noExtract instead of dropping it');
  assert.ok(server.includes('basalamFallbackCategoryIds: Array.isArray(raw.basalamFallbackCategoryIds ?? raw.bslFallbackCatIds)'),
    'normalizer must keep the Basalam fallback ids');
});

test('node reconTable imports the title normalizer it calls', async () => {
  const maintenance = await read('../render-src/maintenance.ts');
  assert.ok(maintenance.includes("import { reconNormTitle } from '../worker-src/recon-core.js';"),
    'a bare re-export leaves the name undefined at runtime (1.179.0 broke the Node per-target table)');
});

test('cleanup', async () => { await rm(temporary, { recursive: true, force: true }); });
