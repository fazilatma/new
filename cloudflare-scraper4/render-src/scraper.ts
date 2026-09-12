import * as cheerio from 'cheerio';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeText } from './network.js';
import { DEFAULT_SELECTORS, type ExtractionEngine, type Product, type Profile, type Selectors } from './types.js';

// Playwright resolves its browser-registry directory at IMPORT time and only
// knows linux/darwin/win32 — on Termux (process.platform === 'android') the
// bare import throws `Unsupported platform: android` before any launch is
// attempted. We always launch an explicit system executable, so the registry
// directory is never actually used — but it must still RESOLVE. Playwright
// checks PLAYWRIGHT_BROWSERS_PATH first, so default it (Android only, an
// explicitly configured value still wins) to the same cache path Linux would
// compute. Module-level on purpose: every browser import in the codebase is
// a lazy import below in this file (Crawlee pulls Playwright in internally),
// so this always runs first, for all three engines.
if (process.platform === 'android' && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), '.cache', 'ms-playwright');
}

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
  nextUrl?:string;
  /**
   * Selectors the selector engines actually ran with (1.128.0). Equals the
   * input selectors unless auto-discovery repaired them first.
   */
  selectorsUsed?:Selectors;
  /**
   * List selectors auto-discovery found on this page (1.128.0). Set only when
   * the input selectors were never configured AND the proposals verified
   * against the real page. Callers that own the profile persist these so the
   * next page/run reuses them instead of re-discovering.
   */
  discoveredSelectors?:Partial<Selectors>;
  /** How the selectors were found: 'curated' | 'structural' | 'mixed'. */
  discoveryMethod?:string};
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

export async function scrapeListWithMeta(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', master?: ExtractionEngine, autoFirst = true, nextSelector = '', autoDiscover = true): Promise<ScrapeListResult> {
  const started=Date.now();
  let sourcePromise:Promise<{text:string;url:string}>|null=null;
  const source=()=>sourcePromise ||= safeText(url);
  // 1.128.0 — PROACTIVE AUTO-DISCOVERY. Profiles created through the API always
  // carry the WooCommerce DEFAULT_SELECTORS (empty list selectors are rejected),
  // so "selectors not configured" never looked empty and the engines ran blind:
  // the discovery engines guessed cards while the selector engines silently
  // matched nothing, and any shop the discovery engines could not read ended
  // the run with 0 products. When the selectors were never configured for this
  // shop (empty, partial, or still the defaults), repair them from the fetched
  // page BEFORE the engine loop — reusing the same HTML, so no extra fetch —
  // and report what was found so the caller can persist it. Fully custom
  // selectors keep the exact old behavior (the job-level last-resort rescue in
  // processor.ts still covers custom selectors that break later).
  let activeSelectors = selectors;
  let discoveredSelectors: Partial<Selectors> | undefined;
  let discoveryMethod = '';
  if (autoDiscover && listSelectorsStatus(selectors) !== 'custom') {
    try {
      const { text, url: finalUrl } = await source();
      if (!verifyListSelectors(text, finalUrl, selectors).ok) {
        const found = discoverListSelectorsFromHtml(text, finalUrl);
        const merged = { ...selectors, ...found.selectors } as Selectors;
        if (found.method !== 'none' && found.selectors.container && found.selectors.title && verifyListSelectors(text, finalUrl, merged).ok) {
          activeSelectors = merged;
          discoveredSelectors = found.selectors;
          discoveryMethod = found.method;
        }
      }
    } catch { /* discovery is best-effort; the engine loop below still runs */ }
  }
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
    // 1.136.0 — skip browser engines in ~1ms when no browser is reachable
    // instead of paying a doomed launch (tens of seconds each) on every
    // zero-result page. An explicit choice still fails loudly with the fix.
    if (BROWSER_ENGINES.has(name) && !browserEngineAvailable()) {
      if (engine !== 'auto' && name === engine) throw new Error('مرورگری روی این دستگاه پیدا نشد؛ موتورهای مرورگر بدون آن اجرا نمی‌شوند. روی Termux دستور pkg install chromium را اجرا کنید یا BROWSER_EXECUTABLE_PATH را تنظیم کنید.');
      return [] as Product[];
    }
    if (name === 'playwright') return scrapeListWithPlaywright(url, activeSelectors);
    if (name === 'puppeteer') return scrapeListWithPuppeteer(url, activeSelectors);
    if (name === 'crawlee_playwright') return scrapeListWithCrawleePlaywright(url, activeSelectors);
    const { text, url: finalUrl } = await source();
    if (name === 'cheerio' || name === 'htmlrewriter') return scrapeListCheerioFromHtml(text, finalUrl, activeSelectors);
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
      if(products.length)return{products,usedEngine:name,elapsedMs:Date.now()-started,nextUrl:await nextLink(),selectorsUsed:activeSelectors,discoveredSelectors,discoveryMethod};
      // The explicit engine ran and found nothing: fall through to the
      // remaining engines instead of returning an empty result, but remember
      // the requested engine so an all-empty run still reports what was asked.
    }catch(error){
      if(engine!=='auto'&&name===engine)throw error;
      if(BROWSER_ENGINES.has(name))lastBrowserError=`${name}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`;
    }
  }
  return{products:[],usedEngine:engine,elapsedMs:Date.now()-started,nextUrl:await nextLink(),selectorsUsed:activeSelectors,discoveredSelectors,discoveryMethod};
}
export async function scrapeList(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', autoDiscover = true): Promise<Product[]> { return (await scrapeListWithMeta(url, selectors, engine, undefined, true, '', autoDiscover)).products; }

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
/** A goto interrupted by the page's own redirect/reload rejects with net::ERR_ABORTED even though the follow-up page loads fine — survivable. */
function isAbortedNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ERR_ABORTED');
}
async function scrapeRenderedHtml(url: string, selectors: Selectors, driver: 'playwright'|'puppeteer'): Promise<Product[]> {
  const executablePath = browserExecutable(driver);
  if (driver === 'playwright') {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, executablePath, args: browserLaunchArgs() });
    try {
      const page = await browser.newPage({ locale: 'fa-IR' });
      // goto waits only for parsed DOM: shops routinely redirect/reload
      // mid-load (cookie checks, bot screens, framework routers), which
      // aborts a networkidle goto with net::ERR_ABORTED even though the
      // follow-up page loads fine. On abort, settle and read whatever
      // actually landed instead of failing the whole run.
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      } catch (navigationError: unknown) {
        if (!isAbortedNavigation(navigationError)) throw navigationError;
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
      }
      // Best-effort idle window for JavaScript rendering; pages with
      // ever-open connections (ads, analytics) may never idle.
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
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
    // Same resilience as the Playwright branch above: domcontentloaded goto,
    // survive ERR_ABORTED, best-effort idle window for rendering.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (navigationError: unknown) {
      if (!isAbortedNavigation(navigationError)) throw navigationError;
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }
    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => undefined);
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
  // Same browser resolution as the Playwright/Puppeteer engines: drive the
  // detected system Chromium (Termux/VPS/desktop) with sandbox-free flags.
  // Crawlee's default launch looks for Playwright's bundled browsers, which
  // .npmrc deliberately skips — and which could never execute on Android
  // (desktop-Linux glibc binaries vs Android's Bionic libc) anyway.
  const executablePath = browserExecutable('playwright');
  const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, launchContext: { launchOptions: { headless: true, executablePath, args: browserLaunchArgs() } }, requestHandler: async ({ page }) => {
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
// True-ancestor matching on raw HTML (1.136.0): the nearest PRECEDING open
// tag is often a sibling subtree, and the first close after the anchor often
// ends a nested child — both built frankenchunks that clustered under the
// wrong signature and failed verification. Walk the tag depth instead.
function enclosingOpen(html: string, pos: number, tag: string, endTag: string): number {
  let extra = 0, cursor = pos;
  while (cursor > 0) {
    const closeAt = html.lastIndexOf(endTag, cursor - 1), openAt = html.lastIndexOf('<' + tag, cursor - 1);
    if (openAt < 0) return -1;
    if (closeAt > openAt) { extra++; cursor = closeAt; continue; }
    if (extra === 0) return openAt;
    extra--; cursor = openAt;
  }
  return -1;
}
function matchingClose(html: string, openPos: number, tag: string, endTag: string): number {
  const openEnd = html.indexOf('>', openPos);
  if (openEnd < 0) return -1;
  let depth = 1, cursor = openEnd + 1;
  while (depth > 0) {
    if (cursor - openPos > 6000) return -1;
    const nextOpen = html.indexOf('<' + tag, cursor), nextClose = html.indexOf(endTag, cursor);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; cursor = nextOpen + 1; }
    else { depth--; if (depth === 0) return nextClose; cursor = nextClose + endTag.length; }
  }
  return -1;
}
function enclosingChunks(html: string, index: number): string[] {
  // Ancestor article/li/tr/div slices, nearest-first (Python parity: the old
  // scraper4.py climbed until the node held an image AND a price).
  const out: string[] = []; let cursor = index;
  for (let level = 0; level < 6 && cursor > 0; level++) {
    let best = '', bestOpen = -1;
    for (const [tag, endTag] of [['article', '</article>'], ['li', '</li>'], ['tr', '</tr>'], ['div', '</div>']] as const) {
      const open = enclosingOpen(html, cursor, tag, endTag);
      if (open < 0 || index - open > 1800) continue;
      const end = matchingClose(html, open, tag, endTag);
      if (end < 0 || end - open > 5000) continue;
      const chunk = html.slice(open, end + endTag.length);
      if (!best || chunk.length < best.length) { best = chunk; bestOpen = open; }
    }
    if (!best || bestOpen < 0) break;
    out.push(best); cursor = bestOpen;
  }
  return out;
}
function productContextChunk(html: string, index: number, anchor: string): string {
  void anchor;
  const candidates = enclosingChunks(html, index);
  if (!candidates.length) return '';
  // Prefer the smallest ancestor that actually holds the card fields; nested
  // cards (media link here, price two divs up) otherwise lose half their data.
  return candidates.find(chunk => /<img\b/i.test(chunk) && PRICE_HINT_RE.test(stripPriceFormatChars(chunk))) || candidates[0];
}
function metadataProduct(html: string, baseUrl: string): Product[] { const title = meta(html, 'og:title') || meta(html, 'twitter:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''); if (!title) return []; const ogType = (meta(html, 'og:type') || '').toLowerCase(), productUrl = absolute(meta(html, 'og:url') || baseUrl, baseUrl), priceText = meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || '', image = absolute(meta(html, 'og:image') || meta(html, 'twitter:image'), baseUrl), price = numberFromText(priceText); if (!/(?:product|product.item)/i.test(ogType) || !priceText || price <= 0 || !image) return []; return [{ sourceKey: sourceKey(productUrl, title), title, price, priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }]; }
function scriptJsonProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)) { const body = decodeHtml(m[1]); if (!/(product|products|price|__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__)/i.test(body)) continue; for (const j of body.matchAll(/(?:window\.)?(?:__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__)?\s*=\s*(\{[\s\S]{50,200000}\}|\[[\s\S]{50,200000}\])\s*;?/g)) { try { walkObjects(JSON.parse(j[1]), baseUrl, out); } catch {} } } return dedupe(out); }
function chunkTitle(chunk: string): string {
  // Last-resort title: longest non-price leaf text (1.136.0; tw-deep parity —
  // the title span sits outside the media link, so h1-h4/alt/inner all miss).
  let best = '';
  for (const m of chunk.matchAll(/<(span|div|p|h5|h6|strong|b|em|li|td)\b[^>]*>([^<>]{6,160})<\/\1>/gi)) {
    const text = normalize(decodeHtml(m[2] || ''));
    if (text.length >= 6 && text.length > best.length && !looksLikePrice(text)) best = text;
  }
  return best;
}
function heuristicImage(chunk: string, baseUrl: string): string {
  // data-* before src: a greedy alternation used to match the LAST attribute
  // (often a placeholder src) and ship 1px gifs as product images (1.136.0).
  const tag = chunk.match(/<img\b[^>]*>/i)?.[0] || '';
  const dataSrc = tag.match(/\sdata-(?:src|lazy-src|lazyload|original|image)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
  const srcAttr = (tag.match(/\ssrc(?:set)?\s*=\s*["']([^"']+)["']/i)?.[1] || '').split(',')[0].trim().split(/\s+/)[0];
  const raw = decodeHtml(dataSrc || srcAttr);
  if (!raw || /^(data:|blob:|javascript:|#)/i.test(raw) || /(?:placeholder|spacer|transparent|loading)(?:[-_.]|$)/i.test(raw)) return '';
  return absolute(raw, baseUrl);
}
// Category/collection/tag links live inside product cards and inherit their
// image+price context, so without this guard they become phantom products.
// The word must end at a path boundary so slugs like «category-theory-book»
// still pass.
const NON_PRODUCT_URL_RE = /[\/-](category|categories|collection|collections|tag|tags|brand|brands|search|blog|news|page)([\/?#]|$)/i;
export function heuristicProducts(html: string, baseUrl: string): Product[] {
  const out: Product[] = []; const seenUrls = new Set<string>();
  // 1.136.0 — first anchor per URL wins: cards with a media link AND a title
  // link otherwise extract twice; /shop/ and snp- match the old scraper4.py.
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,2500}?)<\/a>/gi)) { const productUrl = absolute(decodeHtml(m[1]), baseUrl); if (!productUrl || seenUrls.has(productUrl) || !/(product|products|\/p\/|\/pd\/|\/shop\/|snp-|kala|sku)/i.test(productUrl) || NON_PRODUCT_URL_RE.test(productUrl)) continue; const chunk = productContextChunk(html, m.index || 0, m[0]); if (!chunk) continue; const title = stripHtml(chunk.match(/<h[1-4]\b[^>]*>([\s\S]{0,500}?)<\/h[1-4]>/i)?.[1] || '') || normalize(decodeHtml(chunk.match(/<img\b[^>]*(?:alt|title)=["']([^"']+)["']/i)?.[1] || '')) || stripHtml(m[2]) || chunkTitle(chunk); const image = heuristicImage(chunk, baseUrl); const priceText = normalize(stripPriceFormatChars(chunk).match(PRICE_HINT_RE)?.[0] || ''); if (!title || title.length < 3 || !image || !priceText || numberFromText(priceText) <= 0) continue; seenUrls.add(productUrl); out.push({ sourceKey: sourceKey(productUrl, title), title, price: numberFromText(priceText), priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }); } return dedupe(out); }

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
  container:{selectors:['li.product','article.product','.products .product','.product-card','.product-item','[data-product-id]',
    // Generic / non-WooCommerce grids (1.128.0). Platform-specific guesses stay
    // first; these only win when nothing above matched. Structural inference
    // below is the real fallback when none of these exist either.
    'article','[class*="product-card"]','[class*="product-item"]','[class*="product-box"]','[data-product]','.grid-item','.product','.product-box','.item-card']},
  title:{selectors:['.woocommerce-loop-product__title','.product-title','.card-title','h2','h3','[itemprop="name"]',
    '.product-name','[class*="product-title"]','[class*="product-name"]','.name','h4']},
  price:{selectors:['.price ins','.sale-price','.price','[itemprop="price"]','.amount',
    '[class*="price"]','.money','[data-price]','.product-price']},
  link:{type:'link',selectors:['a.woocommerce-LoopProduct-link','a.product-link','a[href*="/product/"]','a[href]','h2 a','h3 a','article a[href]']},
  image:{type:'image',selectors:['img.wp-post-image','img.product-image','picture img','img','.product-media img','article img']},
  shortDesc:{selectors:['.woocommerce-product-details__short-description','.short-description','[itemprop="description"]','.product-info','.short-desc','[class*="short-description"]']},
  longDesc:{selectors:['#tab-description','.woocommerce-Tabs-panel--description','.product-description','.description','.product-tabs','[class*="description"]']},
  sku:{selectors:['.sku','[itemprop="sku"]','[data-sku]','[class*="sku"]']},
  brand:{selectors:['.brand','[itemprop="brand"]','.product-brand','[class*="brand"]']},
  stock:{selectors:['.stock','[itemprop="availability"]','.inventory']},
  weight:{selectors:['.product_weight','.weight','[data-weight]']},
  category:{selectors:['.posted_in','.product_meta .category','.breadcrumb']},
  tags:{selectors:['.tagged_as','.product_meta .tags','[rel="tag"]']},
  detailImage:{type:'image',selectors:['.woocommerce-product-gallery__image img','.product-main-image img','img.wp-post-image','[itemprop="image"]']},
  gallery:{type:'image',selectors:['.woocommerce-product-gallery img','.product-gallery img','[data-gallery] img','.gallery img','.product-images img','[class*="gallery"] img']},
  variations:{selectors:['.variations','.variations_form','[data-product_variations]','.product-options']}
};
export async function suggestSelectors(url:string,mode:'list'|'detail'|'all'='all'){
  const page=await safeText(url,4_000_000),selectors:Record<string,string>={},evidence:Record<string,unknown>={};
  // List fields go through the same discovery the engines use (1.128.0), so the
  // dashboard button proposes structural selectors for unknown shops too.
  if(mode==='list'||mode==='all'){
    const found=discoverListSelectorsFromHtml(page.text,page.url);
    for(const [key,value] of Object.entries(found.selectors))if(value)selectors[key]=value as string;
    for(const [key,value] of Object.entries(found.evidence))evidence[key]=value;
    evidence.discoveryMethod=found.method;evidence.containerCount=found.containerCount;
  }
  if(mode==='detail'||mode==='all'){
    const wanted=['shortDesc','price','longDesc','sku','category','tags','weight','stock','brand','detailImage','gallery','variations'];
    for(const field of wanted){const config=SUGGESTION_CANDIDATES[field];if(!config)continue;for(const candidate of config.selectors)try{const values=extractSelectorValuesSync(page.text,page.url,candidate,config.type||'text');const count=values.length,minimum=1;if(count>=minimum){selectors[field]=candidate;evidence[field]={count,sample:values[0]||''};break}}catch{}}
  }
  return{url:page.url,mode,selectors,evidence};
}
function extractSelectorValuesSync(html:string,baseUrl:string,selector:string,type:'text'|'link'|'image'='text'):string[]{const $=cheerio.load(html),values:string[]=[];$(selector).slice(0,50).each((_i,el)=>{const node=$(el);const raw=type==='link'?(node.attr('href')||node.find('a[href]').first().attr('href')||''):type==='image'?(node.attr('src')||node.attr('data-src')||node.find('img').first().attr('src')||node.find('img').first().attr('data-src')||''):node.text();const value=type==='text'?normalize(raw):absolute(raw,baseUrl);if(value)values.push(value.slice(0,1000))});return values}
async function extractSelectorValues(html:string,baseUrl:string,selector:string,type:'text'|'link'|'image'='text'):Promise<string[]>{return extractSelectorValuesSync(html,baseUrl,selector,type)}

// ---------------------------------------------------------------------------
// Proactive list-selector auto-discovery (1.128.0, Render/Node runtime).
//
// "Selectors not configured" is NOT "all empty": normalizeProfile() fills every
// new profile with WooCommerce DEFAULT_SELECTORS and rejects empties, so an
// unconfigured profile looks exactly like a WooCommerce one. Auto-discovery
// therefore triggers on empty, partial AND still-default selectors, verifies
// proposals against the real page, and only then lets the engines run with
// them. Fully custom selectors are left untouched.
// ---------------------------------------------------------------------------
const LIST_SELECTOR_KEYS = ['container','title','price','link','image'] as const;
export type SelectorConfigStatus = 'empty' | 'partial' | 'default' | 'custom';
export function listSelectorsStatus(selectors: Selectors | undefined | null): SelectorConfigStatus {
  const values = LIST_SELECTOR_KEYS.map(key => String((selectors as any)?.[key] || '').trim());
  if (values.every(value => !value)) return 'empty';
  if (values.some(value => !value)) return 'partial';
  const isDefault = LIST_SELECTOR_KEYS.every(key => String((selectors as any)?.[key]).trim() === String((DEFAULT_SELECTORS as any)[key]));
  return isDefault ? 'default' : 'custom';
}

export type SelectorFieldEvidence = { count: number; sample: string };
export type ListSelectorVerification = {
  containerCount: number;
  cardsSampled: number;
  title: SelectorFieldEvidence;
  price: SelectorFieldEvidence;
  link: SelectorFieldEvidence;
  image: SelectorFieldEvidence;
  /** Container repeats and titles resolve inside most cards. */
  ok: boolean;
};
const emptyVerification = (containerCount = 0): ListSelectorVerification => ({
  containerCount, cardsSampled: 0,
  title: { count: 0, sample: '' }, price: { count: 0, sample: '' },
  link: { count: 0, sample: '' }, image: { count: 0, sample: '' }, ok: false
});
/**
 * Check list selectors against REAL page HTML the same way extraction reads it:
 * container matches are counted page-wide, but title/price/link/image must
 * resolve INSIDE each card (scopedMatches), otherwise the evidence is the
 * classic contradiction — green page-wide, zero products.
 */
export function verifyListSelectors(html: string, baseUrl: string, selectors: Selectors): ListSelectorVerification {
  const container = String(selectors?.container || '').trim();
  if (!container || !html) return emptyVerification();
  let $: cheerio.CheerioAPI;
  try { $ = cheerio.load(html); } catch { return emptyVerification(); }
  let containerCount = 0, nodes: any[] = [];
  try { const all = containerNodes($, container); containerCount = all.length; nodes = all.slice(0, 12).toArray(); } catch { return emptyVerification(); }
  if (!nodes.length) return emptyVerification(containerCount);
  const hits = { title: { count: 0, sample: '' }, price: { count: 0, sample: '' }, link: { count: 0, sample: '' }, image: { count: 0, sample: '' } };
  for (const element of nodes) {
    const root = $(element);
    const title = firstText($, root, String(selectors.title || ''));
    if (title) { hits.title.count++; hits.title.sample ||= title.slice(0, 200); }
    const priceText = firstText($, root, String(selectors.price || ''));
    if (priceText && numberFromText(priceText) > 0) { hits.price.count++; hits.price.sample ||= priceText.slice(0, 200); }
    const link = absolute(productLink($, root, String(selectors.link || '')), baseUrl);
    if (link) { hits.link.count++; hits.link.sample ||= link.slice(0, 200); }
    let imageValue = firstAttr($, root, String(selectors.image || ''), ['data-src', 'data-lazy-src', 'data-original', 'src']);
    if (!imageValue) imageValue = (firstAttr($, root, String(selectors.image || ''), ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
    if (absolute(imageValue, baseUrl)) { hits.image.count++; hits.image.sample ||= absolute(imageValue, baseUrl).slice(0, 200); }
  }
  // Title is mandatory (extraction skips title-less cards); price/link/image
  // are reported but do not fail verification — "without price" products are
  // filtered later with their own warning, not here.
  const needed = Math.max(1, Math.ceil(nodes.length / 2));
  return { containerCount, cardsSampled: nodes.length, ...hits, ok: containerCount >= 2 && hits.title.count >= needed };
}

const PRICE_HINT_RE = /[۰-۹٠-٩\d][۰-۹٠-٩\d,٬.,\s]{0,30}\s*(?:تومان|تومن|ریال|IRR|IRT|USD|EUR|GBP|€|\$|£|TL|₺|AED|درهم|﷼)/i;
const THOUSANDS_RE = /[0-9۰-۹٠-٩]{1,3}([,٬.][0-9۰-۹٠-٩]{3})+/;
// Tatweel/kashida-styled prices (e.g. «تومــانـ») and zero-width
// joiners defeat plain currency matching; strip ornamental format chars
// before every price test/extraction.
const PRICE_FORMAT_CHARS_RE = /[ـ‌‍﻿]/g;
function stripPriceFormatChars(value: string): string { return value.replace(PRICE_FORMAT_CHARS_RE, ''); }
function looksLikePrice(text: string): boolean {
  const value = stripPriceFormatChars(normalize(text));
  if (!value || value.length > 80) return false;
  if (PRICE_HINT_RE.test(value)) return numberFromText(value) > 0;
  return THOUSANDS_RE.test(value) && numberFromText(value) > 0;
}
function cssEscapeIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, char => '\\' + char).replace(/^(\d)/, '\\3$1 ');
}
const VOLATILE_CLASS_RE = /^(active|selected|current|open|opened|hover|focus|disabled|loading|ng-|v-|is-|has-|js-)/i;
const HASH_CLASS_RE = /^[a-f0-9]{6,}$/i;
function stableClasses(classAttr: string | undefined): string[] {
  const all = String(classAttr || '').split(/\s+/).filter(Boolean);
  const stable = all.filter(name => name.length <= 40 && !VOLATILE_CLASS_RE.test(name) && !HASH_CLASS_RE.test(name));
  // Prefer plain readable classes over escaped Tailwind utilities.
  const rank = (name: string) => (/[^a-zA-Z0-9_-]/.test(name) ? 100 : 0) + name.length;
  return [...new Set(stable)].sort((a, b) => rank(a) - rank(b));
}
/** Minimal `tag.class` selector for an element (relative-safe inside a card). */
function selectorForElement($: cheerio.CheerioAPI, element: any): string {
  const tag = String(element?.tagName || element?.name || '').toLowerCase() || '*';
  const classes = stableClasses($(element).attr('class'));
  if (classes.length >= 2) return `${tag}.${cssEscapeIdent(classes[0])}.${cssEscapeIdent(classes[1])}`;
  if (classes.length === 1) return `${tag}.${cssEscapeIdent(classes[0])}`;
  const id = String($(element).attr('id') || '').trim();
  if (id && /^[a-zA-Z][\w:.-]*$/.test(id)) return `${tag}#${id}`;
  return tag;
}

export type ListDiscoveryMethod = 'curated' | 'structural' | 'mixed' | 'none';
export type ListDiscovery = {
  selectors: Partial<Selectors>;
  evidence: Record<string, unknown>;
  method: ListDiscoveryMethod;
  containerCount: number;
};
/**
 * Find list selectors for a page whose profile never configured them.
 *
 * Pass 1 tests the curated e-commerce selector list (fast, precise on known
 * platforms). Pass 2 — structural inference — handles everything else: it
 * clusters link+image subtrees by their tag+class signature, picks the
 * repeating product-card pattern, and derives title/price/link/image selectors
 * from inside the cards. Every proposal is verified against the same HTML
 * before it is returned, so callers can persist it without a second check.
 */
export function discoverListSelectorsFromHtml(html: string, baseUrl: string): ListDiscovery {
  const selectors: Partial<Selectors> = {};
  const evidence: Record<string, unknown> = {};
  for (const field of LIST_SELECTOR_KEYS) {
    const config = SUGGESTION_CANDIDATES[field];
    for (const candidate of config.selectors) {
      try {
        const values = extractSelectorValuesSync(html, baseUrl, candidate, config.type || 'text');
        const minimum = field === 'container' ? 2 : 1;
        if (values.length >= minimum) {
          (selectors as any)[field] = candidate;
          evidence[field] = { count: values.length, sample: (values[0] || '').slice(0, 200), via: 'curated' };
          break;
        }
      } catch { /* next candidate */ }
    }
  }
  let method: ListDiscoveryMethod = selectors.container && selectors.title ? 'curated' : 'none';
  if (!selectors.container || !selectors.title) {
    try {
      const structural = inferStructuralListSelectors(html, baseUrl);
      if (structural) {
        for (const [key, value] of Object.entries(structural.selectors)) {
          if (value && !(selectors as any)[key]) {
            (selectors as any)[key] = value;
            (evidence as any)[key] = { ...((structural.evidence as any)[key] || {}), via: 'structural' };
          }
        }
        method = method === 'curated' ? 'mixed' : 'structural';
      }
    } catch { /* structural pass is best-effort */ }
  }
  // Final gate: a container that does not repeat, or titles that do not resolve
  // INSIDE the cards, would be saved as fact — reject such proposals outright.
  let containerCount = 0;
  if (selectors.container && selectors.title) {
    const verified = verifyListSelectors(html, baseUrl, { ...DEFAULT_SELECTORS, ...selectors } as Selectors);
    containerCount = verified.containerCount;
    if (!verified.ok) return { selectors: {}, evidence: {}, method: 'none', containerCount };
  }
  return { selectors, evidence, method, containerCount };
}

/**
 * Structural card inference: cluster every link+image subtree by its
 * tag+class signature and treat the largest repeating cluster as the product
 * grid. Unlike the `heuristic` engine (which extracts products directly from
 * price-shaped text), this produces reusable CSS selectors, so the selector
 * engines — and every later page and run — work with them.
 */
function inferStructuralListSelectors(html: string, baseUrl: string): { selectors: Partial<Selectors>; evidence: Record<string, unknown> } | null {
  let $: cheerio.CheerioAPI;
  try { $ = cheerio.load(html); } catch { return null; }
  const groups = new Map<string, { nodes: any[]; seen: Set<object>; priceHits: number }>();
  let anchors: any[];
  try { anchors = $('a[href]').slice(0, 800).toArray(); } catch { return null; }
  if (anchors.length < 2) return null;
  for (const anchor of anchors) {
    const href = String($(anchor).attr('href') || '').trim();
    if (!href || href === '#' || /^javascript:/i.test(href)) continue;
    let current: any = anchor;
    for (let depth = 0; depth < 6 && current; depth++) {
      const element = current;
      current = element.parent;
      const tag = String(element.tagName || '').toLowerCase();
      if (!tag || tag === 'html' || tag === 'body') continue;
      // Page-level wrappers have many children; cards do not. This guard runs
      // before any subtree walk, so huge pages stay fast.
      if (depth > 0 && (element.children?.length || 0) > 40) continue;
      const $el = $(element);
      const linkCount = $el.find('a[href]').length + ($el.is('a[href]') ? 1 : 0);
      if (linkCount > 4) continue;
      const text = $el.text();
      if (!text || text.length < 12 || text.length > 1500) continue;
      const imgCount = $el.is('img') ? 1 : $el.find('img').length;
      if (!imgCount) continue;
      const signature = selectorForElement($, element);
      if (!signature.includes('.') && tag !== 'li' && tag !== 'article') continue;
      let group = groups.get(signature);
      if (!group) { group = { nodes: [], seen: new Set(), priceHits: 0 }; groups.set(signature, group); }
      if (group.seen.has(element)) continue;
      group.seen.add(element);
      group.nodes.push(element);
      if (PRICE_HINT_RE.test(stripPriceFormatChars(text)) || THOUSANDS_RE.test(text)) group.priceHits++;
    }
  }
  const clusters = [...groups.entries()]
    .map(([selector, group]) => ({ selector, nodes: group.nodes, priceHits: group.priceHits }))
    .filter(cluster => cluster.nodes.length >= 2)
    .sort((a, b) => (b.nodes.length * (1 + b.priceHits)) - (a.nodes.length * (1 + a.priceHits)));
  for (const cluster of clusters.slice(0, 5)) {
    const derived = deriveStructuralFieldSelectors($, cluster.nodes.slice(0, 8));
    if (!derived || !derived.title) continue;
    const linkSelector = derived.cardIsLink ? cluster.selector : 'a[href]';
    const merged = { ...DEFAULT_SELECTORS, container: cluster.selector, title: derived.title, price: derived.price || '', link: linkSelector, image: 'img' } as Selectors;
    const verified = verifyListSelectors(html, baseUrl, merged);
    if (!verified.ok) continue;
    return {
      selectors: { container: cluster.selector, title: derived.title, ...(derived.price ? { price: derived.price } : {}), link: linkSelector, image: 'img' },
      evidence: {
        container: { count: verified.containerCount, sample: cluster.selector },
        title: verified.title, price: verified.price, link: verified.link, image: verified.image
      }
    };
  }
  return null;
}

/** Derive title/price selectors from inside sampled cards of one cluster. */
function deriveStructuralFieldSelectors($: cheerio.CheerioAPI, sampleNodes: any[]): { title: string; price: string; cardIsLink: boolean } | null {
  const titleVotes = new Map<string, { count: number; bonus: number }>();
  const priceVotes = new Map<string, { count: number; length: number }>();
  let cardIsLink = 0;
  for (const node of sampleNodes) {
    const root = $(node);
    if (root.is('a[href]')) cardIsLink++;
    // Title: headings/itemprop first, else the longest mid-length text node.
    let titleSig = '';
    const heading = root.find('h1,h2,h3,h4,[itemprop="name"]').filter((_i, el) => {
      const text = normalize($(el).text());
      return text.length >= 8 && text.length <= 200 && !looksLikePrice(text);
    }).first();
    if (heading.length) titleSig = selectorForElement($, heading.get(0));
    else {
      // Ties go to the LATER (deeper/leaf) element: document order puts a
      // wrapping link before the inner span holding the same title, and the
      // wrapper also matches image-only siblings whose empty text then fails
      // verification (1.136.0; mirrors the price tie-break below).
      let bestLen = 0, bestIndex = -1;
      root.find('span,div,p,a,li,td,strong,b').slice(0, 120).each((index, el) => {
        const text = normalize($(el).text());
        if (text.length >= 15 && text.length <= 160 && (text.length > bestLen || (text.length === bestLen && index > bestIndex)) && !looksLikePrice(text)) {
          bestLen = text.length; bestIndex = index;
          titleSig = selectorForElement($, el);
        }
      });
    }
    if (titleSig) {
      const vote = titleVotes.get(titleSig) || { count: 0, bonus: /^h[1-4][.]/.test(titleSig) ? 2 : 0 };
      vote.count++;
      titleVotes.set(titleSig, vote);
    }
    // Price: the SHORTEST price-shaped text — wrappers that also contain the
    // title lose to the leaf element that holds just the price. On a length
    // tie the deeper element wins (document order puts parents first, so the
    // later index is the leaf): a wrapper that also matches today may also
    // match an old-price/discount sibling tomorrow.
    const priceCandidates: Array<{ sig: string; length: number; index: number }> = [];
    root.find('*').slice(0, 150).each((index, el) => {
      const text = $(el).text();
      if (text && text.length <= 80 && looksLikePrice(text)) {
        priceCandidates.push({ sig: selectorForElement($, el), length: normalize(text).length, index });
      }
    });
    priceCandidates.sort((a, b) => a.length - b.length || b.index - a.index);
    if (priceCandidates.length) {
      const winner = priceCandidates[0].sig;
      const vote = priceVotes.get(winner) || { count: 0, length: priceCandidates[0].length };
      vote.count++;
      priceVotes.set(winner, vote);
    }
  }
  const titleWinner = [...titleVotes.entries()].sort((a, b) => (b[1].count * 10 + b[1].bonus) - (a[1].count * 10 + a[1].bonus))[0];
  if (!titleWinner) return null;
  const priceWinner = [...priceVotes.entries()].sort((a, b) => b[1].count - a[1].count || a[1].length - b[1].length)[0];
  return { title: titleWinner[0], price: priceWinner ? priceWinner[0] : '', cardIsLink: cardIsLink * 2 >= sampleNodes.length };
}
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
export type EngineDiagnosis = {
  engine: ExtractionEngine;
  /** Cards/candidates the engine's source sees on the benchmark's first page. */
  candidates: number;
  /** Unique products this engine kept across the scanned pages. */
  extracted: number;
  complete: { title: number; price: number; link: number; image: number };
  sample: { title: string; priceText: string; url: string; image: string } | null;
  /** Persian: why zero / why partial. Empty when the engine is fully healthy. */
  dropReasons: string[];
  /** Persian one-liner: what this means and what to do next. */
  hint: string;
  signals: Record<string, number | string | boolean>;
};

const countMatches = (html: string, re: RegExp): number => {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let n = 0;
  global.lastIndex = 0;
  while (global.exec(html)) { n++; if (n > 5000) break; }
  return n;
};

/**
 * Per-engine diagnosis for the 3-page speed test (1.137.0). The benchmark
 * used to report counts only, so a zero meant nothing actionable. This runs
 * cheap signal checks on ONE shared first-page fetch (the caller fetches it
 * once per benchmark, not once per engine) plus field completeness over the
 * engine's own products, and turns both into Persian why/why-partial reasons
 * and a next-step hint. Twin: worker-src/scraper.ts diagnoseBenchmarkEngine.
 */
export async function diagnoseBenchmarkEngine(
  engine: ExtractionEngine, html: string, baseUrl: string, selectors: Selectors,
  products: Product[], error = ''
): Promise<EngineDiagnosis> {
  const list = Array.isArray(products) ? products : [];
  const complete = { title: 0, price: 0, link: 0, image: 0 };
  for (const p of list) {
    if (p.title) complete.title++;
    if (Number(p.price) > 0) complete.price++;
    if (p.url) complete.link++;
    if (p.image) complete.image++;
  }
  const first = list.find(p => p.title || p.url) || list[0];
  const sample = first
    ? { title: String(first.title || ''), priceText: String(first.priceText || ''), url: String(first.url || ''), image: String(first.image || '') }
    : null;
  const dropReasons: string[] = [];
  const signals: Record<string, number | string | boolean> = {};
  const text = String(html || '');
  let candidates = 0, hint = '';
  const partialNote = (): string => {
    const missing: string[] = [];
    if (complete.title < list.length) missing.push('عنوان');
    if (complete.price < list.length) missing.push('قیمت');
    if (complete.link < list.length) missing.push('لینک');
    if (complete.image < list.length) missing.push('تصویر');
    return missing.length ? ` ولی ${list.length - Math.min(complete.title, complete.price, complete.link, complete.image)} محصول ${missing.join('/')} کامل ندارند` : '';
  };
  if (!text) {
    candidates = list.length;
    signals.pageFetched = false;
    if (error) dropReasons.push(error);
    else if (!list.length) dropReasons.push('صفحهٔ اول برای بررسی سیگنال‌ها دریافت نشد و محصولی هم استخراج نشد.');
    hint = list.length
      ? `موتور ${list.length} محصول استخراج کرد (صفحهٔ اول برای بررسی عمیق در دسترس نبود).`
      : 'دسترسی شبکه به صفحهٔ اول ناموفق بود؛ آدرس و اتصال را بررسی کنید.';
    return { engine, candidates, extracted: list.length, complete, sample, dropReasons, hint, signals };
  }
  signals.pageFetched = true;
  if (engine === 'cheerio' || engine === 'htmlrewriter') {
    let verified: ListSelectorVerification | null = null;
    try { verified = verifyListSelectors(text, baseUrl, selectors); } catch { verified = null; }
    const containers = verified?.containerCount || 0;
    const titles = verified?.title.count || 0, prices = verified?.price.count || 0;
    const links = verified?.link.count || 0, images = verified?.image.count || 0;
    candidates = containers;
    signals.containers = containers; signals.titles = titles; signals.prices = prices; signals.links = links; signals.images = images;
    const containerSel = String((selectors as any)?.container || '').trim();
    if (!containerSel) {
      dropReasons.push('سلکتور ظرف خالی است؛ موتور سلکتوری بدون ظرف نمی‌تواند کارتی پیدا کند.');
      hint = 'سلکتور ظرف را وارد کنید یا «پیشنهاد خودکار سلکتورها» را بزنید.';
    } else if (!containers) {
      dropReasons.push(`سلکتور ظرف «${containerSel}» هیچ کارتی در صفحه پیدا نکرد.`);
      hint = 'سلکتور ظرف اشتباه است یا صفحه جاوااسکریپتی است؛ «پیشنهاد خودکار سلکتورها» را بزنید.';
    } else if (!titles) {
      dropReasons.push(`${containers} کارت پیدا شد ولی داخل هیچ‌کدام عنوانی نیست؛ یعنی سلکتور عنوان بیرون از ظرف را می‌بیند یا ظرف کل فهرست را گرفته است.`);
      hint = 'سلکتور عنوان باید نسبت به ظرف داخلی باشد، یا ظرف باید هر کارت باشد نه کل فهرست.';
    } else if (!list.length) {
      if (error) dropReasons.push(error);
      if (!prices) dropReasons.push(`${containers} کارت و ${titles} عنوان هست ولی قیمت داخل کارت‌ها پیدا نشد.`);
      if (!links) dropReasons.push('لینک محصول داخل کارت‌ها پیدا نشد.');
      if (!images) dropReasons.push('تصویر داخل کارت‌ها پیدا نشد.');
      if (!dropReasons.length) dropReasons.push(`${containers} کارت دیده شد ولی هیچ محصول کاملی استخراج نشد.`);
      hint = 'سلکتورهای عنوان/قیمت/لینک/تصویر را نسبت به ظرف اصلاح کنید.';
    } else {
      if (containers > list.length) dropReasons.push(`از ${containers} کارت، ${list.length} محصول نگه داشته شد؛ بقیه عنوان/قیمت/تصویر کامل نداشتند.`);
      hint = `موتور سالم است: ${list.length} محصول استخراج شد${partialNote()}.`;
    }
  } else if (engine === 'jsonld') {
    const blocks = [...text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1] || '');
    const productBlocks = blocks.filter(b => /"@type"\s*:\s*"(Product|ItemList|ProductGroup|Offer|AggregateOffer|SearchResultsPage)"/i.test(b)).length;
    candidates = countMatches(text, /"@type"\s*:\s*"Product"/i) + countMatches(text, /"@type"\s*:\s*"ListItem"/i);
    signals.ldBlocks = blocks.length; signals.productBlocks = productBlocks;
    if (!blocks.length) { dropReasons.push('صفحه هیچ بلوک JSON-LD ندارد.'); hint = 'این سایت دادهٔ ساخت‌یافته ندارد؛ htmlrewriter یا heuristic را امتحان کنید.'; }
    else if (!list.length) { dropReasons.push(`${blocks.length} بلوک JSON-LD هست ولی هیچ‌کدام محصول یا فهرست محصول نیست.`); hint = 'بلوک‌های JSON-LD این صفحه محصول ندارند؛ htmlrewriter یا heuristic را امتحان کنید.'; }
    else hint = `موتور سالم است: ${list.length} محصول از JSON-LD استخراج شد${partialNote()}.`;
  } else if (engine === 'next_data') {
    const m = text.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    const payload = m?.[1] || '';
    candidates = countMatches(payload, /"(price|priceText|finalPrice|salePrice)"\s*:/i);
    signals.hasNextData = Boolean(m); signals.nextBytes = payload.length; signals.priceKeys = candidates;
    if (!m) { dropReasons.push('صفحه دادهٔ __NEXT_DATA__ ندارد (سایت Next.js نیست).'); hint = 'این موتور فقط برای سایت‌های Next.js است؛ موتور دیگری را امتحان کنید.'; }
    else if (!list.length) { dropReasons.push('دادهٔ __NEXT_DATA__ هست ولی موتور محصولی از آن استخراج نکرد؛ ساختار کاتالوگ با الگوهای شناخته‌شده فرق دارد.'); hint = 'کاتالوگ داخل __NEXT_DATA__ ساختار غیراستاندارد دارد؛ heuristic یا موتور سلکتوری را امتحان کنید.'; }
    else hint = `موتور سالم است: ${list.length} محصول از __NEXT_DATA__ استخراج شد${partialNote()}.`;
  } else if (engine === 'script_json') {
    const inline = [...text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1] || '');
    const withProduct = inline.filter(s => /"(price|priceText|finalPrice|salePrice)"\s*:/i.test(s) && /"(title|name|productName)"\s*:/i.test(s)).length;
    candidates = countMatches(text, /"(price|priceText|finalPrice|salePrice)"\s*:/i);
    signals.inlineScripts = inline.length; signals.productScripts = withProduct; signals.priceKeys = candidates;
    if (!withProduct) { dropReasons.push('هیچ اسکریپت درون‌خطی‌ای آبجکت محصول (نام+قیمت) ندارد.'); hint = 'این صفحه کاتالوگ JSON در اسکریپت ندارد؛ heuristic یا موتور سلکتوری را امتحان کنید.'; }
    else if (!list.length) { dropReasons.push(`${withProduct} اسکریپت دادهٔ محصول‌دار هست ولی موتور نتوانست آن‌ها را بخواند (ساختار غیراستاندارد).`); hint = 'ساختار JSON اسکریپت‌ها غیراستاندارد است؛ heuristic یا موتور سلکتوری را امتحان کنید.'; }
    else hint = `موتور سالم است: ${list.length} محصول از JSON اسکریپت استخراج شد${partialNote()}.`;
  } else if (engine === 'metadata') {
    const og = countMatches(text, /<meta\b[^>]*property=["']og:/i);
    candidates = /<meta\b[^>]*property=["']og:title["']/i.test(text) ? 1 : 0;
    signals.ogTags = og;
    if (!og) { dropReasons.push('صفحه متاتگ OpenGraph ندارد.'); hint = 'این موتور فقط برای صفحات دارای متاتگ og است؛ موتور دیگری را امتحان کنید.'; }
    else if (!list.length) { dropReasons.push('متاتگ og هست ولی محصول کاملی از آن ساخته نشد (این موتور تک‌محصولی است و برای صفحهٔ فهرست مناسب نیست).'); hint = 'موتور metadata برای صفحهٔ جزئیات تک‌محصول است، نه فهرست؛ heuristic یا موتور سلکتوری را امتحان کنید.'; }
    else hint = `موتور سالم است: ${list.length} محصول از متاتگ‌ها استخراج شد${partialNote()}.`;
  } else if (engine === 'heuristic') {
    let anchors = 0;
    for (const m of text.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
      if (/(product|products|\/p\/|\/pd\/|\/shop\/|snp-|kala|sku)/i.test(m[1] || '') && !NON_PRODUCT_URL_RE.test(m[1] || '')) anchors++;
      if (anchors > 5000) break;
    }
    const priceHints = countMatches(stripPriceFormatChars(text), PRICE_HINT_RE);
    const barePrices = countMatches(text, THOUSANDS_RE);
    const images = countMatches(text, /<img\b/i);
    candidates = anchors;
    signals.productAnchors = anchors; signals.priceHints = priceHints; signals.barePrices = barePrices; signals.images = images;
    if (!anchors) { dropReasons.push('هیچ لینکی با الگوی آدرس محصول (/product/ ،/shop/ ،snp- و…) پیدا نشد.'); hint = 'آدرس محصولات این سایت الگوی شناخته‌شده ندارد؛ موتور سلکتوری (htmlrewriter) را امتحان کنید.'; }
    else if (!list.length) {
      if (error) dropReasons.push(error);
      dropReasons.push(`${anchors} لینک محصول هست ولی هیچ‌کدام داخل کارتی با تصویر+قیمت کامل نبودند (حذف شدند).`);
      if (!priceHints && !barePrices) dropReasons.push('در کل صفحه هیچ متن قیمت‌داری (تومان/ریال/…) دیده نشد؛ احتمالاً قیمت‌ها با جاوااسکریپت می‌آیند.');
      else if (!priceHints) dropReasons.push(`${barePrices} عدد هزارگان‌بندی‌شده بدون واحد پولی دیده شد؛ احتمالاً واحد پول با استایل/جاوااسکریپت اضافه می‌شود یا قیمت‌ها داینامیک‌اند.`);
      hint = !priceHints ? 'قیمت‌ها احتمالاً با جاوااسکریپت بارگذاری می‌شوند؛ موتور مرورگری (نمایشی) را امتحان کنید.' : 'کارت‌ها تصویر یا قیمت کامل ندارند؛ موتور سلکتوری (htmlrewriter) را امتحان کنید.';
    } else {
      if (anchors > list.length) dropReasons.push(`از ${anchors} لینک محصول، ${list.length} محصول کامل نگه داشته شد؛ بقیه تصویر/قیمت/عنوان کامل نداشتند.`);
      hint = `موتور سالم است: ${list.length} محصول بدون نیاز به سلکتور پیدا شد${partialNote()}.`;
    }
  } else {
    candidates = list.length;
    signals.note = 'engine-specific signals are not measured for this engine';
    if (error) dropReasons.push(error);
    else if (!list.length) dropReasons.push('موتور محصولی استخراج نکرد.');
    hint = list.length ? `موتور ${list.length} محصول استخراج کرد${partialNote()}.` : (error || 'موتور محصولی استخراج نکرد؛ خطا را بررسی کنید.');
  }
  if (error && !dropReasons.includes(error) && !list.length) dropReasons.unshift(error);
  return { engine, candidates, extracted: list.length, complete, sample, dropReasons, hint, signals };
};

export async function diagnoseExtraction(profile: Profile, urlOverride = '') {
  const started = Date.now(), url = String(urlOverride || profile.url || '').trim();
  const stages: any[] = [], recommendations: string[] = [];
  const add = (name: string, ok: boolean, summary: string, details: any = {}) => stages.push({ name, ok, summary, ...details });
  if (!url) {
    add('configuration', false, 'آدرس مبدأ خالی است.');
    return { ok: false, profileId: profile.id, url, stages, selectorsToSave: {}, recommendations: ['آدرس صفحهٔ فهرست محصولات را در پروفایل وارد کنید.'] };
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
    return { ok: false, profileId: profile.id, url, durationMs: Date.now() - started, stages, selectorsToSave: {}, recommendations };
  }
  let products: Product[] = [], usedEngine: ExtractionEngine | '' = '';
  // 1.135.0 — verified discoveries the route persists when the profile's
  // selectors were never configured (empty/partial/default). Fully custom
  // selectors are never touched (the pipeline only reports discoveries for
  // non-custom sets), and an overridden test URL never rewrites the profile.
  const selectorsToSave: Record<string, string> = {};
  const overriddenTestUrl = String(urlOverride || '').trim().length > 0 && url !== String(profile.url || '').trim();
  try {
    const result = await scrapeListWithMeta(page.url, profile.selectors, profile.extractionEngine || 'auto', profile.extractionEngineMaster);
    products = result.products; usedEngine = result.usedEngine;
    if (!overriddenTestUrl && result.discoveredSelectors) for (const [key, value] of Object.entries(result.discoveredSelectors)) if (String(value || '').trim()) selectorsToSave[key] = String(value);
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
  // 1.128.0 — when nothing extracted, show what proactive auto-discovery sees
  // on the same page. Verified discoveries above are handed to the route for
  // auto-save (1.135.0); this block still shows raw, unverified findings for
  // the manual suggest button when auto-save had nothing to persist.
  if (!products.length) {
    try {
      const discovery = discoverListSelectorsFromHtml(page.text, page.url);
      const proposed = Object.entries(discovery.selectors).filter(([, value]) => String(value || '').trim());
      if (discovery.method !== 'none' && proposed.length >= 2 && discovery.selectors.container && discovery.selectors.title) {
        add('selector-discovery', true,
          `موتور استخراج ${discovery.containerCount.toLocaleString('fa-IR')} کارت محصول را بدون نیاز به سلکتور دستی پیدا کرد (روش: ${discovery.method === 'structural' ? 'تحلیل ساختاری صفحه' : discovery.method === 'mixed' ? 'ترکیبی' : 'الگوهای آماده'})؛ این سلکتورها راستی‌آزمایی شدند و با ذخیرهٔ آن‌ها استخراج شروع می‌شود.`,
          { method: discovery.method, selectors: discovery.selectors, evidence: discovery.evidence, containerCount: discovery.containerCount });
        if (!Object.keys(selectorsToSave).length) recommendations.push('دکمهٔ «پیشنهاد خودکار سلکتورها» را بزنید تا همین سلکتورهای پیداشده ذخیره شوند، سپس استخراج را دوباره اجرا کنید.');
      } else {
        add('selector-discovery', false, 'کشف خودکار هم الگوی کارت محصولی در این صفحه پیدا نکرد؛ احتمالاً صفحه جاوااسکریپتی است (پس از بارگذاری کامل رندر می‌شود)، نیازمند ورود است، یا محصولی در آن نیست.', { method: discovery.method });
      }
    } catch { /* informational only */ }
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
  // Detail selectors are suggested from a real product page only when some
  // are missing; already-configured keys are never overwritten.
  const detailSample = candidate && candidate.url ? candidate.url : '';
  if (!overriddenTestUrl && detailSample) {
    const missingDetail = detailKeys.filter(key => !String((profile.selectors as any)?.[key] || '').trim().length);
    if (missingDetail.length) {
      try {
        const suggested = await suggestSelectors(detailSample, 'detail');
        for (const [key, value] of Object.entries(suggested.selectors || {})) {
          if (String(value || '').trim() && (missingDetail as string[]).includes(key)) selectorsToSave[key] = String(value);
        }
      } catch { /* discovery is best-effort; the report below still stands */ }
    }
  }
  if (Object.keys(selectorsToSave).length) recommendations.push('سلکتورهای پیداشده به‌صورت خودکار در تب سلکتورها ذخیره شدند؛ استخراج را دوباره اجرا کنید.');
  if (!products.length) recommendations.push('سلکتور ظرف محصول را با HTML واقعی اصلاح کنید؛ پیشنهاد خودکار را اجرا و سپس دوباره همین عیب‌یاب را بزنید.');
  else {
    if (!products.some(x => x.price > 0)) recommendations.push('محصول پیدا شده ولی قیمت صفر است؛ سلکتور قیمت و واحد/متن قیمت را بررسی کنید.');
    if (!products.some(x => x.url)) recommendations.push('لینک محصول پیدا نشده است؛ سلکتور لینک باید به عنصر a یا ویژگی href/data-url برسد.');
    if (!products.some(x => x.image)) recommendations.push('تصویر پیدا نشده است؛ data-src، srcset یا سلکتور تصویر را بررسی کنید.');
  }
  const failed = stages.filter(stage => !stage.ok);
  return { ok: products.length > 0 && failed.length === 0, profileId: profile.id, url, finalUrl: page.url, durationMs: Date.now() - started, productCount: products.length, usedEngine, stages, recommendations, detail, selectorsToSave };
}
