/* Paginated trusted browser using the existing dashboard API/controller contract. */
(()=>{'use strict';
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
async function api(url){const r=await fetch(url);const d=await r.json();if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;}
let productOffset = 0, productTotal = 0, productRows = [], productsRequest = 0, tableView = false;
const productLimit = 100;
function safeProductUrl(value, image = false) {
  if(!value) return '';
  try {
    if(typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
    const url = new URL(value);
    if(url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return '';
    return (image ? url.protocol === 'https:' : ['https:','http:'].includes(url.protocol)) ? url.href : '';
  } catch { return ''; }
}
function sourceLink(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'مشاهدهٔ منبع ↗';
  return a;
}
function paintProducts() {
  const grid = document.querySelector('#product-grid');
  const rows = document.querySelector('#product-rows');
  grid.replaceChildren(); rows.replaceChildren();
  for(const product of productRows) {
    const card = document.createElement('article'); card.className = 'product-card';
    const image = document.createElement('div'); image.className = 'product-image'; image.textContent = '📦';
    const src = safeProductUrl(product.image, true);
    if(src) {
      const img = document.createElement('img'); img.src = src; img.alt = product.title || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.remove(); image.textContent = '📦'; };
      image.replaceChildren(img);
    }
    const body = document.createElement('div'); body.className = 'product-body';
    const title = document.createElement('h3'); title.textContent = product.title || 'بدون عنوان';
    const price = document.createElement('div'); price.className = 'product-price'; price.textContent = product.price || 'قیمت ثبت نشده';
    const meta = document.createElement('div'); meta.className = 'product-meta';
    meta.textContent = `${product.sku || 'بدون کد'} · ووکامرس: ${product.woo_id ? 'مرتبط' : 'ارسال نشده'} · باسلام: ${product.basalam_id ? 'مرتبط' : 'ارسال نشده'}`;
    body.append(title, price, meta);
    if(product.extra?._detail_preview || product.extra?.brand || product.extra?.category || product.extra?.tags || product.extra?.images_count) {
      const details = document.createElement('details'), summary = document.createElement('summary'), info = document.createElement('p');
      summary.textContent = 'اطلاعات تکمیلی';
      info.textContent = [product.extra.category ? `دسته: ${product.extra.category}` : '', product.extra.tags ? `برچسب‌ها: ${product.extra.tags}` : '', product.extra.brand ? `برند: ${product.extra.brand}` : '', product.extra.images_count ? `${product.extra.images_count} تصویر` : '', product.extra._detail_preview || ''].filter(Boolean).join(' · ');
      details.append(summary, info); body.append(details);
    }
    const link = safeProductUrl(product.link);
    const detailButton = () => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary product-detail-button';
      button.textContent = 'جزئیات و گالری'; button.disabled = !Number.isInteger(product.id);
      button.onclick = () => window.S4Products?.open(product.id, button);
      return button;
    };
    if(product.profile_name) {const profile = document.createElement('p'); profile.className = 'product-profile'; profile.textContent = product.profile_name; body.append(profile);}
    const actions = document.createElement('div'); actions.className = 'product-card-actions'; actions.append(detailButton());
    if(link) actions.append(sourceLink(link)); body.append(actions);
    card.append(image,body); grid.append(card);
    const row = document.createElement('tr');
    for(const value of [product.title,product.price,product.sku,product.woo_id || '—',product.basalam_id || (product.basalam_linked ? 'غرفه‌های دیگر · جزئیات' : '—')]) cell(row, value || '—');
    const last = cell(row, ''); last.append(detailButton()); if(link) last.append(sourceLink(link));
    rows.append(row);
  }
  grid.hidden = tableView; document.querySelector('#product-table-wrap').hidden = !tableView;
  document.querySelector('#products-status').textContent = productRows.length ? `${productRows.length.toLocaleString('fa-IR')} محصول در این صفحه از ${productTotal.toLocaleString('fa-IR')} نتیجه` : 'نتیجه‌ای برای این جست‌وجو و فیلتر نیست. فیلتر را پاک کنید یا استخراج را اجرا کنید.';
}
async function loadProducts() {
  const ticket = ++productsRequest;
  const profile = document.querySelector('#results-profile').value;
  const params = new URLSearchParams({limit:productLimit, offset:productOffset, summary:'1'});
  if(profile) params.set('profile_id', profile);
  params.set('q', document.querySelector('#products-search').value.trim());
  params.set('filter', document.querySelector('#products-filter').value);
  params.set('sort', document.querySelector('#products-sort').value);
  document.querySelector('#products-prev').disabled = true; document.querySelector('#products-next').disabled = true;
  document.querySelector('#product-grid').setAttribute('aria-busy','true');
  document.querySelector('#products-status').textContent = 'در حال دریافت محصولات…';
  for(const format of ['csv','json']) {
    const anchor = document.querySelector(`#products-${format}`);
    anchor.hidden = !profile;
    if(profile) anchor.href = `/api/export/${encodeURIComponent(profile)}?format=${format}`;
    else anchor.removeAttribute('href');
  }
  document.querySelector('#export-hint').hidden = Boolean(profile);
  try {
    const result = await api('/api/products?' + params);
    if(ticket !== productsRequest) return;
    productRows = result.products; productTotal = result.total;
    if(Number.isSafeInteger(result.offset)) productOffset = result.offset;
    document.querySelector('#products-count').textContent = `${productTotal.toLocaleString('fa-IR')} محصول`;
    document.querySelector('#products-page').textContent = productTotal ? `${productOffset + 1}–${productOffset + productRows.length} از ${productTotal}` : '۰ محصول';
    document.querySelector('#products-prev').disabled = productOffset === 0;
    document.querySelector('#products-next').disabled = productOffset + productLimit >= productTotal;
    paintProducts();
  } catch(error) {
    if(ticket === productsRequest) {
      productRows = []; paintProducts();
      document.querySelector('#products-count').textContent = '—'; document.querySelector('#products-page').textContent = '—';
      document.querySelector('#products-prev').disabled = true; document.querySelector('#products-next').disabled = true;
      document.querySelector('#products-status').textContent = error.message;
    }
  } finally {if(ticket === productsRequest) document.querySelector('#product-grid').setAttribute('aria-busy','false');}
}
let searchTimer;
document.querySelector('#products-search').oninput = () => {
  ++productsRequest; clearTimeout(searchTimer); productOffset = 0;
  document.querySelector('#products-prev').disabled = true; document.querySelector('#products-next').disabled = true;
  document.querySelector('#products-status').textContent = 'در حال جست‌وجو در همهٔ نتایج…';
  searchTimer = setTimeout(loadProducts, 250);
};
for(const id of ['products-filter','products-sort']) document.querySelector('#'+id).onchange = () => {productOffset = 0; loadProducts();};
document.querySelector('#products-clear').onclick = () => {
  clearTimeout(searchTimer); document.querySelector('#products-search').value = '';
  document.querySelector('#products-filter').value = 'all'; document.querySelector('#products-sort').value = 'newest';
  document.querySelector('#results-profile').value = '';
  productOffset = 0; loadProducts();
};
window.S4Browse = (metric = 'all', profile = '', name = '') => {
  clearTimeout(searchTimer); document.querySelector('#products-search').value = '';
  document.querySelector('#products-filter').value = metric;
  const select = document.querySelector('#results-profile');
  if(profile && !Array.from(select.options).some(option => option.value === String(profile))) select.add(new Option(name || `پروفایل #${profile}`, String(profile)));
  select.value = String(profile);
  productOffset = 0; loadProducts();
  document.querySelector('#products-search').focus(); document.querySelector('#php-tools').scrollIntoView({block:'start'});
};
document.querySelector('#results-profile').onchange = () => { productOffset = 0; loadProducts(); };
document.querySelector('#products-refresh').onclick = loadProducts;
document.querySelector('#products-prev').onclick = () => { productOffset = Math.max(0,productOffset-productLimit); loadProducts(); };
document.querySelector('#products-next').onclick = () => { productOffset += productLimit; loadProducts(); };
document.querySelector('#products-view').onclick = event => {
  tableView = !tableView; event.currentTarget.setAttribute('aria-pressed', String(tableView));
  event.currentTarget.textContent = tableView ? 'نمای کارت' : 'نمای جدول'; paintProducts();
};

})();
