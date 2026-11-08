/* Deliberate runtime attachments; upstream functions remain intact in the snapshot. */
(()=>{'use strict';
const unsupported=()=>{showToast('این عملیات هنوز به پایتون متصل نیست؛ مدیریت فعلی را استفاده کنید.',true);};
// Never pretend that a browser-local edit deletes durable/remote products.
for(const name of ['removeNoPrice','removeBelowMinPrice','clearAll','clearResults','startDetailExtraction','start','startAutoExtract','startManualSync','startWoo','startBsl','saveConn'])if(typeof window[name]==='function')window[name]=unsupported;
// Upstream's late syncConfig wrapper drops includeProducts; restore that argument
// at the attachment boundary so a settings-only save cannot upload all products.
const originalCollector=collectProfileData;
window.collectProfileData=includeProducts=>{const data=originalCollector();if(includeProducts===false){delete data.products;delete data.productsOrder;}return data;};
window.saveProfileSilent=()=>Promise.resolve({ok:false,error:'native_explicit_save_required'});
window.backendExtractFor=async()=>{
 try{
  if(!currentProfileKey||isDirty){showToast('ابتدا پروفایل و تغییراتش را با دکمهٔ ذخیره ذخیره کنید.',true);return;}
  const fd=new FormData();fd.set('action','python_enqueue');fd.set('profile',currentProfileKey);fd.set('pages',document.getElementById('pages').value);
  const d=await (await fetch('',{method:'POST',body:fd})).json();if(!d.ok)throw Error(d.error);
  showToast('استخراج در صف پایتون ثبت شد؛ پیشروی با worker/کران تنظیم‌شده است.');refreshExtractQueue();
 }catch(e){showToast(e.message,true);}
};
window.setAppFont=k=>{const selected=window.appFontApply(k,true);syncAppFontPreview(selected);showToast('فونت همین صفحه تغییر کرد؛ تنظیم سراسری سرور تغییر نمی‌کند.');};
// The original version checker sees the pinned UI version, not the port's version.
// Network heartbeats/auto-resume requests are intentionally NOT mapped to cron.
})();
