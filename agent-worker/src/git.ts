/**
 * Replacement for agent-python/app/git_manager.py.
 *
 * The Python module shelled out to the `git` binary against a local checkout.
 * Neither exists on Workers, so version control is expressed through the
 * GitHub REST API against the repository configured on the active project
 * (`git_url` + `default_branch`), with the R2 workspace as the working tree.
 *
 * Every function keeps the response shape the existing UI expects and adds an
 * explicit `backend` field so callers can tell which engine answered.
 */

import type { Env } from './types';
import { getActiveProject } from './projects';
import { getActiveWorkspace } from './workspaces';
import { listRecursive, readFileText } from './storage';
import { computeDiff } from './diff';
import {
  createOrUpdateRepoFile,
  getRepoFile,
  githubApiGet,
  githubApiPost,
  githubApiDelete,
  getGithubToken,
} from './github';

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

const NOT_CONFIGURED = {
  isRepo: false,
  branch: '',
  files: [],
  backend: 'github-api',
  raw:
    'No GitHub repository is linked to the active project. Set the project "gitUrl" ' +
    '(e.g. https://github.com/owner/repo) and GITHUB_TOKEN in Settings to enable version control.',
};

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const m =
    /github\.com[/:]([^/]+)\/([^/.\s]+)(?:\.git)?/i.exec(url) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

export async function resolveRepoRef(env: Env): Promise<RepoRef | null> {
  const proj = await getActiveProject(env);
  const parsed = parseRepoUrl(proj.git_url || '');
  if (!parsed) return null;
  return { ...parsed, branch: proj.default_branch || 'main' };
}

/* ------------------------------------------------------------------ */
/* Status & diff — computed between R2 workspace and the GitHub tree    */
/* ------------------------------------------------------------------ */

export async function getGitStatus(env: Env) {
  const ref = await resolveRepoRef(env);
  if (!ref) return NOT_CONFIGURED;

  try {
    await getGithubToken(env);
  } catch (e: any) {
    return { ...NOT_CONFIGURED, raw: e?.message ?? String(e) };
  }

  const ws = await getActiveWorkspace(env);
  const local = (await listRecursive(env, ws.id)).filter((f) => f.type === 'file');

  let remoteFiles = new Map<string, string>();
  let ahead = 0;
  try {
    const tree = await githubApiGet(
      env,
      `repos/${ref.owner}/${ref.repo}/git/trees/${ref.branch}`,
      { recursive: '1' },
    );
    for (const node of tree?.tree ?? []) {
      if (node.type === 'blob') remoteFiles.set(node.path, node.sha);
    }
  } catch (e: any) {
    return {
      isRepo: false,
      branch: ref.branch,
      files: [],
      backend: 'github-api',
      raw: `Unable to read ${ref.owner}/${ref.repo}@${ref.branch}: ${e?.message ?? e}`,
    };
  }

  const files: { path: string; staged: boolean; status: string }[] = [];
  for (const f of local) {
    if (!remoteFiles.has(f.path)) {
      files.push({ path: f.path, staged: false, status: '??' });
      ahead++;
    } else {
      files.push({ path: f.path, staged: false, status: 'M' });
    }
  }

  return {
    isRepo: true,
    backend: 'github-api',
    remote: `${ref.owner}/${ref.repo}`,
    branch: ref.branch,
    ahead,
    behind: 0,
    files,
    raw:
      `## ${ref.branch} (github:${ref.owner}/${ref.repo})\n` +
      files.map((f) => `${f.status.padEnd(2)} ${f.path}`).join('\n'),
  };
}

export async function getGitDiff(env: Env, _stagedOnly = false, filePath?: string | null) {
  const ref = await resolveRepoRef(env);
  if (!ref) return { diff: '', stat: '', ok: false, backend: 'github-api', error: NOT_CONFIGURED.raw };

  const ws = await getActiveWorkspace(env);
  const local = (await listRecursive(env, ws.id)).filter(
    (f) => f.type === 'file' && (!filePath || f.path === filePath),
  );

  const diffs: string[] = [];
  const stats: string[] = [];
  for (const f of local.slice(0, 80)) {
    const localText = (await readFileText(env, ws.id, f.path)) ?? '';
    let remoteText = '';
    try {
      const remote = await getRepoFile(env, ref.owner, ref.repo, f.path, ref.branch);
      remoteText = remote?.decodedContent ?? '';
    } catch {
      remoteText = '';
    }
    if (remoteText === localText) continue;
    const d = computeDiff(remoteText, localText, f.path);
    if (d) {
      diffs.push(d);
      const added = d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
      const removed = d.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
      stats.push(` ${f.path} | ${added + removed} +${added} -${removed}`);
    }
  }

  return {
    ok: true,
    backend: 'github-api',
    diff: diffs.join('\n'),
    stat: stats.join('\n'),
  };
}

/* ------------------------------------------------------------------ */
/* Branches                                                            */
/* ------------------------------------------------------------------ */

export async function listBranches(env: Env) {
  const ref = await resolveRepoRef(env);
  if (!ref) return { branches: [], current: '', backend: 'github-api', error: NOT_CONFIGURED.raw };
  const data = await githubApiGet(env, `repos/${ref.owner}/${ref.repo}/branches`, {
    per_page: 100,
  });
  return {
    backend: 'github-api',
    current: ref.branch,
    branches: (data ?? []).map((b: any) => ({
      name: b.name,
      current: b.name === ref.branch,
      remote: true,
      sha: b.commit?.sha,
    })),
  };
}

async function getBranchSha(env: Env, ref: RepoRef, branch: string): Promise<string> {
  const data = await githubApiGet(env, `repos/${ref.owner}/${ref.repo}/git/ref/heads/${branch}`);
  return data?.object?.sha;
}

export async function createBranch(env: Env, name: string, from?: string) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  const sha = await getBranchSha(env, ref, from || ref.branch);
  await githubApiPost(env, `repos/${ref.owner}/${ref.repo}/git/refs`, {
    ref: `refs/heads/${name}`,
    sha,
  });
  return { ok: true, backend: 'github-api', branch: name, from: from || ref.branch };
}

export async function switchBranch(env: Env, name: string) {
  // Switching == changing the active project's default branch on Workers.
  const { updateProject } = await import('./projects');
  const proj = await getActiveProject(env);
  await updateProject(env, proj.id, { defaultBranch: name });
  return { ok: true, backend: 'github-api', branch: name, note: 'Active project branch updated.' };
}

export async function renameBranch(env: Env, oldName: string, newName: string) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  await githubApiPost(env, `repos/${ref.owner}/${ref.repo}/branches/${oldName}/rename`, {
    new_name: newName,
  });
  return { ok: true, backend: 'github-api', from: oldName, to: newName };
}

export async function deleteBranch(env: Env, name: string) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  await githubApiDelete(env, `repos/${ref.owner}/${ref.repo}/git/refs/heads/${name}`);
  return { ok: true, backend: 'github-api', deleted: name };
}

/* ------------------------------------------------------------------ */
/* Commit / push / pull                                                */
/* ------------------------------------------------------------------ */

/**
 * "Commit" on Workers = push the changed workspace files to GitHub through the
 * Contents API. Each file becomes one commit on the target branch.
 */
export async function gitCommit(env: Env, message: string, paths?: string[]) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);

  const ws = await getActiveWorkspace(env);
  const all = (await listRecursive(env, ws.id)).filter((f) => f.type === 'file');
  const targets = paths?.length ? all.filter((f) => paths.includes(f.path)) : all;

  const committed: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const f of targets.slice(0, 100)) {
    const content = await readFileText(env, ws.id, f.path);
    if (content === null) continue;
    try {
      const remote = await getRepoFile(env, ref.owner, ref.repo, f.path, ref.branch).catch(
        () => null,
      );
      if (remote?.decodedContent === content) {
        skipped.push({ path: f.path, reason: 'unchanged' });
        continue;
      }
      await createOrUpdateRepoFile(
        env,
        ref.owner,
        ref.repo,
        f.path,
        content,
        message || `Arena Agent: update ${f.path}`,
        ref.branch,
        remote?.sha,
      );
      committed.push(f.path);
    } catch (e: any) {
      skipped.push({ path: f.path, reason: e?.message ?? String(e) });
    }
  }

  return {
    ok: committed.length > 0,
    backend: 'github-api',
    branch: ref.branch,
    repo: `${ref.owner}/${ref.repo}`,
    message,
    committed,
    skipped,
    stdout: `Committed ${committed.length} file(s) to ${ref.owner}/${ref.repo}@${ref.branch}`,
    stderr: skipped.length ? `${skipped.length} file(s) skipped` : '',
  };
}

/** Push is implicit with the Contents API; exposed for UI parity. */
export async function gitPush(env: Env, _remote = 'origin', branch = '', force = false) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  return {
    ok: true,
    backend: 'github-api',
    branch: branch || ref.branch,
    force,
    stdout:
      'Commits made through the GitHub Contents API are written straight to the remote branch — ' +
      'no separate push step is required.',
    stderr: '',
  };
}

/** Pull = copy the remote tree into the R2 workspace. */
export async function gitPull(env: Env, _remote = 'origin', branch = '') {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  const target = branch || ref.branch;
  const ws = await getActiveWorkspace(env);
  const { writeFileText } = await import('./storage');

  const tree = await githubApiGet(env, `repos/${ref.owner}/${ref.repo}/git/trees/${target}`, {
    recursive: '1',
  });
  const blobs = (tree?.tree ?? []).filter((n: any) => n.type === 'blob').slice(0, 300);

  let pulled = 0;
  for (const node of blobs) {
    try {
      const file = await getRepoFile(env, ref.owner, ref.repo, node.path, target);
      if (typeof file?.decodedContent === 'string') {
        await writeFileText(env, ws.id, node.path, file.decodedContent);
        pulled++;
      }
    } catch {
      /* skip binaries / oversized blobs */
    }
  }
  return {
    ok: true,
    backend: 'github-api',
    branch: target,
    pulled,
    stdout: `Synced ${pulled} file(s) from ${ref.owner}/${ref.repo}@${target} into the workspace.`,
    stderr: '',
  };
}

export async function gitFetch(env: Env) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  const branches = await listBranches(env);
  return { ok: true, backend: 'github-api', stdout: `Fetched ${branches.branches.length} branch refs.`, stderr: '' };
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export async function listCommitHistory(env: Env, limit = 50) {
  const ref = await resolveRepoRef(env);
  if (!ref) return [];
  const data = await githubApiGet(env, `repos/${ref.owner}/${ref.repo}/commits`, {
    sha: ref.branch,
    per_page: Math.min(limit, 100),
  });
  return (data ?? []).map((c: any) => ({
    hash: c.sha,
    shortHash: String(c.sha).slice(0, 7),
    author: c.commit?.author?.name ?? c.author?.login ?? '',
    email: c.commit?.author?.email ?? '',
    date: c.commit?.author?.date ?? '',
    message: (c.commit?.message ?? '').split('\n')[0],
    url: c.html_url,
  }));
}

export async function getCommitDetails(env: Env, commitHash: string) {
  const ref = await resolveRepoRef(env);
  if (!ref) throw new Error(NOT_CONFIGURED.raw);
  const c = await githubApiGet(env, `repos/${ref.owner}/${ref.repo}/commits/${commitHash}`);
  return {
    backend: 'github-api',
    hash: c.sha,
    author: c.commit?.author?.name,
    date: c.commit?.author?.date,
    message: c.commit?.message,
    stats: c.stats,
    files: (c.files ?? []).map((f: any) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    diff: (c.files ?? []).map((f: any) => f.patch ?? '').join('\n'),
  };
}

/* ------------------------------------------------------------------ */
/* Unsupported without a local working tree                            */
/* ------------------------------------------------------------------ */

function unsupported(feature: string) {
  return {
    ok: false,
    backend: 'github-api',
    unsupported: true,
    error:
      `'${feature}' needs a local git working tree, which does not exist on Cloudflare Workers. ` +
      `Use branches + pull requests through the GitHub API instead, or keep the Python/Docker ` +
      `deployment for local git operations.`,
  };
}

export const listStashes = async () => [];
export const gitStashSave = async () => unsupported('git stash');
export const gitStashApply = async () => unsupported('git stash apply');
export const gitCherryPick = async () => unsupported('git cherry-pick');
export const gitRevert = async () => unsupported('git revert');
export const gitMerge = async () => unsupported('git merge');
export const getMergeConflicts = async () => [];
export const resolveConflictFile = async () => unsupported('conflict resolution');

export async function listRemotes(env: Env) {
  const ref = await resolveRepoRef(env);
  if (!ref) return [];
  return [
    {
      name: 'origin',
      fetch: `https://github.com/${ref.owner}/${ref.repo}.git`,
      push: `https://github.com/${ref.owner}/${ref.repo}.git`,
    },
  ];
}
