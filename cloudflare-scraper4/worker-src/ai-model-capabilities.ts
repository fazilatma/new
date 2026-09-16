/**
 * Runtime-agnostic AI provider/model helpers — the single source of truth for
 * what a model *is* (endpoint family, chat compatibility, reasoning flag, key
 * selection) and for the URL shape a call needs.
 *
 * Both twins used to grow these rules separately: `worker-src/ai.ts` had the
 * full set, `render-src/ai.ts` had a hand-written subset. That is why the shared
 * dashboard showed an empty model list and wrong endpoints on Termux / Linux /
 * Render / local installs while the Cloudflare Worker was fine — the Node twin
 * could not tell chat models from OCR models, never expanded extra API keys, and
 * built Ollama URLs without the `/v1` segment the Worker adds.
 *
 * Nothing here touches D1, the vault, Cloudflare bindings or the network; the two
 * `aiProviders()` implementations feed their provider rows in here and get
 * byte-identical answers.
 */
import { MISTRAL_MODEL_ENDPOINTS, OPENROUTER_NON_CHAT_MODELS } from './ai-catalog.js';

export type CfAccountKey = { accountId: string; token: string };
/** The minimum every capability helper needs; both twins' `Provider` satisfy it. */
export type AiCapableProvider={id:string;name?:string;baseUrl?:string;apiKey?:string;apiKeys?:Array<string|CfAccountKey>;models?:string[];reasoningModels?:string[];nonChatModels?:string[];enabled?:boolean};
export type AiModelEndpoint = 'chat-completions' | 'ocr' | 'embeddings';

/** Some saved guides hold a markdown link `[label](url)` instead of the bare URL. */
export function unmarkdownUrl(raw: string): string {
  const value = String(raw || '').trim(), match = value.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  return match?.[1] || value;
}
export function isCloudflareNative(raw: string): boolean { return /\/accounts\/[^/]+\/ai\/run(?:\/|$)/i.test(unmarkdownUrl(raw)); }
export function cloudflareAccountId(raw: string): string { return unmarkdownUrl(raw).match(/\/accounts\/([^/]+)\/ai\/run(?:\/|$)/i)?.[1] || ''; }

/**
 * Chat-completions endpoint for any OpenAI-compatible base URL.
 *
 * The `/v1` insertion for `:11434` matters on the local runtimes: Ollama answers
 * `/api/chat`, and its OpenAI-compatible surface lives under `/v1/chat/completions`.
 * A user who pastes `http://127.0.0.1:11434` (the address Termux/VPS setups use)
 * must not get a 404 from a bare `/chat/completions` call.
 */
export function openAiEndpoint(raw: string): string {
  const value = unmarkdownUrl(raw), url = new URL(value);
  if (/\/chat\/completions\/?$/i.test(url.pathname)) return url.toString();
  if (url.port === '11434' && !/\/v1\/?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/$/, '') + '/v1';
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  return url.toString();
}

/** Active API keys of a provider (fallback to the single apiKey), flattened to tokens. */
export function providerKeys(provider: AiCapableProvider): string[] {
  const keys = Array.isArray(provider.apiKeys) && provider.apiKeys.length ? provider.apiKeys : (provider.apiKey ? [provider.apiKey] : []);
  return keys.filter((k: any) => k && (typeof k === 'string' ? String(k).trim() : String((k as CfAccountKey).token || '').trim())).map((k: any) => (typeof k === 'string' ? k : (k as CfAccountKey).token || ''));
}
/** Clone of the provider bound to the n-th key (falls back to the first key). */
export function providerWithKey<T extends AiCapableProvider>(provider: T, index = 0): T {
  const raw = Array.isArray(provider.apiKeys) && provider.apiKeys.length ? provider.apiKeys : (provider.apiKey ? [provider.apiKey] : []);
  const chosen: any = raw[index] ?? raw[0] ?? (provider.apiKey || '');
  if (typeof chosen === 'string') return { ...provider, apiKey: chosen };
  const account=(chosen as CfAccountKey).accountId||cloudflareAccountId(String(provider.baseUrl||''));
  const token = (chosen as CfAccountKey).token || provider.apiKey || '';
  return { ...provider, apiKey: token, baseUrl: account ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/` : provider.baseUrl };
}
/** Parses an optional trailing `::k<n>` suffix from a model reference. */
export function parseModelKeySuffix(raw: string): { model: string; keyIndex: number } {
  const match = String(raw || '').match(/^(.*?)::k(\d+)$/);
  return match ? { model: match[1], keyIndex: Math.max(0, Number(match[2]) - 1) } : { model: String(raw || ''), keyIndex: 0 };
}
/** Display suffix for non-primary keys, e.g. index 1 -> ' [K۲]'. */
export function aiKeySuffixLabel(index:number):string{return index>0?' [K'+String(index+1).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)])+']':''}

/** Explicit user flags win first; the fallback covers common reasoning families already saved before this setting existed. */
export function isReasoningAiModel(provider: Partial<Pick<AiCapableProvider, 'reasoningModels'>> | undefined, model: string): boolean {
  if (provider?.reasoningModels?.includes(model)) return true;
  const value = String(model || '').toLowerCase();
  return /(?:^|[\/_:.-])(?:deepseek[-_.]?(?:r1|v4)|qwq|qwen3|gpt[-_.]?oss|gpt[-_.]?5|o[1-5](?:[-_.]|$)|reason(?:ing|er)?|thinking|think|magistral|leanstral|kimi[-_.]?k2|glm[-_.]?[45]|nemotron|reflection|bonsai|liquid)(?:[\/_:.-]|$)/i.test(value) || /cohere[^/]*reason/i.test(value);
}

function isMistralProvider(provider: Pick<AiCapableProvider, 'id'> & Partial<Pick<AiCapableProvider, 'baseUrl'>>): boolean { return provider.id === 'mistral' || /api\.mistral\.ai/i.test(String(provider.baseUrl || '')); }
export function isOpenRouter(provider: Pick<AiCapableProvider, 'id'> & Partial<Pick<AiCapableProvider, 'name' | 'baseUrl'>>, endpoint = ''): boolean { return provider.id === 'openrouter' || /openrouter/i.test(String(provider.name || '')) || /openrouter\.ai/i.test(String(provider.baseUrl || endpoint || '')); }
export function aiModelEndpoint(provider: Pick<AiCapableProvider, 'id'> & Partial<Pick<AiCapableProvider, 'baseUrl' | 'nonChatModels'>>, model: string): AiModelEndpoint { return isMistralProvider(provider) ? MISTRAL_MODEL_ENDPOINTS[model] || 'chat-completions' : 'chat-completions'; }
export function isChatCompatibleAiModel(provider: Pick<AiCapableProvider, 'id'> & Partial<Pick<AiCapableProvider, 'baseUrl' | 'nonChatModels'>>, model: string): boolean { if(provider.nonChatModels?.includes(model))return false;if(isOpenRouter(provider)&&(OPENROUTER_NON_CHAT_MODELS as readonly string[]).includes(model))return false;return aiModelEndpoint(provider,model)==='chat-completions' }
/** Models a user typed with a `~` preview prefix still need the bare id on the wire. */
export function canonicalAiModel(model: string): string { return String(model || '').trim().replace(/^~+/, ''); }

/* ---------------------- payload adaptation (shared by both twins) ---------------------- */
/** Credit/balance failures must never trigger payload rewriting — see isPayloadShapeError. */
export function isCreditAiText(value: string) { return /(?:^|\b)(?:402|insufficient[_.\s-]?quota|insufficient[_.\s-]?credit|credit[_.\s-]?balance|payment[_.\s-]?required|billing|out of credits|no credits|موجودی اعتبار|اعتبار.*تمام|شارژ.*تمام)(?:\b|$)/i.test(String(value || '')) && !/(?:429|rate.?limit)/i.test(String(value || '')); }
export function isCreditAiStatus(status: number, message: string) { return status === 402 || isCreditAiText(`${status} ${message}`); }
export function isBatchOnlyError(status: number, message: string) { return (status === 404 || status === 400 || status === 403) && /batch api|\/api\/beta\/batches/i.test(message); }
export function isPayloadShapeError(status: number, message: string) { return (status === 400 || status === 422) && !isCreditAiText(message) && !isBatchOnlyError(status, message); }
/**
 * Providers disagree on token-limit field names and on whether `temperature` is
 * legal at all. Local runtimes (Ollama, llama.cpp, vLLM — the usual Termux and
 * self-hosted-Linux AI servers) are the loudest about it, so the rewrite is part
 * of the shared rules instead of Worker-only, and a model that answers on the
 * Worker no longer fails on the Node twin for a field-name reason.
 */
export function adjustChatPayload(payload: any, errorText: string): any | null {
  const msg = String(errorText || ''), next = { ...payload }; let changed = false;
  if (/temperature/i.test(msg) && 'temperature' in next) { delete next.temperature; changed = true; }
  if (/max_completion_tokens/i.test(msg) && next.max_tokens != null) { next.max_completion_tokens = next.max_tokens; delete next.max_tokens; changed = true; }
  else if (/max_tokens/i.test(msg) && next.max_completion_tokens != null) { next.max_tokens = next.max_completion_tokens; delete next.max_completion_tokens; changed = true; }
  else if (/max_tokens|max_completion_tokens/i.test(msg) && next.max_tokens != null) { next.max_completion_tokens = next.max_tokens; delete next.max_tokens; changed = true; }
  if (!changed && /unsupported (?:parameter|value|argument)|unknown argument|unrecognized request argument|extra fields not permitted/i.test(msg)) {
    const slim: any = { model: payload.model, messages: payload.messages };
    if (payload.max_completion_tokens) slim.max_completion_tokens = payload.max_completion_tokens; else if (payload.max_tokens) slim.max_tokens = payload.max_tokens;
    return slim;
  }
  return changed ? next : null;
}

export type AiChatModelRow = { providerId: string; providerName: string; model: string; keyIndex: number; keyLabel: string; chat: boolean; toolCalling: boolean; reasoning: boolean, keyCount: number };

/**
 * The rows behind `GET /api/ai/chat-models` — the model picker of the shared
 * dashboard's «چت با مدل‌ها» tab. One implementation for both runtimes keeps the
 * picker identical everywhere: capability flags for the three filters plus one
 * row per enabled API key so a user can chat with a model through key 2 as well.
 */
export function aiChatModelRows(providers: AiCapableProvider[], toolModelIds: Set<string>): AiChatModelRow[] {
  const rows: AiChatModelRow[] = [];
  for (const provider of providers.filter(p => p && p.enabled !== false)) {
    const keys = providerKeys(provider), keyCount = Math.max(1, keys.length);
    for (const model of provider.models || []) {
      for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
        rows.push({
          providerId: String(provider.id), providerName: String(provider.name || provider.id), model: String(model),
          keyIndex, keyLabel: keyIndex ? aiKeySuffixLabel(keyIndex) : '',
          chat: isChatCompatibleAiModel(provider, model), toolCalling: toolModelIds.has(model),
          reasoning: isReasoningAiModel(provider, model), keyCount,
        });
      }
    }
  }
  return rows.sort((a, b) => String(a.providerName).localeCompare(String(b.providerName)) || a.model.localeCompare(b.model) || a.keyIndex - b.keyIndex);
}

/**
 * Rows for a multi-model voting picker (the Basalam bulk category correction):
 * only chat-compatible models can vote, one row per model (keys are not
 * separate voters), and `green` marks the models the last server-side AI test
 * proved working — the automatic ensemble only uses those.
 */
export function aiCategoryModelRows(providers: AiCapableProvider[], green: Set<string>): Array<{ key: string; label: string; providerId: string; providerName: string; model: string; green: boolean }> {
  const rows: Array<{ key: string; label: string; providerId: string; providerName: string; model: string; green: boolean }> = [];
  for (const provider of aiVotingProviders(providers)) for (const model of provider.models || []) {
    // Only chat-compatible models can answer the category prompt, so the picker never
    // offers an OCR/embedding model as a voter (it would fail on every product).
    if (!model || !isChatCompatibleAiModel(provider, model)) continue;
    const key = `${provider.id}::${model}`;
    rows.push({ key, label: `${provider.name || provider.id} — ${model}`, providerId: String(provider.id), providerName: String(provider.name || provider.id), model: String(model), green: green.has(key) });
  }
  return rows.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.model.localeCompare(b.model));
}
/** Enabled providers, with the legacy single-provider form folded in. Exposed for the twins' own pools. */
export function aiVotingProviders(providers: AiCapableProvider[]): AiCapableProvider[] { return (Array.isArray(providers) ? providers : []).filter(p => p && p.enabled !== false); }
