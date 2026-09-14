import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The changelog once carried a doubled </div> after the 1.96.0 entry
// (present since at least 1.127): the browser closed the change list
// early, popped both folds, and rendered ~109 archive items permanently
// expanded while breaking the hamburger menu layout. These pins keep the
// region structurally valid, not just textually countable.

async function region() {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const start = dashboard.indexOf('<div class="change-list">');
  const end = dashboard.indexOf('<div id="changesResult"', start);
  assert.ok(start !== -1 && end !== -1 && start < end, 'guard: the changelog region was located');
  return dashboard.slice(start, end);
}

test('changelog: div/details tags are balanced with no strays', async () => {
  const stack = [];
  for (const match of (await region()).matchAll(/<div\b[^>]*>|<\/div>|<details\b[^>]*>|<\/details>/g)) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      assert.ok(stack.length > 0, `stray closer ${tag}`);
      const want = tag.includes('div') ? 'div' : 'details';
      assert.equal(stack.pop(), want, `misnested ${tag}`);
    } else stack.push(tag.startsWith('<div') ? 'div' : 'details');
  }
  assert.deepEqual(stack, [], 'every opened tag must be closed');
});

test('changelog: counts agree with the fold summaries', async () => {
  const text = await region();
  const recentOpen = text.indexOf('<details class="change-recent">');
  const recentClose = text.indexOf('</details>', recentOpen);
  const olderOpen = text.indexOf('<details class="change-older">');
  const olderClose = text.indexOf('</details>', olderOpen);
  for (const [name, pos] of [['recent-open', recentOpen], ['recent-close', recentClose], ['older-open', olderOpen], ['older-close', olderClose]]) {
    assert.ok(pos !== -1, `${name} must exist`);
  }
  assert.ok(recentClose < olderOpen, 'the recent and older folds must be siblings, not nested');
  const top = text.slice(0, recentOpen).split('<div class="change-item">').length - 1;
  const recent = text.slice(recentOpen, recentClose).split('<div class="change-item">').length - 1;
  const archive = text.slice(olderOpen, olderClose).split('<div class="change-item">').length - 1;
  const total = text.split('<div class="change-item">').length - 1;
  assert.equal(top, 1, 'exactly one entry stays unfolded');
  assert.equal(top + recent + archive, total, 'no entry may live outside the three spans');
  assert.equal(text.slice(olderClose).split('<div class="change-item">').length - 1, 0, 'no entry may spill past the older fold');
  const recentClaimed = text.slice(recentOpen, recentOpen + 200).match(/نمایش (\d+) تغییر/);
  const olderClaimed = text.slice(olderOpen, olderOpen + 200).match(/\((\d+) مورد\)/);
  assert.ok(recentClaimed && olderClaimed, 'both folds must state their entry count');
  assert.equal(recent, Number(recentClaimed[1]), 'the recent fold must hold what its summary claims');
  assert.equal(archive, Number(olderClaimed[1]), 'the older fold must hold what its summary claims');
});

test('changelog: both folds default to collapsed and stay styled', async () => {
  const text = await region();
  assert.ok(text.includes('<details class="change-recent">'), 'the recent fold must have no open attribute');
  assert.ok(text.includes('<details class="change-older">'), 'the older fold must have no open attribute');
  assert.ok(!text.includes('<details class="change-recent" open'), 'the recent fold must not force itself open');
  assert.ok(!text.includes('<details class="change-older" open'), 'the older fold must not force itself open');
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  for (const rule of ['.change-list{', '.change-item{', '.change-older-body{', '.change-older[open]>summary{']) {
    assert.ok(dashboard.includes(rule), `dashboard CSS must define ${rule}`);
  }
});
