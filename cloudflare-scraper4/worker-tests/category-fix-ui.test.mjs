import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Slice the bulk-fix modal logic out of the dashboard bundle (brace-balanced)
// and execute it with stubbed browser APIs, mirroring version-section.test.mjs.
function extractFns(src, names) {
  return names.map(name => {
    let start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `${name} must exist in the dashboard`);
    if (src.slice(start - 6, start) === 'async ') start -= 6;
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (!depth) break; }
    }
    return src.slice(start, end + 1);
  }).join('\n');
}

function loadModal(src, stubs) {
  const factory = new Function('state', '$', 'api', 'modalShell', 'notice', 'openResultModal', 'renderCategoryAllRun', 'refreshCurrentCategoryRun', 'esc', 'escAttr', 'fa',
    `let categoryFixConsensus=[],categoryFixChatModels=[],categoryAllVisible=false,categoryAllTimer=0;\n${extractFns(src, ['categoryVoteModeLabel', 'categoryFixLastText', 'categoryFixConsensusOptions', 'renderCategoryConsensusEditor', 'saveCategoryFixSchedule', 'startCategoryAllRun', 'beginCategoryAllRun'])}\nreturn {startCategoryAllRun,beginCategoryAllRun,saveCategoryFixSchedule,renderCategoryConsensusEditor,categoryFixLastText,categoryVoteModeLabel,getConsensus:()=>categoryFixConsensus,setChatModels:m=>{categoryFixChatModels=m}};`);
  return factory(stubs.state, stubs.$, stubs.api, stubs.modalShell, stubs.notice, stubs.openResultModal,
    stubs.renderCategoryAllRun, stubs.refreshCurrentCategoryRun, stubs.esc, stubs.escAttr, stubs.fa);
}

function makeStubs({ settings = {}, chatModels = [], last = null } = {}) {
  const calls = { settings: [], runs: [] };
  const state = { settings: JSON.parse(JSON.stringify(settings)), connections: { ai: { master: '', candidates: [] } } };
  const elements = {};
  const el = id => (elements[id] ||= { innerHTML: '', disabled: false, value: '', checked: false });
  const root = { innerHTML: '', onclick: null, onchange: null, querySelectorAll: () => [{ checked: true, value: 'ensemble' }] };
  elements.resultModal = root;
  let shell = null;
  const api = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(String(opts.body)) : null;
    if (path === '/api/ai/chat-models') return { ok: true, models: chatModels };
    if (path === '/api/category-fix-status') return { ok: true, last };
    if (path === '/api/settings' && opts.method === 'POST') { calls.settings.push(body); return { ok: true }; }
    if (path === '/api/destination/basalam/category-runs' && opts.method === 'POST') {
      calls.runs.push(body);
      return { ok: true, existing: false, run: { id: 'run-1', mode: body.mode, modelKeys: body.consensusModels || [] } };
    }
    throw new Error('unexpected api ' + path);
  };
  const notices = [];
  return {
    calls, state, elements, root, notices,
    get shell() { return shell; },
    stubs: {
      state, $: id => el(id),
      api, modalShell: (title, html) => { shell = { title, html }; },
      notice: msg => notices.push(String(msg)),
      openResultModal: () => {}, renderCategoryAllRun: () => {}, refreshCurrentCategoryRun: async () => ({}),
      esc: s => String(s), escAttr: s => String(s), fa: s => String(s),
    },
  };
}

const CHAT_MODELS = [
  { providerId: 'p1', providerName: 'P1', model: 'm1', chat: true },
  { providerId: 'p1', providerName: 'P1', model: 'm2', chat: true },
  { providerId: 'p1', providerName: 'P1', model: 'ocr-x', chat: false },
];

test('bulk-fix modal hosts the consensus editor and the periodic schedule block', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const t = makeStubs({ chatModels: CHAT_MODELS });
  const modal = loadModal(src, t.stubs);
  await modal.startCategoryAllRun();
  await new Promise(resolve => setTimeout(resolve, 10));
  for (const token of ['categoryConsensusChips', 'categoryConsensusAdd', 'categoryFixPeriodic', 'categoryFixHours', 'categoryFixMode', 'data-category-fix-save', 'categoryFixLast', 'data-category-mode-start']) {
    assert.ok(t.shell.html.includes(token), `the vote modal must include ${token}`);
  }
  assert.ok(t.shell.html.includes('value="6"'), 'the schedule defaults to a 6-hour gap');
});

test('consensus chips initialize from settings and offer only addable chat models', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const t = makeStubs({ settings: { categoryFix: { consensusModels: ['p1::m1', 'junk'] } }, chatModels: CHAT_MODELS });
  const modal = loadModal(src, t.stubs);
  await modal.startCategoryAllRun();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(modal.getConsensus(), ['p1::m1']);
  assert.ok(t.elements.categoryConsensusChips.innerHTML.includes('m1'), 'the pinned chip shows the model name');
  const options = t.elements.categoryConsensusAdd.innerHTML;
  assert.ok(options.includes('p1::m2'), 'unpinnned chat models stay selectable');
  assert.ok(!options.includes('p1::m1'), 'pinned models are not offered twice');
  assert.ok(!options.includes('ocr-x'), 'non-chat models are never offered');
});

test('consensus add/remove updates the list and re-renders the chips', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const t = makeStubs({ chatModels: CHAT_MODELS });
  const modal = loadModal(src, t.stubs);
  await modal.startCategoryAllRun();
  await new Promise(resolve => setTimeout(resolve, 10));
  t.root.onchange({ target: { id: 'categoryConsensusAdd', value: 'p1::m2' } });
  assert.deepEqual(modal.getConsensus(), ['p1::m2']);
  assert.ok(t.elements.categoryConsensusChips.innerHTML.includes('m2'));
  assert.ok(t.elements.categoryConsensusChips.innerHTML.includes('data-consensus-remove'), 'each chip carries a remove button');
  t.root.onclick({ target: { closest: sel => (sel === '[data-consensus-remove]' ? { dataset: { consensusRemove: 'p1::m2' } } : null) } });
  assert.deepEqual(modal.getConsensus(), []);
  assert.ok(t.elements.categoryConsensusChips.innerHTML.includes('خالی = اجتماع خودکار'));
});

test('manual start posts the picked mode with the consensus list', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const t = makeStubs({ chatModels: CHAT_MODELS });
  const modal = loadModal(src, t.stubs);
  await modal.startCategoryAllRun();
  await new Promise(resolve => setTimeout(resolve, 10));
  t.root.onchange({ target: { id: 'categoryConsensusAdd', value: 'p1::m1' } });
  t.root.onclick({ target: { closest: sel => (sel === '[data-category-mode-start]' ? {} : null) } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(t.calls.runs.length, 1);
  assert.deepEqual(t.calls.runs[0], { mode: 'ensemble', consensusModels: ['p1::m1'] });
});

test('saving the schedule persists the periodic block and refreshes the last-run line', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const last = { at: '2026-09-16T06:00:00.000Z', ok: true, trigger: 'periodic', mode: 'master' };
  const t = makeStubs({ chatModels: CHAT_MODELS, last });
  const modal = loadModal(src, t.stubs);
  await modal.startCategoryAllRun();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(t.elements.categoryFixLast.innerHTML.includes('خودکار'), 'the last-run line loads from the status endpoint');
  t.stubs.$('categoryFixPeriodic').checked = true;
  t.stubs.$('categoryFixHours').value = '12';
  t.stubs.$('categoryFixMode').value = 'master-candidates';
  t.root.onchange({ target: { id: 'categoryConsensusAdd', value: 'p1::m2' } });
  await modal.saveCategoryFixSchedule();
  assert.equal(t.calls.settings.length, 1);
  assert.deepEqual(t.calls.settings[0].categoryFix, {
    periodic: { enabled: true, everyHours: 12, mode: 'master-candidates' },
    consensusModels: ['p1::m2'],
  });
  assert.deepEqual(t.state.settings.categoryFix.consensusModels, ['p1::m2']);
});

test('last-run text covers none, manual, periodic and failed runs', async () => {
  const src = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const t = makeStubs({});
  const modal = loadModal(src, t.stubs);
  assert.match(modal.categoryFixLastText(null), /هنوز هیچ اجرا/);
  assert.match(modal.categoryFixLastText({ at: '2026-09-16T06:00:00.000Z', ok: true, trigger: 'manual', mode: 'ensemble' }), /دستی.*اجتماع چندمدلی/);
  assert.match(modal.categoryFixLastText({ at: '2026-09-16T06:00:00.000Z', ok: true, trigger: 'periodic', mode: 'master' }), /خودکار.*مدل مستر فقط/);
  assert.match(modal.categoryFixLastText({ at: '2026-09-16T06:00:00.000Z', ok: false, trigger: 'periodic', mode: 'ensemble', error: 'no token' }), /ناموفق.*no token/);
});
