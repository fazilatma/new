/* Start workspace: safe text rendering; bounded explicit actions, no remote sends. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s),form=$('#start-profile-form'),job=$('#job-form');if(!form||!job)return;
  const el=form.elements,select=$('#start-profile'),status=$('#start-action-status');
  let profiles=[],active='',dirty=false,busy=false,latest=null,overviewBusy=false,sourceReady=false,editRevision=0;
  const n=v=>Number(v||0).toLocaleString('fa-IR');
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
  async function request(url,method='GET',data){
    if(method!=='GET')window.S4Refresh?.beginMutation();
    try{const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':$('meta[name=csrf]').content},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok||result.ok===false)throw Error(result.error||`HTTP ${response.status}`);return result;}
    finally{if(method!=='GET')window.S4Refresh?.endMutation();}
  }
  function toggleCard(card,collapsed){card.classList.toggle('start-collapsed',collapsed);card.querySelector('.start-collapse-toggle')?.setAttribute('aria-expanded',String(!collapsed));}
  function collapseCards(){for(const card of document.querySelectorAll('#pane-start section[id]')){
    if(card.dataset.startCollapseReady)continue;card.dataset.startCollapseReady='1';card.classList.add('start-collapsible');
    const header=node('div',undefined,'start-collapse-header'),label=node('span',card.querySelector('h2')?.textContent||'بخش شروع');header.append(label);
    const button=node('button','باز / بسته ▾','secondary start-collapse-toggle');button.type='button';button.setAttribute('aria-controls',card.id);button.setAttribute('aria-expanded','true');header.append(button);card.prepend(header);
    try{toggleCard(card,localStorage.getItem('s4-start-collapse:'+card.id)==='1');}catch(_error){}
    button.onclick=()=>{const closed=!card.classList.contains('start-collapsed');toggleCard(card,closed);try{localStorage.setItem('s4-start-collapse:'+card.id,closed?'1':'0');}catch(_error){}};
  }}
  collapseCards();
  function showCard(id){const card=$('#'+id);if(card){toggleCard(card,false);card.scrollIntoView({block:'start',behavior:'smooth'});}}
  function sourceUI(){$('#start-github').hidden=el.source.value!=='github';for(const name of ['github_repo','github_branch','github_path'])el[name].required=el.source.value==='github';}
  function controls(){for(const id of ['start-copy','start-delete','start-stop','start-sync-stop','start-selectors','start-detail-only'])$('#'+id).disabled=busy||!active;for(const id of ['start-save','start-enqueue','start-sync','start-experiment','start-new'])$('#'+id).disabled=busy;}
  function setDirty(){editRevision++;dirty=true;window.S4Refresh?.changed(form);}
  form.addEventListener('input',setDirty);form.addEventListener('change',setDirty);
  el.source.addEventListener('change',sourceUI);
  el.pages.addEventListener('input',()=>{job.elements.pages.value=el.pages.value;});
  job.elements.pages.addEventListener('input',()=>{el.pages.value=job.elements.pages.value;setDirty();});
  el.url.addEventListener('change',()=>{
    try{const host=new URL(el.url.value).hostname.toLowerCase();const engine=host==='snappshop.ir'||host.endsWith('.snappshop.ir')?'snappshop_api':host==='digikala.com'||host.endsWith('.digikala.com')?'digikala_api':host==='basalam.com'||host.endsWith('.basalam.com')?'basalam_api':'';
      if(engine){el.engine.value=engine;$('#start-engine-hint').textContent='موتور پیشنهادی آدرس انتخاب شد؛ پیش از شروع می‌توانید تغییرش دهید.';}}
    catch(_error){}
  });
  function updateOptions(){
    const value=active;select.replaceChildren(new Option('＋ پروفایل تازه',''));
    for(const p of profiles)select.add(new Option(p.name||p.key,String(p.id)));select.value=value;
    for(const target of [job.elements.profile_id,$('#results-profile'),$('#send-form')?.elements.profile_id,$('#extraction-audit-form')?.elements.profile_id]){
      if(!target)continue;const previous=target.value;
      for(const p of profiles){let option=Array.from(target.options).find(o=>o.value===String(p.id));if(!option){option=new Option('',String(p.id));target.add(option);}option.textContent=p.name||p.key;}
      for(const option of Array.from(target.options))if(/^\d+$/.test(option.value)&&!profiles.some(p=>String(p.id)===option.value))option.remove();
      if(Array.from(target.options).some(o=>o.value===previous))target.value=previous;
    }
    if(active)job.elements.profile_id.value=active;
  }
  function fill(id){
    active=String(id||'');const p=profiles.find(p=>String(p.id)===active),s=p?.settings||{},opts=p?.start_options||{};select.value=active;
    for(const [name,value] of Object.entries({name:p?.name||'',url:p?.url||'',engine:p?.extraction_engine||s.extractionEngine||'selectors',pages:s.startPages??opts.pages??10,pag_type:p?.pagination?.type||'query_page',pag_val:p?.pagination?.val||'',detail_mode:s.detailExtractMode||opts.detail_mode||'two_stage',source:typeof s.productSource==='string'?s.productSource:(opts.source||'direct'),github_repo:s.sourceGithub?.repo||opts.github?.repo||'',github_branch:s.sourceGithub?.branch||opts.github?.branch||'main',github_path:s.sourceGithub?.path||opts.github?.path||''}))el[name].value=value;
    el.with_detail.checked=opts.with_detail!==false&&s.startWithDetail!==false;job.elements.pages.value=el.pages.value;if(active)job.elements.profile_id.value=active;
    dirty=false;window.S4Refresh?.clean(form);sourceUI();controls();
    window.dispatchEvent(new CustomEvent('s4:profile-selected',{detail:{id:active}}));
    try{localStorage.setItem('s4-start-profile',active);}catch(_error){}
    $('#start-target-hint').textContent=p?`تغییر آدرس، موتور و جزئیات فقط روی «${p.name||p.key}» ذخیره می‌شود؛ سلکتورها و شناسه‌های مقصد حفظ می‌شوند.`:'پروفایل جدید؛ هیچ پروفایل قبلی بازنویسی نمی‌شود.';
  }
  function changeProfile(id){if(busy||(window.S4ProfileOptions&&!window.S4ProfileOptions.canSwitch())||(dirty&&!confirm('تغییرات ذخیره‌نشده کنار گذاشته و پروفایل عوض شود؟'))){select.value=active;if(active)job.elements.profile_id.value=active;return false;}fill(id);return true;}
  select.onchange=event=>{event.stopPropagation();changeProfile(select.value);};job.elements.profile_id.addEventListener('change',event=>{event.stopPropagation();changeProfile(job.elements.profile_id.value);});
  $('#start-new').onclick=()=>{changeProfile('');showCard('start-profile-card');el.name.focus();};
  $('#start-reset').onclick=()=>{if(!busy&&(!dirty||confirm('تنظیمات ذخیره‌شده بازخوانی شوند؟ محصولات و صف حذف نمی‌شوند.')))fill(active);};
  form.noValidate=true;job.noValidate=true;
  function payload(){
    for(const invalid of form.querySelectorAll(':invalid')){const card=invalid.closest('section');if(card)toggleCard(card,false);}
    form.inert=false;const valid=form.reportValidity();form.inert=busy;if(!valid)throw Error('فیلدهای لازم را کامل کنید.');
    return {id:active?Number(active):null,name:el.name.value,url:el.url.value,engine:el.engine.value,pagination:{type:el.pag_type.value,val:el.pag_val.value},pages:Number(el.pages.value),with_detail:el.with_detail.checked,detail_mode:el.detail_mode.value,source:el.source.value,github:{repo:el.github_repo.value,branch:el.github_branch.value,path:el.github_path.value}};
  }
  async function save(){await ready;if(!sourceReady)throw Error('فهرست پروفایل‌ها دریافت نشده؛ صفحه را تازه کنید.');const data=payload(),revision=editRevision;const {profile}=await request('/api/start/profile','POST',data);
    profiles=profiles.filter(p=>p.id!==profile.id);profiles.push(profile);active=String(profile.id);updateOptions();if(revision!==editRevision){dirty=true;throw Error('تنظیمات هنگام ذخیره تغییر کردند؛ پیش‌نویس حفظ شد. دوباره ذخیره کنید؛ استخراجی صف نشد.');}fill(active);return profile;}
  async function action(fn){if(busy)return false;busy=true;form.inert=true;job.inert=true;controls();window.S4Refresh?.beginMutation();try{return await fn();}catch(error){status.textContent=error.message;return false;}finally{busy=false;form.inert=false;job.inert=false;controls();window.S4Refresh?.endMutation();}}
  form.addEventListener('submit',event=>{event.preventDefault();action(async()=>{await save();status.textContent='پروفایل ذخیره شد؛ سلکتورها و داده‌های قبلی حفظ شدند.';await refreshOverview(false);});});
  function openSelectors(){const p=profiles.find(p=>String(p.id)===active);if(!p)return;const target=$('#profile-form');if(window.S4Refresh?.isDirty(target)&&!confirm('تغییرات ذخیره‌نشدهٔ تب سلکتورها کنار گذاشته شوند؟'))return;
    for(const k of ['key','name','url'])target.elements[k].value=p[k]||'';
    target.elements.extractionEngine.value=p.extraction_engine||p.settings?.extractionEngine||'selectors';target.elements.pagType.value=p.pagination?.type||'query_page';target.elements.pagVal.value=p.pagination?.val||'';
    for(const k of ['container','title','price','link','image','sku'])target.elements[k].value=p.selectors?.[k]||'';
    for(const k of ['shortDesc','longDesc','specs','images','sku','brand','category','tags']){const v=p.settings?.detailSelectors?.[k];target.elements['detail_'+k].value=typeof v==='string'?v:(v?.enabled===false?'':v?.selector||'');}
    window.S4Refresh?.clean(target);$('#tab-selectors').click();target.scrollIntoView({block:'start'});
  }
  $('#start-selectors').onclick=openSelectors;
  $('#start-mode-manual').onclick=()=>{if(dirty){status.textContent='ابتدا تغییرات شروع را ذخیره کنید؛ سپس سلکتورها را ویرایش کنید.';return;}openSelectors();};
  $('#start-mode-auto').onclick=()=>showCard('start-run-card');
  $('#start-pagination-test').onclick=()=>action(async()=>{const data=payload();if(data.pagination.type==='next_selector'){$('#start-pagination-result').textContent='این روش به HTML صفحه و CSS دکمهٔ بعد نیاز دارد؛ پیش‌نمایش URL ثابت نیست. در تب سلکتورها پیش‌نمایش صفحه را اجرا کنید.';return;}
    const result=await request('/api/pagination/preview?'+new URLSearchParams({url:data.url,type:data.pagination.type,val:data.pagination.val,pages:3}));$('#start-pagination-result').textContent=result.urls.join('\n');});
  async function enqueue(data,sendAfter=[]){return action(async()=>{
    const p=await save();const result=await request('/api/start/enqueue','POST',{profile_id:p.id,pages:Number(el.pages.value),render:data.render||job.elements.render.value,send_after:sendAfter});
    status.textContent=`کار ${result.id} ذخیره و صف شد؛ ادامه با کران / worker. ${sendAfter.length?'ارسال‌ها فقط پس از پایان موفق و غیرخالی صف می‌شوند.':'هیچ ارسال مقصدی انتخاب نشده است.'}`;
    window.dispatchEvent(new Event('s4:extraction-enqueued'));window.dispatchEvent(new Event('s4:start-queued'));return true;
  });}
  window.S4Start={enqueue,select:changeProfile};
  $('#start-detail-only').onclick=()=>action(async()=>{await ready;if(!active)throw Error('ابتدا پروفایل را انتخاب کنید.');if(dirty)throw Error('ابتدا تغییرات شروع را ذخیره کنید؛ جزئیات از تنظیمات ذخیره‌شده خوانده می‌شود.');const p=profiles.find(p=>String(p.id)===active);if(!p)throw Error('پروفایل پیدا نشد.');if(!confirm('جزئیات محصولات دارای لینک همین پروفایل با سلکتورهای ذخیره‌شده خوانده و ذخیره شود؟ یک مرحلهٔ واقعی، بدون تکرار فهرست یا ارسال مقصد.'))return;
    status.textContent='در حال استخراج جزئیات محصولات ذخیره‌شده…';const d=await request('/api/php-ui/write','POST',{action:'python_detail_start',fields:{profile:p.key},query:{}});status.textContent=`کار جزئیات #${d.id} · ${d.message}`;window.dispatchEvent(new Event('s4:extraction-enqueued'));await refreshOverview(false);
  });
  $('#start-sync').onclick=()=>{const targets=[];if($('#start-sync-woo').checked)targets.push({kind:'woo_send',status:'draft'});if($('#start-sync-bsl').checked){if(!$('#start-sync-vendor').value){status.textContent='ابتدا غرفهٔ مقصد را انتخاب کنید.';return;}targets.push({kind:'bsl_send',vendor_id:$('#start-sync-vendor').value});}
    if(!targets.length){status.textContent='حداقل یک مقصد انتخاب کنید.';return;}if(confirm('بعد از استخراج موفق، تمام محصولات ذخیره‌شدهٔ همین پروفایل (از جمله قبلی‌ها) به مقصدهای انتخابی ارسال شوند؟ پیش‌نمایش قیمتِ تنظیمات همین پروفایل و تنظیمات مقصد را بررسی کنید. ارسال ناموفق را بدون بررسی مقصد تکرار نکنید.'))enqueue({render:job.elements.render.value},targets);};
  async function pause(chain){return action(async()=>{if(!active)throw Error('پروفایل را انتخاب کنید.');const result=await request(`/api/start/profiles/${active}/pause`,'POST',{chain});status.textContent=`${n(result.paused)} کار مکث شد؛ درخواست جاری تا مرز امن فرصت پایان دارد و ارسال شروع‌شده ممکن است کامل شود. ادامه فقط از کنترل صف.`;window.dispatchEvent(new Event('s4:extraction-updated'));window.dispatchEvent(new Event('s4:start-queued'));});}
  $('#start-stop').onclick=()=>pause(false);$('#start-sync-stop').onclick=()=>{if(confirm('استخراج و ارسال‌های زنجیره‌ای همین پروفایل مکث شوند؟ ارسال مستقل متوقف نمی‌شود؛ درخواست ارسال جاری ممکن است کامل شود.'))pause(true);};
  $('#start-experiment').onclick=()=>action(async()=>{await ready;if(!active)throw Error('برای آزمایش، ابتدا پروفایل را ذخیره کنید.');if(dirty)throw Error('آزمایش از تنظیمات ذخیره‌شده استفاده می‌کند؛ ابتدا ذخیره کنید.');status.textContent='آزمایش فقط صفحهٔ اول با موتور heuristic، بدون ذخیرهٔ محصولات…';
    const {report}=await request('/api/extraction/probe','POST',{profile_id:Number(active),engine:'heuristic'});status.textContent=`${report.status==='passed'?'دارای محصول':report.status==='empty'?'بدون محصول':'خطا'}: ${n(report.count)} محصول · ${report.hint||''} · فقط صفحهٔ اول؛ صف و محصولات تغییر نکردند.`;});
  $('#start-audit-link').onclick=()=>{const audit=$('#extraction-audit-form');audit.elements.profile_id.value='all';audit.elements.pages.value='5';showCard('extraction-audit');};
  $('#start-clear-finished').onclick=()=>{if(confirm('کارهای تمام‌شده و لغوشده حذف شوند؟ محصولات، کارهای فعال و خطادار حفظ می‌شوند.'))action(async()=>{const result=await request('/api/start/queues/clear-finished','POST',{});status.textContent=`${n(result.removed)} کار پاک شد؛ کارهای فعال و خطادار حفظ شدند.`;window.dispatchEvent(new Event('s4:start-queued'));});};
  const copyDialog=$('#start-copy-dialog');$('#start-copy').onclick=()=>{const p=profiles.find(p=>String(p.id)===active);if(!p)return;const fields=$('#start-copy-form').elements;fields.name.value=(p.name||p.key)+' — کپی';fields.url.value='';copyDialog.showModal();};
  $('#start-copy-cancel').onclick=()=>copyDialog.close();$('#start-copy-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{if(dirty&&!confirm('کپی از تنظیمات ذخیره‌شده ساخته شود؟ تغییرات ذخیره‌نشده کپی نمی‌شوند.'))return;const fields=event.currentTarget.elements;const {profile}=await request(`/api/start/profiles/${active}/duplicate`,'POST',{name:fields.name.value,url:fields.url.value});profiles.push(profile);active=String(profile.id);updateOptions();fill(active);window.S4Refresh?.clean($('#start-copy-form'));copyDialog.close();status.textContent='کپی تنظیمات ساخته شد؛ محصولات و شناسه‌های مقصد کپی نشدند.';await refreshOverview(false);});});
  $('#start-delete').onclick=()=>{const p=profiles.find(p=>String(p.id)===active);if(!p||!confirm(`«${p.name||p.key}» و تمام محصولات محلی آن حذف شوند؟ این حذف قابل بازگشت نیست؛ محصولات مقصد حذف نمی‌شوند. کار فعال را ابتدا لغو کنید.`))return;action(async()=>{await request(`/api/profiles/${active}`,'DELETE');profiles=profiles.filter(p=>String(p.id)!==active);active='';updateOptions();fill(profiles[0]?.id||'');status.textContent='پروفایل و محصولات محلی حذف شدند؛ مقصد تغییری نکرد.';await refreshOverview(false);});};
  function browse(key,profile='',name=''){if(window.S4Menu?.browse(key,profile,name))return;window.S4Browse?.(key,profile,name);}
  function counter(value,key,p){const b=node('button',n(value),'count-drilldown');b.type='button';b.onclick=()=>browse(key,p?.id||'',p?.name||'');return b;}
  function renderOverview(data){latest=data;const grid=$('#start-metrics');grid.replaceChildren();for(const [index,metric] of data.metrics.entries()){
    const card=node('button',undefined,'start-metric');card.type='button';card.dataset.metric=metric.id;card.style.setProperty('--metric-color',['#38bdf8','#22c55e','#f97316','#10b981','#ef4444','#eab308','#8b5cf6','#f43f5e'][index%8]);
    card.append(node('span',metric.icon,'start-metric-icon'),node('span',metric.label,'start-metric-label'),node('strong',n(data.totals[metric.id])),node('small',`${n(data.totals.all?Math.round(data.totals[metric.id]*100/data.totals.all):0)}٪ از کل`));card.onclick=()=>browse(metric.id);grid.append(card);
    if(!Array.from($('#products-filter').options).some(o=>o.value===metric.id))$('#products-filter').add(new Option(metric.label,metric.id));
  }
    for(const [key,label] of [['detail_present','دارای دادهٔ جزئیات'],['detail_checked','جزئیات بررسی‌شده']])if(!Array.from($('#products-filter').options).some(o=>o.value===key))$('#products-filter').add(new Option(label,key));
    const headers=['پروفایل','کل','قیمت','تصویر / گالری','جزئیات / بررسی‌شده','سلکتور جزئیات',...data.destinations.map(d=>d.label+' · شناسهٔ محلی'),'عملیات'];const head=node('tr');for(const text of headers)head.append(node('th',text));$('#start-breakdown-head').replaceChildren(head);
    const body=$('#start-breakdown-body');body.replaceChildren();for(const p of data.by_profile){const row=node('tr');const name=node('td');name.append(node('strong',p.name),node('small',`${p.enabled?'فعال':'غیرفعال'} · ${p.engine}`));row.append(name);
      for(const [key,count] of [['all',p.counts.all],['priced',p.counts.priced]]){const td=node('td');td.append(counter(count,key,p));row.append(td);}
      const images=node('td');images.append(counter(p.counts.has_image,'has_image',p),node('span',' / '),counter(p.counts.gallery,'gallery',p));row.append(images);
      const details=node('td');details.append(counter(p.detail.present,'detail_present',p),node('span',' / '),counter(p.detail.checked,'detail_checked',p));row.append(details,node('td',n(p.detail.selectors)));
      for(const dest of data.destinations)row.append(node('td',n(p.destinations[dest.key])));
      const actions=node('td');for(const [label,fn] of [['انتخاب',()=>{changeProfile(p.id);showCard('start-profile-card');}],['محصولات',()=>browse('all',p.id,p.name)]]){const b=node('button',label,'secondary');b.type='button';b.onclick=fn;actions.append(b);}row.append(actions);body.append(row);
    }
    if(!data.by_profile.length){const row=node('tr'),td=node('td','هنوز پروفایلی ثبت نشده است.');td.colSpan=headers.length;row.append(td);body.append(row);}
    const foot=node('tr');for(const value of ['جمع',n(data.totals.all),n(data.totals.priced),`${n(data.totals.has_image)} / ${n(data.totals.gallery)}`,'—','—',...data.destinations.map(d=>n(data.destination_totals[d.key])),'—'])foot.append(node('td',value));$('#start-breakdown-foot').replaceChildren(foot);
    $('#start-overview-status').textContent=`${n(data.totals.all)} محصول · ${n(data.by_profile.length)} پروفایل · ${data.generated_at} UTC · آمار محلی${data.snapshot_recorded===false?' · ثبت نمودار: حداکثر یک بار در دقیقه':''}`;renderChart();
  }
  async function refreshOverview(record=false){if(overviewBusy)return;overviewBusy=true;$('#start-overview-refresh').disabled=true;$('#start-overview-card').setAttribute('aria-busy','true');
    try{renderOverview(await request(record?'/api/start/snapshot':'/api/start/overview',record?'POST':'GET',record?{}:undefined));}
    catch(error){$('#start-overview-status').textContent=`تازه‌سازی ناموفق؛ اعداد قبلی ممکن است قدیمی باشند. ${error.message}`;}
    finally{overviewBusy=false;$('#start-overview-refresh').disabled=false;$('#start-overview-card').setAttribute('aria-busy','false');}}
  $('#start-overview-refresh').onclick=()=>refreshOverview(true);
  function renderChart(){if(!latest)return;const mode=$('#start-chart-mode').value;const points=(latest.history?.[mode]||[]).slice(mode==='daily'?-30:-60);const chart=$('#start-chart'),values=$('#start-chart-values');chart.replaceChildren();values.replaceChildren();
    if(!points.length){chart.append(node('p','هنوز نقطه‌ای ثبت نشده است. با تازه‌سازی جدول، اولین نقطهٔ واقعی ثبت می‌شود.','muted'));return;}
    const max=Math.max(1,...points.map(p=>p.total));const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 900 180');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',points.map((p,i)=>`${points.length===1?450:20+i*860/(points.length-1)},${160-p.total*140/max}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#38bdf8');path.setAttribute('stroke-width','3');svg.append(path);
    for(const [i,p] of points.entries()){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(points.length===1?450:20+i*860/(points.length-1)));dot.setAttribute('cy',String(160-p.total*140/max));dot.setAttribute('r','3');dot.setAttribute('fill','#34d399');const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${p.at} · ${n(p.total)}`;dot.append(title);svg.append(dot);}
    chart.append(svg);chart.setAttribute('aria-label',`${n(points.length)} نقطهٔ واقعی از ${points[0].at} تا ${points.at(-1).at}؛ آخرین مقدار ${n(points.at(-1).total)} شناسهٔ محلی باسلام.`);
    for(const p of points){const value=node('span',`${mode==='daily'?p.date:p.at} · ${n(p.total)}`);value.title=`${n(p.shops)} غرفه · فقط نگاشت‌های محلی`;values.append(value);}
  }
  try{$('#start-chart-mode').value=localStorage.getItem('s4-start-shop-chart-mode')==='daily'?'daily':'updates';}catch(_error){}
  $('#start-chart-mode').onchange=()=>{try{localStorage.setItem('s4-start-shop-chart-mode',$('#start-chart-mode').value);}catch(_error){}renderChart();};
  const ready=request('/api/profiles').then(data=>{profiles=data.profiles;sourceReady=true;let saved='';try{saved=localStorage.getItem('s4-start-profile')||'';}catch(_error){}const chosen=profiles.some(p=>String(p.id)===saved)?saved:profiles[0]?.id||'';updateOptions();if(!dirty)fill(chosen);}).catch(error=>{status.textContent=`فهرست پروفایل‌ها دریافت نشد: ${error.message}`;});
  async function vendors(){try{const {vendors:shops}=await request('/api/basalam/vendors');const target=$('#start-sync-vendor'),previous=target.value;target.replaceChildren(new Option('انتخاب غرفه…',''));for(const s of shops)target.add(new Option(`${s.shop_name} · ${s.vendor_id}${s.token_configured?'':' (توکن ناقص)'}`,s.vendor_id));target.value=previous;}catch(error){status.textContent=error.message;}}
  vendors();window.addEventListener('s4:connections-saved',vendors);window.addEventListener('s4:basalam-vendors-changed',vendors);
  window.addEventListener('s4:extraction-updated',()=>refreshOverview(false));
  refreshOverview(false);setInterval(()=>{if(document.visibilityState==='visible'&&$('#pane-start').classList.contains('active'))refreshOverview(true);},60000);
})();
