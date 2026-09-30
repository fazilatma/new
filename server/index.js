import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {securityMiddleware, safePath, isDangerousCommand} from './security.js';
const execFileAsync=promisify(execFile); const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.WORKSPACE_ROOT||path.join(__dirname,'..','workspace')); const modelsRoot=path.resolve(process.env.MODELS_ROOT||path.join(__dirname,'..','models')); const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
await fs.mkdir(root,{recursive:true}); await fs.mkdir(modelsRoot,{recursive:true}); const providersFile=path.resolve(process.env.PROVIDERS_FILE||path.join(modelsRoot,'providers.json'));

async function runCommand(command,timeout=120000){if(isDangerousCommand(command))return {code:403,stdout:'',stderr:'Blocked by safety policy'};return await new Promise(resolve=>{const c=spawn('/bin/sh',['-lc',command],{cwd:root,env:{...process.env,HOME:process.env.HOME||root},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const max=Number(process.env.MAX_OUTPUT_BYTES||200000);c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);const t=setTimeout(()=>c.kill('SIGTERM'),timeout);c.on('close',code=>{clearTimeout(t);resolve({code,stdout:stdout.slice(-max),stderr:stderr.slice(-max)})})})}
async function verifyWorkspace(){const results=[];let entries=[];try{entries=await fs.readdir(root,{withFileTypes:true})}catch{};const files=entries.filter(e=>e.isFile()).map(e=>e.name);for(const f of files){if(f.endsWith('.js'))results.push({file:f,...await runCommand('node --check '+JSON.stringify(f),30000)});if(f.endsWith('.py'))results.push({file:f,...await runCommand('python3 -m py_compile '+JSON.stringify(f),30000)});if(f.endsWith('.php'))results.push({file:f,...await runCommand('php -l '+JSON.stringify(f),30000)})}try{const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(pkg.scripts?.test)results.push({file:'package.json',...await runCommand('npm test -- --runInBand',120000)})}catch{}return results}
function providerNormalize(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provider JSON must be an object');const out={};for(const [id,v] of Object.entries(input)){if(!v||typeof v!=='object'||Array.isArray(v))continue;const models=Array.isArray(v.models)?v.models.map(m=>typeof m==='string'?m:(m&&typeof m==='object'?m:{})):[];out[String(id)]={id:String(v.id||id),name:String(v.name||id),vendor:String(v.vendor||''),url:String(v.url||''),apiKey:String(v.apiKey||''),enabled:Boolean(v.enabled),models,relayUrl:String(v.relayUrl||''),relayToken:String(v.relayToken||''),relayEnabled:Boolean(v.relayEnabled),useGlobalRelay:Boolean(v.useGlobalRelay),proxyUrl:String(v.proxyUrl||''),proxyType:String(v.proxyType||'http')};if(Array.isArray(v.apiKeys))out[String(id)].apiKeys=v.apiKeys.map(x=>String(x));}return out}
const app=express(); app.use(cors()); app.use((req,_,next)=>{if(req.url==='/chat'||req.url.startsWith('/chat/')){req.url=req.url.slice(5)||'/';}next()}); app.use(express.json({limit:'2mb'})); app.use(securityMiddleware); app.use(express.static(path.join(__dirname,'..','public'))); const send=(r,d)=>r.json(d);
const APP_VERSION='1.3.0';
app.get('/api/version',async(_,r)=>send(r,{version:APP_VERSION,name:'local-coding-agent',channel:'stable'}));
app.get('/api/health',async(_,r)=>send(r,{ok:true,node:process.version,version:APP_VERSION}));
app.get('/api/runtime',async(_,r)=>{const cmds=[['node','--version'],[process.env.PYTHON_BIN||'python3','--version'],['php','-v'],[process.env.LLAMA_BIN||'llama-server','--version']];const o={};for(const[c,a]of cmds){try{const x=await execFileAsync(c,[a],{timeout:5000});o[c]=(x.stdout||x.stderr).trim().split('\\n')[0]}catch{o[c]=null}}send(r,o)});
app.get('/api/files',async(q,r)=>{const d=safePath(root,String(q.query.path||''));const e=await fs.readdir(d,{withFileTypes:true});send(r,e.map(x=>({name:x.name,type:x.isDirectory()?'dir':'file'})).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name)))});
app.get('/api/file',async(q,r)=>{const p=safePath(root,String(q.query.path||''));send(r,{path:path.relative(root,p),content:await fs.readFile(p,'utf8')})});
app.put('/api/file',async(q,r)=>{const p=safePath(root,String(q.body.path||''));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(q.body.content??''));send(r,{ok:true})});
app.post('/api/mkdir',async(q,r)=>{await fs.mkdir(safePath(root,String(q.body.path||'')),{recursive:true});send(r,{ok:true})});
app.delete('/api/file',async(q,r)=>{await fs.rm(safePath(root,String(q.body.path||'')),{recursive:true});send(r,{ok:true})});
app.post('/api/terminal',async(q,r)=>{const command=String(q.body.command||'').trim();if(!command)return r.status(400).json({error:'command required'});if(isDangerousCommand(command))return r.status(403).json({error:'Blocked by safety policy'});const child=spawn('/bin/sh',['-lc',command],{cwd:root,env:{...process.env,HOME:process.env.HOME||root},stdio:['ignore','pipe','pipe']});let out='',err='';const max=Number(process.env.MAX_OUTPUT_BYTES||200000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const t=setTimeout(()=>child.kill('SIGTERM'),Number(q.body.timeout||process.env.COMMAND_TIMEOUT_MS||120000));child.on('close',code=>{clearTimeout(t);send(r,{code,stdout:out.slice(-max),stderr:err.slice(-max)})})});
app.get('/api/providers',async(_,r)=>{try{send(r,JSON.parse(await fs.readFile(providersFile,'utf8')))}catch{send(r,{})}});app.put('/api/providers',async(q,r)=>{const p=providerNormalize(q.body);await fs.mkdir(path.dirname(providersFile),{recursive:true});await fs.writeFile(providersFile,JSON.stringify(p,null,2));send(r,{ok:true,providers:p})});
app.get('/api/models/recommend',async(q,r)=>{
  const ram=Math.max(4,Number(q.query.ramGb||16)), vram=Math.max(0,Number(q.query.vramGb||0)), cpu=Math.max(1,Number(q.query.cpuThreads||8));
  const context=Math.min(131072,Math.max(2048,Number(q.query.context||8192))), disk=Math.max(2,Number(q.query.diskGb||30));
  const useCase=String(q.query.useCase||'coding'), priority=String(q.query.priority||'balanced'), quant=String(q.query.quant||'auto');
  const catalog=[
    {name:'Qwen3 4B',family:'Qwen3',params:'4B',size:{Q4_K_M:2.5,Q5_K_M:2.9,Q8_0:4.3},ram:6,vram:4,score:{coding:78,general:82,reasoning:72,translation:84},file:{Q4_K_M:'Qwen3-4B-Q4_K_M.gguf',Q5_K_M:'Qwen3-4B-Q5_K_M.gguf',Q8_0:'Qwen3-4B-Q8_0.gguf'},repo:'Qwen/Qwen3-4B-GGUF'},
    {name:'Qwen3 8B',family:'Qwen3',params:'8B',size:{Q4_K_M:5.0,Q5_K_M:5.9,Q8_0:8.7},ram:9,vram:7,score:{coding:88,general:91,reasoning:87,translation:92},file:{Q4_K_M:'Qwen3-8B-Q4_K_M.gguf',Q5_K_M:'Qwen3-8B-Q5_K_M.gguf',Q8_0:'Qwen3-8B-Q8_0.gguf'},repo:'Qwen/Qwen3-8B-GGUF'},
    {name:'Qwen3 14B',family:'Qwen3',params:'14B',size:{Q4_K_M:9.0,Q5_K_M:10.5,Q8_0:15.7},ram:14,vram:11,score:{coding:93,general:94,reasoning:95,translation:95},file:{Q4_K_M:'Qwen3-14B-Q4_K_M.gguf',Q5_K_M:'Qwen3-14B-Q5_K_M.gguf',Q8_0:'Qwen3-14B-Q8_0.gguf'},repo:'Qwen/Qwen3-14B-GGUF'},
    {name:'Qwen3 Coder 30B A3B',family:'Qwen3 Coder MoE',params:'30B / 3B active',size:{Q4_K_M:18.6,Q5_K_M:21.7,Q8_0:32.5},ram:24,vram:20,score:{coding:100,general:94,reasoning:98,translation:96},file:{Q4_K_M:'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf',Q5_K_M:'Qwen3-Coder-30B-A3B-Instruct-Q5_K_M.gguf',Q8_0:'Qwen3-Coder-30B-A3B-Instruct-Q8_0.gguf'},repo:'tensorblock/Qwen_Qwen3-Coder-30B-A3B-Instruct-GGUF'}
  ];
  const pickQuant=m=>{
    if(quant!=='auto')return quant;
    if(priority==='quality' && m.size.Q8_0+4<=Math.max(ram,vram||0))return 'Q8_0';
    if(priority==='quality' && m.size.Q5_K_M+3<=Math.max(ram,vram||0))return 'Q5_K_M';
    return 'Q4_K_M';
  };
  const out=catalog.map(m=>{
    const qn=pickQuant(m), size=m.size[qn], memoryTarget=vram>0?vram:ram, overhead=(context/8192)*1.2+2;
    const fitsDisk=disk>=size+1, fitsMemory=memoryTarget>=size+overhead;
    const cpuFactor=cpu>=12?1:cpu>=8?.9:cpu>=4?.78:.65;
    const useScore=m.score[useCase]||80;
    let fitPenalty=(fitsMemory?0:45)+(fitsDisk?0:25);
    if(vram>0 && vram<size+overhead && ram<size+overhead)fitPenalty+=15;
    let score=useScore*cpuFactor-fitPenalty;
    if(priority==='speed')score+=(m.params==='4B'?8:m.params==='8B'?5:m.params==='14B'?1:-4);
    if(priority==='quality')score+=(qn==='Q8_0'?8:qn==='Q5_K_M'?5:0);
    return {...m,quant:qn,sizeGb:size,ramGb:Math.ceil(Math.max(m.ram, size+overhead)),vramGb:Math.ceil(Math.max(0,m.vram)),context,score,fitLabel:fitsMemory&&fitsDisk?'مناسب':'نیازمند منابع بیشتر',
      url:'https://huggingface.co/'+m.repo+'/resolve/main/'+m.file[qn]+'?download=true',reason:fitsMemory&&fitsDisk?'با توجه به مشخصات واردشده، حافظه و فضای دیسک برای این انتخاب در محدوده مناسب است.':'برای اجرای پایدار، RAM/VRAM یا فضای دیسک بیشتری لازم است.'};
  }).filter(m=>m.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
  send(r,{ok:true,input:{ram,vram,cpu,context,disk,useCase,priority,quant},recommendations:out});
});
app.get('/api/models',async(_,r)=>{const e=await fs.readdir(modelsRoot,{withFileTypes:true});send(r,e.filter(x=>x.isFile()&&/\.gguf$/i.test(x.name)).map(x=>({name:x.name})))});
app.post('/api/models/download',async(q,r)=>{
  const raw=String(q.body.url||'').trim();
  if(!raw)return r.status(400).json({error:'URL مدل وارد نشده است'});
  let parsed;
  try{parsed=new URL(raw)}catch{return r.status(400).json({error:'آدرس دانلود معتبر نیست'})}
  if(!/^https?:$/.test(parsed.protocol))return r.status(400).json({error:'فقط HTTP/HTTPS مجاز است'});
  const name=path.basename(parsed.pathname);
  if(!/\.gguf$/i.test(name))return r.status(400).json({error:'لینک باید به فایل GGUF ختم شود'});
  const dest=safePath(modelsRoot,name),tmp=dest+'.part';
  let fh=null;
  try{
    const x=await fetch(parsed,{redirect:'follow',signal:AbortSignal.timeout(30*60*1000),headers:{'user-agent':'Arena-Coding-Agent/1.3.0'}});
    if(!x.ok)throw Error('دانلود ناموفق: HTTP '+x.status);
    if(!x.body)throw Error('سرور فایل قابل دریافت ارائه نکرد');
    const declared=Number(x.headers.get('content-length')||0);
    const maxBytes=Number(process.env.MAX_MODEL_DOWNLOAD_BYTES||30*1024*1024*1024);
    if(declared>maxBytes)throw Error('حجم مدل از سقف مجاز دانلود بیشتر است');
    fh=await fs.open(tmp,'w');
    const rd=x.body.getReader();let total=0;
    while(true){
      const z=await rd.read();
      if(z.done)break;
      total+=z.value.byteLength;
      if(total>maxBytes)throw Error('حجم مدل از سقف مجاز دانلود بیشتر است');
      await fh.write(z.value);
    }
    await fh.close();fh=null;
    await fs.rename(tmp,dest);
    send(r,{ok:true,name,bytes:total,sizeGb:Math.round(total/1073741824*100)/100});
  }catch(e){
    if(fh)await fh.close().catch(()=>{});
    await fs.rm(tmp,{force:true}).catch(()=>{});
    r.status(502).json({error:e.message||'دانلود مدل ناموفق بود'});
  }
});
app.post('/api/models/test-all',async(q,r)=>{
  const entries=await fs.readdir(modelsRoot,{withFileTypes:true});
  const localModels=entries.filter(x=>x.isFile()&&/\.gguf$/i.test(x.name)).map(x=>x.name);
  const rawProviders=await (async()=>{try{return JSON.parse(await fs.readFile(providersFile,'utf8'))}catch{return {}}})();
  const providers=providerNormalize(rawProviders); const imported=[];
  for(const p of Object.values(providers)) for(const m of (p.models||[])){
    if(typeof m==='string') imported.push({provider:p.name||p.id,id:m,name:m,url:p.url,apiKey:p.apiKey||p.apiKeys?.[0]||'',vendor:p.vendor||p.id});
    else if(m?.id||m?.name) imported.push({provider:p.name||p.id,id:String(m.id||m.name),name:String(m.name||m.id),url:m.url||p.url,apiKey:m.apiKey||p.apiKey||p.apiKeys?.[0]||'',vendor:m.vendor||p.vendor||p.id});
  }
  const prompt=String(q.body.prompt||'سلام! در یک جمله خودت را معرفی کن.').slice(0,400), context=Math.min(32768,Math.max(512,Number(q.body.context||4096))), maxTokens=Math.min(1024,Math.max(1,Number(q.body.maxTokens||64))), temperature=Math.min(2,Math.max(0,Number(q.body.temperature??0.2))), results=[];
  const testImported=async item=>{
    const started=Date.now();
    try{
      if(!item.url)throw Error('آدرس Provider ثبت نشده است');
      const key=item.apiKey||'';
      let url=item.url.replace(/\/$/,'');
      const headers={'content-type':'application/json'};
      let body;
      if(/generativelanguage\.googleapis\.com|gemini/i.test(item.vendor+' '+url)){
        if(!key)throw Error('API key موجود نیست');
        const endpoint=url.includes(':generateContent')?url:(url+'/models/'+encodeURIComponent(item.id)+':generateContent');
        url=endpoint+(endpoint.includes('?')?'&':'?')+'key='+encodeURIComponent(key);
        body={
          contents:[{parts:[{text:prompt}]}],
          generationConfig:{temperature,maxOutputTokens:maxTokens}
        };
      }else{
        if(!/\/(chat\/completions|responses|generate)$/i.test(url))url+=(url.endsWith('/v1')?'/chat/completions':'/v1/chat/completions');
        body={model:item.id,messages:[{role:'user',content:prompt}],temperature,max_tokens:maxTokens};
        if(/ollama/i.test(item.vendor+' '+url))body.stream=false;
        if(key)headers.authorization='Bearer '+key;
      }
      const t0=Date.now();
      const x=await fetch(url,{
        method:'POST',
        headers,
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(60000)
      });
      const d=await x.json().catch(()=>({}));
      if(!x.ok)throw Error(d.error?.message||d.message||('HTTP '+x.status));
      const text=d.choices?.[0]?.message?.content||d.choices?.[0]?.text||d.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||d.response||'';
      const usage=d.usage||d.usageMetadata||{};
      const completionTokens=Number(usage.completion_tokens||usage.output_tokens||usage.candidatesTokenCount||0);
      const elapsed=Date.now()-t0;
      return {
        name:item.name,
        provider:item.provider,
        source:'imported',
        ok:true,
        startupMs:0,
        latencyMs:elapsed,
        response:String(text).slice(0,1200),
        promptTokens:usage.prompt_tokens??usage.input_tokens??usage.promptTokenCount??null,
        completionTokens:completionTokens||null,
        tokensPerSecond:completionTokens&&elapsed>0?Math.round(completionTokens*1000/elapsed*10)/10:null
      };
    }catch(e){
      return {
        name:item.name,
        provider:item.provider,
        source:'imported',
        ok:false,
        error:e.message,
        latencyMs:Date.now()-started
      };
    }
  };
  for(const item of imported)results.push(await testImported(item));
  send(r,{ok:true,total:results.length,localTotal:localModels.length,importedTotal:imported.length,results,settings:{context,maxTokens,temperature,prompt}});
});
app.post('/api/models/launch',async(q,r)=>{const name=String(q.body.name||'');const model=safePath(modelsRoot,name);if(!name.endsWith('.gguf'))return r.status(400).json({error:'GGUF required'});const port=Number(q.body.port||8080);const c=spawn(process.env.LLAMA_BIN||'llama-server',['-m',model,'--host','127.0.0.1','--port',String(port),'-c',String(q.body.context||8192)],{cwd:root,detached:true,stdio:'ignore'});c.unref();send(r,{ok:true,pid:c.pid,baseUrl:'http://127.0.0.1:'+port+'/v1'})});
app.post('/api/agent',async(q,r)=>{const prompt=String(q.body.prompt||'').trim();const url=String(q.body.modelUrl||'http://127.0.0.1:8080/v1/chat/completions');const x=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:q.body.model||'local',messages:[{role:'system',content:'You are a professional autonomous coding agent. Work iteratively until verification passes. Return ONLY valid JSON: {"message":"...","actions":[{"type":"write","path":"relative/path","content":"complete file content"},{"type":"command","command":"safe command"}],"done":true}. You may inspect via command actions. After every execution result, use the feedback to fix errors. Never claim success without verification. Paths must stay inside the workspace.'},{role:'user',content:prompt}],temperature:.1,max_tokens:Number(q.body.maxTokens||4096)})});const d=await x.json();if(!x.ok)return r.status(x.status).json(d);send(r,{ok:true,text:d.choices?.[0]?.message?.content||JSON.stringify(d)})});
app.post('/api/agent/loop',async(q,r)=>{const prompt=String(q.body.prompt||'').trim();if(!prompt)return r.status(400).json({error:'prompt required'});const maxIterations=Math.min(20,Math.max(1,Number(q.body.maxIterations||8)));const modelUrl=String(q.body.modelUrl||'http://127.0.0.1:8080/v1/chat/completions');const messages=[{role:'system',content:'You are an autonomous senior coding agent. Execute a feedback loop. Return ONLY valid JSON: {"message":"...","actions":[{"type":"write","path":"relative/path","content":"complete file content"},{"type":"command","command":"safe command"}],"done":false}. Use commands to inspect and test. After tool results, fix every error you can. Stop only when verification is clean or you need user input. Never claim a change was made unless its write action was executed. Never use paths outside workspace.'},{role:'user',content:prompt}];const history=[];for(let i=1;i<=maxIterations;i++){const x=await fetch(modelUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:q.body.model||'local',messages,temperature:.1,max_tokens:Number(q.body.maxTokens||6000)})});const d=await x.json();if(!x.ok)return r.status(x.status).json({error:d});const raw=d.choices?.[0]?.message?.content||'';let plan;try{plan=JSON.parse(raw.replace(/^\\`\\`\\`json\\s*|\\s*\\`\\`\\`$/g,''))}catch{messages.push({role:'user',content:'Your previous response was not valid JSON. Return only the required JSON object.'});history.push({iteration:i,error:'invalid JSON'});continue}const results=[];for(const a of (plan.actions||[])){if(a.type==='write'){try{const p=safePath(root,String(a.path));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(a.content??''));results.push({type:'write',path:a.path,ok:true})}catch(e){results.push({type:'write',path:a.path,ok:false,error:e.message})}}else if(a.type==='command'){const z=await runCommand(String(a.command||''),Number(q.body.commandTimeout||120000));results.push({type:'command',command:a.command,code:z.code,stdout:z.stdout,stderr:z.stderr})}}const verification=await verifyWorkspace();const clean=verification.every(x=>x.code===0);history.push({iteration:i,message:plan.message,actions:results,verification,done:Boolean(plan.done&&clean)});if(plan.done&&clean)return send(r,{ok:true,success:true,iterations:i,history});messages.push({role:'assistant',content:JSON.stringify(plan)});messages.push({role:'user',content:JSON.stringify({executionResults:results,automaticVerification:verification,feedback:clean?'Verification is clean. If the requested work is complete, finish; otherwise continue.':'Verification has failures. Diagnose and fix them, then verify again.'})})}send(r,{ok:true,success:false,iterations:maxIterations,history,message:'Maximum iterations reached; review the latest verification results.'})});
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'..','public','index.html'));next()});app.use((e,_,r,__)=>(r.status(500).json({error:e.message})));app.listen(port,host,()=>console.log('Local Coding Agent on '+host+':'+port));