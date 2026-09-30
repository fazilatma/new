/* Arena Agent — interface logic.
 *
 * One API helper, one router, one state object. Every request goes through
 * api(), which builds URLs from window.ARENA_API (the front controller path
 * injected by the server). Nothing here guesses at install prefixes. */

'use strict';

const API = window.ARENA_API || 'index.php';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  view: 'chat',
  user: null,
  authEnabled: true,
  providers: [],
  conversations: [],
  conversationId: null,
  provider: localStorage.getItem('arena.provider') || '',
  model: localStorage.getItem('arena.model') || '',
  streaming: false,
  fsPath: '',
  fsFile: null,
};

function url(path, query) {
  let u = API + '?p=' + encodeURIComponent(path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }
  }
  return u;
}

async function api(path, opts = {}) {
  const { query, ...init } = opts;
  init.credentials = 'same-origin';
  if (init.body && typeof init.body !== 'string' && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  let res;
  try {
    res = await fetch(url(path, query), init);
  } catch (e) {
    throw new Error('اتصال به سرور برقرار نشد: ' + e.message);
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const text = await res.text();
    // A non-JSON body means the web server answered instead of the app.
    throw new Error(
      `سرور به‌جای پاسخ برنامه یک صفحهٔ ${res.status} برگرداند.\n` +
      `آدرسی که صدا زده شد:\n${url(path)}\n\n` +
      `${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`
    );
  }
  const data = await res.json();
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    showLogin();
    throw new Error(data.error || 'ابتدا وارد شوید');
  }
  if (!res.ok) throw new Error(data.error || data.detail || `خطای ${res.status}`);
  return data;
}

/* ------------------------------------------------------------ toasts */
function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, kind === 'bad' ? 7000 : 3200);
}
const ok = (m) => toast(m, 'good');
const bad = (m) => toast(m, 'bad');

/* ------------------------------------------------------------ router */
function navigate(view) {
  S.view = view;
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
  $('#viewTitle').textContent = $(`.nav button[data-view="${view}"]`)?.dataset.title || view;
  $('#side').classList.remove('open');
  $('.scrim')?.remove();
  const loaders = {
    chat: loadChat, providers: loadProviders, files: () => loadFiles(''),
    changes: loadChanges, terminal: loadTerminal, diag: loadDiag, git: loadGit,
    settings: () => { loadSettings(); loadAgentInfo(); loadGitSettings(); },
  };
  loaders[view]?.();
}

/* ------------------------------------------------------------- auth */
function showLogin() { $('#loginDlg').showModal(); }

async function doLogin(e) {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value },
    });
    S.user = r.user;
    $('#loginDlg').close();
    $('#loginPass').value = '';
    ok('خوش آمدید، ' + r.user.username);
    await boot();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

/* --------------------------------------------------------- providers */
async function loadProviders() {
  const box = $('#providerList');
  box.innerHTML = '<div class="empty">در حال بارگذاری…</div>';
  try {
    const { providers } = await api('/api/providers');
    S.providers = providers;
    renderPicker();
    if (!providers.length) {
      box.innerHTML = `<div class="empty">هنوز هیچ ارائه‌دهنده‌ای اضافه نشده است.<br>
        <button class="btn primary" style="margin-top:12px" onclick="openProvider()">افزودن ارائه‌دهنده</button>
        <button class="btn" style="margin-top:12px" onclick="openImport()">درون‌ریزی از فایل</button></div>`;
      return;
    }
    box.innerHTML = '<div class="grid">' + providers.map((p) => `
      <div class="card">
        <div class="row">
          <h2 style="flex:1">${esc(p.name)}</h2>
          <span class="tag ${p.enabled ? 'good' : ''}">${p.enabled ? 'فعال' : 'خاموش'}</span>
        </div>
        <p class="hint mono">${esc(p.protocol)} · ${esc(p.baseUrl || '—')}</p>
        <div class="row" style="margin-bottom:10px">
          <span class="tag">${p.models.length} مدل</span>
          <span class="tag ${p.hasApiKey ? 'good' : 'warn'}">${p.hasApiKey ? 'کلید: ' + esc(p.apiKeyHint) : 'بدون کلید'}</span>
        </div>
        <div class="row">
          <button class="btn sm" onclick="openProvider('${esc(p.id)}')">ویرایش</button>
          <button class="btn sm" onclick="discover('${esc(p.id)}')">دریافت مدل‌ها</button>
          <button class="btn sm" onclick="testProvider('${esc(p.id)}')">آزمایش</button>
          <button class="btn sm danger" onclick="removeProvider('${esc(p.id)}')">حذف</button>
        </div>
      </div>`).join('') + '</div>';
  } catch (e) {
    box.innerHTML = `<div class="card"><h2>بارگذاری نشد</h2><p class="hint" style="white-space:pre-wrap">${esc(e.message)}</p></div>`;
  }
}

function openProvider(id) {
  const p = S.providers.find((x) => x.id === id);
  $('#pvTitle').textContent = p ? 'ویرایش ' + p.name : 'ارائه‌دهندهٔ جدید';
  $('#pvId').value = p?.id || '';
  $('#pvName').value = p?.name || '';
  $('#pvProtocol').value = p?.protocol || 'openai';
  $('#pvUrl').value = p?.baseUrl || '';
  $('#pvKey').value = '';
  $('#pvKey').placeholder = p?.hasApiKey ? 'ذخیره‌شده (' + p.apiKeyHint + ') — برای تغییر بنویسید' : 'sk-…';
  $('#pvEnabled').checked = p ? p.enabled : true;
  $('#providerDlg').showModal();
}

async function saveProvider(e) {
  e.preventDefault();
  const id = $('#pvId').value;
  const body = {
    name: $('#pvName').value.trim(),
    protocol: $('#pvProtocol').value,
    baseUrl: $('#pvUrl').value.trim(),
    enabled: $('#pvEnabled').checked,
  };
  const key = $('#pvKey').value.trim();
  if (key) body.apiKey = key;
  try {
    if (id) await api('/api/providers/' + encodeURIComponent(id), { method: 'PUT', body });
    else await api('/api/providers', { method: 'POST', body });
    $('#providerDlg').close();
    ok('ذخیره شد');
    loadProviders();
  } catch (err) { bad(err.message); }
}

async function removeProvider(id) {
  if (!confirm('این ارائه‌دهنده و همهٔ مدل‌هایش حذف شوند؟')) return;
  try { await api('/api/providers/' + encodeURIComponent(id), { method: 'DELETE' }); ok('حذف شد'); loadProviders(); }
  catch (e) { bad(e.message); }
}

async function discover(id) {
  toast('در حال پرسیدن فهرست مدل‌ها…');
  try {
    const { models } = await api('/api/providers/' + encodeURIComponent(id) + '/discover');
    if (!models.length) return bad('ارائه‌دهنده هیچ مدلی برنگرداند.');
    await api('/api/providers/' + encodeURIComponent(id) + '/models', { method: 'POST', body: { models } });
    ok(models.length + ' مدل افزوده شد');
    loadProviders();
  } catch (e) { bad(e.message); }
}

async function testProvider(id) {
  toast('در حال آزمایش…');
  try {
    const r = await api('/api/providers/' + encodeURIComponent(id) + '/test', { method: 'POST', body: {} });
    if (r.ok) ok(`پاسخ داد (${r.latencyMs} میلی‌ثانیه): ${r.reply}`);
    else bad(`HTTP ${r.status}: ${r.error}`);
  } catch (e) { bad(e.message); }
}

/* ------------------------------------------------------------ import */
function openImport() {
  $('#imText').value = '';
  $('#imReplace').checked = false;
  $('#imResult').innerHTML = '';
  $('#importDlg').showModal();
}

function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

async function runImport(e) {
  e.preventDefault();
  const text = $('#imText').value.trim();
  if (!text) return bad('چیزی برای درون‌ریزی نیست.');
  try { JSON.parse(text); }
  catch (err) {
    return bad('متن، JSON معتبر نیست: ' + err.message + '\nاگر کپی ناقص بوده، فایل را انتخاب کنید.');
  }
  const replace = $('#imReplace').checked;
  const btn = $('#imBtn');
  btn.disabled = true;
  $('#imResult').innerHTML = '<p class="hint">در حال ارسال…</p>';
  try {
    let r, fallback = false;
    try {
      r = await api('/api/providers/import', { method: 'POST', body: { json: text, replace } });
    } catch (first) {
      // If the app never saw the request, try again with the payload encoded —
      // some hosts run a firewall that rejects bodies holding API keys.
      if (!/صفحهٔ \d+|اتصال به سرور/.test(first.message)) throw first;
      r = await api('/api/providers/import', { method: 'POST', body: { jsonB64: b64(text), replace } });
      fallback = true;
    }
    $('#imResult').innerHTML = `<div class="card" style="margin:0">
      <h2>${r.providers} ارائه‌دهنده و ${r.models} مدل درون‌ریزی شد</h2>
      ${r.created.length ? `<p class="hint">تازه: ${esc(r.created.join('، '))}</p>` : ''}
      ${r.updated.length ? `<p class="hint">به‌روزشده: ${esc(r.updated.join('، '))}</p>` : ''}
      ${r.skipped.length ? `<p class="hint">رد شد: ${esc(r.skipped.map((s) => s.key).join('، '))}</p>` : ''}
      ${fallback ? '<p class="hint">(ارسال عادی را فایروال میزبان مسدود کرد؛ با بدنهٔ base64 انجام شد.)</p>' : ''}
    </div>`;
    ok('درون‌ریزی انجام شد');
    loadProviders();
  } catch (err) {
    $('#imResult').innerHTML = `<div class="card" style="margin:0;border-color:#5a2a32">
      <h2>درون‌ریزی نشد</h2><p class="hint" style="white-space:pre-wrap">${esc(err.message)}</p>
      <button class="btn sm" onclick="navigate('diag');document.getElementById('importDlg').close()">
        اجرای تشخیص اتصال</button></div>`;
  } finally { btn.disabled = false; }
}

function pickImportFile(input) {
  const f = input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => { $('#imText').value = ev.target.result; };
  reader.readAsText(f);
}

/* -------------------------------------------------------------- chat */
function renderPicker() {
  const ps = $('#pickProvider');
  const enabled = S.providers.filter((p) => p.enabled);
  ps.innerHTML = enabled.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    || '<option value="">— ارائه‌دهنده‌ای نیست —</option>';
  if (enabled.some((p) => p.id === S.provider)) ps.value = S.provider;
  else S.provider = ps.value;
  renderModels();
}

function renderModels() {
  const ms = $('#pickModel');
  const p = S.providers.find((x) => x.id === S.provider);
  const models = (p?.models || []).filter((m) => m.enabled);
  ms.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')
    || '<option value="">— مدلی نیست —</option>';
  if (models.some((m) => m.id === S.model)) ms.value = S.model;
  else S.model = ms.value;
  localStorage.setItem('arena.provider', S.provider);
  localStorage.setItem('arena.model', S.model);
  updatePickerSummary();
}

function updatePickerSummary() {
  const p = S.providers.find((x) => x.id === S.provider);
  const m = (p?.models || []).find((x) => x.id === S.model);
  $('#pickSummary').textContent = `${p?.name || '—'} / ${m?.name || '—'}`;
}

function togglePicker() {
  const folded = $('#picker').classList.toggle('folded');
  $('#pickArrow').textContent = folded ? '▾' : '▴';
  localStorage.setItem('arena.pickerFolded', folded ? '1' : '0');
}

function initPicker() {
  const stored = localStorage.getItem('arena.pickerFolded');
  const compact = window.matchMedia('(max-width: 860px), (max-height: 560px)');
  const apply = (folded) => {
    $('#picker').classList.toggle('folded', folded);
    $('#pickArrow').textContent = folded ? '▾' : '▴';
  };
  apply(stored === null ? compact.matches : stored === '1');
  compact.addEventListener('change', (e) => {
    if (localStorage.getItem('arena.pickerFolded') === null) apply(e.matches);
  });
}

async function loadChat() {
  if (!S.providers.length) {
    try { S.providers = (await api('/api/providers')).providers; renderPicker(); } catch { /* shown elsewhere */ }
  }
  try {
    const { conversations } = await api('/api/conversations');
    S.conversations = conversations;
    $('#convList').innerHTML = conversations.map((c) => `
      <div class="conv ${c.id === S.conversationId ? 'on' : ''}" onclick="openConversation('${esc(c.id)}')">
        <span>${esc(c.title)}</span>
        <button class="btn sm" onclick="event.stopPropagation();deleteConversation('${esc(c.id)}')">×</button>
      </div>`).join('') || '<div class="empty" style="font-size:12px">گفتگویی نیست</div>';
  } catch (e) { bad(e.message); }
}

async function openConversation(id) {
  S.conversationId = id;
  const { messages } = await api('/api/conversations/' + encodeURIComponent(id));
  $('#msgs').innerHTML = messages.map((m) => bubble(m.role, m.content)).join('');
  scrollDown();
  loadChat();
}

async function deleteConversation(id) {
  await api('/api/conversations/' + encodeURIComponent(id), { method: 'DELETE' }).catch((e) => bad(e.message));
  if (S.conversationId === id) { S.conversationId = null; $('#msgs').innerHTML = ''; }
  loadChat();
}

function newConversation() {
  S.conversationId = null;
  $('#msgs').innerHTML = '<div class="empty">گفتگوی تازه — پیامی بنویسید.</div>';
  loadChat();
}

function bubble(role, text) {
  return `<div class="msg ${role}">${renderMarkdown(text)}</div>`;
}

/* Deliberately tiny: fenced code, inline code, bold. Anything more needs a
   real parser, and an unescaped one would be an injection hole. */
function renderMarkdown(text) {
  let out = esc(text);
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function scrollDown() { const m = $('#msgs'); m.scrollTop = m.scrollHeight; }

async function sendMessage(e) {
  e?.preventDefault();
  if (S.streaming) return;
  const ta = $('#composerText');
  const text = ta.value.trim();
  if (!text) return;
  if (!S.provider || !S.model) return bad('اول یک ارائه‌دهنده و مدل انتخاب کنید.');

  const agentMode = $('#agentToggle')?.checked;

  ta.value = '';
  ta.style.height = 'auto';
  if ($('#msgs').querySelector('.empty')) $('#msgs').innerHTML = '';
  $('#msgs').insertAdjacentHTML('beforeend', bubble('user', text));

  /* In agent mode the transcript grows sideways as well as downwards: tool
     cards are interleaved with the model's prose, so each needs its own
     element rather than one growing bubble. */
  const turn = document.createElement('div');
  turn.className = 'turn';
  $('#msgs').append(turn);

  let holder = document.createElement('div');
  holder.className = 'msg assistant typing';
  turn.append(holder);
  scrollDown();

  S.streaming = true;
  $('#sendBtn').disabled = true;
  let acc = '';
  const cards = {};

  const freshBubble = () => {
    holder = document.createElement('div');
    holder.className = 'msg assistant';
    turn.append(holder);
    acc = '';
  };

  try {
    const res = await fetch(url(agentMode ? '/api/agent/stream' : '/api/chat/stream'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: S.provider, modelId: S.model,
        conversationId: S.conversationId || '', message: text,
      }),
    });
    if (!res.ok && !(res.headers.get('content-type') || '').includes('event-stream')) {
      const t = await res.text();
      throw new Error(t.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) || 'HTTP ' + res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const ev = /^event:\s*(\w+)/m.exec(part)?.[1];
        const dataLine = /^data:\s*(.*)$/m.exec(part)?.[1];
        if (!ev || !dataLine) continue;
        let payload = {};
        try { payload = JSON.parse(dataLine); } catch { continue; }

        if (ev === 'start') {
          S.conversationId = payload.conversationId;
        } else if (ev === 'token') {
          acc += payload.text;
          holder.classList.remove('typing');
          holder.innerHTML = renderMarkdown(acc);
          scrollDown();
        } else if (ev === 'step') {
          holder.classList.add('typing');
          holder.dataset.step = `گام ${payload.step} از ${payload.of}`;
        } else if (ev === 'tool') {
          const card = toolCard(payload);
          cards[payload.id] = card;
          turn.append(card);
          /* The model may speak again after the tool, so start a new bubble
             rather than appending to the one above the card. */
          if (acc) freshBubble();
          scrollDown();
        } else if (ev === 'tool_result') {
          fillToolCard(cards[payload.id], payload);
          scrollDown();
        } else if (ev === 'change') {
          turn.append(changeCard(payload));
          refreshPending();
          scrollDown();
        } else if (ev === 'error') {
          const err = document.createElement('div');
          err.className = 'msg error';
          err.textContent = payload.message;
          turn.append(err);
        } else if (ev === 'done') {
          holder.classList.remove('typing');
          if (payload.stoppedEarly) {
            turn.insertAdjacentHTML('beforeend',
              `<div class="note">پس از ${payload.steps} گام متوقف شد.</div>`);
          }
          if (payload.toolCalls) {
            turn.insertAdjacentHTML('beforeend',
              `<div class="note">${payload.steps} گام، ${payload.toolCalls} ابزار` +
              (payload.pending ? ` — ${payload.pending} تغییر در انتظار تأیید` : '') + '</div>');
          }
          loadChat();
          refreshPending();
        }
      }
    }
    if (!acc && holder.className.includes('typing')) {
      holder.className = 'msg error';
      holder.textContent = 'پاسخی دریافت نشد.';
    }
  } catch (err) {
    const fail = document.createElement('div');
    fail.className = 'msg error';
    fail.textContent = err.message;
    turn.append(fail);
  } finally {
    S.streaming = false;
    $('#sendBtn').disabled = false;
    holder.classList.remove('typing');
    if (!holder.textContent.trim() && holder.parentElement) holder.remove();
    scrollDown();
  }
}

/* ------------------------------------------------------------------ tools */

const TOOL_ICON = {
  list_files: '📂', read_file: '📄', search_files: '🔎',
  write_file: '✍️', edit_file: '✏️', delete_file: '🗑', run_command: '⌨️',
};

function toolArgSummary(name, args) {
  if (!args) return '';
  if (name === 'run_command') return args.command || '';
  if (name === 'search_files') return `«${args.query || ''}»` + (args.path ? ` در ${args.path}` : '');
  if (args.path !== undefined) return args.path || '/';
  return Object.values(args).join(' ').slice(0, 80);
}

function toolCard(call) {
  const el = document.createElement('div');
  el.className = 'tool running';
  el.innerHTML = `
    <div class="tool-head">
      <span class="tool-ico">${TOOL_ICON[call.name] || '🔧'}</span>
      <code class="tool-name">${esc(call.name)}</code>
      <span class="tool-arg mono">${esc(toolArgSummary(call.name, call.args))}</span>
      <span class="tool-state">…</span>
    </div>
    <pre class="tool-out" hidden></pre>`;
  el.querySelector('.tool-head').addEventListener('click', () => {
    const out = el.querySelector('.tool-out');
    out.hidden = !out.hidden;
  });
  return el;
}

function fillToolCard(el, result) {
  if (!el) return;
  el.classList.remove('running');
  el.classList.add(result.ok ? 'done' : 'failed');
  el.querySelector('.tool-state').textContent = result.ok ? result.summary : 'خطا';
  const out = el.querySelector('.tool-out');
  out.textContent = result.output || '';
  /* Failures are the ones worth reading, so those open by themselves. */
  out.hidden = result.ok;
}

/* ---------------------------------------------------------------- changes */

function renderDiff(diff) {
  if (!diff) return '<div class="hint">بدون تفاوت</div>';
  return '<pre class="diff">' + diff.split('\n').map((line) => {
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'dh'
      : line.startsWith('@@') ? 'dm'
      : line.startsWith('+') ? 'da'
      : line.startsWith('-') ? 'dd' : '';
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join('\n') + '</pre>';
}

function changeCard(change) {
  const el = document.createElement('div');
  el.className = 'change';
  el.dataset.id = change.id;
  const verb = change.action === 'delete' ? 'حذف' : (change.existed ? 'ویرایش' : 'ایجاد');
  el.innerHTML = `
    <div class="change-head">
      <b>${verb}</b>
      <code class="mono">${esc(change.path)}</code>
      <span class="stat"><span class="add">+${change.added}</span>
        <span class="del">−${change.removed}</span></span>
      <span class="spacer"></span>
      <span class="change-actions"></span>
    </div>
    ${renderDiff(change.diff)}`;
  const actions = el.querySelector('.change-actions');
  if (change.status === 'pending') {
    actions.innerHTML = `<button class="btn sm primary">تأیید</button>
                         <button class="btn sm danger">رد</button>`;
    const [yes, no] = actions.querySelectorAll('button');
    yes.onclick = () => decideChange(el, change.id, 'approve');
    no.onclick = () => decideChange(el, change.id, 'reject');
  } else {
    actions.innerHTML = `<span class="badge ${change.status}">${statusLabel(change.status)}</span>`;
  }
  return el;
}

function statusLabel(s) {
  return { pending: 'در انتظار', applied: 'اعمال شد', rejected: 'رد شد', reverted: 'برگردانده شد' }[s] || s;
}

async function decideChange(el, id, decision) {
  el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const r = await api(`/api/changes/${encodeURIComponent(id)}/${decision}`, { method: 'POST' });
    el.querySelector('.change-actions').innerHTML =
      `<span class="badge ${r.status}">${statusLabel(r.status)}</span>`;
    ok(decision === 'approve' ? 'اعمال شد' : 'رد شد');
    refreshPending();
    if (S.view === 'files') loadFiles(S.fsPath);
  } catch (err) {
    bad(err.message);
    el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

async function refreshPending() {
  try {
    const { pending } = await api('/api/changes');
    const badge = $('#pendingBadge');
    if (!badge) return;
    badge.textContent = pending || '';
    badge.hidden = !pending;
  } catch { /* the badge is decoration; never block on it */ }
}

async function loadChanges() {
  const box = $('#changeList');
  box.innerHTML = '<div class="hint">در حال بارگذاری…</div>';
  try {
    const status = $('#changeFilter').value;
    const { changes, approval } = await api('/api/changes', { query: { status, limit: 100 } });
    $('#approvalMode').value = approval;
    if (!changes.length) {
      box.innerHTML = '<div class="empty">تغییری با این وضعیت نیست.</div>';
      return;
    }
    box.innerHTML = '';
    changes.forEach((c) => box.append(changeCard(c)));
  } catch (err) {
    box.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
  }
}

async function decideAllChanges(decision) {
  const word = decision === 'approve' ? 'تأیید' : 'رد';
  if (!confirm(`همهٔ تغییرهای در انتظار ${word} شوند؟`)) return;
  try {
    const r = await api('/api/changes/decide-all', { method: 'POST', body: { decision } });
    ok(`${r.approved + r.rejected} تغییر ${word} شد`);
    loadChanges();
    refreshPending();
  } catch (err) { bad(err.message); }
}

async function setApprovalMode(mode) {
  try {
    await api('/api/changes/mode', { method: 'PUT', body: { mode } });
    ok(mode === 'auto' ? 'تغییرها بی‌درنگ اعمال می‌شوند' : 'تغییرها منتظر تأیید می‌مانند');
  } catch (err) { bad(err.message); }
}

/* -------------------------------------------------------------------- git */

const G = { status: null, selected: '', staged: false };

async function loadGit() {
  const box = $('#gitBody');
  box.innerHTML = '<div class="hint">در حال بارگذاری…</div>';
  try {
    const info = await api('/api/git');
    G.info = info;

    if (!info.installed) {
      box.innerHTML = `<div class="card"><h2>گیت در دسترس نیست</h2>
        <p class="hint">روی این میزبان گیت نصب نیست، یا PHP اجازهٔ ساختن فرایند ندارد.
        با <code>php bin/console.php doctor</code> بررسی کنید.</p></div>`;
      return;
    }
    if (!info.enabled) {
      box.innerHTML = `<div class="card"><h2>گیت خاموش است</h2>
        <p class="hint"><code>ARENA_GIT=false</code> را از <code>.env</code> بردارید.</p></div>`;
      return;
    }
    if (!info.repo) {
      box.innerHTML = `<div class="card"><h2>هنوز مخزنی نیست</h2>
        <p class="hint">ورک‌اسپیس یک مخزن گیت نیست. یکی بسازید تا بتوانید تغییرها را
        پیگیری کنید. (${esc(info.version)})</p>
        <button class="btn primary" onclick="gitInit()">ساخت مخزن</button></div>`;
      return;
    }

    G.status = info.status;
    box.innerHTML = gitLayout(info);
    bindGitParts();
    if (G.selected) showGitDiff(G.selected, G.staged);
  } catch (err) {
    box.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
  }
}

function gitLayout(info) {
  const st = info.status;
  const staged = st.files.filter((f) => f.staged);
  const unstaged = st.files.filter((f) => !f.staged);

  const fileRow = (f, isStaged) => `
    <div class="git-file${G.selected === f.path && G.staged === isStaged ? ' on' : ''}"
         data-path="${esc(f.path)}" data-staged="${isStaged ? '1' : ''}">
      <span class="git-mark ${f.label}">${esc(f.label[0].toUpperCase())}</span>
      <span class="git-path mono">${esc(f.path)}</span>
      <span class="git-btns">
        ${isStaged
          ? `<button class="btn xs" data-act="unstage" title="بیرون بردن از ایندکس">−</button>`
          : `<button class="btn xs" data-act="stage" title="افزودن به ایندکس">+</button>
             <button class="btn xs danger" data-act="discard" title="دور ریختن تغییر">↺</button>`}
      </span>
    </div>`;

  return `
    <div class="git-bar">
      <span class="git-branch" title="شاخهٔ جاری">⎇ ${esc(st.branch)}</span>
      ${st.upstream ? `<span class="hint mono">${esc(st.upstream)}</span>` : ''}
      ${st.ahead ? `<span class="badge">${st.ahead} ↑</span>` : ''}
      ${st.behind ? `<span class="badge">${st.behind} ↓</span>` : ''}
      <span class="spacer"></span>
      <select class="input sm" id="gitBranch">
        ${info.branches.local.map((b) =>
          `<option${b === st.branch ? ' selected' : ''}>${esc(b)}</option>`).join('')}
      </select>
      <button class="btn sm" onclick="gitNewBranch()">شاخهٔ تازه</button>
      <button class="btn sm" onclick="gitPull()">⬇ pull</button>
      <button class="btn sm" onclick="gitPush()">⬆ push</button>
      <button class="btn sm" onclick="loadGit()">تازه‌سازی</button>
    </div>

    <div class="git-grid">
      <div class="git-col">
        <h3>ایندکس <span class="hint">(${staged.length})</span>
          ${staged.length ? '<button class="btn xs" onclick="gitUnstageAll()">همه بیرون</button>' : ''}</h3>
        <div class="git-list">${staged.map((f) => fileRow(f, true)).join('') ||
          '<div class="hint pad">چیزی برای کامیت آماده نیست.</div>'}</div>

        <h3>تغییرهای کاری <span class="hint">(${unstaged.length})</span>
          ${unstaged.length ? '<button class="btn xs" onclick="gitStageAll()">همه اضافه</button>' : ''}</h3>
        <div class="git-list">${unstaged.map((f) => fileRow(f, false)).join('') ||
          '<div class="hint pad">هیچ تغییری نیست.</div>'}</div>

        <form class="git-commit" id="gitCommitForm">
          <textarea class="input" id="gitMessage" rows="3"
                    placeholder="پیام کامیت — بگویید چرا، نه فقط چه."></textarea>
          <button class="btn primary" type="submit" ${staged.length ? '' : 'disabled'}>
            کامیت ${staged.length ? `(${staged.length} فایل)` : ''}</button>
        </form>
      </div>

      <div class="git-col">
        <h3 id="gitDiffTitle">تفاوت</h3>
        <div id="gitDiff"><div class="hint pad">یک فایل را انتخاب کنید.</div></div>
        <h3>تاریخچه</h3>
        <div class="git-log">${info.log.map((c) => `
          <div class="git-commit-row">
            <code class="mono">${esc(c.short)}</code>
            <span class="git-subject">${esc(c.subject)}</span>
            <span class="hint">${esc(c.author)} · ${esc(c.date.slice(0, 10))}</span>
          </div>`).join('') || '<div class="hint pad">هنوز کامیتی نیست.</div>'}</div>
      </div>
    </div>`;
}

function bindGitParts() {
  $$('#gitBody .git-file').forEach((row) => {
    row.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      const path = row.dataset.path;
      if (act) { e.stopPropagation(); return gitFileAction(act, path); }
      G.selected = path;
      G.staged = row.dataset.staged === '1';
      $$('#gitBody .git-file').forEach((r) => r.classList.remove('on'));
      row.classList.add('on');
      showGitDiff(path, G.staged);
    });
  });
  $('#gitCommitForm')?.addEventListener('submit', gitCommit);
  $('#gitBranch')?.addEventListener('change', (e) => gitCheckout(e.target.value));
}

async function showGitDiff(path, staged) {
  $('#gitDiffTitle').textContent = 'تفاوت — ' + path;
  const box = $('#gitDiff');
  box.innerHTML = '<div class="hint pad">…</div>';
  try {
    const r = await api('/api/git/diff', { query: { path, staged: staged ? '1' : '0' } });
    box.innerHTML = r.diff ? renderDiff(r.diff) : '<div class="hint pad">بدون تفاوت.</div>';
  } catch (err) {
    box.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
  }
}

async function gitFileAction(act, path) {
  if (act === 'discard' && !confirm(`تغییرهای «${path}» دور ریخته شود؟ برگشت‌پذیر نیست.`)) return;
  try {
    await api('/api/git/' + act, { method: 'POST', body: { paths: [path] } });
    if (act === 'discard') ok('دور ریخته شد');
    loadGit();
  } catch (err) { bad(err.message); }
}

const gitStageAll = () => gitBulk('stage');
const gitUnstageAll = () => gitBulk('unstage');

async function gitBulk(act) {
  const want = act === 'stage' ? (f) => !f.staged : (f) => f.staged;
  const paths = (G.status?.files || []).filter(want).map((f) => f.path);
  if (!paths.length) return;
  try { await api('/api/git/' + act, { method: 'POST', body: { paths } }); loadGit(); }
  catch (err) { bad(err.message); }
}

async function gitCommit(e) {
  e.preventDefault();
  const message = $('#gitMessage').value.trim();
  if (!message) return bad('کامیت به پیام نیاز دارد.');
  try {
    const r = await api('/api/git/commit', { method: 'POST', body: { message } });
    ok('کامیت شد: ' + (r.commit?.short || ''));
    G.selected = '';
    loadGit();
  } catch (err) { bad(err.message); }
}

async function gitInit() {
  try { await api('/api/git/init', { method: 'POST' }); ok('مخزن ساخته شد'); loadGit(); }
  catch (err) { bad(err.message); }
}

async function gitCheckout(branch) {
  if (branch === G.status?.branch) return;
  try { await api('/api/git/checkout', { method: 'POST', body: { branch } }); loadGit(); }
  catch (err) { bad(err.message); loadGit(); }
}

async function gitNewBranch() {
  const branch = prompt('نام شاخهٔ تازه:');
  if (!branch) return;
  try {
    await api('/api/git/checkout', { method: 'POST', body: { branch, create: true } });
    ok('روی ' + branch);
    loadGit();
  } catch (err) { bad(err.message); }
}

async function gitPush() {
  const first = !G.status?.upstream;
  try {
    const r = await api('/api/git/push', { method: 'POST', body: { setUpstream: first } });
    ok('push شد');
    if (r.output) toast(r.output.split('\n')[0], 'ok');
    loadGit();
  } catch (err) { bad(err.message); }
}

async function gitPull() {
  try {
    const r = await api('/api/git/pull', { method: 'POST' });
    ok(r.output?.split('\n')[0] || 'pull شد');
    loadGit();
    if (S.fsFile) openFile(S.fsFile);
  } catch (err) { bad(err.message); }
}

async function saveGitConfig(e) {
  e.preventDefault();
  const body = { name: $('#gitName').value, email: $('#gitEmail').value };
  const token = $('#gitToken').value;
  if (token) body.token = token;
  try {
    await api('/api/git/config', { method: 'PUT', body });
    $('#gitToken').value = '';
    ok('ذخیره شد');
    loadGitSettings();
  } catch (err) { bad(err.message); }
}

async function saveGitRemote(e) {
  e.preventDefault();
  try {
    await api('/api/git/remote', { method: 'POST',
      body: { name: $('#gitRemoteName').value || 'origin', url: $('#gitRemoteUrl').value } });
    ok('مخزن دوردست ذخیره شد');
    loadGitSettings();
  } catch (err) { bad(err.message); }
}

async function loadGitSettings() {
  try {
    const info = await api('/api/git');
    $('#gitName').value = info.identity.name;
    $('#gitEmail').value = info.identity.email;
    $('#gitTokenState').textContent = info.hasToken
      ? 'یک توکن ذخیره شده است. برای جایگزینی، توکن تازه را بنویسید؛ برای پاک کردن، «حذف توکن».'
      : 'توکنی ذخیره نشده.';
    $('#gitClearToken').hidden = !info.hasToken;
    const remote = (info.remotes || [])[0];
    if (remote) {
      $('#gitRemoteName').value = remote.name;
      $('#gitRemoteUrl').value = remote.url;
    }
    $('#gitRemoteForm').hidden = !info.repo;
  } catch { /* the settings page still works without it */ }
}

async function clearGitToken() {
  try {
    await api('/api/git/config', { method: 'PUT',
      body: { name: $('#gitName').value, email: $('#gitEmail').value, token: '' } });
    ok('توکن حذف شد');
    loadGitSettings();
  } catch (err) { bad(err.message); }
}

async function loadAgentInfo() {
  try {
    const info = await api('/api/agent/tools');
    const box = $('#agentTools');
    if (!box) return;
    box.innerHTML = info.tools.map((t) =>
      `<div class="tool-doc"><code>${esc(t.name)}</code>` +
      `${t.writes ? '<span class="badge pending">می‌نویسد</span>' : ''}` +
      `<p>${esc(t.description)}</p></div>`).join('')
      + (info.unavailable.length
        ? `<div class="hint">در این میزبان در دسترس نیست: ${info.unavailable.join('، ')}` +
          ' — برای روشن کردن ترمینال ARENA_SHELL=true را در .env بگذارید.</div>'
        : '');
  } catch { /* the settings page still works without it */ }
}


/* ------------------------------------------------------------- files */
async function loadFiles(path) {
  S.fsPath = path;
  try {
    const r = await api('/api/files', { query: { path } });
    const up = path ? `<div class="fs-item" onclick="loadFiles('${esc(path.split('/').slice(0, -1).join('/'))}')">↰ بالا</div>` : '';
    $('#fsList').innerHTML = up + (r.items.map((i) => `
      <div class="fs-item ${S.fsFile === i.path ? 'on' : ''}" onclick="${i.isDir
        ? `loadFiles('${esc(i.path)}')`
        : `openFile('${esc(i.path)}')`}">
        <span>${i.isDir ? '📁' : '📄'}</span><span style="flex:1">${esc(i.name)}</span>
        ${i.isDir ? '' : `<span class="tag">${i.size}</span>`}
      </div>`).join('') || '<div class="empty" style="font-size:12px">خالی</div>');
    $('#fsCrumb').textContent = '/' + path;
  } catch (e) { bad(e.message); }
}

async function openFile(path) {
  try {
    const f = await api('/api/file', { query: { path } });
    S.fsFile = path;
    $('#fsName').textContent = path;
    $('#fsEditor').value = f.binary ? '' : f.content;
    $('#fsEditor').disabled = f.binary;
    $('#fsSave').disabled = f.binary;
    if (f.binary) toast('این فایل باینری است و در ویرایشگر باز نمی‌شود.');
    loadFiles(S.fsPath);
  } catch (e) { bad(e.message); }
}

async function saveFile() {
  if (!S.fsFile) return;
  try {
    await api('/api/file', { method: 'PUT', body: { path: S.fsFile, content: $('#fsEditor').value } });
    ok('ذخیره شد');
  } catch (e) { bad(e.message); }
}

async function newFile() {
  const name = prompt('نام فایل تازه (نسبت به پوشهٔ فعلی):');
  if (!name) return;
  const path = (S.fsPath ? S.fsPath + '/' : '') + name;
  try { await api('/api/file', { method: 'PUT', body: { path, content: '' } }); loadFiles(S.fsPath); openFile(path); }
  catch (e) { bad(e.message); }
}

async function deleteFile() {
  if (!S.fsFile || !confirm('حذف ' + S.fsFile + '؟')) return;
  try {
    await api('/api/file', { method: 'DELETE', query: { path: S.fsFile } });
    S.fsFile = null; $('#fsEditor').value = ''; $('#fsName').textContent = '—';
    loadFiles(S.fsPath);
  } catch (e) { bad(e.message); }
}

/* ---------------------------------------------------------- terminal */
async function loadTerminal() {
  try {
    const r = await api('/api/shell');
    const rt = Object.entries(r.runtimes || {}).map(([k, v]) =>
      `<span class="tag ${v ? 'good' : ''}">${esc(k)}: ${esc(v || 'نیست')}</span>`).join(' ');
    $('#termStatus').innerHTML = r.enabled
      ? `<span class="tag good">فعال</span> ${rt}`
      : `<span class="tag warn">غیرفعال</span> <span class="hint">برای روشن کردن، ARENA_SHELL=true را در .env بگذارید.</span>`;
    $('#termCmd').disabled = !r.enabled;
    $('#termRun').disabled = !r.enabled;
  } catch (e) { $('#termStatus').textContent = e.message; }
}

async function runCommand(e) {
  e.preventDefault();
  const cmd = $('#termCmd').value.trim();
  if (!cmd) return;
  const out = $('#termOut');
  out.innerHTML += `<div class="cmd">$ ${esc(cmd)}</div>`;
  $('#termCmd').value = '';
  try {
    const r = await api('/api/shell/exec', { method: 'POST', body: { command: cmd, cwd: S.fsPath } });
    if (r.stdout) out.innerHTML += esc(r.stdout) + '\n';
    if (r.stderr) out.innerHTML += `<span class="err">${esc(r.stderr)}</span>\n`;
    out.innerHTML += `<span class="hint">exit ${r.exitCode} · ${r.durationMs}ms</span>\n\n`;
  } catch (err) {
    out.innerHTML += `<span class="err">${esc(err.message)}</span>\n\n`;
  }
  out.scrollTop = out.scrollHeight;
}

/* ---------------------------------------------------------- settings */
async function loadSettings() {
  try {
    const { settings } = await api('/api/settings');
    $('#setPrompt').value = settings.systemPrompt || '';
    $('#setTheme').value = settings.theme || 'dark';
  } catch (e) { bad(e.message); }
}

async function saveSettings(e) {
  e.preventDefault();
  try {
    await api('/api/settings', { method: 'PUT', body: {
      systemPrompt: $('#setPrompt').value, theme: $('#setTheme').value } });
    applyTheme($('#setTheme').value);
    ok('تنظیمات ذخیره شد');
  } catch (err) { bad(err.message); }
}

async function changePassword(e) {
  e.preventDefault();
  try {
    const r = await api('/api/auth/password', { method: 'POST', body: {
      currentPassword: $('#pwCurrent').value, newPassword: $('#pwNew').value } });
    ok(r.message);
    setTimeout(() => location.reload(), 1400);
  } catch (err) { bad(err.message); }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('arena.theme', theme);
}

/* ------------------------------------------------------- diagnostics */
async function loadDiag() {
  const box = $('#diagOut');
  box.innerHTML = '<div class="empty">در حال بررسی…</div>';
  const lines = [];
  const row = (label, good, detail) =>
    `<tr><td>${good ? '✅' : '❌'}</td><td>${esc(label)}</td><td class="mono">${esc(detail)}</td></tr>`;
  try {
    const d = await api('/api/diag');
    lines.push(row('اتصال به برنامه', true, d.routing.apiUrlExample));
    lines.push(row('پایگاه داده', d.db.connected, d.db.connected ? d.db.file : d.db.error || ''));
    lines.push(row('نوشتن در data/', d.paths.data.writable, d.paths.data.path));
    lines.push(row('نوشتن در storage/', d.paths.storage.writable, d.paths.storage.path));
    lines.push(row('pdo_sqlite', d.php.extensions.pdo_sqlite, ''));
    lines.push(row('cURL', d.php.extensions.curl, d.php.extensions.curl ? '' : 'استریم کندتر می‌شود'));
    lines.push(row('رمزنگاری کلیدها', d.encryption.available, d.encryption.available ? 'AES-256-GCM' : 'کلیدها رمز نمی‌شوند'));
    lines.push(row('اجرای دستور', d.shell.available, d.shell.enabled ? 'فعال' : 'خاموش'));

    // Prove a POST with a realistic body survives the host.
    const sample = JSON.stringify({ providers: { demo: {
      name: 'Demo', protocol: 'openai', url: 'https://api.example.com/v1',
      apiKey: 'sk-test-0000000000', models: [{ id: 'demo' }] } } });
    for (const [label, body] of [
      ['POST کوچک', { hello: 1 }],
      ['POST حاوی کلید API', { json: sample }],
      ['POST بزرگ (۲۵۰ کیلوبایت)', { json: 'x'.repeat(250000) }],
    ]) {
      try {
        const r = await api('/api/echo', { method: 'POST', body });
        lines.push(row(label, r.bytesReceived > 0, r.bytesReceived + ' بایت رسید'));
      } catch (err) {
        lines.push(row(label, false, err.message.split('\n')[0]));
      }
    }

    box.innerHTML = `<div class="card"><h2>وضعیت</h2>
      <p class="hint">نسخه ${esc(d.version)} · PHP ${esc(d.php.version)} · ${esc(d.php.sapi)}
      · post_max_size ${esc(d.php.postMaxSize)}</p>
      <table>${lines.join('')}</table></div>
      <div class="card"><h2>گزارش کامل</h2>
      <textarea class="input mono" rows="14" readonly>${esc(JSON.stringify(d, null, 2))}</textarea></div>`;
  } catch (e) {
    box.innerHTML = `<div class="card"><h2>تشخیص ناموفق</h2>
      <p class="hint" style="white-space:pre-wrap">${esc(e.message)}</p></div>`;
  }
}

/* ------------------------------------------------------------- boot */
async function boot() {
  try {
    const st = await api('/api/auth/status');
    S.authEnabled = st.enabled;
    S.user = st.user;
    if (st.enabled && !st.signedIn) { showLogin(); return; }
  } catch (e) {
    // Reaching the app at all failed — show it plainly instead of a blank page.
    document.body.innerHTML = `<div style="padding:40px;max-width:640px;margin:auto">
      <h2>برنامه بالا نیامد</h2><pre style="white-space:pre-wrap">${esc(e.message)}</pre>
      <p><a href="${url('/api/diag')}">اجرای تشخیص</a></p></div>`;
    return;
  }
  $('#whoami').textContent = S.user ? `${S.user.username} (${S.user.role})` : 'بدون ورود';
  try { S.providers = (await api('/api/providers')).providers; renderPicker(); } catch { /* view shows it */ }
  refreshPending();
  navigate(S.view);
}

function bindUi() {
  $$('.nav button').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#loginForm').addEventListener('submit', doLogin);
  $('#providerForm').addEventListener('submit', saveProvider);
  $('#importForm').addEventListener('submit', runImport);
  $('#composer').addEventListener('submit', sendMessage);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#passwordForm').addEventListener('submit', changePassword);
  $('#termForm').addEventListener('submit', runCommand);
  $('#changeFilter').addEventListener('change', loadChanges);
  $('#gitConfigForm').addEventListener('submit', saveGitConfig);
  $('#gitRemoteForm').addEventListener('submit', saveGitRemote);
  $('#approvalMode').addEventListener('change', (e) => setApprovalMode(e.target.value));

  // Agent mode is a per-browser preference, not a server setting.
  const agent = $('#agentToggle');
  agent.checked = localStorage.getItem('arena.agent') === 'on';
  agent.addEventListener('change', () => {
    localStorage.setItem('arena.agent', agent.checked ? 'on' : 'off');
    $('#composerText').placeholder = agent.checked
      ? 'چه کاری انجام شود؟  عامل فایل‌ها را می‌خواند و تغییر پیشنهاد می‌دهد.'
      : 'پیام‌تان را بنویسید…  (Enter برای ارسال، Shift+Enter برای خط تازه)';
  });
  agent.dispatchEvent(new Event('change'));

  $('#pickProvider').addEventListener('change', (e) => { S.provider = e.target.value; renderModels(); });
  $('#pickModel').addEventListener('change', (e) => {
    S.model = e.target.value; localStorage.setItem('arena.model', S.model); updatePickerSummary();
  });

  const ta = $('#composerText');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(190, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
  });

  $('#menuBtn').addEventListener('click', () => {
    $('#side').classList.add('open');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.onclick = () => { $('#side').classList.remove('open'); scrim.remove(); };
    document.body.append(scrim);
  });

  applyTheme(localStorage.getItem('arena.theme') || 'dark');
  initPicker();
}

document.addEventListener('DOMContentLoaded', () => { bindUi(); boot(); });

// Handlers referenced from inline onclick attributes.
Object.assign(window, {
  navigate, openProvider, removeProvider, discover, testProvider, openImport,
  pickImportFile, openConversation, deleteConversation, newConversation,
  loadFiles, openFile, saveFile, newFile, deleteFile, doLogout, togglePicker, loadDiag,
});
