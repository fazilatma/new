import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './storefront.css';

const PAGE_SIZE = 24;
const CART_KEY = 'amphp_sf_cart_v1';
const WISH_KEY = 'amphp_sf_wish_v1';
const PENDING_ORDER_KEY = 'amphp_sf_pending_order_v1';
const COLS_KEY = 'scraped_shop_cols';

const faDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const toFa = (v) => String(v ?? '').replace(/\d/g, (d) => faDigits[d]);
const formatMoney = (n, currency = 'تومان') => {
  const num = Number(n) || 0;
  return `${toFa(num.toLocaleString('en-US'))} ${currency}`;
};

/** v13.3.4: جزئیات نمایشی پایدار از id (بدون seed دموی آمار فروشگاه) */
function productVisualMeta(p) {
  const id = String(p?.id ?? p?.title ?? 'x');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const u = Math.abs(h);
  const rating = 3.6 + ((u % 14) / 10); // 3.6–4.9
  const reviews = 12 + (u % 480);
  const sold = 8 + (u % 920);
  const stars = Math.round(rating * 2) / 2;
  return { rating: Math.min(4.9, Math.round(rating * 10) / 10), reviews, sold, stars };
}

function StarRow({ rating, size = 'sm' }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.4;
  const items = [];
  for (let i = 1; i <= 5; i++) {
    let c = 'empty';
    if (i <= full) c = 'full';
    else if (i === full + 1 && half) c = 'half';
    items.push(<i key={i} className={`sf-star ${c}`} aria-hidden />);
  }
  return <span className={`sf-stars sf-stars-${size}`} title={`${toFa(rating)} از ۵`}>{items}</span>;
}

// Keep the stored category intact; remove the supplier name only in the storefront.
function displayCategory(value) {
  const name = String(value || '').replace(/مانتو[\s\u200c]*پاتریس(?![\u0621-\u064a\u0671-\u06d3])/g, '');
  return name
    .replace(/\s*([|/،,>»«:–—-])\s*(?:[|/،,>»«:–—-]\s*)+/g, ' $1 ')
    .replace(/^[\s|/،,>»«:–—-]+|[\s|/،,>»«:–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'عمومی';
}

function MobileNavIcon({ name }) {
  const paths = {
    home: <><path d="m3.5 10 8.5-7 8.5 7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" /><path d="M9.5 20.5v-6h5v6" /></>,
    menu: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.8" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.8" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.8" /><rect x="14" y="14" width="6.5" height="6.5" rx="1.8" /></>,
    cart: <><path d="M3.5 4.5h2l1.8 9.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H6.2" /><circle cx="9.5" cy="19" r="1" /><circle cx="18" cy="19" r="1" /></>,
    account: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  };
  return <svg className="sf-mob-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

const CAT_ICONS = {
  'عمومی': '📦', 'گجت': '📱', 'صوتی': '🎧', 'مد': '👕', 'خانگی': '🏠',
  'دیجیتال': '💻', 'زیبایی': '💄', 'ورزشی': '⚽', 'کتاب': '📚', 'خودرو': '🚗',
  'سوپرمارکت': '🛒', 'ابزار': '🔧', 'کودک': '🧸', 'سلامت': '💊',
};
function catIcon(name) {
  if (!name) return '📂';
  if (CAT_ICONS[name]) return CAT_ICONS[name];
  const keys = Object.keys(CAT_ICONS);
  for (const k of keys) if (String(name).includes(k)) return CAT_ICONS[k];
  const h = String(name).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return ['✨', '🏷️', '🎁', '⭐', '🔥', '💎'][h % 6];
}

function installmentHint(price, currency) {
  const n = Number(price) || 0;
  if (n < 400000) return null;
  const per = Math.ceil(n / 4);
  return `۴ قسط ${formatMoney(per, currency)}`;
}

/** Lightweight markdown → safe React nodes (bold/italic/code/links/lists/breaks). */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function inlineMd(raw) {
  let s = escapeHtml(raw);
  // code `x`
  s = s.replace(/`([^`]+)`/g, '<code class="sf-md-code">$1</code>');
  // bold **x** or __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // italic *x* or _x_
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  // links [t](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="sf-md-link">$1</a>');
  // bare urls
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="sf-md-link">$2</a>');
  return s;
}
function decodeHtmlEntities(str) {
  let s = String(str ?? '');
  if (!s) return '';
  /* چند دور برای &amp;lt;p&amp;gt; و &#13; */
  for (let i = 0; i < 4; i++) {
    const prev = s;
    s = s
      .replace(/&#13;|&#x0d;|&#xd;/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    if (typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.innerHTML = s;
        s = ta.value;
      } catch (_) { /* ignore */ }
    }
    if (s === prev) break;
  }
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** اگر محتوا HTML واقعی است (از AI) مستقیم و امن برگردان */
function sanitizeAiHtml(html) {
  let s = decodeHtmlEntities(html).trim();
  if (!s) return '';
  s = s.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
  /* فقط تگ‌های محتوا */
  s = s.replace(/<(?!\/?(?:p|br|br\/|ul|ol|li|strong|b|em|i|u|h[3-5]|div|span)\b)[^>]*>/gi, '');
  s = s.replace(/\s(on\w+|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return s.trim();
}

function looksLikeHtml(s) {
  const t = String(s || '').trim();
  return /<\s*\/?\s*(p|div|ul|ol|li|h[1-6]|br|strong|b|em)\b/i.test(t)
    || /&lt;\s*\/?\s*(p|div|ul|ol|li)\b/i.test(t);
}

function renderMarkdown(src) {
  let raw = decodeHtmlEntities(String(src ?? '')).trim();
  if (!raw) return null;
  /* v13.3.2: توضیح AI که HTML است — markdown نکن (وگرنه &lt;p&gt; دیده می‌شود) */
  if (looksLikeHtml(String(src ?? '')) || looksLikeHtml(raw)) {
    const safe = sanitizeAiHtml(String(src ?? ''));
    return safe || null;
  }
  const lines = raw.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(escapeHtml(lines[i])); i++; }
      i++; // skip closing
      blocks.push(`<pre class="sf-md-pre"><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (i < lines.length && (/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(ordered ? `<ol class="sf-md-list">${items.join('')}</ol>` : `<ul class="sf-md-list">${items.join('')}</ul>`);
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      const level = (line.match(/^#+/) || ['#'])[0].length;
      const t = inlineMd(line.replace(/^#{1,3}\s+/, ''));
      blocks.push(`<div class="sf-md-h sf-md-h${Math.min(level, 3)}">${t}</div>`);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(inlineMd(lines[i].replace(/^\s*>\s?/, '')));
        i++;
      }
      blocks.push(`<blockquote class="sf-md-quote">${q.join('<br/>')}</blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^\s*[-*•]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^#{1,3}\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
      para.push(inlineMd(lines[i]));
      i++;
    }
    blocks.push(`<p class="sf-md-p">${para.join('<br/>')}</p>`);
  }
  return blocks.join('');
}

function MdBubble({ text, role }) {
  if (role === 'user') {
    return <div className="sf-bubble user">{text}</div>;
  }
  const html = renderMarkdown(text);
  return (
    <div
      className="sf-bubble bot sf-bubble-md"
      dangerouslySetInnerHTML={{ __html: html || escapeHtml(text) }}
    />
  );
}

/** Normalize Persian/Arabic digits & letters for search */
function normalizeSearch(s) {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  let out = String(s ?? '').toLowerCase();
  let buf = '';
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    const fi = fa.indexOf(ch);
    if (fi >= 0) { buf += String(fi); continue; }
    const ai = ar.indexOf(ch);
    if (ai >= 0) { buf += String(ai); continue; }
    if (ch === 'ي') { buf += 'ی'; continue; }
    if (ch === 'ك') { buf += 'ک'; continue; }
    if (/[a-z0-9\u0600-\u06FF\s]/i.test(ch)) buf += ch;
    else buf += ' ';
  }
  return buf.replace(/\s+/g, ' ').trim();
}
function productMatchesQuery(p, qNorm) {
  if (!qNorm) return true;
  const hay = normalizeSearch(`${p.title || ''} ${p.category || ''} ${p.description || ''} ${p.price_formatted || ''}`);
  const tokens = qNorm.split(' ').filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const safeJson = (raw, fb) => {
  try { return JSON.parse(raw); } catch { return fb; }
};
const loadLS = (k, fb) => {
  try { return safeJson(localStorage.getItem(k), fb) ?? fb; } catch { return fb; }
};
const saveLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

/** Woo/gateway return: order-received URL or ?amphp_paid=1 */
function detectOrderReturn() {
  try {
    const u = new URL(window.location.href);
    const q = u.searchParams;
    const path = (u.pathname || '').toLowerCase();
    const orderId = q.get('order_id') || q.get('order') || q.get('amphp_order') || '';
    const orderKey = q.get('key') || q.get('order_key') || q.get('amphp_key') || '';
    const paidFlag = q.get('amphp_paid') === '1' || q.get('payment') === 'success' || q.get('status') === 'paid';
    const onReceived = /order-received|order_received|thank/.test(path) || q.has('order-received');
    const pathOid = (path.match(/order-received\/(\d+)/) || [])[1] || '';
    if (paidFlag || onReceived || (orderId && orderKey) || pathOid) {
      return { order_id: orderId || pathOid, order_key: orderKey, paid: true };
    }
  } catch {}
  return null;
}

function clearOrderReturnParams() {
  try {
    const u = new URL(window.location.href);
    let dirty = false;
    ['amphp_paid', 'amphp_order', 'amphp_key', 'order_id', 'order', 'key', 'order_key', 'payment', 'status'].forEach((k) => {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
    });
    if (dirty) {
      const next = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + (u.hash || '');
      window.history.replaceState({}, '', next);
    }
  } catch {}
}

const FONT_KEY = (typeof window !== 'undefined' && window.APP_FONT_KEY) ? window.APP_FONT_KEY : 'scraper_font';
const FONT_FALLBACK = 'Tahoma,system-ui,-apple-system,sans-serif';

/** Font registry aligned with scraper4.php app_fonts_registry() */
const SF_FONTS = {
  system: { stack: FONT_FALLBACK, css: '', face: '' },
  vazirmatn: {
    stack: 'Vazirmatn,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css',
    face: '',
  },
  vazir: {
    stack: 'Vazir,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@30.1.0/dist/font-face.css',
    face: '',
  },
  sahel: {
    stack: 'Sahel,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@3.4.0/dist/font-face.css',
    face: '',
  },
  samim: {
    stack: 'Samim,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@4.0.5/dist/font-face.css',
    face: '',
  },
  shabnam: {
    stack: 'Shabnam,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/shabnam-font@5.0.1/dist/font-face.css',
    face: '',
  },
  parastoo: {
    stack: 'Parastoo,' + FONT_FALLBACK,
    css: 'https://cdn.jsdelivr.net/gh/rastikerdar/parastoo-font@2.0.0/dist/font-face.css',
    face: '',
  },
  estedad: {
    stack: 'Estedad,' + FONT_FALLBACK,
    css: '',
    face:
      "@font-face{font-family:'Estedad';src:url('https://cdn.jsdelivr.net/gh/aminabedi68/Estedad@8.5/fonts/Statics/webfonts/Estedad-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}" +
      "@font-face{font-family:'Estedad';src:url('https://cdn.jsdelivr.net/gh/aminabedi68/Estedad@8.5/fonts/Statics/webfonts/Estedad-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap}" +
      "@font-face{font-family:'Estedad';src:url('https://cdn.jsdelivr.net/gh/aminabedi68/Estedad@8.5/fonts/Statics/webfonts/Estedad-SemiBold.woff2') format('woff2');font-weight:600;font-style:normal;font-display:swap}" +
      "@font-face{font-family:'Estedad';src:url('https://cdn.jsdelivr.net/gh/aminabedi68/Estedad@8.5/fonts/Statics/webfonts/Estedad-Bold.woff2') format('woff2');font-weight:700;font-style:normal;font-display:swap}",
  },
  iranyekan: {
    stack: 'IRANYekan,' + FONT_FALLBACK,
    css: '',
    face:
      "@font-face{font-family:'IRANYekan';src:url('https://cdn.jsdelivr.net/gh/morajabi/balast-website@master/static/fonts/iranyekan/woff2/iranyekanweblight.woff2') format('woff2');font-weight:300;font-style:normal;font-display:swap}" +
      "@font-face{font-family:'IRANYekan';src:url('https://cdn.jsdelivr.net/gh/morajabi/balast-website@master/static/fonts/iranyekan/woff2/iranyekanwebregular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}" +
      "@font-face{font-family:'IRANYekan';src:url('https://cdn.jsdelivr.net/gh/morajabi/balast-website@master/static/fonts/iranyekan/woff2/iranyekanwebbold.woff2') format('woff2');font-weight:700;font-style:normal;font-display:swap}",
  },
  yekan: {
    stack: 'Yekan,' + FONT_FALLBACK,
    css: '',
    face: "@font-face{font-family:'Yekan';src:url('https://cdn.jsdelivr.net/gh/hemedani/yekan@3.0.0/Yekan.woff') format('woff');font-weight:normal;font-style:normal;font-display:swap}",
  },
};
// agent.php admin aliases → scraper4 keys
SF_FONTS.dana = SF_FONTS.vazirmatn;
SF_FONTS.yekanbakh = SF_FONTS.yekan;
SF_FONTS.iransans = SF_FONTS.iranyekan;
SF_FONTS.morabba = SF_FONTS.sahel;
SF_FONTS.custom = SF_FONTS.vazirmatn;

/** v13.3.3: فونت سرور (preferred / APP_FONT_SERVER) اولویت دارد — برای همهٔ دستگاه‌ها یکسان */
function resolveFontKey(preferred) {
  const pref = String(preferred || '').trim();
  const known = (k) => !!(k && ((typeof window !== 'undefined' && window.APP_FONTS?.[k]) || SF_FONTS[k]));
  if (pref && known(pref)) return pref;
  try {
    if (typeof window !== 'undefined') {
      const srv = window.APP_FONT_SERVER;
      if (known(srv)) return srv;
      if (typeof window.appFontCurrent === 'function') {
        const k = window.appFontCurrent();
        if (known(k)) return k;
      }
      // localStorage فقط وقتی سرور فونت نداده
      const ls = localStorage.getItem(FONT_KEY);
      if (known(ls)) return ls;
    }
  } catch (_) {}
  return 'vazirmatn';
}

function applyStorefrontFont(key) {
  const k = resolveFontKey(key);
  if (typeof window !== 'undefined' && typeof window.appFontApply === 'function' && window.APP_FONTS) {
    try {
      /* save=false — فقط اعمال؛ منبع حقیقت سرور است نه LS */
      window.appFontApply(k, false);
      return k;
    } catch (_) {}
  }
  const pack = (typeof window !== 'undefined' && window.APP_FONTS && window.APP_FONTS[k])
    ? window.APP_FONTS[k]
    : (SF_FONTS[k] || SF_FONTS.system);
  const stack = pack.stack || FONT_FALLBACK;
  try {
    document.documentElement.style.setProperty('--app-font', stack);
    if (document.body) document.body.style.fontFamily = stack;
  } catch (_) {}
  if (pack.css) {
    const lid = 'sfFontLink_' + k;
    if (!document.getElementById(lid)) {
      const l = document.createElement('link');
      l.id = lid; l.rel = 'stylesheet'; l.href = pack.css;
      (document.head || document.documentElement).appendChild(l);
    }
  }
  if (pack.face) {
    const sid = 'sfFontFace_' + k;
    if (!document.getElementById(sid)) {
      const s = document.createElement('style');
      s.id = sid; s.appendChild(document.createTextNode(pack.face));
      (document.head || document.documentElement).appendChild(s);
    }
  }
  return k;
}

const PALETTE_ACCENTS = {
  'digikala-red': '#ef394e',
  'snapp-green': '#00d170',
  'basalam-coral': '#ff6b35',
  'torob-red': '#d32f2f',
  'digistyle-rose': '#e91e63',
  'technolife-blue': '#1a73e8',
  'royal-blue': '#2563eb',
  'luxury-purple': '#7c3aed',
  'amber-gold': '#d97706',
  'persian-turquoise': '#0d9488',
  'midnight-ink': '#6366f1',
  forest: '#16a34a',
  sunset: '#f97316',
  modern: '#2563eb',
  midnight: '#6366f1',
  minimal: '#0f172a',
  bazaar: '#ea580c',
  boutique: '#db2777',
};

const IRAN_PROVINCES = [
  'تهران','اصفهان','فارس','خراسان رضوی','آذربایجان شرقی','آذربایجان غربی','خوزستان','مازندران','گیلان','کرمان',
  'البرز','قم','قزوین','همدان','کرمانشاه','یزد','سیستان و بلوچستان','گلستان','لرستان','مرکزی','هرمزگان',
  'بوشهر','زنجان','اردبیل','کردستان','سمنان','چهارمحال و بختیاری','کهگیلویه و بویراحمد','ایلام','خراسان شمالی','خراسان جنوبی',
];


const IRAN_CITIES = {
  "تهران": ["تهران","شهریار","اسلامشهر","ری","قدس","ملارد","پاکدشت","ورامین","پردیس","دماوند","فیروزکوه","رباط‌کریم","بهارستان","قرچک","پیشوا","بومهن","اندیشه","نسیم‌شهر","گلستان","صالح‌آباد"],
  "البرز": ["کرج","فردیس","نظرآباد","هشتگرد","ساوجبلاغ","طالقان","اشتهارد","ماهدشت","مشکین‌دشت","گوهردشت","مهرشهر"],
  "اصفهان": ["اصفهان","کاشان","خمینی‌شهر","نجف‌آباد","شاهین‌شهر","فلاورجان","زرین‌شهر","مبارکه","نطنز","اردستان","گلپایگان","خوانسار","نایین","فریدن","فریدون‌شهر","سمیرم","شهرضا","دهاقان","تیران","چادگان","برخوار","دولت‌آباد"],
  "فارس": ["شیراز","مرودشت","جهرم","فسا","کازرون","لار","لامرد","داراب","آباده","اقلید","نی‌ریز","استهبان","فیروزآباد","ممسنی","سپیدان","گراش","قیر","زرین‌دشت","خنج","بوانات"],
  "خراسان رضوی": ["مشهد","نیشابور","سبزوار","تربت حیدریه","کاشمر","قوچان","تربت جام","چناران","گناباد","تایباد","خواف","درگز","سرخس","فریمان","بردسکن","کلات","رشتخوار","خلیل‌آباد","باخرز","مه ولات"],
  "آذربایجان شرقی": ["تبریز","مراغه","مرند","میانه","اهر","بناب","سراب","آذرشهر","ملکان","شبستر","هشترود","جلفا","بستان‌آباد","عجب‌شیر","کلیبر","هریس","اسکو","ایلخچی","صوفیان"],
  "آذربایجان غربی": ["ارومیه","خوی","مهاباد","بوکان","میاندوآب","سلماس","پیرانشهر","نقده","ماکو","سردشت","شاهین‌دژ","تکاب","اشنویه","چالدران","پلدشت","شوط"],
  "خوزستان": ["اهواز","آبادان","خرمشهر","دزفول","اندیمشک","ماهشهر","بهبهان","شوشتر","ایذه","شوش","رامهرمز","مسجدسلیمان","بندر امام","شادگان","هندیجان","امیدیه","گتوند","لالی","باغ‌ملک","هفتکل"],
  "مازندران": ["ساری","بابل","آمل","قائم‌شهر","بهشهر","چالوس","تنکابن","بابلسر","نوشهر","رامسر","نکا","جویبار","محمودآباد","فریدونکنار","گلوگاه","سوادکوه","نور","عباس‌آباد","کلاردشت","میاندورود"],
  "گیلان": ["رشت","بندرانزلی","لاهیجان","لنگرود","تالش","رودسر","فومن","صومعه‌سرا","آستارا","آستانه اشرفیه","رودبار","ماسال","سیاهکل","شفت","رضوانشهر","املش","خمام","کیاشهر"],
  "کرمان": ["کرمان","رفسنجان","سیرجان","جیرفت","بم","زرند","کهنوج","شهربابک","بافت","بردسیر","راور","عنبرآباد","منوجان","قلعه‌گنج","فهرج","رابر","انار","کوهبنان"],
  "قم": ["قم","جعفریه","کهک","سلفچگان","قنوات"],
  "قزوین": ["قزوین","تاکستان","آبیک","بوئین‌زهرا","الوند","محمدیه","محمودآباد نمونه","اقبالیه","آوج","ضیاآباد"],
  "همدان": ["همدان","ملایر","نهاوند","تویسرکان","اسدآباد","کبودرآهنگ","بهار","رزن","فامنین","قروه درجزین"],
  "کرمانشاه": ["کرمانشاه","اسلام‌آباد غرب","جوانرود","کنگاور","سرپل ذهاب","سنقر","هرسین","صحنه","پاوه","گیلانغرب","قصرشیرین","ثلاث باباجانی","روانسر","دالاهو"],
  "یزد": ["یزد","میبد","اردکان","بافق","مهریز","ابرکوه","تفت","اشکذر","خاتم","بهاباد","هرات"],
  "سیستان و بلوچستان": ["زاهدان","چابهار","ایرانشهر","زابل","سراوان","خاش","نیک‌شهر","کنارک","سرباز","میرجاوه","زهک","دلگان","قصرقند","فنوج","راسک","سیب و سوران"],
  "گلستان": ["گرگان","گنبد کاووس","بندر ترکمن","علی‌آباد کتول","آق‌قلا","کردکوی","مینودشت","آزادشهر","کلاله","رامیان","گمیشان","گالیکش","مراوه‌تپه","بندر گز"],
  "لرستان": ["خرم‌آباد","بروجرد","دورود","الیگودرز","کوهدشت","ازنا","نورآباد","الشتر","پلدختر","رومشکان","چگنی"],
  "مرکزی": ["اراک","ساوه","خمین","محلات","دلیجان","شازند","تفرش","آشتیان","کمیجان","فراهان","زرندیه"],
  "هرمزگان": ["بندرعباس","میناب","قشم","کیش","بندر لنگه","حاجی‌آباد","رودان","جاسک","پارسیان","بستک","سیریک","ابوموسی","خمیر"],
  "بوشهر": ["بوشهر","برازجان","گناوه","کنگان","عسلویه","خورموج","دیر","دیلم","جم","تنگستان","دشتی"],
  "زنجان": ["زنجان","ابهر","خرمدره","قیدار","آب‌بر","سلطانیه","ماهنشان","ایجرود"],
  "اردبیل": ["اردبیل","پارس‌آباد","مشگین‌شهر","خلخال","گرمی","نمین","نیر","بیله‌سوار","کوثر","سرعین","اصلاندوز"],
  "کردستان": ["سنندج","سقز","بانه","مریوان","قروه","بیجار","کامیاران","دیواندره","دهگلان","سروآباد"],
  "سمنان": ["سمنان","شاهرود","دامغان","گرمسار","مهدی‌شهر","آرادان","میامی","سرخه","ایوانکی"],
  "چهارمحال و بختیاری": ["شهرکرد","بروجن","فارسان","لردگان","سامان","کیان","گندمان","اردل","کوهرنگ","بن","ناغان"],
  "کهگیلویه و بویراحمد": ["یاسوج","دوگنبدان","دهدشت","لیکک","سی‌سخت","چرام","باشت","لنده","مارگون"],
  "ایلام": ["ایلام","ایوان","دهلران","آبدانان","مهران","دره‌شهر","سرابله","بدره","چرداول","ملکشاهی"],
  "خراسان شمالی": ["بجنورد","اسفراین","شیروان","جاجرم","فاروج","گرمه","راز و جرگلان","مانه و سملقان"],
  "خراسان جنوبی": ["بیرجند","قائن","فردوس","طبس","نهبندان","سربیشه","بشرویه","درمیان","سرایان","خوسف","زیرکوه"],
};

function useAdminBarOffset() {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      const bar = document.getElementById('wpadminbar');
      if (!bar) { setTop(0); return; }
      const cs = getComputedStyle(bar);
      if (cs.display === 'none' || cs.visibility === 'hidden') { setTop(0); return; }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') { setTop(0); return; }
      setTop(bar.offsetHeight || (window.innerWidth <= 782 ? 46 : 32));
    };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--sf-adminbar', `${top}px`);
  }, [top]);
  return top;
}

function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.pageYOffset || document.documentElement.scrollTop || 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        setProgress(clamp((y / max) * 100, 0, 100));
        setScrolled(y > 48);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return { progress, scrolled };
}

function useCountdown(hours = 8) {
  const endRef = useRef(Date.now() + hours * 3600 * 1000);
  const [left, setLeft] = useState(endRef.current - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, endRef.current - Date.now())), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.floor(left / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return { h, m, s };
}

function ToastHost({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="sf-toast-wrap" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`sf-toast ${t.type || ''}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}


/** True when URL looks like empty / WC / SnappShop generic placeholder */
function isBadProductImageUrl(url) {
  const u = String(url || '').toLowerCase().trim();
  if (!u) return true;
  if (u.startsWith('data:image')) return true;
  const bad = [
    'placeholder', 'no-image', 'no_image', 'noimage', 'default-image', 'default_image',
    'woocommerce-placeholder', 'wc-placeholder', 'blank.gif', 'blank.png', '1x1.',
    'spacer', 'transparent', 'loading.gif', 'snappshop', 'snapp.ir/static', 'cdn.snapp',
    'default_product', 'product_placeholder', 'product-default', 'img-placeholder',
    'empty-product', 'without-image', 'dummy-image', 'dummy_image',
  ];
  return bad.some((b) => u.includes(b));
}

/**
 * Inline pinch-zoom on PDP main image (two-finger spread/pinch) + open lightbox on tap.
 */
function PdpMainImage({ src, alt, onOpenZoom }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const pinch = useRef(null);
  const moved = useRef(false);
  const scaleRef = useRef(1);

  useEffect(() => { setScale(1); setTx(0); setTy(0); scaleRef.current = 1; }, [src]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      moved.current = true;
      pinch.current = { d: dist(e.touches[0], e.touches[1]), s: scaleRef.current };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault();
      moved.current = true;
      const ratio = dist(e.touches[0], e.touches[1]) / pinch.current.d;
      const n = Math.min(4, Math.max(1, pinch.current.s * ratio));
      setScale(n);
      if (n <= 1) { setTx(0); setTy(0); }
    }
  };
  const onTouchEnd = () => {
    pinch.current = null;
    if (scaleRef.current <= 1.05) {
      setScale(1); setTx(0); setTy(0);
    }
  };
  const onClick = () => {
    if (moved.current) { moved.current = false; return; }
    onOpenZoom?.();
  };

  if (!src) return <div className="sf-pdp-ph">📦</div>;
  return (
    <div
      className="sf-pdp-main-pinch"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenZoom?.(); } }}
      title="پینچ برای زوم · کلیک برای تمام‌صفحه"
    >
      <img
        src={src}
        alt={alt || ''}
        draggable={false}
        style={{ transform: `translate3d(${tx}px,${ty}px,0) scale(${scale})` }}
      />
    </div>
  );
}


function ProductThumbImage({ p, ajax, onImageFix, aiImages = true }) {
  const initial = isBadProductImageUrl(p.image) ? '' : (p.image || '');
  const [src, setSrc] = useState(initial);
  const [trying, setTrying] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    setSrc(isBadProductImageUrl(p.image) ? '' : (p.image || ''));
    tried.current = false;
  }, [p.id, p.image]);

  useEffect(() => {
    if (src || tried.current || !ajax?.ajaxUrl || aiImages === false) return;
    let cancelled = false;
    tried.current = true;
    (async () => {
      setTrying(true);
      try {
        const fd = new FormData();
        fd.append('action', 'scraper_ai_enrich_one_image');
        fd.append('nonce', ajax.cartNonce || '');
        fd.append('id', p.id || '');
        fd.append('title', p.title || '');
        fd.append('category', p.category || '');
        fd.append('image', p.image || '');
        const res = await fetch(ajax.ajaxUrl, { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const url = data?.data?.image || data?.data?.remote || '';
        if (!cancelled && data?.success && url && !isBadProductImageUrl(url)) {
          setSrc(url);
          onImageFix?.(p.id, url);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setTrying(false); }
    })();
    return () => { cancelled = true; };
  }, [src, p.id]);

  if (src) {
    return (
      <img
        src={src}
        alt={p.title}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          e.currentTarget.parentElement.querySelector('.sf-thumb-empty')?.classList.add('show');
          setSrc('');
        }}
      />
    );
  }
  return (
    <div className={`sf-thumb-empty show${trying ? ' sf-thumb-ai' : ''}`} style={{ display: 'grid' }}>
      {trying ? '🔍' : '📦'}
      {trying ? <small className="sf-thumb-ai-lbl">جستجوی تصویر…</small> : null}
    </div>
  );
}

function ProductCard({ p, cols, currency, wish, onWish, onOpen, onAdd, onAsk, showSpecial, ajax, onImageFix, aiImages = true }) {
  const inStock = p.in_stock !== false;
  const meta = productVisualMeta(p);
  const price = Number(p.price) || 0;
  const inst = installmentHint(price, currency);
  const shortHint = String(p.short_desc || p.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);

  return (
    <article className="sf-card sf-card-rich" data-id={p.id}>
      <div className="sf-thumb sf-thumb-click" role="link" tabIndex={0}
        onClick={() => onOpen(p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p); } }}
      >
        <button type="button" className={`sf-wish ${wish ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onWish(p.id); }} aria-label="علاقه‌مندی">
          {wish ? '♥' : '♡'}
        </button>
        <div className="sf-thumb-badges">
          {p.has_discount && p.discount_pct ? (
            <span className="sf-disc">{toFa(p.discount_pct)}٪</span>
          ) : showSpecial ? (
            <span className="sf-badge-special">ویژه</span>
          ) : null}
        </div>
        <span className={`sf-stock ${inStock ? '' : 'out'}`}>{inStock ? 'موجود' : 'ناموجود'}</span>
        <ProductThumbImage p={p} ajax={ajax} onImageFix={onImageFix} aiImages={aiImages} />
        <div className="sf-thumb-hover">
          <button type="button" className="sf-btn primary sm" onClick={(e) => { e.stopPropagation(); onAdd(p); }}>＋ سبد</button>
          <button type="button" className="sf-btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(p); }}>جزئیات</button>
        </div>
      </div>
      <div className="sf-card-body">
        <div className="sf-card-topmeta">
          <span className="sf-card-cat">{catIcon(p.category)} {p.category || 'عمومی'}</span>
          <span className="sf-card-sold">{toFa(meta.sold)}+ فروش</span>
        </div>
        <h3 className="sf-card-title sf-card-title-link" title={p.title} onClick={() => onOpen(p)}>{p.title}</h3>
        {shortHint ? <p className="sf-card-hint">{shortHint}{shortHint.length >= 72 ? '…' : ''}</p> : null}
        <div className="sf-card-rating">
          <StarRow rating={meta.stars} />
          <span className="sf-rating-num">{toFa(meta.rating)}</span>
          <span className="sf-rating-cnt">({toFa(meta.reviews)})</span>
        </div>
        <div className="sf-price-row">
          <div className="sf-price-block">
            {p.has_discount && (p.old_price_formatted || p.old_price) ? (
              <div className="sf-old">{p.old_price_formatted || formatMoney(p.old_price, currency)}</div>
            ) : null}
            <div className="sf-price">{p.price_formatted || formatMoney(p.price, currency)}</div>
            {inst ? <div className="sf-install">{inst}</div> : null}
          </div>
          <button type="button" className="sf-add-fab" disabled={!inStock} onClick={() => onAdd(p)} title="افزودن به سبد" aria-label="افزودن به سبد">＋</button>
        </div>
        <div className="sf-card-chips">
          <span>🚚 سریع</span>
          <span>✅ اصل</span>
          {inStock ? <span>📦 آماده</span> : <span className="out">ناموجود</span>}
          <button type="button" className="sf-chip-ask" onClick={() => onAsk(p)} title="سوال در پشتیبانی">💬</button>
        </div>
      </div>
    </article>
  );
}

function CartDrawer({ open, onClose, items, currency, onQty, onRemove, onCheckout, busy, freeShip }) {
  if (!open) return null;
  const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (it.qty || 1), 0);
  const thr = Number(freeShip) || 0;
  const remain = thr > 0 ? Math.max(0, thr - total) : 0;
  const progress = thr > 0 ? Math.min(100, Math.round((total / thr) * 100)) : 0;
  return (
    <>
      <div className="sf-overlay" onClick={onClose} />
      <aside className="sf-drawer right" role="dialog" aria-label="سبد خرید">
        <div className="sf-drawer-head">
          <h3>🛒 سبد خرید ({toFa(items.length)})</h3>
          <button type="button" className="sf-close" onClick={onClose}>✕</button>
        </div>
        <div className="sf-drawer-body">
          {thr > 0 && items.length ? (
            <div className="sf-ship-bar">
              {remain > 0
                ? <span>فقط {formatMoney(remain, currency)} تا ارسال رایگان 🚚</span>
                : <span className="ok">ارسال این سفارش رایگان است ✓</span>}
              <div className="sf-ship-track"><i style={{ width: `${progress}%` }} /></div>
            </div>
          ) : null}
          {!items.length ? (
            <div className="sf-empty" style={{ border: 'none', boxShadow: 'none' }}>
              <div style={{ fontSize: '2.4rem' }}>🛍️</div>
              <h4>سبد خرید خالی است</h4>
              <p>کالای مورد علاقه‌تان را اضافه کنید.</p>
            </div>
          ) : items.map((it) => (
            <div className="sf-cart-item" key={it.id}>
              {it.image ? <img src={it.image} alt="" /> : <div style={{ width: 64, height: 64, borderRadius: 12, background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>📦</div>}
              <div>
                <h4>{it.title}</h4>
                <div className="meta">{it.price_txt || formatMoney(it.price, currency)}</div>
                <div className="sf-qty">
                  <button type="button" onClick={() => onQty(it.id, (it.qty || 1) - 1)}>−</button>
                  <strong>{toFa(it.qty || 1)}</strong>
                  <button type="button" onClick={() => onQty(it.id, (it.qty || 1) + 1)}>＋</button>
                </div>
              </div>
              <button type="button" className="sf-close" onClick={() => onRemove(it.id)} title="حذف">🗑</button>
            </div>
          ))}
        </div>
        <div className="sf-drawer-foot">
          <div className="sf-cart-total">
            <span>جمع کل</span>
            <span>{formatMoney(total, currency)}</span>
          </div>
          <button type="button" className="sf-btn primary block lg" disabled={!items.length || busy} onClick={onCheckout}>
            {busy ? 'در حال آماده‌سازی…' : 'ادامه و تسویه‌حساب'}
          </button>
        </div>
      </aside>
    </>
  );
}

function MenuDrawer({ open, onClose, settings, categories, onCat, cartCount, onOpenCart, accountUrl, adminUrl }) {
  if (!open) return null;
  return (
    <>
      <div className="sf-overlay" onClick={onClose} />
      <aside className="sf-drawer left" role="dialog" aria-label="منو">
        <div className="sf-drawer-head sf-menu-head">
          <div className="sf-menu-head-title">
            <span className="sf-burger-ico" aria-hidden>
              <i /><i /><i />
            </span>
            <h3>منوی فروشگاه</h3>
          </div>
          <button type="button" className="sf-close" onClick={onClose}>✕</button>
        </div>
        <div className="sf-drawer-body">
          <p style={{ fontWeight: 800, color: '#64748b', marginTop: 0 }}>{settings.shop_subtitle}</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" className="sf-action-btn" style={{ justifyContent: 'flex-start' }} onClick={() => { onCat('all'); onClose(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>🏠 صفحه اصلی</button>
            <button type="button" className="sf-action-btn" style={{ justifyContent: 'flex-start' }} onClick={() => { onOpenCart(); onClose(); }}>🛒 سبد خرید ({toFa(cartCount)})</button>
            <a className="sf-action-btn" style={{ justifyContent: 'flex-start' }} href={accountUrl}>👤 حساب کاربری</a>
            {adminUrl ? <a className="sf-action-btn" style={{ justifyContent: 'flex-start' }} href={adminUrl}>⚙️ مدیریت</a> : null}
            {settings.contact_phone ? <a className="sf-action-btn" style={{ justifyContent: 'flex-start' }} href={`tel:${settings.contact_phone}`}>📞 {settings.contact_phone}</a> : null}
          </div>
          <h4 style={{ margin: '18px 0 8px', fontWeight: 900 }}>دسته‌بندی‌ها</h4>
          <div style={{ display: 'grid', gap: 4 }}>
            <button type="button" className="sf-mega-item" onClick={() => { onCat('all'); onClose(); }}>همه دسته‌ها</button>
            {Object.entries(categories).map(([name, count]) => (
              <button type="button" key={name} className="sf-mega-item" onClick={() => { onCat(name); onClose(); }}>
                <span>📂 {name}</span>
                <span className="sf-mega-count">{toFa(count)}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}


/** Fullscreen image zoom — click/drag pan, wheel/pinch scale */
function ImageZoomLightbox({ src, alt, onClose, onPrev, onNext, hasNav }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef(null);
  const pinch = useRef(null);
  const wrapRef = useRef(null);
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { txRef.current = tx; }, [tx]);
  useEffect(() => { tyRef.current = ty; }, [ty]);

  useEffect(() => {
    setScale(1); setTx(0); setTy(0);
    scaleRef.current = 1; txRef.current = 0; tyRef.current = 0;
  }, [src]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') onPrev?.();
      if (e.key === 'ArrowLeft') onNext?.();
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(5, s + 0.25));
      if (e.key === '-') setScale((s) => Math.max(1, s - 0.25));
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onPrev, onNext]);

  const clampScale = (s) => Math.min(5, Math.max(1, s));

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) => {
      const n = clampScale(s + delta);
      if (n <= 1) { setTx(0); setTy(0); }
      return n;
    });
  };

  const touchDist = (t0, t1) => {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.hypot(dx, dy) || 1;
  };
  const touchMid = (t0, t1) => ({
    x: (t0.clientX + t1.clientX) / 2,
    y: (t0.clientY + t1.clientY) / 2,
  });

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = touchDist(e.touches[0], e.touches[1]);
      const m = touchMid(e.touches[0], e.touches[1]);
      pinch.current = {
        dist: d,
        scale: scaleRef.current,
        tx: txRef.current,
        ty: tyRef.current,
        midX: m.x,
        midY: m.y,
      };
      drag.current = null;
      return;
    }
    if (e.touches.length === 1 && scaleRef.current > 1) {
      const t = e.touches[0];
      drag.current = { x: t.clientX, y: t.clientY, tx: txRef.current, ty: tyRef.current };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault();
      const d = touchDist(e.touches[0], e.touches[1]);
      const ratio = d / (pinch.current.dist || 1);
      const n = clampScale(pinch.current.scale * ratio);
      setScale(n);
      // light pan follow midpoint delta
      const m = touchMid(e.touches[0], e.touches[1]);
      setTx(pinch.current.tx + (m.x - pinch.current.midX));
      setTy(pinch.current.ty + (m.y - pinch.current.midY));
      if (n <= 1) { setTx(0); setTy(0); }
      return;
    }
    if (e.touches.length === 1 && drag.current) {
      e.preventDefault();
      const t = e.touches[0];
      setTx(drag.current.tx + (t.clientX - drag.current.x));
      setTy(drag.current.ty + (t.clientY - drag.current.y));
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinch.current = null;
    if (e.touches.length === 0) drag.current = null;
    if (scaleRef.current <= 1) { setTx(0); setTy(0); }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') return; // handled by touch handlers
    if (scale <= 1) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    if (!drag.current) return;
    setTx(drag.current.tx + (e.clientX - drag.current.x));
    setTy(drag.current.ty + (e.clientY - drag.current.y));
  };
  const onPointerUp = (e) => {
    if (e.pointerType === 'touch') return;
    drag.current = null;
  };

  const zoomIn = () => setScale((s) => Math.min(5, s + 0.35));
  const zoomOut = () => setScale((s) => {
    const n = Math.max(1, s - 0.35);
    if (n <= 1) { setTx(0); setTy(0); }
    return n;
  });
  const reset = () => { setScale(1); setTx(0); setTy(0); };

  return (
    <div className="sf-zoom-overlay" role="dialog" aria-modal="true" aria-label="بزرگ‌نمایی تصویر" onClick={onClose}>
      <div className="sf-zoom-toolbar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={zoomOut} title="کوچک‌تر">−</button>
        <button type="button" onClick={reset} title="بازنشانی">{Math.round(scale * 100)}٪</button>
        <button type="button" onClick={zoomIn} title="بزرگ‌تر">＋</button>
        {hasNav ? (
          <>
            <button type="button" onClick={onPrev} title="قبلی">‹</button>
            <button type="button" onClick={onNext} title="بعدی">›</button>
          </>
        ) : null}
        <button type="button" className="sf-zoom-close" onClick={onClose} title="بستن">✕</button>
      </div>
      <div
        className="sf-zoom-stage"
        ref={wrapRef}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onDoubleClick={() => (scale > 1 ? reset() : setScale(2.2))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <img
          src={src}
          alt={alt || ''}
          draggable={false}
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>
      <div className="sf-zoom-hint">پینچ دو انگشتی · اسکرول · ＋/− · دابل‌کلیک · کشیدن · Esc</div>
    </div>
  );
}

function ProductPage({ product, currency, ajax, onClose, onAdd, onAsk, onCheckout, related = [], freeShip, onOpenRelated }) {
  const [full, setFull] = useState(product);
  const [loading, setLoading] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState('desc');

  useEffect(() => {
    setFull(product);
    setImgIdx(0);
    setQty(1);
    setAiFilling(false);
    setTab('desc');
    if (!product?.id || !ajax?.ajaxUrl) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const leanDesc = String(product.description || product.short_desc || '').trim();
      if (!leanDesc) setAiFilling(true);
      try {
        const fd = new FormData();
        fd.append('action', 'scraper_get_product');
        fd.append('id', product.id);
        const res = await fetch(ajax.ajaxUrl, { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const det = data?.data?.product || data?.product;
        if (!cancelled && data?.success && det && typeof det === 'object') {
          setFull((prev) => ({ ...prev, ...det, category: displayCategory(det.category || prev?.category) }));
          if (det.ai_filled || (det.description || det.short_desc || '').trim()) {
            setAiFilling(false);
          } else if (det.ai_pending) {
            setAiFilling(true);
          } else {
            setAiFilling(false);
          }
          /* v13.3.14: if still no real image, ask server to web-search one */
          const curImg = det.image || det.gallery?.[0] || product.image || '';
          if (isBadProductImageUrl(curImg) && ajax?.ajaxUrl) {
            try {
              const fd2 = new FormData();
              fd2.append('action', 'scraper_ai_enrich_one_image');
              fd2.append('nonce', ajax.cartNonce || '');
              fd2.append('id', product.id || det.id || '');
              fd2.append('title', det.title || product.title || '');
              fd2.append('category', det.category || product.category || '');
              const r2 = await fetch(ajax.ajaxUrl, { method: 'POST', body: fd2, credentials: 'same-origin' });
              const d2 = await r2.json().catch(() => ({}));
              const url = d2?.data?.image || d2?.data?.remote || '';
              if (!cancelled && d2?.success && url && !isBadProductImageUrl(url)) {
                setFull((prev) => ({
                  ...prev,
                  image: url,
                  gallery: [url, ...((prev.gallery || []).filter((g) => g && g !== url))],
                }));
              }
            } catch (_) { /* ignore */ }
          }
        }
      } catch (_) {
        /* keep lean payload */
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAiFilling(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [product?.id]);

  if (!product) return null;
  const p = full || product;
  const gallery = Array.isArray(p.gallery) && p.gallery.length
    ? p.gallery
    : (p.image ? [p.image] : []);
  const mainImg = gallery[imgIdx] || gallery[0] || p.image || '';
  const desc = (p.description || p.short_desc || '').trim();
  const descHtml = desc ? renderMarkdown(desc) : null;
  const inStock = p.in_stock !== false;
  const vars = (p.variations_text || '').trim();
  const showAiBadge = !!(p.ai_filled || aiFilling);
  const meta = productVisualMeta(p);
  const thr = Number(freeShip) || 0;
  const price = Number(p.price) || 0;
  const freeOk = thr > 0 && price >= thr;
  const inst = installmentHint(price, currency);
  const attrs = Array.isArray(p.attributes) ? p.attributes
    : (p.attrs && typeof p.attrs === 'object' && !Array.isArray(p.attrs)
      ? Object.entries(p.attrs).map(([k, v]) => ({ name: k, value: v }))
      : []);
  const specsFromVars = vars
    ? vars.split(/[|،,\\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 12).map((line, idx) => {
        const parts = line.split(/[:：]/);
        if (parts.length >= 2) return { name: parts[0].trim(), value: parts.slice(1).join(':').trim() };
        return { name: `ویژگی ${toFa(idx + 1)}`, value: line };
      })
    : [];
  const specs = attrs.length
    ? attrs.map((a) => ({ name: a.name || a.label || a.key || 'ویژگی', value: a.value || a.val || String(a) }))
    : specsFromVars;

  const addN = () => {
    for (let i = 0; i < qty; i++) onAdd(p);
  };

  const rel = (related || []).filter((x) => String(x.id) !== String(p.id)).slice(0, 8);

  return (
    <div className="sf-pdp sf-pdp-rich" role="dialog" aria-modal="true" aria-label="صفحه محصول">
      <div className="sf-pdp-bar">
        <button type="button" className="sf-checkout-back" onClick={onClose}>→ بازگشت به فروشگاه</button>
        <div className="sf-pdp-bar-title">{p.title}</div>
        <div className="sf-pdp-bar-actions">
          <button type="button" className="sf-btn ask" onClick={() => onAsk(p)}>💬 سوال</button>
          <button type="button" className="sf-btn ghost" onClick={() => { try { navigator.clipboard?.writeText(window.location.href); } catch (_) {} }}>↗ اشتراک</button>
        </div>
      </div>
      <div className="sf-pdp-body sf-container">
        <nav className="sf-pdp-crumb" aria-label="مسیر">
          <button type="button" onClick={onClose}>فروشگاه</button>
          <span>/</span>
          <button type="button" onClick={onClose}>{p.category || 'عمومی'}</button>
          <span>/</span>
          <em>{p.title}</em>
        </nav>

        <div className="sf-pdp-grid">
          <div className="sf-pdp-gallery">
            <div className="sf-pdp-main sf-pdp-main-zoomable">
              {p.has_discount && p.discount_pct ? (
                <span className="sf-pdp-disc-float">{toFa(p.discount_pct)}٪ تخفیف</span>
              ) : null}
              {mainImg
                ? <PdpMainImage src={mainImg} alt={p.title} onOpenZoom={() => setZoomOpen(true)} />
                : <div className="sf-pdp-ph">📦</div>}
              {mainImg ? <span className="sf-pdp-zoom-hint">🔍 پینچ یا کلیک برای زوم</span> : null}
              {loading ? <span className="sf-pdp-loading">بارگذاری جزئیات…</span> : null}
            </div>
            {gallery.length > 1 ? (
              <div className="sf-pdp-thumbs">
                {gallery.map((g, i) => (
                  <button key={g + i} type="button" className={i === imgIdx ? 'on' : ''} onClick={() => setImgIdx(i)}>
                    <img src={g} alt="" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="sf-pdp-gallery-note">
              <span>🔍 پینچ دو انگشتی · کلیک تمام‌صفحه · اسکرول زوم</span>
              <span>{toFa(gallery.length || 1)} تصویر</span>
            </div>
          </div>

          <div className="sf-pdp-info">
            <div className="sf-pdp-cat-row">
              <span className="sf-pdp-cat">{catIcon(p.category)} {p.category || 'عمومی'}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {p.sku ? <span className="sf-pdp-sku">کد: {p.sku}</span> : null}
              </span>
            </div>
            <h1>{p.title}</h1>
            <div className="sf-pdp-rating-row">
              <StarRow rating={meta.stars} size="md" />
              <strong>{toFa(meta.rating)}</strong>
              <span>از مجموع {toFa(meta.reviews)} دیدگاه</span>
              <span className="sf-dot">·</span>
              <span>{toFa(meta.sold)}+ فروش</span>
            </div>
            <div className={`sf-pdp-stock ${inStock ? 'ok' : 'no'}`}>{inStock ? '✓ موجود در انبار — آماده ارسال' : 'ناموجود'}</div>

            <div className="sf-pdp-price-box">
              {p.has_discount && (p.old_price_formatted || p.old_price) ? (
                <div className="sf-old">{p.old_price_formatted || formatMoney(p.old_price, currency)}</div>
              ) : null}
              <div className="sf-price sf-pdp-price">
                {p.price_formatted || formatMoney(p.price, currency)}
                {p.has_discount && p.discount_pct ? (
                  <span className="sf-disc-inline">{toFa(p.discount_pct)}٪</span>
                ) : null}
              </div>
              {inst ? <div className="sf-pdp-install">💳 امکان خرید اقساطی — {inst}</div> : null}
              {freeOk ? <div className="sf-pdp-freeship">🚚 ارسال رایگان برای این کالا</div> : thr > 0 ? (
                <div className="sf-pdp-freeship muted">ارسال رایگان برای سفارش‌های بالای {formatMoney(thr, currency)}</div>
              ) : null}
            </div>

            {vars ? (
              <div className="sf-pdp-vars">
                <strong>تنوع‌ها و گزینه‌ها</strong>
                <div className="sf-pdp-var-chips">
                  {vars.split(/[|،,\\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10).map((v) => (
                    <span key={v} className="sf-var-chip">{v}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="sf-pdp-qty">
              <span>تعداد:</span>
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <strong>{toFa(qty)}</strong>
              <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))}>＋</button>
            </div>
            <div className="sf-pdp-actions">
              <button type="button" className="sf-btn primary lg" disabled={!inStock} onClick={addN}>
                افزودن به سبد خرید
              </button>
              <button type="button" className="sf-btn ghost lg" disabled={!inStock} onClick={() => { addN(); onCheckout?.(); }}>
                خرید فوری
              </button>
              <button type="button" className="sf-btn ask lg" onClick={() => onAsk(p)}>
                💬 بپرس از پشتیبانی
              </button>
            </div>

            <div className="sf-pdp-boxes">
              <div className="sf-pdp-box">
                <div className="t">🚚 ارسال</div>
                <p>ارسال سریع سراسر کشور{freeOk ? ' — رایگان برای این کالا' : ''}</p>
                <p className="sub">تحویل معمولاً ۱ تا ۳ روز کاری</p>
              </div>
              <div className="sf-pdp-box">
                <div className="t">🛡️ گارانتی</div>
                <p>ضمانت اصالت و سلامت فیزیکی کالا</p>
                <p className="sub">۷ روز بازگشت بدون شرط</p>
              </div>
              <div className="sf-pdp-box">
                <div className="t">🏪 فروشنده</div>
                <p>فروشگاه رسمی این ویترین</p>
                <p className="sub">عملکرد عالی · پاسخگویی سریع</p>
              </div>
            </div>

            <div className="sf-pdp-trust">
              <span>🚚 ارسال سریع</span>
              <span>✅ ضمانت اصالت</span>
              <span>↩️ ۷ روز بازگشت</span>
              <span>💳 پرداخت امن</span>
            </div>
          </div>
        </div>

        <div className="sf-pdp-tabs" role="tablist">
          <button type="button" role="tab" className={tab === 'desc' ? 'on' : ''} onClick={() => setTab('desc')}>توضیحات</button>
          <button type="button" role="tab" className={tab === 'specs' ? 'on' : ''} onClick={() => setTab('specs')}>مشخصات{specs.length ? ` (${toFa(specs.length)})` : ''}</button>
          <button type="button" role="tab" className={tab === 'ship' ? 'on' : ''} onClick={() => setTab('ship')}>ارسال و مرجوعی</button>
        </div>

        {tab === 'desc' ? (
          <section className="sf-pdp-desc">
            <h2>توضیحات محصول {showAiBadge ? <span className="sf-pdp-ai-badge">{aiFilling ? '✨ در حال تکمیل با هوش مصنوعی…' : '✨ تکمیل‌شده با AI'}</span> : null}</h2>
            {descHtml ? (
              <div className="sf-pdp-desc-body sf-bubble-md" dangerouslySetInnerHTML={{ __html: descHtml }} />
            ) : (
              <p className="sf-pdp-desc-empty">
                {aiFilling || loading
                  ? '✨ هوش مصنوعی در حال نوشتن توضیحات این کالا است…'
                  : 'توضیحات تکمیلی این کالا به‌زودی تکمیل می‌شود. اصالت کالا و ارسال سریع تضمین شده است.'}
              </p>
            )}
          </section>
        ) : null}

        {tab === 'specs' ? (
          <section className="sf-pdp-desc">
            <h2>جدول مشخصات</h2>
            {specs.length ? (
              <table className="sf-spec-table">
                <tbody>
                  {specs.map((row, i) => (
                    <tr key={i}>
                      <th>{row.name}</th>
                      <td>{String(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="sf-spec-fallback">
                <div className="sf-spec-grid">
                  <div><span>دسته‌بندی</span><b>{p.category || 'عمومی'}</b></div>
                  <div><span>وضعیت</span><b>{inStock ? 'موجود' : 'ناموجود'}</b></div>
                  <div><span>امتیاز</span><b>{toFa(meta.rating)} / ۵</b></div>
                  <div><span>فروش</span><b>{toFa(meta.sold)}+</b></div>
                  {p.has_discount ? <div><span>تخفیف</span><b>{toFa(p.discount_pct || 0)}٪</b></div> : null}
                  <div><span>پرداخت</span><b>آنلاین / در محل</b></div>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {tab === 'ship' ? (
          <section className="sf-pdp-desc">
            <h2>ارسال، پرداخت و مرجوعی</h2>
            <ul className="sf-ship-list">
              <li>ارسال به سراسر ایران با پست پیشتاز و تیپاکس</li>
              <li>بسته‌بندی ایمن و بیمهٔ محموله</li>
              <li>۷ روز ضمانت بازگشت در صورت مغایرت</li>
              <li>پرداخت امن آنلاین یا پرداخت در محل (در صورت فعال بودن)</li>
              {freeOk ? <li className="hi">این کالا شامل ارسال رایگان است</li> : null}
            </ul>
          </section>
        ) : null}

        {rel.length ? (
          <section className="sf-related" aria-label="کالاهای مرتبط">
            <div className="sf-sec-head">
              <h2>کالاهای مشابه و مکمل</h2>
              <span>{toFa(rel.length)} پیشنهاد</span>
            </div>
            <div className="sf-related-scroller">
              {rel.map((rp) => {
                const rm = productVisualMeta(rp);
                return (
                  <button type="button" key={rp.id} className="sf-related-card" onClick={() => onOpenRelated?.(rp)}>
                    {rp.image ? <img src={rp.image} alt="" loading="lazy" /> : <div className="ph">📦</div>}
                    <div className="body">
                      <div className="t">{rp.title}</div>
                      <div className="meta"><StarRow rating={rm.stars} /> <span>{toFa(rm.rating)}</span></div>
                      <div className="pr">{rp.price_formatted || formatMoney(rp.price, currency)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      <div className="sf-pdp-sticky-buy">
        <div className="price">{p.price_formatted || formatMoney(p.price, currency)}</div>
        <button type="button" className="sf-btn primary" disabled={!inStock} onClick={addN}>افزودن به سبد</button>
      </div>
      {zoomOpen && mainImg ? (
        <ImageZoomLightbox
          src={mainImg}
          alt={p.title}
          onClose={() => setZoomOpen(false)}
          hasNav={gallery.length > 1}
          onPrev={() => setImgIdx((i) => (i - 1 + gallery.length) % gallery.length)}
          onNext={() => setImgIdx((i) => (i + 1) % gallery.length)}
        />
      ) : null}
    </div>
  );
}

function QuickView({ product, currency, onClose, onAdd, onAsk, ajax, onCheckout }) {
  /* v13.2: مودال سریع دیگر lean نیست — همان صفحه محصول */
  if (!product) return null;
  return (
    <ProductPage
      product={product}
      currency={currency}
      ajax={ajax}
      onClose={onClose}
      onAdd={onAdd}
      onAsk={onAsk}
      onCheckout={onCheckout}
      related={[]}
      freeShip={0}
      onOpenRelated={onClose}
    />
  );
}


function fieldOn(settings, key, defOn = true) {
  const v = settings?.[key];
  if (v === undefined || v === null) return defOn;
  return !!v;
}

function CheckoutPage({
  open, onClose, items, currency, settings, ajax, gateways: bootGateways,
  onQty, onRemove, onClearCart, toast, initialDone = null,
}) {
  const [gateways, setGateways] = useState(() => Array.isArray(bootGateways) ? bootGateways : []);
  const [payment, setPayment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(() => (initialDone && typeof initialDone === 'object' ? initialDone : null));
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', province: '', city: '', address: '', postal: '', notes: '',
    lat: '', lng: '',
  });
  const [cityOptions, setCityOptions] = useState([]);
  const [cityManual, setCityManual] = useState(false);
  const [shipMethods, setShipMethods] = useState([]);
  const [shippingId, setShippingId] = useState('');
  const [shipLoading, setShipLoading] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapQuery, setMapQuery] = useState('');
  const [mapResults, setMapResults] = useState([]);
  const [mapBusy, setMapBusy] = useState(false);
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const markerRef = useRef(null);

  const showShip = fieldOn(settings, 'checkout_show_shipping', true);
  const showMap = fieldOn(settings, 'checkout_show_map', true) && !!settings.neshan_api_key_set;
  const originLat = parseFloat(settings.shipping_origin_lat || '35.6892') || 35.6892;
  const originLng = parseFloat(settings.shipping_origin_lng || '51.3890') || 51.3890;

  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (it.qty || 1), 0);
  const selectedShip = shipMethods.find((m) => m.id === shippingId) || null;
  const shippingCost = selectedShip ? (Number(selectedShip.cost) || 0) : 0;
  const total = subtotal + shippingCost;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.province) { setCityOptions([]); return; }
    const local = IRAN_CITIES[form.province] || [];
    if (local.length) { setCityOptions(local); return; }
    let cancelled = false;
    (async () => {
      try {
        const fd = new FormData();
        fd.append('action', 'scraper_get_iran_cities');
        fd.append('province', form.province);
        const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const cities = data?.data?.cities || [];
        if (!cancelled && Array.isArray(cities)) setCityOptions(cities);
      } catch { if (!cancelled) setCityOptions([]); }
    })();
    return () => { cancelled = true; };
  }, [form.province]);

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initialDone && typeof initialDone === 'object' && initialDone.phase === 'complete') {
      setDone(initialDone);
    } else if (!done || done.phase !== 'complete') {
      if (!initialDone) setDone(null);
    }
    let cancelled = false;
    (async () => {
      try {
        const fd = new FormData();
        fd.append('action', 'scraper_get_payment_gateways');
        const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const list = data?.data?.gateways || data?.gateways || [];
        if (!cancelled && Array.isArray(list) && list.length) {
          setGateways(list);
          setPayment((p) => p || list[0].id);
        } else if (!cancelled && (!gateways || !gateways.length)) {
          const fallback = [{ id: 'cod', title: settings.checkout_cod_label || 'پرداخت در محل', description: 'پرداخت هنگام تحویل', icon: '' }];
          setGateways(fallback);
          setPayment('cod');
        }
      } catch {
        if (!cancelled && !gateways.length) {
          setGateways([{ id: 'cod', title: settings.checkout_cod_label || 'پرداخت در محل', description: '', icon: '' }]);
          setPayment('cod');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (gateways.length && !payment) setPayment(gateways[0].id);
  }, [gateways, payment]);

  const fetchShipping = async () => {
    if (!showShip) return;
    if (!form.province && !form.city) return;
    setShipLoading(true);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_calc_shipping');
      fd.append('nonce', ajax.cartNonce || '');
      fd.append('province', form.province || '');
      fd.append('city', form.city || '');
      fd.append('postal', form.postal || '');
      fd.append('address', form.address || '');
      fd.append('subtotal', String(subtotal));
      fd.append('weight_kg', String(Math.max(0.5, items.reduce((s, it) => s + (it.qty || 1) * 0.5, 0))));
      if (form.lat) fd.append('lat', form.lat);
      if (form.lng) fd.append('lng', form.lng);
      const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      const list = data?.data?.methods || [];
      if (Array.isArray(list) && list.length) {
        setShipMethods(list);
        setShippingId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0].id));
      }
    } catch { /* keep */ }
    finally { setShipLoading(false); }
  };

  useEffect(() => {
    if (!open || !showShip) return;
    const t = setTimeout(() => { fetchShipping(); }, 350);
    return () => clearTimeout(t);
  }, [open, showShip, form.province, form.city, form.postal, form.lat, form.lng, subtotal, items.length]);

  const ensureLeaflet = () => new Promise((resolve, reject) => {
    if (window.L) { resolve(window.L); return; }
    const cssId = 'sf-leaflet-css';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const jsId = 'sf-leaflet-js';
    const existing = document.getElementById(jsId);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L));
      if (window.L) resolve(window.L);
      return;
    }
    const s = document.createElement('script');
    s.id = jsId; s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('leaflet'));
    document.head.appendChild(s);
  });

  const [geoLabel, setGeoLabel] = useState(''); // Neshan reverse address preview

  const reverseGeocode = async (lat, lng) => {
    const fd = new FormData();
    fd.append('action', 'scraper_neshan_geocode');
    fd.append('mode', 'reverse');
    fd.append('lat', String(Number(lat).toFixed(7)));
    fd.append('lng', String(Number(lng).toFixed(7)));
    const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!data?.success) throw new Error(typeof data?.data === 'string' ? data.data : 'خطا در تبدیل مختصات به آدرس (نشان)');
    return data.data || {};
  };

  /** Apply Neshan reverse-geocode result onto checkout form */
  const applyNeshanGeo = (geo, lat, lng, { keepAddressIfEmpty = false } = {}) => {
    const formatted = geo.formatted || geo.formatted_address || geo.address || '';
    const province = geo.province || '';
    const city = geo.city || '';
    const neigh = geo.neighbourhood || '';
    const route = geo.route_name || '';
    setGeoLabel(formatted || [route, neigh, city].filter(Boolean).join('، '));
    setForm((f) => {
      const next = {
        ...f,
        lat: String(lat),
        lng: String(lng),
        province: province || f.province,
        city: city || f.city,
      };
      if (formatted) {
        next.address = formatted;
      } else if (!keepAddressIfEmpty && (route || neigh)) {
        next.address = [route, neigh, city].filter(Boolean).join('، ');
      }
      return next;
    });
    if (province) {
      const local = IRAN_CITIES[province] || [];
      setCityOptions(local);
      if (city && local.length && !local.includes(city)) {
        setCityManual(true);
      } else if (city && local.includes(city)) {
        setCityManual(false);
      }
    }
  };

  const applyMapPoint = async (lat, lng) => {
    setForm((f) => ({ ...f, lat: String(lat), lng: String(lng) }));
    setGeoLabel('در حال دریافت آدرس از نشان…');
    try {
      setMapBusy(true);
      const geo = await reverseGeocode(lat, lng);
      applyNeshanGeo(geo, lat, lng);
      toast?.(geo.formatted ? 'آدرس از نشان دریافت شد' : 'موقعیت ثبت شد', 'ok');
    } catch (e) {
      setGeoLabel('');
      toast?.(e?.message || 'خطا در سرویس تبدیل مختصات نشان', 'err');
    } finally { setMapBusy(false); }
  };

  useEffect(() => {
    if (!mapOpen || !showMap) return;
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeaflet();
        if (cancelled || !mapRef.current) return;
        const lat0 = form.lat ? parseFloat(form.lat) : originLat;
        const lng0 = form.lng ? parseFloat(form.lng) : originLng;
        if (mapInst.current) { try { mapInst.current.remove(); } catch {} mapInst.current = null; }
        const map = L.map(mapRef.current, { center: [lat0, lng0], zoom: 12, scrollWheelZoom: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap · Neshan',
        }).addTo(map);
        const marker = L.marker([lat0, lng0], { draggable: true }).addTo(map);
        marker.on('dragend', () => { const ll = marker.getLatLng(); applyMapPoint(ll.lat, ll.lng); });
        map.on('click', (e) => { marker.setLatLng(e.latlng); applyMapPoint(e.latlng.lat, e.latlng.lng); });
        mapInst.current = map; markerRef.current = marker;
        setTimeout(() => map.invalidateSize(), 120);
      } catch { toast?.('بارگذاری نقشه ناموفق بود', 'err'); }
    })();
    return () => {
      cancelled = true;
      if (mapInst.current) { try { mapInst.current.remove(); } catch {} mapInst.current = null; }
    };
  }, [mapOpen, showMap]);

  const searchMap = async () => {
    if (!mapQuery.trim()) return;
    setMapBusy(true);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_neshan_geocode');
      fd.append('mode', 'search');
      fd.append('term', mapQuery.trim());
      fd.append('lat', form.lat || String(originLat));
      fd.append('lng', form.lng || String(originLng));
      const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { toast?.(data?.data || 'جستجو ناموفق', 'err'); return; }
      const items = data?.data?.items || [];
      setMapResults(items);
      if (items[0] && mapInst.current && markerRef.current) {
        markerRef.current.setLatLng([items[0].lat, items[0].lng]);
        mapInst.current.setView([items[0].lat, items[0].lng], 14);
      }
    } catch { toast?.('خطا در جستجوی نشان', 'err'); }
    finally { setMapBusy(false); }
  };

  if (!open) return null;

  const validate = () => {
    const checks = [
      ['name', 'checkout_field_name', 'checkout_field_name_req', 'نام و نام خانوادگی', true],
      ['phone', 'checkout_field_phone', 'checkout_field_phone_req', 'شماره موبایل', true],
      ['email', 'checkout_field_email', 'checkout_field_email_req', 'ایمیل', false],
      ['province', 'checkout_field_province', 'checkout_field_province_req', 'استان', true],
      ['city', 'checkout_field_city', 'checkout_field_city_req', 'شهر', true],
      ['address', 'checkout_field_address', 'checkout_field_address_req', 'آدرس', true],
      ['postal', 'checkout_field_postal', 'checkout_field_postal_req', 'کد پستی', false],
      ['notes', 'checkout_field_notes', 'checkout_field_notes_req', 'توضیحات', false],
    ];
    for (const [key, en, req, label, defOn] of checks) {
      if (fieldOn(settings, en, defOn) && fieldOn(settings, req, false) && !String(form[key] || '').trim()) {
        return `لطفاً فیلد «${label}» را تکمیل کنید.`;
      }
    }
    if (showShip && shipMethods.length && !shippingId) return 'روش ارسال را انتخاب کنید.';
    if (fieldOn(settings, 'checkout_show_gateways', true) && gateways.length && !payment) return 'روش پرداخت را انتخاب کنید.';
    if (!items.length) return 'سبد خرید خالی است.';
    return '';
  };

  const placeOrder = async () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_custom_checkout_place_order');
      fd.append('nonce', ajax.cartNonce || '');
      fd.append('items', JSON.stringify(items.map((it) => ({
        id: it.id, title: it.title, price: it.price, qty: it.qty || 1, image: it.image || '',
      }))));
      Object.entries(form).forEach(([k, val]) => fd.append(k, val));
      fd.append('payment_method', payment);
      if (shippingId) {
        fd.append('shipping_method', shippingId);
        fd.append('shipping_title', selectedShip?.title || '');
        fd.append('shipping_cost', String(shippingCost));
      }
      const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { setErr(data?.data || data?.message || 'ثبت سفارش ناموفق بود.'); return; }
      const payload = data.data || {};
      const needsPay = !!(payload.needs_payment || payload.pay_url)
        && payload.payment_method && payload.payment_method !== 'cod' && !payload.is_cod;
      if (needsPay && payload.pay_url) {
        try {
          saveLS(PENDING_ORDER_KEY, {
            order_id: payload.order_id, order_key: payload.order_key, total: payload.total,
            total_formatted: payload.total_formatted, payment_method: payload.payment_method,
            payment_title: payload.payment_title, thankyou_url: payload.thankyou_url || '',
            message: payload.message || settings.checkout_success_msg || '', at: Date.now(),
          });
        } catch {}
        onClearCart?.();
        toast?.('در حال انتقال به درگاه پرداخت…', 'ok');
        setDone({ ...payload, phase: 'redirecting' });
        setTimeout(() => {
          try { window.location.href = payload.pay_url; } catch { setDone({ ...payload, phase: 'awaiting_payment' }); }
        }, 450);
        return;
      }
      try { localStorage.removeItem(PENDING_ORDER_KEY); } catch {}
      setDone({ ...payload, phase: 'complete', paid: true });
      onClearCart?.();
      toast?.(payload.message || settings.checkout_success_msg || 'سفارش شما ثبت شد', 'ok');
    } catch { setErr('خطا در ارتباط با سرور. دوباره تلاش کنید.'); }
    finally { setBusy(false); }
  };

  const showGw = fieldOn(settings, 'checkout_show_gateways', true);
  const onProvinceChange = (val) => {
    setForm((f) => ({ ...f, province: val, city: '' }));
    setCityManual(false);
  };

  return (
    <div className="sf-checkout" role="dialog" aria-modal="true" aria-label="تسویه حساب">
      <div className="sf-checkout-top">
        <button type="button" className="sf-checkout-back" onClick={onClose}>→ بازگشت به فروشگاه</button>
        <div>
          <h2>{settings.checkout_title || 'تسویه حساب امن'}</h2>
          {settings.checkout_note ? <p>{settings.checkout_note}</p> : null}
        </div>
        <div className="sf-checkout-steps">
          <span className="on">۱. سبد</span>
          <span className="on">۲. اطلاعات</span>
          <span className={done && done.phase === 'complete' ? 'on' : (done ? 'mid' : '')}>۳. پرداخت</span>
        </div>
      </div>

      {done ? (
        <div className={`sf-checkout-success ${(done.phase === 'redirecting' || done.phase === 'awaiting_payment') ? 'pending' : 'complete'}`}>
          {(done.phase === 'redirecting' || done.phase === 'awaiting_payment') ? (
            <>
              <div className="ico">⏳</div>
              <h3>در حال انتقال به درگاه پرداخت…</h3>
              <p>سفارش ثبت شد؛ لطفاً پرداخت را در درگاه تکمیل کنید.</p>
              <p>شماره سفارش: <strong>{toFa(done.order_id)}</strong></p>
              <p>مبلغ: <strong>{done.total_formatted || formatMoney(done.total, currency)}</strong></p>
              {done.pay_url ? <a className="sf-btn primary lg" href={done.pay_url}>ورود به درگاه پرداخت ↗</a> : null}
              <p className="sf-co-hint">پیام تکمیل سفارش فقط پس از بازگشت موفق از درگاه نمایش داده می‌شود.</p>
            </>
          ) : (
            <>
              <div className="ico">✓</div>
              <h3>{done.message || settings.checkout_success_msg || 'سفارش شما با موفقیت تکمیل شد'}</h3>
              <p>شماره سفارش: <strong>{toFa(done.order_id)}</strong></p>
              <p>مبلغ: <strong>{done.total_formatted || formatMoney(done.total, currency)}</strong></p>
              <p>روش پرداخت: <strong>{done.payment_title || done.payment_method}</strong></p>
              <button type="button" className="sf-btn primary lg" onClick={onClose}>بازگشت به فروشگاه</button>
            </>
          )}
        </div>
      ) : (
        <div className="sf-checkout-grid">
          <div className="sf-checkout-main">
            <section className="sf-co-card">
              <h3>اطلاعات گیرنده</h3>
              <div className="sf-co-fields">
                {fieldOn(settings, 'checkout_field_name', true) ? (
                  <label className="sf-co-field">
                    <span>نام و نام خانوادگی{fieldOn(settings, 'checkout_field_name_req', true) ? ' *' : ''}</span>
                    <input value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_phone', true) ? (
                  <label className="sf-co-field">
                    <span>موبایل{fieldOn(settings, 'checkout_field_phone_req', true) ? ' *' : ''}</span>
                    <input value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" dir="ltr" inputMode="tel" />
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_email', false) ? (
                  <label className="sf-co-field">
                    <span>ایمیل{fieldOn(settings, 'checkout_field_email_req', false) ? ' *' : ''}</span>
                    <input value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" dir="ltr" />
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_province', true) ? (
                  <label className="sf-co-field">
                    <span>استان{fieldOn(settings, 'checkout_field_province_req', true) ? ' *' : ''}</span>
                    <select value={form.province} onChange={(e) => onProvinceChange(e.target.value)}>
                      <option value="">انتخاب استان</option>
                      {IRAN_PROVINCES.map((pv) => <option key={pv} value={pv}>{pv}</option>)}
                    </select>
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_city', true) ? (
                  <label className="sf-co-field">
                    <span>شهر{fieldOn(settings, 'checkout_field_city_req', true) ? ' *' : ''}</span>
                    {!cityManual && cityOptions.length ? (
                      <select value={form.city} onChange={(e) => {
                        if (e.target.value === '__other__') { setCityManual(true); set('city', ''); return; }
                        set('city', e.target.value);
                      }}>
                        <option value="">انتخاب شهر</option>
                        {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__other__">سایر (ورود دستی)…</option>
                      </select>
                    ) : (
                      <input value={form.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" placeholder={form.province ? 'نام شهر' : 'ابتدا استان را انتخاب کنید'} />
                    )}
                    {cityManual && cityOptions.length ? (
                      <button type="button" className="sf-co-linkbtn" onClick={() => setCityManual(false)}>بازگشت به لیست شهرها</button>
                    ) : null}
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_address', true) ? (
                  <label className="sf-co-field full">
                    <span>آدرس کامل{fieldOn(settings, 'checkout_field_address_req', true) ? ' *' : ''}</span>
                    <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_postal', false) ? (
                  <label className="sf-co-field">
                    <span>کد پستی{fieldOn(settings, 'checkout_field_postal_req', false) ? ' *' : ''}</span>
                    <input value={form.postal} onChange={(e) => set('postal', e.target.value)} dir="ltr" inputMode="numeric" />
                  </label>
                ) : null}
                {fieldOn(settings, 'checkout_field_notes', false) ? (
                  <label className="sf-co-field full">
                    <span>توضیحات سفارش{fieldOn(settings, 'checkout_field_notes_req', false) ? ' *' : ''}</span>
                    <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                  </label>
                ) : null}
              </div>

              {showMap ? (
                <div className="sf-co-map-wrap">
                  <div className="sf-co-map-head">
                    <strong>📍 مقصد روی نقشه · تبدیل مختصات به آدرس (نشان)</strong>
                    <button type="button" className="sf-btn ghost sm" onClick={() => setMapOpen((v) => !v)}>
                      {mapOpen ? 'بستن نقشه' : 'باز کردن نقشه'}
                    </button>
                  </div>
                  {form.lat && form.lng ? (
                    <div className="sf-co-neshan-addr">
                      <p className="sf-co-hint">مختصات: <span dir="ltr">{Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</span></p>
                      {geoLabel ? <p className="sf-co-neshan-line"><strong>آدرس نشان:</strong> {geoLabel}</p> : null}
                      {mapBusy ? <p className="sf-co-hint">⏳ تبدیل مختصات به آدرس (Neshan Reverse)…</p> : null}
                    </div>
                  ) : (
                    <p className="sf-co-hint">با کلیک یا کشیدن نشانگر، سرویس <strong>تبدیل مختصات به آدرس نشان</strong> آدرس کامل را پر می‌کند.</p>
                  )}
                  {mapOpen ? (
                    <div className="sf-co-map-panel">
                      <div className="sf-co-map-search">
                        <input value={mapQuery} onChange={(e) => setMapQuery(e.target.value)} placeholder="جستجوی مکان در نشان…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchMap(); } }} />
                        <button type="button" className="sf-btn primary sm" disabled={mapBusy} onClick={searchMap}>{mapBusy ? '…' : 'جستجو'}</button>
                      </div>
                      {mapResults.length ? (
                        <ul className="sf-co-map-results">
                          {mapResults.slice(0, 6).map((it, idx) => (
                            <li key={idx}>
                              <button type="button" onClick={() => {
                                if (markerRef.current && mapInst.current) {
                                  markerRef.current.setLatLng([it.lat, it.lng]);
                                  mapInst.current.setView([it.lat, it.lng], 15);
                                }
                                /* full address via Neshan reverse geocoding */
                                applyMapPoint(it.lat, it.lng);
                              }}>
                                <strong>{it.title || it.address}</strong>
                                {it.address && it.title !== it.address ? <small>{it.address}</small> : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="sf-co-map" ref={mapRef} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            {showShip ? (
              <section className="sf-co-card">
                <h3>روش ارسال</h3>
                <p className="sf-co-hint">
                  {shipLoading ? 'در حال محاسبه هزینه ارسال…' : 'روش‌های فعال ووکامرس و پست / چاپار / تیپاکس'}
                  {settings.free_shipping_threshold ? ` · ارسال رایگان بالای ${formatMoney(settings.free_shipping_threshold, currency)}` : ''}
                </p>
                {!form.province && !form.city ? (
                  <p className="sf-co-hint">برای مشاهده هزینه، استان و شهر را انتخاب کنید.</p>
                ) : null}
                <div className="sf-gateways sf-ship-methods">
                  {shipMethods.map((m) => (
                    <label key={m.id} className={`sf-gw ${shippingId === m.id ? 'on' : ''}`}>
                      <input type="radio" name="sf_ship" value={m.id} checked={shippingId === m.id} onChange={() => setShippingId(m.id)} />
                      <span className="sf-gw-body">
                        <span className="sf-gw-ph">{m.carrier === 'post' ? '📮' : m.carrier === 'chapar' ? '🚚' : m.carrier === 'tipax' ? '📦' : '🚛'}</span>
                        <span>
                          <strong>{m.title}</strong>
                          {m.description ? <small>{m.description}</small> : null}
                          <small className="sf-ship-src">{m.source === 'woocommerce' ? 'ووکامرس' : 'برآورد سامانه'}</small>
                        </span>
                        <em className="sf-ship-cost">{(Number(m.cost) || 0) <= 0 ? 'رایگان' : (m.cost_formatted || formatMoney(m.cost, currency))}</em>
                      </span>
                    </label>
                  ))}
                  {!shipMethods.length && !shipLoading && (form.province || form.city) ? (
                    <p className="sf-co-hint">روش ارسالی یافت نشد — پس از ثبت سفارش هماهنگ می‌شود.</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {showGw ? (
              <section className="sf-co-card">
                <h3>روش پرداخت</h3>
                <p className="sf-co-hint">درگاه‌های فعال ووکامرس / وردپرس</p>
                <div className="sf-gateways">
                  {gateways.map((g) => (
                    <label key={g.id} className={`sf-gw ${payment === g.id ? 'on' : ''}`}>
                      <input type="radio" name="sf_pay" value={g.id} checked={payment === g.id} onChange={() => setPayment(g.id)} />
                      <span className="sf-gw-body">
                        {g.icon ? <img src={g.icon} alt="" className="sf-gw-icon" /> : <span className="sf-gw-ph">💳</span>}
                        <span>
                          <strong>{g.title}</strong>
                          {g.description ? <small>{g.description}</small> : null}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            {err ? <div className="sf-co-err">{err}</div> : null}
          </div>

          <aside className="sf-checkout-side">
            <section className="sf-co-card sticky">
              <h3>خلاصه سفارش</h3>
              <div className="sf-co-items">
                {items.map((it) => (
                  <div className="sf-co-item" key={it.id}>
                    {it.image ? <img src={it.image} alt="" /> : <span className="ph">📦</span>}
                    <div className="meta">
                      <strong>{it.title}</strong>
                      <span>{toFa(it.qty || 1)} × {it.price_txt || formatMoney(it.price, currency)}</span>
                    </div>
                    <div className="sf-qty mini">
                      <button type="button" onClick={() => onQty(it.id, (it.qty || 1) - 1)}>−</button>
                      <button type="button" onClick={() => onRemove(it.id)} title="حذف">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="sf-co-sum-lines">
                <div className="sf-co-sum-row"><span>جمع کالا</span><span>{formatMoney(subtotal, currency)}</span></div>
                {showShip ? (
                  <div className="sf-co-sum-row">
                    <span>ارسال{selectedShip ? ` (${selectedShip.title})` : ''}</span>
                    <span>{shippingCost <= 0 && selectedShip ? 'رایگان' : formatMoney(shippingCost, currency)}</span>
                  </div>
                ) : null}
              </div>
              <div className="sf-co-sum">
                <span>مبلغ قابل پرداخت</span>
                <strong>{formatMoney(total, currency)}</strong>
              </div>
              <button type="button" className="sf-btn primary block lg sf-co-pay-desk" disabled={busy || !items.length} onClick={placeOrder}>
                {busy ? 'در حال ثبت سفارش…' : 'ثبت و پرداخت'}
              </button>
              <p className="sf-co-secure">🔒 پرداخت امن · اطلاعات شما محفوظ است</p>
            </section>
          </aside>
        </div>
      )}

      {!done ? (
        <div className="sf-co-paybar" role="region" aria-label="پرداخت">
          <div className="sf-co-paybar-inner">
            <div className="sf-co-paybar-meta">
              <span className="lbl">مبلغ قابل پرداخت</span>
              <strong>{formatMoney(total, currency)}</strong>
              <small>{toFa(items.reduce((s, it) => s + (it.qty || 1), 0))} کالا{showShip && selectedShip ? ` · ${selectedShip.title}` : ''}</small>
            </div>
            <button type="button" className="sf-btn primary lg sf-co-paybar-btn" disabled={busy || !items.length} onClick={placeOrder}>
              {busy ? 'در حال ثبت…' : 'ثبت سفارش و پرداخت'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SupportChat({ settings, ajax, productCtx, onClearProduct, openSignal }) {
  const enabled = !!settings.enable_support_chat;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const fileRef = useRef(null);
  const [msgs, setMsgs] = useState(() => ([
    { id: 'w1', role: 'bot', text: settings.chat_welcome_message || 'سلام! خوش آمدید 👋 سوال خود را بنویسید.' },
  ]));
  const boxRef = useRef(null);
  const pos = settings.chat_button_position === 'right' ? 'right' : 'left';

  useEffect(() => {
    if (productCtx && productCtx.id) {
      setCtx(productCtx);
      setOpen(true);
      setMsgs((m) => {
        const note = `🛍 درباره «${productCtx.title || 'این کالا'}» سوال دارید؟ بپرسید.`;
        if (m.some((x) => x.id === `ctx-${productCtx.id}`)) return m;
        return [...m, { id: `ctx-${productCtx.id}`, role: 'bot', text: note }];
      });
      if (!text) setText(`درباره «${productCtx.title || 'این کالا'}» می‌خواستم بپرسم: `);
    }
  }, [productCtx, openSignal]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [msgs, open]);

  if (!enabled) return null;

  const onPickFile = (e) => {
    const f = e?.target?.files?.[0] || null;
    setFile(f);
    if (filePreview) {
      try { URL.revokeObjectURL(filePreview); } catch (_) { /* ignore */ }
    }
    if (f && f.type && f.type.startsWith('image/')) {
      try { setFilePreview(URL.createObjectURL(f)); } catch (_) { setFilePreview(''); }
    } else {
      setFilePreview('');
    }
  };
  const clearFile = () => {
    setFile(null);
    if (filePreview) {
      try { URL.revokeObjectURL(filePreview); } catch (_) { /* ignore */ }
    }
    setFilePreview('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    const msg = text.trim();
    if ((!msg && !file) || busy) return;
    setText('');
    const displayBits = [];
    if (msg) displayBits.push(msg);
    if (file) displayBits.push(`📎 ${file.name || 'پیوست'}`);
    const display = displayBits.join('\n') || '📎 پیوست';
    setMsgs((m) => [...m, {
      id: `u${Date.now()}`,
      role: 'user',
      text: display,
      mediaPreview: filePreview || '',
      mediaName: file?.name || '',
    }]);
    const fileToSend = file;
    clearFile();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_submit_support_chat');
      const nonce = (ajax && (ajax.chatNonce || ajax.nonce || ajax.chat_nonce)) || '';
      if (nonce) fd.append('nonce', nonce);
      fd.append('message', msg || (fileToSend ? '📎 پیوست چندرسانه‌ای' : ''));
      if (fileToSend) fd.append('chat_file', fileToSend, fileToSend.name || 'upload.bin');
      try {
        const sid = sessionStorage.getItem('amphp_chat_sid') || '';
        if (sid) fd.append('session_id', sid);
      } catch (_) { /* ignore */ }
      if (ctx?.id) {
        fd.append('product_id', String(ctx.id));
        fd.append('product_title', String(ctx.title || ''));
        const bits = [];
        if (ctx.price_formatted || ctx.price) bits.push(`قیمت: ${ctx.price_formatted || ctx.price}`);
        if (ctx.category) bits.push(`دسته: ${ctx.category}`);
        if (ctx.description) bits.push(`توضیح: ${String(ctx.description).slice(0, 280)}`);
        fd.append('product_context', bits.join(' | '));
      }
      const ajaxUrl = (ajax && (ajax.ajaxUrl || ajax.url)) || '/wp-admin/admin-ajax.php';
      const res = await fetch(ajaxUrl, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_) {
        // WP sometimes prefixes PHP notices before JSON
        const m = raw && raw.match(/\{[\s\S]*\}\s*$/);
        if (m) {
          try { data = JSON.parse(m[0]); } catch (e2) { data = {}; }
        }
      }
      const payload = (data && typeof data === 'object' && data.data && typeof data.data === 'object')
        ? data.data
        : (data || {});
      if (payload.session_id) {
        try { sessionStorage.setItem('amphp_chat_sid', String(payload.session_id)); } catch (_) { /* ignore */ }
      }
      const pick = (...vals) => {
        for (const v of vals) {
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
      };
      const isAck = (s) => {
        const t = String(s || '');
        return (
          t === 'ارسال انجام شد' ||
          t === 'ارسال انجام نشد. لطفاً دوباره تلاش کنید.' ||
          t.includes('پیام شما با موفقیت ثبت شد') ||
          t.includes('پیام شما دریافت شد') ||
          t === '1' ||
          t === '0'
        );
      };
      let reply = pick(
        payload.ai_reply,
        payload.reply,
        payload.response,
        payload.bot_reply,
        payload.text,
        // last message from thread if AI stored there
        Array.isArray(payload.thread?.messages)
          ? [...payload.thread.messages].reverse().find((x) => x && (x.sender === 'ai' || x.role === 'bot'))?.text
          : ''
      );
      if (isAck(reply)) reply = '';
      if (!reply && data && data.success === false) {
        const err = pick(payload.message, payload.error, typeof data.data === 'string' ? data.data : '');
        reply = err || 'پاسخ سرور ناموفق بود. لطفاً دوباره تلاش کنید.';
      }
      if (!reply) {
        // success without AI text — never show bare "ارسال انجام شد"
        reply = 'متأسفانه پاسخ هوشمند دریافت نشد. چند لحظه بعد دوباره بپرسید یا از پشتیبانی تلفنی استفاده کنید.';
      }
      setMsgs((m) => [...m, {
        id: `b${Date.now()}`,
        role: 'bot',
        text: String(reply),
        meta: payload.ai_model ? String(payload.ai_model) : '',
      }]);
    } catch (err) {
      setMsgs((m) => [...m, {
        id: `b${Date.now()}`,
        role: 'bot',
        text: 'ارتباط با سرور برقرار نشد. صفحه را یک‌بار رفرش کنید و دوباره بفرستید.',
      }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`sf-chat-fab ${pos}`} data-amphp-sf="13.3.21" onClick={() => setOpen((v) => !v)} aria-label={open ? 'بستن دستیار هوشمند' : 'گفتگو با دستیار هوشمند'} aria-expanded={open} aria-controls="sf-support-chat">
        <span className="sf-chat-fab-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="30" height="30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 7.5A4.5 4.5 0 0 1 10.5 3h11A4.5 4.5 0 0 1 26 7.5v10a4.5 4.5 0 0 1-4.5 4.5H15l-5.5 4v-4.1A4.5 4.5 0 0 1 6 17.5v-10Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <circle cx="12" cy="12.5" r="1.6" fill="currentColor"/><circle cx="20" cy="12.5" r="1.6" fill="currentColor"/>
            <path d="M12 17c1.2 1.4 6.8 1.4 8 0M25.5 23.5v5M23 26h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="sf-chat-fab-copy"><span className="lbl">دستیار هوشمند</span><span className="sf-chat-fab-hint">سؤالی دارید؟ بپرسید</span></span>
      </button>
      {open ? (
        <div id="sf-support-chat" className={`sf-chat-win ${pos}`}>
          <div className="sf-chat-head">
            <span>{settings.chat_window_title || 'پشتیبانی آنلاین'}</span>
            <button type="button" onClick={() => setOpen(false)} style={{ color: '#fff', fontWeight: 900 }}>✕</button>
          </div>
          {ctx?.title ? (
            <div className="sf-chat-product">
              {ctx.image ? <img src={ctx.image} alt="" /> : <span className="ph">📦</span>}
              <div>
                <strong>{ctx.title}</strong>
                <small>{ctx.price_formatted || ''}</small>
              </div>
              <button type="button" className="sf-close" title="حذف زمینه کالا" onClick={() => { setCtx(null); onClearProduct?.(); }}>✕</button>
            </div>
          ) : null}
          <div className="sf-chat-msgs" ref={boxRef}>
            {msgs.map((m) => (
              <div key={m.id} className={`sf-bubble-wrap ${m.role}`}>
                {m.mediaPreview ? (
                  <div className="sf-chat-media">
                    <img src={m.mediaPreview} alt="" />
                  </div>
                ) : null}
                {m.mediaName && !m.mediaPreview ? (
                  <div className="sf-chat-filechip">📎 {m.mediaName}</div>
                ) : null}
                <MdBubble role={m.role} text={m.text} />
              </div>
            ))}
            {busy ? <div className="sf-bubble bot sf-bubble-typing">در حال نوشتن…</div> : null}
          </div>
          {file ? (
            <div className="sf-chat-attach-bar">
              {filePreview ? <img src={filePreview} alt="" /> : <span className="sf-chat-filechip">📎 {file.name}</span>}
              <button type="button" className="sf-close" onClick={clearFile} title="حذف پیوست">✕</button>
            </div>
          ) : null}
          <div className="sf-chat-input">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.gif,.webp"
              style={{ display: 'none' }}
              onChange={onPickFile}
            />
            <button
              type="button"
              className="sf-chat-attach"
              title="ارسال عکس، فیلم، گیف یا فایل"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={busy}
            >📎</button>
            <textarea
              value={text}
              placeholder={ctx ? `سوال درباره «${ctx.title}»…` : 'پیام، لینک یا پیوست…'}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button type="button" className="sf-chat-send" onClick={send} disabled={busy || (!text.trim() && !file)}>➤</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function StoreApp({ boot }) {
  const settings = boot.settings || {};
  const meta = boot.meta || {};
  const [products, setProducts] = useState(() => Array.isArray(boot.products)
    ? boot.products.map((product) => ({ ...product, category: displayCategory(product.category) }))
    : []);
  /* v13.3.1: total_count = کل کاتالوگ (هم‌تراز پروفایل‌های اسکریپر) */
  const catalogTotal = Math.max(
    Number(meta.total_count) || 0,
    Number(meta.count) || 0,
    products.length,
  );
  const fixProductImage = useCallback((id, url) => {
    if (!id || !url) return;
    setProducts((list) => list.map((x) => (String(x.id) === String(id)
      ? { ...x, image: url, gallery: [url, ...((x.gallery || []).filter((g) => g && g !== url))], image_source: 'ai_web' }
      : x)));
  }, []);
  const ajax = boot.ajax || {};
  const currency = settings.currency_symbol || 'تومان';
  const palette = settings.store_palette || 'digikala-red';
  const template = settings.store_template || 'digikala';
  /* Palette is source of truth for theme color; accent_color is optional override when non-empty and different. */
  const paletteAccent = PALETTE_ACCENTS[palette] || PALETTE_ACCENTS[template] || '#ef394e';
  const customAccent = String(settings.accent_color || '').trim();
  const accent = (customAccent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(customAccent))
    ? customAccent
    : paletteAccent;
  const pageSize = Math.max(8, Math.min(60, Number(settings.products_per_page) || PAGE_SIZE));

  const categories = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      const c = p.category || 'عمومی';
      map[c] = (map[c] || 0) + 1;
    });
    return map;
  }, [products]);

  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('default');
  const [page, setPage] = useState(1);
  const [cols, setCols] = useState(() => loadLS(COLS_KEY, settings.default_column_layout || '4') || '4');
  const [cart, setCart] = useState(() => loadLS(CART_KEY, []));
  const [wish, setWish] = useState(() => loadLS(WISH_KEY, {}));
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [quick, setQuick] = useState(null);
  const [productPage, setProductPage] = useState(null);
  const [chatProduct, setChatProduct] = useState(null);
  const [chatSignal, setChatSignal] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutDoneSeed, setCheckoutDoneSeed] = useState(null);
  const [toasts, setToasts] = useState([]);
  const megaRef = useRef(null);
  const searchRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocus, setSearchFocus] = useState(false);
  // close expanded search on outside click
  useEffect(() => {
    const onDoc = (e) => {
      try {
        if (!searchRef.current) return;
        if (searchRef.current.contains(e.target)) return;
        if (!query.trim()) {
          setSearchOpen(false);
          setSearchFocus(false);
        } else {
          setSearchOpen(false);
        }
      } catch (err) {}
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [query]);

  useAdminBarOffset();
  const { progress, scrolled } = useScrollProgress();
  const timer = useCountdown(8);

  useEffect(() => { saveLS(CART_KEY, cart); }, [cart]);
  useEffect(() => { saveLS(WISH_KEY, wish); }, [wish]);
  useEffect(() => { saveLS(COLS_KEY, cols); }, [cols]);

  useEffect(() => {
    const root = document.documentElement;
    const soft = (() => {
      try {
        const h = accent.replace('#', '');
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
        const n = parseInt(full, 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return `rgba(${r},${g},${b},0.12)`;
      } catch { return '#fff0f2'; }
    })();
    const darken = (() => {
      try {
        const h = accent.replace('#', '');
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
        const n = parseInt(full, 16);
        let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        r = Math.max(0, Math.round(r * 0.85)); g = Math.max(0, Math.round(g * 0.85)); b = Math.max(0, Math.round(b * 0.85));
        return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
      } catch { return accent; }
    })();
    root.style.setProperty('--sf-accent', accent);
    root.style.setProperty('--sf-accent-2', darken);
    root.style.setProperty('--sf-accent-soft', soft);
    root.setAttribute('data-sf-palette', palette);
    root.setAttribute('data-sf-template', template);
    /* v13.3.3: همیشه فونت سرور از boot settings — نه localStorage دستگاه */
    const serverFont = settings.shop_title_font || settings.app_font || (typeof window !== 'undefined' && window.APP_FONT_SERVER) || 'vazirmatn';
    applyStorefrontFont(serverFont);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_track_event');
      fd.append('event_type', 'site_visit');
      fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' }).catch(() => {});
    } catch {}
  }, [settings.shop_title_font, settings.app_font, accent, palette, template]);

  useEffect(() => {
    const onDoc = (e) => {
      if (megaRef.current && !megaRef.current.contains(e.target)) setMegaOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const toast = useCallback((text, type = 'ok') => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  /* v13.1.8: پیام تکمیل فقط بعد از بازگشت از درگاه (نه با زدن دکمه پرداخت) */
  useEffect(() => {
    const ret = detectOrderReturn();
    let pending = null;
    try { pending = loadLS(PENDING_ORDER_KEY, null); } catch { pending = null; }
    const bootPaid = boot && boot.paid_order && typeof boot.paid_order === 'object' ? boot.paid_order : null;
    const successMsg = settings.checkout_success_msg || 'سفارش شما با موفقیت تکمیل شد. از خریدتان سپاسگزاریم!';

    if (bootPaid && (bootPaid.order_id || bootPaid.paid)) {
      const seed = {
        order_id: bootPaid.order_id,
        order_key: bootPaid.order_key || '',
        total: bootPaid.total,
        total_formatted: bootPaid.total_formatted,
        payment_method: bootPaid.payment_method || '',
        payment_title: bootPaid.payment_title || '',
        message: bootPaid.message || successMsg,
        phase: 'complete',
        paid: true,
      };
      setCheckoutDoneSeed(seed);
      setCheckoutOpen(true);
      try { localStorage.removeItem(PENDING_ORDER_KEY); } catch {}
      clearOrderReturnParams();
      toast(seed.message, 'ok');
      return;
    }

    if (ret && ret.paid) {
      const base = (pending && typeof pending === 'object') ? pending : {};
      const seed = {
        ...base,
        order_id: ret.order_id || base.order_id || '',
        order_key: ret.order_key || base.order_key || '',
        message: base.message || successMsg,
        phase: 'complete',
        paid: true,
      };
      setCheckoutDoneSeed(seed);
      setCheckoutOpen(true);
      setCart([]);
      try { localStorage.removeItem(PENDING_ORDER_KEY); } catch {}
      clearOrderReturnParams();
      toast(seed.message, 'ok');
      return;
    }

    if (pending && pending.at && (Date.now() - Number(pending.at)) > 2 * 3600 * 1000) {
      try { localStorage.removeItem(PENDING_ORDER_KEY); } catch {}
    }
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    let list = products.filter((p) => {
      if (cat !== 'all' && (p.category || 'عمومی') !== cat) return false;
      if (!q) return true;
      return productMatchesQuery(p, q);
    });
    if (sort === 'price-asc') list = [...list].sort((a, b) => (a.price || 0) - (b.price || 0));
    if (sort === 'price-desc') list = [...list].sort((a, b) => (b.price || 0) - (a.price || 0));
    if (sort === 'title') list = [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fa'));
    if (sort === 'popular') list = [...list].sort((a, b) => productVisualMeta(b).sold - productVisualMeta(a).sold);
    if (sort === 'discount') list = [...list].sort((a, b) => (Number(b.discount_pct) || 0) - (Number(a.discount_pct) || 0));
    return list;
  }, [products, query, cat, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = clamp(page, 1, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => { setPage(1); }, [query, cat, sort]);

  const cartCount = cart.reduce((s, it) => s + (it.qty || 1), 0);

  const addToCart = (p) => {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: (next[i].qty || 1) + 1 };
        return next;
      }
      return [...prev, {
        id: p.id,
        title: p.title,
        price: p.price,
        price_txt: p.price_formatted || formatMoney(p.price, currency),
        image: p.image || '',
        qty: 1,
      }];
    });
    toast(`«${p.title}» به سبد اضافه شد`);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_track_event');
      fd.append('event_type', 'add_to_cart');
      fd.append('product_id', p.id || '');
      fd.append('product_title', p.title || '');
      fd.append('price', p.price || 0);
      fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' }).catch(() => {});
    } catch {}
  };

  const setQty = (id, qty) => {
    setCart((prev) => prev
      .map((it) => (it.id === id ? { ...it, qty } : it))
      .filter((it) => (it.qty || 0) > 0));
  };

  const toggleWish = (id) => {
    setWish((w) => {
      const next = { ...w };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  const openProduct = useCallback((p) => {
    if (!p) return;
    setProductPage(p);
    setQuick(null);
    setCartOpen(false);
    setMenuOpen(false);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('product', String(p.id || ''));
      window.history.pushState({ amphpProduct: p.id }, '', u.pathname + '?' + u.searchParams.toString() + (u.hash || ''));
    } catch {}
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_track_event');
      fd.append('event_type', 'product_view');
      fd.append('product_id', p.id || '');
      fd.append('product_title', p.title || '');
      fd.append('price', p.price || 0);
      fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' }).catch(() => {});
    } catch {}
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  }, [ajax.ajaxUrl]);

  const closeProduct = useCallback(() => {
    setProductPage(null);
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has('product')) {
        u.searchParams.delete('product');
        const q = u.searchParams.toString();
        window.history.pushState({}, '', u.pathname + (q ? '?' + q : '') + (u.hash || ''));
      }
    } catch {}
  }, []);

  const openQuick = (p) => openProduct(p);

  const askAboutProduct = useCallback((p) => {
    if (!p) return;
    setChatProduct({
      id: p.id,
      title: p.title,
      image: p.image,
      price: p.price,
      price_formatted: p.price_formatted,
      category: p.category,
      description: p.description,
    });
    setChatSignal((n) => n + 1);
  }, []);

  /* deep-link ?product=id */
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const pid = u.searchParams.get('product');
      if (!pid || !products.length) return;
      const found = products.find((x) => String(x.id) === String(pid));
      if (found) setProductPage(found);
    } catch {}
  }, [products]);

  useEffect(() => {
    const onPop = () => {
      try {
        const u = new URL(window.location.href);
        const pid = u.searchParams.get('product');
        if (!pid) { setProductPage(null); return; }
        const found = products.find((x) => String(x.id) === String(pid));
        if (found) setProductPage(found);
      } catch {}
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [products]);

  const checkout = async () => {
    if (!cart.length) return;
    try {
      const tfd = new FormData();
      tfd.append('action', 'scraper_track_event');
      tfd.append('event_type', 'checkout_step');
      tfd.append('count', cartCount);
      tfd.append('total', cart.reduce((s, it) => s + (Number(it.price) || 0) * (it.qty || 1), 0));
      fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: tfd, credentials: 'same-origin' }).catch(() => {});
    } catch {}

    // Custom React checkout page (admin toggle)
    if (settings.enable_custom_checkout !== false && settings.enable_custom_checkout !== 0 && settings.enable_custom_checkout !== '0') {
      setCartOpen(false);
      setCheckoutOpen(true);
      return;
    }

    // Fallback: sync to WooCommerce checkout URL
    setCheckoutBusy(true);
    try {
      const fd = new FormData();
      fd.append('action', 'scraper_wc_sync_and_checkout');
      fd.append('nonce', ajax.cartNonce || '');
      fd.append('items', JSON.stringify(cart.map((it) => ({
        id: it.id,
        title: it.title,
        price: it.price,
        qty: it.qty || 1,
        image: it.image || '',
      }))));
      const res = await fetch(ajax.ajaxUrl || '/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      const url = data?.data?.checkout_url || data?.data?.url || ajax.checkoutUrl;
      if (url) window.location.href = url;
      else toast('آدرس تسویه در دسترس نیست', 'err');
    } catch {
      if (ajax.checkoutUrl) window.location.href = ajax.checkoutUrl;
      else toast('خطا در اتصال به تسویه', 'err');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const stickyOn = settings.sticky_header !== false && settings.sticky_header !== 0 && settings.sticky_header !== '0';

  const amazing = useMemo(
    () => products.filter((x) => x.has_discount).slice(0, 16),
    [products],
  );

  const bestsellers = useMemo(() => {
    return [...products]
      .map((p) => ({ p, s: productVisualMeta(p).sold }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((x) => x.p);
  }, [products]);

  const newest = useMemo(() => {
    /* آخرین آیتم‌های کاتالوگ به‌عنوان تازه‌ها */
    return products.slice(-12).reverse();
  }, [products]);

  const liveSuggestions = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q || q.length < 1) return [];
    return products.filter((p) => productMatchesQuery(p, q)).slice(0, 8);
  }, [products, query]);

  useEffect(() => {
    const onDoc = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchFocus(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div
      className={`sf-app${checkoutOpen ? ' is-checkout' : ''}${scrolled ? ' is-scrolled' : ''}${productPage ? ' is-pdp' : ''}`}
      data-palette={palette}
      data-template={template}
      style={{ ['--sf-accent']: accent }}
    >
      <ToastHost toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />

      {settings.show_top_bar !== false ? (
        <div className="sf-topbar">
          <div className="sf-container sf-topbar-inner">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sf-topbar-live"><span className="dot" />ارسال سریع</span>
              <span>{settings.top_bar_notice || 'ارسال سریع و تضمین اصالت کالا'}</span>
            </div>
            <div className="sf-topbar-links">
              {settings.support_hours ? <span>🕒 {settings.support_hours}</span> : null}
              {settings.contact_phone ? <a href={`tel:${settings.contact_phone}`}>📞 {settings.contact_phone}</a> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className={`sf-header-wrap ${scrolled ? 'is-compact' : ''}`} style={stickyOn ? undefined : { position: 'relative', top: 'auto' }}>
        <div className="sf-container">
          <header className="sf-header" ref={megaRef}>
            <div className="sf-header-main">
              <a className="sf-brand" href="#" onClick={(e) => { e.preventDefault(); closeProduct(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="sf-brand-logo" aria-hidden>د</div>
                <div className="sf-brand-info">
                  <h1>{settings.shop_title || 'فروشگاه آنلاین'}</h1>
                  <p>{settings.shop_subtitle || ''}</p>
                  <div className="sf-chips">
                    <span className="sf-chip live">● آنلاین</span>
                  </div>
                </div>
              </a>

              <div className={`sf-search ${searchFocus || searchOpen ? 'is-open' : 'is-collapsed'}`} ref={searchRef}>
                <button
                  type="button"
                  className="sf-search-toggle"
                  aria-label={searchOpen || searchFocus ? 'بستن جستجو' : 'باز کردن جستجو'}
                  aria-expanded={searchOpen || searchFocus}
                  title="جستجو"
                  onClick={() => {
                    if (searchOpen || searchFocus) {
                      setSearchOpen(false);
                      setSearchFocus(false);
                    } else {
                      setSearchOpen(true);
                      setSearchFocus(true);
                      requestAnimationFrame(() => {
                        try { searchRef.current?.querySelector('input')?.focus(); } catch (e) {}
                      });
                    }
                  }}
                >
                  <span className="ico" aria-hidden>🔍</span>
                </button>
                <div className="sf-search-panel">
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setPage(1); }}
                  onFocus={() => { setSearchFocus(true); setSearchOpen(true); }}
                  onBlur={() => {
                    // allow click on dropdown items
                    setTimeout(() => {
                      try {
                        if (searchRef.current && !searchRef.current.contains(document.activeElement)) {
                          if (!query.trim()) { setSearchFocus(false); setSearchOpen(false); }
                        }
                      } catch (e) {}
                    }, 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setSearchOpen(false);
                      setSearchFocus(false);
                      document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                      setSearchFocus(false);
                      setQuery('');
                    }
                  }}
                  placeholder="جستجو در کالاها، برندها و دسته‌ها..."
                  aria-label="جستجوی محصولات"
                  aria-autocomplete="list"
                  aria-expanded={searchOpen && !!query}
                  autoComplete="off"
                  tabIndex={(searchOpen || searchFocus) ? 0 : -1}
                />
                {query ? (
                  <button type="button" className="clear" onClick={() => { setQuery(''); setSearchOpen(true); setSearchFocus(true); }} aria-label="پاک کردن">✕</button>
                ) : null}
                {searchOpen && query.trim() ? (
                  <div className="sf-search-drop" role="listbox">
                    {liveSuggestions.length ? (
                      <>
                        <div className="sf-search-drop-head">
                          <span>{toFa(liveSuggestions.length)} نتیجه</span>
                          <button type="button" onClick={() => {
                            setSearchOpen(false);
                            document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' });
                          }}>مشاهده همه</button>
                        </div>
                        {liveSuggestions.map((p) => (
                          <button
                            type="button"
                            key={`sg-${p.id}`}
                            className="sf-search-item"
                            role="option"
                            onClick={() => {
                              setSearchOpen(false);
                              openQuick(p);
                            }}
                          >
                            <span className="sf-search-thumb">
                              {p.image
                                ? <img src={p.image} alt="" loading="lazy" />
                                : <span className="ph">📦</span>}
                            </span>
                            <span className="sf-search-meta">
                              <span className="t">{p.title}</span>
                              <span className="c">{p.category || 'عمومی'}</span>
                            </span>
                            <span className="sf-search-price">
                              {p.has_discount && p.discount_pct ? (
                                <span className="disc">{toFa(p.discount_pct)}٪</span>
                              ) : null}
                              <span className="pr">{p.price_formatted || formatMoney(p.price, currency)}</span>
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="sf-search-more"
                          onClick={() => {
                            setSearchOpen(false);
                            document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          نمایش {toFa(filtered.length)} کالا در فروشگاه ←
                        </button>
                      </>
                    ) : (
                      <div className="sf-search-empty">
                        <span>نتیجه‌ای برای «{query}» پیدا نشد</span>
                        <button type="button" onClick={() => setQuery('')}>پاک کردن جستجو</button>
                      </div>
                    )}
                  </div>
                ) : null}
                </div>
              </div>

              <div className="sf-actions">
                <button type="button" className={`sf-burger-btn ${menuOpen ? 'is-open' : ''}`} onClick={() => setMenuOpen(true)} aria-label="باز کردن منو" title="منو">
                  <span className="sf-burger-ico" aria-hidden><i /><i /><i /></span>
                  <span className="sf-burger-lbl">منو</span>
                </button>
                <a className="sf-action-btn sf-action-account" href={boot.urls?.account || '#'} aria-label="حساب کاربری">
                  <span className="sf-action-ico" aria-hidden>👤</span>
                  <span className="lbl">حساب</span>
                </a>
                <button type="button" className="sf-action-btn cart" onClick={() => setCartOpen(true)} aria-label="سبد خرید">
                  <span className="sf-action-ico" aria-hidden>🛒</span>
                  <span className="lbl">سبد</span>
                  {cartCount > 0 ? <span className="sf-badge">{toFa(cartCount)}</span> : null}
                </button>
                {boot.urls?.admin ? (
                  <a className="sf-action-btn sf-action-admin" href={boot.urls.admin} aria-label="مدیریت"><span className="sf-action-ico">⚙️</span></a>
                ) : null}
              </div>
            </div>

            <nav className="sf-nav" aria-label="منوی اصلی">
              <div className="sf-nav-links">
                <button
                  type="button"
                  className="sf-nav-btn"
                  onClick={(e) => { e.stopPropagation(); setMegaOpen((v) => !v); }}
                >
                  ☰ دسته‌بندی کالاها ▾
                </button>
                <button type="button" className={`sf-nav-link ${cat === 'all' && !query ? 'active' : ''}`} onClick={() => { setCat('all'); setQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>🏠 صفحه اصلی</button>
                <button type="button" className="sf-nav-link" onClick={() => document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' })}>
                  🛍️ همه محصولات ({toFa(catalogTotal)})
                </button>
                <button type="button" className="sf-nav-link" onClick={() => { setSort('price-asc'); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}>
                  🔥 پیشنهادهای اقتصادی
                </button>
                {settings.contact_phone ? (
                  <a className="sf-nav-link" href={`tel:${settings.contact_phone}`}>📞 تماس با ما</a>
                ) : null}
              </div>
              <div className="sf-nav-status" aria-hidden="true" />

              {megaOpen ? (
                <div className="sf-mega">
                  <div style={{ padding: '6px 10px', fontWeight: 800, fontSize: '.82rem', color: '#64748b' }}>دسته‌بندی‌های کالا</div>
                  <button type="button" className={`sf-mega-item ${cat === 'all' ? 'active' : ''}`} onClick={() => { setCat('all'); setMegaOpen(false); }}>
                    <span>همه دسته‌ها</span>
                    <span className="sf-mega-count">{toFa(catalogTotal)}</span>
                  </button>
                  {Object.entries(categories).map(([name, count]) => (
                    <button type="button" key={name} className={`sf-mega-item ${cat === name ? 'active' : ''}`} onClick={() => { setCat(name); setMegaOpen(false); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}>
                      <span>📂 {name}</span>
                      <span className="sf-mega-count">{toFa(count)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </nav>
            <div className="sf-progress" aria-hidden><span style={{ width: `${progress}%` }} /></div>
          </header>
        </div>
      </div>

      <main className="sf-container sf-home-dense">
        <section className="sf-hero sf-hero-rich" aria-label="بنر فروشگاه">
          <div className="sf-hero-content">
            <div className="sf-hero-kicker">ویترین آنلاین · ارسال سراسری</div>
            <h2>{settings.shop_title || 'فروشگاه آنلاین'}</h2>
            <p>{settings.shop_subtitle || 'خرید مطمئن با ارسال سریع، ضمانت اصالت و بهترین قیمت'}</p>
            {settings.show_features_banner !== false ? (
              <div className="sf-hero-features">
                <div className="sf-hero-feature">🚚 ارسال سریع</div>
                <div className="sf-hero-feature">✅ ضمانت اصالت</div>
                <div className="sf-hero-feature">↩️ ۷ روز بازگشت</div>
                <div className="sf-hero-feature">💬 پشتیبانی</div>
                <div className="sf-hero-feature">💳 پرداخت امن</div>
                <div className="sf-hero-feature">⭐ {toFa(catalogTotal || 0)}+ کالا</div>
              </div>
            ) : null}
            <div className="sf-hero-cta">
              <button type="button" className="sf-btn primary" onClick={() => document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' })}>مشاهده محصولات</button>
              <button type="button" className="sf-btn ghost light" onClick={() => { setSort('price-asc'); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}>ارزان‌ترین‌ها</button>
            </div>
          </div>
          <div className="sf-hero-side" aria-hidden>
            <div className="sf-hero-badge">
              <div className="big">{toFa(catalogTotal || 0)}+</div>
              <div className="sub">کالای آماده ارسال</div>
            </div>
            <div className="sf-hero-mini-stats">
              <div><b>{toFa(Object.keys(categories).length || 0)}</b><span>دسته</span></div>
              <div><b>{toFa(amazing.length || 0)}</b><span>تخفیف‌دار</span></div>
              <div><b>۲۴/۷</b><span>پشتیبانی</span></div>
            </div>
          </div>
        </section>

        {Object.keys(categories).length ? (
          <section className="sf-cat-showcase" aria-label="دسته‌بندی‌ها">
            <div className="sf-sec-head">
              <h2>خرید بر اساس دسته‌بندی</h2>
              <button type="button" className="sf-linkish" onClick={() => setCat('all')}>همه دسته‌ها</button>
            </div>
            <div className="sf-cat-showcase-grid">
              {Object.entries(categories).slice(0, 12).map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  className={`sf-cat-tile ${cat === name ? 'on' : ''}`}
                  onClick={() => { setCat(name); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}
                >
                  <span className="ic">{catIcon(name)}</span>
                  <span className="nm">{name}</span>
                  <span className="ct">{toFa(count)} کالا</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {amazing.length ? (
          <section className="sf-amazing" aria-label="پیشنهاد شگفت‌انگیز">
            <div className="sf-amazing-head">
              <div className="title">
                <span>🔥</span>
                <span>پیشنهاد شگفت‌انگیز</span>
                <span className="sf-amazing-sub">{toFa(amazing.length)} کالا با تخفیف ویژه</span>
              </div>
              <div className="sf-timer" style={{ background: 'transparent' }}>
                <span>{toFa(timer.h)}</span>
                <span style={{ color: '#fff', background: 'transparent', minWidth: 0, padding: 0 }}>:</span>
                <span>{toFa(timer.m)}</span>
                <span style={{ color: '#fff', background: 'transparent', minWidth: 0, padding: 0 }}>:</span>
                <span>{toFa(timer.s)}</span>
              </div>
            </div>
            <div className="sf-amazing-scroller">
              {amazing.map((p) => {
                const m = productVisualMeta(p);
                return (
                <button
                  type="button"
                  key={`amz-${p.id}`}
                  className="sf-amazing-card sf-amazing-card-rich"
                  onClick={() => openProduct(p)}
                >
                  {p.has_discount && p.discount_pct ? <span className="sf-amz-disc">{toFa(p.discount_pct)}٪</span> : null}
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div style={{ height: 118, display: 'grid', placeItems: 'center', fontSize: '2rem', background: '#fafafa' }}>📦</div>}
                  <div className="body">
                    <div className="t">{p.title}</div>
                    <div className="meta"><StarRow rating={m.stars} /> <span>{toFa(m.sold)}+</span></div>
                    {p.old_price || p.old_price_formatted ? (
                      <div className="old">{p.old_price_formatted || formatMoney(p.old_price, currency)}</div>
                    ) : null}
                    <div className="pr">{p.price_formatted || formatMoney(p.price, currency)}</div>
                  </div>
                </button>
              );})}
            </div>
          </section>
        ) : (
          <div className="sf-flash">
            <div>⚡ پیشنهادهای ویژه امروز — {toFa(catalogTotal)} کالا در ویترین</div>
            <div className="sf-timer">
              <span>{toFa(timer.h)}</span>:
              <span>{toFa(timer.m)}</span>:
              <span>{toFa(timer.s)}</span>
            </div>
          </div>
        )}

        {bestsellers.length ? (
          <section className="sf-rail" aria-label="پرفروش‌ترین‌ها">
            <div className="sf-sec-head">
              <h2>🏆 پرفروش‌ترین‌ها</h2>
              <button type="button" className="sf-linkish" onClick={() => { setSort('default'); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}>مشاهده همه</button>
            </div>
            <div className="sf-rail-scroller">
              {bestsellers.map((p) => {
                const m = productVisualMeta(p);
                return (
                  <button type="button" key={`bs-${p.id}`} className="sf-rail-card" onClick={() => openProduct(p)}>
                    {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="ph">📦</div>}
                    <div className="body">
                      <div className="t">{p.title}</div>
                      <div className="meta"><StarRow rating={m.stars} /> <span>{toFa(m.sold)} فروش</span></div>
                      <div className="pr">{p.price_formatted || formatMoney(p.price, currency)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {newest.length ? (
          <section className="sf-rail sf-rail-new" aria-label="تازه‌ها">
            <div className="sf-sec-head">
              <h2>✨ تازه‌های ویترین</h2>
              <span className="sf-sec-tag">جدید</span>
            </div>
            <div className="sf-rail-scroller">
              {newest.map((p) => (
                <button type="button" key={`nw-${p.id}`} className="sf-rail-card" onClick={() => openProduct(p)}>
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="ph">📦</div>}
                  <div className="body">
                    <div className="t">{p.title}</div>
                    <div className="pr">{p.price_formatted || formatMoney(p.price, currency)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {settings.show_features_banner !== false ? (
          <div className="sf-trust sf-trust-rich">
            <div className="sf-trust-item"><span className="ic">🚚</span><div><b>ارسال سریع</b><span>سراسر کشور</span></div></div>
            <div className="sf-trust-item"><span className="ic">🛡️</span><div><b>ضمانت اصالت</b><span>کالای اصل</span></div></div>
            <div className="sf-trust-item"><span className="ic">↩️</span><div><b>۷ روز بازگشت</b><span>بدون دردسر</span></div></div>
            <div className="sf-trust-item"><span className="ic">💳</span><div><b>پرداخت امن</b><span>درگاه معتبر</span></div></div>
            <div className="sf-trust-item"><span className="ic">💬</span><div><b>پشتیبانی</b><span>آنلاین ۲۴/۷</span></div></div>
            <div className="sf-trust-item"><span className="ic">📦</span><div><b>بسته‌بندی</b><span>ایمن و مرتب</span></div></div>
          </div>
        ) : null}

        {settings.show_animated_stats !== false ? (
          <div className="sf-kpis sf-kpis-rich">
            <div className="sf-kpi"><div className="n">{toFa(catalogTotal || 0)}</div><div className="l">کالای متنوع</div></div>
            <div className="sf-kpi"><div className="n">{toFa(Object.keys(categories).length || 0)}</div><div className="l">دسته‌بندی</div></div>
            <div className="sf-kpi"><div className="n">{toFa(amazing.length || 0)}</div><div className="l">پیشنهاد ویژه</div></div>
            <div className="sf-kpi"><div className="n">{toFa(Object.keys(wish || {}).filter((k) => wish[k]).length)}</div><div className="l">علاقه‌مندی شما</div></div>
            <div className="sf-kpi"><div className="n">{toFa(cart.length)}</div><div className="l">در سبد</div></div>
            <div className="sf-kpi"><div className="n">۲۴/۷</div><div className="l">پشتیبانی</div></div>
          </div>
        ) : null}

        <div className="sf-promo-strip" aria-hidden>
          <span>🎁</span>
          <span>با خرید بالای {formatMoney(settings.free_shipping_threshold || 400000, currency)} ارسال رایگان بگیرید</span>
          <span>⚡ موجودی محدود برخی کالاها</span>
          <span>✅ تضمین بهترین تجربه خرید</span>
        </div>

        <div className="sf-toolbar" id="sfProducts">
          <h3>
            {cat === 'all' ? 'همه محصولات' : cat}
            <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '.9rem' }}> ({toFa(filtered.length)}{catalogTotal > filtered.length ? ` از ${toFa(catalogTotal)}` : ''})</span>
          </h3>
          <div className="sf-toolbar-controls">
            <select className="sf-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="default">مرتب‌سازی پیش‌فرض</option>
              <option value="price-asc">ارزان‌ترین</option>
              <option value="price-desc">گران‌ترین</option>
              <option value="title">بر اساس نام</option>
              <option value="popular">پرفروش‌ترین</option>
              <option value="discount">بیشترین تخفیف</option>
            </select>
            {['2', '3', '4', '5'].map((c) => (
              <button key={c} type="button" className={`sf-col-btn ${cols === c ? 'active' : ''}`} onClick={() => setCols(c)} title={`${c} ستونه`}>
                {toFa(c)}
              </button>
            ))}
          </div>
        </div>

        <div className="sf-cat-pills">
          <button type="button" className={`sf-pill ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>همه ({toFa(catalogTotal)})</button>
          {Object.entries(categories).map(([name, count]) => (
            <button key={name} type="button" className={`sf-pill ${cat === name ? 'active' : ''}`} onClick={() => setCat(name)}>{catIcon(name)} {name} <em>{toFa(count)}</em></button>
          ))}
        </div>

        <div className={`sf-grid sf-grid-dense cols-${cols}`}>
          {pageItems.length ? pageItems.map((p, idx) => (
            <React.Fragment key={p.id || idx}>
              <ProductCard
                p={p}
                cols={cols}
                currency={currency}
                wish={!!wish[p.id]}
                onWish={toggleWish}
                onOpen={openProduct}
                onAdd={addToCart}
                onAsk={askAboutProduct}
                showSpecial={!!settings.show_special_badge}
                ajax={ajax}
                onImageFix={fixProductImage}
                aiImages={settings.enable_ai_product_images !== false}
              />
              {((idx + 1) % 8 === 0 && idx + 1 < pageItems.length) ? (
                <div className="sf-grid-banner" key={`bn-${idx}`}>
                  <div className="sf-grid-banner-inner">
                    <strong>🔥 پیشنهاد لحظه‌ای</strong>
                    <span>تخفیف‌های امروز را از دست ندهید — ارسال سریع فعال است</span>
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          )) : (
            <div className="sf-empty">
              <div style={{ fontSize: '3rem' }}>🔍</div>
              <h4>کالایی یافت نشد</h4>
              <p>عبارت جستجو یا فیلتر دسته‌بندی را تغییر دهید.</p>
              <button type="button" className="sf-btn ghost" onClick={() => { setQuery(''); setCat('all'); }}>نمایش همه محصولات</button>
            </div>
          )}
        </div>

        {totalPages > 1 ? (
          <div className="sf-pagination">
            <button type="button" className="sf-page-btn" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>« قبلی</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - pageSafe) <= 2)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) => (
                typeof p === 'number' ? (
                  <button key={p} type="button" className={`sf-page-btn ${p === pageSafe ? 'active' : ''}`} onClick={() => { setPage(p); document.getElementById('sfProducts')?.scrollIntoView({ behavior: 'smooth' }); }}>
                    {toFa(p)}
                  </button>
                ) : <span key={`e${i}`} style={{ padding: '0 6px', color: '#94a3b8', fontWeight: 800 }}>…</span>
              ))}
            <button type="button" className="sf-page-btn" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>بعدی »</button>
          </div>
        ) : null}
      </main>

      <footer className="sf-footer">
        <div className="sf-container sf-footer-grid">
          <div>
            <h4>{settings.shop_title || 'فروشگاه'}</h4>
            <p>{settings.shop_subtitle || 'خرید آنلاین مطمئن با ارسال سریع'}</p>
          </div>
          <div>
            <h4>دسترسی سریع</h4>
            <ul>
              <li><a href="#" onClick={(e) => { e.preventDefault(); setCat('all'); }}>همه محصولات</a></li>
              <li><a href={boot.urls?.account || '#'}>حساب کاربری</a></li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); setCartOpen(true); }}>سبد خرید</a></li>
            </ul>
          </div>
          <div>
            <h4>پشتیبانی</h4>
            <ul>
              {settings.contact_phone ? <li><a href={`tel:${settings.contact_phone}`}>{settings.contact_phone}</a></li> : null}
              {settings.support_hours ? <li>{settings.support_hours}</li> : null}
              <li>ارسال سریع سراسر کشور</li>
            </ul>
            <a className="sf-enamad" referrerPolicy="origin" target="_blank" rel="noopener" href="https://trustseal.enamad.ir/?id=637385&Code=bnNb0MoEa3Q7iSDVU6VNxRZ84zr4WWRv" aria-label="مشاهده نماد اعتماد الکترونیکی">
              <img referrerPolicy="origin" src="https://trustseal.enamad.ir/logo.aspx?id=637385&Code=bnNb0MoEa3Q7iSDVU6VNxRZ84zr4WWRv" alt="نماد اعتماد الکترونیکی" style={{ cursor: 'pointer' }} code="bnNb0MoEa3Q7iSDVU6VNxRZ84zr4WWRv" />
            </a>
          </div>
        </div>
        <div className="sf-copy">
          <span>© {toFa(new Date().getFullYear())} {settings.shop_title || 'فروشگاه'} · تمامی حقوق محفوظ است</span>
          <span className="sf-ver" title="نسخه افزونه و فایل‌های ویترین">
            v{meta.version || '—'}
            {meta.asset_ver ? ` · فایل ${meta.asset_ver}` : ''}
          </span>
        </div>
      </footer>

      <nav className="sf-mob-bar" aria-label="منوی موبایل">
        <button type="button" className="sf-mob-item active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="sf-mob-icon-wrap"><MobileNavIcon name="home" /></span><span>خانه</span>
        </button>
        <button type="button" className="sf-mob-item sf-mob-menu" onClick={() => setMenuOpen(true)}>
          <span className="sf-mob-icon-wrap"><MobileNavIcon name="menu" /></span><span>منو</span>
        </button>
        <button type="button" className="sf-mob-item" onClick={() => setCartOpen(true)}>
          <span className="sf-mob-icon-wrap"><MobileNavIcon name="cart" /></span><span>سبد</span>
          {cartCount > 0 ? <span className="sf-badge">{toFa(cartCount)}</span> : null}
        </button>
        <a className="sf-mob-item" href={boot.urls?.account || '#'}>
          <span className="sf-mob-icon-wrap"><MobileNavIcon name="account" /></span><span>حساب</span>
        </a>
      </nav>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cart}
        currency={currency}
        onQty={setQty}
        onRemove={(id) => setCart((c) => c.filter((x) => x.id !== id))}
        onCheckout={checkout}
        busy={checkoutBusy}
        freeShip={settings.free_shipping_threshold}
      />
      <CheckoutPage
        open={checkoutOpen}
        onClose={() => { setCheckoutOpen(false); setCheckoutDoneSeed(null); }}
        items={cart}
        currency={currency}
        settings={settings}
        ajax={ajax}
        gateways={boot.gateways || []}
        onQty={setQty}
        onRemove={(id) => setCart((c) => c.filter((x) => x.id !== id))}
        onClearCart={() => setCart([])}
        toast={toast}
        initialDone={checkoutDoneSeed}
      />
      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        settings={settings}
        categories={categories}
        onCat={setCat}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        accountUrl={boot.urls?.account || '#'}
        adminUrl={boot.urls?.admin || ''}
      />
      {productPage ? (
        <ProductPage
          product={productPage}
          currency={currency}
          ajax={ajax}
          onClose={closeProduct}
          onAdd={addToCart}
          onAsk={askAboutProduct}
          onCheckout={() => { setCheckoutOpen(true); setCartOpen(false); }}
          related={products.filter((x) => (x.category || 'عمومی') === (productPage.category || 'عمومی') || x.has_discount).slice(0, 10)}
          freeShip={settings.free_shipping_threshold}
          onOpenRelated={(rp) => openProduct(rp)}
        />
      ) : null}
      <QuickView
        product={quick}
        currency={currency}
        ajax={ajax}
        onClose={() => setQuick(null)}
        onAdd={addToCart}
        onAsk={askAboutProduct}
        onCheckout={() => { setCheckoutOpen(true); setCartOpen(false); }}
      />
      <SupportChat
        settings={settings}
        ajax={ajax}
        productCtx={chatProduct}
        openSignal={chatSignal}
        onClearProduct={() => setChatProduct(null)}
      />
    </div>
  );
}

function ChatOnlyApp({ boot }) {
  const settings = (boot && boot.settings) || {};
  const ajax = (boot && boot.ajax) || {};
  if (!settings.enable_support_chat) return null;
  return (
    <SupportChat
      settings={settings}
      ajax={ajax}
      productCtx={null}
      openSignal={0}
      onClearProduct={() => {}}
    />
  );
}

function mount() {
  try {
    const boot = (typeof window !== 'undefined' && window.AMPHP_STOREFRONT) ? window.AMPHP_STOREFRONT : {};
    const chatOnly = !!(boot && (boot.mode === 'chat-only' || boot.chat_only));
    const el = document.getElementById(chatOnly ? 'amphp-support-chat-root' : 'amphp-storefront-root')
      || document.getElementById('amphp-storefront-root')
      || document.getElementById('amphp-support-chat-root');
    if (!el) {
      if (!chatOnly) console.error('[AMPHP] #amphp-storefront-root not found');
      return;
    }
    if (el.getAttribute('data-mounted') === '1') return;
    const root = createRoot(el);
    if (chatOnly || el.id === 'amphp-support-chat-root') {
      root.render(<ChatOnlyApp boot={boot} />);
    } else {
      root.render(<StoreApp boot={boot} />);
    }
    el.setAttribute('data-mounted', '1');
    try { el.querySelector('.amphp-sf-bootwait')?.remove(); } catch (_) {}
  } catch (err) {
    console.error('[AMPHP] mount failed', err);
    const el = document.getElementById('amphp-storefront-root') || document.getElementById('amphp-support-chat-root');
    if (el) {
      el.innerHTML = '<div style="padding:24px;text-align:center;font-family:Tahoma,sans-serif;color:#b91c1c;font-weight:800;line-height:1.7">خطا در اجرای فروشگاه<br><span style="font-size:.8rem;font-weight:600;color:#64748b">' + String(err && err.message || err) + '</span></div>';
    }
  }
}

function scheduleMount() {
  const run = () => mount();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  // Extra safety for late boot injection
  setTimeout(run, 50);
  setTimeout(run, 300);
}

scheduleMount();

export default StoreApp;
