/**
 * Port of agent-python/app/worker.py — the background job queue.
 *
 * The Python version ran a `while True` asyncio loop inside the server
 * process. Workers have no long-lived process, so the same lifecycle is built
 * from two primitives:
 *   • `ctx.waitUntil(executeJobTask(...))` — runs the job right after the
 *     enqueueing request returns (the common path, low latency).
 *   • a 1-minute cron trigger — `drainJobQueue()` recovers orphans and picks up
 *     anything still `queued` (the supervision path).
 *
 * Job state lives in D1, artifacts in R2 under `job_outputs/`.
 */

import type { Env } from './types';
import { all, first, run, changes } from './db';
import { JOB_OUTPUTS_PREFIX } from './storage';
import { ProviderStore } from './providers';
import { completeChat } from './chat';
import { randomHex } from './crypto';
import { logEvent } from './observability';

/** Control flags are isolate-local (same caveat as the Python in-memory dict). */
export const JOB_CONTROL_FLAGS = new Map<string, string>();

export async function saveJobOutputArtifact(
  env: Env,
  jobId: string,
  data: unknown,
): Promise<string> {
  const key = `${JOB_OUTPUTS_PREFIX}/${jobId}.json`;
  await env.FILES.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return `r2://${key}`;
}

export async function loadJobOutputArtifact(env: Env, jobId: string): Promise<unknown | null> {
  const obj = await env.FILES.get(`${JOB_OUTPUTS_PREFIX}/${jobId}.json`);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

export async function logJobMessage(
  env: Env,
  jobId: string,
  level: string,
  message: string,
): Promise<void> {
  await run(
    env,
    'INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)',
    jobId,
    level,
    message,
  ).catch(() => undefined);
}

export async function recordJobStep(
  env: Env,
  jobId: string,
  stepIndex: number,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  status: string,
  durationMs: number,
): Promise<void> {
  await run(
    env,
    `INSERT INTO job_steps (id, job_id, step_index, tool_name, arguments, result, status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `step-${randomHex(4)}`,
    jobId,
    stepIndex,
    toolName,
    JSON.stringify(args ?? {}),
    typeof result === 'string' ? result : JSON.stringify(result ?? null),
    status,
    Math.round(durationMs),
  ).catch(() => undefined);
}

/** Port of `recover_orphaned_jobs`. */
export async function recoverOrphanedJobs(env: Env): Promise<number> {
  const rows = await all<any>(
    env,
    "SELECT id, retry_count, max_retries FROM jobs WHERE status = 'running'",
  );
  for (const r of rows) {
    if ((r.retry_count ?? 0) < (r.max_retries ?? 3)) {
      await run(
        env,
        `UPDATE jobs SET status = 'queued', retry_count = retry_count + 1,
         updated_at = datetime('now') WHERE id = ?`,
        r.id,
      );
      await logJobMessage(
        env,
        r.id,
        'WARNING',
        'Recovered job from worker restart: re-queued for execution.',
      );
    } else {
      await run(
        env,
        `UPDATE jobs SET status = 'failed',
         error = 'Worker restarted while job was in progress (max retries reached)',
         updated_at = datetime('now') WHERE id = ?`,
        r.id,
      );
      await logJobMessage(env, r.id, 'ERROR', 'Job marked failed due to worker restart.');
    }
  }
  return rows.length;
}

export interface CreateJobInput {
  title: string;
  providerId: string;
  modelId: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
  userId?: string;
  conversationId?: string;
  maxSteps?: number;
  maxTimeoutSec?: number;
}

export async function createJob(env: Env, input: CreateJobInput) {
  const jobId = `job-${Math.floor(Date.now() / 1000)}-${randomHex(3)}`;
  await run(
    env,
    `INSERT INTO jobs (id, workspace_id, user_id, conversation_id, title, provider_id, model_id,
                       status, max_steps, max_timeout_sec, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    jobId,
    input.workspaceId ?? 'default',
    input.userId ?? 'user',
    input.conversationId ?? '',
    input.title,
    input.providerId,
    input.modelId,
    input.maxSteps ?? 8,
    input.maxTimeoutSec ?? 600,
    JSON.stringify(input.payload ?? {}),
  );
  await logJobMessage(env, jobId, 'INFO', `Job created and queued: ${input.title}`);
  return await getJobDetails(env, jobId);
}

export async function getJobDetails(env: Env, jobId: string) {
  const row = await first<any>(
    env,
    `SELECT id, workspace_id, user_id, conversation_id, provider_id, model_id, title, status,
            progress, step_count, max_steps, max_timeout_sec, retry_count, max_retries, error,
            result_ref, summary, payload, created_at, updated_at, started_at, finished_at
     FROM jobs WHERE id = ?`,
    jobId,
  );
  if (!row) return null;

  try {
    row.payload = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    /* keep raw */
  }

  row.steps = await all(
    env,
    `SELECT step_index, tool_name, arguments, result, status, duration_ms, created_at
     FROM job_steps WHERE job_id = ? ORDER BY step_index ASC`,
    jobId,
  );
  row.logs = await all(
    env,
    'SELECT level, message, created_at FROM job_logs WHERE job_id = ? ORDER BY id ASC',
    jobId,
  );
  if (row.result_ref) row.result = await loadJobOutputArtifact(env, jobId);
  return row;
}

export async function listAllJobs(
  env: Env,
  filters: { status?: string; provider?: string; model?: string; limit?: number } = {},
) {
  let query = `SELECT id, workspace_id, user_id, title, provider_id, model_id, status, progress,
                      step_count, max_steps, retry_count, error, created_at, updated_at,
                      started_at, finished_at
               FROM jobs WHERE 1=1`;
  const params: unknown[] = [];
  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.provider) {
    query += ' AND provider_id = ?';
    params.push(filters.provider);
  }
  if (filters.model) {
    query += ' AND model_id = ?';
    params.push(filters.model);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filters.limit ?? 50);
  return await all(env, query, ...params);
}

export async function cancelJob(env: Env, jobId: string): Promise<boolean> {
  JOB_CONTROL_FLAGS.set(jobId, 'cancel');
  await run(
    env,
    "UPDATE jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    jobId,
  );
  await logJobMessage(env, jobId, 'WARNING', 'Job cancelled by user.');
  return true;
}

export async function pauseJob(env: Env, jobId: string): Promise<boolean> {
  JOB_CONTROL_FLAGS.set(jobId, 'pause');
  await run(
    env,
    "UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?",
    jobId,
  );
  await logJobMessage(env, jobId, 'INFO', 'Job paused.');
  return true;
}

export async function resumeJob(env: Env, jobId: string): Promise<boolean> {
  JOB_CONTROL_FLAGS.delete(jobId);
  await run(
    env,
    "UPDATE jobs SET status = 'queued', updated_at = datetime('now') WHERE id = ?",
    jobId,
  );
  await logJobMessage(env, jobId, 'INFO', 'Job resumed and re-queued.');
  return true;
}

export async function retryJob(env: Env, jobId: string): Promise<boolean> {
  JOB_CONTROL_FLAGS.delete(jobId);
  await run(
    env,
    "UPDATE jobs SET status = 'queued', error = '', updated_at = datetime('now') WHERE id = ?",
    jobId,
  );
  await logJobMessage(env, jobId, 'INFO', 'Job manually re-queued for retry.');
  return true;
}

export async function deleteOldJobs(env: Env, days = 7): Promise<number> {
  const res = await run(
    env,
    "DELETE FROM jobs WHERE created_at < datetime('now', '-' || ? || ' days')",
    days,
  );
  return changes(res);
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

/** Port of `execute_job_task`. */
export async function executeJobTask(env: Env, jobId: string): Promise<void> {
  await run(
    env,
    `UPDATE jobs SET status = 'running', started_at = datetime('now'),
     updated_at = datetime('now') WHERE id = ?`,
    jobId,
  );
  await logJobMessage(env, jobId, 'INFO', 'Starting job task execution...');

  const job = await getJobDetails(env, jobId);
  if (!job) return;

  const payload: any = job.payload ?? {};
  const messages =
    payload.messages ?? [{ role: 'user', content: payload.message ?? job.title ?? '' }];
  const timeoutSec = job.max_timeout_sec ?? 600;
  const started = Date.now();

  try {
    const store = await ProviderStore.load(env);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('__job_timeout__')), timeoutSec * 1000);
    });

    const result: any = await Promise.race([
      completeChat(env, store, {
        providerId: job.provider_id,
        modelId: job.model_id,
        messages,
        maxSteps: job.max_steps ?? 8,
        userId: job.user_id ?? 'user',
        conversationId: job.conversation_id || null,
      }),
      timeoutPromise,
    ]);

    if (JOB_CONTROL_FLAGS.get(jobId) === 'cancel') {
      await run(
        env,
        `UPDATE jobs SET status = 'cancelled', finished_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`,
        jobId,
      );
      return;
    }

    // Persist tool steps recorded by the agent loop.
    for (const [i, step] of (result.stepHistory ?? []).entries()) {
      await recordJobStep(
        env,
        jobId,
        step.step ?? i,
        step.tool ?? '',
        step.args ?? {},
        step.result,
        step.status ?? 'success',
        step.durationMs ?? 0,
      );
    }

    const artifactRef = await saveJobOutputArtifact(env, jobId, result);
    const summary = String(result?.message?.content ?? '').slice(0, 300);

    await run(
      env,
      `UPDATE jobs SET status = 'done', progress = 100.0, step_count = ?, result_ref = ?,
       summary = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      result?.steps ?? 1,
      artifactRef,
      summary,
      jobId,
    );
    await logJobMessage(
      env,
      jobId,
      'INFO',
      `Job completed successfully in ${Math.round((Date.now() - started) / 1000)}s.`,
    );
  } catch (e: any) {
    const isTimeout = String(e?.message ?? e) === '__job_timeout__';
    const errStr = isTimeout ? 'Job execution timed out' : String(e?.message ?? e);
    await run(
      env,
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`,
      errStr,
      jobId,
    );
    await logJobMessage(
      env,
      jobId,
      'ERROR',
      isTimeout
        ? `Job exceeded max execution time (${timeoutSec}s).`
        : `Job failed with error: ${errStr}`,
    );
  } finally {
    JOB_CONTROL_FLAGS.delete(jobId);
  }
}

/**
 * Cron entrypoint — replaces `persistent_worker_loop`.
 * Recovers orphans, then drains up to MAX_CONCURRENT_JOBS queued jobs.
 */
export async function drainJobQueue(env: Env): Promise<{ recovered: number; started: string[] }> {
  const recovered = await recoverOrphanedJobs(env);

  const maxConcurrent = Number(env.MAX_CONCURRENT_JOBS ?? '3') || 3;
  const rows = await all<any>(
    env,
    "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
    maxConcurrent,
  );

  const started: string[] = [];
  for (const r of rows) {
    started.push(r.id);
    await executeJobTask(env, r.id);
  }

  if (recovered || started.length) {
    await logEvent(env, 'INFO', 'WORKER', 'Job queue drained by scheduled trigger', {
      recovered,
      started,
    });
  }
  return { recovered, started };
}
