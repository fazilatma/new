/* Settings secrets stay in the selected file/password fields, never browser storage. */
(() => {
  const doc = document, csrf = doc.querySelector('meta[name="csrf"]').content;
  const exporting = doc.querySelector('#settings-export-form'), importing = doc.querySelector('#settings-import-form');
  const result = doc.querySelector('#settings-preview-result'), status = doc.querySelector('#transfer-message');
  const inspectButton = doc.querySelector('#settings-inspect'), previewButton = doc.querySelector('#settings-preview');
  const applyButton = doc.querySelector('#settings-apply'), fieldset = doc.querySelector('#transfer-import-sections');
  let inspection = null, preview = null, busy = false, generation = 0;
  const boxes = form => [...form.querySelectorAll('input[name="section"]')];
  const selected = form => boxes(form).filter(box => box.checked && !box.disabled).map(box => box.value);
  const message = text => { status.textContent = text; };
  const labels = Object.fromEntries(boxes(importing).map(box => [box.value, box.parentElement.textContent.trim()]));
  function sync() {
    inspectButton.disabled = busy;
    previewButton.disabled = busy || !inspection;
    applyButton.disabled = busy || !preview || preview.active_jobs > 0;
    exporting.querySelector('[type="submit"]').disabled = busy;
    doc.querySelectorAll('[data-transfer-select],button[type="reset"]').forEach(button => {button.disabled = busy;});
  }
  function invalidate(source = false) {
    generation += 1; preview = null; result.textContent = '';
    if(source) {inspection = null; fieldset.disabled = true;}
    doc.querySelector('#transfer-file-fields').hidden = importing.elements.source.value === 'previous';
    sync();
  }
  importing.addEventListener('input', event => invalidate(['file','password','source'].includes(event.target.name)));
  importing.addEventListener('change', event => invalidate(['file','password','source'].includes(event.target.name)));
  importing.addEventListener('reset', () => {invalidate(true); setTimeout(() => invalidate(true), 0);});
  async function api(path, data) {
    const mutating = data !== undefined;
    if(mutating) window.S4Refresh?.beginMutation();
    try {
      const response = await fetch(path, {method:mutating ? 'POST' : 'GET', cache:'no-store', credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf}, ...(mutating ? {body:JSON.stringify(data)} : {})});
      let value;
      try { value = await response.json(); } catch { throw Error('پاسخ سرور خوانده نشد؛ نتیجه را بررسی کنید و پیش‌نمایش تازه بگیرید.'); }
      if(!response.ok) throw Error(value.error || `HTTP ${response.status}`);
      return value;
    } finally {if(mutating) window.S4Refresh?.endMutation();}
  }
  async function run(form, callback) {
    if(busy) return;
    busy = true; sync();
    window.S4Refresh?.submitting(form, true);
    const revision = window.S4Refresh?.revision(form);
    try { await callback(revision); }
    catch(error) {message(error.message);}
    finally {busy = false; window.S4Refresh?.submitting(form, false); sync();}
  }
  async function payload() {
    const epoch = generation;
    const data = {source:importing.elements.source.value, password:importing.elements.password.value,
      sections:selected(importing), mode:importing.elements.mode.value, credentials:importing.elements.credentials.checked};
    if(data.source === 'file') {
      const file = importing.elements.file.files[0];
      if(!file) throw Error('ابتدا فایل JSON را انتخاب کنید.');
      if(file.size > 1500000) throw Error('سقف حجم فایل ۱٫۵ مگابایت است؛ در PHP خروجی بدون محصولات بگیرید.');
      data.file = await file.text();
    }
    if(epoch !== generation) throw Error('فرم تغییر کرد؛ دوباره بررسی کنید.');
    return data;
  }
  doc.querySelectorAll('[data-transfer-select]').forEach(button => button.onclick = () => {
    const [which,choice] = button.dataset.transferSelect.split(':');
    const form = which === 'export' ? exporting : importing;
    for(const box of boxes(form)) if(!box.disabled && (which === 'export' || inspection)) box.checked = choice === 'all';
    window.S4Refresh?.changed(form);
    if(which === 'import') invalidate();
  });
  inspectButton.onclick = () => run(importing, async () => {
    preview = null; result.textContent = '';
    const data = await payload(), epoch = generation;
    const value = await api('/api/settings/inspect', data);
    if(epoch !== generation) throw Error('فرم تغییر کرد؛ دوباره فایل را بررسی کنید.');
    inspection = value; preview = null; fieldset.disabled = false;
    for(const box of boxes(importing)) {
      const available = value.available.includes(box.value);
      box.disabled = !available; box.checked = available && box.value !== 'pythonanywhere';
      doc.querySelector(`[data-transfer-available="${box.value}"]`).textContent = available ? `(${value.counts[box.value]})` : '— در فایل نیست';
    }
    message(['فایل بررسی شد؛ بخش‌ها و روش اعمال را انتخاب و پیش‌نمایش بگیرید.', ...(value.warnings || [])].join('\n'));
  });
  previewButton.onclick = () => run(importing, async () => {
    preview = null; result.textContent = '';
    const data = await payload(), epoch = generation;
    if(!data.sections.length) throw Error('حداقل یک بخش موجود را انتخاب کنید.');
    const value = await api('/api/settings/preview', data);
    if(epoch !== generation) throw Error('فرم تغییر کرد؛ پیش‌نمایش تازه بگیرید.');
    preview = value;
    result.textContent = [...value.changes.map(change => change.section === 'profiles' ?
      `${labels.profiles}: ${change.added} جدید، ${change.updated} ویرایش، ${change.disabled} غیرفعال` :
      `${labels[change.section]}: ${change.changed ? 'تغییر می‌کند' : 'بدون تغییر'}`),
      ...value.warnings, `کران GET عمومی پس از بازیابی: ${value.public_cron ? 'روشن' : 'خاموش'}`,
      value.active_jobs ? `${value.active_jobs} کار فعال وجود دارد؛ ابتدا تمام یا لغو شوند.` : 'صف فعال مسدودکننده‌ای نیست.'].join('\n');
    message('پیش‌نمایش آماده است؛ تا تأیید شما هیچ تنظیمی تغییر نمی‌کند.');
  });
  importing.addEventListener('submit', event => {
    event.preventDefault();
    if(!preview || busy) return;
    if(!confirm('تنظیمات دقیقاً مطابق پیش‌نمایش اعمال شود؟ یک نسخهٔ رمزگذاری‌شده از تنظیمات قبل نگه داشته می‌شود.')) return;
    const approved = preview;
    run(importing, async revision => {
      const data = await payload();
      if(approved !== preview) throw Error('فرم تغییر کرد؛ پیش‌نمایش تازه بگیرید.');
      const epoch = generation;
      preview = null;
      const applied = await api('/api/settings/import', {...data,token:approved.token});
      doc.querySelector('#transfer-previous').disabled = !applied.undo_available;
      if(epoch === generation) {importing.reset(); window.S4Refresh?.clean(importing, revision);}
      message('تنظیمات پیش‌نمایش تأییدشده اعمال شد. محصولات و صف تغییر نکردند. نسخهٔ قبل از بازیابی از همین فرم قابل بازگرداندن است؛ برای دیدن فرم‌های تازه به پنل برگردید.');
    });
  });
  exporting.addEventListener('submit', event => {
    event.preventDefault();
    const password = exporting.elements.password.value;
    if(password !== exporting.elements.repeat.value) {message('رمز فایل و تکرار آن یکسان نیستند.'); return;}
    const sections = selected(exporting);
    run(exporting, async revision => {
      const file = await api('/api/settings/export', {sections,password});
      if(window.S4Refresh && revision !== window.S4Refresh.revision(exporting)) throw Error('فرم خروجی تغییر کرد؛ برای دانلود دوباره تلاش کنید.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(file,null,2)], {type:'application/json'}));
      const link = doc.createElement('a'); link.href = url;
      link.download = 'scraper4-settings-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
      doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
      exporting.elements.password.value = ''; exporting.elements.repeat.value = '';
      window.S4Refresh?.clean(exporting, revision);
      message('دانلود فایل رمزگذاری‌شده آغاز شد؛ فایل و رمز مستقل آن را امن نگه دارید.');
    });
  });
  api('/api/settings/sections').then(value => {doc.querySelector('#transfer-previous').disabled = !value.undo_available;})
    .catch(error => message(error.message));
  sync();
})();
