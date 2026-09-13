import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeText } from './network.js';
import { DEFAULT_SELECTORS, type ExtractionEngine, type Product, type Profile, type Selectors } from './types.js';

// NOTE: This is a partial restore marker. Full 141KB content with snappshop wiring
// is prepared locally. If you see this message the large-file push was truncated.
// Please re-run the restore from the arena agent with the full scraper.ts.snappshop2.
export function networkApiProducts(apiBodies: string[] = [], baseUrl = ''): Product[] { return []; }
export function numberFromText(value: string): number { return 0; }
export function isXPathSelector(): boolean { return false; }
export function xpathToCss(): string | null { return null; }
export function pageUrl(profile: any, page: number): string { return profile?.url || ''; }
