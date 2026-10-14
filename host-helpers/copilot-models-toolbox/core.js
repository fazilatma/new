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
      models.push({
        kind: 'openai',
        vendor,
        provider,
        id,
        configuredName: String(model.name || '').trim(),
        url,
        apiKey: credentialReference ? '' : configuredKey,
        credentialReference,
      });
    }
  }
  return { models, ollamaGroups, warnings };
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
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key|token|api)[-_][A-Za-z0-9._~+\/-]{8,}\b/gi, '[REDACTED]')
    .replace(/([?&](?:api_?key|key|token|access_token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\$\{input:chat\.lm\.secret\.[^}]+\}/g, '[SECRET_REFERENCE]')
    .replace(/(https?:\/\/[^/\s"']+)\/[^\s"']+/gi, '$1/[PATH]')
    .replace(/\/data\/(?:data|user\/0)\/com\.termux\/files\/home\/[\w./-]+/g, '$HOME/[PATH]')
    .replace(/\/(?:home|Users)\/[\w.-]+\/[\w./-]+/g, '$HOME/[PATH]')
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
  resolveRemoteModel,
  sanitizeDiagnosticText,
  isChatSecretReference,
  ollamaUrl,
  requestJson,
  validateCatalog,
};
