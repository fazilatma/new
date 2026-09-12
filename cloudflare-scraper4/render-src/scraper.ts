import * as cheerio from 'cheerio';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safeText } from './network.js';
import type { ExtractionEngine, Product, Profile, Selectors } from './types.js';

const normalize = (value: string) => value.replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
const absolute = (value: string, base: string) => { if (!String(value || '').trim()) return ''; try { const url = new URL(value, base); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };

export function numberFromText(value: string): number {
  const en = value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const groups = en.match(/\d[\d,٬.\s]*/g) || [];
  // Mirrors worker-src/scraper.ts: "1,099.00" is 1099, not 109900.
  return groups.length ? Math.max(...groups.map(item => {
    const token = item.trim().replace(/[\s٬]/g, match => (match === '٬' ? ',' : ''));
    if (/^\d+[.,]\d{1,2}$/.test(token)) return Number(token.replace(',', '.')) || 0;
    if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(token)) return Number(token.replace(/,/g, '')) || 0;
    if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(token)) return Number(token.replace(/\./g, '').replace(',', '.')) || 0;
    return Number(token.replace(/\D/g, '')) || 0;
  })) : 0;
}

function sourceKey(url: string, title: string): string { return createHash('sha256').update(url || title).digest('hex').slice(0, 32); }
/**
 * Find `selector` in the scope of one product card.
 *
 * Three lookups, in order of precision:
 *  1. descendants of the card,
 *  2. the card element itself,
 *  3. document-wide, keeping only hits inside this card.
 *
 * Step 3 exists because the visual selector picker emits ABSOLUTE paths rooted
 * at the document (e.g. "section.grid > div.card:nth-of-type(1) > a > div.title").
 * `find()` matches such a path only against the card's descendants, so it never
 * matches and every card is skipped: extraction returns 0 while the whole-page
 * evidence check stays green. Re-anchoring the same path inside the card keeps
 * those saved profiles working without asking the user to rewrite selectors.
 */
function scopedMatches($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, selector: string): cheerio.Cheerio<any> | null {
  const inner = $root.find(selector);
  if (inner.length) return inner;
  const own = $root.filter(selector);
  if (own.length) return own;
  const element = $root.get(0);
  if (!element) return null;
  const inThisCard = (candidate: cheerio.Cheerio<any>) => {
    const scoped = candidate.filter((_i, node) => node === element || $.contains(element as any, node as any));
    return scoped.length ? scoped : null;
  };
  // Absolute path as saved: only ever inside the card it was picked from.
  let global: cheerio.Cheerio<any> | null = null;
  try { global = $(selector); } catch { global = null; }
  if (global && global.length) {
    const hit = inThisCard(global);
    if (hit) return hit;
  }
  // The picker pins each step with :nth-of-type(N), so the saved path resolves
  // only to the FIRST card. Drop the positional pins and the same path matches
  // the equivalent element in every card; scoping then picks this card's copy.
  if (selector.includes(':nth-of-type(')) {
    const loose = selector.replace(/:nth-of-type\(\d+\)/g, '').trim();
    if (loose && loose !== selector) {
      let widened: cheerio.Cheerio<any> | null = null;
      try { widened = $(loose); } catch { widened = null; }
      if (widened && widened.length) {
        const hit = inThisCard(widened);
        if (hit) return hit;
      }
      // Last resort: the tail of the path, relative to this card.
      const tail = loose.split('>').pop()!.trim();
      if (tail && tail !== loose) {
        let relative: cheerio.Cheerio<any> | null = null;
        try { relative = $root.find(tail); } catch { relative = null; }
        if (relative && relative.length) return relative;
      }
    }
  }
  return null;
}
function firstText($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, selector: string): string {
  if (!String(selector || '').trim()) return '';
  const found = scopedMatches($, $root, selector);
  return found ? normalize(found.first().text()) : '';
}
function firstAttr($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, selector: string, attrs: string[]): string {
  if (!String(selector || '').trim()) return '';
  const found = scopedMatches($, $root, selector);
  if (!found) return '';
  for (const attr of attrs) { const value = found.first().attr(attr); if (value && value !== '#') return value; }
  return '';
}
/**
 * Resolve a product link even when the saved selector does not point at the
 * anchor itself. Visual pickers and "suggest selectors" often land on the <img>
 * inside the product link (or on a wrapper), which yields no href at all: the
 * product then has no URL, detail extraction is skipped and destinations get
 * a product that links nowhere. Look at the matched node, then the anchor that
 * wraps it, then an anchor inside it, and finally any anchor in the card.
 */
function productLink($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, selector: string): string {
  const attrs = ['href', 'data-href', 'data-url', 'data-product-url', 'data-link'];
  const direct = firstAttr($, $root, selector, attrs);
  if (direct) return direct;
  const found = String(selector || '').trim() ? scopedMatches($, $root, selector) : null;
  const candidates = [] as any[];
  if (found && found.length) {
    const node = found.first();
    candidates.push(node.closest('a[href]'), node.find('a[href]').first(), node.parent().find('a[href]').first());
  }
  candidates.push($root.find('a[href]').first());
  for (const candidate of candidates) {
    const href = candidate && candidate.length ? candidate.attr('href') : '';
    if (href && href !== '#' && !/^javascript:/i.test(href)) return href;
  }
  return '';
}

export function pageUrl(profile: Profile, page: number): string {
  const url = new URL(profile.url);
  // next_selector follows a link found in the page, so the URL never changes here.
  if (page <= 1 || profile.pagination === 'none' || profile.pagination === 'next_selector') return url.href;
  const pageNumber = (base: number) => Math.max(1, base) + (page - 1);
  if (profile.pagination === 'full_pattern') return String(profile.paginationValue || '').split('{page}').join(String(pageNumber(1)));
  if (profile.pagination === 'path_page' || profile.pagination === 'path_pattern') {
    const next = profile.pagination === 'path_page'
      ? pageNumber(Number(url.pathname.match(/\/page\/(\d+)\/?$/i)?.[1] || 1))
      : page;
    const pattern = profile.pagination === 'path_page' ? '/page/{page}/' : (profile.paginationValue || '/page/{page}/');
    const basePath = url.pathname.replace(/\/page\/\d+\/?$/i, '').replace(/\/$/, '');
    return url.origin + basePath + pattern.split('{page}').join(String(next));
  }
  const param = profile.pagination === 'query_custom' ? (profile.paginationValue || 'paged') : 'page';
  const current = Number(url.searchParams.get(param) || 1);
  url.hash = '';
  url.searchParams.set(param, String(pageNumber(current)));
  return url.href;
}


/**
 * Resolve the container selector to every product card on the page.
 *
 * The visual picker pins the clicked element with :nth-of-type(N), which makes
 * the selector match exactly ONE card. Extraction then returns a single product
 * (or zero) no matter how many are listed. Dropping the positional pins yields
 * the repeating sibling pattern the user actually meant; we only accept the
 * widened form when it still matches the originally selected element(s).
 */
function containerNodes($: cheerio.CheerioAPI, selector: string): cheerio.Cheerio<any> {
  const exact = $(selector);
  if (!selector.includes(':nth-of-type(')) return exact;
  const loose = selector.replace(/:nth-of-type\(\d+\)/g, '').trim();
  if (!loose || loose === selector) return exact;
  let widened: cheerio.Cheerio<any>;
  try { widened = $(loose); } catch { return exact; }
  if (widened.length <= exact.length) return exact;
  // Every originally matched card must still be part of the wider set.
  const kept = exact.toArray();
  const wide = widened.toArray();
  if (kept.length && !kept.every(node => wide.includes(node))) return exact;
  return widened;
}
function scrapeListCheerioFromHtml(text: string, finalUrl: string, selectors: Selectors): Product[] {
  const $ = cheerio.load(text); const products: Product[] = [];
  containerNodes($, selectors.container).each((_index, element) => {
    const root = $(element); const title = firstText($, root, selectors.title); if (!title) return;
    const priceText = firstText($, root, selectors.price);
    const link = absolute(productLink($, root, selectors.link), finalUrl);
    let imageValue = firstAttr($, root, selectors.image, ['data-src','data-lazy-src','data-original','src']);
    if (!imageValue) imageValue = (firstAttr($, root, selectors.image, ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
    const image = absolute(imageValue, finalUrl);
    products.push({ sourceKey: sourceKey(link, title), title, price: numberFromText(priceText), priceText, url: link, image,
      images: image ? [image] : [], sourcePage: finalUrl, scrapedAt: new Date().toISOString() });
  });
  return products;
}
async function scrapeListCheerio(url: string, selectors: Selectors): Promise<Product[]> {
  const { text, url: finalUrl } = await safeText(url);
  return scrapeListCheerioFromHtml(text, finalUrl, selectors);
}

export type ScrapeListResult={products:Product[];usedEngine:ExtractionEngine;elapsedMs:number;
  /** Absolute URL of the 'next page' link, when a next-selector is configured. */
  nextUrl?:string};
const BROWSER_ENGINES=new Set<ExtractionEngine>(['playwright','puppeteer','crawlee_playwright']);
/** Last browser-engine failure, so callers can explain a skipped engine. */
let lastBrowserError='';
export function lastBrowserEngineError():string{return lastBrowserError}
const RENDER_DISCOVERY_ENGINES:ExtractionEngine[]=['jsonld','next_data','script_json','heuristic','metadata'];
const RENDER_MANUAL_ENGINES=new Set<ExtractionEngine>(['cheerio']);
const RENDER_AUTO_ENGINES:ExtractionEngine[]=[...RENDER_DISCOVERY_ENGINES,'htmlrewriter','cheerio','playwright','puppeteer','crawlee_playwright'];
function engineOrder(requested:ExtractionEngine,master?:ExtractionEngine,autoFirst=true):ExtractionEngine[]{
  const out:ExtractionEngine[]=[],add=(engine?:ExtractionEngine)=>{if(engine&&!out.includes(engine))out.push(engine)};
  if(!autoFirst&&requested!=='auto'){add(requested);return out}
  // An EXPLICIT engine choice must be tried first. Discovery engines used to be
  // prepended even when the user had picked one, so choosing `cheerio` silently
  // ran `heuristic` whenever a page had any inline JSON -- the profile said one
  // engine, the run used another, and the 3-page benchmark (which passes
  // autoFirst=false) disagreed with the real scrape. The other engines stay in
  // the list as fallbacks, just no longer ahead of the explicit choice.
  if(requested!=='auto'){
    add(requested);
    if(master&&!RENDER_MANUAL_ENGINES.has(master))add(master);
    // Discovery engines AND the selector engines are fallbacks; the browser
    // engines stay opt-in so an explicit choice never silently launches one.
    for(const engine of RENDER_DISCOVERY_ENGINES)add(engine);
    add('htmlrewriter');add('cheerio');
    return out;
  }
  if(master&&!RENDER_MANUAL_ENGINES.has(master))add(master);
  for(const engine of RENDER_DISCOVERY_ENGINES)add(engine);
  for(const engine of RENDER_AUTO_ENGINES)add(engine);
  return out;
}

export async function scrapeListWithMeta(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', master?: ExtractionEngine, autoFirst = true, nextSelector = ''): Promise<ScrapeListResult> {
  const started=Date.now();
  let sourcePromise:Promise<{text:string;url:string}>|null=null;
  const source=()=>sourcePromise ||= safeText(url);
  // A 'next page' link is read from the same HTML, so it costs no extra fetch.
  const nextLink=async():Promise<string>=>{
    if(!nextSelector)return '';
    try{
      const {text,url:finalUrl}=await source();
      const $=cheerio.load(text);
      for(const part of nextSelector.split(',').map(x=>x.trim()).filter(Boolean)){
        const href=$(part).first().attr('href');
        if(href)return new URL(href,finalUrl).href;
      }
    }catch{/* a missing next link just ends pagination */}
    return '';
  };
  const pick = async (name: ExtractionEngine) => {
    if (name === 'playwright') return scrapeListWithPlaywright(url, selectors);
    if (name === 'puppeteer') return scrapeListWithPuppeteer(url, selectors);
    if (name === 'crawlee_playwright') return scrapeListWithCrawleePlaywright(url, selectors);
    const { text, url: finalUrl } = await source();
    if (name === 'cheerio' || name === 'htmlrewriter') return scrapeListCheerioFromHtml(text, finalUrl, selectors);
    if (name === 'jsonld') return jsonLdProducts(text, finalUrl);
    if (name === 'next_data') return nextDataProducts(text, finalUrl);
    if (name === 'metadata') return metadataProduct(text, finalUrl);
    if (name === 'script_json') return scriptJsonProducts(text, finalUrl);
    if (name === 'heuristic') return heuristicProducts(text, finalUrl);
    return [] as Product[];
  };
  for(const name of engineOrder(engine,master,autoFirst)){
    try{
      const products=dedupe(await pick(name));
      if(products.length)return{products,usedEngine:name,elapsedMs:Date.now()-started,nextUrl:await nextLink()};
      // The explicit engine ran and found nothing: fall through to the
      // remaining engines instead of returning an empty result, but remember
      // the requested engine so an all-empty run still reports what was asked.
    }catch(error){
      if(engine!=='auto'&&name===engine)throw error;
      if(BROWSER_ENGINES.has(name))lastBrowserError=`${name}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`;
    }
  }
  return{products:[],usedEngine:engine,elapsedMs:Date.now()-started,nextUrl:await nextLink()};
}
export async function scrapeList(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto'): Promise<Product[]> { return (await scrapeListWithMeta(url, selectors, engine)).products; }

/**
 * Finds a Chromium to drive. `.npmrc` deliberately skips the bundled browser
 * download (it is ~300 MB and breaks free hosting tiers), so without this the
 * browser engines always threw "Executable doesn't exist" and — in auto mode —
 * were silently skipped, which looks like they are simply never used.
 * A system Chromium is the normal answer on Termux, a VPS and a desktop.
 */
const SYSTEM_BROWSERS = [
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/snap/bin/chromium',
  '/data/data/com.termux/files/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
let cachedSystemBrowser: string | null | undefined;
function systemBrowser(): string | undefined {
  if (cachedSystemBrowser !== undefined) return cachedSystemBrowser || undefined;
  cachedSystemBrowser = null;
  for (const candidate of SYSTEM_BROWSERS) {
    try { if (existsSync(candidate)) { cachedSystemBrowser = candidate; break; } } catch { /* keep looking */ }
  }
  return cachedSystemBrowser || undefined;
}
function browserExecutable(driver: 'playwright'|'puppeteer'): string | undefined {
  const env = process.env;
  return env.BROWSER_EXECUTABLE_PATH
    || (driver === 'playwright' ? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : env.PUPPETEER_EXECUTABLE_PATH)
    || env.CHROME_BIN
    // Fall back to a browser already installed on the machine before giving up.
    || systemBrowser();
}
/** True when some Chromium is reachable, so the engine list can say why not. */
export function browserEngineAvailable(): boolean {
  if (browserExecutable('playwright')) return true;
  // Playwright downloads into a predictable cache; treat its presence as usable.
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return Boolean(home) && existsSync(`${home}/.cache/ms-playwright`);
  } catch { return false; }
}
function browserLaunchArgs(): string[] { return ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']; }
async function scrapeRenderedHtml(url: string, selectors: Selectors, driver: 'playwright'|'puppeteer'): Promise<Product[]> {
  const executablePath = browserExecutable(driver);
  if (driver === 'playwright') {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, executablePath, args: browserLaunchArgs() });
    try {
      const page = await browser.newPage({ locale: 'fa-IR' });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      const finalUrl = page.url();
      const html = await page.content();
      const products = parseProductsFromHtml(html, finalUrl, selectors);
      return products.length ? products : heuristicProducts(html, finalUrl);
    } finally { await browser.close(); }
  }
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true, executablePath, args: browserLaunchArgs() });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    const finalUrl = page.url();
    const html = await page.content();
    const products = parseProductsFromHtml(html, finalUrl, selectors);
    return products.length ? products : heuristicProducts(html, finalUrl);
  } finally { await browser.close(); }
}
async function scrapeListWithPlaywright(url: string, selectors: Selectors): Promise<Product[]> { return scrapeRenderedHtml(url, selectors, 'playwright'); }
async function scrapeListWithPuppeteer(url: string, selectors: Selectors): Promise<Product[]> { return scrapeRenderedHtml(url, selectors, 'puppeteer'); }
async function scrapeListWithCrawleePlaywright(url: string, selectors: Selectors): Promise<Product[]> {
  const { PlaywrightCrawler, Dataset } = await import('crawlee');
  const dataset = await Dataset.open(`scraper4-${Date.now()}`);
  const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, requestHandler: async ({ page }) => {
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
    const html = await page.content();
    const products = parseProductsFromHtml(html, page.url(), selectors);
    await dataset.pushData(products.length ? products : heuristicProducts(html, page.url()));
  }});
  await crawler.run([url]);
  const data = await dataset.getData();
  return dedupe(data.items.flat() as Product[]);
}
function parseProductsFromHtml(html: string, baseUrl: string, selectors: Selectors): Product[] {
  const $ = cheerio.load(html); const products: Product[] = [];
  containerNodes($, selectors.container).each((_index, element) => {
    const root = $(element); const title = firstText($, root, selectors.title); if (!title) return;
    const priceText = firstText($, root, selectors.price);
    const link = absolute(productLink($, root, selectors.link), baseUrl);
    let imageValue = firstAttr($, root, selectors.image, ['data-src','data-lazy-src','data-original','src']);
    if (!imageValue) imageValue = (firstAttr($, root, selectors.image, ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
    const image = absolute(imageValue, baseUrl);
    products.push({ sourceKey: sourceKey(link, title), title, price: numberFromText(priceText), priceText, url: link, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() });
  });
  return dedupe(products);
}
function dedupe(products: Product[]): Product[] { const seen = new Set<string>(); return products.filter(p => { const key = p.sourceKey || p.url || p.title; if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function decodeHtml(value: string): string { return value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function stripHtml(value: string): string { return normalize(decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))); }
function firstImage(value: any): string { if (!value) return ''; if (typeof value === 'string') return value; if (Array.isArray(value)) return firstImage(value[0]); if (typeof value === 'object') return String(value.url || value.src || value.href || value.original || value.large || ''); return ''; }
function productFromObject(obj: any, baseUrl: string): Product | null { if (!obj || typeof obj !== 'object') return null; const title = normalize(String(obj.name || obj.title || obj.productName || obj.label || '')); const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers || obj.offer || {}; const priceText = normalize(String(obj.price || obj.finalPrice || obj.salePrice || obj.sellingPrice || obj.priceText || offer.price || offer.lowPrice || '')); const rawUrl = String(obj.url || obj.href || obj.link || obj.webUrl || obj.canonicalUrl || (typeof obj.slug === 'string' ? (obj.slug.startsWith('/') ? obj.slug : `/product/${obj.slug}`) : '') || ''); const productUrl = absolute(rawUrl, baseUrl); const image = absolute(firstImage(obj.image || obj.images || obj.thumbnail || obj.cover || obj.imageUrl), baseUrl); if (!title || !image || !priceText || numberFromText(priceText) <= 0) return null; return { sourceKey: sourceKey(productUrl, title), title, price: numberFromText(priceText), priceText, url: productUrl, image, images: image ? [image] : [], sku: String(obj.sku || obj.id || ''), brand: typeof obj.brand === 'object' ? String(obj.brand?.name || '') : String(obj.brand || ''), category: String(obj.category || ''), shortDesc: String(obj.description || ''), sourcePage: baseUrl, scrapedAt: new Date().toISOString() }; }
function walkObjects(value: any, baseUrl: string, out: Product[], depth = 0): void { if (!value || depth > 12 || out.length > 1000) return; if (Array.isArray(value)) { value.forEach(x => walkObjects(x, baseUrl, out, depth + 1)); return; } if (typeof value !== 'object') return; const p = productFromObject(value, baseUrl); if (p) out.push(p); for (const [key, child] of Object.entries(value)) if (/product|item|result|data|pageProps|props|list|card|entity|catalog/i.test(key)) walkObjects(child, baseUrl, out, depth + 1); }
function jsonLdProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const data = JSON.parse(decodeHtml(m[1])); walkObjects(data, baseUrl, out); } catch {} } return dedupe(out); }
function nextDataProducts(html: string, baseUrl: string): Product[] { const m = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if (!m) return []; try { const out: Product[] = []; walkObjects(JSON.parse(decodeHtml(m[1])), baseUrl, out); return dedupe(out); } catch { return []; } }
function meta(html: string, key: string): string { const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return decodeHtml(html.match(new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*content=["']([^"']+)["'][^>]*>`, 'i'))?.[1] || ''); }
function productContextChunk(html: string, index: number, anchor: string): string { let best = ''; for (const [tag, endTag] of [['article', '</article>'], ['li', '</li>'], ['tr', '</tr>'], ['div', '</div>']] as const) { const open = html.lastIndexOf('<' + tag, index); if (open < 0 || index - open > 1800) continue; const close = html.indexOf(endTag, index); if (close < 0 || close - open > 5000) continue; const chunk = html.slice(open, close + endTag.length); if (!best || chunk.length < best.length) best = chunk; } return best; }
function metadataProduct(html: string, baseUrl: string): Product[] { const title = meta(html, 'og:title') || meta(html, 'twitter:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''); if (!title) return []; const ogType = (meta(html, 'og:type') || '').toLowerCase(), productUrl = absolute(meta(html, 'og:url') || baseUrl, baseUrl), priceText = meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || '', image = absolute(meta(html, 'og:image') || meta(html, 'twitter:image'), baseUrl), price = numberFromText(priceText); if (!/(?:product|product.item)/i.test(ogType) || !priceText || price <= 0 || !image) return []; return [{ sourceKey: sourceKey(productUrl, title), title, price, priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }]; }
function scriptJsonProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)) { const body = decodeHtml(m[1]); if (!/(product|products|price|__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__)/i.test(body)) continue; for (const j of body.matchAll(/(?:window\.)?(?:__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__)?\s*=\s*(\{[\s\S]{50,200000}\}|\[[\s\S]{50,200000}\])\s*;?/g)) { try { walkObjects(JSON.parse(j[1]), baseUrl, out); } catch {} } } return dedupe(out); }
function heuristicProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,2500}?)<\/a>/gi)) { const productUrl = absolute(decodeHtml(m[1]), baseUrl); if (!productUrl || !/(product|products|\/p\/|\/pd\/|kala|sku)/i.test(productUrl)) continue; const chunk = productContextChunk(html, m.index || 0, m[0]); if (!chunk) continue; const title = stripHtml(chunk.match(/<h[1-4]\b[^>]*>([\s\S]{0,500}?)<\/h[1-4]>/i)?.[1] || '') || normalize(decodeHtml(chunk.match(/<img\b[^>]*(?:alt|title)=["']([^"']+)["']/i)?.[1] || '')) || stripHtml(m[2]); const image = absolute(decodeHtml(chunk.match(/<img\b[^>]*(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i)?.[1] || ''), baseUrl); const priceText = normalize(chunk.match(/[۰-۹٠-٩\d][۰-۹٠-٩\d,٬.,\s]{1,}\s*(?:تومان|ریال|IRR|USD|EUR|GBP|€|\$|£)/i)?.[0] || ''); if (!title || title.length < 3 || !image || !priceText || numberFromText(priceText) <= 0) continue; out.push({ sourceKey: sourceKey(productUrl, title), title, price: numberFromText(priceText), priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }); } return dedupe(out); }

export async function scrapeDetails(product: Product, selectors: Selectors): Promise<Product> {
  if (!product.url) return product;
  const { text, url } = await safeText(product.url); const $ = cheerio.load(text); const body = $.root();
  const textField = (selector?: string) => selector ? normalize(body.find(selector).first().text()) : '';
  product.shortDesc = textField(selectors.shortDesc) || product.shortDesc;
  product.longDesc = selectors.longDesc ? sanitizeHtml(body.find(selectors.longDesc).first().html() || '', url) : product.longDesc;
  // Specification table: shops render it as <tr><td>name</td><td>value</td></tr>,
  // as <dt>/<dd>, or as <li>name: value</li>. Accept all three shapes so one
  // selector pointing at the block is enough.
  if (selectors.specs) {
    const rows: Array<{ name: string; value: string }> = [];
    const block = body.find(selectors.specs).first();
    block.find('tr').each((_i, el) => {
      const cells = $(el).find('th,td');
      if (cells.length >= 2) rows.push({ name: normalize($(cells[0]).text()), value: normalize($(cells[1]).text()) });
    });
    if (!rows.length) {
      const terms = block.find('dt'), values = block.find('dd');
      terms.each((i, el) => { const value = values[i] ? normalize($(values[i]).text()) : ''; if (value) rows.push({ name: normalize($(el).text()), value }); });
    }
    if (!rows.length) block.find('li').each((_i, el) => {
      const parts = normalize($(el).text()).split(/\s*[:：]\s*/);
      if (parts.length >= 2) rows.push({ name: parts[0], value: parts.slice(1).join(': ') });
    });
    const clean = rows.filter(r => r.name && r.value).slice(0, 60);
    if (clean.length) product.specs = clean;
  }
  product.sku = textField(selectors.sku) || product.sku;
  product.brand = textField(selectors.brand) || product.brand;
  product.category = textField(selectors.category) || product.category;
  const stock = textField(selectors.stock); if (stock) product.stock = numberFromText(stock);
  const weight = textField(selectors.weight); if (weight) product.weight = numberFromText(weight);
  if (selectors.gallery) {
    const images = new Set(product.images);
    body.find(selectors.gallery).each((_i, el) => {
      const node = $(el); const raw = node.attr('data-src') || node.attr('data-large_image') || node.attr('href') || node.attr('src') || '';
      const image = absolute(raw, url); if (image) images.add(image);
    });
    product.images = [...images].slice(0, 30); product.image ||= product.images[0] || '';
  }
  return product;
}

function sanitizeHtml(html: string, base: string): string {
  const $ = cheerio.load(`<div id="s4">${html}</div>`); const root = $('#s4');
  root.find('script,style,iframe,object,embed,form,input,button').remove();
  root.find('*').each((_i, el) => {
    const node = $(el); for (const name of Object.keys(el.attribs || {})) {
      if (/^on/i.test(name) || ['srcdoc','style'].includes(name.toLowerCase())) node.removeAttr(name);
    }
    for (const name of ['href','src']) { const value = node.attr(name); if (value) { const resolved = absolute(value, base); resolved ? node.attr(name, resolved) : node.removeAttr(name); } }
  });
  return root.html() || '';
}

export function transformProduct(product: Product, profile: Profile): Product {
  product.title = normalize(product.title + profile.titleSuffix); const value = profile.priceValue;
  if (profile.priceMode === 'add') product.price += value;
  if (profile.priceMode === 'percent') product.price *= 1 + value / 100;
  if (profile.priceMode === 'multiply') product.price *= value;
  if (profile.roundPrice > 0) product.price = Math.ceil(product.price / profile.roundPrice) * profile.roundPrice;
  product.price = Math.round(product.price); return product;
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) { const index = next++; if (index >= items.length) return; await fn(items[index], index); }
  }));
}

const SUGGESTION_CANDIDATES:Record<string,{type?:'text'|'link'|'image';selectors:string[]}>= {
  container:{selectors:['li.product','article.product','.products .product','.product-card','.product-item','[data-product-id]']},title:{selectors:['.woocommerce-loop-product__title','.product-title','.card-title','h2','h3','[itemprop="name"]']},price:{selectors:['.price ins','.sale-price','.price','[itemprop="price"]','.amount']},link:{type:'link',selectors:['a.woocommerce-LoopProduct-link','a.product-link','a[href*="/product/"]','a[href]']},image:{type:'image',selectors:['img.wp-post-image','img.product-image','picture img','img']},shortDesc:{selectors:['.woocommerce-product-details__short-description','.short-description','[itemprop="description"]']},longDesc:{selectors:['#tab-description','.woocommerce-Tabs-panel--description','.product-description','.description']},sku:{selectors:['.sku','[itemprop="sku"]','[data-sku]']},brand:{selectors:['.brand','[itemprop="brand"]','.product-brand']},stock:{selectors:['.stock','[itemprop="availability"]','.inventory']},weight:{selectors:['.product_weight','.weight','[data-weight]']},category:{selectors:['.posted_in','.product_meta .category','.breadcrumb']},tags:{selectors:['.tagged_as','.product_meta .tags','[rel="tag"]']},detailImage:{type:'image',selectors:['.woocommerce-product-gallery__image img','.product-main-image img','img.wp-post-image','[itemprop="image"]']},gallery:{type:'image',selectors:['.woocommerce-product-gallery img','.product-gallery img','[data-gallery] img','.gallery img']},variations:{selectors:['.variations','.variations_form','[data-product_variations]','.product-options']}
};
export async function suggestSelectors(url:string,mode:'list'|'detail'|'all'='all'){
  const page=await safeText(url,4_000_000),wanted=mode==='list'?['container','title','price','link','image']:mode==='detail'?['shortDesc','price','longDesc','sku','category','tags','weight','stock','brand','detailImage','gallery','variations']:Object.keys(SUGGESTION_CANDIDATES),selectors:Record<string,string>={},evidence:Record<string,unknown>={};
  for(const field of wanted){const config=SUGGESTION_CANDIDATES[field];for(const candidate of config.selectors)try{const values=await extractSelectorValues(page.text,page.url,candidate,config.type||'text');const count=values.length,minimum=field==='container'?2:1;if(count>=minimum){selectors[field]=candidate;evidence[field]={count,sample:values[0]||''};break}}catch{}}
  return{url:page.url,mode,selectors,evidence};
}
async function extractSelectorValues(html:string,baseUrl:string,selector:string,type:'text'|'link'|'image'='text'):Promise<string[]>{const $=cheerio.load(html),values:string[]=[];$(selector).slice(0,50).each((_i,el)=>{const node=$(el);const raw=type==='link'?(node.attr('href')||node.find('a[href]').first().attr('href')||''):type==='image'?(node.attr('src')||node.attr('data-src')||node.find('img').first().attr('src')||node.find('img').first().attr('data-src')||''):node.text();const value=type==='text'?normalize(raw):absolute(raw,baseUrl);if(value)values.push(value.slice(0,1000))});return values}
export async function testSelector(url: string, selector: string, type = 'text'): Promise<{ count: number; values: string[] }> {
  const { text, url: final } = await safeText(url, 4_000_000); const $ = cheerio.load(text); const values: string[] = [];
  $(selector).slice(0, 20).each((_i, el) => { const node = $(el); let value = type === 'link' ? absolute(node.attr('href') || '', final) : type === 'image' ? absolute(node.attr('src') || node.attr('data-src') || '', final) : normalize(node.text()); if (value) values.push(value.slice(0, 1000)); });
  return { count: $(selector).length, values };
}

/**
 * Real extraction diagnostic for the Node runtime.
 *
 * The dashboard's "عیب‌یابی استخراج" button posts to
 * /api/profiles/:id/extraction-diagnostic, which only ever existed on the
 * Worker, so on Termux/Node every diagnostic click returned 404 even though the
 * visual selector preview worked fine. This runs the SAME pipeline the real
 * scrape uses (safeText -> scrapeListWithMeta -> scrapeDetails) so the report
 * reflects what the scraper actually does, not a re-implementation.
 */
export async function diagnoseExtraction(profile: Profile, urlOverride = '') {
  const started = Date.now(), url = String(urlOverride || profile.url || '').trim();
  const stages: any[] = [], recommendations: string[] = [];
  const add = (name: string, ok: boolean, summary: string, details: any = {}) => stages.push({ name, ok, summary, ...details });
  if (!url) {
    add('configuration', false, 'آدرس مبدأ خالی است.');
    return { ok: false, profileId: profile.id, url, stages, recommendations: ['آدرس صفحهٔ فهرست محصولات را در پروفایل وارد کنید.'] };
  }
  let page: { text: string; url: string };
  try {
    page = await safeText(url, 4_000_000);
    const bytes = Buffer.byteLength(page.text, 'utf8');
    const title = normalize(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || '');
    add('network', true, `صفحه با ${bytes.toLocaleString('fa-IR')} بایت دریافت شد.`, { requestedUrl: url, finalUrl: page.url, bytes, title, runtime: 'node' });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    add('network', false, text, { requestedUrl: url, runtime: 'node' });
    recommendations.push(/ضدربات|چالش|challenge|403/i.test(text)
      ? 'سایت صفحهٔ ضدربات برگردانده است؛ دسترسی این دستگاه را در مبدأ مجاز کنید یا از روش اتصال غیرمستقیم استفاده کنید.'
      : 'آدرس، دسترسی اینترنت دستگاه و تنظیمات روش اتصال مبدأ را بررسی کنید.');
    return { ok: false, profileId: profile.id, url, durationMs: Date.now() - started, stages, recommendations };
  }
  let products: Product[] = [], usedEngine: ExtractionEngine | '' = '';
  try {
    const result = await scrapeListWithMeta(page.url, profile.selectors, profile.extractionEngine || 'auto', profile.extractionEngineMaster);
    products = result.products; usedEngine = result.usedEngine;
    const complete = {
      title: products.filter(x => x.title).length, price: products.filter(x => x.price > 0).length,
      link: products.filter(x => x.url).length, image: products.filter(x => x.image).length, sku: products.filter(x => x.sku).length
    };
    add('list-extraction', products.length > 0,
      products.length ? `${products.length.toLocaleString('fa-IR')} محصول با pipeline واقعی استخراج شد.` : 'هیچ محصولی از موتورهای خودکار یا سلکتورهای دستی استخراج نشد.',
      { count: products.length, usedEngine, complete, selectors: profile.selectors, samples: products.slice(0, 5).map(x => ({ title: x.title, price: x.price, priceText: x.priceText, url: x.url, image: x.image, sku: x.sku })) });
  } catch (error) {
    add('list-extraction', false, error instanceof Error ? error.message : String(error), { selectors: profile.selectors });
  }
  const evidence: Record<string, unknown> = {};
  for (const field of ['container', 'title', 'price', 'link', 'image'] as const) {
    const selector = String((profile.selectors as any)?.[field] || '').trim();
    if (!selector) { evidence[field] = { ok: false, count: 0, error: 'سلکتور خالی است' }; continue; }
    try {
      const type = field === 'link' ? 'link' : field === 'image' ? 'image' : 'text';
      const values = await extractSelectorValues(page.text, page.url, selector, type);
      evidence[field] = { ok: values.length > 0, count: values.length, sample: values.slice(0, 3) };
    } catch (error) { evidence[field] = { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }; }
  }
  const evidenceOk = ['container', 'title'].every(key => (evidence[key] as any)?.ok);
  // The raw selector may be pinned with :nth-of-type(N) and match a single card
  // while extraction widens it to every card. Report the number extraction
  // really uses, otherwise the advice contradicts the result.
  let containerCount = Number((evidence.container as any)?.count || 0);
  let widenedContainers = 0;
  try {
    const $page = cheerio.load(page.text);
    widenedContainers = containerNodes($page, String((profile.selectors as any)?.container || '').trim()).length;
    if (widenedContainers > containerCount) {
      (evidence.container as any).effectiveCount = widenedContainers;
      (evidence.container as any).note = 'سلکتور ظرف با :nth-of-type محدود شده بود؛ استخراج آن را به ' + widenedContainers + ' کارت گسترش داد.';
      containerCount = widenedContainers;
    }
  } catch {}
  // Document-wide evidence can be green while container-scoped extraction finds
  // nothing. That contradiction is itself the diagnosis, so surface it.
  const contradiction = evidenceOk && products.length === 0;
  add('selector-evidence', evidenceOk && !contradiction,
    contradiction
      ? 'سلکتورها روی کل صفحه نتیجه دارند اما داخل هر ظرف محصول چیزی پیدا نشد؛ یعنی سلکتور ظرف به کارت محصول اشاره نمی‌کند (احتمالاً کل فهرست را گرفته) یا عنوان/قیمت داخل ظرف نیست.'
      : evidenceOk ? 'سلکتورهای پایه روی پاسخ واقعی نشانه دارند.' : 'یک یا چند سلکتور پایه روی پاسخ واقعی نتیجه نداد.',
    { evidence, containerCount, scope: 'این بررسی روی کل صفحه انجام می‌شود، ولی استخراج واقعی فقط داخل هر ظرف را می‌بیند.' });
  if (contradiction) recommendations.push(containerCount <= 1
    ? 'سلکتور ظرف فقط ' + containerCount + ' مورد در کل صفحه پیدا کرد؛ یعنی به‌جای هر کارت محصول، کل فهرست را گرفته است. سلکتوری بنویسید که به تعداد محصولات صفحه تکرار شود.'
    : 'سلکتور ظرف ' + containerCount + ' مورد پیدا کرد ولی عنوان داخل آن‌ها نبود؛ سلکتور عنوان باید نسبت به ظرف داخلی باشد یا خودِ ظرف را هدف بگیرد.');
  let detail: any = null;
  const candidate = products.find(product => product.url);
  const detailKeys = ['shortDesc', 'longDesc', 'sku', 'category', 'tags', 'weight', 'stock', 'brand', 'detailImage', 'gallery', 'variations'];
  const wantsDetail = detailKeys.some(key => String((profile.selectors as any)?.[key] || '').trim().length > 0);
  if (candidate && wantsDetail) {
    try {
      const extracted = await scrapeDetails(candidate, profile.selectors);
      detail = { url: candidate.url, title: extracted.title, shortDesc: extracted.shortDesc, descriptionCharacters: String(extracted.longDesc || '').length, sku: extracted.sku, brand: extracted.brand, stock: extracted.stock, weight: extracted.weight, category: extracted.category, tags: extracted.tags, image: extracted.image, galleryCount: extracted.images?.length || 0, variations: extracted.variations?.slice(0, 20) };
      add('detail-extraction', true, 'صفحهٔ جزئیات نمونه با pipeline واقعی پردازش شد.', { sample: detail });
    } catch (error) { add('detail-extraction', false, error instanceof Error ? error.message : String(error), { url: candidate.url }); }
  } else add('detail-extraction', true, candidate ? 'برای این پروفایل سلکتور جزئیات تنظیم نشده است.' : 'محصول دارای لینک برای تست جزئیات پیدا نشد.', { skipped: true });
  if (!products.length) recommendations.push('سلکتور ظرف محصول را با HTML واقعی اصلاح کنید؛ پیشنهاد خودکار را اجرا و سپس دوباره همین عیب‌یاب را بزنید.');
  else {
    if (!products.some(x => x.price > 0)) recommendations.push('محصول پیدا شده ولی قیمت صفر است؛ سلکتور قیمت و واحد/متن قیمت را بررسی کنید.');
    if (!products.some(x => x.url)) recommendations.push('لینک محصول پیدا نشده است؛ سلکتور لینک باید به عنصر a یا ویژگی href/data-url برسد.');
    if (!products.some(x => x.image)) recommendations.push('تصویر پیدا نشده است؛ data-src، srcset یا سلکتور تصویر را بررسی کنید.');
  }
  const failed = stages.filter(stage => !stage.ok);
  return { ok: products.length > 0 && failed.length === 0, profileId: profile.id, url, finalUrl: page.url, durationMs: Date.now() - started, productCount: products.length, usedEngine, stages, recommendations, detail };
}
