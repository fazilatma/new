/**
 * The chat model-picker header must fold away on compact viewports.
 *
 *   node tools/tests/ui-collapse.mjs
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '../..');
const src = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

let failed = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };

// ---------- 1. behaviour, against a DOM stub ----------------------------
const names = ['CHAT_CONTROLS_KEY', 'updateChatControlsSummary', 'setChatControlsCollapsed',
               'toggleChatControls', 'isCompactViewport', 'initChatControlsCollapse'];
const code = src.slice(src.indexOf('const CHAT_CONTROLS_KEY'),
                       src.indexOf('function toggleChatReferencesBar'));
for (const n of names) if (!code.includes(n)) throw new Error('missing ' + n);

const mk = (id, extra = {}) => ({
  id,
  classList: {
    _s: new Set(),
    toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); return this._s.has(c); },
    contains(c) { return this._s.has(c); },
  },
  attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, ...extra,
});
const els = {
  chatTopControls: mk('chatTopControls'),
  chatControlsArrow: mk('chatControlsArrow'),
  chatControlsToggle: mk('chatControlsToggle'),
  chatControlsSummary: mk('chatControlsSummary'),
  chatProvider: mk('chatProvider', { selectedIndex: 0, options: [{ textContent: 'OpenRouter ✓' }] }),
  chatModel: mk('chatModel', { selectedIndex: 0, options: [{ textContent: 'qwen3:8b' }] }),
  requireApprovalCheck: mk('requireApprovalCheck', { checked: true }),
};
let compact = false, onMq = null;
globalThis.document = { getElementById: id => els[id] || null };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
globalThis.window = { matchMedia: () => ({ get matches() { return compact; }, addEventListener: (_, h) => { onMq = h; }, addListener: h => { onMq = h; } }) };

const fns = new Function(code + '; return {' + names.join(',') + '};')();

compact = false; fns.initChatControlsCollapse();
ok(!els.chatTopControls.classList.contains('collapsed'), 'desktop default = expanded');
ok(store['arena_chat_controls_collapsed'] === undefined, 'default writes no preference');

compact = true; fns.initChatControlsCollapse();
ok(els.chatTopControls.classList.contains('collapsed'), 'mobile / high zoom default = collapsed');
ok(els.chatControlsArrow.textContent === '▼', 'arrow indicates collapsed');
ok(els.chatControlsSummary.textContent === 'OpenRouter ✓ / qwen3:8b · 🛡️', 'summary shows provider / model / approval');
ok(els.chatControlsToggle.attrs['aria-expanded'] === 'false', 'aria-expanded tracks state');

compact = false; onMq();
ok(!els.chatTopControls.classList.contains('collapsed'), 'zooming back out re-expands');

fns.toggleChatControls();
ok(els.chatTopControls.classList.contains('collapsed') && store['arena_chat_controls_collapsed'] === '1',
  'manual toggle collapses and persists');
compact = false; fns.initChatControlsCollapse();
ok(els.chatTopControls.classList.contains('collapsed'), 'stored choice beats the viewport default');

els.requireApprovalCheck.checked = false; fns.updateChatControlsSummary();
ok(els.chatControlsSummary.textContent === 'OpenRouter ✓ / qwen3:8b', 'summary tracks the approval checkbox');

// ---------- 2. markup + CSS ---------------------------------------------
const mqStart = src.indexOf('@media (max-width: 768px), (max-height: 550px)');
let i = src.indexOf('{', mqStart), depth = 0, end = i;
for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}') { depth--; if (!depth) { end++; break; } } }
const mq = src.slice(mqStart, end);
const base = src.slice(0, mqStart);

ok(mqStart > 0, 'compact-viewport media query present');
ok(mq.includes('.chat-controls-toggle { display: flex; }'), 'toggle only revealed inside the media query');
ok(mq.includes('.chat-top-controls.collapsed .chat-controls-field { display: none !important; }'), 'collapsed hides the three fields');
ok(/\.chat-controls-toggle \{\s*display: none;/.test(base), 'toggle hidden on desktop');
for (const id of ['chatTopControls', 'chatControlsToggle', 'chatControlsArrow', 'chatControlsSummary'])
  ok(src.includes('id="' + id + '"'), 'markup has #' + id);
ok((src.match(/class="[^"]*chat-controls-field/g) || []).length === 3, 'exactly 3 collapsible fields');
ok(src.includes('data-view="localai"') && src.includes('onclick="openLocalAi()"'), 'Local AI nav entry wired');
ok(src.includes('initChatControlsCollapse();'), 'initApp() runs the initialiser');

console.log(failed ? `\n${failed} FAILED` : '\nall UI assertions passed');
process.exit(failed ? 1 : 0);
