const APP_BASE=location.pathname.startsWith('/chat')?'/chat':'';
window.APP_VERSION='1.8.0'; const apiUrl=u=>APP_BASE+(u.startsWith('/')?u:'/'.concat(u)); let current='';const $=x=>document.getElementById(x);
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
  setModelInstallState('loading','در حال بررسی لینک و فضای دیسک…');
  setActivity('Model download','در حال بررسی لینک مدل…');
  try{
    const check=await api('/api/models/download-check?'+new URLSearchParams({url}).toString());
    const sizeText=check.bytes?Math.max(0.01,check.bytes/1073741824).toFixed(2)+' GB':'حجم نامشخص';
    setModelInstallState('loading','آماده دانلود · '+sizeText);
    setActivity('Model download','آماده‌سازی دانلود '+(check.name||'model.gguf'));
    const d=await api('/api/models/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
    if(!d.jobId)throw Error('Download job was not created');
    let lastText='';
    for(let i=0;i<3600;i++){
      await new Promise(resolve=>setTimeout(resolve,i===0?500:1500));
      const job=await api('/api/models/download/'+encodeURIComponent(d.jobId));
      if(job.status==='downloading'){
        const progress=Number.isFinite(Number(job.progress))?Number(job.progress):null;
        const done=Number(job.bytes||0),total=Number(job.total||0);
        const doneText=done?Math.max(0.01,done/1073741824).toFixed(2)+' GB':'';
        const totalText=total?Math.max(0.01,total/1073741824).toFixed(2)+' GB':'';
        const text=progress!==null?('در حال دانلود · '+progress.toFixed(1)+'%'+(totalText?' · '+doneText+' / '+totalText:'')):'در حال دانلود…'+(doneText?' · '+doneText:'');
        if(text!==lastText){setModelInstallState('loading',text);setActivity('Model download',text);lastText=text}
      }else if(job.status==='completed'){
        $('modelUrl').value='';
        await loadModels();
        setModelInstallState('success','✓ '+job.name+' نصب شد'+(job.sizeGb?' · '+job.sizeGb+' GB':''));
        setActivity('Model ready',job.name+' با موفقیت نصب شد');
        return;
      }else if(job.status==='failed'){
        throw Error(job.error||'Model download failed');
      }
    }
    throw Error('Model download timed out while waiting for the server job');
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
      '<select id="benchmarkStatusFilter" onchange="filterBenchmarkTable()"><option value="all">همه</option><option value="ok">موفق</option><option value="fail">خطادار</option></select>'+
      '<select id="benchmarkSourceFilter" onchange="filterBenchmarkTable()"><option value="all">همه منابع</option><option value="local">Local GGUF</option><option value="imported">Provider</option></select>'+
    '</div>'+
    '<div class="benchmark-table-wrap"><table class="benchmark-table modal-table"><thead><tr><th>مدل</th><th>وضعیت</th><th>Startup</th><th>Latency</th><th>Prompt tok</th><th>Output tok</th><th>tok/s</th><th></th></tr></thead><tbody id="benchmarkTableBody">'+results.map((x,k)=>benchmarkRow(x,k).replace('<td>'+formatNum(x.completionTokens)+'</td>','<td>'+formatNum(x.promptTokens)+'</td><td>'+formatNum(x.completionTokens)+'</td>')).join('')+'</tbody></table></div>';
  openBenchmarkModal();
}
function filterBenchmarkTable(query=''){const q=String(query||'').toLowerCase().trim(),sf=$('benchmarkStatusFilter')?.value||'all',src=$('benchmarkSourceFilter')?.value||'all',rows=(window.lastBenchmarkResults||[]).map((x,k)=>({x,k})).filter(({x})=>(sf==='all'||(x.ok?'ok':'fail')===sf)&&(src==='all'||x.source===src)&&(!q||String(x.name+' '+(x.provider||'')).toLowerCase().includes(q)));const body=$('benchmarkTableBody');if(body)body.innerHTML=rows.map(({x,k})=>benchmarkRow(x,k).replace('<td>'+formatNum(x.completionTokens)+'</td>','<td>'+formatNum(x.promptTokens)+'</td><td>'+formatNum(x.completionTokens)+'</td>')).join('')}
function showBenchmarkDetail(index){const x=(window.lastBenchmarkResults||[])[index];if(!x)return;$('benchmarkDetailTitle').textContent=x.name||'Model details';$('benchmarkDetailBody').innerHTML='<div class="detail-grid"><div><span>Source</span><b>'+esc(x.source==='local'?'Local GGUF':'Provider · '+(x.provider||'Imported'))+'</b></div><div><span>Status</span><b>'+esc(x.ok?'PASS':'FAIL')+'</b></div><div><span>Startup</span><b>'+formatMs(x.startupMs)+'</b></div><div><span>Latency</span><b>'+formatMs(x.latencyMs)+'</b></div><div><span>Prompt tokens</span><b>'+formatNum(x.promptTokens)+'</b></div><div><span>Output tokens</span><b>'+formatNum(x.completionTokens)+'</b></div><div><span>Tokens/sec</span><b>'+(x.tokensPerSecond?esc(String(x.tokensPerSecond)):'—')+'</b></div></div><div class="detail-response">'+(x.ok?'<pre>'+esc(x.response||'No response text')+'</pre>':'<div class="benchmark-error">'+esc(x.error||'Unknown error')+'</div>')+'</div>';$('benchmarkDetailModal').classList.add('open')}
function closeBenchmarkDetail(){$('benchmarkDetailModal').classList.remove('open')}
async function testAllModels(){const box=$('benchmarkResults'),status=$('benchmarkStatus'),btn=document.querySelector('.test-all-btn');if(btn){btn.disabled=true;btn.textContent='⏳ در حال تست…'}status.textContent='در حال اجرای benchmark…';box.innerHTML='<div class="benchmark-empty">در حال تست GGUF و Providerها؛ مدل‌های محلی به‌صورت موقت اجرا و سپس خاموش می‌شوند.</div>';try{const d=await api('/api/models/test-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:$('testPrompt').value,context:Number($('testContext').value||4096),maxTokens:Number($('testMaxTokens').value||64),temperature:Number($('testTemperature').value||0.2),gpuLayers:Number($('testGpuLayers')?.value??-1)})});if(!d.results?.length){box.innerHTML='<div class="benchmark-empty">هیچ مدل نصب‌شده یا Provider واردشده‌ای برای تست پیدا نشد.</div>';status.textContent='مدلی موجود نیست';return}renderBenchmarkResults(d);setActivity('Model benchmark',d.results.filter(x=>x.ok).length+' / '+d.total+' مدل با موفقیت تست شدند')}catch(e){box.innerHTML='<div class="benchmark-empty">'+esc(e.message)+'</div>';status.textContent='خطا در تست'}finally{if(btn){btn.disabled=false;btn.textContent='▶ تست همه مدل‌ها'}}}
function clearBenchmark(){window.lastBenchmarkResults=[];$('benchmarkResults').innerHTML='<div class="benchmark-empty">نتایج پاک شد.</div>';$('benchmarkStatus').textContent='آماده تست';closeBenchmarkModal();closeBenchmarkDetail()}
const AGENT_CHAT_KEY='arena.agent.chat.v1';
let agentConversation=[];
let agentRunStartedAt=0;

function encodeAgentSelection(value){return encodeURIComponent(JSON.stringify(value))}
function decodeAgentSelection(value){try{return JSON.parse(decodeURIComponent(value))}catch{return null}}

function scrollAgentChat(){
  const box=$('answer');
  if(box)box.scrollTop=box.scrollHeight;
}

function compactAgentHistory(history){
  return (history||[]).map(x=>({
    iteration:x.iteration,
    message:x.message||x.error||'',
    done:Boolean(x.done),
    actions:(x.actions||[]).map(a=>({
      type:a.type,
      path:a.path,
      command:a.type==='command'?String(a.command||'').slice(0,240):undefined,
      ok:a.ok,
      code:a.code
    })),
    verification:(x.verification||[]).map(v=>({
      file:v.file,
      code:v.code,
      stdout:String(v.stdout||'').slice(-240),
      stderr:String(v.stderr||'').slice(-240)
    }))
  }));
}

function saveAgentChat(){
  try{
    localStorage.setItem(AGENT_CHAT_KEY,JSON.stringify(agentConversation.filter(x=>x.type!=='working').slice(-16)));
  }catch{}
}

function renderAgentSummary(history,success){
  const safeHistory=history||[];
  const last=safeHistory[safeHistory.length-1]||{};
  const actions=safeHistory.flatMap(x=>Array.isArray(x.actions)?x.actions:[]);
  const writes=actions.filter(a=>a.type==='write'&&a.ok).length;
  const commands=actions.filter(a=>a.type==='command').length;
  const checks=safeHistory.reduce((n,x)=>n+(Array.isArray(x.verification)?x.verification.length:0),0);
  const failures=safeHistory.reduce((n,x)=>n+(Array.isArray(x.verification)?x.verification.filter(v=>v.code!==0).length:0),0)+actions.filter(a=>a.ok===false).length;
  const state=success?'done':failures?'error':'paused';
  const title=success?'Task completed':failures?'Agent found issues':'Iteration limit reached';
  const details=[
    '<span><b>'+safeHistory.length+'</b> iterations</span>',
    '<span><b>'+writes+'</b> file writes</span>',
    '<span><b>'+commands+'</b> commands</span>',
    '<span><b>'+checks+'</b> checks</span>'
  ].join('');
  return '<div class="agent-message agent-message-agent">'+
    '<div class="message-avatar agent-avatar-small">✦</div>'+
    '<div class="message-content">'+
      '<div class="message-meta"><b>Arena Agent</b><span>'+title+'</span></div>'+
      '<div class="agent-result '+state+'">'+
        '<div class="agent-result-head"><span class="result-icon">'+(success?'✓':failures?'!':'↻')+'</span><div><b>'+title+'</b><small>'+(last.message?esc(last.message):'The agent finished its current execution cycle.')+'</small></div></div>'+
        '<div class="agent-result-stats">'+details+'</div>'+
        (failures?'<div class="agent-result-warning">'+esc('Some verification or actions failed. Review the latest iteration details below.')+'</div>':'')+
      '</div>'+
      '<div class="agent-iterations">'+safeHistory.map(renderAgentIteration).join('')+'</div>'+
    '</div>'+
  '</div>';
}

function renderAgentIteration(x){
  const actions=Array.isArray(x.actions)?x.actions:[];
  const verification=Array.isArray(x.verification)?x.verification:[];
  const writes=actions.filter(a=>a.type==='write'&&a.ok).length;
  const commands=actions.filter(a=>a.type==='command').length;
  const failed=verification.filter(v=>v.code!==0).length+actions.filter(a=>a.ok===false).length;
  const state=x.done?'done':failed?'error':'running';
  return '<details class="agent-iteration '+state+'">'+
    '<summary><span class="iteration-index">'+esc(String(x.iteration||'?'))+'</span><b>Iteration '+esc(String(x.iteration||'?'))+'</b><small>'+(writes?'✎ '+writes+' ':'')+(commands?'⌘ '+commands+' ':'')+(verification.length?'✓ '+(verification.length-failed)+' checks':'')+'</small></summary>'+
    '<div class="iteration-body">'+
      '<div class="iteration-message">'+esc(x.message||x.error||'No message')+'</div>'+
      (actions.length?'<div class="iteration-actions">'+actions.slice(0,10).map(renderAgentAction).join('')+'</div>':'')+
      (failed?'<div class="iteration-errors">'+esc(JSON.stringify(actions.filter(a=>a.ok===false).concat(verification.filter(v=>v.code!==0)).slice(0,5),null,2))+'</div>':'')+
    '</div>'+
  '</details>';
}

function renderAgentAction(a){
  const label=a.type==='write'?'FILE':'CMD';
  const name=a.type==='write'?(a.path||'file'):(a.command||'command');
  const ok=a.type==='write'?a.ok!==false:a.code===0;
  return '<div class="agent-action '+(ok?'ok':'fail')+'"><span>'+label+'</span><code>'+esc(String(name).slice(0,260))+'</code><i>'+(ok?'✓':'×')+'</i></div>';
}

function renderConversation(){
  const box=$('answer');
  if(!box)return;
  if(!agentConversation.length){
    box.innerHTML='<div class="agent-welcome">'+
      '<div class="welcome-orb">✦</div>'+
      '<h3>What should we build?</h3>'+
      '<p>Ask for a feature, bug fix, refactor, test run, code review, or full project investigation.</p>'+
      '<div class="welcome-grid">'+
        '<button onclick="setPrompt(\'Inspect the project structure, identify the most important issues, and fix the safe ones.\')"><b>Inspect project</b><span>Find problems and improve the workspace.</span></button>'+
        '<button onclick="setPrompt(\'Run the available tests and syntax checks, fix failures, then verify everything again.\')"><b>Test & repair</b><span>Execute checks and iterate on failures.</span></button>'+
        '<button onclick="setPrompt(\'Refactor the project for cleaner code, better performance, and better error handling without changing the intended behavior.\')"><b>Refactor</b><span>Improve quality without changing the goal.</span></button>'+
      '</div></div>';
    return;
  }
  box.innerHTML=agentConversation.map(entry=>{
    if(entry.type==='user'){
      return '<div class="agent-message agent-message-user"><div class="message-avatar user-avatar">M</div><div class="message-content"><div class="message-meta"><b>You</b><span>'+esc(entry.time||'Now')+'</span></div><div class="user-bubble">'+esc(entry.text)+'</div></div></div>';
    }
    if(entry.type==='working'){
      return '<div class="agent-message agent-message-agent working-message"><div class="message-avatar agent-avatar-small">✦</div><div class="message-content"><div class="message-meta"><b>Arena Agent</b><span>Working…</span></div><div class="agent-working-card"><span class="working-dots"><i></i><i></i><i></i></span><div><b>Agent is working through the task</b><small>Analyze → execute → verify → repair</small></div></div></div></div>';
    }
    return renderAgentSummary(entry.history||[],Boolean(entry.success));
  }).join('');
  scrollAgentChat();
}

function restoreAgentChat(){
  try{
    const saved=JSON.parse(localStorage.getItem(AGENT_CHAT_KEY)||'[]');
    if(Array.isArray(saved))agentConversation=saved;
  }catch{agentConversation=[]}
  renderConversation();
}

function clearAgentChat(){
  agentConversation=[];
  saveAgentChat();
  renderConversation();
  setActivity('Agent chat','New session started');
}

function resizeAgentPrompt(el){
  if(!el)return;
  el.style.height='auto';
  el.style.height=Math.min(Math.max(el.scrollHeight,58),150)+'px';
}

function handleAgentPromptKey(event){
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){
    event.preventDefault();
    runAgentLoop();
    return;
  }
}

function updateAgentContextState(){
  const ctx=Number($('agentContext')?.value||8192);
  const label=ctx>=1024?((ctx/1024)%1===0?String(ctx/1024):String(Math.round(ctx/1024*10)/10))+'K context':ctx+' context';
  if($('agentContextState'))$('agentContextState').textContent=label;
}

async function loadAgentModels(){
  const select=$('agentModel'); if(!select)return;
  try{
    const [locals,providers]=await Promise.all([api('/api/models'),api('/api/providers')]);
    const options=['<option value="">Select a model…</option>'];
    for(const m of locals||[]){
      const value=encodeAgentSelection({kind:'local',name:m.name});
      options.push('<option value="'+value+'">Local · '+esc(m.name)+'</option>');
    }
    for(const [id,p] of Object.entries(providers||{})){
      if(!p.enabled)continue;
      for(const m of (p.models||[])){
        const name=typeof m==='string'?m:String(m.id||m.name||'');
        if(name){
          const value=encodeAgentSelection({kind:'provider',providerId:id,name});
          options.push('<option value="'+value+'">'+esc(p.name||id)+' · '+esc(name)+'</option>');
        }
      }
    }
    select.innerHTML=options.join('');
    if(window.selectedAgentModel)select.value=window.selectedAgentModel;
    const selected=decodeAgentSelection(select.value);
    if($('agentModelState'))$('agentModelState').textContent=selected?selected.name:'No model selected';
  }catch(e){select.innerHTML='<option value="">No models available</option>';setActivity('Model selector',e.message)}
}

async function selectAgentModel(){
  const value=$('agentModel')?.value||'';
  const selected=decodeAgentSelection(value);
  window.selectedAgentModel=value;
  if($('agentModelState'))$('agentModelState').textContent=selected?selected.name:'No model selected';
  if(!selected)return;
  if(selected.kind==='local'){
    try{
      setAgentRunState('STARTING');
      setActivity('Local model','Starting '+selected.name+'…');
      const d=await api('/api/models/launch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:selected.name,port:8080,context:Number($('agentContext')?.value||8192)})});
      window.modelUrlApi={value:d.baseUrl+'/chat/completions'};
      window.activeAgentModel=selected.name;
      setAgentRunState('READY');
      setActivity('Local model','Started: '+selected.name);
    }catch(e){
      setAgentRunState('ERROR');
      setActivity('Local model error',e.message);
    }
  }else{
    setAgentRunState('READY');
    setActivity('Provider model',selected.name+' selected');
  }
}

function setAgentRunState(state){
  const el=$('agentRunState');
  if(!el)return;
  el.textContent=state;
  el.className='agent-state '+String(state).toLowerCase();
}

function toggleAgentAdvanced(){document.getElementById('agentAdvanced')?.classList.toggle('open')}
function setPrompt(v){
  const p=$('prompt');
  if(!p)return;
  p.value=v;
  resizeAgentPrompt(p);
  p.focus();
}
async function runAgentLoop(){
  const p=$('prompt').value.trim(); if(!p)return;
  const selected=decodeAgentSelection($('agentModel')?.value||'');
  if(!selected){setActivity('Agent','Select a model first');return}
  const out=$('answer'),button=document.querySelector('.run-agent');
  if(button){button.disabled=true;button.dataset.running='1';button.innerHTML='<span>◌</span><b>Running…</b><small>Working</small>'}
  const now=new Date();
  agentConversation.push({type:'user',text:p,time:now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),model:selected.name});
  agentConversation.push({type:'working'});
  $('prompt').value='';
  resizeAgentPrompt($('prompt'));
  renderConversation();
  setAgentRunState('RUNNING');
  setActivity('Agent started',p);
  agentRunStartedAt=Date.now();
  saveAgentChat();
  try{
    const body={
      prompt:p,
      maxIterations:Number($('maxIterations').value||8),
      maxTokens:Number($('agentMaxTokens').value||6000),
      commandTimeout:Number($('agentCommandTimeout').value||120000),
      temperature:Number($('agentTemperature').value||0.1),
      context:Number($('agentContext').value||8192)
    };
    if(selected.kind==='local'){body.modelType='local';body.model=selected.name}
    else {body.modelType='provider';body.providerId=selected.providerId;body.model=selected.name}
    const d=await api('/api/agent/loop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    agentConversation=agentConversation.filter(x=>x.type!=='working');
    agentConversation.push({type:'agent',history:compactAgentHistory(d.history||[]),success:Boolean(d.success),durationMs:Date.now()-agentRunStartedAt});
    renderConversation();
    setAgentRunState(d.success?'READY':'PAUSED');
    setActivity(d.success?'Agent completed':'Agent stopped',d.success?'Verification passed':'Maximum iterations reached');
    if($('settingIterations'))$('settingIterations').textContent=String(body.maxIterations);
    saveAgentChat();
  }catch(e){
    agentConversation=agentConversation.filter(x=>x.type!=='working');
    agentConversation.push({type:'agent',history:[{iteration:1,message:e.message,actions:[],verification:[]}],success:false,error:true});
    renderConversation();
    setAgentRunState('ERROR');
    setActivity('Agent error',e.message);
    saveAgentChat();
  }finally{
    if(button){button.disabled=false;button.dataset.running='';button.innerHTML='<span>➜</span><b>Run Agent</b><small>Ctrl + Enter</small>'}
  }
}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveFile()}});
window.modelUrlApi={value:'http://127.0.0.1:8080/v1/chat/completions'};
window.selectedAgentModel='';
async function loadVersion(){try{const d=await api('/api/version');if($('appVersion'))$('appVersion').textContent='v'+d.version}catch{}}
async function refresh(){try{await Promise.all([loadFiles(),loadModels(),loadProviders(),loadVersion(),loadAgentModels()]);updateAgentContextState();resizeAgentPrompt($('prompt'));$('status').textContent='متصل';$('statusDot').parentElement.classList.add('online')}catch(e){$('status').textContent=e.message}}
refresh();restoreAgentChat();updateAgentContextState();resizeAgentPrompt($('prompt'));

function toggleSettings(){const o=$('settingsOverlay');if(o)o.classList.toggle('open')}
function closeSettings(e){if(e.target===$('settingsOverlay'))toggleSettings()}
function showSettingsTab(name,btn){document.querySelectorAll('.settings-section').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.settings-tabs button').forEach(x=>x.classList.remove('active'));const s=$('settings-'+name);if(s)s.classList.add('active');if(btn)btn.classList.add('active')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('settingsOverlay')?.classList.remove('open')});
