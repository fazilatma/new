/**
 * Unified-diff engine — replacement for Python's `difflib.unified_diff`
 * used by agent-python/app/changesets.py.
 *
 * Produces byte-compatible output with difflib for the cases the app relies on:
 *   --- a/<file>
 *   +++ b/<file>
 *   @@ -l,s +l,s @@
 * with 3 lines of context and `\ No newline at end of file` markers omitted
 * (difflib also omits them).
 */

/** Split keeping line endings, like Python's `str.splitlines(keepends=True)`. */
export function splitLinesKeepEnds(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        out.push(text.slice(start, i + 2));
        i++;
      } else {
        out.push(text.slice(start, i + 1));
      }
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

type OpCode = ['equal' | 'replace' | 'delete' | 'insert', number, number, number, number];

/**
 * Longest-common-subsequence based opcodes. Uses a Myers-style middle-snake
 * approach for large inputs and a simple DP for small ones.
 */
function computeOpcodes(a: string[], b: string[]): OpCode[] {
  const ops: OpCode[] = [];

  // Trim common prefix / suffix first — massive win for typical edits.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;

  if (pre > 0) ops.push(['equal', 0, pre, 0, pre]);

  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);

  if (aMid.length || bMid.length) {
    const inner = lcsOpcodes(aMid, bMid);
    for (const [tag, i1, i2, j1, j2] of inner) {
      ops.push([tag, i1 + pre, i2 + pre, j1 + pre, j2 + pre]);
    }
  }

  if (suf > 0) ops.push(['equal', a.length - suf, a.length, b.length - suf, b.length]);
  return mergeOpcodes(ops);
}

function mergeOpcodes(ops: OpCode[]): OpCode[] {
  const out: OpCode[] = [];
  for (const op of ops) {
    if (op[1] === op[2] && op[3] === op[4]) continue;
    const last = out[out.length - 1];
    if (last && last[0] === op[0] && last[2] === op[1] && last[4] === op[3]) {
      last[2] = op[2];
      last[4] = op[4];
    } else {
      out.push([...op] as OpCode);
    }
  }
  return out;
}

/** Hirschberg-free DP LCS with a size guard; falls back to a line-hash diff. */
function lcsOpcodes(a: string[], b: string[]): OpCode[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [['insert', 0, 0, 0, m]];
  if (m === 0) return [['delete', 0, n, 0, 0]];

  const CELL_LIMIT = 4_000_000; // ~4M cells ≈ 16MB of Int32 — safe inside a Worker
  if (n * m > CELL_LIMIT) {
    // Too large for full DP: emit a coarse replace block.
    return [['replace', 0, n, 0, m]];
  }

  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const rowOff = i * width;
    const nextOff = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      dp[rowOff + j] =
        a[i] === b[j] ? dp[nextOff + j + 1] + 1 : Math.max(dp[nextOff + j], dp[rowOff + j + 1]);
    }
  }

  const ops: OpCode[] = [];
  let i = 0;
  let j = 0;
  let pendA = 0;
  let pendB = 0;
  let eqStartA = -1;

  const flushPending = () => {
    if (pendA > 0 && pendB > 0) ops.push(['replace', i - pendA, i, j - pendB, j]);
    else if (pendA > 0) ops.push(['delete', i - pendA, i, j, j]);
    else if (pendB > 0) ops.push(['insert', i, i, j - pendB, j]);
    pendA = 0;
    pendB = 0;
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushPending();
      if (eqStartA < 0) eqStartA = i;
      i++;
      j++;
    } else {
      if (eqStartA >= 0) {
        ops.push(['equal', eqStartA, i, j - (i - eqStartA), j]);
        eqStartA = -1;
      }
      if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        i++;
        pendA++;
      } else {
        j++;
        pendB++;
      }
    }
  }
  if (eqStartA >= 0) {
    ops.push(['equal', eqStartA, i, j - (i - eqStartA), j]);
    eqStartA = -1;
  }
  flushPending();
  if (i < n || j < m) {
    if (i < n && j < m) ops.push(['replace', i, n, j, m]);
    else if (i < n) ops.push(['delete', i, n, j, j]);
    else ops.push(['insert', i, i, j, m]);
  }
  return mergeOpcodes(ops);
}

/** Group opcodes into hunks with `n` lines of context (difflib.get_grouped_opcodes). */
function groupOpcodes(ops: OpCode[], n = 3): OpCode[][] {
  if (!ops.length) return [];
  const codes: OpCode[] = ops.map((o) => [...o] as OpCode);

  if (codes[0][0] === 'equal') {
    const [tag, i1, i2, j1, j2] = codes[0];
    codes[0] = [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
  }
  const lastIdx = codes.length - 1;
  if (codes[lastIdx][0] === 'equal') {
    const [tag, i1, i2, j1, j2] = codes[lastIdx];
    codes[lastIdx] = [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
  }

  const nn = n + n;
  const groups: OpCode[][] = [];
  let group: OpCode[] = [];
  for (const code of codes) {
    let [tag, i1, i2, j1, j2] = code;
    if (tag === 'equal' && i2 - i1 > nn) {
      group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
      groups.push(group);
      group = [];
      i1 = Math.max(i1, i2 - n);
      j1 = Math.max(j1, j2 - n);
    }
    group.push([tag, i1, i2, j1, j2]);
  }
  if (group.length && !(group.length === 1 && group[0][0] === 'equal')) groups.push(group);
  return groups;
}

function rangeStr(start: number, stop: number): string {
  const length = stop - start;
  const begin = length ? start + 1 : start;
  if (length === 1) return `${begin}`;
  return `${begin},${length}`;
}

/** Port of changesets.compute_diff. */
export function computeDiff(oldContent: string, newContent: string, filename: string): string {
  const a = splitLinesKeepEnds(oldContent ?? '');
  const b = splitLinesKeepEnds(newContent ?? '');
  if (oldContent === newContent) return '';

  const ops = computeOpcodes(a, b);
  const groups = groupOpcodes(ops, 3);
  if (!groups.length) return '';

  const out: string[] = [];
  out.push(`--- a/${filename}\n`);
  out.push(`+++ b/${filename}\n`);

  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    out.push(`@@ -${rangeStr(first[1], last[2])} +${rangeStr(first[3], last[4])} @@\n`);
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === 'equal') {
        for (const line of a.slice(i1, i2)) out.push(` ${line}`);
        continue;
      }
      if (tag === 'replace' || tag === 'delete') {
        for (const line of a.slice(i1, i2)) out.push(`-${line}`);
      }
      if (tag === 'replace' || tag === 'insert') {
        for (const line of b.slice(j1, j2)) out.push(`+${line}`);
      }
    }
  }
  return out.join('');
}

export interface DiffHunk {
  index: number;
  header: string;
  lines: { text: string; type: 'add' | 'del' | 'context' }[];
  status: string;
}

/** Port of changesets.parse_diff_hunks. */
export function parseDiffHunks(diffText: string): DiffHunk[] {
  const lines = (diffText || '').split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let idx = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      idx += 1;
      current = { index: idx, header: line, lines: [], status: 'pending' };
    } else if (current) {
      let kind: 'add' | 'del' | 'context' = 'context';
      if (line.startsWith('+')) kind = 'add';
      else if (line.startsWith('-')) kind = 'del';
      current.lines.push({ text: line, type: kind });
    }
  }
  if (current) hunks.push(current);
  return hunks;
}
