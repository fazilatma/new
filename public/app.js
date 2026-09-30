const APP_BASE=location.pathname.startsWith('/chat')?'/chat':'';
window.APP_VERSION='1.5.0'; const apiUrl=u=>APP_BASE+(u.startsWith('/')?u:'/'.concat(u)); let current='';const $=x=>document.getElementById(x);
async function api(u,o={}){const t=localStorage.agentToken||'';o.headers={...(o.headers||{}),...(t?{'x-agent-token':t}:{})};const r=await fetch(apiUrl(u),o),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||r.statusText);return d}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function setActivity(title,msg){const a=$('activity');if(a.querySelector('.activity-empty'))a.innerHTML='';const d=document.createElement('div');d.className='activity-item';d.innerHTML='<b>'+esc(title)+'</b><p>'+esc(msg)+'</p>';a.prepend(d)}
function clearActivity(){$('activity').innerHTML='<div class="activity-empty">فعالیت‌ها پاک شدند.</div>'}
async function loadFiles(){const d=await api('/api/files');$('files').innerHTML=d.map(x=>x.type==='dir'?'<div>📁 '+esc(x.name)+'</div>':'<div onclick="openFile(\''+encodeURIComponent(x.name)+'\')">📄 '+esc(x.name)+'</div>').join('')||'<div class="activity-empty">پوشه خالی است</div>'}
async function openFile(p){const d=await api('/api/file?path='+p);current=d.path;$('current').textContent=current;$('editor').value=d.content;$('editorMode').textContent=(current.split('.').pop()||'text').toUpperCase()}
async function saveFile(){if(!current)return;await api('/api/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({path:current,content:$('editor').value})});setActivity('فایل ذخیره شد',current)}
async function newFile(){const p=prompt('مسیر فایل جدید؟');if(p){await api('/api/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({path:p,content:''})});await loadFiles();await openFile(encodeURIComponent(p))}}
async function newFolder(){const p=prompt('مسیر پوشه جدید؟');if(p){await api('/api/mkdir',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:p})});await loadFiles()}}
async function runCommand(){const cmd=$('command').value.trim();if(!cmd)return;$('terminalState').textContent='Running…';try{const d=await api('/api/terminal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:cmd})});$('termout').textContent=(d.stdout||'')+(d.stderr?'\n'+d.stderr:'');setActivity('Terminal',cmd+' → exit '+d.code)}catch(e){$('termout').textContent=e.message;setActivity('Terminal error',e.message)}finally{$('terminalState').textContent='Ready'}}
function setModelInstallState(state,message=''){
  const buttons=document.querySelectorAll('.install-model-btn');
  buttons.forEach(x=>{x.disabled=state==='loading';x.textContent=state==='loading'?'⏳ در حال نصب…':'⬇ دانلود و نصب'});
  const box=$('modelInstallStatus');
  if(box){box.className='model-install-status '+state;box.textContent=message}
}
async function loadModels(){
  const d=await api('/api/models');$('modelCount').textContent=d.length;
  $('models').innerHTML=d.map(m=>'<div class="model installed-model" title="'+esc(m.name)+'"><span>🧠</span><span>'+esc(m.name)+'</span><small>GGUF · نصب‌شده</small></div>').join('')||'<div class="model" style="color:#566176">مدلی نصب نشده</div>'
}
async function recommendModels(){
  const box=$('recommendations');
  box.innerHTML='<div class="benchmark-empty">در حال محاسبه مدل‌های مناسب…</div>';
  try{
    const q=new URLSearchParams({ramGb:Number($('recRam').value||16),vramGb:Number($('recVram').value||0),cpuThreads:Number($('recCpu').value||8),context:Number($('recContext').value||8192),diskGb:Number($('recDisk').value||30),useCase:$('recUse').value,priority:$('recPriority').value,quant:$('recQuant').value});
    const d=await api('/api/models/recommend?'+q.toString());
    if(!d.recommendations?.length){box.innerHTML='<div class="benchmark-empty">مدلی با این محدودیت‌ها پیدا نشد. RAM/VRAM یا فضای دیسک را افزایش دهید.</div>';return}
    box.innerHTML=d.recommendations.map((m,i)=>{
      const file=m.file?.[m.quant]||m.file||m.name+'.gguf';
      return '<div class="recommend-card '+(i===0?'recommended':'')+'"><div class="recommend-top"><div><b>'+esc(m.name)+'</b><small>'+esc(m.family)+' · '+m.params+' · '+esc(m.quant)+'</small></div><span>'+esc(m.fitLabel)+'</span></div>'+
      '<div class="recommend-meta"><span>فایل <b>'+m.sizeGb+' GB</b></span><span>RAM پیشنهادی <b>'+m.ramGb+' GB</b></span><span>VRAM پیشنهادی <b>'+m.vramGb+' GB</b></span><span>Context <b>'+m.context.toLocaleString()+'</b></span></div>'+
      '<p>'+esc(m.reason)+'</p><div class="recommend-actions"><button class="primary-setting install-model-btn" onclick="installRecommended('+JSON.stringify(m.url)+','+JSON.stringify(file)+')">⬇ دانلود و نصب</button><button class="secondary-setting" onclick="copyModelUrl('+JSON.stringify(m.url)+')">کپی لینک</button></div></div>'
    }).join('');
  }catch(e){box.innerHTML='<div class="benchmark-empty">'+esc(e.message)+'</div>'}
}
async function installRecommended(url,file){
  $('modelUrl').value=url;
  setModelInstallState('loading','در حال دانلود '+file+'…');
  setActivity('Model Advisor','شروع نصب '+file);
  await downloadModel(true)
}
async function copyModelUrl(url){
  try{await navigator.clipboard.writeText(url);setActivity('Model URL','لینک دانلود کپی شد')}
  catch{setActivity('Model URL','کپی لینک توسط مرورگر مسدود شد')}
}
async function downloadModel(fromAdvisor=false){
  const url=$('modelUrl').value.trim();
  if(!url){setModelInstallState('error','ابتدا لینک فایل GGUF را وارد کنید');return}
  if(!/\.gguf(?:\?|$)/i.test(url)){setModelInstallState('error','لینک باید به فایل .gguf ختم شود');return}
  setModelInstallState('loading','در حال دانلود مدل…');
  setActivity('Model download','در حال دانلود…');
  try{
    const d=await api('/api/models/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
    $('modelUrl').value='';await loadModels();
    setModelInstallState('success','✓ '+d.name+' نصب شد'+(d.sizeGb?' · '+d.sizeGb+' GB':''));
    setActivity('Model ready',d.name+' با موفقیت نصب شد')
  }catch(e){
    setModelInstallState('error','✕ '+e.message);setActivity('Model error',e.message);
    if(!fromAdvisor)throw e
  }
}
async function launchModel(){const name=$('modelName').value.trim();if(!name)return;try{const d=await api('/api/models/launch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,port:8080,context:8192})});window.modelUrlApi.value=d.baseUrl+'/chat/completions';setActivity('Local model started',name+' روی پورت 8080');toggleSettings()}catch(e){setActivity('Model error',e.message)}}
async function loadProviders(){try{const d=await api('/api/providers');$('providerCount').textContent=Object.keys(d).length;$('providers').innerHTML=Object.values(d).map(p=>'<div class="model">🔌 '+esc(p.name)+' <small style="color:#566176;display:block;margin-top:2px">'+esc(p.url||'local')+'</small></div>').join('')||'<div class="model" style="color:#566176">Provider ثبت نشده</div>'}catch(e){setActivity('Provider error',e.message)}}
async function importProviders(e){const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());await api('/api/providers',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)});await loadProviders();setActivity('Providers imported',f.name)}catch(x){setActivity('Import error',x.message)}}
async function exportProviders(){try{const d=await api('/api/providers/export');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='ai-providers.json';a.click();URL.revokeObjectURL(u)}catch(e){setActivity('Export error',e.message)}}
function benchmarkSummary(results){const ok=results.filter(x=>x.ok),failed=results.length-ok.length,speed=ok.filter(x=>Number.isFinite(x.tokensPerSecond)).sort((a,b)=>b.tokensPerSecond-a.tokensPerSecond)[0],latency=ok.filter(x=>Number.isFinite(x.latencyMs)).sort((a,b)=>a.latencyMs-b.latencyMs)[0];return{ok,failed,speed,latency}}
function openBenchmarkModal(){const m=$('benchmarkModal');if(m)m.classList.add('open')}
function closeBenchmarkModal(){const m=$('benchmarkModal');if(m)m.classList.remove('open')}
function formatMs(v){return Number.isFinite(Number(v))?Number(v).toLocaleString()+' ms':'—'}
function formatNum(v){return Number.isFinite(Number(v))?Number(v).toLocaleString():'—'}
function benchmarkRow(x,index){const status=x.ok?'ok':'fail',source=x.source==='local'?'Local GGUF':('Provider · '+(x.provider||'Imported'));return '<tr class="'+status+'"><td><div class="bm-name"><span class="bm-index">'+(index+1)+'</span><div><b>'+esc(x.name||'Unnamed')+'</b><small>'+esc(source)+'</small></div></div></td><td><span class="bm-status '+status+'">'+(x.ok?'● PASS':'× FAIL')+'</span></td><td>'+formatMs(x.startupMs)+'</td><td>'+formatMs(x.latencyMs)+'</td><td>'+formatNum(x.completionTokens)+'</td><td><strong>'+(x.tokensPerSecond?esc(String(x.tokensPerSecond))+' tok/s':'—')+'</strong></td><td><button class="bm-view" onclick="showBenchmarkDetail('+index+')">جزئیات</button></td></tr>'}
function renderBenchmarkResults(d){
  const box=$('benchmarkResults'),status=$('benchmarkStatus'),results=d.results||[],s=benchmarkSummary(results);
  status.textContent=s.ok.length+' / '+results.length+' موفق · '+(d.localTotal||0)+' محلی · '+(d.importedTotal||0)+' Provider';
  if(!results.length){box.innerHTML='<div class="benchmark-empty">مدلی برای تست پیدا نشد.</div>';return}
  window.lastBenchmarkResults=results;
  box.innerHTML=
    '<div class="benchmark-summary"><div><b>'+s.ok.length+'</b><small>موفق</small></div><div><b>'+s.failed+'</b><small>خطا</small></div><div><b>'+((s.speed&&s.speed.tokensPerSecond)||'—')+'</b><small>بهترین tok/s</small></div><div><b>'+formatMs(s.latency&&s.latency.latencyMs)+'</b><small>کمترین latency</small></div></div>'+
    '<div class="benchmark-preview"><div class="benchmark-preview-head"><b>آخرین نتیجه‌ها</b><button class="primary-setting" onclick="openBenchmarkModal()">مشاهده جدول کامل</button></div><div class="benchmark-preview-scroll"><table class="benchmark-table"><thead><tr><th>مدل</th><th>وضعیت</th><th>Startup</th><th>Latency</th><th>Output</th><th>سرعت</th><th></th></tr></thead><tbody>'+results.slice(0,5).map(benchmarkRow).join('')+'</tbody></table></div></div>';
  const body=$('benchmarkModalBody');
  if(body)body.innerHTML=
    '<div class="benchmark-modal-tools">'+
      '<input id="benchmarkFilter" placeholder="جستجوی مدل یا Provider…" oninput="filterBenchmarkTable(this.value)">'+
      '<select id="benchmarkStatusFilter" onchange="filterBenchmarkTable(document.getElementById(\\'benchmarkFilter\\')?.value||\\'\\')"><option value="all">همه</option><option value="ok">موفق</option><option value="fail">خطادار</option></select>'+
      '<select id="benchmarkSourceFilter" onchange="filterBenchmarkTable(document.getElementById(\\'benchmarkFilter\\')?.value||\\'\\')"><option value="all">همه منابع</option><option value="local">Local GGUF</option><option value="imported">Provider</option></select>'+
    '</div>'+\
    '<div class="benchmark-table-wrap"><table class="benchmark-table modal-table"><thead><tr><th>مدل</th><th>وضعیت</th><th>Startup</th><th>Latency</th><th>Prompt tok</th><th>Output tok</th><th>tok/s</th><th></th></tr></thead><tbody id="benchmarkTableBody">'+results.map((x,k)=>benchmarkRow(x,k).replace('<td>'+formatNum(x.completionTokens)+'</td>','<td>'+formatNum(x.promptTokens)+'</td><td>'+formatNum(x.completionTokens)+'</td>')).join('')+'</tbody></table></div>';
  openBenchmarkModal();
}
function filterBenchmarkTable(query=''){const q=String(query||'').toLowerCase().trim(),sf=$('benchmarkStatusFilter')?.value||'all',src=$('benchmarkSourceFilter')?.value||'all',rows=(window.lastBenchmarkResults||[]).map((x,k)=>({x,k})).filter(({x})=>(sf==='all'||(x.ok?'ok':'fail')===sf)&&(src==='all'||x.source===src)&&(!q||String(x.name+' '+(x.provider||'')).toLowerCase().includes(q)));const body=$('benchmarkTableBody');if(body)body.innerHTML=rows.map(({x,k})=>benchmarkRow(x,k).replace('<td>'+formatNum(x.completionTokens)+'</td>','<td>'+formatNum(x.promptTokens)+'</td><td>'+formatNum(x.completionTokens)+'</td>')).join('')}
function showBenchmarkDetail(index){const x=(window.lastBenchmarkResults||[])[index];if(!x)return;$('benchmarkDetailTitle').textContent=x.name||'Model details';$('benchmarkDetailBody').innerHTML='<div class="detail-grid"><div><span>Source</span><b>'+esc(x.source==='local'?'Local GGUF':'Provider · '+(x.provider||'Imported'))+'</b></div><div><span>Status</span><b>'+esc(x.ok?'PASS':'FAIL')+'</b></div><div><span>Startup</span><b>'+formatMs(x.startupMs)+'</b></div><div><span>Latency</span><b>'+formatMs(x.latencyMs)+'</b></div><div><span>Prompt tokens</span><b>'+formatNum(x.promptTokens)+'</b></div><div><span>Output tokens</span><b>'+formatNum(x.completionTokens)+'</b></div><div><span>Tokens/sec</span><b>'+(x.tokensPerSecond?esc(String(x.tokensPerSecond)):'—')+'</b></div></div><div class="detail-response">'+(x.ok?'<pre>'+esc(x.response||'No response text')+'</pre>':'<div class="benchmark-error">'+esc(x.error||'Unknown error')+'</div>')+'</div>';$('benchmarkDetailModal').classList.add('open')}
function closeBenchmarkDetail(){$('benchmarkDetailModal').classList.remove('open')}
async function testAllModels(){const box=$('benchmarkResults'),status=$('benchmarkStatus'),btn=document.querySelector('.test-all-btn');if(btn){btn.disabled=true;btn.textContent='⏳ در حال تست…'}status.textContent='در حال اجرای benchmark…';box.innerHTML='<div class="benchmark-empty">در حال تست GGUF و Providerها؛ مدل‌های محلی به‌صورت موقت اجرا و سپس خاموش می‌شوند.</div>';try{const d=await api('/api/models/test-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:$('testPrompt').value,context:Number($('testContext').value||4096),maxTokens:Number($('testMaxTokens').value||64),temperature:Number($('testTemperature').value||0.2),gpuLayers:Number($('testGpuLayers')?.value??-1)})});if(!d.results?.length){box.innerHTML='<div class="benchmark-empty">هیچ مدل نصب‌شده یا Provider واردشده‌ای برای تست پیدا نشد.</div>';status.textContent='مدلی موجود نیست';return}renderBenchmarkResults(d);setActivity('Model benchmark',d.results.filter(x=>x.ok).length+' / '+d.total+' مدل با موفقیت تست شدند')}catch(e){box.innerHTML='<div class="benchmark-empty">'+esc(e.message)+'</div>';status.textContent='خطا در تست'}finally{if(btn){btn.disabled=false;btn.textContent='▶ تست همه مدل‌ها'}}}
function clearBenchmark(){window.lastBenchmarkResults=[];$('benchmarkResults').innerHTML='<div class="benchmark-empty">نتایج پاک شد.</div>';$('benchmarkStatus').textContent='آماده تست';closeBenchmarkModal();closeBenchmarkDetail()}
function setPrompt(v){$('prompt').value=v;$('prompt').focus()}
async function runAgentLoop(){const p=$('prompt').value.trim();if(!p)return;const out=$('answer');out.innerHTML='<div class="empty-agent"><span>◌</span><p>Agent در حال کار است…</p><small>تحلیل → اجرا → تست → اصلاح</small></div>';setActivity('Agent started',p);try{const d=await api('/api/agent/loop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:p,modelUrl:window.modelUrlApi?.value||'http://127.0.0.1:8080/v1/chat/completions',maxIterations:Number($('maxIterations').value||8)})});out.innerHTML=(d.history||[]).map(x=>'<div class="activity-item"><b>Iteration '+x.iteration+' · '+esc(x.message||'')+'</b><p>'+esc(JSON.stringify(x.verification||x.actions||[]))+'</p></div>').join('')||'<div class="empty-agent">پاسخی دریافت نشد.</div>';setActivity(d.success?'Agent completed':'Agent stopped',d.success?'نسخه تأیید شد':'به سقف تکرار رسید')}catch(e){out.innerHTML='<div class="empty-agent"><p>'+esc(e.message)+'</p></div>';setActivity('Agent error',e.message)}}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveFile()}});
window.modelUrlApi={value:'http://127.0.0.1:8080/v1/chat/completions'};
async function loadVersion(){try{const d=await api('/api/version');if($('appVersion'))$('appVersion').textContent='v'+d.version}catch{}}
async function refresh(){try{await Promise.all([loadFiles(),loadModels(),loadProviders(),loadVersion()]);$('status').textContent='متصل';$('statusDot').parentElement.classList.add('online')}catch(e){$('status').textContent=e.message}}
refresh();

function toggleSettings(){const o=$('settingsOverlay');if(o)o.classList.toggle('open')}
function closeSettings(e){if(e.target===$('settingsOverlay'))toggleSettings()}
function showSettingsTab(name,btn){document.querySelectorAll('.settings-section').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.settings-tabs button').forEach(x=>x.classList.remove('active'));const s=$('settings-'+name);if(s)s.classList.add('active');if(btn)btn.classList.add('active')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('settingsOverlay')?.classList.remove('open')});
