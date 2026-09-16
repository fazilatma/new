import { monitored } from '../worker-src/activity-monitor.js';
import { deleteState } from './db.js';
import { scheduledBranchPushTick as rawscheduledBranchPushTick } from '../worker-src/branch-backup.js';
import { CATEGORY_FIX_LAST_KEY, categoryFixTick } from '../worker-src/destination-core.js';
import { AI_ENRICH_LAST_KEY, aiEnrichTick as rawaiEnrichTick } from '../worker-src/ai-enrich.js';
import { startCategoryRun } from './category-run.js';
import { assertConfig } from './config.js';
import { automationTick as rawautomationTick } from './automation.js';
import { enqueueDueProfiles, getProfile, getState, listProfiles, listStalestProducts, migrate, pool, setState, snapshotSqliteDatabase, upsertProduct } from './db.js';
import { githubApiFetch, githubApiPut } from './github-client.js';
import { destinationCategories } from './maintenance.js';
import { createPhpSettingsBundle } from './settings-transfer.js';
import { generateProductDescription, preferredAiChatModel } from './ai.js';

assertConfig();
await migrate();
await scheduledBranchPushTick({settings:await getState<any>('settings',{}),envToken:process.env.GH_BACKUP_TOKEN,loadLast:()=>getState<any>('branch_push_last',null),saveLast:rec=>setState('branch_push_last',rec),buildBundle:()=>createPhpSettingsBundle(),connect:token=>({getter:githubApiFetch(token),putter:githubApiPut(token)}),snapshotDatabase:async()=>{const snap=await snapshotSqliteDatabase().catch(()=>({skipped:'unavailable'}));return 'b64' in snap?{b64:(snap as {b64:string}).b64}:{skipped:'unavailable'}},log:m=>console.log('[scheduled-push]',m)});
await categoryFixTick({settings:await getState<any>('settings',{}),loadLast:()=>getState<any>(CATEGORY_FIX_LAST_KEY,null),saveLast:rec=>setState(CATEGORY_FIX_LAST_KEY,rec),start:input=>startCategoryRun(input),log:m=>console.log('[category-fix]',m)});
await aiEnrichTick({enabled:async()=>(await getState<any>('ai_description_settings',{enabled:true}))?.enabled!==false,modelReady:async()=>Boolean(await preferredAiChatModel()),listProfileIds:async()=>(await listProfiles()).map(p=>p.id),profileEnabled:async id=>(await getProfile(id))?.aiDescriptions!==false,loadCursor:()=>getState<any>(AI_ENRICH_LAST_KEY,null),saveCursor:rec=>setState(AI_ENRICH_LAST_KEY,rec),listStalest:(profileId,limit)=>listStalestProducts(profileId,limit),categories:async()=>{try{return(await destinationCategories()).items}catch{return[]}},enrich:(product,cats)=>generateProductDescription(product,{categories:cats}),saveProduct:(profileId,product)=>upsertProduct(profileId,product as any),log:m=>console.log('[ai-enrich]',m)});
const count=await enqueueDueProfiles(),automation=await automationTick();
console.log(JSON.stringify({ok:true,enqueued:count,automation,at:new Date().toISOString()}));
await pool.end();
function automationTick(...args:Parameters<typeof rawautomationTick>):ReturnType<typeof rawautomationTick>{return monitored({setState,deleteState},'پاسخ خودکار و گزارش دوره‌ای',()=>rawautomationTick(...args))}
function aiEnrichTick(...args:Parameters<typeof rawaiEnrichTick>):ReturnType<typeof rawaiEnrichTick>{return monitored({setState,deleteState},'تکمیل دوره‌ای محتوای محصولات با هوش مصنوعی',()=>rawaiEnrichTick(...args))}
function scheduledBranchPushTick(...args:Parameters<typeof rawscheduledBranchPushTick>):ReturnType<typeof rawscheduledBranchPushTick>{return monitored({setState,deleteState},'پشتیبان‌گیری دوره‌ای شاخه',()=>rawscheduledBranchPushTick(...args))}
