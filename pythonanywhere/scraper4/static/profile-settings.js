(() => {
  const form=document.querySelector('#profile-options-form');if(!form)return;
  const $=s=>document.querySelector(s),message=$('#profile-options-message'),output=$('#profile-options-result');
  let id='',dirty=false,busy=false,ticket=0,revision=0;
  const numeric=['priceVal','roundPrice','minPrice','wooProfileCatId','bslProfileCatId','wooPriceVal','wooRound','basalamPriceVal','basalamRound'];
  async function api(url,method='GET',body){if(method!=='GET')window.S4Refresh?.beginMutation();try{const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':$('meta[name=csrf]').content},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;}finally{if(method!=='GET')window.S4Refresh?.endMutation();}}
  function buttons(){for(const b of form.querySelectorAll('button'))b.disabled=busy||!id;}
  function changed(){dirty=true;revision++;}form.addEventListener('input',changed);form.addEventListener('change',changed);
  function canSwitch(){if(busy)return false;if(dirty&&!confirm('تنظیمات ذخیره‌نشدهٔ پروفایل کنار گذاشته شوند؟'))return false;dirty=false;window.S4Refresh?.clean(form);return true;}
  window.S4ProfileOptions={canSwitch};
  async function load(next,force=false){next=String(next||'');if(next===id&&dirty&&!force)return;id=next;const token=++ticket,at=revision;buttons();output.textContent='';if(!id){$('#profile-settings-name').textContent='ابتدا پروفایل را در شروع بسازید یا انتخاب کنید';message.textContent='پروفایل انتخاب نشده است.';return;}
    try{const data=await api(`/api/profile-settings/${id}`);if(ticket!==token||revision!==at)return;for(const [key,value] of Object.entries(data.options))if(form.elements[key]){if(key==='useCustomCol')form.elements[key].checked=value;else form.elements[key].value=value;}
      $('#profile-settings-name').textContent=data.name;message.textContent=data.active?'تنظیمات ذخیره‌شدهٔ همین پروفایل؛ تغییرات جدید با ذخیره اعمال می‌شوند.':'تنظیمات پیش‌فرض/قدیمی برای بازبینی نمایش داده شد؛ هنوز فعال نشده است.';dirty=false;window.S4Refresh?.clean(form);
    }catch(error){if(ticket===token)message.textContent=error.message;}}
  function values(){if(!form.reportValidity())throw Error('فیلدهای تنظیمات را کامل کنید.');const data=Object.fromEntries(new FormData(form));delete data.useCustomCol;data.useCustomCol=form.elements.useCustomCol.checked;for(const key of numeric)data[key]=Number(data[key]);return data;}
  async function run(fn){if(busy||!id)return;busy=true;buttons();window.S4Refresh?.beginMutation();try{await fn();}catch(error){message.textContent=error.message;}finally{busy=false;buttons();window.S4Refresh?.endMutation();}}
  form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{const at=revision;await api(`/api/profile-settings/${id}`,'POST',values());if(at===revision){dirty=false;window.S4Refresh?.clean(form);}message.textContent=at===revision?'تنظیمات فقط همین پروفایل ذخیره شد؛ هیچ استخراج، ارسال یا حذف محصولی اجرا نشد.':'تنظیمات قبلی ذخیره شدند؛ پیش‌نویس تازه حفظ شده و هنوز ذخیره نشده است.';window.dispatchEvent(new Event('s4:profile-options-saved'));});});
  $('#profile-options-preview').onclick=()=>run(async()=>{const data=await api(`/api/profile-settings/${id}/preview`,'POST',{options:values(),price:Number($('#profile-preview-price').value),title:$('#profile-preview-title').value});output.textContent=JSON.stringify(data,null,2);message.textContent='پیش‌نمایش قیمت و عنوان؛ داده‌ها و صف تغییری نکردند.';});
  $('#profile-options-reset').onclick=()=>{if(canSwitch())load(id,true);};
  for(const b of form.querySelectorAll('[data-profile-cleanup]'))b.onclick=()=>run(async()=>{if(dirty)throw Error('برای پاک‌سازی، اول تنظیمات را ذخیره کنید.');const target=id;const preview=await api(`/api/profile-settings/${id}/cleanup-preview`,'POST',{mode:b.dataset.profileCleanup});if(!preview.count){message.textContent='محصولی مطابق این شرط پیدا نشد.';return;}
    if(!confirm(`${preview.count} محصول محلی از همین پروفایل حذف شود؟ قابل بازگشت نیست؛ محصولات مقصد حذف نمی‌شوند.`))return;
    if(id!==target)return;const result=await api(`/api/profile-settings/${id}/cleanup`,'POST',{proof:preview.proof});message.textContent=`${result.removed} محصول محلی حذف شد؛ مقصد دست‌نخورده است.`;window.dispatchEvent(new Event('s4:extraction-updated'));
  });
  window.addEventListener('s4:profile-selected',event=>load(event.detail.id));
  load($('#start-profile')?.value||'');
})();
