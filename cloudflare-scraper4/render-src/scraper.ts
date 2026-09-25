import {isBrowserSelectorEngine} from '../worker-src/selector-engine.js';
import {embeddedProductData,parseDownloadedProducts,selectedProductParser,type ProductParser} from '../worker-src/product-parser.js';
import {renderPythonPlaywright} from './playwright-python.js';
import { collectScrollProducts } from '../worker-src/scroll-collector.js';
import { applyResultAdjustments } from '../worker-src/result-adjustments.js';
import { diagnosticProgress, type DiagnosticObserver } from '../worker-src/diagnostic-progress.js';
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertPublicUrl, safeText, sourceRoute } from './network.js';
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
/**
 * 1.141.0 — Chrome copy-XPath → CSS converter. Users paste the container from
 * DevTools ("Copy XPath"), e.g.
 * `//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article`. No engine here speaks
 * XPath, so every one of them died on it with a tagged «سلکتور نامعتبر» error.
 * The convertible dialect is exactly what Chrome emits: absolute `/a/b` and
 * `//a` paths, `*` steps, positional `[N]` / `[position()=N]` / `[last()]`
 * predicates, `@attr="value"` equality, `contains()` / `starts-with()` /
 * `ends-with()` on attributes, `and`-joined predicate lists, `./` + `.//`
 * relative paths, and `|` unions of the above.
 *
 * Anything outside that dialect (axes, `..`, `text()`, `or`, `name()`, bare
 * `(//x)[N]` positional unions over node-sets) has no faithful CSS equivalent
 * and returns null, so the caller keeps the original selector and the run
 * fails honestly with the tagged invalid-selector error instead of matching
 * the wrong elements. Twin: worker-src/scraper.ts.
 */
export function isXPathSelector(selector: string): boolean {
  const value = String(selector || '').trim();
  if (!value) return false;
  if (/^(\(\/\/|\/\/|\/html\b|\/\*|\.\/\/|\.\/)/.test(value)) return true;
  return value.startsWith('/') && (value.includes('@') || value.includes('['));
}
/** Split on any of `seps` outside `[...]` groups and quotes. */
function splitOutsideXPath(input: string, seps: string): string[] {
  const parts: string[] = []; let depth = 0, quote = '', current = '';
  for (const ch of input) {
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}
/** Split a predicate list on top-level ` and ` (values may contain the word). */
function splitXPathAnd(predicate: string): string[] {
  const parts: string[] = []; let depth = 0, quote = '', current = '';
  for (let i = 0; i < predicate.length; i++) {
    const ch = predicate[i];
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && predicate.startsWith(' and ', i)) { parts.push(current); current = ''; i += 4; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}
function xpathAttrValue(matched: RegExpMatchArray): string {
  return String(matched[3] ?? matched[4] ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function xpathSinglePredicateToCss(part: string, tag: string): string | null {
  const nth = tag === '*' ? 'nth-child' : 'nth-of-type';
  const last = tag === '*' ? 'last-child' : 'last-of-type';
  let match = part.match(/^(\d+)$/) || part.match(/^position\(\)\s*=\s*(\d+)$/);
  if (match) return `:${nth}(${match[1]})`;
  if (/^last\(\)$/.test(part)) return `:${last}`;
  match = part.match(/^@([\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')$/);
  if (match) return `[${match[1]}="${xpathAttrValue(match)}"]`;
  match = part.match(/^(contains|starts-with|ends-with)\(\s*@([\w.-]+)\s*,\s*("([^"]*)"|'([^']*)')\s*\)$/);
  if (match) {
    const operator = match[1] === 'contains' ? '*=' : (match[1] === 'starts-with' ? '^=' : '$=');
    const value = String(match[4] ?? match[5] ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `[${match[2]}${operator}"${value}"]`;
  }
  return null;
}
function xpathPredicateToCss(predicate: string, tag: string): string | null {
  let css = '';
  for (const raw of splitXPathAnd(predicate.trim())) {
    const converted = xpathSinglePredicateToCss(raw.trim(), tag);
    if (converted === null) return null;
    css += converted;
  }
  return css;
}
type XPathStep = { axis: 'child' | 'descendant'; tag: string; predicates: string[] };
function xpathParseStep(raw: string): Omit<XPathStep, 'axis'> | null {
  const bracket = raw.indexOf('[');
  const tag = (bracket < 0 ? raw : raw.slice(0, bracket)).trim();
  // `*`, plain tags. Axes (`a::b`), parent steps (`..`), attribute/text
  // steps and function steps have no CSS equivalent and fail the conversion.
  if (!/^(\*|[A-Za-z_][\w.-]*)$/.test(tag)) return null;
  const predicates: string[] = [];
  if (bracket >= 0) {
    const rest = raw.slice(bracket); let cursor = 0;
    while (cursor < rest.length) {
      if (rest[cursor] !== '[') return null;
      let depth = 0, quote = '', end = cursor;
      for (; end < rest.length; end++) {
        const ch = rest[end];
        if (quote) { if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) return null;
      predicates.push(rest.slice(cursor + 1, end).trim());
      cursor = end + 1;
      while (rest[cursor] === ' ' || rest[cursor] === '\t') cursor++;
    }
  }
  return { tag, predicates };
}
function xpathSingleToCss(input: string): string | null {
  // `(//x)[N]` picks one node out of a node-set — positional over a union,
  // which CSS cannot express. Any other parenthesised form is out too.
  if (input.startsWith('(')) return null;
  let cursor = 0, pendingAxis: 'child' | 'descendant' = 'descendant', scoped = false;
  if (input.startsWith('.//')) cursor = 3;
  else if (input.startsWith('./')) { cursor = 2; pendingAxis = 'child'; scoped = true; }
  else if (input.startsWith('//')) cursor = 2;
  else if (input.startsWith('/')) { cursor = 1; pendingAxis = 'child'; }
  else return null;
  const steps: XPathStep[] = [];
  while (cursor < input.length) {
    let end = cursor, depth = 0, quote = '';
    for (; end < input.length; end++) {
      const ch = input[end];
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth < 0) return null; }
      else if (ch === '/' && depth === 0) break;
    }
    const step = xpathParseStep(input.slice(cursor, end).trim());
    if (!step) return null;
    steps.push({ ...step, axis: pendingAxis });
    if (end >= input.length) break;
    if (input[end + 1] === '/') { pendingAxis = 'descendant'; cursor = end + 2; }
    else { pendingAxis = 'child'; cursor = end + 1; }
  }
  if (!steps.length) return null;
  let css = scoped ? ':scope' : '';
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    let chunk = step.tag === '*' ? '' : cssEscapeIdent(step.tag);
    for (const predicate of step.predicates) {
      const converted = xpathPredicateToCss(predicate, step.tag);
      if (converted === null) return null;
      chunk += converted;
    }
    if (!chunk) chunk = '*';
    if (index > 0) css += step.axis === 'descendant' ? ' ' : ' > ';
    else if (scoped) css += ' > ';
    css += chunk;
  }
  return css || null;
}
/**
 * Convert a Chrome-dialect XPath to CSS. Returns null for non-XPath input
 * and for out-of-dialect XPath alike — callers keep the original selector
 * (`xpathToCss(selector) ?? selector`) so neither case can silently match
 * the wrong elements.
 */
export function xpathToCss(selector: string): string | null {
  const input = String(selector || '').trim();
  if (!isXPathSelector(input)) return null;
  const arms = splitOutsideXPath(input, '|');
  if (arms.length > 1) {
    const converted: string[] = [];
    for (const arm of arms) {
      const css = xpathSingleToCss(arm.trim());
      if (css === null) return null;
      converted.push(css);
    }
    return converted.join(', ');
  }
  return xpathSingleToCss(input);
}
function invalidSelectorError(selector: string, cause: unknown): Error {
  // A saved selector that no longer compiles (older discovery, hand edits)
  // must fail LOUDLY carrying its own text — Python raises «سلکتور نامعتبر»
  // the same way — instead of dying later as a cryptic engine error.
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`سلکتور نامعتبر «${String(selector).slice(0, 160)}»: ${detail}`);
}
function scopedMatches($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>, selector: string): cheerio.Cheerio<any> | null {
  // Pasted copy-XPath evaluates as its CSS equivalent; the tagged error below
  // still carries the ORIGINAL text so the user recognises their selector.
  const css = xpathToCss(selector) ?? selector;
  const guarded = <T,>(fn: () => T): T => { try { return fn(); } catch (error) { throw invalidSelectorError(selector, error); } };
  const inner = guarded(() => $root.find(css));
  if (inner.length) return inner;
  const own = guarded(() => $root.filter(css));
  if (own.length) return own;
  const element = $root.get(0);
  if (!element) return null;
  const inThisCard = (candidate: cheerio.Cheerio<any>) => {
    const scoped = candidate.filter((_i, node) => node === element || $.contains(element as any, node as any));
    return scoped.length ? scoped : null;
  };
  // Absolute path as saved: only ever inside the card it was picked from.
  let global: cheerio.Cheerio<any> | null = null;
  try { global = $(css); } catch { global = null; }
  if (global && global.length) {
    const hit = inThisCard(global);
    if (hit) return hit;
  }
  // The picker pins each step with :nth-of-type(N), so the saved path resolves
  // only to the FIRST card. Drop the positional pins and the same path matches
  // the equivalent element in every card; scoping then picks this card's copy.
  if (css.includes(':nth-of-type(')) {
    const loose = css.replace(/:nth-of-type\(\d+\)/g, '').trim();
    if (loose && loose !== css) {
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
  if (page <= 1 || profile.pagination === 'scroll' || profile.pagination === 'none' || profile.pagination === 'next_selector') return url.href;
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
 * 1.141.0 — benchmark probe URL: the 3-page benchmark tests CAPABILITY, so it
 * always probes from page 1 even when the profile URL was pasted mid-catalog
 * (`?page=336`, `/page/336/`). Only the page cursor is reset — every filter,
 * sort and search param is kept, and the saved profile URL is never touched
 * (callers probe a copy). `none` / `next_selector` / `full_pattern` already
 * start at page 1 and pass through untouched. Twin: worker-src/scraper.ts.
 */
export function benchmarkProbeUrl(profile: Profile): string {
  try {
    const pagination = String((profile as any)?.pagination || 'query');
    if (pagination === 'scroll' || pagination === 'none' || pagination === 'next_selector' || pagination === 'full_pattern') return profile.url;
    const url = new URL(profile.url);
    url.hash = '';
    if (pagination === 'path_page' || pagination === 'path_pattern') {
      url.pathname = url.pathname.replace(/\/page\/\d+\/?$/i, '') || '/';
      return url.href;
    }
    const custom = pagination === 'query_custom' ? String((profile as any)?.paginationValue || 'paged') : 'page';
    for (const param of new Set([custom, 'page', 'paged'])) url.searchParams.delete(param);
    return url.href;
  } catch { return profile.url; }
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
  // Same XPath handling as scopedMatches: evaluate the CSS equivalent, but
  // report the original text when nothing compiles.
  const css = xpathToCss(selector) ?? selector;
  let exact: cheerio.Cheerio<any>;
  try { exact = $(css); } catch (error) { throw invalidSelectorError(selector, error); }
  if (!css.includes(':nth-of-type(')) return exact;
  const loose = css.replace(/:nth-of-type\(\d+\)/g, '').trim();
  if (!loose || loose === css) return exact;
  let widened: cheerio.Cheerio<any>;
  try { widened = $(loose); } catch { return exact; }
  if (widened.length <= exact.length) return exact;
  // Every originally matched card must still be part of the wider set.
  const kept = exact.toArray();
  const wide = widened.toArray();
  if (kept.length && !kept.every(node => wide.includes(node))) return exact;
  return widened;
}
export function scrapeListCheerioFromHtml(text: string, finalUrl: string, selectors: Selectors): Product[] {
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
  browserDiagnostics?:any;
  productParser?:ProductParser;
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
  discoveryMethod?:string;
  /** The explicitly requested engine's error, when it threw and no engine produced products (real runs don't throw; the benchmark still does). */
  engineError?:string;
  /** Which browser second layer won ('selectors'|'structural'|'heuristic'|'none') — set only when a browser engine produced the products. */
  browserLayer?:string;
  /** API-traffic capture stats — set only when the network_api engine ran. */
  networkApiStats?:NetworkApiStats};
const BROWSER_ENGINES=new Set<ExtractionEngine>(['playwright','puppeteer','crawlee_playwright','network_api']);
/** Last browser-engine failure, so callers can explain a skipped engine. */
let lastBrowserError='';
export function lastBrowserEngineError():string{return lastBrowserError}
/** Last browser second-layer outcome; reset per scrapeListWithMeta call so a skipped browser never reports the previous run's layer. */
let lastBrowserLayer:''|BrowserExtractionLayer='';
export function lastBrowserLayerUsed():''|BrowserExtractionLayer{return lastBrowserLayer}
const RENDER_DISCOVERY_ENGINES:ExtractionEngine[]=['jsonld','next_data','script_json','heuristic','metadata'];
const RENDER_MANUAL_ENGINES=new Set<ExtractionEngine>(['cheerio']);
// 1.144.0 — 'structural' (the cheerio twin of py-auto-extract.py) sits right
// after the selector engine, not in RENDER_DISCOVERY_ENGINES: the Node auto
// chain must mirror the Worker chain first (see the auto-order test), and the
// Worker cannot run cheerio at all.
const RENDER_AUTO_ENGINES:ExtractionEngine[]=[...RENDER_DISCOVERY_ENGINES,'htmlrewriter','structural','cheerio','playwright','puppeteer','crawlee_playwright','network_api'];
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
    add('htmlrewriter');add('structural');add('cheerio');
    return out;
  }
  if(master&&!RENDER_MANUAL_ENGINES.has(master))add(master);
  for(const engine of RENDER_DISCOVERY_ENGINES)add(engine);
  for(const engine of RENDER_AUTO_ENGINES)add(engine);
  return out;
}

export async function scrapeListWithMeta(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', master?: ExtractionEngine, autoFirst = true, nextSelector = '', autoDiscover = true, indirect = false, scrollToEnd = false, stopped?:()=>Promise<boolean>, initialDocument?:{text:string;url:string},productParser?:ProductParser): Promise<ScrapeListResult> {
  const started=Date.now();
  lastBrowserLayer='';
  lastNetworkApiStats=null;lastRenderedSnapshot=null;
  if(productParser&&engine==='network_api')throw Error('network_api reads API responses, not HTML; disable the second-stage parser or choose a browser HTML loader.');
  if(scrollToEnd){
    if(!browserEngineAvailable())throw Error('اسکرول تا انتها به Chromium نیاز دارد؛ npm run browsers:install را اجرا کنید.');
    const driver=engine==='puppeteer'?'puppeteer':'playwright';
    const {renderBrowserSnapshot}=await import('./visual-browser.js');
    let tracker:ReturnType<typeof trackScrollRequests>;
    const snapshot=await renderBrowserSnapshot(url,driver,indirect,{initial:initialDocument,prepare:page=>{tracker=trackScrollRequests(page)},collect:page=>collectRenderedScroll(page,selectors,stopped,tracker,undefined,productParser)});
    const products=snapshot.collected as Product[];
    return {products,usedEngine:driver,elapsedMs:Date.now()-started,nextUrl:'',selectorsUsed:selectors,browserLayer:'scroll-union',browserDiagnostics:snapshot.browserDiagnostics,...(productParser?{productParser}:{})};
  }
  if(productParser){
    let document:{text:string;url:string}|undefined;
    const reader=async(html:string,base:string)=>{document={text:html,url:base};return parseProductDocument(html,base,selectors,productParser)};
    let products:Product[];
    if(engine==='playwright'||engine==='puppeteer')products=await withBrowserSlot(async()=>scrapeRenderedHtml(url,selectors,engine,stopped,reader));
    else if(engine==='crawlee_playwright')products=await withBrowserSlot(async()=>scrapeListWithCrawleePlaywright(url,selectors,reader));
    else {document=initialDocument||await safeText(url,8_000_000,{indirect});products=await reader(document.text,document.url);}
    let nextUrl='';if(nextSelector&&document){const $=cheerio.load(document.text);for(const part of nextSelector.split(',').map(x=>x.trim()).filter(Boolean)){const href=$(xpathToCss(part)??part).first().attr('href');if(href){nextUrl=new URL(href,document.url).href;break;}}}
    return {products:dedupe(products),usedEngine:engine,elapsedMs:Date.now()-started,nextUrl,selectorsUsed:selectors,productParser};
  }
  let sourcePromise:Promise<{text:string;url:string}>|null=null;
  const source=()=>sourcePromise ||= safeText(url,8_000_000,{indirect});
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
        const href=$(xpathToCss(part) ?? part).first().attr('href');
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
    if (name === 'playwright') return withBrowserSlot(() => scrapeListWithPlaywright(url, activeSelectors, stopped));
    if (name === 'puppeteer') return withBrowserSlot(() => scrapeListWithPuppeteer(url, activeSelectors));
    if (name === 'crawlee_playwright') return withBrowserSlot(() => scrapeListWithCrawleePlaywright(url, activeSelectors));
    if (name === 'network_api') return withBrowserSlot(() => scrapeListWithNetworkApi(url));
    const { text, url: finalUrl } = await source();
    if (name === 'cheerio' || name === 'htmlrewriter') return scrapeListCheerioFromHtml(text, finalUrl, activeSelectors);
    if (name === 'jsonld') return jsonLdProducts(text, finalUrl);
    if (name === 'next_data') return nextDataProducts(text, finalUrl);
    if (name === 'metadata') return metadataProduct(text, finalUrl);
    if (name === 'script_json') return scriptJsonProducts(text, finalUrl);
    if (name === 'structural') return structuralProducts(text, finalUrl);
    if (name === 'heuristic') return heuristicProducts(text, finalUrl);
    return [] as Product[];
  };
  // Python parity (scraper4.py parse_html): a throwing engine must not kill
  // the run — the remaining engines still get their chance (an explicit
  // choice is tried FIRST, as before, just no longer fatally). Probing
  // callers (benchmark: autoFirst=false, single-engine list) still get the
  // loud original error; real runs report it as engineError so the
  // processor's last-resort rescue and the diagnostic can show it.
  let firstError:unknown=null,explicitError:unknown=null;
  for(const name of engineOrder(engine,master,autoFirst)){
    try{
      const products=dedupe(await pick(name));
      if(products.length)return{products,usedEngine:name,elapsedMs:Date.now()-started,nextUrl:await nextLink(),selectorsUsed:activeSelectors,discoveredSelectors,discoveryMethod,...(BROWSER_ENGINES.has(name)&&lastBrowserLayer?{browserLayer:lastBrowserLayer}:{}),...(name==='network_api'&&lastNetworkApiStats?{networkApiStats:lastNetworkApiStats}:{})};
      // The explicit engine ran and found nothing: fall through to the
      // remaining engines instead of returning an empty result, but remember
      // the requested engine so an all-empty run still reports what was asked.
    }catch(error){
      if(!firstError)firstError=error;
      if(engine!=='auto'&&name===engine&&!explicitError)explicitError=error;
      if(BROWSER_ENGINES.has(name))lastBrowserError=`${name}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`;
    }
  }
  if(!autoFirst&&firstError)throw firstError;
  const engineError=explicitError instanceof Error?explicitError.message:explicitError?String(explicitError):undefined;
  return{products:[],usedEngine:engine,elapsedMs:Date.now()-started,nextUrl:await nextLink(),selectorsUsed:activeSelectors,discoveredSelectors,discoveryMethod,engineError,...(BROWSER_ENGINES.has(engine)&&lastBrowserLayer?{browserLayer:lastBrowserLayer}:{}),...(engine==='network_api'&&lastNetworkApiStats?{networkApiStats:lastNetworkApiStats}:{}),...(BROWSER_ENGINES.has(engine)&&lastRenderedSnapshot?{renderedSnapshot:lastRenderedSnapshot}:{})};
}
export async function scrapeList(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', autoDiscover = true, indirect = false): Promise<Product[]> { return (await scrapeListWithMeta(url, selectors, engine, undefined, true, '', autoDiscover, indirect)).products; }

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
export function browserExecutable(driver: 'playwright'|'puppeteer'): string | undefined {
  const env = process.env;
  return env.BROWSER_EXECUTABLE_PATH
    || (driver === 'playwright' ? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : env.PUPPETEER_EXECUTABLE_PATH)
    || env.CHROME_BIN
    // Fall back to a browser already installed on the machine before giving up.
    || systemBrowser();
}
/** A cache directory only counts when it holds a real browser binary: a stale
 * ms-playwright folder from a failed/interrupted download used to report
 * "available", so every browser probe died in launch with the giant
 * "Executable doesn't exist" error instead of skipping cleanly. */
function cacheHasBrowserBinary(root: string): boolean {
  const names = new Set(['chrome', 'headless_shell', 'chromium', 'firefox', 'webkit']);
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (names.has(entry.name)) return true;
      if (entry.isDirectory() && depth < 4) stack.push({ dir: join(dir, entry.name), depth: depth + 1 });
    }
  }
  return false;
}
/** True when some Chromium is reachable, so the engine list can say why not. */
export function browserEngineAvailable(): boolean {
  if (browserExecutable('playwright')) return true;
  // Playwright downloads into a predictable cache; treat it as usable only
  // when a browser binary is actually inside.
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return false;
    return cacheHasBrowserBinary(join(home, '.cache', 'ms-playwright'))
      || cacheHasBrowserBinary(join(home, '.cache', 'puppeteer'));
  } catch { return false; }
}
/**
 * Browser launch mutex: at most ONE Chromium runs at a time per process.
 * Without it, two simultaneous operations (diagnostic + benchmark, a retry
 * on top of a slow run, two open tabs) pile up full browsers until a small
 * VPS runs out of memory and the kernel kills the server mid-request — the
 * "crash" that only happens where browsers actually launch. Every browser
 * engine funnels through pick(), so gating there covers all callers.
 */
let browserLaunchChain: Promise<void> = Promise.resolve();
export async function withBrowserSlot<T>(task: () => Promise<T>): Promise<T> {
  const previous = browserLaunchChain;
  let release: () => void = () => undefined;
  browserLaunchChain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); } finally { release(); }
}
export function browserLaunchArgs(): string[] { return ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']; }
/** A goto interrupted by the page's own redirect/reload rejects with net::ERR_ABORTED even though the follow-up page loads fine — survivable. */
function isAbortedNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ERR_ABORTED');
}
/**
 * 1.153.0 — a goto that never landed leaves the default blank document
 * (`about:blank`, 39 bytes). Running parsers on it reports "silent shop"
 * for what is really a failed navigation — detect it instead.
 */
export function isBlankPageUrl(u: string): boolean {
  const s = String(u || '').trim().toLowerCase();
  return !s || s === 'about:blank' || s.startsWith('about:blank#');
}
/** Rendered pages at or below this size are an empty shell, never a shop. */
export const BLANK_RENDER_HTML_MAX = 200;
/**
 * 1.142.0 — rendered-HTML dump for JS shops. The benchmark diagnoses the
 * FETCHED shell, but browser engines see the RENDERED page — when they find
 * nothing, nobody can tell whether the render was empty, bot-blocked, or just
 * needs different selectors. With SCRAPER4_DUMP_RENDERED_DIR set to a
 * directory, every browser render is saved there (first 5 per process, 2MB
 * each) together with what auto-discovery makes of it, so the operator can
 * attach the file and get working selectors back. Never throws: a dump
 * failure must not break extraction. Exported for tests.
 */
let renderedDumpCount = 0;
const RENDERED_DUMP_CAP = 5, RENDERED_DUMP_MAX_BYTES = 2_000_000;
export function dumpRenderedHtml(html: string, url: string, driver: string): string {
  const dir = String(process.env.SCRAPER4_DUMP_RENDERED_DIR || '').trim();
  if (!dir) return '';
  renderedDumpCount++;
  if (renderedDumpCount > RENDERED_DUMP_CAP) return '';
  try {
    mkdirSync(dir, { recursive: true });
    const body = String(html || '');
    const file = join(dir, `rendered-${String(driver || 'browser').replace(/[^a-z0-9_-]+/gi, '_')}-${renderedDumpCount}.html`);
    writeFileSync(file, body.length > RENDERED_DUMP_MAX_BYTES ? body.slice(0, RENDERED_DUMP_MAX_BYTES) + '\n<!-- SCRAPER4 TRUNCATED -->' : body);
    let discovered = 'auto-discovery: none';
    try {
      const found = discoverListSelectorsFromHtml(body, url);
      discovered = found.method === 'none' ? 'auto-discovery: none' : `auto-discovery: ${found.method} ${JSON.stringify(found.selectors)}`;
    } catch { /* discovery is best-effort; the file is the point */ }
    console.log(`[scraper4] rendered HTML dumped: ${file} (${body.length} bytes, ${url}) — ${discovered}`);
    return file;
  } catch (error) {
    console.error(`[scraper4] rendered dump failed: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}
export type BrowserExtractionLayer='selectors'|'structural'|'heuristic'|'none';
/**
 * 1.145.0 — second layer for the browser engines. Layer 1 (configured
 * selectors on the rendered DOM) already ran; when it found nothing, read the
 * SAME rendered HTML selector-free: structural first (lenient, card-aware),
 * heuristic as the final net. Pure and exported so tests pin it without a
 * browser; all three browser drivers call it.
 */
export function rescueRenderedProducts(html: string, baseUrl: string, firstLayer: Product[]): { products: Product[]; layer: BrowserExtractionLayer } {
  if (firstLayer.length) return { products: firstLayer, layer: 'selectors' };
  const structural = structuralProducts(html, baseUrl);
  if (structural.length) return { products: structural, layer: 'structural' };
  const heuristic = heuristicProducts(html, baseUrl);
  return heuristic.length ? { products: heuristic, layer: 'heuristic' } : { products: [], layer: 'none' };
}
// ---------------------------------------------------------------------------
export type NetworkApiStats={responsesSeen:number;failedResponses:number;jsonBodies:number;bytes:number;parsed:number;endpoints:string[];failedEndpoints:string[]};
/** Last network_api capture outcome; reset per scrapeListWithMeta call. */
let lastNetworkApiStats:NetworkApiStats|null=null;
export function lastNetworkApiStatsUsed():NetworkApiStats|null{return lastNetworkApiStats}
export type RenderedSnapshot={title:string;htmlLength:number;textLength:number;textPrefix:string;scripts:number;scriptSrcs:string[];links:number;images:number;finalUrl:string;httpStatus:number};
/**
 * 1.152.0 — a compact fingerprint of what a browser engine actually saw.
 * Zero-product browser runs attach it to the result, so a pasted diagnostic
 * carries the forensics (bot-wall? empty shell? real shop?) with no dump
 * files or terminal steps.
 */
export function renderedSnapshotFromHtml(html:string,landing:{finalUrl?:string;httpStatus?:number}={}):RenderedSnapshot{
  const body=String(html||'');
  const finalUrl=String(landing.finalUrl||'').slice(0,200),httpStatus=Number(landing.httpStatus)||0;
  const empty:RenderedSnapshot={title:'',htmlLength:body.length,textLength:0,textPrefix:'',scripts:0,scriptSrcs:[],links:0,images:0,finalUrl,httpStatus};
  if(!body)return empty;
  try{
    const $=cheerio.load(body);
    const scriptSrcs:string[]=[];
    $('script[src]').each((_,el)=>{ if(scriptSrcs.length<10)scriptSrcs.push(String($(el).attr('src')||'').slice(0,160)); });
    const snap:RenderedSnapshot={title:$('title').first().text().trim().slice(0,200),htmlLength:body.length,textLength:0,textPrefix:'',
      scripts:$('script').length,scriptSrcs,links:$('a[href]').length,images:$('img').length,finalUrl,httpStatus};
    $('script,style,noscript,template').remove();
    const text=$('body').text().replace(/\s+/g,' ').trim();
    snap.textLength=text.length; snap.textPrefix=text.slice(0,500);
    return snap;
  }catch{ return empty; }
}
/** Last zero-product browser snapshot; reset per scrapeListWithMeta call. */
let lastRenderedSnapshot:RenderedSnapshot|null=null;
export function lastRenderedSnapshotUsed():RenderedSnapshot|null{return lastRenderedSnapshot}
/**
 * Walk API JSON with FULL recursion: unlike giant Next.js blobs (where the
 * key filter skips noise), API bodies are dense and nest products under
 * unpredictable keys (`hits`, `docs`, `entries`...). Precision stays guarded
 * by productFromObject's title+image+price gate.
 */
function walkApiObjects(value: any, baseUrl: string, out: Product[], depth = 0): void {
  if (!value || depth > 14 || out.length > 1000) return;
  if (Array.isArray(value)) { for (const item of value) { walkApiObjects(item, baseUrl, out, depth + 1); if (out.length > 1000) return; } return; }
  if (typeof value !== 'object') return;
  const p = productFromObject(value, baseUrl);
  if (p) out.push(p);
  for (const child of Object.values(value)) { walkApiObjects(child, baseUrl, out, depth + 1); if (out.length > 1000) return; }
}
// 1.147.0 — network_api engine: products from the page's own API traffic.
//
// JavaScript shops like Snappshop render an empty shell and then fetch the
// catalogue as JSON (XHR/fetch). Instead of reading the DOM, this engine
// sniffs those responses with Playwright's DevTools-grade network events,
// parses every JSON-shaped API body, and walks each for product-like objects
// with the same walker the script_json/next_data engines use. Bounds keep one
// chatty page from exploding memory: 50 responses max, 2MB per body, 8MB
// total, plus the walker's own 1000-product cap. Pure parsing lives in
// networkApiProducts so tests pin it without a browser.
// ---------------------------------------------------------------------------
const NETWORK_API_MAX_RESPONSES = 50;
const NETWORK_API_MAX_BODY_BYTES = 2_000_000;
const NETWORK_API_MAX_TOTAL_BYTES = 8_000_000;
const NETWORK_API_SETTLE_MS = 3000;

export function networkApiProducts(apiBodies: string[], baseUrl: string): Product[] {
  const out: Product[] = [];
  for (const text of (Array.isArray(apiBodies) ? apiBodies : []).slice(0, NETWORK_API_MAX_RESPONSES)) {
    const raw = String(text || '').trim();
    if (!raw) continue;
    try {
      walkApiObjects(JSON.parse(raw), baseUrl, out);
    } catch { /* not JSON: skip */ }
    if (out.length > 1000) break;
  }
  return dedupe(out);
}

/**
 * 1.148.0 — dump captured API bodies for schema forensics (opt-in, like the
 * rendered-HTML dump): set SCRAPER4_DUMP_API_DIR and re-run, then send the
 * files so the walker can be taught the shop's schema.
 */
function dumpApiBodies(bodies: string[], endpoints: string[], url: string, failedEndpoints: string[] = []): string {
  const dir = String(process.env.SCRAPER4_DUMP_API_DIR || '').trim();
  if (!dir || (!bodies.length && !failedEndpoints.length)) return '';
  try {
    mkdirSync(dir, { recursive: true });
    bodies.slice(0, 10).forEach((body, i) => writeFileSync(join(dir, `api-${i}.json`), String(body || '').slice(0, NETWORK_API_MAX_BODY_BYTES)));
    const manifest = `url: ${url}\n` + endpoints.map((e, i) => `${i}: ${e}`).join('\n') + '\n'
      + (failedEndpoints.length ? `failed:\n${failedEndpoints.map((e, i) => `${i}: ${e}`).join('\n')}\n` : '');
    writeFileSync(join(dir, 'api-endpoints.txt'), manifest);
    console.log(`[scraper4] API bodies dumped: ${dir} (${bodies.length} bodies, ${url})`);
    return dir;
  } catch (error) {
    console.error(`[scraper4] API dump failed: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}
// ---------------------------------------------------------------------------
// 1.151.0 — network_api capture reliability: rank what to keep, and never
// drop a body that was still draining when the settle window closed.
// ---------------------------------------------------------------------------
const productUrlRe = /(product|plp|pdp|search|categor|listing|browse|collection|shop|items?|goods|skus?|prices?|inventory|availability)/i;
const noiseUrlRe = /(analytics|telemetry|tracking|tealium|sentry|datadog|newrelic|hotjar|fullstory|segment|beacon|pixel|impression|collect\?|\/log\/|\/logs\/|rum\.|monitor)/i;
/** Rank an API URL so product-list calls win the capture slots over noise. */
export function scoreUrl(url: string): number {
  const u = String(url || '').toLowerCase();
  if (!u) return 0;
  if (noiseUrlRe.test(u)) return -10;
  // Noise lives in hostnames (analytics.test); product signals live in paths.
  // Scoring the path keeps one shop's own hostname from inflating every URL.
  let path = u;
  try { const parsed = new URL(u); path = parsed.pathname + parsed.search; } catch { /* relative URL: score it whole */ }
  let score = 0;
  if (productUrlRe.test(path)) score += 10;
  if (path.includes('/api/') || path.includes('/graphql') || path.includes('.json')) score += 5;
  return score;
}
/** A body is worth keeping when the server calls it JSON, or it looks like JSON. */
function isJsonish(contentType: string, text: string): boolean {
  if (/(json|graphql)/i.test(String(contentType || ''))) return true;
  return /^[\s]*[{[]/.test(text);
}
async function scrapeListWithNetworkApi(url: string): Promise<Product[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable('playwright'), args: browserLaunchArgs() });
  try {
    const page = await browser.newPage({ locale: 'fa-IR' });
    const bodies: string[] = [];
    const bodyScores: number[] = [];
    const bodyBytes: number[] = [];
    const pendingBodies: Promise<void>[] = [];
    const weakestKeptIndex = () => { let w = -1; for (let i = 0; i < bodyScores.length; i++) if (w < 0 || bodyScores[i] < bodyScores[w]) w = i; return w; };
    const minKeptScore = () => { const w = weakestKeptIndex(); return w < 0 ? Infinity : bodyScores[w]; };
    let seenResponses = 0, failedResponses = 0;
    const endpoints: string[] = [];
    const failedEndpoints: string[] = [];
    let totalBytes = 0, done = false;
    // A radar on the Network tab: every XHR/fetch response is buffered,
    // bounded, and kept when it looks like JSON.
    page.on('response', (response) => {
      if (done) return;
      try {
        const req = response.request();
        const type = req.resourceType();
        if (type !== 'xhr' && type !== 'fetch') return;
        if (!response.ok()) {
          failedResponses++;
          if (failedEndpoints.length < 20) failedEndpoints.push(`${response.status()} ${String(req.url() || '').slice(0, 140)}`);
          return;
        }
        seenResponses++;
        const apiUrl = String(req.url() || '');
        if (endpoints.length < 20) endpoints.push(apiUrl.slice(0, 160));
        const apiScore = scoreUrl(apiUrl);
        if (bodies.length >= NETWORK_API_MAX_RESPONSES && apiScore <= minKeptScore()) return;
        pendingBodies.push((async () => {
          try {
            const buf = await response.body();
            if (done) return;
            if (buf.length < 50 || buf.length > NETWORK_API_MAX_BODY_BYTES) return;
            const text = buf.toString('utf8');
            if (!isJsonish(String(response.headers()?.['content-type'] || ''), text)) return;
            if (totalBytes + buf.length > NETWORK_API_MAX_TOTAL_BYTES) return;
            if (bodies.length < NETWORK_API_MAX_RESPONSES) {
              bodies.push(text); bodyScores.push(apiScore); bodyBytes.push(buf.length); totalBytes += buf.length;
            } else {
              const weakest = weakestKeptIndex();
              if (weakest >= 0 && apiScore > bodyScores[weakest]) {
                totalBytes += buf.length - bodyBytes[weakest];
                bodies[weakest] = text; bodyScores[weakest] = apiScore; bodyBytes[weakest] = buf.length;
              }
            }
          } catch { /* non-bufferable response: skip */ }
        })());
      } catch { /* the listener must never break the page */ }
    });
    let navStatus = 0;
    try {
      const navResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      navStatus = navResponse?.status() ?? 0;
    } catch (navigationError: unknown) {
      if (!isAbortedNavigation(navigationError)) throw navigationError;
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
    }
    // An aborted navigation that never re-lands leaves a blank page; retry
    // once so a redirect race cannot masquerade as a silent shop.
    if (isBlankPageUrl(page.url())) {
      try {
        const retryResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        navStatus = retryResponse?.status() ?? navStatus;
      } catch (retryError: unknown) {
        if (!isAbortedNavigation(retryError)) throw retryError;
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
      }
    }
    if (isBlankPageUrl(page.url())) throw new Error(`مرورگر به صفحه نرسید؛ پس از رفتن به آدرس، صفحه خالی ماند (${String(url).slice(0, 120)}).`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    // Settle window: lets in-flight API calls finish and flush their bodies.
    await new Promise(resolve => setTimeout(resolve, NETWORK_API_SETTLE_MS));
    // Drain: wait for every in-flight body read (bounded, so one stuck
    // response cannot hang the run) instead of dropping them at the bell.
    await Promise.race([Promise.allSettled(pendingBodies), new Promise(resolve => setTimeout(resolve, 5000))]);
    try { lastRenderedSnapshot = renderedSnapshotFromHtml(await page.content(), { finalUrl: page.url(), httpStatus: navStatus }); } catch { /* content unreadable: the stats still stand */ }
    done = true;
    const products = networkApiProducts(bodies, page.url());
    lastNetworkApiStats = { responsesSeen: seenResponses, failedResponses, jsonBodies: bodies.length, bytes: totalBytes, parsed: products.length, endpoints: endpoints.slice(0, 20), failedEndpoints: failedEndpoints.slice(0, 20) };
    dumpApiBodies(bodies, endpoints, url, failedEndpoints);
    console.log(`[scraper4] network_api: ${seenResponses} API responses seen, ${failedResponses} failed, ${bodies.length} JSON bodies (${totalBytes} bytes), ${products.length} products parsed (${url})`);
    if (endpoints.length) console.log(`[scraper4] network_api endpoints (${endpoints.length}): ${endpoints.join(' | ')}`);
    if (failedEndpoints.length) console.log(`[scraper4] network_api failed (${failedEndpoints.length}): ${failedEndpoints.join(' | ')}`);
    return products;
  } finally { await browser.close(); }
}

function trackScrollRequests(page:any){
 const pending=new Set<any>();let failed=false;
 const started=(r:any)=>{if(['xhr','fetch'].includes(r.resourceType()))pending.add(r)};
 const finished=(r:any)=>pending.delete(r);
 const failure=(r:any)=>{if(pending.has(r))failed=true;pending.delete(r)};
 const response=(r:any)=>{if(pending.has(r.request())&&r.status()>=400)failed=true};
 page.on('request',started);page.on('requestfinished',finished);page.on('requestfailed',failure);page.on('response',response);
 return {pending,failed:()=>failed,close(){page.off('request',started);page.off('requestfinished',finished);page.off('requestfailed',failure);page.off('response',response)}};
}
export async function benchmarkScroll(url:string,selectors:Selectors,engine:ExtractionEngine,indirect=false,productParser?:ProductParser){
 if(engine!=='playwright'&&engine!=='puppeteer')throw Error('آزمون اسکرول فقط با موتور واقعی Playwright یا Puppeteer انجام می‌شود.');
 const {renderBrowserSnapshot}=await import('./visual-browser.js'),benchmark={batches:[] as any[]};let tracker:ReturnType<typeof trackScrollRequests>;
 const snapshot=await renderBrowserSnapshot(url,engine,indirect,{prepare:page=>{tracker=trackScrollRequests(page)},collect:page=>collectRenderedScroll(page,selectors,undefined,tracker,benchmark,productParser)});
 return {products:snapshot.collected||[],batches:benchmark.batches};
}
async function collectRenderedScroll(page:any,selectors:Selectors,stopped?:()=>Promise<boolean>,tracker=trackScrollRequests(page),benchmark?:{batches:any[]},productParser?:ProductParser):Promise<Product[]>{
 try{return await collectScrollProducts<Product>({
  snapshot:async()=>{if(tracker.failed())throw Error('درخواست شبکه هنگام اسکرول ناموفق بود؛ کامل بودن فهرست تأیید نشد.');const html=await page.content(),url=page.url();return productParser?parseProductDocument(html,url,selectors,productParser):rescueRenderedProducts(html,url,parseProductsFromHtml(html,url,selectors)).products},
  observe:benchmark?(products,added)=>{if(added)benchmark.batches.push({page:benchmark.batches.length+1,url:page.url(),products:products.length,newProducts:added,status:'verified'})}:undefined,
  key:p=>p.sourceKey||p.url||p.sku||p.title,
  step:async()=>{const result=await page.evaluate((selector:string)=>{
   let root=document.scrollingElement||document.documentElement;
   // Virtualized shops often scroll an inner list, not the document itself.
   try{let el=document.querySelector(selector)?.parentElement;while(el){const style=getComputedStyle(el);if(/auto|scroll/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+5){root=el;break}el=el.parentElement}}catch{}
   const bottom=root.scrollTop+root.clientHeight>=root.scrollHeight-3;
   if(bottom){const more=Array.from(document.querySelectorAll('button')).find(b=>!b.disabled&&b.getClientRects().length>0&&/^(?:نمایش بیشتر|بارگذاری بیشتر|محصولات بیشتر|load more|show more)$/i.test((b.textContent||'').trim()));more?.click()}
   root.scrollTop=Math.min(root.scrollHeight,root.scrollTop+Math.max(240,root.clientHeight*.8));
   return {height:root.scrollHeight,top:root.scrollTop,atEnd:root.scrollTop+root.clientHeight>=root.scrollHeight-3};
  },xpathToCss(selectors.container)||selectors.container||'body');return {...result,pending:tracker.pending.size>0}},
  wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),now:()=>Date.now(),stopped
 },benchmark?{maxBatches:3,timeoutMs:30000,quietMs:4000,maxRounds:60}:{})}finally{tracker.close()}
}

export async function parseProductDocument(html:string,base:string,selectors:Selectors,parser:ProductParser):Promise<Product[]>{
 const embedded=(mode:'next_data'|'script_json')=>{const out:Product[]=[];for(const value of embeddedProductData(html,mode))walkObjects(value,base,out);return out;};
 const cards=()=>{let active=selectors;if(listSelectorsStatus(selectors)!=='custom'){const found=discoverListSelectorsFromHtml(html,base);if(found.selectors.container)active={...selectors,...found.selectors};}return parseProductsFromHtml(html,base,active);};
 return dedupe(await parseDownloadedProducts(parser,{lxml:cards,selectolax:cards,jsonld:()=>jsonLdProducts(html,base),next_data:()=>embedded('next_data'),script_json:()=>[...jsonLdProducts(html,base),...embedded('script_json'),...scriptJsonProducts(html,base)],metadata:()=>metadataProduct(html,base),heuristic:()=>heuristicProducts(html,base)}));
}
async function scrapeRenderedHtml(url: string, selectors: Selectors, driver: 'playwright'|'puppeteer', stopped?:()=>Promise<boolean>,reader?:(html:string,url:string)=>Promise<Product[]>): Promise<Product[]> {
  const executablePath = browserExecutable(driver);
  if (driver === 'playwright') {
    const {html,finalUrl,httpStatus}=await renderPythonPlaywright(url,executablePath,stopped);
    dumpRenderedHtml(html,finalUrl,'playwright');
    lastRenderedSnapshot=renderedSnapshotFromHtml(html,{finalUrl,httpStatus});
    if(reader)return reader(html,finalUrl);
    const rescued=rescueRenderedProducts(html, finalUrl, parseProductsFromHtml(html, finalUrl, selectors));
    lastBrowserLayer=rescued.layer;
    console.log(`[scraper4] playwright extraction layer: ${rescued.layer} (${rescued.products.length} products, ${finalUrl})`);
    return rescued.products;
  }
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true, executablePath, args: browserLaunchArgs() });
  try {
    const page = await browser.newPage();
    // Same resilience as the Playwright branch above: domcontentloaded goto,
    // survive ERR_ABORTED, best-effort idle window for rendering.
    let navStatus = 0;
    try {
      const navResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      navStatus = navResponse?.status() ?? 0;
    } catch (navigationError: unknown) {
      if (!isAbortedNavigation(navigationError)) throw navigationError;
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }
    if (isBlankPageUrl(page.url())) {
      try {
        const retryResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        navStatus = retryResponse?.status() ?? navStatus;
      } catch (retryError: unknown) {
        if (!isAbortedNavigation(retryError)) throw retryError;
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
      }
    }
    if (isBlankPageUrl(page.url())) throw new Error(`مرورگر به صفحه نرسید؛ پس از رفتن به آدرس، صفحه خالی ماند (${String(url).slice(0, 120)}).`);
    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => undefined);
    const finalUrl = page.url();
    const html = await page.content();
    dumpRenderedHtml(html, page.url(), 'puppeteer');lastRenderedSnapshot=renderedSnapshotFromHtml(html,{finalUrl:page.url(),httpStatus:navStatus});
    if(reader)return reader(html,finalUrl);
    const rescued = rescueRenderedProducts(html, finalUrl, parseProductsFromHtml(html, finalUrl, selectors));
    lastBrowserLayer = rescued.layer;
    console.log(`[scraper4] puppeteer extraction layer: ${rescued.layer} (${rescued.products.length} products, ${finalUrl})`);
    return rescued.products;
  } finally { await browser.close(); }
}
async function scrapeListWithPlaywright(url: string, selectors: Selectors, stopped?:()=>Promise<boolean>): Promise<Product[]> { return scrapeRenderedHtml(url, selectors, 'playwright', stopped); }
async function scrapeListWithPuppeteer(url: string, selectors: Selectors): Promise<Product[]> { return scrapeRenderedHtml(url, selectors, 'puppeteer'); }
async function scrapeListWithCrawleePlaywright(url: string, selectors: Selectors,reader?:(html:string,url:string)=>Promise<Product[]>): Promise<Product[]> {
  const { PlaywrightCrawler } = await import('crawlee');
  // The crawl covers exactly one page, so the products ride home in a closure
  // variable — the old per-run Dataset left a scraper4-<timestamp> storage
  // directory behind on every benchmark/diagnostic page, forever.
  let found: Product[] = [];
  // Same browser resolution as the Playwright/Puppeteer engines: drive the
  // detected system Chromium (Termux/VPS/desktop) with sandbox-free flags.
  // Crawlee's default launch looks for Playwright's bundled browsers, which
  // .npmrc deliberately skips — and which could never execute on Android
  // (desktop-Linux glibc binaries vs Android's Bionic libc) anyway.
  const executablePath = browserExecutable('playwright');
  const crawler = new PlaywrightCrawler({ maxRequestsPerCrawl: 1, launchContext: { launchOptions: { headless: true, executablePath, args: browserLaunchArgs() } }, requestHandler: async ({ page }) => {
    if (isBlankPageUrl(page.url())) throw new Error(`مرورگر به صفحه نرسید؛ پس از رفتن به آدرس، صفحه خالی ماند (${String(url).slice(0, 120)}).`);
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
    const html = await page.content();
    dumpRenderedHtml(html, page.url(), 'crawlee');lastRenderedSnapshot=renderedSnapshotFromHtml(html,{finalUrl:page.url(),httpStatus:0});
    if(reader){found=await reader(html,page.url());return;}
    const rescued = rescueRenderedProducts(html, page.url(), parseProductsFromHtml(html, page.url(), selectors));
    lastBrowserLayer = rescued.layer;
    console.log(`[scraper4] crawlee extraction layer: ${rescued.layer} (${rescued.products.length} products, ${page.url()})`);
    found = rescued.products;
  }});
  await crawler.run([url]);
  return dedupe(found);
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
function decodeHtml(value: string): string { return value.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function stripHtml(value: string): string { return normalize(decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))); }
function firstImage(value: any): string { if (!value) return ''; if (typeof value === 'string') return value; if (Array.isArray(value)) return firstImage(value[0]); if (typeof value === 'object') return String(value.url || value.src || value.href || value.original || value.large || ''); return ''; }
function productFromObject(obj: any, baseUrl: string): Product | null { if (!obj || typeof obj !== 'object') return null; const title = normalize(String(obj.name || obj.title || obj.productName || obj.label || '')); const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers || obj.offer || {}; const priceText = normalize(String(obj.price || obj.finalPrice || obj.salePrice || obj.sellingPrice || obj.priceText || offer.price || offer.lowPrice || '')); const rawUrl = String(obj.url || obj.href || obj.link || obj.webUrl || obj.canonicalUrl || (typeof obj.slug === 'string' ? (obj.slug.startsWith('/') ? obj.slug : `/product/${obj.slug}`) : '') || ''); const productUrl = absolute(rawUrl, baseUrl); const image = absolute(firstImage(obj.image || obj.images || obj.thumbnail || obj.cover || obj.imageUrl), baseUrl); if (!title || !image || !priceText || numberFromText(priceText) <= 0) return null; return { sourceKey: sourceKey(productUrl, title), title, price: numberFromText(priceText), priceText, url: productUrl, image, images: image ? [image] : [], sku: String(obj.sku || obj.id || ''), brand: typeof obj.brand === 'object' ? String(obj.brand?.name || '') : String(obj.brand || ''), category: String(obj.category || ''), shortDesc: String(obj.description || ''), sourcePage: baseUrl, scrapedAt: new Date().toISOString() }; }
function walkObjects(value: any, baseUrl: string, out: Product[], depth = 0): void { if (!value || depth > 12 || out.length > 1000) return; if (Array.isArray(value)) { value.forEach(x => walkObjects(x, baseUrl, out, depth + 1)); return; } if (typeof value !== 'object') return; const p = productFromObject(value, baseUrl); if (p) out.push(p); for (const [key, child] of Object.entries(value)) if (/product|item|result|data|pageProps|props|list|card|entity|catalog|shop|store/i.test(key)) walkObjects(child, baseUrl, out, depth + 1); }
function jsonLdProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const data = JSON.parse(decodeHtml(m[1])); walkObjects(data, baseUrl, out); } catch {} } return dedupe(out); }
export function nextDataProducts(html: string, baseUrl: string): Product[] { const m = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if (!m) return []; try { const out: Product[] = []; walkObjects(JSON.parse(decodeHtml(m[1])), baseUrl, out); return dedupe(out); } catch { return []; } }
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
  return candidates.find(chunk => /<img\b/i.test(chunk) && chunkHasPriceText(stripPriceFormatChars(stripHtml(chunk)))) || candidates[0];
}
function metadataProduct(html: string, baseUrl: string): Product[] { const title = meta(html, 'og:title') || meta(html, 'twitter:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''); if (!title) return []; const ogType = (meta(html, 'og:type') || '').toLowerCase(), productUrl = absolute(meta(html, 'og:url') || baseUrl, baseUrl), priceText = meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || '', image = absolute(meta(html, 'og:image') || meta(html, 'twitter:image'), baseUrl), price = numberFromText(priceText); if (!/(?:product|product.item)/i.test(ogType) || !priceText || price <= 0 || !image) return []; return [{ sourceKey: sourceKey(productUrl, title), title, price, priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }]; }
export function scriptJsonProducts(html: string, baseUrl: string): Product[] { const out: Product[] = []; for (const m of html.matchAll(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)) { const body = decodeHtml(m[1]); if (!/(product|products|price|__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__)/i.test(body)) continue; for (const j of body.matchAll(/(?:window\.)?(?:__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__)?\s*=\s*(\{[\s\S]{50,200000}\}|\[[\s\S]{50,200000}\])\s*;?/g)) { try { walkObjects(JSON.parse(j[1]), baseUrl, out); } catch {} } } return dedupe(out); }
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
// ---------------------------------------------------------------------------
// 1.144.0 — structural engine: the Node twin of scripts/py-auto-extract.py.
//
// The same DOM algorithm, ported 1:1 from BeautifulSoup to cheerio so the
// Node runtime (Termux/VPS/Render/desktop) extracts ordinary shops with NO
// manual selectors, exactly like the deployer's Python tab: known card
// containers first (WooCommerce `li.product`), an outer-container repair,
// then a product-link climb for unknown class names, then embedded JSON
// catalogs. Acceptance matches Python too: a card is kept when it has a
// title OR a link — a missing price or image never discards it (unlike the
// strict `heuristic` gate, which needs title+image+parseable price together).
//
// Deliberate divergences from the Python source:
// - No explicit-selector overrides: this engine runs selector-free by design
//   (explicit selectors already have the cheerio/htmlrewriter engines, and
//   scrapeListWithMeta repairs unconfigured selectors before the engine loop).
// - Identity hashes reuse the existing sha256 sourceKey(url || title); Python
//   uses md5 over url:/sku:/title: — same url → title fallback semantics.
// - Struck-through old prices are stripped before parsing (see below); Python
//   keeps them and misreads discount cards, so prices there differ by design.
// The Cloudflare Worker cannot run this engine (no cheerio package there), so
// it is Node-only: the Worker throws the same loud error as for the browser
// engines, and its benchmark marks it unavailable.
// ---------------------------------------------------------------------------
type StructuralRow = { title: string; price: string; link: string; image: string; sku: string };
const STRUCTURAL_CONTAINERS = "li.product,article[class*='product'],div.product-card,div.product-item,div[class*='product-card'],div[class*='product-item'],[data-product-id],[itemtype*='Product']";
const STRUCTURAL_REPAIR = "li,article,div[class*='product'],[data-product-id]";
const STRUCTURAL_CLIMB_LINK = "a[href*='/product/'],a[href*='/products/'],a[href*='/shop/'],a[href*='/snp-']";
const STRUCTURAL_CLIMB_RE = /\/product\/|\/products\/|\/shop\/|\/snp-/i;
const STRUCTURAL_MAX_PRODUCTS = 2000; // Python's MAX_PRODUCTS_HARD.
const STRUCTURAL_JSON_BLOBS = [
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/gi,
];
const STRUCTURAL_VOLATILE_CLASS = /^(active|selected|current|open|opened|hover|focus|disabled|loading|ng-|v-|is-|has-|js-)/i;
const STRUCTURAL_HASH_CLASS = /^[a-f0-9]{6,}$/i;

function structuralClean(value: unknown): string {
  if (value == null || typeof value === 'object') return '';
  return String(value)
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/\s+/g, ' ').trim();
}

function structuralAbsolute(value: unknown, base: string): string {
  const clean = structuralClean(value);
  if (!clean || clean.startsWith('data:') || clean.toLowerCase().startsWith('javascript:') || clean.startsWith('#')) return '';
  return absolute(clean, base);
}

function structuralPriceText(value: unknown): string {
  const text = structuralClean(value);
  if (!text) return '';
  const currency = 'تومان|تومن|ریال|ر\\.ی|USD|EUR|GBP|AED|TRY|CAD|AUD|CHF|JPY|CNY|£|\\$|€|¥|₽|₺|₹|﷼';
  const number = '\\d(?:[\\d,،٬.٫\\s]*\\d)?';
  const matches = [...text.matchAll(new RegExp(`(?:(${number})\\s*(${currency})|(${currency})\\s*(${number}))`, 'gi'))];
  if (matches.length) {
    const choices: Array<[number, string]> = [];
    for (const m of matches) {
      const left = m[1] || '', rightCur = m[2] || '', leftCur = m[3] || '', right = m[4] || '';
      const raw = left || right, cur = left ? rightCur : leftCur;
      const digits = raw.replace(/\D/g, '');
      if (digits) choices.push([digits.length, structuralClean(leftCur ? `${cur} ${raw}` : `${raw} ${cur}`)]);
    }
    if (choices.length) return choices.sort((a, b) => b[0] - a[0])[0][1];
  }
  const grouped = text.match(/\d{1,3}(?:[,،٬\s]\d{3})+/g) || [];
  if (grouped.length) return grouped.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)[0] + ' تومان';
  const nums = (text.match(/\d{4,}/g) || []).filter(x => Number(x) >= 1000);
  return nums.length ? nums.sort((a, b) => Number(b) - Number(a))[0] + ' تومان' : '';
}

// BeautifulSoup's get_text(" ", strip=True): every text node stripped, joined
// with spaces (script/style included, exactly like Python — cards with inline
// scripts inherit the same longest-text quirk on both sides).
function structuralTextBits($: any, el: any, out: string[]): void {
  el.contents().each((_: number, node: any) => {
    if (node.type === 'text') { const t = structuralClean(node.data); if (t) out.push(t); }
    else if (node.type === 'tag') structuralTextBits($, $(node), out);
  });
}
function structuralText($: any, el: any): string {
  const out: string[] = [];
  structuralTextBits($, el, out);
  return out.join(' ');
}

function structuralProductFromCard($: any, card: any, base: string): StructuralRow | null {
  let title = '';
  const head = card.find("h1,h2,h3,h4,[class*='title'],[class*='name'],a[title]").first();
  if (head.length) title = structuralClean(head.attr('title') || structuralText($, head));
  if (!title) {
    const img = card.find('img').first();
    if (img.length) title = structuralClean(img.attr('alt') || img.attr('title') || '');
  }
  if (!title) {
    const bits: string[] = [];
    structuralTextBits($, card, bits);
    const pieces = bits.filter(x => x.length > 3 && !/^[%0-9,،٬.٫ تومانریال]+$/.test(x));
    title = pieces.sort((a, b) => b.length - a.length)[0] || '';
  }
  let price = '';
  // Intentional divergence from Python: struck-through old prices (<del>) are
  // removed before parsing (the heuristic engine's rule). Python keeps them,
  // so on a discount card its digit-span swallows old+sale together
  // ("203٬000 189٬000 تومان" → 203000189000) or the longer old price wins —
  // both wrong for WooCommerce <del>/<ins> sales, where the sale price must win.
  const priceScope = card.clone();
  priceScope.find('del,s,strike').remove();
  const pc = priceScope.find("[class*='price'],[class*='amount'],ins,[itemprop='price']").first();
  if (pc.length) price = structuralPriceText(pc.attr('content') || structuralText($, pc));
  if (!price) price = structuralPriceText(structuralText($, priceScope));
  const selfHref = card.is('a') && card.attr('href') ? String(card.attr('href')) : '';
  const anchor = selfHref ? null : card.find('a[href]').first();
  const link = structuralAbsolute(selfHref || (anchor && anchor.length ? anchor.attr('href') : ''), base);
  let image = '';
  const im = card.find('img').first();
  if (im.length) {
    for (const attr of ['data-zoom-image', 'data-large_image', 'data-src', 'data-lazy-src', 'src']) {
      const v = im.attr(attr);
      if (v) { image = structuralAbsolute(v, base); break; }
    }
  }
  const sku = structuralClean(card.attr('data-product-id') || '');
  if (!title && !link) return null;
  return { title: title.slice(0, 300), price, link, image, sku };
}

function structuralJsonPrice(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['final', 'selling', 'sale', 'amount', 'value', 'min', 'current', 'discounted', 'rrp', 'price']) {
      if (key in value) { const got = structuralJsonPrice(value[key]); if (got) return got; }
    }
    return '';
  }
  if (typeof value === 'number' && value > 0) {
    let number = Math.trunc(value);
    if (number >= 10 ** 7) number = Math.floor(number / 10); // rial → toman-ish display; the price parser still runs
    return structuralPriceText(`${number} تومان`) || String(number);
  }
  return structuralPriceText(value);
}

function structuralJsonText(...values: unknown[]): string {
  for (const value of values) { const text = structuralClean(value); if (text) return text; }
  return '';
}

function structuralJsonRow(obj: any, base: string): StructuralRow | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const title = structuralJsonText(obj.title, obj.name, obj.productTitle, obj.fa_title, obj.displayName);
  if (!title || title.length < 3) return null;
  const price = structuralJsonPrice(obj.price || obj.offers || obj.finalPrice || obj.sellingPrice || obj.discountedPrice || obj.minPrice);
  let href = structuralJsonText(obj.url, obj.link, obj.href, obj.slug, obj.productUrl);
  const ident = structuralJsonText(obj.sku, obj.id, obj.productId, obj.code);
  if (href) {
    if (/^snp-\d+$/i.test(href)) href = '/product/' + href;
    href = structuralAbsolute(href, base);
  } else if (ident && /^snp-\d+$/i.test(ident)) href = structuralAbsolute('/product/' + ident, base);
  let image: any = obj.image || obj.thumbnail || obj.cover || obj.mainImage;
  if (Array.isArray(image) && image.length) image = image[0];
  if (image && typeof image === 'object' && !Array.isArray(image)) image = image.url || image.src;
  const imageUrl = image ? structuralAbsolute(structuralClean(image), base) : '';
  if (!href && !price) return null;
  return { title: title.slice(0, 300), price, link: href, image: imageUrl, sku: ident.slice(0, 80) };
}

function structuralWalkCatalog(obj: any, out: StructuralRow[], base: string, depth = 0): void {
  if (depth > 14) return;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const row = structuralJsonRow(obj, base);
    if (row) out.push(row);
    const items = obj.itemListElement;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const inner = item.item;
          const row2 = structuralJsonRow(inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : item, base);
          if (row2) out.push(row2);
        }
      }
    }
    for (const value of Object.values(obj)) structuralWalkCatalog(value, out, base, depth + 1);
  } else if (Array.isArray(obj) && obj.length < 4000) {
    for (const item of obj) structuralWalkCatalog(item, out, base, depth + 1);
  }
}

function structuralEmbeddedCatalog(html: string, base: string): StructuralRow[] {
  const found: StructuralRow[] = [];
  for (const pattern of STRUCTURAL_JSON_BLOBS) {
    pattern.lastIndex = 0;
    for (const m of (html || '').matchAll(pattern)) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      try { structuralWalkCatalog(JSON.parse(raw), found, base); } catch { /* invalid JSON blob: skip */ }
    }
  }
  return found;
}

export function structuralProducts(html: string, baseUrl: string): Product[] {
  const $ = cheerio.load(html || '');
  const store = new Map<string, Product>();
  const add = (row: StructuralRow | null): void => {
    if (!row || (!row.title && !row.link)) return;
    const key = sourceKey(row.link || row.title, row.title);
    const old = store.get(key);
    if (old) {
      // Python's add_product merge: a later path only fills fields the first
      // path left empty (e.g. the link climb adds the image the JSON row had).
      if (!old.title && row.title) old.title = row.title;
      if (!old.priceText && row.price) { old.priceText = row.price; old.price = numberFromText(row.price); }
      if (!old.url && row.link) old.url = row.link;
      if (!old.image && row.image) { old.image = row.image; old.images = [row.image]; }
      if (!old.sku && row.sku) old.sku = row.sku;
      return;
    }
    if (store.size >= STRUCTURAL_MAX_PRODUCTS) return;
    store.set(key, {
      sourceKey: key, title: row.title, price: numberFromText(row.price), priceText: row.price,
      url: row.link, image: row.image, images: row.image ? [row.image] : [], sku: row.sku,
      sourcePage: baseUrl, scrapedAt: new Date().toISOString(),
    });
  };
  let cards = $(STRUCTURAL_CONTAINERS);
  if (cards.length === 1) {
    // Like Python's outer-container repair: one wrapper matched, so descend
    // to the repeated cards inside it.
    const nested = cards.first().find(STRUCTURAL_REPAIR);
    if (nested.length > 1) cards = nested;
  }
  cards.each((_: number, el: any) => add(structuralProductFromCard($, $(el), baseUrl)));
  if (!store.size) {
    // Last fallback, same as Python: product links with images are reliable
    // even when a shop uses unknown generated class names.
    $(STRUCTURAL_CLIMB_LINK).each((_: number, el: any) => {
      const link = $(el);
      if (!link.find('img').length && !link.find("[class*='price']").length) return;
      let node: any = link;
      for (let i = 0; i < 5; i++) {
        const parent = node.parent();
        const raw = parent.get(0);
        if (!raw || raw.type !== 'tag') break;
        node = parent;
        if (node.find('img').length && structuralPriceText(structuralText($, node))) break;
      }
      add(structuralProductFromCard($, node, baseUrl));
    });
  }
  for (const row of structuralEmbeddedCatalog(html, baseUrl)) add(row);
  return [...store.values()];
}

function structuralCssEscape(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, m => '\\' + m).replace(/^(\d)/, '\\3$1 ');
}

function structuralStableClasses(el: any): string[] {
  const classes = String(el.attr('class') || '').split(/\s+/).filter(Boolean);
  const stable = classes.filter(c => c.length <= 40 && !STRUCTURAL_VOLATILE_CLASS.test(c) && !STRUCTURAL_HASH_CLASS.test(c));
  const seen = new Set<string>();
  return stable
    .filter(c => !seen.has(c) && (seen.add(c), true))
    .sort((a, b) => (((/[^a-zA-Z0-9_-]/.test(a) ? 100 : 0) + a.length) - ((/[^a-zA-Z0-9_-]/.test(b) ? 100 : 0) + b.length)));
}

function structuralSig(el: any): string {
  const raw = el.get(0);
  const name = String((raw && raw.name) || '').toLowerCase();
  const tag = /^[a-z][a-z0-9]*$/.test(name) ? name : 'div';
  const classes = structuralStableClasses(el);
  if (classes.length >= 2) return `${tag}.${structuralCssEscape(classes[0])}.${structuralCssEscape(classes[1])}`;
  if (classes.length === 1) return `${tag}.${structuralCssEscape(classes[0])}`;
  return tag;
}

function structuralLooksPrice(text: string): boolean {
  const value = structuralClean(text);
  return Boolean(value) && value.length <= 80 && Boolean(structuralPriceText(value));
}

function structuralVoteTitle($: any, nodes: any[]): string {
  const votes = new Map<string, { count: number; bonus: number }>();
  for (const node of nodes) {
    let sig = '';
    const heads = node.find('h1,h2,h3,h4,[itemprop="name"]');
    for (let i = 0; i < heads.length; i++) {
      const text = structuralClean(structuralText($, heads.eq(i)));
      if (text.length >= 8 && text.length <= 200 && !structuralLooksPrice(text)) { sig = structuralSig(heads.eq(i)); break; }
    }
    if (!sig) {
      let bestLen = 0, bestIdx = -1;
      const cands = node.find('span,div,p,a,li,td,strong,b').slice(0, 120);
      for (let idx = 0; idx < cands.length; idx++) {
        const text = structuralClean(structuralText($, cands.eq(idx)));
        if (text.length >= 15 && text.length <= 160 && !structuralLooksPrice(text) && (text.length > bestLen || (text.length === bestLen && idx > bestIdx))) {
          bestLen = text.length; bestIdx = idx; sig = structuralSig(cands.eq(idx));
        }
      }
    }
    if (sig) { const v = votes.get(sig) || { count: 0, bonus: /^h[1-4]\./.test(sig) ? 2 : 0 }; v.count++; votes.set(sig, v); }
  }
  if (!votes.size) return '';
  return [...votes.entries()].sort((a, b) => (b[1].count * 10 + b[1].bonus) - (a[1].count * 10 + a[1].bonus))[0][0];
}

function structuralVotePrice($: any, nodes: any[]): string {
  const votes = new Map<string, { count: number; length: number }>();
  for (const node of nodes) {
    const cands: Array<{ sig: string; length: number; index: number }> = [];
    const all = node.find('*').slice(0, 150);
    for (let idx = 0; idx < all.length; idx++) {
      const rawText = structuralText($, all.eq(idx));
      if (rawText && rawText.length <= 80 && structuralLooksPrice(rawText)) {
        cands.push({ sig: structuralSig(all.eq(idx)), length: structuralClean(rawText).length, index: idx });
      }
    }
    cands.sort((a, b) => (a.length - b.length) || (b.index - a.index));
    if (cands.length) { const w = cands[0]; const v = votes.get(w.sig) || { count: 0, length: w.length }; v.count++; votes.set(w.sig, v); }
  }
  if (!votes.size) return '';
  return [...votes.entries()].sort((a, b) => (b[1].count - a[1].count) || (a[1].length - b[1].length))[0][0];
}

export type StructuralDiscovery = {
  selectors: { container?: string; title?: string; price?: string; link?: string; image?: string };
  method: string;
  containerCount: number;
  ok: boolean;
  error?: string;
};

// Python's discover_selectors, ported for tests and the suggestion tooling:
// climb product links exactly like structuralProducts, group the climbed
// cards by tag+class signature, vote title/price selectors, and verify the
// winner against the same HTML before returning it.
export function discoverStructuralSelectors(html: string, baseUrl: string): StructuralDiscovery {
  void baseUrl;
  try {
    const $ = cheerio.load(html || '');
    const climbed: any[] = [];
    $('a[href]').slice(0, 800).each((_: number, el: any) => {
      const link = $(el);
      const href = structuralClean(link.attr('href'));
      if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) return;
      if (!STRUCTURAL_CLIMB_RE.test(href)) return;
      if (!link.find('img').length && !link.find("[class*='price']").length) return;
      let node: any = link;
      for (let i = 0; i < 5; i++) {
        const parent = node.parent();
        const raw = parent.get(0);
        if (!raw || raw.type !== 'tag') break;
        node = parent;
        if (node.find('img').length && structuralPriceText(structuralText($, node))) break;
      }
      climbed.push(node);
    });
    if (climbed.length < 2) return { selectors: {}, method: 'none', containerCount: 0, ok: false };
    const groups = new Map<string, any[]>();
    for (const node of climbed) {
      const sig = structuralSig(node);
      const g = groups.get(sig) || [];
      g.push(node);
      groups.set(sig, g);
    }
    const ranked = [...groups.entries()].sort((a, b) => (b[1].length - a[1].length) || (a[0].length - b[0].length)).slice(0, 5);
    for (const [sig, members] of ranked) {
      if (members.length < 2) continue;
      const sample = members.slice(0, 8);
      const title = structuralVoteTitle($, sample);
      if (!title) continue;
      const price = structuralVotePrice($, sample);
      const links = sample.filter((n: any) => { const r = n.get(0); return r && r.name === 'a' && n.attr('href'); }).length;
      const linkSel = links * 2 >= sample.length ? sig : 'a[href]';
      let cards: any;
      try { cards = $(sig).slice(0, 12); } catch { continue; }
      const titleHits = sample.filter((n: any) => { const t = n.find(title).first(); return t.length > 0 && structuralClean(structuralText($, t)); }).length;
      const needed = Math.max(1, Math.floor((Math.min(cards.length, 12) + 1) / 2));
      if (cards.length >= 2 && titleHits >= needed) {
        return {
          selectors: { container: sig, title, ...(price ? { price } : {}), link: linkSel, image: 'img' },
          method: 'structural', containerCount: cards.length, ok: true,
        };
      }
    }
    return { selectors: {}, method: 'none', containerCount: 0, ok: false };
  } catch (error) {
    return { selectors: {}, method: 'none', containerCount: 0, ok: false, error: String((error as Error)?.message || error).slice(0, 200) };
  }
}

export function heuristicProducts(html: string, baseUrl: string): Product[] {
  const out: Product[] = []; const seenUrls = new Set<string>();
  // 1.136.0 — first anchor per URL wins: cards with a media link AND a title
  // link otherwise extract twice; /shop/ and snp- match the old scraper4.py.
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,2500}?)<\/a>/gi)) { const productUrl = absolute(decodeHtml(m[1]), baseUrl); if (!productUrl || seenUrls.has(productUrl) || !/(product|products|\/p\/|\/pd\/|\/shop\/|snp-|kala|sku)/i.test(productUrl) || NON_PRODUCT_URL_RE.test(productUrl)) continue; const chunk = productContextChunk(html, m.index || 0, m[0]); if (!chunk) continue; const title = stripHtml(chunk.match(/<h[1-4]\b[^>]*>([\s\S]{0,500}?)<\/h[1-4]>/i)?.[1] || '') || normalize(decodeHtml(chunk.match(/<img\b[^>]*(?:alt|title)=["']([^"']+)["']/i)?.[1] || '')) || stripHtml(m[2]) || chunkTitle(chunk); const image = heuristicImage(chunk, baseUrl); const priceText = heuristicPriceText(stripPriceFormatChars(stripHtml(chunk.replace(/<(del|s|strike)\b[\s\S]*?<\/\1>/gi, ' ')))); if (!title || title.length < 3 || !image || !priceText || numberFromText(priceText) <= 0) continue; seenUrls.add(productUrl); out.push({ sourceKey: sourceKey(productUrl, title), title, price: numberFromText(priceText), priceText, url: productUrl, image, images: image ? [image] : [], sourcePage: baseUrl, scrapedAt: new Date().toISOString() }); } return dedupe(out); }

export async function scrapeDetails(product: Product, selectors: Selectors, indirect = false): Promise<Product> {
  if (!product.url) return product;
  const { text, url } = await safeText(product.url, 8_000_000, { indirect }); const $ = cheerio.load(text); const body = $.root();
  const css = (selector?: string) => selector ? (xpathToCss(selector) ?? selector) : '';
  const textField = (selector?: string) => selector ? normalize(body.find(css(selector)).first().text()) : '';
  const priceText = textField(selectors.price), detailPrice = numberFromText(priceText);
  if (detailPrice > 0) { product.price = detailPrice; product.priceText = priceText; }
  product.shortDesc = textField(selectors.shortDesc) || product.shortDesc;
  product.longDesc = selectors.longDesc ? sanitizeHtml(body.find(css(selectors.longDesc)).first().html() || '', url) : product.longDesc;
  // Specification table: shops render it as <tr><td>name</td><td>value</td></tr>,
  // as <dt>/<dd>, or as <li>name: value</li>. Accept all three shapes so one
  // selector pointing at the block is enough.
  if (selectors.specs) {
    const rows: Array<{ name: string; value: string }> = [];
    const block = body.find(css(selectors.specs)).first();
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
    body.find(css(selectors.gallery)).each((_i, el) => {
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
  return applyResultAdjustments(product, profile);
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
/** Selector tools read the selected browser's DOM, never a product-parser result.
 * Capture through the existing drivers so navigation/context match extraction.
 * network_api uses Playwright for DOM selectors; API JSON has no CSS nodes.
 */
export async function selectorToolDocument(url:string,engine?:string):Promise<{text:string;url:string}>{
  if(!isBrowserSelectorEngine(engine))return safeText(url,4_000_000);
  await assertPublicUrl(url);
  return withBrowserSlot(async()=>{
    let document:{text:string;url:string}|undefined;
    const reader=async(text:string,finalUrl:string):Promise<Product[]>=>{await assertPublicUrl(finalUrl);document={text,url:finalUrl};return []};
    if(engine==='crawlee_playwright')await scrapeListWithCrawleePlaywright(url,DEFAULT_SELECTORS,reader);
    else await scrapeRenderedHtml(url,DEFAULT_SELECTORS,engine==='puppeteer'?'puppeteer':'playwright',undefined,reader);
    if(!document)throw Error('مرورگر HTML قابل آزمایشی برنگرداند؛ HTML اولیه جایگزین نشده است.');
    return document;
  });
}
export async function suggestSelectors(url:string,mode:'list'|'detail'|'all'='all',engine?:string){
  const page=await selectorToolDocument(url,engine),selectors:Record<string,string>={},evidence:Record<string,unknown>={};
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
function extractSelectorValuesSync(html:string,baseUrl:string,selector:string,type:'text'|'link'|'image'='text'):string[]{const $=cheerio.load(html),values:string[]=[];let _nodes:cheerio.Cheerio<any>;const css=xpathToCss(selector)??selector;try{_nodes=$(css)}catch(error){throw invalidSelectorError(selector,error)}_nodes.slice(0,50).each((_i,el)=>{const node=$(el);const raw=type==='link'?(node.attr('href')||node.find('a[href]').first().attr('href')||''):type==='image'?(node.attr('src')||node.attr('data-src')||node.find('img').first().attr('src')||node.find('img').first().attr('data-src')||''):node.text();const value=type==='text'?normalize(raw):absolute(raw,baseUrl);if(value)values.push(value.slice(0,1000))});return values}
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
  /** A selector that failed to compile (tagged message); counts are partial. */
  error?: string;
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
  try { const all = containerNodes($, container); containerCount = all.length; nodes = all.slice(0, 12).toArray(); } catch (error) { return { ...emptyVerification(), error: error instanceof Error ? error.message : String(error) }; }
  if (!nodes.length) return emptyVerification(containerCount);
  const hits = { title: { count: 0, sample: '' }, price: { count: 0, sample: '' }, link: { count: 0, sample: '' }, image: { count: 0, sample: '' } };
  for (const element of nodes) {
    const root = $(element);
    try {
    const title = firstText($, root, String(selectors.title || ''));
    if (title) { hits.title.count++; hits.title.sample ||= title.slice(0, 200); }
    const priceText = firstText($, root, String(selectors.price || ''));
    if (priceText && numberFromText(priceText) > 0) { hits.price.count++; hits.price.sample ||= priceText.slice(0, 200); }
    const link = absolute(productLink($, root, String(selectors.link || '')), baseUrl);
    if (link) { hits.link.count++; hits.link.sample ||= link.slice(0, 200); }
    let imageValue = firstAttr($, root, String(selectors.image || ''), ['data-src', 'data-lazy-src', 'data-original', 'src']);
    if (!imageValue) imageValue = (firstAttr($, root, String(selectors.image || ''), ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
    if (absolute(imageValue, baseUrl)) { hits.image.count++; hits.image.sample ||= absolute(imageValue, baseUrl).slice(0, 200); }
    } catch (error) { return { containerCount, cardsSampled: nodes.length, ...hits, ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  // Title is mandatory (extraction skips title-less cards); price/link/image
  // are reported but do not fail verification — "without price" products are
  // filtered later with their own warning, not here.
  const needed = Math.max(1, Math.ceil(nodes.length / 2));
  return { containerCount, cardsSampled: nodes.length, ...hits, ok: containerCount >= 2 && hits.title.count >= needed };
}

const PRICE_HINT_RE = /[۰-۹٠-٩\d][۰-۹٠-٩\d,٬.,\s]{0,30}\s*(?:تومان|تومن|ریال|IRR|IRT|USD|EUR|GBP|€|\$|£|TL|₺|AED|درهم|﷼)/i;
const THOUSANDS_RE = /[0-9۰-۹٠-٩]{1,3}([,٬.][0-9۰-۹٠-٩]{3})+/;
const THOUSANDS_GLOBAL_RE = new RegExp(THOUSANDS_RE.source, 'g');
/** Card text holds a price when a currency hint OR a bare thousands-grouped
 * number («۵۲۵٬۰۰۰» with no تومان, the barfbox.ir layout) is present. */
function chunkHasPriceText(plainText: string): boolean {
  return PRICE_HINT_RE.test(plainText) || THOUSANDS_RE.test(plainText);
}
/**
 * Python parity (scraper4.py extract_price): a currency word wins, but a bare
 * thousands-grouped number is still a price — the longest digit run wins.
 */
function heuristicPriceText(plainText: string): string {
  const hint = plainText.match(PRICE_HINT_RE)?.[0];
  if (hint) return normalize(hint);
  let best = '';
  for (const m of plainText.matchAll(THOUSANDS_GLOBAL_RE)) {
    if (m[0].replace(/[^\d۰-۹٠-٩]/g, '').length > best.replace(/[^\d۰-۹٠-٩]/g, '').length) best = m[0];
  }
  return normalize(best);
}
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
  const curatedSelectors = { ...selectors };
  const curatedEvidence = { ...evidence };
  let structuralSelectors: Partial<Selectors> | null = null;
  let structuralEvidence: Record<string, unknown> = {};
  if (!selectors.container || !selectors.title) {
    try {
      const structural = inferStructuralListSelectors(html, baseUrl);
      if (structural) {
        structuralSelectors = { ...structural.selectors };
        structuralEvidence = { ...structural.evidence };
        for (const [key, value] of Object.entries(structural.selectors)) {
          if (value && !(selectors as any)[key]) {
            (selectors as any)[key] = value;
            (evidence as any)[key] = { ...((structural.evidence as any)[key] || {}), via: 'structural' };
          }
        }
      }
    } catch { /* structural pass is best-effort */ }
  }
  // Final gate, best-of ranking: curated candidates match page-wide (an 'h2'
  // page heading wins 'title'), while structural selectors are card-scoped —
  // merging both can poison a good structural container with a bad curated
  // title (barfbox.ir: 12 good cards vetoed by 2 page headings). Verify the
  // merged set first, then each pass alone; the first set whose titles
  // resolve INSIDE the cards wins, so a stale stowaway can never veto a
  // working set.
  const mergedMethod: ListDiscoveryMethod = !structuralSelectors ? 'curated'
    : (curatedSelectors.container && curatedSelectors.title ? 'mixed' : 'structural');
  const candidates: Array<{ sel: Partial<Selectors>; ev: Record<string, unknown>; method: ListDiscoveryMethod }> = [
    { sel: selectors, ev: evidence, method: mergedMethod },
    ...(structuralSelectors ? [{ sel: structuralSelectors, ev: structuralEvidence, method: 'structural' as ListDiscoveryMethod }] : []),
    { sel: curatedSelectors, ev: curatedEvidence, method: 'curated' },
  ];
  let containerCount = 0;
  for (const candidate of candidates) {
    if (!candidate.sel.container || !candidate.sel.title) continue;
    const verified = verifyListSelectors(html, baseUrl, { ...DEFAULT_SELECTORS, ...candidate.sel } as Selectors);
    containerCount = verified.containerCount;
    if (verified.ok) return { selectors: candidate.sel, evidence: candidate.ev, method: candidate.method, containerCount };
  }
  return { selectors: {}, evidence: {}, method: 'none', containerCount };
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
export async function testSelector(url: string, selector: string, type = 'text',engine?:string,gallery?:{max?:number;skipFirst?:boolean}): Promise<{ count: number; values: string[] }> {
  const { text, url: final } = await selectorToolDocument(url,engine); const $ = cheerio.load(text); const values: string[] = [];
  let nodes: cheerio.Cheerio<any>; try { nodes = $(xpathToCss(selector) ?? selector); } catch (error) { throw invalidSelectorError(selector, error); }
  if(type==='gallery'&&isBrowserSelectorEngine(engine)){
    const images:string[]=[];
    nodes.each((_i,el)=>{const node=$(el);const candidates=node.is('img,source,a[href]')?node.add(node.find('img,source')):node.find('img,source');candidates.each((_j,img)=>{const image=$(img),value=absolute(image.attr('data-src')||image.attr('src')||image.attr('href')||'',final);if(value&&!images.includes(value))images.push(value)});});
    const values=images.slice(gallery?.skipFirst?1:0).slice(0,Math.max(1,Math.min(30,Number(gallery?.max)||30)));return {count:values.length,values};
  }
  nodes.slice(0, 20).each((_i, el) => { const node = $(el); let value = type === 'link' ? absolute(node.attr('href') || '', final) : type === 'image' ? absolute(node.attr('src') || node.attr('data-src') || '', final) : normalize(node.text()); if (value) values.push(value.slice(0, 1000)); });
  return { count: nodes.length, values };
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
/**
 * Normalize any invalid-selector failure (tagged at the throw site, or a raw
 * engine message that leaked through) into the one diagnosis reason, so the
 * report names the breakage instead of blaming the container. Twin: worker.
 */
function invalidSelectorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error || '');
  if (!msg) return '';
  if (msg.startsWith('سلکتور نامعتبر')) return msg;
  if (/attribute selector|didn't terminate|not a valid selector|unknown pseudo/i.test(msg)) return `سلکتور نامعتبر: ${msg}`;
  return '';
}
/**
 * 1.141.0 — fetch-aware diagnosis hints. When the run failed before (or
 * without) parsing — a 429 throttle, a 403 ban, a dead connection — the
 * content-based hint below would mislead ("this site has no structured
 * data" blames the site for a transport problem). The fetch error is the
 * story then, so it gets its own hint. Tagged selector errors are NOT fetch
 * failures and return '' (the R5 selector hint keeps priority: a broken
 * selector stays broken after any retry). Twin: worker-src/scraper.ts.
 */
export function fetchErrorHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message || /سلکتور نامعتبر/.test(message)) return '';
  if (/HTTP 429/.test(message)) return 'سایت درخواست‌ها را محدود کرده (خطای 429)؛ یک دقیقه صبر کنید و بعد با صفحه‌های کمتر دوباره تلاش کنید.';
  if (/HTTP 403/.test(message)) return 'سایت دسترسی را بست (خطای 403)؛ معمولاً IP دیتاسنتر یا VPN است. اتصال غیرمستقیم (Worker واسط) را امتحان کنید.';
  if (/مهلت|timeout|timed out|abort|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|network|Network|ERR_|HTTP (502|503|504)/.test(message)) return 'دریافت صفحه از سایت ناموفق بود؛ آدرس، اتصال اینترنت و وضعیت سایت را بررسی کنید و دوباره تلاش کنید.';
  return '';
}
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
    if (!list.length) {
      // The run error beats the generic network guess: a broken selector and
      // a throttled fetch need different next steps from the user.
      const bad = invalidSelectorMessage(error), fetch = fetchErrorHint(error);
      if (bad) hint = 'یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.';
      else if (fetch) hint = fetch;
    }
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
    const badSelector = invalidSelectorMessage(error) || verified?.error || '';
    if (badSelector) {
      dropReasons.push(badSelector);
      hint = 'یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.';
    } else if (!containerSel) {
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
    const priceHints = countMatches(stripPriceFormatChars(stripHtml(text)), PRICE_HINT_RE);
    const barePrices = countMatches(stripHtml(text), THOUSANDS_RE);
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
  } else if (engine === 'structural') {
    let containers = 0;
    try { containers = cheerio.load(text)(STRUCTURAL_CONTAINERS).length; } catch { containers = 0; }
    let anchors = 0;
    for (const m of text.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
      if (STRUCTURAL_CLIMB_RE.test(m[1] || '')) anchors++;
      if (anchors > 5000) break;
    }
    const priceHints = countMatches(stripPriceFormatChars(stripHtml(text)), PRICE_HINT_RE);
    candidates = Math.max(containers, anchors);
    signals.structuralContainers = containers; signals.productAnchors = anchors; signals.priceHints = priceHints;
    if (!containers && !anchors) {
      dropReasons.push('نه کارت محصول شناخته‌شده‌ای (li.product و…) پیدا شد نه لینک محصول (/product/ ،/shop/ و…).');
      hint = 'صفحه احتمالاً پوستهٔ جاوااسکریپتی است یا فهرست محصول ندارد؛ موتور مرورگری (نمایشی) یا آدرس صفحه را بررسی کنید.';
    } else if (!list.length) {
      if (error) dropReasons.push(error);
      dropReasons.push(`${Math.max(containers, anchors)} کارت/لینک محصول دیده شد ولی هیچ‌کدام عنوان یا لینک سالم نداشتند (حذف شدند).`);
      if (!priceHints) dropReasons.push('در کل صفحه هیچ متن قیمت‌داری (تومان/ریال/…) دیده نشد؛ احتمالاً قیمت‌ها با جاوااسکریپت می‌آیند.');
      hint = 'کارت‌های این صفحه با الگوهای ساختاری خوانده نشدند؛ موتور مرورگری (نمایشی) یا سلکتور دستی را امتحان کنید.';
    } else {
      hint = `موتور سالم است: ${list.length} محصول بدون نیاز به سلکتور پیدا شد${partialNote()}.`;
    }
  } else {
    candidates = list.length;
    signals.note = 'engine-specific signals are not measured for this engine';
    if (error) dropReasons.push(error);
    else if (!list.length) dropReasons.push('موتور محصولی استخراج نکرد.');
    // A broken saved selector gets the same fix-it hint as the selector
    // engines — echoing the raw error back taught the user nothing. Fetch
    // failures are translated by the shared block before the final return.
    const badSelectorError = invalidSelectorMessage(error);
    hint = list.length ? `موتور ${list.length} محصول استخراج کرد${partialNote()}.` : badSelectorError ? 'یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.' : (error || 'موتور محصولی استخراج نکرد؛ خطا را بررسی کنید.');
  }
  if (error && !dropReasons.includes(error) && !dropReasons.some(reason => reason.includes(error)) && !list.length) dropReasons.unshift(error);
  // 1.141.0 — a fetch failure beats every content-based guess: the engine
  // never saw a parseable page, so "this site has no X" would blame the site
  // for a transport problem. A tagged selector error keeps its R5 hint — it
  // is the one failure a retry cannot fix.
  const fetchHint = !list.length ? fetchErrorHint(error) : '';
  if (fetchHint && !dropReasons.some(reason => String(reason).includes('سلکتور نامعتبر'))) hint = fetchHint;
  return { engine, candidates, extracted: list.length, complete, sample, dropReasons, hint, signals };
};

export async function diagnoseExtraction(profile: Profile, urlOverride = '', onProgress?: DiagnosticObserver) {
  const started = Date.now(), url = String(urlOverride || profile.url || '').trim();
  const stages: any[] = [], recommendations: string[] = [];
  if(profile.pagination==='none'&&profile.networkIndirect&&['auto','playwright','puppeteer','crawlee_playwright','network_api'].includes(profile.extractionEngine||'auto'))recommendations.push('حالت بدون صفحه‌بندی از مسیر قدیمی موتور استفاده می‌کند؛ در موتورهای مرورگر، عبور ترافیک مرورگر از Worker تضمین نشده است. گزینهٔ اسکرول تا انتها همچنان مسیر محافظت‌شدهٔ جداگانه دارد.');
  const progress = diagnosticProgress(onProgress);
  const add = (name: string, ok: boolean, summary: string, details: any = {}) => { const stage = { name, ok, summary, ...details }; stages.push(stage); progress.finish(stage); };
  if (!url) {
    add('configuration', false, 'آدرس مبدأ خالی است.');
    return { ok: false, profileId: profile.id, url, stages, selectorsToSave: {}, recommendations: ['آدرس صفحهٔ فهرست محصولات را در پروفایل وارد کنید.'] };
  }
  let page: { text: string; url: string };
  try {
    progress.begin('network', 'در حال اتصال به مبدأ و دریافت HTML…', {url, indirect: Boolean(profile.networkIndirect)});
    page = await safeText(url, 4_000_000, { indirect: Boolean(profile.networkIndirect) });
    const bytes = Buffer.byteLength(page.text, 'utf8');
    const title = normalize(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || '');
    add('network', true, `صفحه با ${bytes.toLocaleString('fa-IR')} بایت دریافت شد.`, { requestedUrl: url, finalUrl: page.url, bytes, title, runtime: 'node', indirect: Boolean(profile.networkIndirect), route: sourceRoute(Boolean(profile.networkIndirect)) });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    add('network', false, text, { requestedUrl: url, runtime: 'node', indirect: Boolean(profile.networkIndirect), route: sourceRoute(Boolean(profile.networkIndirect)) });
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
    progress.begin('list-extraction', 'در حال اجرای موتور استخراج فهرست و بررسی سلکتورها…', {engine: profile.extractionEngine || 'auto'});
    const result = await scrapeListWithMeta(page.url, profile.selectors, profile.extractionEngine || 'auto', profile.extractionEngineMaster, true, '', true, Boolean(profile.networkIndirect),profile.pagination==='scroll',undefined,page,selectedProductParser(profile));
    products = result.products; usedEngine = result.usedEngine;
    // 1.146.0 — a browser run that finds nothing must say WHY: no browser
    // on the device, or rendered-but-empty (the layer names the outcome).
    const browserProfile = BROWSER_ENGINES.has(profile.extractionEngine || 'auto');
    const browserAvailable = browserProfile ? browserEngineAvailable() : true;
    if (!overriddenTestUrl && result.discoveredSelectors) for (const [key, value] of Object.entries(result.discoveredSelectors)) if (String(value || '').trim()) selectorsToSave[key] = String(value);
    const complete = {
      title: products.filter(x => x.title).length, price: products.filter(x => x.price > 0).length,
      link: products.filter(x => x.url).length, image: products.filter(x => x.image).length, sku: products.filter(x => x.sku).length
    };
    add('list-extraction', products.length > 0,
      products.length ? `${products.length.toLocaleString('fa-IR')} محصول با pipeline واقعی استخراج شد.`
        : !browserAvailable ? 'موتور مرورگری انتخاب شده ولی مرورگری روی این دستگاه پیدا نشد؛ بدون آن هیچ رندری انجام نمی‌شود.'
        : result.renderedSnapshot && result.renderedSnapshot.htmlLength <= BLANK_RENDER_HTML_MAX ? `مرورگر به‌جای فروشگاه یک صفحهٔ خالی تحویل گرفت (فقط ${result.renderedSnapshot.htmlLength.toLocaleString('fa-IR')} بایت)؛ جزئیات در snapshot.`
        : browserProfile && result.browserLayer === 'none' ? 'مرورگر رندر کرد ولی هیچ لایه‌ای محصولی پیدا نکرد (نه سلکتور، نه structural، نه heuristic).'
        : profile.extractionEngine === 'network_api' && result.networkApiStats && result.networkApiStats.responsesSeen === 0 && result.networkApiStats.failedResponses === 0 ? 'مرورگر رندر کرد ولی هیچ درخواست API (XHR/fetch) دیده نشد.'
        : profile.extractionEngine === 'network_api' && result.networkApiStats && result.networkApiStats.responsesSeen === 0 && result.networkApiStats.failedResponses > 0 ? `صفحه ${result.networkApiStats.failedResponses.toLocaleString('fa-IR')} درخواست API زد ولی همه ناموفق بودند؛ کدهای وضعیت در لاگ است.`
        : profile.extractionEngine === 'network_api' && result.networkApiStats && result.networkApiStats.parsed === 0 ? `مرورگر ${result.networkApiStats.jsonBodies.toLocaleString('fa-IR')} پاسخ API گرفت ولی محصولی از آن‌ها خوانده نشد.`
        : 'هیچ محصولی از موتورهای خودکار یا سلکتورهای دستی استخراج نشد.',
      { count: products.length, usedEngine, ...(selectedProductParser(profile)?{productParser:selectedProductParser(profile)}:{}), ...(result.browserDiagnostics?{browser:result.browserDiagnostics}:{}), ...(result.browserLayer ? { browserLayer: result.browserLayer } : {}), ...(browserProfile ? { browserAvailable } : {}), ...(result.engineError ? { engineError: result.engineError } : {}), ...(result.networkApiStats ? { networkApi: result.networkApiStats } : {}), ...(result.renderedSnapshot ? { snapshot: result.renderedSnapshot } : {}), complete, selectors: profile.selectors, samples: products.slice(0, 5).map(x => ({ title: x.title, price: x.price, priceText: x.priceText, url: x.url, image: x.image, sku: x.sku })) });
  } catch (error) {
    add('list-extraction', false, error instanceof Error ? error.message : String(error), { selectors: profile.selectors, ...((error as any)?.browserDiagnostics?{browser:(error as any).browserDiagnostics}:{}), ...((error as any)?.scrollRequests?{scrollRequests:(error as any).scrollRequests}:{}) });
  }
  // 1.128.0 — when nothing extracted, show what proactive auto-discovery sees
  // on the same page. Verified discoveries above are handed to the route for
  // auto-save (1.135.0); this block still shows raw, unverified findings for
  // the manual suggest button when auto-save had nothing to persist.
  if (!products.length) {
    try {
      progress.begin('selector-discovery', 'در حال جست‌وجوی ساختار کارت‌های محصول…');
      const discovery = discoverListSelectorsFromHtml(page.text, page.url);
      const proposed = Object.entries(discovery.selectors).filter(([, value]) => String(value || '').trim());
      if (discovery.method !== 'none' && proposed.length >= 2 && discovery.selectors.container && discovery.selectors.title) {
        add('selector-discovery', true,
          `موتور استخراج ${discovery.containerCount.toLocaleString('fa-IR')} کارت محصول را بدون نیاز به سلکتور دستی پیدا کرد (روش: ${discovery.method === 'structural' ? 'تحلیل ساختاری صفحه' : discovery.method === 'mixed' ? 'ترکیبی' : 'الگوهای آماده'})؛ این یافته مربوط به HTML اولیه است و موفقیت مرورگر یا اسکرول را ثابت نمی‌کند.`,
          { method: discovery.method, selectors: discovery.selectors, evidence: discovery.evidence, containerCount: discovery.containerCount });
        if (!Object.keys(selectorsToSave).length && !(await verifyListSelectors(page.text,page.url,profile.selectors)).ok) recommendations.push('دکمهٔ «پیشنهاد خودکار سلکتورها» را بزنید تا همین سلکتورهای پیداشده ذخیره شوند، سپس استخراج را دوباره اجرا کنید.');
      } else {
        add('selector-discovery', false, 'کشف خودکار هم الگوی کارت محصولی در این صفحه پیدا نکرد؛ احتمالاً صفحه جاوااسکریپتی است (پس از بارگذاری کامل رندر می‌شود)، نیازمند ورود است، یا محصولی در آن نیست.', { method: discovery.method });
      }
    } catch(error) { progress.finish({name:'selector-discovery',ok:false,summary:String(error)}); }
  }
  progress.begin('selector-evidence', 'در حال بررسی تک‌تک سلکتورها روی HTML واقعی…');
  const evidence: Record<string, unknown> = {};
  for (const field of ['container', 'title', 'price', 'link', 'image'] as const) {
    progress.begin('selector-evidence', 'در حال بررسی سلکتور '+field, {field});
    const selector = String((profile.selectors as any)?.[field] || '').trim();
    if (!selector) { evidence[field] = { ok: false, count: 0, error: 'سلکتور خالی است' }; continue; }
    try {
      const type = field === 'link' ? 'link' : field === 'image' ? 'image' : 'text';
      const values = await extractSelectorValues(page.text, page.url, selector, type);
      evidence[field] = { ok: values.length > 0, count: values.length, sample: values.slice(0, 3) };
    } catch (error) { evidence[field] = { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }; }
  }
  const scoped=await verifyListSelectors(page.text,page.url,{...profile.selectors,...selectorsToSave});
  const containerCount=scoped.containerCount;
  const evidenceOk=containerCount>0&&Number(scoped.title.count||0)>0;
  const scopedEvidence={container:{ok:containerCount>0,count:containerCount},...Object.fromEntries(['title','price','link','image'].map(key=>[key,{...(scoped as any)[key],ok:(scoped as any)[key].count>0}]))};
  add('selector-evidence',evidenceOk,
    evidenceOk?'سلکتورها داخل کارت‌های واقعی HTML اولیه معتبرند؛ نتیجهٔ مرورگر و اسکرول جداگانه بررسی می‌شود.':'سلکتور ظرف یا عنوان داخل کارت‌های HTML اولیه نتیجه نداد.',
    {evidence:scopedEvidence,containerCount,cardsSampled:scoped.cardsSampled,documentEvidence:evidence,scope:'عنوان، قیمت، لینک و تصویر فقط داخل کارت‌ها بررسی شدند؛ شاهد کل صفحه نمونهٔ محدود است.'});
  let detail: any = null;
  progress.begin('detail-extraction', 'در حال بررسی نمونهٔ محصول و استخراج جزئیات…');
  const candidate = products.find(product => product.url);
  const detailKeys = ['shortDesc', 'longDesc', 'sku', 'category', 'tags', 'weight', 'stock', 'brand', 'detailImage', 'gallery', 'variations'];
  const wantsDetail = detailKeys.some(key => String((profile.selectors as any)?.[key] || '').trim().length > 0);
  if (candidate && wantsDetail) {
    try {
      const extracted = await scrapeDetails(candidate, profile.selectors, Boolean(profile.networkIndirect));
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
        progress.begin('detail-discovery', 'در حال دریافت صفحهٔ محصول برای پیشنهاد سلکتورهای جزئیات…');
        const suggested = await suggestSelectors(detailSample, 'detail');
        for (const [key, value] of Object.entries(suggested.selectors || {})) {
          if (String(value || '').trim() && (missingDetail as string[]).includes(key)) selectorsToSave[key] = String(value);
        }
        progress.finish({name:'detail-discovery',ok:true,summary:'پیشنهاد سلکتورهای جزئیات بررسی شد.'});
      } catch(error) { progress.finish({name:'detail-discovery',ok:false,summary:String(error)}); }
    }
  }
  if (Object.keys(selectorsToSave).length) recommendations.push('سلکتورهای پیداشده به‌صورت خودکار در تب سلکتورها ذخیره شدند؛ استخراج را دوباره اجرا کنید.');
  const deepPage = Number((url.match(/[?&](page|pg|pageNumber|page_number)=(\d+)/i) || [])[2] || 0);
  if (!products.length && deepPage > 1) recommendations.push(`آدرس صفحهٔ ${deepPage.toLocaleString('fa-IR')} است؛ اول همین عیب‌یاب را روی صفحهٔ اول (بدون پارامتر صفحه) اجرا کنید — صفحه‌های عمیق اغلب خالی‌اند یا ساختار دیگری دارند.`);
  if (!products.length && !evidenceOk) recommendations.push('سلکتور ظرف محصول را با HTML واقعی اصلاح کنید؛ پیشنهاد خودکار را اجرا و سپس دوباره همین عیب‌یاب را بزنید.');
  else if(products.length) {
    if (!products.some(x => x.price > 0)) recommendations.push('محصول پیدا شده ولی قیمت صفر است؛ سلکتور قیمت و واحد/متن قیمت را بررسی کنید.');
    if (!products.some(x => x.url)) recommendations.push('لینک محصول پیدا نشده است؛ سلکتور لینک باید به عنصر a یا ویژگی href/data-url برسد.');
    if (!products.some(x => x.image)) recommendations.push('تصویر پیدا نشده است؛ data-src، srcset یا سلکتور تصویر را بررسی کنید.');
  }
  if(!products.length&&evidenceOk)recommendations.push('سلکتورهای فعلی در کارت‌های HTML اولیه معتبرند؛ خطای مرحلهٔ استخراج، مرورگر و ارتباط غیرمستقیم را بررسی کنید. صفر محصول پس از خطای مرورگر دلیل خرابی سلکتور نیست و کامل‌شدن اسکرول را تأیید نمی‌کند.');
  const failed = stages.filter(stage => !stage.ok);
  return { ok: products.length > 0 && failed.length === 0, profileId: profile.id, url, finalUrl: page.url, durationMs: Date.now() - started, productCount: products.length, usedEngine, stages, recommendations, detail, selectorsToSave };
}
