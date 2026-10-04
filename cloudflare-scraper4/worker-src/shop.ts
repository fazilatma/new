/**
 * Storefront pages (Persian, RTL). Server rendered HTML + ONE external script, because the
 * dashboard security headers allow script-src 'self' only — an inline shop script would be
 * blocked exactly like the visual picker was.
 *
 * Mobile is the primary target: 44px tap targets, a two column grid down to 320px, a sticky
 * cart bar, no horizontal overflow and no hover-only affordances.
 */
import { PAYMENT_PLUGINS, type PaymentSettings } from './payments.js';
import { DEFAULT_APPEARANCE, fa, money, type Order, type OrderTotals, type ShopSettings, type ShowcaseItem } from './shop-core.js';

export const SHOP_SCRIPT_PATH = '/shop.js';

/**
 * Every storefront link is RELATIVE to the app root (a <base> element carries settings.basePath),
 * and no link goes one level deeper than that root: pages are selected with query parameters.
 */
export const HOME_URL = './';
export function shopUrl(params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `./?${text}` : HOME_URL;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const STYLE = String.raw`
:root{
  --bg:#070b17;--bg2:#0b1222;--card:#121b33;--line:#22304f;--line2:#2d3c60;
  --text:#eef3ff;--muted:#9eb0d6;--brand:#34d399;--brand-ink:#04281a;--accent:#60a5fa;--warn:#fbbf24;--bad:#f87171;
  --radius:18px;--tap:44px;--shadow:0 14px 34px rgba(3,7,18,.45);
  --font:Vazirmatn,Vazir,Tahoma,system-ui,-apple-system,sans-serif;--fsize:14px
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;background:
  radial-gradient(90% 60% at 100% -10%,rgba(52,211,153,.13),transparent 62%),
  radial-gradient(80% 55% at 0% 0%,rgba(96,165,250,.12),transparent 60%),
  linear-gradient(180deg,#070b17,#0a1020 40%,#070b17) fixed;color:var(--text);
  font-family:var(--font);direction:rtl;line-height:1.9;
  font-size:var(--fsize);padding-bottom:env(safe-area-inset-bottom)}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font-family:inherit;font-size:var(--fsize);color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skip{position:absolute;right:-9999px;top:0}.skip:focus{right:8px;top:8px;background:var(--brand);color:var(--brand-ink);padding:8px 12px;border-radius:10px;z-index:99}

/* ---------- header ---------- */
.head{position:sticky;top:0;z-index:20;background:rgba(7,11,23,.86);backdrop-filter:blur(14px) saturate(140%);border-bottom:1px solid var(--line);box-shadow:0 10px 30px rgba(3,7,18,.35)}
.head-in{max-width:1200px;margin:0 auto;padding:10px 14px;display:flex;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;white-space:nowrap}
.brand .dot{width:26px;height:26px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--accent));display:grid;place-items:center;color:var(--brand-ink);font-size:14px}
.head form.search{flex:1 1 auto;display:flex;gap:6px;min-width:0}
.head form.search input{flex:1 1 auto;min-width:0;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:0 12px;height:var(--tap)}
.nav{display:flex;align-items:center;gap:6px}
.iconbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--tap);min-width:var(--tap);
  padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg2);cursor:pointer;white-space:nowrap}
.iconbtn.primary{background:var(--brand);color:var(--brand-ink);border-color:transparent;font-weight:800}
.badge-count{background:var(--brand);color:var(--brand-ink);border-radius:999px;padding:0 7px;font-size:11px;font-weight:800;min-width:20px;text-align:center}
.badge-count[data-empty="1"]{background:var(--line2);color:var(--muted)}

/* ---------- layout ---------- */
.wrap{max-width:1200px;margin:0 auto;padding:16px 14px 28px}
.hero{position:relative;overflow:hidden;background:
  radial-gradient(120% 140% at 100% 0,rgba(52,211,153,.2),transparent 60%),
  radial-gradient(90% 120% at 0% 100%,rgba(96,165,250,.16),transparent 60%),var(--card);
  border:1px solid var(--line);border-radius:22px;padding:22px;margin-bottom:18px;box-shadow:var(--shadow)}
.hero::after{content:"";position:absolute;inset-inline-end:-40px;top:-60px;width:180px;height:180px;border-radius:50%;
  background:radial-gradient(circle,rgba(52,211,153,.22),transparent 70%);pointer-events:none}
.hero h1{margin:0 0 6px;font-size:19px}
.hero p{margin:0;color:var(--muted);font-size:13px}
.hero .stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--muted)}
.hero .stats b{color:var(--text)}
.chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--bg2);border-radius:999px;padding:0 14px;height:38px;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.chip.on{background:var(--brand);color:var(--brand-ink);border-color:transparent;font-weight:700}
.toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
.toolbar .count{color:var(--muted);font-size:12px}
.sortbox{display:flex;align-items:center;gap:6px}
.sortbox select{background:var(--bg2);border:1px solid var(--line);border-radius:12px;height:var(--tap);padding:0 10px}

/* ---------- product grid ---------- */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.pcard{background:linear-gradient(180deg,rgba(255,255,255,.04),transparent 45%),var(--card);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.pcard:hover,.pcard:focus-within{transform:translateY(-3px);border-color:var(--line2);box-shadow:0 18px 40px rgba(3,7,18,.55)}
.pcard .thumb img{transition:transform .35s ease}
.pcard:hover .thumb img{transform:scale(1.04)}
.pcard .thumb{position:relative;display:block;aspect-ratio:1/1;background:var(--bg2)}
.pcard .thumb img{width:100%;height:100%;object-fit:cover}
.pcard .thumb .ph{width:100%;height:100%;display:grid;place-items:center;color:var(--line2);font-size:34px}
.pcard .off{position:absolute;inset-inline-start:8px;top:8px;background:var(--warn);color:#271a00;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800}
.pcard .body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px;flex:1}
.pcard h3{margin:0;font-size:13px;font-weight:600;line-height:1.75;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em}
.tagrow{display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag.profile{border-color:#2a3f73;color:var(--accent)}
.tag.adj{border-color:#473518;color:var(--warn)}
.prices{margin-top:auto;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.base{color:var(--muted);font-size:11px;text-decoration:line-through}
.final{color:var(--brand);font-weight:800;font-size:16px;letter-spacing:.2px}
.unit{font-size:11px;color:var(--muted)}
.add{width:100%;min-height:var(--tap);border-radius:12px;border:1px solid transparent;background:linear-gradient(135deg,var(--brand),#22c7a9);
  color:var(--brand-ink);font-weight:800;cursor:pointer;box-shadow:0 8px 20px rgba(52,211,153,.2)}
.add[data-state="in"]{background:var(--bg2);color:var(--brand);border-color:var(--brand)}

/* ---------- panels, tables, forms ---------- */
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:14px}
.panel h2{margin:0 0 12px;font-size:15px;display:flex;align-items:center;gap:8px}
.cols{display:grid;grid-template-columns:1.4fr .9fr;gap:14px;align-items:start}
.sticky{position:sticky;top:76px}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.field label{font-size:12px;color:var(--muted)}
.field input,.field textarea,.field select{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-height:var(--tap);width:100%}
.field textarea{min-height:96px;resize:vertical}
.field.bad input,.field.bad textarea{border-color:var(--bad)}
.field .err{color:var(--bad);font-size:11px;min-height:0}
table.sum{width:100%;border-collapse:collapse;font-size:13px}
table.sum th,table.sum td{border-bottom:1px solid var(--line);padding:10px 6px;text-align:start;vertical-align:middle}
table.sum tfoot td{border-bottom:none}
.scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pay-list{display:grid;gap:10px}
.pay{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--bg2);cursor:pointer;min-height:var(--tap)}
.pay:has(input:checked){border-color:var(--brand);box-shadow:0 0 0 1px var(--brand) inset}
.pay input{margin-top:6px;width:18px;height:18px;accent-color:var(--brand)}
.pay b{font-size:13px}.pay small{display:block;color:var(--muted);font-size:11px;line-height:1.8}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--tap);padding:0 16px;border-radius:12px;
  border:1px solid var(--line);background:var(--bg2);cursor:pointer}
.btn.primary{background:linear-gradient(135deg,var(--brand),#22c7a9);color:var(--brand-ink);border-color:transparent;font-weight:800;box-shadow:0 10px 24px rgba(52,211,153,.22)}
.btn:hover{border-color:var(--line2)}
.btn.block{width:100%}
.btn[disabled]{opacity:.6;cursor:progress}
.note{color:var(--muted);font-size:12px;line-height:2}
.ok{color:var(--brand)}.bad{color:var(--bad)}
.empty{color:var(--muted);text-align:center;padding:42px 12px;font-size:13px}
.statusline{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)}
.pill{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:11px}
.pill.paid{border-color:var(--brand);color:var(--brand)}
.pill.failed{border-color:var(--bad);color:var(--bad)}
.pager{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:20px 0 0}
.pager a{min-width:var(--tap);min-height:var(--tap);display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;background:var(--bg2);padding:0 10px}
.pager a.on{background:var(--brand);color:var(--brand-ink);border-color:transparent;font-weight:800}
.crumbs{font-size:12px;color:var(--muted);margin-bottom:10px}
.gallery{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
.gallery img{width:74px;height:74px;object-fit:cover;border-radius:12px;border:1px solid var(--line);flex:0 0 auto}
.product-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.product-top .shot{background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;aspect-ratio:1/1}
.product-top .shot img{width:100%;height:100%;object-fit:contain}

/* ---------- footer ---------- */
.foot{border-top:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.02),transparent),var(--bg2);margin-top:26px;padding:22px 14px calc(26px + env(safe-area-inset-bottom))}
.foot-in{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:18px}
.foot h4{margin:0 0 10px;font-size:13px}
.foot ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.foot li{color:var(--muted);font-size:12px}
.footnav{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:0 10px;border:1px solid transparent;border-radius:12px;
  background:transparent;color:var(--muted);font-size:12px;cursor:pointer;text-align:start}
.footnav:hover,.footnav:focus-visible{color:var(--text);border-color:var(--line);background:rgba(255,255,255,.03)}
.footnav[aria-current="page"]{color:var(--brand);border-color:var(--line)}
.footinfo{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02);margin-bottom:6px}
.footinfo>summary{list-style:none;cursor:pointer;min-height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;font-size:12px;color:var(--muted)}
.footinfo>summary::-webkit-details-marker{display:none}
.footinfo>summary::after{content:"＋";margin-inline-start:auto;color:var(--line2)}
.footinfo[open]>summary{color:var(--text)}
.footinfo[open]>summary::after{content:"−"}
.footinfo p{margin:0;padding:0 10px 10px;font-size:11.5px;color:var(--muted);line-height:2}
.foot .about{color:var(--muted);font-size:12px}
.copy{max-width:1200px;margin:16px auto 0;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;
  display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}

/* ---------- bottom tab bar (mobile app style) ---------- */
.tabbar{position:fixed;inset-inline:0;bottom:0;z-index:40;display:none;background:rgba(9,14,27,.97);
  border-top:1px solid var(--line);backdrop-filter:blur(10px);padding-bottom:env(safe-area-inset-bottom)}
.tabbar ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,1fr)}
.tabbar a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  min-height:58px;font-size:10px;color:var(--muted);position:relative}
.tabbar a .ico{font-size:19px;line-height:1}
.tabbar a[aria-current="page"]{color:var(--brand)}
.tabbar a[aria-current="page"]::before{content:"";position:absolute;top:0;inset-inline:22%;height:2px;background:var(--brand);border-radius:0 0 4px 4px}
.tabbar .tabcount{position:absolute;top:6px;inset-inline-end:calc(50% - 22px);background:var(--brand);color:var(--brand-ink);
  border-radius:999px;font-size:10px;font-weight:800;padding:0 5px;min-width:17px;text-align:center}
.tabbar .tabcount[data-empty="1"]{display:none}
@media(max-width:900px){.tabbar{display:block}body{padding-bottom:calc(66px + env(safe-area-inset-bottom))}}

/* ---------- categories ---------- */
.catgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.catcard{position:relative;display:block;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--card);min-height:104px}
.catcard img{width:100%;height:104px;object-fit:cover;opacity:.45}
.catcard .ph{height:104px;display:grid;place-items:center;color:var(--line2);font-size:28px}
.catcard .meta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;padding:10px;
  background:linear-gradient(180deg,transparent,rgba(7,11,23,.86))}
.catcard b{font-size:13px}.catcard small{color:var(--muted);font-size:11px}

@media(max-width:900px){.cols{grid-template-columns:1fr}.sticky{position:static}.foot-in{grid-template-columns:1fr 1fr}}
@media(max-width:720px){
  .head-in{flex-wrap:wrap;padding:8px 12px;gap:8px}
  .head form.search{order:3;flex:1 0 100%}
  .nav .label{display:none}
  .wrap{padding:12px 12px 20px}
  .hero{padding:14px}.hero h1{font-size:17px}
  .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .pcard h3{font-size:12px}
  .final{font-size:14px}
  .product-top{grid-template-columns:1fr}
  table.sum th,table.sum td{padding:8px 4px;font-size:12px}
}
@media(max-width:360px){.grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const PAGES: Record<string, { title: string; body: string }> = {
  payment: { title: 'روش‌های پرداخت', body: 'پرداخت از طریق درگاه‌های فعال فروشگاه انجام می‌شود. پس از انتخاب روش پرداخت در صفحهٔ تسویه حساب، به صفحهٔ امن درگاه منتقل می‌شوید و نتیجهٔ پرداخت روی صفحهٔ سفارش نمایش داده می‌شود. در روش کارت به کارت، پس از واریز باید کد پیگیری را در صفحهٔ سفارش ثبت کنید.' },
  shipping: { title: 'ارسال و تحویل', body: 'سفارش‌ها پس از تأیید پرداخت آمادهٔ ارسال می‌شوند. هزینه و شرایط ارسال در صفحهٔ تسویه حساب و در فاکتور سفارش نمایش داده می‌شود.' },
  returns: { title: 'بازگشت کالا', body: 'در صورت مغایرت کالا با مشخصات اعلام‌شده، با شمارهٔ تماس فروشگاه هماهنگ کنید تا روند بازگشت یا تعویض انجام شود.' },
  about: { title: 'دربارهٔ ما', body: 'این فروشگاه محصولات را از منابع معتبر گردآوری می‌کند و قیمت هر کالا را به‌روز و نهایی نمایش می‌دهد.' },
  contact: { title: 'تماس با ما', body: 'برای پرسش دربارهٔ سفارش‌ها، شمارهٔ سفارش خود را آماده کنید و از راه شمارهٔ تماس درج‌شده در پانوشت با ما در ارتباط باشید.' },
  terms: { title: 'قوانین و حریم خصوصی', body: 'اطلاعات تماس و نشانی شما فقط برای پردازش و ارسال سفارش استفاده می‌شود و در اختیار اشخاص ثالث قرار نمی‌گیرد. ثبت سفارش به معنی پذیرش قوانین فروشگاه است.' }
};


function footer(settings: ShopSettings, active?: TabKey): string {
  const navButtons = (items: Array<{ tab: TabKey; url: string; label: string }>) => items.map(item =>
    `<li><button type="button" class="footnav" data-go="${escapeHtml(item.url)}"${item.tab === active ? ' aria-current="page"' : ''}>
      <span aria-hidden="true">›</span><span>${escapeHtml(item.label)}</span></button></li>`).join('');
  // Shopping guide / info are NOT links: the text is folded into the page itself, so the
  // footer never navigates one level deeper than the storefront root.
  const infoFold = (slugs: string[]) => slugs.map(slug => {
    const page = PAGES[slug];
    return page ? `<details class="footinfo" id="info-${escapeHtml(slug)}"><summary>${escapeHtml(page.title)}</summary><p>${escapeHtml(page.body)}</p></details>` : '';
  }).join('');
  return `<footer class="foot"><div class="foot-in">
  <div><h4>${escapeHtml(settings.name)}</h4><p class="about">${escapeHtml(settings.tagline)}</p>
    ${settings.contactPhone ? `<p class="about">☎ <a href="tel:${escapeHtml(settings.contactPhone)}" dir="ltr">${fa(settings.contactPhone)}</a></p>` : ''}</div>
  <div><h4>فروشگاه</h4><ul>${navButtons([
    { tab: 'home', url: HOME_URL, label: 'ویترین محصولات' },
    { tab: 'categories', url: shopUrl({ view: 'categories' }), label: 'دسته‌بندی محصولات' },
    { tab: 'cart', url: shopUrl({ view: 'checkout' }), label: 'سبد خرید و تسویه' },
    { tab: 'track', url: shopUrl({ view: 'track' }), label: 'پیگیری سفارش' }
  ])}</ul></div>
  <div><h4>راهنمای خرید</h4>${infoFold(['payment', 'shipping', 'returns'])}</div>
  <div><h4>اطلاعات</h4>${infoFold(['about', 'contact', 'terms'])}</div>
</div>
<div class="copy"><span>© ${fa(new Date().getFullYear())} ${escapeHtml(settings.name)} — همهٔ حقوق محفوظ است.</span>
<span>قیمت‌ها به‌صورت روزانه به‌روزرسانی می‌شوند.</span></div></footer>`;
}

type TabKey = 'home' | 'categories' | 'search' | 'cart' | 'track';

/** Bottom tab bar: the primary navigation on phones, mirrored by the footer menu on desktop. */
function tabbar(active?: TabKey): string {
  const tabs: Array<{ key: TabKey; href: string; icon: string; label: string; badge?: boolean }> = [
    { key: 'home', href: HOME_URL, icon: '🏠', label: 'خانه' },
    { key: 'categories', href: shopUrl({ view: 'categories' }), icon: '🗂', label: 'دسته‌بندی' },
    { key: 'search', href: shopUrl({ focus: '1' }), icon: '🔍', label: 'جست‌وجو' },
    { key: 'cart', href: shopUrl({ view: 'checkout' }), icon: '🧺', label: 'سبد خرید', badge: true },
    { key: 'track', href: shopUrl({ view: 'track' }), icon: '📦', label: 'پیگیری' }
  ];
  return `<nav class="tabbar" aria-label="منوی پایین"><ul>${tabs.map(tab => `<li><a href="${escapeHtml(tab.href)}"${tab.key === active ? ' aria-current="page"' : ''}>
    <span class="ico" aria-hidden="true">${tab.icon}</span><span>${tab.label}</span>
    ${tab.badge ? '<span class="tabcount" id="tabCartCount" data-empty="1">۰</span>' : ''}</a></li>`).join('')}</ul></nav>`;
}

/** The storefront inherits the scraper panel's font choice (same self hosted /assets/fonts route). */
function appearanceOf(settings: ShopSettings) {
  return settings.appearance && settings.appearance.family ? settings.appearance : DEFAULT_APPEARANCE;
}
function appearanceLinks(settings: ShopSettings): string {
  const sheets = [appearanceOf(settings).stylesheet, 'vazirmatn'].filter((name, index, all) => name && all.indexOf(name) === index);
  return sheets.map(name => `<link rel="stylesheet" href="assets/fonts/${escapeHtml(name)}.css">`).join('\n');
}

function layout(settings: ShopSettings, title: string, body: string, options: { search?: string; showSearch?: boolean; tab?: TabKey } = {}): string {
  const search = options.showSearch === false ? '' : `<form class="search" method="get" action="${escapeHtml(HOME_URL)}" role="search">
    <input name="q" value="${escapeHtml(options.search || '')}" placeholder="جست‌وجوی محصول…" aria-label="جست‌وجوی محصول" enterkeyhint="search">
    <button class="iconbtn" type="submit" aria-label="جست‌وجو">🔍</button></form>`;
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#070b17">
<meta name="description" content="${escapeHtml(settings.tagline)}">
<title>${escapeHtml(title)} — ${escapeHtml(settings.name)}</title>
<base href="${escapeHtml(settings.basePath || '/')}">
${appearanceLinks(settings)}
<style>${STYLE}</style>
<style>:root{--font:${appearanceOf(settings).family};--fsize:${appearanceOf(settings).scale}px}</style></head><body>
<a class="skip" href="#main">رفتن به محتوا</a>
<header class="head"><div class="head-in">
  <a class="brand" href="${escapeHtml(HOME_URL)}"><span class="dot">🛍</span><span>${escapeHtml(settings.name)}</span></a>
  ${search}
  <nav class="nav" aria-label="منوی اصلی">
    <a class="iconbtn" href="${escapeHtml(shopUrl({ view: 'track' }))}"><span aria-hidden="true">📦</span><span class="label">پیگیری سفارش</span></a>
    <a class="iconbtn primary" href="${escapeHtml(shopUrl({ view: 'checkout' }))}" id="cartLink"><span aria-hidden="true">🧺</span><span class="label">سبد</span>
      <span class="badge-count" id="cartCount" data-empty="1">۰</span></a>
  </nav>
</div></header>
<main class="wrap" id="main">${body}</main>
${footer(settings, options.tab)}
${tabbar(options.tab)}
<script src="shop.js" defer></script></body></html>`;
}

function priceBlock(item: ShowcaseItem, currency: string): string {
  const changed = item.price !== item.basePrice && item.basePrice > 0;
  return `<div class="prices">${changed ? `<span class="base">${money(item.basePrice)}</span>` : ''}` +
    `<span class="final">${money(item.price)}</span><span class="unit">${escapeHtml(currency)}</span></div>`;
}

function addButton(item: ShowcaseItem): string {
  return `<button class="add" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-price="${item.price}"
    aria-label="افزودن ${escapeHtml(item.title)} به سبد خرید">افزودن به سبد</button>`;
}

function thumb(item: ShowcaseItem): string {
  return item.image
    ? `<img loading="lazy" decoding="async" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">`
    : `<div class="ph" role="img" aria-label="بدون تصویر">🖼</div>`;
}

export function catalogueHtml(input: {
  settings: ShopSettings;
  items: ShowcaseItem[];
  categories: Array<{ name: string; count: number }>;
  query: { q: string; category: string; page: number; sort?: string };
  total: number;
  perPage: number;
}): string {
  const { settings, items, categories, query, total, perPage } = input;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const link = (patch: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged = { q: query.q, category: query.category, sort: query.sort || '', page: '', ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const text = params.toString();
    return text ? `./?${text}` : HOME_URL;
  };
  const chips = [`<a class="chip${query.category ? '' : ' on'}" href="${escapeHtml(link({ category: '' }))}">همهٔ دسته‌ها</a>`]
    .concat(categories.slice(0, 20).map(entry => `<a class="chip${entry.name === query.category ? ' on' : ''}" href="${escapeHtml(link({ category: entry.name }))}">${escapeHtml(entry.name)} <b>${fa(entry.count)}</b></a>`))
    .join('');
  const cards = items.map(item => `<article class="pcard">
  <a class="thumb" href="${escapeHtml(shopUrl({ product: item.id }))}" aria-label="${escapeHtml(item.title)}">${thumb(item)}${item.price > item.basePrice && item.basePrice > 0 ? '' : ''}</a>
  <div class="body">
    <div class="tagrow">${item.category ? `<a class="tag" href="${escapeHtml(link({ category: item.category }))}">${escapeHtml(item.category)}</a>` : ''}
      ${item.brand ? `<span class="tag">${escapeHtml(item.brand)}</span>` : ''}</div>
    <h3><a href="${escapeHtml(shopUrl({ product: item.id }))}">${escapeHtml(item.title)}</a></h3>
    ${priceBlock(item, settings.currency)}
    ${addButton(item)}
  </div></article>`).join('');
  const window5 = pageWindow(query.page, pages);
  const pager = pages > 1 ? `<nav class="pager" aria-label="صفحه‌بندی">
    ${query.page > 1 ? `<a href="${escapeHtml(link({ page: String(query.page - 1) }))}" rel="prev">قبلی</a>` : ''}
    ${window5.map(page => `<a class="${page === query.page ? 'on' : ''}" href="${escapeHtml(link({ page: String(page) }))}"${page === query.page ? ' aria-current="page"' : ''}>${fa(page)}</a>`).join('')}
    ${query.page < pages ? `<a href="${escapeHtml(link({ page: String(query.page + 1) }))}" rel="next">بعدی</a>` : ''}</nav>` : '';
  const sorts: Array<[string, string]> = [['', 'جدیدترین'], ['cheap', 'ارزان‌ترین'], ['expensive', 'گران‌ترین'], ['name', 'نام محصول']];
  const body = `<section class="hero"><h1>${escapeHtml(settings.name)}</h1><p>${escapeHtml(settings.tagline)}</p>
  <div class="stats"><span><b>${fa(total)}</b> محصول</span><span><b>${fa(categories.length)}</b> دسته‌بندی</span>
  ${query.category ? `<span>دستهٔ فعلی: <b>${escapeHtml(query.category)}</b></span>` : '<span>بر اساس دسته و نوع محصول مرتب شده است</span>'}</div></section>
  <nav class="chips" aria-label="فیلتر دسته‌بندی">${chips}</nav>
  <div class="toolbar"><span class="count">${query.q ? `نتایج «${escapeHtml(query.q)}»: ` : ''}${fa(total)} محصول</span>
    <form class="sortbox" method="get" action="${escapeHtml(HOME_URL)}">
      ${query.q ? `<input type="hidden" name="q" value="${escapeHtml(query.q)}">` : ''}
      ${query.category ? `<input type="hidden" name="category" value="${escapeHtml(query.category)}">` : ''}
      <label for="sort" class="note">مرتب‌سازی</label>
      <select id="sort" name="sort" data-autosubmit>${sorts.map(([value, label]) =>
        `<option value="${value}"${(query.sort || '') === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <noscript><button class="btn" type="submit">اعمال</button></noscript>
    </form></div>
  ${items.length ? `<div class="grid">${cards}</div>${pager}` : `<div class="panel"><div class="empty">
    ${query.q || query.category ? 'محصولی با این فیلتر پیدا نشد. فیلترها را بردارید یا عبارت دیگری جست‌وجو کنید.' : 'هنوز محصولی برای نمایش وجود ندارد؛ به‌زودی کالاهای تازه اضافه می‌شوند.'}
    </div>${query.q || query.category ? '<a class="btn block" href="${escapeHtml(HOME_URL)}">نمایش همهٔ محصولات</a>' : ''}</div>`}`;
  return layout(settings, query.category || 'ویترین', body, { search: query.q, tab: query.q ? 'search' : 'home' });
}

function pageWindow(current: number, pages: number): number[] {
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const out: number[] = [];
  for (let page = start; page <= Math.min(pages, start + 4); page++) out.push(page);
  return out;
}

export function categoriesHtml(input: { settings: ShopSettings; categories: Array<{ name: string; count: number; image: string }> }): string {
  const { settings, categories } = input;
  const cards = categories.map(entry => `<a class="catcard" href="${escapeHtml(shopUrl({ category: entry.name }))}">
    ${entry.image ? `<img loading="lazy" decoding="async" src="${escapeHtml(entry.image)}" alt="">` : '<div class="ph" aria-hidden="true">🗂</div>'}
    <span class="meta"><b>${escapeHtml(entry.name)}</b><small>${fa(entry.count)} محصول</small></span></a>`).join('');
  const body = `<section class="hero"><h1>دسته‌بندی محصولات</h1><p>محصولات بر اساس دسته و نوع کالا گروه‌بندی شده‌اند.</p></section>
  ${categories.length ? `<div class="catgrid">${cards}</div>` : '<div class="panel"><div class="empty">هنوز دسته‌بندی‌ای وجود ندارد.</div></div>'}`;
  return layout(settings, 'دسته‌بندی‌ها', body, { showSearch: false, tab: 'categories' });
}

export function productHtml(input: { settings: ShopSettings; item: ShowcaseItem; related: ShowcaseItem[] }): string {
  const { settings, item } = input;
  // Customer facing: only shop facts. Source price, sourcing profile and the pricing
  // coefficient are internal and never rendered.
  const rows: Array<[string, string]> = [['قیمت فروشگاه', `${money(item.price)} ${settings.currency}`]];
  if (item.brand) rows.push(['برند', item.brand]);
  if (item.category) rows.push(['دسته', item.category]);
  if (typeof item.stock === 'number') rows.push(['موجودی', fa(item.stock)]);
  const related = input.related.slice(0, 4).map(other => `<article class="pcard">
    <a class="thumb" href="${escapeHtml(shopUrl({ product: other.id }))}">${thumb(other)}</a>
    <div class="body"><h3><a href="${escapeHtml(shopUrl({ product: other.id }))}">${escapeHtml(other.title)}</a></h3>
    ${priceBlock(other, settings.currency)}${addButton(other)}</div></article>`).join('');
  const body = `<p class="crumbs"><a href="${escapeHtml(HOME_URL)}">ویترین</a> › <a href="${escapeHtml(shopUrl({ category: item.category || '' }))}">${escapeHtml(item.category || 'همهٔ محصولات')}</a> › ${escapeHtml(item.title)}</p>
  <section class="product-top">
    <div class="shot">${thumb(item)}</div>
    <div class="panel" style="margin:0">
      <h2>${escapeHtml(item.title)}</h2>
      <div class="tagrow">${item.category ? `<a class="tag" href="${escapeHtml(shopUrl({ category: item.category }))}">${escapeHtml(item.category)}</a>` : ''}${item.brand ? `<span class="tag">${escapeHtml(item.brand)}</span>` : ''}</div>
      ${priceBlock(item, settings.currency)}
      ${item.shortDesc ? `<p class="note">${escapeHtml(item.shortDesc)}</p>` : ''}
      ${addButton(item)}
      <div class="scroll-x" style="margin-top:12px"><table class="sum"><tbody>
        ${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
      </tbody></table></div>
    </div></section>
  ${related ? `<h2 style="font-size:15px;margin:22px 0 10px">محصولات مشابه</h2><div class="grid">${related}</div>` : ''}`;
  return layout(settings, item.title, body, { tab: 'home' });
}

export function checkoutHtml(input: { settings: ShopSettings; gateways: Array<{ id: string; title: string; description: string }>; source?: 'wordpress' | 'builtin'; error?: string }): string {
  const { settings, gateways } = input;
  const emptyText = input.error
    ? escapeHtml(input.error)
    : input.source === 'wordpress'
      ? 'در ووکامرس هیچ درگاه پرداختی فعال نیست. افزونهٔ درگاه (زرین‌پال، ترب‌پی، دیجی‌پی، کارت به کارت …) را در وردپرس نصب و فعال کنید.'
      : 'هیچ روش پرداختی فعال نیست. از پنل مدیریت فروشگاه یکی از افزونه‌ها را فعال کنید.';
  const pays = gateways.length ? gateways.map((plugin, index) => `<label class="pay">
  <input type="radio" name="gateway" value="${escapeHtml(plugin.id)}"${index === 0 ? ' checked' : ''}>
  <span><b>${escapeHtml(plugin.title)}</b>${plugin.description ? `<small>${escapeHtml(plugin.description)}</small>` : ''}</span></label>`).join('')
    : `<div class="empty">${emptyText}</div>`;
  const sourceNote = input.source === 'wordpress'
    ? '<p class="note">پرداخت توسط <b>افزونه‌های درگاه وردپرس/ووکامرس</b> انجام می‌شود؛ سفارش در ووکامرس ثبت و وضعیت پرداخت از همان‌جا خوانده می‌شود.</p>'
    : '<p class="note">اتصال ووکامرس تنظیم نشده است؛ درگاه‌های داخلی برنامه استفاده می‌شوند.</p>';
  const body = `<p class="crumbs"><a href="${escapeHtml(HOME_URL)}">ویترین</a> › تسویه حساب</p>
<div class="cols">
  <div>
    <div class="panel"><h2>🧺 سبد خرید</h2><div id="cartBox"><div class="empty">در حال بارگذاری…</div></div></div>
    <div class="panel"><h2>🚚 اطلاعات گیرنده</h2>
      <div class="field"><label for="cname">نام و نام خانوادگی</label><input id="cname" autocomplete="name" enterkeyhint="next"><span class="err" data-for="cname"></span></div>
      <div class="field"><label for="cphone">شمارهٔ موبایل</label><input id="cphone" type="tel" inputmode="numeric" dir="ltr" placeholder="09123456789" autocomplete="tel" enterkeyhint="next"><span class="err" data-for="cphone"></span></div>
      <div class="field"><label for="caddress">نشانی کامل تحویل</label><textarea id="caddress" rows="3" autocomplete="street-address"></textarea><span class="err" data-for="caddress"></span></div>
      <div class="field"><label for="cnote">توضیح سفارش (اختیاری)</label><input id="cnote"></div></div>
  </div>
  <div class="sticky">
    <div class="panel"><h2>💳 روش پرداخت</h2>${sourceNote}<div class="pay-list">${pays}</div></div>
    <div class="panel"><h2>🧾 خلاصهٔ پرداخت</h2>
      <table class="sum"><tbody>
        <tr><td>جمع کالاها</td><td id="sumItems">—</td></tr>
        <tr><td>هزینهٔ ارسال</td><td id="sumShip">${settings.shippingCost ? money(settings.shippingCost) : 'رایگان'}</td></tr>
        <tr><td>مالیات</td><td>${settings.taxPercent ? fa(settings.taxPercent) + '٪' : '—'}</td></tr>
      </tbody></table>
      <p class="note">${settings.freeShippingFrom ? 'ارسال رایگان برای سفارش‌های بالای ' + money(settings.freeShippingFrom) + ' ' + escapeHtml(settings.currency) + '.' : ''}
      مبلغ نهایی روی سرور و بر اساس قیمت روز محاسبه می‌شود.</p>
      <button class="btn primary block" id="placeOrder"${gateways.length ? '' : ' disabled'}>ثبت سفارش و پرداخت</button>
      <div id="payResult" class="note" role="status" aria-live="polite"></div></div>
  </div></div>`;
  return layout(settings, 'تسویه حساب', body, { showSearch: false, tab: 'cart' });
}

export function orderHtml(input: { settings: ShopSettings; order: Order; instructions?: string }): string {
  const { settings, order } = input;
  const rows = order.lines.map(line => `<tr><td>${escapeHtml(line.title)}</td>
    <td>${fa(line.qty)}</td><td>${money(line.price)}</td><td>${money(line.price * line.qty)}</td></tr>`).join('');
  const statusText: Record<string, string> = {
    pending: '⏳ در انتظار پرداخت', 'awaiting-receipt': '🧾 در انتظار ثبت رسید کارت به کارت',
    review: '🔎 در انتظار تأیید فروشنده', paid: '✅ پرداخت‌شده', failed: '❌ ناموفق', canceled: '🚫 لغو شده'
  };
  const pillClass = order.status === 'paid' ? ' paid' : order.status === 'failed' || order.status === 'canceled' ? ' failed' : '';
  const receipt = order.status === 'awaiting-receipt' ? `<div class="panel"><h2>🧾 ثبت رسید واریز</h2>
    <p class="note">${escapeHtml(input.instructions || '')}</p>
    <div class="field"><label for="receiptRef">کد پیگیری / شمارهٔ رسید</label><input id="receiptRef" inputmode="numeric" dir="ltr"></div>
    <button class="btn primary block" id="sendReceipt" data-order="${escapeHtml(order.id)}">ثبت رسید</button>
    <div id="receiptResult" class="note" role="status" aria-live="polite"></div></div>` : '';
  const retry = order.status === 'pending' && order.payment.payUrl
    ? `<a class="btn primary block" href="${escapeHtml(order.payment.payUrl)}">ادامهٔ پرداخت</a>` : '';
  const body = `<p class="crumbs"><a href="${escapeHtml(HOME_URL)}">ویترین</a> › <a href="${escapeHtml(shopUrl({ view: 'track' }))}">پیگیری سفارش</a> › ${escapeHtml(order.id)}</p>
<div class="panel"><h2>سفارش ${escapeHtml(order.id)}</h2>
  <div class="statusline"><span class="pill${pillClass}">${escapeHtml(statusText[order.status] || order.status)}</span>
    <span class="pill">روش پرداخت: ${escapeHtml(order.payment.gatewayTitle || order.gateway)}</span>
    ${order.payment.reference ? `<span class="pill">کد پیگیری: ${escapeHtml(order.payment.reference)}</span>` : ''}
    ${order.payment.error ? `<span class="pill failed">${escapeHtml(order.payment.error)}</span>` : ''}</div>
  <div class="scroll-x" style="margin-top:12px"><table class="sum">
  <thead><tr><th>محصول</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3">جمع کالاها</td><td>${money(order.subtotal)}</td></tr>
  <tr><td colspan="3">ارسال</td><td>${money(order.shipping)}</td></tr>
  <tr><td colspan="3">مالیات</td><td>${money(order.tax)}</td></tr>
  <tr><td colspan="3"><b>مبلغ قابل پرداخت</b></td><td><b>${money(order.total)} ${escapeHtml(order.currency)}</b></td></tr></tfoot></table></div>
  ${retry}</div>${receipt}`;
  return layout(settings, 'سفارش ' + order.id, body, { showSearch: false, tab: 'track' });
}

export function trackHtml(input: { settings: ShopSettings; notFound?: string }): string {
  const body = `<div class="panel"><h2>📦 پیگیری سفارش</h2>
  <p class="note">شمارهٔ سفارشی که بعد از ثبت خرید دریافت کرده‌اید را وارد کنید.</p>
  ${input.notFound ? `<p class="bad">${escapeHtml(input.notFound)}</p>` : ''}
  <form method="get" action="${escapeHtml(HOME_URL)}"><input type="hidden" name="view" value="track">
    <div class="field"><label for="order">شمارهٔ سفارش</label><input id="order" name="order" dir="ltr" required></div>
    <button class="btn primary block" type="submit">پیگیری</button></form></div>`;
  return layout(input.settings, 'پیگیری سفارش', body, { showSearch: false, tab: 'track' });
}


export function infoPageHtml(settings: ShopSettings, slug: string): string | null {
  const page = PAGES[slug];
  if (!page) return null;
  const body = `<p class="crumbs"><a href="${escapeHtml(HOME_URL)}">ویترین</a> › ${escapeHtml(page.title)}</p>
  <div class="panel"><h2>${escapeHtml(page.title)}</h2><p class="note">${escapeHtml(page.body)}</p>
  ${settings.contactPhone ? `<p class="note">تماس: <a href="tel:${escapeHtml(settings.contactPhone)}" dir="ltr">${fa(settings.contactPhone)}</a></p>` : ''}</div>`;
  return layout(settings, page.title, body, { showSearch: false });
}

export function shopAdminHtml(input: { settings: ShopSettings; payments: PaymentSettings; scraperPath: string }): string {
  const { settings, payments } = input;
  const gateways = PAYMENT_PLUGINS.map(plugin => `<div class="panel"><h2>${escapeHtml(plugin.title)}</h2>
  <p class="note">${escapeHtml(plugin.description)}</p>
  <label class="pay"><input type="checkbox" data-pay="${plugin.id}" data-key="enabled"${payments[plugin.id].enabled ? ' checked' : ''}><span>فعال باشد</span></label>
  ${plugin.id === 'card' ? '' : `
  <div class="field"><label>شناسهٔ پذیرنده / Merchant</label><input data-pay="${plugin.id}" data-key="merchantId" value="${escapeHtml(payments[plugin.id].merchantId)}"></div>
  ${plugin.needs.includes('secret') ? `<div class="field"><label>کلید مخفی (برای دیجی‌پی: user:pass)</label><input data-pay="${plugin.id}" data-key="secret" value="${escapeHtml(payments[plugin.id].secret)}"></div>` : ''}
  <div class="field"><label>آدرس پایهٔ درگاه</label><input data-pay="${plugin.id}" data-key="baseUrl" value="${escapeHtml(payments[plugin.id].baseUrl)}" placeholder="${escapeHtml(plugin.defaultBaseUrl)}"></div>
  <label class="pay"><input type="checkbox" data-pay="${plugin.id}" data-key="sandbox"${payments[plugin.id].sandbox ? ' checked' : ''}><span>حالت آزمایشی (sandbox)</span></label>`}
  </div>`).join('');
  const body = `<div class="panel"><h2>🛍 تنظیمات ویترین</h2>
  <label class="pay"><input type="checkbox" data-shop="enabled"${settings.enabled ? ' checked' : ''}><span>ویترین روی ریشهٔ دامنه فعال باشد</span></label>
  <div class="field"><label>نام فروشگاه</label><input data-shop="name" value="${escapeHtml(settings.name)}"></div>
  <div class="field"><label>شعار</label><input data-shop="tagline" value="${escapeHtml(settings.tagline)}"></div>
  <div class="field"><label>ریشهٔ آدرس فروشگاه (همهٔ لینک‌ها از این ریشه ساخته می‌شوند)</label><input data-shop="basePath" value="${escapeHtml(settings.basePath)}" dir="ltr" placeholder="/">
  <span class="note">اگر برنامه زیر یک زیرپوشه نصب شده است، همان را وارد کنید؛ مثل <code dir="ltr">/shop/</code>. لینک‌ها هیچ‌وقت از این ریشه عمیق‌تر نمی‌شوند.</span></div>
  <div class="field"><label>پوشهٔ پنل اسکریپر (ریشه همیشه متعلق به فروشگاه است)</label><input data-shop="scraperPath" value="${escapeHtml(settings.scraperPath)}"></div>
  <div class="field"><label>منبع درگاه‌های پرداخت</label><select data-shop="gatewaySource">
    <option value="wordpress"${settings.gatewaySource === 'wordpress' ? ' selected' : ''}>افزونه‌های وردپرس/ووکامرس (پیشنهادی)</option>
    <option value="builtin"${settings.gatewaySource === 'builtin' ? ' selected' : ''}>درگاه‌های داخلی این برنامه</option></select>
  <span class="note">با گزینهٔ وردپرس، هر درگاهی که در ووکامرس فعال باشد (زرین‌پال، ترب‌پی، دیجی‌پی، کارت به کارت و …) خودکار در تسویه حساب نمایش داده می‌شود و کلیدهای درگاه در وردپرس می‌مانند.</span></div>
  <div class="field"><label>واحد پول</label><select data-shop="currency"><option${settings.currency === 'تومان' ? ' selected' : ''}>تومان</option><option${settings.currency === 'ریال' ? ' selected' : ''}>ریال</option></select></div>
  <div class="field"><label>هزینهٔ ارسال</label><input data-shop="shippingCost" type="number" inputmode="numeric" value="${settings.shippingCost}"></div>
  <div class="field"><label>ارسال رایگان از مبلغ</label><input data-shop="freeShippingFrom" type="number" inputmode="numeric" value="${settings.freeShippingFrom}"></div>
  <div class="field"><label>درصد مالیات</label><input data-shop="taxPercent" type="number" inputmode="numeric" value="${settings.taxPercent}"></div>
  <div class="field"><label>شمارهٔ تماس فروشگاه (در پانوشت)</label><input data-shop="contactPhone" value="${escapeHtml(settings.contactPhone)}" dir="ltr"></div>
  <div class="field"><label>شمارهٔ کارت (کارت به کارت)</label><input data-shop="card.number" value="${escapeHtml(settings.card.number)}" inputmode="numeric" dir="ltr"></div>
  <div class="field"><label>نام صاحب کارت</label><input data-shop="card.holder" value="${escapeHtml(settings.card.holder)}"></div>
  <div class="field"><label>بانک</label><input data-shop="card.bank" value="${escapeHtml(settings.card.bank)}"></div></div>
  <div class="panel"><h2>🔌 درگاه‌های داخلی (فقط وقتی منبع «داخلی» است)</h2><p class="note">اگر سایت ووکامرس متصل است این بخش را خالی بگذارید؛ پرداخت با افزونه‌های وردپرس انجام می‌شود.</p></div>
  ${gateways}
  <button class="btn primary block" id="saveShop">💾 ذخیرهٔ تنظیمات فروشگاه</button>
  <div id="shopSaveResult" class="note" role="status" aria-live="polite"></div>
  <p class="note">پنل اسکریپر: <a href="${escapeHtml(input.scraperPath)}">/${escapeHtml(input.scraperPath)}</a> · ویترین: <a href="${escapeHtml(HOME_URL)}">ریشهٔ فروشگاه</a></p>`;
  return layout(settings, 'مدیریت فروشگاه', body, { showSearch: false });
}

/**
 * The only client script. Cart lives in localStorage; totals are always recomputed on the server.
 * Everything is delegated from document, so markup rendered later keeps working.
 */
export const SHOP_JS = String.raw`(function(){
'use strict';
var KEY='shop.cart.v1';
function fa(v){return String(v).replace(/\d/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[+d]})}
function en(v){return String(v==null?'':v).replace(/[۰-۹]/g,function(d){return String(d.charCodeAt(0)-0x06f0)}).replace(/[٠-٩]/g,function(d){return String(d.charCodeAt(0)-0x0660)})}
function money(v){return fa(Math.round(+v||0).toLocaleString('en-US').replace(/,/g,'٬'))}
function read(){try{var raw=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(raw))return[];
  return raw.filter(function(l){return l&&typeof l.id==='string'}).map(function(l){
    return {id:l.id,title:String(l.title||''),price:Math.max(0,+l.price||0),qty:Math.max(1,Math.min(999,Math.round(+l.qty||1)))}})}catch(e){return[]}}
function write(items){try{localStorage.setItem(KEY,JSON.stringify(items))}catch(e){}paint()}
function count(){return read().reduce(function(n,l){return n+l.qty},0)}
function subtotal(){return read().reduce(function(n,l){return n+l.price*l.qty},0)}
function paint(){
  var items=read(),n=count(),badge=document.getElementById('cartCount');
  if(badge){badge.textContent=fa(n);badge.setAttribute('data-empty',n?'0':'1')}
  var tabBadge=document.getElementById('tabCartCount');
  if(tabBadge){tabBadge.textContent=fa(n);tabBadge.setAttribute('data-empty',n?'0':'1')}
  var sumItems=document.getElementById('sumItems');
  if(sumItems)sumItems.textContent=items.length?money(subtotal()):'—';
  document.querySelectorAll('.add').forEach(function(btn){
    var line=items.filter(function(l){return l.id===btn.dataset.id})[0];
    if(line){btn.setAttribute('data-state','in');btn.textContent='در سبد ('+fa(line.qty)+') — افزودن دوباره'}
    else{btn.removeAttribute('data-state');btn.textContent='افزودن به سبد'}
  });
}
function renderCart(){
  var box=document.getElementById('cartBox');if(!box)return;
  var items=read();
  if(!items.length){box.innerHTML='<div class="empty">سبد خرید خالی است.</div><a class="btn block" href="./">رفتن به ویترین</a>';paint();return}
  box.innerHTML='<div class="scroll-x"><table class="sum"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت</th><th>جمع</th><th></th></tr></thead><tbody>'+
    items.map(function(l){return '<tr><td>'+esc(l.title)+'</td>'+
      '<td><span style="display:inline-flex;gap:6px;align-items:center">'+
      '<button class="btn" data-step="-1" data-id="'+esc(l.id)+'" aria-label="کاهش">−</button>'+
      '<b>'+fa(l.qty)+'</b>'+
      '<button class="btn" data-step="1" data-id="'+esc(l.id)+'" aria-label="افزایش">+</button></span></td>'+
      '<td>'+money(l.price)+'</td><td>'+money(l.price*l.qty)+'</td>'+
      '<td><button class="btn" data-remove="'+esc(l.id)+'" aria-label="حذف">🗑</button></td></tr>'}).join('')+
    '</tbody></table></div>';
  paint();
}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function closest(target,selector){return target&&target.closest?target.closest(selector):null}

document.addEventListener('click',function(e){
  var add=closest(e.target,'.add');
  if(add){
    e.preventDefault();
    var items=read(),id=add.dataset.id,line=items.filter(function(l){return l.id===id})[0];
    if(line)line.qty=Math.min(999,line.qty+1);
    else items.push({id:id,title:add.dataset.title,price:+add.dataset.price||0,qty:1});
    write(items);renderCart();return;
  }
  var del=closest(e.target,'[data-remove]');
  if(del){e.preventDefault();write(read().filter(function(l){return l.id!==del.dataset.remove}));renderCart();return}
  var go=closest(e.target,'[data-go]');
  if(go){e.preventDefault();location.href=go.getAttribute('data-go');return}
  var step=closest(e.target,'[data-step]');
  if(step){
    e.preventDefault();
    var next=read().map(function(l){return l.id===step.dataset.id?Object.assign({},l,{qty:Math.max(1,Math.min(999,l.qty+(+step.dataset.step)))}):l});
    write(next);renderCart();return;
  }
});
document.addEventListener('change',function(e){
  var auto=closest(e.target,'[data-autosubmit]');
  if(auto&&auto.form)auto.form.submit();
});
// Keep every open tab in sync with the cart.
window.addEventListener('storage',function(e){if(e.key===KEY){paint();renderCart()}});

function fieldError(id,text){
  var input=document.getElementById(id);if(!input)return;
  var field=input.closest('.field'),slot=document.querySelector('.err[data-for="'+id+'"]');
  if(field)field.classList.toggle('bad',Boolean(text));
  if(slot)slot.textContent=text||'';
  return Boolean(text);
}
function validate(){
  var name=(document.getElementById('cname')||{}).value||'';
  var phone=en((document.getElementById('cphone')||{}).value||'').replace(/[^\d+]/g,'');
  var address=(document.getElementById('caddress')||{}).value||'';
  var bad=false;
  bad=fieldError('cname',name.trim().length<3?'نام و نام خانوادگی را کامل وارد کنید.':'')||bad;
  bad=fieldError('cphone',/^(\+98|0)?9\d{9}$/.test(phone)?'':'شمارهٔ موبایل معتبر نیست؛ مثل 09123456789.')||bad;
  bad=fieldError('caddress',address.trim().length<10?'نشانی تحویل را کامل‌تر بنویسید.':'')||bad;
  return bad?null:{name:name,phone:phone,address:address,note:(document.getElementById('cnote')||{}).value||''};
}

var place=document.getElementById('placeOrder');
if(place)place.addEventListener('click',function(){
  var out=document.getElementById('payResult');
  var picked=document.querySelector('input[name=gateway]:checked');
  if(!picked){out.innerHTML='<span class="bad">یک روش پرداخت انتخاب کنید.</span>';return}
  var items=read();
  if(!items.length){out.innerHTML='<span class="bad">سبد خرید خالی است.</span>';return}
  var customer=validate();
  if(!customer){out.innerHTML='<span class="bad">لطفاً خطاهای فرم را برطرف کنید.</span>';
    var firstBad=document.querySelector('.field.bad input,.field.bad textarea');if(firstBad)firstBad.focus();return}
  place.disabled=true;out.textContent='در حال ثبت سفارش…';
  fetch('api/shop/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    gateway:picked.value,items:items.map(function(l){return {id:l.id,qty:l.qty}}),customer:customer})})
   .then(function(r){return r.json()})
   .then(function(body){
     if(!body||!body.ok){out.innerHTML='<span class="bad">'+esc(body&&body.error||'ثبت سفارش ناموفق بود.')+'</span>';place.disabled=false;return}
     try{localStorage.removeItem(KEY)}catch(e){}
     if(body.redirect){out.innerHTML='<span class="ok">در حال انتقال به درگاه پرداخت…</span>';location.href=body.redirect;return}
     location.href='./?order='+encodeURIComponent(body.orderId);
   })
   .catch(function(error){out.innerHTML='<span class="bad">'+esc(error)+'</span>';place.disabled=false});
});

var receipt=document.getElementById('sendReceipt');
if(receipt)receipt.addEventListener('click',function(){
  var out=document.getElementById('receiptResult');
  var reference=en((document.getElementById('receiptRef')||{}).value||'').trim();
  if(reference.length<4){out.innerHTML='<span class="bad">کد پیگیری واریز را وارد کنید.</span>';return}
  receipt.disabled=true;out.textContent='در حال ثبت…';
  fetch('api/shop/receipt',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({orderId:receipt.dataset.order,reference:reference})})
   .then(function(r){return r.json()}).then(function(body){
     out.innerHTML=body&&body.ok?'<span class="ok">رسید ثبت شد؛ پس از تأیید فروشنده سفارش پردازش می‌شود.</span>':'<span class="bad">'+esc(body&&body.error||'ثبت نشد')+'</span>';
     if(body&&body.ok)setTimeout(function(){location.reload()},1200);else receipt.disabled=false;
   }).catch(function(error){out.innerHTML='<span class="bad">'+esc(error)+'</span>';receipt.disabled=false});
});

var save=document.getElementById('saveShop');
if(save)save.addEventListener('click',function(){
  var out=document.getElementById('shopSaveResult'),shop={card:{}},pays={};
  document.querySelectorAll('[data-shop]').forEach(function(el){
    var key=el.dataset.shop,value=el.type==='checkbox'?el.checked:el.value;
    if(key.indexOf('card.')===0)shop.card[key.slice(5)]=value;else shop[key]=value;
  });
  document.querySelectorAll('[data-pay]').forEach(function(el){
    var id=el.dataset.pay;pays[id]=pays[id]||{};
    pays[id][el.dataset.key]=el.type==='checkbox'?el.checked:el.value;
  });
  save.disabled=true;out.textContent='در حال ذخیره…';
  fetch('api/shop/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shop:shop,payments:pays})})
   .then(function(r){return r.json()}).then(function(body){
     out.innerHTML=body&&body.ok?'<span class="ok">ذخیره شد.</span>':'<span class="bad">'+esc(body&&body.error||'ذخیره نشد')+'</span>';save.disabled=false;
   }).catch(function(error){out.innerHTML='<span class="bad">'+esc(error)+'</span>';save.disabled=false});
});

// "جست‌وجو" tab: land on the catalogue with the search box focused.
if(/[?&]focus=1/.test(location.search)){var box=document.querySelector('.head form.search input');if(box){box.focus();try{box.select()}catch(e){}}}
renderCart();paint();
})();`;

export function totalsSummary(totals: OrderTotals, settings: ShopSettings): string {
  return `${money(totals.subtotal)} + ارسال ${money(totals.shipping)} + مالیات ${money(totals.tax)} = ${money(totals.total)} ${settings.currency}`;
}
