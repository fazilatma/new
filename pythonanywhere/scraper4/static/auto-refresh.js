/* Observe activated builds, never just downloaded files. No draft/password storage. */
((win) => {
  if(win.S4Refresh) return;
  const doc = win.document;
  const pageVersion = doc.querySelector('meta[name="s4-version"]')?.content;
  const pageCommit = doc.querySelector('meta[name="s4-build"]')?.content || '';
  const notice = doc.querySelector('#build-update-notice');
  const text = doc.querySelector('#build-update-text');
  const button = doc.querySelector('#build-refresh-now');
  if(!pageVersion || !notice || !button) return;
  const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
  const dirty = new Set(), submitting = new Map(), revisions = new WeakMap();
  let mutations = 0, nativeSubmit = false, checking = false, deciding = false, reloading = false;
  let candidate = '', observations = 0, ready = null, timer = null, generation = 0;
  const storageKey = 's4:last-auto-refresh';
  let attempted = '';
  try { attempted = win.sessionStorage.getItem(storageKey) || ''; } catch {}
  const initial = new URL(win.location.href);
  if(sha(initial.searchParams.get('__s4_refresh'))) attempted = initial.searchParams.get('__s4_refresh');
  function clearAttempt() {
    attempted = '';
    try { win.sessionStorage.removeItem(storageKey); } catch {}
    const url = new URL(win.location.href);
    if(url.searchParams.has('__s4_refresh')) {
      url.searchParams.delete('__s4_refresh');
      win.history.replaceState(null, '', url);
    }
  }
  if(sha(pageCommit) && attempted === pageCommit) clearAttempt();
  const busy = () => mutations > 0 || submitting.size > 0 || nativeSubmit;
  function prune() { for(const form of dirty) if(!form.isConnected) dirty.delete(form); }
  function render() {
    prune();
    notice.hidden = !ready;
    if(!ready) return;
    button.disabled = busy() || deciding;
    text.textContent = busy() ? 'نسخهٔ جدید آماده است؛ منتظر پایان درخواست در حال اجرا هستیم.' : dirty.size ?
      'نسخهٔ جدید نصب شده است؛ پس از ذخیره یا بازنشانی فرم، صفحه خودکار تازه می‌شود.' : attempted === ready.commit ?
      'نسخهٔ جدید آماده است؛ برای جلوگیری از تکرار رفرش، بارگذاری دوباره را تأیید کنید.' :
      'نسخهٔ جدید فعال شده است؛ صفحه در حال تازه‌شدن است.';
  }
  function schedule(delay) {
    win.clearTimeout(timer);
    if(!reloading) timer = win.setTimeout(checkNow, delay ?? (doc.hidden ? 60000 : 10000));
  }
  function resetObservation() { candidate = ''; observations = 0; ready = null; render(); }
  async function healthy() {
    const controller = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    const timeout = controller ? win.setTimeout(() => controller.abort(), 5000) : null;
    try {
      const response = await win.fetch('/healthz?browser=' + Date.now(), {
        cache:'no-store', credentials:'same-origin', redirect:'error',
        headers:{'Cache-Control':'no-cache'}, ...(controller ? {signal:controller.signal} : {})
      });
      if(!response.ok) return null;
      const value = await response.json();
      const installed = response.headers.get('X-Scraper-Installed-Commit');
      if(value.ok !== true || !sha(value.commit) || installed !== value.commit || typeof value.version !== 'string' || !value.version) return null;
      return {commit:value.commit, version:value.version};
    } catch { return null; }
    finally { if(timeout !== null) win.clearTimeout(timeout); }
  }
  async function refreshIfSafe(manual = false) {
    prune();
    if(!ready || reloading || deciding || doc.hidden || busy()) { render(); return; }
    if(!manual && (dirty.size || attempted === ready.commit)) { render(); return; }
    const atConfirmation = generation;
    if(manual && dirty.size && !win.confirm('تغییرات ذخیره‌نشدهٔ فرم از دست می‌رود. صفحه با نسخهٔ جدید بارگذاری شود؟')) return;
    const target = ready;
    deciding = true; render();
    try {
      // Recheck immediately before navigation: another rollout may have begun.
      const current = await healthy();
      prune();
      if(!current || current.commit !== target.commit || current.version !== target.version) {
        resetObservation(); return;
      }
      if(doc.hidden || busy() || generation !== atConfirmation || (!manual && dirty.size)) return;
      reloading = true;
      attempted = target.commit;
      try { win.sessionStorage.setItem(storageKey, target.commit); } catch {}
      const url = new URL(win.location.href);
      // Also bounds reloads when sessionStorage is blocked or a stale worker
      // serves the old page. Preserve the current tab and all other parameters.
      url.searchParams.set('__s4_refresh', target.commit);
      win.location.replace(url.toString());
    } finally { deciding = false; render(); }
  }
  async function checkNow() {
    if(checking || reloading) return;
    checking = true;
    try {
      const current = await healthy();
      if(!current) { resetObservation(); return; }
      if(current.commit === pageCommit || (!sha(pageCommit) && current.version === pageVersion)) {
        resetObservation();
        if(attempted) clearAttempt();
        return;
      }
      if(candidate === current.commit) observations += 1;
      else { candidate = current.commit; observations = 1; ready = null; }
      if(observations >= 2) { ready = current; render(); await refreshIfSafe(); }
    } finally { checking = false; schedule(); }
  }
  const changed = form => { if(form) { dirty.add(form); revisions.set(form, (revisions.get(form) || 0) + 1); generation += 1; render(); } };
  const clean = (form, revision) => { if(revision === undefined || revision === (revisions.get(form) || 0)) dirty.delete(form); render(); schedule(0); };
  doc.addEventListener('input', event => changed(event.target.closest?.('form')));
  doc.addEventListener('change', event => changed(event.target.closest?.('form')));
  doc.addEventListener('reset', event => { if(!event.defaultPrevented) clean(event.target); });
  doc.addEventListener('submit', event => { if(!event.defaultPrevented) { nativeSubmit = true; render(); } });
  doc.addEventListener('visibilitychange', () => schedule(0));
  win.addEventListener('pageshow', () => { nativeSubmit = false; schedule(0); });
  button.onclick = () => refreshIfSafe(true);
  win.S4Refresh = {
    checkNow, changed, clean,
    revision(form) { return revisions.get(form) || 0; },
    isDirty(form) { return dirty.has(form); },
    submitting(form, active) { const count = (submitting.get(form) || 0) + (active ? 1 : -1); if(count > 0) submitting.set(form, count); else submitting.delete(form); render(); schedule(0); },
    beginMutation() { mutations += 1; render(); },
    endMutation() { mutations = Math.max(0, mutations - 1); render(); schedule(0); }
  };
  schedule(0);
})(window);
