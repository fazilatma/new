#!/usr/bin/env node
/**
 * Integration laboratory for the configurable local-model bind address.
 *
 * It starts the real manager against a stateful mock of the official OpenHands
 * API and proves that the installed-model table reports the model IP/port, that
 * both values can be changed, that the managed Profile and its encrypted
 * Provider Connection follow the new address, and that unusable or reserved
 * values are rejected instead of silently accepted.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const labDir = path.dirname(fileURLToPath(import.meta.url));
const managerScript = path.resolve(labDir, "..", "openhands-model-manager.mjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-local-address-"));
const sessionKey = "local-address-session-key";
const profiles = new Map();
const connections = [];
const connectionPatches = [];

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

const backend = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://backend.invalid");
  if (req.method === "GET" && url.pathname === "/api/profiles") {
    json(res, 200, { profiles: [...profiles].map(([name, profile]) => ({ name, model: profile.config.model })) });
    return;
  }
  if (url.pathname.startsWith("/api/profiles/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
    if (req.method === "GET") {
      const profile = profiles.get(name);
      json(res, profile ? 200 : 404, profile ? { name, ...profile } : { error: "not found" });
      return;
    }
    if (req.method === "POST") {
      const body = await requestBody(req);
      assert.equal(body.include_secrets, false, "profile writes must use include_secrets=false");
      assert.ok(!Object.hasOwn(body.llm, "api_key"), "profiles must never store an inline key");
      profiles.set(name, { config: body.llm, api_key_set: Boolean(body.llm.provider_connection_id) });
      json(res, 200, { name, ...profiles.get(name) });
      return;
    }
  }
  if (req.method === "GET" && url.pathname === "/api/llm/provider-connections") {
    json(res, 200, connections);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/llm/provider-connections") {
    const body = await requestBody(req);
    const created = {
      id: `connection-${connections.length + 1}`,
      display_name: body.display_name,
      provider: body.provider,
      base_url: body.base_url,
      api_key_set: Boolean(body.api_key),
    };
    connections.push(created);
    json(res, 201, created);
    return;
  }
  if (req.method === "PATCH" && url.pathname.startsWith("/api/llm/provider-connections/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const index = connections.findIndex((item) => item.id === id);
    if (index < 0) { json(res, 404, { error: "not found" }); return; }
    const body = await requestBody(req);
    connectionPatches.push({ id, ...body });
    connections[index] = { ...connections[index], base_url: body.base_url ?? connections[index].base_url };
    json(res, 200, connections[index]);
    return;
  }
  if (req.method === "GET" && url.pathname === "/server_info") { json(res, 200, { version: "1.49.6" }); return; }
  json(res, 404, { error: `Unhandled laboratory endpoint: ${req.method} ${url.pathname}` });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function managerCall(port, endpoint, init = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/_openhands/models-api${endpoint}`, {
    ...init,
    headers: { "content-type": "application/json", "x-session-api-key": sessionKey, ...(init.headers || {}) },
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  return { status: response.status, value };
}

async function waitForReady(port, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Manager exited before readiness with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for model manager readiness");
}

let child;
let stdout = "";
let stderr = "";
try {
  const backendPort = await listen(backend);
  const managerPort = await freePort();
  const defaultLocalPort = await freePort();
  const changedPort = await freePort();
  const dataDir = path.join(tempDir, "data");
  const toolsDir = path.join(tempDir, "tools");
  fs.mkdirSync(path.join(dataDir, "models"), { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  const modelFile = path.join(dataDir, "models", "demo.gguf");
  fs.writeFileSync(modelFile, Buffer.alloc(64));
  fs.writeFileSync(path.join(dataDir, "local-models.json"), `${JSON.stringify({
    version: 2,
    active: null,
    models: [{
      name: "demo",
      file: modelFile,
      bytes: 64,
      contextLength: 16384,
      threads: 1,
      batchSize: 512,
      ubatchSize: 256,
      parallel: 1,
      mmap: true,
      mlock: false,
      gguf: { version: 3 },
    }],
  }, null, 2)}\n`);

  child = spawn(process.execPath, [managerScript], {
    env: {
      ...process.env,
      LOCAL_BACKEND_API_KEY: sessionKey,
      OH_MODEL_MANAGER_PORT: String(managerPort),
      OH_LOCAL_MODEL_PORT: String(defaultLocalPort),
      OH_MODEL_MANAGER_BACKEND_PORT: String(backendPort),
      OH_GATEWAY_BASE_PATH: "/open",
      OH_MODEL_MANAGER_CONFIG_FILE: path.join(tempDir, "manager.json"),
      OH_MODEL_MANAGER_DATA_DIR: dataDir,
      OH_MODEL_MANAGER_TOOLS_DIR: toolsDir,
      OH_MODEL_MANAGER_WORKSPACE: tempDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await waitForReady(managerPort, child);

  const page = await (await fetch(`http://127.0.0.1:${managerPort}/models`)).text();
  assert.match(page, /<th>IP و پورت<\/th>/, "installed-model table must expose an IP/port column");
  assert.match(page, /id="gguf-host"/, "a bind-address field must exist");
  assert.match(page, /id="gguf-port"/, "a port field must exist");
  assert.match(page, /esc\(m\.host\)\+":"\+esc\(m\.port\)/, "each row must render its own host and port");

  // Startup reconciliation creates the managed Profile and its encrypted
  // connection asynchronously; wait for it before changing the address.
  const reconcileDeadline = Date.now() + 15000;
  while (Date.now() < reconcileDeadline && !(profiles.has("local-demo") && connections.length)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(profiles.has("local-demo") && connections.length, "startup must create the managed local Profile and connection");

  const initial = await managerCall(managerPort, "/local/status");
  assert.equal(initial.status, 200);
  const initialModel = initial.value.models[0];
  assert.equal(initialModel.host, "127.0.0.1", "a model defaults to loopback");
  assert.equal(initialModel.port, defaultLocalPort);
  assert.equal(initialModel.baseUrl, `http://127.0.0.1:${defaultLocalPort}/v1`);
  assert.equal(initial.value.defaults.port, defaultLocalPort);

  const changed = await managerCall(managerPort, "/local/models/demo", {
    method: "PUT",
    body: JSON.stringify({ host: "127.0.0.1", port: changedPort, contextLength: 16384 }),
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.value));
  assert.equal(changed.value.options.port, changedPort, "the port must be persisted");
  assert.equal(changed.value.baseUrl, `http://127.0.0.1:${changedPort}/v1`);
  assert.equal(changed.value.warning, null, "a loopback address must not raise an exposure warning");
  const profile = profiles.get("local-demo");
  assert.ok(profile, "the managed Profile must exist");
  assert.equal(profile.config.base_url, `http://127.0.0.1:${changedPort}/v1`, "the Profile endpoint must follow the new port");
  assert.equal(connections[0].base_url, `http://127.0.0.1:${changedPort}/v1`, "the encrypted Provider Connection must follow the new port");
  assert.ok(connectionPatches.every((patch) => !Object.hasOwn(patch, "api_key")), "an address change must never resend a credential");

  const afterChange = await managerCall(managerPort, "/local/status");
  assert.equal(afterChange.value.models[0].port, changedPort, "the table data must report the changed port");

  const exposed = await managerCall(managerPort, "/local/models/demo", {
    method: "PUT",
    body: JSON.stringify({ host: "0.0.0.0", port: changedPort }),
  });
  assert.equal(exposed.status, 200, JSON.stringify(exposed.value));
  assert.equal(exposed.value.options.host, "0.0.0.0");
  assert.equal(exposed.value.baseUrl, `http://127.0.0.1:${changedPort}/v1`, "clients must still reach an all-interfaces bind through loopback");
  assert.ok(exposed.value.warning, "a non-loopback bind address must return an explicit warning");

  const badHost = await managerCall(managerPort, "/local/models/demo", {
    method: "PUT",
    body: JSON.stringify({ host: "203.0.113.9", port: changedPort }),
  });
  assert.equal(badHost.status, 500, JSON.stringify(badHost.value));
  assert.match(String(badHost.value.error), /does not belong to this host/);

  const reservedPort = await managerCall(managerPort, "/local/models/demo", {
    method: "PUT",
    body: JSON.stringify({ host: "127.0.0.1", port: backendPort }),
  });
  assert.equal(reservedPort.status, 500, JSON.stringify(reservedPort.value));
  assert.match(String(reservedPort.value.error), /reserved/);

  const stillValid = await managerCall(managerPort, "/local/status");
  assert.equal(stillValid.value.models[0].port, changedPort, "a rejected change must not corrupt the stored configuration");
  assert.ok(!stdout.includes(sessionKey) && !stderr.includes(sessionKey), "manager logs must not contain the session key");

  const evidence = {
    status: "passed",
    assertions: {
      tableReportsHostAndPort: true,
      addressFieldsRendered: true,
      defaultLoopbackAddress: true,
      portChangePersisted: true,
      profileEndpointFollowsAddress: true,
      providerConnectionEndpointFollowsAddress: true,
      credentialNeverResent: true,
      allInterfacesBindWarned: true,
      unownedAddressRejected: true,
      reservedPortRejected: true,
      rejectedChangeLeftConfigIntact: true,
      sessionKeyLeak: false,
    },
    endpoint: { host: exposed.value.options.host, port: changedPort, baseUrl: exposed.value.baseUrl },
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 5000).unref();
    });
  }
  await new Promise((resolve) => backend.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
