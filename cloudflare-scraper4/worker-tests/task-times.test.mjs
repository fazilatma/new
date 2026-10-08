// Every task says when it started and, once it is over, when it finished (1.344.0).
//
// The request: «هر وظیفه مثل استخراج و ارسال و غیره، زمان شروع در حین انجام و زمان اتمام بعد از
// اتمام را بنویسد.»
//
// Until now a running job showed only a phase and a percentage, a finished one showed a bare
// «updatedAt» string with a T in the middle, and the background-run rows showed a naked number of
// seconds. None of them answered the two questions a human actually asks: when did this start,
// and when did it end? These tests pin the shared clock and every place it must appear.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const dash = await read('worker-src/dashboard.ts');

/** Compile the real helper block out of the dashboard (no copies in the test). */
const fa = value => Number(value || 0).toLocaleString('fa-IR');
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const helpers = new Function('fa', 'esc',
  dash.slice(dash.indexOf('function faDigits('), dash.indexOf('function jobElapsed('))
  + ';return {faDigits,taskClock,faSpan,taskIsDone,taskTimes,taskTimesHtml};')(fa, esc);

const at = (h, m, s) => { const d = new Date(); d.setHours(h, m, s, 0); return d.toISOString(); };

test('the clock reads as a Persian wall clock, and names the day only when it is not today', () => {
  assert.equal(helpers.taskClock(at(9, 5, 3)), '۰۹:۰۵:۰۳');
  assert.equal(helpers.taskClock(''), '', 'a missing timestamp prints nothing, never «Invalid Date»');
  assert.equal(helpers.taskClock('not a date'), '');
  const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const text = helpers.taskClock(yesterday);
  assert.match(text, /ساعت ۰?[۰-۹]+:[۰-۹]+:[۰-۹]+$/, 'an older task keeps its date: ' + text);
  assert.ok(!/^[۰-۹]{2}:/.test(text), 'and is not mistaken for today');
});

test('a duration is spoken, not printed in milliseconds', () => {
  assert.equal(helpers.faSpan(0), '۰ ثانیه');
  assert.equal(helpers.faSpan(45_000), '۴۵ ثانیه');
  assert.equal(helpers.faSpan(60_000), '۱ دقیقه');
  assert.equal(helpers.faSpan(95_000), '۱ دقیقه و ۳۵ ثانیه');
  assert.equal(helpers.faSpan(3_600_000), '۱ ساعت');
  assert.equal(helpers.faSpan(7_830_000), '۲ ساعت و ۱۰ دقیقه');
});

test('while it runs: the start time and how long it has been going', () => {
  const started = new Date(Date.now() - 125_000).toISOString();
  const text = helpers.taskTimes({ status: 'running', startedAt: started, createdAt: started });
  assert.match(text, /^🟢 شروع: [۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}/, 'the start time comes first: ' + text);
  assert.match(text, /⏱ تا این لحظه: ۲ دقیقه و ۵ ثانیه/, 'and the elapsed time keeps counting: ' + text);
  assert.ok(!text.includes('پایان'), 'nothing claims an end before there is one');
});

test('after it ends: start, finish and the total it took', () => {
  const text = helpers.taskTimes({ status: 'done', startedAt: at(10, 0, 0), finishedAt: at(10, 7, 30) });
  assert.match(text, /🟢 شروع: ۱۰:۰۰:۰۰/);
  assert.match(text, /🏁 پایان: ۱۰:۰۷:۳۰/);
  assert.match(text, /⏱ مدت: ۷ دقیقه و ۳۰ ثانیه/);
  const failed = helpers.taskTimes({ status: 'failed', startedAt: at(10, 0, 0), finishedAt: at(10, 0, 20) });
  assert.match(failed, /🏁 پایان: ۱۰:۰۰:۲۰ · ⏱ مدت: ۲۰ ثانیه/, 'a failed task is finished too: ' + failed);
});

test('a job still waiting in the queue says so, with the time it was queued', () => {
  const queued = helpers.taskTimes({ status: 'queued', createdAt: at(8, 30, 0) });
  assert.match(queued, /^⏳ در صف از: ۰۸:۳۰:۰۰/, queued);
  assert.ok(!queued.includes('🟢 شروع'), 'a queued task has not started');
  assert.equal(helpers.taskTimes({ status: 'queued' }), '⏱ هنوز شروع نشده است', 'with no timestamp at all it still says something true');
  assert.equal(helpers.taskTimes(null), '');
});

test('a finished server job that only carries «at» still gets an end time', () => {
  const text = helpers.taskTimes({ status: 'done', startedAt: at(12, 0, 0), at: at(12, 1, 0) });
  assert.match(text, /🏁 پایان: ۱۲:۰۱:۰۰/, text);
});

test('the html is escaped and skipped when there is nothing to say', () => {
  assert.equal(helpers.taskTimesHtml(null), '');
  const html = helpers.taskTimesHtml({ status: 'done', startedAt: at(1, 2, 3), finishedAt: at(1, 2, 9) });
  assert.match(html, /^<div class="task-times">/);
  assert.match(html, /۰۱:۰۲:۰۳/);
});

test('every task card in the panel prints the times: queue, home, destination, activity, history', () => {
  const once = (needle, where) => assert.ok(dash.includes(needle), where + ' must render the task clock');
  once('+taskTimesHtml(j)+jobLiveMeta(j)+jobPlanHtml(j)+jobMetricsHtml(j,false)+jobQueueRecoveryHtml(j)', 'the «کارها» tab card');
  once('+taskTimesHtml(j)+jobLiveMeta(j)+jobPlanHtml(j)+jobMetricsHtml(j,false)+(active?', 'the destination mini card');
  once('+taskTimesHtml(job)+jobLiveMeta(job)+jobPlanHtml(job)+', 'the home mini card');
  once("+'</div>'+taskTimesHtml(j)+activityExtractionHtml(j)+'</div>'}", 'the running/queued row of the activity panel');
  once("+'</div>'+taskTimesHtml(r)+'<div style=\"margin-top:4px\">'+del", 'the background-run row');
  once("+'</div>'+taskTimesHtml(j)+'</div>').join('')", 'the finished-jobs history');
  assert.ok(!dash.includes("+' · '+esc((j.at||'').replace('T',' ').slice(0,19))"),
    'the raw ISO stamp with a T in the middle is gone');
  assert.ok(!dash.includes("(r.startedAt?' · '+fa(Math.max(0,Math.round(((r.finishedAt?Date.parse(r.finishedAt)"),
    'the bare «N ثانیه» on background runs is replaced by real clock times');
  assert.ok(dash.includes('<p class="task-times" data-recon-times></p>'), 'and the live reconciliation window has its own line');
  assert.ok(dash.includes('drawTimes(Date.now());panel.classList.add(\'finished\')'), 'which is frozen at the finish time when the run ends');
});

test('both servers send the three timestamps, for running and for finished work', async () => {
  for (const [runtime, file] of [['worker', 'worker-src/app.ts'], ['render', 'render-src/server.ts']]) {
    const server = await read(file);
    const activity = server.slice(server.indexOf("/api/activity"), server.indexOf("/api/activity") + 4000);
    assert.match(activity, /startedAt:j\.startedAt\|\|null/, runtime + ': a running job must carry its start time');
    assert.match(activity, /finishedAt:j\.finishedAt\|\|null/, runtime + ': and its finish time once it has one');
    assert.match(activity, /finishedAt:j\.finishedAt\|\|j\.updatedAt/, runtime + ': a finished job always has an end time to show');
    assert.match(activity, /startedAt:r\.startedAt\|\|null/, runtime + ': background runs carry theirs too');
  }
});

test('a browser-side task records both ends by itself', () => {
  assert.match(dash, /function localTaskStart\(key,name,detail\)\{[^]*?startedAt:new Date\(\)\.toISOString\(\)/,
    'starting a local task stamps the start');
  assert.match(dash, /task\.finishedAt=new Date\(\)\.toISOString\(\)/, 'ending it stamps the finish');
});
