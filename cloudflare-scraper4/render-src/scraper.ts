import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { safeText } from './network.js';
import type { ExtractionEngine, Product, Profile, Selectors } from './types.js';

const normalize = (value: string) => value.replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
const absolute = (value: string, base: string) => { try { const url = new URL(value, base); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };

export function numberFromText(value: string): number {
  const en = value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const groups = en.match(/\d[\d,٬.\s]*/g) || [];
  return groups.length ? Math.max(...groups.map(item => Number(item.replace(/\D/g, '')) || 0)) : 0;
}

function sourceKey(url: string, title: string): string { return createHash('sha256').update(url || title).digest('hex').slice(0, 32); }
function firstText($root: cheerio.Cheerio<any>, selector: string): string { return normalize($root.find(selector).first().text()); }
function firstAttr($root: cheerio.Cheerio<any>, selector: string, attrs: string[]): string {
  const node = $root.find(selector).first();
  for (const attr of attrs) { const value = node.attr(attr); if (value && value !== '#') return value; }
  return '';
}

export function pageUrl(profile: Profile, page: number): string {
  const url = new URL(profile.url);
  if (page <= 1 || profile.pagination === 'none') return url.href;
  const pageNumber = (base: number) => Math.max(1, base) + (page - 1);
  if (profile.pagination === 'path_page') {
    const current = Number(url.pathname.match(/\/page\/(\d+)\/?$/i)?.[1] || 1);
    url.pathname = url.pathname.replace(/\/page\/\d+\/?$/i, '').replace(/\/$/, '') + `/page/${pageNumber(current)}/`;
    return url.href;
  }
  const param = profile.paginationValue || 'page';
  const current = Number(url.searchParams.get(param) || 1);
  url.searchParams.set(param, String(pageNumber(current)));
  return url.href;
}

function scrapeListCheerioFromHtml(text: string, finalUrl: string, selectors: Selectors): Product[] {
  const $ = cheerio.load(text); const products: Product[] = [];
  $(selectors.container).each((_index, element) => {
    const root = $(element); const title = firstText(root, selectors.title); if (!title) return;
    const priceText = firstText(root, selectors.price);
    const link = absolute(firstAttr(root, selectors.link, ['href','data-href','data-url','data-product-url']), finalUrl);
    let imageValue = firstAttr(root, selectors.image, ['data-src','data-lazy-src','data-original','src']);
    if (!imageValue) imageValue = (firstAttr(root, selectors.image, ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
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

export type ScrapeListResult={products:Product[];usedEngine:ExtractionEngine;elapsedMs:number};
const RENDER_DISCOVERY_ENGINES:ExtractionEngine[]=['jsonld','next_data','script_json','heuristic','metadata'];
const RENDER_MANUAL_ENGINES=new Set<ExtractionEngine>(['cheerio','htmlrewriter']);
const RENDER_AUTO_ENGINES:ExtractionEngine[]=[...RENDER_DISCOVERY_ENGINES,'cheerio','playwright','puppeteer','crawlee_playwright'];
function engineOrder(requested:ExtractionEngine,master?:ExtractionEngine):ExtractionEngine[]{const out:ExtractionEngine[]=[],add=(engine?:ExtractionEngine)=>{if(engine&&!out.includes(engine))out.push(engine)};if(master&&!RENDER_MANUAL_ENGINES.has(master))add(master);for(const engine of RENDER_DISCOVERY_ENGINES)add(engine);if(requested!=='auto')add(requested);else for(const engine of RENDER_AUTO_ENGINES)add(engine);return out}

export async function scrapeListWithMeta(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto', master?: ExtractionEngine): Promise<ScrapeListResult> {
  const started=Date.now();
  let sourcePromise:Promise<{text:string;url:string}>|null=null;
  const source=()=>sourcePromise ||= safeText(url);
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
  for(const name of engineOrder(engine,master)){
    try{
      const products=dedupe(await pick(name));
      if(products.length||engine!=='auto')return{products,usedEngine:name,elapsedMs:Date.now()-started};
    }catch(error){
      if(engine!=='auto')throw error;
    }
  }
  return{products:[],usedEngine:engine,elapsedMs:Date.now()-started};
}
export async function scrapeList(url: string, selectors: Selectors, engine: ExtractionEngine = 'auto'): Promise<Product[]> { return (await scrapeListWithMeta(url, selectors, engine)).products; }

function browserExecutable(driver: 'playwright'|'puppeteer'): string | undefined {
  const env = process.env;
  return env.BROWSER_EXECUTABLE_PATH || (driver === 'playwright' ? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : env.PUPPETEER_EXECUTABLE_PATH) || env.CHROME_BIN || undefined;
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
  $(selectors.container).each((_index, element) => {
    const root = $(element); const title = firstText(root, selectors.title); if (!title) return;
    const priceText = firstText(root, selectors.price);
    const link = absolute(firstAttr(root, selectors.link, ['href','data-href','data-url','data-product-url']), baseUrl);
    let imageValue = firstAttr(root, selectors.image, ['data-src','data-lazy-src','data-original','src']);
    if (!imageValue) imageValue = (firstAttr(root, selectors.image, ['srcset']).split(',')[0] || '').trim().split(/\s+/)[0];
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
