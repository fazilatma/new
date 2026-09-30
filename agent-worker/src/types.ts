/**
 * Cloudflare bindings + shared domain types.
 *
 * Mapping from the original Python/FastAPI application:
 *   sqlite3  -> D1        (env.DB)
 *   local FS -> R2        (env.FILES)
 *   data/*.json config    -> Workers KV (env.CONFIG)
 *   app/static/*          -> Workers Assets (env.ASSETS)
 */

export interface Env {
  // Bindings
  DB: D1Database;
  FILES: R2Bucket;
  CONFIG: KVNamespace;
  ASSETS: Fetcher;
  AI?: any;
  BROWSER?: Fetcher;

  // Vars
  APP_VERSION?: string;
  AUTH_ENABLED?: string;
  REQUIRE_FILE_APPROVAL?: string;
  AGENT_PROXY_ENABLED?: string;
  AGENT_PROXY_URL?: string;
  CORS_ORIGINS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  MAX_CONCURRENT_JOBS?: string;
  MAX_RETRY_SLEEP_SEC?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // Secrets (wrangler secret put ...)
  AGENT_MASTER_KEY?: string;
  AGENT_AUTH_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
  TOGETHER_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GITHUB_TOKEN?: string;
  OLLAMA_BASE_URL?: string;

  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  full_name?: string;
  session_id?: string;
}

/** Hono context variables. */
export type Vars = {
  user: AuthUser;
  clientIp: string;
};

export interface ModelSpec {
  id: string;
  name: string;
  toolCalling: boolean;
  vision: boolean;
  free: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  enabled: boolean;
  inputCostPer1M: number;
  outputCostPer1M: number;
  extra: Record<string, unknown>;
}

export interface Provider {
  id: string;
  name: string;
  vendor: string;
  url: string;
  /** openai-compatible | anthropic | gemini | ollama | mistral | azure | cloudflare | workers-ai */
  protocol: string;
  enabled: boolean;
  apiKey: string;
  apiKeys: string[];
  apiKeyEnv: string;
  proxyUrl: string;
  priority: number;
  timeoutSec: number;
  models: ModelSpec[];
  extra: Record<string, unknown>;
}

export interface ChatMessage {
  role: string;
  content: any;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  reasoning_content?: string;
  [key: string]: any;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  instructions: string;
  agent_rules: string;
  is_default: number;
  created_at?: string;
}

export type AgentEvent = Record<string, any> & { type: string };
