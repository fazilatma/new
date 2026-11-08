/* Deliberate runtime attachments; upstream functions remain intact in the snapshot. */
(()=>{'use strict';
// Service-worker access itself throws in a real opaque-origin browser. The
// upstream lifecycle helper explicitly accepts null for an unavailable worker.
window.s4RegisterShellWorker=()=>Promise.resolve(null);
// Full-viewport host still keeps the exact upstream client untouched. Fix the
// upstream desktop padding reset that put the title behind its fixed toolbar.
const viewportStyle=document.createElement('style');viewportStyle.id='php-ui-viewport-adapter';
viewportStyle.textContent=`body{padding-top:calc(66px + env(safe-area-inset-top))}body>.container{max-width:none;width:100%;min-width:0}#hdrTools{top:calc(10px + env(safe-area-inset-top))}.settings-panel{height:100vh;height:100dvh}@media(max-width:899px){body{padding-bottom:calc(90px + env(safe-area-inset-bottom))}}`;
document.head.append(viewportStyle);
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
  if(!currentProfileKey||!profileFormReady||isDirty){showToast('ابتدا پروفایل و تغییراتش را با دکمهٔ ذخیره ذخیره کنید.',true);return;}
  const fd=new FormData();fd.set('action','python_enqueue');fd.set('profile',currentProfileKey);fd.set('pages',document.getElementById('pages').value);
  const d=await (await fetch('',{method:'POST',body:fd})).json();if(!d.ok)throw Error(d.error);
  showToast('استخراج در صف پایتون ثبت شد؛ پیشروی با worker/کران تنظیم‌شده است.');refreshExtractQueue();
 }catch(e){showToast(e.message,true);}
};
window.setAppFont=k=>{const selected=window.appFontApply(k,true);syncAppFontPreview(selected);showToast('فونت همین صفحه تغییر کرد؛ تنظیم سراسری سرور تغییر نمی‌کند.');};
// Explicit native commands below never start work during bootstrap or polling.
async function call(action,fields={}){const fd=new FormData();fd.set('action',action);for(const [k,v]of Object.entries(fields))fd.set(k,String(v));const d=await(await fetch('',{method:'POST',body:fd})).json();if(!d.ok)throw Error(d.error);return d;}
const panel=key=>call('python_open_panel',{panel:key}).catch(e=>showToast(e.message,true));
window.pythonOpenPanel=panel;
// Profile hydration must never probe a source URL automatically. Explicit
// original test buttons open the real trusted laboratory instead.
window.testSel=type=>{const out=document.getElementById('prev-'+type);if(out)out.textContent='آزمایش خودکار غیرفعال است؛ دکمهٔ تست، آزمایشگاه امن را باز می‌کند.';};
for(const button of document.querySelectorAll('[onclick^="testSel("]'))button.onclick=()=>panel('selectors');
window.testDetailSel=()=>panel('selectors');
window.s4RuntimeHealthCheck=async()=>{const el=document.getElementById('runtimePulse'),tag=document.getElementById('runtimePulseTag');if(!el||s4RuntimeHealthBusy)return;s4RuntimeHealthBusy=true;try{const d=await(await fetch('?runtime_health=1')).json();if(!d.ok)throw Error(d.error||'پاسخ سلامت نامعتبر است.');el.classList.remove('checking','offline');el.classList.add('online');if(tag)tag.textContent='Py';el.title=`Python v${d.version} · رابط PHP v${d.ui_version} · پاسخ واقعی فقط‌خواندنی`;el.setAttribute('aria-label','بک‌اند پایتون پاسخ می‌دهد');}catch(e){el.classList.remove('checking','online');el.classList.add('offline');if(tag)tag.textContent='!';el.title='خطای دریافت وضعیت پایتون: '+e.message;}finally{s4RuntimeHealthBusy=false;}};

function saved(){if(!currentProfileKey||!profileFormReady||isDirty)throw Error('ابتدا پروفایل و تغییراتش را صریحاً ذخیره کنید؛ صف از دادهٔ ذخیره‌شده استفاده می‌کند.');return currentProfileKey;}
const syncFields=target=>{const f={profile:saved(),target};if(target==='woo'||target==='both')f.status=document.getElementById('wcSt').value;if(target==='bsl'||target==='both'){const selected=typeof bslGetSelectedVids==='function'?bslGetSelectedVids():[];const ids=selected===null?bslAllShopEntries().map(shop=>String(shop.vid)):selected;if(!ids.length)throw Error('حداقل یک غرفهٔ ذخیره‌شده انتخاب کنید.');f.vendor_ids=JSON.stringify(ids.map(String));}return f;};
async function send(target){try{const d=await call('python_send_enqueue',syncFields(target));showToast('ارسال همهٔ محصولات ذخیره‌شده در صف پایتون ثبت شد؛ HTTP مقصد هنوز اجرا نشده.');if(target==='woo')checkWooQueue();else checkBslQueue();return d;}catch(e){showToast(e.message,true);}}
window.sendWoo=()=>send('woo');window.sendBsl=()=>send('bsl');
window.sendBslClient=window.queueWooSend=window.queueBslSend=unsupported;
window.startManualSync=async()=>{try{const f=syncFields(document.getElementById('profileSyncTarget').value);const noExtract=document.getElementById('profileSyncNoExtract').checked;if(!noExtract)f.pages=document.getElementById('pages').value;const d=await call(noExtract?'python_send_enqueue':'python_manual_sync',f);showToast(noExtract?'ارسال مستقیم در صف پایتون ثبت شد.':'زنجیرهٔ استخراج و سپس ارسال در صف پایتون ثبت شد.');refreshExtractQueue();return d;}catch(e){showToast(e.message,true);}};
for(const name of ['removeNoPrice','removeBelowMinPrice','clearResults'])window[name]=()=>panel('profile');
window.saveConn=target=>panel(target?(target==='woo'?'woocommerce':'basalam'):'general');
const control=(id,action,kind)=>call('python_queue_control',id?{id,control:action}:{profile:saved(),kind,control:action});
for(const [name,kind]of [['stop','extract'],['wooStop','woo_send'],['stopBslProcess','bsl_send']])window[name]=async()=>{try{await control('', 'pause',kind);showToast('کارهای فعال همین پروفایل مکث شد؛ درخواست درحال پرواز ممکن است تمام شود.');}catch(e){showToast(e.message,true);}};
async function retire(id,kind){try{const data=await call(kind==='extract'?'extract_queue_status':kind==='woo_send'?'woo_queue_status':'bsl_queue_status');const row=data.entries.find(e=>String(e.id)===String(id));if(!row)throw Error('ردیف در ۱۰۰ کار اخیر نیست؛ از کنترل امن صف استفاده کنید.');const action=['done','cancelled'].includes(row.status)?'delete':'cancel';await control(String(id),action);showToast(action==='delete'?'رد کار پایان‌یافته پاک شد.':'کار لغو شد؛ درخواست درحال پرواز ممکن است تمام شود.');refreshExtractQueue();checkWooQueue();checkBslQueue();}catch(e){showToast(e.message,true);}}
for(const [name,kind]of [['deleteExtractQueue','extract'],['deleteWooQueue','woo_send'],['deleteBslQueue','bsl_send'],['cancelBslQueueEntry','bsl_send']])window[name]=id=>retire(id,kind);
for(const [name,kind]of [['clearExtractQueueDone','extract'],['clearWooQueueDone','woo_send'],['clearBslQueueDone','bsl_send']])window[name]=async()=>{try{const d=await call('python_queue_clear',{kind});showToast(`${d.removed} کار پایان‌یافته/لغوشده پاک شد؛ ناموفق‌ها و کارهای فعال حفظ شدند.`);refreshExtractQueue();checkWooQueue();checkBslQueue();}catch(e){showToast(e.message,true);}};
for(const name of ['stopExtractQueue','pauseBslQueue'])window[name]=async id=>{try{await control(String(id),'pause');showToast('مکث ذخیره شد؛ درخواست درحال پرواز ممکن است تمام شود.');refreshExtractQueue();checkBslQueue();}catch(e){showToast(e.message,true);}};
for(const name of ['resumeBslQueue','startWooServer','startBslServer'])window[name]=()=>panel('guardian');
window.resumeExtractQueue=(profile,id,page,autoResume)=>{if(!autoResume)return panel('guardian');};
// These are scheduling callbacks, not user commands. Python alone claims work.
window.bslManageLaneOperations=()=>{};window.startNextBslQueueEntry=()=>{};window.bslWatchHiddenLane=()=>{};
window.restartBslServer=unsupported;
for(const [name,action]of [['tmStop','pause'],['tmResume','resume'],['tmClear','delete']])window[name]=async key=>{try{if(!/^py:[1-9][0-9]*$/.test(key))throw Error('این نوع کار هنوز متصل نیست.');if(action==='resume'){panel('guardian');showToast('ادامه را در کنترل امن صف انجام دهید؛ ارسال ناموفق نیازمند بررسی مقصد است.');return;}await control(key.slice(3),action);tmRefresh(true);}catch(e){showToast(e.message,true);}};
window.tmResumeAll=()=>showToast('ادامهٔ دسته‌جمعی/خودکار ایمن نیست؛ هر کار را پس از بررسی در کنترل صف ادامه دهید.',true);
window.tmSetConcurrency=window.tmCpuChange=window.tmOrder=unsupported;
for(const [name,kind]of [['tmResumeJob','resume'],['tmDeleteJob','delete']])window[name]=unsupported;
window.openDuplicateProfileModal=async explicitKey=>{try{const profile=explicitKey||saved(),source=profiles.find(p=>p.key===profile),name=prompt('نام کپی پروفایل (فقط تنظیمات؛ بدون محصولات/شناسه‌های مقصد):',(source?.name||'پروفایل')+' - کپی');if(!name)return;const d=await call('python_profile_duplicate',{profile,name});profiles.push(d);renderProfileDropdown();showToast('پروفایل کپی شد؛ محصولات و شناسه‌های مقصد کپی نشدند.');}catch(e){showToast(e.message,true);}};
async function deleteLocal(profile){try{await call('python_profile_delete',{profile});purgeDeletedProfileClientState(profile);showToast('پروفایل و محصولات محلی حذف شد؛ محصولات مقصد حذف نشدند.');loadStartProductOverview(true);}catch(e){showToast(e.message,true);}}
window.deleteProfile=()=>{try{return deleteLocal(saved());}catch(e){showToast(e.message,true);}};
window.deleteStartBreakdownProfile=btn=>{const profile=btn?.dataset.delProfile;if(profile)deleteLocal(profile);};
const add=(node,text,key)=>{if(!node||node.querySelector('[data-python-panel="'+key+'"]'))return;const b=document.createElement('button');b.type='button';b.className='btn btn-cyan';b.dataset.pythonPanel=key;b.textContent=text;b.onclick=()=>panel(key);node.prepend(b);};
for(const [id,key,text]of [['pane-settings','profile','⚙ تنظیمات واقعی و پاک‌سازی امن پروفایل'],['pane-selectors','selectors','🔬 آزمایش واقعی سلکتور'],['pane-selectors','audit','🧪 مقایسهٔ موتورهای پایتون'],['pane-results','results','📊 مرور تمام محصولات، جست‌وجو و جزئیات'],['pane-start','guardian','⏯ کنترل امن صف پایتون']])add(document.getElementById(id),text,key);
// Original secret fields are intentionally inert. Their replacements are the
// same trusted menu controllers already used by the default Python dashboard.
for(const [id,key]of [['wcUrl','woocommerce'],['bsTk','basalam'],['vcRepo','version'],['renderUrl','render'],['appFontSel','general'],['tmCards','guardian'],['sxPicker','backup'],['phpRuntimeResult','general'],['stallWatchdog','guardian']]){const body=document.getElementById(id)?.closest('.smenu-body');if(!body)continue;for(const n of body.querySelectorAll('input,select,textarea,button'))if(!['appFontSel','appThemeSel','appFxSel'].includes(n.id))n.disabled=true;add(body,'بازکردن تنظیمات متصل پایتون در همین صفحه',key);}
add(document.getElementById('settingsPanel')?.querySelector('.settings-panel-body')||document.getElementById('settingsPanel'),'☰ همهٔ تنظیمات اجرایی / بکاپ / کران','general');
add(document.getElementById('settingsPanel')?.querySelector('.settings-panel-body'),'ℹ اطلاعات رابط و ابزارهای امن پایتون','help');
window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='s4-php-refresh-profile')return;if(isDirty){showToast('تنظیمات امن ذخیره شد؛ برای دریافت نسخهٔ تازه ابتدا پیش‌نویس را ذخیره/لغو کنید.',true);return;}loadConn();if(currentProfileKey)loadProfileFromServer(currentProfileKey,true);});
// The original version checker sees the pinned UI version, not the port's version.
// Network heartbeats/auto-resume requests are intentionally NOT mapped to cron.
})();
