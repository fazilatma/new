(() => {
const csrf = document.querySelector('meta[name="csrf"]').content;
async function api(url, method = 'GET', data) {
  const response = await fetch(url, {method, headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:data === undefined ? undefined : JSON.stringify(data)});
  if(response.status === 401) { location.href='/login'; throw Error('ورود دوباره لازم است.'); }
  const result = await response.json();
  if(!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
function handle(form, callback) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try { await callback(Object.fromEntries(new FormData(form))); }
    catch(error) { message(error.message); }
  });
}
const platformForm = document.querySelector('#platform-form');
const platformResult = document.querySelector('#platform-result');
function message(text) { document.querySelector('#platform-message').textContent = text; }
async function loadPlatform() {
  const data = await api('/api/platform/config');
  for (const [key, value] of Object.entries(data.fields)) platformForm.elements[key].value = value;
  // Never refill a credential from a GET response.
  platformForm.elements.token.value = '';
  document.querySelector('#platform-credential-state').textContent = data.configured ? 'توکن ذخیره شده است؛ مقدار آن دوباره نمایش داده نمی‌شود.' : 'هنوز توکن PythonAnywhere ذخیره نشده است.';
  if (Object.keys(data.test || {}).length) platformResult.textContent = JSON.stringify(data.test, null, 2);
}
handle(platformForm, async data => {
  await api('/api/platform/config', 'POST', data);
  platformForm.elements.token.value = '';
  await loadPlatform();
  message('توکن رمز‌شده ذخیره شد؛ حالا تست دسترسی و سپس فعال‌سازی Task را بزنید.');
});
document.querySelector('#platform-test').onclick = async event => {
  event.currentTarget.disabled = true;
  try {
    const result = await api('/api/platform/test', 'POST', {});
    platformResult.textContent = JSON.stringify(result, null, 2);
    message(result.ok ? 'تست دسترسی موفق بود؛ برای ساخت Task، فعال‌سازی را بزنید.' : 'تست کامل موفق نبود؛ جزئیات امن در زیر فرم نمایش داده شد.');
  } catch (error) { message(error.message); }
  finally { document.querySelector('#platform-test').disabled = false; }
};
document.querySelector('#platform-activate').onclick = async event => {
  if (!confirm('Task زمان‌بندی‌شدهٔ همین برنامه با اطلاعات ذخیره‌شده ایجاد یا به‌روزرسانی شود؟')) return;
  event.currentTarget.disabled = true;
  try {
    const result = await api('/api/platform/activate', 'POST', {});
    platformResult.textContent = JSON.stringify(result, null, 2);
    message('Task فعال شد؛ بررسی خودکار و اجرای صف از نوبت بعدی Task انجام می‌شود.');
  } catch (error) { message(error.message); }
  finally { document.querySelector('#platform-activate').disabled = false; }
};
document.querySelector('#platform-remove').onclick = async () => {
  if (!confirm('توکن PythonAnywhere حذف شود؟ Reload و آپدیت خودکار بدون آن کار نمی‌کنند.')) return;
  try {
    await api('/api/platform/config', 'DELETE');
    platformResult.textContent = '';
    await loadPlatform();
    message('توکن حذف شد؛ Task موجود حذف نمی‌شود و استخراج همچنان قابل اجراست.');
  } catch (error) { message(error.message); }
};
loadPlatform().catch(error => message(error.message));

})();
