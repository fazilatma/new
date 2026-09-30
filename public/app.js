const APP_BASE=location.pathname.startsWith('/chat')?'/chat':''; const apiUrl=u=>APP_BASE+(u.startsWith('/')?u:'/'.concat(u)); let current='';const $=x=>document.getElementById(x);
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
async function loadModels(){const d=await api('/api/models');$('modelCount').textContent=d.length;$('models').innerHTML=d.map(m=>'<div class="model" title="'+esc(m.name)+'">🧠 '+esc(m.name)+'</div>').join('')||'<div class="model" style="color:#566176">مدلی نصب نشده</div>'}
async function downloadModel(){const url=$('modelUrl').value.trim();if(!url)return;setActivity('Model download','در حال دانلود…');try{await api('/api/models/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});$('modelUrl').value='';await loadModels();setActivity('Model ready','مدل با موفقیت نصب شد')}catch(e){setActivity('Model error',e.message)}}
async function launchModel(){const name=$('modelName').value.trim();if(!name)return;try{const d=await api('/api/models/launch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,port:8080,context:8192})});window.modelUrlApi.value=d.baseUrl+'/chat/completions';setActivity('Local model started',name+' روی پورت 8080');toggleSettings()}catch(e){setActivity('Model error',e.message)}}
async function loadProviders(){try{const d=await api('/api/providers');$('providers').innerHTML=Object.values(d).map(p=>'<div class="model">🔌 '+esc(p.name)+' <small style="color:#566176;display:block;margin-top:2px">'+esc(p.url||'local')+'</small></div>').join('')||'<div class="model" style="color:#566176">Provider ثبت نشده</div>'}catch(e){setActivity('Provider error',e.message)}}
async function importProviders(e){const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());await api('/api/providers',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)});await loadProviders();setActivity('Providers imported',f.name)}catch(x){setActivity('Import error',x.message)}}
async function exportProviders(){try{const d=await api('/api/providers');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='ai-providers.json';a.click();URL.revokeObjectURL(u)}catch(e){setActivity('Export error',e.message)}}
async function testAllModels(){
  const box=$('benchmarkResults'),status=$('benchmarkStatus');
  status.textContent='در حال تست مدل‌ها…'; box.innerHTML='<div class="benchmark-empty">در حال راه‌اندازی و تست تک‌تک مدل‌ها…</div>';
  try{
    const d=await api('/api/models/test-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      prompt:$('testPrompt').value,context:Number($('testContext').value||4096),maxTokens:Number($('testMaxTokens').value||64),temperature:Number($('testTemperature').value||0.2)
    })});
    if(!d.results?.length){box.innerHTML='<div class="benchmark-empty">مدل GGUF برای تست پیدا نشد.</div>';status.textContent='مدلی موجود نیست';return}
    box.innerHTML=d.results.map(x=>'<div class="benchmark-card '+(x.ok?'ok':'fail')+'"><div class="benchmark-card-head"><b>'+esc(x.ok?'● '+x.name:'× '+x.name)+'</b><span>'+esc(x.ok?(x.tokensPerSecond?x.tokensPerSecond+' tok/s':'پاسخ دریافت شد'):'خطا')+'</span></div>'+
      (x.ok?'<div class="benchmark-metrics"><span>Startup <b>'+x.startupMs+'ms</b></span><span>Latency <b>'+x.latencyMs+'ms</b></span><span>Output <b>'+((x.completionTokens??'—'))+'</b></span></div><pre>'+esc(x.response||'')+'</pre>':'<div class="benchmark-error">'+esc(x.error||'خطای نامشخص')+'</div>')+
      '</div>').join('');
    const ok=d.results.filter(x=>x.ok).length;status.textContent=ok+' از '+d.total+' مدل با موفقیت تست شدند';setActivity('Model benchmark',ok+' / '+d.total+' مدل تست شدند');
  }catch(e){box.innerHTML='<div class="benchmark-empty">'+esc(e.message)+'</div>';status.textContent='خطا در تست'}
}
function clearBenchmark(){$('benchmarkResults').innerHTML='<div class="benchmark-empty">نتایج پاک شد.</div>';$('benchmarkStatus').textContent='آماده تست'}
function setPrompt(v){$('prompt').value=v;$('prompt').focus()}
async function runAgentLoop(){const p=$('prompt').value.trim();if(!p)return;const out=$('answer');out.innerHTML='<div class="empty-agent"><span>◌</span><p>Agent در حال کار است…</p><small>تحلیل → اجرا → تست → اصلاح</small></div>';setActivity('Agent started',p);try{const d=await api('/api/agent/loop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:p,modelUrl:window.modelUrlApi?.value||'http://127.0.0.1:8080/v1/chat/completions',maxIterations:Number($('maxIterations').value||8)})});out.innerHTML=(d.history||[]).map(x=>'<div class="activity-item"><b>Iteration '+x.iteration+' · '+esc(x.message||'')+'</b><p>'+esc(JSON.stringify(x.verification||x.actions||[]))+'</p></div>').join('')||'<div class="empty-agent">پاسخی دریافت نشد.</div>';setActivity(d.success?'Agent completed':'Agent stopped',d.success?'نسخه تأیید شد':'به سقف تکرار رسید')}catch(e){out.innerHTML='<div class="empty-agent"><p>'+esc(e.message)+'</p></div>';setActivity('Agent error',e.message)}}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveFile()}});
window.modelUrlApi={value:'http://127.0.0.1:8080/v1/chat/completions'};
async function refresh(){try{await loadFiles();await loadModels();await loadProviders();$('status').textContent='متصل';$('statusDot').parentElement.classList.add('online')}catch(e){$('status').textContent=e.message}}
refresh();

function toggleSettings(){const o=$('settingsOverlay');if(o)o.classList.toggle('open')}
function closeSettings(e){if(e.target===$('settingsOverlay'))toggleSettings()}
function showSettingsTab(name,btn){document.querySelectorAll('.settings-section').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.settings-tabs button').forEach(x=>x.classList.remove('active'));const s=$('settings-'+name);if(s)s.classList.add('active');if(btn)btn.classList.add('active')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('settingsOverlay')?.classList.remove('open')});
