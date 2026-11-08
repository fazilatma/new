/* Host-managed process controls; no arbitrary command or WSGI process launch. */
(() => {
  'use strict';
  const form=document.querySelector('#worker-runtime-form');if(!form)return;
  const message=document.querySelector('#worker-runtime-message'),state=document.querySelector('#worker-runtime-state');
  const activate=document.querySelector('#worker-native-schedule');let busy=false,revision=0;
  form.addEventListener('input',()=>revision++);form.addEventListener('change',()=>revision++);
  async function api(path,data){
    const response=await fetch(path,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf"]').content},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const value=await response.json();if(!response.ok)throw Error(value.error||`HTTP ${response.status}`);return value;
  }
  async function refresh(fill=false){
    const version=revision;const data=await api('/api/worker/status');
    if(fill&&version===revision&&!window.S4Refresh?.isDirty(form)){form.elements.enabled.checked=data.config.enabled;form.elements.poll_seconds.value=data.config.poll_seconds;}
    state.textContent=JSON.stringify({observed_running:data.observed_running,phase:data.state.phase||'not_observed',heartbeat_age_seconds:data.heartbeat_age_seconds,native_schedule:data.native_schedule,enabled:data.config.enabled},null,2);
    document.querySelector('#worker-runtime-commands').textContent=Object.entries(data.commands||{}).map(([key,command])=>`${key}:\n${command}`).join('\n\n')||data.setup_hint||'';
    message.textContent=data.observed_running?'worker با قفل و ضربان تازه مشاهده شد؛ مرحلهٔ جاری ممکن است هنوز در حال اجرا باشد.':data.config.enabled?'اجازهٔ اجرا روشن است، ولی worker زنده مشاهده نشده؛ Task/Always-on یا فرمان کنسول را شروع کنید.':'worker داخلی غیرفعال است؛ این تنظیم کران بیرونی را خاموش نمی‌کند.';
  }
  async function act(callback){
    if(busy)return;busy=true;activate.disabled=true;form.querySelector('[type=submit]').disabled=true;window.S4Refresh?.beginMutation();
    try{await callback();}catch(error){message.textContent=error.message;}
    finally{busy=false;activate.disabled=false;form.querySelector('[type=submit]').disabled=false;window.S4Refresh?.endMutation();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();const value={enabled:form.elements.enabled.checked,poll_seconds:Number(form.elements.poll_seconds.value)};
    if(value.enabled&&!confirm('worker داخلی اجازهٔ پردازش صف‌های استخراج و ارسالِ از قبل ثبت‌شده را داشته باشد؟'))return;
    const version=revision,stamp=window.S4Refresh?.revision(form);
    act(async()=>{const data=await api('/api/worker/config',value);if(version===revision)window.S4Refresh?.clean(form,stamp);await refresh();message.textContent=data.note;});
  });
  activate.onclick=()=>{if(window.S4Refresh?.isDirty(form)){message.textContent='ابتدا تغییرات تنظیم worker را ذخیره کنید؛ Task با تنظیمات ذخیره‌شده ساخته می‌شود.';return;}if(!confirm('Task همین برنامه ایجاد/ارتقا و اجازهٔ worker روشن شود؟ صف‌های ارسال ثبت‌شده هم قابل پردازش‌اند؛ محدودیت پلن میزبان ممکن است مانع شود.'))return;
    act(async()=>{const data=await api('/api/worker/schedule',{});await refresh(true);message.textContent=data.note;});
  };
  document.querySelector('#worker-runtime-refresh').onclick=()=>refresh().catch(error=>message.textContent=error.message);
  setInterval(()=>{if(!document.hidden&&!busy)refresh().catch(()=>{});},20000);
  refresh(true).catch(error=>message.textContent=error.message);
})();
