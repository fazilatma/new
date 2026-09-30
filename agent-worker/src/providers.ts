/**
 * Port of agent-python/app/providers.py.
 *
 * The provider catalog was a JSON file on disk; here it is a KV entry
 * (`providers.json`) seeded from the bundled data/providers.json on first use.
 */

import type { Env, Provider, ModelSpec } from './types';
import { all, run } from './db';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';
import { getMasterKey, getRawConfig } from './config';
import seedCatalog from '../data/providers.json';

export const PROVIDERS_KV_KEY = 'providers.json';

/* ------------------------------------------------------------------ */
/* Normalisation (replaces pydantic model validation)                   */
/* ------------------------------------------------------------------ */

export function normalizeModel(raw: any): ModelSpec {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? raw?.id ?? ''),
    toolCalling: Boolean(raw?.toolCalling ?? false),
    vision: Boolean(raw?.vision ?? false),
    free: Boolean(raw?.free ?? false),
    maxInputTokens: Number(raw?.maxInputTokens ?? 128000),
    maxOutputTokens: Number(raw?.maxOutputTokens ?? 8192),
    enabled: raw?.enabled === undefined ? true : Boolean(raw.enabled),
    inputCostPer1M: Number(raw?.inputCostPer1M ?? 0),
    outputCostPer1M: Number(raw?.outputCostPer1M ?? 0),
    extra: (raw?.extra ?? {}) as Record<string, unknown>,
  };
}

export function normalizeProvider(raw: any, fallbackId = ''): Provider {
  const id = String(raw?.id ?? fallbackId);
  if (!id) throw new Error('Provider is missing an "id"');
  return {
    id,
    name: String(raw?.name ?? id),
    vendor: String(raw?.vendor ?? 'custom'),
    url: String(raw?.url ?? ''),
    protocol: String(raw?.protocol ?? 'openai-compatible'),
    enabled: Boolean(raw?.enabled ?? false),
    apiKey: String(raw?.apiKey ?? ''),
    apiKeys: Array.isArray(raw?.apiKeys) ? raw.apiKeys.map(String) : [],
    apiKeyEnv: String(raw?.apiKeyEnv ?? ''),
    proxyUrl: String(raw?.proxyUrl ?? ''),
    priority: Number(raw?.priority ?? 1),
    timeoutSec: Number(raw?.timeoutSec ?? 120),
    models: Array.isArray(raw?.models) ? raw.models.map(normalizeModel) : [],
    extra: (raw?.extra ?? {}) as Record<string, unknown>,
  };
}

/* ------------------------------------------------------------------ */
/* Circuit breaker (per-isolate, same semantics as the Python class)    */
/* ------------------------------------------------------------------ */

export class CircuitBreaker {
  failureThreshold: number;
  recoveryTimeout: number;
  private failureCounts = new Map<string, number>();
  private lastFailure = new Map<string, number>();

  constructor(failureThreshold = 5, recoveryTimeout = 60) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
  }

  isTripped(providerId: string): boolean {
    const now = Date.now() / 1000;
    const failures = this.failureCounts.get(providerId) ?? 0;
    const last = this.lastFailure.get(providerId) ?? 0;
    if (failures >= this.failureThreshold) {
      return now - last <= this.recoveryTimeout;
    }
    return false;
  }

  recordSuccess(providerId: string): void {
    this.failureCounts.set(providerId, 0);
  }

  recordFailure(providerId: string): void {
    this.failureCounts.set(providerId, (this.failureCounts.get(providerId) ?? 0) + 1);
    this.lastFailure.set(providerId, Date.now() / 1000);
  }
}

export const CIRCUIT_BREAKER = new CircuitBreaker();

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export class ProviderStore {
  env: Env;
  data: Map<string, Provider>;
  private keyIndices = new Map<string, number>();
  private masterKey: string;

  private constructor(env: Env, data: Map<string, Provider>) {
    this.env = env;
    this.data = data;
    this.masterKey = getMasterKey(env);
  }

  static async load(env: Env): Promise<ProviderStore> {
    let raw: Record<string, any> | null = null;
    try {
      const stored = await env.CONFIG.get(PROVIDERS_KV_KEY);
      if (stored) raw = JSON.parse(stored);
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) {
      raw = seedCatalog as Record<string, any>;
    }

    const map = new Map<string, Provider>();
    for (const [k, v] of Object.entries(raw)) {
      try {
        const p = normalizeProvider(v, k);
        map.set(p.id, p);
      } catch {
        /* skip malformed entries, same as pydantic validation failure */
      }
    }
    return new ProviderStore(env, map);
  }

  async save(): Promise<void> {
    const dump: Record<string, any> = {};
    for (const [k, v] of this.data) {
      const d: any = { ...v };
      if (d.apiKey && !String(d.apiKey).startsWith('enc:')) {
        d.apiKey = await encryptSecret(d.apiKey, this.masterKey);
      }
      if (Array.isArray(d.apiKeys) && d.apiKeys.length) {
        d.apiKeys = await Promise.all(
          d.apiKeys.map((key: string) =>
            String(key).startsWith('enc:') ? key : encryptSecret(key, this.masterKey),
          ),
        );
      }
      dump[k] = d;
    }
    await this.env.CONFIG.put(PROVIDERS_KV_KEY, JSON.stringify(dump, null, 2));
  }

  /** Port of ProviderStore.get_api_key (with round-robin key rotation). */
  async getApiKey(p: Provider): Promise<string> {
    if (p.apiKeys && p.apiKeys.length) {
      const idx = this.keyIndices.get(p.id) ?? 0;
      const raw = p.apiKeys[idx % p.apiKeys.length];
      this.keyIndices.set(p.id, idx + 1);
      return raw.startsWith('enc:') ? await decryptSecret(raw, this.masterKey) : raw;
    }
    if (p.apiKey) {
      return p.apiKey.startsWith('enc:') ? await decryptSecret(p.apiKey, this.masterKey) : p.apiKey;
    }
    if (p.apiKeyEnv) {
      const val = await getRawConfig(this.env, p.apiKeyEnv, '');
      if (val) return val;
    }
    // Convention fallback: OPENROUTER -> OPENROUTER_API_KEY, groq -> GROQ_API_KEY ...
    const guess = `${p.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    const guessed = await getRawConfig(this.env, guess, '');
    return guessed || '';
  }

  async publicView(p: Provider): Promise<Record<string, unknown>> {
    const key = await this.getApiKey(p);
    return {
      ...p,
      hasApiKey: Boolean(key),
      apiKey: p.apiKey ? await maskSecret(p.apiKey, this.masterKey) : '',
      apiKeys: await Promise.all(p.apiKeys.map((k) => maskSecret(k, this.masterKey))),
      circuitBreakerTripped: CIRCUIT_BREAKER.isTripped(p.id),
    };
  }

  async allPublic(): Promise<Record<string, unknown>[]> {
    const sorted = [...this.data.values()].sort((a, b) => b.priority - a.priority);
    return await Promise.all(sorted.map((p) => this.publicView(p)));
  }

  async upsert(p: Provider): Promise<Record<string, unknown>> {
    const existing = this.data.get(p.id);
    if (existing) {
      if (!p.apiKey || p.apiKey.includes('••••')) p.apiKey = existing.apiKey;
      if (!p.apiKeys || !p.apiKeys.length) p.apiKeys = existing.apiKeys;
    }
    this.data.set(p.id, p);
    await this.save();
    return await this.publicView(p);
  }

  async delete(pid: string): Promise<void> {
    this.data.delete(pid);
    await this.save();
  }

  async addModel(pid: string, m: ModelSpec): Promise<void> {
    const p = this.data.get(pid);
    if (!p) return;
    p.models.push(m);
    await this.save();
  }

  async updateModel(pid: string, mid: string, m: ModelSpec): Promise<void> {
    const p = this.data.get(pid);
    if (!p) return;
    p.models = p.models.map((x) => (x.id === mid ? m : x));
    await this.save();
  }

  async deleteModel(pid: string, mid: string): Promise<void> {
    const p = this.data.get(pid);
    if (!p) return;
    p.models = p.models.filter((x) => x.id !== mid);
    await this.save();
  }

  /** Port of ProviderStore.record_metric. */
  async recordMetric(
    providerId: string,
    modelId: string,
    latencyMs: number,
    isError: boolean,
    tokens = 0,
  ): Promise<void> {
    if (isError) CIRCUIT_BREAKER.recordFailure(providerId);
    else CIRCUIT_BREAKER.recordSuccess(providerId);

    try {
      await run(
        this.env,
        `INSERT INTO provider_metrics (
           provider_id, model_id, request_count, error_count, total_tokens,
           total_latency_ms, last_latency_ms, last_status, circuit_breaker_tripped, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider_id, model_id) DO UPDATE SET
           request_count = request_count + 1,
           error_count = error_count + excluded.error_count,
           total_tokens = total_tokens + excluded.total_tokens,
           total_latency_ms = total_latency_ms + excluded.total_latency_ms,
           last_latency_ms = excluded.last_latency_ms,
           last_status = excluded.last_status,
           circuit_breaker_tripped = excluded.circuit_breaker_tripped,
           updated_at = datetime('now')`,
        providerId,
        modelId,
        isError ? 1 : 0,
        tokens,
        latencyMs,
        latencyMs,
        isError ? 'error' : 'ok',
        CIRCUIT_BREAKER.isTripped(providerId) ? 1 : 0,
      );
    } catch {
      /* metrics must never break a chat turn */
    }
  }

  /** Port of ProviderStore.get_verified_fallback_candidates. */
  async getVerifiedFallbackCandidates(
    excludeProviderId?: string,
    excludeModelId?: string,
    preferDifferentProvider = false,
  ): Promise<[Provider, ModelSpec][]> {
    const out: [Provider, ModelSpec][] = [];
    const seen = new Set<string>();
    try {
      const rows = await all<any>(
        this.env,
        `SELECT provider_id, model_id, last_latency_ms FROM provider_metrics
         WHERE last_status = 'ok' ORDER BY last_latency_ms ASC, updated_at DESC`,
      );
      for (const row of rows) {
        const pid = row.provider_id;
        const mid = row.model_id;
        if (pid === excludeProviderId && mid === excludeModelId) continue;
        const key = `${pid}::${mid}`;
        if (seen.has(key)) continue;

        const provider = this.data.get(pid);
        if (!provider || !provider.enabled || CIRCUIT_BREAKER.isTripped(pid)) continue;

        const apiKey = await this.getApiKey(provider);
        if (!apiKey && provider.protocol !== 'ollama' && provider.protocol !== 'workers-ai') continue;

        const model =
          provider.models.find((m) => m.id === mid) ??
          normalizeModel({ id: mid, name: mid, toolCalling: true });

        out.push([provider, model]);
        seen.add(key);
      }
    } catch {
      /* metrics table may be empty */
    }

    if (preferDifferentProvider && excludeProviderId) {
      out.sort((a, b) => (a[0].id !== excludeProviderId ? 0 : 1) - (b[0].id !== excludeProviderId ? 0 : 1));
    }
    return out;
  }

  exportJson(): string {
    const dump: Record<string, any> = {};
    for (const [k, v] of this.data) {
      dump[k] = { ...v, apiKey: '', apiKeys: [] };
    }
    return JSON.stringify(dump, null, 2);
  }

  async importJson(text: string, replace = false): Promise<void> {
    const incoming = JSON.parse(text);
    const parsed = new Map<string, Provider>();
    if (Array.isArray(incoming)) {
      for (const item of incoming) {
        const p = normalizeProvider(item);
        parsed.set(p.id, p);
      }
    } else if (incoming && typeof incoming === 'object') {
      for (const [k, v] of Object.entries(incoming)) {
        const p = normalizeProvider(v, k);
        parsed.set(p.id, p);
      }
    } else {
      throw new Error('Import JSON must be an array of providers or an object mapping.');
    }

    if (replace) this.data = parsed;
    else for (const [k, v] of parsed) this.data.set(k, v);
    await this.save();
  }
}
