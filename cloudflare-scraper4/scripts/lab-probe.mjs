#!/usr/bin/env node
// lab-probe.mjs
// ---------------------------------------------------------------------------
// Interactive lab probe: runs BOTH extraction twins (worker-src + render-src)
// against a fixture (or any saved HTML page) and prints one compact report:
// selector discovery, heuristic extraction, selector-engine extraction and the
// benchmark diagnosis. This is the fastest way to reproduce a report from the
// field ("0 products on shop X") without network access: save the page HTML,
// add it as a fixture, probe it, fix the code, probe again.
//
// Usage (from cloudflare-scraper4/):
//   node scripts/lab-probe.mjs [fixture] [--file path/to/page.html] [--base URL]
//   node scripts/lab-probe.mjs patris-cards.html
//   node scripts/lab-probe.mjs --file /tmp/shop-page.html --base https://shop.example/
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEsbuild } from './esbuild-loader.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
const { build } = await loadEsbuild();
const { load } = require('cheerio');

// The worker twin runs selector extraction through the HTMLRewriter API,
// which only exists on Cloudflare. This stub (same one as
// worker-tests/engine-diagnosis.test.mjs) replays it on cheerio so the lab
// exercises the real worker code paths on plain Node.
const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
class CheerioHTMLRewriter {
  constructor() { this.registrations = []; }
  on(selector, handler) { load('<i></i>')(selector); this.registrations.push({ selector, handler }); return this; }
  transform(response) { return new Response(new ReadableStream({ start: async controller => { try { const source = await response.text(), $ = load(source, { decodeEntities: true }), roots = $.root().contents().toArray(); for (const root of roots) this.#walk($, root, []); controller.enqueue(new TextEncoder().encode($.html())); controller.close(); } catch (error) { controller.error(error); } } })); }
  #walk($, node, active) {
    if (node.type === 'text') { for (const handler of active) handler.text?.({ text: node.data || '', lastInTextNode: true }); return; }
    if (node.type === 'comment') return;
    const matching = [];
    if (node.type === 'tag') for (const registration of this.registrations) if ($(node).is(registration.selector)) matching.push(registration.handler);
    const callbacks = [], wrapper = {
      tagName: node.name, getAttribute: name => node.attribs?.[name] ?? null, setAttribute: (name, value) => $(node).attr(name, value), removeAttribute: name => $(node).removeAttr(name),
      before: (value) => $(node).before(value), after: (value) => $(node).after(value), remove: () => $(node).remove(), onEndTag: callback => { if (HTML_VOID_TAGS.has(String(node.name).toLowerCase())) throw Error('Parser error: No end tag.'); callbacks.push(callback); },
      get attributes() { return Object.entries(node.attribs || {}); }
    };
    for (const handler of matching) handler.element?.(wrapper);
    const scoped = [...active, ...matching]; for (const child of [...(node.children || [])]) this.#walk($, child, scoped);
    for (const callback of callbacks.reverse()) callback();
  }
}
globalThis.HTMLRewriter = CheerioHTMLRewriter;

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const positional = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--file' && args[args.indexOf(a) - 1] !== '--base') || 'patris-cards.html';
const fileArg = flag('--file');
const htmlPath = fileArg || join(ROOT, 'worker-tests', 'fixtures', positional.endsWith('.html') ? positional : `${positional}.html`);
const baseArg = flag('--base');
const BASE = baseArg || (htmlPath.includes('patris') ? 'https://www.mantoopatris.com/' : 'https://shop.example/');
const SEL = { container: 'li.product', title: 'h2', price: '.price', link: 'a[href]', image: 'img' };

let html;
try {
  html = await readFile(htmlPath, 'utf8');
} catch {
  console.error(`lab-probe: cannot read ${htmlPath}`);
  process.exit(1);
}

// Worker twin: self-contained ESM bundle (browser platform, like production).
const wtmp = await mkdtemp(join(tmpdir(), 'scraper4-lab-worker-'));
await build({ entryPoints: { scraper: join(ROOT, 'worker-src', 'scraper.ts') }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: wtmp, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const worker = await import(pathToFileURL(join(wtmp, 'scraper.mjs')));

// Render twin: CJS bundle built INSIDE the repo tree (gitignored
// node_modules cache) so the external requires (cheerio, ...) resolve via
// node_modules walk-up; a /tmp bundle cannot see them.
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'render-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const short = (p, i) => `  #${i} [${p.price}] ${(p.title || '').slice(0, 44)} | ${(p.url || '').slice(0, 60)} | img:${p.image ? 'yes' : 'NO'}`;

console.log(`lab-probe: ${htmlPath} (${html.length} bytes, base ${BASE})`);
for (const [name, twin, heuristic] of [['worker', worker, 'extractHeuristicProducts'], ['render', render, 'heuristicProducts']]) {
  console.log(`=== ${name} ===`);
  const found = await twin.discoverListSelectorsFromHtml(html, BASE);
  console.log('discovery:', found.method, JSON.stringify(found.selectors));
  const heu = await twin[heuristic](html, BASE);
  console.log(`heuristic: ${heu.length} products`);
  heu.slice(0, 8).forEach((p, i) => console.log(short(p, i)));
  if (found.method !== 'none') {
    if (name === 'worker') {
      const cards = await twin.parseCards(html, BASE, found.selectors);
      const full = cards.filter(p => p.price > 0 && p.image && p.title).length;
      console.log(`selector(parseCards): ${cards.length} products, ${full} complete`);
      cards.slice(0, 8).forEach((p, i) => console.log(short(p, i)));
    } else {
      const v = await twin.verifyListSelectors(html, BASE, { ...SEL, ...found.selectors });
      console.log(`selector(verify): ok=${v.ok} containers=${v.containerCount} titles=${v.title?.count} prices=${v.price?.count} links=${v.link?.count} images=${v.image?.count}`);
    }
  }
  const dHeu = await twin.diagnoseBenchmarkEngine('heuristic', html, BASE, SEL, heu);
  console.log('diag heuristic:', JSON.stringify(dHeu.signals));
  console.log('  hint:', dHeu.hint);
  if (dHeu.dropReasons?.length) console.log('  drops:', dHeu.dropReasons.join(' / ').slice(0, 300));
}
