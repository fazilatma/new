<?php
/**
 * php-daemon.php — run a one-shot PHP script as a continuous worker.
 * Part of WebConsole Pro. Requires PHP 7.0+. No extensions, no Composer.
 *
 *   php php-daemon.php --script=scraper4.php --args=cron_run
 *
 * WHY THIS EXISTS
 * ---------------
 * A PHP script written for the web SAPI is interrupted by things that have
 * nothing to do with PHP: LiteSpeed/FPM request timeouts, proxy read timeouts,
 * the browser going away. Authors work around that with ignore_user_abort(),
 * set_time_limit(0), finish-request tricks, a lock file and checkpoint/resume
 * logic — an entire machinery whose only job is to survive being cut off.
 *
 * None of it is needed in the CLI SAPI, where max_execution_time defaults to 0
 * and nothing terminates the process. PHP is as capable of running for weeks as
 * Node or Python; it is the web server in front of it that was never designed
 * for that.
 *
 * So this is a supervisor: one long-lived process that runs the work script
 * back to back, with no 60-second cron granularity and no lock contention,
 * because only one worker ever exists.
 *
 * WHY A CHILD PROCESS PER CYCLE, RATHER THAN A while(true) INSIDE THE SCRIPT
 * -------------------------------------------------------------------------
 * A script written as a one-shot run accumulates global state, static caches
 * and cyclic references. Looping inside it grows the heap until the host's
 * memory limit kills the process. A fresh child per cycle starts from a clean
 * heap every time, which is the same reason Laravel's queue:work recycles its
 * workers. Startup is a few milliseconds; a memory leak is an outage.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not stop the host from killing the process. Nothing running inside
 * a shared-hosting account can. Pair it with the console's cron watchdog,
 * which restarts it from outside the account's process tree.
 */

declare(ticks=1);

// ---------------------------------------------------------------- options ---

$OPT = [
    'script'        => '',     // required: the PHP script to run each cycle
    'args'          => '',     // arguments passed to it, space separated
    'php'           => '',     // interpreter; defaults to the running one
    'dir'           => '',     // working directory; defaults to the script's
    'idle-min'      => 2,      // seconds to wait after a cycle that found work
    'idle-max'      => 30,     // ceiling for the idle backoff
    'cycle-timeout' => 3600,   // kill a cycle that runs longer than this
    'max-fails'     => 0,      // give up after N consecutive failures (0 = never)
    'idle-marker'   => '',     // substring in the output meaning "nothing to do"
    'heartbeat'     => '.daemon-heartbeat.json',
    'stop-file'     => '.daemon.stop',
    'quiet'         => false,  // suppress the child's own output
    'once'          => false,  // run a single cycle and exit (for testing)
];

foreach (array_slice($argv, 1) as $a) {
    if (!preg_match('/^--([a-z-]+)(?:=(.*))?$/s', $a, $m)) {
        fwrite(STDERR, "Unrecognised argument: {$a}\n");
        exit(2);
    }
    $k = $m[1];
    if (!array_key_exists($k, $OPT)) {
        fwrite(STDERR, "Unknown option: --{$k}\n");
        exit(2);
    }
    $OPT[$k] = isset($m[2]) ? $m[2] : true;
}

if ($OPT['script'] === '') {
    fwrite(STDERR, "Usage: php php-daemon.php --script=<file.php> [--args=...] [--idle-min=2] [--idle-max=30]\n");
    exit(2);
}

$script = $OPT['script'];
if ($script[0] !== '/') $script = getcwd() . '/' . $script;
if (!is_file($script)) {
    fwrite(STDERR, "Script not found: {$script}\n");
    exit(2);
}

$workDir = $OPT['dir'] !== '' ? $OPT['dir'] : dirname($script);
$php     = $OPT['php'] !== '' ? $OPT['php'] : (defined('PHP_BINARY') && PHP_BINARY !== '' ? PHP_BINARY : 'php');
$idleMin = max(0, (int)$OPT['idle-min']);
$idleMax = max($idleMin, (int)$OPT['idle-max']);
$cycleTo = max(0, (int)$OPT['cycle-timeout']);
$maxFail = max(0, (int)$OPT['max-fails']);
$quiet   = (bool)$OPT['quiet'];

$hbFile   = $OPT['heartbeat'] !== '' ? rtrim($workDir, '/') . '/' . $OPT['heartbeat'] : '';
$stopFile = $OPT['stop-file'] !== '' ? rtrim($workDir, '/') . '/' . $OPT['stop-file'] : '';

// ---------------------------------------------------------------- helpers ---

function dlog($msg)
{
    $line = '[' . date('Y-m-d H:i:s') . '] [daemon] ' . $msg . "\n";
    fwrite(STDOUT, $line);
    flush();
}

/** Ask the loop to finish the current cycle and exit. */
$GLOBALS['WANT_STOP'] = false;
function requestStop($why)
{
    if ($GLOBALS['WANT_STOP']) return;
    $GLOBALS['WANT_STOP'] = true;
    dlog("Stop requested ({$why}). Finishing the current cycle first.");
}

// pcntl is absent on plenty of shared hosts, so signals are a bonus, not a
// dependency; the stop-file below works everywhere.
$hasPcntl = function_exists('pcntl_signal') && function_exists('pcntl_signal_dispatch');
if ($hasPcntl) {
    foreach ([SIGTERM, SIGINT, SIGHUP] as $sig) {
        @pcntl_signal($sig, function ($s) { requestStop('signal ' . $s); });
    }
}

function pumpSignals($hasPcntl)
{
    if ($hasPcntl) @pcntl_signal_dispatch();
}

/**
 * Run one cycle. Streams the child's output as it arrives rather than
 * buffering it, so a long scrape shows progress in the console log instead of
 * appearing to hang.
 *
 * @return array{code:int,output:string,seconds:float,timedout:bool}
 */
function runCycle($php, $script, $argStr, $workDir, $timeout, $quiet, $hasPcntl)
{
    // The `exec` prefix matters. proc_open() runs the command through a shell,
    // so without it proc_terminate() signals the shell and the PHP child is
    // orphaned and keeps running. `exec` makes the shell replace itself with
    // PHP, so the pid proc_open() reports is the pid that receives the signal.
    $cmd = 'exec ' . escapeshellarg($php) . ' ' . escapeshellarg($script);
    if ($argStr !== '') $cmd .= ' ' . $argStr;

    $spec = [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $pipes = [];
    $started = microtime(true);
    $proc = @proc_open($cmd, $spec, $pipes, $workDir, null);
    if (!is_resource($proc)) {
        return ['code' => 127, 'output' => 'proc_open failed', 'seconds' => 0.0, 'timedout' => false];
    }
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);

    $out = '';
    $timedout = false;
    while (true) {
        pumpSignals($hasPcntl);

        $read = [];
        foreach ([1, 2] as $i) if (is_resource($pipes[$i])) $read[] = $pipes[$i];
        if (!empty($read)) {
            $w = null; $e = null;
            // Short select so the timeout and stop-file stay responsive.
            if (@stream_select($read, $w, $e, 1) > 0) {
                foreach ($read as $r) {
                    $chunk = fread($r, 8192);
                    if ($chunk === '' || $chunk === false) continue;
                    $out .= $chunk;
                    if (!$quiet) { fwrite(STDOUT, $chunk); flush(); }
                }
            }
        }

        $st = proc_get_status($proc);
        if (!$st['running']) {
            // Drain whatever is still buffered in the pipes.
            foreach ([1, 2] as $i) {
                if (!is_resource($pipes[$i])) continue;
                while (($chunk = fread($pipes[$i], 8192)) !== '' && $chunk !== false) {
                    $out .= $chunk;
                    if (!$quiet) { fwrite(STDOUT, $chunk); flush(); }
                }
            }
            break;
        }

        if ($timeout > 0 && (microtime(true) - $started) > $timeout) {
            $timedout = true;
            dlog("Cycle exceeded {$timeout}s. Terminating it.");
            @proc_terminate($proc, defined('SIGTERM') ? SIGTERM : 15);
            $grace = microtime(true);
            while (microtime(true) - $grace < 10) {
                $s2 = proc_get_status($proc);
                if (!$s2['running']) break;
                usleep(200000);
            }
            $s2 = proc_get_status($proc);
            if ($s2['running']) @proc_terminate($proc, defined('SIGKILL') ? SIGKILL : 9);
            break;
        }

        if ($GLOBALS['WANT_STOP'] && $timeout === 0) {
            // Nothing to do: a stop was requested but we still let the cycle
            // finish, which is the whole point of a graceful stop.
        }
    }

    foreach ([1, 2] as $i) if (is_resource($pipes[$i])) @fclose($pipes[$i]);
    $st = proc_get_status($proc);
    $code = $st['running'] ? 0 : (int)$st['exitcode'];
    @proc_close($proc);

    return [
        'code'     => $timedout ? 124 : $code,
        'output'   => $out,
        'seconds'  => microtime(true) - $started,
        'timedout' => $timedout,
    ];
}

// ------------------------------------------------------------------- loop ---

if ($stopFile !== '' && is_file($stopFile)) {
    @unlink($stopFile);
    dlog('Cleared a stale stop-file left by a previous run.');
}

dlog('Worker starting.');
dlog('  interpreter : ' . $php . ' (' . PHP_VERSION . ', SAPI ' . PHP_SAPI . ')');
dlog('  script      : ' . $script);
dlog('  directory   : ' . $workDir);
dlog('  time limit  : ' . (ini_get('max_execution_time') === '0' ? 'none (CLI)' : ini_get('max_execution_time') . 's'));
dlog('  signals     : ' . ($hasPcntl ? 'pcntl available' : 'no pcntl — use the stop-file'));
if ($stopFile !== '') dlog('  stop with   : touch ' . $stopFile);

$cycle = 0;
$fails = 0;
$idle  = $idleMin;
$startedAt = time();

while (true) {
    pumpSignals($hasPcntl);

    if ($stopFile !== '' && is_file($stopFile)) {
        @unlink($stopFile);
        requestStop('stop-file');
    }
    if ($GLOBALS['WANT_STOP']) {
        dlog('Stopping after ' . $cycle . ' cycle(s).');
        break;
    }

    $cycle++;
    $r = runCycle($php, $script, (string)$OPT['args'], $workDir, $cycleTo, $quiet, $hasPcntl);

    // Did this cycle actually do anything? The idle marker lets the worker
    // spin down to a slow poll when the queue is empty, instead of hammering
    // the script — and speed straight back up when work appears.
    $didWork = true;
    $marker = (string)$OPT['idle-marker'];
    if ($marker !== '' && strpos($r['output'], $marker) !== false) $didWork = false;

    if ($r['code'] === 0) {
        $fails = 0;
        $idle = $didWork ? $idleMin : min($idleMax, max(1, $idle * 2));
    } else {
        $fails++;
        $idle = min($idleMax, max(1, $idle * 2));
        dlog('Cycle ' . $cycle . ' exited with code ' . $r['code'] . ' (failure ' . $fails . ').');
        if ($maxFail > 0 && $fails >= $maxFail) {
            dlog('Reached --max-fails=' . $maxFail . '. Exiting so the supervisor can decide.');
            break;
        }
    }

    if ($hbFile !== '') {
        @file_put_contents($hbFile, json_encode([
            'pid'            => getmypid(),
            'time'           => time(),
            'iso'            => date('c'),
            'cycle'          => $cycle,
            'uptime_seconds' => time() - $startedAt,
            'last_exit_code' => $r['code'],
            'last_seconds'   => round($r['seconds'], 2),
            'last_did_work'  => $didWork,
            'consecutive_failures' => $fails,
            'memory_mb'      => round(memory_get_usage(true) / 1048576, 1),
            'next_sleep'     => $idle,
        ], JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    $verdict = $r['timedout'] ? 'timed out' : ($r['code'] !== 0 ? 'failed' : ($didWork ? 'work done' : 'idle'));
    dlog(sprintf('Cycle %d finished in %.1fs (exit %d, %s). Sleeping %ds.',
        $cycle, $r['seconds'], $r['code'], $verdict, $idle));

    if (!empty($OPT['once'])) { dlog('--once given; exiting.'); break; }

    // Sleep in short slices so a stop request is noticed promptly.
    $deadline = microtime(true) + $idle;
    while (microtime(true) < $deadline) {
        pumpSignals($hasPcntl);
        if ($GLOBALS['WANT_STOP']) break;
        if ($stopFile !== '' && is_file($stopFile)) { @unlink($stopFile); requestStop('stop-file'); break; }
        usleep(200000);
    }
}

if ($hbFile !== '') @unlink($hbFile);
dlog('Worker stopped cleanly.');
exit(0);
