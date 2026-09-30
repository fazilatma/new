/**
 * Port of the provider/model health-test engine from agent-python/app/main.py
 * (`/api/providers/{pid}/models/{mid}/test` and `/api/providers/test-all`) and
 * the proxy connectivity probe (`/api/config/test-proxy`).
 *
 * The full diagnostic payload shape is preserved verbatim because the SPA
 * renders every field of it.
 */

import type { Env, Provider, ModelSpec } from './types';
import { getProxyConfig, getRawConfig } from './config';
import { ProviderStore } from './providers';

export const TEST_PROMPT = 'Reply with the single word: OK';

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'x-api-key' || lk === 'api-key') {
      const raw = v.replace(/^Bearer\s+/i, '');
      out[k] =
        raw.length <= 8
          ? '••••••••'
          : `${lk === 'authorization' ? 'Bearer ' : ''}${raw.slice(0, 3)}••••••••${raw.slice(-4)}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface TestEndpoint {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function buildTestRequest(
  provider: Provider,
  model: ModelSpec,
  apiKey: string,
): TestEndpoint {
  const base = (provider.url || '').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider.protocol === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      url: base.endsWith('/messages') ? base : `${base}/v1/messages`,
      headers,
      body: {
        model: model.id,
        max_tokens: 16,
        messages: [{ role: 'user', content: TEST_PROMPT }],
      },
    };
  }

  if (provider.protocol === 'ollama') {
    return {
      url: base.endsWith('/chat') ? base : `${base}/api/chat`,
      headers,
      body: {
        model: model.id,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        stream: false,
      },
    };
  }

  if (provider.protocol === 'azure') {
    headers['api-key'] = apiKey;
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return {
    url: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
    headers,
    body: {
      model: model.id,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_tokens: 16,
      temperature: 0,
    },
  };
}

function renderText(protocol: string, data: any): { text: string; reasoning: string } {
  try {
    if (protocol === 'anthropic') {
      const blocks = data?.content ?? [];
      return {
        text: blocks
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => b.text ?? '')
          .join(''),
        reasoning: blocks
          .filter((b: any) => b?.type === 'thinking')
          .map((b: any) => b.thinking ?? '')
          .join(''),
      };
    }
    if (protocol === 'ollama') {
      return { text: data?.message?.content ?? '', reasoning: '' };
    }
    const msg = data?.choices?.[0]?.message ?? {};
    return {
      text: msg.content ?? '',
      reasoning: msg.reasoning_content ?? msg.reasoning ?? msg.thought ?? '',
    };
  } catch {
    return { text: '', reasoning: '' };
  }
}

export interface TestOptions {
  connectTimeoutSec?: number;
  readTimeoutSec?: number;
}

export async function testProviderModel(
  env: Env,
  store: ProviderStore,
  provider: Provider,
  model: ModelSpec,
  opts: TestOptions = {},
): Promise<Record<string, any>> {
  const readTimeout = opts.readTimeoutSec ?? 5.0;
  const apiKey = await store.getApiKey(provider);

  const { url: directEndpoint, headers, body } = buildTestRequest(provider, model, apiKey);

  const isLocal =
    provider.protocol === 'ollama' ||
    directEndpoint.includes('127.0.0.1') ||
    directEndpoint.includes('localhost');

  const proxy = isLocal
    ? { effectiveUrl: directEndpoint, proxyClient: null }
    : await getProxyConfig(env, directEndpoint, provider.proxyUrl || null);

  const proxyMode = isLocal
    ? 'Direct (Local / Ollama)'
    : proxy.proxyClient
      ? `Forward proxy '${proxy.proxyClient}' (unsupported on Workers — sent directly)`
      : proxy.effectiveUrl !== directEndpoint
        ? 'Gateway Proxy (URL rewrite)'
        : 'Direct';

  const base: Record<string, any> = {
    provider: provider.id,
    providerName: provider.name,
    model: model.id,
    modelName: model.name,
    protocol: provider.protocol,
    request: {
      method: 'POST',
      directEndpoint,
      effectiveEndpoint: proxy.effectiveUrl,
      proxyClient: proxy.proxyClient,
      isProxyActive: proxy.effectiveUrl !== directEndpoint || Boolean(proxy.proxyClient),
      proxyMode,
      headers: maskHeaders(headers),
      body,
    },
    timestamp: nowIso(),
  };

  if (!apiKey && provider.protocol !== 'ollama' && provider.protocol !== 'workers-ai') {
    return {
      ...base,
      ok: false,
      latencyMs: 0,
      error: `No API key configured for provider '${provider.name}'.`,
      message: 'Missing API key',
      response: {
        statusCode: 401,
        renderedText: '',
        reasoningContent: '',
        rawJson: null,
        rawError: `Set the key with: wrangler secret put ${provider.apiKeyEnv || provider.id.toUpperCase() + '_API_KEY'}`,
      },
    };
  }

  const started = Date.now();
  const attempts: string[] = [proxy.effectiveUrl];
  if (proxy.effectiveUrl !== directEndpoint) attempts.push(directEndpoint);

  let lastError = '';
  let lastStatus = 0;

  for (const url of attempts) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(readTimeout * 1000),
      });
      const latencyMs = Date.now() - started;
      lastStatus = resp.status;
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (resp.ok) {
        const { text: rendered, reasoning } = renderText(provider.protocol, data);
        await store.recordMetric(provider.id, model.id, latencyMs, false);
        return {
          ...base,
          ok: true,
          latencyMs,
          message: rendered ? rendered.trim().slice(0, 200) : 'Empty response body',
          response: {
            statusCode: resp.status,
            renderedText: rendered,
            reasoningContent: reasoning,
            rawJson: data,
            rawError: null,
          },
        };
      }

      lastError =
        (data && (data.error?.message || data.error || data.message)) || text.slice(0, 800);
      if (typeof lastError !== 'string') lastError = JSON.stringify(lastError).slice(0, 800);
    } catch (e: any) {
      lastError = `${e?.name ?? 'Error'}: ${e?.message ?? e}`;
      lastStatus = 0;
    }
  }

  const latencyMs = Date.now() - started;
  await store.recordMetric(provider.id, model.id, latencyMs, true);
  return {
    ...base,
    ok: false,
    latencyMs,
    error: lastError || 'Request failed',
    message: lastError ? String(lastError).slice(0, 200) : 'Request failed',
    response: {
      statusCode: lastStatus,
      renderedText: '',
      reasoningContent: '',
      rawJson: null,
      rawError: lastError,
    },
  };
}

/** Port of `/api/providers/test-all` — bounded concurrency of 15. */
export async function testAllModels(
  env: Env,
  store: ProviderStore,
): Promise<Record<string, any>[]> {
  const tasks: { provider: Provider; model: ModelSpec }[] = [];
  for (const p of store.data.values()) {
    if (!p.enabled) continue;
    for (const m of p.models ?? []) tasks.push({ provider: p, model: m });
  }

  const results: Record<string, any>[] = new Array(tasks.length);
  const CONCURRENCY = 15;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      const { provider, model } = tasks[i];
      try {
        results[i] = await testProviderModel(env, store, provider, model, {
          connectTimeoutSec: 4.0,
          readTimeoutSec: 4.0,
        });
      } catch (e: any) {
        results[i] = {
          provider: provider.id,
          providerName: provider.name,
          model: model.id,
          modelName: model.name,
          protocol: provider.protocol,
          ok: false,
          latencyMs: 0,
          error: String(e?.message ?? e),
          timestamp: nowIso(),
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return results.filter(Boolean);
}

/** Port of `/api/config/test-proxy`. */
export async function testProxy(
  env: Env,
  proxyUrl?: string | null,
  targetUrl = 'https://httpbin.org/get',
): Promise<Record<string, any>> {
  const target = targetUrl || 'https://httpbin.org/get';
  const cfg = proxyUrl
    ? (await import('./config')).parseProxySetting(proxyUrl, target)
    : await getProxyConfig(env, target);

  const started = Date.now();
  try {
    const resp = await fetch(cfg.effectiveUrl, {
      headers: { 'User-Agent': 'Arena-Agent-Worker/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - started;
    await resp.text().catch(() => '');
    return {
      ok: resp.ok,
      status_code: resp.status,
      latency_ms: latency,
      proxy_url: proxyUrl ?? (await getRawConfig(env, 'AGENT_PROXY_URL', '')),
      effective_url: cfg.effectiveUrl,
      proxy_client: cfg.proxyClient,
      message: resp.ok
        ? `Proxy reachable (HTTP ${resp.status}) in ${latency}ms`
        : `Proxy responded with HTTP ${resp.status}`,
    };
  } catch (e: any) {
    return {
      ok: false,
      status_code: 0,
      latency_ms: Date.now() - started,
      proxy_url: proxyUrl ?? (await getRawConfig(env, 'AGENT_PROXY_URL', '')),
      effective_url: cfg.effectiveUrl,
      proxy_client: cfg.proxyClient,
      message: 'Proxy connectivity test failed',
      error: `${e?.name ?? 'Error'}: ${e?.message ?? e}`,
    };
  }
}
