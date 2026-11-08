/* Read-only product overview and on-demand details; never inserts external HTML. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const overview = $('#product-overview');
  const dialog = $('#product-detail');
  if(!overview || !dialog) return;
  const metrics = [
    ['all', 'کل محصولات', '◈', 'تمام رکوردهای ذخیره‌شده', 'blue'],
    ['priced', 'دارای قیمت', '↗', 'قیمت عددی بزرگ‌تر از صفر', 'green'],
    ['no_price', 'بدون قیمت', '—', 'قیمت عددی صفر، منفی یا ثبت‌نشده', 'amber'],
    ['with_image', 'تصویر شاخص', '▧', 'فیلد تصویر اصلی ثبت شده است؛ نه گالری', 'purple'],
    ['linked', 'لینک مبدأ', '↗', 'فیلد لینک مبدأ ثبت شده است', 'blue'],
    ['sku', 'دارای SKU', '#', 'کد محصول ذخیره شده است', 'purple'],
    ['woo_linked', 'شناسهٔ ووکامرس', 'W', 'شناسهٔ مقصد محلی؛ نه موجودی زنده', 'green'],
    ['bsl_linked', 'شناسهٔ باسلام', 'B', 'شناسهٔ مقصد محلی؛ نه موجودی زنده', 'amber'],
  ];
  const number = value => Number(value || 0).toLocaleString('fa-IR');
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if(text !== undefined) element.textContent = String(text);
    if(className) element.className = className;
    return element;
  };
  async function read(url) {
    const response = await fetch(url, {cache: 'no-store', credentials: 'same-origin'});
    const result = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(response.status === 401 ? 'نشست شما پایان یافته است؛ دوباره وارد شوید.' : result.error || 'دریافت داده ناموفق بود. دوباره تلاش کنید.');
    return result;
  }
  const metricNodes = new Map();
  for(const [key, title, icon, help, tone] of metrics) {
    const button = node('button', undefined, `metric-card metric-${tone}`); button.type = 'button';
    button.dataset.metric = key; button.disabled = true; button.title = help;
    const value = node('strong', '—', 'metric-value');
    const percent = node('span', '—', 'metric-percent');
    const symbol = node('span', icon, 'metric-icon'); symbol.setAttribute('aria-hidden', 'true');
    button.append(symbol, node('span', title, 'metric-label'), value, percent, node('small', help));
    button.onclick = () => window.S4Browse(key);
    metricNodes.set(key, {button, value, percent}); $('#overview-metrics').append(button);
  }
  let overviewRequest = 0;
  async function refreshOverview() {
    const ticket = ++overviewRequest;
    $('#overview-status').textContent = 'در حال محاسبهٔ آمار ذخیره‌شده…';
    overview.setAttribute('aria-busy', 'true');
    try {
      const data = await read('/api/products/overview');
      if(ticket !== overviewRequest) return;
      const total = Number(data.totals.all);
      for(const [key, parts] of metricNodes) {
        const count = Number(data.totals[key]); parts.value.textContent = number(count);
        parts.percent.textContent = `${number(total ? Math.round(count * 100 / total) : 0)}٪ از کل`;
        parts.button.disabled = false;
      }
      const rows = $('#overview-profiles'); rows.replaceChildren();
      for(const profile of data.by_profile) {
        const row = node('tr'); const name = node('td');
        name.append(node('strong', profile.name));
        if(!profile.enabled) name.append(node('small', 'غیرفعال', 'muted'));
        row.append(name);
        for(const key of ['all', 'priced', 'with_image', 'woo_linked', 'bsl_linked']) {
          const td = node('td'); const button = node('button', number(profile.counts[key]), 'count-drilldown'); button.type = 'button';
          button.setAttribute('aria-label', `${profile.name} · ${metrics.find(metric => metric[0] === key)[1]} · ${number(profile.counts[key])}`);
          button.onclick = () => window.S4Browse(key, profile.id, profile.name); td.append(button);
          if(key === 'priced') {
            const progress = node('progress'); progress.max = Math.max(1, profile.counts.all); progress.value = profile.counts.priced;
            progress.setAttribute('aria-label', 'سهم محصولات دارای قیمت'); td.append(progress);
          }
          row.append(td);
        }
        const action = node('td'); const browse = node('button', 'مشاهده ←', 'secondary'); browse.type = 'button';
        browse.onclick = () => window.S4Browse('all', profile.id, profile.name); action.append(browse); row.append(action); rows.append(row);
      }
      if(!data.by_profile.length) {const row = node('tr'); const cell = node('td', 'هنوز پروفایلی ثبت نشده است.', 'muted'); cell.colSpan = 7; row.append(cell); rows.append(row);}
      $('#overview-status').textContent = `${number(total)} محصول · ${number(data.by_profile.length)} پروفایل · به‌روزرسانی ${new Date().toLocaleTimeString('fa-IR')}`;
    } catch(error) {
      if(ticket === overviewRequest) $('#overview-status').textContent = `آمار تازه دریافت نشد؛ اعداد قبلی ممکن است قدیمی باشند. ${error.message}`;
    } finally {if(ticket === overviewRequest) overview.setAttribute('aria-busy', 'false');}
  }
  $('#overview-refresh').onclick = refreshOverview;
  window.addEventListener('s4:extraction-updated', refreshOverview);
  refreshOverview();
  setInterval(() => {if(!document.hidden && !overview.contains(document.activeElement) && $('#pane-start')?.classList.contains('active')) refreshOverview();}, 60000);

  function safeUrl(value, image = false) {
    if(typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
    try {
      const url = new URL(value);
      if(url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) return '';
      return (image ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) ? url.href : '';
    } catch {return '';}
  }
  const body = $('#product-detail-body');
  const status = $('#product-detail-status');
  let detailRequest = 0, trigger = null;
  function closeDetails() {
    ++detailRequest;
    if(dialog.open) dialog.close();
  }
  $('#product-detail-close').onclick = closeDetails;
  dialog.addEventListener('close', () => {++detailRequest; body.setAttribute('aria-busy', 'false'); if(trigger?.isConnected) trigger.focus();});
  dialog.addEventListener('cancel', event => {event.preventDefault(); closeDetails();});
  dialog.addEventListener('click', event => {
    if(event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if(event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDetails();
  });
  function addTextSection(title, text) {
    if(!text) return;
    const section = node('section', undefined, 'detail-text'); section.append(node('h3', title), node('p', text)); body.append(section);
  }
  function renderDetail(payload) {
    const fields = payload.details;
    const product = {...payload.product, ...fields, gallery: fields.images,
      specs: fields.specs.map(row => ({name: row.k, value: row.v})),
      short_description: fields.shortDesc_text, description: fields.longDesc_text};
    $('#product-detail-title').textContent = product.title || 'محصول بدون عنوان';
    const summary = node('dl', undefined, 'detail-facts');
    const facts = [
      ['قیمت ذخیره‌شده', product.price || 'ثبت نشده'], ['پروفایل', product.profile_name], ['SKU', product.sku || '—'],
      ['شناسهٔ محلی', product.id], ['شناسهٔ ووکامرس', product.woo_id || '—'], ['شناسهٔ باسلام', product.basalam_id || '—'],
      ['دستهٔ مبدأ', product.category || '—'], ['برند مبدأ', product.brand || '—'], ['برچسب‌ها', product.tags || '—'],
      ['زمان ثبت', product.created_at || '—'], ['آخرین تغییر محلی', product.updated_at || '—'],
    ];
    for(const [label, value] of facts) {const group = node('div'); group.append(node('dt', label), node('dd', value ?? '—')); summary.append(group);}
    body.append(summary);
    const source = safeUrl(product.link);
    if(fields.basalam_targets && Object.keys(fields.basalam_targets).length) addTextSection('شناسه‌های مقصد به تفکیک غرفهٔ باسلام',Object.entries(fields.basalam_targets).map(([vendor,id])=>`غرفه ${vendor}: ${id}`).join(' · '));
    if(source) {const link = node('a', 'بازکردن صفحهٔ مبدأ ↗', 'detail-source'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);}
    const gallery = node('section', undefined, 'detail-gallery'); gallery.setAttribute('aria-label', 'تصاویر ذخیره‌شدهٔ محصول');
    for(const [index, value] of (product.gallery || []).entries()) {
      const url = safeUrl(value, true); if(!url) continue;
      const link = node('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const image = node('img'); image.src = url; image.alt = `${product.title || 'تصویر محصول'} · ${number(index + 1)}`;
      image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; link.append(image); gallery.append(link);
    }
    if(gallery.children.length) body.append(gallery); else body.append(node('p', 'تصویر HTTPS قابل نمایش ذخیره نشده است.', 'muted'));
    if(product.specs?.length) {
      const section = node('section', undefined, 'detail-specs'); section.append(node('h3', 'مشخصات ذخیره‌شده'));
      const table = node('table'); const tbody = node('tbody');
      for(const spec of product.specs) {const row = node('tr'); const heading = node('th', spec.name); heading.scope = 'row'; row.append(heading, node('td', spec.value)); tbody.append(row);}
      table.append(tbody); section.append(table); body.append(section);
    }
    if(!product.specs?.length) addTextSection('مشخصات ذخیره‌شده', fields.specs_text);
    addTextSection('توضیح کوتاه', product.short_description);
    addTextSection('توضیحات', product.description);
    if(!product.description && !product.short_description && !product.specs?.length && !fields.specs_text) body.append(node('p', 'توضیحات و مشخصات ذخیره نشده‌اند. این پنجره اطلاعات جدیدی از مبدأ دریافت نمی‌کند.', 'muted'));
  }
  async function openDetails(id, opener) {
    if(!Number.isSafeInteger(id) || id <= 0) return;
    const ticket = ++detailRequest; trigger = opener || document.activeElement;
    body.replaceChildren(); body.setAttribute('aria-busy', 'true');
    $('#product-detail-title').textContent = 'جزئیات محصول'; status.textContent = 'در حال دریافت اطلاعات ذخیره‌شده…';
    if(!dialog.open) dialog.showModal();
    $('#product-detail-close').focus();
    try {
      const product = await read(`/api/products/${id}`);
      if(ticket !== detailRequest || !dialog.open) return;
      renderDetail(product); status.textContent = 'اطلاعات محلی · فقط خواندنی';
    } catch(error) {if(ticket === detailRequest && dialog.open) status.textContent = error.message;}
    finally {if(ticket === detailRequest) body.setAttribute('aria-busy', 'false');}
  }
  window.S4Products = Object.freeze({open: openDetails});
})();
