'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_RESPONSE_BYTES = 1024 * 1024;

function chatCompletionsUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported endpoint protocol: ${parsed.protocol}`);
  }
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/chat/completions')) {
    pathname += '/chat/completions';
  }
  parsed.pathname = pathname;
  return parsed.toString();
}

function modelsUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported endpoint protocol: ${parsed.protocol}`);
  }
  let pathname = parsed.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/(?:chat\/completions|responses)$/i, '');
  if (!pathname.endsWith('/models')) pathname += '/models';
  parsed.pathname = pathname;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function modelNameVariants(...values) {
  const variants = new Set();
  for (const input of values) {
    const value = String(input || '').trim().toLowerCase();
    if (!value) continue;
    const candidates = [value, value.replace(/^models\//, '')];
    const basename = value.split('/').filter(Boolean).pop();
    if (basename) candidates.push(basename);
    for (const candidate of candidates) {
      variants.add(candidate);
      variants.add(candidate.replace(/[\s_.]+/g, '-'));
      variants.add(candidate.replace(/[^a-z0-9]+/g, ''));
    }
  }
  variants.delete('');
  return variants;
}

function resolveRemoteModel(model, remoteModels) {
  const available = (Array.isArray(remoteModels) ? remoteModels : [])
    .map((entry) =>
      typeof entry === 'string'
        ? { id: entry, name: '' }
        : {
            id: String((entry && (entry.id || entry.model || entry.modelId || entry.name)) || '').trim(),
            name: String((entry && (entry.display_name || entry.displayName || entry.name)) || '').trim(),
          }
    )
    .filter((entry) => entry.id);
  const configuredId = String(model && model.id || '').trim();
  const exact = available.filter((entry) => entry.id === configuredId);
  if (exact.length === 1) return { id: exact[0].id, reason: 'exact' };
  const caseInsensitive = available.filter(
    (entry) => entry.id.toLowerCase() === configuredId.toLowerCase()
  );
  if (caseInsensitive.length === 1) {
    return { id: caseInsensitive[0].id, reason: 'case-corrected' };
  }
  const wanted = modelNameVariants(configuredId, model && model.configuredName);
  const matches = available.filter((entry) => {
    const candidate = modelNameVariants(entry.id, entry.name);
    return [...wanted].some((value) => candidate.has(value));
  });
  return matches.length === 1
    ? { id: matches[0].id, reason: 'name-resolved' }
    : undefined;
}

function ollamaUrl(rawUrl, suffix) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported Ollama protocol: ${parsed.protocol}`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') + suffix;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function httpRequest(rawUrl, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 30000,
    signal,
    maxBytes = MAX_RESPONSE_BYTES,
    redirects = 3,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!transport) {
      reject(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
      return;
    }

    const request = transport.request(parsed, { method, headers }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirects > 0) {
        response.resume();
        const redirectedUrl = new URL(location, parsed);
        const redirected = redirectedUrl.toString();
        const redirectedHeaders = { ...headers };
        if (redirectedUrl.origin !== parsed.origin) {
          for (const key of Object.keys(redirectedHeaders)) {
            if (key.toLowerCase() === 'authorization') delete redirectedHeaders[key];
          }
        }
        cleanupAbort();
        httpRequest(redirected, {
          ...options,
          method: status === 303 ? 'GET' : method,
          body: status === 303 ? undefined : body,
          headers: redirectedHeaders,
          redirects: redirects - 1,
        }).then(resolve, reject);
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error(`Response exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        cleanupAbort();
        resolve({
          status,
          headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    const abort = () => request.destroy(new Error('Cancelled'));
    const cleanupAbort = () => {
      if (signal) {
        signal.removeEventListener('abort', abort);
      }
    };
    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
    }
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    request.on('error', (error) => {
      cleanupAbort();
      reject(error);
    });
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

function requestJson(rawUrl, payload, options = {}) {
  const body = JSON.stringify(payload);
  return httpRequest(rawUrl, {
    ...options,
    method: options.method || 'POST',
    body,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(options.headers || {}),
    },
  });
}

function isChatSecretReference(value) {
  return /^\$\{input:chat\.lm\.secret\.[^}]+\}$/.test(String(value || '').trim());
}

function collectConfiguredModels(groups) {
  if (!Array.isArray(groups)) {
    throw new Error('chatLanguageModels.json must contain a JSON array');
  }
  const models = [];
  const ollamaGroups = [];
  const warnings = [];

  for (const group of groups) {
    if (!group || typeof group !== 'object') {
      continue;
    }
    const vendor = String(group.vendor || '').toLowerCase();
    const provider = String(group.name || vendor || 'Unknown provider');
    if (vendor === 'ollama') {
      if (typeof group.url === 'string' && group.url) {
        ollamaGroups.push({ provider, url: group.url });
      } else {
        warnings.push(`${provider}: missing Ollama URL`);
      }
      continue;
    }
    if (vendor !== 'customoai') {
      continue;
    }
    if (!Array.isArray(group.models)) {
      warnings.push(`${provider}: model list is missing`);
      continue;
    }
    for (const model of group.models) {
      if (!model || typeof model !== 'object') {
        continue;
      }
      const id = String(model.id || '').trim();
      const url = String(model.url || '').trim();
      if (!id || !url) {
        warnings.push(`${provider}: skipped a model with no id or URL`);
        continue;
      }
      const configuredKey = typeof group.apiKey === 'string' ? group.apiKey.trim() : '';
      const credentialReference = isChatSecretReference(configuredKey) ? configuredKey : '';
      const reasoningEfforts = Array.isArray(model.supportsReasoningEffort)
        ? model.supportsReasoningEffort.map((value) => String(value))
        : [];
      models.push({
        kind: 'openai',
        vendor,
        provider,
        id,
        configuredName: String(model.name || '').trim(),
        url,
        apiKey: credentialReference ? '' : configuredKey,
        credentialReference,
        toolCalling: typeof model.toolCalling === 'boolean' ? model.toolCalling : null,
        vision: typeof model.vision === 'boolean' ? model.vision : null,
        streaming: typeof model.streaming === 'boolean' ? model.streaming : null,
        maxInputTokens: Number.isSafeInteger(model.maxInputTokens) ? model.maxInputTokens : null,
        maxOutputTokens: Number.isSafeInteger(model.maxOutputTokens) ? model.maxOutputTokens : null,
        contextWindow: Number.isSafeInteger(model.contextWindow) ? model.contextWindow : null,
        reasoning:
          model.thinking === true ||
          model.adaptiveThinking === true ||
          reasoningEfforts.length > 0,
        reasoningKnown:
          Object.prototype.hasOwnProperty.call(model, 'thinking') ||
          Object.prototype.hasOwnProperty.call(model, 'adaptiveThinking') ||
          Object.prototype.hasOwnProperty.call(model, 'supportsReasoningEffort') ||
          Object.prototype.hasOwnProperty.call(model, 'toolCalling'),
        reasoningEfforts,
      });
    }
  }
  return { models, ollamaGroups, warnings };
}

function modelPower(model) {
  if (!model || typeof model !== 'object') {
    return { score: null, label: 'Unknown', basis: 'No capability metadata' };
  }
  let score = 0;
  let known = false;
  const input = Number(model.maxInputTokens);
  if (Number.isFinite(input) && input > 0) {
    known = true;
    score += input >= 1000000 ? 20 : input >= 200000 ? 17 : input >= 128000 ? 14 : input >= 64000 ? 10 : input >= 32000 ? 6 : 3;
  }
  const output = Number(model.maxOutputTokens);
  if (Number.isFinite(output) && output > 0) {
    known = true;
    score += output >= 64000 ? 15 : output >= 32000 ? 12 : output >= 16000 ? 9 : output >= 8000 ? 6 : 3;
  }
  if (model.reasoningKnown === true) {
    known = true;
    if (model.reasoning === true) score += 30;
  }
  for (const [property, points] of [['toolCalling', 20], ['vision', 10], ['streaming', 5]]) {
    if (typeof model[property] === 'boolean') {
      known = true;
      if (model[property]) score += points;
    }
  }
  if (!known) return { score: null, label: 'Unknown', basis: 'No capability metadata' };
  const bounded = Math.max(0, Math.min(100, score));
  const label = bounded >= 85
    ? 'Exceptional'
    : bounded >= 70
      ? 'Very high'
      : bounded >= 50
        ? 'High'
        : bounded >= 25
          ? 'Medium'
          : 'Basic';
  return {
    score: bounded,
    label,
    basis: 'Declared capability index: token limits, reasoning, tool calling, vision, and streaming; not a benchmark',
  };
}

function roundRobinModelRounds(models) {
  const providers = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    const key = `${String(model && model.vendor || '')}\u0000${String(model && model.provider || '')}`;
    if (!providers.has(key)) providers.set(key, []);
    providers.get(key).push(model);
  }
  const queues = [...providers.values()];
  const rounds = [];
  const maximum = queues.reduce((value, queue) => Math.max(value, queue.length), 0);
  for (let index = 0; index < maximum; index += 1) {
    const round = queues.map((queue) => queue[index]).filter(Boolean);
    if (round.length) rounds.push(round);
  }
  return rounds;
}

function roundRobinModels(models) {
  return roundRobinModelRounds(models).flat();
}

function chatModelIdentifier(model) {
  if (!model || typeof model !== 'object') return '';
  const vendor = String(model.vendor || (model.kind === 'ollama' ? 'ollama' : '')).trim();
  const group = String(model.provider || '').trim();
  const id = String(model.resolvedId || model.id || '').trim();
  if (!vendor || !group || !id || id === 'auto') return '';
  return `${vendor}/${group}/${id}`;
}

function validateCatalog(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.providers)) {
    throw new Error('Downloaded catalog has no providers array');
  }
  if (value.providers.length === 0) {
    throw new Error('Downloaded catalog is empty');
  }
  let modelCount = 0;
  for (const provider of value.providers) {
    if (!provider || typeof provider !== 'object') {
      throw new Error('Downloaded catalog contains an invalid provider');
    }
    if (Array.isArray(provider.models)) {
      modelCount += provider.models.length;
    }
  }
  return { providerCount: value.providers.length, modelCount };
}

function sanitizeDiagnosticText(text, secrets = [], maxLength = 4000) {
  let output = String(text || '');
  for (const secret of secrets) {
    if (secret) output = output.split(String(secret)).join('[REDACTED]');
  }
  output = output
    .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Authorization [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:sk|key|token|api)[-_][A-Za-z0-9._~+\/-]{8,}\b/gi, '[REDACTED]')
    .replace(/([?&](?:api_?key|key|token|access_token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api_?key|token|access_?token|password|secret|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/\$\{input:chat\.lm\.secret\.[^}]+\}/g, '[SECRET_REFERENCE]')
    .replace(/(["']?(?:prompt|messages?|content|requestBody|sourceText|documentText)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[[^\]]*\])/gi, '$1[PRIVATE_TEXT]')
    .replace(/(https?:\/\/[^/\s"']+)\/[^\s"']+/gi, '$1/[PATH]')
    .replace(/file:\/\/{2,}[^\s"']+/gi, 'file:///[LOCAL_PATH]')
    .replace(/\/data\/(?:data|user\/0)\/com\.termux\/files\/home\/[\w./@+-]+/g, '$HOME/[PATH]')
    .replace(/\/(?:home|Users)\/[\w.@+-]+\/[\w./@+-]+/g, '$HOME/[PATH]')
    .replace(/(^|[\s"'(=:])\/(?:[\w.@+-]+\/)+[\w.@+:-]+/g, '$1/[LOCAL_PATH]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return output.length <= maxLength ? output : output.slice(0, maxLength - 3) + '...';
}

function compactError(text, apiKey = '', maxLength = 8000) {
  let output = String(text || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (apiKey) {
    output = output.split(apiKey).join('[REDACTED]');
  }
  if (output.length <= maxLength) return output;
  return output.slice(0, Math.max(0, maxLength - 3)) + '...';
}

module.exports = {
  chatCompletionsUrl,
  chatModelIdentifier,
  collectConfiguredModels,
  compactError,
  httpRequest,
  modelsUrl,
  modelNameVariants,
  modelPower,
  resolveRemoteModel,
  sanitizeDiagnosticText,
  isChatSecretReference,
  ollamaUrl,
  requestJson,
  roundRobinModelRounds,
  roundRobinModels,
  validateCatalog,
};
