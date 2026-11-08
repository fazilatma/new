(() => {
  const dialog = document.querySelector('#settings-menu');
  const trigger = document.querySelector('#hamburgerBtn');
  const close = document.querySelector('#settings-menu-close');
  const wide = document.querySelector('#settings-menu-wide');
  if(!dialog || !trigger) return;
  let returnFocus = null;
  function cleanup() {
    trigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
    if(returnFocus && returnFocus.isConnected) returnFocus.focus({preventScroll:true});
    returnFocus = null;
  }
  function closeMenu(restoreFocus = true) {
    if(!restoreFocus) returnFocus = null;
    dialog.close();
    cleanup();
  }
  trigger.onclick = () => {
    if(dialog.open) { closeMenu(); return; }
    if(typeof dialog.showModal !== 'function') { location.href = '/#settings'; return; }
    returnFocus = document.activeElement === document.body ? trigger : document.activeElement;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    close.focus();
  };
  close.onclick = () => closeMenu();
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
  dialog.addEventListener('close', () => { if(!dialog.open) cleanup(); });
  dialog.addEventListener('click', event => {
    if(event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if(event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu();
  });
  wide.onclick = () => {
    const expanded = dialog.classList.toggle('wide');
    wide.setAttribute('aria-pressed', String(expanded));
    wide.textContent = expanded ? 'عرض معمولی' : 'تمام‌عرض';
  };
  const links = [...dialog.querySelectorAll('[data-menu-tab]')];
  function focusTarget(id) {
    const target = document.getElementById(id);
    if(!target) return;
    target.scrollIntoView({block:'center'});
    if(!target.matches('button,input,select,a[href],textarea')) target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  }
  links.forEach(link => link.addEventListener('click', event => {
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    if(typeof window.activateTab !== 'function' || !document.querySelector(`#pane-${link.dataset.menuTab}`)) return;
    event.preventDefault();
    closeMenu(false);
    window.activateTab(link.dataset.menuTab);
    const url = new URL(location.href);
    url.searchParams.set('section', link.dataset.menuTarget);
    history.replaceState(null, '', url);
    focusTarget(link.dataset.menuTarget);
  }));
  document.addEventListener('DOMContentLoaded', () => {
    const section = new URLSearchParams(location.search).get('section');
    if(links.some(link => link.dataset.menuTarget === section && link.dataset.menuTab === location.hash.slice(1))) focusTarget(section);
  });
  const check = document.querySelector('#menu-runtime-check');
  check.onclick = async () => {
    const output = document.querySelector('#menu-runtime-result');
    check.disabled = true;
    output.textContent = 'در حال بررسی…';
    try {
      const response = await fetch('/api/system/status', {cache:'no-store'});
      if(response.status === 401) { location.href = '/login'; return; }
      const data = await response.json();
      if(!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      // Display only runtime and selftest, not connection credentials/config.
      output.textContent = JSON.stringify({runtime:data.runtime, selftest:data.selftest, commit:data.updates?.current}, null, 2);
    } catch(error) { output.textContent = error.message; }
    finally { check.disabled = false; }
  };
})();
