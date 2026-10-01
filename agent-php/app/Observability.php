<?php
/**
 * Structured logging, provider metrics and system metrics.
 * Port of agent-python/app/observability.py.
 *
 * Back on a real host the "disk" card can report genuine statvfs numbers again
 * (the Workers build had to substitute R2 usage against a fake 1 GiB budget).
 */

declare(strict_types=1);

namespace Arena;

final class Observability
{
    private static int $sinceTrim = 0;
    private static float $started = 0.0;

    public static function boot(): void
    {
        if (self::$started === 0.0) {
            self::$started = microtime(true);
        }
    }

    public static function log(string $level, string $category, string $message, array $meta = []): void
    {
        try {
            Database::run(
                'INSERT INTO app_logs (level, category, message, meta) VALUES (?,?,?,?)',
                [
                    strtoupper($level ?: 'INFO'),
                    $category,
                    Security::maskLogTokens($message),
                    json_encode($meta, JSON_UNESCAPED_UNICODE) ?: '{}',
                ]
            );
            if (++self::$sinceTrim >= 100) {
                self::$sinceTrim = 0;
                Database::run('DELETE FROM app_logs WHERE id <= (SELECT MAX(id) - 2000 FROM app_logs)');
            }
        } catch (\Throwable) {
            // logging must never break a request
        }
    }

    public static function logs(?string $level = null, ?string $search = null, int $limit = 100): array
    {
        $sql = 'SELECT id, timestamp, level, category, message, meta FROM app_logs WHERE 1=1';
        $params = [];
        if ($level !== null && $level !== '') {
            $sql .= ' AND level = ?';
            $params[] = strtoupper($level);
        }
        if ($search !== null && $search !== '') {
            $sql .= ' AND (lower(message) LIKE ? OR lower(category) LIKE ?)';
            $t = '%' . strtolower($search) . '%';
            $params[] = $t;
            $params[] = $t;
        }
        $sql .= ' ORDER BY id DESC LIMIT ?';
        $params[] = max(1, min($limit, 1000));

        try {
            $rows = Database::all($sql, $params);
        } catch (\Throwable) {
            return [];
        }
        return array_map(static function (array $r): array {
            $meta = json_decode((string) ($r['meta'] ?? '{}'), true);
            return [
                'id' => (int) $r['id'],
                'timestamp' => $r['timestamp'],
                'level' => $r['level'],
                'category' => $r['category'],
                'module' => $r['category'],
                'message' => $r['message'],
                'details' => $r['meta'],
                'meta' => is_array($meta) ? $meta : [],
            ];
        }, $rows);
    }

    /** Port of observability.get_system_metrics — with real host numbers. */
    public static function systemMetrics(string $activeWorkspaceId): array
    {
        $active = (int) Database::scalar("SELECT COUNT(*) FROM jobs WHERE status IN ('running','queued')");
        $completed = (int) Database::scalar("SELECT COUNT(*) FROM jobs WHERE status = 'done'");
        $failed = (int) Database::scalar("SELECT COUNT(*) FROM jobs WHERE status = 'failed'");

        $ws = Workspaces::find($activeWorkspaceId) ?? Workspaces::fallback();
        $root = Workspaces::ensureRoot($ws);
        $size = Files::dirSize($root);

        $total = (float) (@disk_total_space($root) ?: 0);
        $free = (float) (@disk_free_space($root) ?: 0);
        $used = $total - $free;

        $caps = Bootstrap::capabilities();
        $load = function_exists('sys_getloadavg') ? (sys_getloadavg() ?: [0, 0, 0]) : [0, 0, 0];

        return [
            'activeJobs' => $active,
            'completedJobs' => $completed,
            'failedJobs' => $failed,
            'disk' => [
                'totalBytes' => (int) $total,
                'freeBytes' => (int) $free,
                'usedBytes' => (int) $used,
                'usedPercent' => $total > 0 ? round($used / $total * 1000) / 10 : 0,
                'backend' => 'local-filesystem',
                'note' => 'Real filesystem usage of the partition hosting the workspaces.',
            ],
            'storage' => [
                'fileCount' => $size['files'],
                'totalSizeBytes' => $size['bytes'],
                'totalSizeMB' => round($size['bytes'] / 1048576, 2),
                'root' => $root,
            ],
            'memory' => [
                'usageBytes' => memory_get_usage(true),
                'peakBytes' => memory_get_peak_usage(true),
                'limit' => ini_get('memory_limit'),
            ],
            'loadAverage' => ['1m' => $load[0] ?? 0, '5m' => $load[1] ?? 0, '15m' => $load[2] ?? 0],
            'runtime' => 'php-' . PHP_VERSION,
            'pythonVersion' => $caps['python'] ? Terminal::probeVersion((string) $caps['python'], '--version') : null,
            'nodeVersion' => $caps['node'] ? Terminal::probeVersion((string) $caps['node'], '--version') : null,
            'gitVersion' => $caps['git'] ? Terminal::probeVersion((string) $caps['git'], '--version') : null,
            'workerdVersion' => APP_VERSION,
            'databaseBytes' => is_file(Database::path()) ? (int) filesize(Database::path()) : 0,
            'uptimeSeconds' => (int) round(microtime(true) - (self::$started ?: microtime(true))),
        ];
    }

    public static function exportCsv(array $logs): string
    {
        $esc = static fn($v): string => '"' . str_replace('"', '""', (string) ($v ?? '')) . '"';
        $lines = [implode(',', ['ID', 'Timestamp', 'Level', 'Module', 'Message', 'Details'])];
        foreach ($logs as $l) {
            $lines[] = implode(',', array_map($esc, [
                $l['id'] ?? '',
                $l['timestamp'] ?? '',
                $l['level'] ?? '',
                $l['module'] ?? '',
                $l['message'] ?? '',
                $l['details'] ?? '',
            ]));
        }
        return implode("\n", $lines);
    }

    // ------------------------------------------------------ provider stats

    public static function recordProviderCall(
        string $providerId,
        string $modelId,
        bool $ok,
        float $latencyMs,
        int $tokens = 0
    ): void {
        try {
            Database::run(
                "INSERT INTO provider_metrics
                    (provider_id, model_id, request_count, error_count, total_tokens, total_latency_ms, last_latency_ms, last_status, updated_at)
                 VALUES (?,?,1,?,?,?,?,?,datetime('now'))
                 ON CONFLICT(provider_id, model_id) DO UPDATE SET
                    request_count = request_count + 1,
                    error_count = error_count + ?,
                    total_tokens = total_tokens + ?,
                    total_latency_ms = total_latency_ms + ?,
                    last_latency_ms = ?,
                    last_status = ?,
                    updated_at = datetime('now')",
                [
                    $providerId, $modelId, $ok ? 0 : 1, $tokens, $latencyMs, $latencyMs, $ok ? 'ok' : 'error',
                    $ok ? 0 : 1, $tokens, $latencyMs, $latencyMs, $ok ? 'ok' : 'error',
                ]
            );
        } catch (\Throwable) {
            // metrics are best effort
        }
    }

    public static function providerMetrics(): array
    {
        $rows = Database::all('SELECT * FROM provider_metrics ORDER BY request_count DESC');
        return array_map(static function (array $r): array {
            $count = max(1, (int) $r['request_count']);
            return [
                'providerId' => $r['provider_id'],
                'modelId' => $r['model_id'],
                'requestCount' => (int) $r['request_count'],
                'errorCount' => (int) $r['error_count'],
                'totalTokens' => (int) $r['total_tokens'],
                'avgLatencyMs' => round(((float) $r['total_latency_ms']) / $count, 1),
                'lastLatencyMs' => round((float) $r['last_latency_ms'], 1),
                'lastStatus' => $r['last_status'],
                'circuitBreakerTripped' => (int) $r['circuit_breaker_tripped'] === 1,
                'updatedAt' => $r['updated_at'],
            ];
        }, $rows);
    }
}
