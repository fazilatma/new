import type { JobMessage } from './types.js';

/** The per-query accounting D1 returns; rows_read/rows_written are the exact units Cloudflare bills and rate-limits on. */
export interface D1Meta { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number; duration?: number; size_after?: number; }

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ success: boolean; results: T[]; meta?: D1Meta; error?: string }>;
  run<T = Record<string, unknown>>(): Promise<{ success: boolean; results?: T[]; meta: D1Meta; error?: string }>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}
export interface QueueProducer<T> { send(message: T, options?: { delaySeconds?: number }): Promise<void>; }
export interface R2ObjectBody { body: ReadableStream; text(): Promise<string>; }
export interface R2Bucket {
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string,string> }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export type Env = {
  DB: D1Database;
  JOBS?: QueueProducer<JobMessage>;
  /** Provisioning-only producer binding that guarantees the dead-letter queue exists. */
  JOBS_DLQ?: QueueProducer<JobMessage>;
  BACKUPS?: R2Bucket;
  VAULT_SECRET?: string;
  /** Backward-compatible alias accepted when a user created VAULT_TOKEN by mistake. Prefer VAULT_SECRET. */
  VAULT_TOKEN?: string;
  ALLOW_INSECURE?: string;
  REQUEST_TIMEOUT_MS?: string;
  DETAIL_CONCURRENCY?: string;
  AI_DESCRIPTION_CONCURRENCY?: string;
  JOB_CHUNK_SIZE?: string;
  MAX_RESPONSE_BYTES?: string;
  WOO_URL?: string;
  WOO_KEY?: string;
  WOO_SECRET?: string;
  BASALAM_TOKEN?: string;
  BASALAM_VENDOR_ID?: string;
  BASALAM_API?: string;
  WORKER_VERSION?: string;
  GH_BACKUP_TOKEN?: string;
  AI_TEST_MODEL_BUDGET_MS?: string;
  AI_TEST_TIMEOUT_MS?: string;
  OPENROUTER_API_KEY?: string;
  AI_OPENROUTER_API_KEY?: string;
  OLLAMA_URL?: string;
};

export const MIN_SECRET_LENGTH = 8;
export function validSecret(value: string | undefined): value is string { return typeof value === 'string' && value.length >= MIN_SECRET_LENGTH; }

let current: Env | undefined;
export function configureEnv(env: Env): void { current = env; }
export function getEnv(): Env {
  if (!current?.DB) throw new Error('D1 binding DB is not configured');
  return current;
}
