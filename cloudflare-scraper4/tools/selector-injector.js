/* Scraper4 selector injector — paste into the DevTools console on any shop page.
 *
 * Finds the product grid on the LIVE rendered page (works on JS-rendered shops
 * like Snappshop where fetch-based engines see a shell or a bot wall), derives
 * worker-safe CSS selectors (container/title/price/link/image), verifies them
 * on the page, and prints a profile JSON ready for dashboard import.
 *
 * Usage: open the shop category page, scroll once so cards render, open DevTools
 * (F12) → Console, paste this whole file, press Enter. Cards get a green
 * outline; the selectors + profile JSON are printed below.
 *
 * No dependencies, no network calls, no layout APIs; only standard DOM reads.
 * Version: 1.0.0 (bump when this script changes).
 */
const S4I = (() => {
'use strict';
const VERSION = '1.0.0';

/* ---------------- text helpers (Persian-digit aware) ---------------- */
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
function fold(s) {
  return String(s == null ? '' : s)
    .replace(/[۰-۹]/g, d => FA.indexOf(d))
    .replace(/[٠-٩]/g, d => AR.indexOf(d));
}
function clean(s) { return fold(s).replace(/\s+/g, ' ').trim(); }
function elText(el) { try { return clean(el.textContent || ''); } catch (e) { return ''; } }

/* A text is ONLY a price when it holds >=3 digits and nothing but digits,
 * separators and currency words. Titles with model numbers ("M-1100") or
 * badges ("خرید قسطی") fail here, which is exactly what we want. */
const CURRENCY_WORDS = /تومان|تومن|ریال|irs?|usd|eur|gbp|aed|try|toman|rial|\$|€|£|¥|₺|₹|₽|﷼/gi;
function priceVal(text) {
  let t = clean(text);
  if (!t || t.length > 64) return -1;
  if (/[%٪]/.test(t)) return -1;
  t = t.replace(/^(از|from|to|تا)\s+/i, '');
  const digits = t.replace(/\D/g, '');
  if (digits.length < 3) return -1;
  const rest = t.replace(/[\d\s,٬،.٫_+\-]/g, '').replace(CURRENCY_WORDS, '').trim();
  if (/[A-Za-z\u0600-\u06FF]/.test(rest)) return -1;
  return Number(digits);
}
function maxDigits(text) {
  const t = clean(text);
  let best = 0;
  const re = /\d[\d\s,٬،.٫]*/g;
  let m;
  while ((m = re.exec(t))) {
    const d = m[0].replace(/\D/g, '').length;
    if (d > best) best = d;
  }
  return best;
}

/* ---------------- tiny DOM helpers (linkedom-safe subset) ---------------- */
function tag(el) { return String((el && el.tagName) || '').toLowerCase(); }
function kids(el) {
  try { return Array.prototype.slice.call(el.children || []); } catch (e) { return []; }
}
function all(root, sel) {
  try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; }
}
function attr(el, name) {
  try { const v = el.getAttribute(name); return v == null ? '' : String(v); } catch (e) { return ''; }
}
function hasImg(node) {
  try { return !!node.querySelector('img'); } catch (e) { return false; }
}

/* ---------------- class-token stability (mirrors the structural engine) ---------------- */
const VOLATILE = /^(active|selected|current|open|opened|hover|focus|disabled|loading|ng-|v-|is-|has-|js-)/i;
const FULLHASH = /^[a-f0-9]{6,}$/i;
const HASHSEG = /^[A-Za-z0-9]{3,10}$/;
function hashish(seg) {
  if (!HASHSEG.test(seg)) return false;
  return (/[a-z]/.test(seg) && /[A-Z]/.test(seg)) || (/\d/.test(seg) && /[A-Za-z]/.test(seg));
}
/* `productPrice__new__a1B2c` → `productPrice__new`; CSS-module hashes never
 * survive a rebuild, so the stable prefix is what a selector must use. */
function stableToken(cls) {
  if (!cls || cls.length > 48 || VOLATILE.test(cls) || FULLHASH.test(cls)) return '';
  if (cls.indexOf('__') > 0) {
    const parts = cls.split('__');
    if (parts.length >= 2 && hashish(parts[parts.length - 1])) parts.pop();
    const joined = parts.join('__');
    if (!joined || VOLATILE.test(joined)) return '';
    return joined;
  }
  return cls;
}
function stableTokens(el) {
  const seen = {};
  const out = [];
  const toks = attr(el, 'class').split(/\s+/);
  for (const t of toks) {
    const s = stableToken(t);
    if (s && !seen[s]) { seen[s] = 1; out.push(s); }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}
function escAttr(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

/* ---------------- card discovery ---------------- */
const PRODUCT_HREF = /\/(product|products|p|item|items|goods|sku|pd|detail|product-detail)s?\//i;
function isProductHref(h) { return PRODUCT_HREF.test(h || '') || /\/snp-/i.test(h || ''); }
function productAnchors(doc) {
  const anchors = all(doc, 'a[href]').filter(a => {
    const h = attr(a, 'href');
    return h && h !== '#' && !/^(javascript|mailto|tel|data|blob):/i.test(h);
  });
  const cands = anchors.filter(a => isProductHref(attr(a, 'href')));
  if (cands.length >= 3) return cands.slice(0, 500);
  const fb = anchors.filter(hasImg);
  return (fb.length >= 3 ? fb : cands).slice(0, 500);
}
function distinctHrefs(node, isProd) {
  const seen = {};
  let n = 0;
  for (const a of all(node, 'a[href]')) {
    if (!isProd(a)) continue;
    const h = attr(a, 'href');
    if (h && !seen[h]) { seen[h] = 1; n++; }
  }
  return n;
}
/* An anchor that already holds image + price-like text IS the card (Snappshop
 * shape). Otherwise climb to the smallest ancestor with image + price, never
 * entering a node that holds 2+ distinct product links (that is the grid). */
function climbToCard(a, isProd) {
  let node = a;
  for (let i = 0; i < 6; i++) {
    if (hasImg(node) && maxDigits(elText(node)) >= 4) return node;
    const p = node.parentNode;
    if (!p || p.nodeType !== 1) return node;
    if (distinctHrefs(p, isProd) > 1) return node;
    node = p;
  }
  return node;
}
function cardSig(card) {
  const p = card.parentNode;
  const pt = p && p.nodeType === 1 ? tag(p) : '?';
  const toks = stableTokens(card).slice(0, 3).join('.');
  const ct = kids(card).map(tag).sort().join(',');
  return tag(card) + '|' + pt + '|' + toks + '|' + ct;
}
function clusterCards(cards) {
  const groups = {};
  for (const c of cards) {
    const s = cardSig(c);
    (groups[s] = groups[s] || []).push(c);
  }
  let best = [];
  for (const k in groups) if (groups[k].length > best.length) best = groups[k];
  const seen = new Set();
  return best.filter(c => !seen.has(c) && (seen.add(c), true));
}

/* ---------------- field location (mirrors structural priorities) ---------------- */
const OLDISH = /old|was|regular|compare|before|original|strike|previous|ex-price|last-price/i;
const SALEISH = /new|sale|final|current|special|now|discounted|offer/i;
const PRICEISH = /price|amount|cost|toman|rial|money/i;
function struck(el, top) {
  let n = el;
  while (n && n !== top) {
    if (n.nodeType === 1) {
      const t = tag(n);
      if (t === 'del' || t === 's' || t === 'strike') return true;
      if (OLDISH.test(attr(n, 'class') + ' ' + attr(n, 'id'))) return true;
    }
    n = n.parentNode;
  }
  return false;
}
function priceRank(el) {
  const c = attr(el, 'class') + ' ' + attr(el, 'id');
  let r = 0;
  if (SALEISH.test(c)) r += 4;
  if (PRICEISH.test(c)) r += 2;
  if (tag(el) === 'ins') r += 3;
  if (/content|price/i.test(attr(el, 'itemprop'))) r += 2;
  return r;
}
function priceCandidates(card) {
  const out = [];
  for (const el of all(card, '*').slice(0, 400)) {
    const t = tag(el);
    if (t === 'script' || t === 'style' || t === 'noscript' || t === 'a' || t === 'img' || t === 'br') continue;
    const v = priceVal(el.textContent || '');
    if (v < 0 || struck(el, card)) continue;
    let tight = true; // skip wrappers that merely CONTAIN a price element
    for (const c of kids(el)) {
      if (priceVal(c.textContent || '') >= 0) { tight = false; break; }
    }
    if (!tight) continue;
    out.push({ el, val: v, rank: priceRank(el) });
  }
  out.sort((a, b) => (b.rank - a.rank) || (a.val - b.val));
  return out;
}
function titleDirect(card) {
  for (const el of all(card, 'h1,h2,h3,h4,[class*="title"],[class*="name"],[itemprop="name"]')) {
    const t = elText(el);
    if (t.length >= 2 && t.length <= 300 && priceVal(t) < 0 && !/^[%٪]/.test(t)) return el;
  }
  return null;
}
/* Tightest element holding the longest non-price text bit. Intentionally
 * prefers real text over img alt: engines read element text via CSS, while
 * alt attributes are invisible to the selector path on one runtime. */
function titleBitEl(card) {
  const good = [];
  for (const el of all(card, '*').slice(0, 400)) {
    const t = tag(el);
    if (t === 'script' || t === 'style' || t === 'noscript' || t === 'img' || t === 'br' || t === 'a') continue;
    const tx = elText(el);
    if (tx.length < 8 || tx.length > 300) continue;
    if (priceVal(tx) >= 0 || /^[%٪]/.test(tx)) continue;
    good.push({ el, tx });
  }
  const tight = good.filter(g => !good.some(h => h !== g && g.tx.length > h.tx.length && g.tx.indexOf(h.tx) >= 0));
  tight.sort((a, b) => b.tx.length - a.tx.length);
  return tight.length ? tight[0].el : null;
}
function titleAltEl(card) {
  for (const im of all(card, 'img').slice(0, 10)) {
    if (clean(attr(im, 'alt') || attr(im, 'title')).length >= 2) return im;
  }
  return null;
}
const IMG_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-zoom-image'];
function imgUrl(img) {
  for (const a of IMG_ATTRS) {
    const v = attr(img, a);
    if (v && !/^data:/i.test(v) && v !== '#') return v;
  }
  return '';
}
function imageEl(card) {
  const imgs = all(card, 'img').slice(0, 10);
  for (const im of imgs) if (imgUrl(im)) return im;
  return imgs.length ? imgs[0] : null;
}

/* ---------------- selector synthesis (generate-and-validate) ---------------- */
function synthField(anchor, cards, ok) {
  const t = tag(anchor);
  const toks = stableTokens(anchor);
  const cands = [];
  for (const tok of toks) cands.push(t + '[class*="' + escAttr(tok) + '"]');
  for (const tok of toks) cands.push('[class*="' + escAttr(tok) + '"]');
  cands.push(t);
  for (const sel of cands) {
    let good = true;
    for (const card of cards) {
      const m = all(card, sel);
      if (m.length !== 1 || !ok(m[0])) { good = false; break; }
    }
    if (good) return sel;
  }
  return '';
}
function lcpPath(hrefs) {
  if (!hrefs.length) return '';
  let p = hrefs[0];
  for (const h of hrefs) {
    let i = 0;
    while (i < p.length && i < h.length && p[i] === h[i]) i++;
    p = p.slice(0, i);
    if (!p) return '';
  }
  const proto = p.indexOf('://');
  if (proto >= 0) {
    const slash = p.indexOf('/', proto + 3);
    p = slash >= 0 ? p.slice(slash) : '';
  }
  return p;
}
function validateContainer(doc, sel, cards, isProd) {
  const m = all(doc, sel);
  if (!m.length || m.length < cards.length) return null;
  const set = new Set(cards);
  let extra = 0;
  for (const x of m) {
    if (set.has(x)) continue;
    /* Extra matches must still be plausible cards (holding a product link):
     * a related-products strip then only widens coverage with a warning,
     * while junk matches reject the selector outright. */
    const holds = tag(x) === 'a' ? isProd(x) : distinctHrefs(x, isProd) >= 1;
    if (!holds) return null;
    extra++;
  }
  return { sel, extra };
}
/* No combinators, no :nth-of-type, no XPath: every suggestion must also run
 * on the Cloudflare Worker (HTMLRewriter), not just in this browser. */
function synthContainer(doc, cards, cardAnchors, isProd) {
  if (tag(cards[0]) === 'a') {
    const hrefs = cardAnchors.map(a => (a ? attr(a, 'href') : '')).filter(Boolean);
    if (hrefs.length === cards.length) {
      let tok = lcpPath(hrefs);
      /* Coincidental shared digits overfit (`/product/snp-1` when every slug
       * happens to start with 1): trim to a segment boundary first. */
      const bi = Math.max(tok.lastIndexOf('/'), tok.lastIndexOf('-'), tok.lastIndexOf('_'),
        tok.lastIndexOf('.'), tok.lastIndexOf('?'), tok.lastIndexOf('&'), tok.lastIndexOf('='), tok.lastIndexOf('#'));
      if (bi >= 3) tok = tok.slice(0, bi + 1);
      while (tok.length >= 4) {
        const v = validateContainer(doc, 'a[href*="' + escAttr(tok) + '"]', cards, isProd);
        if (v) return v;
        tok = tok.slice(0, -1);
      }
    }
  }
  const t = tag(cards[0]);
  for (const tok of stableTokens(cards[0])) {
    const cands = [t + '[class*="' + escAttr(tok) + '"]', '[class*="' + escAttr(tok) + '"]'];
    for (const sel of cands) {
      const v = validateContainer(doc, sel, cards, isProd);
      if (v) return v;
    }
  }
  return null;
}

/* ---------------- run ---------------- */
function pageUrl(doc, opts) {
  if (opts && opts.url) return String(opts.url);
  try {
    return String(doc.baseURI || doc.URL || doc.location || '');
  } catch (e) { return ''; }
}
function hostSlug(url) {
  const m = String(url).match(/^https?:\/\/([^/]+)/i);
  return (m ? m[1] : 'shop').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shop';
}
function run(doc, opts) {
  opts = opts || {};
  const quiet = !!opts.quiet;
  const log = (...a) => { if (!quiet) console.log(...a); };
  const warnings = [];
  const anchors = productAnchors(doc);
  const anchorSet = new Set(anchors);
  const isProd = el => anchorSet.has(el);
  const roots = anchors.map(a => climbToCard(a, isProd));
  const pool = roots.filter(r => {
    if (tag(r) === 'a') return all(r, 'a[href]').filter(x => x !== r && isProd(x)).length === 0;
    return distinctHrefs(r, isProd) >= 1;
  });
  const cards = clusterCards(pool);
  const cardSet = new Set(cards);
  const strayCount = new Set(pool.filter(r => !cardSet.has(r))).size;
  if (strayCount > 0) {
    warnings.push(strayCount + ' لینک محصول در کارتی با شکل متفاوت است و در استخراج خودکار پوشش داده نشد؛ دستی بررسی کنید.');
  }
  if (cards.length < 3) {
    const reason = 'کمتر از ۳ کارت محصول پیدا شد (پیدا شد: ' + cards.length + '). صفحه را اسکرول کنید تا محصولات لود شوند و دوباره اجرا کنید.';
    if (!quiet) console.warn('[S4] ' + reason);
    return { ok: false, reason, cards: cards.length, warnings };
  }
  const sample = cards.slice(0, 30);
  const cardAnchors = sample.map(c =>
    tag(c) === 'a' ? c : (all(c, 'a[href]').filter(isProd)[0] || all(c, 'a[href]')[0] || null));

  // Title: direct heading/title-class, else longest-text element, else img alt.
  let titleSel = '', titleFromAlt = false;
  for (const card of sample.slice(0, 5)) {
    const direct = titleDirect(card) || titleBitEl(card);
    if (direct) {
      titleSel = synthField(direct, sample, el => {
        const t = elText(el);
        return t.length >= 2 && priceVal(t) < 0;
      });
      if (titleSel) break;
    }
  }
  if (!titleSel) {
    const alt = titleAltEl(sample[0]);
    if (alt && synthField(alt, sample, el => clean(attr(el, 'alt')).length >= 2)) {
      titleFromAlt = true;
      warnings.push('عنوان فقط در alt تصویر پیدا شد؛ موتورها alt را با سلکتور CSS نمی‌خوانند — عنوان را دستی بررسی کنید.');
    } else {
      warnings.push('برای «عنوان» سلکتور مطمئن پیدا نشد؛ دستی تنظیم کنید.');
    }
  }

  // Price: ranked candidates (sale-ish first), sale-vs-old sanity check.
  let priceSel = '';
  outer:
  for (const card of sample.slice(0, 5)) {
    for (const cand of priceCandidates(card).slice(0, 3)) {
      const sel = synthField(cand.el, sample, el => priceVal(elText(el)) >= 0);
      if (sel) { priceSel = sel; break outer; }
    }
  }
  if (!priceSel) {
    warnings.push('برای «قیمت» سلکتور مطمئن پیدا نشد؛ دستی تنظیم کنید.');
  } else {
    let multi = 0, notMin = 0;
    for (const card of sample) {
      const vals = priceCandidates(card).map(c => c.val);
      if (vals.length > 1) {
        multi++;
        const chosen = priceVal(elText(all(card, priceSel)[0] || { textContent: '' }));
        if (chosen !== Math.min(...vals)) notMin++;
      }
    }
    if (multi > 0 && notMin > multi / 2) {
      warnings.push('قیمت پیشنهادی در بیشتر کارت‌ها بزرگ‌ترین عدد است؛ ممکن است قیمت قدیمی (خط‌خورده) باشد — بررسی کنید.');
    }
  }

  // Link + image.
  let linkSel = 'a[href]';
  if (tag(sample[0]) !== 'a') {
    let linkOk = true;
    for (const card of sample) {
      const m = all(card, 'a[href]');
      if (!m.length || !isProductHref(attr(m[0], 'href'))) { linkOk = false; break; }
    }
    if (!linkOk) { linkSel = ''; warnings.push('برای «لینک» سلکتور مطمئن پیدا نشد؛ دستی تنظیم کنید.'); }
  }
  let imageSel = '';
  const im0 = imageEl(sample[0]);
  if (im0) imageSel = synthField(im0, sample, el => !!imgUrl(el));
  if (!imageSel) warnings.push('برای «تصویر» سلکتور مطمئن پیدا نشد؛ دستی تنظیم کنید.');

  const cont = synthContainer(doc, sample, cardAnchors, isProd);
  const containerSel = cont ? cont.sel : '';
  if (!containerSel) {
    warnings.push('برای «ظرف محصول» سلکتور یکتا پیدا نشد؛ دستی تنظیم کنید.');
  } else if (cont.extra > 0) {
    warnings.push('ظرف محصول ' + cont.extra + ' گرهٔ اضافه هم پوشش می‌دهد (تأییدشده ' + sample.length + ' از ' + (sample.length + cont.extra) + ')؛ اگر محصول نامرتبط آمد، سلکتور را دستی تنگ کنید.');
  }

  // On-page verification with the suggested selectors.
  const PLACEHOLDER = /\.(svg)(\?|#|$)|\b(placeholder|blank|loading|lazy|fallback|no-image|empty)\b/i;
  let placeholders = 0;
  const rows = [];
  for (const card of sample) {
    const t = titleSel && !titleFromAlt ? elText(all(card, titleSel)[0] || { textContent: '' }) : '';
    const pv = priceSel ? priceVal(elText(all(card, priceSel)[0] || { textContent: '' })) : -1;
    const link = tag(card) === 'a' ? attr(card, 'href')
      : (linkSel ? attr(all(card, linkSel)[0] || { getAttribute: () => '' }, 'href') : '');
    const img = imageSel ? imgUrl(all(card, imageSel)[0] || { getAttribute: () => '' }) : '';
    if (img && PLACEHOLDER.test(img)) placeholders++;
    rows.push({ title: t, price: pv, url: link, image: img });
  }
  const okRows = rows.filter(r => r.title && r.price > 0 && r.url).length;
  if (placeholders > 0) {
    warnings.push(placeholders + ' کارت از ' + sample.length + ' تصویر جای‌نگهدار (svg/placeholder) دارند؛ برای عکس واقعی اسکرول کنید.');
  }

  const url = pageUrl(doc, opts);
  const id = hostSlug(url) + '-auto';
  const selectors = { container: containerSel, title: titleFromAlt ? '' : titleSel, price: priceSel, link: linkSel, image: imageSel };
  const profile = { profiles: {} };
  profile.profiles[id] = {
    id, name: hostSlug(url) + ' (تزریق خودکار)', url, enabled: true, pages: 3,
    pagination: 'query_page', extractionEngine: 'cheerio', paginationValue: 'page',
    selectors, syncWoo: false, syncBasalam: false, intervalMinutes: 0
  };
  const samples = rows.slice(0, 3);

  try {
    for (const card of sample) {
      if (card.style) { card.style.outline = '2px solid #22c55e'; card.style.outlineOffset = '2px'; }
    }
  } catch (e) { /* highlight is cosmetic */ }

  log('[S4] ' + cards.length + ' کارت محصول پیدا شد؛ ' + okRows + ' ردیف کامل (عنوان+قیمت+لینک).');
  log('[S4] ظرف محصول: ' + (containerSel || '—'));
  log('[S4] عنوان: ' + (selectors.title || '—'));
  log('[S4] قیمت: ' + (priceSel || '—'));
  log('[S4] لینک: ' + (linkSel || '—'));
  log('[S4] تصویر: ' + (imageSel || '—'));
  for (const w of warnings) log('[S4] ⚠️ ' + w);
  log('[S4] نمونه ردیف‌ها:', samples);
  log('[S4] پروفایل آماده است — JSON زیر را در فایل profiles.json ذخیره و از بخش پروفایل‌ها درون‌ریزی کنید:');
  log(JSON.stringify(profile, null, 2));

  return { ok: true, version: VERSION, cards: cards.length, verified: sample.length, okRows, selectors, profile, samples, warnings };
}

return {
  VERSION, run, discover: run,
  _t: { fold, clean, priceVal, maxDigits, stableToken, stableTokens, lcpPath, isProductHref, priceCandidates }
};
})();

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__S4I_NO_AUTORUN) {
  try { window.__S4I_LAST = S4I.run(document); }
  catch (error) { console.warn('[S4] خطای تزریق‌کننده: ' + (error && error.message)); }
}
