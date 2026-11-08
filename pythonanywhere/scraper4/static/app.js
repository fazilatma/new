const csrf = document.querySelector('meta[name="csrf"]').content;
const message = text => { document.querySelector('#message').textContent = text; };
async function api(url, method = 'GET', data) {
  const response = await fetch(url, {method, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: data === undefined ? undefined : JSON.stringify(data)});
  if (response.status === 401) { location.href = '/login'; throw Error('ورود دوباره لازم است.'); }
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
function handle(form, callback) {
  form.addEventListener('submit', async event => { event.preventDefault(); try { await callback(Object.fromEntries(new FormData(form))); } catch(error) { message(error.message); } });
}
const profileForm = document.querySelector('#profile-form');
handle(profileForm, async data => {
  const selectors = Object.fromEntries(['container','title','price','link','image','sku'].map(k => [k, data[k]]).filter(([,v]) => v));
  await api('/api/profiles', 'POST', {key:data.key, name:data.name, url:data.url, selectors, pagination:{type:data.pagType, val:data.pagVal}});
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
    profileForm.scrollIntoView({behavior:'smooth'});
  } catch(error) { message(error.message); }
});
document.querySelectorAll('.delete').forEach(button => button.onclick = async () => {
  if(!confirm('پروفایل و همه محصولات آن حذف شود؟')) return;
  try { await api(`/api/profiles/${button.dataset.id}`, 'DELETE'); location.reload(); } catch(error) { message(error.message); }
});
handle(document.querySelector('#job-form'), async data => {
  if(data.kind !== 'extract' && !confirm('ارسال به فروشگاه انجام شود؟ قبل از تلاش مجدد، محصولات مقصد را بررسی کنید.')) return;
  const result = await api('/api/jobs','POST', data);
  message(`کار ${result.id} به صف اضافه شد. worker را از کنسول یا Tasks اجرا کنید.`);
  await poll();
});
document.querySelectorAll('.connection-form').forEach(form => {
  handle(form, async data => { await api(`/api/connections/${form.dataset.name}`,'POST',data); message('اتصال ذخیره شد.'); });
  api(`/api/connections/${form.dataset.name}`).then(result => {
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
    cell(row, `${job.counters.current || 0} / ${job.counters.total || 0}`); cell(row,job.error);
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
    systemState.textContent = JSON.stringify({domain:data.platform.domain, platform:data.platform.provisioning,
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
