const csrf = document.querySelector('meta[name="csrf"]').content;
const message = text => { document.querySelector('#message').textContent = text; };
async function api(url, method = 'GET', data) {
  const mutating = !['GET','HEAD'].includes(method.toUpperCase());
  if(mutating) window.S4Refresh?.beginMutation();
  try {
    const response = await fetch(url, {method, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: data === undefined ? undefined : JSON.stringify(data)});
    if (response.status === 401) { location.href = '/login'; throw Error('ورود دوباره لازم است.'); }
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    return result;
  } finally { if(mutating) window.S4Refresh?.endMutation(); }
}
function handle(form, callback) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const revision = window.S4Refresh?.revision(form);
    window.S4Refresh?.submitting(form, true);
    try {
      if(await callback(Object.fromEntries(new FormData(form))) !== false) window.S4Refresh?.clean(form, revision);
    } catch(error) { message(error.message); }
    finally { window.S4Refresh?.submitting(form, false); }
  });
}
const profileForm = document.querySelector('#profile-form');
handle(profileForm, async data => {
  const selectors = Object.fromEntries(['container','title','price','link','image','sku'].map(k => [k, data[k]]).filter(([,v]) => v));
  const detailSelectors = Object.fromEntries(['shortDesc','longDesc','specs','images','sku','brand','category','tags'].map(key => [key, data['detail_'+key] || '']).filter(([,value]) => value.trim()));
  await api('/api/profiles', 'POST', {detailSelectors, extractionEngine:data.extractionEngine, key:data.key, name:data.name, url:data.url, selectors, pagination:{type:data.pagType, val:data.pagVal}});
  location.reload();
});
document.querySelector('#preview').onclick = async () => {
  try {
    const data = Object.fromEntries(new FormData(profileForm));
    const result = await api('/api/pagination/preview?' + new URLSearchParams({url:data.url,type:data.pagType,val:data.pagVal,pages:3}));
    document.querySelector('#preview-result').textContent = result.urls.join('\n');
  } catch(error) { message(error.message); }
};
document.querySelectorAll('.edit').forEach(button => button.onclick = async () => {
  try {
    const {profiles} = await api('/api/profiles');
    const profile = profiles.find(p => p.id === Number(button.dataset.id));
    if(window.S4Start&&window.S4Start.select(profile.id)===false)return;
    for(const key of ['key','name','url']) profileForm.elements[key].value = profile[key];
    profileForm.elements.extractionEngine.value = profile.extraction_engine || profile.settings?.extractionEngine || 'selectors';
    profileForm.elements.pagType.value = profile.pagination.type || 'query_page';
    profileForm.elements.pagVal.value = profile.pagination.val || '';
    for(const key of ['container','title','price','link','image','sku']) profileForm.elements[key].value = profile.selectors[key] || '';
    for(const key of ['shortDesc','longDesc','specs','images','sku','brand','category','tags']) {
      const saved = profile.settings?.detailSelectors?.[key];
      profileForm.elements['detail_'+key].value = typeof saved === 'string' ? saved : (saved?.enabled === false ? '' : saved?.selector || '');
    }
    window.S4Refresh?.changed(profileForm);
    activateTab('selectors');
    profileForm.scrollIntoView({behavior:'smooth'});
  } catch(error) { message(error.message); }
});
document.querySelectorAll('.delete').forEach(button => button.onclick = async () => {
  if(!confirm('پروفایل و همه محصولات آن حذف شود؟')) return;
  try { await api(`/api/profiles/${button.dataset.id}`, 'DELETE'); location.reload(); } catch(error) { message(error.message); }
});
handle(document.querySelector('#job-form'), async data => {
  if(window.S4Start) return window.S4Start.enqueue(data);
  if(data.kind !== 'extract' && !confirm('ارسال به فروشگاه انجام شود؟ قبل از تلاش مجدد، محصولات مقصد را بررسی کنید.')) return false;
  const result = await api('/api/jobs','POST', data);
  window.dispatchEvent(new Event('s4:extraction-enqueued'));
  message(`کار ${result.id} به صف اضافه شد. کران خارجی یا worker آن را ادامه می‌دهد.`);
  await poll();
});
function cell(row, text) { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; }
const labels = {waiting:'در انتظار',running:'در حال اجرا',paused:'مکث',failed:'خطا',done:'تمام‌شده',cancelled:'لغو شده'};
async function poll() {
  const result = await api('/api/jobs');
  for(const key of ['profiles','products','queue_alive']) document.querySelector(`#stat-${key}`).textContent = result.stats[key];
  const tbody = document.querySelector('#jobs'); tbody.replaceChildren();
  for(const job of result.jobs) {
    const row = document.createElement('tr');
    cell(row, job.id); cell(row, job.kind); cell(row, labels[job.status] || job.status);
    cell(row, `${job.counters.current || 0} / ${job.counters.total || 0}` + (job.counters.phase === 'detail' ? ` · جزئیات ${job.counters.detail_current || 0}/${job.counters.detail_total || 0}` : job.counters.detail_enriched ? ` · ${job.counters.detail_enriched} جزئیات` : '')); cell(row,job.error);
    const controls = cell(row,'');
    if(!['done','cancelled'].includes(job.status)) for(const [action,title] of [['pause','مکث'],['resume','ادامه'],['cancel','لغو']]) {
      if(action === 'resume' && !['paused','failed'].includes(job.status)) continue;
      if(action === 'pause' && !['waiting','running'].includes(job.status)) continue;
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = title;
      button.onclick = async () => { try {
        if(job.status === 'failed' && action === 'resume' && !confirm('قبل از ارسال مجدد، محصول را در مقصد بررسی کرده‌اید؟')) return;
        await api(`/api/jobs/${job.id}/${action}`,'POST',{}); await poll();
      } catch(error) { message(error.message); } };
      controls.append(button);
    }
    tbody.append(row);
  }
}
window.addEventListener('s4:start-queued',()=>poll().catch(error=>message(error.message)));
async function refresh() { try { await poll(); } catch(error) { message(error.message); } finally { setTimeout(refresh,5000); } }
refresh();

// Match the PHP navigation without exposing unavailable PHP-only controls.
const tabNames = ['start','settings','selectors','results','send'];
function activateTab(name, updateHash = true) {
  if(!tabNames.includes(name)) name = 'start';
  for(const key of tabNames) {
    const active = key === name;
    document.querySelector(`#pane-${key}`).classList.toggle('active', active);
    document.querySelector(`#pane-${key}`).hidden = !active;
    const tab = document.querySelector(`#tab-${key}`);
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  if(updateHash) history.replaceState(null, '', '#' + name);
  if(name === 'results') loadProducts();
}
document.querySelectorAll('[data-tab]').forEach(button => {
  button.onclick = () => activateTab(button.dataset.tab);
  button.onkeydown = event => {
    let index = tabNames.indexOf(button.dataset.tab);
    if(event.key === 'ArrowLeft') index = (index + 1) % tabNames.length;
    else if(event.key === 'ArrowRight') index = (index + tabNames.length - 1) % tabNames.length;
    else if(event.key === 'Home') index = 0;
    else if(event.key === 'End') index = tabNames.length - 1;
    else return;
    event.preventDefault(); activateTab(tabNames[index]);
    document.querySelector(`#tab-${tabNames[index]}`).focus();
  };
});
document.querySelectorAll('[data-open-tab]').forEach(button => button.onclick = () => activateTab(button.dataset.openTab));
window.addEventListener('hashchange', () => activateTab(location.hash.slice(1), false));
handle(document.querySelector('#send-form'), async data => {
  if(!confirm('محصولات این پروفایل به مقصد انتخاب‌شده ارسال شوند؟ اتصال و قیمت‌ها را بررسی کرده‌اید؟')) return false;
  if(!data.category_id) delete data.category_id;
  const result = await api('/api/jobs', 'POST', data);
  activateTab('start');
  message(`ارسال ${result.id} به صف اضافه شد؛ کران یا worker آن را ادامه می‌دهد.`);
  await poll();
});

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
  productOffset = 0; activateTab('results');
  document.querySelector('#products-search').focus(); document.querySelector('#pane-results').scrollIntoView({block:'start'});
};
document.querySelector('#results-profile').onchange = () => { productOffset = 0; loadProducts(); };
document.querySelector('#products-refresh').onclick = loadProducts;
document.querySelector('#products-prev').onclick = () => { productOffset = Math.max(0,productOffset-productLimit); loadProducts(); };
document.querySelector('#products-next').onclick = () => { productOffset += productLimit; loadProducts(); };
document.querySelector('#products-view').onclick = event => {
  tableView = !tableView; event.currentTarget.setAttribute('aria-pressed', String(tableView));
  event.currentTarget.textContent = tableView ? 'نمای کارت' : 'نمای جدول'; paintProducts();
};
activateTab(location.hash.slice(1), false);


document.querySelector('#detail-woo-defaults').onclick = () => {
  const defaults = {shortDesc:'.woocommerce-product-details__short-description',longDesc:'#tab-description',specs:'.woocommerce-product-attributes',images:'.woocommerce-product-gallery img',sku:'.product_meta .sku',brand:'.product_meta .brand',category:'.product_meta .posted_in a',tags:'.product_meta .tagged_as'};
  for(const [key,value] of Object.entries(defaults)) profileForm.elements['detail_'+key].value = value;
  window.S4Refresh?.changed(profileForm);
  message('سلکتورهای رایج ووکامرس وارد شدند؛ آن‌ها را با سایت مبدأ تطبیق دهید و سپس پروفایل را ذخیره کنید.');
};

window.addEventListener('s4:extraction-updated', () => {poll().catch(error => message(error.message)); if(document.querySelector('#pane-results').classList.contains('active')) loadProducts();});
