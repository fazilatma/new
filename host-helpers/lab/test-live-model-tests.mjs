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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-live-tests-"));
const sessionKey = "live-test-session-key";
const profiles = new Map([
  ["good-profile", { config: { model: "openai/good-model", max_input_tokens: 16384 }, api_key_set: true }],
  ["bad-profile", { config: { model: "anthropic/bad-model", max_input_tokens: 16384 }, api_key_set: true }],
  ["slow-profile", { config: { model: "mistral/slow-model", max_input_tokens: 32768 }, api_key_set: true }],
]);

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

const backend = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://backend.invalid");
  if (req.method === "GET" && url.pathname === "/api/profiles") {
    json(res, 200, { profiles: [...profiles].map(([name, profile]) => ({ name, model: profile.config.model })) });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/profiles/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
    const profile = profiles.get(name);
    json(res, profile ? 200 : 404, profile ? { name, ...profile } : { error: "not found" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/llm/provider-connections") {
    json(res, 200, []);
    return;
  }
  if (req.method === "GET" && url.pathname === "/server_info") {
    json(res, 200, { version: "1.49.6" });
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for model manager readiness");
}

async function managerCall(port, endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/_openhands/models-api${endpoint}`, {
    ...options,
    headers: {
      "x-session-api-key": sessionKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`);
  return { status: response.status, value };
}

async function waitForJob(port, id, snapshots) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const { value: job } = await managerCall(port, `/jobs/${id}`);
    snapshots.push({ status: job.status, completed: job.completed || 0, results: job.results || [] });
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error("Timed out waiting for live profile-test job");
}

async function waitForRecoverableJob(port, id) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value: status } = await managerCall(port, "/status");
    const job = status.jobs.find((item) => item.id === id);
    if (job?.results?.length === 3 && ["queued", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Active profile-test job was not recoverable through manager status");
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
  const fakeUv = path.join(tempDir, "fake-uv.py");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(fakeUv, `#!/usr/bin/env python3
import json, sys, time
payload = json.load(sys.stdin)
names = payload.get("profiles", [])
stream = payload.get("stream") is True
results = []
if stream:
    concurrency = max(1, int(payload.get("concurrency") or 1))
    print(json.dumps({"event":"started","total":len(names),"concurrency":concurrency}), flush=True)
    for running_name in names[:concurrency]:
        print(json.dumps({"event":"profile-started","name":running_name,"queueMs":0}), flush=True)
for index, name in enumerate(names):
    time.sleep(0.22)
    ok = name != "bad-profile"
    model = {"good-profile":"openai/good-model","bad-profile":"anthropic/bad-model","slow-profile":"mistral/slow-model"}.get(name)
    result = {"name":name,"model":model,"provider":model.split("/",1)[0],"ok":ok,"latencyMs":80+index*35,"queueMs":index*12,"error":None if ok else {"type":"BadRequestError","message":"Provider rejected the laboratory request"}}
    results.append(result)
    if stream:
        print(json.dumps({"event":"result","result":result}), flush=True)
        next_index = index + concurrency
        if next_index < len(names):
            print(json.dumps({"event":"profile-started","name":names[next_index],"queueMs":index*12+12}), flush=True)
if stream:
    print(json.dumps({"event":"summary","tested":len(names)}), flush=True)
else:
    print(json.dumps({"tested":len(results),"results":results}), flush=True)
sys.exit(0 if all(name != "bad-profile" for name in names) else 1)
`);
  fs.chmodSync(fakeUv, 0o700);

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
      OH_MODEL_MANAGER_UV_BIN: fakeUv,
      OH_MODEL_MANAGER_TESTER: fakeUv,
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
  assert.match(page, /id="test-modal"/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /focusable=\[\.\.\.modal\.querySelectorAll/);
  assert.match(page, /id="test-result-body"/);
  assert.match(page, /\/profiles\/test-jobs/);
  assert.match(page, /@media\(max-width:680px\)/);
  assert.match(page, /data-test-filter="failed"/);
  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "manager page must contain its interaction script");
  assert.doesNotThrow(() => new Function(script), "generated browser script must parse");

  const started = await managerCall(managerPort, "/profiles/test-jobs", {
    method: "POST",
    body: JSON.stringify({ concurrency: 2 }),
  });
  assert.equal(started.status, 202);
  assert.match(started.value.jobId, /^[a-f0-9]{24}$/);
  const recoverableJob = await waitForRecoverableJob(managerPort, started.value.jobId);
  assert.equal(recoverableJob.kind, "profile-test");
  assert.equal(recoverableJob.results.length, 3);
  const snapshots = [];
  const finalJob = await waitForJob(managerPort, started.value.jobId, snapshots);
  assert.equal(finalJob.status, "completed");
  assert.equal(finalJob.total, 3);
  assert.equal(finalJob.completed, 3);
  assert.equal(finalJob.passed, 2);
  assert.equal(finalJob.failed, 1);
  assert.equal(finalJob.results.length, 3);
  assert.ok(snapshots.some((snapshot) => snapshot.status === "running" && snapshot.completed > 0 && snapshot.completed < 3), "polling must expose partial live results before completion");
  assert.ok(snapshots.some((snapshot) => snapshot.results.some((row) => ["queued", "running"].includes(row.status))), "live rows must expose queue/running states");
  assert.ok(snapshots.some((snapshot) => snapshot.results.some((row) => row.name === "slow-profile" && row.status === "running") && snapshot.completed > 0), "a queued row must transition to running when a concurrency slot opens");
  assert.equal(finalJob.results.find((row) => row.name === "bad-profile").error.type, "BadRequestError");
  assert.equal(finalJob.results.find((row) => row.name === "good-profile").provider, "openai");
  assert.equal(finalJob.result.tested, 3);

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "last-model-tests.json"), "utf8"));
  assert.equal(persisted.tested, 3);
  assert.equal(persisted.results.filter((row) => row.ok).length, 2);

  const blocking = await managerCall(managerPort, "/profiles/test", {
    method: "POST",
    body: JSON.stringify({ profiles: ["good-profile"], concurrency: 1 }),
  });
  assert.equal(blocking.status, 200);
  assert.equal(blocking.value.tested, 1);
  assert.equal(blocking.value.results[0].provider, "openai");

  const cancellation = await managerCall(managerPort, "/profiles/test-jobs", {
    method: "POST",
    body: JSON.stringify({ concurrency: 1 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const cancelled = await managerCall(managerPort, `/jobs/${cancellation.value.jobId}/cancel`, { method: "POST", body: "{}" });
  assert.equal(cancelled.status, 202);
  const cancelledJob = await waitForJob(managerPort, cancellation.value.jobId, []);
  assert.equal(cancelledJob.status, "cancelled");

  const evidence = {
    status: "passed",
    assertions: {
      modalRendered: true,
      accessibleDialogAndFocusTrap: true,
      generatedBrowserScriptParsed: true,
      responsiveMobileTablePresent: true,
      partialResultsObservedLive: true,
      activeJobRecoverableAfterRefresh: true,
      queuedAndRunningStatesObserved: true,
      queuedToRunningTransitionObserved: true,
      advancedMetricsPersisted: true,
      failedResultDetailsVisible: true,
      blockingCliCompatibilityPassed: true,
      cancellationPassed: true,
      secretLeakInLogs: false,
    },
    final: {
      total: finalJob.total,
      completed: finalJob.completed,
      passed: finalJob.passed,
      failed: finalJob.failed,
      progress: finalJob.progress,
    },
  };
  assert.ok(!stdout.includes(sessionKey) && !stderr.includes(sessionKey));
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
