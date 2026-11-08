/* PHP test_selector/testDetailSel: explicit, transient static-page tests. */
(() => {
  'use strict';
  const form = document.querySelector('#profile-form');
  const area = document.querySelector('#selector-test-result');
  if(!form || !area) return;
  const status = document.querySelector('#selector-test-status');
  const buttons = ['list', 'detail'].map(mode => document.querySelector('#selector-test-' + mode));
  const labels = {container:'کارت محصول',title:'عنوان',price:'قیمت',link:'لینک',image:'تصویر',sku:'SKU',shortDesc:'توضیح کوتاه',longDesc:'توضیحات',specs:'مشخصات',images:'گالری',brand:'برند',category:'دستهٔ مبدأ',tags:'برچسب‌ها'};
  const states = {matched:'دارای مقدار',empty:'پیدا شد، مقدار خالی',missing:'پیدا نشد'};
  let revision = 0, busy = false;
  function invalidate() {
    ++revision; area.replaceChildren();
    status.textContent = 'ورودی‌ها تغییر کرده‌اند؛ برای دیدن نتیجهٔ تازه دوباره آزمایش کنید.';
  }
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  form.addEventListener('reset', invalidate);
  // These controls fill the form programmatically without an input event.
  document.querySelectorAll('.edit, #detail-woo-defaults').forEach(button => button.addEventListener('click', invalidate));
  function node(tag, text, className) {
    const element = document.createElement(tag); if(text !== undefined) element.textContent = String(text);
    if(className) element.className = className; return element;
  }
  function paint(data) {
    area.replaceChildren();
    if(data.automatic) area.append(node('p', 'سلکتور کارت فهرست خالی است؛ نمونه‌ها با تشخیص خودکار ساخته شده‌اند و سایر سلکتورهای فهرست فقط در جدول زیر آزمایش می‌شوند.', 'notice'));
    for(const warning of data.warnings || []) area.append(node('p', warning, 'muted'));
    if(data.fields.length) {
      const wrap = node('div', undefined, 'table-wrap'); const table = node('table', undefined, 'selector-diagnostics');
      const head = node('thead'); const headings = node('tr');
      for(const label of ['فیلد / سلکتور','تطبیق در سند','وضعیت','نمونهٔ مقدار']) headings.append(node('th',label));
      head.append(headings); const body = node('tbody');
      for(const field of data.fields) {
        const row = node('tr'); row.dataset.state = field.status;
        const name = node('td'); name.append(node('strong',labels[field.field] || field.field),node('code',field.selector));
        row.append(name,node('td',Number(field.count).toLocaleString('fa-IR')),node('td',states[field.status] || 'نامشخص'),node('td',field.value || '—'));
        body.append(row);
      }
      table.append(head,body); wrap.append(table); area.append(wrap);
    }
    if(data.mode === 'list') {
      area.append(node('h3',`${Number(data.total).toLocaleString('fa-IR')} محصول تشخیص داده شد · نمایش حداکثر ۸ نمونه`));
      if(!data.products.length) area.append(node('p','محصولی استخراج نشد. سلکتور کارت، فیلدها و نیاز سایت به JavaScript را بررسی کنید.','notice'));
      for(const product of data.products) {
        const card = node('article',undefined,'selector-sample'); card.append(node('strong',product.title || 'بدون عنوان'));
        for(const [label,value] of [['قیمت',product.price],['SKU',product.sku],['لینک',product.link],['تصویر',product.image]]) {
          if(value) card.append(node('p',`${label}: ${value}`));
        }
        // URLs are text only: no source HTML or automatic image/link requests.
        area.append(card);
      }
    }
  }
  function collect(mode) {
    const url = mode === 'list' ? form.elements.url.value.trim() : document.querySelector('#selector-sample-url').value.trim();
    const fields = mode === 'list' ? ['container','title','price','link','image','sku'] : ['shortDesc','longDesc','specs','images','sku','brand','category','tags'];
    const selectors = Object.fromEntries(fields.map(key => [key,form.elements[(mode === 'detail' ? 'detail_' : '') + key].value.trim()]).filter(([,value]) => value));
    return {mode,url,selectors};
  }
  async function run(mode) {
    if(busy) return;
    const payload = collect(mode);
    if(!payload.url) {status.textContent = mode === 'list' ? 'ابتدا آدرس فهرست را در پروفایل وارد کنید.' : 'ابتدا آدرس نمونهٔ صفحهٔ محصول را وارد کنید.'; return;}
    if(mode === 'detail' && !Object.keys(payload.selectors).length) {status.textContent = 'برای آزمایش جزئیات حداقل یک سلکتور وارد کنید.'; return;}
    const signature = JSON.stringify(payload);
    function current() {
      if(ticket !== revision) return false;
      if(JSON.stringify(collect(mode)) !== signature) {invalidate(); return false;}
      return true;
    }
    const ticket = revision;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    busy = true; buttons.forEach(button => button.disabled = true); area.replaceChildren(); area.setAttribute('aria-busy','true');
    status.textContent = 'در حال دریافت یک صفحه و آزمایش ورودی‌های فعلی…';
    window.S4Refresh?.beginMutation();
    try {
      const response = await fetch('/api/selectors/preview',{method:'POST',credentials:'same-origin',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf"]').content},body:signature});
      const data = await response.json().catch(() => {throw new Error('پاسخ سرور قابل خواندن نیست؛ دوباره تلاش کنید.');});
      if(!current()) return;
      if(!response.ok) throw new Error(response.status === 401 ? 'نشست پایان یافته است؛ دوباره وارد شوید.' : data.error || 'آزمایش ناموفق بود.');
      paint(data); status.textContent = 'آزمایش تمام شد؛ چیزی ذخیره نشده است. برای نگه‌داشتن سلکتورها، جداگانه «ذخیره پروفایل» را بزنید.';
    } catch(error) {
      if(current()) status.textContent = error.name === 'AbortError' ? 'مهلت پیش‌نمایش تمام شد؛ می‌توانید دوباره آزمایش کنید.' : error.message;
    } finally {
      clearTimeout(timeout); busy = false; buttons.forEach(button => button.disabled = false); area.setAttribute('aria-busy','false');
      window.S4Refresh?.endMutation();
    }
  }
  for(const mode of ['list','detail']) document.querySelector('#selector-test-'+mode).onclick = () => run(mode);
})();
