(() => {
  const dialog = document.querySelector('#settings-menu');
  const trigger = document.querySelector('#hamburgerBtn');
  const close = document.querySelector('#settings-menu-close');
  const wide = document.querySelector('#settings-menu-wide');
  if(!dialog || !trigger) return;
  let returnFocus = null;const mounts=[];
  function mount(){for(const slot of dialog.querySelectorAll('[data-menu-mount]')){const target=document.getElementById(slot.dataset.menuMount);if(!target||dialog.contains(target))continue;const marker=document.createComment('menu-return:'+target.id);target.before(marker);slot.append(target);mounts.push({target,marker});}}
  function unmount(){for(const {target,marker} of mounts){marker.replaceWith(target);}mounts.length=0;}
  function cleanup() {
    unmount();trigger.setAttribute('aria-expanded', 'false');
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
    if(typeof dialog.showModal !== 'function') { dialog.setAttribute('open','');mount();trigger.setAttribute('aria-expanded','true');return; }
    returnFocus = document.activeElement === document.body ? trigger : document.activeElement;
    mount();dialog.showModal();
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
  function openSection(key){
    if(!dialog.open)trigger.click();
    const group=Array.from(dialog.querySelectorAll('[data-menu-key]')).find(e=>e.dataset.menuKey===key);
    if(group){group.open=true;group.scrollIntoView({block:'start'});group.querySelector('summary').focus();}
  }
  let browseTicket=0;
  function browse(metric,profile,name,offset=0){
    if(!dialog.open)return false;const output=document.querySelector('#menu-product-results');if(!output)return false;
    openSection('profile-stats');const ticket=++browseTicket;output.textContent='در حال دریافت محصولات…';
    const params=new URLSearchParams({filter:metric,limit:50,offset,summary:'1'});if(profile)params.set('profile_id',profile);
    fetch('/api/products?'+params,{credentials:'same-origin',cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'خطا در دریافت محصولات');if(ticket!==browseTicket)return;output.replaceChildren();
      const heading=document.createElement('h3');heading.textContent=`${name||'همهٔ پروفایل‌ها'} · ${data.total} محصول`;output.append(heading);
      for(const product of data.products){const line=document.createElement('p');line.textContent=`#${product.id} · ${product.title} · ${product.price||product.price_num||0}`;output.append(line);}
      for(const [label,next] of [['قبلی',data.offset-50],['بعدی',data.offset+50]]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.disabled=next<0||next>=data.total;b.onclick=()=>browse(metric,profile,name,next);output.append(b);}
      output.scrollIntoView({block:'start'});
    }).catch(error=>{if(ticket===browseTicket)output.textContent=error.message;});return true;
  }
  window.S4Menu={open:openSection,browse};
  document.querySelectorAll('[data-open-menu]').forEach(button=>button.onclick=()=>openSection(button.dataset.openMenu));
  document.addEventListener('DOMContentLoaded',()=>{const section=location.pathname==='/settings/backup'?'backup':location.pathname==='/settings/pythonanywhere'?'general':new URLSearchParams(location.search).get('menu');if(section)openSection(section);});
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
