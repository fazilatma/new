#!/usr/bin/env node
/**
 * Permanent laboratory for the authenticated model-manager page.
 *
 * It starts the real manager against a mock of the official OpenHands API and
 * checks the page a browser actually receives: the generated script must parse,
 * the usability controls must exist, every generated HTML attribute must stay
 * quoted (the escaping class of bug that previously produced invalid markup),
 * and /status must carry every field the page renders so the table cannot show
 * undefined values.
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-manager-ui-"));
const sessionKey = "manager-ui-session-key";
const profiles = new Map([
  ["openrouter-demo", { config: { model: "openrouter/vendor/demo", max_input_tokens: 16384 }, api_key_set: true }],
]);

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
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
    if (req.method === "POST") { json(res, 200, { name }); return; }
  }
  if (req.method === "GET" && url.pathname === "/api/llm/provider-connections") { json(res, 200, []); return; }
  if (req.method === "POST" && url.pathname === "/api/llm/provider-connections") {
    json(res, 201, { id: "connection-1", display_name: "Local llama.cpp: demo", provider: "openai", base_url: null, api_key_set: true });
    return;
  }
  if (req.method === "PATCH" && url.pathname.startsWith("/api/llm/provider-connections/")) { json(res, 200, { id: "connection-1" }); return; }
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
  fs.mkdirSync(path.join(dataDir, "models"), { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  const modelFile = path.join(dataDir, "models", "demo.gguf");
  fs.writeFileSync(modelFile, Buffer.alloc(32));
  fs.writeFileSync(path.join(dataDir, "local-models.json"), `${JSON.stringify({
    version: 2,
    active: null,
    models: [{ name: "demo", file: modelFile, bytes: 32, contextLength: 16384, threads: 1, batchSize: 512, ubatchSize: 256, parallel: 1, mmap: true, mlock: false, gguf: { version: 3 } }],
  }, null, 2)}\n`);

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

  const pageResponse = await fetch(`http://127.0.0.1:${managerPort}/models`);
  const page = await pageResponse.text();
  assert.equal(pageResponse.status, 200);

  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "the manager page must contain its interaction script");
  assert.doesNotThrow(() => new Function(script), "the generated browser script must parse");

  // Regression guard for the escaping bug class: generated markup must never
  // concatenate an attribute value without quotes around it.
  const unquoted = script.match(/data-(?:start|edit|delete|hf|hf-repo)=(?:\\?")?\s*\+/g) || [];
  assert.deepEqual(unquoted, [], "generated HTML attributes must stay quoted");
  assert.match(script, /data-start='"\+name\+"'/, "action buttons must use quoted attribute values");

  assert.match(page, /id="refresh"/, "a manual refresh control must exist");
  assert.match(page, /id="alert"/, "a global error bar must exist");
  assert.match(page, /id="alert-retry"/, "the error bar must offer a retry action");
  assert.match(page, /id="profile-search"/, "the Profile list must be searchable");
  assert.match(page, /id="profile-summary"/, "the Profile list must report how many entries match");
  assert.match(page, /id="updated"/, "the page must show when the data was last refreshed");
  assert.match(page, /class="scroll stack-table"/, "long tables must collapse into cards on small screens");
  assert.match(script, /setInterval\(\(\)=>\{if\(document\.hidden\|\|typing\(\)\|\|!q\("test-modal"\)\.hidden\)return;safeRefresh\(\)\},8000\)/, "auto-refresh must pause while hidden, typing, or testing");
  assert.match(script, /visibilitychange/, "returning to the tab must refresh immediately");
  assert.match(script, /threadsSeeded/, "the CPU-thread suggestion must not overwrite user input on every refresh");
  assert.match(script, /function watchInstallJob/, "an in-flight installation must be recoverable after a page reload");
  assert.match(script, /activeInstall/, "the page must adopt an installation that is already running");
  assert.match(page, /@media\(max-width:680px\)/, "the page must keep its mobile rules");

  assert.match(page, /id="version"/, "the header must show the running helper version");
  assert.match(page, /data-tab="changes"/, "the page must offer a changelog tab");
  assert.match(page, /id="changelog"/, "the changelog panel must exist");
  assert.match(script, /function renderVersion/, "the page must render the version and changelog from /status");
  for (const id of ["test-rerun-failed", "test-export", "test-export-csv", "test-copy-report"]) {
    assert.ok(page.includes(`id="${id}"`), `the test modal must offer the ${id} control`);
  }
  assert.match(script, /function testRowDiagnostics/, "each test row must produce copyable diagnostics");
  assert.match(script, /data-copy-row/, "each test row must expose a copy button");
  assert.match(script, /function downloadTestResults/, "test results must be exportable");
  assert.match(script, /profiles:only/, "re-running failed tests must send only the selected Profiles");
  assert.match(page, /@media\(max-width:760px\)/, "the test modal must get more room on phones");

  const status = await (await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/status`, {
    headers: { "x-session-api-key": sessionKey },
  })).json();
  assert.match(String(status.version || ""), /^\d+\.\d+\.\d+$|^dev$/, "/status must report the running helper version");
  assert.ok(Array.isArray(status.changelog) && status.changelog.length > 0, "/status must report the changelog");
  assert.ok(status.changelog.every((entry) => entry.version && Array.isArray(entry.items)), "each changelog entry must list its changes");
  assert.ok(Array.isArray(status.profiles), "/status must list Profiles for the overview table");
  assert.ok(Array.isArray(status.jobs), "/status must expose jobs so running work can be adopted");
  const model = status.local.models[0];
  for (const field of ["name", "host", "port", "baseUrl", "contextLength", "threads", "batchSize", "bytes"]) {
    assert.ok(model[field] !== undefined, `/status must provide ${field} for the installed-model table`);
  }
  assert.equal(typeof model.filePresent, "boolean", "the table must be able to report a missing GGUF file");

  const unauthorized = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/status`);
  assert.equal(unauthorized.status, 401, "the manager API must stay authenticated");
  assert.ok(!page.includes(sessionKey), "the page must never embed the session key");
  assert.ok(!stdout.includes(sessionKey) && !stderr.includes(sessionKey), "manager logs must not contain the session key");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    assertions: {
      generatedScriptParsed: true,
      quotedAttributesEnforced: true,
      manualRefreshControl: true,
      globalErrorBarWithRetry: true,
      searchableProfileList: true,
      lastUpdatedIndicator: true,
      responsiveCardTables: true,
      pausedAutoRefresh: true,
      threadSuggestionNotClobbered: true,
      installJobRecoverable: true,
      statusContractComplete: true,
      versionVisibleInUi: true,
      changelogPanelRendered: true,
      failedOnlyRerun: true,
      perRowDiagnostics: true,
      resultsExportable: true,
      roomierTestModalOnMobile: true,
      apiStaysAuthenticated: true,
      sessionKeyLeak: false,
    },
  }, null, 2)}\n`);
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
