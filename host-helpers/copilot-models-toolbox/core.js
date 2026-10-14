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
        const redirected = new URL(location, parsed).toString();
        cleanupAbort();
        httpRequest(redirected, {
          ...options,
          method: status === 303 ? 'GET' : method,
          body: status === 303 ? undefined : body,
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
      models.push({
        kind: 'openai',
        provider,
        id,
        url,
        apiKey: typeof group.apiKey === 'string' ? group.apiKey : '',
      });
    }
  }
  return { models, ollamaGroups, warnings };
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

function compactError(text, apiKey = '') {
  let output = String(text || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (apiKey) {
    output = output.split(apiKey).join('[REDACTED]');
  }
  return output.length > 300 ? output.slice(0, 297) + '...' : output;
}

module.exports = {
  chatCompletionsUrl,
  collectConfiguredModels,
  compactError,
  httpRequest,
  ollamaUrl,
  requestJson,
  validateCatalog,
};
