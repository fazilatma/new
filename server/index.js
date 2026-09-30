import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {securityMiddleware, safePath, isDangerousCommand} from './security.js';
const execFileAsync=promisify(execFile); const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.WORKSPACE_ROOT||path.join(__dirname,'..','workspace')); const modelsRoot=path.resolve(process.env.MODELS_ROOT||path.join(__dirname,'..','models')); const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
await fs.mkdir(root,{recursive:true}); await fs.mkdir(modelsRoot,{recursive:true}); const providersFile=path.resolve(process.env.PROVIDERS_FILE||path.join(modelsRoot,'providers.json'));

async function runCommand(command,timeout=120000,signal){
  if(isDangerousCommand(command))return {code:403,stdout:'',stderr:'Blocked by safety policy'};
  if(signal?.aborted)return {code:130,stdout:'',stderr:'Command cancelled'};
  return await new Promise(resolve=>{
    const c=spawn('/bin/sh',['-lc',command],{cwd:root,env:{...process.env,HOME:process.env.HOME||root},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const max=Number(process.env.MAX_OUTPUT_BYTES||200000);let settled=false;
    const finish=code=>{if(settled)return;settled=true;clearTimeout(t);signal?.removeEventListener('abort',onAbort);resolve({code,stdout:stdout.slice(-max),stderr:stderr.slice(-max)})};
    const onAbort=()=>{try{c.kill('SIGTERM')}catch{}};
    c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);
    const t=setTimeout(()=>c.kill('SIGTERM'),timeout);
    if(signal)signal.addEventListener('abort',onAbort,{once:true});
    c.on('close',finish);
  });
}
async function collectSourceFiles(maxFiles=240){
  const out=[];const ignored=new Set(['.git','node_modules','.cache','dist','build','.wconsole_data','.arena']);
  async function walk(dir,rel=''){
    if(out.length>=maxFiles)return;
    let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true})}catch{return}
    for(const entry of entries){
      if(out.length>=maxFiles)break;
      if(ignored.has(entry.name))continue;
      const abs=path.join(dir,entry.name),name=rel?path.join(rel,entry.name):entry.name;
      if(entry.isDirectory()){await walk(abs,name);continue}
      if(/\.(js|mjs|cjs|py|php)$/i.test(entry.name))out.push(name);
    }
  }
  await walk(root);return out;
}
async function discoverProjectCommands(){
  const commands=[];
  let pkgData=null;
  try{pkgData=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))}catch{}
  const sourceFiles=await collectSourceFiles(240);
  const hasJs=sourceFiles.some(x=>/\.(js|mjs|cjs)$/i.test(x));
  const hasPy=sourceFiles.some(x=>/\.py$/i.test(x));
  const hasPhp=sourceFiles.some(x=>/\.php$/i.test(x));
  if(hasJs)commands.push({id:'node-check',label:'JS syntax',group:'Verify',risk:'safe'});
  if(hasPy)commands.push({id:'python-compile',label:'Python syntax',group:'Verify',risk:'safe'});
  if(hasPhp)commands.push({id:'php-lint',label:'PHP syntax',group:'Verify',risk:'safe'});
  if(pkgData?.scripts&&typeof pkgData.scripts==='object'){
    for(const [name,script] of Object.entries(pkgData.scripts)){
      if(typeof script!=='string'||/^pre|^post/.test(name))continue;
      const lower=name.toLowerCase();
      const safe=/^(test|check|lint|typecheck|types|verify|format|format:check|compile|build)(:|$)/.test(lower);
      commands.push({id:'npm-script',name,script:String(script).slice(0,240),label:'npm · '+name,group:safe?'Project checks':'Project scripts',risk:safe?'safe':'confirm'});
    }
  }
  return {commands,sourceFiles:sourceFiles.length,limits:{maxFiles:240}};
}
async function verifyWorkspace(){
  const results=[];const files=await collectSourceFiles(160);
  for(const f of files){
    if(/\.(js|mjs|cjs)$/i.test(f))results.push({file:f,...await runCommand('node --check '+JSON.stringify(f),30000)});
    else if(/\.py$/i.test(f))results.push({file:f,...await runCommand('python3 -m py_compile '+JSON.stringify(f),30000)});
    else if(/\.php$/i.test(f))results.push({file:f,...await runCommand('php -l '+JSON.stringify(f),30000)});
    if(results.length>=160)break;
  }
  try{const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(pkg.scripts?.test)results.push({file:'package.json · npm test',...await runCommand('npm test',120000)})}catch{}
  return results
}
const agentRunControllers=new Map();

async function snapshotWorkspace(){
  const files=new Map();let count=0;
  const ignored=new Set(['.git','node_modules','.cache','dist','build','.wconsole_data','.arena']);
  async function walk(dir,rel=''){
    if(count>=500)return;
    let entries=[];
    try{entries=await fs.readdir(dir,{withFileTypes:true})}catch{return}
    for(const entry of entries){
      if(count>=500)break;
      if(ignored.has(entry.name))continue;
      const abs=path.join(dir,entry.name),r=rel?path.join(rel,entry.name):entry.name;
      if(entry.isDirectory()){await walk(abs,r);continue}
      try{
        const st=await fs.stat(abs);
        if(st.size>1024*1024)continue;
        files.set(r,await fs.readFile(abs,'utf8'));count++;
      }catch{}
    }
  }
  await walk(root);return files;
}
function workspaceChanges(before,after){
  const changed=[];
  const names=new Set([...before.keys(),...after.keys()]);
  for(const name of names){
    const a=before.get(name),b=after.get(name);
    if(a===undefined&&b!==undefined)changed.push({path:name,status:'added',bytesAfter:Buffer.byteLength(b)});
    else if(a!==undefined&&b===undefined)changed.push({path:name,status:'deleted',bytesBefore:Buffer.byteLength(a)});
    else if(a!==b)changed.push({path:name,status:'modified',bytesBefore:Buffer.byteLength(a||''),bytesAfter:Buffer.byteLength(b||'')});
  }
  return changed.sort((a,b)=>a.path.localeCompare(b.path));
}
async function gitWorkspaceInfo(){
  try{
    const status=await execFileAsync('git',['status','--short'],{cwd:root,timeout:5000});
    const diff=await execFileAsync('git',['diff','--stat'],{cwd:root,timeout:5000});
    const branch=await execFileAsync('git',['branch','--show-current'],{cwd:root,timeout:5000});
    return {isGit:true,branch:(branch.stdout||'').trim(),status:(status.stdout||'').trim(),diffStat:(diff.stdout||'').trim()};
  }catch{return {isGit:false,branch:'',status:'',diffStat:''}}
}

function providerNormalize(input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provider JSON must be an object');const out={};for(const [id,v] of Object.entries(input)){if(!v||typeof v!=='object'||Array.isArray(v))continue;const models=Array.isArray(v.models)?v.models.map(m=>typeof m==='string'?m:(m&&typeof m==='object'?m:{})):[];out[String(id)]={id:String(v.id||id),name:String(v.name||id),vendor:String(v.vendor||''),url:String(v.url||''),apiKey:String(v.apiKey||''),enabled:Boolean(v.enabled),models,relayUrl:String(v.relayUrl||''),relayToken:String(v.relayToken||''),relayEnabled:Boolean(v.relayEnabled),useGlobalRelay:Boolean(v.useGlobalRelay),proxyUrl:String(v.proxyUrl||''),proxyType:String(v.proxyType||'http')};if(Array.isArray(v.apiKeys))out[String(id)].apiKeys=v.apiKeys.map(x=>String(x));}return out}
const app=express(); app.use(cors()); app.use((req,_,next)=>{if(req.url==='/chat'||req.url.startsWith('/chat/')){req.url=req.url.slice(5)||'/';}next()}); app.use(express.json({limit:'2mb'})); app.use(securityMiddleware); app.use(express.static(path.join(__dirname,'..','public'))); const send=(r,d)=>r.json(d);
const clamp=(n,min,max,fallback)=>{const x=Number(n);return Number.isFinite(x)?Math.min(max,Math.max(min,x)):fallback};
const safeTimeout=v=>clamp(v,1000,300000,120000);
const validLocalPort=v=>{const p=clamp(v,1024,65535,8080);return Math.floor(p)};
const APP_VERSION='1.14.1';
const CHECKPOINT_DIR=path.join(root,'.arena','checkpoints');
const CHECKPOINT_MAX_FILES=200;
const CHECKPOINT_MAX_BYTES=20*1024*1024;
const CHECKPOINT_MAX_FILE_BYTES=2*1024*1024;
async function createCheckpoint(label='Agent run'){
  const snap=await snapshotWorkspace(); let total=0; let dataSkipped=false; const files={};
  for(const [name,content] of snap){ if(Object.keys(files).length>=CHECKPOINT_MAX_FILES) break; const bytes=Buffer.byteLength(content); if(bytes>CHECKPOINT_MAX_FILE_BYTES) { dataSkipped=true; continue; } if(total+bytes>CHECKPOINT_MAX_BYTES) break; files[name]=content; total+=bytes; }
  await fs.mkdir(CHECKPOINT_DIR,{recursive:true});
  const id=randomUUID(); const data={id,label:String(label).slice(0,160),createdAt:new Date().toISOString(),files,totalBytes:total,truncated:dataSkipped||Object.keys(files).length<snap.size};
  await fs.writeFile(path.join(CHECKPOINT_DIR,'latest.json'),JSON.stringify(data));
  return {id,label:data.label,createdAt:data.createdAt,fileCount:Object.keys(files).length,totalBytes:total,truncated:data.truncated};
}
async function readCheckpoint(){try{return JSON.parse(await fs.readFile(path.join(CHECKPOINT_DIR,'latest.json'),'utf8'))}catch{return null}}
async function restoreCheckpoint(){
  const cp=await readCheckpoint(); if(!cp)return {ok:false,error:'No checkpoint exists'};
  if(cp.truncated)return {ok:false,error:'Checkpoint is partial and cannot be used for a destructive revert. Create a fresh checkpoint with a smaller workspace or increase the checkpoint limits.'};
  const target=new Set(Object.keys(cp.files||{})); const current=await snapshotWorkspace(); let restored=0,deleted=0;
  for(const name of target){const p=safePath(root,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(cp.files[name]??''));restored++}
  for(const name of current.keys()){if(target.has(name))continue; if(name.startsWith('.arena'+path.sep)||name==='.arena')continue; await fs.rm(safePath(root,name),{recursive:true,force:true});deleted++}
  return {ok:true,restored,deleted,checkpoint:{id:cp.id,label:cp.label,createdAt:cp.createdAt,truncated:Boolean(cp.truncated)}};
}
function diffText(before='',after=''){
  const a=String(before).split(/\r?\n/),b=String(after).split(/\r?\n/),out=[]; let i=0,j=0;
  while(i<a.length||j<b.length){if(a[i]===b[j]){out.push({type:'context',lineA:i+1,lineB:j+1,text:a[i]??''});i++;j++;continue}
    if(i<a.length&&(!b[j]||!b.slice(j,j+3).includes(a[i]))){out.push({type:'remove',lineA:i+1,lineB:null,text:a[i]});i++;continue}
    if(j<b.length){out.push({type:'add',lineA:null,lineB:j+1,text:b[j]??''});j++;}
  }
  return out.slice(0,4000);
}

app.get('/api/version',async(_,r)=>send(r,{version:APP_VERSION,name:'local-coding-agent',channel:'stable'}));
app.get('/api/health',async(_,r)=>send(r,{ok:true,node:process.version,version:APP_VERSION}));
app.get('/api/workspace/git',async(_,r)=>send(r,await gitWorkspaceInfo()));
app.get('/api/workspace/checkpoint',async(_,r)=>{const cp=await readCheckpoint();send(r,{exists:Boolean(cp),checkpoint:cp?{id:cp.id,label:cp.label,createdAt:cp.createdAt,fileCount:Object.keys(cp.files||{}).length,totalBytes:cp.totalBytes,truncated:Boolean(cp.truncated)}:null})});
app.post('/api/workspace/checkpoint',async(q,r)=>{try{send(r,{ok:true,checkpoint:await createCheckpoint(q.body?.label||'Manual checkpoint')})}catch(e){r.status(500).json({error:e.message||'Checkpoint failed'})}});
app.post('/api/workspace/revert',async(_,r)=>{try{const result=await restoreCheckpoint();if(!result.ok)return r.status(404).json(result);send(r,result)}catch(e){r.status(500).json({error:e.message||'Revert failed'})}});
app.get('/api/workspace/diff',async(q,r)=>{const name=String(q.query.path||'');if(!name)return r.status(400).json({error:'path required'});const cp=await readCheckpoint();if(!cp)return r.status(404).json({error:'No checkpoint exists'});try{const before=Object.prototype.hasOwnProperty.call(cp.files||{},name)?String(cp.files[name]):null;let after=null;try{after=await fs.readFile(safePath(root,name),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}if(before===null&&after===null)return r.status(404).json({error:'File is not available in checkpoint or workspace'});send(r,{path:name,before,after,kind:before===null?'added':after===null?'deleted':'modified',lines:diffText(before||'',after||'')})}catch(e){r.status(500).json({error:e.message||'Diff failed'})}});
app.post('/api/workspace/revert-file',async(q,r)=>{
  const name=String(q.body.path||'');
  if(!name)return r.status(400).json({error:'path required'});
  const cp=await readCheckpoint();
  if(!cp||cp.truncated)return r.status(409).json({error:'A complete checkpoint is required for per-file revert'});
  const has=Object.prototype.hasOwnProperty.call(cp.files||{},name);
  const p=safePath(root,name);
  try{
    if(has){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(cp.files[name]??''));return send(r,{ok:true,path:name,action:'restored'})}
    await fs.rm(p,{recursive:true,force:true});
    return send(r,{ok:true,path:name,action:'removed'})
  }catch(e){return r.status(500).json({error:e.message||'File revert failed'})}
});
app.get('/api/project/commands',async(_,r)=>{
  try{send(r,{ok:true,...await discoverProjectCommands()})}
  catch(e){r.status(500).json({error:e.message||'Command discovery failed'})}
});
app.post('/api/project/check',async(q,r)=>{
  const kind=String(q.body?.kind||'').trim();
  const name=String(q.body?.name||'').trim();
  const timeout=safeTimeout(q.body?.timeout);
  const started=Date.now();
  try{
    let command='';
    if(kind==='node-check'||kind==='python-compile'||kind==='php-lint'){
      const files=await collectSourceFiles(160);
      const selected=kind==='node-check'?files.filter(x=>/\.(js|mjs|cjs)$/i.test(x)):kind==='python-compile'?files.filter(x=>/\.py$/i.test(x)):files.filter(x=>/\.php$/i.test(x));
      if(!selected.length)return send(r,{ok:true,kind,name:'',code:0,stdout:'No matching source files were found.',stderr:'',durationMs:0,files:0});
      const results=[];
      for(const file of selected.slice(0,160)){
        const check=kind==='node-check'?'node --check '+JSON.stringify(file):kind==='python-compile'?'python3 -m py_compile '+JSON.stringify(file):'php -l '+JSON.stringify(file);
        const result=await runCommand(check,Math.min(timeout,30000));
        results.push({file,code:result.code,stdout:result.stdout,stderr:result.stderr});
        if(result.code!==0)break;
      }
      const failed=results.find(x=>x.code!==0);
      return send(r,{ok:!failed,kind,name:kind==='node-check'?'JS syntax':kind==='python-compile'?'Python syntax':'PHP syntax',code:failed?.code||0,stdout:results.map(x=>x.file+': '+(x.stdout||'OK')).join('\\n'),stderr:failed?.stderr||'',durationMs:Date.now()-started,files:results.length});
    }
    if(kind==='npm-script'){
      if(!name||!/^[a-z0-9][a-z0-9:@._+/-]{0,120}$/i.test(name))return r.status(400).json({error:'Invalid npm script name'});
      const discovered=await discoverProjectCommands();
      const item=discovered.commands.find(x=>x.id==='npm-script'&&x.name===name);
      if(!item)return r.status(404).json({error:'Project script not found'});
      command='npm run '+JSON.stringify(name);
    }else if(kind==='npm-test'){
      command='npm test';
    }else return r.status(400).json({error:'Unsupported project check'});
    const result=await runCommand(command,timeout);
    return send(r,{ok:result.code===0,kind,name:name||kind,command,code:result.code,stdout:result.stdout,stderr:result.stderr,durationMs:Date.now()-started});
  }catch(e){return r.status(500).json({error:e.message||'Project check failed'})}
});
app.get('/api/runtime',async(_,r)=>{const cmds=[['node','--version'],[process.env.PYTHON_BIN||'python3','--version'],['php','-v'],[process.env.LLAMA_BIN||'llama-server','--version']];const o={};for(const[c,a]of cmds){try{const x=await execFileAsync(c,[a],{timeout:5000});o[c]=(x.stdout||x.stderr).trim().split('\\n')[0]}catch{o[c]=null}}send(r,o)});
app.get('/api/files',async(q,r)=>{const d=safePath(root,String(q.query.path||''));const e=await fs.readdir(d,{withFileTypes:true});send(r,e.map(x=>({name:x.name,type:x.isDirectory()?'dir':'file'})).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name)))});
app.get('/api/file',async(q,r)=>{const p=safePath(root,String(q.query.path||''));send(r,{path:path.relative(root,p),content:await fs.readFile(p,'utf8')})});
app.put('/api/file',async(q,r)=>{const p=safePath(root,String(q.body.path||''));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,String(q.body.content??''));send(r,{ok:true})});
app.post('/api/mkdir',async(q,r)=>{await fs.mkdir(safePath(root,String(q.body.path||'')),{recursive:true});send(r,{ok:true})});
app.delete('/api/file',async(q,r)=>{await fs.rm(safePath(root,String(q.body.path||'')),{recursive:true});send(r,{ok:true})});
app.post('/api/terminal',async(q,r)=>{const command=String(q.body.command||'').trim();if(!command)return r.status(400).json({error:'command required'});const z=await runCommand(command,safeTimeout(q.body.timeout||process.env.COMMAND_TIMEOUT_MS));send(r,z)});
app.get('/api/providers',async(_,r)=>{try{const p=providerNormalize(JSON.parse(await fs.readFile(providersFile,'utf8')));const safe=Object.fromEntries(Object.entries(p).map(([id,v])=>[id,{...v,apiKey:'',apiKeys:[],hasApiKey:Boolean(v.apiKey||v.apiKeys?.length)}]));send(r,safe)}catch{send(r,{})}});
app.get('/api/providers/export',async(_,r)=>{try{send(r,providerNormalize(JSON.parse(await fs.readFile(providersFile,'utf8'))))}catch{send(r,{})}});app.put('/api/providers',async(q,r)=>{const p=providerNormalize(q.body);await fs.mkdir(path.dirname(providersFile),{recursive:true});await fs.writeFile(providersFile,JSON.stringify(p,null,2));send(r,{ok:true,providers:p})});
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
const downloadJobs=new Map();
const MODEL_DOWNLOAD_MAX_BYTES=Number(process.env.MAX_MODEL_DOWNLOAD_BYTES||30*1024*1024*1024);
const MODEL_DOWNLOAD_TIMEOUT_MS=Number(process.env.MODEL_DOWNLOAD_TIMEOUT_MS||30*60*1000);
const MODEL_DOWNLOAD_FREE_RESERVE_BYTES=Number(process.env.MODEL_DOWNLOAD_FREE_RESERVE_BYTES||512*1024*1024);
let activeDownloadJob=null;

async function diskInfo(dir){
  try{
    const s=await fs.statfs(dir);
    return {freeBytes:Number(s.bavail)*Number(s.bsize),blockSize:Number(s.bsize)};
  }catch{
    return {freeBytes:null,blockSize:null};
  }
}

async function probeModelUrl(rawUrl){
  const headers={'user-agent':'Arena-Coding-Agent/1.7.0'};
  let x;
  try{
    x=await fetch(rawUrl,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(15000),headers});
  }catch{}
  let bytes=Number(x?.headers?.get('content-length')||0);
  let finalUrl=x?.url||rawUrl;
  let status=x?.status||0;
  let contentType=x?.headers?.get('content-type')||'';
  if(!x?.ok || !bytes){
    try{
      x=await fetch(rawUrl,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(15000),headers:{...headers,range:'bytes=0-0'}});
      status=x.status;
      finalUrl=x.url||rawUrl;
      contentType=x.headers.get('content-type')||contentType;
      const range=x.headers.get('content-range')||'';
      const match=range.match(/\/([0-9]+)$/);
      bytes=Number(x.headers.get('content-length')||0);
      if(match)bytes=Number(match[1]);
      await x.body?.cancel().catch(()=>{});
    }catch(e){
      throw Error('URL check failed: '+e.message);
    }
  }
  const disk=await diskInfo(modelsRoot);
  if(status<200||status>=400)throw Error('Download URL returned HTTP '+status);
  if(!/gguf/i.test(contentType) && !/\.gguf(?:$|\?)/i.test(new URL(finalUrl).pathname))throw Error('URL does not appear to point to a GGUF file');
  if(bytes>MODEL_DOWNLOAD_MAX_BYTES)throw Error('Model exceeds the configured download limit');
  if(Number.isFinite(disk.freeBytes) && bytes>Math.max(0,disk.freeBytes-MODEL_DOWNLOAD_FREE_RESERVE_BYTES))throw Error('Not enough free disk space for this model');
  return {ok:true,finalUrl,bytes:bytes||null,contentType,freeBytes:disk.freeBytes};
}

async function runModelDownload(job){
  activeDownloadJob=job.id;
  job.status='downloading';
  job.startedAt=new Date().toISOString();
  const dest=safePath(modelsRoot,job.name),tmp=dest+'.part';
  let fh=null;
  try{
    const x=await fetch(job.url,{redirect:'follow',signal:AbortSignal.timeout(MODEL_DOWNLOAD_TIMEOUT_MS),headers:{'user-agent':'Arena-Coding-Agent/1.7.0','accept':'application/octet-stream,application/*;q=0.9,*/*;q=0.8'}});
    if(!x.ok)throw Error('Download failed: HTTP '+x.status);
    if(!x.body)throw Error('Download server returned no response body');
    const declared=Number(x.headers.get('content-length')||0);
    job.finalUrl=x.url||job.url;
    job.contentType=x.headers.get('content-type')||'';
    job.total=declared||job.total||0;
    if(declared>MODEL_DOWNLOAD_MAX_BYTES)throw Error('Model exceeds the configured download limit');
    const disk=await diskInfo(modelsRoot);
    if(declared && Number.isFinite(disk.freeBytes) && declared>Math.max(0,disk.freeBytes-MODEL_DOWNLOAD_FREE_RESERVE_BYTES))throw Error('Not enough free disk space for this model');
    await fs.mkdir(modelsRoot,{recursive:true});
    fh=await fs.open(tmp,'w');
    const rd=x.body.getReader();
    let total=0;
    while(true){
      const z=await rd.read();
      if(z.done)break;
      total+=z.value.byteLength;
      if(total>MODEL_DOWNLOAD_MAX_BYTES)throw Error('Model exceeds the configured download limit');
      await fh.write(z.value);
      job.bytes=total;
      job.progress=job.total?Math.min(100,Math.round(total/job.total*1000)/10):null;
    }
    await fh.close();fh=null;
    if(job.total && total!==job.total)job.total=total;
    await fs.rename(tmp,dest);
    job.bytes=total;job.progress=100;job.status='completed';job.completedAt=new Date().toISOString();job.sizeGb=Math.round(total/1073741824*100)/100;
  }catch(e){
    if(fh)await fh.close().catch(()=>{});
    await fs.rm(tmp,{force:true}).catch(()=>{});
    job.status='failed';job.error=e.message||'Model download failed';job.completedAt=new Date().toISOString();
  }finally{
    if(activeDownloadJob===job.id)activeDownloadJob=null;
    setTimeout(()=>downloadJobs.delete(job.id),10*60*1000);
  }
}

app.get('/api/models/download-check',async(q,r)=>{
  const raw=String(q.query.url||'').trim();
  if(!raw)return r.status(400).json({error:'Model URL is required'});
  let parsed;
  try{parsed=new URL(raw)}catch{return r.status(400).json({error:'Invalid download URL'})}
  if(!/^https?:$/.test(parsed.protocol))return r.status(400).json({error:'Only HTTP/HTTPS URLs are allowed'});
  const name=path.basename(parsed.pathname);
  if(!/\.gguf$/i.test(name))return r.status(400).json({error:'URL must point to a .gguf file'});
  try{
    const d=await probeModelUrl(parsed.toString());
    send(r,{ok:true,name,finalUrl:d.finalUrl,bytes:d.bytes,contentType:d.contentType,freeBytes:d.freeBytes});
  }catch(e){
    r.status(502).json({error:e.message||'Model URL check failed'});
  }
});

app.post('/api/models/download',async(q,r)=>{
  const raw=String(q.body.url||'').trim();
  if(!raw)return r.status(400).json({error:'Model URL is required'});
  if(activeDownloadJob)return r.status(409).json({error:'Another model download is already running',jobId:activeDownloadJob});
  let parsed;
  try{parsed=new URL(raw)}catch{return r.status(400).json({error:'Invalid download URL'})}
  if(!/^https?:$/.test(parsed.protocol))return r.status(400).json({error:'Only HTTP/HTTPS URLs are allowed'});
  const name=path.basename(parsed.pathname);
  if(!/\\.gguf$/i.test(name))return r.status(400).json({error:'URL must point to a .gguf file'});
  await fs.mkdir(modelsRoot,{recursive:true});
  try{
    const probe=await probeModelUrl(parsed.toString());
    const job={id:randomUUID(),name,url:probe.finalUrl||parsed.toString(),status:'queued',bytes:0,total:probe.bytes||0,progress:0,freeBytes:probe.freeBytes||null,contentType:probe.contentType||'',startedAt:null,completedAt:null,error:null};
    downloadJobs.set(job.id,job);
    void runModelDownload(job);
    send(r,{ok:true,accepted:true,jobId:job.id,name,bytes:job.total||null,status:job.status});
  }catch(e){
    r.status(502).json({error:e.message||'Model download could not be started'});
  }
});

app.get('/api/models/download/:jobId',async(q,r)=>{
  const job=downloadJobs.get(String(q.params.jobId));
  if(!job)return r.status(404).json({error:'Download job not found'});
  send(r,{ok:job.status==='completed',...job,url:undefined});
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
  const testLocal=async name=>{
    const started=Date.now();
    const port=10080+(results.length%1000);
    const modelPath=safePath(modelsRoot,name);
    let child=null;
    let logs='';
    try{
      const llama=process.env.LLAMA_BIN||'llama-server';
      const args=['-m',modelPath,'--host','127.0.0.1','--port',String(port),'-c',String(context)];
      const gpuLayers=Number(q.body.gpuLayers);
      if(Number.isFinite(gpuLayers)&&gpuLayers>=0)args.push('-ngl',String(Math.floor(gpuLayers)));
      child=spawn(llama,args,{cwd:root,stdio:['ignore','pipe','pipe']});
      child.stderr?.on('data',b=>{logs+=b.toString().slice(-4000)});
      const deadline=Date.now()+60000;
      let ready=false;
      while(Date.now()<deadline){
        try{
          const z=await fetch('http://127.0.0.1:'+port+'/v1/models',{signal:AbortSignal.timeout(1500)});
          if(z.ok){ready=true;break}
        }catch{}
        if(child.exitCode!==null)break;
        await new Promise(x=>setTimeout(x,350));
      }
      if(!ready)throw Error(child.exitCode!==null?'llama-server exited before becoming ready':'Model startup timeout');
      const readyAt=Date.now();
      const x=await fetch('http://127.0.0.1:'+port+'/v1/chat/completions',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({model:name,messages:[{role:'user',content:prompt}],temperature,max_tokens:maxTokens,stream:false}),
        signal:AbortSignal.timeout(120000)
      });
      const d=await x.json().catch(()=>({}));
      if(!x.ok)throw Error(d.error?.message||d.message||('HTTP '+x.status));
      const text=d.choices?.[0]?.message?.content||d.choices?.[0]?.text||d.response||'';
      const usage=d.usage||{};
      const elapsed=Date.now()-readyAt;
      const completionTokens=Number(usage.completion_tokens||0);
      return {
        name,
        source:'local',
        ok:true,
        startupMs:readyAt-started,
        latencyMs:elapsed,
        response:String(text).slice(0,2000),
        promptTokens:usage.prompt_tokens??null,
        completionTokens:completionTokens||null,
        tokensPerSecond:completionTokens&&elapsed>0?Math.round(completionTokens*1000/elapsed*10)/10:null
      };
    }catch(e){
      return {
        name,
        source:'local',
        ok:false,
        error:e.message+(logs?': '+logs.slice(-600):''),
        startupMs:Date.now()-started,
        latencyMs:Date.now()-started
      };
    }finally{
      if(child){try{child.kill('SIGTERM')}catch{}}
    }
  };
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
  for(const name of localModels)results.push(await testLocal(name));
  for(const item of imported)results.push(await testImported(item));
  send(r,{ok:true,total:results.length,localTotal:localModels.length,importedTotal:imported.length,results,settings:{context,maxTokens,temperature,prompt}});
});
app.post('/api/models/launch',async(q,r)=>{const name=String(q.body.name||'');if(!name||path.basename(name)!==name||!name.toLowerCase().endsWith('.gguf'))return r.status(400).json({error:'GGUF required'});const model=safePath(modelsRoot,name);if(!(await fs.stat(model).catch(()=>null))?.isFile())return r.status(404).json({error:'Model not found'});const port=validLocalPort(q.body.port);if(port<1024||port>65535)return r.status(400).json({error:'Invalid port'});const c=spawn(process.env.LLAMA_BIN||'llama-server',['-m',model,'--host','127.0.0.1','--port',String(port),'-c',String(q.body.context||8192)],{cwd:root,detached:true,stdio:'ignore'});c.unref();send(r,{ok:true,pid:c.pid,baseUrl:'http://127.0.0.1:'+port+'/v1'})});
app.post('/api/agent',async(q,r)=>{const prompt=String(q.body.prompt||'').trim();const url=String(q.body.modelUrl||'http://127.0.0.1:8080/v1/chat/completions');const x=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:q.body.model||'local',messages:[{role:'system',content:'You are a professional autonomous coding agent. Work iteratively until verification passes. Return ONLY valid JSON: {"message":"...","actions":[{"type":"write","path":"relative/path","content":"complete file content"},{"type":"command","command":"safe command"}],"done":true}. You may inspect via command actions. After every execution result, use the feedback to fix errors. Never claim success without verification. Paths must stay inside the workspace.'},{role:'user',content:prompt}],temperature:.1,max_tokens:Number(q.body.maxTokens||4096)})});const d=await x.json();if(!x.ok)return r.status(x.status).json(d);send(r,{ok:true,text:d.choices?.[0]?.message?.content||JSON.stringify(d)})});
app.post('/api/agent/cancel/:runId',async(q,r)=>{const id=String(q.params.runId||'');const controller=agentRunControllers.get(id);if(!controller)return r.status(404).json({error:'Agent run not found'});controller.abort();agentRunControllers.delete(id);send(r,{ok:true,cancelled:true,runId:id})});
app.post('/api/agent/loop',async(q,r)=>{
  const prompt=String(q.body.prompt||'').trim();if(!prompt)return r.status(400).json({error:'prompt required'});const maxIterations=clamp(q.body.maxIterations,1,20,8);const temperature=clamp(q.body.temperature,0,2,.1);const maxTokens=clamp(q.body.maxTokens,256,12000,6000);const commandTimeout=safeTimeout(q.body.commandTimeout);const context=clamp(q.body.context,2048,131072,8192);const planOnly=Boolean(q.body.planOnly);const runId=String(q.get('x-agent-run-id')||'').trim();const controller=new AbortController();if(runId){agentRunControllers.set(runId,controller);setTimeout(()=>agentRunControllers.delete(runId),30*60*1000)}const checkpoint=await createCheckpoint('Agent run: '+prompt.slice(0,120)).catch(()=>null);
  const beforeSnapshot=await snapshotWorkspace();
  let modelUrl=String(q.body.modelUrl||'');
  let resolvedModel=String(q.body.model||'local');
  let providerKind='openai-compatible';
  if(q.body.modelType==='local'){
    const name=String(q.body.model||'');
    if(!name||path.basename(name)!==name||!name.toLowerCase().endsWith('.gguf'))return r.status(400).json({error:'Invalid local model'});
    const model=safePath(modelsRoot,name);
    if(!(await fs.stat(model).catch(()=>null))?.isFile())return r.status(404).json({error:'Local model not found: '+name});
    const port=validLocalPort(8080);
    const health='http://127.0.0.1:'+port+'/v1/models';
    try{const z=await fetch(health,{signal:AbortSignal.any([AbortSignal.timeout(1200),controller.signal])});if(!z.ok)throw Error('not ready')}catch{
      const child=spawn(process.env.LLAMA_BIN||'llama-server',['-m',model,'--host','127.0.0.1','--port',String(port),'-c',String(q.body.context||8192)],{cwd:root,detached:true,stdio:'ignore'});
      child.unref();
      const deadline=Date.now()+60000;let ready=false;
      while(Date.now()<deadline&&!controller.signal.aborted){try{const z=await fetch(health,{signal:AbortSignal.any([AbortSignal.timeout(1200),controller.signal])});if(z.ok){ready=true;break}}catch{}await new Promise(x=>setTimeout(x,400))}
      if(controller.signal.aborted)return r.status(499).json({error:'Agent run cancelled'});if(!ready)return r.status(504).json({error:'Local model startup timeout'});
    }
    modelUrl='http://127.0.0.1:'+port+'/v1/chat/completions';
    resolvedModel=name;
  }else if(q.body.modelType==='provider'){
    const providerId=String(q.body.providerId||'');
    const raw=JSON.parse(await fs.readFile(providersFile,'utf8').catch(()=>'{ }'));
    const providers=providerNormalize(raw);const p=providers[providerId];
    if(!p||!p.enabled)return r.status(404).json({error:'Provider not found or disabled'});
    const item=(p.models||[]).find(m=>typeof m==='string'?m===q.body.model:String(m.id||m.name)===q.body.model);
    const modelItem=typeof item==='string'?{id:item}:item;
    if(!modelItem)return r.status(404).json({error:'Provider model not found'});
    const key=modelItem.apiKey||p.apiKey||p.apiKeys?.[0]||'';
    let url=String(modelItem.url||p.url||'').replace(/\/$/,'');
    if(!url)throw Error('Provider URL is missing');
    if(/generativelanguage\.googleapis\.com|gemini/i.test((p.vendor||'')+' '+url)){
      if(!key)throw Error('Provider API key missing');
      providerKind='gemini';
      if(!url.includes(':generateContent'))url+='/models/'+encodeURIComponent(modelItem.id||q.body.model)+':generateContent';
      url+=(url.includes('?')?'&':'?')+'key='+encodeURIComponent(key);
    }else{
      if(!/\/(chat\/completions|responses|generate)$/i.test(url))url+=(url.endsWith('/v1')?'/chat/completions':'/v1/chat/completions');
    }
    q.body.model=q.body.model||modelItem.id;modelUrl=url;resolvedModel=String(q.body.model);
  }else if(!modelUrl)modelUrl='http://127.0.0.1:8080/v1/chat/completions';
  try{const u=new URL(modelUrl);if(!/^https?:$/.test(u.protocol))throw Error('Invalid model URL')}catch(e){return r.status(400).json({error:e.message})}const messages=[{role:'system',content:'You are an autonomous senior coding agent. Execute a feedback loop. Return ONLY valid JSON: {"message":"...","actions":[{"type":"write","path":"relative/path","content":"complete file content"},{"type":"command","command":"safe command"}],"done":false}. Use commands to inspect and test. After tool results, fix every error you can. Stop only when verification is clean or you need user input. Never claim a change was made unless its write action was executed. Never use paths outside workspace.'},{role:'user',content:prompt}];const history=[];for(let i=1;i<=maxIterations;i++){if(controller.signal.aborted)return r.status(499).json({error:'Agent run cancelled'});let x;try{x=await fetch(modelUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(providerKind==='gemini'?{systemInstruction:{parts:[{text:messages.filter(m=>m.role==='system').map(m=>m.content).join('\\n')}]} ,contents:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{temperature,maxOutputTokens:maxTokens}}:{model:resolvedModel,messages,temperature,max_tokens:maxTokens}),signal:controller.signal})}catch(e){if(controller.signal.aborted)return r.status(499).json({error:'Agent run cancelled'});throw e}const d=await x.json();if(!x.ok)return r.status(x.status).json({error:d});const raw=providerKind==='gemini'?(d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||''):((d.choices?.[0]?.message?.content||d.choices?.[0]?.text)||'');let plan;try{plan=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{messages.push({role:'user',content:'Your previous response was not valid JSON. Return only the required JSON object.'});history.push({iteration:i,error:'invalid JSON'});continue}const results=[];if(!plan||typeof plan!=='object'||!Array.isArray(plan.actions)){history.push({iteration:i,error:'invalid action plan'});messages.push({role:'user',content:'Return a JSON object with an actions array.'});continue}if(planOnly){history.push({iteration:i,message:plan.message,actions:plan.actions.slice(0,30).map(a=>({...a,preview:true})),verification:[],done:false,planOnly:true});return send(r,{ok:true,success:false,planOnly:true,iterations:i,history,changes:workspaceChanges(beforeSnapshot,await snapshotWorkspace()),message:'Plan generated; no workspace changes were executed.'})}for(const a of plan.actions.slice(0,30)){if(a.type==='write'){try{const p=safePath(root,String(a.path));await fs.mkdir(path.dirname(p),{recursive:true});const content=String(a.content??'');if(content.length>2*1024*1024)throw Error('File write exceeds 2 MB limit');await fs.writeFile(p,content);results.push({type:'write',path:a.path,ok:true})}catch(e){results.push({type:'write',path:a.path,ok:false,error:e.message})}}else if(a.type==='command'){const z=await runCommand(String(a.command||''),commandTimeout,controller.signal);results.push({type:'command',command:a.command,code:z.code,stdout:z.stdout,stderr:z.stderr})}}const verification=await verifyWorkspace();const clean=verification.every(x=>x.code===0);history.push({iteration:i,message:plan.message,actions:results,verification,done:Boolean(plan.done&&clean)});if(plan.done&&clean){const changes=workspaceChanges(beforeSnapshot,await snapshotWorkspace());if(runId)agentRunControllers.delete(runId);return send(r,{ok:true,success:true,iterations:i,history,changes,checkpoint});}messages.push({role:'assistant',content:JSON.stringify(plan)});messages.push({role:'user',content:JSON.stringify({executionResults:results,automaticVerification:verification,feedback:clean?'Verification is clean. If the requested work is complete, finish; otherwise continue.':'Verification has failures. Diagnose and fix them, then verify again.'})})}const changes=workspaceChanges(beforeSnapshot,await snapshotWorkspace());if(runId)agentRunControllers.delete(runId);send(r,{ok:true,success:false,iterations:maxIterations,history,changes,checkpoint,message:'Maximum iterations reached; review the latest verification results.'})});
app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'..','public','index.html'));next()});app.use((e,_,r,__)=>{console.error(e);if(r.headersSent)return __();r.status(e.status||500).json({error:e.message||'Internal server error'})});app.listen(port,host,()=>console.log('Local Coding Agent on '+host+':'+port));