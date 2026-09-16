export type AiProviderCatalog={
  catalogVersion?:number;
  providers?:Array<{id:string;name?:string;baseUrl?:string;apiKey?:string;models?:string[];reasoningModels?:string[];enabled?:boolean}>;
};

/**
 * Every model carrying the explicit “Text-to-text” capability on Mistral's
 * official API pricing page (reviewed 2026-08-20). Some of these models use a
 * dedicated endpoint; see MISTRAL_MODEL_ENDPOINTS rather than assuming chat.
 */
export const MISTRAL_TEXT_TO_TEXT_MODELS=[
  'mistral-medium-latest',
  'mistral-small-latest',
  'mistral-large-latest',
  'zai-glm-5-2',
  'mistral-ocr-latest',
  'voxtral-small-latest',
  'codestral-latest',
  'ministral-3b-latest',
  'ministral-8b-latest',
  'ministral-14b-latest',
  'mistral-embed'
] as const;


export type DefaultAiProviderPreset={id:string;name:string;vendor?:string;baseUrl:string;apiKey:string;models:string[];reasoningModels:string[];enabled:boolean};
export const DEFAULT_OPENROUTER_MODELS=[
  'bytedance-seed/seed-2-1-turbo',
  'qwen/qwen3.8-2.4t-a95b',
  'bytedance-seed/seed-2.0-code',
  'deepseek/deepseek-v4-pro-0813',
  'x-ai/grok-4.6',
  'liquid/lfm-2.5-2.6b:free',
  'sakana/sakana-namazu',
  'upstage/solar-pro4',
  'meta/muse-glimmer-30b',
  'meta/muse-spark-1.2'
] as const;
export const OPENROUTER_NON_CHAT_MODELS=[
  'nvidia/nemotron-3.5-lightning',
  'nvidia/nemotron-3.5-lightning:free'
] as const;
export const DEFAULT_AI_PROVIDER_PRESETS:DefaultAiProviderPreset[]=[
  {id:'ollama',name:'Ollama',vendor:'ollama-models',baseUrl:'http://127.0.0.1:11434',apiKey:'',models:[],reasoningModels:[],enabled:false},
  {id:'openrouter',name:'OpenRouter',vendor:'openrouter',baseUrl:'https://openrouter.ai/api/v1',apiKey:'',models:[...DEFAULT_OPENROUTER_MODELS,...OPENROUTER_NON_CHAT_MODELS],reasoningModels:['qwen/qwen3.8-2.4t-a95b','deepseek/deepseek-v4-pro-0813','x-ai/grok-4.6','liquid/lfm-2.5-2.6b:free','nvidia/nemotron-3.5-lightning','nvidia/nemotron-3.5-lightning:free'],enabled:false}
];

export const MISTRAL_MODEL_ENDPOINTS:Record<string,'chat-completions'|'ocr'|'embeddings'>={
  'mistral-ocr-latest':'ocr',
  'mistral-embed':'embeddings'
};

/** The previous one-time catalog is kept as migration history. */
export const MISTRAL_CATALOG_V1_MODELS=[
  'mistral-medium-latest',
  'mistral-small-latest',
  'mistral-large-latest',
  'zai-glm-5-2',
  'voxtral-small-latest',
  'codestral-latest',
  'labs-leanstral-2603',
  'ministral-3b-latest',
  'ministral-8b-latest',
  'ministral-14b-latest'
] as const;

export const MISTRAL_CATALOG_VERSION=4;
const MISTRAL_CATALOG_V2_ADDITIONS=['mistral-ocr-latest','mistral-embed'] as const;
/** Leanstral 2603 retired 2026-06-30; replaced by the free Labs model labs-leanstral-1-5. */
export const MISTRAL_CATALOG_V3_ADDITIONS=['labs-leanstral-1-5'] as const;

function mistralProvider(ai:AiProviderCatalog){return ai.providers?.find(provider=>provider.id==='mistral'||/api\.mistral\.ai/i.test(String(provider.baseUrl||'')))}
function modelId(value:any):string{return typeof value==='string'?value:String(value?.id||value?.name||'')}
function appendModels(provider:NonNullable<AiProviderCatalog['providers']>[number],models:readonly any[]){provider.models=[...new Set([...(Array.isArray(provider.models)?provider.models.map(modelId).filter(Boolean):[]),...models.map(modelId).filter(Boolean)])]}

/**
 * Applies each catalog revision exactly once. Existing names, keys, URLs,
 * enabled flags, custom models, candidates and master choices are untouched;
 * a model deleted after a completed revision is therefore not re-added.
 */
export function upgradeAiProviderCatalog(ai:AiProviderCatalog):boolean{
  ai.providers=Array.isArray(ai.providers)?ai.providers:[];
  let version=Math.max(0,Math.trunc(Number(ai.catalogVersion)||0)),changed=false,provider=mistralProvider(ai);
  if(!provider){
    provider={id:'mistral',name:'Mistral AI',baseUrl:'https://api.mistral.ai/v1',apiKey:'',models:[],reasoningModels:[],enabled:false};
    ai.providers.push(provider);changed=true;
  }
  if(version<1){appendModels(provider,MISTRAL_CATALOG_V1_MODELS);version=1;changed=true}
  if(version<2){appendModels(provider,MISTRAL_CATALOG_V2_ADDITIONS);version=2;changed=true}
  if(version<3){appendModels(provider,MISTRAL_CATALOG_V3_ADDITIONS);version=3;changed=true}
  if(version<4){
    for(const preset of DEFAULT_AI_PROVIDER_PRESETS){
      let existing=ai.providers.find(item=>item.id===preset.id||String(item.name||'').toLowerCase()===preset.name.toLowerCase());
      if(!existing){existing={id:preset.id,name:preset.name,baseUrl:preset.baseUrl,apiKey:'',models:[],reasoningModels:[],enabled:false};ai.providers.push(existing);changed=true}
      if(!existing.baseUrl)existing.baseUrl=preset.baseUrl;
      appendModels(existing,preset.models);
      existing.reasoningModels=[...new Set([...(Array.isArray(existing.reasoningModels)?existing.reasoningModels:[]),...preset.reasoningModels].filter(model=>existing!.models?.includes(model)))];
    }
    version=4;changed=true;
  }
  if(ai.catalogVersion!==version){ai.catalogVersion=version;changed=true}
  return changed;
}

// ─── Tool-calling models (each entry is verified to support function/tool calling) ──
// Kept here (not in agent.ts) so both runtimes share the chat-models toolCalling flags.
// ─── Tool-calling models (each entry is verified to support function/tool calling) ──
export type AgentToolModel={id:string;name:string;vendor:string;free:boolean;toolCalling:boolean;note:string};
export const AGENT_TOOL_MODELS:AgentToolModel[]=[
  // Cloudflare Workers AI — function-calling models (verified against the official
  // Workers AI catalog, Aug 2026). All run on the free tier's daily neuron quota.
  {id:'@cf/meta/llama-4-scout-17b-16e-instruct',name:'Llama 4 Scout 17B 16E Instruct',vendor:'Meta — Workers AI',free:true,toolCalling:true,note:'فراخوانی ابزار + vision؛ مدل پین‌شدهٔ کاتالوگ Workers AI. در سهمیهٔ رایگان روزانه در دسترس است.'},
  {id:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',name:'Llama 3.3 70B Instruct (FP8 Fast)',vendor:'Meta — Workers AI',free:true,toolCalling:true,note:'فراخوانی ابزار رسمی؛ دقت بالا برای تحلیل‌های پیچیده.'},
  {id:'@cf/qwen/qwen3.8-27b',name:'Qwen 3.8 27B',vendor:'Alibaba — Workers AI',free:true,toolCalling:true,note:'فراخوانی ابزار + استدلال + vision؛ پنجرهٔ ۲۶۲K توکن. (جایگزین Qwen2.5-Coder)'},
  {id:'@cf/openai/gpt-oss-120b',name:'GPT-OSS 120B',vendor:'OpenAI — Workers AI',free:true,toolCalling:true,note:'مدل متن‌باز OpenAI با فراخوانی ابزار و استدلال؛ پنجرهٔ ۱۲۸K.'},
  {id:'@cf/deepseek-ai/deepseek-v4-flash-0731',name:'DeepSeek V4 Flash 0731',vendor:'DeepSeek — Workers AI',free:true,toolCalling:true,note:'استدلالی + فراخوانی ابزار؛ پنجرهٔ ۱M توکن.'},
  {id:'@cf/deepseek-ai/deepseek-v4-pro-0813',name:'DeepSeek V4 Pro 0813',vendor:'DeepSeek — Workers AI',free:true,toolCalling:true,note:'نسخهٔ قوی‌تر V4 برای کارهای چندمرحله‌ای؛ پنجرهٔ ۱M توکن.'},
  {id:'@cf/zai-org/glm-5.2',name:'GLM-5.2',vendor:'Z.ai — Workers AI',free:true,toolCalling:true,note:'مدل عامل‌محور Z.ai با فراخوانی ابزار و استدلال برای کدنویسی.'},
  {id:'@cf/moonshotai/kimi-k2.7-code',name:'Kimi K2.7 Code',vendor:'Moonshot AI — Workers AI',free:true,toolCalling:true,note:'۱T پارامتر؛ فراخوانی ابزار چندنوبته + استدلال + vision؛ پنجرهٔ ۲۶۲K.'},
  {id:'@cf/moonshotai/kimi-k2.6',name:'Kimi K2.6',vendor:'Moonshot AI — Workers AI',free:true,toolCalling:true,note:'نسل قبلی K2.6 با فراخوانی ابزار و استدلال.'},
  {id:'Prism-ML/Ternary-Bonsai-27B',name:'Prism Ternary Bonsai 27B',vendor:'PrismML — Together AI',free:true,toolCalling:true,note:'رایگان روی Together AI (api.together.xyz/v1)؛ مدل استدلالی با فراخوانی ابزار. برای استفاده، یک ارائه‌دهنده با Base URL «https://api.together.xyz/v1» بسازید و همین شناسه را به مدل‌هایش اضافه کنید.'},
  {id:'labs-leanstral-1-5',name:'Leanstral 1.5 (119B)',vendor:'Mistral AI (Labs — رایگان)',free:true,toolCalling:true,note:'جایگزین Leanstral 2603 (بازنشسته). رایگان روی Labs مایسترال با فراخوانی ابزار و استدلال؛ شناسهٔ API: labs-leanstral-1-5.'},
  {id:'*configured',name:'مدل‌های ارائه‌دهنده‌های تنظیم‌شده',vendor:'OpenAI-compatible (GPT، DeepSeek، Qwen و…)',free:false,toolCalling:false,note:'از مدل‌های ذخیره‌شدهٔ خودتان انتخاب کنید؛ مدل باید فراخوانی ابزار (tool calling) پشتیبانی کند.'}
];

// ─── Pure model helpers shared by both runtimes ─────────────────────────────
// Chat compatibility, reasoning detection and key-suffix parsing live here (not
// in worker-src/ai.ts) so the Node runtime single-sources the same behavior.
export function isOpenRouter(provider:{id:string;name?:string;baseUrl?:string},endpoint=''){return provider.id==='openrouter'||/openrouter/i.test(String(provider.name||''))||/openrouter\.ai/i.test(String(provider.baseUrl||endpoint||''))}
/** Parses an optional trailing `::k<n>` suffix from a model reference. */
export function parseModelKeySuffix(raw:string):{model:string;keyIndex:number}{const match=String(raw||'').match(/^(.*?)::k(\d+)$/);return match?{model:match[1],keyIndex:Math.max(0,Number(match[2])-1)}:{model:String(raw||''),keyIndex:0}}
/** Explicit user flags win first; the fallback covers common reasoning families already saved before this setting existed. */
export function isReasoningAiModel(provider:{reasoningModels?:string[]}|undefined,model:string):boolean{
  if(provider?.reasoningModels?.includes(model))return true;
  const value=String(model||'').toLowerCase();
  return /(?:^|[\/_:.-])(?:deepseek[-_.]?(?:r1|v4)|qwq|qwen3|gpt[-_.]?oss|gpt[-_.]?5|o[1-5](?:[-_.]|$)|reason(?:ing|er)?|thinking|think|magistral|leanstral|kimi[-_.]?k2|glm[-_.]?[45]|nemotron|reflection|bonsai|liquid)(?:[\/_:.-]|$)/i.test(value)||/cohere[^/]*reason/i.test(value);
}
export type AiModelEndpoint='chat-completions'|'ocr'|'embeddings';
export type AiEndpointProvider={id:string;name?:string;baseUrl?:string;nonChatModels?:string[]};
function isMistralProvider(provider:AiEndpointProvider):boolean{return provider.id==='mistral'||/api\.mistral\.ai/i.test(String(provider.baseUrl||''))}
export function aiModelEndpoint(provider:AiEndpointProvider,model:string):AiModelEndpoint{return isMistralProvider(provider)?MISTRAL_MODEL_ENDPOINTS[model]||'chat-completions':'chat-completions'}
export function isChatCompatibleAiModel(provider:AiEndpointProvider,model:string):boolean{if(provider.nonChatModels?.includes(model))return false;if(isOpenRouter(provider)&&OPENROUTER_NON_CHAT_MODELS.includes(model as any))return false;return aiModelEndpoint(provider,model)==='chat-completions'}
