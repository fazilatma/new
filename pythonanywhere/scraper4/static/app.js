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
  await api('/api/profiles', 'POST', {detailSelectors, key:data.key, name:data.name, url:data.url, selectors, pagination:{type:data.pagType, val:data.pagVal}});
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
    for(const key of ['key','name','url']) profileForm.elements[key].value = profile[key];
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
  if(data.kind !== 'extract' && !confirm('ارسال به فروشگاه انجام شود؟ قبل از تلاش مجدد، محصولات مقصد را بررسی کنید.')) return false;
  const result = await api('/api/jobs','POST', data);
  message(`کار ${result.id} به صف اضافه شد. کران خارجی یا worker آن را ادامه می‌دهد.`);
  await poll();
});
document.querySelectorAll('.connection-form').forEach(form => {
  handle(form, async data => { await api(`/api/connections/${form.dataset.name}`,'POST',data); message('اتصال ذخیره شد.'); });
  api(`/api/connections/${form.dataset.name}`).then(result => {
    if(window.S4Refresh?.isDirty(form)) return;
    for(const [key,value] of Object.entries(result.fields)) if(form.elements[key]) form.elements[key].value = value;
  }).catch(error => message(error.message));
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
async function refresh() { try { await poll(); } catch(error) { message(error.message); } finally { setTimeout(refresh,5000); } }
refresh();

// Management operations are queued; a Scheduled Task performs them outside WSGI.
const systemState = document.querySelector('#system-state');
async function systemPoll() {
  try {
    const data = await api('/api/system/status');
    const update = data.updates;
    const operation = update.operation || {};
    systemState.textContent = JSON.stringify({running:data.runtime, domain:data.platform.domain, platform:data.platform.provisioning,
      auto_update:update.config, current:update.current, latest:update.state.latest,
      update_available:update.state.available, error:update.state.error,
      operation:operation}, null, 2);
    document.querySelector('#auto-update').checked = update.config.enabled;
  } catch(error) { systemState.textContent = error.message; }
  finally { setTimeout(systemPoll,15000); }
}
document.querySelectorAll('[data-maintenance]').forEach(button => button.onclick = async () => {
  if(['apply','rollback'].includes(button.dataset.maintenance) && !confirm('تغییر نسخهٔ برنامه از طریق Task انجام شود؟ قبل از ارتقا نسخهٔ پشتیبان گرفته می‌شود.')) return;
  try {
    const path = ['reload','configure'].includes(button.dataset.maintenance) ? '/api/system/' : '/api/updates/';
    const result = await api(path + button.dataset.maintenance, 'POST', {});
    message(`درخواست ${result.operation.action} ثبت شد؛ Task زمان‌بندی‌شده آن را اجرا می‌کند.`);
  } catch(error) { message(error.message); }
});
document.querySelector('#auto-update').onchange = async event => {
  try { await api('/api/updates/config', 'POST', {enabled:event.target.checked, interval_seconds:3600}); message('تنظیم اتوآپدیت ذخیره شد.'); }
  catch(error) { message(error.message); }
};
document.querySelector('#api-token-create').onclick = async () => {
  if(!confirm('کلید جدید همهٔ دسترسی‌های مدیر را دارد و کلید قبلی را باطل می‌کند. ادامه؟')) return;
  try {
    const result = await api('/api/auth/token','POST',{});
    document.querySelector('#api-token-value').textContent = result.token;
    message('کلید فقط همین‌بار نمایش داده می‌شود؛ آن را محرمانه نگه دارید.');
  } catch(error) { message(error.message); }
};
document.querySelector('#api-token-revoke').onclick = async () => {
  try { await api('/api/auth/token','DELETE'); document.querySelector('#api-token-value').textContent = ''; message('کلید API باطل شد.'); }
  catch(error) { message(error.message); }
};
systemPoll();


document.querySelector('#cron-key-create').onclick = async () => {
  if(!confirm('کلید جدید کران ساخته شود؟ کلید قبلی باطل خواهد شد.')) return;
  try {
    const data = await api('/api/cron/token','POST',{});
    document.querySelector('#cron-key-value').textContent = data.token;
    message('کلید فقط همین‌بار نمایش داده می‌شود؛ آن را در هدر Authorization کران خارجی قرار دهید.');
  } catch(error) { message(error.message); }
};
document.querySelector('#cron-key-revoke').onclick = async () => {
  try {
    await api('/api/cron/token','DELETE');
    document.querySelector('#cron-key-value').textContent = '';
    message('کلید کران باطل شد.');
  } catch(error) { message(error.message); }
};
document.querySelector('#cron-status').onclick = async () => {
  try { document.querySelector('#cron-result').textContent = JSON.stringify(await api('/api/cron/status'),null,2); }
  catch(error) { message(error.message); }
};


const publicCron = document.querySelector('#cron-public-get');
api('/api/cron/config').then(data => { publicCron.checked = data.config.public_get; })
  .catch(error => message(error.message));
publicCron.onchange = async () => {
  const enabled = publicCron.checked;
  if (enabled && !confirm('کران بدون کلید عمومی می‌شود. هر بازدیدکننده می‌تواند صف استخراج/ارسال ثبت‌شده را جلو ببرد و منابع حساب را مصرف کند. تأیید می‌کنید؟')) {
    publicCron.checked = false;
    return;
  }
  publicCron.disabled = true;
  try {
    await api('/api/cron/config', 'POST', {public_get: enabled});
    message(enabled ? 'GET عمومی فعال شد؛ آدرس /api/cron/run بدون کلید قابل فراخوانی است.' : 'GET عمومی خاموش شد؛ POST دارای کلید همچنان در دسترس است.');
  } catch(error) {
    publicCron.checked = !enabled;
    message(error.message);
  } finally { publicCron.disabled = false; }
};

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
    const url = new URL(value, location.origin);
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
  const query = document.querySelector('#products-search').value.trim().toLocaleLowerCase('fa');
  const filtered = productRows.filter(p => `${p.title || ''} ${p.sku || ''}`.toLocaleLowerCase('fa').includes(query));
  for(const product of filtered) {
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
    if(link) body.append(sourceLink(link));
    card.append(image,body); grid.append(card);
    const row = document.createElement('tr');
    for(const value of [product.title,product.price,product.sku,product.woo_id || '—',product.basalam_id || '—']) cell(row, value || '—');
    const last = cell(row, ''); if(link) last.append(sourceLink(link));
    rows.append(row);
  }
  grid.hidden = tableView; document.querySelector('#product-table-wrap').hidden = !tableView;
  document.querySelector('#products-status').textContent = filtered.length ? `${filtered.length.toLocaleString('fa-IR')} محصول در این صفحه` : (productRows.length ? 'در صفحهٔ فعلی نتیجه‌ای مطابق جست‌وجو نیست.' : 'هنوز محصولی برای نمایش وجود ندارد. ابتدا استخراج را اجرا کنید.');
}
async function loadProducts() {
  const ticket = ++productsRequest;
  const profile = document.querySelector('#results-profile').value;
  const params = new URLSearchParams({limit:productLimit, offset:productOffset, summary:'1'});
  if(profile) params.set('profile_id', profile);
  document.querySelector('#products-status').textContent = 'در حال دریافت محصولات…';
  try {
    const result = await api('/api/products?' + params);
    if(ticket !== productsRequest) return;
    productRows = result.products; productTotal = result.total;
    document.querySelector('#products-count').textContent = `${productTotal.toLocaleString('fa-IR')} محصول`;
    document.querySelector('#products-page').textContent = productTotal ? `${productOffset + 1}–${productOffset + productRows.length} از ${productTotal}` : '۰ محصول';
    document.querySelector('#products-prev').disabled = productOffset === 0;
    document.querySelector('#products-next').disabled = productOffset + productLimit >= productTotal;
    for(const format of ['csv','json']) {
      const anchor = document.querySelector(`#products-${format}`);
      anchor.hidden = !profile;
      if(profile) anchor.href = `/api/export/${encodeURIComponent(profile)}?format=${format}`;
      else anchor.removeAttribute('href');
    }
    document.querySelector('#export-hint').hidden = Boolean(profile);
    paintProducts();
  } catch(error) {
    if(ticket === productsRequest) document.querySelector('#products-status').textContent = error.message;
  }
}
document.querySelector('#products-search').oninput = paintProducts;
document.querySelector('#results-profile').onchange = () => { productOffset = 0; loadProducts(); };
document.querySelector('#products-refresh').onclick = loadProducts;
document.querySelector('#products-prev').onclick = () => { productOffset = Math.max(0,productOffset-productLimit); loadProducts(); };
document.querySelector('#products-next').onclick = () => { productOffset += productLimit; loadProducts(); };
document.querySelector('#products-view').onclick = event => {
  tableView = !tableView; event.currentTarget.setAttribute('aria-pressed', String(tableView));
  event.currentTarget.textContent = tableView ? 'نمای کارت' : 'نمای جدول'; paintProducts();
};
activateTab(location.hash.slice(1), false);


const agentDeployEnabled = document.querySelector('#agent-deploy-enabled');
api('/api/deploy/config').then(data => {
  agentDeployEnabled.checked = data.config.enabled;
  document.querySelector('#agent-deploy-state').textContent = JSON.stringify({host:data.host, ready:data.ready, mode:data.mode}, null, 2);
}).catch(error => { document.querySelector('#agent-deploy-state').textContent = error.message; });
agentDeployEnabled.onchange = async () => {
  const enabled = agentDeployEnabled.checked;
  try {
    await api('/api/deploy/config', 'POST', {enabled});
    message(enabled ? 'استقرار نسخه‌های دارای امضای معتبر فعال شد.' : 'استقرار عامل غیرفعال شد.');
  } catch(error) { agentDeployEnabled.checked = !enabled; message(error.message); }
};


document.querySelector('#detail-woo-defaults').onclick = () => {
  const defaults = {shortDesc:'.woocommerce-product-details__short-description',longDesc:'#tab-description',specs:'.woocommerce-product-attributes',images:'.woocommerce-product-gallery img',sku:'.product_meta .sku',brand:'.product_meta .brand',category:'.product_meta .posted_in a',tags:'.product_meta .tagged_as'};
  for(const [key,value] of Object.entries(defaults)) profileForm.elements['detail_'+key].value = value;
  window.S4Refresh?.changed(profileForm);
  message('سلکتورهای رایج ووکامرس وارد شدند؛ آن‌ها را با سایت مبدأ تطبیق دهید و سپس پروفایل را ذخیره کنید.');
};
