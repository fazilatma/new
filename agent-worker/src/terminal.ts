/**
 * Replacement for agent-python/app/terminal_sandbox.py.
 *
 * The Workers runtime has no process model: there is no `subprocess`, no
 * `fork`/`exec`, no filesystem and no `eval`. Arbitrary shell commands and
 * `python script.py` therefore cannot run here.
 *
 * Instead of removing the feature we ship a small, safe, read/write shell that
 * operates on the R2-backed workspace. It covers the commands the UI's quick
 * actions and the agent's `run_command` tool realistically need, and returns a
 * clear, machine-readable `unsupported` result for everything else so callers
 * (including the self-healing loop in chat.ts) can degrade gracefully.
 */

import type { Env } from './types';
import {
  deletePath,
  listDir,
  listRecursive,
  makeDir,
  normalizeRel,
  readFileText,
  writeFileText,
  workspaceMetrics,
} from './storage';
import { maskLogTokens } from './security';
import { APP_VERSION } from './config';

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  mode: string;
  unsupported?: boolean;
  requiresApproval?: boolean;
}

const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  ':(){ :|:& };:',
  '> /dev/sda',
  'chmod -R 777 /',
  'chown -R',
  'shutdown',
  'reboot',
  'poweroff',
  'init 0',
  'drop table',
  'truncate table',
  'git push --force',
  'git push -f',
  'git reset --hard origin',
];

export function isDangerousCommand(command: string): boolean {
  const lower = (command || '').toLowerCase();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

/** Runtimes that simply do not exist inside workerd. */
const UNSUPPORTED_BINARIES = new Set([
  'python',
  'python3',
  'pip',
  'pip3',
  'php',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'pytest',
  'bash',
  'sh',
  'zsh',
  'make',
  'gcc',
  'g++',
  'cargo',
  'go',
  'java',
  'ruby',
  'perl',
  'docker',
  'apt',
  'apt-get',
  'curl',
  'wget',
  'ssh',
  'df',
  'top',
  'ps',
  'kill',
]);

/** Naive but adequate POSIX-ish argv splitter (handles quotes). */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function ok(command: string, stdout: string, started: number): ExecResult {
  return {
    command,
    exitCode: 0,
    stdout: maskLogTokens(stdout).slice(-30000),
    stderr: '',
    durationMs: Date.now() - started,
    mode: 'workers-vfs',
  };
}

function fail(command: string, stderr: string, started: number, code = 1): ExecResult {
  return {
    command,
    exitCode: code,
    stdout: '',
    stderr: maskLogTokens(stderr).slice(-30000),
    durationMs: Date.now() - started,
    mode: 'workers-vfs',
  };
}

function unsupported(command: string, bin: string, started: number): ExecResult {
  return {
    command,
    exitCode: 127,
    stdout: '',
    stderr:
      `UNSUPPORTED ON CLOUDFLARE WORKERS: '${bin}' cannot be executed.\n` +
      `The Workers runtime has no process model (no subprocess/exec/eval), so shell ` +
      `programs and language runtimes are unavailable.\n\n` +
      `Available here: ls, cat, head, tail, wc, find, tree, echo, pwd, mkdir, touch, rm, mv, cp, ` +
      `grep, stat, du, env, whoami, uname, clear, help.\n` +
      `For real command execution, keep the Python/Docker deployment (agent-python) or point ` +
      `the agent at an external runner service.`,
    durationMs: Date.now() - started,
    mode: 'workers-vfs',
    unsupported: true,
  };
}

/**
 * Port of terminal_sandbox.execute_sandboxed_command, restricted to the safe
 * built-in command set described above.
 */
export async function executeSandboxedCommand(
  env: Env,
  workspaceId: string,
  command: string,
  cwd = '.',
  _timeout = 60,
  confirmedDangerous = false,
): Promise<ExecResult> {
  const started = Date.now();
  const raw = (command || '').trim();
  if (!raw) return ok(raw, '', started);

  if (isDangerousCommand(raw) && !confirmedDangerous) {
    return {
      command: raw,
      exitCode: -1,
      stdout: '',
      stderr:
        'BLOCKED: This command is classified as potentially dangerous and requires explicit user confirmation.',
      durationMs: 0,
      mode: 'workers-vfs',
      requiresApproval: true,
    };
  }

  // No pipes / redirection / chaining in the built-in shell.
  if (/[|><&;`$]/.test(raw)) {
    return fail(
      raw,
      'Pipes, redirection, command substitution and chaining are not supported by the Workers built-in shell.',
      started,
      2,
    );
  }

  const argv = tokenize(raw);
  const bin = argv[0];
  const args = argv.slice(1);
  const base = normalizeRel(cwd);
  const resolve = (p?: string) => normalizeRel(p ? (base ? `${base}/${p}` : p) : base || '.');

  try {
    switch (bin) {
      case 'help':
        return ok(
          raw,
          [
            'Arena Agent — Cloudflare Workers built-in shell',
            '',
            'File system (R2-backed workspace):',
            '  ls [-la] [path]      list a directory',
            '  tree [path]          recursive listing',
            '  cat <file>           print a file',
            '  head/tail [-n N] <f> print first/last lines',
            '  wc [-l] <file>       count lines/words/bytes',
            '  grep <pat> <file>    search inside a file',
            '  find [path]          recursive file list',
            '  stat <path>          size + type',
            '  du                   workspace usage',
            '  mkdir <dir>          create a directory',
            '  touch <file>         create an empty file',
            '  rm [-rf] <path>      delete a file or directory',
            '  echo <text>          print text',
            '  pwd | whoami | uname | env | clear',
            '',
            "Anything else returns exit code 127 — see 'why' in the error message.",
          ].join('\n'),
          started,
        );

      case 'pwd':
        return ok(raw, `/${base}`.replace(/\/+$/, '') || '/', started);

      case 'whoami':
        return ok(raw, 'agent', started);

      case 'clear':
        return ok(raw, '', started);

      case 'uname':
        return ok(raw, `Cloudflare workerd (arena-agent-worker ${APP_VERSION})`, started);

      case 'env':
        return ok(
          raw,
          [
            'RUNTIME=cloudflare-workers',
            `APP_VERSION=${APP_VERSION}`,
            `WORKSPACE=r2://ws/${workspaceId}`,
          ].join('\n'),
          started,
        );

      case 'echo':
        return ok(raw, args.join(' '), started);

      case 'ls': {
        const flags = args.filter((a) => a.startsWith('-'));
        const target = args.find((a) => !a.startsWith('-'));
        const entries = await listDir(env, workspaceId, resolve(target));
        const longFmt = flags.some((f) => f.includes('l'));
        if (!entries.length) return ok(raw, '', started);
        const body = entries
          .map((e) =>
            longFmt
              ? `${e.type === 'dir' ? 'd' : '-'}rw-r--r--  ${String(e.size).padStart(9)}  ${
                  e.modified ? new Date(e.modified * 1000).toISOString().slice(0, 16).replace('T', ' ') : '                '
                }  ${e.name}${e.type === 'dir' ? '/' : ''}`
              : `${e.name}${e.type === 'dir' ? '/' : ''}`,
          )
          .join('\n');
        return ok(raw, body, started);
      }

      case 'tree':
      case 'find': {
        const target = args.find((a) => !a.startsWith('-'));
        const entries = await listRecursive(env, workspaceId, resolve(target));
        return ok(raw, entries.map((e) => (e.type === 'dir' ? `${e.path}/` : e.path)).join('\n'), started);
      }

      case 'cat': {
        if (!args.length) return fail(raw, 'cat: missing operand', started, 2);
        const chunks: string[] = [];
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          const text = await readFileText(env, workspaceId, resolve(a));
          if (text === null) return fail(raw, `cat: ${a}: No such file`, started, 1);
          chunks.push(text);
        }
        return ok(raw, chunks.join(''), started);
      }

      case 'head':
      case 'tail': {
        const nIdx = args.findIndex((a) => a === '-n');
        const n = nIdx >= 0 ? parseInt(args[nIdx + 1] ?? '10', 10) || 10 : 10;
        const file = args.filter((a) => !a.startsWith('-') && a !== String(n))[0];
        if (!file) return fail(raw, `${bin}: missing operand`, started, 2);
        const text = await readFileText(env, workspaceId, resolve(file));
        if (text === null) return fail(raw, `${bin}: ${file}: No such file`, started, 1);
        const lines = text.split('\n');
        return ok(raw, (bin === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n'), started);
      }

      case 'wc': {
        const file = args.filter((a) => !a.startsWith('-'))[0];
        if (!file) return fail(raw, 'wc: missing operand', started, 2);
        const text = await readFileText(env, workspaceId, resolve(file));
        if (text === null) return fail(raw, `wc: ${file}: No such file`, started, 1);
        const lines = text.split('\n').length;
        const words = text.split(/\s+/).filter(Boolean).length;
        const bytes = new TextEncoder().encode(text).length;
        if (args.includes('-l')) return ok(raw, `${lines} ${file}`, started);
        return ok(raw, `${lines} ${words} ${bytes} ${file}`, started);
      }

      case 'grep': {
        const positional = args.filter((a) => !a.startsWith('-'));
        const [pattern, file] = positional;
        if (!pattern || !file) return fail(raw, 'grep: usage: grep <pattern> <file>', started, 2);
        const text = await readFileText(env, workspaceId, resolve(file));
        if (text === null) return fail(raw, `grep: ${file}: No such file`, started, 1);
        const ci = args.includes('-i');
        const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : '');
        const hits = text
          .split('\n')
          .map((l, i) => [i + 1, l] as const)
          .filter(([, l]) => re.test(l))
          .map(([i, l]) => `${i}:${l}`);
        return hits.length ? ok(raw, hits.join('\n'), started) : fail(raw, '', started, 1);
      }

      case 'stat': {
        const target = resolve(args[0]);
        const text = await readFileText(env, workspaceId, target);
        if (text !== null) {
          return ok(
            raw,
            `  File: ${target}\n  Size: ${new TextEncoder().encode(text).length}\n  Type: regular file`,
            started,
          );
        }
        const entries = await listDir(env, workspaceId, target);
        if (entries.length) return ok(raw, `  File: ${target}\n  Type: directory`, started);
        return fail(raw, `stat: cannot stat '${args[0]}': No such file or directory`, started, 1);
      }

      case 'du': {
        const m = await workspaceMetrics(env, workspaceId);
        return ok(
          raw,
          `${m.totalSizeMB} MB\t${m.fileCount} files\t${m.root}`,
          started,
        );
      }

      case 'mkdir': {
        const target = args.filter((a) => !a.startsWith('-'))[0];
        if (!target) return fail(raw, 'mkdir: missing operand', started, 2);
        await makeDir(env, workspaceId, resolve(target));
        return ok(raw, '', started);
      }

      case 'touch': {
        const target = args.filter((a) => !a.startsWith('-'))[0];
        if (!target) return fail(raw, 'touch: missing operand', started, 2);
        const rel = resolve(target);
        const existing = await readFileText(env, workspaceId, rel);
        await writeFileText(env, workspaceId, rel, existing ?? '');
        return ok(raw, '', started);
      }

      case 'rm': {
        const target = args.filter((a) => !a.startsWith('-'))[0];
        if (!target) return fail(raw, 'rm: missing operand', started, 2);
        try {
          const res = await deletePath(env, workspaceId, resolve(target));
          return ok(raw, `removed ${res.deleted} object(s)`, started);
        } catch (e: any) {
          return fail(raw, `rm: ${e?.message ?? e}`, started, 1);
        }
      }

      case 'cp':
      case 'mv': {
        const positional = args.filter((a) => !a.startsWith('-'));
        const [src, dst] = positional;
        if (!src || !dst) return fail(raw, `${bin}: usage: ${bin} <src> <dst>`, started, 2);
        const text = await readFileText(env, workspaceId, resolve(src));
        if (text === null) return fail(raw, `${bin}: ${src}: No such file`, started, 1);
        await writeFileText(env, workspaceId, resolve(dst), text);
        if (bin === 'mv') await deletePath(env, workspaceId, resolve(src)).catch(() => undefined);
        return ok(raw, '', started);
      }

      default:
        if (UNSUPPORTED_BINARIES.has(bin)) return unsupported(raw, bin, started);
        return unsupported(raw, bin, started);
    }
  } catch (e: any) {
    return fail(raw, String(e?.message ?? e), started, 1);
  }
}

/** There are no long-lived child processes on Workers. */
export function listActiveProcesses(): unknown[] {
  return [];
}

export function killProcess(_pid: number): boolean {
  return false;
}

/**
 * Port of chat.execute_file_in_workspace.
 * HTML previews work natively; script runtimes are reported as unsupported so
 * the self-healing loop can skip instead of looping forever.
 */
export async function executeFileInWorkspace(
  env: Env,
  workspaceId: string,
  path: string,
  conversationId?: string | null,
): Promise<Record<string, any>> {
  const rel = normalizeRel(path);
  const text = await readFileText(env, workspaceId, rel);
  const lower = rel.toLowerCase();

  if (text === null) {
    return { ok: false, success: false, error: `File not found: ${path}`, exitCode: 1, path };
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const qs = new URLSearchParams({ path: rel });
    if (conversationId) qs.set('conversation_id', conversationId);
    return {
      ok: true,
      success: true,
      type: 'html',
      fileType: 'html',
      path,
      previewUrl: `/api/workspace/raw?${qs.toString()}`,
      exitCode: 0,
      stdout: 'Live HTML preview ready.',
      stderr: '',
      message: 'HTML ready for live preview.',
    };
  }

  const scriptExts = ['.py', '.pyw', '.sh', '.bash', '.js', '.mjs', '.ts', '.php'];
  if (scriptExts.some((e) => lower.endsWith(e))) {
    const res = await executeSandboxedCommand(
      env,
      workspaceId,
      `${lower.endsWith('.py') || lower.endsWith('.pyw') ? 'python3' : lower.endsWith('.php') ? 'php' : lower.endsWith('.sh') || lower.endsWith('.bash') ? 'bash' : 'node'} '${rel}'`,
      '.',
      60,
      true,
    );
    return {
      ok: false,
      success: false,
      unsupported: true,
      command: res.command,
      path,
      type: 'script',
      fileType: lower.split('.').pop(),
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs: res.durationMs,
    };
  }

  return {
    ok: true,
    success: true,
    type: 'text',
    fileType: lower.split('.').pop(),
    path,
    exitCode: 0,
    stdout: text.slice(0, 30000),
    stderr: '',
    message: 'File created.',
  };
}
