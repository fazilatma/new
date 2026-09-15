import { scheduledBranchPushTick } from '../worker-src/branch-backup.js';
import { assertConfig } from './config.js';
import { automationTick } from './automation.js';
import { enqueueDueProfiles, getState, migrate, pool, setState } from './db.js';
import { githubApiFetch, githubApiPut } from './github-client.js';
import { createPhpSettingsBundle } from './settings-transfer.js';

assertConfig();
await migrate();
await scheduledBranchPushTick({settings:await getState<any>('settings',{}),envToken:process.env.GH_BACKUP_TOKEN,loadLast:()=>getState<any>('branch_push_last',null),saveLast:rec=>setState('branch_push_last',rec),buildBundle:()=>createPhpSettingsBundle(),connect:token=>({getter:githubApiFetch(token),putter:githubApiPut(token)}),log:m=>console.log('[scheduled-push]',m)});
const count=await enqueueDueProfiles(),automation=await automationTick();
console.log(JSON.stringify({ok:true,enqueued:count,automation,at:new Date().toISOString()}));
await pool.end();
