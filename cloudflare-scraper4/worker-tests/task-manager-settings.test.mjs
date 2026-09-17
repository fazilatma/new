import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
async function compile(text,names,io={}){const js=(await transform(text,{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names.join(',')+'};')(...Object.values(io))}
const helpers=await compile(source.slice(source.indexOf('function mInput('),source.indexOf('function mMasterCombo(')),['mInput','mCheck','mButton']);
const a=source.indexOf('function activitySettingsHtml('),b=source.indexOf('function openActivityManager(',a),nestedGet=(o,path)=>path.split('.').reduce((x,k)=>x?.[k],o);
async function settingsUI(extra={}){return compile(source.slice(a,b),['activitySettingsHtml','hydrateActivitySettings'],{...helpers,BSET:key=>['data-setting',key],nestedGet,state:{settings:{general:{maxConcurrentProfiles:4},watchdog:{enabled:false}}},autoSaveDrafts:new Map(),autoSaveInFlightDraft:null,...extra})}
test('task settings are native collapsible details and start closed on every opening',async()=>{
 const ui=await settingsUI();
 for(let i=0;i<2;i++){
  const {document}=parseHTML(ui.activitySettingsHtml()),panel=document.querySelector('#activitySettings');
  assert.equal(panel.tagName,'DETAILS');assert.equal(panel.hasAttribute('open'),false);
  assert.equal(panel.firstElementChild.tagName,'SUMMARY');assert.match(panel.firstElementChild.textContent,/تنظیمات اجرای وظایف/);
  assert.equal(panel.querySelector('details').hasAttribute('open'),false);
  panel.setAttribute('open','');ui.hydrateActivitySettings(document);
  assert.equal(panel.hasAttribute('open'),true);assert.equal(panel.querySelector('#maxConcurrentProfiles').value,'4');
 }
});
test('queue, concurrency and AI/watchdog settings live in Task Manager, not duplicate sidebar forms',async()=>{
 const ui=await settingsUI(),html=ui.activitySettingsHtml(),{document}=parseHTML('<main>'+html+'</main>');ui.hydrateActivitySettings(document);
 assert.equal(document.querySelector('#maxConcurrentProfiles').value,'4');assert.equal(document.querySelector('#stallWatchdog').checked,false);
 for(const id of ['qDedup','maxConcurrentProfiles','aiStageTimeoutSeconds','aiStageFailureLimit','qDedupStale','cronLockMin','keepReports','stallWatchdog','autoContinueJobs','stallAfter','detailBudget','proxyTimeout'])assert.equal(document.querySelectorAll('#'+id).length,1,id);
 const general=source.slice(source.indexOf("['⚙️ تنظیمات عمومی'"),source.indexOf("['🌐 اتصال به سایت مبدأ'"));
 assert.doesNotMatch(general,/BSET\('general.maxConcurrentProfiles'\)|BSET\('watchdog.enabled'\)/);assert.match(general,/task-manager/);
});
test('reopening Task Manager prefers pending and in-flight settings over an old response',async()=>{
 const drafts=new Map(),ui=await settingsUI({autoSaveDrafts:drafts,autoSaveInFlightDraft:{kind:'settings',body:{general:{maxConcurrentProfiles:5}}}}),{document}=parseHTML(ui.activitySettingsHtml());
 ui.hydrateActivitySettings(document);assert.equal(document.querySelector('#maxConcurrentProfiles').value,'5');drafts.set('settings',{body:{general:{maxConcurrentProfiles:7}}});ui.hydrateActivitySettings(document);assert.equal(document.querySelector('#maxConcurrentProfiles').value,'7');
});
test('live activity refreshes do not replace controls or reset edited settings',async()=>{
 const ui=await settingsUI(),{document}=parseHTML('<main>'+ui.activitySettingsHtml()+'<div id="activityBody"></div></main>'),input=document.querySelector('#maxConcurrentProfiles');input.value='6';document.querySelector('#activitySettings').scrollTop=80;
 const a=source.indexOf('function renderActivity(d)'),b=source.indexOf('\n}\n',a)+2;
 const {renderActivity}=await compile(source.slice(a,b),['renderActivity'],{$:id=>document.getElementById(id),activityDragging:false,localTasks:new Map(),mergeActivityRuns:(local,remote)=>[...local,...remote],renderQuotaBar:()=>'<div id="testQuota">quota</div>',d1QuotaHtml:()=>{throw Error('do not duplicate quota summaries')},fa:String,esc:String});
 const panel=document.querySelector('#activitySettings');renderActivity({counts:{}});assert.equal(panel.hasAttribute('open'),false);panel.setAttribute('open','');renderActivity({counts:{jobs:3}});assert.equal(panel.hasAttribute('open'),true);panel.removeAttribute('open');renderActivity({counts:{}});assert.equal(panel.hasAttribute('open'),false);assert.equal(document.querySelector('#maxConcurrentProfiles'),input);assert.equal(input.value,'6');assert.equal(document.querySelectorAll('#testQuota').length,1);assert.equal(document.querySelector('#activitySettings').scrollTop,80);
});
test('Task Manager bindings autosave while preserving settings from unmounted panels',async()=>{
 const ui=await settingsUI(),{window}=parseHTML('<main><span id="autoSaveState"></span>'+ui.activitySettingsHtml()+'</main>'),$=id=>window.document.getElementById(id),state={connected:true,profiles:[],settings:{appearance:{font:'vazir'},general:{maxConcurrentProfiles:2}},connections:{}},sent=[];
 const nestedSet=(o,path,v)=>{const keys=path.split('.'),last=keys.pop();for(const k of keys)o=o[k]||=( {});o[last]=v};
 const a=source.indexOf('let autoSaveTimer='),b=source.indexOf('async function saveConnections(',a);
 const autosave=await compile(source.slice(a,b),['initAutoSave','scheduleAutoSave','flushAutoSave'],{document:window.document,window,$,state,nestedSet,api:async(path,options)=>{sent.push({path,body:JSON.parse(options.body)});return{ok:true}}});
 autosave.initAutoSave();$('maxConcurrentProfiles').value='6';autosave.scheduleAutoSave('settings',true);await autosave.flushAutoSave();assert.equal(sent.length,1);assert.equal(sent[0].path,'/api/settings');assert.equal(sent[0].body.general.maxConcurrentProfiles,6);assert.equal(sent[0].body.appearance.font,'vazir');assert.match($('activitySettingsStatus').textContent,/ذخیره و اعمال/);
});
