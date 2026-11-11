(() => {
const csrf = document.querySelector('meta[name="csrf"]').content;
const message = text => { document.querySelector('#menu-message').textContent = text; };
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
document.querySelectorAll('.connection-form').forEach(form => {
  handle(form, async data => { await api(`/api/connections/${form.dataset.name}`,'POST',data); const status=document.querySelector(`[data-connection-status="${form.dataset.name}"]`);if(status)status.textContent='اتصال ذخیره شد؛ مقدار کلیدها فقط به صورت مخفی نمایش داده می‌شود.'; message('اتصال ذخیره شد.'); window.dispatchEvent(new Event('s4:connections-saved')); });
  api(`/api/connections/${form.dataset.name}`).then(result => {
    if(window.S4Refresh?.isDirty(form)) return;
    const state=document.querySelector(`[data-connection-status="${form.dataset.name}"]`);
    if(state) state.textContent=Object.entries(result.credential_status||{}).map(([key,value])=>`${key}: ${value?'ذخیره‌شده (مخفی)':'موجود نیست؛ درون‌ریزی با اجازهٔ انتقال کلید یا ثبت دستی لازم است'}`).join(' · ');
    for(const [key,value] of Object.entries(result.fields)) if(form.elements[key]) form.elements[key].value = value;
  }).catch(error => message(error.message));
});
// Management operations are queued; a Scheduled Task performs them outside WSGI.
const systemState = document.querySelector('#system-state');
async function systemPoll() {
  try {
    const data = await api('/api/system/status');
    const update = data.updates;
    const operation = update.operation || {};
    systemState.textContent = JSON.stringify({running:data.runtime, domain:data.platform.domain, platform:data.platform.provisioning,
      auto_update:update.config, update_branch:update.branch, checked_branch:update.state.branch, current:update.current, latest:update.state.latest,
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



const diagnose=document.querySelector('#extraction-diagnose');if(diagnose)diagnose.onclick=async()=>{
  const out=document.querySelector('#extraction-diagnostics');diagnose.disabled=true;
  try{out.textContent=JSON.stringify(await api('/api/extraction/diagnostics'),null,2);}catch(error){out.textContent=error.message;}finally{diagnose.disabled=false;}
};
})();
