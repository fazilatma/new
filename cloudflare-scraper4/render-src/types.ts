export type Selectors = {
  container: string;
  title: string;
  price: string;
  link: string;
  image: string;
  shortDesc?: string;
  longDesc?: string;
  sku?: string;
  brand?: string;
  stock?: string;
  weight?: string;
  category?: string;
  gallery?: string;
};

export type ExtractionEngine = 'auto' | 'cheerio' | 'htmlrewriter' | 'jsonld' | 'next_data' | 'metadata' | 'script_json' | 'heuristic' | 'playwright' | 'puppeteer' | 'crawlee_playwright';

export type Profile = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  pages: number;
  pagination: 'query_page' | 'path_page' | 'none';
  extractionEngine: ExtractionEngine;
  extractionEngineMaster?: ExtractionEngine;
  extractionEngineHost?: string;
  extractionEngineMs?: number;
  extractionEngineBenchmarks?: Array<{engine: ExtractionEngine; elapsedMs: number; pagesScanned: number; products: number; productsPerMinute: number; ok: boolean; error?: string}>;
  paginationValue: string;
  selectors: Selectors;
  titleSuffix: string;
  priceMode: 'none' | 'add' | 'percent' | 'multiply';
  priceValue: number;
  roundPrice: number;
  minPrice: number;
  wooCategoryId: number;
  basalamCategoryId: number;
  syncWoo: boolean;
  syncBasalam: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Product = {
  sourceKey: string;
  title: string;
  price: number;
  priceText: string;
  url: string;
  image: string;
  images: string[];
  shortDesc?: string;
  longDesc?: string;
  sku?: string;
  brand?: string;
  stock?: number;
  weight?: number;
  category?: string;
  sourcePage: string;
  scrapedAt: string;
};

export type Job = {
  id: string;
  profileId: string;
  kind: 'scrape' | 'sync';
  target: 'none' | 'woo' | 'basalam' | 'both';
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  phase: string;
  total: number;
  processed: number;
  added: number;
  updated: number;
  failed: number;
  /** Products skipped because the source had no usable price. */
  skippedNoPrice?: number;
  stopRequested: boolean;
  error: string | null;
  log: Array<{ at: string; level: string; message: string; event?: 'added'|'updated'|'failed'|'removed'|'out-of-stock'|'zero-price'|'price-increased'|'price-decreased'|'sync-created'|'sync-updated'; item?: {sourceKey:string;title:string;url?:string;target?:string;shop?:string;price?:number;oldPrice?:number;newPrice?:number;delta?:number;percent?:number;error?:string;transport?:string} }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export const DEFAULT_SELECTORS: Selectors = {
  container: 'li.product',
  title: 'h2, h3, .woocommerce-loop-product__title',
  price: '.price, .amount',
  link: 'a[href]',
  image: 'img'
};
