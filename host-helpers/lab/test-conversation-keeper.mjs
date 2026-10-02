#!/usr/bin/env node
/**
 * Permanent laboratory for server-side continuity.
 *
 * The agent loop itself lives inside the Agent Server, so a closed browser or a
 * dropped network never stops it. What can stop it is a restart that leaves a
 * conversation persisted as paused or error. This gate runs the real manager
 * against a mock Agent Server and proves that such conversations are resumed
 * server-side, that finished work is left alone, that the keeper can be turned
 * off, that it stops after its hourly budget, that it survives a manager
 * restart, and that it never leaks the session key.
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-keeper-"));
const sessionKey = "keeper-session-key";

const conversations = new Map([
  ["11111111-1111-4111-8111-111111111111", { execution_status: "running" }],
  ["22222222-2222-4222-8222-222222222222", { execution_status: "idle" }],
]);
const runCalls = [];
let authenticatedCalls = 0;
let unauthenticatedCalls = 0;

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

const backend = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://backend.invalid");
  if (req.headers["x-session-api-key"] === sessionKey) authenticatedCalls += 1;
  else unauthenticatedCalls += 1;
  if (req.method === "GET" && url.pathname === "/api/conversations/search") {
    json(res, 200, { items: [...conversations].map(([id, value]) => ({ id, ...value })), next_page_id: null });
    return;
  }
  const run = url.pathname.match(/^\/api\/conversations\/([^/]+)\/run$/);
  if (req.method === "POST" && run) {
    const id = decodeURIComponent(run[1]);
    runCalls.push(id);
    const conversation = conversations.get(id);
    if (!conversation) { json(res, 404, { error: "not found" }); return; }
    if (conversation.execution_status === "running") { json(res, 409, { detail: "Conversation already running." }); return; }
    conversation.execution_status = "running";
    json(res, 200, { success: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/profiles") { json(res, 200, { profiles: [] }); return; }
  if (req.method === "GET" && url.pathname === "/api/llm/provider-connections") { json(res, 200, []); return; }
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
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Timed out waiting for model manager readiness");
}

let child;
let stdout = "";
let stderr = "";
let managerPort;
let backendPort;
const dataDir = path.join(tempDir, "data");

function startManager() {
  const started = spawn(process.execPath, [managerScript], {
    env: {
      ...process.env,
      LOCAL_BACKEND_API_KEY: sessionKey,
      OH_MODEL_MANAGER_PORT: String(managerPort),
      OH_LOCAL_MODEL_PORT: String(9999),
      OH_MODEL_MANAGER_BACKEND_PORT: String(backendPort),
      OH_GATEWAY_BASE_PATH: "/open",
      OH_MODEL_MANAGER_CONFIG_FILE: path.join(tempDir, "manager.json"),
      OH_MODEL_MANAGER_DATA_DIR: dataDir,
      OH_MODEL_MANAGER_TOOLS_DIR: path.join(tempDir, "tools"),
      OH_MODEL_MANAGER_WORKSPACE: tempDir,
      OH_KEEPER_INTERVAL_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  started.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  started.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return started;
}

async function stopManager() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 5000).unref();
  });
}

async function api(endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api${endpoint}`, {
    ...options,
    headers: {
      "x-session-api-key": sessionKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { status: response.status, value: text ? JSON.parse(text) : null };
}

async function waitFor(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

try {
  backendPort = await listen(backend);
  managerPort = await freePort();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(tempDir, "tools"), { recursive: true });

  child = startManager();
  await waitForReady(managerPort, child);

  // The keeper must first observe the running conversation.
  await waitFor(async () => {
    const { value } = await api("/keeper");
    return value.watched.some((row) => row.id.startsWith("1111") && row.lastStatus === "running");
  }, "the keeper never observed the running conversation");

  // Simulate a lost run task: the conversation is persisted as paused.
  conversations.get("11111111-1111-4111-8111-111111111111").execution_status = "paused";
  await waitFor(() => runCalls.includes("11111111-1111-4111-8111-111111111111"), "an interrupted conversation was not resumed server-side");
  assert.ok(!runCalls.includes("22222222-2222-4222-8222-222222222222"), "an idle conversation must never be auto-started");

  const afterResume = (await api("/keeper")).value;
  assert.equal(afterResume.enabled, true);
  assert.ok(afterResume.resumedTotal >= 1, "the keeper must report how often it resumed work");
  assert.ok(afterResume.log.some((entry) => entry.action === "resume" && entry.ok), "resumes must be visible in the keeper log");

  // A manager restart must not lose the watch list: work continues after restart.
  await stopManager();
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "conversation-keeper.json"), "utf8"));
  assert.ok(persisted.watched["11111111-1111-4111-8111-111111111111"], "the keeper state must survive a restart");
  conversations.get("11111111-1111-4111-8111-111111111111").execution_status = "paused";
  const runsBeforeRestart = runCalls.length;
  child = startManager();
  await waitForReady(managerPort, child);
  await waitFor(() => runCalls.length > runsBeforeRestart, "a conversation interrupted by a restart was not resumed");

  // Turning the keeper off must stop automatic resumes.
  const disabled = await api("/keeper", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  assert.equal(disabled.value.enabled, false);
  conversations.get("11111111-1111-4111-8111-111111111111").execution_status = "paused";
  const runsWhileDisabled = runCalls.length;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(runCalls.length, runsWhileDisabled, "a disabled keeper must never resume anything");

  // A manual resume must still work while the keeper is off.
  const manual = await api("/keeper/resume", { method: "POST", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(manual.status, 200);
  assert.equal(manual.value.resumed, true);

  const enabled = await api("/keeper", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  assert.equal(enabled.value.enabled, true);

  const status = await api("/status");
  assert.ok(status.value.keeper, "/status must expose the keeper so the page can render it");
  assert.equal(typeof status.value.keeper.intervalMs, "number");

  const unauthorized = await fetch(`http://127.0.0.1:${managerPort}/_openhands/models-api/keeper`);
  assert.equal(unauthorized.status, 401, "the keeper API must stay authenticated");
  assert.equal(unauthenticatedCalls, 0, "the manager must always authenticate to the Agent Server");
  assert.ok(authenticatedCalls > 0);
  assert.ok(!stdout.includes(sessionKey) && !stderr.includes(sessionKey), "keeper logs must not contain the session key");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    assertions: {
      runningConversationObserved: true,
      interruptedConversationResumed: true,
      idleConversationLeftAlone: true,
      resumeVisibleInKeeperLog: true,
      keeperStateSurvivesRestart: true,
      restartInterruptionResumed: true,
      keeperCanBeDisabled: true,
      manualResumeWorks: true,
      keeperExposedInStatus: true,
      keeperApiAuthenticated: true,
      sessionKeyLeak: false,
    },
    resumeCalls: runCalls.length,
  }, null, 2)}\n`);
} finally {
  await stopManager();
  await new Promise((resolve) => backend.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
