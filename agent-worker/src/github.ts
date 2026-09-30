/**
 * Port of agent-python/app/github_workspace.py — GitHub REST v3 connector
 * using `fetch` instead of httpx.
 */

import type { Env } from './types';
import { getRawConfig } from './config';
import { HttpError } from './workspaces';

export const GITHUB_API_BASE = 'https://api.github.com';

export async function getGithubToken(env: Env): Promise<string> {
  const token = await getRawConfig(env, 'GITHUB_TOKEN', '');
  if (!token) {
    throw new HttpError(400, 'GITHUB_TOKEN is not configured in Environment settings.');
  }
  return token;
}

async function ghHeaders(env: Env): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getGithubToken(env)}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Arena-Agent-Worker/1.0',
    'Content-Type': 'application/json',
  };
}

async function ghRequest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>,
): Promise<any> {
  const url = new URL(`${GITHUB_API_BASE}/${path.replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), {
    method,
    headers: await ghHeaders(env),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (resp.status === 204) return { ok: true };
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (resp.status >= 400) {
    const message = (data && typeof data === 'object' && data.message) || text || resp.statusText;
    throw new HttpError(resp.status, message);
  }
  return data;
}

export const githubApiGet = (env: Env, path: string, params?: Record<string, any>) =>
  ghRequest(env, 'GET', path, undefined, params);
export const githubApiPost = (env: Env, path: string, body: unknown) =>
  ghRequest(env, 'POST', path, body);
export const githubApiPut = (env: Env, path: string, body: unknown) =>
  ghRequest(env, 'PUT', path, body);
export const githubApiPatch = (env: Env, path: string, body: unknown) =>
  ghRequest(env, 'PATCH', path, body);
export const githubApiDelete = (env: Env, path: string, body?: unknown) =>
  ghRequest(env, 'DELETE', path, body);

/* ------------------------------------------------------------------ */
/* High-level operations (same names as the Python module)             */
/* ------------------------------------------------------------------ */

export const getGithubUser = (env: Env) => githubApiGet(env, 'user');

export const listUserRepos = (env: Env) =>
  githubApiGet(env, 'user/repos', { per_page: 100, sort: 'updated' });

export const listRepoBranches = (env: Env, owner: string, repo: string) =>
  githubApiGet(env, `repos/${owner}/${repo}/branches`, { per_page: 100 });

export const getRepoTree = (env: Env, owner: string, repo: string, branch = 'main') =>
  githubApiGet(env, `repos/${owner}/${repo}/git/trees/${branch}`, { recursive: '1' });

export async function getRepoFile(
  env: Env,
  owner: string,
  repo: string,
  path: string,
  ref?: string | null,
) {
  const data = await githubApiGet(env, `repos/${owner}/${repo}/contents/${path}`, {
    ref: ref ?? undefined,
  });
  if (data && typeof data === 'object' && data.content && data.encoding === 'base64') {
    try {
      const bin = atob(String(data.content).replace(/\n/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      data.decodedContent = new TextDecoder().decode(bytes);
    } catch {
      data.decodedContent = null;
    }
  }
  return data;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function createOrUpdateRepoFile(
  env: Env,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string,
) {
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await githubApiGet(env, `repos/${owner}/${repo}/contents/${path}`, {
        ref: branch,
      });
      fileSha = existing?.sha;
    } catch {
      fileSha = undefined;
    }
  }
  return await githubApiPut(env, `repos/${owner}/${repo}/contents/${path}`, {
    message: message || `Update ${path} via Arena Agent`,
    content: toBase64(content),
    branch: branch || undefined,
    sha: fileSha,
  });
}

export async function deleteRepoFile(
  env: Env,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch?: string,
) {
  const existing = await githubApiGet(env, `repos/${owner}/${repo}/contents/${path}`, {
    ref: branch,
  });
  return await githubApiDelete(env, `repos/${owner}/${repo}/contents/${path}`, {
    message: message || `Delete ${path} via Arena Agent`,
    sha: existing?.sha,
    branch: branch || undefined,
  });
}

export const listPullRequests = (env: Env, owner: string, repo: string, state = 'open') =>
  githubApiGet(env, `repos/${owner}/${repo}/pulls`, { state, per_page: 50 });

export const getPullRequest = (env: Env, owner: string, repo: string, n: number) =>
  githubApiGet(env, `repos/${owner}/${repo}/pulls/${n}`);

export const createPullRequest = (
  env: Env,
  owner: string,
  repo: string,
  body: Record<string, unknown>,
) => githubApiPost(env, `repos/${owner}/${repo}/pulls`, body);

export const mergePullRequest = (
  env: Env,
  owner: string,
  repo: string,
  n: number,
  body: Record<string, unknown> = {},
) => githubApiPut(env, `repos/${owner}/${repo}/pulls/${n}/merge`, body);

export const createPrReview = (
  env: Env,
  owner: string,
  repo: string,
  n: number,
  body: Record<string, unknown>,
) => githubApiPost(env, `repos/${owner}/${repo}/pulls/${n}/reviews`, body);

export const listWorkflowRuns = (env: Env, owner: string, repo: string) =>
  githubApiGet(env, `repos/${owner}/${repo}/actions/runs`, { per_page: 30 });

export const rerunWorkflowRun = (env: Env, owner: string, repo: string, runId: number) =>
  githubApiPost(env, `repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {});

export const listIssues = (env: Env, owner: string, repo: string, state = 'open') =>
  githubApiGet(env, `repos/${owner}/${repo}/issues`, { state, per_page: 50 });

export const createIssue = (
  env: Env,
  owner: string,
  repo: string,
  body: Record<string, unknown>,
) => githubApiPost(env, `repos/${owner}/${repo}/issues`, body);

export const addIssueComment = (
  env: Env,
  owner: string,
  repo: string,
  n: number,
  body: string,
) => githubApiPost(env, `repos/${owner}/${repo}/issues/${n}/comments`, { body });
