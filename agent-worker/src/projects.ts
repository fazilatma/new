/**
 * Port of agent-python/app/projects.py. The active project id moves from a
 * module global into the D1 `app_state` table.
 */

import type { Env } from './types';
import { all, first, run, changes, getState, setState, DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_PATH } from './db';
import { uuidHex } from './crypto';
import { HttpError } from './workspaces';

export const ACTIVE_PROJECT_STATE_KEY = 'active_project_id';

function formatProjectRow(r: any) {
  const d = { ...r };
  try {
    d.env_vars = JSON.parse(d.env_vars || '{}');
  } catch {
    d.env_vars = {};
  }
  try {
    d.custom_commands = JSON.parse(d.custom_commands || '[]');
  } catch {
    d.custom_commands = [];
  }
  return d;
}

export async function getActiveProject(env: Env) {
  const pid = await getState(env, ACTIVE_PROJECT_STATE_KEY, DEFAULT_PROJECT_ID);
  let row =
    (await first<any>(env, `SELECT * FROM projects WHERE id = ?`, pid)) ??
    (await first<any>(env, `SELECT * FROM projects WHERE is_default = 1`)) ??
    (await first<any>(env, `SELECT * FROM projects ORDER BY created_at ASC LIMIT 1`));

  if (row) return formatProjectRow(row);

  return {
    id: DEFAULT_PROJECT_ID,
    name: 'Default Project',
    description: 'Primary coding workspace',
    path: DEFAULT_WORKSPACE_PATH,
    git_url: '',
    default_branch: 'main',
    default_provider: 'openrouter',
    default_model: '',
    instructions: '',
    agent_rules: '',
    env_vars: {},
    custom_commands: [],
    is_default: 1,
  };
}

export async function setActiveProject(env: Env, projectId: string) {
  const row = await first<any>(env, `SELECT * FROM projects WHERE id = ?`, projectId);
  if (!row) throw new HttpError(404, 'Project not found');
  await env.DB.batch([
    env.DB.prepare(`UPDATE projects SET is_default = 0`),
    env.DB.prepare(
      `UPDATE projects SET is_default = 1, updated_at = datetime('now') WHERE id = ?`,
    ).bind(projectId),
  ]);
  await setState(env, ACTIVE_PROJECT_STATE_KEY, projectId);
  return formatProjectRow(row);
}

export async function listProjects(env: Env) {
  const rows = await all<any>(
    env,
    `SELECT * FROM projects ORDER BY is_default DESC, created_at DESC`,
  );
  return rows.map(formatProjectRow);
}

export async function getProject(env: Env, projectId: string) {
  const row = await first<any>(env, `SELECT * FROM projects WHERE id = ?`, projectId);
  return row ? formatProjectRow(row) : null;
}

export interface ProjectInput {
  name?: string;
  description?: string;
  path?: string;
  gitUrl?: string;
  defaultBranch?: string;
  defaultProvider?: string;
  defaultModel?: string;
  instructions?: string;
  agentRules?: string;
  envVars?: Record<string, string>;
  customCommands?: Record<string, string>[];
}

export async function createProject(env: Env, data: ProjectInput) {
  const projId = `proj-${Math.floor(Date.now() / 1000)}-${uuidHex(6)}`;
  const projPath = data.path || `r2://ws/${projId}`;

  await run(
    env,
    `INSERT INTO projects (
      id, name, description, path, git_url, default_branch, default_provider,
      default_model, instructions, agent_rules, env_vars, custom_commands, is_default
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    projId,
    (data.name || 'New Project').trim(),
    data.description || '',
    projPath,
    data.gitUrl || '',
    data.defaultBranch || 'main',
    data.defaultProvider || 'openrouter',
    data.defaultModel || '',
    data.instructions || '',
    data.agentRules || '',
    JSON.stringify(data.envVars || {}),
    JSON.stringify(data.customCommands || []),
  );
  return await getProject(env, projId);
}

export async function updateProject(env: Env, projectId: string, data: ProjectInput) {
  const current = await getProject(env, projectId);
  if (!current) throw new HttpError(404, 'Project not found');

  const pick = <T>(incoming: T | undefined | null, fallback: T): T =>
    incoming !== undefined && incoming !== null ? incoming : fallback;

  await run(
    env,
    `UPDATE projects SET
       name = ?, description = ?, path = ?, git_url = ?, default_branch = ?,
       default_provider = ?, default_model = ?, instructions = ?, agent_rules = ?,
       env_vars = ?, custom_commands = ?, updated_at = datetime('now')
     WHERE id = ?`,
    pick(data.name, current.name),
    pick(data.description, current.description),
    pick(data.path, current.path),
    pick(data.gitUrl, current.git_url),
    pick(data.defaultBranch, current.default_branch),
    pick(data.defaultProvider, current.default_provider),
    pick(data.defaultModel, current.default_model),
    pick(data.instructions, current.instructions),
    pick(data.agentRules, current.agent_rules),
    JSON.stringify(pick(data.envVars, current.env_vars)),
    JSON.stringify(pick(data.customCommands, current.custom_commands)),
    projectId,
  );
  return await getProject(env, projectId);
}

export async function deleteProject(env: Env, projectId: string): Promise<boolean> {
  const res = await run(env, `DELETE FROM projects WHERE id = ?`, projectId);
  return changes(res) > 0;
}
