/**
 * Storefront pages (Persian, RTL). Server rendered HTML + one external script, because the
 * dashboard security headers allow script-src 'self' only — inline shop scripts would be blocked
 * exactly like the visual picker was.
 */
import { PAYMENT_PLUGINS, type PaymentPlugin, type PaymentSettings } from './payments.js';
import { fa, money, type Order, type OrderTotals, type ShopSettings, type ShowcaseItem } from './shop-core.js';

export const SHOP_SCRIPT_PATH = '/shop.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const STYLE = String.raw`
:root{--bg:#0b1020;--card:#121a33;--line:#243056;--text:#eaf0ff;--muted:#9fb0d9;--brand:#4ade80;--accent:#60a5fa;--warn:#fbbf24}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Vazirmatn,Tahoma,system-ui,sans-serif;direction:rtl}
a{color:inherit;text-decoration:none}
header.shop-head{position:sticky;top:0;z-index:5;background:#0b1020ee;backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.brand{font-weight:800;font-size:18px}
.tagline{color:var(--muted);font-size:12px;flex:1 1 200px}
.wrap{max-width:1180px;margin:0 auto;padding:16px}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.filters input,.filters select{background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 12px;font-family:inherit;font-size:13px;min-height:40px}
.filters input{flex:1 1 220px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#0d1428}
.card .body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:7px;flex:1}
.card h3{margin:0;font-size:13px;line-height:1.8;font-weight:600;min-height:46px}
.badge{display:inline-block;font-size:10px;padding:3px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.badge.profile{border-color:#2b3c6e;color:var(--accent)}
.badge.adj{border-color:#3f3016;color:var(--warn)}
.prices{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:auto}
.base{color:var(--muted);font-size:11px;text-decoration:line-through}
.final{color:var(--brand);font-weight:800;font-size:15px}
.unit{font-size:11px;color:var(--muted)}
button{font-family:inherit;cursor:pointer;border-radius:10px;border:1px solid var(--line);background:#1b2a4d;min-height:40px}
.btn{background:#1b2a4d;color:var(--text);border:1px solid var(--line);padding:9px 14px;font-size:13px}
.btn.primary{background:var(--brand);color:#06240f;border-color:#2f9c56;font-weight:800}
.btn.ghost{background:transparent}
.cart-link{position:relative}
.cart-count{background:var(--brand);color:#06240f;border-radius:999px;padding:1px 7px;font-size:11px;font-weight:800;margin-inline-start:4px}
table.sum{width:100%;border-collapse:collapse;font-size:13px}
table.sum td,table.sum th{border-bottom:1px solid var(--line);padding:9px 6px;text-align:start}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
.panel h2{margin:0 0 10px;font-size:15px}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.field label{font-size:12px;color:var(--muted)}
.field input,.field textarea,.field select{background:#0d1428;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px;font-family:inherit;font-size:13px}
.pay-list{display:grid;gap:9px}
.pay{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:10px;background:#0d1428}
.pay b{font-size:13px}
.pay small{color:var(--muted);font-size:11px;line-height:1.8;display:block}
.empty{color:var(--muted);text-align:center;padding:40px 10px;font-size:13px}
.note{color:var(--muted);font-size:11px;line-height:2}
.ok{color:var(--brand)}.bad{color:#fca5a5}
.pager{display:flex;gap:8px;justify-content:center;margin:18px 0}
@media(max-width:600px){.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.card h3{min-height:40px;font-size:12px}}
`;

function layout(settings: ShopSettings, title: string, body: string, cartCount = 0): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(settings.name)}</title>
<link rel="stylesheet" href="/assets/fonts/vazirmatn.css">
<style>${STYLE}</style></head><body>
<header class="shop-head">
<a class="brand" href="/">🛍 ${escapeHtml(settings.name)}</a>
<span class="tagline">${escapeHtml(settings.tagline)}</span>
<a class="btn ghost" href="/">ویترین</a>
<a class="btn ghost cart-link" href="/checkout">🧺 سبد خرید<span class="cart-count" id="cartCount">${fa(cartCount)}</span></a>
</header>
<main class="wrap">${body}</main>
<script src="${SHOP_SCRIPT_PATH}" defer></script></body></html>`;
}

function priceBlock(item: ShowcaseItem, currency: string): string {
  const changed = item.price !== item.basePrice && item.basePrice > 0;
  return `<div class="prices">${changed ? `<span class="base">${money(item.basePrice)}</span>` : ''}` +
    `<span class="final">${money(item.price)}</span><span class="unit">${escapeHtml(currency)}</span></div>`;
}

export function catalogueHtml(input: {
  settings: ShopSettings;
  items: ShowcaseItem[];
  profiles: Array<{ id: string; name: string; count: number }>;
  query: { q: string; profileId: string; page: number };
  total: number;
  perPage: number;
}): string {
  const { settings, items, profiles, query, total, perPage } = input;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const options = profiles.map(profile =>
    `<option value="${escapeHtml(profile.id)}"${profile.id === query.profileId ? ' selected' : ''}>${escapeHtml(profile.name)} (${fa(profile.count)})</option>`).join('');
  const cards = items.map(item => `<article class="card" data-item="${escapeHtml(item.id)}">
  ${item.image ? `<img loading="lazy" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">` : '<img alt="">'}
  <div class="body">
    <span class="badge profile">${escapeHtml(item.profileName)}</span>
    <h3>${escapeHtml(item.title)}</h3>
    <span class="badge adj" title="ضریب تعدیل قیمت این پروفایل">⚖ ${escapeHtml(item.adjustment.label)}</span>
    ${priceBlock(item, settings.currency)}
    <button class="btn primary add" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-price="${item.price}">افزودن به سبد</button>
  </div></article>`).join('');
  const pager = pages > 1 ? `<div class="pager">` + Array.from({ length: Math.min(pages, 12) }, (_, index) => {
    const page = index + 1;
    const url = `/?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.profileId ? { profile: query.profileId } : {}), page: String(page) })}`;
    return `<a class="btn${page === query.page ? ' primary' : ''}" href="${escapeHtml(url)}">${fa(page)}</a>`;
  }).join('') + `</div>` : '';
  const body = `<form class="filters" method="get" action="/">
  <input name="q" value="${escapeHtml(query.q)}" placeholder="🔍 جست‌وجو در نام محصول">
  <select name="profile"><option value="">همهٔ پروفایل‌ها</option>${options}</select>
  <button class="btn primary" type="submit">اعمال</button></form>
  <p class="note">قیمت هر محصول با <b>ضرایب تعدیل همان پروفایل</b> (درصد/مبلغ/ضریب، گرد کردن و حداقل قیمت) محاسبه و نمایش داده می‌شود؛ قیمت خط‌خورده همان قیمت خام مبدأ است. ${fa(total)} محصول.</p>
  ${items.length ? `<div class="grid">${cards}</div>${pager}` : '<div class="empty">هنوز محصولی برای نمایش وجود ندارد. ابتدا از بخش اسکریپر محصولات را استخراج کنید.</div>'}`;
  return layout(settings, 'ویترین', body);
}

export function checkoutHtml(input: { settings: ShopSettings; gateways: PaymentPlugin[] }): string {
  const { settings, gateways } = input;
  const pays = gateways.length ? gateways.map(plugin => `<label class="pay">
  <input type="radio" name="gateway" value="${plugin.id}"${plugin.id === gateways[0].id ? ' checked' : ''}>
  <span><b>${escapeHtml(plugin.title)}</b><small>${escapeHtml(plugin.description)}</small></span></label>`).join('')
    : '<div class="empty">هیچ روش پرداختی فعال نیست. از پنل مدیریت فروشگاه یکی از افزونه‌ها را فعال کنید.</div>';
  const body = `<div class="panel"><h2>🧺 سبد خرید</h2><div id="cartBox"><div class="empty">در حال بارگذاری…</div></div></div>
<div class="panel"><h2>🚚 اطلاعات گیرنده</h2>
  <div class="field"><label>نام و نام خانوادگی</label><input id="cname" autocomplete="name"></div>
  <div class="field"><label>شمارهٔ موبایل</label><input id="cphone" inputmode="numeric" placeholder="۰۹…" autocomplete="tel"></div>
  <div class="field"><label>نشانی کامل تحویل</label><textarea id="caddress" rows="3"></textarea></div>
  <div class="field"><label>توضیح سفارش (اختیاری)</label><input id="cnote"></div></div>
<div class="panel"><h2>💳 روش پرداخت</h2><div class="pay-list">${pays}</div>
  <p class="note">${settings.shippingCost ? 'هزینهٔ ارسال: ' + money(settings.shippingCost) + ' ' + escapeHtml(settings.currency) + (settings.freeShippingFrom ? ' — رایگان از ' + money(settings.freeShippingFrom) + ' به بالا' : '') : 'ارسال رایگان'}${settings.taxPercent ? ' · مالیات ' + fa(settings.taxPercent) + '٪' : ''}</p>
  <button class="btn primary" id="placeOrder" style="width:100%">ثبت سفارش و پرداخت</button>
  <div id="payResult" class="note"></div></div>`;
  return layout(settings, 'تسویه حساب', body);
}

export function orderHtml(input: { settings: ShopSettings; order: Order; instructions?: string }): string {
  const { settings, order } = input;
  const rows = order.lines.map(line => `<tr><td>${escapeHtml(line.title)}</td><td>${fa(line.qty)}</td>
    <td>${money(line.basePrice)}</td><td>${escapeHtml(line.adjustment.label)}</td><td>${money(line.price)}</td><td>${money(line.price * line.qty)}</td></tr>`).join('');
  const statusText: Record<string, string> = {
    pending: '⏳ در انتظار پرداخت', 'awaiting-receipt': '🧾 در انتظار ثبت رسید کارت به کارت',
    review: '🔎 در انتظار تأیید فروشنده', paid: '✅ پرداخت‌شده', failed: '❌ ناموفق', canceled: '🚫 لغو شده'
  };
  const receipt = order.status === 'awaiting-receipt' ? `<div class="panel"><h2>ثبت رسید واریز</h2>
    <p class="note">${escapeHtml(input.instructions || '')}</p>
    <div class="field"><label>کد پیگیری / شمارهٔ رسید</label><input id="receiptRef"></div>
    <button class="btn primary" id="sendReceipt" data-order="${escapeHtml(order.id)}">ثبت رسید</button>
    <div id="receiptResult" class="note"></div></div>` : '';
  const body = `<div class="panel"><h2>سفارش ${escapeHtml(order.id)}</h2>
  <p class="note">وضعیت: <b>${escapeHtml(statusText[order.status] || order.status)}</b> · روش پرداخت: ${escapeHtml(order.gateway)}${order.payment.reference ? ' · کد پیگیری: ' + escapeHtml(order.payment.reference) : ''}</p>
  <table class="sum"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت مبدأ</th><th>ضریب تعدیل پروفایل</th><th>قیمت فروشگاه</th><th>جمع</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><td colspan="5">جمع کالاها</td><td>${money(order.subtotal)}</td></tr>
  <tr><td colspan="5">ارسال</td><td>${money(order.shipping)}</td></tr>
  <tr><td colspan="5">مالیات</td><td>${money(order.tax)}</td></tr>
  <tr><td colspan="5"><b>مبلغ قابل پرداخت</b></td><td><b>${money(order.total)} ${escapeHtml(order.currency)}</b></td></tr></tfoot></table></div>${receipt}`;
  return layout(settings, 'سفارش', body);
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
  <div class="field"><label>پوشهٔ پنل اسکریپر (ریشه همیشه متعلق به فروشگاه است)</label><input data-shop="scraperPath" value="${escapeHtml(settings.scraperPath)}"></div>
  <div class="field"><label>واحد پول</label><select data-shop="currency"><option${settings.currency === 'تومان' ? ' selected' : ''}>تومان</option><option${settings.currency === 'ریال' ? ' selected' : ''}>ریال</option></select></div>
  <div class="field"><label>هزینهٔ ارسال</label><input data-shop="shippingCost" type="number" value="${settings.shippingCost}"></div>
  <div class="field"><label>ارسال رایگان از مبلغ</label><input data-shop="freeShippingFrom" type="number" value="${settings.freeShippingFrom}"></div>
  <div class="field"><label>درصد مالیات</label><input data-shop="taxPercent" type="number" value="${settings.taxPercent}"></div>
  <div class="field"><label>شمارهٔ کارت (کارت به کارت)</label><input data-shop="card.number" value="${escapeHtml(settings.card.number)}" inputmode="numeric"></div>
  <div class="field"><label>نام صاحب کارت</label><input data-shop="card.holder" value="${escapeHtml(settings.card.holder)}"></div>
  <div class="field"><label>بانک</label><input data-shop="card.bank" value="${escapeHtml(settings.card.bank)}"></div></div>
  ${gateways}
  <button class="btn primary" id="saveShop" style="width:100%">💾 ذخیرهٔ تنظیمات فروشگاه</button>
  <div id="shopSaveResult" class="note"></div>
  <p class="note">پنل اسکریپر: <a href="/${escapeHtml(input.scraperPath)}">/${escapeHtml(input.scraperPath)}</a> · ویترین: <a href="/">/</a></p>`;
  return layout(settings, 'مدیریت فروشگاه', body);
}

/** External script: cart in localStorage, checkout and receipt submission. */
export const SHOP_JS = String.raw`(function(){
var KEY='shop.cart.v1';
function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[]}catch(e){return[]}}
function write(items){try{localStorage.setItem(KEY,JSON.stringify(items))}catch(e){}paint()}
function fa(v){return String(v).replace(/\d/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[+d]})}
function money(v){return fa(Math.round(+v||0).toLocaleString('en-US').replace(/,/g,'٬'))}
function count(){return read().reduce(function(n,l){return n+l.qty},0)}
function paint(){var el=document.getElementById('cartCount');if(el)el.textContent=fa(count());}
document.addEventListener('click',function(e){
  var add=e.target.closest&&e.target.closest('.add');
  if(add){e.preventDefault();var items=read(),id=add.dataset.id,line=items.filter(function(l){return l.id===id})[0];
    if(line)line.qty++;else items.push({id:id,title:add.dataset.title,price:+add.dataset.price||0,qty:1});
    write(items);add.textContent='✓ افزوده شد ('+fa(items.filter(function(l){return l.id===id})[0].qty)+')';
    setTimeout(function(){add.textContent='افزودن به سبد'},1200);return}
  var del=e.target.closest&&e.target.closest('[data-remove]');
  if(del){e.preventDefault();write(read().filter(function(l){return l.id!==del.dataset.remove}));renderCart();return}
  var step=e.target.closest&&e.target.closest('[data-step]');
  if(step){e.preventDefault();var list=read();list.forEach(function(l){if(l.id===step.dataset.id)l.qty=Math.max(1,l.qty+(+step.dataset.step))});write(list);renderCart();return}
});
function renderCart(){
  var box=document.getElementById('cartBox');if(!box)return;
  var items=read();
  if(!items.length){box.innerHTML='<div class="empty">سبد خرید خالی است.</div>';paint();return}
  box.innerHTML='<table class="sum"><thead><tr><th>محصول</th><th>تعداد</th><th>قیمت</th><th>جمع</th><th></th></tr></thead><tbody>'+
    items.map(function(l){return '<tr><td>'+l.title+'</td><td><button class="btn" data-step="-1" data-id="'+l.id+'">−</button> '+fa(l.qty)+
    ' <button class="btn" data-step="1" data-id="'+l.id+'">+</button></td><td>'+money(l.price)+'</td><td>'+money(l.price*l.qty)+
    '</td><td><button class="btn" data-remove="'+l.id+'">حذف</button></td></tr>'}).join('')+
    '</tbody></table><p class="note">جمع اولیه: <b>'+money(items.reduce(function(s,l){return s+l.price*l.qty},0))+'</b> — مبلغ نهایی با ارسال و مالیات هنگام ثبت سفارش روی سرور محاسبه می‌شود.</p>';
  paint();
}
var place=document.getElementById('placeOrder');
if(place)place.addEventListener('click',async function(){
  var out=document.getElementById('payResult'),gateway=(document.querySelector('input[name=gateway]:checked')||{}).value;
  if(!gateway){out.innerHTML='<span class="bad">یک روش پرداخت انتخاب کنید.</span>';return}
  var items=read();if(!items.length){out.innerHTML='<span class="bad">سبد خرید خالی است.</span>';return}
  place.disabled=true;out.textContent='در حال ثبت سفارش…';
  try{
    var response=await fetch('/api/shop/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      gateway:gateway,items:items.map(function(l){return {id:l.id,qty:l.qty}}),
      customer:{name:(document.getElementById('cname')||{}).value,phone:(document.getElementById('cphone')||{}).value,
        address:(document.getElementById('caddress')||{}).value,note:(document.getElementById('cnote')||{}).value}})});
    var body=await response.json();
    if(!body.ok){out.innerHTML='<span class="bad">'+(body.error||'ثبت سفارش ناموفق بود.')+'</span>';place.disabled=false;return}
    localStorage.removeItem(KEY);
    if(body.redirect){out.innerHTML='<span class="ok">در حال انتقال به درگاه…</span>';location.href=body.redirect;return}
    location.href='/order/'+encodeURIComponent(body.orderId);
  }catch(error){out.innerHTML='<span class="bad">'+error+'</span>';place.disabled=false}
});
var receipt=document.getElementById('sendReceipt');
if(receipt)receipt.addEventListener('click',async function(){
  var out=document.getElementById('receiptResult'),reference=(document.getElementById('receiptRef')||{}).value||'';
  out.textContent='در حال ثبت…';
  var response=await fetch('/api/shop/receipt',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({orderId:receipt.dataset.order,reference:reference})});
  var body=await response.json();
  out.innerHTML=body.ok?'<span class="ok">رسید ثبت شد؛ پس از تأیید فروشنده سفارش پردازش می‌شود.</span>':'<span class="bad">'+(body.error||'ثبت نشد')+'</span>';
  if(body.ok)setTimeout(function(){location.reload()},1200);
});
var save=document.getElementById('saveShop');
if(save)save.addEventListener('click',async function(){
  var out=document.getElementById('shopSaveResult'),shop={card:{}},payments={};
  document.querySelectorAll('[data-shop]').forEach(function(el){
    var key=el.dataset.shop,value=el.type==='checkbox'?el.checked:el.value;
    if(key.indexOf('card.')===0)shop.card[key.slice(5)]=value;else shop[key]=value;
  });
  document.querySelectorAll('[data-pay]').forEach(function(el){
    var id=el.dataset.pay;payments[id]=payments[id]||{};
    payments[id][el.dataset.key]=el.type==='checkbox'?el.checked:el.value;
  });
  out.textContent='در حال ذخیره…';
  var response=await fetch('/api/shop/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shop:shop,payments:payments})});
  var body=await response.json();
  out.innerHTML=body.ok?'<span class="ok">ذخیره شد.</span>':'<span class="bad">'+(body.error||'ذخیره نشد')+'</span>';
});
renderCart();paint();
})();`;

export function totalsSummary(totals: OrderTotals, settings: ShopSettings): string {
  return `${money(totals.subtotal)} + ارسال ${money(totals.shipping)} + مالیات ${money(totals.tax)} = ${money(totals.total)} ${settings.currency}`;
}
