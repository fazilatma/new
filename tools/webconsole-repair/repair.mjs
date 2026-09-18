// WebConsole Pro 1.1.0 -> 1.1.1 launcher repair. Never executes the input.
export function repairWebConsole(input) {
  let source = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!source.trimStart().startsWith('<?php')) throw new Error('Choose the PHP source file, not an HTML page or Markdown code block.');
  if (source.includes('function wcp_php_cli(): string')) throw new Error('This file already contains the launcher repair. Keep the existing repaired file.');
  const changes = [];
  function once(before, after, label) {
    if (source.split(before).length !== 2) throw new Error('Unexpected source version: '+label+'. No output was generated.');
    source = source.replace(before, () => after); changes.push(label);
  }
  function section(start, end, replacement, label) {
    if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Unexpected source version: '+label);
    const a=source.indexOf(start), b=source.indexOf(end,a);
    if(b<=a)throw new Error('Unexpected section order: '+label);
    source=source.slice(0,a)+replacement+'\n'+source.slice(b); changes.push(label);
  }
  once("define('WCP_VERSION', '1.1.0');", "define('WCP_VERSION', '1.1.1');", 'WebConsole version 1.1.1');
  once('function wcp_init_data_dir(): string {', String.raw`function wcp_init_data_dir(): string {
    // A child must use the SAME directory selected by its web parent.
    if (PHP_SAPI === 'cli') {
        foreach (($_SERVER['argv'] ?? []) as $argument) {
            if (strpos($argument, '--wcp-data-dir=') !== 0) continue;
            $directory = base64_decode(substr($argument, 15), true);
            if ($directory === false || $directory === '' || $directory[0] !== '/' || !is_dir($directory) || !is_writable($directory)) {
                throw new RuntimeException('The inherited WebConsole data directory is invalid or not writable.');
            }
            return $directory;
        }
    }`, 'Share the selected data directory with PHP CLI');

  section('function job_start(array &$job) {', 'function job_pid_alive(int $pid): bool', String.raw`function wcp_php_cli(): string {
    if (!function_exists('exec')) throw new RuntimeException('PHP exec() is disabled; background jobs cannot launch.');
    $override = defined('WCP_PHP_CLI') ? trim((string)WCP_PHP_CLI) : trim((string)getenv('WCP_PHP_CLI'));
    $candidates = $override !== '' ? [$override] : array_merge(
        [PHP_SAPI === 'cli' ? PHP_BINARY : '', '/usr/bin/php', '/usr/local/bin/php', PHP_BINDIR . '/php', trim(sh_ok('command -v php'))],
        glob('/usr/bin/php[0-9]*') ?: []
    );
    foreach (array_unique($candidates) as $candidate) {
        if ($candidate === '' || $candidate[0] !== '/' || !is_file($candidate) || !is_executable($candidate)) continue;
        // Do not accidentally start php-fpm or apache as a server.
        if ($override === '' && !preg_match('/^php(?:[0-9.]+|-cli)?$/', basename($candidate))) continue;
        $probe = 'if (PHP_SAPI === "cli" && function_exists("exec") && function_exists("proc_open")) { echo "WCP_CLI_OK"; } else { exit(78); }';
        $result = sh(esc($candidate) . ' -r ' . esc($probe), $rc);
        if ($rc === 0 && trim($result) === 'WCP_CLI_OK') return $candidate;
    }
    throw new RuntimeException('No usable PHP CLI with exec/proc_open was found. Install php-cli, or configure an absolute WCP_PHP_CLI path. PHP-FPM/CGI is not PHP CLI.');
}
function wcp_job_alive(array $job): bool {
    $pid = (int)($job['pid'] ?? 0);
    if (!job_pid_alive($pid)) return false;
    $args = explode("\0", (string)@file_get_contents('/proc/' . $pid . '/cmdline'));
    return in_array('--bgjob=' . $job['id'], $args, true)
        && in_array($job['script'] ?? __FILE__, $args, true);
}
function job_start(array &$job) {
    $id = $job['id'];
    $receipt = JOBS_DIR . '/' . $id . '.started.json';
    $exitFile = JOBS_DIR . '/' . $id . '.exit';
    try {
        if (!is_writable(JOBS_DIR) || !is_readable(__FILE__)) throw new RuntimeException('Job directory is not writable or the PHP source is not readable.');
        $php = wcp_php_cli();
        $setsid = trim(sh_ok('command -v setsid'));
        if ($setsid === '' || $setsid[0] !== '/' || !is_executable($setsid)) throw new RuntimeException('setsid is missing. Install util-linux.');
        if (@file_put_contents($job['log'], "[launcher] PHP CLI: " . $php . "\n", FILE_APPEND | LOCK_EX) === false) throw new RuntimeException('Cannot write the job log.');
        @unlink($receipt);
        @unlink($exitFile);
        @unlink(JOBS_DIR . '/' . $id . '.pid');
        $job['pid'] = 0;
        $job['script'] = __FILE__;
        $job['launch_token'] = wcp_random(16);
        $job['launch_deadline'] = time() + 10;
        job_save($job);
        $cmd = 'cd ' . esc(DATA_DIR) . ' && ( ' . esc($setsid) . ' ' . esc($php)
            . ' -d register_argc_argv=1 ' . esc(__FILE__)
            . ' ' . esc('--bgjob=' . $id)
            . ' ' . esc('--wcp-data-dir=' . base64_encode(DATA_DIR))
            . ' >> ' . esc($job['log']) . ' 2>&1 < /dev/null & )';
        $output = sh($cmd, $rc);
        if ($rc !== 0) throw new RuntimeException('Background launcher failed: ' . mask_url($output));
        $deadline = microtime(true) + 5;
        do {
            clearstatcache(true, $receipt);
            $ack = json_decode((string)@file_get_contents($receipt), true);
            if (is_array($ack) && hash_equals($job['launch_token'], (string)($ack['token'] ?? '')) && (int)($ack['pid'] ?? 0) > 1) {
                $job['pid'] = (int)$ack['pid'];
                job_save($job);
                act_log('Started ' . $job['type'] . ': ' . $job['name'] . ' (job ' . $id . ', PID ' . $job['pid'] . ')');
                return;
            }
            usleep(100000);
        } while (microtime(true) < $deadline);
        throw new RuntimeException('PHP CLI did not acknowledge startup within 5 seconds. Read the job log for permissions, PHP configuration or bootstrap errors.');
    } catch (Throwable $e) {
        $message = $e->getMessage();
        $job['result'] = ['error' => $message];
        @file_put_contents($job['log'], "[launcher ERROR] " . $message . "\n", FILE_APPEND | LOCK_EX);
        @file_put_contents($exitFile, "127\n", LOCK_EX);
        job_save($job);
        throw new RuntimeException('Job ' . $id . ': ' . $message, 0, $e);
    }
}`, 'Validate PHP CLI and require a child startup acknowledgement');

  once("function job_pid_alive(int $pid): bool { return $pid > 0 && @file_exists('/proc/' . $pid); }", String.raw`function job_pid_alive(int $pid): bool {
    if ($pid <= 1) return false;
    $stat = (string)@file_get_contents('/proc/' . $pid . '/stat');
    $end = strrpos($stat, ')');
    if ($end === false) return false;
    $state = substr($stat, $end + 2, 1);
    return $state !== 'Z' && $state !== 'X';
}`, 'Exclude zombie processes from running status');
  once("if (job_pid_alive((int)$job['pid'])) return ['status' => 'running', 'exit' => null];", "if (wcp_job_alive($job)) return ['status' => 'running', 'exit' => null];", 'Validate process identity before reporting running');
  once("$pid = (int)$job['pid'];\n    if ($pid > 0) {", "$pid = (int)$job['pid'];\n    if (wcp_job_alive($job)) {", 'Guard intentional stops against reused PIDs');

  once("        if (!$job) exit(1);", String.raw`        if (!$job) { fwrite(STDERR, "Background job metadata not found in " . JOBS_DIR . "\n"); exit(1); }
        if (!empty($job['launch_token'])) {
            if (is_file(JOBS_DIR . '/' . $id . '.exit') || time() > (int)$job['launch_deadline']) {
                fwrite(STDERR, "Background launch was cancelled or expired.\n"); exit(127);
            }
            $ack = ['token' => $job['launch_token'], 'pid' => getmypid()];
            if (file_put_contents(JOBS_DIR . '/' . $id . '.started.json', json_encode($ack), LOCK_EX) === false) {
                fwrite(STDERR, "Cannot write background startup acknowledgement.\n"); exit(127);
            }
            file_put_contents(JOBS_DIR . '/' . $id . '.pid', getmypid() . "\n", LOCK_EX);
        }`, 'Record the real PHP worker PID rather than the intermediate shell PID');

  once("if (!empty($in['api'])) { handle_api(); exit; }", String.raw`if (!empty($in['api'])) {
    try { handle_api(); }
    catch (Throwable $e) { jout(false, null, mask_url($e->getMessage()), 500); }
    exit;
}`, 'Return actionable JSON errors rather than blank API responses');
  once("'offset' => $size, 'status' => job_status($job)", "'offset' => $off + strlen($data), 'has_more' => ($off + strlen($data) < $size), 'status' => job_status($job)", 'Avoid skipping log chunks');
  once("{onclose:()=>{clearInterval(timer)}}", "{onclose:()=>{alive=false;clearInterval(timer)}}", 'Stop polling after the log viewer closes');
  once("if(s.status==='running'){sh.querySelector('#jstop').classList.remove('hide')}else{", "if(s.status==='running'||d.has_more){sh.querySelector('#jstop').classList.toggle('hide',s.status!=='running')}else{alive=false;", 'Drain remaining logs after the worker exits');
  once('  await poll();timer=setInterval(poll,1000);', '  await poll();if(alive)timer=setInterval(poll,1000);', 'Do not restart polling for an already completed job');
  // A nearby existing typo otherwise crashes terminal-list cleanup.
  once('                term_close($id);', '                term_kill($id);', 'Fix the undefined terminal cleanup function');
  return {source, changes};
}
