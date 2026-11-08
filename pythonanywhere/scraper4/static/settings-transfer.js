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
  const localStatus = doc.querySelector('#settings-import-state'), hint = doc.querySelector('#settings-apply-hint');
  const message = text => { status.textContent = text; localStatus.textContent = text; };
  let autoTimer = null, queued = null;
  const labels = Object.fromEntries(boxes(importing).map(box => [box.value, box.parentElement.textContent.trim()]));
  function sync() {
    inspectButton.disabled = busy;
    previewButton.disabled = busy || !inspection || !selected(importing).length;
    applyButton.disabled = busy || !preview || preview.active_jobs > 0;
    hint.textContent = busy ? 'در حال بررسی؛ لطفاً منتظر بمانید…' : !inspection ? 'فایل را انتخاب کنید؛ بخش‌ها خودکار بررسی می‌شوند. فایل Python به رمز نیاز دارد.' : !selected(importing).length ? 'حداقل یک بخش موجود و قابل انتقال را انتخاب کنید.' : !preview ? 'برای فعال‌شدن تأیید، پیش‌نمایش معتبر لازم است؛ پیام همین بخش را بررسی کنید.' : preview.active_jobs > 0 ? `${preview.active_jobs} کار فعال است؛ پس از اتمام یا لغو آن‌ها دوباره پیش‌نمایش بگیرید.` : 'پیش‌نمایش آماده است؛ اکنون می‌توانید تأیید و اعمال کنید.';
    exporting.querySelector('[type="submit"]').disabled = busy;
    doc.querySelectorAll('[data-transfer-select],button[type="reset"]').forEach(button => {button.disabled = busy;});
  }
  function invalidate(source = false) {
    generation += 1; preview = null; result.textContent = '';
    if(source) {inspection = null; fieldset.disabled = true;}
    doc.querySelector('#transfer-file-fields').hidden = importing.elements.source.value === 'previous';
    sync();
  }
  function queueAutomatic(action) {
    queued = action;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if(busy) return; // run() drains the newest pending selection on completion.
      const next = queued; queued = null;
      if(next === 'inspect') inspectFile(true);
      else if(next === 'preview' && inspection && selected(importing).length) makePreview();
    }, 0);
  }
  importing.addEventListener('input', event => {
    invalidate(['file','password','source'].includes(event.target.name));
  });
  importing.addEventListener('change', event => {
    const source = ['file','password','source'].includes(event.target.name);
    invalidate(source);
    queueAutomatic(source ? 'inspect' : 'preview');
  });
  importing.addEventListener('reset', () => {
    queued = null; clearTimeout(autoTimer); invalidate(true);
    const epoch = generation;
    setTimeout(() => {if(epoch === generation) invalidate(true);}, 0);
  });
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
    finally {busy = false; window.S4Refresh?.submitting(form, false); sync(); if(queued) queueAutomatic(queued);}
  }
  async function payload() {
    const epoch = generation;
    const data = {source:importing.elements.source.value, password:importing.elements.password.value,
      sections:selected(importing), mode:importing.elements.mode.value, credentials:importing.elements.credentials.checked};
    if(data.source === 'file') {
      const file = importing.elements.file.files[0];
      if(!file) throw Error('ابتدا فایل JSON را انتخاب کنید.');
      if(file.size > 1500000) throw Error('سقف حجم فایل ۱٫۵ مگابایت است؛ در PHP خروجی بدون محصولات بگیرید.');
      data.file = typeof file.text === 'function' ? await file.text() : await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('خواندن فایل ممکن نشد؛ فایل را دوباره انتخاب کنید.'));
        reader.readAsText(file);
      });
    }
    if(epoch !== generation) throw Error('فرم تغییر کرد؛ دوباره بررسی کنید.');
    return data;
  }
  doc.querySelectorAll('[data-transfer-select]').forEach(button => button.onclick = () => {
    const [which,choice] = button.dataset.transferSelect.split(':');
    const form = which === 'export' ? exporting : importing;
    for(const box of boxes(form)) if(!box.disabled && (which === 'export' || inspection)) box.checked = choice === 'all';
    window.S4Refresh?.changed(form);
    if(which === 'import') {invalidate(); queueAutomatic('preview');}
  });
  function inspectFile(automatic = false) {
    queued = null; clearTimeout(autoTimer);
    return run(importing, async () => {
    preview = null; result.textContent = '';
    inspection = null; fieldset.disabled = true;
    message('در حال خواندن فایل و شناسایی بخش‌های قابل انتقال…');
    const data = await payload(), epoch = generation;
    if(data.source === 'file' && !data.password) {
      let header;
      try {header = JSON.parse(data.file.replace(/^\uFEFF/,''));} catch {throw Error('فایل JSON معتبر نیست؛ خروجی تنظیمات PHP یا Python را انتخاب کنید.');}
      if(!header || typeof header !== 'object' || Array.isArray(header)) throw Error('ساختار فایل تنظیمات شناخته نشد؛ خروجی تنظیمات PHP یا Python را انتخاب کنید.');
      if(header.format === 'scraper4-settings-encrypted') throw Error('این فایل خروجی رمزگذاری‌شدهٔ Python است؛ رمز مستقل فایل را وارد و بررسی را بزنید. فایل PHP به رمز نیاز ندارد.');
    }
    const value = await api('/api/settings/inspect', data);
    if(epoch !== generation) throw Error('فرم تغییر کرد؛ دوباره فایل را بررسی کنید.');
    inspection = value; preview = null; fieldset.disabled = false;
    for(const box of boxes(importing)) {
      const available = value.available.includes(box.value);
      box.disabled = !available; box.checked = available && box.value !== 'pythonanywhere';
      doc.querySelector(`[data-transfer-available="${box.value}"]`).textContent = available ? `(${value.counts[box.value]})` : '— دادهٔ قابل انتقال ندارد';
    }
    message([value.available.length ? 'فایل بررسی شد؛ بخش‌های موجود فعال شدند. پیش‌نمایش خودکار هیچ تنظیمی را ذخیره نمی‌کند.' : 'هیچ بخش پشتیبانی‌شدهٔ دارای تنظیمات در این فایل نیست؛ علت‌ها در زیر آمده‌اند.', ...(value.warnings || [])].join('\n'));
    if(automatic && selected(importing).length) queueAutomatic('preview');
    });
  }
  inspectButton.onclick = () => inspectFile(true);
  function makePreview() {
    queued = null; clearTimeout(autoTimer);
    return run(importing, async () => {
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
    message(['پیش‌نمایش آماده است؛ تا تأیید شما هیچ تنظیمی تغییر نمی‌کند.', ...(inspection.warnings || [])].join('\n'));
    });
  }
  previewButton.onclick = makePreview;
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
