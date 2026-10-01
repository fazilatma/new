#!/usr/bin/env node
/**
 * Authenticated OpenHands model/provider manager.
 *
 * Secrets are accepted only over the protected same-origin API and are handed
 * directly to the official Provider Connections API. They are never logged or
 * included in exports. The local routing adapter is bound to 127.0.0.1 only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const managerPort = Number(process.env.OH_MODEL_MANAGER_PORT || "18819");
const localModelPort = Number(process.env.OH_LOCAL_MODEL_PORT || "18820");
const backendPort = Number(process.env.OH_MODEL_MANAGER_BACKEND_PORT || "18810");
const sessionKey = process.env.LOCAL_BACKEND_API_KEY || "";
const basePathRaw = process.env.OH_GATEWAY_BASE_PATH || "/open";
const basePath = basePathRaw === "/" ? "" : `/${basePathRaw.replace(/^\/+|\/+$/g, "")}`;
const configFile = process.env.OH_MODEL_MANAGER_CONFIG_FILE || "";
const dataDir = process.env.OH_MODEL_MANAGER_DATA_DIR || "";
const toolsDir = process.env.OH_MODEL_MANAGER_TOOLS_DIR || "";
const uvBin = process.env.OH_MODEL_MANAGER_UV_BIN || "uv";
const testerScript = process.env.OH_MODEL_MANAGER_TESTER || "";
const workspace = process.env.OH_MODEL_MANAGER_WORKSPACE || process.cwd();
const backend = `http://127.0.0.1:${backendPort}`;
const apiPrefix = "/_openhands/models-api";
const modelsPage = "/models";
const registryFile = path.join(dataDir, "local-models.json");
const importedSnapshotFile = path.join(dataDir, "providers-last-import.json");
const testResultsFile = path.join(dataDir, "last-model-tests.json");
const localLogFile = path.join(dataDir, "local-model.log");
const llamaHome = path.join(toolsDir, "llama.cpp");
const llamaServerLink = path.join(llamaHome, "llama-server");
const modelsDir = path.join(dataDir, "models");
const jobs = new Map();
const jobControllers = new Map();
const managedSubprocesses = new Set();
let localModelProcess = null;
let localModelName = null;
let localModelReady = false;
let localModelStartedAt = null;
let localModelLastExit = null;
let profileTestPromise = null;

const MIN_CONTEXT_WINDOW = 16384;
const DEFAULT_PROXY_TEMPLATE = "https://proxy.fazilat-ma.workers.dev/?url={url}";
const DEFAULT_CONFIG = {
  version: 1,
  proxyTemplate: DEFAULT_PROXY_TEMPLATE,
  defaultMode: "direct-fallback",
  routes: {
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      targetBaseUrl: "https://openrouter.ai",
      mode: "direct-fallback",
    },
  },
};

if (![managerPort, localModelPort, backendPort].every(Number.isInteger) || !sessionKey || !configFile || !dataDir || !toolsDir) {
  console.error("[openhands-model-manager] Required configuration is missing.");
  process.exit(2);
}

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(toolsDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(modelsDir, { recursive: true, mode: 0o700 });

function atomicJson(file, value, mode = 0o600) {
  const temp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, file);
}

function readJson(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMode(value) {
  return ["direct", "direct-fallback", "proxy-only"].includes(value) ? value : "direct-fallback";
}

function validProxyTemplate(value) {
  if (typeof value !== "string" || !value.includes("{url}") || value.length > 2048) return false;
  try {
    return new URL(value.replace("{url}", encodeURIComponent("https://example.invalid"))).protocol === "https:";
  } catch {
    return false;
  }
}

function loadConfig() {
  const stored = readJson(configFile, {});
  const routes = stored.routes && typeof stored.routes === "object" ? stored.routes : {};
  return {
    version: 1,
    proxyTemplate: validProxyTemplate(stored.proxyTemplate) ? stored.proxyTemplate : DEFAULT_PROXY_TEMPLATE,
    defaultMode: normalizeMode(stored.defaultMode),
    routes: { ...DEFAULT_CONFIG.routes, ...routes },
  };
}

function saveConfig(config) {
  atomicJson(configFile, config);
}

if (!fs.existsSync(configFile)) saveConfig(DEFAULT_CONFIG);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticated(req) {
  return safeEqual(req.headers["x-session-api-key"], sessionKey);
}

function secureHeaders(type = "application/json; charset=utf-8") {
  return {
    "cache-control": "no-store, max-age=0",
    "content-type": type,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
}

function sendJson(res, status, value, extra = {}) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  res.writeHead(status, { ...secureHeaders(), "content-length": String(body.length), ...extra });
  res.end(body);
}

function publicError(error) {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");
  message = message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/(api[_ -]?key|authorization|bearer)(\s*[:=]?\s*)[^\s,;]+/gi, "$1$2[REDACTED]");
  return message.slice(0, 800);
}

async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function backendRequest(endpoint, options = {}) {
  const response = await fetch(`${backend}${endpoint}`, {
    ...options,
    headers: {
      "X-Session-API-Key": sessionKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) throw new Error(`OpenHands API ${response.status}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return value;
}

function slug(value, fallback = "item") {
  const result = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return result || fallback;
}

function uniqueProfileName(provider, model, existing) {
  const base = slug(`${provider}-${String(model).replace(/[/:]+/g, "-")}`, "imported-model").slice(0, 64);
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base.slice(0, 60 - String(index).length)}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base.slice(0, 54)}-${crypto.randomBytes(4).toString("hex")}`;
}

const KEY_NAMES = new Set(["apikey", "apikeys", "api_key", "api_keys", "key", "keys", "token", "tokens", "secret", "secrets", "authorization", "bearertoken", "access_token"]);
function redactDocument(value, key = "", depth = 0) {
  if (depth > 20) return null;
  if (KEY_NAMES.has(String(key).toLowerCase())) return null;
  if (Array.isArray(value)) return value.map((item) => redactDocument(item, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactDocument(item, name, depth + 1)]));
  }
  return value;
}

function firstString(object, names) {
  for (const name of names) {
    if (typeof object?.[name] === "string" && object[name].trim()) return object[name].trim();
  }
  return "";
}

const MODEL_ID_FIELDS = ["id", "model", "modelId", "model_id", "modelName", "model_name", "slug", "canonicalSlug", "canonical_slug", "value"];
const MODEL_COLLECTION_FIELDS = new Set(["models", "modelList", "model_list", "availableModels", "available_models", "modelCatalog", "model_catalog"]);
const GENERIC_MODEL_COLLECTION_FIELDS = new Set(["data", "items", "results"]);
const GENERIC_PARENT_NAMES = new Set(["", "root", "imported", "providers", "provider", "data", "items", "results", "models"]);

function modelInfo(source) {
  if (typeof source === "string") return { id: source.trim(), name: source.trim(), source: {} };
  if (!source || typeof source !== "object" || Array.isArray(source)) return { id: "", name: "", source: {} };
  const id = firstString(source, MODEL_ID_FIELDS);
  const name = firstString(source, ["name", "displayName", "display_name", "label", "title", "modelName", "model_name"]) || id;
  return { id, name, source };
}

function normalizeModelCollection(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" || (item && typeof item === "object" && !Array.isArray(item)));
  if (!value || typeof value !== "object") return [];
  const models = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      models.push(/^\d+$/.test(key) ? item : { id: key, name: item });
    } else if (item === true) {
      models.push({ id: key, name: key });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      models.push(modelInfo(item).id || /^\d+$/.test(key) ? item : { id: key, ...item });
    }
  }
  return models;
}

function looksLikeModelRecord(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(modelInfo(value).id);
}

function hasModelCollection(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).some(([name, item]) => (MODEL_COLLECTION_FIELDS.has(name) || GENERIC_MODEL_COLLECTION_FIELDS.has(name))
      && normalizeModelCollection(item).some(looksLikeModelRecord)));
}

function collectProviderDocuments(document) {
  const found = [];
  const flatModels = [];
  const seen = new Set();

  function addCandidate(source, collection, parentName) {
    const models = normalizeModelCollection(collection).filter(looksLikeModelRecord);
    if (models.length) found.push({ source: source && typeof source === "object" && !Array.isArray(source) ? source : {}, models, parentName });
  }

  function visit(value, parentName = "imported", depth = 0, owner = null) {
    if (depth > 14 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const records = value.filter(looksLikeModelRecord);
      const containsProviders = value.some(hasModelCollection);
      if (!containsProviders && records.length && records.length === value.filter((item) => item != null).length) {
        const source = owner && typeof owner === "object" && !Array.isArray(owner) ? owner : {};
        addCandidate(source, records, parentName);
        return;
      }
      for (const item of value) visit(item, parentName, depth + 1, owner);
      return;
    }

    const consumed = new Set();
    for (const [name, collection] of Object.entries(value)) {
      const direct = MODEL_COLLECTION_FIELDS.has(name);
      const generic = GENERIC_MODEL_COLLECTION_FIELDS.has(name);
      if ((direct || generic) && normalizeModelCollection(collection).some(looksLikeModelRecord)) {
        addCandidate(value, collection, parentName);
        consumed.add(name);
      }
    }
    if (!consumed.size && looksLikeModelRecord(value)) flatModels.push(value);
    for (const [name, item] of Object.entries(value)) {
      if (consumed.has(name)) continue;
      visit(item, name, depth + 1, value);
    }
  }

  visit(document);
  if (!found.length && flatModels.length) {
    const groups = new Map();
    for (const model of flatModels) {
      const key = [firstString(model, ["provider", "providerName", "provider_name", "providerId", "provider_id", "type", "vendor"]) || "Imported", firstString(model, ["baseUrl", "baseURL", "base_url", "apiBase", "api_base", "endpoint"]), firstString(model, ["apiKey", "api_key", "key", "token"])].join("\u0000");
      if (!groups.has(key)) groups.set(key, { source: model, models: [], parentName: "imported" });
      groups.get(key).models.push(model);
    }
    found.push(...groups.values());
  }
  if (!found.length && document && typeof document === "object" && !Array.isArray(document)) {
    const mapped = normalizeModelCollection(document).filter(looksLikeModelRecord);
    if (mapped.length) found.push({ source: {}, models: mapped, parentName: "imported" });
  }
  return found;
}

function providerInfo(candidate) {
  const source = candidate.source || {};
  const sample = candidate.models.find((item) => item && typeof item === "object" && !Array.isArray(item)) || {};
  const nested = source.connection || source.credentials || source.config || source.settings || {};
  const explicitProvider = firstString(source, ["provider", "providerName", "provider_name", "providerId", "provider_id", "type", "vendor", "id", "slug"])
    || firstString(sample, ["provider", "providerName", "provider_name", "providerId", "provider_id", "type", "vendor"]);
  const parentProvider = GENERIC_PARENT_NAMES.has(String(candidate.parentName || "").toLowerCase()) ? "" : candidate.parentName;
  let baseUrl = firstString(source, ["baseUrl", "baseURL", "base_url", "apiBase", "api_base", "apiUrl", "api_url", "endpoint", "url"])
    || firstString(nested, ["baseUrl", "baseURL", "base_url", "apiBase", "api_base", "endpoint"])
    || firstString(sample, ["baseUrl", "baseURL", "base_url", "apiBase", "api_base", "endpoint"]);
  let providerHint = explicitProvider || parentProvider || "";
  if (!providerHint && /openrouter\.ai/i.test(baseUrl)) providerHint = "openrouter";
  if (!providerHint && candidate.models.some((item) => /^openrouter\//i.test(modelInfo(item).id))) providerHint = "openrouter";
  const displayName = firstString(source, ["name", "displayName", "display_name", "label", "providerName", "provider_name"])
    || providerHint || candidate.parentName || "Imported Provider";
  const provider = slug(providerHint || displayName, "custom");
  if (!baseUrl && provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
  let apiKey = firstString(source, ["apiKey", "api_key", "key", "token", "secret"])
    || firstString(nested, ["apiKey", "api_key", "key", "token", "secret"])
    || firstString(sample, ["apiKey", "api_key", "key", "token", "secret"]);
  const apiKeys = source.apiKeys || source.api_keys || nested.apiKeys || nested.api_keys;
  if (!apiKey && Array.isArray(apiKeys) && apiKeys.length) {
    apiKey = typeof apiKeys[0] === "string" ? apiKeys[0] : firstString(apiKeys[0], ["apiKey", "api_key", "key", "token", "value"]);
  }
  return { displayName, provider, baseUrl, apiKey };
}

function canonicalModel(provider, id) {
  let model = String(id || "").trim();
  if (!model) return "";
  if (provider === "openrouter" || provider.includes("openrouter")) {
    if (!model.startsWith("openrouter/")) model = `openrouter/${model}`;
    return model;
  }
  if (model.includes("/")) return model;
  const prefixes = { xai: "xai", "x-ai": "xai", groq: "groq", cerebras: "cerebras", cohere: "cohere", openai: "openai", anthropic: "anthropic", gemini: "gemini" };
  const prefix = prefixes[provider];
  return prefix ? `${prefix}/${model}` : model;
}

function numericField(source, names) {
  for (const name of names) {
    const value = Number(source?.[name]);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return null;
}

function routeForBase(provider, displayName, baseUrl, mode) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") throw new Error(`Provider ${displayName} must use an HTTPS base URL`);
  const routeId = slug(provider, "provider");
  const config = loadConfig();
  config.routes[routeId] = {
    id: routeId,
    name: displayName,
    targetBaseUrl: parsed.origin,
    mode: normalizeMode(mode || config.defaultMode),
  };
  saveConfig(config);
  const suffix = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return { routeId, adapterBaseUrl: `http://127.0.0.1:${managerPort}/routes/${routeId}${suffix}` };
}

async function importProviders(body) {
  const document = body?.document;
  if (!document || typeof document !== "object") throw new Error("The imported JSON must contain an object or array");
  const importSecrets = body.importSecrets === true;
  const overwrite = body.overwrite === true;
  const candidates = collectProviderDocuments(document);
  if (!candidates.length) throw new Error("No models were recognized. Use a provider models/modelList object, a data array, a flat model array, or a model-ID map.");
  const list = await backendRequest("/api/profiles");
  const connectionsResponse = await backendRequest("/api/llm/provider-connections");
  const connections = Array.isArray(connectionsResponse) ? connectionsResponse : (connectionsResponse?.connections || []);
  const existing = new Set((list?.profiles || []).map((profile) => profile.name));
  const summary = {
    providers: 0,
    detectedModels: candidates.reduce((total, candidate) => total + candidate.models.length, 0),
    connectionsCreated: 0,
    profilesCreated: 0,
    profilesExisting: 0,
    profilesLinked: 0,
    profilesUpdated: 0,
    contextWindowsAdjusted: 0,
    skipped: 0,
    profileNames: [],
    warnings: [],
  };

  for (const candidate of candidates) {
    const info = providerInfo(candidate);
    const requestedMode = firstString(candidate.source, ["proxyMode", "proxy_mode", "connectionMode", "connection_mode"])
      || (candidate.source.proxyOnly === true ? "proxy-only" : candidate.source.useProxy === true || candidate.source.proxyEnabled === true ? "direct-fallback" : "");
    const mode = normalizeMode(requestedMode || loadConfig().defaultMode);
    let effectiveBase = info.baseUrl;
    let routeId = null;
    if (effectiveBase && !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(effectiveBase)) {
      const routed = routeForBase(info.provider, info.displayName, effectiveBase, mode);
      routeId = routed.routeId;
      effectiveBase = routed.adapterBaseUrl;
    }
    let connectionId = null;
    if (importSecrets && info.apiKey) {
      const reusable = connections.find((item) => item.provider === info.provider && item.display_name === info.displayName);
      if (reusable) {
        connectionId = reusable.id;
        summary.warnings.push(`Existing encrypted connection kept unchanged: ${info.displayName}`);
      } else {
        const created = await backendRequest("/api/llm/provider-connections", {
          method: "POST",
          body: JSON.stringify({ display_name: info.displayName, provider: info.provider, api_key: info.apiKey, base_url: effectiveBase || null }),
        });
        connectionId = created.id;
        connections.push(created);
        summary.connectionsCreated += 1;
      }
    } else if (info.apiKey && !importSecrets) {
      summary.warnings.push(`Credential found but intentionally not imported for ${info.displayName}; enable secret import to create its encrypted Provider Connection.`);
    }
    summary.providers += 1;

    for (const rawModel of candidate.models) {
      const model = modelInfo(rawModel);
      const modelId = canonicalModel(info.provider, model.id);
      if (!modelId) { summary.skipped += 1; continue; }
      const requestedProfileName = firstString(model.source, ["profileName", "profile_name"]);
      const preferredName = slug(requestedProfileName || `${info.provider}-${model.name || model.id}`, "imported-model").slice(0, 64);
      const profileName = existing.has(preferredName) || requestedProfileName
        ? preferredName
        : uniqueProfileName(info.provider, model.name || model.id, existing);
      let existingConfig = {};
      let replacing = false;

      if (existing.has(profileName)) {
        const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`);
        existingConfig = detail.config || {};
        if (!overwrite) {
          if (existingConfig.model !== modelId) {
            summary.warnings.push(`Name conflict skipped without overwrite: ${profileName}`);
            summary.skipped += 1;
            continue;
          }
          summary.profilesExisting += 1;
          summary.profileNames.push(profileName);
          // A same-model import remains non-destructive, but a context value
          // that OpenHands itself cannot run is safe to raise when the secret
          // lives in a Provider Connection (or no inline secret exists).
          const shortContext = Number(existingConfig.max_input_tokens || 0) > 0
            && Number(existingConfig.max_input_tokens) < MIN_CONTEXT_WINDOW;
          const linkSeededProfile = connectionId && SEEDED_OPENROUTER_PROFILES.has(profileName)
            && !existingConfig.provider_connection_id && !detail.api_key_set;
          if ((shortContext || linkSeededProfile) && !(detail.api_key_set && !existingConfig.provider_connection_id)) {
            const llm = {
              ...existingConfig,
              api_key: undefined,
              ...(shortContext ? { max_input_tokens: MIN_CONTEXT_WINDOW } : {}),
              ...(linkSeededProfile && effectiveBase ? { base_url: effectiveBase } : {}),
              ...(linkSeededProfile ? { provider_connection_id: connectionId } : {}),
            };
            await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
              method: "POST",
              body: JSON.stringify({ llm, include_secrets: false }),
            });
            if (shortContext) summary.contextWindowsAdjusted += 1;
            if (linkSeededProfile) summary.profilesLinked += 1;
          }
          continue;
        }
        if (detail.api_key_set && !existingConfig.provider_connection_id) {
          summary.warnings.push(`Skipped inline-key profile to protect its credential: ${profileName}`);
          summary.skipped += 1;
          continue;
        }
        replacing = true;
      }

      const suppliedMaxInput = numericField(model.source, ["maxInputTokens", "max_input_tokens", "contextLength", "context_length", "contextWindow", "context_window"]);
      const existingMaxInput = numericField(existingConfig, ["max_input_tokens"]);
      const maxInput = Math.max(MIN_CONTEXT_WINDOW, suppliedMaxInput || existingMaxInput || MIN_CONTEXT_WINDOW);
      if ((suppliedMaxInput && suppliedMaxInput < MIN_CONTEXT_WINDOW)
          || (!suppliedMaxInput && existingMaxInput && existingMaxInput < MIN_CONTEXT_WINDOW)) {
        summary.contextWindowsAdjusted += 1;
      }
      const maxOutput = numericField(model.source, ["maxOutputTokens", "max_output_tokens", "maxTokens", "max_tokens"]);
      const capabilities = model.source.capabilities && typeof model.source.capabilities === "object" ? model.source.capabilities : {};
      const toolCalling = model.source.toolCalling ?? model.source.tool_calling ?? capabilities.toolCalling ?? capabilities.tool_calling ?? capabilities.tools ?? true;
      const llm = {
        ...existingConfig,
        api_key: undefined,
        model: modelId,
        ...(effectiveBase ? { base_url: effectiveBase } : {}),
        ...(connectionId ? { provider_connection_id: connectionId } : {}),
        max_input_tokens: maxInput,
        ...(maxOutput ? { max_output_tokens: maxOutput } : {}),
        native_tool_calling: Boolean(toolCalling),
        api_mode: "chat",
        drop_params: true,
      };
      await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
        method: "POST",
        body: JSON.stringify({ llm, include_secrets: false }),
      });
      existing.add(profileName);
      summary.profileNames.push(profileName);
      if (replacing) summary.profilesUpdated += 1;
      else summary.profilesCreated += 1;
      if (routeId && !connectionId) summary.warnings.push(`Profile ${profileName} needs a Provider Connection before use.`);
    }
  }

  summary.profileNames = [...new Set(summary.profileNames)];
  // Preserve the submitted shape for auditing/round-tripping, but permanently
  // strip credential fields before it touches disk.
  atomicJson(importedSnapshotFile, { importedAt: new Date().toISOString(), document: redactDocument(document) });
  return summary;
}

function portableBaseUrl(value) {
  const input = String(value || "");
  const match = input.match(new RegExp(`^http://127\\.0\\.0\\.1:${managerPort}/routes/([a-z0-9._-]+)(/.*)?$`));
  if (!match) return { baseUrl: input || null, proxyMode: null };
  const route = loadConfig().routes[match[1]];
  if (!route) return { baseUrl: input, proxyMode: null };
  return { baseUrl: `${String(route.targetBaseUrl).replace(/\/$/, "")}${match[2] || ""}`, proxyMode: normalizeMode(route.mode) };
}

async function exportProviders() {
  const list = await backendRequest("/api/profiles");
  const connections = await backendRequest("/api/llm/provider-connections");
  const tests = readJson(testResultsFile, { results: [] });
  const byTest = new Map((tests.results || []).map((result) => [result.name, result]));
  const providers = new Map();
  for (const connection of connections) {
    const portable = portableBaseUrl(connection.base_url);
    providers.set(connection.id, {
      id: connection.id,
      name: connection.display_name,
      provider: connection.provider,
      enabled: true,
      apiKey: null,
      apiKeySet: connection.api_key_set,
      baseUrl: portable.baseUrl,
      proxyMode: portable.proxyMode,
      models: [],
    });
  }
  for (const profile of list?.profiles || []) {
    const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profile.name)}`);
    const config = detail.config || {};
    const connection = config.provider_connection_id ? providers.get(config.provider_connection_id) : null;
    const providerName = connection?.provider || String(config.model || "custom").split("/")[0] || "custom";
    const key = connection ? connection.id : `profile:${providerName}`;
    if (!providers.has(key)) {
      const portable = portableBaseUrl(config.base_url);
      providers.set(key, { id: providerName, name: providerName, provider: providerName, enabled: true, apiKey: null, apiKeySet: detail.api_key_set, baseUrl: portable.baseUrl, proxyMode: portable.proxyMode, models: [] });
    }
    const test = byTest.get(profile.name) || null;
    providers.get(key).models.push({
      id: config.model,
      name: config.model,
      profileName: profile.name,
      enabled: true,
      available: test ? Boolean(test.ok) : null,
      rateLimited: Boolean(test?.error?.type?.toLowerCase().includes("ratelimit")),
      contextLength: config.max_input_tokens || null,
      maxOutputTokens: config.max_output_tokens || null,
      capabilities: { toolCalling: config.native_tool_calling !== false, vision: config.disable_vision !== true },
      testDetails: test ? { ok: test.ok, latencyMs: test.latencyMs, error: test.error || null } : null,
    });
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    secretsIncluded: false,
    proxy: loadConfig(),
    providers: [...providers.values()],
  };
}

async function testProfiles(body) {
  if (profileTestPromise) throw new Error("A bulk model test is already running");
  profileTestPromise = runProfileTests(body);
  try { return await profileTestPromise; }
  finally { profileTestPromise = null; }
}

async function runProfileTests(body) {
  const list = await backendRequest("/api/profiles");
  const all = (list?.profiles || []).map((profile) => profile.name);
  const requested = Array.isArray(body?.profiles) ? body.profiles.filter((name) => all.includes(name)) : all;
  if (!requested.length) return { tested: 0, results: [] };
  const info = await backendRequest("/server_info");
  const version = String(info?.version || "").match(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/)?.[0];
  if (!version) throw new Error("Could not determine the installed Agent Server version");
  if (!testerScript || !fs.existsSync(testerScript)) throw new Error("The profile tester is not installed");
  const args = ["run", "--quiet", "--python", "3.12", "--with", `openhands-agent-server==${version}`, "python", testerScript];
  const result = await spawnCollect(uvBin, args, {
    cwd: workspace,
    input: JSON.stringify({ profiles: requested, concurrency: Math.max(1, Math.min(Number(body?.concurrency) || 3, 5)) }),
    timeout: 15 * 60 * 1000,
    maxOutput: 4 * 1024 * 1024,
  });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`Profile tester returned invalid output: ${publicError(result.stderr)}`); }
  atomicJson(testResultsFile, { testedAt: new Date().toISOString(), ...parsed });
  return parsed;
}

function spawnCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    managedSubprocesses.add(child);
    let stdout = "";
    let stderr = "";
    const limit = options.maxOutput || 1024 * 1024;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Command timed out")); }, options.timeout || 120000);
    child.stdout.on("data", (chunk) => { if (stdout.length < limit) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { if (stderr.length < limit) stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); managedSubprocesses.delete(child); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); managedSubprocesses.delete(child); resolve({ code, stdout, stderr }); });
    child.stdin.end(options.input || "");
  });
}

function localModelOptions(source = {}) {
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const integer = (name, fallback, minimum, maximum) => {
    const value = Number(source?.[name]);
    return Number.isSafeInteger(value) ? Math.max(minimum, Math.min(value, maximum)) : fallback;
  };
  const batchSize = integer("batchSize", 512, 1, 4096);
  return {
    contextLength: integer("contextLength", MIN_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW, 1048576),
    threads: integer("threads", Math.max(1, Math.min(cpuCount, Math.ceil(cpuCount * 0.75))), 1, 256),
    batchSize,
    ubatchSize: Math.min(batchSize, integer("ubatchSize", Math.min(256, batchSize), 1, 4096)),
    parallel: integer("parallel", 1, 1, 16),
    mmap: source?.mmap !== false,
    mlock: source?.mlock === true,
  };
}

function loadRegistry() {
  const value = readJson(registryFile, { version: 2, active: null, models: [] });
  const models = Array.isArray(value.models) ? value.models.map((model) => ({ ...model, ...localModelOptions(model) })) : [];
  return { version: 2, active: typeof value.active === "string" ? value.active : null, models };
}

function saveRegistry(registry) {
  atomicJson(registryFile, { ...registry, version: 2 });
}

function managedModelPath(model) {
  if (!model?.name || slug(model.name, "") !== model.name) throw new Error("Unsafe managed model name");
  const expected = path.resolve(modelsDir, `${model.name}.gguf`);
  if (path.resolve(String(model.file || "")) !== expected) throw new Error(`Unsafe managed model path for ${model.name}`);
  return expected;
}

function filesystemStatus() {
  try {
    const stats = fs.statfsSync(modelsDir);
    return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
  } catch { return { freeBytes: null, totalBytes: null }; }
}

function localStatus() {
  const registry = loadRegistry();
  const running = Boolean(localModelProcess && localModelProcess.exitCode === null);
  return {
    active: registry.active,
    running,
    ready: localModelReady,
    runningName: localModelName,
    pid: running ? localModelProcess.pid : null,
    startedAt: localModelStartedAt,
    lastExit: localModelLastExit,
    runtimeInstalled: fs.existsSync(llamaServerLink),
    runtime: readJson(path.join(llamaHome, "runtime.json"), null),
    resources: {
      cpuCount: Math.max(1, os.cpus()?.length || 1),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      ...filesystemStatus(),
    },
    logTail: (() => { try { const data = fs.readFileSync(localLogFile); return data.subarray(Math.max(0, data.length - 32000)).toString("utf8"); } catch { return ""; } })(),
    partialDownloads: (() => { try { return fs.readdirSync(modelsDir).filter((name) => name.endsWith(".gguf.part")).map((filename) => ({ name: filename.slice(0, -10), bytes: fs.statSync(path.join(modelsDir, filename)).size })); } catch { return []; } })(),
    models: registry.models.map((model) => ({
      ...model,
      file: undefined,
      partialBytes: (() => { try { return fs.statSync(`${model.file}.part`).size; } catch { return 0; } })(),
      filePresent: Boolean(model.file && fs.existsSync(model.file)),
    })),
  };
}

function updateJob(id, patch) {
  const current = jobs.get(id) || {};
  jobs.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

function createJob(kind, task) {
  const id = crypto.randomBytes(12).toString("hex");
  const controller = new AbortController();
  jobControllers.set(id, controller);
  jobs.set(id, { id, kind, status: "queued", progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  Promise.resolve().then(async () => {
    updateJob(id, { status: "running" });
    try {
      const result = await task((patch) => updateJob(id, patch), controller.signal);
      updateJob(id, { status: "completed", progress: 100, result });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      updateJob(id, { status: cancelled ? "cancelled" : "failed", error: cancelled ? "Cancelled; the partial download was kept for resume." : publicError(error) });
    } finally {
      jobControllers.delete(id);
    }
  });
  return id;
}

function cancelJob(id) {
  const job = jobs.get(id);
  const controller = jobControllers.get(id);
  if (!job || !controller || !["queued", "running"].includes(job.status)) return false;
  controller.abort(new Error("Cancelled"));
  updateJob(id, { status: "cancelling", message: "Stopping safely; partial download will be retained…" });
  return true;
}

async function hashExistingFile(file, hash, signal) {
  if (!fs.existsSync(file)) return 0;
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    if (signal?.aborted) throw signal.reason || new Error("Cancelled");
    bytes += chunk.length;
    hash.update(chunk);
  }
  return bytes;
}

async function sha256File(file, signal = null) {
  const hash = crypto.createHash("sha256");
  const bytes = await hashExistingFile(file, hash, signal);
  return { bytes, sha256: hash.digest("hex") };
}

const SAFE_ARCHIVE_EXTRACTOR = String.raw`
import json
import inspect
import os
import pathlib
import posixpath
import stat
import sys
import tarfile
import zipfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()
destination.mkdir(parents=True, exist_ok=True)
max_members = 20000
max_unpacked = 2 * 1024 ** 3

def contained(name):
    candidate = (destination / name).resolve()
    try:
        return os.path.commonpath((str(destination), str(candidate))) == str(destination)
    except ValueError:
        return False

if archive.suffix.lower() == ".zip":
    with zipfile.ZipFile(archive) as package:
        members = package.infolist()
        if len(members) > max_members or sum(item.file_size for item in members) > max_unpacked:
            raise ValueError("archive exceeds safe extraction limits")
        for item in members:
            mode = (item.external_attr >> 16) & 0xFFFF
            if not contained(item.filename) or stat.S_ISLNK(mode):
                raise ValueError("archive contains an unsafe path or symbolic link")
        package.extractall(destination)
else:
    with tarfile.open(archive) as package:
        members = package.getmembers()
        if len(members) > max_members or sum(item.size for item in members) > max_unpacked:
            raise ValueError("archive exceeds safe extraction limits")
        names = set()
        links = set()
        for item in members:
            if item.isdev() or item.isfifo():
                raise ValueError("archive contains a device or FIFO")
            if posixpath.isabs(item.name):
                raise ValueError("archive contains an absolute path")
            normalized = posixpath.normpath(item.name)
            if normalized == ".." or normalized.startswith("../") or normalized in names:
                raise ValueError("archive contains an unsafe or duplicate path")
            names.add(normalized)
            if item.issym():
                links.add(normalized)
                target = posixpath.normpath(posixpath.join(posixpath.dirname(normalized), item.linkname))
                if posixpath.isabs(item.linkname) or target == ".." or target.startswith("../"):
                    raise ValueError("archive contains an unsafe symbolic link")
            elif item.islnk():
                target = posixpath.normpath(item.linkname)
                if posixpath.isabs(item.linkname) or target == ".." or target.startswith("../"):
                    raise ValueError("archive contains an unsafe hard link")
        for name in names:
            parent = posixpath.dirname(name)
            while parent not in ("", "."):
                if parent in links:
                    raise ValueError("archive writes through a symbolic-link directory")
                parent = posixpath.dirname(parent)
        if "filter" in inspect.signature(package.extractall).parameters:
            package.extractall(destination, filter="data")
        else:
            package.extractall(destination, members=members)
print(json.dumps({"members": len(members)}))
`;

async function downloadFile(url, destination, update, expectedSha = "", maxBytes = 20 * 1024 ** 3, signal = null) {
  const temp = `${destination}.part`;
  const hash = crypto.createHash("sha256");
  let offset = await hashExistingFile(temp, hash, signal);
  if (offset > maxBytes) throw new Error("Existing partial download exceeds the safety limit");
  const requestHeaders = offset ? { range: `bytes=${offset}-` } : {};
  const timeoutSignal = AbortSignal.timeout(6 * 60 * 60 * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response = await fetch(url, { redirect: "follow", headers: requestHeaders, signal: requestSignal });
  if (response.status === 416 && offset) {
    fs.rmSync(temp, { force: true });
    offset = 0;
    response = await fetch(url, { redirect: "follow", signal: requestSignal });
  }
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
  const resumed = offset > 0 && response.status === 206;
  if (resumed) {
    const contentRange = response.headers.get("content-range") || "";
    if (!contentRange.startsWith(`bytes ${offset}-`)) { fs.rmSync(temp, { force: true }); throw new Error("Download server returned an invalid resume range; partial data was removed"); }
  }
  if (offset && !resumed) offset = 0;
  const contentBytes = Number(response.headers.get("content-length") || "0");
  const total = contentBytes ? offset + contentBytes : 0;
  if (total > maxBytes) throw new Error(`Download exceeds the ${Math.round(maxBytes / 1024 ** 3)} GiB safety limit`);
  if (typeof fs.statfsSync === "function" && contentBytes > 0) {
    const stats = fs.statfsSync(path.dirname(destination));
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free < contentBytes + 512 * 1024 ** 2) throw new Error("Not enough free disk space for this model and a 512 MiB reserve");
  }
  const effectiveHash = offset ? hash : crypto.createHash("sha256");
  const output = fs.createWriteStream(temp, { flags: offset ? "a" : "w", mode: 0o600 });
  let received = offset;
  const input = Readable.fromWeb(response.body);
  await new Promise((resolve, reject) => {
    const fail = (error) => { output.destroy(); reject(error); };
    input.on("data", (chunk) => {
      received += chunk.length;
      if (signal?.aborted) { input.destroy(signal.reason || new Error("Cancelled")); return; }
      if (received > maxBytes) { input.destroy(new Error("Download exceeds the safety limit")); return; }
      effectiveHash.update(chunk);
      if (total) update({ progress: Math.min(95, Math.round((received / total) * 95)), bytesReceived: received, bytesTotal: total, resumed });
      else update({ bytesReceived: received, bytesTotal: null, resumed });
    });
    input.on("error", fail);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(output);
  });
  const digest = effectiveHash.digest("hex");
  if (expectedSha && !safeEqual(digest.toLowerCase(), expectedSha.toLowerCase())) {
    fs.rmSync(temp, { force: true });
    throw new Error("Downloaded file SHA-256 does not match; corrupt partial data was removed");
  }
  fs.renameSync(temp, destination);
  fs.chmodSync(destination, 0o600);
  return { sha256: digest, bytes: received, resumed };
}

const SSL_FREE_LLAMA_X64 = Object.freeze({
  name: "llama-b7716-bin-ubuntu-x64.tar.gz",
  browser_download_url: "https://github.com/ggml-org/llama.cpp/releases/download/b7716/llama-b7716-bin-ubuntu-x64.tar.gz",
  digest: "sha256:c784d9cb5c4392ae2d70c7324a07511674e898b4fa2677afe61f5795dccb5c68",
});

function hostHasSharedLibrary(filename) {
  const triplet = process.arch === "x64" ? "x86_64-linux-gnu" : process.arch === "arm64" ? "aarch64-linux-gnu" : "";
  const candidates = new Set([
    ...(process.env.LD_LIBRARY_PATH || "").split(":").filter(Boolean),
    "/lib", "/usr/lib", "/lib64", "/usr/lib64", "/usr/local/lib", "/usr/local/lib64",
    ...(triplet ? [`/lib/${triplet}`, `/usr/lib/${triplet}`, `/usr/local/lib/${triplet}`] : []),
  ]);
  return [...candidates].some((directory) => fs.existsSync(path.join(directory, filename)));
}

async function ensureLlamaRuntime(update, signal = null) {
  if (fs.existsSync(llamaServerLink)) return llamaServerLink;
  update({ message: "Finding a compatible llama.cpp release…", progress: 1 });
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "";
  if (!arch) throw new Error(`No managed llama.cpp binary is available for ${process.arch}`);
  const sslFreeCompatibility = arch === "x64"
    && (process.env.OH_LLAMA_FORCE_SSL_FREE === "1" || !hostHasSharedLibrary("libssl.so.3"));
  let archive = null;
  if (sslFreeCompatibility) {
    archive = { ...SSL_FREE_LLAMA_X64 };
    update({ message: "OpenSSL 3 is unavailable; using the verified official SSL-free llama.cpp compatibility runtime…", progress: 2 });
  } else {
    const response = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10", {
      headers: { "user-agent": "openhands-host-model-manager", accept: "application/vnd.github+json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub release lookup failed with HTTP ${response.status}`);
    const releases = await response.json();
    for (const release of Array.isArray(releases) ? releases : []) {
      archive = (Array.isArray(release.assets) ? release.assets : []).find((asset) => {
        const name = String(asset.name || "").toLowerCase();
        return name.includes("bin") && (name.includes(`ubuntu-${arch}`) || name.includes(`linux-${arch}`)) && /\.(zip|tar\.gz|tgz)$/.test(name) && !/(cuda|cudart|rocm|vulkan|sycl|kompute|openvino)/.test(name);
      });
      if (archive) break;
    }
  }
  if (!archive?.browser_download_url) throw new Error("No compatible CPU llama.cpp release asset was found");
  fs.mkdirSync(llamaHome, { recursive: true, mode: 0o700 });
  for (const item of fs.readdirSync(llamaHome)) {
    const itemPath = path.join(llamaHome, item);
    if (item.startsWith(".extract-") || item.startsWith("runtime-")) fs.rmSync(itemPath, { recursive: true, force: true });
    else if (/^llama-.*\.(?:zip|tar\.gz|tgz)$/i.test(item) && item !== path.basename(archive.name)) fs.rmSync(itemPath, { force: true });
  }
  const archivePath = path.join(llamaHome, path.basename(archive.name));
  const digest = String(archive.digest || "").startsWith("sha256:") ? String(archive.digest).slice(7) : "";
  let reuseArchive = false;
  if (digest && fs.existsSync(archivePath)) {
    update({ message: `Checking the existing ${archive.name} download…`, progress: 3 });
    const existingArchive = await sha256File(archivePath, signal);
    reuseArchive = safeEqual(existingArchive.sha256.toLowerCase(), digest.toLowerCase());
    if (!reuseArchive) fs.rmSync(archivePath, { force: true });
  }
  if (!reuseArchive) {
    update({ message: `Downloading ${archive.name}…`, progress: 3 });
    await downloadFile(archive.browser_download_url, archivePath, update, digest, 2 * 1024 ** 3, signal);
  } else {
    update({ message: `Using the verified ${archive.name} download…`, progress: 95 });
  }
  if (signal?.aborted) throw signal.reason || new Error("Cancelled");
  update({ message: "Extracting llama.cpp into a clean staging directory…", progress: 96 });
  const staging = fs.mkdtempSync(path.join(llamaHome, ".extract-"));
  fs.chmodSync(staging, 0o700);
  const extracted = await spawnCollect("python3", ["-c", SAFE_ARCHIVE_EXTRACTOR, archivePath, staging], { timeout: 120000 });
  if (extracted.code !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`Could not safely extract llama.cpp: ${publicError(extracted.stderr || extracted.stdout || "unknown extraction error")}`);
  }
  const queue = [staging];
  let binary = "";
  while (queue.length) {
    const directory = queue.shift();
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, item.name);
      if (item.isDirectory()) queue.push(candidate);
      else if (item.name === "llama-server") { binary = candidate; break; }
    }
    if (binary) break;
  }
  if (!binary) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error("The llama.cpp archive did not contain llama-server");
  }
  const runtimeId = digest ? digest.slice(0, 16) : slug(archive.name, "release");
  const runtimeRoot = path.join(llamaHome, `runtime-${runtimeId}`);
  const relativeBinary = path.relative(staging, binary);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.renameSync(staging, runtimeRoot);
  binary = path.join(runtimeRoot, relativeBinary);
  fs.chmodSync(binary, 0o700);
  fs.rmSync(llamaServerLink, { force: true });
  fs.symlinkSync(binary, llamaServerLink);
  update({ message: "Validating the llama.cpp executable…", progress: 98 });
  const version = await spawnCollect(llamaServerLink, ["--version"], { timeout: 15000, maxOutput: 32000 });
  if (version.code !== 0) {
    fs.rmSync(llamaServerLink, { force: true });
    throw new Error(`Downloaded llama.cpp runtime failed validation: ${publicError(version.stderr || version.stdout || `exit code ${version.code}`)}`);
  }
  atomicJson(path.join(llamaHome, "runtime.json"), {
    installedAt: new Date().toISOString(),
    release: archive.name,
    digest: digest || null,
    compatibilityMode: sslFreeCompatibility ? "ssl-free" : "current",
    version: publicError(`${version.stdout}\n${version.stderr}`.trim()),
    architecture: process.arch,
  });
  fs.rmSync(archivePath, { force: true });
  fs.rmSync(path.join(llamaHome, "build"), { recursive: true, force: true });
  return llamaServerLink;
}

function validateModelUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Model URL must use HTTPS");
  if (url.username || url.password || [...url.searchParams.keys()].some((name) => /(token|key|auth|signature|credential)/i.test(name))) {
    throw new Error("Model URL must not contain credentials or signed secret query parameters");
  }
  if (url.hostname.toLowerCase() === "github.com") {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (match) {
      url.hostname = "raw.githubusercontent.com";
      url.pathname = `/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
    }
  }
  if (url.hostname.toLowerCase() === "huggingface.co") url.pathname = url.pathname.replace("/blob/", "/resolve/");
  const host = url.hostname.toLowerCase();
  const allowed = host === "huggingface.co" || host === "hf.co" || host === "github.com" || host === "raw.githubusercontent.com" || host.endsWith(".huggingface.co");
  if (!allowed) throw new Error("Model downloads are restricted to Hugging Face or GitHub HTTPS URLs");
  return url.toString();
}

function modelDownloadUrl(body) {
  const repo = String(body?.repo || "").trim();
  const filename = String(body?.filename || "").trim();
  const revision = String(body?.revision || "main").trim();
  if (repo || filename) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("Hugging Face repo must use owner/repository format");
    if (!filename || filename.startsWith("/") || filename.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("A safe GGUF filename is required");
    if (!/^[A-Za-z0-9._/-]+$/.test(revision) || revision.includes("..")) throw new Error("Invalid Hugging Face revision");
    const encodedFile = filename.split("/").map(encodeURIComponent).join("/");
    return validateModelUrl(`https://huggingface.co/${repo}/resolve/${revision}/${encodedFile}?download=true`);
  }
  return validateModelUrl(body?.url || "");
}

async function searchHuggingFaceGgufModels(body) {
  const query = String(body?.query || "").trim().slice(0, 120);
  const family = String(body?.family || "").trim().slice(0, 60);
  const parameterSize = String(body?.parameterSize || "").trim().slice(0, 24);
  const author = String(body?.author || "").trim().slice(0, 80);
  const license = String(body?.license || "").trim().toLowerCase().slice(0, 60);
  const language = String(body?.language || "").trim().toLowerCase().slice(0, 24);
  const quantization = String(body?.quantization || "").trim().slice(0, 40);
  const maxFileSizeGbRaw = Number(body?.maxFileSizeGb || 0);
  const maxFileSizeGb = Number.isFinite(maxFileSizeGbRaw) && maxFileSizeGbRaw > 0 ? Math.min(maxFileSizeGbRaw, 20) : null;
  const limit = Math.max(1, Math.min(Math.trunc(Number(body?.limit) || 20), 50));
  const requestedSort = ["downloads", "likes", "updated"].includes(String(body?.sort || "")) ? String(body.sort) : "downloads";
  const sort = ({ downloads: "downloads", likes: "likes", updated: "lastModified" })[requestedSort];
  const searchTerms = [query, family, parameterSize].filter(Boolean).join(" ");
  const url = new URL("https://huggingface.co/api/models");
  if (searchTerms) url.searchParams.set("search", searchTerms);
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("sort", sort);
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(Math.min(100, Math.max(limit * 3, limit))));
  url.searchParams.set("full", "true");
  url.searchParams.set("config", "true");
  const response = await fetch(url, { headers: { "user-agent": "openhands-host-model-manager" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Hugging Face model search failed with HTTP ${response.status}`);
  const document = await response.json();
  const candidates = [];
  for (const item of Array.isArray(document) ? document : []) {
    const id = firstString(item, ["id", "modelId"]);
    if (!id || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(id)) continue;
    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    const itemLicense = String(item.cardData?.license || normalizedTags.find((tag) => tag.startsWith("license:"))?.slice(8) || "").toLowerCase();
    const cardLanguages = Array.isArray(item.cardData?.language) ? item.cardData.language : item.cardData?.language ? [item.cardData.language] : [];
    const itemLanguages = cardLanguages.map((value) => String(value).toLowerCase());
    for (const tag of normalizedTags) if (tag.startsWith("language:")) itemLanguages.push(tag.slice(9));
    const architecture = String(item.config?.architectures?.[0] || item.config?.model_type || "");
    const searchable = `${id} ${architecture} ${tags.join(" ")}`.toLowerCase();
    if (author && !id.toLowerCase().startsWith(`${author.toLowerCase()}/`)) continue;
    if (license && itemLicense !== license && !normalizedTags.includes(`license:${license}`)) continue;
    if (language && !itemLanguages.includes(language) && !normalizedTags.includes(language)) continue;
    if (family && !searchable.includes(family.toLowerCase())) continue;
    if (parameterSize && !searchable.includes(parameterSize.toLowerCase())) continue;
    const parameterTag = tags.find((tag) => /(?:^|[-_ ])\d+(?:\.\d+)?[bm](?:$|[-_ ])/i.test(tag)) || null;
    candidates.push({
      id,
      author: id.split("/")[0],
      architecture: architecture || null,
      parameterSize: parameterTag,
      license: itemLicense || null,
      languages: [...new Set(itemLanguages)].slice(0, 12),
      downloads: Number(item.downloads || 0),
      likes: Number(item.likes || 0),
      lastModified: item.lastModified || null,
      pipelineTag: item.pipeline_tag || null,
    });
    if (candidates.length >= Math.min(50, limit * 2)) break;
  }
  const results = [];
  if (quantization || maxFileSizeGb) {
    for (let offset = 0; offset < candidates.length && results.length < limit; offset += 5) {
      const batch = candidates.slice(offset, offset + 5);
      const inspected = await Promise.all(batch.map(async (candidate) => {
        try {
          const listing = await listHuggingFaceGgufFiles({ repo: candidate.id, revision: "main", quantization, maxFileSizeGb });
          if (!listing.files.length) return null;
          return { ...candidate, matchingFileCount: listing.count, suggestedFile: listing.files[0] };
        } catch { return null; }
      }));
      results.push(...inspected.filter(Boolean).slice(0, limit - results.length));
    }
  } else {
    results.push(...candidates.slice(0, limit));
  }
  return {
    criteria: { query, family, parameterSize, quantization, maxFileSizeGb, author, license, language, sort: requestedSort, limit },
    results,
    count: results.length,
  };
}

async function listHuggingFaceGgufFiles(body) {
  const repo = String(body?.repo || "").trim();
  const revision = String(body?.revision || "main").trim();
  const quantization = String(body?.quantization || "").trim().toLowerCase().slice(0, 40);
  const requestedMaxFileSizeGb = Number(body?.maxFileSizeGb || 0);
  const maxFileSizeGb = Number.isFinite(requestedMaxFileSizeGb) && requestedMaxFileSizeGb > 0 ? Math.min(requestedMaxFileSizeGb, 20) : null;
  const maxBytes = maxFileSizeGb ? maxFileSizeGb * 1024 ** 3 : null;
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("Hugging Face repo must use owner/repository format");
  if (!/^[A-Za-z0-9._/-]+$/.test(revision) || revision.includes("..")) throw new Error("Invalid Hugging Face revision");
  const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/${encodeURIComponent(revision)}?recursive=true&expand=false`, {
    headers: { "user-agent": "openhands-host-model-manager" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Hugging Face repository lookup failed with HTTP ${response.status}`);
  const entries = await response.json();
  const allFiles = (Array.isArray(entries) ? entries : []).filter((item) => item?.type === "file" && /\.gguf$/i.test(String(item.path || ""))).map((item) => ({
    filename: String(item.path),
    bytes: Number(item.size || item.lfs?.size || 0) || null,
    sha256: /^[a-f0-9]{64}$/i.test(String(item.lfs?.oid || "")) ? String(item.lfs.oid).toLowerCase() : null,
  }));
  const files = allFiles.filter((file) => (!quantization || file.filename.toLowerCase().includes(quantization))
    && (!maxBytes || (file.bytes !== null && file.bytes <= maxBytes))).slice(0, 500);
  return { repo, revision, quantization: quantization || null, maxFileSizeGb: maxBytes ? maxFileSizeGb : null, totalGgufFiles: allFiles.length, files, count: files.length };
}

function readGgufHeader(file) {
  const descriptor = fs.openSync(file, "r");
  const header = Buffer.alloc(24);
  let bytesRead = 0;
  try { bytesRead = fs.readSync(descriptor, header, 0, header.length, 0); }
  finally { fs.closeSync(descriptor); }
  if (bytesRead < header.length || header.subarray(0, 4).toString("ascii") !== "GGUF") throw new Error("Downloaded file is not a valid GGUF model");
  const version = header.readUInt32LE(4);
  if (version < 2 || version > 3) throw new Error(`Unsupported GGUF version ${version}`);
  return { version, tensorCount: header.readBigUInt64LE(8).toString(), metadataCount: header.readBigUInt64LE(16).toString() };
}

async function installLocalModel(body, update, signal = null) {
  const name = slug(body?.name, "");
  if (!name || name.length > 48) throw new Error("A valid model name is required");
  const url = modelDownloadUrl(body);
  const sha256 = String(body?.sha256 || "").trim().toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("SHA-256 must contain 64 hexadecimal characters");
  const options = localModelOptions(body);
  const replace = body?.replace === true;
  const registry = loadRegistry();
  const existingIndex = registry.models.findIndex((model) => model.name === name);
  const destination = path.join(modelsDir, `${name}.gguf`);
  if ((existingIndex >= 0 || fs.existsSync(destination)) && !replace) throw new Error(`Local model ${name} already exists; enable replace to reinstall it`);
  if (localModelName === name && localModelProcess?.exitCode === null) throw new Error("Stop the running model before replacing it");
  if (replace) fs.rmSync(destination, { force: true });
  const partialMetadataFile = `${destination}.part.json`;
  const partialMetadata = readJson(partialMetadataFile, {});
  if (fs.existsSync(`${destination}.part`) && partialMetadata.url !== url) fs.rmSync(`${destination}.part`, { force: true });
  atomicJson(partialMetadataFile, { url, expectedSha256: sha256 || null, updatedAt: new Date().toISOString() });
  await ensureLlamaRuntime(update, signal);
  update({ message: `Downloading ${name}.gguf (safe resume enabled)…`, progress: 1 });
  const downloaded = await downloadFile(url, destination, update, sha256, 20 * 1024 ** 3, signal);
  fs.rmSync(partialMetadataFile, { force: true });
  let gguf;
  try { gguf = readGgufHeader(destination); }
  catch (error) { fs.rmSync(destination, { force: true }); throw error; }
  const descriptor = {
    name,
    filename: `${name}.gguf`,
    file: destination,
    source: url,
    sha256: downloaded.sha256,
    bytes: downloaded.bytes,
    gguf,
    ...options,
    installedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) registry.models[existingIndex] = descriptor;
  else registry.models.push(descriptor);
  saveRegistry(registry);
  await ensureLocalProfile(name, options.contextLength);
  return { name, sha256: downloaded.sha256, bytes: downloaded.bytes, resumed: downloaded.resumed, gguf, options };
}

async function ensureLocalProfile(name, contextLength) {
  const list = await backendRequest("/api/profiles");
  const profileName = `local-${name}`.slice(0, 64);
  const existing = (list?.profiles || []).some((profile) => profile.name === profileName);
  if (existing) {
    const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`);
    if (detail.config?.model !== `openai/${name}`) throw new Error(`Profile ${profileName} already belongs to another model`);
    await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
      method: "POST",
      body: JSON.stringify({
        llm: { ...detail.config, api_key: undefined, max_input_tokens: contextLength, max_output_tokens: Math.min(8192, Math.floor(contextLength / 2)) },
        include_secrets: false,
      }),
    });
    return profileName;
  }
  const displayName = `Local llama.cpp: ${name}`;
  const connectionsResponse = await backendRequest("/api/llm/provider-connections");
  const connections = Array.isArray(connectionsResponse) ? connectionsResponse : (connectionsResponse?.connections || []);
  let connection = connections.find((item) => item.provider === "openai" && item.display_name === displayName);
  if (!connection) {
    connection = await backendRequest("/api/llm/provider-connections", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, provider: "openai", api_key: "local-no-key", base_url: `http://127.0.0.1:${localModelPort}/v1` }),
    });
  }
  await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
    method: "POST",
    body: JSON.stringify({
      llm: {
        model: `openai/${name}`,
        base_url: `http://127.0.0.1:${localModelPort}/v1`,
        provider_connection_id: connection.id,
        max_input_tokens: contextLength,
        max_output_tokens: Math.min(8192, Math.floor(contextLength / 2)),
        native_tool_calling: true,
        api_mode: "chat",
        drop_params: true,
      },
      include_secrets: false,
    }),
  });
  return profileName;
}

async function reconcileMinimumContextWindows() {
  const registry = loadRegistry();
  for (const model of registry.models) {
    try { await ensureLocalProfile(model.name, localModelOptions(model).contextLength); }
    catch (error) { console.error(`[openhands-model-manager] Could not reconcile managed profile ${model.name}: ${publicError(error)}`); }
  }
  const list = await backendRequest("/api/profiles");
  let updated = 0;
  for (const profile of list?.profiles || []) {
    try {
      const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profile.name)}`);
      const config = detail.config || {};
      const context = Number(config.max_input_tokens || 0);
      if (!Number.isFinite(context) || context <= 0 || context >= MIN_CONTEXT_WINDOW) continue;
      // Updating an inline-key profile without retrieving its secret could
      // destroy the credential. Provider-Connection profiles are safe to fix.
      if (detail.api_key_set && !config.provider_connection_id) continue;
      await backendRequest(`/api/profiles/${encodeURIComponent(profile.name)}`, {
        method: "POST",
        body: JSON.stringify({
          llm: { ...config, api_key: undefined, max_input_tokens: MIN_CONTEXT_WINDOW },
          include_secrets: false,
        }),
      });
      updated += 1;
    } catch (error) {
      console.error(`[openhands-model-manager] Could not reconcile profile ${profile.name}: ${publicError(error)}`);
    }
  }
  return updated;
}

async function stopLocalModel() {
  if (!localModelProcess || localModelProcess.exitCode !== null) {
    localModelProcess = null; localModelName = null; localModelReady = false; localModelStartedAt = null;
    return { stopped: true };
  }
  const child = localModelProcess;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
  return { stopped: true };
}

async function updateLocalModel(name, body) {
  const registry = loadRegistry();
  const index = registry.models.findIndex((item) => item.name === name);
  if (index < 0) throw new Error("Local model was not found");
  if (localModelName === name && localModelProcess?.exitCode === null) throw new Error("Stop the model before changing runtime settings");
  const options = localModelOptions({ ...registry.models[index], ...body });
  registry.models[index] = { ...registry.models[index], ...options, updatedAt: new Date().toISOString() };
  saveRegistry(registry);
  await ensureLocalProfile(name, options.contextLength);
  return { name, options };
}

async function deleteLocalModel(name) {
  const registry = loadRegistry();
  const index = registry.models.findIndex((item) => item.name === name);
  if (index < 0) throw new Error("Local model was not found");
  if (localModelName === name && localModelProcess?.exitCode === null) await stopLocalModel();
  const model = registry.models[index];
  const modelFile = managedModelPath(model);
  fs.rmSync(modelFile, { force: true });
  fs.rmSync(`${modelFile}.part`, { force: true });
  fs.rmSync(`${modelFile}.part.json`, { force: true });
  registry.models.splice(index, 1);
  if (registry.active === name) registry.active = null;
  saveRegistry(registry);
  const profileName = `local-${name}`.slice(0, 64);
  try {
    const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`);
    if (detail.config?.model === `openai/${name}`) await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, { method: "DELETE" });
  } catch (error) {
    if (!/OpenHands API 404/.test(String(error))) throw error;
  }
  return { deleted: name };
}

async function startLocalModel(name) {
  const registry = loadRegistry();
  const model = registry.models.find((item) => item.name === name);
  if (!model) throw new Error("The selected local model is not installed");
  const modelFile = managedModelPath(model);
  if (!fs.existsSync(modelFile)) throw new Error("The selected local model file is missing");
  if (!fs.existsSync(llamaServerLink)) throw new Error("llama.cpp is not installed");
  await stopLocalModel();
  const options = localModelOptions(model);
  if (options.mlock && Number(model.bytes || 0) + 512 * 1024 ** 2 > os.freemem()) {
    throw new Error("mlock was requested but free RAM is smaller than the model plus a 512 MiB safety reserve");
  }
  if (fs.existsSync(localLogFile) && fs.statSync(localLogFile).size > 5 * 1024 * 1024) fs.renameSync(localLogFile, `${localLogFile}.old`);
  const log = fs.createWriteStream(localLogFile, { flags: "a", mode: 0o600 });
  const args = [
    "-m", modelFile,
    "--alias", model.name,
    "--host", "127.0.0.1",
    "--port", String(localModelPort),
    "--ctx-size", String(options.contextLength),
    "--threads", String(options.threads),
    "--batch-size", String(options.batchSize),
    "--ubatch-size", String(options.ubatchSize),
    "--parallel", String(options.parallel),
    "--jinja",
    "--n-gpu-layers", "0",
    ...(options.mmap ? [] : ["--no-mmap"]),
    ...(options.mlock ? ["--mlock"] : []),
  ];
  const child = spawn(llamaServerLink, args, { cwd: workspace, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("error", (error) => {
    localModelLastExit = { at: new Date().toISOString(), code: null, signal: null, error: publicError(error) };
    if (localModelProcess === child) { localModelProcess = null; localModelName = null; localModelReady = false; localModelStartedAt = null; }
    log.end();
  });
  child.once("exit", (code, exitSignal) => {
    localModelLastExit = { at: new Date().toISOString(), code, signal: exitSignal, error: null };
    if (localModelProcess === child) { localModelProcess = null; localModelName = null; localModelReady = false; localModelStartedAt = null; }
    log.end();
  });
  localModelProcess = child;
  localModelName = name;
  localModelReady = false;
  localModelStartedAt = new Date().toISOString();
  registry.active = name;
  saveRegistry(registry);
  (async () => {
    for (let attempt = 0; attempt < 300 && localModelProcess === child && child.exitCode === null; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${localModelPort}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { localModelReady = true; return; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })();
  return { name, port: localModelPort, status: "starting", options };
}

function validateEndpointBase(value) {
  const baseUrl = String(value || "").trim().replace(/\/$/, "");
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Endpoint must use HTTP or HTTPS");
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol === "http:" && !loopback) throw new Error("Plain HTTP endpoints are restricted to localhost; use HTTPS for remote endpoints");
  return baseUrl;
}

async function probeEndpoint(body) {
  const baseUrl = validateEndpointBase(body?.baseUrl);
  const apiKey = String(body?.apiKey || "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Endpoint model discovery failed with HTTP ${response.status}: ${publicError(text)}`);
  let document;
  try { document = JSON.parse(text); }
  catch { throw new Error("Endpoint /models response was not JSON"); }
  const entries = Array.isArray(document?.data) ? document.data : Array.isArray(document?.models) ? document.models : Array.isArray(document) ? document : [];
  const models = entries.map((item) => typeof item === "string" ? item : firstString(item, ["id", "model", "name"])).filter(Boolean).slice(0, 500);
  return { ok: true, baseUrl, models, count: models.length };
}

async function registerEndpoint(body) {
  const name = slug(body?.name, "");
  const model = String(body?.model || "").trim();
  const baseUrl = validateEndpointBase(body?.baseUrl);
  if (!name || !model) throw new Error("Name and model are required");
  const apiKey = String(body?.apiKey || "");
  const probe = body?.verify === false ? null : await probeEndpoint({ baseUrl, apiKey });
  if (probe?.models.length && !probe.models.includes(model) && !probe.models.includes(model.replace(/^openai\//, ""))) {
    throw new Error(`Model ${model} was not advertised by the endpoint`);
  }
  const list = await backendRequest("/api/profiles");
  const profileName = `local-${name}`.slice(0, 64);
  if ((list?.profiles || []).some((profile) => profile.name === profileName)) throw new Error(`Profile ${profileName} already exists`);
  const connection = await backendRequest("/api/llm/provider-connections", {
    method: "POST",
    body: JSON.stringify({ display_name: `Local endpoint: ${name}`, provider: "openai", api_key: apiKey || "local-no-key", base_url: baseUrl }),
  });
  const connectionId = connection.id;
  const contextLength = localModelOptions(body).contextLength;
  await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
    method: "POST",
    body: JSON.stringify({
      llm: {
        model: model.includes("/") ? model : `openai/${model}`,
        base_url: baseUrl,
        ...(connectionId ? { provider_connection_id: connectionId } : {}),
        max_input_tokens: contextLength,
        max_output_tokens: Math.min(8192, Math.floor(contextLength / 2)),
        native_tool_calling: body?.nativeToolCalling !== false,
        api_mode: "chat",
        drop_params: true,
      },
      include_secrets: false,
    }),
  });
  return { profileName, connectionId, probe };
}

function filterProxyHeaders(headers) {
  const blocked = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())));
}

function outboundRequest(target, req, body) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const headers = filterProxyHeaders(req.headers);
    headers["content-length"] = String(body.length);
    const outgoing = transport.request(target, { method: req.method, headers, timeout: 120000 }, resolve);
    outgoing.on("timeout", () => outgoing.destroy(new Error("Upstream request timed out")));
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function routeModelRequest(req, res, parsed) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "")) {
    sendJson(res, 403, { error: "Model routes are internal only" });
    return;
  }
  const match = parsed.pathname.match(/^\/routes\/([a-z0-9._-]+)(\/.*)?$/);
  if (!match) { sendJson(res, 404, { error: "Unknown model route" }); return; }
  const config = loadConfig();
  const route = config.routes[match[1]];
  if (!route) { sendJson(res, 404, { error: "Unknown model route" }); return; }
  const body = await readRawBody(req, 16 * 1024 * 1024);
  const direct = new URL(`${String(route.targetBaseUrl).replace(/\/$/, "")}${match[2] || "/"}${parsed.search}`);
  if (direct.protocol !== "https:") throw new Error("Remote model routes must target HTTPS");
  const proxied = new URL(config.proxyTemplate.replace("{url}", encodeURIComponent(direct.toString())));
  let upstream;
  const mode = normalizeMode(route.mode);
  if (mode === "proxy-only") {
    upstream = await outboundRequest(proxied, req, body);
  } else {
    try {
      upstream = await outboundRequest(direct, req, body);
      if (mode === "direct-fallback" && (upstream.statusCode === 403 || upstream.statusCode === 408 || (upstream.statusCode || 0) >= 500)) {
        upstream.resume();
        upstream = await outboundRequest(proxied, req, body);
      }
    } catch (error) {
      if (mode !== "direct-fallback") throw error;
      upstream = await outboundRequest(proxied, req, body);
    }
  }
  res.writeHead(upstream.statusCode || 502, filterProxyHeaders(upstream.headers));
  upstream.pipe(res);
}

async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Model request exceeds the routing limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const SEEDED_OPENROUTER_PROFILES = new Set([
  "openrouter-seed-2-1-turbo", "openrouter-qwen3-8-2-4t-a95b", "openrouter-seed-2-0-code",
  "openrouter-deepseek-v4-pro-0813", "openrouter-grok-4-6", "openrouter-lfm-2-5-2-6b-free",
  "openrouter-nemotron-3-5-lightning", "openrouter-nemotron-3-5-lightning-free",
  "openrouter-sakana-namazu", "openrouter-solar-pro4", "openrouter-muse-glimmer-30b",
  "openrouter-muse-spark-1-2",
]);

async function migrateSeededOpenRouterProfiles() {
  const list = await backendRequest("/api/profiles");
  const adapter = `http://127.0.0.1:${managerPort}/routes/openrouter/api/v1`;
  let updated = 0;
  for (const summary of list?.profiles || []) {
    if (!SEEDED_OPENROUTER_PROFILES.has(summary.name)) continue;
    const detail = await backendRequest(`/api/profiles/${encodeURIComponent(summary.name)}`);
    const config = detail.config || {};
    if (config.base_url !== "https://openrouter.ai/api/v1" || config.provider_connection_id || detail.api_key_set) continue;
    await backendRequest(`/api/profiles/${encodeURIComponent(summary.name)}`, {
      method: "POST",
      body: JSON.stringify({ llm: { ...config, api_key: undefined, base_url: adapter }, include_secrets: false }),
    });
    updated += 1;
  }
  if (updated) console.log(`[openhands-model-manager] Attached ${updated} unmodified seeded OpenRouter profiles to the configurable route.`);
}

async function applyRoute(body) {
  const routeId = slug(body?.routeId, "");
  const config = loadConfig();
  const route = config.routes[routeId];
  if (!route) throw new Error("Unknown proxy route");
  const baseSuffix = String(body?.basePath || "/api/v1");
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(baseSuffix)) throw new Error("Invalid provider base path");
  const adapter = `http://127.0.0.1:${managerPort}/routes/${routeId}${baseSuffix}`;
  const names = Array.isArray(body?.profiles) ? body.profiles : [];
  const updated = [];
  const skipped = [];
  const connectionsUpdated = [];
  if (typeof body?.provider === "string" && body.provider) {
    const connections = await backendRequest("/api/llm/provider-connections");
    for (const connection of connections.filter((item) => item.provider === body.provider)) {
      await backendRequest(`/api/llm/provider-connections/${encodeURIComponent(connection.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ base_url: adapter }),
      });
      connectionsUpdated.push(connection.id);
    }
  }
  for (const name of names) {
    const detail = await backendRequest(`/api/profiles/${encodeURIComponent(name)}`);
    if (detail.api_key_set && !detail.config?.provider_connection_id) { skipped.push({ name, reason: "inline API key is protected; migrate it to a Provider Connection first" }); continue; }
    const llm = { ...detail.config, api_key: undefined, base_url: adapter };
    await backendRequest(`/api/profiles/${encodeURIComponent(name)}`, { method: "POST", body: JSON.stringify({ llm, include_secrets: false }) });
    updated.push(name);
  }
  return { adapter, updated, skipped, connectionsUpdated };
}

function managerPage() {
  const api = `${basePath}${apiPrefix}`;
  const home = `${basePath || ""}/`;
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>مدیریت مدل‌های OpenHands</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0a0a0b;color:#f4f4f5;--base:#0a0a0b;--surface:#121214;--raised:#19191c;--soft:#222226;--border:#2d2d32;--muted:#a1a1aa;--text:#f4f4f5;--accent:#3b82f6;--accent2:#2563eb;--good:#22c55e;--bad:#f87171;--warn:#f59e0b}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -10%,rgba(37,99,235,.13),transparent 32rem),var(--base);color:var(--text)}button,input,select,textarea{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.shell{width:min(1440px,100%);margin:auto;padding:20px 24px 48px}.app-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:8px 0 20px}.brand{display:flex;align-items:center;gap:13px;min-width:0}.brand-mark{display:grid;place-items:center;width:42px;height:42px;flex:0 0 auto;border:1px solid #3f3f46;border-radius:12px;background:linear-gradient(145deg,#27272a,#111113);color:#93c5fd;font-weight:900;letter-spacing:-.04em}.brand h1{font-size:1.32rem;line-height:1.35;margin:0}.brand p{color:var(--muted);font-size:.86rem;margin:3px 0 0}.header-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px}.back-link,.auth-pill{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:8px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);text-decoration:none;font-size:.86rem;white-space:nowrap}.back-link:hover{background:var(--raised);border-color:#52525b}.auth-pill.ok{color:#86efac;border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.09)}.auth-pill.err{color:#fca5a5;border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.09)}.tabs-wrap{position:sticky;top:0;z-index:20;margin:0 -8px 20px;padding:8px;background:rgba(10,10,11,.9);backdrop-filter:blur(14px)}.tabs{display:flex;gap:5px;overflow-x:auto;padding:4px;border:1px solid var(--border);border-radius:12px;background:var(--surface);scrollbar-width:thin}.tab{width:auto;min-width:max-content;margin:0;padding:9px 14px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-weight:650;cursor:pointer}.tab:hover{background:var(--raised);color:var(--text)}.tab[aria-selected="true"]{background:#27272a;color:#fff;box-shadow:inset 0 0 0 1px #3f3f46}.panel{animation:panel-in .16s ease}.panel[hidden]{display:none}@keyframes panel-in{from{opacity:.25;transform:translateY(3px)}to{opacity:1;transform:none}}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:6px 0 16px}.section-head h2{font-size:1.18rem;margin:0 0 5px}.section-head p{margin:0;color:var(--muted);font-size:.9rem;line-height:1.75}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-12{grid-column:1/-1}.card{min-width:0;background:linear-gradient(180deg,rgba(25,25,28,.96),rgba(18,18,20,.96));border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.12)}.card h2,.card h3{margin:0 0 8px}.card h2{font-size:1.05rem}.card h3{font-size:.96rem}.subcard{margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}.muted{color:var(--muted);font-size:.87rem;line-height:1.7}.notice{padding:12px 14px;border:1px solid rgba(59,130,246,.25);border-radius:10px;background:rgba(59,130,246,.07);color:#bfdbfe;font-size:.86rem;line-height:1.65}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.metric{padding:15px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.metric strong{display:block;font-size:1.45rem;margin-top:7px}.metric span{color:var(--muted);font-size:.78rem}.form-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:0 12px}.field{grid-column:span 6;min-width:0}.field.full{grid-column:1/-1}.field.third{grid-column:span 4}label{display:block;margin:.72rem 0 .32rem;color:#d4d4d8;font-size:.82rem;font-weight:600}input,select,textarea{display:block;width:100%;min-height:42px;padding:.68rem .78rem;border:1px solid #3f3f46;border-radius:9px;background:#0d0d0f;color:#fafafa;outline:none;transition:border-color .15s,box-shadow .15s}input::placeholder,textarea::placeholder{color:#71717a}input:focus,select:focus,textarea:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.16)}input[type="checkbox"]{display:inline-block;width:17px;min-height:17px;margin:0 0 0 7px;vertical-align:middle;accent-color:var(--accent)}.check{display:flex;align-items:flex-start;gap:8px;margin:.75rem 0;color:#d4d4d8;font-weight:450;line-height:1.55}.check input{margin-top:3px}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px}button{width:auto;min-height:40px;padding:.64rem 1rem;border:1px solid transparent;border-radius:9px;background:var(--accent2);color:#fff;font-weight:700;cursor:pointer;transition:filter .15s,transform .1s,background .15s}button:hover:not(:disabled){filter:brightness(1.1)}button:active:not(:disabled){transform:translateY(1px)}button:disabled{cursor:not-allowed;opacity:.5}button.alt{background:#27272a;border-color:#3f3f46}button.warn{background:#991b1b;border-color:#b91c1c}button.ghost{background:transparent;border-color:#3f3f46;color:#d4d4d8}.status{min-height:1.45rem;margin-top:10px;font-size:.87rem;line-height:1.65}.ok{color:#86efac}.err{color:#fca5a5}.scroll{width:100%;overflow:auto;border-radius:10px}table{width:100%;min-width:620px;border-collapse:separate;border-spacing:0;font-size:.84rem}th,td{padding:10px 9px;border-bottom:1px solid var(--border);text-align:right;vertical-align:middle}th{position:sticky;top:0;background:#18181b;color:#a1a1aa;font-size:.75rem;z-index:1}tr:last-child td{border-bottom:0}td button{min-height:32px;padding:.4rem .65rem;margin:2px;font-size:.78rem}.ltr{direction:ltr;text-align:left}hr{height:1px;margin:20px 0;border:0;background:var(--border)}pre{margin:0;max-height:340px;padding:14px;overflow:auto;border:1px solid var(--border);border-radius:10px;background:#09090b;color:#d4d4d8;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}details{margin-top:14px}summary{cursor:pointer;color:#d4d4d8;font-weight:650}.footer{padding:22px 0 0;text-align:center;color:#71717a;font-size:.75rem}@media(max-width:980px){.span-4,.span-5,.span-6,.span-7,.span-8{grid-column:1/-1}}@media(max-width:680px){.shell{padding:12px 12px 36px}.app-header{align-items:flex-start}.brand p{display:none}.header-actions{flex-direction:column;align-items:stretch}.auth-pill,.back-link{min-height:34px;padding:6px 9px}.tabs-wrap{margin-inline:-4px}.card{padding:14px}.field,.field.third{grid-column:1/-1}.metric-grid{grid-template-columns:1fr}.section-head{display:block}.actions button{flex:1 1 150px}table{min-width:560px}}
</style></head><body><div class="shell">
<header class="app-header"><div class="brand"><div class="brand-mark" aria-hidden="true">OH</div><div><h1>مدیریت مدل‌ها</h1><p>ارائه‌دهنده‌ها، Profileها، Proxy و مدل‌های محلی OpenHands</p></div></div><div class="header-actions"><span id="auth" class="auth-pill">در حال بررسی اتصال…</span><a class="back-link" href="${home}">بازگشت به OpenHands ←</a></div></header>
<nav class="tabs-wrap" aria-label="بخش‌های مدیریت"><div class="tabs" role="tablist"><button class="tab" type="button" role="tab" data-tab="overview">نمای کلی</button><button class="tab" type="button" role="tab" data-tab="providers">Import / Export</button><button class="tab" type="button" role="tab" data-tab="proxy">Proxy</button><button class="tab" type="button" role="tab" data-tab="local">GGUF محلی</button><button class="tab" type="button" role="tab" data-tab="endpoint">OpenAI Endpoint</button><button class="tab" type="button" role="tab" data-tab="tests">تست مدل‌ها</button></div></nav>
<main>
<section class="panel" data-panel="overview"><div class="section-head"><div><h2>نمای کلی مدل‌ها</h2><p>وضعیت Profileها و مدل‌های محلی این نصب را یک‌جا مشاهده کنید.</p></div></div><div class="grid"><div class="card span-4"><h2>وضعیت نصب</h2><div id="profile-limit" class="status ok"></div><p class="muted">این پنل فقط در مرورگر Pair‌شده فعال است. هیچ کلید یا tokenی در URL، خروجی یا log قرار نمی‌گیرد.</p></div><div class="card span-8"><div class="metric-grid"><div class="metric"><span>LLM Profile</span><strong id="profile-count">—</strong></div><div class="metric"><span>مدل GGUF نصب‌شده</span><strong id="local-count">—</strong></div><div class="metric"><span>وضعیت llama.cpp</span><strong id="runtime-state">—</strong></div></div></div><div class="card span-12"><h2>LLM Profileهای موجود</h2><p class="muted">پس از ایجاد یا Import مدل، برای مشاهده آن در Canvas صفحه اصلی را تازه‌سازی کنید.</p><div id="profiles" class="scroll"></div></div></div></section>
<section class="panel" data-panel="providers" hidden><div class="section-head"><div><h2>درون‌ریزی و برون‌ریزی</h2><p>فایل JSON ارائه‌دهنده را با کنترل کامل روی secretها مدیریت کنید.</p></div></div><div class="grid"><div class="card span-7"><h2>Import JSON</h2><div class="notice">API key فقط در صورت فعال‌کردن گزینه زیر به Provider Connection رمزنگاری‌شده منتقل می‌شود. snapshot و export همیشه بدون secret هستند. Context خالی یا کمتر از ۱۶٬۳۸۴ هنگام Import خودکار به حداقل قابل‌اجرای OpenHands تبدیل می‌شود.</div><label for="file">فایل JSON ارائه‌دهنده</label><input id="file" type="file" accept="application/json,.json"><label class="check"><input id="secrets" type="checkbox"><span>درون‌ریزی API keyهای فایل در Provider Connections رمزنگاری‌شده</span></label><label class="check"><input id="overwrite" type="checkbox"><span>به‌روزرسانی Profileهای هم‌نام؛ Profile دارای inline key هرگز بازنویسی نمی‌شود</span></label><div class="actions"><button id="import" type="button">درون‌ریزی و بررسی</button></div><div id="io-status" class="status" role="status"></div></div><div class="card span-5"><h2>Export امن</h2><p class="muted">Providerها و Profileها با قالب سازگار و مقدار <code>secretsIncluded=false</code> دریافت می‌شوند.</p><div class="actions"><button class="alt" id="export" type="button">دریافت JSON بدون secret</button></div></div></div></section>
<section class="panel" data-panel="proxy" hidden><div class="section-head"><div><h2>مسیر خروجی و Proxy</h2><p>اتصال مستقیم، fallback خودکار یا عبور اجباری از Proxy را انتخاب کنید.</p></div></div><div class="grid"><div class="card span-7"><div class="notice">در حالت Proxy، سرویس واسط prompt، پاسخ و هدر احراز هویت ارائه‌دهنده را دریافت می‌کند؛ فقط از واسط مورد اعتماد استفاده کنید.</div><div class="form-grid"><div class="field full"><label for="mode">حالت پیش‌فرض</label><select id="mode"><option value="direct">اتصال مستقیم</option><option value="direct-fallback">مستقیم، سپس Proxy در صورت خطا</option><option value="proxy-only">فقط Proxy</option></select></div><div class="field full"><label for="template">URL template</label><input id="template" class="ltr" spellcheck="false"></div></div><div class="actions"><button id="save-proxy" type="button">ذخیره تنظیمات</button><button class="alt" id="apply-openrouter" type="button">اعمال روی همه مدل‌های OpenRouter</button></div><div id="proxy-status" class="status" role="status"></div></div><div class="card span-5"><h2>Routeهای فعال</h2><div id="routes"></div></div></div></section>
<section class="panel" data-panel="local" hidden><div class="section-head"><div><h2>مدل محلی GGUF و llama.cpp</h2><p>مدل مناسب را جست‌وجو، فایل را انتخاب و دانلود قابل‌ادامه را مدیریت کنید.</p></div></div><div class="grid"><div class="card span-12"><div id="resources" class="notice"></div></div><div class="card span-6"><h2>۱. جست‌وجوی Hugging Face</h2><p class="muted">فیلترها اختیاری‌اند. Quantization و سقف حجم روی فایل‌های واقعی هر repository نیز بررسی می‌شوند.</p><div class="form-grid"><div class="field full"><label for="hf-search">عبارت جست‌وجو</label><input id="hf-search" class="ltr" placeholder="coder instruct persian"></div><div class="field"><label for="hf-family">خانواده یا معماری</label><input id="hf-family" class="ltr" placeholder="Qwen"></div><div class="field"><label for="hf-params">اندازه پارامتر</label><input id="hf-params" class="ltr" placeholder="7B"></div><div class="field"><label for="hf-quant">Quantization</label><input id="hf-quant" class="ltr" placeholder="Q4_K_M"></div><div class="field"><label for="hf-max-gb">حداکثر حجم فایل (GB)</label><input id="hf-max-gb" type="number" min="0.1" max="20" step="0.1" placeholder="8"></div><div class="field"><label for="hf-license">License</label><input id="hf-license" class="ltr" placeholder="apache-2.0"></div><div class="field"><label for="hf-language">زبان</label><input id="hf-language" class="ltr" placeholder="fa"></div><div class="field"><label for="hf-author">سازنده یا سازمان</label><input id="hf-author" class="ltr" placeholder="bartowski"></div><div class="field third"><label for="hf-sort">مرتب‌سازی</label><select id="hf-sort"><option value="downloads">بیشترین دانلود</option><option value="likes">بیشترین پسند</option><option value="updated">جدیدترین</option></select></div><div class="field third"><label for="hf-limit">تعداد</label><input id="hf-limit" type="number" value="20" min="1" max="50"></div></div><div class="actions"><button id="hf-search-button" type="button">جست‌وجوی مدل‌های GGUF</button></div><div id="hf-search-status" class="status" role="status"></div><div id="hf-search-results" class="scroll"></div></div>
<div class="card span-6" id="install-card"><h2>۲. انتخاب فایل و نصب</h2><div class="notice">حداقل Context موردنیاز OpenHands برابر ۱۶٬۳۸۴ است. مقدار کمتر در API و Profile به‌طور خودکار اصلاح می‌شود.</div><div class="form-grid"><div class="field"><label for="gguf-name">نام کوتاه</label><input id="gguf-name" class="ltr" placeholder="qwen-small"></div><div class="field"><label for="gguf-revision">Revision</label><input id="gguf-revision" class="ltr" value="main"></div><div class="field full"><label for="gguf-url">URL مستقیم HTTPS از Hugging Face یا GitHub</label><input id="gguf-url" class="ltr" spellcheck="false" placeholder="https://huggingface.co/.../resolve/main/model.gguf"></div><div class="field full"><label for="gguf-repo">یا Hugging Face repository</label><input id="gguf-repo" class="ltr" spellcheck="false" placeholder="Qwen/Qwen3-GGUF"></div><div class="field full"><label for="gguf-file">نام فایل GGUF</label><input id="gguf-file" class="ltr" spellcheck="false" placeholder="model-Q4_K_M.gguf"></div></div><div class="actions"><button id="hf-files" class="alt" type="button">نمایش فایل‌های منطبق مخزن</button></div><div id="hf-results" class="scroll"></div><div class="form-grid"><div class="field full"><label for="gguf-sha">SHA-256 اختیاری</label><input id="gguf-sha" class="ltr" spellcheck="false" maxlength="64"></div><div class="field third"><label for="gguf-context">Context</label><input id="gguf-context" type="number" value="16384" min="16384"></div><div class="field third"><label for="gguf-threads">CPU threads</label><input id="gguf-threads" type="number" value="1" min="1"></div><div class="field third"><label for="gguf-parallel">Parallel slots</label><input id="gguf-parallel" type="number" value="1" min="1" max="16"></div><div class="field"><label for="gguf-batch">Batch size</label><input id="gguf-batch" type="number" value="512" min="1"></div><div class="field"><label for="gguf-ubatch">Micro batch</label><input id="gguf-ubatch" type="number" value="256" min="1"></div></div><label class="check"><input id="gguf-mmap" type="checkbox" checked><span>استفاده از mmap برای کاهش مصرف RAM</span></label><label class="check"><input id="gguf-mlock" type="checkbox"><span>قفل‌کردن مدل در RAM؛ فقط در صورت RAM کافی</span></label><label class="check"><input id="gguf-replace" type="checkbox"><span>نصب مجدد و جایگزینی مدل هم‌نام</span></label><div class="actions"><button id="install" type="button">دانلود یا ادامه دانلود و نصب</button><button id="save-local-config" class="alt" type="button">ذخیره تنظیمات</button><button id="stop-local" class="ghost" type="button">توقف مدل</button><button id="cancel-install" class="warn" type="button" disabled>لغو امن دانلود</button></div><div id="install-status" class="status" role="status"></div></div>
<div class="card span-12"><h2>مدل‌های نصب‌شده</h2><div id="locals" class="scroll"></div><details><summary>مشاهده log مدل محلی</summary><pre id="log"></pre></details></div></div></section>
<section class="panel" data-panel="endpoint" hidden><div class="section-head"><div><h2>endpoint سازگار با OpenAI</h2><p>Ollama، LM Studio، vLLM، llama.cpp یا هر endpoint سازگار دیگر را بررسی و ثبت کنید.</p></div></div><div class="grid"><div class="card span-7"><div class="notice">مسیر <code>/models</code> پیش از ثبت بررسی می‌شود. HTTP فقط برای localhost مجاز است و endpoint راه‌دور باید HTTPS باشد.</div><div class="form-grid"><div class="field"><label for="ep-name">نام اتصال</label><input id="ep-name" class="ltr" placeholder="ollama"></div><div class="field"><label for="ep-context">Context length</label><input id="ep-context" type="number" value="16384" min="16384"></div><div class="field full"><label for="ep-url">Base URL</label><input id="ep-url" class="ltr" spellcheck="false" placeholder="http://127.0.0.1:11434/v1"></div><div class="field full"><label for="ep-model">Model ID</label><input id="ep-model" class="ltr" placeholder="qwen2.5-coder"></div><div class="field full"><label for="ep-key">API key اختیاری</label><input id="ep-key" type="password" autocomplete="new-password"></div></div><label class="check"><input id="ep-tools" type="checkbox" checked><span>Native tool calling</span></label><div class="actions"><button class="alt" id="probe-endpoint" type="button">کشف و تست مدل‌ها</button><button id="endpoint" type="button">تست و ساخت LLM Profile</button></div><div id="endpoint-status" class="status" role="status"></div></div><div class="card span-5"><h2>مدل‌های کشف‌شده</h2><div id="endpoint-models" class="scroll"><p class="muted">پس از تست endpoint، مدل‌های اعلام‌شده اینجا نمایش داده می‌شوند.</p></div></div></div></section>
<section class="panel" data-panel="tests" hidden><div class="section-head"><div><h2>تست جمعی مدل‌ها</h2><p>همه Profileهای ذخیره‌شده بدون محدودیت تعداد و با concurrency کنترل‌شده آزمایش می‌شوند.</p></div></div><div class="card"><div class="notice">برای هر LLM Profile یک درخواست حداکثر دو توکنی فرستاده می‌شود و ممکن است هزینه ناچیزی ایجاد کند.</div><div class="actions"><button id="test" type="button">شروع تست همه Profileها</button></div><div id="test-status" class="status" role="status"></div><div id="results" class="scroll"></div></div></section>
</main><div class="footer">OpenHands Host Model Manager · تمام APIها نیازمند Session API Key هستند.</div></div>
<script>(()=>{const API=${JSON.stringify(api)},q=id=>document.getElementById(id);let key="",state=null,currentInstallJob="",hfFiles=[],hfSearchResults=[];try{const list=JSON.parse(localStorage.getItem("openhands-backends")||"[]"),sel=JSON.parse(sessionStorage.getItem("openhands-active-backend")||localStorage.getItem("openhands-active-backend")||"null");key=(list.find(x=>x&&x.id===(sel?.backendId||"default-local"))||{}).apiKey||"";}catch{}const tabs=[...document.querySelectorAll("[data-tab]")],panels=[...document.querySelectorAll("[data-panel]")],validTabs=new Set(tabs.map(t=>t.dataset.tab));function activateTab(name,focus=false){if(!validTabs.has(name))name="overview";tabs.forEach(t=>{const active=t.dataset.tab===name;t.setAttribute("aria-selected",String(active));t.tabIndex=active?0:-1});panels.forEach(p=>p.hidden=p.dataset.panel!==name);try{localStorage.setItem("openhands-model-manager-tab",name)}catch{}if(location.hash!=="#"+name)history.replaceState(history.state,"","#"+name);if(focus)tabs.find(t=>t.dataset.tab===name)?.focus()}tabs.forEach((tab,index)=>{const name=tab.dataset.tab,panel=panels.find(item=>item.dataset.panel===name);tab.id="manager-tab-"+name;tab.setAttribute("aria-controls","manager-panel-"+name);if(panel){panel.id="manager-panel-"+name;panel.setAttribute("role","tabpanel");panel.setAttribute("aria-labelledby",tab.id)}tab.onclick=()=>activateTab(name);tab.onkeydown=e=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(e.key))return;e.preventDefault();let next=e.key==="Home"?0:e.key==="End"?tabs.length-1:(index+(e.key==="ArrowRight"?-1:1)+tabs.length)%tabs.length;activateTab(tabs[next].dataset.tab,true)}});let initial=location.hash.slice(1);try{if(!validTabs.has(initial))initial=localStorage.getItem("openhands-model-manager-tab")||"overview"}catch{}activateTab(initial);q("auth").textContent=key?"مرورگر احراز هویت شده است":"مرورگر Pair نشده است";q("auth").className=key?"auth-pill ok":"auth-pill err";
async function call(p,o={}){if(!key)throw Error("مرورگر Pair نشده است");const r=await fetch(API+p,{...o,headers:{"X-Session-API-Key":key,...(o.body?{"content-type":"application/json"}:{}),...(o.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Error(d?.error||t||("HTTP "+r.status));return d}function show(id,msg,ok=true){q(id).textContent=msg;q(id).className=ok?"status ok":"status err"}async function busy(button,work){if(button.disabled||button.dataset.busy)return;button.dataset.busy="1";const old=button.textContent;button.disabled=true;button.textContent="لطفاً صبر کنید…";try{return await work()}finally{delete button.dataset.busy;button.disabled=false;button.textContent=old}}function esc(s){return String(s??"").replace(/[&<>"']/g,c=>c.charCodeAt(0)===34?"&quot;":({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"}[c]))}
function bytes(n){if(n==null)return "نامشخص";const u=["B","KiB","MiB","GiB","TiB"];let v=Number(n),i=0;while(v>=1024&&i<u.length-1){v/=1024;i++}return v.toFixed(i?2:0)+" "+u[i]}
function localOptions(){return {contextLength:Number(q("gguf-context").value),threads:Number(q("gguf-threads").value),parallel:Number(q("gguf-parallel").value),batchSize:Number(q("gguf-batch").value),ubatchSize:Number(q("gguf-ubatch").value),mmap:q("gguf-mmap").checked,mlock:q("gguf-mlock").checked}}
function loadLocalForm(m){q("gguf-name").value=m.name;q("gguf-context").value=m.contextLength;q("gguf-threads").value=m.threads;q("gguf-parallel").value=m.parallel;q("gguf-batch").value=m.batchSize;q("gguf-ubatch").value=m.ubatchSize;q("gguf-mmap").checked=m.mmap!==false;q("gguf-mlock").checked=m.mlock===true;show("install-status","تنظیمات "+m.name+" برای ویرایش بارگذاری شد.")}
async function refresh(){
 const s=await call("/status");state=s;q("log").textContent=s.local.logTail||"";q("profile-count").textContent=String(s.profiles.length);q("local-count").textContent=String(s.local.models.length);q("runtime-state").textContent=s.local.running?(s.local.ready?"آماده":"در حال اجرا"):(s.local.runtimeInstalled?"نصب‌شده":"نیازمند نصب");q("profile-limit").textContent=s.profileLimit===null?"✓ محدودیت تعداد LLM Profile در این نصب برداشته شده است.":"سقف Profile: "+s.profileLimit;q("mode").value=s.proxy.defaultMode;q("template").value=s.proxy.proxyTemplate;q("routes").innerHTML="<p class=muted>Routeها: "+Object.values(s.proxy.routes).map(r=>esc(r.name)+" ("+esc(r.mode)+")").join("، ")+"</p>";
 const r=s.local.resources;q("resources").textContent="CPU: "+r.cpuCount+" رشته | RAM آزاد: "+bytes(r.freeMemoryBytes)+" از "+bytes(r.totalMemoryBytes)+" | فضای آزاد: "+bytes(r.freeBytes)+(s.local.runtimeInstalled?" | llama.cpp نصب است":" | llama.cpp هنگام اولین نصب دریافت می‌شود");if(document.activeElement!==q("gguf-threads")&&q("gguf-threads").value==="1")q("gguf-threads").value=Math.max(1,Math.ceil(r.cpuCount*.75));
 q("profiles").innerHTML=s.profiles.length?"<table><tr><th>نام Profile</th><th>Model ID</th></tr>"+s.profiles.map(p=>"<tr><td class=ltr>"+esc(p.name)+"</td><td class=ltr>"+esc(p.model||"")+"</td></tr>").join("")+"</table>":"<p class=muted>هیچ LLM Profile ثبت نشده است.</p>";
 const partials=s.local.partialDownloads.length?"<p class=muted>دانلودهای قابل ادامه: "+s.local.partialDownloads.map(p=>esc(p.name)+" ("+bytes(p.bytes)+")").join("، ")+"</p>":"";q("locals").innerHTML=partials+(s.local.models.length?"<table><tr><th>مدل</th><th>حجم/نسخه</th><th>تنظیمات</th><th>عملیات</th></tr>"+s.local.models.map(m=>"<tr><td class=ltr>"+esc(m.name)+(s.local.runningName===m.name?(s.local.ready?" ✅":" ⏳"):"")+(m.partialBytes?"<br><small>دانلود ناقص: "+bytes(m.partialBytes)+"</small>":"")+"</td><td>"+bytes(m.bytes)+"<br>GGUF v"+esc(m.gguf?.version||"?")+"</td><td>ctx "+esc(m.contextLength)+"<br>threads "+esc(m.threads)+" / batch "+esc(m.batchSize)+"</td><td><button data-start="+esc(m.name)+">اجرا</button><button class=alt data-edit="+esc(m.name)+">تنظیم</button><button class=warn data-delete="+esc(m.name)+">حذف</button></td></tr>").join("")+"</table>":"<p class=muted>مدلی نصب نشده است.</p>");
 document.querySelectorAll("[data-start]").forEach(b=>b.onclick=async()=>{try{show("install-status","در حال اجرای مدل…");await call("/local/start",{method:"POST",body:JSON.stringify({name:b.dataset.start})});await refresh()}catch(e){show("install-status",e.message,false)}});document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>loadLocalForm(s.local.models.find(m=>m.name===b.dataset.edit)));document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("مدل "+b.dataset.delete+"، فایل GGUF و Profile مدیریت‌شده آن حذف شود؟"))return;try{await call("/local/models/"+encodeURIComponent(b.dataset.delete),{method:"DELETE"});show("install-status","مدل حذف شد.");await refresh()}catch(e){show("install-status",e.message,false)}})
}
q("import").onclick=()=>busy(q("import"),async()=>{try{const f=q("file").files[0];if(!f)throw Error("فایل JSON را انتخاب کنید");const document=JSON.parse(await f.text());show("io-status","در حال درون‌ریزی…");const r=await call("/providers/import",{method:"POST",body:JSON.stringify({document,importSecrets:q("secrets").checked,overwrite:q("overwrite").checked})});const message="شناسایی: "+r.detectedModels+" مدل؛ جدید: "+r.profilesCreated+"؛ از قبل موجود: "+r.profilesExisting+"؛ متصل به Provider: "+r.profilesLinked+"؛ به‌روزشده: "+r.profilesUpdated+"؛ Context اصلاح‌شده: "+r.contextWindowsAdjusted+"؛ اتصال جدید: "+r.connectionsCreated+"؛ ردشده: "+r.skipped+(r.warnings.length?" — "+r.warnings.join(" | "):"");show("io-status",message,r.skipped===0);await refresh()}catch(e){show("io-status",e.message,false)}});
q("export").onclick=()=>busy(q("export"),async()=>{try{const d=await call("/providers/export");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}));a.download="openhands-providers.json";a.hidden=true;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);show("io-status","فایل امن بدون API key ساخته شد.")}catch(e){show("io-status",e.message,false)}});
q("save-proxy").onclick=()=>busy(q("save-proxy"),async()=>{try{await call("/proxy",{method:"PUT",body:JSON.stringify({defaultMode:q("mode").value,proxyTemplate:q("template").value})});show("proxy-status","ذخیره شد؛ Routeهای موجود نیز به حالت جدید تغییر کردند.");refresh()}catch(e){show("proxy-status",e.message,false)}});
q("apply-openrouter").onclick=()=>busy(q("apply-openrouter"),async()=>{try{if(!state)await refresh();const profiles=(state?.profiles||[]).filter(p=>String(p.model||"").startsWith("openrouter/")).map(p=>p.name);const r=await call("/proxy/apply",{method:"POST",body:JSON.stringify({routeId:"openrouter",basePath:"/api/v1",provider:"openrouter",profiles})});show("proxy-status",r.updated.length+" Profile و "+r.connectionsUpdated.length+" اتصال به Route متصل شد؛ "+r.skipped.length+" مورد رد شد.");refresh()}catch(e){show("proxy-status",e.message,false)}});
q("test").onclick=()=>busy(q("test"),async()=>{try{show("test-status","در حال تست؛ این کار ممکن است چند دقیقه طول بکشد…");const d=await call("/profiles/test",{method:"POST",body:JSON.stringify({concurrency:3})});show("test-status",d.tested+" مدل تست شد؛ "+d.results.filter(x=>x.ok).length+" موفق.");q("results").innerHTML="<table><tr><th>Profile</th><th>نتیجه</th><th>زمان</th><th>خطا</th></tr>"+d.results.map(x=>"<tr><td class=ltr>"+esc(x.name)+"</td><td>"+(x.ok?"✅":"❌")+"</td><td>"+esc(x.latencyMs)+" ms</td><td>"+esc(x.error?.message||"")+"</td></tr>").join("")+"</table>"}catch(e){show("test-status",e.message,false)}});
async function discoverHfFiles(){show("install-status","در حال خواندن و فیلتر فایل‌های مخزن…");const d=await call("/local/hf-files",{method:"POST",body:JSON.stringify({repo:q("gguf-repo").value,revision:q("gguf-revision").value,quantization:q("hf-quant").value,maxFileSizeGb:Number(q("hf-max-gb").value)||null})});hfFiles=d.files;show("install-status",d.count+" فایل مطابق مشخصات از "+d.totalGgufFiles+" فایل GGUF پیدا شد.");q("hf-results").innerHTML=d.files.length?"<table><tr><th>فایل</th><th>حجم</th><th>SHA</th><th></th></tr>"+d.files.map((f,i)=>"<tr><td class=ltr>"+esc(f.filename)+"</td><td>"+bytes(f.bytes)+"</td><td>"+(f.sha256?"✓":"—")+"</td><td><button data-hf="+i+">انتخاب</button></td></tr>").join("")+"</table>":"<p class=muted>فایلی مطابق Quantization و سقف حجم مشخص‌شده پیدا نشد.</p>";document.querySelectorAll("[data-hf]").forEach(b=>b.onclick=()=>{const f=hfFiles[Number(b.dataset.hf)];q("gguf-file").value=f.filename;q("gguf-sha").value=f.sha256||"";show("install-status","فایل "+f.filename+" انتخاب شد و آماده دانلود است.")})}
q("hf-files").onclick=()=>busy(q("hf-files"),async()=>{try{await discoverHfFiles()}catch(e){show("install-status",e.message,false)}});
q("hf-search-button").onclick=()=>busy(q("hf-search-button"),async()=>{try{show("hf-search-status","در حال جستجوی مدل‌های GGUF…");const d=await call("/local/hf-search",{method:"POST",body:JSON.stringify({query:q("hf-search").value,family:q("hf-family").value,parameterSize:q("hf-params").value,quantization:q("hf-quant").value,license:q("hf-license").value,language:q("hf-language").value,author:q("hf-author").value,maxFileSizeGb:Number(q("hf-max-gb").value)||null,sort:q("hf-sort").value,limit:Number(q("hf-limit").value)})});hfSearchResults=d.results;show("hf-search-status",d.count+" مخزن مطابق مشخصات پیدا شد.");q("hf-search-results").innerHTML=d.results.length?"<table><tr><th>مخزن</th><th>معماری/مجوز</th><th>دانلود/پسند</th><th></th></tr>"+d.results.map((m,i)=>"<tr><td class=ltr>"+esc(m.id)+"</td><td>"+esc(m.architecture||m.parameterSize||"—")+"<br>"+esc(m.license||"نامشخص")+"</td><td>"+esc(m.downloads)+" / "+esc(m.likes)+"</td><td><button data-hf-repo="+i+">انتخاب و آماده‌سازی دانلود</button></td></tr>").join("")+"</table>":"<p class=muted>مدلی مطابق همه مشخصات پیدا نشد؛ برخی فیلترها را خالی کنید.</p>";document.querySelectorAll("[data-hf-repo]").forEach(b=>b.onclick=async()=>{const m=hfSearchResults[Number(b.dataset.hfRepo)];q("gguf-repo").value=m.id;q("gguf-url").value="";q("gguf-revision").value="main";q("gguf-name").value=m.id.split("/").pop().replace(/-gguf$/i,"").toLowerCase().replace(/[^a-z0-9._-]+/g,"-").slice(0,48);if(m.suggestedFile){q("gguf-file").value=m.suggestedFile.filename||"";q("gguf-sha").value=m.suggestedFile.sha256||""}if(innerWidth<981)q("install-card").scrollIntoView({behavior:"smooth",block:"start"});try{await discoverHfFiles()}catch(e){show("install-status",e.message,false)}})}catch(e){show("hf-search-status",e.message,false)}});
q("install").onclick=async()=>{if(currentInstallJob)return;try{const payload={name:q("gguf-name").value,url:q("gguf-url").value,repo:q("gguf-repo").value,filename:q("gguf-file").value,revision:q("gguf-revision").value,sha256:q("gguf-sha").value,replace:q("gguf-replace").checked,...localOptions()};const d=await call("/local/install",{method:"POST",body:JSON.stringify(payload)});currentInstallJob=d.jobId;q("install").disabled=true;q("cancel-install").disabled=false;show("install-status","Job "+d.jobId+" شروع شد.");const timer=setInterval(async()=>{try{const j=await call("/jobs/"+d.jobId),detail=j.error||j.message||"";show("install-status",j.status+": "+detail+" "+(j.progress||0)+"%"+(j.bytesReceived?" — "+bytes(j.bytesReceived)+(j.bytesTotal?" / "+bytes(j.bytesTotal):""):""),!["failed","cancelled"].includes(j.status));if(["completed","failed","cancelled"].includes(j.status)){clearInterval(timer);currentInstallJob="";q("install").disabled=false;q("cancel-install").disabled=true;await refresh()}}catch(e){clearInterval(timer);currentInstallJob="";q("install").disabled=false;q("cancel-install").disabled=true;show("install-status",e.message,false)}},1500)}catch(e){show("install-status",e.message,false)}};
q("cancel-install").onclick=async()=>{if(!currentInstallJob)return;try{await call("/jobs/"+currentInstallJob+"/cancel",{method:"POST"});show("install-status","در حال لغو امن؛ فایل ناقص برای ادامه بعدی حفظ می‌شود…")}catch(e){show("install-status",e.message,false)}};
q("save-local-config").onclick=()=>busy(q("save-local-config"),async()=>{try{const name=q("gguf-name").value;if(!name)throw Error("ابتدا یک مدل نصب‌شده را از دکمه تنظیم انتخاب کنید");await call("/local/models/"+encodeURIComponent(name),{method:"PUT",body:JSON.stringify(localOptions())});show("install-status","تنظیمات ذخیره شد.");await refresh()}catch(e){show("install-status",e.message,false)}});
q("stop-local").onclick=()=>busy(q("stop-local"),async()=>{try{await call("/local/stop",{method:"POST",body:"{}"});show("install-status","مدل متوقف شد.");await refresh()}catch(e){show("install-status",e.message,false)}});
function endpointPayload(){return {name:q("ep-name").value,baseUrl:q("ep-url").value,model:q("ep-model").value,apiKey:q("ep-key").value,contextLength:Number(q("ep-context").value),nativeToolCalling:q("ep-tools").checked}}
q("probe-endpoint").onclick=()=>busy(q("probe-endpoint"),async()=>{try{show("endpoint-status","در حال بررسی /models…");const d=await call("/local/probe-endpoint",{method:"POST",body:JSON.stringify(endpointPayload())});show("endpoint-status","endpoint سالم است؛ "+d.count+" مدل پیدا شد.");q("endpoint-models").innerHTML=d.models.length?"<p class=muted>"+d.models.map(esc).join("، ")+"</p>":"<p class=muted>پاسخ معتبر بود اما فهرست مدل خالی است.</p>"}catch(e){show("endpoint-status",e.message,false)}});
q("endpoint").onclick=()=>busy(q("endpoint"),async()=>{try{const d=await call("/local/register-endpoint",{method:"POST",body:JSON.stringify(endpointPayload())});q("ep-key").value="";show("endpoint-status","Profile "+d.profileName+" پس از تست endpoint ساخته شد.");await refresh()}catch(e){show("endpoint-status",e.message,false)}});
refresh().catch(e=>{q("auth").textContent=e.message;q("auth").className="auth-pill err"});})();</script></body></html>`;
}

async function handleApi(req, res, pathname) {
  if (!authenticated(req)) { sendJson(res, 401, { error: "Invalid or missing session API key" }); return; }
  const endpoint = pathname.slice(apiPrefix.length) || "/";
  if (req.method === "GET" && endpoint === "/status") {
    const profiles = await backendRequest("/api/profiles");
    sendJson(res, 200, { profileLimit: null, proxy: loadConfig(), local: localStatus(), profiles: profiles?.profiles || [], jobs: [...jobs.values()].slice(-20) });
    return;
  }
  if (req.method === "POST" && endpoint === "/providers/import") { sendJson(res, 200, await importProviders(await readBody(req))); return; }
  if (req.method === "GET" && endpoint === "/providers/export") { sendJson(res, 200, await exportProviders(), { "content-disposition": "attachment; filename=openhands-providers.json" }); return; }
  if (req.method === "PUT" && endpoint === "/proxy") {
    const body = await readBody(req);
    if (!validProxyTemplate(body.proxyTemplate)) throw new Error("Proxy template must be an HTTPS URL containing {url}");
    const config = loadConfig();
    config.proxyTemplate = body.proxyTemplate;
    config.defaultMode = normalizeMode(body.defaultMode);
    for (const route of Object.values(config.routes)) route.mode = config.defaultMode;
    saveConfig(config);
    sendJson(res, 200, config);
    return;
  }
  if (req.method === "POST" && endpoint === "/proxy/apply") { sendJson(res, 200, await applyRoute(await readBody(req))); return; }
  if (req.method === "POST" && endpoint === "/profiles/test") { sendJson(res, 200, await testProfiles(await readBody(req))); return; }
  if (req.method === "GET" && endpoint === "/local/status") { sendJson(res, 200, localStatus()); return; }
  if (req.method === "POST" && endpoint === "/local/hf-search") { sendJson(res, 200, await searchHuggingFaceGgufModels(await readBody(req))); return; }
  if (req.method === "POST" && endpoint === "/local/hf-files") { sendJson(res, 200, await listHuggingFaceGgufFiles(await readBody(req))); return; }
  if (req.method === "POST" && endpoint === "/local/install") {
    if ([...jobs.values()].some((job) => job.kind === "local-model-install" && ["queued", "running", "cancelling"].includes(job.status))) throw new Error("A local model installation is already running");
    const body = await readBody(req);
    const jobId = createJob("local-model-install", (update, signal) => installLocalModel(body, update, signal));
    sendJson(res, 202, { jobId }); return;
  }
  if (req.method === "GET" && endpoint.startsWith("/jobs/")) {
    const job = jobs.get(endpoint.slice(6));
    if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
    sendJson(res, 200, job); return;
  }
  if (req.method === "POST" && /^\/jobs\/[a-f0-9]{24}\/cancel$/.test(endpoint)) {
    const id = endpoint.split("/")[2];
    if (!cancelJob(id)) { sendJson(res, 409, { error: "Job is not running" }); return; }
    sendJson(res, 202, { id, status: "cancelling" }); return;
  }
  if (req.method === "PUT" && endpoint.startsWith("/local/models/")) {
    const name = slug(decodeURIComponent(endpoint.slice("/local/models/".length)), "");
    sendJson(res, 200, await updateLocalModel(name, await readBody(req))); return;
  }
  if (req.method === "DELETE" && endpoint.startsWith("/local/models/")) {
    const name = slug(decodeURIComponent(endpoint.slice("/local/models/".length)), "");
    sendJson(res, 200, await deleteLocalModel(name)); return;
  }
  if (req.method === "POST" && endpoint === "/local/start") { const body = await readBody(req); sendJson(res, 200, await startLocalModel(String(body.name || ""))); return; }
  if (req.method === "POST" && endpoint === "/local/stop") { await stopLocalModel(); const registry = loadRegistry(); registry.active = null; saveRegistry(registry); sendJson(res, 200, { stopped: true }); return; }
  if (req.method === "POST" && endpoint === "/local/probe-endpoint") { sendJson(res, 200, await probeEndpoint(await readBody(req))); return; }
  if (req.method === "POST" && endpoint === "/local/register-endpoint") { sendJson(res, 201, await registerEndpoint(await readBody(req))); return; }
  sendJson(res, 404, { error: "Unknown model-manager API endpoint" });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url || "/", "http://model-manager.invalid");
    if (parsed.pathname.startsWith("/routes/")) { await routeModelRequest(req, res, parsed); return; }
    if (parsed.pathname === "/health") { sendJson(res, 200, { status: "ready" }); return; }
    if (parsed.pathname === modelsPage || parsed.pathname === `${modelsPage}/`) {
      const body = Buffer.from(managerPage(), "utf8");
      res.writeHead(200, { ...secureHeaders("text/html; charset=utf-8"), "content-length": String(body.length) });
      res.end(body); return;
    }
    if (parsed.pathname.startsWith(apiPrefix)) { await handleApi(req, res, parsed.pathname); return; }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, String(error?.message || "").includes("too large") ? 413 : 500, { error: publicError(error) });
  }
});

async function shutdown() {
  for (const controller of jobControllers.values()) controller.abort(new Error("Manager shutting down"));
  for (const child of managedSubprocesses) child.kill("SIGTERM");
  await stopLocalModel();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(managerPort, "127.0.0.1", async () => {
  console.log(`[openhands-model-manager] Internal manager listening on 127.0.0.1:${managerPort}`);
  try { await migrateSeededOpenRouterProfiles(); }
  catch (error) { console.error(`[openhands-model-manager] Seeded profile route migration skipped: ${publicError(error)}`); }
  try {
    const repaired = await reconcileMinimumContextWindows();
    if (repaired) console.log(`[openhands-model-manager] Raised ${repaired} profile context window(s) to ${MIN_CONTEXT_WINDOW}.`);
  } catch (error) { console.error(`[openhands-model-manager] Minimum context-window reconciliation skipped: ${publicError(error)}`); }
  const registry = loadRegistry();
  if (registry.active) {
    try { await startLocalModel(registry.active); }
    catch (error) { console.error(`[openhands-model-manager] Could not restore local model: ${publicError(error)}`); }
  }
});
