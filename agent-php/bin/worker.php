#!/usr/bin/env php
<?php
/**
 * Background job worker daemon — the real equivalent of
 * agent-python/app/worker.py's `persistent_worker_loop`.
 *
 * Usage:
 *   php bin/worker.php                 # run forever (systemd / supervisor / nohup)
 *   php bin/worker.php --once          # drain the queue once and exit (cron)
 *   php bin/worker.php --job <jobId>   # execute exactly one job (autospawned)
 *   php bin/worker.php --interval 2    # poll interval in seconds (default 2)
 */

declare(strict_types=1);

namespace Arena;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("bin/worker.php must be run from the command line.\n");
}

require_once dirname(__DIR__) . '/app/Bootstrap.php';

Bootstrap::init();
Database::init();

$args = $argv ?? [];
$once = in_array('--once', $args, true);
$jobIdIdx = array_search('--job', $args, true);
$jobId = $jobIdIdx !== false ? (string) ($args[$jobIdIdx + 1] ?? '') : '';
$intervalIdx = array_search('--interval', $args, true);
$interval = $intervalIdx !== false ? max(1, (int) ($args[$intervalIdx + 1] ?? 2)) : 2;

$log = static function (string $msg): void {
    fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . '] ' . $msg . PHP_EOL);
};

/* ---------------------------------------------------------- one-shot job */

if ($jobId !== '') {
    $log("Executing single job {$jobId}");
    Jobs::execute($jobId);
    $log("Finished job {$jobId}");
    exit(0);
}

/* ------------------------------------------------------------- drain once */

if ($once) {
    $res = Jobs::drain();
    $log('Drained queue: recovered=' . $res['recovered'] . ' started=' . count($res['started']));
    exit(0);
}

/* ------------------------------------------------------------- daemon loop */

$running = true;
if (function_exists('pcntl_async_signals') && function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    foreach ([SIGTERM, SIGINT] as $sig) {
        pcntl_signal($sig, static function () use (&$running, $log): void {
            $log('Shutdown signal received — finishing current tick.');
            $running = false;
        });
    }
}

$log('Arena job worker started (pid ' . getmypid() . ', interval ' . $interval . 's)');
Observability::log('INFO', 'WORKER', 'Job worker daemon started', ['pid' => getmypid()]);

Jobs::recoverOrphaned();
$tick = 0;

while ($running) {
    try {
        Jobs::heartbeat();
        // Recover orphans every ~60 ticks, drain the queue every tick.
        $res = Jobs::drain($tick % 60 === 0);
        if ($res['started']) {
            $log('Started jobs: ' . implode(', ', $res['started']));
        }
        // Housekeeping: expired sessions once a minute.
        if ($tick % 60 === 0) {
            Security::purgeExpiredSessions();
        }
    } catch (\Throwable $e) {
        $log('Worker tick error: ' . $e->getMessage());
        try {
            Observability::log('ERROR', 'WORKER', 'Worker tick failed: ' . $e->getMessage());
        } catch (\Throwable) {
        }
    }
    $tick++;
    sleep($interval);
}

Observability::log('INFO', 'WORKER', 'Job worker daemon stopped', ['pid' => getmypid()]);
$log('Worker stopped.');
