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
const managedSubprocesses = new Set();
let localModelProcess = null;
let localModelName = null;
let localModelReady = false;
let profileTestPromise = null;

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

function collectProviderDocuments(document) {
  const found = [];
  const flatModels = [];
  const seen = new Set();
  function visit(value, parentName = "", depth = 0) {
    if (depth > 12 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentName, depth + 1);
      return;
    }
    const models = Array.isArray(value.models) ? value.models : Array.isArray(value.modelList) ? value.modelList : null;
    if (models) {
      const inferred = models[0] && typeof models[0] === "object" ? models[0] : {};
      found.push({ source: { ...inferred, ...value }, models, parentName });
    }
    if (!models && firstString(value, ["id", "model", "modelId", "model_id", "slug"]) && firstString(value, ["provider", "providerName", "type", "baseUrl", "baseURL", "apiBase"])) {
      flatModels.push(value);
    }
    for (const [name, item] of Object.entries(value)) {
      if (name !== "models" && name !== "modelList") visit(item, name, depth + 1);
    }
  }
  visit(document);
  if (!found.length && flatModels.length) {
    const groups = new Map();
    for (const model of flatModels) {
      const key = [firstString(model, ["provider", "providerName", "type"]) || "Imported", firstString(model, ["baseUrl", "baseURL", "apiBase", "endpoint"]), firstString(model, ["apiKey", "api_key", "key", "token"])].join("\u0000");
      if (!groups.has(key)) groups.set(key, { source: model, models: [], parentName: "imported" });
      groups.get(key).models.push(model);
    }
    found.push(...groups.values());
  }
  if (!found.length && Array.isArray(document)) found.push({ source: { name: "Imported" }, models: document, parentName: "imported" });
  return found;
}

function providerInfo(candidate) {
  const source = candidate.source;
  const displayName = firstString(source, ["name", "displayName", "label", "providerName"]) || candidate.parentName || "Imported Provider";
  const provider = slug(firstString(source, ["provider", "type", "id", "slug"]) || displayName, "custom");
  const nested = source.connection || source.credentials || source.config || {};
  let baseUrl = firstString(source, ["baseUrl", "baseURL", "apiBase", "api_base", "apiUrl", "api_url", "endpoint", "url"]) || firstString(nested, ["baseUrl", "baseURL", "apiBase", "endpoint"]);
  if (!baseUrl && provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
  let apiKey = firstString(source, ["apiKey", "api_key", "key", "token", "secret"]) || firstString(nested, ["apiKey", "api_key", "key", "token", "secret"]);
  if (!apiKey && Array.isArray(source.apiKeys) && source.apiKeys.length) {
    apiKey = typeof source.apiKeys[0] === "string" ? source.apiKeys[0] : firstString(source.apiKeys[0], ["apiKey", "api_key", "key", "token"]);
  }
  return { displayName, provider, baseUrl, apiKey };
}

function modelInfo(source) {
  if (typeof source === "string") return { id: source, name: source, source: {} };
  const id = firstString(source, ["id", "model", "modelId", "model_id", "slug", "value"]);
  const name = firstString(source, ["name", "displayName", "label", "title"]) || id;
  return { id, name, source: source && typeof source === "object" ? source : {} };
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
  if (!candidates.length) throw new Error("No provider object with a models array was found");
  const list = await backendRequest("/api/profiles");
  const connections = await backendRequest("/api/llm/provider-connections");
  const existing = new Set((list?.profiles || []).map((profile) => profile.name));
  const summary = { providers: 0, connectionsCreated: 0, profilesCreated: 0, skipped: 0, warnings: [] };

  for (const candidate of candidates) {
    const info = providerInfo(candidate);
    const requestedMode = firstString(candidate.source, ["proxyMode", "proxy_mode", "connectionMode"]) || (candidate.source.proxyOnly === true ? "proxy-only" : candidate.source.useProxy === true || candidate.source.proxyEnabled === true ? "direct-fallback" : "");
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
        summary.warnings.push(`Existing connection kept unchanged: ${info.displayName}`);
      } else {
        const created = await backendRequest("/api/llm/provider-connections", {
          method: "POST",
          body: JSON.stringify({ display_name: info.displayName, provider: info.provider, api_key: info.apiKey, base_url: effectiveBase || null }),
        });
        connectionId = created.id;
        connections.push(created);
        summary.connectionsCreated += 1;
      }
    }
    summary.providers += 1;

    for (const rawModel of candidate.models) {
      const model = modelInfo(rawModel);
      const modelId = canonicalModel(info.provider, model.id);
      if (!modelId) { summary.skipped += 1; continue; }
      const preferredName = slug(firstString(model.source, ["profileName", "profile_name"]) || `${info.provider}-${model.name || model.id}`, "imported-model").slice(0, 64);
      const profileName = existing.has(preferredName) ? preferredName : uniqueProfileName(info.provider, model.name || model.id, existing);
      let existingConfig = {};
      if (existing.has(profileName) && !overwrite) { summary.skipped += 1; continue; }
      if (existing.has(profileName) && overwrite) {
        const detail = await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`);
        if (detail.api_key_set && !detail.config?.provider_connection_id) {
          summary.warnings.push(`Skipped inline-key profile to protect its credential: ${profileName}`);
          summary.skipped += 1;
          continue;
        }
        existingConfig = detail.config || {};
      }
      const maxInput = numericField(model.source, ["maxInputTokens", "max_input_tokens", "contextLength", "context_length", "contextWindow"]);
      const maxOutput = numericField(model.source, ["maxOutputTokens", "max_output_tokens", "maxTokens", "max_tokens"]);
      const capabilities = model.source.capabilities && typeof model.source.capabilities === "object" ? model.source.capabilities : {};
      const toolCalling = model.source.toolCalling ?? model.source.tool_calling ?? capabilities.toolCalling ?? capabilities.tools ?? true;
      const llm = {
        ...existingConfig,
        api_key: undefined,
        model: modelId,
        ...(effectiveBase ? { base_url: effectiveBase } : {}),
        ...(connectionId ? { provider_connection_id: connectionId } : {}),
        ...(maxInput ? { max_input_tokens: maxInput } : {}),
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
      summary.profilesCreated += 1;
      if (routeId && !connectionId) summary.warnings.push(`Profile ${profileName} needs a Provider Connection before use.`);
    }
  }

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

function loadRegistry() {
  const value = readJson(registryFile, { version: 1, active: null, models: [] });
  return { version: 1, active: typeof value.active === "string" ? value.active : null, models: Array.isArray(value.models) ? value.models : [] };
}

function saveRegistry(registry) {
  atomicJson(registryFile, registry);
}

function localStatus() {
  const registry = loadRegistry();
  return {
    active: registry.active,
    running: Boolean(localModelProcess && localModelProcess.exitCode === null),
    ready: localModelReady,
    runningName: localModelName,
    logTail: (() => { try { const data = fs.readFileSync(localLogFile); return data.subarray(Math.max(0, data.length - 16000)).toString("utf8"); } catch { return ""; } })(),
    models: registry.models.map((model) => ({ ...model, file: undefined })),
  };
}

function updateJob(id, patch) {
  const current = jobs.get(id) || {};
  jobs.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

function createJob(kind, task) {
  const id = crypto.randomBytes(12).toString("hex");
  jobs.set(id, { id, kind, status: "queued", progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  Promise.resolve().then(async () => {
    updateJob(id, { status: "running" });
    try {
      const result = await task((patch) => updateJob(id, patch));
      updateJob(id, { status: "completed", progress: 100, result });
    } catch (error) {
      updateJob(id, { status: "failed", error: publicError(error) });
    }
  });
  return id;
}

async function downloadFile(url, destination, update, expectedSha = "", maxBytes = 20 * 1024 ** 3) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length") || "0");
  if (total > maxBytes) throw new Error("Download exceeds the 20 GiB safety limit");
  if (typeof fs.statfsSync === "function" && total > 0) {
    const stats = fs.statfsSync(path.dirname(destination));
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free < total + 512 * 1024 ** 2) throw new Error("Not enough free disk space for this model");
  }
  const temp = `${destination}.part`;
  const output = fs.createWriteStream(temp, { mode: 0o600 });
  const hash = crypto.createHash("sha256");
  let received = 0;
  const input = Readable.fromWeb(response.body);
  await new Promise((resolve, reject) => {
    input.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) { input.destroy(new Error("Download exceeds the 20 GiB safety limit")); return; }
      hash.update(chunk);
      if (total) update({ progress: Math.min(95, Math.round((received / total) * 95)), bytesReceived: received, bytesTotal: total });
    });
    input.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(output);
  });
  const digest = hash.digest("hex");
  if (expectedSha && !safeEqual(digest.toLowerCase(), expectedSha.toLowerCase())) {
    fs.rmSync(temp, { force: true });
    throw new Error("Downloaded file SHA-256 does not match");
  }
  fs.renameSync(temp, destination);
  fs.chmodSync(destination, 0o600);
  return { sha256: digest, bytes: received };
}

async function ensureLlamaRuntime(update) {
  if (fs.existsSync(llamaServerLink)) return llamaServerLink;
  update({ message: "Finding a compatible llama.cpp release…", progress: 1 });
  const response = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10", {
    headers: { "user-agent": "openhands-host-model-manager", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed with HTTP ${response.status}`);
  const releases = await response.json();
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "";
  if (!arch) throw new Error(`No managed llama.cpp binary is available for ${process.arch}`);
  let archive = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    archive = (Array.isArray(release.assets) ? release.assets : []).find((asset) => {
      const name = String(asset.name || "").toLowerCase();
      return name.includes("bin") && (name.includes(`ubuntu-${arch}`) || name.includes(`linux-${arch}`)) && /\.(zip|tar\.gz|tgz)$/.test(name) && !/(cuda|cudart|rocm|vulkan|sycl|kompute|openvino)/.test(name);
    });
    if (archive) break;
  }
  if (!archive?.browser_download_url) throw new Error("No compatible CPU llama.cpp release asset was found");
  fs.mkdirSync(llamaHome, { recursive: true, mode: 0o700 });
  const archivePath = path.join(llamaHome, path.basename(archive.name));
  const digest = String(archive.digest || "").startsWith("sha256:") ? String(archive.digest).slice(7) : "";
  update({ message: `Downloading ${archive.name}…`, progress: 3 });
  await downloadFile(archive.browser_download_url, archivePath, update, digest, 2 * 1024 ** 3);
  update({ message: "Extracting llama.cpp…", progress: 96 });
  const extractor = `import pathlib,sys,tarfile,zipfile\np=pathlib.Path(sys.argv[1]); d=pathlib.Path(sys.argv[2])\n(zipfile.ZipFile(p).extractall(d) if p.suffix=='.zip' else tarfile.open(p).extractall(d))\n`;
  const extracted = await spawnCollect("python3", ["-c", extractor, archivePath, llamaHome], { timeout: 120000 });
  if (extracted.code !== 0) throw new Error(`Could not extract llama.cpp: ${publicError(extracted.stderr)}`);
  const queue = [llamaHome];
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
  if (!binary) throw new Error("The llama.cpp archive did not contain llama-server");
  fs.chmodSync(binary, 0o700);
  try { fs.symlinkSync(binary, llamaServerLink); } catch (error) { if (error.code !== "EEXIST") throw error; }
  fs.rmSync(archivePath, { force: true });
  return llamaServerLink;
}

function validateModelUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Model URL must use HTTPS");
  const host = url.hostname.toLowerCase();
  const allowed = host === "huggingface.co" || host === "hf.co" || host === "github.com" || host.endsWith(".huggingface.co");
  if (!allowed) throw new Error("Model downloads are restricted to Hugging Face or GitHub HTTPS URLs");
  return url.toString();
}

async function installLocalModel(body, update) {
  const name = slug(body?.name, "");
  if (!name || name.length > 48) throw new Error("A valid model name is required");
  const url = validateModelUrl(body?.url || "");
  const sha256 = String(body?.sha256 || "").trim().toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("SHA-256 must contain 64 hexadecimal characters");
  const contextLength = Math.max(512, Math.min(Number(body?.contextLength) || 8192, 1048576));
  await ensureLlamaRuntime(update);
  const destination = path.join(modelsDir, `${name}.gguf`);
  if (fs.existsSync(destination)) throw new Error(`Local model ${name} is already installed`);
  update({ message: `Downloading ${name}.gguf…`, progress: 1 });
  const downloaded = await downloadFile(url, destination, update, sha256);
  const descriptor = fs.openSync(destination, "r");
  const magic = Buffer.alloc(4);
  try { fs.readSync(descriptor, magic, 0, 4, 0); } finally { fs.closeSync(descriptor); }
  if (magic.toString("ascii") !== "GGUF") {
    fs.rmSync(destination, { force: true });
    throw new Error("Downloaded file is not a GGUF model");
  }
  const registry = loadRegistry();
  registry.models.push({ name, filename: `${name}.gguf`, file: destination, sha256: downloaded.sha256, bytes: downloaded.bytes, contextLength, installedAt: new Date().toISOString() });
  saveRegistry(registry);
  await ensureLocalProfile(name, contextLength);
  return { name, sha256: downloaded.sha256, bytes: downloaded.bytes };
}

async function ensureLocalProfile(name, contextLength) {
  const list = await backendRequest("/api/profiles");
  const profileName = `local-${name}`.slice(0, 64);
  if ((list?.profiles || []).some((profile) => profile.name === profileName)) return profileName;
  const displayName = `Local llama.cpp: ${name}`;
  const connections = await backendRequest("/api/llm/provider-connections");
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

function stopLocalModel() {
  return new Promise((resolve) => {
    if (!localModelProcess || localModelProcess.exitCode !== null) { localModelProcess = null; localModelName = null; localModelReady = false; resolve(); return; }
    const child = localModelProcess;
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.once("exit", () => { clearTimeout(timer); localModelProcess = null; localModelName = null; localModelReady = false; resolve(); });
    child.kill("SIGTERM");
  });
}

async function startLocalModel(name) {
  const registry = loadRegistry();
  const model = registry.models.find((item) => item.name === name);
  if (!model || !fs.existsSync(model.file)) throw new Error("The selected local model is not installed");
  if (!fs.existsSync(llamaServerLink)) throw new Error("llama.cpp is not installed");
  await stopLocalModel();
  if (fs.existsSync(localLogFile) && fs.statSync(localLogFile).size > 5 * 1024 * 1024) fs.renameSync(localLogFile, `${localLogFile}.old`);
  const log = fs.createWriteStream(localLogFile, { flags: "a", mode: 0o600 });
  const args = ["-m", model.file, "--alias", model.name, "--host", "127.0.0.1", "--port", String(localModelPort), "-c", String(model.contextLength || 8192), "--jinja", "--n-gpu-layers", "0"];
  const child = spawn(llamaServerLink, args, { cwd: workspace, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("exit", () => { if (localModelProcess === child) { localModelProcess = null; localModelName = null; localModelReady = false; } log.end(); });
  localModelProcess = child;
  localModelName = name;
  localModelReady = false;
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
  return { name, port: localModelPort, status: "starting" };
}

async function registerEndpoint(body) {
  const name = slug(body?.name, "");
  const model = String(body?.model || "").trim();
  const baseUrl = String(body?.baseUrl || "").trim().replace(/\/$/, "");
  if (!name || !model || !baseUrl) throw new Error("Name, model, and base URL are required");
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Endpoint must use HTTP or HTTPS");
  const list = await backendRequest("/api/profiles");
  const profileName = `local-${name}`.slice(0, 64);
  if ((list?.profiles || []).some((profile) => profile.name === profileName)) throw new Error(`Profile ${profileName} already exists`);
  const apiKey = String(body?.apiKey || "") || "local-no-key";
  const connection = await backendRequest("/api/llm/provider-connections", {
    method: "POST",
    body: JSON.stringify({ display_name: `Local endpoint: ${name}`, provider: "openai", api_key: apiKey, base_url: baseUrl }),
  });
  const connectionId = connection.id;
  await backendRequest(`/api/profiles/${encodeURIComponent(profileName)}`, {
    method: "POST",
    body: JSON.stringify({
      llm: { model: model.includes("/") ? model : `openai/${model}`, base_url: baseUrl, ...(connectionId ? { provider_connection_id: connectionId } : {}), native_tool_calling: body?.nativeToolCalling !== false, api_mode: "chat", drop_params: true },
      include_secrets: false,
    }),
  });
  return { profileName, connectionId };
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
  for (const name of names.slice(0, 50)) {
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
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مدیریت مدل‌های OpenHands</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#07111f;color:#e5eefb}body{max-width:1100px;margin:auto;padding:22px}a{color:#7dd3fc}.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.card{background:#111d2e;border:1px solid #29405f;border-radius:14px;padding:18px;margin:14px 0}h1{font-size:1.55rem}h2{font-size:1.12rem;margin-top:0}label{display:block;margin:.65rem 0 .25rem}input,select,textarea,button{box-sizing:border-box;width:100%;padding:.72rem;border-radius:8px;border:1px solid #49627f;background:#081321;color:#fff}button{background:#0ea5e9;border:0;font-weight:700;cursor:pointer;margin-top:.65rem}button.alt{background:#334155}button.warn{background:#c2410c}.row{display:flex;gap:8px}.row>*{flex:1}.muted{color:#9fb0c5;font-size:.9rem}.ok{color:#86efac}.err{color:#fca5a5}pre{white-space:pre-wrap;word-break:break-word;background:#050b14;padding:12px;border-radius:8px;max-height:360px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{padding:7px;border-bottom:1px solid #29405f;text-align:right}.ltr{direction:ltr;text-align:left}input[type=checkbox]{width:auto}.status{min-height:1.4rem}</style></head><body>
<div class="top"><h1>مدیریت ارائه‌دهنده‌ها و مدل‌ها</h1><a href="${home}">بازگشت به OpenHands</a></div><p class="muted">این صفحه فقط پس از Pair شدن مرورگر کار می‌کند. کلیدها در URL، export یا log قرار نمی‌گیرند.</p><div id="auth" class="status"></div>
<div class="grid"><section class="card"><h2>Import / Export JSON</h2><input id="file" type="file" accept="application/json,.json"><label><input id="secrets" type="checkbox"> درون‌ریزی API keyهای داخل فایل در Provider Connections رمزنگاری‌شده</label><label><input id="overwrite" type="checkbox"> به‌روزرسانی Profileهای هم‌نام؛ Profile دارای inline key هرگز overwrite نمی‌شود</label><button id="import">درون‌ریزی</button><button class="alt" id="export">برون‌ریزی امن بدون secret</button><div id="io-status" class="status"></div></section>
<section class="card"><h2>Proxy server</h2><p class="muted">در حالت Proxy، سرویس واسط درخواست، محتوای prompt و هدر احراز هویت ارائه‌دهنده را دریافت می‌کند. فقط از Proxy مورد اعتماد استفاده کنید.</p><label>حالت پیش‌فرض</label><select id="mode"><option value="direct">اتصال مستقیم</option><option value="direct-fallback">مستقیم، سپس Proxy در صورت خطا</option><option value="proxy-only">فقط Proxy</option></select><label>URL template</label><input id="template" class="ltr"><button id="save-proxy">ذخیره تنظیمات</button><button class="alt" id="apply-openrouter">اعمال Route روی همه مدل‌های OpenRouter</button><div id="routes"></div><div id="proxy-status" class="status"></div></section></div>
<section class="card"><h2>تست جمعی مدل‌ها</h2><p class="muted">برای هر LLM Profile یک درخواست حداکثر دو توکنی ارسال می‌شود و می‌تواند هزینه ناچیزی ایجاد کند.</p><button id="test">تست همه Profileها</button><div id="test-status" class="status"></div><div id="results"></div></section>
<div class="grid"><section class="card"><h2>نصب مدل GGUF با llama.cpp</h2><label>نام کوتاه</label><input id="gguf-name" placeholder="qwen-small"><label>لینک HTTPS فایل GGUF از Hugging Face یا GitHub</label><input id="gguf-url" class="ltr" placeholder="https://huggingface.co/.../model.gguf"><label>SHA-256 اختیاری</label><input id="gguf-sha" class="ltr"><label>Context length</label><input id="gguf-context" type="number" value="8192" min="512"><button id="install">دانلود و نصب</button><div id="install-status" class="status"></div><div id="locals"></div></section>
<section class="card"><h2>ثبت endpoint لوکال موجود</h2><label>نام</label><input id="ep-name" placeholder="ollama"><label>Base URL سازگار با OpenAI</label><input id="ep-url" class="ltr" placeholder="http://127.0.0.1:11434/v1"><label>Model ID</label><input id="ep-model" class="ltr" placeholder="qwen2.5-coder"><label>API key اختیاری</label><input id="ep-key" type="password" autocomplete="new-password"><button id="endpoint">ساخت LLM Profile</button><div id="endpoint-status" class="status"></div></section></div>
<pre id="log"></pre><script>(()=>{const API=${JSON.stringify(api)},q=id=>document.getElementById(id);let key="",state=null;try{const list=JSON.parse(localStorage.getItem("openhands-backends")||"[]"),sel=JSON.parse(sessionStorage.getItem("openhands-active-backend")||localStorage.getItem("openhands-active-backend")||"null");key=(list.find(x=>x&&x.id===(sel?.backendId||"default-local"))||{}).apiKey||"";}catch{}q("auth").textContent=key?"مرورگر احراز هویت شده است.":"ابتدا openhands-host pair را اجرا و مرورگر را Pair کنید.";q("auth").className=key?"ok":"err";
async function call(p,o={}){if(!key)throw Error("مرورگر Pair نشده است");const r=await fetch(API+p,{...o,headers:{"X-Session-API-Key":key,...(o.body?{"content-type":"application/json"}:{}),...(o.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Error(d?.error||t||("HTTP "+r.status));return d}function show(id,msg,ok=true){q(id).textContent=msg;q(id).className=ok?"status ok":"status err"}function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
async function refresh(){const s=await call("/status");state=s;q("log").textContent=s.local.logTail||"";q("mode").value=s.proxy.defaultMode;q("template").value=s.proxy.proxyTemplate;q("routes").innerHTML="<p class=muted>Routeها: "+Object.values(s.proxy.routes).map(r=>esc(r.name)+" ("+esc(r.mode)+")").join("، ")+"</p>";q("locals").innerHTML=s.local.models.length?"<table><tr><th>مدل</th><th>حجم</th><th></th></tr>"+s.local.models.map(m=>"<tr><td>"+esc(m.name)+(s.local.runningName===m.name?(s.local.ready?" ✓":" ⏳"):"")+"</td><td>"+(Number(m.bytes||0)/1073741824).toFixed(2)+" GB</td><td><button data-start=\""+esc(m.name)+"\">اجرا</button></td></tr>").join("")+"</table>":"<p class=muted>مدلی نصب نشده است.</p>";document.querySelectorAll("[data-start]").forEach(b=>b.onclick=async()=>{await call("/local/start",{method:"POST",body:JSON.stringify({name:b.dataset.start})});refresh()})}
q("import").onclick=async()=>{try{const f=q("file").files[0];if(!f)throw Error("فایل JSON را انتخاب کنید");const document=JSON.parse(await f.text());show("io-status","در حال درون‌ریزی…");const r=await call("/providers/import",{method:"POST",body:JSON.stringify({document,importSecrets:q("secrets").checked,overwrite:q("overwrite").checked})});show("io-status","ساخته شد: "+r.profilesCreated+" Profile و "+r.connectionsCreated+" اتصال؛ ردشده: "+r.skipped);refresh()}catch(e){show("io-status",e.message,false)}};
q("export").onclick=async()=>{try{const d=await call("/providers/export");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}));a.download="openhands-providers.json";a.click();URL.revokeObjectURL(a.href);show("io-status","فایل امن بدون API key ساخته شد.")}catch(e){show("io-status",e.message,false)}};
q("save-proxy").onclick=async()=>{try{await call("/proxy",{method:"PUT",body:JSON.stringify({defaultMode:q("mode").value,proxyTemplate:q("template").value})});show("proxy-status","ذخیره شد؛ Routeهای موجود نیز به حالت جدید تغییر کردند.");refresh()}catch(e){show("proxy-status",e.message,false)}};
q("apply-openrouter").onclick=async()=>{try{if(!state)await refresh();const profiles=(state?.profiles||[]).filter(p=>String(p.model||"").startsWith("openrouter/")).map(p=>p.name);const r=await call("/proxy/apply",{method:"POST",body:JSON.stringify({routeId:"openrouter",basePath:"/api/v1",provider:"openrouter",profiles})});show("proxy-status",r.updated.length+" Profile و "+r.connectionsUpdated.length+" اتصال به Route متصل شد؛ "+r.skipped.length+" مورد رد شد.");refresh()}catch(e){show("proxy-status",e.message,false)}};
q("test").onclick=async()=>{try{show("test-status","در حال تست؛ این کار ممکن است چند دقیقه طول بکشد…");const d=await call("/profiles/test",{method:"POST",body:JSON.stringify({concurrency:3})});show("test-status",d.tested+" مدل تست شد؛ "+d.results.filter(x=>x.ok).length+" موفق.");q("results").innerHTML="<table><tr><th>Profile</th><th>نتیجه</th><th>زمان</th><th>خطا</th></tr>"+d.results.map(x=>"<tr><td class=ltr>"+esc(x.name)+"</td><td>"+(x.ok?"✅":"❌")+"</td><td>"+esc(x.latencyMs)+" ms</td><td>"+esc(x.error?.message||"")+"</td></tr>").join("")+"</table>"}catch(e){show("test-status",e.message,false)}};
q("install").onclick=async()=>{try{const d=await call("/local/install",{method:"POST",body:JSON.stringify({name:q("gguf-name").value,url:q("gguf-url").value,sha256:q("gguf-sha").value,contextLength:Number(q("gguf-context").value)})});show("install-status","Job "+d.jobId+" شروع شد.");const timer=setInterval(async()=>{try{const j=await call("/jobs/"+d.jobId);show("install-status",j.status+": "+(j.message||"")+" "+(j.progress||0)+"%",j.status!=="failed");if(["completed","failed"].includes(j.status)){clearInterval(timer);refresh()}}catch(e){clearInterval(timer);show("install-status",e.message,false)}},1500)}catch(e){show("install-status",e.message,false)}};
q("endpoint").onclick=async()=>{try{const d=await call("/local/register-endpoint",{method:"POST",body:JSON.stringify({name:q("ep-name").value,baseUrl:q("ep-url").value,model:q("ep-model").value,apiKey:q("ep-key").value})});q("ep-key").value="";show("endpoint-status","Profile "+d.profileName+" ساخته شد.")}catch(e){show("endpoint-status",e.message,false)}};refresh().catch(e=>show("auth",e.message,false));})();</script></body></html>`;
}

async function handleApi(req, res, pathname) {
  if (!authenticated(req)) { sendJson(res, 401, { error: "Invalid or missing session API key" }); return; }
  const endpoint = pathname.slice(apiPrefix.length) || "/";
  if (req.method === "GET" && endpoint === "/status") {
    const profiles = await backendRequest("/api/profiles");
    sendJson(res, 200, { proxy: loadConfig(), local: localStatus(), profiles: profiles?.profiles || [], jobs: [...jobs.values()].slice(-20) });
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
  if (req.method === "POST" && endpoint === "/local/install") {
    if ([...jobs.values()].some((job) => job.kind === "local-model-install" && ["queued", "running"].includes(job.status))) throw new Error("A local model installation is already running");
    const body = await readBody(req);
    const jobId = createJob("local-model-install", (update) => installLocalModel(body, update));
    sendJson(res, 202, { jobId }); return;
  }
  if (req.method === "GET" && endpoint.startsWith("/jobs/")) {
    const job = jobs.get(endpoint.slice(6));
    if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
    sendJson(res, 200, job); return;
  }
  if (req.method === "POST" && endpoint === "/local/start") { const body = await readBody(req); sendJson(res, 200, await startLocalModel(String(body.name || ""))); return; }
  if (req.method === "POST" && endpoint === "/local/stop") { await stopLocalModel(); const registry = loadRegistry(); registry.active = null; saveRegistry(registry); sendJson(res, 200, { stopped: true }); return; }
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
  const registry = loadRegistry();
  if (registry.active) {
    try { await startLocalModel(registry.active); }
    catch (error) { console.error(`[openhands-model-manager] Could not restore local model: ${publicError(error)}`); }
  }
});
