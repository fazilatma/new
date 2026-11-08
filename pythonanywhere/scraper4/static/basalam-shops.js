(() => {
  'use strict';const form=document.querySelector('#basalam-shop-form');if(!form)return;
  const list=document.querySelector('#basalam-shops-list'),message=document.querySelector('#basalam-shops-message');let busy=false;
  async function api(url,method='GET',data){const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf]').content},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;}
  function show(vendors){list.replaceChildren();const select=document.querySelector('#send-form [name=vendor_id]');const previous=select?.value;if(select)select.replaceChildren();
    for(const shop of vendors){const card=document.createElement('article');card.className='shop-card';const title=document.createElement('h3');title.textContent=shop.shop_name;card.append(title);
      const summary=document.createElement('p');summary.textContent=`#${shop.vendor_id} · ${shop.is_default?'اصلی · ':''}توکن ${shop.token_configured?'ذخیره‌شده':'موجود نیست'}`;card.append(summary);
      if(!shop.is_default){for(const [label,action] of [['ویرایش',()=>{for(const key of ['vendor_id','shop_name','category_id','price_mode','price_val'])form.elements[key].value=shop[key]??(key==='price_mode'?'none':key==='price_val'?0:'');form.elements.token.value='';window.S4Refresh?.changed(form);} ],['حذف اتصال',()=>remove(shop)]]){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.onclick=action;card.append(button);}}
      list.append(card);if(select&&shop.token_configured){const option=document.createElement('option');option.value=shop.vendor_id;option.textContent=shop.shop_name+' #'+shop.vendor_id;select.append(option);}
    }
    if(select&&[...select.options].some(o=>o.value===previous))select.value=previous;
    if(!vendors.length)message.textContent='هنوز غرفه‌ای ثبت نشده است؛ اتصال اصلی یا غرفهٔ اضافی را ثبت کنید.';
  }
  async function run(callback){if(busy)return;busy=true;window.S4Refresh?.beginMutation();try{await callback();}catch(error){message.textContent=error.message;}finally{busy=false;window.S4Refresh?.endMutation();}}
  async function remove(shop){if(!confirm(`اتصال غرفهٔ ${shop.shop_name} حذف شود؟ محصولات مقصد و شناسه‌های ذخیره‌شده حذف نمی‌شوند.`))return;
    run(async()=>{show((await api('/api/basalam/vendors/'+encodeURIComponent(shop.vendor_id),'DELETE',{})).vendors);message.textContent='اتصال حذف شد؛ محصولات و شناسه‌های مقصد حفظ شدند.';});}
  form.addEventListener('submit',event=>{event.preventDefault();const revision=window.S4Refresh?.revision(form);const data=Object.fromEntries(new FormData(form));run(async()=>{
    const result=await api('/api/basalam/vendors','POST',data);show(result.vendors);if(revision===window.S4Refresh?.revision(form)){form.reset();window.S4Refresh?.clean(form,revision);}message.textContent='غرفه ذخیره شد؛ توکن نمایش داده نمی‌شود. مقصد را در تب ارسال انتخاب کنید.';
  });});
  const refresh=()=>api('/api/basalam/vendors').then(result=>show(result.vendors)).catch(error=>message.textContent=error.message);
  window.addEventListener('s4:connections-saved',refresh);refresh();
})();
