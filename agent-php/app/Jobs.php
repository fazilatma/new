<?php
/**
 * Background job queue. Port of agent-python/app/worker.py.
 *
 * The Python version ran a `while True` asyncio loop inside the server
 * process. PHP-FPM requests die at the end of the response, so the same
 * lifecycle is built from two primitives:
 *   • `bin/worker.php` — a real long-lived daemon that drains the queue
 *     (systemd / supervisor / `nohup`), the supervision path.
 *   • an autospawned detached `php bin/worker.php --job <id>` right after the
 *     enqueueing request, the low-latency path.
 *
 * Claiming is atomic (`UPDATE ... WHERE status='queued'`) so the two can never
 * run the same job twice. Job state lives in SQLite, artifacts on disk under
 * `storage/job_outputs/`.
 */

declare(strict_types=1);

namespace Arena;

final class Jobs
{
    public const DEFAULT_MAX_STEPS = 8;
    public const DEFAULT_TIMEOUT_SEC = 600;

    /* ------------------------------------------------- control flags */

    private static function flagKey(string $jobId): string
    {
        return 'job:control:' . $jobId;
    }

    public static function setControlFlag(string $jobId, string $flag): void
    {
        Database::setState(self::flagKey($jobId), $flag);
    }

    public static function controlFlag(string $jobId): string
    {
        return (string) Database::state(self::flagKey($jobId), '');
    }

    public static function clearControlFlag(string $jobId): void
    {
        Database::run('DELETE FROM app_state WHERE key = ?', [self::flagKey($jobId)]);
    }

    /* ----------------------------------------------------- artifacts */

    private static function artifactPath(string $jobId): string
    {
        return Bootstrap::$jobOutputsDir . '/' . $jobId . '.json';
    }

    public static function saveArtifact(string $jobId, mixed $data): string
    {
        $path = self::artifactPath($jobId);
        Files::write($path, (string) json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR));
        return 'file://' . $path;
    }

    public static function loadArtifact(string $jobId): mixed
    {
        $path = self::artifactPath($jobId);
        if (!is_file($path)) {
            return null;
        }
        return json_decode(Files::read($path), true);
    }

    /* ---------------------------------------------------- logs/steps */

    public static function log(string $jobId, string $level, string $message): void
    {
        try {
            Database::run('INSERT INTO job_logs (job_id, level, message) VALUES (?,?,?)', [$jobId, $level, Security::maskLogTokens($message)]);
        } catch (\Throwable) {
        }
    }

    public static function logs(string $jobId, int $limit = 500): array
    {
        return Database::all(
            'SELECT level, message, created_at FROM job_logs WHERE job_id = ? ORDER BY id ASC LIMIT ?',
            [$jobId, $limit]
        );
    }

    public static function recordStep(
        string $jobId,
        int $stepIndex,
        string $toolName,
        array $args,
        mixed $result,
        string $status,
        float $durationMs
    ): void {
        try {
            Database::run(
                'INSERT INTO job_steps (id, job_id, step_index, tool_name, arguments, result, status, duration_ms)
                 VALUES (?,?,?,?,?,?,?,?)',
                [
                    'step-' . Crypto::hex(2),
                    $jobId,
                    $stepIndex,
                    $toolName,
                    (string) json_encode($args, JSON_UNESCAPED_UNICODE),
                    is_string($result) ? $result : (string) json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR),
                    $status,
                    (int) round($durationMs),
                ]
            );
        } catch (\Throwable) {
        }
    }

    /* -------------------------------------------------------- CRUD */

    public static function create(array $input): array
    {
        $jobId = 'job-' . time() . '-' . Crypto::hex(2);
        Database::run(
            "INSERT INTO jobs (id, workspace_id, user_id, conversation_id, title, provider_id, model_id,
                               status, max_steps, max_timeout_sec, payload)
             VALUES (?,?,?,?,?,?,?, 'queued', ?, ?, ?)",
            [
                $jobId,
                (string) ($input['workspaceId'] ?? Workspaces::DEFAULT_ID),
                (string) ($input['userId'] ?? 'user'),
                (string) ($input['conversationId'] ?? ''),
                (string) ($input['title'] ?? 'Background job'),
                (string) ($input['providerId'] ?? ''),
                (string) ($input['modelId'] ?? ''),
                (int) ($input['maxSteps'] ?? self::DEFAULT_MAX_STEPS),
                (int) ($input['maxTimeoutSec'] ?? self::DEFAULT_TIMEOUT_SEC),
                (string) json_encode($input['payload'] ?? [], JSON_UNESCAPED_UNICODE),
            ]
        );
        self::log($jobId, 'INFO', 'Job created and queued: ' . ($input['title'] ?? ''));
        self::autospawn($jobId);
        return self::details($jobId) ?? [];
    }

    /** Kick a detached worker for this job so it starts without waiting for the daemon tick. */
    public static function autospawn(string $jobId): void
    {
        if (!Config::rawBool('AGENT_WORKER_AUTOSPAWN', true)) {
            return;
        }
        if (self::daemonRunning()) {
            return; // the daemon will pick it up within a second
        }
        if (!function_exists('proc_open')) {
            return;
        }
        $php = PHP_BINARY ?: 'php';
        $script = Bootstrap::$binDir . '/worker.php';
        if (!is_file($script)) {
            return;
        }
        $cmd = escapeshellarg($php) . ' ' . escapeshellarg($script) . ' --job ' . escapeshellarg($jobId);
        try {
            Terminal::startDetached($cmd, Bootstrap::$root, 'worker');
        } catch (\Throwable $e) {
            Observability::log('WARNING', 'WORKER', 'Could not autospawn job worker: ' . $e->getMessage());
        }
    }

    public static function daemonRunning(): bool
    {
        $hb = (int) Database::state('worker:heartbeat', '0');
        return $hb > 0 && (time() - $hb) < 30;
    }

    public static function heartbeat(): void
    {
        Database::setState('worker:heartbeat', (string) time());
    }

    public static function details(string $jobId): ?array
    {
        $row = Database::one(
            'SELECT id, workspace_id, user_id, conversation_id, provider_id, model_id, title, status,
                    progress, step_count, max_steps, max_timeout_sec, retry_count, max_retries, error,
                    result_ref, summary, payload, created_at, updated_at, started_at, finished_at
             FROM jobs WHERE id = ?',
            [$jobId]
        );
        if ($row === null) {
            return null;
        }
        $payload = json_decode((string) ($row['payload'] ?? ''), true);
        $row['payload'] = is_array($payload) ? $payload : [];
        $row['steps'] = Database::all(
            'SELECT step_index, tool_name, arguments, result, status, duration_ms, created_at
             FROM job_steps WHERE job_id = ? ORDER BY step_index ASC',
            [$jobId]
        );
        $row['logs'] = self::logs($jobId);
        if (!empty($row['result_ref'])) {
            $row['result'] = self::loadArtifact($jobId);
        }
        return $row;
    }

    public static function all(array $filters = []): array
    {
        $query = 'SELECT id, workspace_id, user_id, title, provider_id, model_id, status, progress,
                         step_count, max_steps, retry_count, error, created_at, updated_at,
                         started_at, finished_at
                  FROM jobs WHERE 1=1';
        $params = [];
        if (!empty($filters['status'])) {
            $query .= ' AND status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['provider'])) {
            $query .= ' AND provider_id = ?';
            $params[] = $filters['provider'];
        }
        if (!empty($filters['model'])) {
            $query .= ' AND model_id = ?';
            $params[] = $filters['model'];
        }
        $query .= ' ORDER BY created_at DESC LIMIT ?';
        $params[] = (int) ($filters['limit'] ?? 50);
        return Database::all($query, $params);
    }

    public static function cancel(string $jobId): bool
    {
        self::setControlFlag($jobId, 'cancel');
        Database::run("UPDATE jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [$jobId]);
        self::log($jobId, 'WARNING', 'Job cancelled by user.');
        return true;
    }

    public static function pause(string $jobId): bool
    {
        self::setControlFlag($jobId, 'pause');
        Database::run("UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?", [$jobId]);
        self::log($jobId, 'INFO', 'Job paused.');
        return true;
    }

    public static function resume(string $jobId): bool
    {
        self::clearControlFlag($jobId);
        Database::run("UPDATE jobs SET status = 'queued', updated_at = datetime('now') WHERE id = ?", [$jobId]);
        self::log($jobId, 'INFO', 'Job resumed and re-queued.');
        self::autospawn($jobId);
        return true;
    }

    public static function retry(string $jobId): bool
    {
        self::clearControlFlag($jobId);
        Database::run("UPDATE jobs SET status = 'queued', error = '', updated_at = datetime('now') WHERE id = ?", [$jobId]);
        self::log($jobId, 'INFO', 'Job manually re-queued for retry.');
        self::autospawn($jobId);
        return true;
    }

    public static function deleteOld(int $days = 7): int
    {
        $stmt = Database::run("DELETE FROM jobs WHERE created_at < datetime('now', '-' || ? || ' days')", [$days]);
        return $stmt->rowCount();
    }

    /* ---------------------------------------------------- execution */

    /** Port of `recover_orphaned_jobs`. */
    public static function recoverOrphaned(): int
    {
        $rows = Database::all("SELECT id, retry_count, max_retries FROM jobs WHERE status = 'running'");
        foreach ($rows as $r) {
            if ((int) ($r['retry_count'] ?? 0) < (int) ($r['max_retries'] ?? 3)) {
                Database::run(
                    "UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?",
                    [$r['id']]
                );
                self::log((string) $r['id'], 'WARNING', 'Recovered job from worker restart: re-queued for execution.');
            } else {
                Database::run(
                    "UPDATE jobs SET status = 'failed',
                     error = 'Worker restarted while job was in progress (max retries reached)',
                     updated_at = datetime('now') WHERE id = ?",
                    [$r['id']]
                );
                self::log((string) $r['id'], 'ERROR', 'Job marked failed due to worker restart.');
            }
        }
        return count($rows);
    }

    /** Atomically move a queued job to running. Returns false when someone beat us to it. */
    public static function claim(string $jobId): bool
    {
        $stmt = Database::run(
            "UPDATE jobs SET status = 'running', started_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ? AND status = 'queued'",
            [$jobId]
        );
        return $stmt->rowCount() > 0;
    }

    /** Port of `execute_job_task`. */
    public static function execute(string $jobId, bool $alreadyClaimed = false): void
    {
        if (!$alreadyClaimed && !self::claim($jobId)) {
            return;
        }
        self::log($jobId, 'INFO', 'Starting job task execution...');

        $job = self::details($jobId);
        if ($job === null) {
            return;
        }

        $payload = $job['payload'] ?? [];

        // Non-LLM job kinds run their own pipeline (local model installs, …).
        $kind = (string) ($payload['kind'] ?? 'chat');
        if ($kind === 'localai_install') {
            LocalAI::runInstallJob($jobId, $payload);
            self::clearControlFlag($jobId);
            return;
        }

        $messages = $payload['messages'] ?? [['role' => 'user', 'content' => (string) ($payload['message'] ?? $job['title'] ?? '')]];
        $timeoutSec = (int) ($job['max_timeout_sec'] ?? self::DEFAULT_TIMEOUT_SEC);
        $started = microtime(true);

        // Wall-clock guard: PHP CLI has no time limit by default, so arm one.
        if (PHP_SAPI === 'cli') {
            @set_time_limit($timeoutSec + 30);
        }

        try {
            $store = ProviderStore::reload();
            $result = Chat::completeChat($store, [
                'providerId' => (string) $job['provider_id'],
                'modelId' => (string) $job['model_id'],
                'messages' => $messages,
                'maxSteps' => (int) ($job['max_steps'] ?? self::DEFAULT_MAX_STEPS),
                'userId' => (string) ($job['user_id'] ?? 'user'),
                'conversationId' => ($job['conversation_id'] ?? '') ?: null,
            ]);

            if (self::controlFlag($jobId) === 'cancel') {
                Database::run(
                    "UPDATE jobs SET status = 'cancelled', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                    [$jobId]
                );
                return;
            }

            foreach (array_values($result['stepHistory'] ?? []) as $i => $step) {
                self::recordStep(
                    $jobId,
                    (int) ($step['step'] ?? $i),
                    (string) ($step['tool'] ?? ''),
                    (array) ($step['args'] ?? []),
                    $step['result'] ?? null,
                    (string) ($step['status'] ?? 'success'),
                    (float) ($step['durationMs'] ?? 0)
                );
            }

            $artifactRef = self::saveArtifact($jobId, $result);
            $summary = mb_substr((string) ($result['message']['content'] ?? ''), 0, 300);

            Database::run(
                "UPDATE jobs SET status = 'done', progress = 100.0, step_count = ?, result_ref = ?,
                 summary = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                [(int) ($result['steps'] ?? 1), $artifactRef, $summary, $jobId]
            );
            self::log($jobId, 'INFO', 'Job completed successfully in ' . (int) round(microtime(true) - $started) . 's.');
        } catch (\Throwable $e) {
            $errStr = $e->getMessage();
            $isTimeout = str_contains(strtolower($errStr), 'timed out') || str_contains($errStr, '__job_timeout__');
            Database::run(
                "UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                [$errStr, $jobId]
            );
            self::log($jobId, 'ERROR', $isTimeout
                ? "Job exceeded max execution time ({$timeoutSec}s)."
                : "Job failed with error: {$errStr}");
        } finally {
            self::clearControlFlag($jobId);
        }
    }

    /**
     * One supervision tick — replaces `persistent_worker_loop`'s body.
     * Recovers orphans, then drains up to MAX_CONCURRENT_JOBS queued jobs.
     *
     * @return array{recovered:int, started:string[]}
     */
    public static function drain(bool $recover = true): array
    {
        $recovered = $recover ? self::recoverOrphaned() : 0;
        $maxConcurrent = Config::maxConcurrentJobs();
        $rows = Database::all("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?", [$maxConcurrent]);

        $started = [];
        foreach ($rows as $r) {
            $jid = (string) $r['id'];
            if (!self::claim($jid)) {
                continue;
            }
            $started[] = $jid;
            self::execute($jid, true);
        }

        if ($recovered > 0 || $started) {
            Observability::log('INFO', 'WORKER', 'Job queue drained', ['recovered' => $recovered, 'started' => $started]);
        }
        return ['recovered' => $recovered, 'started' => $started];
    }

    public static function stats(): array
    {
        $rows = Database::all('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status');
        $counts = [];
        foreach ($rows as $r) {
            $counts[(string) $r['status']] = (int) $r['n'];
        }
        return [
            'total' => array_sum($counts),
            'byStatus' => $counts,
            'queued' => $counts['queued'] ?? 0,
            'running' => $counts['running'] ?? 0,
            'done' => $counts['done'] ?? 0,
            'failed' => $counts['failed'] ?? 0,
            'workerRunning' => self::daemonRunning(),
            'maxConcurrent' => Config::maxConcurrentJobs(),
        ];
    }
}
