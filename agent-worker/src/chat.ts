/**
 * Port of agent-python/app/chat.py — multi-protocol provider adapter, SSE
 * streaming, tool-calling loop, automatic provider fallback, checkpointing and
 * the self-healing execution loop.
 *
 * `httpx` becomes `fetch`; async generators map 1:1 onto JS async generators.
 */

import type { Env, Provider, ModelSpec, ChatMessage, AgentEvent } from './types';
import { getProxyConfig, getRawConfig } from './config';
import { CIRCUIT_BREAKER, ProviderStore, normalizeModel } from './providers';
import { AGENT_TOOL_DEFINITIONS, executeAgentTool, ToolContext } from './agent-tools';
import {
  getActiveWorkspace,
  getConversationReferences,
  getOrCreateSessionWorkspace,
  listReferenceFiles,
  addConversationReference,
} from './workspaces';
import { getActiveProject } from './projects';
import {
  clearConversationCheckpoints,
  getLatestConversationCheckpoint,
  saveConversationCheckpoint,
} from './db';
import { saveFileVersionSnapshot } from './changesets';
import { writeFileText } from './storage';
import { executeFileInWorkspace } from './terminal';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* System prompt                                                       */
/* ------------------------------------------------------------------ */

export async function buildSystemPrompt(
  env: Env,
  conversationId?: string | null,
  referencedItems?: Record<string, any>[] | null,
  messages?: ChatMessage[] | null,
): Promise<string> {
  const proj = await getActiveProject(env);
  const ws = await getActiveWorkspace(env);

  let prompt =
    'You are an expert AI Coding Agent running in the Arena Agent environment, deployed on ' +
    'Cloudflare Workers. You have full access to workspace file tools (backed by R2 object ' +
    'storage), an HTTP/browser tool with unrestricted external web access, and GitHub-API ' +
    'backed version control.\n\n' +
    `Active Project: ${proj.name ?? 'Main Project'}\n`;

  if (proj.description) prompt += `Project Description: ${proj.description}\n`;
  if (proj.path) prompt += `Project Workspace: ${proj.path}\n`;
  if (proj.default_branch) prompt += `Target Git Branch: ${proj.default_branch}\n`;

  const ins = proj.instructions || ws.instructions;
  if (ins) prompt += `\nProject Instructions & Guidelines:\n${ins}\n`;
  const rules = proj.agent_rules || ws.agent_rules;
  if (rules) prompt += `\nAgent Rules & Constraints:\n${rules}\n`;

  // Gather references (explicit + @chat:/@project: mentions).
  let refs: Record<string, any>[] = [...(referencedItems ?? [])];
  if (conversationId && !refs.length) {
    try {
      refs = await getConversationReferences(env, conversationId);
    } catch {
      refs = [];
    }
  }

  if (messages) {
    for (const m of messages) {
      const content = String(m?.content ?? '');
      for (const cid of content.match(/@chat:([a-zA-Z0-9_\-]+)/g) ?? []) {
        const id = cid.slice(6);
        if (!refs.some((r) => r.target_id === id)) {
          refs.push({ target_type: 'chat', target_id: id, title: `Chat ${id}` });
          if (conversationId) {
            await addConversationReference(env, conversationId, 'chat', id).catch(() => undefined);
          }
        }
      }
      for (const pid of content.match(/@project:([a-zA-Z0-9_\-]+)/g) ?? []) {
        const id = pid.slice(9);
        if (!refs.some((r) => r.target_id === id)) {
          refs.push({ target_type: 'project', target_id: id, title: `Project ${id}` });
          if (conversationId) {
            await addConversationReference(env, conversationId, 'project', id).catch(
              () => undefined,
            );
          }
        }
      }
    }
  }

  if (refs.length) {
    prompt += '\n\n### 🔗 Referenced Chats & Projects (Cross-Session File Access):\n';
    prompt +=
      'This chat references the following other chats and projects. You have FULL permission and ' +
      'ability to inspect, read, and copy files from them into the active workspace using the ' +
      '`read_referenced_file`, `list_referenced_files`, and `copy_referenced_file` tools (or by ' +
      'prefixing paths with `@chat:<id>/path` or `@project:<id>/path`):\n';
    for (const r of refs) {
      const tType = r.target_type ?? 'chat';
      const tId = r.target_id ?? '';
      const title = r.title || tId;
      prompt += `- [${String(tType).toUpperCase()}] Reference '${title}' (ID: \`${tId}\`):\n`;
      try {
        const files = await listReferenceFiles(env, tType, tId);
        const names = files.filter((f) => f.type === 'file').map((f) => f.path).slice(0, 15);
        prompt += names.length
          ? `  Files (${names.length}): ${names.join(', ')}\n`
          : '  Files: (empty or newly created)\n';
      } catch (e: any) {
        prompt += `  Files: (unable to list: ${e?.message ?? e})\n`;
      }
    }
  }

  prompt +=
    '\n### 🤖 ARENA AGENT WORKFLOW & AGENTIC CODING STANDARD:\n' +
    'You must structure all your multi-step coding, debugging, and implementation responses according to the Arena Agent standard:\n' +
    '1. **اعلام هدف و نیت (Goal & Intent)**: Start immediately with a clear statement of your goal and the approach you will take.\n' +
    '2. **برنامه کاری مرحله‌ای (Step-by-Step Work Plan)**: Provide an explicit numbered work plan under `### 📋 برنامه کاری (Work Plan)`.\n' +
    '3. **اجرای گام‌ها در کشوهای تاشو (Collapsible Step Drawers)**: Wrap each step\'s execution details, tools called, generated code, and error tracebacks inside `<details class="agent-step-drawer" open>` with a `<summary class="agent-step-summary">` line displaying the step number, title, and badge (e.g. `<span class="agent-step-badge done">تکمیل شد ✓</span>` or `<span class="agent-step-badge healed">اصلاح شد ✓</span>`).\n' +
    '4. **خلاصه کارهای انجام‌شده (Accomplishments Summary)**: End with a clean bulleted report under `### 🏁 خلاصه کارهای انجام‌شده (Accomplishments)` listing all created files, executed tests, and verified results.\n\n' +
    '### ☁️ CLOUDFLARE WORKERS RUNTIME CONSTRAINTS (IMPORTANT):\n' +
    '- This agent runs inside the Cloudflare Workers runtime. There is **no process execution**: `python`, `node`, `php`, `bash`, `pytest` and friends CANNOT be run.\n' +
    '- `run_command` only supports filesystem built-ins (ls, cat, head, tail, wc, grep, find, tree, stat, du, mkdir, touch, rm, mv, cp, echo, pwd). Anything else returns exit code 127.\n' +
    '- Therefore: do NOT promise to "run the tests" or "execute the script". Instead, write complete, correct, self-verifying code, and explain how the user can run it locally.\n' +
    '- HTML/CSS/JS files CAN be previewed live from the workspace — prefer them for demos.\n' +
    '- Version control goes through the GitHub API (`git_status`, `git_diff`), not a local checkout.\n\n' +
    '### 🛠️ WORKSPACE FILE CREATION & EDITING RULES:\n' +
    '- When the user asks you to write, create, generate, modify, refactor, or test code or files, you MUST ALWAYS call the `write_file` tool (`write_file(path=..., content=...)`) so the code is saved directly into the active workspace.\n' +
    '- DO NOT just output markdown code blocks without saving the file using `write_file`.\n' +
    '- Always ensure the generated code is completely implemented, production-ready, and saved to the correct relative path in the workspace.\n';

  return prompt;
}

/* ------------------------------------------------------------------ */
/* Request building (multi-protocol)                                   */
/* ------------------------------------------------------------------ */

interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

export function buildProviderRequest(
  provider: Provider,
  model: ModelSpec,
  messages: ChatMessage[],
  apiKey: string,
  stream: boolean,
): BuiltRequest {
  const baseUrl = (provider.url || '').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (apiKey) {
    if (provider.protocol === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider.protocol === 'azure') {
      headers['api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  if (provider.protocol === 'anthropic') {
    const url = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/v1/messages`;
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content ?? '' }));
    return {
      url,
      headers,
      body: {
        model: model.id,
        system: systemMsg,
        messages: userMsgs,
        max_tokens: model.maxOutputTokens || 4096,
        temperature: 0.2,
        ...(stream ? { stream: true } : {}),
      },
    };
  }

  if (provider.protocol === 'ollama') {
    const url = baseUrl.endsWith('/chat') ? baseUrl : `${baseUrl}/api/chat`;
    return { url, headers, body: { model: model.id, messages, stream } };
  }

  if (provider.protocol === 'gemini') {
    // Google AI Studio exposes an OpenAI-compatible surface at /openai.
    const url = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/openai$/, '')}/openai/chat/completions`;
    const body: Record<string, any> = { model: model.id, messages, temperature: 0.2 };
    if (stream) body.stream = true;
    if (model.toolCalling) body.tools = AGENT_TOOL_DEFINITIONS;
    return { url, headers, body };
  }

  // openai-compatible, mistral, azure, cloudflare, openrouter, workers-ai
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const body: Record<string, any> = { model: model.id, messages, temperature: 0.2 };
  if (stream) body.stream = true;
  if (model.toolCalling) body.tools = AGENT_TOOL_DEFINITIONS;
  return { url, headers, body };
}

async function resolveTargetUrl(
  env: Env,
  provider: Provider,
  directUrl: string,
): Promise<{ targetUrl: string; proxyClient: string | null }> {
  const baseUrl = provider.url || '';
  if (
    provider.protocol === 'ollama' ||
    baseUrl.includes('127.0.0.1') ||
    baseUrl.includes('localhost')
  ) {
    return { targetUrl: directUrl, proxyClient: null };
  }
  const cfg = await getProxyConfig(env, directUrl, provider.proxyUrl || null);
  return { targetUrl: cfg.effectiveUrl, proxyClient: cfg.proxyClient };
}

function normalizeResponse(provider: Provider, data: any): any {
  if (provider.protocol === 'anthropic') {
    const blocks = data?.content ?? [];
    const contentText = blocks
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('');
    const thinkingText = blocks
      .filter((b: any) => b?.type === 'thinking')
      .map((b: any) => b.thinking ?? '')
      .join('');
    const msg: ChatMessage = { role: 'assistant', content: contentText };
    if (thinkingText) msg.reasoning_content = thinkingText;
    return { choices: [{ message: msg }] };
  }
  if (provider.protocol === 'ollama') {
    return { choices: [{ message: data?.message ?? { role: 'assistant', content: '' } }] };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Non-streaming call — port of chat.call_provider_api                 */
/* ------------------------------------------------------------------ */

export async function callProviderApi(
  env: Env,
  store: ProviderStore,
  provider: Provider,
  model: ModelSpec,
  messages: ChatMessage[],
  apiKey: string,
  customTimeoutSec?: number,
): Promise<any> {
  const { url: directUrl, headers, body } = buildProviderRequest(
    provider,
    model,
    messages,
    apiKey,
    false,
  );
  const { targetUrl } = await resolveTargetUrl(env, provider, directUrl);
  const timeoutMs = (customTimeoutSec ?? provider.timeoutSec ?? 120) * 1000;
  const started = Date.now();

  const attempt = async (url: string) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
    }
    return await resp.json();
  };

  try {
    const data = await attempt(targetUrl);
    const latency = Date.now() - started;
    CIRCUIT_BREAKER.recordSuccess(provider.id);
    await store.recordMetric(provider.id, model.id, latency, false);
    return normalizeResponse(provider, data);
  } catch (primaryErr) {
    // Adaptive direct fallback when the proxy gateway failed.
    if (targetUrl !== directUrl && provider.protocol !== 'ollama') {
      try {
        const data = await attempt(directUrl);
        const latency = Date.now() - started;
        CIRCUIT_BREAKER.recordSuccess(provider.id);
        await store.recordMetric(provider.id, model.id, latency, false);
        return normalizeResponse(provider, data);
      } catch {
        /* fall through to the original error */
      }
    }
    CIRCUIT_BREAKER.recordFailure(provider.id);
    await store.recordMetric(provider.id, model.id, Date.now() - started, true);
    throw primaryErr;
  }
}

/* ------------------------------------------------------------------ */
/* Streaming call — port of chat.stream_call_provider_api              */
/* ------------------------------------------------------------------ */

type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'full_message'; message: ChatMessage };

async function* iterateSseLines(resp: Response): AsyncGenerator<string> {
  const reader = resp.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) yield line.trim();
  }
  if (buffer.trim()) yield buffer.trim();
}

async function* streamRequest(
  provider: Provider,
  url: string,
  headers: Record<string, string>,
  body: Record<string, any>,
  timeoutMs: number,
): AsyncGenerator<StreamChunk> {
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
  }

  const fullContent: string[] = [];
  const fullReasoning: string[] = [];
  const toolCalls = new Map<number, any>();

  for await (const line of iterateSseLines(resp)) {
    if (!line || line.startsWith(':')) continue;

    if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      if (dataStr === '[DONE]') break;
      let chunk: any;
      try {
        chunk = JSON.parse(dataStr);
      } catch {
        continue;
      }

      // Anthropic event stream
      if (provider.protocol === 'anthropic') {
        if (chunk?.type === 'content_block_delta') {
          const delta = chunk.delta ?? {};
          if (delta.type === 'text_delta' && delta.text) {
            fullContent.push(delta.text);
            yield { type: 'token', text: delta.text };
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            fullReasoning.push(delta.thinking);
            yield { type: 'reasoning', reasoning: delta.thinking };
          }
        }
        continue;
      }

      const choices = chunk?.choices ?? [];
      if (!choices.length) continue;
      const delta = choices[0]?.delta ?? {};

      const rText = delta.reasoning_content || delta.reasoning || delta.thought || '';
      if (rText) {
        fullReasoning.push(rText);
        yield { type: 'reasoning', reasoning: rText };
      }

      const cText = delta.content || '';
      if (cText) {
        fullContent.push(cText);
        yield { type: 'token', text: cText };
      }

      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        if (!toolCalls.has(idx)) {
          toolCalls.set(idx, {
            id: tc.id ?? `call_${idx}_${Date.now()}`,
            type: 'function',
            function: { name: '', arguments: '' },
          });
        }
        const entry = toolCalls.get(idx);
        if (tc.id) entry.id = tc.id;
        const fn = tc.function ?? {};
        if (fn.name) entry.function.name += fn.name;
        if (fn.arguments) entry.function.arguments += fn.arguments;
      }
      continue;
    }

    // Ollama emits bare NDJSON objects
    if (provider.protocol === 'ollama' && line.startsWith('{')) {
      try {
        const chunk = JSON.parse(line);
        const cText = chunk?.message?.content ?? '';
        if (cText) {
          fullContent.push(cText);
          yield { type: 'token', text: cText };
        }
        if (chunk?.done) break;
      } catch {
        /* ignore malformed frame */
      }
    }
  }

  const finalMsg: ChatMessage = { role: 'assistant', content: fullContent.join('') };
  if (fullReasoning.length) finalMsg.reasoning_content = fullReasoning.join('');
  const tcFinal = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  if (tcFinal.length) finalMsg.tool_calls = tcFinal;

  yield { type: 'full_message', message: finalMsg };
}

export async function* streamCallProviderApi(
  env: Env,
  store: ProviderStore,
  provider: Provider,
  model: ModelSpec,
  messages: ChatMessage[],
  apiKey: string,
  customTimeoutSec?: number,
): AsyncGenerator<StreamChunk> {
  const { url: directUrl, headers, body } = buildProviderRequest(
    provider,
    model,
    messages,
    apiKey,
    true,
  );
  const { targetUrl } = await resolveTargetUrl(env, provider, directUrl);
  const timeoutMs = (customTimeoutSec ?? provider.timeoutSec ?? 120) * 1000;
  const started = Date.now();

  try {
    for await (const item of streamRequest(provider, targetUrl, headers, body, timeoutMs)) {
      yield item;
    }
    CIRCUIT_BREAKER.recordSuccess(provider.id);
    await store.recordMetric(provider.id, model.id, Date.now() - started, false);
    return;
  } catch (proxyErr) {
    if (targetUrl !== directUrl && provider.protocol !== 'ollama') {
      try {
        for await (const item of streamRequest(provider, directUrl, headers, body, timeoutMs)) {
          yield item;
        }
        CIRCUIT_BREAKER.recordSuccess(provider.id);
        await store.recordMetric(provider.id, model.id, Date.now() - started, false);
        return;
      } catch {
        /* fall through to non-streaming */
      }
    }

    // Last resort: non-streaming call, chunked client-side (same as Python).
    try {
      const resp = await callProviderApi(env, store, provider, model, messages, apiKey);
      const msg = resp?.choices?.[0]?.message ?? { role: 'assistant', content: '' };
      const reasoning = msg.reasoning_content || msg.reasoning || msg.thought || '';
      if (reasoning) yield { type: 'reasoning', reasoning };
      const content = String(msg.content ?? '');
      for (let i = 0; i < content.length; i += 25) {
        yield { type: 'token', text: content.slice(i, i + 25) };
      }
      yield { type: 'full_message', message: msg };
      return;
    } catch (nonStreamErr) {
      CIRCUIT_BREAKER.recordFailure(provider.id);
      await store.recordMetric(provider.id, model.id, Date.now() - started, true);
      throw nonStreamErr;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Auto file detection — port of auto_detect_and_save_code_files       */
/* ------------------------------------------------------------------ */

export interface SavedFile {
  path: string;
  type: string;
  content: string;
  isExecutable: boolean;
  isHtml: boolean;
}

export async function autoDetectAndSaveCodeFiles(
  env: Env,
  workspaceId: string,
  content: string,
): Promise<SavedFile[]> {
  const saved: SavedFile[] = [];
  if (!content || !content.includes('```')) return saved;

  const used = new Set<string>();
  const blocks = content.split('```');

  for (let i = 1; i < blocks.length; i += 2) {
    const block = blocks[i];
    const precedingText = blocks[i - 1] ?? '';
    const nl = block.indexOf('\n');
    const firstLine = (nl >= 0 ? block.slice(0, nl) : block).trim();
    const code = nl >= 0 ? block.slice(nl + 1) : '';
    if (!code.trim()) continue;

    let filename: string | null = null;
    const lang = firstLine.toLowerCase();
    const cleanLang = (lang.split(/[\s:;=]/)[0] || 'code').trim();

    // 1. filename attached to the fence info string
    const tagMatch = /(?:^|[\s:])(?:file=|filename=|path=|:)?\s*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i.exec(
      firstLine,
    );
    if (tagMatch) filename = tagMatch[1].trim();

    // 2. filename in a leading comment of the block
    if (!filename) {
      const codeHead = code.trim().split('\n').slice(0, 3).join('\n');
      const m = /(?:#|\/\/|\/\*|<!--)\s*(?:filename|filepath|file|path|نام فایل)?\s*:?\s*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?/i.exec(
        codeHead,
      );
      if (m) filename = m[1].trim();
    }

    // 3. filename in the preceding prose
    if (!filename && precedingText) {
      const lastLines = precedingText
        .trim()
        .split('\n')
        .slice(-3)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const l of [...lastLines].reverse()) {
        const m = /(?:###|##|#|\*\*|فایل|File:?|ساخت فایل|کد فایل)?\s*`?([a-zA-Z0-9_\-./]+\.(?:html|htm|py|js|ts|jsx|tsx|css|json|sql|sh|md|txt|php|toml|yaml|yml))`?/i.exec(
          l,
        );
        if (m) {
          filename = m[1].trim();
          break;
        }
      }
    }

    // 4. language-based fallbacks
    if (!filename) {
      const lower = code.toLowerCase();
      const nth = used.size + 1;
      if (lower.includes('<!doctype html') || lower.includes('<html')) filename = 'index.html';
      else if (['html', 'htm'].includes(cleanLang))
        filename = used.has('index.html') ? `page_${nth}.html` : 'index.html';
      else if (cleanLang === 'css')
        filename = used.has('style.css') ? `style_${nth}.css` : 'style.css';
      else if (['javascript', 'js'].includes(cleanLang))
        filename = used.has('app.js') ? `script_${nth}.js` : 'app.js';
      else if (['typescript', 'ts'].includes(cleanLang))
        filename = used.has('app.ts') ? `script_${nth}.ts` : 'app.ts';
      else if (['python', 'py'].includes(cleanLang))
        filename = used.has('main.py') ? `script_${nth}.py` : 'main.py';
      else if (cleanLang === 'json') filename = 'data.json';
      else if (cleanLang === 'sql') filename = 'schema.sql';
      else if (['bash', 'sh', 'zsh'].includes(cleanLang)) filename = 'run.sh';
      else if (cleanLang === 'php' || code.includes('<?php'))
        filename = used.has('index.php') ? `script_${nth}.php` : 'index.php';
      else if (['toml'].includes(cleanLang)) filename = 'config.toml';
    }

    if (!filename) continue;
    const cleanFn = filename.trim().replace(/^\/+/, '').replace(/\\/g, '/');
    if (!cleanFn || cleanFn.startsWith('..') || !cleanFn.includes('.')) continue;

    try {
      await writeFileText(env, workspaceId, cleanFn, code);
      await saveFileVersionSnapshot(env, workspaceId, cleanFn, code, 'agent-auto-save');
      used.add(cleanFn);
      const lower = cleanFn.toLowerCase();
      saved.push({
        path: cleanFn,
        type: cleanLang || 'code',
        content: code,
        isExecutable: /\.(py|pyw|sh|bash|js|mjs|ts|php)$/.test(lower),
        isHtml: /\.(html|htm)$/.test(lower),
      });
    } catch {
      /* skip unwritable paths */
    }
  }

  return saved;
}

/* ------------------------------------------------------------------ */
/* Error classification helpers                                        */
/* ------------------------------------------------------------------ */

export function isRateLimitError(err: unknown): boolean {
  const s = String((err as any)?.message ?? err).toLowerCase();
  return (
    s.includes('429') ||
    s.includes('rate limit') ||
    s.includes('rate_limit') ||
    s.includes('402') ||
    s.includes('quota') ||
    s.includes('credit') ||
    s.includes('billing') ||
    s.includes('insufficient')
  );
}

export function isNetworkError(err: unknown): boolean {
  const s = String((err as any)?.message ?? err).toLowerCase();
  const name = String((err as any)?.name ?? '').toLowerCase();
  return (
    name.includes('timeout') ||
    name.includes('abort') ||
    s.includes('timeout') ||
    s.includes('timed out') ||
    s.includes('connect') ||
    s.includes('connection') ||
    s.includes('502') ||
    s.includes('503') ||
    s.includes('504') ||
    s.includes('520') ||
    s.includes('521') ||
    s.includes('522') ||
    s.includes('524') ||
    s.includes('network') ||
    s.includes('disconnected')
  );
}

/* ------------------------------------------------------------------ */
/* Candidate resolution (shared by stream + non-stream)                */
/* ------------------------------------------------------------------ */

interface Candidate {
  provider: Provider;
  model: ModelSpec;
  isFallback: boolean;
}

async function buildCandidates(
  store: ProviderStore,
  primary: Provider,
  model: ModelSpec,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [{ provider: primary, model, isFallback: false }];
  const seen = new Set([`${primary.id}::${model.id}`]);

  const verified = await store.getVerifiedFallbackCandidates(primary.id, model.id, true);
  for (const [vp, vm] of verified) {
    const key = `${vp.id}::${vm.id}`;
    if (!seen.has(key)) {
      candidates.push({ provider: vp, model: vm, isFallback: true });
      seen.add(key);
    }
  }

  const sorted = [...store.data.values()].sort((a, b) => b.priority - a.priority);
  for (const p of sorted) {
    if (!p.enabled || p.id === primary.id || CIRCUIT_BREAKER.isTripped(p.id)) continue;
    const apiKey = await store.getApiKey(p);
    if (!apiKey && p.protocol !== 'ollama' && p.protocol !== 'workers-ai') continue;
    for (const m of p.models ?? []) {
      const key = `${p.id}::${m.id}`;
      if (!seen.has(key)) {
        candidates.push({ provider: p, model: m, isFallback: true });
        seen.add(key);
      }
    }
  }
  return candidates;
}

function resolveModel(provider: Provider, modelId: string): ModelSpec {
  return (
    provider.models.find((m) => m.id === modelId) ??
    provider.models[0] ??
    normalizeModel({ id: modelId || 'default-model', name: modelId || 'Default Model', toolCalling: true })
  );
}

function nowUtc(): string {
  return `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/* ------------------------------------------------------------------ */
/* Streaming agent loop — port of chat.stream_complete_chat            */
/* ------------------------------------------------------------------ */

export interface ChatOptions {
  providerId: string;
  modelId: string;
  messages: ChatMessage[];
  maxSteps?: number;
  userId?: string;
  conversationId?: string | null;
  references?: Record<string, any>[] | null;
}

export async function* streamCompleteChat(
  env: Env,
  store: ProviderStore,
  opts: ChatOptions,
): AsyncGenerator<AgentEvent> {
  const maxSteps = opts.maxSteps ?? 30;
  const conversationId = opts.conversationId ?? null;

  let workspaceId = (await getActiveWorkspace(env)).id;
  if (conversationId) {
    try {
      workspaceId = (await getOrCreateSessionWorkspace(env, conversationId)).id;
    } catch {
      /* keep active workspace */
    }
  }
  const toolCtx: ToolContext = { env, workspaceId, conversationId, userId: opts.userId };

  const sysPrompt = await buildSystemPrompt(env, conversationId, opts.references, opts.messages);
  let chatMsgs: ChatMessage[] = [
    { role: 'system', content: sysPrompt },
    ...opts.messages.filter((m) => m.role !== 'system'),
  ];

  // Resume from checkpoint
  if (conversationId) {
    const cp = await getLatestConversationCheckpoint(env, conversationId);
    if (cp?.chatHistory?.length) {
      const nonSys = opts.messages.filter((m) => m.role !== 'system');
      const cpNonSys = (cp.chatHistory as ChatMessage[]).filter((m) => m.role !== 'system');
      if (
        cpNonSys.length >= nonSys.length &&
        (cp.chatHistory as ChatMessage[]).some((m) => ['assistant', 'tool'].includes(m.role))
      ) {
        chatMsgs = [{ role: 'system', content: sysPrompt }, ...cpNonSys];
        yield {
          type: 'checkpoint_resumed',
          checkpointId: cp.id,
          stepIndex: cp.stepIndex ?? 0,
          message: `Resumed execution from checkpoint at step ${(cp.stepIndex ?? 0) + 1}.`,
        };
      }
    }
  }

  const primary = store.data.get(opts.providerId);
  if (!primary) {
    throw new Error(`Provider '${opts.providerId}' is not configured in the Provider Catalog.`);
  }
  const primaryModel = resolveModel(primary, opts.modelId);

  yield { type: 'status', status: 'started', provider: primary.id, model: primaryModel.id };

  const primaryKey = await store.getApiKey(primary);
  if (!primaryKey && primary.protocol !== 'ollama' && primary.protocol !== 'workers-ai') {
    let anyOther = false;
    for (const p of store.data.values()) {
      if (!p.enabled || p.id === opts.providerId) continue;
      if ((await store.getApiKey(p)) || p.protocol === 'ollama') {
        anyOther = true;
        break;
      }
    }
    if (!anyOther) {
      const errMsg = `Provider '${primary.name}' (${primary.id}) does not have an API key configured.`;
      yield {
        type: 'error',
        error: errMsg,
        errorDetails: {
          provider: primary.id,
          providerName: primary.name,
          model: primaryModel.id,
          protocol: primary.protocol,
          url: primary.url,
          error: errMsg,
          timestamp: nowUtc(),
          remediation: `Set the API key with: wrangler secret put ${primary.apiKeyEnv || 'OPENROUTER_API_KEY'} — or enter it in 'Providers & Models' / 'Security & Settings'.`,
        },
      };
      return;
    }
  }

  const candidates = await buildCandidates(store, primary, primaryModel);
  const pendingApprovals: any[] = [];
  let primaryError: string | null = null;
  const fallbackErrors: any[] = [];
  const maxRetrySleep = Number(await getRawConfig(env, 'MAX_RETRY_SLEEP_SEC', '20')) || 20;

  for (const { provider: p, model: targetModel, isFallback } of candidates) {
    const apiKey = await store.getApiKey(p);
    if (!apiKey && p.protocol !== 'ollama' && p.protocol !== 'workers-ai') continue;

    if (isFallback) {
      yield {
        type: 'fallback_activated',
        fallbackDetails: {
          used: true,
          originalProvider: primary.name,
          originalModel: primaryModel.id,
          activeProvider: p.name,
          activeModel: targetModel.id,
        },
      };
    }

    let stepIdx = 0;
    try {
      for (stepIdx = 0; stepIdx < maxSteps; stepIdx++) {
        let lastMsg: ChatMessage | null = null;

        // Exponential backoff retry for transient network failures.
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            for await (const chunk of streamCallProviderApi(
              env,
              store,
              p,
              targetModel,
              chatMsgs,
              apiKey,
            )) {
              if (chunk.type === 'token') yield { type: 'token', text: chunk.text };
              else if (chunk.type === 'reasoning')
                yield { type: 'reasoning', reasoning: chunk.reasoning };
              else if (chunk.type === 'full_message') lastMsg = chunk.message;
            }
            break;
          } catch (streamErr) {
            if (isRateLimitError(streamErr)) throw streamErr;
            if (!isNetworkError(streamErr) || attempt >= 10) throw streamErr;

            const delaySec = Math.min(2 ** (attempt - 1), 60);
            const actual = Math.min(delaySec, maxRetrySleep);
            yield {
              type: 'retry_countdown',
              attempt,
              maxAttempts: 10,
              delaySec,
              provider: p.name,
              model: targetModel.name,
              reason: `قطع ارتباط شبکه یا تایم‌اوت (${(streamErr as any)?.name ?? 'Error'}). تلاش مجدد در ${delaySec} ثانیه...`,
            };
            if (actual > 0) await sleep(actual * 1000);
          }
        }

        if (!lastMsg) break;

        chatMsgs.push(lastMsg);
        const toolCalls = lastMsg.tool_calls ?? [];

        if (!toolCalls.length) {
          const savedFiles = await autoDetectAndSaveCodeFiles(
            env,
            workspaceId,
            String(lastMsg.content ?? ''),
          );
          const executionReports: any[] = [];

          if (conversationId) {
            await saveConversationCheckpoint(env, {
              conversationId,
              stepIndex: stepIdx,
              providerId: p.id,
              modelId: targetModel.id,
              accumulatedContent: String(lastMsg.content ?? ''),
              accumulatedReasoning: lastMsg.reasoning_content ?? '',
              chatHistory: chatMsgs,
              savedFiles,
              executionResults: executionReports,
              status: 'completed',
            });
          }

          // Autonomous execution / self-healing loop.
          for (const sf of savedFiles) {
            if (sf.isHtml) {
              const qs = new URLSearchParams({ path: sf.path });
              if (conversationId) qs.set('conversation_id', conversationId);
              yield {
                type: 'render_preview_ready',
                path: sf.path,
                previewUrl: `/api/workspace/raw?${qs.toString()}`,
                previewType: 'html',
              };
              continue;
            }
            if (!sf.isExecutable) continue;

            const execRes = await executeFileInWorkspace(env, workspaceId, sf.path, conversationId);
            executionReports.push(execRes);

            if (execRes.exitCode === 0) {
              yield {
                type: 'execution_result',
                path: sf.path,
                status: 'success',
                exitCode: 0,
                command: execRes.command ?? '',
                stdout: execRes.stdout ?? '',
                stderr: execRes.stderr ?? '',
                attempt: 1,
              };
              continue;
            }

            // On Workers, script runtimes are unavailable — surface that once
            // and skip the heal loop instead of burning tokens forever.
            if (execRes.unsupported) {
              yield {
                type: 'execution_result',
                path: sf.path,
                status: 'unsupported',
                exitCode: execRes.exitCode ?? 127,
                command: execRes.command ?? '',
                stdout: '',
                stderr: execRes.stderr ?? '',
                unsupported: true,
                attempt: 1,
              };
              continue;
            }

            yield {
              type: 'execution_result',
              path: sf.path,
              status: 'failed',
              exitCode: execRes.exitCode ?? 1,
              command: execRes.command ?? '',
              stdout: execRes.stdout ?? '',
              stderr: execRes.stderr ?? '',
              attempt: 1,
            };

            let currentErr =
              execRes.stderr || execRes.stdout || 'Execution failed with non-zero exit code';
            let lastExec = execRes;
            for (let healAttempt = 1; healAttempt <= 3; healAttempt++) {
              chatMsgs.push({
                role: 'user',
                content:
                  `\n\n[AUTONOMOUS TEST EXECUTION FAILURE - Attempt ${healAttempt}/3]\n` +
                  `File \`${sf.path}\` was executed and failed with Exit Code ${lastExec.exitCode ?? 1}.\n` +
                  `Error Traceback:\n\`\`\`\n${currentErr}\n\`\`\`\n\n` +
                  `Please diagnose this error, fix all issues in \`${sf.path}\`, and output the full corrected code in a code block.`,
              });
              yield {
                type: 'token',
                text: `\n\n⚙️ *در حال رفع خودکار خطای اجرای \`${sf.path}\` (تلاش ${healAttempt})...*\n\n`,
              };

              let healMsg: ChatMessage | null = null;
              for await (const chunk of streamCallProviderApi(
                env,
                store,
                p,
                targetModel,
                chatMsgs,
                apiKey,
              )) {
                if (chunk.type === 'token') yield { type: 'token', text: chunk.text };
                else if (chunk.type === 'reasoning')
                  yield { type: 'reasoning', reasoning: chunk.reasoning };
                else if (chunk.type === 'full_message') healMsg = chunk.message;
              }
              if (!healMsg) break;

              chatMsgs.push(healMsg);
              await autoDetectAndSaveCodeFiles(env, workspaceId, String(healMsg.content ?? ''));

              const reExec = await executeFileInWorkspace(
                env,
                workspaceId,
                sf.path,
                conversationId,
              );
              if (reExec.exitCode === 0) {
                yield {
                  type: 'execution_healed',
                  path: sf.path,
                  status: 'healed',
                  exitCode: 0,
                  command: reExec.command ?? '',
                  stdout: reExec.stdout ?? '',
                  stderr: reExec.stderr ?? '',
                  durationMs: reExec.durationMs ?? 0,
                  attempts: healAttempt + 1,
                };
                executionReports.push(reExec);
                break;
              }
              currentErr = reExec.stderr || reExec.stdout || currentErr;
              lastExec = reExec;
            }
          }

          CIRCUIT_BREAKER.recordSuccess(p.id);
          await store.recordMetric(p.id, targetModel.id, 0, false);

          if (pendingApprovals.length) {
            yield { type: 'approvals', approvals: pendingApprovals };
          }

          yield {
            type: 'done',
            steps: stepIdx + 1,
            provider: p.id,
            model: targetModel.id,
            reasoning: lastMsg.reasoning_content ?? '',
            savedFiles,
            executionReports,
            isFallback,
            fallbackDetails: isFallback
              ? {
                  used: true,
                  originalProvider: primary.name,
                  originalModel: primaryModel.id,
                  activeProvider: p.name,
                  activeModel: targetModel.id,
                }
              : null,
          };
          if (conversationId) await clearConversationCheckpoints(env, conversationId);
          return;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          const name = tc.function?.name ?? '';
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }

          yield { type: 'tool_executing', tool: name, args };
          let res: unknown;
          try {
            res = await executeAgentTool(toolCtx, name, args);
            if (res && typeof res === 'object' && (res as any).requiresApproval) {
              pendingApprovals.push(res);
            }
          } catch (e: any) {
            res = { error: String(e?.message ?? e) };
          }

          yield { type: 'tool_result', tool: name, result: res };

          chatMsgs.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(res),
          });

          if (conversationId) {
            await saveConversationCheckpoint(env, {
              conversationId,
              stepIndex: stepIdx,
              providerId: p.id,
              modelId: targetModel.id,
              chatHistory: chatMsgs,
              status: 'in_progress',
            });
          }
        }
      }

      CIRCUIT_BREAKER.recordSuccess(p.id);
      yield {
        type: 'done',
        steps: maxSteps,
        provider: p.id,
        model: targetModel.id,
        isFallback,
      };
      if (conversationId) await clearConversationCheckpoints(env, conversationId);
      return;
    } catch (e: any) {
      const errText = String(e?.message ?? e);
      CIRCUIT_BREAKER.recordFailure(p.id);
      await store.recordMetric(p.id, targetModel.id, 0, true);

      if (conversationId) {
        await saveConversationCheckpoint(env, {
          conversationId,
          stepIndex: stepIdx,
          providerId: p.id,
          modelId: targetModel.id,
          chatHistory: chatMsgs,
          status: 'failed',
          errorMessage: errText,
        });
      }

      if (isRateLimitError(e)) {
        const fallbacks = await store.getVerifiedFallbackCandidates(p.id, targetModel.id, true);
        if (fallbacks.length) {
          const [nextP, nextM] = fallbacks[0];
          yield {
            type: 'model_switched_rate_limit',
            previousProvider: p.name,
            previousModel: targetModel.name,
            newProvider: nextP.name,
            newModel: nextM.name,
            reason: `خطای ریت‌لیمیت یا اتمام اعتبار (${errText})؛ سوییچ هوشمند به مدل ${nextM.name} از ارائه‌دهنده ${nextP.name}`,
          };
        }
      }

      if (p.id === primary.id) primaryError = `${errText} (Endpoint: ${p.url})`;
      else
        fallbackErrors.push({
          provider: p.id,
          providerName: p.name,
          model: targetModel.id,
          url: p.url,
          error: errText,
        });
      continue;
    }
  }

  yield {
    type: 'error',
    error: `Failed to get response from ${primary.name}: ${primaryError ?? 'Network/API error'}`,
    errorDetails: {
      provider: primary.id,
      providerName: primary.name,
      model: primaryModel.id,
      protocol: primary.protocol,
      url: primary.url,
      error: primaryError ?? 'All candidate models failed to respond.',
      fallbackErrors,
      timestamp: nowUtc(),
      remediation:
        '1. Check the provider API keys (wrangler secret put ...).\n' +
        '2. In Providers & Models, run the model health test.\n' +
        '3. Verify the proxy gateway URL in Settings (forward proxies are not supported on Workers).',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Non-streaming agent loop — port of chat.complete_chat               */
/* ------------------------------------------------------------------ */

export async function completeChat(
  env: Env,
  store: ProviderStore,
  opts: ChatOptions,
): Promise<Record<string, any>> {
  const maxSteps = opts.maxSteps ?? 8;
  const conversationId = opts.conversationId ?? null;

  let workspaceId = (await getActiveWorkspace(env)).id;
  if (conversationId) {
    try {
      workspaceId = (await getOrCreateSessionWorkspace(env, conversationId)).id;
    } catch {
      /* keep active */
    }
  }
  const toolCtx: ToolContext = { env, workspaceId, conversationId, userId: opts.userId };

  const sysPrompt = await buildSystemPrompt(env, conversationId, opts.references, opts.messages);
  let chatMsgs: ChatMessage[] = [
    { role: 'system', content: sysPrompt },
    ...opts.messages.filter((m) => m.role !== 'system'),
  ];

  if (conversationId) {
    const cp = await getLatestConversationCheckpoint(env, conversationId);
    if (cp?.chatHistory?.length) {
      const cpNonSys = (cp.chatHistory as ChatMessage[]).filter((m) => m.role !== 'system');
      const nonSys = opts.messages.filter((m) => m.role !== 'system');
      if (
        cpNonSys.length >= nonSys.length &&
        (cp.chatHistory as ChatMessage[]).some((m) => ['assistant', 'tool'].includes(m.role))
      ) {
        chatMsgs = [{ role: 'system', content: sysPrompt }, ...cpNonSys];
      }
    }
  }

  const primary = store.data.get(opts.providerId);
  if (!primary) {
    throw new Error(`Provider '${opts.providerId}' is not configured in the Provider Catalog.`);
  }
  const primaryModel = resolveModel(primary, opts.modelId);

  const primaryKey = await store.getApiKey(primary);
  if (!primaryKey && primary.protocol !== 'ollama' && primary.protocol !== 'workers-ai') {
    let anyOther = false;
    for (const p of store.data.values()) {
      if (!p.enabled || p.id === opts.providerId) continue;
      if ((await store.getApiKey(p)) || p.protocol === 'ollama') {
        anyOther = true;
        break;
      }
    }
    if (!anyOther) {
      const errMsg = `Provider '${primary.name}' (${primary.id}) does not have an API key configured.`;
      return {
        message: {
          role: 'assistant',
          content:
            `⚠️ **API Key Required**: Provider \`${primary.name}\` (\`${primary.id}\`) does not have an API key configured.\n\n` +
            `Set it with \`wrangler secret put ${primary.apiKeyEnv || 'OPENROUTER_API_KEY'}\`, or enter it in the ` +
            `**Providers & Models** / **Security & Settings** tab.`,
        },
        steps: 0,
        provider: primary.id,
        model: primaryModel.id,
        errorDetails: {
          provider: primary.id,
          providerName: primary.name,
          model: primaryModel.id,
          protocol: primary.protocol,
          url: primary.url,
          error: errMsg,
          timestamp: nowUtc(),
          remediation: `Configure the API key for ${primary.name}.`,
        },
        pendingApprovals: [],
      };
    }
  }

  const candidates = await buildCandidates(store, primary, primaryModel);
  const pendingApprovals: any[] = [];
  const stepHistory: any[] = [];
  let primaryError: string | null = null;
  const fallbackErrors: any[] = [];
  const maxRetrySleep = Number(await getRawConfig(env, 'MAX_RETRY_SLEEP_SEC', '20')) || 20;

  for (const { provider: p, model: targetModel, isFallback } of candidates) {
    const apiKey = await store.getApiKey(p);
    if (!apiKey && p.protocol !== 'ollama' && p.protocol !== 'workers-ai') continue;

    try {
      for (let stepIdx = 0; stepIdx < maxSteps; stepIdx++) {
        let resp: any = null;
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            resp = await callProviderApi(env, store, p, targetModel, chatMsgs, apiKey);
            break;
          } catch (reqErr) {
            if (isRateLimitError(reqErr) || !isNetworkError(reqErr) || attempt >= 10) throw reqErr;
            const delaySec = Math.min(2 ** (attempt - 1), 60);
            await sleep(Math.min(delaySec, maxRetrySleep) * 1000);
          }
        }
        if (!resp?.choices?.length) break;

        const msg: ChatMessage = resp.choices[0].message;
        chatMsgs.push(msg);

        const toolCalls = msg.tool_calls ?? [];
        if (!toolCalls.length) {
          const savedFiles = await autoDetectAndSaveCodeFiles(
            env,
            workspaceId,
            String(msg.content ?? ''),
          );
          const executionReports: any[] = [];
          for (const sf of savedFiles) {
            if (!sf.isExecutable) continue;
            const execRes = await executeFileInWorkspace(env, workspaceId, sf.path, conversationId);
            executionReports.push(execRes);
          }

          if (conversationId) {
            await saveConversationCheckpoint(env, {
              conversationId,
              stepIndex: stepIdx,
              providerId: p.id,
              modelId: targetModel.id,
              accumulatedContent: String(msg.content ?? ''),
              chatHistory: chatMsgs,
              savedFiles,
              executionResults: executionReports,
              status: 'completed',
            });
            await clearConversationCheckpoints(env, conversationId);
          }

          CIRCUIT_BREAKER.recordSuccess(p.id);
          await store.recordMetric(p.id, targetModel.id, 0, false);

          return {
            message: msg,
            steps: stepIdx + 1,
            provider: p.id,
            model: targetModel.id,
            reasoning: msg.reasoning_content ?? '',
            savedFiles,
            executionReports,
            stepHistory,
            pendingApprovals,
            isFallback,
            fallbackDetails: isFallback
              ? {
                  used: true,
                  originalProvider: primary.name,
                  originalModel: primaryModel.id,
                  activeProvider: p.name,
                  activeModel: targetModel.id,
                }
              : null,
          };
        }

        for (const tc of toolCalls) {
          const name = tc.function?.name ?? '';
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }
          const started = Date.now();
          let res: unknown;
          let status = 'success';
          try {
            res = await executeAgentTool(toolCtx, name, args);
            if (res && typeof res === 'object' && (res as any).requiresApproval) {
              pendingApprovals.push(res);
            }
          } catch (e: any) {
            res = { error: String(e?.message ?? e) };
            status = 'error';
          }
          stepHistory.push({
            step: stepIdx,
            tool: name,
            args,
            status,
            durationMs: Date.now() - started,
            result: res,
          });
          chatMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res) });
        }
      }

      return {
        message: { role: 'assistant', content: 'Reached the maximum number of agent steps.' },
        steps: maxSteps,
        provider: p.id,
        model: targetModel.id,
        stepHistory,
        pendingApprovals,
        isFallback,
      };
    } catch (e: any) {
      const errText = String(e?.message ?? e);
      CIRCUIT_BREAKER.recordFailure(p.id);
      await store.recordMetric(p.id, targetModel.id, 0, true);
      if (p.id === primary.id) primaryError = `${errText} (Endpoint: ${p.url})`;
      else
        fallbackErrors.push({
          provider: p.id,
          providerName: p.name,
          model: targetModel.id,
          url: p.url,
          error: errText,
        });
      continue;
    }
  }

  return {
    message: {
      role: 'assistant',
      content: `⚠️ Failed to get a response from ${primary.name}: ${primaryError ?? 'Network/API error'}`,
    },
    steps: 0,
    provider: primary.id,
    model: primaryModel.id,
    errorDetails: {
      provider: primary.id,
      providerName: primary.name,
      model: primaryModel.id,
      protocol: primary.protocol,
      url: primary.url,
      error: primaryError ?? 'All candidate models failed to respond.',
      fallbackErrors,
      timestamp: nowUtc(),
    },
    pendingApprovals,
  };
}
