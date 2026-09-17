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
