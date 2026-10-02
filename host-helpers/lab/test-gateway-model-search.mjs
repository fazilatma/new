#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const labDir = path.dirname(fileURLToPath(import.meta.url));
const helperFile = path.resolve(labDir, "..", "install-openhands-host.sh");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-gateway-search-"));
const helper = fs.readFileSync(helperFile, "utf8");
const gatewaySource = helper.match(/cat > "\$GATEWAY_SCRIPT" <<'EOF_GATEWAY'\n([\s\S]*?)\nEOF_GATEWAY/)?.[1];
assert.ok(gatewaySource, "the gateway heredoc must remain extractable for laboratory validation");
const gatewayFile = path.join(tempDir, "prefix-gateway.mjs");
fs.writeFileSync(gatewayFile, gatewaySource, { mode: 0o700 });

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

async function waitForPage(port, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Gateway exited before readiness with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/open/`);
      if (response.ok) return { response, html: await response.text() };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the extracted gateway");
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.focused = false;
    this.clicked = 0;
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) { for (const node of nodes) { this.detach(node); node.parentElement = this; this.children.push(node); } }
  prepend(node) { this.detach(node); node.parentElement = this; this.children.unshift(node); }
  detach(node) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((item) => item !== node); }
  insertBefore(node, reference) {
    this.detach(node);
    node.parentElement = this;
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? 0 : index, 0, node);
  }
  insertAdjacentElement(position, node) {
    const parent = this.parentElement;
    if (!parent) return;
    parent.detach(node);
    node.parentElement = parent;
    const index = parent.children.indexOf(this);
    parent.children.splice(position === "afterend" ? index + 1 : index, 0, node);
  }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() { if (this.parentElement) this.parentElement.detach(this); }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentElement; } return null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  focus() { this.focused = true; }
  click() { this.clicked += 1; }
  matches(selector) {
    if (selector === "aside") return this.tagName === "ASIDE";
    if (selector === "input") return this.tagName === "INPUT";
    if (selector === "li") return this.tagName === "LI";
    const present = selector.match(/^\[([^=\]]+)\]$/);
    if (present) return this.attributes.has(present[1]);
    const exact = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
    if (exact) return this.getAttribute(exact[1]) === exact[2];
    const prefix = selector.match(/^([a-z]+)\[([^\]]+)\^="([^"]+)"\]$/i);
    if (prefix) return this.tagName === prefix[1].toUpperCase() && String(this.getAttribute(prefix[2]) || "").startsWith(prefix[3]);
    return false;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selectors.some((part) => child.matches(part))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function event(key = "") {
  return {
    key,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

function validateInjectedSearch(script) {
  const root = new FakeElement("html");
  const menu = new FakeElement("ul");
  menu.setAttribute("data-testid", "chat-input-llm-profile-popover");
  const remote = new FakeElement("button");
  remote.setAttribute("data-testid", "chat-input-llm-profile-option-openrouter-deepseek");
  remote.textContent = "openrouter-deepseek openrouter/deepseek/v4";
  const local = new FakeElement("button");
  local.setAttribute("data-testid", "chat-input-llm-profile-option-local-qwen");
  local.textContent = "local-qwen openai/qwen-local";
  const persian = new FakeElement("button");
  persian.setAttribute("data-testid", "chat-input-llm-profile-option-persian-model");
  persian.textContent = "مدل يک";
  menu.append(remote, local, persian);
  const acpMenu = new FakeElement("ul");
  acpMenu.setAttribute("data-testid", "chat-input-llm-model-popover");
  const acpModel = new FakeElement("button");
  acpModel.setAttribute("data-testid", "chat-input-acp-model-option-claude-sonnet");
  acpModel.textContent = "Claude Sonnet";
  acpMenu.append(acpModel);
  root.append(menu, acpMenu);

  const document = {
    documentElement: root,
    createElement: (name) => new FakeElement(name),
    createTextNode: (text) => ({ textContent: text, children: [], matches: () => false }),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  };
  class FakeMutationObserver { constructor(callback) { this.callback = callback; } observe() {} }
  const storage = (map) => ({ getItem: (name) => (name in map ? map[name] : null), setItem: (name, value) => { map[name] = String(value); } });
  const healthCalls = [];
  const context = {
    document,
    localStorage: storage({ "openhands-backends": JSON.stringify([{ id: "default-local", apiKey: "lab-session-key" }]) }),
    sessionStorage: storage({}),
    fetch: async (url, init) => {
      healthCalls.push({ url, key: init && init.headers && init.headers["x-session-api-key"] });
      return {
        ok: true,
        json: async () => ({
          testedAt: new Date().toISOString(),
          passed: [{ name: "local-qwen", model: "openai/qwen-local" }],
          failed: [{ name: "openrouter-deepseek", model: "openrouter/deepseek/v4", errorClass: "auth" }],
        }),
      };
    },
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    addEventListener: () => {},
    console,
  };
  vm.runInNewContext(script, context, { filename: "injected-canvas-enhancements.js" });

  const box = menu.querySelector("[data-oh-model-search]");
  assert.ok(box, "the Profile/model dropdown must receive a search control");
  const input = box.querySelector("input");
  const empty = box.querySelector("[data-oh-model-search-empty]");
  assert.equal(input.type, "search");
  assert.equal(input.placeholder, "جستجوی مدل یا Profile…");
  assert.equal(input.focused, true);
  const acpInput = acpMenu.querySelector("[data-oh-model-search]").querySelector("input");
  acpInput.value = "sonnet";
  acpInput.emit("input");
  assert.equal(acpModel.hidden, false);
  acpInput.value = "qwen";
  acpInput.emit("input");
  assert.equal(acpModel.hidden, true);

  input.value = "local qwen";
  input.emit("input");
  assert.equal(remote.hidden, true);
  assert.equal(local.hidden, false);
  assert.equal(persian.hidden, true);
  assert.equal(empty.hidden, true);

  input.value = "مدل یک";
  input.emit("input");
  assert.equal(remote.hidden, true);
  assert.equal(local.hidden, true);
  assert.equal(persian.hidden, false);

  input.value = "missing-model";
  input.emit("input");
  assert.equal(remote.hidden, true);
  assert.equal(local.hidden, true);
  assert.equal(persian.hidden, true);
  assert.equal(empty.hidden, false);

  const escape = event("Escape");
  input.emit("keydown", escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(input.value, "");
  assert.equal(remote.hidden, false);
  assert.equal(local.hidden, false);
  assert.equal(persian.hidden, false);

  input.value = "local";
  input.emit("input");
  const enter = event("Enter");
  input.emit("keydown", enter);
  assert.equal(local.clicked, 1);
  return { healthCalls, menu, local, remote, persian };
}

async function validateHealthGrouping(state) {
  const { healthCalls, menu, local, remote, persian } = state;
  assert.ok(healthCalls.length > 0, "the dropdown must ask the manager for the last test results");
  assert.match(healthCalls[0].url, /\/_openhands\/models-api\/model-health$/, "health must come from the authenticated manager API");
  assert.equal(healthCalls[0].key, "lab-session-key", "the health request must be authenticated from local storage, never from the HTML");
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(local.getAttribute("data-oh-health"), "passed", "a model that passed its test must be marked as passed");
  assert.equal(remote.getAttribute("data-oh-health"), "failed", "a model that failed its test must be marked as failed");
  assert.equal(persian.getAttribute("data-oh-health"), null, "an untested model must stay neutral");
  const order = menu.children.filter((node) => node.getAttribute("data-oh-model-group") || node.getAttribute("data-testid"));
  const labels = order.map((node) => node.getAttribute("data-oh-model-group") || node.getAttribute("data-testid"));
  assert.deepEqual(labels, [
    "passed",
    "chat-input-llm-profile-option-local-qwen",
    "chat-input-llm-profile-option-persian-model",
    "failed",
    "chat-input-llm-profile-option-openrouter-deepseek",
  ], "passing models must come first, failing models must come after the divider");
  return true;
}

let gateway;
let gatewayStdout = "";
let gatewayStderr = "";
const upstreamRequests = [];
const upstream = http.createServer((req, res) => {
  upstreamRequests.push(req.url);
  const body = "<!doctype html><html><head><title>Canvas fixture</title></head><body><main>Canvas</main></body></html>";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
});

try {
  const upstreamPort = await listen(upstream);
  const gatewayPort = await freePort();
  const managerPort = await freePort();
  gateway = spawn(process.execPath, [gatewayFile], {
    env: {
      ...process.env,
      OH_GATEWAY_HOST: "127.0.0.1",
      OH_GATEWAY_PORT: String(gatewayPort),
      OH_GATEWAY_UPSTREAM_PORT: String(upstreamPort),
      OH_GATEWAY_MODEL_MANAGER_PORT: String(managerPort),
      OH_GATEWAY_BASE_PATH: "/open",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout.on("data", (chunk) => { gatewayStdout += chunk.toString(); });
  gateway.stderr.on("data", (chunk) => { gatewayStderr += chunk.toString(); });

  const { response, html } = await waitForPage(gatewayPort, gateway);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(upstreamRequests, ["/open/"]);
  assert.match(html, /data-testid="chat-input-llm-profile-popover"/);
  assert.match(html, /data-testid="chat-input-llm-model-popover"/);
  assert.match(html, /data-oh-model-search/);
  assert.match(html, /جستجوی مدل یا Profile/);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2, "base-path and Canvas enhancement scripts must both be injected");
  for (const script of scripts) assert.doesNotThrow(() => new Function(script), "every injected browser script must parse");
  const enhancement = html.match(/<script id="openhands-host-sidebar-script">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(enhancement);
  await validateHealthGrouping(validateInjectedSearch(enhancement));
  assert.equal(gatewayStderr, "");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    assertions: {
      gatewayInjectionPassed: true,
      injectedScriptsParsed: true,
      profileAndModelDropdownsTargeted: true,
      unicodeSearchFilteringPassed: true,
      emptyStatePassed: true,
    passedModelsHighlightedFirst: true,
    failedModelsAfterDivider: true,
    healthRequestAuthenticated: true,
      escapeResetPassed: true,
      keyboardSelectionPassed: true,
      upstreamBasePathPreserved: true,
    },
  }, null, 2)}\n`);
} finally {
  if (gateway && gateway.exitCode === null) {
    gateway.kill("SIGTERM");
    await new Promise((resolve) => {
      gateway.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  await new Promise((resolve) => upstream.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
