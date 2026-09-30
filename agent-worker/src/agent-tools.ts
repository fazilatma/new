/**
 * Port of agent-python/app/agent_tools.py — the OpenAI tool-calling surface
 * exposed to the model, plus its execution engine.
 */

import type { Env } from './types';
import { isFileApprovalRequired } from './config';
import {
  listDir,
  listRecursive,
  normalizeRel,
  readFileText,
  writeFileText,
  basename,
} from './storage';
import {
  createChangeset,
  saveFileVersionSnapshot,
} from './changesets';
import {
  copyReferenceFile,
  listReferenceFiles,
  readReferenceFile,
} from './workspaces';
import { executeSandboxedCommand } from './terminal';
import { browserNavigate, browserFetch } from './browser';
import { getGitStatus, getGitDiff } from './git';

export interface ToolContext {
  env: Env;
  workspaceId: string;
  conversationId?: string | null;
  userId?: string;
}

/** Port of `_parse_prefixed_reference`: `@chat:<id>/path` / `@project:<id>/path`. */
export function parsePrefixedReference(
  path: string,
): { targetType: string; targetId: string; subpath: string } | null {
  const raw = (path || '').trim();
  const m = /^@(chat|project|session|conversation|proj):([^/]+)(?:\/(.*))?$/.exec(raw);
  if (!m) return null;
  return { targetType: m[1], targetId: m[2], subpath: m[3] ?? '.' };
}

/* ------------------------------------------------------------------ */
/* Individual tools                                                    */
/* ------------------------------------------------------------------ */

export async function agentListFiles(ctx: ToolContext, path = '.') {
  const ref = parsePrefixedReference(path);
  if (ref) return await listReferenceFiles(ctx.env, ref.targetType, ref.targetId, ref.subpath);
  return await listDir(ctx.env, ctx.workspaceId, path);
}

export async function agentReadFile(ctx: ToolContext, path: string) {
  const ref = parsePrefixedReference(path);
  if (ref) return await readReferenceFile(ctx.env, ref.targetType, ref.targetId, ref.subpath);
  const text = await readFileText(ctx.env, ctx.workspaceId, path);
  if (text === null) throw new Error(`File not found: ${path}`);
  return text;
}

export async function agentWriteFile(
  ctx: ToolContext,
  path: string,
  content: string,
  requireApproval?: boolean,
) {
  const relPath = normalizeRel(path);
  if (!relPath) throw new Error('A file path is required');

  const approvalNeeded =
    requireApproval === undefined ? await isFileApprovalRequired(ctx.env) : requireApproval;

  const existing = await readFileText(ctx.env, ctx.workspaceId, relPath);

  if (approvalNeeded) {
    const cs = await createChangeset(
      ctx.env,
      ctx.workspaceId,
      `Agent edit: ${relPath}`,
      [
        {
          path: relPath,
          new_content: content,
          change_type: existing === null ? 'added' : 'modified',
        },
      ],
      'agent',
    );
    return {
      status: 'pending_approval',
      requiresApproval: true,
      changesetId: cs.id,
      path: relPath,
      diff: cs.files[0]?.diff ?? '',
      message: `Change to '${relPath}' is staged in ChangeSet ${cs.id} and requires user approval before applying.`,
    };
  }

  if (existing !== null) {
    await saveFileVersionSnapshot(
      ctx.env,
      ctx.workspaceId,
      relPath,
      existing,
      'before-direct-write',
    );
  }
  const bytes = await writeFileText(ctx.env, ctx.workspaceId, relPath, content);
  await saveFileVersionSnapshot(ctx.env, ctx.workspaceId, relPath, content, 'agent-direct');

  return {
    status: 'applied',
    path: relPath,
    bytes,
    message: `File '${relPath}' saved successfully.`,
  };
}

export async function agentRunCommand(
  ctx: ToolContext,
  command: string,
  cwd = '.',
  timeout = 60,
  confirmed = false,
) {
  return await executeSandboxedCommand(
    ctx.env,
    ctx.workspaceId,
    command,
    cwd,
    timeout,
    confirmed,
  );
}

/* ------------------------------------------------------------------ */
/* Tool definitions sent to the model                                  */
/* ------------------------------------------------------------------ */

export const AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in the active project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Subdirectory to list (defaults to workspace root '.')." },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read text content of a workspace file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write or update a file in the workspace. Staged for diff approval if approval is enabled.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
          content: { type: 'string', description: 'Complete file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a command in the workspace shell. NOTE: this deployment runs on Cloudflare Workers, ' +
        'which has no process model. Only filesystem built-ins are available ' +
        '(ls, cat, head, tail, wc, grep, find, tree, stat, du, mkdir, touch, rm, mv, cp, echo, pwd). ' +
        'Language runtimes (python, node, php, bash) return exit code 127 — do not rely on them.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run (built-ins only).' },
          cwd: { type: 'string', description: "Working directory relative to workspace root (defaults to '.')." },
          timeout: { type: 'integer', description: 'Timeout in seconds (advisory).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Fetch a web page and retrieve its title, text content and links. Uses Cloudflare Browser ' +
        'Rendering when configured, otherwise a fetch + DOM extraction engine.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'HTTP or HTTPS URL to load.' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description:
        'Perform a raw HTTP(S) GET against any public URL and return the response body ' +
        '(useful for APIs, raw files and JSON endpoints).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'HTTP or HTTPS URL to request.' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description:
        'Get version-control status for the active project (GitHub API backed: compares the ' +
        'workspace against the linked repository branch).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Get the diff between the workspace and the linked GitHub repository branch.',
      parameters: {
        type: 'object',
        properties: {
          staged_only: { type: 'boolean', description: 'Kept for API compatibility.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_referenced_files',
      description: 'List files from another referenced chat session or project workspace.',
      parameters: {
        type: 'object',
        properties: {
          target_type: { type: 'string', enum: ['chat', 'project'] },
          target_id: { type: 'string', description: 'Chat session ID/title or Project ID/name.' },
          path: { type: 'string', description: "Subdirectory to list (defaults to root '.')." },
        },
        required: ['target_type', 'target_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_referenced_file',
      description:
        'Read the complete text content of a file from a referenced chat session or project workspace.',
      parameters: {
        type: 'object',
        properties: {
          target_type: { type: 'string', enum: ['chat', 'project'] },
          target_id: { type: 'string' },
          path: { type: 'string', description: 'Relative path in that referenced workspace.' },
        },
        required: ['target_type', 'target_id', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_referenced_file',
      description:
        'Copy a file or directory from a referenced chat session or project workspace into the active workspace.',
      parameters: {
        type: 'object',
        properties: {
          target_type: { type: 'string', enum: ['chat', 'project'] },
          target_id: { type: 'string' },
          source_path: { type: 'string' },
          dest_path: { type: 'string', description: 'Optional destination in the active workspace.' },
        },
        required: ['target_type', 'target_id', 'source_path'],
      },
    },
  },
] as const;

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export async function executeAgentTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, any>,
): Promise<unknown> {
  switch (name) {
    case 'list_files':
      return await agentListFiles(ctx, args.path ?? '.');
    case 'read_file':
      return await agentReadFile(ctx, args.path);
    case 'write_file':
      return await agentWriteFile(ctx, args.path, args.content ?? '');
    case 'list_referenced_files':
      return await listReferenceFiles(ctx.env, args.target_type, args.target_id, args.path ?? '.');
    case 'read_referenced_file':
      return await readReferenceFile(ctx.env, args.target_type, args.target_id, args.path);
    case 'copy_referenced_file':
      return await copyReferenceFile(
        ctx.env,
        args.target_type,
        args.target_id,
        args.source_path,
        args.dest_path,
        ctx.workspaceId,
      );
    case 'run_command':
      return await agentRunCommand(
        ctx,
        args.command,
        args.cwd ?? '.',
        args.timeout ?? 60,
        Boolean(args.confirmed),
      );
    case 'browser_navigate':
      return await browserNavigate(ctx.env, args.url);
    case 'http_request':
      return await browserFetch(ctx.env, args.url);
    case 'git_status':
      return await getGitStatus(ctx.env);
    case 'git_diff':
      return await getGitDiff(ctx.env, Boolean(args.staged_only));
    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}

export { listRecursive, basename };
