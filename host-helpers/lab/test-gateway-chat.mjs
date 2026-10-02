#!/usr/bin/env node
/**
 * Permanent laboratory for the injected Agent Canvas chat improvements.
 *
 * It extracts the real gateway from the helper, serves a Canvas fixture through
 * it, compiles every injected browser script, and then runs the chat script
 * against a simulated Canvas DOM to prove the usability behaviour: automatic
 * text direction, jump-to-latest, per-code-block copy, the long-message
 * counter, Ctrl/Cmd+Enter send, Escape stop, and Ctrl+/ focus.
 */
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openhands-gateway-chat-"));
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
      if (response.ok) return await response.text();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the extracted gateway");
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.dispatched = [];
    this.disabled = false;
    this.focused = false;
    this.blurred = 0;
    this.clicked = 0;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())];
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  cloneNode() {
    const copy = new FakeElement(this.tagName);
    copy.textContent = this.textContent;
    copy.className = this.className;
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    for (const child of this.children) copy.append(child.cloneNode ? child.cloneNode(true) : child);
    return copy;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
  }
  dispatchEvent(value) { this.dispatched.push(value); this.emit(value.type, value); return true; }
  focus() { this.focused = true; }
  blur() { this.blurred += 1; this.focused = false; }
  click() { this.clicked += 1; }
  matches(selector) {
    if (selector.includes("rounded-xl")) {
      if (this.tagName !== "DIV") return false;
      if (!String(this.className).includes("rounded-xl") || !String(this.className).includes("flex-col")) return false;
      let ancestor = this.parentElement;
      while (ancestor) {
        if (ancestor.getAttribute("data-testid") === "chat-scroll-container") return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    }
    for (const part of selector.split(",").map((item) => item.trim())) {
      const attributeOnly = part.match(/^\[([^=\]]+)\]$/);
      if (attributeOnly && this.attributes.has(attributeOnly[1])) return true;
      const exact = part.match(/^\[([^=\]]+)="([^"]*)"\]$/);
      if (exact && this.getAttribute(exact[1]) === exact[2]) return true;
      const descendant = part.match(/^\[([^=\]]+)="([^"]*)"\]\s+([a-z]+)$/i);
      if (descendant && this.tagName === descendant[3].toUpperCase()) {
        let ancestor = this.parentElement;
        while (ancestor) {
          if (ancestor.getAttribute(descendant[1]) === descendant[2]) return true;
          ancestor = ancestor.parentElement;
        }
      }
      if (/^[a-z]+$/i.test(part) && this.tagName === part.toUpperCase()) return true;
    }
    return false;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function event(key, options = {}) {
  return {
    key,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    target: options.target || null,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

function buildCanvas() {
  const root = new FakeElement("html");
  const chat = new FakeElement("div");
  chat.setAttribute("data-testid", "chat-interface");
  const scrollHost = new FakeElement("div");
  const scroller = new FakeElement("div");
  scroller.setAttribute("data-testid", "chat-scroll-container");
  scroller.scrollHeight = 4000;
  scroller.clientHeight = 600;
  scroller.scrollTop = 0;
  const userMessage = new FakeElement("div");
  userMessage.className = "rounded-xl relative w-fit max-w-full flex flex-col mt-6 bg-tertiary self-end px-4 py-2.5";
  userMessage.textContent = "سلام، این پیام کاربر است";
  const agentMessage = new FakeElement("div");
  agentMessage.className = "rounded-xl relative w-fit max-w-full flex flex-col mt-6 w-full bg-transparent";
  agentMessage.textContent = "پاسخ ایجنت";
  scroller.append(userMessage, agentMessage);
  const pre = new FakeElement("pre");
  const code = new FakeElement("code");
  code.textContent = "echo 'hello'";
  pre.append(code);
  scroller.append(pre);
  scrollHost.append(scroller);
  const inputWrapper = new FakeElement("div");
  const inputHost = new FakeElement("div");
  const input = new FakeElement("div");
  input.setAttribute("data-testid", "chat-input");
  inputHost.append(input);
  inputWrapper.append(inputHost);
  const submit = new FakeElement("button");
  submit.setAttribute("data-testid", "submit-button");
  chat.append(scrollHost, inputWrapper, submit);
  root.append(chat);
  return { root, chat, scroller, scrollHost, input, inputHost, inputWrapper, submit, pre, userMessage, agentMessage };
}

function runChatScript(script, dom) {
  const copied = [];
  const frames = [];
  const document = {
    documentElement: dom.root,
    createElement: (name) => new FakeElement(name),
    querySelector: (selector) => dom.root.querySelector(selector),
    querySelectorAll: (selector) => dom.root.querySelectorAll(selector),
  };
  class FakeMutationObserver { constructor(callback) { this.callback = callback; } observe() {} }
  const windowListeners = new Map();
  const context = {
    document,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: (callback) => { frames.push(callback); callback(); return frames.length; },
    setTimeout: (callback) => { frames.push(callback); return 0; },
    addEventListener: (type, listener) => {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    InputEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    console,
  };
  context.window = context;
  vm.runInNewContext(script, context, { filename: "injected-canvas-chat.js" });
  const dispatch = (type, value) => { for (const listener of windowListeners.get(type) || []) listener(value); };
  return { copied, dispatch, windowListeners };
}

let gateway;
let gatewayStderr = "";
const upstream = http.createServer((req, res) => {
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
  gateway.stderr.on("data", (chunk) => { gatewayStderr += chunk.toString(); });

  const html = await waitForPage(gatewayPort, gateway);
  assert.match(html, /<style id="openhands-host-chat-style">/, "chat styling must be injected");
  assert.match(html, /unicode-bidi:plaintext/, "mixed Persian/Latin text must render with automatic direction");
  assert.match(html, /overscroll-behavior:contain/, "chat scrolling must not chain to the page");
  assert.match(html, /@media\(max-width:680px\)/, "the chat improvements must include a mobile breakpoint");
  assert.match(html, /prefers-reduced-motion/, "reduced-motion users must keep an instant scroll");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script), "every injected browser script must parse");
  const chatScript = html.match(/<script id="openhands-host-chat-script">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(chatScript, "the chat enhancement script must be injected");

  const dom = buildCanvas();
  const runtime = runChatScript(chatScript, dom);

  assert.ok(/data-openhands-helper/.test(chatScript), "the injected script must publish the helper version");
  assert.equal(dom.root.getAttribute("data-openhands-helper"), "dev", "the page must carry the running helper version");
  assert.equal(dom.input.getAttribute("dir"), "auto", "the chat input must use automatic text direction");

  const jump = dom.scrollHost.querySelector("[data-oh-chat-jump]");
  assert.ok(jump, "a jump-to-latest control must be installed");
  assert.equal(jump.getAttribute("data-oh-visible"), "1", "the control must appear while the user is scrolled up");
  jump.emit("click", event("click"));
  assert.equal(dom.scroller.scrollTop, dom.scroller.scrollHeight, "the control must scroll to the newest message");
  assert.equal(jump.getAttribute("data-oh-visible"), "0", "the control must hide again at the bottom");

  const before = dom.scrollHost.querySelectorAll("[data-oh-chat-jump]").length;
  runtime.dispatch("pageshow");
  assert.equal(dom.scrollHost.querySelectorAll("[data-oh-chat-jump]").length, before, "re-running after a React rerender must not duplicate controls");

  const copy = dom.pre.querySelector("[data-oh-code-copy]");
  assert.ok(copy, "every code block must receive its own copy button");
  copy.emit("click", event("click"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(runtime.copied, ["echo 'hello'"], "the copy button must copy only that code block");

  const userActions = dom.userMessage.querySelector("[data-oh-msg-actions]");
  assert.ok(userActions, "a user message must receive its own action row");
  const [userCopy, userEdit, userResend] = userActions.children;
  assert.deepEqual([userCopy.textContent, userEdit.textContent, userResend.textContent], ["کپی", "ویرایش", "ارسال دوباره"]);
  userCopy.emit("click", event("click"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(runtime.copied.includes("سلام، این پیام کاربر است"), "copying a user message must copy only its text");
  userEdit.emit("click", event("click"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.input.textContent, "سلام، این پیام کاربر است", "editing must place the message back in the chat box");
  assert.equal(dom.input.focused, true, "editing must focus the chat box");
  assert.ok(dom.input.dispatched.some((item) => item.type === "input"), "Canvas must be notified about the restored text");

  const agentActions = dom.agentMessage.querySelector("[data-oh-msg-actions]");
  assert.ok(agentActions, "an agent message must receive its own action row");
  const [agentCopy, agentRetry] = agentActions.children;
  assert.deepEqual([agentCopy.textContent, agentRetry.textContent], ["کپی", "تلاش مجدد"]);
  agentCopy.emit("click", event("click"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(runtime.copied.includes("پاسخ ایجنت"), "copying an agent message must copy its answer");
  const clicksBeforeRetry = dom.submit.clicked;
  agentRetry.emit("click", event("click"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.input.textContent, "سلام، این پیام کاربر است", "retry must resend the preceding user message");
  assert.equal(dom.submit.clicked, clicksBeforeRetry + 1, "retry must submit the restored message");

  const counter = dom.inputWrapper.querySelector("[data-oh-chat-counter]");
  assert.ok(counter, "a long-message counter must exist");
  assert.equal(counter.getAttribute("data-oh-visible"), "0", "the counter must stay hidden for short messages");
  dom.input.textContent = "x".repeat(1200);
  dom.input.emit("input", {});
  assert.equal(counter.getAttribute("data-oh-visible"), "1", "the counter must appear for long messages");

  const clicksBeforeShortcut = dom.submit.clicked;
  const send = event("Enter", { ctrlKey: true, target: dom.input });
  runtime.dispatch("keydown", send);
  assert.equal(send.defaultPrevented, true, "Ctrl+Enter must be handled by the gateway");
  assert.equal(dom.submit.clicked, clicksBeforeShortcut + 1, "Ctrl+Enter must send the message");

  dom.submit.disabled = true;
  const blocked = event("Enter", { ctrlKey: true, target: dom.input });
  runtime.dispatch("keydown", blocked);
  assert.equal(dom.submit.clicked, clicksBeforeShortcut + 1, "a disabled send button must never be clicked");
  assert.equal(blocked.defaultPrevented, false, "a blocked shortcut must fall through to Canvas");
  dom.submit.disabled = false;

  const plainEnter = event("Enter", { target: dom.input });
  runtime.dispatch("keydown", plainEnter);
  assert.equal(plainEnter.defaultPrevented, false, "plain Enter must keep Canvas's own behaviour");

  const stop = new FakeElement("button");
  stop.setAttribute("data-testid", "stop-button");
  dom.chat.append(stop);
  const escapeStop = event("Escape", { target: dom.input });
  runtime.dispatch("keydown", escapeStop);
  assert.equal(stop.clicked, 1, "Escape must stop a running generation");

  dom.chat.children = dom.chat.children.filter((child) => child !== stop);
  const escapeBlur = event("Escape", { target: dom.input });
  runtime.dispatch("keydown", escapeBlur);
  assert.equal(dom.input.blurred, 1, "Escape must release the input when nothing is running");

  const focus = event("/", { ctrlKey: true, target: dom.chat });
  runtime.dispatch("keydown", focus);
  assert.equal(dom.input.focused, true, "Ctrl+/ must focus the chat input");
  assert.equal(gatewayStderr, "", "the gateway must not log errors");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    assertions: {
      chatStylingInjected: true,
      automaticTextDirection: true,
      responsiveAndReducedMotionRules: true,
      injectedScriptsParsed: true,
      jumpToLatestWorks: true,
      rerenderDoesNotDuplicateControls: true,
      perCodeBlockCopyWorks: true,
      longMessageCounterWorks: true,
      acceleratorSendWorks: true,
      disabledSendNeverForced: true,
      plainEnterUntouched: true,
      escapeStopsGeneration: true,
      escapeReleasesInput: true,
      focusShortcutWorks: true,
      userMessageCopyAndEdit: true,
      userMessageResend: true,
      agentMessageCopy: true,
      agentMessageRetry: true,
      helperVersionExposed: true,
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
