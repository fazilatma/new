#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const labDir = path.dirname(fileURLToPath(import.meta.url));
const managerScript = path.resolve(labDir, "..", "openhands-model-manager.mjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-provider-lab-"));
const importedApiKey = "LAB_ONLY_SECRET_MUST_NEVER_LEAK_92741";
const failedApiKey = "LAB_FAILED_SECRET_MUST_NEVER_LEAK_61802";
const sessionKey = "lab-session-key";
const profileWrites = [];
const connectionPatches = [];
const profiles = new Map([
  ["openrouter-existing-a", {
    config: { model: "openrouter/vendor/a", base_url: "https://openrouter.ai/api/v1", max_input_tokens: 16384 },
    api_key_set: false,
  }],
  ["custom-openrouter-existing", {
    config: { model: "openrouter/vendor/other", base_url: "https://openrouter.ai/api/v1", max_input_tokens: 32768 },
    api_key_set: false,
  }],
  ["anthropic-untouched", {
    config: { model: "anthropic/claude-test", max_input_tokens: 16384 },
    api_key_set: false,
  }],
]);
let connection = {
  id: "connection-openrouter-existing",
  display_name: "Legacy OpenRouter Label",
  provider: "openrouter",
  base_url: "https://openrouter.ai/api/v1",
  api_key_set: true,
};

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
    json(res, 200, { profiles: [...profiles.keys()].map((name) => ({ name })) });
    return;
  }
  if (url.pathname.startsWith("/api/profiles/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
    if (req.method === "GET") {
      const profile = profiles.get(name);
      if (!profile) { json(res, 404, { error: "not found" }); return; }
      json(res, 200, { name, config: profile.config, api_key_set: profile.api_key_set });
      return;
    }
    if (req.method === "POST") {
      const body = await requestBody(req);
      assert.equal(body.include_secrets, false, "profile writes must use include_secrets=false");
      assert.ok(body.llm && typeof body.llm === "object", "profile write requires llm config");
      assert.ok(!Object.hasOwn(body.llm, "api_key"), "API key must never be stored inline in a profile");
      profileWrites.push({ name, body });
      profiles.set(name, {
        config: body.llm,
        api_key_set: Boolean(body.llm.provider_connection_id),
      });
      json(res, 200, { name, config: body.llm, api_key_set: Boolean(body.llm.provider_connection_id) });
      return;
    }
  }
  if (req.method === "GET" && url.pathname === "/api/llm/provider-connections") {
    json(res, 200, [connection]);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/llm/provider-connections") {
    const body = await requestBody(req);
    json(res, 400, { error: `Rejected api_key:${body.api_key}` });
    return;
  }
  if (req.method === "PATCH" && url.pathname === `/api/llm/provider-connections/${connection.id}`) {
    const body = await requestBody(req);
    connectionPatches.push(body);
    connection = { ...connection, base_url: body.base_url, api_key_set: Boolean(body.api_key) };
    json(res, 200, connection);
    return;
  }
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
  const localModelPort = await freePort();
  const dataDir = path.join(tempDir, "data");
  const toolsDir = path.join(tempDir, "tools");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  child = spawn(process.execPath, [managerScript], {
    env: {
      ...process.env,
      LOCAL_BACKEND_API_KEY: sessionKey,
      OH_MODEL_MANAGER_PORT: String(managerPort),
      OH_LOCAL_MODEL_PORT: String(localModelPort),
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

  const document = {
    providers: [{
      name: "OpenRouter",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: importedApiKey,
      models: [
        { id: "vendor/a", name: "A", profileName: "openrouter-existing-a" },
        { id: "vendor/new", name: "New" },
      ],
    }],
  };
  const response = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/providers/import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-api-key": sessionKey },
    body: JSON.stringify({ document, overwrite: false, importSecrets: false }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.connectionsUpdated, 1, "existing encrypted connection must be rotated");
  assert.equal(result.connectionsCreated, 0);
  assert.equal(result.profilesExisting, 1);
  assert.equal(result.profilesCreated, 1);
  assert.equal(result.profilesLinked, 3, "all existing and imported OpenRouter profiles must be linked");
  assert.equal(connectionPatches.length, 1);
  assert.equal(connectionPatches[0].api_key, importedApiKey, "imported key must reach only the Provider Connection PATCH");

  for (const name of ["openrouter-existing-a", "custom-openrouter-existing", "openrouter-new"]) {
    assert.equal(profiles.get(name)?.config.provider_connection_id, connection.id, `${name} must use the encrypted connection`);
  }
  assert.equal(profiles.get("anthropic-untouched").config.provider_connection_id, undefined, "unrelated providers must remain untouched");
  assert.ok(profileWrites.length >= 3, "laboratory must observe real profile API writes");

  const snapshot = fs.readFileSync(path.join(dataDir, "providers-last-import.json"), "utf8");
  assert.ok(!snapshot.includes(importedApiKey), "redacted import snapshot must not contain the API key");
  assert.ok(!stdout.includes(importedApiKey) && !stderr.includes(importedApiKey), "manager logs must not contain the API key");

  const exportResponse = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/providers/export`, {
    headers: { "x-session-api-key": sessionKey },
  });
  const exported = await exportResponse.text();
  assert.equal(exportResponse.status, 200, exported);
  assert.ok(!exported.includes(importedApiKey), "safe export must not contain the API key");
  assert.equal(JSON.parse(exported).secretsIncluded, false);

  const failedResponse = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/providers/import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-api-key": sessionKey },
    body: JSON.stringify({
      document: {
        providers: [{
          name: "Failing Anthropic",
          provider: "anthropic",
          apiKey: failedApiKey,
          models: [{ id: "claude-failure-probe" }],
        }],
      },
    }),
  });
  const failedText = await failedResponse.text();
  assert.equal(failedResponse.status, 500, failedText);
  assert.ok(!failedText.includes(failedApiKey), "backend credential errors must not reflect the API key to the browser");
  assert.ok(!stdout.includes(failedApiKey) && !stderr.includes(failedApiKey), "backend credential errors must not leak into manager logs");

  const evidence = {
    status: "passed",
    assertions: {
      connectionRotated: true,
      existingProviderProfilesLinked: 2,
      importedProfilesLinked: 1,
      unrelatedProfileUntouched: true,
      inlineProfileSecrets: false,
      snapshotSecretLeak: false,
      exportSecretLeak: false,
      logSecretLeak: false,
      failedCredentialErrorRedacted: true,
    },
    summary: result,
  };
  fs.writeFileSync(path.join(tempDir, "provider-import-result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
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
