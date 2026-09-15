import { deleteState, getRunPriorities, getState, getTriedBasalamCategories, markBasalamCategoriesTried, setState } from './db.js';
import { isWriteQuotaError } from './utils.js';
import { normalizeCategoryMode, selectCategoryModels } from './destination-core.js';
import { getEnv } from './env.js';
import { getLastAiTestResults, isChatCompatibleAiModel, isRetryableAiResult, nextAiTestBatch, suggestCategoryWithModel, testModelBatch } from './ai.js';
import { loadConnections } from './connections.js';
import { applyBasalamCategory, destinationCatalog, destinationCategories, destinationChangeStatus } from './maintenance.js';
import { buildDedupGroups, normalizeDedupKeep, parseSuffixFormats, type DedupCandidate, type DedupGroup, type DedupKeep } from './dedup.js';
import { currentAgentRun, processAgentRunMessage, recoverAgentRun } from './agent.js';
import type { BackgroundMessage } from './types.js';

export type BackgroundOutcome={outcome:'complete'|'continue'|'ignored';delaySeconds?:number};
type RunStatus='queued'|'running'|'paused'|'done'|'failed';
type BaseRun={id:string;kind:'ai-test'|'category-all'|'dedup';status:RunStatus;phase:string;stopRequested:boolean;createdAt:string;updatedAt:string;startedAt:string|null;finishedAt:string|null;attempts:number;error:string|null};
type AiTestRun=BaseRun&{kind:'ai-test';prompt:string;categoryTitle:string;onlyCandidates:boolean;delayMs:number;cursor:number;result:any;skipNext?:boolean;currentStartedAt?:string|null;currentKey?:string|null;retryJobs?:{key:string;left:number}[]};
type CategoryProduct={id:number;shopId:string;title:string;categoryId?:number};
type CategoryRunItem={id:number;shopId:string;title:string;ok:boolean;categoryId?:number;categoryName?:string;source?:string;confidence?:number;error?:string};
type CategoryRun=BaseRun&{kind:'category-all';modelKeys:string[];mode:string;page:number;totalPages:number;products:CategoryProduct[];cursor:number;total:number;processed:number;changed:number;failed:number;items:CategoryRunItem[]};
type DedupTarget='woo'|'basalam';
type DedupItemLog={id:number;shopId:string;name:string;ok:boolean;action:string;error?:string};
type DedupRun=BaseRun&{kind:'dedup';target:DedupTarget;keep:DedupKeep;suffixFormats:string[];apply:boolean;page:number;totalPages:number;listingDone:boolean;grouped:boolean;products:DedupCandidate[];groups:DedupGroup[];groupCursor:number;removeCursor:number;scanned:number;groupsFound:number;duplicates:number;removed:number;failed:number;items:DedupItemLog[]};
export type BackgroundRun=AiTestRun|CategoryRun|DedupRun;

const pointerKey=(kind:BackgroundRun['kind'])=>`background_current:${kind}`;
const runKey=(kind:BackgroundRun['kind'],id:string)=>`background_run:${kind}:${id}`;
const leaseKey=(kind:BackgroundRun['kind'],id:string)=>`background_lease:${kind}:${id}`;
const now=()=>new Date().toISOString();
const active=(run:BackgroundRun|null)=>Boolean(run&&['queued','running','paused'].includes(run.status));
/** If a run shows no progress for this long, skip the current model and continue. */
const STALL_MS=45_000;
/** Lease must expire sooner than STALL so a dead isolate cannot block the watchdog. */
const DEFAULT_SKIP_TIMEOUT_MS=30_000;
export function aiSkipTimeoutMs(settings:any):number{
  const fromSettings=Number(settings?.ai?.skipTimeoutMs),fromEnv=Number(getEnv().AI_TEST_TIMEOUT_MS);
  const raw=Number.isFinite(fromSettings)&&fromSettings>0?fromSettings:Number.isFinite(fromEnv)&&fromEnv>0?fromEnv:DEFAULT_SKIP_TIMEOUT_MS;
  return Math.max(50,Math.min(60_000,Math.trunc(raw)));
}
const runAge=(run:BackgroundRun)=>Date.now()-(Date.parse(run.updatedAt||run.createdAt)||Date.now());
