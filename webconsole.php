<?php
/** WebConsole Pro — standalone VPS console, based on the supplied source.
 * PHP 7.4+. Use HTTPS and a non-root PHP account. Protect .wconsole_data
 * in the web-server configuration (Nginx does not read .htaccess).
 * Jobs are detached, but reboot startup still requires an OS supervisor.
 */
error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED);
ini_set('display_errors', '0');
@set_time_limit(300);
define('WCP_VERSION', '1.6.0');
function wcp_is_dir_writable(string $dir): bool {
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0777, true) && !is_dir($dir)) return false;
    }
    // Android Termux /sdcard / FUSE can return false for is_writable() even when fully writable.
    // Live probe write test guarantees 100% accurate detection across Termux, Android, Linux, NFS, and Docker:
    $probe = rtrim($dir, '/') . '/.wcp_probe_' . mt_rand(10000, 99999) . '.tmp';
    $fp = @fopen($probe, 'wb');
    if ($fp !== false) {
        @fwrite($fp, '1');
        @fclose($fp);
        @unlink($probe);
        return true;
    }
    if (@file_put_contents($probe, '1') !== false) {
        @unlink($probe);
        return true;
    }
    return @is_writable($dir);
}
function wcp_put_contents(string $path, string $content, bool $lock = false, int $flags = 0): bool {
    if (substr($path, -3) === '.sh' || substr($path, -4) === '.env' || substr($path, -5) === '.json' || substr($path, -4) === '.txt') {
        $content = str_replace(["\r\n", "\r"], "\n", $content);
    }
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    // 1. Try standard write without lock first if not explicitly requiring exclusive lock, or try with lock
    if ($lock) {
        $writeFlags = $flags | LOCK_EX;
        $res = @file_put_contents($path, $content, $writeFlags);
        if ($res !== false) {
            @chmod($path, 0666);
            return true;
        }
    }
    // 2. Retry without LOCK_EX (crucial for Android FUSE, Termux storage, sdcardfs, FAT32/exFAT)
    $writeFlags = $flags & ~LOCK_EX;
    $res = @file_put_contents($path, $content, $writeFlags);
    if ($res !== false) {
        @chmod($path, 0666);
        return true;
    }
    // 3. Low-level fopen / fwrite fallback
    $mode = ($flags & FILE_APPEND) ? 'ab' : 'wb';
    $fp = @fopen($path, $mode);
    if ($fp !== false) {
        $written = @fwrite($fp, $content);
        @fflush($fp);
        @fclose($fp);
        if ($written !== false) {
            @chmod($path, 0666);
            return true;
        }
    }
    // 4. Force unlink if stale file exists and retry
    if (is_file($path)) {
        @unlink($path);
        $fp = @fopen($path, $mode);
        if ($fp !== false) {
            $written = @fwrite($fp, $content);
            @fflush($fp);
            @fclose($fp);
            if ($written !== false) {
                @chmod($path, 0666);
                return true;
            }
        }
    }
    return false;
}
function wcp_acquire_lock(string $lockPath, &$lockHandle): bool {
    $dir = dirname($lockPath);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $fp = @fopen($lockPath, 'c+');
    if (!$fp) return false;
    if (@flock($fp, LOCK_EX | LOCK_NB)) {
        $lockHandle = $fp;
        @ftruncate($fp, 0);
        @rewind($fp);
        @fwrite($fp, getmypid() . "\n" . time() . "\n");
        @fflush($fp);
        return true;
    }
    // If flock returns false (common on Android FUSE / sdcard mounts), verify existing PID
    @rewind($fp);
    $content = (string)@fread($fp, 1024);
    $lines = explode("\n", trim($content));
    $existingPid = (int)($lines[0] ?? 0);
    $lockTime = (int)($lines[1] ?? 0);
    $isAlive = ($existingPid > 1) && job_pid_alive($existingPid);
    if (!$isAlive || ($lockTime > 0 && time() - $lockTime > 600)) {
        $lockHandle = $fp;
        @ftruncate($fp, 0);
        @rewind($fp);
        @fwrite($fp, getmypid() . "\n" . time() . "\n");
        @fflush($fp);
        return true;
    }
    @fclose($fp);
    return false;
}
function wcp_release_lock(string $lockPath, &$lockHandle): void {
    if (is_resource($lockHandle)) {
        @flock($lockHandle, LOCK_UN);
        @fclose($lockHandle);
        $lockHandle = null;
    }
    @unlink($lockPath);
}
function wcp_init_data_dir(): string {
    // A child must use the SAME directory selected by its web parent.
    if (PHP_SAPI === 'cli') {
        foreach (($_SERVER['argv'] ?? []) as $argument) {
            if (strpos($argument, '--wcp-data-dir=') !== 0) continue;
            $directory = base64_decode(substr($argument, 15), true);
            if ($directory !== false && $directory !== '' && $directory[0] === '/' && is_dir($directory) && wcp_is_dir_writable($directory)) {
                return $directory;
            }
        }
    }
    // Priority 1: .wconsole_data in same folder as webconsole.php
    $primaryDot = __DIR__ . '/.wconsole_data';
    if (!is_dir($primaryDot)) @mkdir($primaryDot, 0777, true);
    if (is_dir($primaryDot) && wcp_is_dir_writable($primaryDot)) {
        return $primaryDot;
    }
    // Priority 2: wconsole_data (non-dot for Android SDCard where dot-folders may be restricted by media providers)
    $primaryNoDot = __DIR__ . '/wconsole_data';
    if (!is_dir($primaryNoDot)) @mkdir($primaryNoDot, 0777, true);
    if (is_dir($primaryNoDot) && wcp_is_dir_writable($primaryNoDot)) {
        return $primaryNoDot;
    }
    // Priority 3: Termux App Home & Temp directories
    $termuxHome = getenv('HOME') ?: '/data/data/com.termux/files/home';
    $hash = substr(md5(__DIR__), 0, 8);
    $candidates = [
        $termuxHome . '/.wconsole_data_' . $hash,
        $termuxHome . '/.wconsole_data',
        getenv('PREFIX') ? getenv('PREFIX') . '/tmp/.wconsole_data_' . $hash : '',
        getenv('TMPDIR') ? getenv('TMPDIR') . '/.wconsole_data_' . $hash : '',
        '/data/data/com.termux/files/usr/tmp/.wconsole_data_' . $hash,
        sys_get_temp_dir() . '/.wconsole_data_' . $hash,
        '/tmp/.wconsole_data_' . $hash,
        sys_get_temp_dir()
    ];
    foreach ($candidates as $cand) {
        if (empty($cand)) continue;
        if (!is_dir($cand)) @mkdir($cand, 0777, true);
        if (is_dir($cand) && wcp_is_dir_writable($cand)) {
            return $cand;
        }
    }
    if (wcp_is_dir_writable(__DIR__)) {
        return __DIR__;
    }
    throw new RuntimeException('WebConsole data directory is not writable. On Termux Android: run `termux-setup-storage` or execute from home `cd ~`.');
}
@umask(0022);
define('DATA_DIR', wcp_init_data_dir());
define('JOBS_DIR', DATA_DIR . '/jobs');
define('CACHE_DIR', DATA_DIR . '/cache');
define('TERM_DIR', DATA_DIR . '/term');
define('MAX_EDIT', 3 * 1024 * 1024);
define('SPLIT_BYTES', 80 * 1024 * 1024);
foreach ([JOBS_DIR, CACHE_DIR, TERM_DIR] as $d) if (!is_dir($d)) @mkdir($d, 0777, true);
@wcp_put_contents(DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
@wcp_put_contents(DATA_DIR . '/index.html', '');
$GLOBALS['__NOEXEC'] = !function_exists('exec');
if (!function_exists('mb_strtolower')) { function mb_strtolower($s) { return strtolower((string)$s); } }
if (!function_exists('mb_substr')) { function mb_substr($s, $start, $len = null) { return $len === null ? substr((string)$s, $start) : substr((string)$s, $start, $len); } }
if (!function_exists('mb_check_encoding')) { function mb_check_encoding($s, $enc = 'UTF-8') { return $enc !== 'UTF-8' ? true : preg_match('//u', (string)$s) === 1; } }
function jout($ok, $data = null, $err = null, $code = 200) {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok'=>$ok,'data'=>$data,'error'=>$err], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE); exit;
}
function body(): array {
    static $b = null; if ($b !== null) return $b;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) { $j=json_decode((string)file_get_contents('php://input'),true); $b=is_array($j)?$j:[]; } else $b=$_POST;
    if (isset($_GET['api'])) $b['api']=$_GET['api']; if (isset($_POST['api'])) $b['api']=$_POST['api']; return $b;
}
function esc($s) { return escapeshellarg((string)$s); }
function sh($cmd, &$code = null) {
    if ($GLOBALS['__NOEXEC']) { $code=127; return 'PHP exec() is disabled'; }
    $o=[]; exec($cmd.' 2>&1',$o,$code); return implode("\n",$o);
}
function sh_ok($cmd, &$code = null) {
    if ($GLOBALS['__NOEXEC']) { $code=127; return ''; }
    $o=[]; exec($cmd.' 2>/dev/null',$o,$code); return implode("\n",$o);
}
function which($bin) { return trim(sh_ok('command -v '.esc($bin))) !== ''; }
function mask_url($u) { return preg_replace('~//([^:@/]+):([^@/]+)@~','//$1:***@',(string)$u); }
function act_log($m) { $who=PHP_SAPI==='cli'?'cli':($_SESSION['wcp_user']??'anon'); wcp_put_contents(DATA_DIR.'/activity.log','['.date('c')."] $who | $m\n",true,FILE_APPEND); }
function wcp_random($n=8) { return bin2hex(random_bytes($n)); }
function cfg(): array {
    if (!empty($GLOBALS['__CFG'])) return $GLOBALS['__CFG'];
    $d=['pass_hash'=>'','created'=>date('c'),'theme'=>'dark','layout'=>'classic','density'=>'comfortable','project_root'=>default_project_root(),'fs_start'=>is_dir('/var/www')?'/var/www':'/','fs_roots'=>['/'],'session_minutes'=>180,'allowed_ips'=>'','gh_token'=>'','gh_repo'=>'','gh_branch'=>'backups','git_name'=>'webconsole','git_email'=>'webconsole@localhost','split_mb'=>80,'tmux_width'=>120,'tmux_height'=>34,'proxy_mode'=>'auto','proxy_cf_url'=>'https://proxy.fazilat-ma.workers.dev/?url=https://example.com/page'];
    $j=json_decode((string)@file_get_contents(DATA_DIR.'/config.json'),true); if(is_array($j))$d=array_merge($d,$j); return $GLOBALS['__CFG']=$d;
}
function cfg_save(array $new) {
    $c=array_merge(cfg(),$new); $f=DATA_DIR.'/config.json';
    $json=json_encode($c,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    if(!wcp_put_contents($f,$json,true))throw new RuntimeException('Cannot save configuration to '.DATA_DIR.' (Termux / Android Storage write error)');
    $GLOBALS['__CFG']=$c;
}
if (PHP_SAPI !== 'cli') {
    $sessDir = DATA_DIR . '/sessions';
    if (!is_dir($sessDir)) @mkdir($sessDir, 0777, true);
    if (is_dir($sessDir) && wcp_is_dir_writable($sessDir)) {
        @session_save_path($sessDir);
    }
    session_name('WCPSESS');
    session_set_cookie_params(['lifetime'=>0,'path'=>'/','httponly'=>true,'samesite'=>'Lax','secure'=>(($_SERVER['HTTPS']??'')==='on'||($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https')]);
    @session_start();
}
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }
function ip_allowed(): bool {
    $list=trim((string)cfg()['allowed_ips']); if($list==='')return true; $ip=client_ip();
    foreach(preg_split('/[\s,;]+/',$list)as$r){if($r===$ip)return true;if(strpos($r,'/')!==false){[$net,$bits]=explode('/',$r,2);$n=inet_pton($net);$i=inet_pton($ip);if($n===false||$i===false||strlen($n)!==strlen($i)||!ctype_digit($bits))continue;$b=(int)$bits;if($b>strlen($n)*8)continue;$bytes=intdiv($b,8);$rest=$b%8;if(substr($n,0,$bytes)===substr($i,0,$bytes)&&(!$rest||((ord($n[$bytes])^ord($i[$bytes]))&(255<<(8-$rest)))===0))return true;}}
    return false;
}
function wcp_logged(): bool {
    if(empty($_SESSION['wcp_ok']))return false;
    if(time()-(int)($_SESSION['wcp_last']??0)>(int)cfg()['session_minutes']*60){session_destroy();return false;}
    $_SESSION['wcp_last']=time();return ip_allowed();
}
function require_auth(){if(!wcp_logged())jout(false,null,'نشست منقضی شده — دوباره وارد شوید',401);}
function csrf_ok(): bool {$in=body();$t=$_SERVER['HTTP_X_CSRF']??($in['csrf']??'');return !empty($_SESSION['wcp_csrf'])&&is_string($t)&&hash_equals($_SESSION['wcp_csrf'],$t);}
function login_locked(): int {$j=json_decode((string)@file_get_contents(DATA_DIR.'/loginfails.json'),true)?:[];return max(0,(int)($j['until']??0)-time());}
function login_fail(){ $f=DATA_DIR.'/loginfails.json';$j=json_decode((string)@file_get_contents($f),true)?:['n'=>0,'until'=>0];$j['n']++;if($j['n']>=6){$j['until']=time()+600;$j['n']=0;}wcp_put_contents($f,json_encode($j),true); }
function login_reset(){@unlink(DATA_DIR.'/loginfails.json');}
function do_login(string $pw): bool {
    if(cfg()['pass_hash']&&password_verify($pw,cfg()['pass_hash'])){session_regenerate_id(true);$_SESSION['wcp_ok']=true;$_SESSION['wcp_last']=time();$_SESSION['wcp_user']='admin';$_SESSION['wcp_csrf']=wcp_random(16);login_reset();act_log('Login from '.client_ip());return true;}
    login_fail();return false;
}
function norm_path(string $p): string {
    $p=str_replace('\\','/',$p);if($p==='')$p='/';if($p[0]!=='/')$p=rtrim(getcwd()?:'/','/').'/'.$p;$parts=[];
    foreach(explode('/',$p)as$s){if($s===''||$s==='.')continue;if($s==='..')array_pop($parts);else$parts[]=$s;}return '/'.implode('/',$parts);
}
function safe_path(string $p): string {
    $p=norm_path($p);$resolved=realpath($p);if($resolved!==false)$p=$resolved;
    foreach(cfg()['fs_roots']?:['/']as$r){$r=norm_path($r);$real=realpath($r);if($real!==false)$r=$real;if($r==='/')return $p;$r=rtrim($r,'/');if($p===$r||strpos($p,$r.'/')===0)return $p;}
    throw new RuntimeException('Path is outside the configured roots: '.$p);
}
function safe_new_path(string $p): string {
    $p=norm_path($p);$parent=realpath(dirname($p));if($parent===false)throw new RuntimeException('Parent directory does not exist');$base=basename($p);if($base===''||$base==='.'||$base==='..')throw new RuntimeException('Invalid name');return safe_path($parent.'/'.$base);
}
function job_file(string $id): string { return JOBS_DIR.'/'.preg_replace('/[^a-f0-9]/','',$id).'.json'; }
function job_get(string $id): ?array {$j=json_decode((string)@file_get_contents(job_file($id)),true);return is_array($j)?$j:null;}
function job_save(array $job){if(!wcp_put_contents(job_file($job['id']),json_encode($job,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE),true))throw new RuntimeException('Cannot save job metadata');}
function job_create(string $type,string $name,array $params): array {
    $id=date('ymd').'-'.wcp_random(4);$job=['id'=>$id,'type'=>$type,'name'=>$name,'params'=>$params,'pid'=>0,'created'=>date('c'),'log'=>JOBS_DIR."/$id.log",'result'=>null];@unlink(JOBS_DIR."/$id.exit");job_save($job);return $job;
}
function wcp_php_cli(): string {
    if (!function_exists('exec')) throw new RuntimeException('PHP exec() is disabled; background jobs cannot launch.');
    $override = defined('WCP_PHP_CLI') ? trim((string)WCP_PHP_CLI) : trim((string)getenv('WCP_PHP_CLI'));
    $termuxBin = getenv('PREFIX') ? getenv('PREFIX') . '/bin/php' : '';
    $candidates = $override !== '' ? [$override] : array_merge(
        [PHP_SAPI === 'cli' ? PHP_BINARY : '', '/usr/bin/php', '/usr/local/bin/php', PHP_BINDIR . '/php', $termuxBin, '/data/data/com.termux/files/usr/bin/php', trim(sh_ok('command -v php'))],
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
    $pidFile = JOBS_DIR . '/' . $id . '.pid';
    try {
        if (!wcp_is_dir_writable(JOBS_DIR) || !is_readable(__FILE__)) {
            throw new RuntimeException('Job directory is not writable (' . JOBS_DIR . ') or PHP source is not readable.');
        }
        $php = wcp_php_cli();
        $setsid = trim(sh_ok('command -v setsid'));
        $nohup = trim(sh_ok('command -v nohup'));
        $logHeader = "[launcher] " . date('c') . " Starting " . $job['name'] . "\n[launcher] PHP CLI: " . $php . "\n";
        if (!wcp_put_contents($job['log'], $logHeader, false, FILE_APPEND)) {
            $fp = @fopen($job['log'], 'ab');
            if ($fp) { @fwrite($fp, $logHeader); @fclose($fp); }
            else { throw new RuntimeException('Cannot write the job log (' . $job['log'] . '). Check storage write permissions.'); }
        }
        @unlink($receipt);
        @unlink($exitFile);
        @unlink($pidFile);
        $job['pid'] = 0;
        $job['script'] = __FILE__;
        $job['launch_token'] = wcp_random(16);
        $job['launch_deadline'] = time() + 15;
        job_save($job);
        $launcherPrefix = '';
        if ($setsid !== '' && ($setsid[0] === '/' || which('setsid'))) {
            $launcherPrefix = esc($setsid) . ' ';
        } elseif ($nohup !== '' && ($nohup[0] === '/' || which('nohup'))) {
            $launcherPrefix = esc($nohup) . ' ';
        }
        $cmd = 'cd ' . esc(DATA_DIR) . ' && ( ' . $launcherPrefix . esc($php)
            . ' -d register_argc_argv=1 ' . esc(__FILE__)
            . ' ' . esc('--bgjob=' . $id)
            . ' ' . esc('--wcp-data-dir=' . base64_encode(DATA_DIR))
            . ' >> ' . esc($job['log']) . ' 2>&1 < /dev/null & )';
        $output = sh($cmd, $rc);
        if ($rc !== 0) throw new RuntimeException('Background launcher failed: ' . mask_url($output));
        $deadline = microtime(true) + 7;
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
        throw new RuntimeException('PHP CLI did not acknowledge startup within 7 seconds. Read the job log for permissions, PHP configuration or bootstrap errors.');
    } catch (Throwable $e) {
        $message = $e->getMessage();
        $job['result'] = ['error' => $message];
        wcp_put_contents($job['log'], "[launcher ERROR] " . $message . "\n", false, FILE_APPEND);
        wcp_put_contents($exitFile, "127\n", false);
        job_save($job);
        throw new RuntimeException('Job ' . $id . ': ' . $message, 0, $e);
    }
}
function job_pid_alive(int $pid): bool {
    if ($pid <= 1) return false;
    if (function_exists('posix_kill')) {
        if (@posix_kill($pid, 0)) return true;
    }
    if (is_dir('/proc/' . $pid)) {
        $stat = (string)@file_get_contents('/proc/' . $pid . '/stat');
        if ($stat !== '') {
            $end = strrpos($stat, ')');
            if ($end !== false) {
                $state = substr($stat, $end + 2, 1);
                return $state !== 'Z' && $state !== 'X';
            }
        }
        return true;
    }
    $out = trim(sh_ok('kill -0 ' . (int)$pid . ' 2>&1', $rc));
    return $rc === 0;
}
function job_status(array $job): array {
    $f=JOBS_DIR.'/'.$job['id'].'.exit';clearstatcache(true,$f);
    if(is_file($f)){$text=trim((string)file_get_contents($f));if(preg_match('/^-?\d+$/',$text))return ['status'=>(int)$text===0?'done':'failed','exit'=>(int)$text];}
    if (wcp_job_alive($job)) return ['status' => 'running', 'exit' => null];
    return ['status'=>'dead','exit'=>-1];
}
function wcp_get_pid_systemd_service(int $pid): ?string {
    if ($pid <= 1) return null;
    $cgroup = (string)@file_get_contents("/proc/{$pid}/cgroup");
    if ($cgroup !== '' && preg_match('#system\.slice/([^\s/]+\.service)#', $cgroup, $m)) {
        return $m[1];
    }
    $status = trim((string)sh_ok("systemctl status {$pid} 2>/dev/null || sudo -n systemctl status {$pid} 2>/dev/null"));
    if ($status !== '' && preg_match('/([a-zA-Z0-9_\-\.\@]+\.service)/', $status, $m)) {
        return $m[1];
    }
    return null;
}

function wcp_get_listening_ports(): array {
    $ports = [];
    $seen = [];

    // 1. ss tool with sudo fallback
    $ss = trim(sh_ok('ss -tulpn -H 2>/dev/null || (sudo -n ss -tulpn -H 2>/dev/null)'));
    if ($ss !== '') {
        foreach (explode("\n", $ss) as $line) {
            $line = trim($line);
            if ($line === '') continue;
            $cols = preg_split('/\s+/', $line);
            if (count($cols) < 5) continue;
            $proto = strtoupper($cols[0]);
            $local = $cols[4] ?? '';
            $users = implode(' ', array_slice($cols, 6));

            $pPos = strrpos($local, ':');
            if ($pPos === false) continue;
            $port = (int)substr($local, $pPos + 1);
            if ($port <= 0 || $port > 65535) continue;

            $pidsFound = [];
            if (preg_match_all('/(?:\"([^\"]+)\",pid=(\d+)|pid=(\d+))/', $users, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $m) {
                    $pid = !empty($m[2]) ? (int)$m[2] : (!empty($m[3]) ? (int)$m[3] : 0);
                    $name = !empty($m[1]) ? $m[1] : '';
                    if ($pid > 0) $pidsFound[] = [$pid, $name];
                }
            }
            if (empty($pidsFound)) {
                $pidsFound[] = [null, ''];
            }

            foreach ($pidsFound as [$pid, $name]) {
                $key = $proto . ':' . $port . ':' . ($pid ?? '0');
                if (isset($seen[$key])) continue;
                $seen[$key] = true;

                $cmdline = '';
                $user = '';
                $svcName = null;
                if ($pid && is_dir('/proc/' . $pid)) {
                    $raw = (string)@file_get_contents('/proc/' . $pid . '/cmdline');
                    if ($raw !== '') $cmdline = trim(str_replace("\0", ' ', $raw));
                    $stat = @stat('/proc/' . $pid);
                    if ($stat && function_exists('posix_getpwuid')) {
                        $pw = @posix_getpwuid($stat['uid']);
                        if ($pw) $user = $pw['name'];
                    }
                    $svcName = wcp_get_pid_systemd_service($pid);
                }

                $ports[] = [
                    'proto' => $proto,
                    'port' => $port,
                    'local_addr' => $local,
                    'pid' => $pid,
                    'name' => ($name !== '' ? $name : ($cmdline !== '' ? basename(explode(' ', $cmdline)[0]) : 'unknown')),
                    'cmdline' => $cmdline,
                    'user' => ($user !== '' ? $user : '—'),
                    'system_service' => $svcName
                ];
            }
        }
    }

    // 2. Direct /proc/net scan fallback
    if (empty($ports)) {
        $netFiles = [
            '/proc/net/tcp' => 'TCP',
            '/proc/net/tcp6' => 'TCP6',
            '/proc/net/udp' => 'UDP',
            '/proc/net/udp6' => 'UDP6'
        ];
        foreach ($netFiles as $file => $proto) {
            if (!is_readable($file)) continue;
            $lines = @file($file);
            if (!$lines) continue;
            foreach ($lines as $i => $line) {
                if ($i === 0) continue;
                $parts = preg_split('/\s+/', trim($line));
                if (count($parts) < 10) continue;
                if ($parts[3] !== '0A' && strpos($proto, 'TCP') === 0) continue;
                $addrParts = explode(':', $parts[1] ?? '');
                if (count($addrParts) !== 2) continue;
                $port = (int)hexdec($addrParts[1]);
                if ($port <= 0 || $port > 65535) continue;
                $inode = $parts[9] ?? '0';

                $pid = null; $name = ''; $cmdline = ''; $user = ''; $svcName = null;
                if ($inode !== '0') {
                    $procDirs = glob('/proc/[0-9]*/fd/*') ?: [];
                    foreach ($procDirs as $fd) {
                        $target = @readlink($fd);
                        if ($target && strpos($target, 'socket:[' . $inode . ']') !== false) {
                            if (preg_match('#^/proc/(\d+)/#', $fd, $pm)) {
                                $pid = (int)$pm[1];
                                break;
                            }
                        }
                    }
                }
                if ($pid && is_dir('/proc/' . $pid)) {
                    $raw = (string)@file_get_contents('/proc/' . $pid . '/cmdline');
                    if ($raw !== '') $cmdline = trim(str_replace("\0", ' ', $raw));
                    $stat = @stat('/proc/' . $pid);
                    if ($stat && function_exists('posix_getpwuid')) {
                        $pw = @posix_getpwuid($stat['uid']);
                        if ($pw) $user = $pw['name'];
                    }
                    $svcName = wcp_get_pid_systemd_service($pid);
                }

                $key = $proto . ':' . $port . ':' . ($pid ?? '0');
                if (!isset($seen[$key])) {
                    $seen[$key] = true;
                    $ports[] = [
                        'proto' => $proto,
                        'port' => $port,
                        'local_addr' => '*:' . $port,
                        'pid' => $pid,
                        'name' => ($name !== '' ? $name : ($cmdline !== '' ? basename(explode(' ', $cmdline)[0]) : 'process')),
                        'cmdline' => $cmdline,
                        'user' => ($user !== '' ? $user : '—'),
                        'system_service' => $svcName
                    ];
                }
            }
        }
    }

    usort($ports, fn($a, $b) => $a['port'] <=> $b['port']);
    return $ports;
}

function wcp_kill_port($port) {
    $port = (int)$port;
    if ($port <= 0 || $port > 65535) return;
    $hexPort = strtoupper(str_pad(dechex($port), 4, '0', STR_PAD_LEFT));

    // Stop any systemd services attached to this port
    $ss = @shell_exec("ss -tulpn \"sport = :{$port}\" -H 2>/dev/null || (sudo -n ss -tulpn \"sport = :{$port}\" -H 2>/dev/null)");
    if ($ss && preg_match_all("/pid=(\d+)/", $ss, $m)) {
        foreach ($m[1] as $pid) {
            $pid = (int)$pid;
            if ($pid > 0 && $pid !== getmypid()) {
                $svc = wcp_get_pid_systemd_service($pid);
                if ($svc && $svc !== 'systemd.service') {
                    @shell_exec("systemctl stop " . escapeshellarg($svc) . " 2>/dev/null || sudo -n systemctl stop " . escapeshellarg($svc) . " 2>/dev/null");
                }
                @shell_exec("kill -9 {$pid} 2>/dev/null || (sudo -n kill -9 {$pid} 2>/dev/null)");
            }
        }
    }

    @shell_exec("fuser -k -9 {$port}/tcp 2>/dev/null || (sudo -n fuser -k -9 {$port}/tcp 2>/dev/null)");
    @shell_exec("fuser -k -9 {$port}/udp 2>/dev/null || (sudo -n fuser -k -9 {$port}/udp 2>/dev/null)");
    @shell_exec("lsof -ti :{$port} 2>/dev/null | xargs -r kill -9 2>/dev/null || (sudo -n lsof -ti :{$port} 2>/dev/null | sudo -n xargs -r kill -9 2>/dev/null)");

    foreach (["/proc/net/tcp", "/proc/net/tcp6", "/proc/net/udp", "/proc/net/udp6"] as $netFile) {
        if (!is_readable($netFile)) continue;
        $lines = @file($netFile);
        if (!$lines) continue;
        foreach ($lines as $line) {
            $parts = preg_split("/\s+/", trim($line));
            if (count($parts) < 10) continue;
            $localAddr = $parts[1] ?? '';
            $inode = $parts[9] ?? '0';
            if ($inode === '0') continue;
            $addrParts = explode(':', $localAddr);
            if (count($addrParts) === 2 && strtoupper($addrParts[1]) === $hexPort) {
                $procDirs = glob("/proc/[0-9]*/fd/*") ?: [];
                foreach ($procDirs as $fd) {
                    $target = @readlink($fd);
                    if ($target && strpos($target, "socket:[{$inode}]") !== false) {
                        if (preg_match("#^/proc/(\d+)/#", $fd, $pm)) {
                            $spid = (int)$pm[1];
                            if ($spid > 0 && $spid !== getmypid()) {
                                $svc = wcp_get_pid_systemd_service($spid);
                                if ($svc && $svc !== 'systemd.service') {
                                    @shell_exec("systemctl stop " . escapeshellarg($svc) . " 2>/dev/null || sudo -n systemctl stop " . escapeshellarg($svc) . " 2>/dev/null");
                                }
                                @shell_exec("kill -9 {$spid} 2>/dev/null || (sudo -n kill -9 {$spid} 2>/dev/null)");
                            }
                        }
                    }
                }
            }
        }
    }
}

function wcp_kill_directory_procs(string $dir) {
    $dir = rtrim(realpath($dir) ?: $dir, '/');
    if (empty($dir) || $dir === '/' || $dir === '/root' || $dir === '/home') return;
    @shell_exec("pkill -9 -f " . escapeshellarg($dir) . " 2>/dev/null");
    $myPid = getmypid();
    $procDirs = glob("/proc/[0-9]*") ?: [];
    foreach ($procDirs as $pDir) {
        $pid = (int)basename($pDir);
        if ($pid <= 0 || $pid === $myPid) continue;
        $cwd = @readlink($pDir . '/cwd');
        if ($cwd && ($cwd === $dir || strpos($cwd, $dir . '/') === 0)) {
            @shell_exec("kill -9 {$pid} 2>/dev/null");
            continue;
        }
        $cmdline = @file_get_contents($pDir . '/cmdline');
        if ($cmdline && strpos($cmdline, $dir) !== false) {
            @shell_exec("kill -9 {$pid} 2>/dev/null");
        }
    }
}

function job_stop(array $job) {
    $pid = (int)$job['pid'];
    @wcp_put_contents(JOBS_DIR . '/' . $job['id'] . '.stop', "1\n", false);
    $childPidFile = JOBS_DIR . '/' . $job['id'] . '.child_pid';
    $childPid = 0;
    if (is_file($childPidFile)) {
        $childPid = (int)trim((string)@file_get_contents($childPidFile));
    }
    $k = is_executable('/bin/kill') ? '/bin/kill' : 'kill';
    if ($childPid > 0 && job_pid_alive($childPid)) {
        sh($k . ' -TERM -- -' . $childPid . ' 2>/dev/null; ' . $k . ' -TERM ' . $childPid . ' 2>/dev/null');
    }
    if ($pid > 0 && wcp_job_alive($job)) {
        sh($k . ' -TERM -- -' . $pid . ' 2>/dev/null; ' . $k . ' -TERM ' . $pid . ' 2>/dev/null');
        for ($i = 0; $i < 15; $i++) {
            if (!job_pid_alive($pid)) break;
            usleep(200000);
        }
        if (wcp_job_alive($job)) {
            sh($k . ' -KILL -- -' . $pid . ' 2>/dev/null; ' . $k . ' -KILL ' . $pid . ' 2>/dev/null');
        }
    }
    if ($childPid > 0 && job_pid_alive($childPid)) {
        sh($k . ' -KILL -- -' . $childPid . ' 2>/dev/null; ' . $k . ' -KILL ' . $childPid . ' 2>/dev/null');
    }
    if (($job['type'] ?? '') === 'service' && !empty($job['params']['project_id'])) {
        $p = proj_find(proj_all(), $job['params']['project_id']);
        if ($p) {
            if (!empty($p['port'])) wcp_kill_port($p['port']);
            $deployDir = proj_resolve_deploy_path($p);
            if (!empty($deployDir)) wcp_kill_directory_procs($deployDir);
        }
    }
    wcp_put_contents(JOBS_DIR . '/' . $job['id'] . '.exit', "130\n", false);
    act_log('Stopped job ' . $job['id']);
}
function term_mode(): string {
    if(!empty($GLOBALS['__TMODE']))return $GLOBALS['__TMODE'];
    return $GLOBALS['__TMODE']=$GLOBALS['__NOEXEC']?'none':(which('tmux')?'tmux':(which('screen')?'screen':'simple'));
}
function term_root_target(): array {
    $bash = trim(sh_ok('command -v bash')) ?: '/bin/sh';
    $isRoot = (function_exists('posix_getuid') && @posix_getuid() === 0) || trim(sh_ok('whoami')) === 'root';
    $rootHome = is_dir('/root') ? '/root' : '/';
    if ($isRoot) {
        return array('cmd' => $bash, 'home' => $rootHome, 'is_root' => true, 'user' => 'root');
    }
    $hasNoPassSudo = false;
    if (which('sudo')) {
        sh('sudo -n true 2>&1', $sudoRc);
        if ($sudoRc === 0) {
            $hasNoPassSudo = true;
        }
    }
    if ($hasNoPassSudo) {
        return array('cmd' => 'sudo -n -i', 'home' => $rootHome, 'is_root' => true, 'user' => 'root');
    }
    $curUser = trim(sh_ok('whoami')) ?: 'www-data';
    $home = is_dir('/var/www') ? '/var/www' : (getenv('HOME') ?: '/');
    return array('cmd' => $bash, 'home' => $home, 'is_root' => false, 'user' => $curUser);
}
function term_tmux_conf(): string {
    $f=TERM_DIR.'/tmux.conf';
    if(!is_file($f)){
        $bash=trim(sh_ok('command -v bash'))?:'/bin/sh';
        file_put_contents($f,"set-option -g default-shell $bash\nset-option -g default-command $bash\nset-option -g escape-time 0\nset-option -g default-terminal xterm-256color\nset-option -g history-limit 10000\n");
    }
    return $f;
}
function term_dir(string $id): string {if(!preg_match('/^[a-f0-9]{12}$/',$id))throw new RuntimeException('Invalid terminal ID');$d=TERM_DIR.'/'.$id;if(!is_dir($d))mkdir($d,0700,true);return $d;}
function term_name(string $id): string {return 'wc_'.preg_replace('/[^a-f0-9]/','',$id);}
function term_list(): array {
    $mode=term_mode();$alive=[];
    if($mode==='tmux'){foreach(explode("\n",sh_ok('tmux -f '.esc(term_tmux_conf()).' ls -F "#S"'))as$l)if(strpos($l,'wc_')===0)$alive[substr($l,3)]=true;}
    elseif($mode==='screen'){preg_match_all('/\bwc_([a-f0-9]+)\b/',sh_ok('screen -ls'),$m);foreach($m[1]as$id)$alive[$id]=true;}
    $res=[];foreach(glob(TERM_DIR.'/*',GLOB_ONLYDIR)?:[]as$d){$id=basename($d);if(!preg_match('/^[a-f0-9]{12}$/',$id))continue;$meta=json_decode((string)@file_get_contents($d.'/meta.json'),true)?:[];$isAlive=isset($alive[$id])||$mode==='simple';
        if(!$isAlive && time()-(strtotime($meta['created']??'')?:time())>3600){
                term_kill($id);
            continue;
        }
        $res[]=array('id'=>$id,'title'=>$meta['title']??('شل '.substr($id,0,4).' (root)'),'created'=>$meta['created']??'','alive'=>$isAlive,'user'=>'root');
    }usort($res,fn($a,$b)=>strcmp($a['created'],$b['created']));return $res;
}
function term_create(int $cols,int $rows): array {
    $id=wcp_random(6);$d=term_dir($id);$s=term_name($id);$log=$d.'/out.log';touch($log);@chmod($log,0666);$cols=max(40,min(500,$cols?:120));$rows=max(10,min(200,$rows?:34));$mode=term_mode();
    $target=term_root_target();$home=$target['home'];$cmd=$target['cmd'];$isRoot=$target['is_root'];$u=$target['user'];
    if($mode==='tmux'){
        $tm='tmux -f '.esc(term_tmux_conf());
        $out=sh($tm.' new-session -d -s '.esc($s).' -x '.$cols.' -y '.$rows.' -c '.esc($home).' '.esc($cmd),$rc);
        if($rc!==0)throw new RuntimeException($out);
        sh($tm.' pipe-pane -t '.esc($s).' '.esc('stdbuf -o0 -e0 cat >> '.esc($log).' 2>&1 || cat >> '.esc($log).' 2>&1'));
        if($isRoot){
            sh($tm.' send-keys -t '.esc($s).' '.esc('export USER=root HOME=/root PS1="\\[\\033[01;32m\\]root@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]# "; cd /root; clear').' Enter');
        }else{
            sh($tm.' send-keys -t '.esc($s).' '.esc('export PS1="\\[\\033[01;32m\\]'.$u.'@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]$ "; clear').' Enter');
        }
    }elseif($mode==='screen'){
        $out=sh('screen -dmS '.esc($s).' -L -Logfile '.esc($log).' '.esc($cmd),$rc);
        if($rc!==0)throw new RuntimeException($out);
        if($isRoot){
            sh('screen -S '.esc($s).' -p 0 -X stuff "export USER=root HOME=/root PS1=\"root@\\h:\\w# \"; cd /root; clear\\n"');
        }
    }elseif($mode==='simple'){
        file_put_contents($d.'/cwd',$home);
        file_put_contents($log,"Simple shell (User: ".$u."): install tmux for an interactive terminal.\n");
    }else throw new RuntimeException('PHP exec() is disabled');
    file_put_contents($d.'/meta.json',json_encode(array('title'=>'شل '.substr($id,0,4).($isRoot?' (root)':(' ('.$u.')')),'created'=>date('c'),'mode'=>$mode,'user'=>$u,'is_root'=>$isRoot),JSON_UNESCAPED_UNICODE));
    return array('id'=>$id,'mode'=>$mode,'log'=>$log,'user'=>$u,'is_root'=>$isRoot);
}
function term_read(string $id,int $offset): array {
    $log=term_dir($id).'/out.log';if(!is_file($log))return ['b64'=>'','offset'=>0,'alive'=>false];clearstatcache(true,$log);$size=filesize($log);$offset=max(0,$offset);if($offset>$size)$offset=0;$data='';if($size>$offset){$f=fopen($log,'rb');fseek($f,$offset);$data=(string)fread($f,min(1048576,$size-$offset));fclose($f);}
    $alive=true;$info='';if(term_mode()==='tmux'){$info=sh_ok('tmux -f '.esc(term_tmux_conf()).' display-message -p -t '.esc(term_name($id)).' "#{pane_current_command}|#{pane_current_path}"');$alive=trim($info)!=='';}elseif(term_mode()==='screen')$alive=strpos(sh_ok('screen -ls'),term_name($id))!==false;
    return ['b64'=>base64_encode($data),'offset'=>$offset+strlen($data),'alive'=>$alive,'info'=>$info];
}
function term_write(string $id,string $b64){
    $raw=base64_decode($b64,true);if($raw===false||$raw==='')return;$d=term_dir($id);$s=term_name($id);
    if(term_mode()==='tmux')sh('tmux -f '.esc(term_tmux_conf()).' send-keys -t '.esc($s).' -l -- '.esc($raw));
    elseif(term_mode()==='screen')sh('screen -S '.esc($s).' -p 0 -X stuff '.esc($raw));
    else{file_put_contents($d.'/in.buf',$raw,FILE_APPEND|LOCK_EX);$buf=(string)file_get_contents($d.'/in.buf');if(strpbrk($buf,"\r\n")!==false){$lines=preg_split('/\r\n|\n|\r/',$buf);file_put_contents($d.'/in.buf',array_pop($lines),LOCK_EX);foreach($lines as$l)if(trim($l)!=='')term_simple_exec($id,$l);}}
}
function term_simple_exec(string $id,string $line){
    $d=term_dir($id);$cwd=trim((string)@file_get_contents($d.'/cwd'))?:(is_dir('/root')?'/root':'/');
    file_put_contents($d.'/out.log',$cwd.' # '.$line."\n",FILE_APPEND|LOCK_EX);
    $isRoot=(function_exists('posix_getuid')&&@posix_getuid()===0)||trim(sh_ok('whoami'))==='root';
    $prefix=(!$isRoot && which('sudo')) ? 'sudo -n ' : '';
    $script='cd '.esc($cwd)." || exit\n{ ".$prefix.$line."\n}\n__rc=\$?\necho \"[wcp-exit:\$__rc]\"\npwd > ".esc($d.'/cwd2')."\n";
    file_put_contents($d.'/run.sh',$script);sh('bash '.esc($d.'/run.sh').' >> '.esc($d.'/out.log').' 2>&1');$new=trim((string)@file_get_contents($d.'/cwd2'));if(is_dir($new))file_put_contents($d.'/cwd',$new);
}
function term_resize(string $id,int $cols,int $rows){$cols=max(40,min(500,$cols));$rows=max(10,min(200,$rows));$s=term_name($id);if(term_mode()==='tmux')sh('tmux -f '.esc(term_tmux_conf()).' resize-window -t '.esc($s).' -x '.$cols.' -y '.$rows);elseif(term_mode()==='screen')sh('screen -S '.esc($s).' -p 0 -X width -w '.$cols);}
function term_kill(string $id){$d=term_dir($id);$s=term_name($id);if(term_mode()==='tmux')sh('tmux -f '.esc(term_tmux_conf()).' kill-session -t '.esc($s));elseif(term_mode()==='screen')sh('screen -S '.esc($s).' -p 0 -X quit');sh('rm -rf -- '.esc($d));}
function fs_scan_dir(string $path,string $sort='name',bool $asc=true): array {
    $path=safe_path($path);$dh=opendir($path);if(!$dh)throw new RuntimeException('Cannot open directory');$items=[];
    while(($f=readdir($dh))!==false){if($f==='.'||$f==='..')continue;$full=rtrim($path,'/').'/'.$f;$st=lstat($full);if(!$st)continue;$items[]=['name'=>$f,'dir'=>is_dir($full)&&!is_link($full),'link'=>is_link($full),'size'=>$st['size'],'mtime'=>$st['mtime'],'perms'=>substr(sprintf('%o',$st['mode']),-4),'owner'=>function_exists('posix_getpwuid')?(posix_getpwuid($st['uid'])['name']??$st['uid']):$st['uid'],'group'=>function_exists('posix_getgrgid')?(posix_getgrgid($st['gid'])['name']??$st['gid']):$st['gid']];}
    closedir($dh);usort($items,function($a,$b)use($sort,$asc){if($a['dir']!==$b['dir'])return $a['dir']?-1:1;$r=$sort==='size'?($a['size']<=>$b['size']):($sort==='date'?($a['mtime']<=>$b['mtime']):strcasecmp($a['name'],$b['name']));return $asc?$r:-$r;});return ['path'=>$path,'items'=>$items];
}
function fs_zip_to(string $zipFile,array $paths,string $baseDir): bool {
    if(which('zip')){$cmd='cd '.esc($baseDir).' && zip -rq '.esc($zipFile).' --';foreach($paths as$p)$cmd.=' '.esc(ltrim($p,'/'));sh($cmd,$rc);return $rc===0&&is_file($zipFile);}
    if(!class_exists('ZipArchive'))return false;$z=new ZipArchive();if($z->open($zipFile,ZipArchive::CREATE|ZipArchive::OVERWRITE)!==true)return false;
    foreach($paths as$p){$full=rtrim($baseDir,'/').'/'.ltrim($p,'/');if(is_dir($full)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($full,FilesystemIterator::SKIP_DOTS))as$f)if($f->isFile())$z->addFile($f->getPathname(),ltrim(substr($f->getPathname(),strlen(rtrim($baseDir,'/'))),'/'));}elseif(is_file($full))$z->addFile($full,basename($full));}return $z->close();
}
function fs_stream_download(string $file,string $name){@set_time_limit(0);session_write_close();header('Content-Type: application/octet-stream');header('Content-Disposition: attachment; filename="'.rawurlencode($name).'"');header('Content-Length: '.filesize($file));header('X-Content-Type-Options: nosniff');readfile($file);exit;}
function fs_search(string $base,string $q,bool $content=false): array {
    $base=safe_path($base);$res=[];$start=microtime(true);$it=new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(new RecursiveDirectoryIterator($base,FilesystemIterator::SKIP_DOTS),function($f){return !in_array($f->getFilename(),['.git','node_modules','.wconsole_data'],true)&&!$f->isLink();}),RecursiveIteratorIterator::SELF_FIRST,RecursiveIteratorIterator::CATCH_GET_CHILD);$it->setMaxDepth(12);
    foreach($it as$f){if(microtime(true)-$start>8||count($res)>=600)break;$hit=strpos(mb_strtolower($f->getFilename()),mb_strtolower($q))!==false;if(!$hit&&$content&&$f->isFile()&&$f->getSize()<1048576)$hit=stripos((string)@file_get_contents($f->getPathname()),$q)!==false;if($hit)$res[]=['path'=>$f->getPathname(),'dir'=>$f->isDir(),'size'=>$f->getSize()];}return $res;
}
function bk_profiles(): array {
    $f=DATA_DIR.'/backup_profiles.json';$j=json_decode((string)@file_get_contents($f),true);if(is_array($j))return $j;
    $j=[['id'=>'web','name'=>'وب‌سایت‌ها','icon'=>'🌐','extra'=>'','enabled'=>true,'includes'=>['/var/www','/usr/share/nginx/html','/srv'],'excludes'=>['*/node_modules','*/.git','*/cache/*','*/tmp/*']],['id'=>'home','name'=>'فایل‌های شخصی','icon'=>'🏠','extra'=>'','enabled'=>true,'includes'=>['/root','/home'],'excludes'=>['*/.bash_history','*/.cache/*','*/.npm/*']],['id'=>'etc','name'=>'کانفیگ‌ها','icon'=>'⚙️','extra'=>'','enabled'=>true,'includes'=>['/etc'],'excludes'=>[]],['id'=>'ssl','name'=>'گواهی‌ها','icon'=>'🔒','extra'=>'','enabled'=>false,'includes'=>['/etc/letsencrypt'],'excludes'=>[]],['id'=>'db','name'=>'دیتابیس‌ها','icon'=>'🗄️','extra'=>'db','enabled'=>true,'includes'=>[],'excludes'=>[]],['id'=>'cron','name'=>'کران‌جاب‌ها','icon'=>'⏰','extra'=>'cron','enabled'=>true,'includes'=>[],'excludes'=>[]],['id'=>'pkg','name'=>'لیست پکیج‌ها','icon'=>'📦','extra'=>'packages','enabled'=>true,'includes'=>[],'excludes'=>[]],['id'=>'logs','name'=>'لاگ‌ها','icon'=>'📜','extra'=>'','enabled'=>false,'includes'=>['/var/log'],'excludes'=>['*.gz','*.xz','*/journal/*']]];bk_profiles_save($j);return $j;
}
function bk_profiles_save(array $list){wcp_put_contents(DATA_DIR.'/backup_profiles.json',json_encode(array_values($list),JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE),LOCK_EX);}
function gh_url(): string {
    $c=cfg();$repo=trim((string)$c['gh_repo']);if($repo==='')return '';if($repo[0]==='/')return $repo;
    if(preg_match('~^git@([^:]+):(.+)$~',$repo,$m))$repo=$m[1].'/'.$m[2];$repo=preg_replace('~^https?://~i','',$repo);$repo=preg_replace('~^[^@/]+@~','',$repo);if(strpos($repo,'github.com/')!==0)$repo='github.com/'.ltrim($repo,'/');return 'https://'.($c['gh_token']!==''?'wcp:'.rawurlencode($c['gh_token']).'@':'').$repo;
}
function gh_slug(string $name): string {return trim(preg_replace('/[^a-z0-9_\-]+/i','-',$name),'-')?:'p';}
function cf_proxy_url(string $targetUrl, ?array $c = null): string {
    if ($c === null) $c = cfg();
    $raw = trim((string)($c['proxy_cf_url'] ?? ''));
    if ($raw === '') $raw = 'https://proxy.fazilat-ma.workers.dev/?url=https://example.com/page';
    if ($targetUrl === '') return $raw;
    if (strpos($raw, '{url}') !== false) return str_replace('{url}', $targetUrl, $raw);
    if (preg_match('~^(https?://[^?#]+(?:\?[^#]*url=))(.*)$~i', $raw, $m)) {
        return $m[1] . $targetUrl;
    }
    if (strpos($raw, '?') === false) {
        return rtrim($raw, '/') . '/?url=' . $targetUrl;
    }
    return $raw . '&url=' . $targetUrl;
}
function gh_request(string $url, string $token = ''): ?string {
    $c = cfg();
    $proxyMode = $c['proxy_mode'] ?? 'auto';
    $token = $token !== '' ? $token : (string)($c['gh_token'] ?? '');
    
    $fetchDirect = function(string $targetUrl) use ($token): ?string {
        $headers = ['User-Agent: WebConsole-Pro/1.3.8', 'Accept: application/vnd.github+json'];
        if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;
        if (function_exists('curl_init')) {
            $ch = curl_init($targetUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => 25,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0
            ]);
            $res = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            return ($code >= 200 && $code < 300 && is_string($res)) ? $res : null;
        }
        $ctx = stream_context_create([
            'http' => ['method' => 'GET', 'header' => implode("\r\n", $headers) . "\r\n", 'timeout' => 25, 'ignore_errors' => true, 'follow_location' => 1],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]
        ]);
        $res = @file_get_contents($targetUrl, false, $ctx);
        if (!is_string($res)) return null;
        $statusLine = $http_response_header[0] ?? '';
        if (preg_match('#HTTP/\S+\s+(\d+)#', $statusLine, $m)) {
            $code = (int)$m[1];
            if ($code < 200 || $code >= 300) return null;
        }
        return $res;
    };

    if ($proxyMode === 'cf_proxy') {
        $proxiedUrl = cf_proxy_url($url, $c);
        return $fetchDirect($proxiedUrl);
    }

    $res = $fetchDirect($url);
    if ($res !== null) return $res;

    // If auto mode and direct request failed, fallback to Cloudflare proxy
    if ($proxyMode === 'auto') {
        $proxiedUrl = cf_proxy_url($url, $c);
        return $fetchDirect($proxiedUrl);
    }

    return null;
}
function gh_http_get(string $url,string $token=''): ?array {$j=json_decode((string)gh_request($url,$token),true);return is_array($j)?$j:null;}
function gh_raw_get(string $owner,string $repo,string $branch,string $path,string $token=''): ?string {return gh_request('https://raw.githubusercontent.com/'.rawurlencode($owner).'/'.rawurlencode($repo).'/'.rawurlencode($branch).'/'.implode('/',array_map('rawurlencode',explode('/',ltrim($path,'/')))),$token);}
function gh_user_repos(string $owner,string $token=''): array {
    $owner=trim($owner)?:'fazilatma';$data=gh_http_get('https://api.github.com/users/'.rawurlencode($owner).'/repos?per_page=100&sort=updated',$token);if(!is_array($data))$data=gh_http_get('https://api.github.com/orgs/'.rawurlencode($owner).'/repos?per_page=100&sort=updated',$token)?:[];$list=[];foreach($data as$r)if(isset($r['name']))$list[]=['name'=>$r['name'],'full_name'=>$r['full_name']??($owner.'/'.$r['name']),'description'=>$r['description']??'','default_branch'=>$r['default_branch']??'main','language'=>$r['language']??'Other','stars'=>(int)($r['stargazers_count']??0),'updated_at'=>$r['updated_at']??'','private'=>!empty($r['private']),'clone_url'=>$r['clone_url']??''];return $list;
}
function gh_repo_branches(string $owner,string $repo,string $token='',?callable $fetch=null): array {
    $fetch=$fetch??'gh_http_get';$base='https://api.github.com/repos/'.rawurlencode($owner).'/'.rawurlencode($repo);$meta=$fetch($base,$token);$default=$meta['default_branch']??'';$list=[];
    for($page=1;;$page++){$data=$fetch($base.'/branches?per_page=100&page='.$page,$token);if(!is_array($data)||isset($data['message']))throw new RuntimeException('Cannot list all branches (page '.$page.'). Check GitHub access, token, rate limit and network.');foreach($data as $b)if(isset($b['name']))$list[]=['name'=>$b['name'],'default'=>$b['name']===$default];if(count($data)<100)break;}return $list;
}
function proj_scraper4_runtime(): array {
    return json_decode('{"type":"node","install_cmd":"npm ci --include=dev --no-audit --no-fund","build_cmd":"node scripts/esbuild-check.mjs && npm run version:check && npm run render:build","start_cmd":"node scripts/local-deployer-ui.mjs","port":"8790","auto_start":false,"is_daemon":true,"env":{"NODE_ENV":"production","DEPLOYER_UI_PORT":"8790","DEPLOYER_UI_HOST":"127.0.0.1","SCRAPER_PORT":"3000","SCRAPER_BIND_HOST":"127.0.0.1","RUN_WORKER_IN_WEB":"true","DEPLOYER_SUPERVISED":"true","LOCAL_SCRAPER_AUTOSTART":"true","LOCAL_SCRAPER_KEEPALIVE":"true","LOCAL_SCRAPER_STOP_WITH_UI":"true","LOCAL_DEPLOYER_AUTO_UPDATE":"false","LOCAL_DEPLOYER_AUTO_INSTALL_LATEST":"false","LOCAL_SCRAPER_AUTO_UPDATE":"false"},"runtime_profile":"scraper4-local-deployer"}',true);
}
function gh_apply_runtime_profile(array $app,array $pkg,bool $hasLauncher): array {
    if($hasLauncher&&($pkg['name']??'')==='scraper4-cloudflare'&&trim((string)($pkg['scripts']['deployer:ui']??''))==='node scripts/local-deployer-ui.mjs'){
        $app=array_merge($app,proj_scraper4_runtime());$app['framework']='Scraper4 Node + Local Deployer (8790 / 3000)';
    }
    return $app;
}
function proj_quick_settings(array $p): array {
    if(($p['runtime_profile']??'')==='scraper4-local-deployer'){
        $env=$p['env']??[];$p=array_merge($p,proj_scraper4_runtime());$p['env']=array_merge($p['env'],$env);
    }else{$p['env']=array_merge(['NODE_ENV'=>'production','PYTHONUNBUFFERED'=>'1'],$p['env']??[]);}
    $p['id']='';$p['auto_start']=true;$p['is_daemon']=true;if(($p['port']??'')!=='')$p['env']['PORT']=$p['port'];return $p;
}

function gh_inspect_branch(string $owner,string $repo,string $branch,string $token=''): array {
    $data=gh_http_get('https://api.github.com/repos/'.rawurlencode($owner).'/'.rawurlencode($repo).'/git/trees/'.rawurlencode($branch).'?recursive=1',$token);$byDir=[];if(!is_array($data)||!isset($data['tree']))throw new RuntimeException('Cannot inspect branch. Check GitHub access, rate limit and network.');if(!empty($data['truncated']))throw new RuntimeException('GitHub tree is truncated; project versions cannot be compared reliably.');
    foreach($data['tree']??[]as$item){if(($item['type']??'')!=='blob')continue;$p=$item['path'];$d=dirname($p);$byDir[$d==='.'?'':$d][]=basename($p);}$apps=[];
    foreach($byDir as$sub=>$files){$set=array_flip($files);$name=$sub===''?$repo:basename($sub);$app=['name'=>$name,'subfolder'=>$sub,'type'=>'other','lang_label'=>'Other','framework'=>'','version'=>'','description'=>'','install_cmd'=>'','build_cmd'=>'','start_cmd'=>'','port'=>'','is_daemon'=>true];
        if(isset($set['package.json'])){$pkg=json_decode((string)gh_raw_get($owner,$repo,$branch,($sub!==''?$sub.'/':'').'package.json',$token),true);if(!is_array($pkg))throw new RuntimeException('Cannot read valid package.json at '.($sub?:'/').'; version inspection incomplete.');$scripts=$pkg['scripts']??[];$deps=array_keys(array_merge($pkg['dependencies']??[],$pkg['devDependencies']??[]));$frameworks=[];foreach(['express'=>'Express','fastify'=>'Fastify','hono'=>'Hono','next'=>'Next.js','nuxt'=>'Nuxt','telegraf'=>'Telegram Bot','grammy'=>'Telegram Bot','crawlee'=>'Scraper','playwright'=>'Scraper','puppeteer'=>'Scraper','wrangler'=>'Cloudflare','socket.io'=>'Socket.io']as$key=>$label)if(in_array($key,$deps))$frameworks[]=$label;$app=array_merge($app,['name'=>$pkg['name']??$name,'type'=>'node','lang_label'=>'Node.js','framework'=>implode(' • ',array_unique($frameworks))?:'Node.js / JS','version'=>$pkg['version']??'','description'=>$pkg['description']??'','install_cmd'=>isset($set['pnpm-lock.yaml'])?'pnpm install':(isset($set['yarn.lock'])?'yarn install':'npm install --include=dev --no-audit --no-fund'),'build_cmd'=>isset($scripts['build'])?'npm run build':'','start_cmd'=>isset($scripts['start'])?'npm start':(isset($set['server.js'])?'node server.js':(isset($set['index.js'])?'node index.js':'node app.js')),'port'=>'3000']);$app=gh_apply_runtime_profile($app,$pkg,in_array('local-deployer-ui.mjs',$byDir[($sub!==''?$sub.'/':'').'scripts']??[],true));
        }elseif(isset($set['requirements.txt'])||isset($set['pyproject.toml'])||isset($set['Pipfile'])||isset($set['app.py'])||isset($set['main.py'])||isset($set['bot.py'])||isset($set['scraper4.py'])||isset($set['deployer4.py'])||isset($set['server.py'])){$req=strtolower((string)gh_raw_get($owner,$repo,$branch,($sub!==''?$sub.'/':'').'requirements.txt',$token));$f=[];foreach(['fastapi','flask','django','telethon','pyrogram','aiogram','streamlit','scrapy','beautifulsoup4']as$key)if(strpos($req,$key)!==false)$f[]=$key;$pyEntry='python3 main.py';if(isset($set['scraper4.py']))$pyEntry='python3 scraper4.py';elseif(isset($set['app.py']))$pyEntry=in_array('fastapi',$f)?'uvicorn app:app --host 0.0.0.0 --port 8000':'python3 app.py';elseif(isset($set['main.py']))$pyEntry='python3 main.py';elseif(isset($set['server.py']))$pyEntry='python3 server.py';elseif(isset($set['run.py']))$pyEntry='python3 run.py';elseif(isset($set['bot.py']))$pyEntry='python3 bot.py';elseif(isset($set['manage.py']))$pyEntry='python3 manage.py runserver 0.0.0.0:8000';elseif(isset($set['deployer4.py']))$pyEntry='python3 deployer4.py';else{foreach($files as$fn){if(substr($fn,-3)==='.py'&&$fn[0]!=='.'&&$fn!=='__init__.py'){$pyEntry='python3 '.$fn;break;}}}$app=array_merge($app,['type'=>'python','lang_label'=>'Python 3','framework'=>implode(' • ',$f)?:'Python','install_cmd'=>isset($set['requirements.txt'])?'pip3 install -r requirements.txt':'pip3 install .','start_cmd'=>$pyEntry,'port'=>'8000']);
        }elseif(isset($set['composer.json'])||isset($set['index.php'])){$app=array_merge($app,['type'=>'php','lang_label'=>'PHP','framework'=>isset($set['artisan'])?'Laravel':'PHP','install_cmd'=>isset($set['composer.json'])?'composer install --no-dev -o':'','is_daemon'=>false]);
        }elseif(isset($set['go.mod'])){$app=array_merge($app,['lang_label'=>'Go','framework'=>'Go','install_cmd'=>'go mod download','build_cmd'=>'go build -o app','start_cmd'=>'./app','port'=>'8080']);
        }elseif(isset($set['Cargo.toml'])){$app=array_merge($app,['lang_label'=>'Rust','framework'=>'Rust','install_cmd'=>'cargo fetch','build_cmd'=>'cargo build --release','start_cmd'=>'./target/release/'.$name,'port'=>'8080']);
        }elseif(isset($set['index.html'])&&$sub===''){$app=array_merge($app,['type'=>'static','lang_label'=>'HTML/Static','is_daemon'=>false]);}else continue;$apps[]=$app;
    }return $apps;
}
// A dedicated, persistent storage root is separate from the file-browser start path.
function default_project_root(): string {
    $isAndroid = getenv('PREFIX') || is_dir('/data/data/com.termux') || is_dir('/sdcard');
    if ($isAndroid) {
        $termuxHome = getenv('HOME') ?: '/data/data/com.termux/files/home';
        if (is_dir($termuxHome) && wcp_is_dir_writable($termuxHome)) {
            $path = $termuxHome . '/webconsole-projects';
            if (!is_dir($path)) @mkdir($path, 0777, true);
            return $path;
        }
        if (is_dir('/sdcard') && wcp_is_dir_writable('/sdcard')) {
            $path = '/sdcard/webconsole-projects';
            if (!is_dir($path)) @mkdir($path, 0777, true);
            return $path;
        }
        $path = DATA_DIR . '/projects';
        if (!is_dir($path)) @mkdir($path, 0777, true);
        return $path;
    }
    $dataProj = DATA_DIR . '/projects';
    if (!is_dir($dataProj)) @mkdir($dataProj, 0777, true);
    if (wcp_is_dir_writable($dataProj)) {
        return $dataProj;
    }
    if (is_dir('/var/lib/webconsole-projects') && wcp_is_dir_writable('/var/lib/webconsole-projects')) {
        return '/var/lib/webconsole-projects';
    }
    if (is_dir('/var/lib') && wcp_is_dir_writable('/var/lib')) {
        return '/var/lib/webconsole-projects';
    }
    $home = getenv('HOME');
    if ($home && is_dir($home) && wcp_is_dir_writable($home)) {
        return $home . '/webconsole-projects';
    }
    return $dataProj;
}
function proj_storage_root(?string $value = null): string {
    $configured = $value ?? (string)cfg()['project_root'];
    if ($configured === '/var/lib/webconsole-projects' && (!is_dir('/var/lib') || !wcp_is_dir_writable('/var/lib'))) {
        $configured = default_project_root();
    }
    if ($configured === '' || $configured[0] !== '/' || preg_match('/[\x00-\x1f]/', $configured)) {
        $configured = default_project_root();
    }
    $root = norm_path($configured);
    if (!is_dir($root)) @mkdir($root, 0777, true);
    return safe_path($root);
}
function proj_execution_identity(): array {
    $uid=function_exists('posix_geteuid')?(string)posix_geteuid():trim(sh_ok('id -u'));
    $gid=function_exists('posix_getegid')?(string)posix_getegid():trim(sh_ok('id -g'));
    return ['uid'=>ctype_digit($uid)?(int)$uid:null,'gid'=>ctype_digit($gid)?(int)$gid:null];
}
function proj_storage_setup_script(string $root,array $identity): string {
    // This script is displayed for explicit SSH execution; PHP never runs it.
    $uid=$identity['uid'];$gid=$identity['gid'];
    if($uid===null||$gid===null||$uid===0||$gid===0)return '# No safe setup command: configure PHP with a dedicated non-root UID/GID first.';
    $script= <<<'SH'
#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" -eq 0 ] || { echo "Run this setup in a root SSH session, not WebConsole." >&2; exit 1; }
SH;
    $script.="\nroot=".esc($root)."\nuid=".(int)$uid."\ngid=".(int)$gid."\n";
    $script.= <<<'SH'
# Refuse symlinks and untrusted writable ancestors. Never chown recursively.
parent=$(dirname "$root")
while :; do
  [ ! -L "$parent" ] || { echo "Symlink ancestor refused: $parent" >&2; exit 1; }
  [ -d "$parent" ] || { echo "Create the trusted parent first: $parent" >&2; exit 1; }
  [ "$(stat -c %u -- "$parent")" = 0 ] || { echo "Parent is not root-owned: $parent" >&2; exit 1; }
  mode=$(stat -c %a -- "$parent")
  [ $((0$mode & 022)) -eq 0 ] || { echo "Writable ancestor refused: $parent" >&2; exit 1; }
  [ "$parent" != / ] || break
  parent=$(dirname "$parent")
done
[ ! -L "$root" ] || { echo "Symlink target refused." >&2; exit 1; }
if [ -e "$root" ]; then
  [ -d "$root" ] || { echo "Target is not a directory." >&2; exit 1; }
  owner=$(stat -c %u -- "$root")
  if [ "$owner" != "$uid" ]; then
    [ "$owner" = 0 ] && [ -z "$(find "$root" -mindepth 1 -maxdepth 1 -printf x -quit)" ] || { echo "Existing directory belongs to another account or contains data; refusing takeover." >&2; exit 1; }
  fi
else
  mkdir -m 0700 -- "$root"
fi
chown --no-dereference "$uid:$gid" -- "$root"
chmod 0700 -- "$root"
echo "Managed project storage prepared: $root (UID $uid / GID $gid). Return to WebConsole and run the write test."
SH;
    return $script."\n";
}
function proj_storage_status(bool $probe=false): array {
    $root=proj_storage_root();$identity=proj_execution_identity();clearstatcache(true,$root);
    $ready=is_dir($root)&&is_writable($root)&&is_executable($root);
    $error=$ready?'':'Storage is missing or not writable by the PHP execution account. Run the one-time SSH setup.';
    if($probe&&$ready){$dir=$root.'/.wcp-probe-'.wcp_random(8);$made=@mkdir($dir,0700);$ready=$made&&@file_put_contents($dir.'/write-test','ok')===2;if($made){@unlink($dir.'/write-test');if(!@rmdir($dir))$ready=false;}if(!$ready)$error='Actual directory/file write test failed; check mount permissions, ACLs, quota, SELinux/AppArmor and available disk space.';}
    return ['root'=>$root,'ready'=>$ready,'uid'=>$identity['uid'],'gid'=>$identity['gid'],'probed'=>$probe,'error'=>$error,'setup_script'=>proj_storage_setup_script($root,$identity)];
}
function proj_managed_path(string $name,string $id): string {
    $root=proj_storage_root();$slug=substr(gh_slug($name),0,64);$id=gh_slug($id);
    return $root.'/'.$slug.'-'.$id;
}
function proj_resolve_deploy_path(array $p, ?array $existing = null): string {
    $path = trim((string)($p['deploy_path'] ?? ''));
    if ($path === '') {
        $path = !empty($existing['deploy_path']) ? $existing['deploy_path'] : proj_managed_path($p['name'], $p['id'] ?? wcp_random(5));
    }
    
    $target = safe_path($path);
    $parent = $target;
    while (!file_exists($parent) && $parent !== '/' && $parent !== '') {
        $parent = dirname($parent);
    }
    
    $isWritable = is_dir($parent) && wcp_is_dir_writable($parent);
    
    if (!$isWritable) {
        if (strpos($parent, '/var/www') === 0 || strpos($parent, '/var/lib') === 0) {
            @shell_exec('sudo -n chown -R www-data:www-data ' . escapeshellarg($parent) . ' 2>/dev/null || sudo -n chmod 777 ' . escapeshellarg($parent) . ' 2>/dev/null');
            clearstatcache(true, $parent);
            $isWritable = is_dir($parent) && wcp_is_dir_writable($parent);
        }
        
        if (!$isWritable) {
            $root = proj_storage_root();
            if (!wcp_is_dir_writable($root)) {
                $root = DATA_DIR . '/projects';
                if (!is_dir($root)) @mkdir($root, 0777, true);
            }
            $slug = substr(gh_slug($p['name']), 0, 64);
            $id = gh_slug($p['id'] ?? wcp_random(5));
            $path = $root . '/' . $slug . '-' . $id;
        }
    }
    
    if (!is_dir($path)) @mkdir($path, 0777, true);
    return safe_path($path);
}
function proj_runtime_env(array $p): array {
    $base = DATA_DIR . '/runtime/' . gh_slug((string)$p['id']);
    foreach ([$base, $base . '/home', $base . '/cache', $base . '/tmp'] as $dir) {
        if (is_link($dir) || (!is_dir($dir) && !@mkdir($dir, 0700, true)) || !wcp_is_dir_writable($dir)) {
            throw new RuntimeException('Private project runtime directory is not writable: ' . $dir);
        }
    }
    $defaults = ['XDG_CACHE_HOME' => $base . '/cache', 'npm_config_cache' => $base . '/cache/npm', 'PIP_CACHE_DIR' => $base . '/cache/pip', 'TMPDIR' => $base . '/tmp'];
    if (strpos((string)($p['deploy_path'] ?? ''), rtrim(norm_path((string)cfg()['project_root']), '/') . '/') === 0) $defaults['HOME'] = $base . '/home';
    $port = !empty($p['port']) ? (string)$p['port'] : '8000';
    $defaults['PORT'] = $port;
    $defaults['APP_PORT'] = $port;
    $defaults['FLASK_RUN_PORT'] = $port;
    $defaults['SERVER_PORT'] = $port;
    $defaults['SCRAPER_PORT'] = $port;
    $defaults['DEPLOYER_UI_PORT'] = $port;
    $defaults['UVICORN_PORT'] = $port;
    $defaults['WEB_PORT'] = $port;
    $defaults['PORT_NUMBER'] = $port;
    if (isset($p['env']['NPM_CONFIG_CACHE'])) unset($defaults['npm_config_cache']);
    return array_merge($defaults, $p['env'] ?? []);
}
function proj_empty_location(string $path): bool {
    if($path==='')return true;
    for($part=norm_path($path);$part!=='/';$part=dirname($part))if(is_link($part))return false;
    if(!file_exists($path)){for($parent=dirname($path);!file_exists($parent)&&$parent!=='/';$parent=dirname($parent)){}return is_dir($parent)&&is_readable($parent)&&is_executable($parent);}
    if(!is_dir($path)||!is_readable($path))return false;
    $files=@scandir($path);return is_array($files)&&count(array_diff($files,['.','..']))===0;
}

function proj_all(): array {$j=json_decode((string)@file_get_contents(DATA_DIR.'/projects.json'),true);return is_array($j)?$j:[];}
function proj_save_all(array $list){if(!wcp_put_contents(DATA_DIR.'/projects.json',json_encode(array_values($list),JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),true))throw new RuntimeException('Cannot save projects');}
function proj_find(array $list,string $id): ?array {foreach($list as$p)if(($p['id']??'')===$id)return $p;return null;}
function proj_repo_url(array $p): string {
    $raw=trim($p['repo_url']??'');if($raw===''||$raw[0]==='/')return $raw;if(!empty($p['auth_token'])&&preg_match('~^https://github\.com/~',$raw))return 'https://wcp:'.rawurlencode($p['auth_token']).'@'.substr($raw,8);return $raw;
}
function proj_check_remote_commit(array $p): ?string {
    $rawUrl = trim($p['repo_url'] ?? '');
    $branch = trim($p['branch'] ?? '') ?: 'main';
    if (empty($rawUrl)) return null;

    if (preg_match('#(?:github\.com/|github\.com:)([^/]+)/([^/\.]+)(?:\.git)?#i', $rawUrl, $m)) {
        $owner = $m[1];
        $repoName = preg_replace('/\.git$/i', '', $m[2]);
        $apiUrl = 'https://api.github.com/repos/' . rawurlencode($owner) . '/' . rawurlencode($repoName) . '/commits/' . rawurlencode($branch);
        $headers = ['User-Agent: WebConsole-Agent/1.4.9', 'Accept: application/vnd.github.v3+json'];
        if (!empty($p['auth_token'])) {
            $headers[] = 'Authorization: token ' . $p['auth_token'];
        } elseif (!empty(cfg()['gh_token'])) {
            $headers[] = 'Authorization: token ' . cfg()['gh_token'];
        }
        $cfProxy = trim(cfg()['cf_proxy'] ?? '');
        $proxyMode = cfg()['cf_proxy_mode'] ?? 'auto';
        $finalUrl = $apiUrl;
        if (!empty($cfProxy) && in_array($proxyMode, ['all', 'auto'], true)) {
            $proxyBase = rtrim($cfProxy, '/');
            if (strpos($proxyBase, '://') === false) $proxyBase = 'https://' . $proxyBase;
            $finalUrl = $proxyBase . '/?url=' . rawurlencode($apiUrl);
        }

        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => implode("\r\n", $headers),
                'timeout' => 8,
                'ignore_errors' => true
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false
            ]
        ]);

        $res = @file_get_contents($finalUrl, false, $ctx);
        if ($res !== false) {
            $data = @json_decode($res, true);
            if (!empty($data['sha']) && preg_match('/^[a-f0-9]{7,40}$/i', $data['sha'])) {
                return substr($data['sha'], 0, 7);
            }
        }
    }

    $url = proj_repo_url($p);
    if (empty($url)) return null;
    $cmd = 'git -c safe.directory=* ls-remote ' . esc($url) . ' ' . esc('refs/heads/' . $branch) . ' ' . esc($branch);
    $out = trim(sh($cmd, $rc));
    if ($rc === 0 && !empty($out)) {
        foreach (explode("\n", $out) as $line) {
            $parts = preg_split('/\s+/', trim($line));
            if (!empty($parts[0]) && preg_match('/^[a-f0-9]{7,40}$/i', $parts[0])) {
                return substr($parts[0], 0, 7);
            }
        }
    }

    $cmdHead = 'git -c safe.directory=* ls-remote ' . esc($url) . ' HEAD';
    $outHead = trim(sh($cmdHead, $rcHead));
    if ($rcHead === 0 && !empty($outHead)) {
        foreach (explode("\n", $outHead) as $line) {
            $parts = preg_split('/\s+/', trim($line));
            if (!empty($parts[0]) && preg_match('/^[a-f0-9]{7,40}$/i', $parts[0])) {
                return substr($parts[0], 0, 7);
            }
        }
    }

    return null;
}
if (!function_exists('wcp_array_is_list')) {
    function wcp_array_is_list(array $arr): bool {
        if ($arr === []) return true;
        return array_keys($arr) === range(0, count($arr) - 1);
    }
}
function wcp_merge_json_data($base, $override) {
    if (is_array($base) && is_array($override)) {
        if (wcp_array_is_list($base) || wcp_array_is_list($override)) {
            return !empty($override) ? $override : $base;
        }
        $merged = $base;
        foreach ($override as $k => $v) {
            if (isset($merged[$k]) && is_array($merged[$k]) && is_array($v)) {
                $merged[$k] = wcp_merge_json_data($merged[$k], $v);
            } else {
                $merged[$k] = $v;
            }
        }
        return $merged;
    }
    return $override !== null ? $override : $base;
}

function proj_perform_deploy(array $p, ?string &$commitOut = null): array {
    $repo = CACHE_DIR . '/proj-' . $p['id'];
    $branch = $p['branch'] ?: 'main';
    $sub = trim($p['subfolder'] ?? '', '/');
    $dest = proj_resolve_deploy_path($p);
    $preflight = proj_preflight($p);
    foreach ($preflight['checks'] as $check) {
        cli_log('[preflight] ' . ($check['ok'] ? 'OK ' : 'FAIL ') . $check['name'] . ': ' . $check['detail']);
    }
    if (!$preflight['ok']) throw new RuntimeException('Deployment preflight failed. Resolve failed checks before retrying.');
    if (!is_dir($dest) && !@mkdir($dest, 0750, true) && !is_dir($dest)) throw new RuntimeException('Cannot create deployment directory: ' . $dest);
    cli_log('Deploying ' . $p['name'] . ' -> ' . $dest);
    if (is_dir($repo . '/.git')) {
        $g = 'git -c safe.directory=* -C ' . esc($repo) . ' ';
        cli_checked($g . 'remote set-url origin ' . esc(proj_repo_url($p)));
        cli_run($g . 'fetch origin ' . esc($branch) . ' && ' . $g . 'checkout --detach --force FETCH_HEAD && ' . $g . 'clean -fd', $rc);
        if ($rc !== 0) {
            cli_log('[git] Fetch failed. Re-cloning repository...');
            sh('rm -rf -- ' . esc($repo));
        }
    }
    if (!is_dir($repo . '/.git')) {
        cli_checked('git -c safe.directory=* clone --depth 1 --branch ' . esc($branch) . ' -- ' . esc(proj_repo_url($p)) . ' ' . esc($repo));
    }
    $commit = trim(sh_ok('git -c safe.directory=* -C ' . esc($repo) . ' rev-parse --short HEAD'));
    $commitOut = $commit;
    $src = $sub !== '' ? manifest_path($repo, $sub) : $repo;
    if (!is_dir($src)) throw new RuntimeException('Repository subfolder does not exist');
    // Parse and preserve any existing local .env variables
    $existingEnv = [];
    if (file_exists($dest . '/.env')) {
        $rawEnv = (string)@file_get_contents($dest . '/.env');
        foreach (preg_split('/\r\n|\r|\n/', $rawEnv) as $l) {
            $l = trim($l);
            if ($l === '' || $l[0] === '#' || strpos($l, '=') === false) continue;
            [$k, $v] = explode('=', $l, 2);
            $k = trim($k);
            if (preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $k)) {
                $existingEnv[$k] = trim($v);
            }
        }
    }

    $shouldPreserve = ($p['preserve_configs'] ?? true) !== false;

    // 1. Backup and snapshot existing JSON configs if preservation is enabled
    $knownConfigFiles = [
        'config.json', 'settings.json', 'scraper-config.json', 'options.json',
        'deployer-config.json', 'channels.json', 'targets.json', 'users.json',
        'auth.json', 'secrets.json', 'custom.json', 'worker-config.json'
    ];
    $savedConfigs = [];
    if ($shouldPreserve) {
        foreach ($knownConfigFiles as $cfName) {
            $destFile = $dest . '/' . $cfName;
            if (file_exists($destFile)) {
                $rawJson = @file_get_contents($destFile);
                $parsed = @json_decode((string)$rawJson, true);
                if (is_array($parsed)) {
                    $savedConfigs[$cfName] = $parsed;
                    @wcp_put_contents($destFile . '.wcp_bak', (string)$rawJson);
                }
            }
        }
    }

    // Exclude persistent directories, databases, and configuration from being wiped out on updates
    $rsyncExcludes = $shouldPreserve ? [
        '.git', 'node_modules', '.env', '.env.*', '.env.local', '.env.wcp',
        'data/', 'storage/', 'uploads/', 'sessions/', 'logs/', 'db/',
        '*.sqlite', '*.sqlite3', '*.db', '*.local.*', 'config.local.*', '*.wcp_bak'
    ] : [
        '.git', 'node_modules', '.env.wcp'
    ];
    $excludeArgs = implode(' ', array_map(fn($x) => '--exclude=' . escapeshellarg($x), $rsyncExcludes));

    if (which('rsync')) {
        cli_checked('rsync -a --delete ' . $excludeArgs . ' ' . esc(rtrim($src, '/') . '/') . ' ' . esc(rtrim($dest, '/') . '/'));
    } else {
        $tarExcludes = implode(' ', array_map(fn($x) => '--exclude=' . escapeshellarg(rtrim($x, '/')), $rsyncExcludes));
        cli_checked('bash -o pipefail -c ' . esc('tar -C ' . esc($src) . ' ' . $tarExcludes . ' -cf - . | tar -C ' . esc($dest) . ' -xf -'));
    }

    // Build .env text
    $finalEnv = $shouldPreserve ? $existingEnv : [];
    if (!empty($p['port'])) {
        $portStr = (string)$p['port'];
        $finalEnv['PORT'] = $portStr;
        $finalEnv['APP_PORT'] = $portStr;
        $finalEnv['FLASK_RUN_PORT'] = $portStr;
        $finalEnv['SERVER_PORT'] = $portStr;
        $finalEnv['SCRAPER_PORT'] = $portStr;
        $finalEnv['DEPLOYER_UI_PORT'] = $portStr;
        $finalEnv['UVICORN_PORT'] = $portStr;
        $finalEnv['WEB_PORT'] = $portStr;
    }
    foreach ($p['env'] ?? [] as $k => $v) {
        $finalEnv[$k] = (string)$v;
    }

    $envTxt = $shouldPreserve ? "# Merged and preserved by WebConsole (Updated: " . date('Y-m-d H:i:s') . ")\n" : "# Clean deploy by WebConsole (Updated: " . date('Y-m-d H:i:s') . ")\n";
    foreach ($finalEnv as $k => $v) {
        $envTxt .= $k . '=' . $v . "\n";
    }
    wcp_put_contents($dest . '/.env.wcp', $envTxt);
    @chmod($dest . '/.env.wcp', 0600);
    wcp_put_contents($dest . '/.env', $envTxt);

    // Restore and deep-merge preserved JSON configuration files if preservation enabled
    if ($shouldPreserve && !empty($savedConfigs)) {
        foreach ($savedConfigs as $cfName => $userCfg) {
            $destFile = $dest . '/' . $cfName;
            $srcFile = $src . '/' . $cfName;
            $repoCfg = file_exists($srcFile) ? @json_decode((string)@file_get_contents($srcFile), true) : [];
            if (!is_array($repoCfg)) $repoCfg = [];
            $mergedJson = wcp_merge_json_data($repoCfg, $userCfg);
            wcp_put_contents($destFile, json_encode($mergedJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            cli_log("[config-guard] Preserved and merged {$cfName} settings successfully.");
        }
    }
    foreach (['install' => ($p['install_cmd'] ?: default_install_cmd($p['type'])), 'build' => $p['build_cmd']] as $label => $cmd) {
        if (trim($cmd) === '') continue;
        $script = "#!/bin/bash\nset -e\nset -o pipefail\ncd " . esc($dest) . "\n";
        $script .= "pip() { if [ \"\$1\" = \"install\" ] && echo \"\$*\" | grep -q -- \"-r \"; then local req_file=\"\"; local args=(); local skip_next=0; for arg in \"\$@\"; do if [ \"\$skip_next\" -eq 1 ]; then req_file=\"\$arg\"; skip_next=0; elif [ \"\$arg\" = \"-r\" ] || [ \"\$arg\" = \"--requirement\" ]; then skip_next=1; else args+=(\"\$arg\"); fi; done; if [ -n \"\$req_file\" ]; then if [ ! -f \"\$req_file\" ]; then echo \"[pip-smart NOTICE] Requirements file '\$req_file' not present in project directory. Skipping.\"; return 0; fi; if ! command pip \"\$@\" 2>/dev/null; then echo \"[pip-smart] Bulk install encountered platform-incompatible dependencies (e.g. desktop browser binaries on Android/ARM64). Installing compatible packages line-by-line...\"; while IFS= read -r line || [ -n \"\$line\" ]; do pkg=\$(echo \"\$line\" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*\$//' -e 's/#.*//'); if [ -n \"\$pkg\" ]; then if ! command pip install \"\${args[@]:1}\" \"\$pkg\" --no-warn-script-location 2>/dev/null; then echo \"[pip-smart WARNING] Skipped incompatible package on \$(uname -m): \$pkg\"; fi; fi; done < \"\$req_file\"; echo \"[pip-smart] Resilient package installation completed.\"; return 0; fi; return 0; fi; fi; command pip \"\$@\"; }\n";
        $script .= "pip3() { pip \"\$@\"; }\n";
        foreach (proj_runtime_env($p) as $k => $v) $script .= 'export ' . esc($k . '=' . $v) . "\n";
        $script .= str_replace(["\r\n", "\r"], "\n", $cmd) . "\n";
        $script = str_replace(["\r\n", "\r"], "\n", $script);
        $f = CACHE_DIR . '/deploy-step-' . $p['id'] . '-' . time() . '.sh';
        wcp_put_contents($f, $script, false);
        @chmod($f, 0755);
        try { cli_checked('bash ' . esc($f)); } finally { @unlink($f); }
        cli_log($label . ' completed');
    }
    $list = proj_all();
    foreach ($list as &$x) {
        if ($x['id'] === $p['id']) {
            $x['last_deploy'] = ['time' => date('c'), 'commit' => $commit, 'status' => 'ok'];
            $p = $x;
        }
    }
    unset($x);
    proj_save_all($list);
    wcp_put_contents($dest . '/.deploy.json', json_encode([
        'project' => $p['name'],
        'commit' => $commit,
        'branch' => $branch,
        'time' => date('c'),
        'by' => 'webconsole'
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    return $p;
}
function proj_service_job(array $p): ?array {
    $jobs=[];foreach(glob(JOBS_DIR.'/*.json')?:[]as$f){$j=json_decode((string)@file_get_contents($f),true);if(($j['type']??'')==='service'&&($j['params']['project_id']??'')===$p['id'])$jobs[]=$j;}usort($jobs,fn($a,$b)=>strcmp($b['created'],$a['created']));foreach($jobs as$j)if(job_status($j)['status']==='running')return $j;return $jobs[0]??null;
}
function public_project(array $p): array {$p['has_token_hint']=!empty($p['auth_token']);unset($p['auth_token']);return $p;}
function sysinfo(): array {
    $mem=['total'=>0,'avail'=>0];$swap=['total'=>0,'free'=>0];
    foreach(@file('/proc/meminfo')?:[]as$l){
        if(preg_match('/^MemTotal:\s+(\d+)/',$l,$m))$mem['total']=(int)$m[1]*1024;
        if(preg_match('/^MemAvailable:\s+(\d+)/',$l,$m))$mem['avail']=(int)$m[1]*1024;
        if(preg_match('/^SwapTotal:\s+(\d+)/',$l,$m))$swap['total']=(int)$m[1]*1024;
        if(preg_match('/^SwapFree:\s+(\d+)/',$l,$m))$swap['free']=(int)$m[1]*1024;
    }
    $parse=function($s){if(!preg_match('/^cpu\s+(.+)$/m',(string)$s,$m))return null;$a=array_map('intval',preg_split('/\s+/',trim($m[1])));return [array_sum(array_slice($a,0,8)),($a[3]??0)+($a[4]??0)];};
    $a=$parse(@file_get_contents('/proc/stat'));usleep(120000);$b=$parse(@file_get_contents('/proc/stat'));
    $cpu=$a&&$b&&$b[0]>$a[0]?round(100*(1-($b[1]-$a[1])/($b[0]-$a[0])),1):null;
    $load=sys_getloadavg()?:[0,0,0];
    $tools=[];foreach(['git','tmux','screen','zip','rsync','composer','npm','node','python3','pip3','tar','setsid','nice']as$t)$tools[$t]=which($t);
    $tools['mysqldump']=which('mysqldump')||which('mariadb-dump');
    return ['host'=>gethostname(),'kernel'=>php_uname('s').' '.php_uname('r').' '.php_uname('m'),'php'=>PHP_VERSION,'user'=>sh_ok('id -un')?:get_current_user(),'cores'=>(int)sh_ok("grep -c '^processor' /proc/cpuinfo"),'load'=>array_map(fn($v)=>round($v,2),$load),'cpu_pct'=>$cpu,'mem'=>['total'=>$mem['total'],'used'=>$mem['total']-$mem['avail']],'swap'=>['total'=>$swap['total'],'used'=>$swap['total']-$swap['free']],'disk'=>['total'=>disk_total_space('/')?:0,'free'=>disk_free_space('/')?:0],'uptime'=>(int)(float)@file_get_contents('/proc/uptime'),'web'=>$_SERVER['SERVER_SOFTWARE']??'cli','term_mode'=>term_mode(),'ip'=>client_ip(),'tools'=>$tools];
}

function emergency_rescue(): array {
    $actions=[];$killed=0;
    $procs=sh("ps -eo pid,ppid,stat,comm,args --no-headers 2>/dev/null");
    foreach(explode("\n",trim($procs))as$line){
        $parts=preg_split('/\s+/',trim($line),5);if(count($parts)<5)continue;
        [$pid,$ppid,$stat,$comm,$args]=$parts;$pid=(int)$pid;$ppid=(int)$ppid;if($pid<=1||$pid===getmypid())continue;
        if(strpos($stat,'Z')!==false||($ppid===1&&preg_match('/(chromium|chrome|headless_shell)/i',$args))){@sh("kill -9 $pid 2>/dev/null");$killed++;}
    }
    if($killed>0)$actions[]="$killed پردازش زامبی و مرورگر معلق پاک‌سازی شد.";
    @sh("sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || sudo -n sysctl -w vm.drop_caches=3 2>/dev/null");
    $actions[]="حافظه کش دیسک (PageCache) تخلیه و آزاد شد.";
    $fpmPids=sh("pgrep -f 'php-fpm: master' 2>/dev/null");
    if(!empty(trim($fpmPids))){foreach(explode("\n",trim($fpmPids))as$fpid){$fpid=(int)trim($fpid);if($fpid>1)@sh("kill -USR2 $fpid 2>/dev/null || sudo -n kill -USR2 $fpid 2>/dev/null");}$actions[]="استخر پردازش‌های PHP-FPM بازنشانی (Reload) شد.";}
    return ['actions'=>$actions,'killed'=>$killed];
}

function create_swap(int $sizeMb = 2048): array {
    if(!is_file('/swapfile')){
        $cmd="sudo -n fallocate -l {$sizeMb}M /swapfile 2>/dev/null || sudo -n dd if=/dev/zero of=/swapfile bs=1M count={$sizeMb} 2>/dev/null";
        sh($cmd);sh("sudo -n chmod 600 /swapfile 2>/dev/null; sudo -n mkswap /swapfile 2>/dev/null; sudo -n swapon /swapfile 2>/dev/null");
    }else{sh("sudo -n swapon /swapfile 2>/dev/null");}
    $total=0;foreach(@file('/proc/meminfo')?:[]as$l){if(preg_match('/^SwapTotal:\s+(\d+)/',$l,$m))$total=(int)$m[1]*1024;}
    return ['total'=>$total,'ok'=>$total>0];
}
function check_file_syntax(string $path, string $content): array {
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (in_array($ext, ['php', 'phtml', 'inc'], true) || strpos($content, '<?php') !== false) {
        $tmp = tempnam(sys_get_temp_dir(), 'wc_syn_');
        file_put_contents($tmp, $content);
        $out = trim(sh_ok("php -l " . esc($tmp) . " 2>&1"));
        @unlink($tmp);
        $ok = strpos($out, 'No syntax errors detected') !== false;
        $cleanOut = preg_replace('/in ' . preg_quote($tmp, '/') . '/', 'in ' . basename($path), $out);
        return ['ok' => $ok, 'type' => 'PHP', 'msg' => $cleanOut];
    }
    if ($ext === 'json') {
        json_decode($content);
        $err = json_last_error();
        return ['ok' => $err === JSON_ERROR_NONE, 'type' => 'JSON', 'msg' => $err === JSON_ERROR_NONE ? 'فرمت JSON معتبر است.' : json_last_error_msg()];
    }
    if ($ext === 'py') {
        $tmp = tempnam(sys_get_temp_dir(), 'wc_py_');
        file_put_contents($tmp, $content);
        $out = trim(sh_ok("python3 -m py_compile " . esc($tmp) . " 2>&1"));
        @unlink($tmp);
        $ok = empty($out);
        return ['ok' => $ok, 'type' => 'Python', 'msg' => $ok ? 'گرامر Python معتبر است.' : $out];
    }
    if (in_array($ext, ['sh', 'bash'], true)) {
        $tmp = tempnam(sys_get_temp_dir(), 'wc_sh_');
        file_put_contents($tmp, $content);
        $out = trim(sh_ok("bash -n " . esc($tmp) . " 2>&1"));
        @unlink($tmp);
        $ok = empty($out);
        return ['ok' => $ok, 'type' => 'Shell', 'msg' => $ok ? 'اسکریپت Bash معتبر است.' : $out];
    }
    if (in_array($ext, ['yml', 'yaml'], true)) {
        $tmp = tempnam(sys_get_temp_dir(), 'wc_yml_');
        file_put_contents($tmp, $content);
        $out = trim(sh_ok('python3 -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]))" ' . esc($tmp) . ' 2>&1'));
        @unlink($tmp);
        if (strpos($out, "No module named 'yaml'") !== false) {
            return ['ok' => true, 'type' => 'YAML', 'msg' => 'بررسی سینتکس YAML (ماژول pyyaml نصب نیست)'];
        }
        $ok = empty($out);
        return ['ok' => $ok, 'type' => 'YAML', 'msg' => $ok ? 'فرمت YAML معتبر است.' : $out];
    }
    return ['ok' => true, 'type' => strtoupper($ext ?: 'TEXT'), 'msg' => 'بررسی سینتکس برای این نوع فایل نیاز نیست.'];
}



function handle_api() {
    $in=body();$api=$in['api']??'';if(!ip_allowed())jout(false,null,'IP is not allowed',403);
    // Passive background auto-update check (every 30s)
    $lastCheckFile = CACHE_DIR . '/last_auto_poll_ts';
    $lastTs = (int)@file_get_contents($lastCheckFile);
    if (time() - $lastTs >= 30) {
        @wcp_put_contents($lastCheckFile, (string)time());
        proj_poll_auto_updates();
    }
    if(!in_array($api,['auth.login','auth.setup'],true)){require_auth();if($api!=='fs.download'&&!csrf_ok())jout(false,null,'توکن CSRF نامعتبر',403);}
    switch($api){
    case 'auth.setup':
        if(cfg()['pass_hash']!=='')jout(false,null,'قبلاً رمز تنظیم شده است');$pw=(string)($in['password']??'');if(strlen($pw)<8)jout(false,null,'رمز حداقل ۸ کاراکتر باشد');
        try{cfg_save(['pass_hash'=>password_hash($pw,PASSWORD_DEFAULT)]);}catch(Throwable $e){jout(false,null,'خطا در ذخیره پیکربندی در ترموکس/حافظه: '.$e->getMessage());}
        do_login($pw);jout(true,['csrf'=>$_SESSION['wcp_csrf']]);
    case 'auth.login':
        if(cfg()['pass_hash']==='')jout(true,['setup'=>true]);if(login_locked()>0)jout(false,null,'ورود موقتاً قفل شده است',429);if(do_login((string)($in['password']??'')))jout(true,['csrf'=>$_SESSION['wcp_csrf']]);jout(false,null,'رمز عبور اشتباه است',401);
    case 'auth.logout':
        $_SESSION=[];
        if(ini_get("session.use_cookies")){$params=session_get_cookie_params();setcookie(session_name(),'',time()-42000,$params["path"],$params["domain"],$params["secure"],$params["httponly"]);}
        @session_destroy();
        jout(true);
    case 'auth.change':
        if(!password_verify((string)($in['old']??''),cfg()['pass_hash']))jout(false,null,'رمز فعلی اشتباه است');if(strlen((string)($in['new']??''))<8)jout(false,null,'رمز حداقل ۸ کاراکتر باشد');cfg_save(['pass_hash'=>password_hash($in['new'],PASSWORD_DEFAULT)]);jout(true);
    case 'ping': jout(true,['v'=>WCP_VERSION,'user'=>$_SESSION['wcp_user']??'']);
    case 'sysinfo': jout(true,sysinfo());
    case 'sys.emergency_rescue': jout(true,emergency_rescue());
    case 'sys.create_swap': jout(true,create_swap((int)($in['size_mb']??2048)));
            case 'ports.disable_service':
        $unit = trim((string)($in['unit'] ?? ''));
        if ($unit === '' || !preg_match('/^[a-zA-Z0-9_\-\.\@]+\.service$/', $unit)) {
            jout(false, null, 'نام سرویس سیستمی نامعتبر است');
        }
        $cmd = "systemctl stop " . esc($unit) . " 2>/dev/null || sudo -n systemctl stop " . esc($unit) . " 2>/dev/null; ";
        $cmd .= "systemctl disable " . esc($unit) . " 2>/dev/null || sudo -n systemctl disable " . esc($unit) . " 2>/dev/null; ";
        $cmd .= "systemctl mask " . esc($unit) . " 2>/dev/null || sudo -n systemctl mask " . esc($unit) . " 2>/dev/null";
        $out = sh_ok($cmd);
        jout(true, ['unit' => $unit, 'message' => 'سرویس سیستمی ' . $unit . ' با موفقیت متوقف و غیرفعال شد.']);
    case 'ports.list':
        $pList = wcp_get_listening_ports();
        jout(true, ['list' => $pList, 'count' => count($pList)]);
    case 'ports.kill':
        $port = (int)($in['port'] ?? 0);
        $pid = (int)($in['pid'] ?? 0);
        if ($port <= 0 && $pid <= 0) jout(false, null, 'شماره پورت یا شناسه پردازش مشخص نشده است');
        $k = is_executable('/bin/kill') ? '/bin/kill' : 'kill';
        if ($pid > 0 && $pid !== getmypid()) {
            sh($k . ' -9 ' . $pid . ' 2>/dev/null || (sudo -n ' . $k . ' -9 ' . $pid . ' 2>/dev/null)');
        }
        if ($port > 0) {
            wcp_kill_port($port);
        }
        usleep(200000);
        jout(true, ['port' => $port, 'pid' => $pid, 'message' => 'پورت با موفقیت آزاد شد']);
    case 'proc.list':
        $procs=[];$cpu=0;$mem=0;foreach(explode("\n",trim(sh_ok('ps -eo pid,user,%cpu,%mem,vsz,rss,stat,start,time,comm,args --no-headers')))as$l){$p=preg_split('/\s+/',trim($l),11);if(count($p)<10)continue;$cpu+=(float)$p[2];$mem+=(float)$p[3];$procs[]=['pid'=>(int)$p[0],'user'=>$p[1],'cpu'=>(float)$p[2],'mem'=>(float)$p[3],'vsz'=>(int)$p[4],'rss'=>(int)$p[5],'stat'=>$p[6],'start'=>$p[7],'time'=>$p[8],'comm'=>$p[9],'args'=>$p[10]??$p[9]];}jout(true,['list'=>$procs,'count'=>count($procs),'total_cpu'=>round($cpu,1),'total_mem'=>round($mem,1),'my_pid'=>getmypid()]);
    case 'proc.kill':
        $pid=(int)($in['pid']??0);$sig=(int)($in['sig']??15);if($pid<=1||$pid===getmypid())jout(false,null,'Invalid/protected PID');if(!in_array($sig,[1,2,9,15]))$sig=15;$out=sh('kill -'.$sig.' '.$pid,$rc);if($rc!==0&&is_dir('/proc/'.$pid))jout(false,null,$out?:'Permission denied');act_log("Signal $sig to PID $pid");jout(true,['pid'=>$pid,'sig'=>$sig]);
    case 'proc.info':
        $pid=(int)($in['pid']??0);if($pid<1||!is_dir('/proc/'.$pid))jout(false,null,'Process does not exist');$d='/proc/'.$pid;jout(true,['pid'=>$pid,'cmdline'=>str_replace("\0",' ',(string)@file_get_contents($d.'/cmdline')),'cwd'=>@readlink($d.'/cwd')?:'','exe'=>@readlink($d.'/exe')?:'','status'=>(string)@file_get_contents($d.'/status'),'raw_stat'=>sh_ok('ps -p '.$pid.' -o pid,user,%cpu,%mem,vsz,rss,stat,start,time,comm,args --no-headers')]);
    case 'fs.list':
        $r=fs_scan_dir((string)($in['path']??'/'),(string)($in['sort']??'name'),(bool)($in['asc']??true));$r['items']=array_values(array_filter($r['items'],fn($i)=>!empty($in['hidden'])||$i['name'][0]!=='.'));jout(true,$r);
    case 'fs.read':
        $p=safe_path((string)$in['path']);
        if(!is_file($p))jout(false,null,'فایل یافت نشد');
        $sz=filesize($p);$isLarge=$sz>MAX_EDIT;$allowLarge=!empty($in['allow_large'])||!empty($in['head_only']);
        if($isLarge&&!$allowLarge){jout(false,['size'=>$sz,'is_large'=>true,'max'=>MAX_EDIT],'حجم فایل بیشتر از حد مجاز ویرایشگر (' . round(MAX_EDIT / (1024*1024)) . ' مگابایت) است.');}
        $c='';$isTruncated=false;
        if($isLarge&&$allowLarge){$fp=@fopen($p,'rb');if($fp){$c=(string)fread($fp,1048576);fclose($fp);$isTruncated=true;}}else{$c=(string)@file_get_contents($p);}
        if($c===false)jout(false,null,'امکان خواندن محتوای فایل وجود ندارد');
        if(!mb_check_encoding($c,'UTF-8')){$c=mb_convert_encoding($c,'UTF-8','UTF-8, ISO-8859-1, Windows-1256, Windows-1252, ASCII, auto');}
        $st=@stat($p);
        jout(true,['path'=>$p,'name'=>basename($p),'content'=>$c,'size'=>$sz,'mtime'=>$st['mtime']??filemtime($p),'is_writable'=>is_writable($p),'perms'=>substr(sprintf('%o',fileperms($p)),-4),'line_count'=>substr_count($c,"\n")+1,'is_truncated'=>$isTruncated,'line_ending'=>strpos($c,"\r\n")!==false?'CRLF':'LF']);
    case 'fs.save':
        $p=safe_new_path((string)$in['path']);$c=(string)$in['content'];$backup=!empty($in['backup']);
        if($backup&&is_file($p)&&filesize($p)>0){@copy($p,$p.'.bak');}
        if(($in['eol']??'')==='LF'){$c=str_replace("\r\n","\n",$c);}elseif(($in['eol']??'')==='CRLF'){$c=str_replace("\r\n","\n",$c);$c=str_replace("\n","\r\n",$c);}
        $tmpFile=$p.'.tmp.'.bin2hex(random_bytes(4));
        $saved=false;
        if(wcp_put_contents($tmpFile,$c,true)){
            if(@rename($tmpFile,$p)){$saved=true;}
            else{@unlink($tmpFile);$saved=wcp_put_contents($p,$c,false);}
        }else{$saved=wcp_put_contents($p,$c,false);}
        if(!$saved)jout(false,null,'خطا در ذخیره فایل (بررسی دسترسی نوشتن در حافظه دستگاه / ترموکس)');
        $syntax=null;if(!empty($in['check_syntax'])){$syntax=check_file_syntax($p,$c);}
        clearstatcache(true,$p);
        jout(true,['path'=>$p,'size'=>filesize($p),'mtime'=>filemtime($p),'syntax'=>$syntax,'backed_up'=>$backup&&is_file($p.'.bak')]);
    case 'fs.syntax_check':
        $p=(string)($in['path']??'test.php');$c=(string)($in['content']??'');jout(true,check_file_syntax($p,$c));
    case 'fs.create':
        $p=safe_new_path((string)$in['path']);if(file_exists($p))jout(false,null,'Already exists');$ok=($in['type']??'file')==='dir'?mkdir($p,0755,true):file_put_contents($p,(string)($in['content']??''))!==false;jout($ok,['path'=>$p],$ok?null:'Cannot create item');
    case 'fs.delete':
        $n=0;foreach((array)($in['paths']??[])as$p){$p=safe_path((string)$p);if(in_array($p,['/','/etc','/usr','/var','/home','/root',DATA_DIR],true))throw new RuntimeException('Protected directory');$out=sh('rm -rf -- '.esc($p),$rc);if($rc!==0)throw new RuntimeException($out);$n++;}act_log('Deleted '.$n.' items');jout(true,['deleted'=>$n]);
    case 'fs.rename':
        $p=safe_path((string)$in['path']);$np=safe_new_path(dirname($p).'/'.basename((string)$in['name']));if(file_exists($np))jout(false,null,'Destination already exists');jout(rename($p,$np),['path'=>$np]);
    case 'fs.transfer':
        $dest=safe_path((string)$in['dest']);if(!is_dir($dest))jout(false,null,'Destination missing');$errs=[];foreach((array)($in['paths']??[])as$p){$p=safe_path((string)$p);$t=safe_new_path(rtrim($dest,'/').'/'.basename($p));if($t===$p)continue;if(is_dir($p)&&strpos($t.'/',rtrim($p,'/').'/')===0){$errs[]=$p;continue;}sh((($in['op']??'move')==='copy'?'cp -a -- ':'mv -- ').esc($p).' '.esc($t),$rc);if($rc!==0)$errs[]=$p;}jout(!$errs,['errors'=>$errs],$errs?implode(', ',$errs):null);
    case 'fs.chmod':
        $mode=(string)($in['mode']??'644');if(!preg_match('/^[0-7]{3,4}$/',$mode))jout(false,null,'Invalid mode');foreach((array)$in['paths']as$p){$p=safe_path($p);sh('chmod '.(!empty($in['recursive'])&&is_dir($p)?'-R ':'').$mode.' -- '.esc($p),$rc);if($rc!==0)throw new RuntimeException('chmod failed');}jout(true);
    case 'fs.chown':
        $ug=trim((string)($in['owner']??''));if(!preg_match('/^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*(:[a-zA-Z0-9_\-.]+)?$/',$ug))jout(false,null,'Invalid owner/group');foreach((array)$in['paths']as$p){$p=safe_path($p);sh('chown '.(!empty($in['recursive'])&&is_dir($p)?'-R ':'').esc($ug).' -- '.esc($p),$rc);if($rc!==0)throw new RuntimeException('chown failed');}jout(true);
    case 'fs.zip':
        $dest=safe_new_path((string)$in['dest']);if(!fs_zip_to($dest,array_map('basename',(array)$in['paths']),safe_path((string)$in['base'])))jout(false,null,'ZIP failed');jout(true,['path'=>$dest,'size'=>filesize($dest)]);
    case 'fs.unzip':
        $z=safe_path((string)$in['zip']);$dest=safe_new_path((string)$in['dest']);if(!class_exists('ZipArchive'))jout(false,null,'Install the PHP zip extension for checked ZIP extraction');$zip=new ZipArchive();if($zip->open($z)!==true)jout(false,null,'Cannot open ZIP');
        for($i=0;$i<$zip->numFiles;$i++){$name=str_replace('\\','/',$zip->getNameIndex($i));$ops=0;$attr=0;$zip->getExternalAttributesIndex($i,$ops,$attr);if($name===''||$name[0]==='/'||preg_match('~(^|/)\.\.(/|$)|^[a-zA-Z]:~',$name)||(($attr>>16)&0170000)===0120000)throw new RuntimeException('Unsafe ZIP entry');$target=norm_path($dest.'/'.$name);$parent=$target;while(!file_exists($parent)&&dirname($parent)!==$parent)$parent=dirname($parent);if(is_link($parent)||is_link($target))throw new RuntimeException('ZIP target contains a symlink');}
        if(!is_dir($dest))mkdir($dest,0755,true);$ok=$zip->extractTo($dest);$zip->close();jout($ok,['dest'=>$dest],$ok?null:'Extraction failed');
    case 'fs.search': jout(true,['results'=>fs_search((string)$in['path'],(string)$in['q'],!empty($in['content']))]);
    case 'fs.du':
        $p=safe_path((string)$in['path']);preg_match('/^(\d+)/',trim(sh_ok('du -sb -- '.esc($p))),$m);jout(true,['bytes'=>(int)($m[1]??0),'path'=>$p]);
    case 'fs.info':
        $p=safe_path((string)$in['path']);$st=lstat($p);if(!$st)jout(false,null,'Missing');jout(true,['path'=>$p,'size'=>$st['size'],'mtime'=>$st['mtime'],'ctime'=>$st['ctime'],'perms'=>substr(sprintf('%o',$st['mode']),-4),'link'=>is_link($p)?readlink($p):null,'owner'=>function_exists('posix_getpwuid')?(posix_getpwuid($st['uid'])['name']??$st['uid']):$st['uid'],'mime'=>function_exists('mime_content_type')?mime_content_type($p):'']);
    case 'fs.download':
        $p=safe_path((string)($_GET['path']??''));if(is_dir($p)){$tmp=CACHE_DIR.'/dl-'.wcp_random(4).'.zip';if(!fs_zip_to($tmp,[basename($p)],dirname($p)))jout(false,null,'Cannot create ZIP');register_shutdown_function(function()use($tmp){@unlink($tmp);});fs_stream_download($tmp,basename($p).'.zip');}if(!is_file($p))jout(false,null,'Missing file');fs_stream_download($p,basename($p));
    case 'fs.upload':
        $dest=safe_path((string)($in['dest']??'/'));$n=0;$errors=[];foreach((array)($_FILES['files']['name']??[])as$i=>$nm){$nm=basename(str_replace('\\','/',$nm));if(($_FILES['files']['error'][$i]??1)!==UPLOAD_ERR_OK||!move_uploaded_file($_FILES['files']['tmp_name'][$i],safe_new_path(rtrim($dest,'/').'/'.$nm)))$errors[]=$nm;else$n++;}jout(!$errors,['uploaded'=>$n,'errors'=>$errors],$errors?'Upload failed':null);
    case 'fs.upload_chunk':
        $t=safe_new_path(rtrim(safe_path((string)$in['dest']),'/').'/'.basename(str_replace('\\','/',(string)$in['name'])));$off=max(0,(int)($in['offset']??0));$data=base64_decode((string)$in['b64'],true);if($data===false)jout(false,null,'Invalid data');$fp=fopen($t,'c+b');if(!$fp)jout(false,null,'Cannot open destination');flock($fp,LOCK_EX);if($off===0)ftruncate($fp,0);$size=fstat($fp)['size'];if($size!==$off){flock($fp,LOCK_UN);fclose($fp);jout(false,null,'Chunk offset mismatch');}fseek($fp,$off);$r=fwrite($fp,$data);flock($fp,LOCK_UN);fclose($fp);jout($r===strlen($data),['path'=>$t,'received'=>$r]);
    case 'term.list': jout(true,['sessions'=>term_list(),'mode'=>term_mode()]);
    case 'term.create': jout(true,term_create((int)($in['cols']??120),(int)($in['rows']??34)));
    case 'term.read': jout(true,term_read((string)$in['id'],(int)($in['offset']??0)));
    case 'term.write': term_write((string)$in['id'],(string)$in['b64']);jout(true);
    case 'term.resize': term_resize((string)$in['id'],(int)$in['cols'],(int)$in['rows']);jout(true);
    case 'term.kill': term_kill((string)$in['id']);jout(true);
    case 'gh.save':
        $c=cfg();$new=[];foreach(['gh_repo','gh_branch','git_name','git_email']as$k)$new[$k]=trim((string)($in[$k]??$c[$k]));$new['gh_branch']=$new['gh_branch']?:'backups';if(!empty($in['gh_token'])&&$in['gh_token']!=='__KEEP__')$new['gh_token']=$in['gh_token'];cfg_save($new);$c=cfg();jout(true,['gh_repo'=>$c['gh_repo'],'gh_branch'=>$c['gh_branch'],'git_name'=>$c['git_name'],'git_email'=>$c['git_email'],'has_token'=>$c['gh_token']!=='','token_hint'=>$c['gh_token']?'••••'.substr($c['gh_token'],-4):'']);
    case 'gh.get':
        $c=cfg();jout(true,['gh_repo'=>$c['gh_repo'],'gh_branch'=>$c['gh_branch'],'git_name'=>$c['git_name'],'git_email'=>$c['git_email'],'has_token'=>$c['gh_token']!=='','token_hint'=>$c['gh_token']?'••••'.substr($c['gh_token'],-4):'']);
    case 'gh.test':
        if(gh_url()==='')jout(false,null,'Save repository settings first');$out=sh('git -c safe.directory=* ls-remote '.esc(gh_url()),$rc);if($rc!==0)jout(false,null,mb_substr(mask_url($out),0,400));jout(true,['empty'=>trim($out)==='','refs'=>array_slice(explode("\n",trim($out)),0,10)]);
    case 'gh.profiles':
        $list=bk_profiles();$op=$in['op']??'list';if($op==='save'){$p=$in['profile'];$p['id']=$p['id']?:wcp_random(4);$found=false;foreach($list as&$x)if($x['id']===$p['id']){$x=array_merge($x,$p);$found=true;}unset($x);if(!$found)$list[]=$p;bk_profiles_save($list);}elseif($op==='delete'){bk_profiles_save(array_values(array_filter($list,fn($x)=>$x['id']!==$in['id'])));}jout(true,['profiles'=>bk_profiles()]);
    case 'gh.backup':
        if(empty($in['profiles'])||gh_url()==='')jout(false,null,'Select profiles and configure repository');$job=job_create('backup','بکاپ گیت‌هاب',['profiles'=>(array)$in['profiles'],'msg'=>(string)($in['msg']??''),'tag'=>(string)($in['tag']??'')]);job_start($job);jout(true,['job'=>$job['id']]);
    case 'gh.snapshots':
        if(gh_url()==='')jout(false,null,'Configure repository');$out=sh('git -c safe.directory=* ls-remote '.esc(gh_url()),$rc);if($rc!==0)jout(false,null,mask_url($out));$tags=[];$has=false;$branch=cfg()['gh_branch'];foreach(explode("\n",trim($out))as$l){$a=explode("\t",$l,2);if(count($a)<2)continue;$ref=$a[1];if(strpos($ref,'refs/tags/')===0&&strpos($ref,'^{}')===false)$tags[]=substr($ref,10);if($ref==='refs/heads/'.$branch)$has=true;}rsort($tags);jout(true,['tags'=>$tags,'has_branch'=>$has,'branch'=>$branch]);
    case 'gh.manifest':
        $ref=(string)($in['ref']??'');if($ref===''||$ref[0]==='-')jout(false,null,'Invalid ref');$cache=CACHE_DIR.'/gh-'.hash('sha256',gh_url().'|'.$ref);if(!is_file($cache.'/manifest.json')){sh('rm -rf -- '.esc($cache));$out=sh('git -c safe.directory=* clone --depth 1 --branch '.esc($ref).' -- '.esc(gh_url()).' '.esc($cache),$rc);if($rc!==0)jout(false,null,mask_url($out));}$mf=json_decode((string)@file_get_contents($cache.'/manifest.json'),true);if(!$mf)jout(false,null,'manifest.json is missing');jout(true,['ref'=>$ref,'manifest'=>$mf,'cache'=>$cache]);
    case 'gh.restore':
        if(empty($in['categories']))jout(false,null,'Select categories');$job=job_create('restore','بازیابی از گیت‌هاب',['ref'=>(string)$in['ref'],'categories'=>(array)$in['categories'],'overwrite'=>!empty($in['overwrite']),'safety'=>!empty($in['safety']),'target_base'=>trim((string)($in['target_base']??''))]);job_start($job);jout(true,['job'=>$job['id']]);
    case 'gh.user_repos': $owner=trim((string)($in['owner']??'fazilatma'));jout(true,['owner'=>$owner,'repos'=>gh_user_repos($owner,(string)($in['token']??''))]);
    case 'gh.repo_branches': jout(true,['branches'=>gh_repo_branches((string)$in['owner'],(string)$in['repo'],(string)($in['token']??''))]);

    case 'gh.inspect_branch': jout(true,['apps'=>gh_inspect_branch((string)$in['owner'],(string)$in['repo'],(string)$in['branch'],(string)($in['token']??''))]);
    case 'proj.list':
        $list=proj_all();foreach($list as&$p){$svc=proj_service_job($p);$p['service']=$svc?['job'=>$svc['id'],'status'=>job_status($svc)['status']]:null;$p['deploy_path_exists']=is_dir($p['deploy_path']??'');$p=public_project($p);}unset($p);jout(true,['projects'=>$list]);
    case 'proj.save': case 'proj.quick_deploy':
        $list=proj_all();$p=$in['project']??[];foreach(['name','type','repo_url','branch','subfolder','deploy_path','install_cmd','build_cmd','start_cmd','port','id']as$k)$p[$k]=trim((string)($p[$k]??''));if($p['name']==='')jout(false,null,'Name is required');if($p['repo_url']!==''&&!preg_match('~^(https?://|git@|ssh://|file://|/)~',$p['repo_url']))jout(false,null,'Invalid repository URL');if($p['branch']==='')$p['branch']='main';if($p['branch'][0]==='-'||preg_match('~(^|/)\.\.(/|$)~',$p['subfolder']))jout(false,null,'Invalid branch/subfolder');
        $env=[];foreach(preg_split('/\r\n|\r|\n/',(string)($p['env_text']??''))as$l){$l=trim($l);if($l===''||$l[0]==='#'||strpos($l,'=')===false)continue;[$k,$v]=explode('=',$l,2);$k=trim($k);if(!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/',$k))jout(false,null,'Invalid environment key');$env[$k]=trim($v);}unset($p['env_text']);$p['env']=$env;
        if($api==='proj.quick_deploy')$p=proj_quick_settings($p);
        if(($p['auth_token']??'')==='__KEEP__'||($p['auth_token']??'')==='')unset($p['auth_token']);$p['keep_git']=!empty($p['keep_git']);$p['preserve_configs']=!isset($p['preserve_configs'])||!empty($p['preserve_configs']);$p['auto_start']=!empty($p['auto_start']);$p['is_daemon']=!empty($p['is_daemon']);$p['auto_update']=!empty($p['auto_update']);$p['auto_update_interval']=max(30,min(86400,(int)($p['auto_update_interval']??60)));$existing=$p['id']!==''?proj_find($list,$p['id']):null;if(!$existing)$p['id']=wcp_random(5);$p['deploy_path']=proj_resolve_deploy_path($p,$existing);if($p['deploy_path']==='/')jout(false,null,'Invalid deployment root');
        $found=false;if($p['id']!==''){foreach($list as&$x)if($x['id']===$p['id']){$p=array_merge($x,$p);$x=$p;$found=true;}unset($x);}if(!$found){$p['created']=date('c');$list[]=$p;}proj_save_all($list);
        if($api==='proj.quick_deploy'){$job=job_create('deploy','دیپلوی: '.$p['name'],['project_id'=>$p['id']]);job_start($job);jout(true,['project'=>public_project($p),'job'=>$job['id']]);}jout(true,['projects'=>array_map('public_project',proj_all())]);
    case 'proj.delete': cli_stop_service((string)$in['id']);proj_save_all(array_values(array_filter(proj_all(),fn($x)=>$x['id']!==$in['id'])));jout(true);
    case 'proj.toggle_auto_update':
        $list=proj_all();$id=(string)($in['id']??'');$found=false;$p=null;foreach($list as&$x){if($x['id']===$id){$x['auto_update']=empty($x['auto_update']);if(empty($x['auto_update_interval']))$x['auto_update_interval']=60;$found=true;$p=$x;}}unset($x);if(!$found)jout(false,null,'Project not found');proj_save_all($list);
        $pollRes=null;if(!empty($p['auto_update'])){proj_install_cron();$pollRes=proj_poll_auto_updates();}
        jout(true,['project'=>public_project($p),'auto_update'=>$p['auto_update'],'poll'=>$pollRes]);
    case 'proj.check_update':
        $id=(string)($in['id']??'');$p=proj_find(proj_all(),$id);if(!$p)jout(false,null,'Project not found');
        $remote=proj_check_remote_commit($p);$local=$p['last_deploy']['commit']??'';
        if(empty($local)&&!empty($p['deploy_path'])&&is_dir(safe_path($p['deploy_path']))){
            $local=trim(sh_ok('git -c safe.directory=* -C '.esc(safe_path($p['deploy_path'])).' rev-parse --short HEAD 2>/dev/null'));
        }
        $hasUpdate=($remote&&($local===''||substr($remote,0,7)!==substr($local,0,7)));
        jout(true,['remote_commit'=>$remote,'local_commit'=>$local,'has_update'=>$hasUpdate,'branch'=>$p['branch']?:'main']);
    case 'proj.poll_auto_updates':
        jout(true,proj_poll_auto_updates());
    case 'proj.install_cron':
        jout(true,proj_install_cron());
    case 'proj.storage':
        if(!empty($in['fix_permissions'])){
            @shell_exec('sudo -n chown -R www-data:www-data /var/www /var/www/html 2>/dev/null; sudo -n chmod -R 775 /var/www /var/www/html 2>/dev/null');
            jout(true, proj_storage_status(true));
        }
        if(!empty($in['prepare'])){$root=proj_storage_root();if(!file_exists($root)&&is_dir(dirname($root))&&wcp_is_dir_writable(dirname($root)))@mkdir($root,0700);}
        jout(true,proj_storage_status(!empty($in['probe'])||!empty($in['prepare'])));
    case 'proj.managed_path':
        $id=(string)($in['id']??'');$old=$id!==''?proj_find(proj_all(),$id):null;if($id!==''&&!$old)jout(false,null,'Project not found');
        if($old){foreach(glob(JOBS_DIR.'/*.json')?:[]as$file){$active=json_decode((string)@file_get_contents($file),true);if(($active['params']['project_id']??null)===$id&&in_array($active['type']??'',['deploy','service'],true)&&job_status($active)['status']==='running')jout(false,null,'Stop or finish the active deployment/service before changing its storage location.');}$svc=proj_service_job($old);if($svc&&job_status($svc)['status']==='running')jout(false,null,'Stop the existing service before changing its storage location.');if(!proj_empty_location((string)($old['deploy_path']??'')))jout(false,null,'Existing installation contains data or cannot be inspected. No files were moved. Keep its path, or ask an administrator to migrate the full installation, database, .env.local and vault key first.');}
        $storage=proj_storage_status(true);if(!$storage['ready'])jout(false,null,$storage['error']);
        $path=proj_managed_path((string)($in['name']??($old['name']??'project')),$id?:wcp_random(5));if(file_exists($path)||is_link($path))jout(false,null,'Managed destination already exists; refusing to reuse it.');jout(true,['path'=>$path]);
    case 'proj.preflight':
        $p=proj_find(proj_all(),(string)($in['id']??''));if(!$p)jout(false,null,'Project not found');jout(true,proj_preflight($p));
    case 'proj.deploy':
        $p=proj_find(proj_all(),(string)$in['id']);if(!$p)jout(false,null,'Project not found');$job=job_create('deploy','دیپلوی: '.$p['name'],['project_id'=>$p['id']]);job_start($job);jout(true,['job'=>$job['id']]);
    case 'proj.service':
        $p = proj_find(proj_all(), (string)$in['id']);
        if (!$p) jout(false, null, 'Project not found');
        $act = $in['action'] ?? 'start';
        if (in_array($act, ['stop', 'restart'], true)) cli_stop_service($p['id']);
        if ($act === 'stop') jout(true);
        if (empty($p['start_cmd'])) jout(false, null, 'Start command is empty');
        if ($act === 'restart') usleep(300000);
        $svc = proj_service_job($p);
        if ($act !== 'restart' && $svc && job_status($svc)['status'] === 'running') jout(true, ['job' => $svc['id']]);
        if (!empty($p['port'])) wcp_kill_port($p['port']);
        $job = job_create('service', 'سرویس: ' . $p['name'], ['project_id' => $p['id']]);
        job_start($job);
        jout(true, ['job' => $job['id']]);
    case 'jobs.status':
        $job=job_get((string)$in['id']);if(!$job)jout(false,null,'Job not found');jout(true,['id'=>$job['id'],'name'=>$job['name'],'type'=>$job['type'],'status'=>job_status($job),'result'=>$job['result'],'created'=>$job['created']]);
    case 'jobs.log':
        $job=job_get((string)$in['id']);if(!$job)jout(false,null,'Job not found');$off=max(0,(int)($in['offset']??0));$f=$job['log'];if(!is_file($f))jout(true,['b64'=>'','offset'=>0,'status'=>job_status($job)]);clearstatcache(true,$f);$size=filesize($f);if($off>$size)$off=0;$data='';if($size>$off){$fp=fopen($f,'rb');fseek($fp,$off);$data=(string)fread($fp,min($size-$off,1048576));fclose($fp);}
        jout(true,['b64'=>base64_encode($data),'offset' => $off + strlen($data), 'has_more' => ($off + strlen($data) < $size), 'status' => job_status($job)]);
    case 'jobs.stop': $j=job_get((string)$in['id']);if($j)job_stop($j);jout(true);
    case 'jobs.list':
        $res=[];foreach(glob(JOBS_DIR.'/*.json')?:[]as$f){$j=json_decode((string)file_get_contents($f),true);if(!$j||empty($j['id']))continue;$res[]=['id'=>$j['id'],'name'=>$j['name'],'type'=>$j['type'],'created'=>$j['created'],'status'=>job_status($j)];}usort($res,fn($a,$b)=>strcmp($b['created'],$a['created']));jout(true,['jobs'=>array_slice($res,0,50)]);
        case 'settings.export':
        $c = cfg();
        $exportCfg = $c;
        unset($exportCfg['pass_hash']);
        $projects = proj_all();
        $backupProfiles = bk_profiles();
        $payload = [
            'magic' => 'webconsole_settings_export',
            'version' => WCP_VERSION,
            'exported_at' => date('c'),
            'host' => gethostname() ?: 'unknown',
            'config' => $exportCfg,
            'projects' => $projects,
            'backup_profiles' => $backupProfiles
        ];
        jout(true, [
            'export_data' => $payload,
            'json_string' => json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        ]);

    case 'settings.import':
        $data = $in['data'] ?? null;
        if (is_string($data)) {
            $data = json_decode($data, true);
        }
        if (!is_array($data)) {
            jout(false, null, 'ساختار داده‌های JSON نامعتبر است');
        }
        $importConfig = !empty($in['import_config']);
        $importProjects = !empty($in['import_projects']);
        $importBackups = !empty($in['import_backups']);
        $mergeProjects = !empty($in['merge_projects']);

        $imported = ['config' => false, 'projects_count' => 0, 'backups_count' => 0];

        // 1. Import general config
        if ($importConfig && !empty($data['config']) && is_array($data['config'])) {
            $allowedKeys = [
                'theme', 'layout', 'density', 'project_root', 'fs_start', 'session_minutes',
                'allowed_ips', 'gh_token', 'gh_repo', 'gh_branch', 'git_name', 'git_email',
                'split_mb', 'tmux_width', 'tmux_height', 'proxy_mode', 'proxy_cf_url',
                'cf_proxy', 'cf_proxy_mode'
            ];
            $newCfg = [];
            foreach ($allowedKeys as $k) {
                if (isset($data['config'][$k])) {
                    $newCfg[$k] = $data['config'][$k];
                }
            }
            if (!empty($newCfg)) {
                cfg_save($newCfg);
                $imported['config'] = true;
            }
        }

        // 2. Import projects
        if ($importProjects && isset($data['projects']) && is_array($data['projects'])) {
            $existingProjects = proj_all();
            if ($mergeProjects) {
                $projMap = [];
                foreach ($existingProjects as $ep) $projMap[$ep['id']] = $ep;
                foreach ($data['projects'] as $np) {
                    if (!empty($np['name']) && !empty($np['repo_url'])) {
                        $id = !empty($np['id']) ? $np['id'] : wcp_random(5);
                        $np['id'] = $id;
                        $projMap[$id] = $np;
                    }
                }
                $finalProjects = array_values($projMap);
            } else {
                $finalProjects = [];
                foreach ($data['projects'] as $np) {
                    if (!empty($np['name']) && !empty($np['repo_url'])) {
                        if (empty($np['id'])) $np['id'] = wcp_random(5);
                        $finalProjects[] = $np;
                    }
                }
            }
            proj_save_all($finalProjects);
            $imported['projects_count'] = count($finalProjects);
        }

        // 3. Import backup profiles
        if ($importBackups && isset($data['backup_profiles']) && is_array($data['backup_profiles'])) {
            bk_profiles_save($data['backup_profiles']);
            $imported['backups_count'] = count($data['backup_profiles']);
        }

        jout(true, [
            'imported' => $imported,
            'message' => 'تنظیمات با موفقیت درون‌ریزی شدند.'
        ]);

    case 'settings.get':
        $c=cfg();jout(true,['theme'=>$c['theme'],'layout'=>$c['layout'],'density'=>$c['density'],'project_root'=>$c['project_root'],'fs_start'=>$c['fs_start'],'session_minutes'=>$c['session_minutes'],'allowed_ips'=>$c['allowed_ips'],'created'=>$c['created'],'proxy_mode'=>$c['proxy_mode']??'auto','proxy_cf_url'=>$c['proxy_cf_url']??'https://proxy.fazilat-ma.workers.dev/?url=https://example.com/page','noexec'=>$GLOBALS['__NOEXEC']]);
    case 'settings.save':
        $new=[];foreach(['theme'=>['dark','light','forest','ocean','amber'],'layout'=>['classic','studio','focus'],'density'=>['comfortable','compact']] as $key=>$allowed){if(isset($in[$key])){if(!in_array($in[$key],$allowed,true))jout(false,null,'Invalid appearance option: '.$key);$new[$key]=$in[$key];}}if(isset($in['project_root']))$new['project_root']=proj_storage_root((string)$in['project_root']);if(isset($in['fs_start']))$new['fs_start']=safe_path((string)$in['fs_start']);if(isset($in['session_minutes']))$new['session_minutes']=max(10,min(1440,(int)$in['session_minutes']));if(isset($in['allowed_ips']))$new['allowed_ips']=trim((string)$in['allowed_ips']);if(isset($in['proxy_mode'])){if(!in_array($in['proxy_mode'],['direct','auto','cf_proxy'],true))jout(false,null,'Invalid proxy mode');$new['proxy_mode']=$in['proxy_mode'];}if(isset($in['proxy_cf_url'])){$new['proxy_cf_url']=trim((string)$in['proxy_cf_url']);}cfg_save($new);jout(true);
    case 'proxy.test':
        $testUrl = trim((string)($in['target_url'] ?? 'https://api.github.com/zen'));
        if ($testUrl === '') $testUrl = 'https://api.github.com/zen';
        $customTemplate = isset($in['proxy_cf_url']) ? trim((string)$in['proxy_cf_url']) : null;
        $fetchTest = function(string $u): array {
            $t0 = microtime(true);
            $headers = ['User-Agent: WebConsole-Pro/1.3.8', 'Accept: */*'];
            if (function_exists('curl_init')) {
                $ch = curl_init($u);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_HTTPHEADER => $headers,
                    CURLOPT_TIMEOUT => 8,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => 0
                ]);
                $res = curl_exec($ch);
                $err = curl_error($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                $ms = round((microtime(true) - $t0) * 1000);
                return [
                    'ok' => ($code >= 200 && $code < 400 && is_string($res)),
                    'code' => $code,
                    'ms' => $ms,
                    'error' => $err,
                    'preview' => is_string($res) ? (function_exists('mb_substr') ? mb_substr(trim($res), 0, 150) : substr(trim($res), 0, 150)) : ''
                ];
            }
            $ctx = stream_context_create([
                'http' => ['method' => 'GET', 'header' => implode("\r\n", $headers) . "\r\n", 'timeout' => 8, 'ignore_errors' => true, 'follow_location' => 1],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]
            ]);
            $res = @file_get_contents($u, false, $ctx);
            $ms = round((microtime(true) - $t0) * 1000);
            $code = 200;
            $statusLine = $http_response_header[0] ?? '';
            if (preg_match('#HTTP/\S+\s+(\d+)#', $statusLine, $m)) $code = (int)$m[1];
            return [
                'ok' => (is_string($res) && $code >= 200 && $code < 400),
                'code' => $code,
                'ms' => $ms,
                'error' => is_string($res) ? '' : 'Connection error',
                'preview' => is_string($res) ? (function_exists('mb_substr') ? mb_substr(trim($res), 0, 150) : substr(trim($res), 0, 150)) : ''
            ];
        };
        $direct = $fetchTest($testUrl);
        $proxiedUrl = cf_proxy_url($testUrl, $customTemplate !== null ? ['proxy_cf_url' => $customTemplate] : null);
        $proxy = $fetchTest($proxiedUrl);
        jout(true, ['target' => $testUrl, 'proxied_url' => $proxiedUrl, 'direct' => $direct, 'proxy' => $proxy]);
    case 'activity': $lines=@file(DATA_DIR.'/activity.log',FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)?:[];jout(true,['lines'=>array_slice(array_reverse($lines),0,200)]);
    default:jout(false,null,'Unknown action',400);
    }
}
function cli_log(string $m){echo '['.date('H:i:s').'] '.$m."\n";}
function cli_run(string $cmd,&$code=null): string {cli_log('$ '.mask_url($cmd));$out=sh($cmd,$code);if(trim($out)!=='')echo mask_url($out)."\n";return $out;}
function cli_checked(string $cmd): string {$out=cli_run($cmd,$rc);if($rc!==0)throw new RuntimeException('Command failed ('.$rc.'): '.mask_url($out));return $out;}
function cli_backup(array $job): int {
    $c=cfg();$params=$job['params'];$url=gh_url();if($url==='')throw new RuntimeException('Configure backup repository');$stage=CACHE_DIR.'/backup-'.$job['id'];mkdir($stage,0700,true);$selected=array_filter(bk_profiles(),fn($p)=>in_array($p['id'],$params['profiles'],true));$mf=['app'=>'wconsole','version'=>WCP_VERSION,'created'=>date('c'),'host'=>gethostname(),'branch'=>$c['gh_branch'],'profiles'=>[],'splits'=>[]];
    foreach($selected as$p){$slug=gh_slug($p['id'].'-'.$p['name']);$dest=$stage.'/profiles/'.$slug;mkdir($dest,0700,true);$info=['id'=>$p['id'],'name'=>$p['name'],'extra'=>$p['extra'],'includes'=>[],'bytes'=>0,'files'=>0];cli_log('Profile: '.$p['name']);
        if($p['extra']==='db'){
            mkdir($dest.'/dumps',0700,true);$found=false;
            if(which('mysqldump')||which('mariadb-dump')){$bin=which('mysqldump')?'mysqldump':'mariadb-dump';cli_checked('bash -o pipefail -c '.esc($bin.' --all-databases --single-transaction --quick | gzip > '.esc($dest.'/dumps/mysql-all.sql.gz')));$found=true;}
            if(which('pg_dumpall')){cli_checked('bash -o pipefail -c '.esc('pg_dumpall | gzip > '.esc($dest.'/dumps/postgres-all.sql.gz')));$found=true;}
            if(!$found)throw new RuntimeException('No database dump utility is available');$info['includes'][]=['src'=>'@db','staged'=>'profiles/'.$slug.'/dumps','restore_mode'=>'cache'];
        }elseif($p['extra']==='cron'){
            mkdir($dest.'/cron',0700,true);file_put_contents($dest.'/cron/current-user.cron.txt',sh_ok('crontab -l'));if(is_readable('/var/spool/cron/crontabs'))cli_checked('cp -a /var/spool/cron/crontabs '.esc($dest.'/cron/spool'));$info['includes'][]=['src'=>'/var/spool/cron','staged'=>'profiles/'.$slug.'/cron','restore_mode'=>'direct'];
        }elseif($p['extra']==='packages'){
            mkdir($dest.'/packages',0700,true);foreach(['dpkg'=>"dpkg-query -W -f='\${Package}\t\${Version}\n'",'pip'=>'pip3 freeze','npm'=>'npm ls -g --depth=0','snap'=>'snap list']as$k=>$cmd)file_put_contents($dest.'/packages/'.$k.'.txt',sh_ok($cmd));$info['includes'][]=['src'=>'@packages','staged'=>'profiles/'.$slug.'/packages','restore_mode'=>'cache'];
        }else foreach((array)($p['includes']??[])as$src){$src=rtrim(trim((string)$src),'/');if($src===''||!is_dir($src)){cli_log('Skipping missing path: '.$src);continue;}$ex=' --exclude='.esc(ltrim(DATA_DIR,'/'));foreach((array)($p['excludes']??[])as$e)if(trim($e)!=='')$ex.=' --exclude='.esc(ltrim($e,'/'));cli_checked('bash -o pipefail -c '.esc('tar -C / -cf - '.$ex.' -- '.esc(ltrim($src,'/')).' | tar -C '.esc($dest).' -xf -'));$info['includes'][]=['src'=>$src,'staged'=>'profiles/'.$slug.'/'.ltrim($src,'/'),'restore_mode'=>'direct'];preg_match('/^(\d+)/',sh_ok('du -sb -- '.esc($dest.'/'.ltrim($src,'/'))),$m);$info['bytes']+=(int)($m[1]??0);$info['files']+=(int)sh_ok('find '.esc($dest.'/'.ltrim($src,'/')).' -type f | wc -l');}
        $mf['profiles'][]=$info;
    }
    $split=max(10,(int)$c['split_mb']?:80);foreach(explode("\n",trim(sh_ok('find '.esc($stage).' -type f -size +'.$split.'M')))as$big){if($big==='')continue;$rel=ltrim(substr($big,strlen($stage)),'/');cli_checked('split -b '.($split*1048576).' -d -- '.esc($big).' '.esc($big.'.part.'));$parts=[];foreach(glob($big.'.part.*')?:[]as$pp)$parts[]=ltrim(substr($pp,strlen($stage)),'/');if(!$parts)throw new RuntimeException('File splitting produced no parts');unlink($big);$mf['splits'][]=['final'=>$rel,'parts'=>$parts];}
    file_put_contents($stage.'/manifest.json',json_encode($mf,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));$branch=$c['gh_branch']?:'backups';$tag=trim($params['tag']??'')?:'bk-'.date('Ymd-His');$g='git -c safe.directory=* -C '.esc($stage).' ';cli_checked($g.'check-ref-format --branch '.esc($branch));cli_checked($g.'check-ref-format '.esc('refs/tags/'.$tag));cli_checked($g.'init -b '.esc($branch));cli_checked($g.'config user.email '.esc($c['git_email']));cli_checked($g.'config user.name '.esc($c['git_name']));cli_checked($g.'remote add origin '.esc($url));cli_checked($g.'add -A -f');cli_checked($g.'commit --allow-empty -m '.esc(trim($params['msg']??'')?:'WebConsole backup '.date('c')));cli_checked($g.'push --force origin '.esc($branch.':'.$branch));cli_checked($g.'tag '.esc($tag));cli_checked($g.'push origin '.esc('refs/tags/'.$tag));sh('rm -rf -- '.esc($stage));cli_log('Backup complete: '.$tag);return 0;
}
function manifest_path(string $root,string $relative): string {
    if($relative===''||$relative[0]==='/'||strpos($relative,"\0")!==false||preg_match('~(^|/)\.\.(/|$)~',str_replace('\\','/',$relative)))throw new RuntimeException('Unsafe manifest path');$path=norm_path($root.'/'.$relative);$probe=$path;while(!file_exists($probe)&&dirname($probe)!==$probe)$probe=dirname($probe);$real=realpath($probe);$base=realpath($root);if($real===false||$base===false||($real!==$base&&strpos($real,$base.'/')!==0))throw new RuntimeException('Manifest path escapes backup');return $path;
}
function cli_restore(array $job): int {
    $p=$job['params'];$ref=$p['ref'];if($ref===''||$ref[0]==='-')throw new RuntimeException('Invalid ref');$work=CACHE_DIR.'/restore-'.$job['id'];mkdir($work,0700,true);$repo=$work.'/repo';cli_checked('git -c safe.directory=* clone --depth 1 --branch '.esc($ref).' -- '.esc(gh_url()).' '.esc($repo));$mf=json_decode((string)@file_get_contents($repo.'/manifest.json'),true);if(!$mf)throw new RuntimeException('Invalid manifest');
    if(!empty($p['safety'])){$tag='pre-restore-'.date('Ymd-His');$g='git -c safe.directory=* -C '.esc($repo).' ';cli_checked($g.'fetch --depth 1 origin '.esc(cfg()['gh_branch']));cli_checked($g.'tag '.esc($tag).' FETCH_HEAD');cli_checked($g.'push origin '.esc('refs/tags/'.$tag));cli_log('Safety tag preserves the remote backup branch, not a new snapshot of local VPS files.');}
    $selected=array_filter($mf['profiles']??[],fn($pr)=>in_array($pr['id'],$p['categories'],true));
    foreach($mf['splits']??[]as$sp){$need=false;foreach($selected as$pr)foreach($pr['includes']as$inc)if($sp['final']===$inc['staged']||strpos($sp['final'],rtrim($inc['staged'],'/').'/')===0)$need=true;if(!$need)continue;$final=manifest_path($repo,$sp['final']);$parts=array_map(fn($pt)=>manifest_path($repo,$pt),$sp['parts']);foreach($parts as$part)if(!is_file($part))throw new RuntimeException('Missing backup part');cli_checked('cat -- '.implode(' ',array_map('esc',$parts)).' > '.esc($final));}
    foreach($selected as$pr){cli_log('Restoring '.$pr['name']);foreach($pr['includes']??[]as$inc){$src=manifest_path($repo,$inc['staged']);if(!is_dir($src))throw new RuntimeException('Missing staged directory');$base=trim((string)($p['target_base']??''));$target=($inc['restore_mode']??'direct')==='cache'?DATA_DIR.'/restored/'.date('Ymd-His').'/'.basename($inc['staged']):($base!==''?rtrim($base,'/').'/'.ltrim($inc['src'],'/'):$inc['src']);$target=safe_path($target);if($target==='/')throw new RuntimeException('Cannot restore to filesystem root');if(!is_dir($target))mkdir($target,0755,true);$cmd=which('rsync')?'rsync -a '.(!empty($p['overwrite'])?'':'--ignore-existing ').esc(rtrim($src,'/').'/.').' '.esc(rtrim($target,'/').'/'):'cp -'.(!empty($p['overwrite'])?'a':'an').' -- '.esc(rtrim($src,'/').'/.').' '.esc(rtrim($target,'/').'/');cli_checked($cmd);}}
    sh('rm -rf -- '.esc($work));cli_log('Restore complete. Database dumps require a separate manual import.');return 0;
}
function default_install_cmd(string $type): string {
    switch($type){
        case 'php':
            return 'if [ -f composer.json ]; then composer install --no-interaction --no-dev -o; fi';
        case 'node':
            return 'if [ -f package-lock.json ]; then (npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund); elif [ -f package.json ]; then npm install --include=dev --no-audit --no-fund; fi';
        case 'python':
            return 'if [ -f requirements.txt ]; then if ! (pip3 install --break-system-packages -r requirements.txt --no-warn-script-location 2>/dev/null || pip3 install --user -r requirements.txt --no-warn-script-location 2>/dev/null || pip3 install -r requirements.txt --no-warn-script-location 2>/dev/null); then echo "[deploy-installer] Bulk install failed. Installing packages line-by-line..."; while IFS= read -r line || [ -n "$line" ]; do pkg=$(echo "$line" | sed -e "s/^[[:space:]]*//" -e "s/[[:space:]]*$//" -e "s/#.*//"); if [ -n "$pkg" ]; then if ! (pip3 install --break-system-packages "$pkg" --no-warn-script-location 2>/dev/null || pip3 install --user "$pkg" --no-warn-script-location 2>/dev/null || pip3 install "$pkg" --no-warn-script-location 2>/dev/null); then echo "[deploy-installer WARNING] Skipped incompatible package: $pkg"; fi; fi; done < requirements.txt; echo "[deploy-installer] Resilient installation completed."; fi; elif [ -f setup.py ] || [ -f pyproject.toml ]; then (pip3 install --break-system-packages . --no-warn-script-location 2>/dev/null || pip3 install --user . --no-warn-script-location 2>/dev/null || pip3 install . --no-warn-script-location 2>/dev/null); elif [ -f scraper4.py ] || [ -f app.py ]; then (pip3 install --break-system-packages flask requests beautifulsoup4 lxml python-dotenv --no-warn-script-location 2>/dev/null || pip3 install --user flask requests beautifulsoup4 lxml python-dotenv --no-warn-script-location 2>/dev/null || pip3 install flask requests beautifulsoup4 lxml python-dotenv --no-warn-script-location 2>/dev/null || true); fi';
        default:return '';
    }
}
function proj_preflight(array $p): array {
    $checks = [];
    $add = function($name, $ok, $detail) use (&$checks) { $checks[] = ['name' => $name, 'ok' => (bool)$ok, 'detail' => $detail]; };
    $path = proj_resolve_deploy_path($p);
    $target = '';
    $parent = '';
    try {
        $target = safe_path($path);
        if ($path === '' || $target === '/') throw new RuntimeException('Choose a non-root absolute deployment directory');
        if (!is_dir($target)) @mkdir($target, 0777, true);
        $parent = $target;
        while (!file_exists($parent) && $parent !== '/') $parent = dirname($parent);
        $ok = is_dir($parent) && wcp_is_dir_writable($parent);
        $add('Deployment directory', $ok, $ok ? 'Writable directory: ' . $parent : 'Permission denied or not writable: ' . $parent . '. Open settings to change project storage root.');
    } catch (Throwable $e) {
        $add('Deployment directory', false, $e->getMessage());
    }
    $uid = function_exists('posix_geteuid') ? posix_geteuid() : null;
    $pw = $uid !== null && function_exists('posix_getpwuid') ? posix_getpwuid($uid) : false;
    $user = is_array($pw) ? $pw['name'] : trim(sh_ok('id -un'));
    if ($user === '') $user = 'unknown';
    $add('Shell execution', empty($GLOBALS['__NOEXEC']), 'PHP execution account: ' . $user . ($uid !== null ? ' (UID ' . $uid . ')' : ''));
    foreach (['git', 'bash'] as $tool) $add($tool, which($tool), 'Required in the execution account PATH');
    
    // Check runtime engine version for Node.js projects
    if (($p['type'] ?? '') === 'node') {
        $nodePath = which('node');
        if (!$nodePath) {
            $add('Node.js runtime', false, 'node is not installed or not in PATH. Install Node 20 LTS: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs');
        } else {
            $nodeVer = trim((string)sh_ok('node -v 2>/dev/null'));
            $nodeMajor = 0;
            if (preg_match('/v?(\d+)/i', $nodeVer, $nvm)) {
                $nodeMajor = (int)$nvm[1];
            }
            if ($nodeMajor < 18) {
                $add('Node.js version', false, "Detected {$nodeVer} (Outdated). Packages like Puppeteer/Crawlee/Wrangler require Node >= 20. Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs");
            } else {
                $add('Node.js version', true, "Node.js {$nodeVer} is compatible (>= 18.x / 20.x LTS)");
            }
        }
    } elseif (($p['type'] ?? '') === 'python') {
        $pyPath = which('python3') || which('python');
        if (!$pyPath) {
            $add('Python runtime', false, 'python3 is not installed or not in PATH.');
        } else {
            $pyVer = trim((string)sh_ok('python3 --version 2>/dev/null || python --version 2>/dev/null'));
            $add('Python version', true, $pyVer ?: 'Python is available');
        }
    }

    $copy = which('rsync') || which('tar');
    $add('File copy tool', $copy, 'rsync or tar required');
    $add('WebConsole cache', wcp_is_dir_writable(CACHE_DIR), 'Cache directory must be writable');
    return ['ok' => !in_array(false, array_column($checks, 'ok'), true), 'checks' => $checks];
}
function proj_install_cron(): array {
    $php = wcp_php_cli();
    $self = __FILE__;
    $cronLine = "* * * * * " . $php . " -d register_argc_argv=1 " . $self . " --auto-update --wcp-data-dir=" . base64_encode(DATA_DIR) . " >/dev/null 2>&1";
    $current = sh_ok('crontab -l 2>/dev/null');
    if (strpos($current, '--auto-update') !== false) {
        return ['installed' => true, 'line' => $cronLine, 'msg' => 'کران‌جاب آپدیت خودکار قبلاً در سیستم فعال شده است.'];
    }
    $newCron = trim($current . "\n" . $cronLine) . "\n";
    $tmp = tempnam(sys_get_temp_dir(), 'wc_cr_');
    file_put_contents($tmp, $newCron);
    $out = sh("crontab " . esc($tmp) . " 2>&1", $rc);
    @unlink($tmp);
    return ['installed' => $rc === 0, 'line' => $cronLine, 'msg' => $rc === 0 ? 'دیده‌بان کران‌جاب لینوکس (هر ۱ دقیقه) با موفقیت فعال شد.' : 'خطا در نصب کران‌جاب: ' . $out];
}

function proj_poll_auto_updates(): array {
    $projects = proj_all();
    $triggered = [];
    $activeJobs = [];
    foreach (glob(JOBS_DIR . '/*.json') ?: [] as $jf) {
        $j = json_decode((string)@file_get_contents($jf), true);
        if ($j && in_array($j['type'] ?? '', ['deploy', 'service'], true)) {
            $st = job_status($j);
            if ($st['status'] === 'running') {
                $activeJobs[$j['type']][$j['params']['project_id'] ?? ''] = true;
            }
        }
    }
    foreach ($projects as $p) {
        if (empty($p['auto_update'])) continue;
        if (!empty($activeJobs['deploy'][$p['id']])) continue;
        $remote = proj_check_remote_commit($p);
        if (!$remote) continue;
        $local = $p['last_deploy']['commit'] ?? '';
        $deployDir = proj_resolve_deploy_path($p);
        if (empty($local) && is_dir($deployDir)) {
            $local = trim(sh_ok('git -c safe.directory=* -C ' . esc($deployDir) . ' rev-parse --short HEAD 2>/dev/null'));
        }
        if (empty($local) && is_file($deployDir . '/.deploy.json')) {
            $depMeta = json_decode((string)@file_get_contents($deployDir . '/.deploy.json'), true);
            if (!empty($depMeta['commit'])) $local = $depMeta['commit'];
        }
        $hasUpdate = ($local === '' || substr($remote, 0, 7) !== substr($local, 0, 7));
        if ($hasUpdate) {
            $job = job_create('deploy', 'به‌روزرسانی خودکار: ' . $p['name'] . ' (' . $remote . ')', ['project_id' => $p['id']]);
            job_start($job);
            $triggered[] = [
                'project_id' => $p['id'],
                'project_name' => $p['name'],
                'remote_commit' => $remote,
                'local_commit' => $local,
                'job_id' => $job['id']
            ];
        }
    }
    return ['triggered' => $triggered, 'count' => count($triggered)];
}


function cli_deploy(array $job): int {
    $p = proj_find(proj_all(), $job['params']['project_id'] ?? '');
    if (!$p) throw new RuntimeException('Project not found');
    $lockFile = CACHE_DIR . '/deploy-' . $p['id'] . '.lock';
    $lockHandle = null;
    if (!wcp_acquire_lock($lockFile, $lockHandle)) {
        throw new RuntimeException('Another deployment for this project is currently in progress.');
    }
    $commit = 'unknown';
    $wasRunning = false;
    $svc = proj_service_job($p);
    if ($svc && job_status($svc)['status'] === 'running') { $wasRunning = true; }
    try {
        cli_log('Stopping active service before deploy...');
        cli_stop_service($p['id']);
        
        $p = proj_perform_deploy($p, $commit);
        
        if (($wasRunning || !empty($p['auto_start'])) && !empty($p['start_cmd'])) {
            cli_log('Restarting service with new commit ' . $commit . '...');
            cli_start_service($p);
        }
        cli_log('Deployment complete: commit ' . $commit);
        return 0;
    } catch (Throwable $e) {
        $list = proj_all();
        foreach ($list as &$x) {
            if ($x['id'] === $p['id']) {
                $x['last_deploy'] = ['time' => date('c'), 'commit' => $commit, 'status' => 'warn'];
            }
        }
        unset($x);
        proj_save_all($list);
        throw $e;
    } finally {
        wcp_release_lock($lockFile, $lockHandle);
    }
}

function cli_start_service(array $p) {
    if (!empty($p['port'])) {
        wcp_kill_port($p['port']);
        usleep(150000);
    }
    $deployDir = proj_resolve_deploy_path($p);
    if (!empty($deployDir)) {
        wcp_kill_directory_procs($deployDir);
    }
    $job = job_create('service', 'سرویس: ' . $p['name'], ['project_id' => $p['id']]);
    job_start($job);
    cli_log('Service job ' . $job['id'] . ' started');
    return $job;
}

function cli_stop_service(string $projectId) {
    $p = proj_find(proj_all(), $projectId);
    foreach (glob(JOBS_DIR . '/*.json') ?: [] as $f) {
        $j = json_decode((string)@file_get_contents($f), true);
        if (($j['type'] ?? '') === 'service' && ($j['params']['project_id'] ?? '') === $projectId) {
            $childPidFile = JOBS_DIR . '/' . $j['id'] . '.child_pid';
            if (is_file($childPidFile)) {
                $cpid = (int)trim((string)@file_get_contents($childPidFile));
                if ($cpid > 0 && job_pid_alive($cpid)) {
                    @sh('kill -9 -- -' . $cpid . ' 2>/dev/null; kill -9 ' . $cpid . ' 2>/dev/null');
                }
                @unlink($childPidFile);
            }
            if (job_status($j)['status'] === 'running') {
                job_stop($j);
            }
        }
    }
    if ($p) {
        $deployDir = proj_resolve_deploy_path($p);
        if (!empty($deployDir)) {
            wcp_kill_directory_procs($deployDir);
        }
        if (!empty($p['port'])) {
            wcp_kill_port($p['port']);
        }
    }
    usleep(250000);
}

function cli_service(array $job): int {
    $p = proj_find(proj_all(), $job['params']['project_id'] ?? '');
    if (!$p || empty($p['start_cmd'])) throw new RuntimeException('Missing project/start command');
    if (!function_exists('proc_open')) throw new RuntimeException('PHP CLI proc_open() is disabled');
    $stop = JOBS_DIR . '/' . $job['id'] . '.stop';
    @unlink($stop);
    $stopRequested = false;
    if (function_exists('pcntl_async_signals')) {
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, function() use (&$stopRequested) { $stopRequested = true; });
        pcntl_signal(SIGINT, function() use (&$stopRequested) { $stopRequested = true; });
    }
    $attempt = 0;
    $lastAutoUpdateCheck = time();
    $ph = null;
    $runner = '';
    try {
        while (!$stopRequested && !is_file($stop)) {
            $currentP = proj_find(proj_all(), $p['id']) ?: $p;
            $deployDir = proj_resolve_deploy_path($currentP);
            $startCmd = trim($currentP['start_cmd']);

            if (!is_dir($deployDir) || count(scandir($deployDir)) <= 2) {
                if (!empty($currentP['repo_url'])) {
                    cli_log("[service] Project directory '{$deployDir}' is missing or empty. Auto-deploying...");
                    $commitOut = null;
                    try {
                        proj_perform_deploy($currentP, $commitOut);
                        cli_log("[service] Auto-deployment succeeded (commit {$commitOut}).");
                    } catch (Throwable $de) {
                        cli_log("[service ERROR] Auto-deployment failed: " . mask_url($de->getMessage()));
                    }
                } else {
                    @mkdir($deployDir, 0777, true);
                }
            }

            if (!is_dir($deployDir)) {
                cli_log("[service ERROR] Deployment directory does not exist: {$deployDir}. Please run 'دیپلوی و به‌روزرسانی' first.");
                sleep(5);
                continue;
            }

            // 1. Auto-detect all potential ports used by the project
            $portsToFree = [];
            if (!empty($currentP['port']) && ctype_digit((string)$currentP['port'])) {
                $portsToFree[] = (int)$currentP['port'];
            }
            if (preg_match_all('/(?:--port|-p|\:)\s*(\d{2,5})|\bPORT\s*=\s*(\d{2,5})/i', $startCmd, $pm)) {
                foreach (array_merge($pm[1], $pm[2]) as $detectedPort) {
                    if ($detectedPort && ctype_digit($detectedPort)) $portsToFree[] = (int)$detectedPort;
                }
            }
            if (is_dir($deployDir)) {
                $envFile = $deployDir . '/.env';
                if (is_file($envFile)) {
                    $envContent = (string)@file_get_contents($envFile);
                    if (preg_match_all('/(?:PORT|PORT_NUMBER|SCRAPER_PORT|DEPLOYER_UI_PORT|FLASK_RUN_PORT)\s*=\s*(\d{2,5})/i', $envContent, $epm)) {
                        foreach ($epm[1] as $ep) $portsToFree[] = (int)$ep;
                    }
                }
                foreach (glob($deployDir . '/*.py') ?: [] as $pyf) {
                    $pyc = (string)@file_get_contents($pyf);
                    if (preg_match_all('/(?:port\s*=\s*|PORT\s*=\s*)(\d{2,5})/i', $pyc, $spm)) {
                        foreach ($spm[1] as $sp) $portsToFree[] = (int)$sp;
                    }
                }
            }
            // Add standard defaults for Python web apps (Flask, Scraper, FastAPI)
            if (empty($portsToFree)) {
                $portsToFree = [8000, 5000, 8790, 3000];
            }
            $portsToFree = array_unique(array_filter($portsToFree, fn($pt) => $pt > 0 && $pt < 65536));

            // 2. Preemptively release all candidate ports
            foreach ($portsToFree as $pt) {
                wcp_kill_port($pt);
            }
            if (!empty($deployDir)) {
                wcp_kill_directory_procs($deployDir);
            }
            if (preg_match('/(?:python3?|node)\s+([a-zA-Z0-9_\-\.\/]+)/', $startCmd, $sm)) {
                $scriptBase = basename($sm[1]);
                if ($scriptBase !== '' && !in_array($scriptBase, ['python', 'python3', 'node', 'sh', 'bash'], true)) {
                    @shell_exec("pkill -9 -f " . escapeshellarg($scriptBase) . " 2>/dev/null");
                }
            }
            usleep(150000);

            if (is_dir($deployDir)) {
                if (preg_match('/^python3?\s+([a-zA-Z0-9_\-\.\/]+)$/', $startCmd, $m)) {
                    $targetFile = $deployDir . '/' . $m[1];
                    if (!is_file($targetFile)) {
                        $candidates = ['scraper4.py', 'app.py', 'server.py', 'run.py', 'bot.py', 'deployer4.py', 'main.py'];
                        $found = null;
                        foreach ($candidates as $cand) {
                            if (is_file($deployDir . '/' . $cand)) { $found = $cand; break; }
                        }
                        if (!$found) {
                            foreach (glob($deployDir . '/*.py') ?: [] as $pf) {
                                $bn = basename($pf);
                                if ($bn !== '__init__.py' && $bn[0] !== '.') { $found = $bn; break; }
                            }
                        }
                        if ($found) {
                            cli_log("[launcher] Notice: '{$m[1]}' not found in {$deployDir}. Auto-resolved entrypoint to '{$found}'.");
                            $startCmd = 'python3 ' . $found;
                        }
                    }
                }
            }

                        // Auto-synchronize .env file in project directory with chosen port
            if (is_dir($deployDir) && !empty($chosenPort)) {
                $envFile = $deployDir . '/.env';
                $existingEnv = is_file($envFile) ? (string)@file_get_contents($envFile) : '';
                $pKeys = ['PORT', 'APP_PORT', 'FLASK_RUN_PORT', 'SERVER_PORT', 'SCRAPER_PORT', 'DEPLOYER_UI_PORT', 'UVICORN_PORT', 'WEB_PORT'];
                foreach ($pKeys as $pk) {
                    if (preg_match('/^' . $pk . '=.*$/m', $existingEnv)) {
                        $existingEnv = preg_replace('/^' . $pk . '=.*$/m', $pk . '=' . $chosenPort, $existingEnv);
                    } else {
                        $existingEnv .= "\n" . $pk . '=' . $chosenPort;
                    }
                }
                wcp_put_contents($envFile, trim($existingEnv) . "\n");
            }

            $runner = CACHE_DIR . '/svc-run-' . $job['id'] . '.sh';
            $script = "#!/bin/bash\nset -e\ncd " . esc($deployDir) . "\nexport NODE_ENV=production\nexport PYTHONUNBUFFERED=1\n";
            foreach (proj_runtime_env($currentP) as $k => $v) $script .= "export " . esc($k . '=' . $v) . "\n";
            $chosenPort = !empty($currentP['port']) ? $currentP['port'] : (!empty($portsToFree) ? reset($portsToFree) : '');
            if (!empty($chosenPort)) {
                $script .= "export PORT=" . esc($chosenPort) . "\n";
                $script .= "export APP_PORT=" . esc($chosenPort) . "\n";
                $script .= "export FLASK_RUN_PORT=" . esc($chosenPort) . "\n";
                $script .= "export SERVER_PORT=" . esc($chosenPort) . "\n";
                $script .= "export SCRAPER_PORT=" . esc($chosenPort) . "\n";
                $script .= "export DEPLOYER_UI_PORT=" . esc($chosenPort) . "\n";
                $script .= "export UVICORN_PORT=" . esc($chosenPort) . "\n";
                $script .= "if [ -n \"\$PORT\" ]; then (fuser -k -9 \"\$PORT/tcp\" 2>/dev/null || true); (lsof -ti :\"\$PORT\" 2>/dev/null | xargs -r kill -9 2>/dev/null || true); fi\n";
            }
            $script .= str_replace(["\r\n", "\r"], "\n", $startCmd) . "\n";
            $script = str_replace(["\r\n", "\r"], "\n", $script);
            wcp_put_contents($runner, $script, false);
            @chmod($runner, 0755);
            $started = microtime(true);
            cli_log('Starting service attempt ' . (++$attempt));
            $cmdArr = which('nice') ? ['nice', '-n', '10', 'bash', $runner] : ['bash', $runner];
            $ph = proc_open($cmdArr, [0 => ['file', '/dev/null', 'r'], 1 => ['file', $job['log'], 'a'], 2 => ['file', $job['log'], 'a']], $pipes);
            if (!is_resource($ph)) throw new RuntimeException('Cannot start service');
            $st = proc_get_status($ph);
            wcp_put_contents(JOBS_DIR . '/' . $job['id'] . '.child_pid', $st['pid'] . "\n", false);
            $childRunning = $st['running'];

            while ($childRunning && !$stopRequested && !is_file($stop)) {
                usleep(500000);
                $st = proc_get_status($ph);
                $childRunning = $st['running'];
                if (!empty($currentP['auto_update'])) {
                    $interval = max(30, (int)($currentP['auto_update_interval'] ?? 60));
                    if (time() - $lastAutoUpdateCheck >= $interval) {
                        $lastAutoUpdateCheck = time();
                        $remote = proj_check_remote_commit($currentP);
                        $local = $currentP['last_deploy']['commit'] ?? '';
                        if (empty($local) && is_dir($deployDir)) {
                            $local = trim(sh_ok('git -c safe.directory=* -C ' . esc($deployDir) . ' rev-parse --short HEAD 2>/dev/null'));
                        }
                        if (empty($local) && is_file($deployDir . '/.deploy.json')) {
                            $depMeta = json_decode((string)@file_get_contents($deployDir . '/.deploy.json'), true);
                            if (!empty($depMeta['commit'])) $local = $depMeta['commit'];
                        }
                        $hasUpdate = ($remote && ($local === '' || substr($remote, 0, 7) !== substr($local, 0, 7)));
                        if ($hasUpdate) {
                            cli_log("Auto-update detected new commit {$remote} (current: {$local}). Initiating auto-deployment...");
                            $k = is_executable('/bin/kill') ? '/bin/kill' : 'kill';
                            if ($st['pid']) sh($k . ' -TERM -- -' . $st['pid'] . ' 2>/dev/null; ' . $k . ' -TERM ' . $st['pid'] . ' 2>/dev/null');
                            proc_close($ph);
                            $ph = null;
                            foreach ($portsToFree as $pt) wcp_kill_port($pt);
                            wcp_kill_directory_procs($deployDir);
                            $depJob = job_create('deploy', 'به‌روزرسانی خودکار: ' . $currentP['name'] . ' (' . $remote . ')', ['project_id' => $currentP['id']]);
                            job_start($depJob);
                            return 0;
                        }
                    }
                }
            }

            $code = $st['exitcode'];
            proc_close($ph);
            $ph = null;

            // 3. Inspect recent log tail for port conflict and missing dependencies (Instant Self-Healing)
            $logTail = '';
            if (is_file($job['log'])) {
                $logTail = (string)sh_ok('tail -n 40 ' . esc($job['log']));
            }
            
            $depsAutoInstalled = false;

            // A) Check for missing Python/Node dependencies
            if ($code !== 0) {
                // Pattern 1: Explicit missing dependency suggestions (e.g. "Missing dependency. Run: pip3 install flask requests beautifulsoup4 lxml")
                if (preg_match('/(?:Missing dependency\.?\s*(?:Run:?)?|Please run:?)\s*pip3?\s+install\s+([^\r\n]+)/i', $logTail, $dpm)) {
                    $rawPkgs = trim($dpm[1]);
                    if ($rawPkgs !== '') {
                        cli_log("[auto-installer] Detected missing dependencies from application error: {$rawPkgs}. Installing via pip3...");
                        $pipCmd = 'pip3 install --break-system-packages --no-warn-script-location ' . $rawPkgs . ' 2>&1 || pip3 install --user --no-warn-script-location ' . $rawPkgs . ' 2>&1 || pip3 install --no-warn-script-location ' . $rawPkgs . ' 2>&1 || pip install ' . $rawPkgs . ' 2>&1';
                        cli_run($pipCmd);
                        cli_log("[auto-installer] Successfully installed: {$rawPkgs}");
                        $depsAutoInstalled = true;
                    }
                }
                // Pattern 2: ModuleNotFoundError / ImportError (e.g. "ModuleNotFoundError: No module named 'requests'")
                if (!$depsAutoInstalled && preg_match_all('/(?:ModuleNotFoundError:\s*No module named|ImportError:\s*No module named|cannot import name [^\r\n]+ from)\s*[\'"]([a-zA-Z0-9_\-]+)[\'"]/i', $logTail, $mpm)) {
                    $modMap = [
                        'bs4' => 'beautifulsoup4', 'dotenv' => 'python-dotenv', 'python_dotenv' => 'python-dotenv',
                        'yaml' => 'pyyaml', 'PIL' => 'pillow', 'telebot' => 'pyTelegramBotAPI',
                        'telegram' => 'python-telegram-bot', 'jwt' => 'pyjwt', 'cv2' => 'opencv-python-headless',
                        'sklearn' => 'scikit-learn', 'psycopg2' => 'psycopg2-binary', 'MySQLdb' => 'mysqlclient',
                        'dateutil' => 'python-dateutil', 'magic' => 'python-magic', 'Crypto' => 'pycryptodome',
                        'cryptography' => 'cryptography', 'jose' => 'python-jose', 'multipart' => 'python-multipart',
                        'docx' => 'python-docx', 'pptx' => 'python-pptx', 'openpyxl' => 'openpyxl', 'xlsxwriter' => 'xlsxwriter'
                    ];
                    $missingMods = array_unique($mpm[1]);
                    $pkgsToInstall = [];
                    foreach ($missingMods as $mName) {
                        $pName = $modMap[$mName] ?? $mName;
                        $pkgsToInstall[] = escapeshellarg($pName);
                    }
                    if (!empty($pkgsToInstall)) {
                        $pkgStr = implode(' ', $pkgsToInstall);
                        cli_log("[auto-installer] Detected missing Python module(s): " . implode(', ', $missingMods) . " (packages: {$pkgStr}). Auto-installing via pip3...");
                        $pipCmd = 'pip3 install --break-system-packages --no-warn-script-location ' . $pkgStr . ' 2>&1 || pip3 install --user --no-warn-script-location ' . $pkgStr . ' 2>&1 || pip3 install --no-warn-script-location ' . $pkgStr . ' 2>&1 || pip install ' . $pkgStr . ' 2>&1';
                        cli_run($pipCmd);
                        cli_log("[auto-installer] Installation completed for: {$pkgStr}");
                        $depsAutoInstalled = true;
                    }
                }
                // Pattern 3: Node.js missing module (e.g. "Cannot find module 'express'")
                if (!$depsAutoInstalled && preg_match('/Cannot find module\s*[\'"]([a-zA-Z0-9_\-\.\@\/]+)[\'"]/i', $logTail, $npmM)) {
                    $nodePkg = trim($npmM[1]);
                    if ($nodePkg !== '' && $nodePkg[0] !== '.' && $nodePkg[0] !== '/') {
                        cli_log("[auto-installer] Detected missing Node.js module: {$nodePkg}. Auto-installing via npm...");
                        cli_run('cd ' . esc($deployDir) . ' && npm install ' . esc($nodePkg) . ' --no-audit --no-fund 2>&1');
                        cli_log("[auto-installer] Installed Node.js module: {$nodePkg}");
                        $depsAutoInstalled = true;
                    }
                }
            }

            // B) Check for port collision
            if ($code !== 0 && (stripos($logTail, 'Address already in use') !== false || stripos($logTail, 'is in use by another program') !== false || stripos($logTail, 'EADDRINUSE') !== false)) {
                if (preg_match('/(?:Port\s+(\d+)\s+is\s+in\s+use|EADDRINUSE[^\d]*(\d+)|(?:port|\:)\s*(\d{2,5}))/i', $logTail, $lpm)) {
                    $failedPort = 0;
                    for ($gi = 1; $gi < count($lpm); $gi++) {
                        if (!empty($lpm[$gi])) { $failedPort = (int)$lpm[$gi]; break; }
                    }
                    if ($failedPort > 0) {
                        cli_log("[port-guard] Detected port {$failedPort} conflict from process log. Forcefully releasing port {$failedPort}...");
                        wcp_kill_port($failedPort);
                        usleep(300000);
                    }
                } else {
                    foreach ($portsToFree as $pt) wcp_kill_port($pt);
                }
            }

            if ($depsAutoInstalled) {
                cli_log("[auto-installer] Dependencies installed successfully. Restarting service attempt immediately...");
                $attempt = 0;
                usleep(200000);
                continue;
            }

            $dur = microtime(true) - $started;
            cli_log('Service exited: ' . $code);
            if ($stopRequested || is_file($stop)) break;
            if ($dur > 30) $attempt = 0;
            $backoff = min(60, pow(2, min($attempt, 6)));
            for ($i = 0; $i < $backoff; $i++) {
                if ($stopRequested || is_file($stop)) break 2;
                sleep(1);
            }
        }
        return 0;
    } finally {
        if ($ph && is_resource($ph)) {
            $st = proc_get_status($ph);
            if ($st['running']) {
                $k = is_executable('/bin/kill') ? '/bin/kill' : 'kill';
                if ($st['pid']) sh($k . ' -KILL -- -' . $st['pid'] . ' 2>/dev/null; ' . $k . ' -KILL ' . $st['pid'] . ' 2>/dev/null');
            }
            proc_close($ph);
        }
        if (!empty($p['port'])) wcp_kill_port($p['port']);
        $deployDir = proj_resolve_deploy_path($p);
        if (!empty($deployDir)) wcp_kill_directory_procs($deployDir);
        @unlink($runner);
        @unlink(JOBS_DIR . '/' . $job['id'] . '.child_pid');
    }
}
function wcp_cli(array $argv) {
    if (in_array('--auto-update', $argv, true)) {
        @set_time_limit(300);
        $res = proj_poll_auto_updates();
        echo "[auto-update] Checked projects. Triggered " . $res['count'] . " deployments.\n";
        exit(0);
    }
    if(isset($argv[1])&&strpos($argv[1],'--bgjob=')===0){
        $id=substr($argv[1],8);$job=job_get($id);
        if (!$job) { fwrite(STDERR, "Background job metadata not found in " . JOBS_DIR . "\n"); exit(1); }
        if (!empty($job['launch_token'])) {
            if (is_file(JOBS_DIR . '/' . $id . '.exit') || time() > (int)$job['launch_deadline']) {
                fwrite(STDERR, "Background launch was cancelled or expired.\n"); exit(127);
            }
            $ack = ['token' => $job['launch_token'], 'pid' => getmypid()];
            if (!wcp_put_contents(JOBS_DIR . '/' . $id . '.started.json', json_encode($ack), false)) {
                fwrite(STDERR, "Cannot write background startup acknowledgement.\n"); exit(127);
            }
            wcp_put_contents(JOBS_DIR . '/' . $id . '.pid', getmypid() . "\n", false);
        }
        @set_time_limit(0);ini_set('memory_limit','512M');$code=1;cli_log('WebConsole job '.$id.' ('.$job['type'].')');
        try{switch($job['type']){case 'backup':$code=cli_backup($job);break;case 'restore':$code=cli_restore($job);break;case 'deploy':$code=cli_deploy($job);break;case 'service':$code=cli_service($job);break;default:throw new RuntimeException('Unknown job type');}}
        catch(Throwable $e){cli_log('ERROR: '.mask_url($e->getMessage()));$code=1;}
        $exit=JOBS_DIR.'/'.$id.'.exit';if(!is_file($exit))wcp_put_contents($exit,$code."\n",false);exit($code);
    }
    exit(0);
}
if (PHP_SAPI === 'cli') {
    if (defined('WCP_LIBRARY_ONLY') && WCP_LIBRARY_ONLY === true) return;
    wcp_cli($argv ?? []);
}
function page_head(){
    $c = cfg();
    $boot = [
        'csrf' => $_SESSION['wcp_csrf'] ?? '',
        'v' => WCP_VERSION,
        'theme' => $c['theme'],
        'layout' => $c['layout'],
        'density' => $c['density'],
        'fs_start' => $c['fs_start'],
        'host' => gethostname(),
        'term_mode' => term_mode(),
        'setup' => $c['pass_hash'] === ''
    ];
    echo '<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>وب‌کنسول Pro</title><script>const __BOOT=' . json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) . ';</script>';
}
function render_css(){ob_start();?>
<style>
:root{
  --bg:#090d16;
  --panel:#0f172a;
  --panel2:#0a101f;
  --panel3:#16223b;
  --line:#1e293b;
  --line2:#334155;
  --txt:#f8fafc;
  --mut:#94a3b8;
  --acc:#6366f1;
  --acc-hover:#4f46e5;
  --acc2:#38bdf8;
  --ok:#10b981;
  --warn:#f59e0b;
  --err:#ef4444;
  --r:12px;
  --sw1:#6366f1;
  --sw2:#38bdf8;
}
[data-theme=light]{
  --bg:#f1f5f9;
  --panel:#ffffff;
  --panel2:#f8fafc;
  --panel3:#e2e8f0;
  --line:#e2e8f0;
  --line2:#cbd5e1;
  --txt:#0f172a;
  --mut:#64748b;
  --acc:#4f46e5;
  --acc-hover:#4338ca;
  --acc2:#0284c7;
  --ok:#059669;
  --warn:#d97706;
  --err:#dc2626;
  --sw1:#4f46e5;
  --sw2:#0284c7;
}
[data-theme=forest]{
  --bg:#051410;
  --panel:#0a201b;
  --panel2:#071915;
  --panel3:#10332c;
  --line:#164238;
  --line2:#235e50;
  --txt:#f0fdf4;
  --mut:#86efac;
  --acc:#10b981;
  --acc-hover:#059669;
  --acc2:#34d399;
  --sw1:#10b981;
  --sw2:#34d399;
}
[data-theme=ocean]{
  --bg:#06101e;
  --panel:#0b192e;
  --panel2:#081324;
  --panel3:#102747;
  --line:#173b6c;
  --line2:#225396;
  --txt:#f0f9ff;
  --mut:#7dd3fc;
  --acc:#0284c7;
  --acc-hover:#0369a1;
  --acc2:#38bdf8;
  --sw1:#0284c7;
  --sw2:#38bdf8;
}
[data-theme=amber]{
  --bg:#140e06;
  --panel:#20170a;
  --panel2:#181107;
  --panel3:#30230f;
  --line:#473417;
  --line2:#694d22;
  --txt:#fffbeb;
  --mut:#fcd34d;
  --acc:#d97706;
  --acc-hover:#b45309;
  --acc2:#f59e0b;
  --sw1:#d97706;
  --sw2:#f59e0b;
}

*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background: var(--bg);
  color: var(--txt);
  font: 13.5px/1.6 Vazirmatn, -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif;
  direction: rtl;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
button, input, textarea, select {
  font: inherit;
  color: inherit;
}
button { cursor: pointer; touch-action: manipulation; }
a { color: var(--acc2); text-decoration: none; }
a:hover { text-decoration: underline; }
.hide { display: none !important; }
.ltr { direction: ltr; text-align: left; }
.hint, small { color: var(--mut); font-size: 11.5px; }

/* ── Typography & Cards ── */
h1 { font-size: 18px; margin: 0 0 8px; font-weight: 700; }
h3 { font-size: 14.5px; margin: 0 0 10px; font-weight: 700; color: var(--txt); }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
}
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }

/* ── Buttons & Inputs ── */
.btn {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line2);
  border-radius: 8px;
  padding: 7px 12px;
  background: var(--panel2);
  color: var(--txt);
  font-weight: 600;
  font-size: 12.5px;
  transition: all .15s ease;
  white-space: nowrap;
}
.btn:hover { background: var(--panel3); border-color: var(--acc); }
.btn:active { transform: scale(0.97); }
.btn.pri { background: var(--acc); color: #fff; border-color: var(--acc); }
.btn.pri:hover { background: var(--acc-hover); }
.btn.danger { color: var(--err); border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); }
.btn.danger:hover { background: rgba(239,68,68,0.2); }
.btn.ok { color: var(--ok); border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.08); }
.btn.sm { padding: 4px 9px; font-size: 11.5px; border-radius: 6px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }

.inp, .mini {
  background: var(--panel2);
  border: 1px solid var(--line2);
  border-radius: 8px;
  padding: 8px 12px;
  width: 100%;
  outline: none;
  color: var(--txt);
  transition: border-color .15s, box-shadow .15s;
}
.inp:focus, .mini:focus { border-color: var(--acc); box-shadow: 0 0 0 2px rgba(99,102,241,0.25); }
textarea.inp { min-height: 80px; resize: vertical; line-height: 1.5; }
.mini { width: auto; padding: 5px 8px; font-size: 12px; }
.lb { display: block; color: var(--mut); font-size: 11.5px; font-weight: 600; margin: 8px 0 4px; }

/* ── Badges & Tags ── */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--line2);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mut);
  background: var(--panel2);
}
.tag.ok { color: var(--ok); border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.1); }
.tag.err { color: var(--err); border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.1); }
.tag.acc { color: var(--acc2); border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.1); }
.tag.warn { color: var(--warn); border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.1); }
.pulse-badge { color: var(--ok); font-size: 11.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }

/* ── App Shell Structure ── */
#app { height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }

/* Top Header */
#topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  min-height: 50px;
  flex-shrink: 0;
  z-index: 10;
}
.top-brand { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  background: var(--acc);
  color: #fff;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 2px 6px rgba(99,102,241,0.4);
}
.brand-sub { font-size: 10px; background: var(--acc); color: #fff; padding: 1px 5px; border-radius: 4px; vertical-align: middle; }
.hosttag-pill {
  direction: ltr;
  background: var(--panel2);
  border: 1px solid var(--line2);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--mut);
}
.top-actions { display: flex; align-items: center; gap: 6px; }
.top-actions .btn { padding: 5px 10px; font-size: 12px; }

/* Workspace Bar */
#workspacebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  background: var(--panel2);
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  color: var(--mut);
  flex-shrink: 0;
}
#workspacebar .tag { margin-right: auto; }

/* Main Area */
#main { display: flex; flex: 1; min-height: 0; position: relative; overflow: hidden; }

/* Desktop Sidebar */
#sidebar {
  width: 200px;
  padding: 10px 8px;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
  flex-shrink: 0;
}
#sidebar button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: right;
  border: 0;
  background: transparent;
  color: var(--mut);
  padding: 8px 12px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  transition: all .15s;
}
#sidebar button:hover { background: var(--panel2); color: var(--txt); }
#sidebar button.on { background: var(--panel2); color: var(--acc2); font-weight: 700; border-right: 3px solid var(--acc2); }
.nav-icon { display: inline-flex; align-items: center; font-size: 15px; }

/* Content Area & Views */
#content { flex: 1; position: relative; min-width: 0; height: 100%; overflow: hidden; }
.view {
  display: none;
  position: absolute;
  inset: 0;
  padding: 14px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.view.on { display: block; }

/* Mobile Bottom Navigation */
#navbottom {
  display: none;
  background: var(--panel);
  border-top: 1px solid var(--line);
  padding: 4px 0;
  padding-bottom: env(safe-area-inset-bottom, 4px);
  flex-shrink: 0;
  justify-content: space-around;
  align-items: center;
  z-index: 10;
}
#navbottom button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--mut);
  padding: 4px 2px;
  font-size: 10px;
  min-width: 0;
  transition: color .15s;
}
#navbottom button.on { color: var(--acc2); font-weight: 700; }
#navbottom .nav-icon svg { width: 18px; height: 18px; }

/* Responsive rules for Mobile */
@media(max-width: 899px) {
  #sidebar { display: none; }
  #navbottom { display: flex; }
  .grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid2 { grid-template-columns: 1fr; }
  .view { padding: 10px; }
  #topbar { padding: 6px 10px; min-height: 44px; }
  .top-brand .brand-text { font-size: 13px; }
  #workspacebar { padding: 3px 10px; font-size: 11px; }
  .top-actions .btn .btn-lbl { display: none; }
  .top-actions .btn { padding: 4px 8px; }
}

/* ── Login / Setup Page ── */
body.login-page {
  overflow-y: auto !important;
  height: auto !important;
  min-height: 100vh !important;
  min-height: 100dvh !important;
  display: block !important;
}
#login {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  overflow-y: auto;
  box-sizing: border-box;
  background: radial-gradient(circle at 50% 30%, #15223e 0%, #060b14 100%);
}
.login-card {
  width: min(420px, 100%);
  max-width: 100%;
  margin: auto;
  padding: 28px 24px;
  border-radius: 16px;
  background: var(--panel);
  border: 1px solid var(--line2);
  box-shadow: 0 16px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.2);
  text-align: center;
  box-sizing: border-box;
}
.login-brand { display: inline-flex; margin-bottom: 12px; }
.login-brand .brand-mark { width: 44px; height: 44px; font-size: 24px; border-radius: 12px; }
.login-card h1 { font-size: 21px; font-weight: 800; color: var(--txt); margin-bottom: 6px; }
.login-card .hint { line-height: 1.6; margin-bottom: 20px; }
.login-card .form-group { text-align: right; margin-bottom: 14px; }
.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap .inp { padding-left: 38px; }
.pwd-toggle {
  position: absolute;
  left: 6px;
  background: transparent;
  border: 0;
  color: var(--mut);
  padding: 4px 6px;
  font-size: 14px;
  cursor: pointer;
}
.lgsubmit-btn { width: 100%; margin-top: 10px; padding: 10px; font-size: 14px; }
.login-footer {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--mut);
  line-height: 1.6;
}

/* ── Dashboard (v-dash) ── */
.dash-hero-card { position: relative; border-top: 3px solid var(--acc); }
.dash-hero-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.dash-server-title { display: flex; align-items: center; gap: 10px; }
.server-status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px var(--ok); flex-shrink: 0; }
.dash-meta-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.sys-kernel-line { word-break: break-all; margin: 4px 0 14px; font-size: 11.5px; }

/* Stat Boxes */
.stat {
  padding: 12px;
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 94px;
}
.stat-top { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--mut); font-weight: 600; }
.badge-mini { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--panel3); color: var(--txt); }
.badge-mini.ok { color: var(--ok); background: rgba(16,185,129,0.15); }
.stat .v { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.02em; color: var(--txt); margin: 2px 0; }
.stat .v-sub { font-size: 12px; font-weight: 400; color: var(--mut); }
.stat small { font-size: 11px; color: var(--mut); }
.bar { height: 6px; background: var(--line); border-radius: 10px; overflow: hidden; margin: 6px 0; }
.bar i { display: block; height: 100%; background: var(--acc2); border-radius: 10px; transition: width .3s ease; }
.bar i.err { background: var(--err); }
.bar i.ok { background: var(--ok); }
.font-uptime { font-size: 1.15rem !important; }

/* Tools List */
.tools-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--line2);
  background: var(--panel2);
}
.tool-pill.installed { color: var(--ok); border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.06); }
.tool-pill.missing { color: var(--mut); opacity: 0.6; }
.tool-ic { font-weight: 800; font-size: 11px; }

/* Quick actions */
.quick-nav-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ── Terminal (v-term) ── */
#termwrap { height: 100%; display: flex; flex-direction: column; gap: 6px; }
#termbox {
  flex: 1;
  min-height: 120px;
  background: #05080f;
  direction: ltr;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  touch-action: pan-y pinch-zoom;
  position: relative;
}
#termbox .xterm { height: 100%; }
#termbox .xterm-screen, #termbox .xterm-viewport {
  touch-action: pan-y !important;
  -webkit-overflow-scrolling: touch !important;
}
#termbox, #termbox .xterm, #termbox .xterm-screen, #termbox .xterm-viewport, .logbox, #fallbacklog {
  user-select: text !important;
  -webkit-user-select: text !important;
}
::selection { background: rgba(99, 102, 241, 0.45); color: #fff; }
#keybar, .quick { display: flex; gap: 4px; overflow-x: auto; flex-shrink: 0; padding: 2px 0; }
#keybar button { min-width: 36px; flex-shrink: 0; padding: 3px 6px; font-size: 11px; }
.termstatus { font-size: 11px; color: var(--mut); }
.mob-dock {
  display: flex;
  gap: 4px;
  align-items: center;
  background: var(--panel);
  padding: 4px 6px;
  border: 1px solid var(--line2);
  border-radius: 8px;
  flex-shrink: 0;
}
.mob-dock .inp { padding: 6px 9px; font-size: 13px; flex: 1; border-radius: 6px; }
.mob-dock .btn { padding: 5px 8px; font-size: 11.5px; white-space: nowrap; border-radius: 6px; }
@media(min-width: 900px) { .mob-dock { display: none; } }

/* ── File Manager (v-files) ── */
.frow { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.frow:hover { background: var(--panel2); }
.frow.sel { background: rgba(99, 102, 241, 0.12); }
.frow .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; cursor: pointer; }
.frow .sz { font-size: 11px; color: var(--mut); }
#crumb { direction: ltr; overflow-wrap: anywhere; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; background: var(--panel2); }
#selbar { display: none; position: sticky; bottom: 0; background: var(--panel); border: 1px solid var(--line2); padding: 8px; gap: 6px; flex-wrap: wrap; z-index: 5; }
#selbar.on { display: flex; }
.view-tools { display: flex; gap: 6px; align-items: center; margin: 6px 0 10px; }
.view-tools .inp { flex: 1; }

/* ── Tables & Lists ── */
.tblwrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
.tbl { border-collapse: collapse; width: 100%; font-size: 12px; }
.tbl th, .tbl td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--line); }
.tbl th { background: var(--panel2); color: var(--mut); font-weight: 700; white-space: nowrap; }
.cmdcol { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; text-align: left !important; }
.numcol { direction: ltr; }
.li {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  margin: 6px 0;
  background: var(--panel2);
}
.li .t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.acts { display: flex; gap: 5px; flex-wrap: wrap; }
.empty { text-align: center; color: var(--mut); padding: 24px; }
.chk { width: 17px; height: 17px; accent-color: var(--acc); cursor: pointer; }

/* ── Modals & Sheets ── */
#modals { display: none; position: fixed; inset: 0; z-index: 80; }
#modals.on { display: block; }
.mback { position: absolute; inset: 0; background: rgba(2, 6, 16, 0.75); backdrop-filter: blur(4px); }
.msheet {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 90vh;
  max-height: 90dvh;
  overflow-y: auto;
  background: var(--panel);
  padding: 16px;
  border: 1px solid var(--line2);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 30px rgba(0,0,0,0.5);
}
@media(min-width: 900px) {
  .msheet {
    top: 50%;
    bottom: auto;
    left: 50%;
    right: auto;
    transform: translate(-50%, -50%);
    width: min(840px, 92vw);
    max-height: 85vh;
    border-radius: 14px;
  }
}
.mhead { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
.mhead .x { margin-inline-start: auto; }
#toasts { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: min(90vw, 420px); z-index: 100; pointer-events: none; }
.toast { background: var(--panel); padding: 10px 14px; margin: 6px 0; border: 1px solid var(--line2); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); font-weight: 600; font-size: 12.5px; }
.toast.err { border-color: var(--err); color: var(--err); }
.toast.ok { border-color: var(--ok); color: var(--ok); }
.segtabs { display: flex; gap: 6px; margin-bottom: 12px; }
.segtabs button { flex: 1; }
.logbox { direction: ltr; text-align: left; background: #05080f; color: #c8d6ee; padding: 10px; border: 1px solid var(--line); border-radius: 8px; font: 12px/1.5 ui-monospace, monospace; overflow: auto; max-height: 50vh; }
.appearance-note { padding: 10px; border-right: 3px solid var(--acc2); background: var(--panel2); border-radius: 6px; margin: 8px 0; }
.skin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px; }
.skin-choice { display: flex; flex-direction: column; align-items: stretch; text-align: right; padding: 10px; border-radius: 8px; background: var(--panel2); border: 1px solid var(--line2); gap: 6px; }
.skin-choice[aria-pressed=true] { outline: 2px solid var(--acc2); outline-offset: 2px; }
.skin-swatch { height: 24px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: linear-gradient(110deg, var(--sw1) 65%, var(--sw2) 65%); }
.palette-item { width: 100%; text-align: right; justify-content: flex-start; padding: 10px 12px; margin: 4px 0; }
.check-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.check-row p { margin: 0; overflow-wrap: anywhere; }
.check-row b { display: block; }

/* ── Custom Layouts & Density ── */
[data-density=compact] .card { padding: 8px 10px; margin-bottom: 8px; }
[data-density=compact] .li, [data-density=compact] .frow, [data-density=compact] .tbl td { padding: 4px 8px; }
[data-density=compact] .view { padding: 8px; }
[data-density=compact] #sidebar button { padding: 5px 8px; font-size: 12px; }

@media(min-width: 900px) {
  [data-layout=studio] #main { flex-direction: column; }
  [data-layout=studio] #sidebar { width: 100%; display: flex; flex-direction: row; border-left: 0; border-bottom: 1px solid var(--line); padding: 6px 12px; gap: 6px; overflow-x: auto; flex-shrink: 0; }
  [data-layout=studio] #sidebar button { width: auto; white-space: nowrap; margin: 0; padding: 6px 12px; }
  [data-layout=studio] #sidebar button.on { border-right: 0; box-shadow: inset 0 -2px var(--acc2); }
  [data-layout=focus] #sidebar { width: 56px; }
  [data-layout=focus] #sidebar .nav-caption { display: none; }
  [data-layout=focus] #sidebar button { justify-content: center; padding: 10px 4px; }
  [data-layout=classic] #sidebar:after { content: "WEBCONSOLE PRO"; display: block; margin-top: auto; padding-top: 16px; text-align: center; font: 9px monospace; letter-spacing: .12em; color: var(--mut); }
}

/* Keyboard active state on Mobile */
body.kbd-active #topbar, body.kbd-active #workspacebar, body.kbd-active #navbottom { display: none !important; }
body.kbd-active #main { height: 100% !important; }
body.kbd-active .view { padding: 2px !important; }

@media(prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; scroll-behavior: auto !important; } }



.msheet.msheet-editor {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
  padding: 8px;
  padding-bottom: max(8px, env(safe-area-inset-bottom, 8px));
  margin: 0;
  transform: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 95;
  background: var(--panel);
}
@media(min-width: 900px) {
  .msheet.msheet-editor {
    position: absolute;
    top: 50%;
    bottom: auto;
    left: 50%;
    right: auto;
    transform: translate(-50%, -50%);
    width: min(1300px, 96vw);
    height: 90vh;
    height: 90dvh;
    max-height: 92dvh;
    border-radius: 14px;
    padding: 14px;
  }
}
.msheet.msheet-fullscreen {
  position: fixed !important;
  inset: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  max-height: 100dvh !important;
  border-radius: 0 !important;
  transform: none !important;
  z-index: 99 !important;
  padding: 10px !important;
  padding-bottom: max(10px, env(safe-area-inset-bottom, 10px)) !important;
}
.ed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  margin-bottom: 6px;
  font-size: 13.5px;
  font-weight: 700;
}
.ed-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--panel2);
  border: 1px solid var(--line2);
  border-radius: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.ed-toolbar::-webkit-scrollbar { height: 4px; }
.ed-toolbar::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 4px; }
.ed-toolbar .btn, .ed-toolbar select, .ed-toolbar label {
  flex-shrink: 0;
}
.ed-container {
  flex: 1 1 0%;
  min-height: 180px;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #05080f;
}
.ed-container #edcm, .ed-container #edta {
  flex: 1 1 100%;
  height: 100% !important;
  min-height: 100% !important;
  width: 100% !important;
  display: flex;
  flex-direction: column;
}
.ed-container .CodeMirror {
  flex: 1 1 100% !important;
  height: 100% !important;
  min-height: 160px !important;
  width: 100% !important;
  direction: ltr !important;
  text-align: left !important;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace !important;
  font-size: 13.5px;
  line-height: 1.55;
}
.ed-container .CodeMirror-scroll {
  height: 100% !important;
  min-height: 160px !important;
  -webkit-overflow-scrolling: touch !important;
  touch-action: pan-x pan-y !important;
}
.ed-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  background: var(--panel2);
  border-top: 1px solid var(--line2);
  font-size: 11.5px;
  color: var(--mut);
  flex-shrink: 0;
  overflow-x: auto;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}
.ed-badge-dirty {
  background: rgba(239, 68, 68, 0.18) !important;
  color: #f87171 !important;
  border: 1px solid rgba(239, 68, 68, 0.35) !important;
  animation: ed-pulse 1.8s infinite;
}
@keyframes ed-pulse {
  0% { opacity: 0.8; }
  50% { opacity: 1; transform: scale(1.02); }
  100% { opacity: 0.8; }
}
.ed-banner {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}
.ed-banner.err { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; }
.ed-banner.ok { background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); color: #86efac; }
.ed-quick-keys {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 4px 0 2px;
  flex-shrink: 0;
}
.ed-quick-keys button {
  min-width: 32px;
  height: 28px;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
@media(min-width: 900px) {
  .ed-quick-keys { display: none; }
}


/* ── Project Card Metadata Table ── */
.proj-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.proj-meta-tbl {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--line2);
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0 10px;
  background: var(--panel2);
  font-size: 12px;
}
.proj-meta-tbl tr {
  border-bottom: 1px solid var(--line);
}
.proj-meta-tbl tr:last-child {
  border-bottom: 0;
}
.proj-meta-tbl tr:hover {
  background: rgba(99, 102, 241, 0.04);
}
.proj-meta-tbl td {
  padding: 8px 12px;
  vertical-align: middle;
  border-bottom: 1px solid var(--line);
}
.proj-meta-tbl tr:last-child td {
  border-bottom: 0;
}
.proj-meta-tbl td.k {
  width: 160px;
  color: var(--mut);
  font-weight: 700;
  background: rgba(0, 0, 0, 0.14);
  border-inline-end: 1px solid var(--line);
  white-space: nowrap;
}
.proj-meta-tbl td.v {
  color: var(--txt);
  overflow-wrap: anywhere;
}
.proj-commit-pill {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  background: rgba(99, 102, 241, 0.15);
  color: var(--acc2);
  border: 1px solid rgba(99, 102, 241, 0.3);
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.proj-path-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  direction: ltr;
  flex-wrap: wrap;
}
@media(max-width: 768px) {
  .proj-meta-tbl,
  .proj-meta-tbl tbody,
  .proj-meta-tbl tr,
  .proj-meta-tbl td {
    display: block !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }
  .proj-meta-tbl {
    margin: 6px 0 10px !important;
    border-radius: 8px !important;
  }
  .proj-meta-tbl tr {
    padding: 8px 10px !important;
    border-bottom: 1px solid var(--line) !important;
  }
  .proj-meta-tbl tr:last-child {
    border-bottom: 0 !important;
  }
  .proj-meta-tbl td.k {
    width: 100% !important;
    background: transparent !important;
    border: 0 !important;
    border-bottom: 0 !important;
    padding: 0 0 3px 0 !important;
    font-size: 11px !important;
    color: var(--mut) !important;
    font-weight: 700 !important;
  }
  .proj-meta-tbl td.v {
    width: 100% !important;
    padding: 0 !important;
    border: 0 !important;
    font-size: 12px !important;
  }
  .proj-meta-tbl td.v .ltr {
    word-break: break-all !important;
  }
  .proj-path-wrap {
    word-break: break-all !important;
  }
}

</style>
<?php return ob_get_clean();}
function render_login(bool $setup){ob_start();?>
<div id="login"><div class="login-card"><div class="login-brand"><span class="brand-mark">W</span></div><h1>وب‌کنسول Pro</h1><p class="hint"><?= $setup?'برای شروع و امنیت سرور، یک رمز عبور قدرتمند تعیین کنید:':'برای دسترسی به پنل مدیریت سرور، رمز عبور را وارد کنید:' ?></p><form id="lgform"><div class="form-group"><label class="lb" for="lgpass">رمز عبور <?= $setup?'جدید':'' ?></label><div class="input-wrap"><input class="inp ltr" id="lgpass" type="password" required minlength="8" placeholder="••••••••••••" autocomplete="<?= $setup?'new-password':'current-password' ?>"><button type="button" class="pwd-toggle" id="toggle-pwd" title="نمایش/پنهان‌سازی رمز">👁</button></div></div><?php if($setup){?><div class="form-group"><label class="lb" for="lgpass2">تکرار رمز عبور</label><div class="input-wrap"><input class="inp ltr" id="lgpass2" type="password" required minlength="8" placeholder="••••••••••••" autocomplete="new-password"></div></div><?php }?><button class="btn pri lgsubmit-btn" id="lgbtn" type="submit"><?= $setup?'✓ راه‌اندازی و ورود':'ورود به پنل سرور ➔' ?></button></form><div class="login-footer hint"><span>🔒 این کنسول دسترسی مستقیم به شل سرور دارد. همیشه از اتصال ایمن HTTPS استفاده فرمایید.</span></div></div></div>
<script>
const pwdToggle=document.getElementById('toggle-pwd');
if(pwdToggle){pwdToggle.onclick=()=>{const p=document.getElementById('lgpass');p.type=p.type==='password'?'text':'password';pwdToggle.textContent=p.type==='password'?'👁':'🙈';};}
document.getElementById('lgform').onsubmit=async e=>{e.preventDefault();const p=document.getElementById('lgpass').value,p2=document.getElementById('lgpass2');if(p2&&p!==p2.value){alert('رمزها یکسان نیستند');return}const b=document.getElementById('lgbtn');b.disabled=true;b.textContent='در حال ورود...';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:__BOOT.setup?'auth.setup':'auth.login',password:p})});const j=await r.json();if(!j.ok)throw Error(j.error||'رمز عبور نامعتبر است');window.location.replace(window.location.pathname);}catch(e){alert(e.message||'خطا در برقراری ارتباط');b.disabled=false;b.textContent=__BOOT.setup?'✓ راه‌اندازی و ورود':'ورود به پنل سرور ➔';}};
</script>
<?php return ob_get_clean();}
function render_body(){ob_start();?>
<div id="app"><header id="topbar"><div class="top-brand"><span class="brand-mark">W</span><b class="brand-text">وب‌کنسول <span class="brand-sub">Pro</span></b></div><small id="hosttag" class="hosttag-pill"></small><span class="spacer"></span><div class="top-actions"><button class="btn sm chrome-btn" id="palettebtn" title="جستجو (Ctrl+K)"><span class="btn-ic">⌕</span> <span class="btn-lbl">جستجو</span></button><button class="btn sm chrome-btn" id="appearancebtn" title="تنظیم پوسته"><span class="btn-ic">◈</span> <span class="btn-lbl">پوسته‌ها</span></button><button class="btn sm" id="themebtn" aria-label="تغییر روشنایی" title="تغییر تم تاریک/روشن">☀</button><button class="btn sm danger" id="logoutbtn" title="خروج"><span class="btn-lbl">خروج</span> <span class="btn-ic">⎋</span></button></div></header><div id="workspacebar"><span id="viewtitle">داشبورد</span><span class="hint">/ فضای مدیریت سرور</span><span class="tag" id="workspace-version"></span></div><div id="main"><aside id="sidebar"></aside><main id="content"><section class="view on" id="v-dash"><div class="card"><div class="row" style="gap:8px;align-items:center;padding:12px"><span class="spin">⏳</span> <b>در حال بارگذاری اطلاعات داشبورد سرور...</b></div></div></section><section class="view" id="v-term"><div id="termwrap"><div class="row"><button class="btn pri sm" id="newterm">+ شل جدید</button><select class="mini" id="termsel"></select><span class="tag ok" id="term-user-badge" style="font-weight:700;display:inline-flex;align-items:center;gap:4px">👑 Root</span><span id="termstat" class="termstatus"></span><button class="btn sm pri" id="selterm" title="مشاهده و انتخاب متنی کل خروجی ترمینال در موبایل و دسکتاپ">📑 انتخاب متن</button><button class="btn sm" id="copyterm" title="کپی متن انتخاب‌شده یا کل خروجی">📋 کپی</button><button class="btn sm" id="pasteterm" title="چسباندن متن (Paste)">📥 پیست</button><button class="btn sm" id="clrterm" title="پاک‌سازی صفحه (Clear)">🧹 Clear</button><button class="btn sm" id="kbterm">⌨</button><button class="btn danger sm" id="killterm">توقف</button></div><div id="keybar"></div><div id="termbox"></div><div class="mob-dock" id="mob-input-dock"><input class="inp ltr" id="mob-cmd-inp" placeholder="دستور را بنویسید… (Enter برای اجرا)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><button class="btn pri sm" id="mob-send-btn" type="button" title="اجرای دستور">➤</button><button class="btn sm" id="mob-tab-btn" type="button" title="تکمیل خودکار">⇥</button><button class="btn sm" id="mob-ctrlc-btn" type="button" title="توقف Ctrl+C">^C</button><button class="btn sm" id="mob-up-btn" type="button" title="دستور قبلی">↑</button><button class="btn sm" id="mob-down-btn" type="button" title="دستور بعدی">↓</button></div></div></section><section class="view" id="v-files"><div class="row"><button class="btn sm" id="upbtn">⬆ بالا</button><button class="btn sm" id="refbtn">🔄</button><button class="btn sm pri" id="newfbtn">+ جدید</button><button class="btn sm" id="uploadbtn">بارگذاری</button><button class="btn sm" id="searchbtn">جستجو</button><button class="btn sm" id="hiddenbtn">فایل مخفی</button><select id="sortsel" class="mini"><option value="name-1">نام ↑</option><option value="name-0">نام ↓</option><option value="size-0">حجم ↓</option><option value="date-0">تاریخ ↓</option><option value="date-1">تاریخ ↑</option></select></div><div id="crumb"></div><div class="quick" id="quick"></div><div class="view-tools"><input class="inp" id="file-filter" aria-label="فیلتر فایل‌های این پوشه" placeholder="فیلتر سریع فایل‌های نمایش‌داده‌شده…"></div><div id="fmlist" class="card"></div><div id="selbar"><span id="selcnt"></span><button class="btn sm" data-op="copy">کپی</button><button class="btn sm" data-op="move">انتقال</button><button class="btn sm" data-op="zip">ZIP</button><button class="btn sm" data-op="download">دانلود</button><button class="btn sm danger" data-op="delete">حذف</button><button class="btn sm" id="selclear">لغو</button></div><input id="fileinput" type="file" multiple class="hide"></section><section class="view" id="v-proc"></section><section class="view" id="v-backup"></section><section class="view" id="v-proj"></section><section class="view" id="v-jobs"></section><section class="view" id="v-set"></section></main></div><nav id="navbottom"></nav></div><div id="modals"><div class="mback"></div><div class="msheet" role="dialog" aria-modal="true" aria-label="پنجره کنسول" tabindex="-1"></div></div><div id="toasts"></div>
<script>
'use strict';
function loadCssAsync(href){try{const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);}catch(e){}}
function loadScriptAsync(src){return new Promise(resolve=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>resolve(true);s.onerror=()=>resolve(false);document.head.appendChild(s);});}
async function loadAsyncAddons(){
  loadCssAsync('https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/Vazirmatn-font-face.css');
  loadCssAsync('https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css');
  loadCssAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.css');
  loadCssAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/theme/material-darker.css');
  loadCssAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/theme/dracula.css');
  loadCssAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/theme/eclipse.css');
  
  const xOk = await loadScriptAsync('https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js');
  if(xOk) await loadScriptAsync('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js');
  if(curTab==='term'&&typeof Terminal!=='undefined'&&!term){mountXterm();}
  
  const cmOk = await loadScriptAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.js');
  if(cmOk){
    ['javascript','xml','css','htmlmixed','clike','php','python','shell','markdown','yaml','sql','nginx','dockerfile','properties','diff'].forEach(m=>loadScriptAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/'+m+'/'+m+'.js'));
    ['dialog','searchcursor','search','jump-to-line','matchbrackets','closebrackets','comment','active-line'].forEach(a=>loadScriptAsync('https://cdn.jsdelivr.net/npm/codemirror@5.65.16/addon/'+a+'/'+a+'.js'));
  }
}
setTimeout(loadAsyncAddons, 60);

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],CSRF=__BOOT.csrf;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtSize(n){if(!n)return '0 B';const u=['B','KB','MB','GB','TB'],i=Math.min(4,Math.max(0,Math.floor(Math.log(Math.abs(n))/Math.log(1024))));return (n/1024**i).toFixed(i?1:0)+' '+u[i]}
function fmtDate(v){if(!v)return '—';return new Date(typeof v==='number'?v*1000:v).toLocaleString('fa-IR')}
function fmtDur(s){return Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m '+Math.floor(s%60)+'s'}
async function api(action,data={}){const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF':CSRF},body:JSON.stringify({api:action,...data})});if(r.status===401){location.reload();throw Error('نشست منقضی شده')}const j=await r.json().catch(()=>({ok:false,error:'پاسخ نامعتبر سرور'}));if(!j.ok)throw Error(j.error||'خطای نامشخص');return j.data}
function toast(msg,type=''){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;$('#toasts').append(t);setTimeout(()=>t.remove(),6000)}
async function copyText(text,msg='متن با موفقیت کپی شد'){if(!text){toast('محتوایی برای کپی وجود ندارد','warn');return false;}try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);toast(msg,'ok');return true;}}catch(e){}try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.top='-9999px';ta.style.left='-9999px';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();const ok=document.execCommand('copy');document.body.removeChild(ta);if(ok){toast(msg,'ok');return true;}}catch(err){}toast('امکان کپی خودکار فراهم نشد','err');return false;}
let __sheet=null;
function openSheet(html,{onclose=null,onbeforeclose=null,className=''}={}){if(__sheet&&__sheet.onbeforeclose&&!__sheet.onbeforeclose())return null;__closeSheet(true);$('#modals').classList.add('on');const sh=$('#modals .msheet');sh.className='msheet'+(className?' '+className:'');sh.innerHTML=html;const returnFocus=document.activeElement;__sheet={onclose,onbeforeclose,returnFocus,className};sh.focus();sh.onkeydown=e=>{if(e.key==='Escape'&&__sheet?.onbeforeclose&&!__sheet.onbeforeclose()){e.stopPropagation();return;}if(e.key!=='Tab')return;const list=[...sh.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(el=>!el.disabled&&el.getAttribute('tabindex')!=='-1'&&el.getClientRects().length);if(!list.length){e.preventDefault();return;}const first=list[0],last=list[list.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===sh)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};$('#modals .mback').onclick=()=>{if(__sheet?.onbeforeclose&&!__sheet.onbeforeclose())return;__closeSheet();};return sh;}
function __closeSheet(force=false){if(!__sheet)return;if(!force&&__sheet.onbeforeclose&&!__sheet.onbeforeclose())return;const cb=__sheet.onclose,returnFocus=__sheet.returnFocus;__sheet=null;$('#modals').classList.remove('on');const sh=$('#modals .msheet');sh.className='msheet';sh.replaceChildren();if(cb)cb();if(returnFocus?.isConnected)returnFocus.focus();}
function sheetHead(t){return `<div class="mhead">${t}<button class="btn sm x" onclick="__closeSheet()">✕</button></div>`}
async function confirmDlg(msg){return window.confirm(msg)}
async function promptDlg(title,val=''){return window.prompt(title,val)}
function actions(root,attr,fn){root.querySelectorAll('['+attr+']').forEach(b=>b.onclick=()=>Promise.resolve(fn(b.getAttribute(attr),b)).catch(e=>toast(e.message,'err')))}
function decode(b64){return new TextDecoder().decode(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)))}
async function openJob(id,title){
 let offset=0,alive=true,timer=null,buffer='',follow=true,paused=false,busy=false;
 const sh=openSheet(sheetHead('📜 '+esc(title)+` <span class="tag acc" id="jstat">…</span>`)+`<div class="row" id="log-tools"><input class="inp" id="jfilter" aria-label="فیلتر خطوط لاگ" placeholder="فیلتر خطوط لاگ…"><label class="hint"><input type="checkbox" id="jfollow" checked> دنبال‌کردن</label><button class="btn sm pri" id="jcopy" title="کپی لاگ فعلی یا فیلترشده">📋 کپی لاگ</button><button class="btn sm" id="jpause">مکث دریافت</button><button class="btn sm" id="jdownload">دانلود متن</button></div><div class="logbox" id="jlog"></div><p class="hint">نمایش حداکثر ۲ میلیون نویسه آخر دریافت‌شده؛ فیلتر فقط نمایشی است. متن لاگ ممکن است حاوی اطلاعات حساس باشد.</p><div class="row"><button class="btn sm pri" id="jcopy2" title="کپی کامل متن خام لاگ">📋 کپی کل لاگ</button><button class="btn danger sm" id="jstop">توقف کار</button><button class="btn sm" id="jclr">پاک کردن صفحه</button></div>`,{onclose:()=>{alive=false;clearInterval(timer)}});
 const log=sh.querySelector('#jlog'),st=sh.querySelector('#jstat');
 const paint=()=>{const q=sh.querySelector('#jfilter').value.toLowerCase();log.textContent=q?buffer.split('\n').filter(line=>line.toLowerCase().includes(q)).join('\n'):buffer;if(follow)log.scrollTop=log.scrollHeight};
 sh.querySelector('#jfilter').oninput=paint;sh.querySelector('#jfollow').onchange=e=>{follow=e.target.checked;if(follow)paint()};
 sh.querySelector('#jcopy').onclick=()=>{const q=sh.querySelector('#jfilter').value.toLowerCase();const t=q?buffer.split('\n').filter(l=>l.toLowerCase().includes(q)).join('\n'):buffer;copyText(t,'لاگ با موفقیت کپی شد');};
 sh.querySelector('#jcopy2').onclick=()=>copyText(buffer,'کل لاگ با موفقیت کپی شد');
 sh.querySelector('#jpause').onclick=e=>{paused=!paused;e.target.textContent=paused?'ادامه دریافت':'مکث دریافت'};
 sh.querySelector('#jdownload').onclick=()=>downloadText('job-'+id+'.log',buffer);
 sh.querySelector('#jclr').onclick=()=>{buffer='';paint()};sh.querySelector('#jstop').onclick=async()=>{if(!await confirmDlg('کار متوقف شود؟'))return;try{await api('jobs.stop',{id})}catch(e){toast(e.message,'err')}};
 const poll=async()=>{if(busy||!alive||paused)return;busy=true;try{const d=await api('jobs.log',{id,offset});if(!alive)return;if(d.offset<offset)buffer='';offset=d.offset;if(d.b64)buffer=(buffer+decode(d.b64)).slice(-2000000);paint();const s=d.status||{},map={running:'در حال اجرا',done:'کامل شد',failed:'ناموفق',dead:'قطع شده'};st.textContent=(map[s.status]||s.status)+(s.exit!=null?' · '+s.exit:'');st.className='tag '+(s.status==='done'?'ok':s.status==='running'?'acc':'err');if(s.status==='running'||d.has_more){sh.querySelector('#jstop').classList.toggle('hide',s.status!=='running')}else{alive=false;sh.querySelector('#jstop').classList.add('hide');clearInterval(timer);sh.querySelector('#jpause').disabled=true;}}catch(e){st.textContent=e.message;st.className='tag err'}finally{busy=false}};
 await poll();if(alive)timer=setInterval(poll,1000);
}
const TABS=[['dash','داشبورد','🏠'],['term','ترمینال','⌨'],['files','فایل‌ها','📁'],['proc','پردازش‌ها','⚙'],['backup','بکاپ','☁'],['proj','پروژه‌ها','📦'],['jobs','کارها','📜'],['set','تنظیمات','🔧']];let curTab='';const INITS={};
function navIcon(id){const paths={dash:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',term:'M4 5l6 6-6 6 M13 18h7',files:'M3 7V5h6l2 3h10v12H3z',proc:'M2 12h5l3-8 4 16 3-8h5',backup:'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5 5 0 0 1 0 11 M12 20V10 M8 14l4-4 4 4',proj:'M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 4 9-4 M12 11v11',jobs:'M8 3h8v4H8z M8 5H5v16h14V5h-3 M8 12h8 M8 16h5',set:'M3 6h18 M3 12h18 M3 18h18 M8 3v6 M16 9v6 M10 15v6'};return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[id]+'"/></svg>'}
function buildNav(){for(const sel of ['#sidebar','#navbottom']){$(sel).innerHTML=TABS.map(([id,t,i])=>`<button data-tab="${id}" title="${t}" aria-label="${t}"><span class="nav-icon">${navIcon(id)}</span><span class="nav-caption">${t}</span></button>`).join('');actions($(sel),'data-tab',switchTab)}}
function switchTab(id){if(!TABS.some(t=>t[0]===id))return;curTab=id;$('#viewtitle').textContent=TABS.find(t=>t[0]===id)[1];$$('.view').forEach(v=>v.classList.toggle('on',v.id==='v-'+id));$$('[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));if(INITS[id]&&!INITS[id].done){INITS[id].done=true;INITS[id].fn()}if(id==='term')setTimeout(fitTerm,80)}
async function renderDash(){
  try{
    const s=await api('sysinfo'),
      m=s.mem.total?Math.round(s.mem.used/s.mem.total*100):0,
      d=s.disk.total?Math.round((s.disk.total-s.disk.free)/s.disk.total*100):0,
      cpuVal=s.cpu_pct!=null?s.cpu_pct:'—',
      cpuNum=typeof s.cpu_pct==='number'?s.cpu_pct:0;
    $('#v-dash').innerHTML=`
      <div class="card dash-hero-card">
        <div class="dash-hero-header">
          <div class="dash-server-title">
            <span class="server-status-dot"></span>
            <div>
              <h3>سرور: ${esc(s.host)}</h3>
              <div class="dash-meta-tags">
                <span class="tag acc">IP: ${esc(s.ip)}</span>
                <span class="tag">کاربر: ${esc(s.user)}</span>
                <span class="tag">PHP ${esc(s.php)}</span>
                <span class="tag">مود ترمینال: ${esc(s.term_mode)}</span>
              </div>
            </div>
          </div>
          <button class="btn sm pri" onclick="switchTab('term')" title="باز کردن شل ترمینال">⚡ باز کردن ترمینال</button>
        </div>
        <p class="hint ltr sys-kernel-line">${esc(s.kernel)} · ${esc(s.web)}</p>
        <div class="grid4">
          <div class="stat stat-cpu">
            <div class="stat-top"><span>پردازنده (CPU)</span><span class="badge-mini">${s.cores} هسته</span></div>
            <div class="v">${cpuVal}%</div>
            <div class="bar"><i style="width:${Math.min(100, Math.max(0, cpuNum))}%"></i></div>
            <small class="ltr">Load: ${s.load.join(' / ')}</small>
          </div>
          <div class="stat stat-ram">
            <div class="stat-top"><span>حافظه موقت (RAM)</span><span class="badge-mini">${m}%</span></div>
            <div class="v">${fmtSize(s.mem.used)}</div>
            <div class="bar"><i style="width:${m}%" class="${m>85?'err':''}"></i></div>
            <small>از کل ${fmtSize(s.mem.total)}</small>
          </div>
          <div class="stat stat-disk">
            <div class="stat-top"><span>فضای دیسک (Disk)</span><span class="badge-mini">${d}%</span></div>
            <div class="v">${fmtSize(s.disk.free)} <span class="v-sub">آزاد</span></div>
            <div class="bar"><i style="width:${d}%" class="${d>90?'err':''}"></i></div>
            <small>از کل ${fmtSize(s.disk.total)}</small>
          </div>
          <div class="stat stat-uptime">
            <div class="stat-top"><span>مدت روشن بودن</span><span class="badge-mini ok">Online</span></div>
            <div class="v ltr font-uptime">${fmtDur(s.uptime)}</div>
            <div class="bar"><i style="width:100%" class="ok"></i></div>
            <small>وضعیت پایدار سرور</small>
          </div>
        </div>
      </div>

      <div class="card" style="border-right: 3px solid var(--acc2)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0">🛡️ متعادل‌سازی بار و محافظت از پایداری سرور</h3>
            <p class="hint" style="margin:4px 0">جلوگیری از قفل سرور هنگام اشباع ۱۰۰٪ پردازنده و بازیابی خودکار سرویس‌ها</p>
          </div>
          <div class="row">
            <button class="btn sm ok" id="dash-rescue-btn" title="آزادسازی رم، تخلیه کش و پاک‌سازی پردازش‌های قفل‌شده">🧹 آزادسازی فوری رم و رفع قفل</button>
            ${s.swap?.total===0?`<button class="btn sm pri" id="dash-swap-btn" title="ایجاد ۲ گیگابایت Swap جهت جلوگیری از هنگ هسته سرور">🚀 ایجاد ۲GB Swap</button>`:''}
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <span class="tag ${s.swap?.total>0?'ok':'warn'}">حافظه مجازی (Swap): ${s.swap?.total>0?fmtSize(s.swap.used)+' / '+fmtSize(s.swap.total):'غیرفعال (خطر فریز هسته)'}</span>
          <span class="tag ok">اولویت‌بندی پردازشی: فعال (nice -n 10)</span>
          <span class="tag acc">دیده‌بان پایداری: فعال</span>
        </div>
      </div>

      <div class="card">
        <h3>ابزارهای آماده سرور</h3>
        <div class="tools-grid">${Object.entries(s.tools).map(([k,v])=>`
          <div class="tool-pill ${v?'installed':'missing'}">
            <span class="tool-ic">${v?'✓':'✗'}</span>
            <span class="tool-nm">${esc(k)}</span>
          </div>`).join('')}
        </div>
      </div>

      <div class="grid2">
        <div class="card dash-quick-nav">
          <h3>دسترسی سریع</h3>
          <div class="quick-nav-actions">
            <button class="btn sm" onclick="switchTab('files')">📁 مرورگر فایل‌ها</button>
            <button class="btn sm" onclick="switchTab('proc')">⚙ مدیریت پردازش‌ها</button>
            <button class="btn sm" onclick="switchTab('proj')">📦 پروژه‌ها و دیمن‌ها</button>
            <button class="btn sm" onclick="switchTab('backup')">☁ بکاپ و گیت‌هاب</button>
          </div>
        </div>
        <div class="card dash-daemon-info">
          <h3>وضعیت سیستم پس‌زمینه</h3>
          <p class="hint">سیستم پس‌زمینه با PHP CLI Daemon فعال است. برای پایداری خودکار پس از راه‌اندازی مجدد VPS، می‌توانید سرویس systemd ثبت کنید.</p>
          <div class="row"><span class="tag ok">نسخه ${esc(__BOOT.v)}</span><span class="tag acc">پوسته: ${esc(__BOOT.theme||'dark')}</span></div>
        </div>
      </div>
    `;
      const rBtn=$('#dash-rescue-btn');
    if(rBtn)rBtn.onclick=async()=>{
      rBtn.disabled=true;rBtn.textContent='در حال پاک‌سازی...';
      try{
        const d=await api('sys.emergency_rescue');
        toast(d.actions.join(' · ')||'آزادسازی حافظه انجام شد','ok');
        renderDash();
      }catch(e){toast(e.message,'err')}
      finally{rBtn.disabled=false;rBtn.textContent='🧹 آزادسازی فوری رم و رفع قفل';}
    };
    const sBtn=$('#dash-swap-btn');
    if(sBtn)sBtn.onclick=async()=>{
      if(!await confirmDlg('۲ گیگابایت حافظه مجازی Swap برای سرور ایجاد شود؟ (مانع از فریز شدن سرور در بار ۱۰۰٪ می‌شود)'))return;
      sBtn.disabled=true;sBtn.textContent='در حال ساخت Swap...';
      try{
        const d=await api('sys.create_swap',{size_mb:2048});
        toast(d.ok?'فایل Swap با موفقیت ایجاد و فعال شد':'ایجاد Swap نیازمند دسترسی sudo است','ok');
        renderDash();
      }catch(e){toast(e.message,'err')}
      finally{sBtn.disabled=false;sBtn.textContent='🚀 ایجاد ۲GB Swap';}
    };
  }catch(e){toast(e.message,'err')}
}

async function openExportDlg() {
  try {
    toast('در حال آماده‌سازی فایل پشتیبان تنظیمات...', 'acc');
    const d = await api('settings.export');
    const exportJson = d.json_string || JSON.stringify(d.export_data, null, 2);
    const projCount = d.export_data?.projects?.length || 0;
    const bkCount = d.export_data?.backup_profiles?.length || 0;
    const filename = `webconsole-settings-backup-${new Date().toISOString().slice(0,10)}.json`;

    const sh = openSheet(sheetHead('برون‌بری تنظیمات کلی وب‌کنسول (Export)') + `
      <p class="appearance-note">این فایل شامل تمام تنظیمات عمومی، پروکسی کلودفلر، ${projCount} پروژه و ${bkCount} پروفایل بکاپ سرور است. (رمز عبور جهت امنیت در این فایل ذخیره نمی‌شود).</p>
      <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn pri" id="st-dl-export-btn">📥 دانلود فایل JSON (${esc(filename)})</button>
        <button class="btn sm" id="st-copy-export-btn">📋 کپی متن JSON</button>
      </div>
      <label class="lb">پیش‌نمایش محتوای فایل پشتیبان JSON</label>
      <textarea class="inp ltr" id="st-export-textarea" rows="14" readonly spellcheck="false" style="font-family:monospace;font-size:12px">${esc(exportJson)}</textarea>
    `);

    sh.querySelector('#st-dl-export-btn').onclick = () => {
      downloadText(filename, exportJson, 'application/json');
      toast('فایل تنظیمات با موفقیت دانلود شد', 'ok');
    };
    sh.querySelector('#st-copy-export-btn').onclick = () => {
      copyText(exportJson, 'تنظیمات JSON با موفقیت در کلیپ‌بورد کپی شد');
    };
  } catch(e) {
    toast(e.message, 'err');
  }
}

async function openImportDlg() {
  const sh = openSheet(sheetHead('درون‌ریزی تنظیمات کلی وب‌کنسول (Import)') + `
    <p class="appearance-note">می‌توانید فایل JSON برون‌بری‌شده از وب‌کنسول دیگر را بارگذاری کنید یا متن آن را مستقیماً در کادر زیر قرار دهید.</p>
    
    <div style="background:var(--panel2);padding:12px;border-radius:8px;border:1px dashed var(--line);margin-bottom:12px">
      <label class="lb" style="margin-top:0">📁 بارگذاری فایل JSON از حافظه دستگاه:</label>
      <input type="file" id="st-import-file-input" accept=".json,application/json" class="inp" style="padding:6px">
    </div>

    <label class="lb">یا متن JSON تنظیمات را در اینجا جای‌گذاری (Paste) کنید:</label>
    <textarea class="inp ltr" id="st-import-textarea" rows="10" placeholder='{"magic":"webconsole_settings_export", ...}' spellcheck="false" style="font-family:monospace;font-size:12px"></textarea>
    
    <div id="st-import-preview-box" style="margin-top:8px;margin-bottom:8px;display:none"></div>

    <div style="background:var(--panel2);padding:12px;border-radius:8px;margin-top:12px;margin-bottom:14px">
      <label class="lb" style="margin-top:0;font-weight:700">بخش‌های مورد نظر برای درون‌ریزی:</label>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="hint" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="imp-cfg" checked> 🎨 تنظیمات عمومی، پوسته، مدت نشست و پروکسی کلودفلر</label>
        <label class="hint" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="imp-proj" checked> 📦 لیست پروژه‌ها و مشخصات مخازن گیت</label>
        <div id="imp-proj-merge-box" style="margin-right:24px;display:flex;gap:12px;font-size:12px" class="hint">
          <label style="cursor:pointer"><input type="radio" name="imp_proj_mode" value="merge" checked> ادغام با پروژه‌های فعلی</label>
          <label style="cursor:pointer"><input type="radio" name="imp_proj_mode" value="overwrite"> جایگزینی کامل لیست پروژه‌ها</label>
        </div>
        <label class="hint" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="imp-bk" checked> ☁️ پروفایل‌های پشتیبان‌گیری (Backup Profiles)</label>
      </div>
    </div>

    <div class="row" style="gap:8px">
      <button class="btn pri" id="st-apply-import-btn">🚀 اعمال و درون‌ریزی تنظیمات</button>
      <button class="btn" onclick="__closeSheet()">انصراف</button>
    </div>
  `);

  const fileInput = sh.querySelector('#st-import-file-input');
  const txtArea = sh.querySelector('#st-import-textarea');
  const prevBox = sh.querySelector('#st-import-preview-box');

  function updatePreview() {
    const raw = txtArea.value.trim();
    if (!raw) {
      prevBox.style.display = 'none';
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const projCount = parsed.projects ? parsed.projects.length : 0;
      const bkCount = parsed.backup_profiles ? parsed.backup_profiles.length : 0;
      const hasCfg = !!parsed.config;
      prevBox.style.display = 'block';
      prevBox.innerHTML = `<div class="tag ok" style="display:block;padding:8px 12px;font-size:12px">✓ ساختار فایل معتبر است: ${hasCfg?'شامل تنظیمات عمومی، ':''}${projCount} پروژه و ${bkCount} پروفایل بکاپ آماده درون‌ریزی.</div>`;
    } catch(e) {
      prevBox.style.display = 'block';
      prevBox.innerHTML = `<div class="tag danger" style="display:block;padding:8px 12px;font-size:12px">✗ خطا در ساختار JSON: ${esc(e.message)}</div>`;
    }
  }

  txtArea.oninput = updatePreview;

  fileInput.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      txtArea.value = ev.target?.result || '';
      updatePreview();
      toast('فایل JSON با موفقیت بارگذاری شد', 'ok');
    };
    reader.readAsText(file);
  };

  sh.querySelector('#st-apply-import-btn').onclick = async () => {
    const raw = txtArea.value.trim();
    if (!raw) {
      toast('لطفاً یک فایل JSON انتخاب کنید یا متن آن را در کادر قرار دهید', 'err');
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch(e) {
      toast('متن واردشده یک JSON معتبر نیست: ' + e.message, 'err');
      return;
    }

    const impConfig = sh.querySelector('#imp-cfg').checked;
    const impProjects = sh.querySelector('#imp-proj').checked;
    const impBackups = sh.querySelector('#imp-bk').checked;
    const mergeProjects = sh.querySelector('input[name="imp_proj_mode"]:checked')?.value === 'merge';

    if (!impConfig && !impProjects && !impBackups) {
      toast('حداقل یکی از بخش‌ها را برای درون‌ریزی انتخاب کنید', 'warn');
      return;
    }

    if (!await confirmDlg('آیا از درون‌ریزی و اعمال این تنظیمات بر روی وب‌کنسول اطمینان دارید؟')) return;

    try {
      toast('در حال درون‌ریزی و اعمال تنظیمات...', 'acc');
      const res = await api('settings.import', {
        data,
        import_config: impConfig,
        import_projects: impProjects,
        import_backups: impBackups,
        merge_projects: mergeProjects
      });
      __closeSheet();
      toast(res.message || 'تنظیمات با موفقیت درون‌ریزی شدند', 'ok');
      if (impConfig && data.config?.theme) applyTheme(data.config.theme);
      renderSet();
      if (curTab === 'proj') renderProj();
    } catch(e) {
      toast(e.message, 'err');
    }
  };
}

INITS.dash={fn(){renderDash();setInterval(()=>{if(curTab==='dash'&&!document.hidden)renderDash()},6000)}};
let term=null,fitAddon=null,termId=null,termOffset=0,termTimer=null,keyQueue=[],keyTimer=null,ctrlLatch=false,termMounted=false;
INITS.term={fn(){initTermUI()}};
function initTermUI(){
  const keys=[
    ['Esc','\x1b'],['Tab','\t'],['Ctrl','__CTRL__'],
    ['⏫','__SCROLL_TOP__'],['🔼','__SCROLL_UP__'],['🔽','__SCROLL_DOWN__'],['⏬','__SCROLL_BOT__'],
    ['↑','\x1b[A'],['↓','\x1b[B'],['←','\x1b[D'],['→','\x1b[C'],
    ['Home','\x1b[H'],['End','\x1b[F'],['^C','\x03'],['^D','\x04'],['^U','\x15'],['^L','\x0c'],
    ['PgUp','\x1b[5~'],['PgDn','\x1b[6~'],['|','|'],['/','/'],['~','~']
  ];
  $('#keybar').replaceChildren();
  keys.forEach(([l,s])=>{
    const b=document.createElement('button');
    b.className='btn sm';
    b.textContent=l;
    b.title=s.startsWith('__SCROLL_')?'اسکرول سطرها':l;
    b.onclick=()=>{
      if(s==='__CTRL__'){ctrlLatch=!ctrlLatch;b.classList.toggle('pri',ctrlLatch);}
      else if(s==='__SCROLL_TOP__'){if(term)term.scrollToTop();}
      else if(s==='__SCROLL_BOT__'){if(term)term.scrollToBottom();}
      else if(s==='__SCROLL_UP__'){if(term)term.scrollLines(-5);}
      else if(s==='__SCROLL_DOWN__'){if(term)term.scrollLines(5);}
      else sendKeys(s);
    };
    $('#keybar').append(b);
  });

  // Touch gesture scroll listener on mobile
  const termBox=$('#termbox');
  if(termBox&&!termBox.__touchBound){
    termBox.__touchBound=true;
    let tStartY=0,tAccum=0;
    termBox.addEventListener('touchstart',e=>{
      if(e.touches.length===1){tStartY=e.touches[0].clientY;tAccum=0;}
    },{passive:true});
    termBox.addEventListener('touchmove',e=>{
      if(e.touches.length===1&&term){
        const curY=e.touches[0].clientY;
        const diffY=tStartY-curY;
        tStartY=curY;
        tAccum+=diffY;
        const lineH=18;
        if(Math.abs(tAccum)>=lineH){
          const lines=Math.trunc(tAccum/lineH);
          term.scrollLines(lines);
          tAccum-=lines*lineH;
        }
      }
    },{passive:true});
  }

  $('#newterm').onclick=createTerm;
  $('#killterm').onclick=async()=>{if(termId&&await confirmDlg('این شل بسته شود؟')){await api('term.kill',{id:termId});termId=null;await loadSessions();}};
  $('#termsel').onchange=e=>attachTerm(e.target.value);
  $('#selterm').onclick=openTermSelectionModal;
  $('#copyterm').onclick=copyTerm;
  $('#pasteterm').onclick=pasteTerm;$('#clrterm').onclick=()=>{if(term){term.clear();sendKeys('clear\r')}else if($('#fallbacklog')){$('#fallbacklog').textContent='';sendKeys('clear\r')}toast('صفحه ترمینال پاک‌سازی شد','ok',1200)};$('#kbterm').onclick=()=>term?term.focus():$('#fallbackcmd')?.focus();window.addEventListener('resize',fitTerm);
 if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
   const isKbd=window.visualViewport.height<window.innerHeight*0.78;
   document.body.classList.toggle('kbd-active',isKbd);
   if(curTab==='term'){setTimeout(fitTerm,40);if(term)term.scrollToBottom()}
  });
 }
 const mobInp=$('#mob-cmd-inp');
 let cmdHist=[],cmdIdx=-1;
 if(mobInp){
  const sendMob=()=>{const val=mobInp.value;if(val){cmdHist.push(val);cmdIdx=cmdHist.length;sendKeys(val+'\r');mobInp.value=''}else{sendKeys('\r')}if(term)term.scrollToBottom()};
  mobInp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();sendMob()}else if(e.key==='ArrowUp'){e.preventDefault();if(cmdIdx>0){cmdIdx--;mobInp.value=cmdHist[cmdIdx]||''}}else if(e.key==='ArrowDown'){e.preventDefault();if(cmdIdx<cmdHist.length-1){cmdIdx++;mobInp.value=cmdHist[cmdIdx]||''}else{cmdIdx=cmdHist.length;mobInp.value=''}}};
  $('#mob-send-btn').onclick=sendMob;
  $('#mob-tab-btn').onclick=()=>sendKeys('\t');
  $('#mob-ctrlc-btn').onclick=()=>sendKeys('\x03');
  $('#mob-up-btn').onclick=()=>{if(cmdHist.length&&cmdIdx>0){cmdIdx--;mobInp.value=cmdHist[cmdIdx]}else sendKeys('\x1b[A')};
  $('#mob-down-btn').onclick=()=>{if(cmdHist.length&&cmdIdx<cmdHist.length-1){cmdIdx++;mobInp.value=cmdHist[cmdIdx]}else{mobInp.value='';sendKeys('\x1b[B')}};
  mobInp.onfocus=()=>{document.body.classList.add('kbd-active');setTimeout(fitTerm,60)};
  mobInp.onblur=()=>{setTimeout(()=>{if(document.activeElement!==mobInp){document.body.classList.remove('kbd-active');setTimeout(fitTerm,60)}},150)};
 }
 mountXterm();loadSessions()}
function mountXterm(){if(termMounted)return;termMounted=true;if(typeof Terminal!=='undefined'){term=new Terminal({cursorBlink:true,scrollback:10000,fontSize:13,allowTransparency:true,theme:{background:'#05080f',foreground:'#d7e3f8',selectionBackground:'rgba(99,102,241,0.5)',selectionForeground:'#ffffff'}});if(typeof FitAddon!=='undefined'){fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon)}term.open($('#termbox'));term.attachCustomKeyEventHandler(e=>{if((e.ctrlKey||e.metaKey)&&(e.key==='c'||e.key==='C')&&term.hasSelection()){if(e.type==='keydown'){const sel=term.getSelection();if(sel){try{navigator.clipboard.writeText(sel);toast('متن انتخاب‌شده کپی شد','ok',1200)}catch(_){}}}return false}if(e.ctrlKey&&e.shiftKey&&(e.key==='c'||e.key==='C')){if(e.type==='keydown'){const sel=term.getSelection();if(sel){try{navigator.clipboard.writeText(sel);toast('متن انتخاب‌شده کپی شد','ok',1200)}catch(_){}}}return false}return true});term.onSelectionChange(()=>{const sel=term.getSelection();if(sel&&sel.trim()){try{navigator.clipboard.writeText(sel)}catch(_){}}});term.onData(d=>{if(ctrlLatch&&/^[a-z]$/.test(d)){d=String.fromCharCode(d.charCodeAt(0)-96);ctrlLatch=false}sendKeys(d)});term.onResize(({cols,rows})=>{if(termId)api('term.resize',{id:termId,cols,rows}).catch(()=>{})});fitTerm()}else{$('#termbox').innerHTML='<pre class="logbox" id="fallbacklog" style="height:65%;max-height:none;user-select:text;-webkit-user-select:text;cursor:text"></pre><textarea class="inp ltr" id="fallbackcmd" placeholder="دستور کامل؛ Enter برای اجرا"></textarea>';$('#fallbackcmd').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendKeys(e.target.value+'\r');e.target.value=''}}}startPoll()}
async function loadSessions(){try{const d=await api('term.list');$('#termsel').innerHTML=d.sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}${s.alive?'':' (پایان)'}</option>`).join('');const cur=d.sessions.find(s=>s.id===termId);if($('#term-user-badge')){$('#term-user-badge').textContent=cur?.is_root?'👑 Root':('👤 '+(cur?.user||'User'));$('#term-user-badge').className='tag '+(cur?.is_root?'ok':'acc');}const alive=d.sessions.filter(s=>s.alive);if(!alive.length){await createTerm();return}if(!alive.some(s=>s.id===termId))attachTerm(alive[alive.length-1].id);else $('#termsel').value=termId}catch(e){toast(e.message,'err')}}
async function createTerm(){try{const d=await api('term.create',{cols:term?.cols||120,rows:term?.rows||34});attachTerm(d.id);await loadSessions()}catch(e){toast(e.message,'err')}}
function attachTerm(id){termId=id;termOffset=0;if(term)term.reset();else if($('#fallbacklog'))$('#fallbacklog').textContent='';$('#termsel').value=id;fitTerm();pollTermNow()}
let termPollBusy=false;
async function pollTermNow(){if(termPollBusy||!termId||curTab!=='term'||document.hidden)return;termPollBusy=true;const id=termId;try{const d=await api('term.read',{id,offset:termOffset});if(id!==termId)return;termOffset=d.offset;if(d.b64){if(term)term.write(Uint8Array.from(atob(d.b64),c=>c.charCodeAt(0)));else{$('#fallbacklog').textContent+=decode(d.b64);$('#fallbacklog').scrollTop=$('#fallbacklog').scrollHeight}}$('#termstat').textContent=d.alive?(d.info||'متصل'):'پایان‌یافته'}catch(e){$('#termstat').textContent=e.message}finally{termPollBusy=false}}
function startPoll(){clearInterval(termTimer);termTimer=setInterval(pollTermNow,100)}
function toPlainText(str){if(!str)return'';return str.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g,' ').replace(/[\u2018\u2019\u201A\u201B]/g,"'").replace(/[\u201C\u201D\u201E\u201F]/g,'"').replace(/[\u2013\u2014\u2015]/g,'-').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'')}
function utf8ToBase64(str){const bytes=new TextEncoder().encode(str);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);return btoa(binary)}
function sendKeys(s){if(!termId)return;keyQueue.push(s);if(keyTimer)clearTimeout(keyTimer);keyTimer=setTimeout(flushKeys,0)}
async function flushKeys(){if(!keyQueue.length||!termId)return;const raw=keyQueue.join('');keyQueue=[];try{await api('term.write',{id:termId,b64:utf8ToBase64(raw)});pollTermNow()}catch(e){toast(e.message,'err')}}
function fitTerm(){try{fitAddon?.fit()}catch(e){}}
function openTermSelectionModal(){
  let lines=[];
  if(term){
    const b=term.buffer.active;
    for(let i=0;i<b.length;i++){const l=b.getLine(i);if(l!==undefined)lines.push(l.translateToString(true));}
    while(lines.length&&lines[lines.length-1]==='')lines.pop();
  }
  const fullText=lines.join('\n')||$('#fallbacklog')?.textContent||'';
  if(!fullText){toast('خروجی متنی در ترمینال موجود نیست','warn');return;}
  const sh=openSheet(sheetHead('📋 انتخاب و کپی متن ترمینال')+`
    <p class="hint" style="margin-bottom:8px">می‌توانید با لمس و نگه‌داشتن روی کادر زیر، هر بخشی از لاگ ترمینال را با ابزار موبایل انتخاب، هایلایت یا کپی کنید:</p>
    <div class="row" style="margin-bottom:8px;gap:6px;flex-wrap:wrap">
      <button class="btn sm pri" id="ts-copyall">📋 کپی کل خروجی (${lines.length} سطر)</button>
      <button class="btn sm" id="ts-dl">⬇️ دانلود لاگ (TXT)</button>
      <button class="btn sm danger" id="ts-clear">🧹 پاک‌سازی ترمینال</button>
    </div>
    <pre class="logbox" id="ts-text" style="height:60vh;max-height:65dvh;overflow-y:auto;user-select:text;-webkit-user-select:text;cursor:text;white-space:pre-wrap;word-break:break-all;padding:10px;font-size:12.5px">${esc(fullText)}</pre>
  `);
  sh.querySelector('#ts-copyall').onclick=()=>copyText(fullText,'کل خروجی ترمینال با موفقیت کپی شد');
  sh.querySelector('#ts-dl').onclick=()=>downloadText('terminal-log-'+dateStr()+'.txt',fullText);
  sh.querySelector('#ts-clear').onclick=()=>{
    if(term){term.clear();sendKeys('clear\r');}
    else if($('#fallbacklog')){$('#fallbacklog').textContent='';sendKeys('clear\r');}
    __closeSheet();
    toast('ترمینال پاک‌سازی شد','ok');
  };
}
function dateStr(){const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+'_'+d.getHours()+'-'+d.getMinutes();}

async function copyTerm(){let text='';if(term&&term.hasSelection()){text=term.getSelection()}else if(term){const a=term.buffer.active;let lines=[];for(let i=0;i<a.length;i++){const line=a.getLine(i);if(line!==undefined)lines.push(line.translateToString(true))}while(lines.length&&lines[lines.length-1]==='')lines.pop();text=lines.join('\n')}if(!text)text=window.getSelection()?.toString()||$('#fallbacklog')?.textContent||'';if(!text){toast('متنی برای کپی انتخاب یا موجود نیست','warn');return}text=toPlainText(text);try{await navigator.clipboard.writeText(text);toast('متن (Plain Text) با حفظ خطوط کپی شد','ok')}catch(e){window.prompt('متن ترمینال (Plain Text):',text)}}
async function pasteTerm(){let s='';try{s=await navigator.clipboard.readText()}catch(e){s=window.prompt('متن برای چسباندن (Plain Text):','')||''}if(!s)return;s=toPlainText(s);if(term){const lines=s.split('\n');sendKeys(lines.join('\r'))}else{sendKeys(s)}}
const F={path:__BOOT.fs_start||'/',items:[],sort:'name-1',hidden:false,sel:new Set(),quick:['/','/var/www','/root','/home','/etc','/tmp','/opt','/srv']};
function joinPath(a,b){return (a.replace(/\/+$/,'')+'/'+b).replace(/\/+/g,'/')}
function parentDir(p){p=p.replace(/\/+$/,'');return p.slice(0,p.lastIndexOf('/'))||'/'}
function navFm(p){F.path=p||'/';F.sel.clear();renderFm()}
INITS.files={fn(){for(const[id,fn]of Object.entries({upbtn:()=>navFm(parentDir(F.path)),refbtn:renderFm,newfbtn:newItemDlg,uploadbtn:()=>$('#fileinput').click(),searchbtn:searchDlg,hiddenbtn:()=>{F.hidden=!F.hidden;renderFm()},selclear:()=>{F.sel.clear();renderFm()}}))$('#'+id).onclick=fn;$('#sortsel').onchange=e=>{F.sort=e.target.value;renderFm()};$('#fileinput').onchange=e=>{uploadFiles([...e.target.files]);e.target.value=''};actions($('#selbar'),'data-op',selOp);const v=$('#v-files');v.ondragover=e=>e.preventDefault();v.ondrop=e=>{e.preventDefault();uploadFiles([...e.dataTransfer.files])};renderFm()}};
async function renderFm(){try{const[sort,asc]=F.sort.split('-');const d=await api('fs.list',{path:F.path,sort,asc:asc==='1',hidden:F.hidden});F.path=d.path;F.items=d.items;$('#hiddenbtn').classList.toggle('pri',F.hidden);let acc='';$('#crumb').innerHTML='<a href="#" data-p="/">/</a> '+F.path.split('/').filter(Boolean).map(x=>{acc+='/'+x;return `<a href="#" data-p="${esc(acc)}">${esc(x)}</a>`}).join(' / ');actions($('#crumb'),'data-p',navFm);$('#quick').innerHTML=F.quick.map(p=>`<button class="btn sm" data-p="${esc(p)}">${esc(p)}</button>`).join('');actions($('#quick'),'data-p',navFm);$('#fmlist').innerHTML=d.items.length?d.items.map((it,i)=>`<div class="frow ${F.sel.has(it.name)?'sel':''}"><input class="chk" data-select="${i}" type="checkbox" ${F.sel.has(it.name)?'checked':''}><span class="nm" data-open="${i}">${it.dir?'📁':'📄'} ${esc(it.name)}<small class="ltr">${it.perms} · ${esc(it.owner)}:${esc(it.group)} · ${fmtDate(it.mtime)}</small></span><span class="sz">${it.dir?'—':fmtSize(it.size)}</span><button class="btn sm" data-more="${i}">⋯</button></div>`).join(''):'<div class="empty">پوشه خالی است</div>';actions($('#fmlist'),'data-open',i=>{const it=F.items[i];it.dir?navFm(joinPath(F.path,it.name)):openEditor(joinPath(F.path,it.name))});actions($('#fmlist'),'data-more',i=>itemMenu(F.items[i]));$('#fmlist').querySelectorAll('[data-select]').forEach(c=>c.onchange=()=>{const n=F.items[c.dataset.select].name;c.checked?F.sel.add(n):F.sel.delete(n);c.closest('.frow').classList.toggle('sel',c.checked);paintSel()});paintSel();const filter=()=>$('#fmlist').querySelectorAll('.frow').forEach(row=>row.classList.toggle('hide',!row.querySelector('.nm').textContent.toLowerCase().includes($('#file-filter').value.trim().toLowerCase())));$('#file-filter').oninput=filter;filter()}catch(e){toast(e.message,'err')}}
function paintSel(){$('#selbar').classList.toggle('on',F.sel.size>0);$('#selcnt').textContent=F.sel.size+' انتخاب'}
function selPaths(){return [...F.sel].map(n=>joinPath(F.path,n))}
function itemMenu(it){const p=joinPath(F.path,it.name),ops=[['باز کردن',()=>it.dir?navFm(p):openEditor(p)],['دانلود',()=>dlPath(p)],['کپی مسیر',async()=>{try{await navigator.clipboard.writeText(p)}catch(e){window.prompt('مسیر',p)}}],['تغییرنام',async()=>{const n=await promptDlg('نام جدید',it.name);if(n&&n!==it.name){await api('fs.rename',{path:p,name:n});renderFm()}}],['مجوزها',()=>chmodDlg([p],it)],['مالکیت',()=>chownDlg([p])],['ZIP',()=>zipDlg([p])],['مشخصات',async()=>{const d=await api('fs.info',{path:p});const fsJson=JSON.stringify(d,null,2);const sh=openSheet(sheetHead(esc(it.name))+'<div class="row" style="margin-bottom:8px"><button class="btn sm pri" id="fs-copy">📋 کپی مشخصات</button></div><pre class="logbox">'+esc(fsJson)+'</pre>');sh.querySelector('#fs-copy').onclick=()=>copyText(fsJson,'مشخصات فایل کپی شد');}],['حذف',async()=>{if(await confirmDlg('حذف '+it.name+'؟')){await api('fs.delete',{paths:[p]});renderFm()}}]];if(/\.zip$/i.test(it.name))ops.push(['استخراج ZIP',()=>unzipDlg(p)]);const sh=openSheet(sheetHead(esc(it.name))+ops.map(([label],i)=>`<button class="btn" style="margin:4px" data-act="${i}">${label}</button>`).join(''));actions(sh,'data-act',async i=>{__closeSheet();await ops[i][1]()})}
function dlPath(p){const a=document.createElement('a');a.href=location.pathname+'?api=fs.download&path='+encodeURIComponent(p);a.download='';a.click()}
async function selOp(op){const ps=selPaths();if(!ps.length)return;if(op==='delete'){if(await confirmDlg('حذف '+ps.length+' مورد؟')){await api('fs.delete',{paths:ps});F.sel.clear();renderFm()}}else if(op==='download'){if(ps.length===1)dlPath(ps[0]);else{const d=await api('fs.zip',{paths:ps.map(p=>p.split('/').pop()),base:F.path,dest:joinPath(F.path,'selection-'+Date.now()+'.zip')});dlPath(d.path);renderFm()}}else if(op==='zip')await zipDlg(ps);else{const dest=await promptDlg('پوشه مقصد',F.path);if(dest){await api('fs.transfer',{paths:ps,dest,op});F.sel.clear();renderFm()}}}
async function zipDlg(ps){const name=await promptDlg('نام ZIP','archive-'+Date.now()+'.zip');if(name){await api('fs.zip',{paths:ps.map(p=>p.split('/').pop()),base:F.path,dest:joinPath(F.path,name)});renderFm()}}
async function unzipDlg(p){const dest=await promptDlg('پوشه مقصد',p.replace(/\.zip$/i,'')+'-extracted');if(dest){await api('fs.unzip',{zip:p,dest});renderFm()}}
async function chmodDlg(paths,it){const mode=await promptDlg('مجوز (مثلاً 644 یا 755)',it?.perms||'644');if(mode){await api('fs.chmod',{paths,mode,recursive:!!it?.dir&&await confirmDlg('بازگشتی روی زیرپوشه‌ها؟')});renderFm()}}
async function chownDlg(paths){const owner=await promptDlg('کاربر:گروه','');if(owner){await api('fs.chown',{paths,owner,recursive:await confirmDlg('بازگشتی؟')});renderFm()}}
async function newItemDlg(){const sh=openSheet(sheetHead('مورد جدید')+'<input class="inp ltr" id="nname" placeholder="نام"><select class="inp" id="ntype"><option value="file">فایل</option><option value="dir">پوشه</option></select><button class="btn pri" id="nok">ساخت</button>');sh.querySelector('#nok').onclick=async()=>{const name=sh.querySelector('#nname').value.trim(),type=sh.querySelector('#ntype').value;if(!name)return;try{await api('fs.create',{path:joinPath(F.path,name),type});__closeSheet();renderFm();if(type==='file')openEditor(joinPath(F.path,name),true)}catch(e){toast(e.message,'err')}}}
function searchDlg(){const sh=openSheet(sheetHead('جستجو')+'<input class="inp" id="sq" placeholder="عبارت"><label class="lb"><input id="scontent" type="checkbox"> جستجو در محتوا</label><button class="btn pri" id="sok">جستجو</button><div id="sres"></div>');sh.querySelector('#sok').onclick=async()=>{try{const d=await api('fs.search',{path:F.path,q:sh.querySelector('#sq').value,content:sh.querySelector('#scontent').checked});const box=sh.querySelector('#sres');box.innerHTML=d.results.map((r,i)=>`<div class="li"><span class="t ltr">${esc(r.path)}</span><button class="btn sm" data-r="${i}">باز کردن</button></div>`).join('')||'نتیجه‌ای نیست';actions(box,'data-r',i=>{const r=d.results[i];__closeSheet();r.dir?navFm(r.path):openEditor(r.path)})}catch(e){toast(e.message,'err')}}}
async function uploadFiles(files){if(!files.length)return;const sh=openSheet(sheetHead('بارگذاری')+'<div id="upl"></div>'),box=sh.querySelector('#upl');for(const f of files){const row=document.createElement('div');row.className='li ltr';row.textContent=f.name+' …';box.append(row);try{const chunk=1024*1024;let off=0;do{const blob=f.slice(off,off+chunk),b64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob)});await api('fs.upload_chunk',{dest:F.path,name:f.name,offset:off,b64});off+=blob.size;row.textContent=f.name+' '+Math.round(f.size?off/f.size*100:100)+'%'}while(off<f.size)}catch(e){row.textContent=f.name+': '+e.message;row.style.color='var(--err)'}}renderFm()}
function cmMode(n){
  n=String(n||'').toLowerCase();
  if(/\.php$|\.phtml$|\.inc$/i.test(n))return 'application/x-httpd-php';
  if(/\.(html?|vue|svelte|blade\.php)$/i.test(n))return 'htmlmixed';
  if(/\.json$/i.test(n))return {name:'javascript',json:true};
  if(/\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(n))return 'javascript';
  if(/\.(css|scss|less)$/i.test(n))return 'css';
  if(/\.(py|pyw)$/i.test(n))return 'python';
  if(/\.(ya?ml)$/i.test(n))return 'yaml';
  if(/\.(md|markdown)$/i.test(n))return 'markdown';
  if(/\.sql$/i.test(n))return 'sql';
  if(/\.(sh|bash|zsh|env|env\..*|gitignore|service|conf|cfg)$/i.test(n)||n==='dockerfile'||n.startsWith('dockerfile.'))return 'shell';
  if(/nginx|\.conf$/i.test(n))return 'nginx';
  if(/dockerfile/i.test(n))return 'dockerfile';
  if(/\.(ini|properties)$/i.test(n))return 'properties';
  if(/\.(diff|patch)$/i.test(n))return 'diff';
  if(/\.(c|cpp|h|hpp|java|cs|go|rs)$/i.test(n))return 'clike';
  if(/\.(xml|svg)$/i.test(n))return 'xml';
  return 'text/plain';
}

let edDirty=false;
window.addEventListener('beforeunload',e=>{if(edDirty){e.preventDefault();e.returnValue='تغییرات ذخیره‌نشده دارید.';}});

async function openEditor(path,isNew=false){
  try{
    let fileData={path:path,name:path.split('/').pop(),content:'',size:0,mtime:Date.now()/1000,is_writable:true,perms:'0644',line_count:1,is_truncated:false,line_ending:'LF'};
    if(!isNew){
      try{
        const d=await api('fs.read',{path,allow_large:true});
        fileData=Object.assign(fileData,d);
      }catch(err){toast(err.message||'خطا در باز کردن فایل','err');return;}
    }

    let isDirty=false;
    let initialContent=fileData.content;
    let fontSize=parseInt(localStorage.getItem('wc_ed_fontsize')||'13',10);
    let theme=localStorage.getItem('wc_ed_theme')||'material-darker';
    let lineWrap=localStorage.getItem('wc_ed_wrap')==='1';

    const safeCloseCheck=()=>{
      if(isDirty){return window.confirm('شما تغییرات ذخیره‌نشده دارید. آیا مایلید بدون ذخیره خارج شوید؟');}
      return true;
    };

    const initialMode=cmMode(path);

    const html=`
      <div class="ed-head">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;flex:1">
          <span style="font-size:15px;flex-shrink:0">📝</span>
          <span class="ltr" style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(path)}">${esc(fileData.name||path)}</span>
          <span id="ed-dirty-tag" class="tag ${isDirty?'ed-badge-dirty':'ok'}" style="font-size:10.5px;flex-shrink:0">${isDirty?'● تغییر یافته':'ذخیره‌شده'}</span>
          <span class="tag" style="font-size:10.5px;flex-shrink:0">${fmtSize(fileData.size)}</span>
          <span id="ed-lines-tag" class="tag" style="font-size:10.5px;flex-shrink:0">${fileData.line_count} خط</span>
          ${fileData.is_truncated?'<span class="tag warn" style="font-size:10.5px;flex-shrink:0" title="به دلیل حجم بالا پیش‌نمایش ۱ مگابایت نمایش داده شده است">پیش‌نمایش ۱MB</span>':''}
        </div>
        <div class="row" style="gap:4px;flex-shrink:0">
          <button class="btn sm" id="ed-btn-fs" title="حالت تمام‌صفحه (F11)">🔲</button>
          <button class="btn sm x" id="ed-btn-close" title="بستن (Esc)">✕</button>
        </div>
      </div>

      <div class="ed-toolbar">
        <button class="btn sm pri" id="ed-btn-save" title="ذخیره فایل (Ctrl+S)">💾 ذخیره</button>
        <label class="hint" style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;font-size:11px">
          <input type="checkbox" id="ed-chk-bak" checked> بکاپ (.bak)
        </label>
        <span style="border-left:1px solid var(--line2);height:18px;margin:0 2px"></span>
        <button class="btn sm" id="ed-btn-selall" title="انتخاب کل متن (Ctrl+A)">🎯 انتخاب همه</button>
        <button class="btn sm" id="ed-btn-copy" title="کپی متن انتخاب‌شده یا کل متن (Ctrl+C)">📋 کپی</button>
        <button class="btn sm" id="ed-btn-cut" title="برش متن انتخاب‌شده (Ctrl+X)">✂️ برش</button>
        <button class="btn sm" id="ed-btn-paste" title="چسباندن متن از حافظه کلیپ‌بورد (Ctrl+V)">📥 پیست</button>
        <span style="border-left:1px solid var(--line2);height:18px;margin:0 2px"></span>
        <button class="btn sm" id="ed-btn-undo" title="واگرد تغییر قبلی (Ctrl+Z)">↩️ Undo</button>
        <button class="btn sm" id="ed-btn-redo" title="انجام مجدد تغییر (Ctrl+Y)">↪️ Redo</button>
        <button class="btn sm" id="ed-btn-comment" title="کامنت‌گذاری سطرها (Ctrl+/)">💬 کامنت</button>
        <button class="btn sm" id="ed-btn-format" title="مرتب‌سازی و فاصله‌گذاری کد (JSON / Auto Indent)">🧹 مرتب‌سازی</button>
        <button class="btn sm danger" id="ed-btn-clear" title="پاک‌سازی کامل متن فایل">🗑️ پاک‌کردن</button>
        <span style="border-left:1px solid var(--line2);height:18px;margin:0 2px"></span>
        <button class="btn sm" id="ed-btn-find" title="جستجو در متن (Ctrl+F)">🔍 جستجو</button>
        <button class="btn sm" id="ed-btn-replace" title="جایگزینی در متن (Ctrl+H)">🔁 جایگزینی</button>
        <button class="btn sm" id="ed-btn-syntax" title="بررسی خطاهای گرامری (PHP/JSON/Python/Bash)">🛡️ سینتکس</button>
        <span style="border-left:1px solid var(--line2);height:18px;margin:0 2px"></span>
        <button class="btn sm" id="ed-btn-wrap" title="شکستن خطوط طولانی">${lineWrap?'↩️ شکست خط: روشن':'↔️ شکست خط: خاموش'}</button>
        <div class="row" style="gap:2px">
          <button class="btn sm" id="ed-font-dec" title="کوچک‌تر کردن قلم" style="padding:2px 7px">A-</button>
          <span id="ed-font-val" class="hint" style="font-size:11px;min-width:24px;text-align:center">${fontSize}px</span>
          <button class="btn sm" id="ed-font-inc" title="بزرگ‌تر کردن قلم" style="padding:2px 7px">A+</button>
        </div>
        <select class="mini" id="ed-sel-theme" title="قالب رنگی ادیتور">
          <option value="material-darker" ${theme==='material-darker'?'selected':''}>Darker</option>
          <option value="dracula" ${theme==='dracula'?'selected':''}>Dracula</option>
          <option value="eclipse" ${theme==='eclipse'?'selected':''}>Light</option>
        </select>
        <select class="mini" id="ed-sel-mode" title="زبان برنامه‌نویسی">
          <option value="application/x-httpd-php">PHP</option>
          <option value="javascript">JavaScript / TypeScript</option>
          <option value="json">JSON</option>
          <option value="python">Python</option>
          <option value="htmlmixed">HTML / Vue</option>
          <option value="css">CSS</option>
          <option value="shell">Shell / Bash / .env</option>
          <option value="yaml">YAML</option>
          <option value="sql">SQL</option>
          <option value="nginx">Nginx Conf</option>
          <option value="dockerfile">Dockerfile</option>
          <option value="properties">Properties / INI</option>
          <option value="diff">Diff / Patch</option>
          <option value="text/plain">Plain Text</option>
        </select>
        <button class="btn sm" id="ed-btn-reload" title="بارگذاری مجدد فایل از دیسک">🔄 بازخوانی</button>
        <button class="btn sm" id="ed-btn-dl" title="دانلود این فایل">⬇️ دانلود</button>
      </div>

      <div class="ed-quick-keys">
        ${['Tab','{','}','(',')','[',']','$','=',';','"',"'",':','/','\\','<','>','-','_','!','&','|'].map(k=>`<button class="btn sm" data-ins="${esc(k)}">${esc(k==='Tab'?'⇥ Tab':k)}</button>`).join('')}
      </div>

      <div id="ed-syntax-banner" class="ed-banner hide"></div>

      <div class="ed-container">
        <div id="edcm"></div>
        <textarea id="edta" class="inp ltr hide" spellcheck="false"></textarea>
      </div>

      <div class="ed-statusbar">
        <div class="row" style="gap:10px">
          <span id="ed-pos-stat">سطر ۱، ستون ۱</span>
          <span id="ed-sel-stat">انتخاب: ۰</span>
        </div>
        <div class="row" style="gap:8px">
          <span class="tag sm ${fileData.is_writable?'ok':'warn'}">${fileData.is_writable?'✏️ '+fileData.perms:'🔒 فقط خواندنی'}</span>
          <button class="btn mini" id="ed-btn-eol" title="تغییر فرمت انتهای خط">${fileData.line_ending||'LF'}</button>
          <span>UTF-8</span>
          <span class="hint" style="font-size:11px" title="کلیدهای میانبر: Ctrl+S ذخیره | Ctrl+F جستجو | Ctrl+H جایگزینی | Alt+G پرش به خط | F11 تمام‌صفحه">راهنما</span>
        </div>
      </div>
    `;

    const sh=openSheet(html,{
      className:'msheet-editor',
      onbeforeclose:safeCloseCheck,
      onclose:()=>{
        edDirty=false;
        if(window.__edResizeHandler)window.removeEventListener('resize',window.__edResizeHandler);
        if(window.visualViewport&&window.__edVpHandler)window.visualViewport.removeEventListener('resize',window.__edVpHandler);
      }
    });
    if(!sh)return;

    let cm=null;
    const edcmEl=sh.querySelector('#edcm');
    const edtaEl=sh.querySelector('#edta');
    const dirtyTag=sh.querySelector('#ed-dirty-tag');
    const linesTag=sh.querySelector('#ed-lines-tag');
    const posStat=sh.querySelector('#ed-pos-stat');
    const selStat=sh.querySelector('#ed-sel-stat');
    const syntaxBanner=sh.querySelector('#ed-syntax-banner');
    const selMode=sh.querySelector('#ed-sel-mode');
    const selTheme=sh.querySelector('#ed-sel-theme');

    const currentModeName=typeof initialMode==='object'?initialMode.name:initialMode;
    if(currentModeName){
      for(let opt of selMode.options){
        if(opt.value===currentModeName||(opt.value==='json'&&initialMode?.json)){
          selMode.value=opt.value;break;
        }
      }
    }

    const setDirtyState=(dirty)=>{
      isDirty=dirty;
      edDirty=dirty;
      if(dirty){
        dirtyTag.textContent='● تغییر یافته';
        dirtyTag.className='tag ed-badge-dirty';
      }else{
        dirtyTag.textContent='ذخیره‌شده';
        dirtyTag.className='tag ok';
      }
    };

    const updateCursorStatus=(cursor,selText='')=>{
      posStat.textContent=`سطر ${cursor.line+1}، ستون ${cursor.ch+1}`;
      selStat.textContent=selText?`انتخاب: ${selText.length}`:'انتخاب: ۰';
    };

    const updateLinesCount=(val)=>{
      const lines=(val.match(/\n/g)||[]).length+1;
      linesTag.textContent=`${lines} خط`;
    };

    if(typeof CodeMirror!=='undefined'){
      let resolvedMode=initialMode;
      if(selMode.value==='json')resolvedMode={name:'javascript',json:true};

      cm=CodeMirror(edcmEl,{
        value:initialContent,
        mode:resolvedMode,
        theme:theme,
        lineNumbers:true,
        lineWrapping:lineWrap,
        styleActiveLine:true,
        matchBrackets:true,
        autoCloseBrackets:true,
        foldGutter:true,
        gutters:["CodeMirror-linenumbers","CodeMirror-foldgutter"],
        extraKeys:{
          'Ctrl-S':()=>saveFile(),
          'Cmd-S':()=>saveFile(),
          'Ctrl-F':'findPersistent',
          'Cmd-F':'findPersistent',
          'Ctrl-H':'replace',
          'Alt-G':'jumpToLine',
          'Ctrl-/':'toggleComment',
          'Cmd-/':'toggleComment',
          'F11':()=>toggleFullscreen(),
          'Esc':()=>{if(safeCloseCheck())__closeSheet();}
        }
      });

      cm.getWrapperElement().style.fontSize=fontSize+'px';

      cm.on('change',()=>{
        const val=cm.getValue();
        setDirtyState(val!==initialContent);
        updateLinesCount(val);
      });

      cm.on('cursorActivity',()=>{
        const cur=cm.getCursor();
        const sel=cm.getSelection();
        updateCursorStatus(cur,sel);
      });

      const refreshEditor=()=>{if(cm)cm.refresh();};
      window.__edResizeHandler=refreshEditor;
      window.addEventListener('resize',refreshEditor);
      if(window.visualViewport){
        window.__edVpHandler=refreshEditor;
        window.visualViewport.addEventListener('resize',refreshEditor);
      }

      setTimeout(()=>{cm.refresh();cm.focus();},60);
      setTimeout(()=>{cm.refresh();},300);
    }else{
      edcmEl.classList.add('hide');
      edtaEl.classList.remove('hide');
      edtaEl.value=initialContent;
      edtaEl.style.fontSize=fontSize+'px';

      edtaEl.oninput=()=>{
        setDirtyState(edtaEl.value!==initialContent);
        updateLinesCount(edtaEl.value);
      };
      edtaEl.onkeyup=edtaEl.onclick=()=>{
        const start=edtaEl.selectionStart;
        const text=edtaEl.value.substring(0,start);
        const line=(text.match(/\n/g)||[]).length+1;
        const col=start-text.lastIndexOf('\n');
        const sel=edtaEl.value.substring(edtaEl.selectionStart,edtaEl.selectionEnd);
        updateCursorStatus({line:line-1,ch:col-1},sel);
      };
    }

    // Quick Keys for mobile
    sh.querySelectorAll('[data-ins]').forEach(btn=>{
      btn.onclick=e=>{
        e.preventDefault();
        const str=btn.dataset.ins==='Tab'?'  ':btn.dataset.ins;
        if(cm){
          const doc=cm.getDoc();
          const cursor=doc.getCursor();
          doc.replaceRange(str,cursor);
          cm.focus();
        }else{
          const p=edtaEl.selectionStart;
          edtaEl.value=edtaEl.value.slice(0,p)+str+edtaEl.value.slice(edtaEl.selectionEnd);
          edtaEl.selectionStart=edtaEl.selectionEnd=p+str.length;
          edtaEl.focus();
          setDirtyState(true);
        }
      };
    });

    const getContent=()=>cm?cm.getValue():edtaEl.value;

    const setContent=(newVal)=>{
      if(cm){cm.setValue(newVal);}else{edtaEl.value=newVal;}
      initialContent=newVal;
      setDirtyState(false);
      updateLinesCount(newVal);
    };

    const saveFile=async()=>{
      const btn=sh.querySelector('#ed-btn-save');
      const bak=sh.querySelector('#ed-chk-bak').checked;
      const content=getContent();
      btn.disabled=true;
      btn.textContent='در حال ذخیره...';
      try{
        const res=await api('fs.save',{
          path,
          content,
          backup:bak,
          check_syntax:true,
          eol:fileData.line_ending
        });
        initialContent=content;
        setDirtyState(false);
        fileData.size=res.size;
        fileData.mtime=res.mtime;
        toast(res.backed_up?'فایل با پشتیبان (.bak) ذخیره شد':'فایل با موفقیت ذخیره شد','ok');

        if(res.syntax){
          showSyntaxResult(res.syntax);
        }else{
          syntaxBanner.classList.add('hide');
        }
        if(typeof renderFm==='function')renderFm();
      }catch(err){
        toast(err.message||'خطا در ذخیره فایل','err');
      }finally{
        btn.disabled=false;
        btn.textContent='💾 ذخیره';
      }
    };

    const showSyntaxResult=(syn)=>{
      syntaxBanner.classList.remove('hide','ok','err');
      if(syn.ok){
        syntaxBanner.classList.add('ok');
        syntaxBanner.innerHTML=`<span>✅ <b>${esc(syn.type)}:</b> ${esc(syn.msg)}</span><button class="btn mini x" onclick="this.parentElement.classList.add('hide')">✕</button>`;
      }else{
        syntaxBanner.classList.add('err');
        syntaxBanner.innerHTML=`<span>⚠️ <b>خطای سینتکس (${esc(syn.type)}):</b> <pre style="margin:4px 0;font-size:12px;white-space:pre-wrap;direction:ltr;text-align:left">${esc(syn.msg)}</pre></span><button class="btn mini x" onclick="this.parentElement.classList.add('hide')">✕</button>`;
      }
    };

    sh.querySelector('#ed-btn-syntax').onclick=async()=>{
      try{
        const res=await api('fs.syntax_check',{path,content:getContent()});
        showSyntaxResult(res);
      }catch(err){toast(err.message,'err');}
    };

    const toggleFullscreen=()=>{
      const isFs=sh.classList.toggle('msheet-fullscreen');
      sh.querySelector('#ed-btn-fs').textContent=isFs?'🗗':'🔲';
      if(cm)setTimeout(()=>cm.refresh(),100);
    };

    sh.querySelector('#ed-btn-save').onclick=saveFile;
    sh.querySelector('#ed-btn-fs').onclick=toggleFullscreen;
    sh.querySelector('#ed-btn-close').onclick=()=>{if(safeCloseCheck())__closeSheet();};
    sh.querySelector('#ed-btn-find').onclick=()=>{if(cm)cm.execCommand('findPersistent');};
    sh.querySelector('#ed-btn-replace').onclick=()=>{if(cm)cm.execCommand('replace');};

    // Selection & Clipboard Handlers
    sh.querySelector('#ed-btn-selall').onclick=()=>{
      if(cm){cm.execCommand('selectAll');cm.focus();}
      else{edtaEl.select();edtaEl.focus();}
      toast('تمام متن انتخاب شد','ok');
    };

    sh.querySelector('#ed-btn-copy').onclick=async()=>{
      let sel='';
      if(cm){sel=cm.getSelection();}
      else{const s=edtaEl.selectionStart,e=edtaEl.selectionEnd;if(s!==e)sel=edtaEl.value.substring(s,e);}
      if(sel&&sel.length>0){await copyText(sel,'متن انتخاب‌شده کپی شد');}
      else{await copyText(getContent(),'تمام فایل کپی شد');}
    };

    sh.querySelector('#ed-btn-cut').onclick=async()=>{
      let sel='';
      if(cm){
        sel=cm.getSelection();
        if(sel&&sel.length>0){await copyText(sel,'متن برش داده شد');cm.replaceSelection('');cm.focus();}
        else{toast('ابتدا بخشی از متن را انتخاب نمایید','warn');}
      }else{
        const s=edtaEl.selectionStart,e=edtaEl.selectionEnd;
        if(s!==e){
          sel=edtaEl.value.substring(s,e);
          await copyText(sel,'متن برش داده شد');
          edtaEl.value=edtaEl.value.slice(0,s)+edtaEl.value.slice(e);
          edtaEl.selectionStart=edtaEl.selectionEnd=s;
          edtaEl.focus();
          setDirtyState(true);
        }else{toast('ابتدا بخشی از متن را انتخاب نمایید','warn');}
      }
    };

    sh.querySelector('#ed-btn-paste').onclick=async()=>{
      let txt='';
      try{
        if(navigator.clipboard&&navigator.clipboard.readText){txt=await navigator.clipboard.readText();}
      }catch(err){}
      if(!txt){txt=window.prompt('متن مورد نظر برای چسباندن را وارد کنید:','');}
      if(!txt)return;
      if(cm){cm.replaceSelection(txt);cm.focus();}
      else{
        const s=edtaEl.selectionStart,e=edtaEl.selectionEnd;
        edtaEl.value=edtaEl.value.slice(0,s)+txt+edtaEl.value.slice(e);
        edtaEl.selectionStart=edtaEl.selectionEnd=s+txt.length;
        edtaEl.focus();
        setDirtyState(true);
      }
      toast('متن چسبانده شد','ok');
    };

    sh.querySelector('#ed-btn-undo').onclick=()=>{
      if(cm){cm.undo();cm.focus();}
      else{toast('از Ctrl+Z در فیلد متنی استفاده نمایید','hint');}
    };

    sh.querySelector('#ed-btn-redo').onclick=()=>{
      if(cm){cm.redo();cm.focus();}
      else{toast('از Ctrl+Y در فیلد متنی استفاده نمایید','hint');}
    };

    sh.querySelector('#ed-btn-comment').onclick=()=>{
      if(cm){cm.execCommand('toggleComment');cm.focus();}
      else{toast('از میانبر Ctrl+/ برای کامنت استفاده نمایید','hint');}
    };

    sh.querySelector('#ed-btn-format').onclick=()=>{
      const mode=selMode.value;
      if(mode==='json'){
        try{
          const obj=JSON.parse(getContent());
          setContent(JSON.stringify(obj,null,2));
          toast('فرمت JSON مرتب و زیباسازی شد','ok');
        }catch(e){toast('خطا در پارس JSON: '+e.message,'err');}
      }else if(cm){
        const totalLines=cm.lineCount();
        cm.operation(()=>{for(let i=0;i<totalLines;i++){cm.indentLine(i);}});
        toast('تورفتگی و فاصله‌گذاری خطوط مرتب شد','ok');
      }
    };

    sh.querySelector('#ed-btn-clear').onclick=async()=>{
      if(await confirmDlg('آیا مطمئنید می‌خواهید کل محتوای فایل را پاک کنید؟')){
        setContent('');
        toast('محتوای فایل پاک شد','ok');
      }
    };
    sh.querySelector('#ed-btn-reload').onclick=async()=>{
      if(isDirty&&!window.confirm('تغییرات ذخیره‌نشده لغو خواهد شد. آیا مطمئنید؟'))return;
      try{
        const d=await api('fs.read',{path,allow_large:true});
        setContent(d.content);
        fileData=Object.assign(fileData,d);
        toast('فایل از روی دیسک بازخوانی شد','ok');
      }catch(err){toast(err.message,'err');}
    };
    sh.querySelector('#ed-btn-dl').onclick=()=>{
      location.href=location.pathname+'?api=fs.download&path='+encodeURIComponent(path);
    };

    sh.querySelector('#ed-btn-wrap').onclick=()=>{
      lineWrap=!lineWrap;
      localStorage.setItem('wc_ed_wrap',lineWrap?'1':'0');
      sh.querySelector('#ed-btn-wrap').textContent=lineWrap?'↩️ شکست خط: روشن':'↔️ شکست خط: خاموش';
      if(cm){cm.setOption('lineWrapping',lineWrap);cm.refresh();}else{edtaEl.style.whiteSpace=lineWrap?'pre-wrap':'pre';}
    };

    const setFont=(sz)=>{
      fontSize=Math.max(10,Math.min(26,sz));
      localStorage.setItem('wc_ed_fontsize',fontSize);
      sh.querySelector('#ed-font-val').textContent=fontSize+'px';
      if(cm){cm.getWrapperElement().style.fontSize=fontSize+'px';cm.refresh();}else{edtaEl.style.fontSize=fontSize+'px';}
    };
    sh.querySelector('#ed-font-inc').onclick=()=>setFont(fontSize+1);
    sh.querySelector('#ed-font-dec').onclick=()=>setFont(fontSize-1);

    selTheme.onchange=()=>{
      theme=selTheme.value;
      localStorage.setItem('wc_ed_theme',theme);
      if(cm)cm.setOption('theme',theme);
    };

    selMode.onchange=()=>{
      const m=selMode.value;
      let targetMode=m;
      if(m==='json')targetMode={name:'javascript',json:true};
      if(cm)cm.setOption('mode',targetMode);
    };

    sh.querySelector('#ed-btn-eol').onclick=()=>{
      const cur=fileData.line_ending||'LF';
      const target=cur==='LF'?'CRLF':'LF';
      fileData.line_ending=target;
      sh.querySelector('#ed-btn-eol').textContent=target;
      toast(`فرمت انتهای خط به ${target} تغییر یافت (با ذخیره اعمال می‌شود)`,'ok');
      setDirtyState(true);
    };

  }catch(e){toast(e.message||'خطا در باز کردن فایل','err');}
}
let procList=[],procFilter='',procUser='',procSort='cpu',procTimer=null,procHideKernel=true;
let procSubView='procs',portsList=[],portFilter='';
INITS.proc={fn(){renderProcContainer()}};
function renderProcContainer(){
  const v=$('#v-proc');
  v.innerHTML=`<div class="segtabs" style="margin-bottom:12px"><button class="btn ${procSubView==='procs'?'pri':''}" id="proc-tab-procs">⚙️ پردازش‌های سیستم (Processes)</button><button class="btn ${procSubView==='ports'?'pri':''}" id="proc-tab-ports">🔌 پورت‌های فعال شبکه (Listening Ports)</button></div><div id="proc-subview-container"></div>`;
  $('#proc-tab-procs').onclick=()=>{procSubView='procs';renderProcContainer()};
  $('#proc-tab-ports').onclick=()=>{procSubView='ports';renderProcContainer()};
  if(procSubView==='procs'){initProcView()}else{initPortsView()}
}
function initProcView(){
  const c=$('#proc-subview-container');
  c.innerHTML='<div class="card"><h3>مدیریت پردازش‌ها</h3><div id="proc-summary" class="hint"></div><div class="row"><input class="inp" id="proc-search" placeholder="نام، PID، فرمان" value="'+esc(procFilter)+'"><select class="mini" id="proc-user"></select><select class="mini" id="proc-sort"><option value="cpu" '+(procSort==='cpu'?'selected':'')+'>CPU</option><option value="mem" '+(procSort==='mem'?'selected':'')+'>RAM</option><option value="pid" '+(procSort==='pid'?'selected':'')+'>PID</option><option value="name" '+(procSort==='name'?'selected':'')+'>نام</option></select><select class="mini" id="proc-rate"><option value="0">خودکار خاموش</option><option value="2000">۲ ثانیه</option><option value="5000" selected>۵ ثانیه</option><option value="10000">۱۰ ثانیه</option></select><button class="btn sm" id="proc-refresh">به‌روزرسانی</button><label class="hint"><input id="proc-kernel" type="checkbox" '+(procHideKernel?'checked':'')+'> مخفی‌کردن Kernel Threads</label></div></div><div id="proc-table"></div>';
  $('#proc-search').oninput=e=>{procFilter=e.target.value.toLowerCase();renderProcList()};
  $('#proc-user').onchange=e=>{procUser=e.target.value;renderProcList()};
  $('#proc-sort').onchange=e=>{procSort=e.target.value;renderProcList()};
  $('#proc-kernel').onchange=e=>{procHideKernel=e.target.checked;renderProcList()};
  $('#proc-refresh').onclick=loadProcs;
  const timer=()=>{clearInterval(procTimer);const ms=+$('#proc-rate').value;if(ms)procTimer=setInterval(()=>{if(curTab==='proc'&&procSubView==='procs'&&!document.hidden&&!__sheet)loadProcs()},ms)};
  $('#proc-rate').onchange=timer;
  timer();
  loadProcs();
}
async function loadProcs(){try{const d=await api('proc.list');procList=d.list;const s=$('#proc-summary');if(s)s.textContent=d.count+' processes · CPU '+d.total_cpu+'% · RAM '+d.total_mem+'% · PHP PID '+d.my_pid;const u=$('#proc-user');if(u){u.innerHTML='<option value="">همه کاربران</option>'+[...new Set(procList.map(p=>p.user))].sort().map(usr=>`<option value="${esc(usr)}">${esc(usr)}</option>`).join('');u.value=procUser;}renderProcList()}catch(e){toast(e.message,'err')}}
function renderProcList(){let a=procList.filter(p=>(!procHideKernel||!/^\[.*\]$/.test(p.args))&&(!procUser||p.user===procUser)&&(!procFilter||[p.pid,p.user,p.comm,p.args].join(' ').toLowerCase().includes(procFilter)));a.sort((a,b)=>procSort==='name'?a.comm.localeCompare(b.comm):procSort==='pid'?a.pid-b.pid:b[procSort]-a[procSort]);const box=$('#proc-table');if(!box)return;box.innerHTML='<div class="tblwrap"><table class="tbl"><thead><tr><th>PID</th><th>User</th><th>CPU</th><th>RAM</th><th>State</th><th>Command</th><th>عملیات</th></tr></thead><tbody>'+a.map(p=>`<tr><td>${p.pid}</td><td>${esc(p.user)}</td><td>${p.cpu}%</td><td>${p.mem}% (${(p.rss/1024).toFixed(1)}M)</td><td>${esc(p.stat)}</td><td class="cmdcol" title="${esc(p.args)}">${esc(p.args)}</td><td><button class="btn sm" data-info="${p.pid}">جزئیات</button><button class="btn sm" data-term="${p.pid}">TERM</button><button class="btn danger sm" data-kill="${p.pid}">KILL</button></td></tr>`).join('')+'</tbody></table></div>';actions(box,'data-info',openProcInfo);actions(box,'data-term',id=>killProc(+id,15));actions(box,'data-kill',id=>killProc(+id,9))}
async function killProc(pid,sig){if(await confirmDlg('ارسال سیگنال '+sig+' به PID '+pid+'؟')){await api('proc.kill',{pid,sig});toast('سیگنال ارسال شد','ok');loadProcs()}}
async function openProcInfo(pid){const d=await api('proc.info',{pid:+pid}),infoJson=JSON.stringify(d,null,2),sh=openSheet(sheetHead('PID '+pid)+'<div class="row" style="margin-bottom:8px"><button class="btn sm pri" id="pinfo-copy">📋 کپی مشخصات پردازش</button></div><pre class="logbox">'+esc(infoJson)+'</pre><div class="row">'+[1,15,9].map(sig=>`<button class="btn sm" data-sig="${sig}">${sig===1?'SIGHUP':sig===15?'SIGTERM':'SIGKILL'}</button>`).join('')+'</div>');sh.querySelector('#pinfo-copy').onclick=()=>copyText(infoJson,'مشخصات پردازش با موفقیت کپی شد');actions(sh,'data-sig',async sig=>{__closeSheet();await killProc(+pid,+sig)})}

async function initPortsView(){
  const c=$('#proc-subview-container');
  c.innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">🔌 مدیریت پورت‌های فعال شبکه (Listening Ports)</h3><div id="ports-summary" class="hint" style="margin-top:4px">در حال استعلام وضعیت پورت‌ها...</div></div><div class="row" style="gap:6px"><button class="btn danger sm" id="ports-kill-custom">⚡ آزادسازی پورت دلخواه</button><button class="btn sm" id="ports-refresh">🔄 بازخوانی</button></div></div><div class="row" style="margin-top:12px"><input class="inp" id="ports-search" placeholder="جستجوی پورت (مثلاً 8000)، نام پروسه، آدرس یا PID..." value="${esc(portFilter)}"></div></div><div id="ports-table"></div>`;
  $('#ports-search').oninput=e=>{portFilter=e.target.value.toLowerCase();renderPortsList()};
  $('#ports-refresh').onclick=loadPorts;
  $('#ports-kill-custom').onclick=killCustomPortPrompt;
  loadPorts();
}

async function loadPorts(){
  try{
    const d=await api('ports.list');
    portsList=d.list||[];
    const s=$('#ports-summary');
    if(s)s.textContent=`تعداد پورت‌های فعال: ${portsList.length} · پورت‌های وب‌سایت‌ها و اپلیکیشن‌ها`;
    renderPortsList();
  }catch(e){toast(e.message,'err')}
}

function renderPortsList(){
  let a=portsList.filter(p=>!portFilter||[p.port,p.proto,p.local_addr,p.name,p.pid,p.user,p.cmdline].join(' ').toLowerCase().includes(portFilter));
  const box=$('#ports-table');
  if(!box)return;
  if(a.length===0){
    box.innerHTML='<div class="card hint" style="text-align:center;padding:24px">هیچ پورتی مطابق با فیلتر یافت نشد.</div>';
    return;
  }
  box.innerHTML=`<div class="tblwrap"><table class="tbl"><thead><tr><th>پورت</th><th>پروتکل</th><th>آدرس محلی (Bind)</th><th>پروسه / برنامه</th><th>PID</th><th>کاربر</th><th>عملیات</th></tr></thead><tbody>`+a.map(p=>`<tr><td><span class="tag acc" style="font-family:monospace;font-weight:700;font-size:13px">🔌 ${esc(p.port)}</span></td><td><span class="tag sm ${p.proto.startsWith('TCP')?'ok':'info'}">${esc(p.proto)}</span></td><td><span class="ltr" style="font-family:monospace;font-size:12px;font-weight:600">${esc(p.local_addr)}</span></td><td><div style="font-weight:600">${esc(p.name)}</div>${p.system_service?`<div style="margin-top:2px"><span class="tag sm warn" title="این پروسه توسط سرویس سیستمی systemd لینوکس مدیریت می‌شود و پس از ریبوت خودکار اجرا می‌گردد">⚙️ سرویس: ${esc(p.system_service)}</span></div>`:''}${p.cmdline?`<div class="hint ltr" style="font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.cmdline)}">${esc(p.cmdline)}</div>`:''}</td><td><span class="ltr" style="font-family:monospace">${p.pid||'—'}</span></td><td><span class="tag sm">${esc(p.user)}</span></td><td><div class="row" style="gap:4px"><button class="btn danger sm" data-kill-port="${p.port}" data-kill-pid="${p.pid||''}" title="بستن فوری این پروسه و آزادسازی پورت ${p.port}">🔴 آزادسازی پورت</button>${p.system_service?`<button class="btn danger sm" data-disable-svc="${esc(p.system_service)}" title="غیرفعال‌سازی دائمی سرویس سیستمی ${esc(p.system_service)} تا پس از ریبوت اجرا نشود">🛑 غیرفعال‌سازی سرویس لینوکس</button>`:''}${p.pid?`<button class="btn sm" data-pinfo="${p.pid}">جزئیات</button>`:''}</div></td></tr>`).join('')+`</tbody></table></div>`;
  actions(box,'data-kill-port',async(port,el)=>{
    const pid=el.dataset.killPid;
    await killPortAction(+port,pid?+pid:null);
  });
  actions(box,'data-disable-svc',async unit=>{
    if(!await confirmDlg(`آیا می‌خواهید سرویس سیستمی «${unit}» را برای همیشه متوقف و غیرفعال (Disable & Mask) کنید تا بعد از ریبوت سرور اجرا نشود؟`))return;
    try{
      toast(`در حال توقف و غیرفعال‌سازی ${unit}...`,'acc');
      const d=await api('ports.disable_service',{unit});
      toast(d.message||`سرویس ${unit} غیرفعال شد`,'ok');
      loadPorts();
    }catch(e){toast(e.message,'err')}
  });
  actions(box,'data-pinfo',id=>openProcInfo(+id));
}

async function killPortAction(port,pid){
  if(!await confirmDlg(`آیا از بستن پروسه و آزادسازی فوری پورت ${port} اطمینان دارید؟`))return;
  try{
    toast(`در حال آزادسازی پورت ${port}...`,'acc');
    await api('ports.kill',{port,pid});
    toast(`پورت ${port} با موفقیت آزاد شد`,'ok');
    if(procSubView==='ports')loadPorts();
    if(curTab==='proc'&&procSubView==='procs')loadProcs();
  }catch(e){toast(e.message,'err')}
}

async function killCustomPortPrompt(){
  const pStr=await promptDlg('شماره پورت مورد نظر جهت آزادسازی و بستن فوری (مثلاً 8000 یا 8790):','8000');
  if(!pStr)return;
  const port=parseInt(pStr.trim(),10);
  if(isNaN(port)||port<1||port>65535){toast('شماره پورت نامعتبر است (باید بین ۱ تا ۶۵۵۳۵ باشد)','err');return;}
  try{
    toast(`در حال بستن تمامی پروسه‌های متصل به پورت ${port}...`,'acc');
    await api('ports.kill',{port});
    toast(`پورت ${port} با موفقیت آزاد شد`,'ok');
    if(procSubView==='ports')loadPorts();
  }catch(e){toast(e.message,'err')}
}

function openPortsSheet(){
  const sh=openSheet(sheetHead('مدیریت و آزادسازی پورت‌های سرور')+'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px"><input class="inp" id="sh-ports-search" placeholder="فیلتر پورت (مثلاً 8000) یا نام برنامه..." style="flex:1;min-width:200px"><button class="btn danger sm" id="sh-ports-kill-custom">⚡ آزادسازی پورت دلخواه</button><button class="btn sm" id="sh-ports-refresh">🔄 بازخوانی</button></div><div id="sh-ports-container">در حال دریافت وضعیت پورت‌ها...</div>');
  async function fetchAndRender(){
    try{
      const d=await api('ports.list');
      const list=d.list||[];
      const filter=(sh.querySelector('#sh-ports-search').value||'').toLowerCase();
      const filtered=list.filter(p=>!filter||[p.port,p.proto,p.local_addr,p.name,p.pid,p.user,p.cmdline].join(' ').toLowerCase().includes(filter));
      const c=sh.querySelector('#sh-ports-container');
      if(filtered.length===0){c.innerHTML='<div class="hint" style="text-align:center;padding:24px">هیچ پورتی یافت نشد.</div>';return;}
      c.innerHTML='<div class="tblwrap"><table class="tbl"><thead><tr><th>پورت</th><th>پروتکل</th><th>آدرس</th><th>پروسه</th><th>PID</th><th>عملیات</th></tr></thead><tbody>'+filtered.map(p=>`<tr><td><span class="tag acc" style="font-family:monospace;font-weight:700">🔌 ${p.port}</span></td><td><span class="tag sm ${p.proto.startsWith('TCP')?'ok':'info'}">${p.proto}</span></td><td><span class="ltr" style="font-family:monospace;font-size:11px">${esc(p.local_addr)}</span></td><td><span style="font-weight:600">${esc(p.name)}</span></td><td><span class="ltr" style="font-family:monospace">${p.pid||'—'}</span></td><td><button class="btn danger sm" data-sh-kill="${p.port}" data-sh-pid="${p.pid||''}">🔴 بستن پورت</button></td></tr>`).join('')+'</tbody></table></div>';
      actions(c,'data-sh-kill',async(port,el)=>{
        const pid=el.dataset.shPid;
        if(!await confirmDlg(`پورت ${port} و پروسه مربوطه بسته شود؟`))return;
        try{
          await api('ports.kill',{port:+port,pid:pid?+pid:null});
          toast(`پورت ${port} آزاد شد`,'ok');
          fetchAndRender();
        }catch(e){toast(e.message,'err');}
      });
    }catch(e){sh.querySelector('#sh-ports-container').innerHTML=`<div class="hint err">${esc(e.message)}</div>`;}
  }
  sh.querySelector('#sh-ports-search').oninput=fetchAndRender;
  sh.querySelector('#sh-ports-refresh').onclick=fetchAndRender;
  sh.querySelector('#sh-ports-kill-custom').onclick=async()=>{
    const pStr=await promptDlg('شماره پورت برای آزادسازی فوری (مثلاً 8000):','8000');
    if(!pStr)return;
    const port=parseInt(pStr.trim(),10);
    if(!port||port<1||port>65535){toast('پورت نامعتبر است','err');return;}
    try{
      await api('ports.kill',{port});
      toast(`پورت ${port} آزاد شد`,'ok');
      fetchAndRender();
    }catch(e){toast(e.message,'err');}
  };
  fetchAndRender();
}
const B={gh:null,profiles:[]};INITS.backup={fn:renderBackup};
async function renderBackup(){try{const[g,p]=await Promise.all([api('gh.get'),api('gh.profiles')]);B.gh=g;B.profiles=p.profiles;const v=$('#v-backup');v.innerHTML=`<div class="card"><h3>اتصال به گیت‌هاب</h3><div class="grid2"><div><label class="lb">ریپازیتوری بکاپ (خصوصی)</label><input class="inp ltr" id="ghrepo" value="${esc(g.gh_repo)}" placeholder="owner/private-backups"></div><div><label class="lb">شاخه بکاپ</label><input class="inp ltr" id="ghbranch" value="${esc(g.gh_branch)}"></div><div><label class="lb">توکن؛ خالی یعنی بدون تغییر</label><input class="inp ltr" id="ghtoken" type="password" placeholder="${esc(g.token_hint)}"></div><div><label class="lb">نام و ایمیل کامیت</label><input class="inp ltr" id="ghname" value="${esc(g.git_name)}"><input class="inp ltr" id="ghmail" value="${esc(g.git_email)}"></div></div><div class="row"><button class="btn pri" id="ghsave">ذخیره</button><button class="btn" id="ghtest">تست اتصال</button></div><p class="hint">بکاپ‌ها ممکن است حاوی اسرار باشند. از ریپوی خصوصی و توکن با حداقل دسترسی استفاده کنید. این شاخه با force push بازنویسی می‌شود؛ شاخه کد پروژه را وارد نکنید.</p></div><div class="card"><h3>پروفایل‌های بکاپ</h3><div id="proflist"></div><button class="btn sm" id="profadd">+ پروفایل</button></div><div class="card"><h3>اجرای بکاپ</h3><input class="inp" id="bkmsg" placeholder="پیام کامیت"><button class="btn pri" id="bkgo">شروع بکاپ</button></div><div class="card"><h3>نسخه‌های بکاپ</h3><button class="btn sm" id="snapref">به‌روزرسانی</button><div id="snaplist"></div></div>`;
 const save=async()=>{const repo=$('#ghrepo').value.trim();if(!repo)throw Error('ریپو الزامی است');B.gh=await api('gh.save',{gh_repo:repo,gh_branch:$('#ghbranch').value.trim()||'backups',gh_token:$('#ghtoken').value.trim()||'__KEEP__',git_name:$('#ghname').value.trim(),git_email:$('#ghmail').value.trim()});$('#ghtoken').value=''};
 $('#ghsave').onclick=async()=>{try{await save();toast('ذخیره شد','ok');loadSnaps()}catch(e){toast(e.message,'err')}};$('#ghtest').onclick=async()=>{try{await save();await api('gh.test');toast('اتصال موفق','ok');loadSnaps()}catch(e){toast(e.message,'err')}};$('#profadd').onclick=()=>profileDlg(null);$('#snapref').onclick=loadSnaps;$('#bkgo').onclick=async()=>{try{const profiles=$$('#proflist [data-id]:checked').map(c=>c.dataset.id),msg=$('#bkmsg').value;if(!profiles.length)throw Error('حداقل یک پروفایل انتخاب کنید');await save();if(!await confirmDlg('بکاپ به '+B.gh.gh_repo+' ارسال شود؟'))return;const d=await api('gh.backup',{profiles,msg});openJob(d.job,'بکاپ گیت‌هاب')}catch(e){toast(e.message,'err')}};paintProfiles();loadSnaps();}catch(e){toast(e.message,'err')}}
function paintProfiles(){const box=$('#proflist');box.innerHTML=B.profiles.map(p=>`<div class="li"><input class="chk" type="checkbox" data-id="${esc(p.id)}" ${p.enabled?'checked':''}><span class="t"><b>${esc(p.icon||'📁')} ${esc(p.name)}</b><small class="ltr">${esc((p.includes||[]).join(', ')||p.extra||'')}</small></span><div class="acts"><button class="btn sm" data-edit="${esc(p.id)}">ویرایش</button><button class="btn danger sm" data-del="${esc(p.id)}">حذف</button></div></div>`).join('');box.querySelectorAll('[data-id]').forEach(c=>c.onchange=async()=>{try{const p=B.profiles.find(x=>x.id===c.dataset.id);p.enabled=c.checked;await api('gh.profiles',{op:'save',profile:p})}catch(e){toast(e.message,'err')}});actions(box,'data-edit',id=>profileDlg(B.profiles.find(p=>p.id===id)));actions(box,'data-del',async id=>{if(await confirmDlg('پروفایل حذف شود؟')){B.profiles=(await api('gh.profiles',{op:'delete',id})).profiles;paintProfiles()}})}
function profileDlg(p){p=p||{id:'',name:'',icon:'📁',extra:'',enabled:true,includes:[],excludes:[]};const sh=openSheet(sheetHead('پروفایل بکاپ')+`<label class="lb">نام</label><input class="inp" id="pname" value="${esc(p.name)}"><label class="lb">آیکون</label><input class="inp" id="picon" value="${esc(p.icon)}"><label class="lb">مسیرها؛ هر خط یک مسیر</label><textarea class="inp ltr" id="pinc">${esc((p.includes||[]).join('\n'))}</textarea><label class="lb">الگوهای مستثنی</label><textarea class="inp ltr" id="pexc">${esc((p.excludes||[]).join('\n'))}</textarea><label class="lb">نوع ویژه</label><select class="inp" id="pextra">${[['','پوشه‌ها'],['db','دیتابیس'],['cron','کران‌جاب'],['packages','لیست پکیج‌ها']].map(([v,l])=>`<option value="${v}" ${p.extra===v?'selected':''}>${l}</option>`).join('')}</select><button class="btn pri" id="pok">ذخیره</button>`);sh.querySelector('#pok').onclick=async()=>{try{const q={...p,name:sh.querySelector('#pname').value.trim(),icon:sh.querySelector('#picon').value.trim(),extra:sh.querySelector('#pextra').value,includes:sh.querySelector('#pinc').value.split('\n').map(x=>x.trim()).filter(Boolean),excludes:sh.querySelector('#pexc').value.split('\n').map(x=>x.trim()).filter(Boolean)};if(!q.name)throw Error('نام الزامی است');B.profiles=(await api('gh.profiles',{op:'save',profile:q})).profiles;__closeSheet();paintProfiles()}catch(e){toast(e.message,'err')}}}
async function loadSnaps(){if(!B.gh?.gh_repo){$('#snaplist').textContent='ابتدا ریپو را ذخیره کنید';return}try{const d=await api('gh.snapshots'),refs=[...(d.has_branch?[d.branch]:[]),...d.tags],box=$('#snaplist');box.innerHTML=refs.map((r,i)=>`<div class="li"><span class="t ltr">${esc(r)}</span><div class="acts"><button class="btn sm" data-tree="${i}">محتوا</button><button class="btn pri sm" data-restore="${i}">بازیابی</button></div></div>`).join('')||'بکاپی موجود نیست';actions(box,'data-tree',i=>snapshotTreeDlg(refs[i]));actions(box,'data-restore',i=>restoreDlg(refs[i]))}catch(e){$('#snaplist').textContent=e.message}}
async function restoreDlg(ref){const d=await api('gh.manifest',{ref}),mf=d.manifest;const sh=openSheet(sheetHead('بازیابی '+esc(ref))+`<p class="hint">${fmtDate(mf.created)} · ${esc(mf.host)}</p><div>${(mf.profiles||[]).map(p=>`<label class="li"><input class="chk rc" type="checkbox" value="${esc(p.id)}" checked><span>${esc(p.name)}</span></label>`).join('')}</div><label class="lb"><input id="rover" type="checkbox" checked> بازنویسی فایل‌ها</label><label class="lb"><input id="rsafe" type="checkbox" checked> تگ ایمنی از شاخه بکاپ (نه بکاپ جدید VPS)</label><label class="lb">مسیر جایگزین؛ خالی یعنی مسیر اصلی</label><input class="inp ltr" id="rbase" placeholder="/restore-test"><button class="btn pri" id="rok">شروع بازیابی</button>`);sh.querySelector('#rok').onclick=async()=>{try{const params={ref,categories:[...sh.querySelectorAll('.rc:checked')].map(c=>c.value),overwrite:sh.querySelector('#rover').checked,safety:sh.querySelector('#rsafe').checked,target_base:sh.querySelector('#rbase').value.trim()};if(!params.categories.length)throw Error('دسته‌ای انتخاب نشده');if(params.target_base&&!params.target_base.startsWith('/'))throw Error('مسیر باید مطلق باشد');if(!await confirmDlg('بازیابی انجام شود؟ فایل‌های موجود ممکن است بازنویسی شوند.'))return;const result=await api('gh.restore',params);openJob(result.job,'بازیابی '+ref)}catch(e){toast(e.message,'err')}}}
async function snapshotTreeDlg(ref){const d=await api('gh.manifest',{ref}),entries=[];(d.manifest.profiles||[]).forEach(p=>(p.includes||[]).forEach(i=>entries.push({name:p.name+' → '+i.src,path:d.cache+'/'+i.staged})));const sh=openSheet(sheetHead('محتوای '+esc(ref))+entries.map((e,i)=>`<div class="li"><span class="t">${esc(e.name)}</span><button class="btn sm" data-p="${i}">باز</button></div>`).join(''));actions(sh,'data-p',i=>repoBrowse(entries[i].path))}
async function repoBrowse(path){const d=await api('fs.list',{path,hidden:true}),sh=openSheet(sheetHead(esc(path))+d.items.map((it,i)=>`<div class="li"><span class="t">${it.dir?'📁':'📄'} ${esc(it.name)}</span><button class="btn sm" data-i="${i}">${it.dir?'باز':'دانلود'}</button></div>`).join(''));actions(sh,'data-i',i=>{const it=d.items[i],p=joinPath(path,it.name);it.dir?repoBrowse(p):dlPath(p)})}
INITS.proj={
  fn(){
    renderProj();
    if(window.__projPollTimer)clearInterval(window.__projPollTimer);
    window.__projPollTimer=setInterval(async()=>{
      if(document.hidden)return;
      try{
        const d=await api('proj.poll_auto_updates');
        if(d&&d.triggered&&d.triggered.length>0){
          for(const item of d.triggered){
            toast(`🚀 نسخه جدید (${item.remote_commit}) برای پروژه «${item.project_name}» شناسایی و نصب خودکار آغاز شد`,'ok');
          }
          if(curTab==='proj'&&!__sheet)renderProj();
          if(curTab==='jobs'&&!__sheet&&typeof renderJobs==='function')renderJobs();
        }
      }catch(e){}
    },25000);
  }
};let projectList=[];
async function renderProj(){try{projectList=(await api('proj.list')).projects;const v=$('#v-proj');v.innerHTML='<div class="card"><h3>مدیریت پروژه‌ها</h3><button class="btn pri" id="padd">+ پروژه جدید</button><button class="btn" id="pref">به‌روزرسانی</button><button class="btn" id="project-cron" title="فعال‌سازی دیده‌بان کران‌جاب لینوکس برای آپدیت خودکار حتی در حالت بسته بودن مرورگر">⏰ دیده‌بان کران‌جاب (۱ دقیقه‌ای)</button><button class="btn" id="project-storage">فضای نصب پروژه‌ها</button><button class="btn" id="proj-ports-btn" title="مشاهده و آزادسازی پورت‌های شبکه">🔌 پورت‌های فعال سرور</button><p class="appearance-note hint">نصب‌های جدید از ریشه اختصاصی پروژه‌ها استفاده می‌کنند، نه /var/www. ابتدا «فضای نصب پروژه‌ها» را یک‌بار آماده و آزمایش کنید. مسیرهای قبلی بدون تأیید شما تغییر نمی‌کنند.</p><p class="hint">نگهبان PHP تا زمانی که پردازش آن زنده باشد، سرویس را بازیابی می‌کند. راه‌اندازی پس از بوت نیازمند systemd است. هم‌زمان دو نگهبان برای یک پروژه اجرا نکنید.</p></div>'+'<div class="view-tools"><input class="inp" id="project-filter" aria-label="فیلتر پروژه" placeholder="جستجوی نام، ریپو یا وضعیت پروژه…"><select class="mini" id="project-preset"><option value="scraper4">Scraper4 + Deployer</option><option value="node">Node.js</option><option value="static">Static</option></select><button class="btn" id="preset-new">ساخت از الگو</button></div>'+projectList.map(p=>`
  <div class="card project-card" style="border-right: 4px solid ${p.service?.status==='running'?'var(--ok)':'var(--line2)'}">
    <div class="proj-card-header">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:18px">${p.type==='python'?'🐍':p.type==='php'?'🐘':p.type==='node'?'⚡':p.type==='static'?'📄':'📦'}</span>
        <h3 style="margin:0;font-size:16px">${esc(p.name)}</h3>
        <span class="tag ${p.service?.status==='running'?'ok':'warn'}">${p.service?.status==='running'?'🟢 در حال اجرا':'⚪ متوقف'}</span>
        <span class="tag acc">${(p.type||'other').toUpperCase()}</span>
        ${p.auto_update?`<span class="tag ok" title="بررسی خودکار هر ${(p.auto_update_interval||60)} ثانیه">🔄 آپدیت خودکار فعال (${Math.round((p.auto_update_interval||60)/60)}د)</span>`:`<span class="tag" style="opacity:0.65">⏸ آپدیت خودکار خاموش</span>`}
      </div>
      <div class="row" style="gap:4px">
        <button class="btn sm" data-check-update="${p.id}" title="بررسی آنلاین کامیت جدید در گیت‌هاب">🔍 بررسی آپدیت</button>
        <button class="btn sm ${p.auto_update?'ok':''}" data-toggle-update="${p.id}" title="تغییر وضعیت آپدیت خودکار">${p.auto_update?'🔄 وضعیت: فعال':'⚡ فعال‌سازی خودکار'}</button>
        <button class="btn sm" data-check="${p.id}" title="آزمایش دسترسی‌ها و نیازمندی‌ها">بررسی نصب</button>
        <button class="btn sm" data-edit="${p.id}">ویرایش</button>
        <button class="btn sm" data-export="${p.id}">خروجی JSON</button>
        <button class="btn sm" data-files="${p.id}">فایل‌ها</button>
        <button class="btn danger sm" data-del="${p.id}">حذف</button>
      </div>
    </div>

    <table class="proj-meta-tbl">
      <tbody>
        <tr>
          <td class="k">🌐 مخزن و شاخه</td>
          <td class="v">
            <div class="row" style="gap:6px">
              <span class="ltr" style="font-family:monospace;font-weight:600">${esc(p.repo_url)}</span>
              <span class="tag sm ok">🌿 شاخه: ${esc(p.branch||'main')}</span>
              ${p.subfolder?`<span class="tag sm">📁 پوشه: ${esc(p.subfolder)}</span>`:''}
            </div>
          </td>
        </tr>
        <tr>
          <td class="k">📂 مسیر استقرار</td>
          <td class="v">
            <div class="proj-path-wrap">
              <span>${esc(p.deploy_path||'—')}</span>
              ${p.deploy_path?`<button class="btn mini" onclick="copyText('${esc(p.deploy_path)}','مسیر استقرار کپی شد')" title="کپی مسیر">📋 کپی مسیر</button>`:''}
            </div>
          </td>
        </tr>
        <tr>
          <td class="k">🚀 نسخه و کامیت مستقر</td>
          <td class="v">
            ${p.last_deploy?`
              <div class="row" style="gap:8px">
                <span class="proj-commit-pill">🔖 کامیت: ${esc(p.last_deploy.commit||'نامشخص')}</span>
                <span class="tag sm ok">✓ تاریخ دیپلوی: ${fmtDate(p.last_deploy.time)}</span>
                <span class="tag sm ${p.last_deploy.status==='ok'?'ok':'warn'}">وضعیت: ${esc(p.last_deploy.status)}</span>
              </div>
            `:'<span class="hint">هنوز دیپلوی نشده است (روی «نصب / به‌روزرسانی» کلیک کنید)</span>'}
          </td>
        </tr>
        <tr>
          <td class="k">⚙️ پیکربندی و اجرا</td>
          <td class="v">
            <div class="row" style="gap:6px">
              <span class="tag sm">پورت: ${esc(p.port||'—')}</span>
              <span class="tag sm ${p.is_daemon?'acc':''}">حالت: ${p.is_daemon?'دائم (Daemon)':'استاندارد'}</span>
              <span class="tag sm ${p.auto_start?'ok':''}">استارت خودکار: ${p.auto_start?'فعال':'غیرفعال'}</span>
              ${p.preserve_configs!==false?'<span class="tag sm ok" title="فایل‌های کانفیگ، دیتابیس و .env در آپدیت‌ها حفظ می‌شوند">🛡️ حفظ تنظیمات: فعال</span>':'<span class="tag sm warn" title="در هر آپدیت تمام فایل‌ها به نسخه خام گیت‌هاب ریست می‌شوند">🧹 ریست گیت (Clean)</span>'}
              ${p.start_cmd?`<span class="tag sm ltr" style="font-family:monospace">فرمان: ${esc(p.start_cmd)}</span>`:''}
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="row" style="margin-top:6px">
      <button class="btn pri sm" data-deploy="${p.id}">🚀 نصب / به‌روزرسانی دستی</button>
      ${p.start_cmd?`
        <button class="btn ok sm" data-start="${p.id}">▶ اجرا</button>
        <button class="btn danger sm" data-stop="${p.id}">⏹ توقف</button>
        <button class="btn sm" data-restart="${p.id}">🔄 راه‌اندازی مجدد</button>
      `:''}
      ${p.service?`
        <button class="btn sm" data-log="${esc(p.service.job)}">📜 لاگ زنده</button>
        <button class="btn sm pri" data-copylog="${esc(p.service.job)}" title="کپی سریع لاگ سرویس">📋 کپی لاگ</button>
      `:''}
    </div>
  </div>
`).join('');$('#project-storage').onclick=projectStorageDlg;
  const cronBtn=$('#project-cron');
  if(cronBtn)cronBtn.onclick=async()=>{
    cronBtn.disabled=true;cronBtn.textContent='در حال فعال‌سازی...';
    try{
      const d=await api('proj.install_cron');
      toast(d.msg,'ok');
    }catch(e){toast(e.message,'err')}
    finally{cronBtn.disabled=false;cronBtn.textContent='⏰ دیده‌بان کران‌جاب (۱ دقیقه‌ای)';}
  };$('#padd').onclick=()=>projectDlg(null);$('#preset-new').onclick=()=>projectDlg(presetProject($('#project-preset').value));$('#project-filter').oninput=e=>v.querySelectorAll('.project-card').forEach(c=>c.classList.toggle('hide',!c.textContent.toLowerCase().includes(e.target.value.trim().toLowerCase())));actions(v,'data-check',projectPreflight);
 actions(v,'data-toggle-update',async id=>{try{const d=await api('proj.toggle_auto_update',{id});if(d.auto_update){if(d.poll?.triggered?.length>0){toast(`🚀 به‌روزرسانی خودکار فعال شد؛ کامیت جدید (${d.poll.triggered[0].remote_commit}) در حال نصب است.`,'ok');openJob(d.poll.triggered[0].job_id,'دیپلوی خودکار');}else{toast('به‌روزرسانی خودکار با موفقیت فعال شد (بررسی منظم برنچ)','ok');}}else{toast('به‌روزرسانی خودکار غیرفعال شد','warn');}renderProj();}catch(e){toast(e.message,'err')}});
 actions(v,'data-check-update',async id=>{try{toast('در حال بررسی مخزن گیت‌هاب...','acc');const d=await api('proj.check_update',{id});if(d.has_update){if(await confirmDlg(`نسخه جدید (${d.remote_commit}) در شاخه ${d.branch} یافت شد (نسخه فعلی: ${d.local_commit}). هم‌اکنون نصب شود؟`)){const dep=await api('proj.deploy',{id});openJob(dep.job,'دیپلوی و به‌روزرسانی پروژه');}}else{toast(`پروژه با شاخه ${d.branch} (کامیت ${d.remote_commit||d.local_commit}) کاملاً به‌روز است`,'ok');}}catch(e){toast(e.message,'err')}});actions(v,'data-export',id=>projectExport(projectList.find(p=>p.id===id)));$('#pref').onclick=renderProj;if($('#proj-ports-btn'))$('#proj-ports-btn').onclick=openPortsSheet;actions(v,'data-deploy',async id=>{if(!await confirmDlg('فایل‌های پروژه به‌روزرسانی شوند؟ از داده‌ها بکاپ داشته باشید.'))return;const d=await api('proj.deploy',{id});openJob(d.job,'دیپلوی پروژه')});for(const action of ['start','stop','restart'])actions(v,'data-'+action,async id=>{const d=await api('proj.service',{id,action});renderProj();if(d?.job)openJob(d.job,'سرویس')});actions(v,'data-log',id=>openJob(id,'لاگ سرویس'));actions(v,'data-copylog',async jid=>{try{toast('در حال دریافت لاگ...','acc');const d=await api('jobs.log',{id:jid,offset:0});const txt=d.b64?decode(d.b64):'';await copyText(txt,'لاگ سرویس پروژه با موفقیت کپی شد');}catch(e){toast(e.message,'err')}});actions(v,'data-edit',id=>projectDlg(projectList.find(p=>p.id===id)));actions(v,'data-files',id=>{switchTab('files');navFm(projectList.find(p=>p.id===id).deploy_path)});actions(v,'data-del',async id=>{if(await confirmDlg('پروفایل حذف و سرویس آن متوقف شود؟ فایل‌ها باقی می‌مانند.')){await api('proj.delete',{id});renderProj()}})}catch(e){toast(e.message,'err')}}
// Import is data-only: it never saves, deploys, evaluates, or starts commands.
const PROJECT_JSON_MAX_BYTES=256*1024;
function parseProjectJson(text){
 if(new TextEncoder().encode(text).byteLength>PROJECT_JSON_MAX_BYTES)throw Error('JSON بزرگ‌تر از ۲۵۶ کیلوبایت است');
 let d;try{d=JSON.parse(text.replace(/^\uFEFF/,''))}catch(e){throw Error('JSON معتبر نیست؛ کوتیشن، ویرگول و براکت‌ها را بررسی کنید')}
 const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!record(d))throw Error('تنظیمات باید یک شیء JSON باشد، نه آرایه');
 if(Object.prototype.hasOwnProperty.call(d,'project')){if(Object.keys(d).length!==1||!record(d.project))throw Error('قالب project نامعتبر است');d=d.project}
 const strings=['name','type','repo_url','branch','subfolder','deploy_path','install_cmd','build_cmd','start_cmd','auth_token'];
 const allowed=new Set([...strings,'id','port','env','auto_start','is_daemon','auto_update','auto_update_interval','preserve_configs']);
 for(const k of Object.keys(d))if(!allowed.has(k))throw Error('فیلد ناشناخته: '+k);
 if(typeof d.name!=='string'||!d.name.trim()||typeof d.repo_url!=='string'||!d.repo_url.trim())throw Error('نام و repo_url الزامی هستند');
 const out=Object.create(null);
 for(const k of strings)if(Object.prototype.hasOwnProperty.call(d,k)){if(typeof d[k]!=='string'||/[\r\n\0]/.test(d[k]))throw Error('مقدار تک‌خطی متنی لازم است: '+k);out[k]=d[k]}
 if(out.type!==undefined&&!['node','python','php','static','other'].includes(out.type))throw Error('نوع پروژه نامعتبر است');
 if(!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)/.test(out.repo_url))throw Error('آدرس ریپو نامعتبر است');
 if(out.deploy_path!==undefined&&out.deploy_path!==''&&(!out.deploy_path.startsWith('/')||out.deploy_path==='/'))throw Error('مسیر نصب باید مطلق و غیر از / باشد');
 if(out.branch?.startsWith('-')||/(^|\/)\.\.(\/|$)/.test(out.subfolder||''))throw Error('شاخه یا زیرپوشه نامعتبر است');
 if(Object.prototype.hasOwnProperty.call(d,'port')){if(!['string','number'].includes(typeof d.port))throw Error('پورت نامعتبر است');const v=String(d.port);if(v!==''&&(!/^\d+$/.test(v)||+v<1||+v>65535))throw Error('پورت باید بین ۱ و ۶۵۵۳۵ باشد');out.port=v}
 for(const k of ['auto_start','is_daemon','preserve_configs'])if(Object.prototype.hasOwnProperty.call(d,k)){if(typeof d[k]!=='boolean')throw Error('مقدار '+k+' باید true یا false باشد');out[k]=d[k]}
 if(Object.prototype.hasOwnProperty.call(d,'env')){if(!record(d.env))throw Error('env باید یک شیء کلید/مقدار باشد');out.env=Object.create(null);for(const[k,v]of Object.entries(d.env)){if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)||!['string','number','boolean'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v))||/[\r\n\0]/.test(String(v)))throw Error('متغیر محیطی نامعتبر: '+k);out.env[k]=String(v)}}
 // A portable profile cannot change the identity of the dialog being edited.
 return out;
}
function applyProjectJson(sh,d){
 for(const k of ['name','repo_url','branch','subfolder','deploy_path','port','install_cmd','build_cmd','start_cmd'])if(d[k]!==undefined)sh.querySelector('#jq-'+k).value=d[k];
 if(d.type!==undefined)sh.querySelector('#jq-type').value=d.type;
 if(d.auth_token!==undefined)sh.querySelector('#jq-token').value=d.auth_token;
 if(d.auto_start!==undefined)sh.querySelector('#jq-auto').checked=d.auto_start;
 if(d.is_daemon!==undefined)sh.querySelector('#jq-daemon').checked=d.is_daemon;if(d.preserve_configs!==undefined)sh.querySelector('#jq-preserve').checked=d.preserve_configs;
 if(d.env!==undefined){const box=sh.querySelector('#jq-env');const lines=box.value.split(/\r?\n/).filter(line=>{const i=line.indexOf('=');return i<0||!Object.prototype.hasOwnProperty.call(d.env,line.slice(0,i).trim())});box.value=[...lines.filter(line=>line.trim()!==''),...Object.entries(d.env).map(([k,v])=>k+'='+v)].join('\n')}
}

function parsedProjectVersion(value){const m=String(value||'').trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]*)?$/);return m?{core:[m[1],m[2],m[3]||'0'].map(x=>BigInt(x)),pre:m[4]?.split('.')||[]}:null}
function compareProjectVersions(a,b){const x=parsedProjectVersion(a),y=parsedProjectVersion(b);if(!x||!y)return x?-1:y?1:0;for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?-1:1;if(!x.pre.length||!y.pre.length)return x.pre.length?1:y.pre.length?-1:0;for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){if(x.pre[i]===undefined)return 1;if(y.pre[i]===undefined)return -1;const a=x.pre[i],b=y.pre[i];if(a===b)continue;const an=/^\d+$/.test(a),bn=/^\d+$/.test(b);if(an&&bn){if(BigInt(a)===BigInt(b))continue;return BigInt(a)>BigInt(b)?-1:1}if(an!==bn)return an?1:-1;return a>b?-1:1}return 0}
function branchVersion(row,path='*'){const apps=(row.apps||[]).filter(a=>path==='*'||a.subfolder===path);return apps.map(a=>a.version).filter(v=>parsedProjectVersion(v)).sort(compareProjectVersions)[0]||''}
function sortedBranchRows(rows,path='*'){return [...rows].sort((a,b)=>compareProjectVersions(branchVersion(a,path),branchVersion(b,path))||a.name.localeCompare(b.name))}

function projectDlg(p){const fresh=!p;p=p||{id:'',name:'',type:'node',repo_url:'',branch:'main',subfolder:'',deploy_path:'',install_cmd:'',build_cmd:'',start_cmd:'',port:'',env:{},auto_start:false,is_daemon:true};const fields=[['name','نام پروژه'],['repo_url','آدرس ریپو'],['branch','شاخه'],['subfolder','زیرپوشه داخل ریپو'],['deploy_path','مسیر نصب روی سرور'],['port','پورت'],['install_cmd','دستور نصب'],['build_cmd','دستور بیلد'],['start_cmd','دستور اجرا']];const sh=openSheet(sheetHead('پروفایل پروژه')+`<div class="segtabs"><button class="btn ${fresh ? 'pri' : ''}" id="tab-gh">⚡ کاوشگر مخازن گیت‌هاب</button><button class="btn ${!fresh ? 'pri' : ''}" id="tab-man">✍️ تنظیمات دستی</button><button class="btn" id="tab-json">📄 ورود JSON</button></div><div id="json-exp" class="hide"><label class="lb">انتخاب فایل JSON تنظیمات (حداکثر ۲۵۶ کیلوبایت)</label><input class="inp" id="jq-json-file" type="file" accept=".json,application/json"><label class="lb">یا JSON را اینجا پیست کنید</label><textarea class="inp ltr" id="jq-json-text" rows="12" spellcheck="false" placeholder='{"name":"My project","repo_url":"https://github.com/owner/repo"}'></textarea><p class="hint">فقط فایل مورداعتماد وارد کنید؛ دستورات این پروفایل هنگام نصب قابل اجرا هستند. ورود JSON فقط فرم را پر می‌کند و چیزی را ذخیره یا اجرا نمی‌کند. متغیرهای محیطی موجود حفظ می‌شوند مگر همان کلید در JSON آمده باشد. شناسه id واردشده نادیده گرفته می‌شود.</p><button class="btn pri" id="jq-json-apply">اعمال در فرم برای بازبینی</button><p class="hint" id="jq-json-status" role="status" aria-live="polite"></p></div><div id="gh-exp" class="${fresh ? '' : 'hide'}"><div class="row"><input class="inp ltr" id="gh-owner" value="fazilatma"><button class="btn pri" id="gh-load">دریافت مخازن</button></div><label class="lb">مخزن</label><select class="inp" id="gh-repo-sel"></select><label class="lb">مرتب‌سازی شاخه‌ها بر اساس نسخه پروژه</label><select class="inp" id="gh-version-path"><option value="*">بالاترین نسخه بین پروژه‌ها</option></select><p class="hint">جدیدترین نسخه ابتدا؛ نسخه‌های نامشخص در انتها. برای مقایسه یک پروژه مشخص، زیرپوشه آن را انتخاب کنید. بررسی نسخه‌های Node از package.json انجام می‌شود.</p><div class="row"><span class="hint" id="gh-branch-progress" role="status" aria-live="polite"></span><button class="btn sm" id="gh-branches-refresh">بررسی دوباره شاخه‌ها</button></div><div class="tblwrap" id="gh-branch-table"></div><label class="lb">شاخه انتخاب‌شده</label><select class="inp" id="gh-branch-sel"></select><div id="gh-apps-list"></div></div><div id="man-exp" class="${fresh ? 'hide' : ''}"><div class="grid2">${fields.map(([k,l])=>`<div><label class="lb">${l}</label><input class="inp ${k==='name'?'':'ltr'}" id="jq-${k}" value="${esc(p[k]||'')}"></div>`).join('')}<div><label class="lb">نوع</label><select class="inp" id="jq-type">${['node','python','php','static','other'].map(t=>`<option value="${t}" ${p.type===t?'selected':''}>${t}</option>`).join('')}</select></div><div><label class="lb">توکن ریپوی خصوصی؛ خالی بدون تغییر</label><input class="inp ltr" id="jq-token" type="password" placeholder="${p.has_token_hint?'ذخیره شده':''}"></div></div><div class="row"><button class="btn sm" id="jq-managed-path">استفاده از مسیر قابل‌نوشتن مدیریت‌شده</button></div><p class="hint">پروژه جدید: مسیر خالی یعنی پوشه اختصاصی زیر ریشه نصب مدیریت‌شده. پروژه موجود: خالی‌کردن مسیر، محل قبلی را حفظ می‌کند. جابه‌جایی نصب‌های دارای داده خودکار نیست.</p><p class="hint">فیلد پورت فقط PORT را تنظیم می‌کند؛ برنامه باید آن را پشتیبانی کند. در Scraper4، دیپلویر از DEPLOYER_UI_PORT (پیش‌فرض 8790) و اسکریپر از SCRAPER_PORT (پیش‌فرض 3000) استفاده می‌کند. npm start این مخزن، Wrangler است نه دیپلویر.</p><label class="lb">متغیرهای محیطی؛ هر خط KEY=VALUE</label><textarea class="inp ltr" id="jq-env">${esc(Object.entries(p.env||{}).map(([k,v])=>k+'='+v).join('
'))}</textarea><label class="lb"><input class="chk" id="jq-auto" type="checkbox" ${p.auto_start?'checked':''}> اجرای خودکار پس از دیپلوی</label><label class="lb"><input class="chk" id="jq-daemon" type="checkbox" ${p.is_daemon?'checked':''}> بازیابی خودکار سرویس هنگام خروج</label><label class="lb"><input class="chk" id="jq-autoupdate" type="checkbox" ${p.auto_update?'checked':''}> 🔄 به‌روزرسانی خودکار برنچ گیت‌هاب (Auto-Update)</label><div id="jq-autoupdate-box" class="${p.auto_update?'':'hide'}" style="margin-right:24px;margin-bottom:8px"><label class="lb">فاصله بررسی تغییرات برنچ</label><select class="inp" id="jq-autoupdate-interval"><option value="60" ${p.auto_update_interval===60||!p.auto_update_interval?'selected':''}>هر ۱ دقیقه (پیش‌فرض)</option><option value="120" ${p.auto_update_interval===120?'selected':''}>هر ۲ دقیقه</option><option value="300" ${p.auto_update_interval===300?'selected':''}>هر ۵ دقیقه</option><option value="900" ${p.auto_update_interval===900?'selected':''}>هر ۱۵ دقیقه</option><option value="1800" ${p.auto_update_interval===1800?'selected':''}>هر ۳۰ دقیقه</option><option value="3600" ${p.auto_update_interval===3600?'selected':''}>هر ۱ ساعت</option></select></div><div style="margin-top:8px;padding:10px;border-radius:8px;background:var(--panel2);border:1px solid var(--line)"><label class="lb" style="margin:0;cursor:pointer"><input class="chk" id="jq-preserve" type="checkbox" ${p.preserve_configs!==false?'checked':''}> 🛡️ حفظ و ادغام تنظیمات، کانفیگ‌ها و دیتابیس محلی هنگام آپدیت</label><p class="hint" style="margin:4px 0 0 0;font-size:12px"><b>فعال (پیش‌فرض):</b> متغیرهای .env، فایل‌های config.json/settings.json، دیتابیس‌ها و توکن‌های محلی سرور ایران در آپدیت‌ها ادغام و حفظ می‌شوند.<br><b>غیرفعال:</b> در هر آپدیت، پروژه کاملاً به نسخه خام مخزن گیت‌هاب ریست می‌شود (Clean Reset).</p></div><button class="btn pri" id="jq-save" style="margin-top:10px">ذخیره پروفایل</button><p class="hint">ذخیره به‌تنهایی نصب را شروع نمی‌کند. پس از ذخیره دکمه نصب را بزنید.</p></div>`);
 const showTab=id=>{for(const tab of ['gh','man','json']){sh.querySelector('#'+tab+'-exp').classList.toggle('hide',tab!==id);sh.querySelector('#tab-'+tab).classList.toggle('pri',tab===id)}};
 const man=()=>showTab('man'),gh=()=>showTab('gh');sh.querySelector('#tab-man').onclick=man;sh.querySelector('#tab-gh').onclick=gh;sh.querySelector('#tab-json').onclick=()=>showTab('json');
 const jsonText=sh.querySelector('#jq-json-text'),jsonStatus=sh.querySelector('#jq-json-status');let jsonEpoch=0;
 jsonText.oninput=()=>{jsonEpoch++;jsonStatus.textContent=''};
 sh.querySelector('#jq-json-file').onchange=async e=>{const epoch=++jsonEpoch,file=e.target.files[0];if(!file)return;try{if(file.size>PROJECT_JSON_MAX_BYTES)throw Error('فایل بزرگ‌تر از ۲۵۶ کیلوبایت است');const text=await file.text();if(epoch!==jsonEpoch||sh.querySelector('#jq-json-text')!==jsonText)return;jsonText.value=text;jsonStatus.textContent='فایل خوانده شد؛ برای اعتبارسنجی و بازبینی دکمه اعمال را بزنید'}catch(error){if(epoch===jsonEpoch&&sh.querySelector('#jq-json-text')===jsonText)jsonStatus.textContent=error.message}};
 sh.querySelector('#jq-json-apply').onclick=()=>{try{const imported=parseProjectJson(jsonText.value);jsonEpoch++;applyProjectJson(sh,imported);man();toast('JSON در فرم اعمال شد؛ دستورات و مسیر را بررسی و سپس ذخیره کنید','ok')}catch(error){jsonStatus.textContent=error.message}};
 const fill=app=>{applyProjectJson(sh,app);sh.querySelector('#jq-type').value=app.type||'node';man()};
 const owner=()=>sh.querySelector('#gh-owner').value.trim()||'fazilatma',repo=()=>sh.querySelector('#gh-repo-sel').value,branch=()=>sh.querySelector('#gh-branch-sel').value;
 const table=sh.querySelector('#gh-branch-table'),progress=sh.querySelector('#gh-branch-progress'),pathSelect=sh.querySelector('#gh-version-path');
 let epoch=0,selection=0,rows=[],snapshot=null;
 const current=e=>e===epoch&&sh.querySelector('#gh-branch-table')===table&&table.isConnected;
 const renderApps=(apps,ctx)=>{const box=sh.querySelector('#gh-apps-list');if(!apps.length){box.innerHTML='<p class="empty" style="text-align:center;padding:16px">📁 پروژه استانداردی در این شاخه یافت نشد؛ از تب تنظیمات دستی استفاده کنید.</p>';return;}box.innerHTML=`<div style="margin-top:14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0">📋 برنامه‌ها و سرویس‌های کشف‌شده در شاخه <span class="tag ltr" style="font-weight:700">${esc(ctx.branch)}</span>:</h4><span class="tag acc">${apps.length} برنامه</span></div><div class="tblwrap" style="max-height:45vh;margin-bottom:10px"><table class="tbl"><thead><tr><th style="width:23%">📦 نام و مسیر</th><th style="width:19%">💻 زبان و فریم‌ورک</th><th style="width:11%">🏷️ ورژن</th><th style="width:18%">⚡ وضعیت سرویس</th><th style="width:17%">⚙️ دستورات</th><th style="width:12%;text-align:center">عملیات</th></tr></thead><tbody>${apps.map((a,i)=>`<tr><td><div style="font-weight:700;font-size:13.5px">${esc(a.name)}</div><div class="hint ltr" style="font-size:11px;margin-top:2px">📁 ${esc(a.subfolder?'/'+a.subfolder:'/ (ریشه)')}</div></td><td><span class="tag acc" style="font-weight:700">${esc(a.lang_label||a.type)}</span><div style="font-size:11px;color:var(--mut);margin-top:3px">${esc(a.framework||'استاندارد')}</div></td><td><span class="tag ok" style="font-weight:700">${esc(a.version?'v'+a.version:'نامشخص')}</span></td><td><span class="tag" style="background:rgba(16,185,129,.15);color:#10b981;font-weight:700;border:1px solid rgba(16,185,129,.3)">● ۲۴/۷ دائمی</span>${a.port?`<div class="hint ltr" style="font-size:11px;margin-top:2px">🔌 پورت: ${esc(a.port)}</div>`:''}</td><td><div class="cmdcol" style="max-width:180px" title="نصب: ${esc(a.install_cmd)}
اجرا: ${esc(a.start_cmd)}">${a.install_cmd?`<span style="color:#6ee7b7">📦</span> <small class="ltr">${esc(a.install_cmd)}</small><br>`:''}${a.start_cmd?`<span style="color:#93c5fd">⚡</span> <small class="ltr">${esc(a.start_cmd)}</small>`:''}</div></td><td style="text-align:center"><div style="display:flex;gap:4px;flex-direction:column"><button class="btn pri sm" data-quick="${i}" type="button" style="background:linear-gradient(135deg,#059669,#10b981);box-shadow:0 2px 8px rgba(16,185,129,.3);white-space:nowrap;padding:4px 8px;font-size:11.5px">🚀 نصب و دیپلوی</button><button class="btn sm" data-custom="${i}" type="button" style="white-space:nowrap;padding:4px 6px;font-size:11px">✏️ سفارشی‌سازی</button></div></td></tr>`).join('')}</tbody></table></div>`;const project=i=>({...apps[i],repo_url:'https://github.com/'+ctx.owner+'/'+ctx.repo,branch:ctx.branch,is_daemon:true,auto_start:true});actions(box,'data-custom',i=>fill(project(i)));actions(box,'data-quick',async i=>{try{const r=await api('proj.quick_deploy',{project:project(i)});__closeSheet();renderProj();openJob(r.job,'🚀 نصب و استقرار: '+apps[i].name)}catch(err){toast(err.message,'err')}})};
 const paintBranches=()=>{const path=pathSelect.value,ordered=sortedBranchRows(rows,path);table.innerHTML=rows.length?'<table class="tbl"><thead><tr><th>شاخه</th><th>نسخه ↓</th><th>پروژه / زیرپوشه</th><th>وضعیت</th><th>انتخاب</th></tr></thead><tbody>'+ordered.map(row=>{const apps=(row.apps||[]).filter(a=>path==='*'||a.subfolder===path);return `<tr><td class="ltr">${esc(row.name)}${row.default?' <span class="tag">پیش‌فرض</span>':''}</td><td class="ltr">${esc(branchVersion(row,path)||'—')}</td><td>${apps.map(a=>'<div class="ltr">'+esc(a.subfolder||'/')+' · '+esc(a.version||'نامشخص')+'</div>').join('')||'—'}</td><td>${esc(row.error||({pending:'در صف بررسی',loading:'در حال بررسی…',done:apps.length?'بررسی شد':'بدون پروژه مطابق'}[row.state]))}</td><td><button class="btn sm" data-branch-row="${rows.indexOf(row)}">انتخاب</button></td></tr>`}).join('')+'</tbody></table>':'<p class="empty">شاخه‌ای یافت نشد</p>';actions(table,'data-branch-row',i=>{sh.querySelector('#gh-branch-sel').value=rows[i].name;inspect()});};
 const updatePaths=()=>{const old=pathSelect.value,paths=[...new Set(rows.flatMap(r=>(r.apps||[]).map(a=>a.subfolder)))].sort();pathSelect.innerHTML='<option value="*">بالاترین نسخه بین پروژه‌ها</option>'+paths.map(path=>`<option value="${esc(path)}" ${old===path?'selected':''}>${esc(path||'/ (ریشه)')}</option>`).join('');if(old==='*')pathSelect.value='*'};
 const inspect=async()=>{if(!snapshot)return;const e=epoch,s=++selection,ctx={...snapshot,branch:branch()},row=rows.find(r=>r.name===ctx.branch);sh.querySelector('#gh-apps-list').textContent='در حال بررسی…';try{const apps=row?.state==='done'?row.apps:(await api('gh.inspect_branch',ctx)).apps;if(current(e)&&s===selection)renderApps(apps,ctx)}catch(error){if(current(e)&&s===selection)sh.querySelector('#gh-apps-list').textContent=error.message}};
 const branches=async()=>{const e=++epoch;selection++;snapshot={owner:owner(),repo:repo()};const ctx={...snapshot};rows=[];table.replaceChildren();progress.textContent='دریافت همه شاخه‌ها…';sh.querySelector('#gh-apps-list').replaceChildren();sh.querySelector('#gh-branch-sel').replaceChildren();pathSelect.innerHTML='<option value="*">بالاترین نسخه بین پروژه‌ها</option>';pathSelect.value='*';try{const d=await api('gh.repo_branches',ctx);if(!current(e))return;rows=d.branches.map(b=>({...b,state:'pending',apps:[]}));sh.querySelector('#gh-branch-sel').innerHTML=rows.map(b=>`<option value="${esc(b.name)}" ${b.default?'selected':''}>${esc(b.name)}</option>`).join('');paintBranches();let done=0;for(const row of rows){if(!current(e))return;row.state='loading';progress.textContent=`بررسی نسخه‌ها: ${done} / ${rows.length}`;paintBranches();try{row.apps=(await api('gh.inspect_branch',{...ctx,branch:row.name})).apps;row.state='done'}catch(error){row.state='error';row.error=error.message}if(!current(e))return;done++;updatePaths();paintBranches();progress.textContent=`بررسی نسخه‌ها: ${done} / ${rows.length} · خطا: ${rows.filter(r=>r.state==='error').length}`;}}catch(error){if(current(e))progress.textContent=error.message}};
 pathSelect.onchange=paintBranches;sh.querySelector('#gh-branches-refresh').onclick=branches;
 let repoLoad=0;
 sh.querySelector('#gh-owner').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();sh.querySelector('#gh-load').click();}};
 sh.querySelector('#gh-load').onclick=async()=>{const request=++repoLoad,requestedOwner=owner();++epoch;++selection;rows=[];snapshot=null;table.replaceChildren();sh.querySelector('#gh-apps-list').replaceChildren();sh.querySelector('#gh-repo-sel').replaceChildren();sh.querySelector('#gh-branch-sel').replaceChildren();progress.textContent='دریافت مخازن…';try{const d=await api('gh.user_repos',{owner:requestedOwner});if(request!==repoLoad||owner()!==requestedOwner||!table.isConnected||sh.querySelector('#gh-branch-table')!==table)return;sh.querySelector('#gh-repo-sel').innerHTML=d.repos.map(r=>`<option value="${esc(r.name)}">${esc(r.name)} (${esc(r.language)})</option>`).join('');sh.querySelector('#gh-repo-sel').value=d.repos[0]?.name||'';if(d.repos.length)await branches();else progress.textContent='مخزنی یافت نشد'}catch(error){if(request===repoLoad&&table.isConnected)progress.textContent=error.message}};
 sh.querySelector('#gh-owner').oninput=()=>{++epoch;++selection;++repoLoad;snapshot=null;rows=[];table.replaceChildren();sh.querySelector('#gh-apps-list').replaceChildren();sh.querySelector('#gh-repo-sel').replaceChildren();sh.querySelector('#gh-branch-sel').replaceChildren();progress.textContent='برای این مالک، دریافت مخازن را بزنید'};
 sh.querySelector('#gh-repo-sel').onchange=branches;sh.querySelector('#gh-branch-sel').onchange=inspect;
 sh.querySelector('#jq-managed-path').onclick=async()=>{try{const d=await api('proj.managed_path',{id:p.id||'',name:sh.querySelector('#jq-name').value});sh.querySelector('#jq-deploy_path').value=d.path;toast('مسیر پیشنهادی در فرم قرار گرفت؛ پس از بازبینی ذخیره کنید','ok')}catch(e){toast(e.message,'err')}};
 sh.querySelector('#jq-autoupdate').onchange=e=>sh.querySelector('#jq-autoupdate-box').classList.toggle('hide',!e.target.checked);
 sh.querySelector('#jq-save').onclick=async()=>{try{const q={id:p.id||'',type:sh.querySelector('#jq-type').value,auth_token:sh.querySelector('#jq-token').value.trim()||'__KEEP__',env_text:sh.querySelector('#jq-env').value,auto_start:sh.querySelector('#jq-auto').checked,is_daemon:sh.querySelector('#jq-daemon').checked,auto_update:sh.querySelector('#jq-autoupdate').checked,auto_update_interval:+sh.querySelector('#jq-autoupdate-interval').value||60,preserve_configs:sh.querySelector('#jq-preserve').checked};for(const[k]of fields)q[k]=sh.querySelector('#jq-'+k).value.trim();if(!q.name||!q.repo_url)throw Error('نام و ریپو الزامی است');await api('proj.save',{project:q});__closeSheet();renderProj();toast('ذخیره شد؛ اکنون نصب را بزنید','ok')}catch(e){toast(e.message,'err')}};
 if(fresh){gh();sh.querySelector('#gh-load').click()}
}
INITS.jobs={fn(){renderJobs();setInterval(()=>{if(curTab==='jobs'&&!document.hidden&&!__sheet)renderJobs()},5000)}};
let jobText="",jobState="";
async function renderJobs(){try{const d=await api('jobs.list'),v=$('#v-jobs');v.innerHTML='<div class="card"><h3>کارهای پس‌زمینه و خطاهای راه‌اندازی</h3><button class="btn sm" id="jobs-ref">به‌روزرسانی</button></div>'+'<div class="view-tools"><input class="inp" id="job-filter" aria-label="جستجوی کارها" placeholder="فیلتر کارها…" value="'+esc(jobText)+'"><select class="mini" id="job-state">'+[['','همه وضعیت‌ها'],['running','در حال اجرا'],['failed','ناموفق'],['done','کامل'],['dead','قطع شده']].map(([k,t])=>'<option value="'+k+'" '+(jobState===k?'selected':'')+'>'+t+'</option>').join('')+'</select></div>'+d.jobs.map(j=>`<div class="li job-row" data-state="${esc(j.status.status)}"><span class="t"><b>${esc(j.name)}</b><small>${fmtDate(j.created)} · ${esc(j.type)} · ${esc(j.status.status)} ${j.status.exit??''}</small></span><button class="btn sm" data-log="${esc(j.id)}">لاگ</button><button class="btn sm pri" data-copylog="${esc(j.id)}" title="کپی سریع متن لاگ">📋 کپی لاگ</button>${j.status.status==='running'?`<button class="btn danger sm" data-stop="${esc(j.id)}">توقف</button>`:''}</div>`).join('');const filter=()=>v.querySelectorAll('.job-row').forEach(row=>row.classList.toggle('hide',!(row.textContent.toLowerCase().includes(jobText.toLowerCase())&&(!jobState||row.dataset.state===jobState))));$('#job-filter').oninput=e=>{jobText=e.target.value;filter()};$('#job-state').onchange=e=>{jobState=e.target.value;filter()};filter();$('#jobs-ref').onclick=renderJobs;actions(v,'data-log',id=>openJob(id,d.jobs.find(j=>j.id===id).name));actions(v,'data-copylog',async jid=>{try{toast('در حال دریافت لاگ...','acc');const dj=await api('jobs.log',{id:jid,offset:0});const txt=dj.b64?decode(dj.b64):'';await copyText(txt,'لاگ کار با موفقیت کپی شد');}catch(e){toast(e.message,'err')}});actions(v,'data-stop',async id=>{if(await confirmDlg('متوقف شود؟')){await api('jobs.stop',{id});renderJobs()}})}catch(e){toast(e.message,'err')}}
INITS.set={fn:renderSet};
async function renderSet(){try{const s=await api('settings.get'),v=$('#v-set');v.innerHTML=`<div class="card"><h3>استودیوی ظاهر</h3><p class="hint">۵ پالت رنگ × ۳ چیدمان · حالت فشرده · پیش‌نمایش و ذخیره</p><button class="btn pri" onclick="appearanceDlg()">پوسته و چیدمان</button></div><div class="card"><h3>🛡️ پروکسی کلودفلر و رفع تحریم پکیج‌ها (Proxy & Anti-Sanction)</h3><p class="hint">تنظیم حالت عبور ترافیک، کلون مخازن گیت، دانلود پکیج‌ها (Pip / Npm / Composer / Git) و وب‌هوک‌ها از طریق Cloudflare Worker جهت دورزدن تحریم‌ها و فیلترینگ.</p><label class="lb">حالت اتصال پروکسی (Proxy Mode)</label><div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"><label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--panel2)"><input type="radio" name="st_proxy_mode" value="direct" ${s.proxy_mode==='direct'?'checked':''} style="margin-top:3px"><div><div style="font-weight:700">🌐 مستقیم (Direct)</div><div class="hint" style="font-size:12px;margin:0">اتصال بدون پروکسی (برای سرورهای خارج از کشور یا اینترنت بدون فیلتر و تحریم)</div></div></label><label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--panel2)"><input type="radio" name="st_proxy_mode" value="auto" ${s.proxy_mode==='auto'||!s.proxy_mode?'checked':''} style="margin-top:3px"><div><div style="font-weight:700">⚡ خودکار و هوشمند (Auto / Smart Fallback) — پیشنهادی</div><div class="hint" style="font-size:12px;margin:0">تلاش اتصال مستقیم؛ در صورت خطا، مسدودی، تحریم یا HTTP 403 به طور خودکار از ورکر کلودفلر عبور می‌کند</div></div></label><label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--panel2)"><input type="radio" name="st_proxy_mode" value="cf_proxy" ${s.proxy_mode==='cf_proxy'?'checked':''} style="margin-top:3px"><div><div style="font-weight:700">🛡️ پروکسی کلودفلر (Cloudflare Worker Proxy)</div><div class="hint" style="font-size:12px;margin:0">هدایت اجباری تمامی درخواست‌های مخازن، دیپلوی، دانلودها و ارتباطات خارجی از طریق ورکر کلودفلر</div></div></label></div><label class="lb">آدرس ورکر پروکسی کلودفلر (Worker Proxy URL)</label><input class="inp ltr" id="st_proxy_cf_url" placeholder="https://proxy.fazilat-ma.workers.dev/?url=https://example.com/page" value="${esc(s.proxy_cf_url||'https://proxy.fazilat-ma.workers.dev/?url=https://example.com/page')}"><p class="hint">می‌توانید ورکر پیش‌فرض را استفاده کنید یا آدرس Cloudflare Worker اختصاصی خودتان را وارد فرمایید.</p><div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn pri" id="st_proxy_save_btn">💾 ذخیره تنظیمات پروکسی</button><button class="btn" id="st_proxy_test_btn">🔍 تست اتصال و سلامت پروکسی</button></div><div id="proxy-test-box" style="margin-top:10px;display:none"></div></div><div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div>
      <h3 style="margin:0">📦 درون‌ریزی و برون‌بری تنظیمات (Import / Export)</h3>
      <p class="hint" style="margin-top:4px">تهیه نسخه پشتیبان از کل تنظیمات وب‌کنسول، لیست پروژه‌ها، پروفایل‌های بکاپ و کانفیگ پروکسی یا انتقال سریع به سرور دیگر.</p>
    </div>
    <div class="row" style="gap:8px">
      <button class="btn pri" id="st_export_btn">📥 برون‌بری و دانلود (Export JSON)</button>
      <button class="btn ok" id="st_import_btn">📤 درون‌ریزی تنظیمات (Import JSON)</button>
    </div>
  </div>
</div><div class="card"><h3>تغییر رمز</h3><label class="lb">رمز فعلی</label><input class="inp" type="password" id="pwold"><label class="lb">رمز جدید</label><input class="inp" type="password" id="pwnew"><button class="btn pri" id="pwok">تغییر رمز</button></div><div class="card"><h3>تنظیمات عمومی</h3><button class="btn" onclick="projectStorageDlg()">فضای نصب پروژه‌ها</button><label class="lb">پوشه شروع</label><input class="inp ltr" id="stfs" value="${esc(s.fs_start)}"><label class="lb">مدت نشست (دقیقه)</label><input class="inp" type="number" id="stses" value="${s.session_minutes}"><label class="lb">IP/CIDR مجاز؛ هر خط یک مورد، خالی یعنی همه</label><textarea class="inp ltr" id="stip">${esc(s.allowed_ips)}</textarea><p class="hint">محدودیت IP از REMOTE_ADDR استفاده می‌کند. در پشت پراکسی، آدرس واقعی را در تنظیمات مورداعتماد وب‌سرور تنظیم کنید.</p><button class="btn pri" id="stok">ذخیره</button>${s.noexec?'<p class="hint">PHP exec غیرفعال است</p>':''}</div><div class="card"><h3>گزارش فعالیت</h3><button class="btn" id="actbtn">مشاهده</button></div><div class="card hint">وب‌کنسول Pro ${esc(__BOOT.v)} · ترمینال، فایل منیجر، بکاپ، مدیریت پردازش و پروژه.<br>داده‌ها در .wconsole_data نگه‌داری می‌شوند. دسترسی HTTP به این پوشه را در وب‌سرور ببندید. این ابزار را به‌عنوان root اجرا نکنید.</div>`;$('#st_export_btn').onclick=openExportDlg;$('#st_import_btn').onclick=openImportDlg;$('#st_proxy_save_btn').onclick=async()=>{try{const mode=$('input[name="st_proxy_mode"]:checked')?.value||'auto';const cfUrl=$('#st_proxy_cf_url').value.trim();await api('settings.save',{proxy_mode:mode,proxy_cf_url:cfUrl});toast('تنظیمات پروکسی کلودفلر با موفقیت ذخیره شد','ok')}catch(e){toast(e.message,'err')}};$('#st_proxy_test_btn').onclick=async()=>{const box=$('#proxy-test-box');box.style.display='block';box.innerHTML='<div class="row" style="gap:8px;align-items:center"><span class="spin">⏳</span> در حال ارزیابی اتصال مستقیم و پروکسی کلودفلر...</div>';try{const cfUrl=$('#st_proxy_cf_url').value.trim();const d=await api('proxy.test',{proxy_cf_url:cfUrl});let html='<div class="grid grid-2" style="gap:8px;margin-top:8px">';html+=`<div style="padding:10px;border-radius:8px;background:var(--panel2);border:1px solid ${d.direct.ok?'var(--ok)':'var(--err)'}"><div style="font-weight:700;display:flex;justify-content:space-between"><span>🌐 اتصال مستقیم:</span><span class="tag ${d.direct.ok?'ok':'danger'}">${d.direct.ok?'موفق ('+d.direct.ms+'ms)':'ناموفق (HTTP '+d.direct.code+')'}</span></div><div class="hint" style="font-size:11px;margin-top:4px;word-break:break-all">${esc(d.direct.preview||d.direct.error||'بدون پاسخ')}</div></div>`;html+=`<div style="padding:10px;border-radius:8px;background:var(--panel2);border:1px solid ${d.proxy.ok?'var(--ok)':'var(--err)'}"><div style="font-weight:700;display:flex;justify-content:space-between"><span>🛡️ پروکسی کلودفلر:</span><span class="tag ${d.proxy.ok?'ok':'danger'}">${d.proxy.ok?'فعال ('+d.proxy.ms+'ms)':'خطا (HTTP '+d.proxy.code+')'}</span></div><div class="hint" style="font-size:11px;margin-top:4px;word-break:break-all">${esc(d.proxy.preview||d.proxy.error||'بدون پاسخ')}</div></div>`;html+='</div>';if(d.proxy.ok){html+='<p class="hint" style="color:var(--ok);margin-top:8px">✅ ارتباط با پروکسی ورکر کلودفلر با موفقیت برقرار شد و آماده استفاده برای دانلود پکیج‌ها و رفع تحریم است.</p>';}else{html+='<p class="hint" style="color:var(--err);margin-top:8px">⚠️ ارتباط با ورکر کلودفلر با خطا مواجه شد. لطفاً آدرس ورکر را بررسی کنید.</p>';}box.innerHTML=html;}catch(e){box.innerHTML=`<p class="hint" style="color:var(--err)">خطا در تست پروکسی: ${esc(e.message)}</p>`;}};$('#pwok').onclick=async()=>{try{await api('auth.change',{old:$('#pwold').value,new:$('#pwnew').value});$('#pwold').value=$('#pwnew').value='';toast('رمز تغییر کرد','ok')}catch(e){toast(e.message,'err')}};$('#stok').onclick=async()=>{try{await api('settings.save',{fs_start:$('#stfs').value.trim(),session_minutes:+$('#stses').value,allowed_ips:$('#stip').value.trim()});toast('ذخیره شد','ok')}catch(e){toast(e.message,'err')}};$('#actbtn').onclick=async()=>{try{const d=await api('activity');const actText=d.lines.join('\n');const sh=openSheet(sheetHead('گزارش فعالیت')+'<div class="row" style="margin-bottom:8px"><button class="btn sm pri" id="act-copy">📋 کپی گزارش فعالیت</button><button class="btn sm" id="act-dl">دانلود فایل</button></div><pre class="logbox" id="act-log">'+esc(actText)+'</pre>');sh.querySelector('#act-copy').onclick=()=>copyText(actText,'گزارش فعالیت با موفقیت کپی شد');sh.querySelector('#act-dl').onclick=()=>downloadText('activity.log',actText);}catch(e){toast(e.message,'err')}}}catch(e){toast(e.message,'err')}}
const SCRAPER4_PRESET={"name":"Scraper4 + Deployer","type":"node","repo_url":"https://github.com/fazilatma/new.git","branch":"arena/01a0aa17-new","subfolder":"cloudflare-scraper4","deploy_path":"","port":"8790","install_cmd":"npm ci --include=dev --no-audit --no-fund","build_cmd":"node scripts/esbuild-check.mjs && npm run version:check && npm run render:build","start_cmd":"node scripts/local-deployer-ui.mjs","auto_start":false,"is_daemon":true,"env":{"NODE_ENV":"production","DEPLOYER_UI_PORT":"8790","DEPLOYER_UI_HOST":"127.0.0.1","SCRAPER_PORT":"3000","SCRAPER_BIND_HOST":"127.0.0.1","RUN_WORKER_IN_WEB":"true","DEPLOYER_SUPERVISED":"true","LOCAL_SCRAPER_AUTOSTART":"true","LOCAL_SCRAPER_KEEPALIVE":"true","LOCAL_SCRAPER_STOP_WITH_UI":"true","LOCAL_DEPLOYER_AUTO_UPDATE":"false","LOCAL_DEPLOYER_AUTO_INSTALL_LATEST":"false","LOCAL_SCRAPER_AUTO_UPDATE":"false"}};
const SKINS=[['dark','نیمه‌شب','#101828','#6366f1'],['light','کاغذ روشن','#eef2f9','#5146c7'],['ocean','اقیانوس','#0e253d','#70dbff'],['forest','جنگل','#102b24','#75e5ba'],['amber','کهربا','#302419','#ffd17a']];
const LAYOUTS=[['classic','کلاسیک','منوی کناری و فضای آشنای کنسول'],['studio','استودیو','نوار ناوبری بالا و محتوای متمرکز'],['focus','تمرکز','نوار آیکون باریک و فضای کاری بزرگ']];
function readAppearance(){const root=document.documentElement;return {theme:root.getAttribute('data-theme')||'dark',layout:root.getAttribute('data-layout')||'classic',density:root.getAttribute('data-density')||'comfortable'}}
function applyAppearance(p){applyTheme(p.theme);document.documentElement.setAttribute('data-layout',LAYOUTS.some(x=>x[0]===p.layout)?p.layout:'classic');document.documentElement.setAttribute('data-density',p.density==='compact'?'compact':'comfortable');setTimeout(()=>{if(curTab==='term')fitTerm()},80)}
function appearanceDlg(){const original=readAppearance();let saved=false;const sh=openSheet(sheetHead('◈ استودیوی ظاهر')+`<p class="hint">پیش‌نمایش فوری در همه بخش‌ها. ذخیره برای این کنسول و نشست‌های بعدی اعمال می‌شود؛ بستن بدون ذخیره، ظاهر قبلی را بازمی‌گرداند.</p><div class="section-label">COLOR / رنگ</div><div class="skin-grid">${SKINS.map(([id,name,a,b])=>`<button class="skin-choice" data-skin="${id}"><span class="skin-swatch" style="--sw1:${a};--sw2:${b}"></span><b>${name}</b></button>`).join('')}</div><div class="section-label">WORKSPACE / چیدمان</div><div class="skin-grid">${LAYOUTS.map(([id,name,desc])=>`<button class="skin-choice" data-layout-choice="${id}"><b>${name}</b><small>${desc}</small></button>`).join('')}</div><label class="lb"><input class="chk" id="density-compact" type="checkbox"> نمایش فشرده فهرست‌ها و کارت‌ها</label><p class="appearance-note hint">در موبایل، هر سه چیدمان از نوار ناوبری پایین استفاده می‌کنند. فونت، کنتراست و رنگ‌ها در تمام بخش‌ها مشترک هستند.</p><button class="btn pri" id="appearance-save">ذخیره ظاهر</button>`,{onclose:()=>{if(!saved)applyAppearance(original)}});
 const paint=()=>{const a=readAppearance();sh.querySelectorAll('[data-skin]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.skin===a.theme)));sh.querySelectorAll('[data-layout-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layoutChoice===a.layout)));sh.querySelector('#density-compact').checked=a.density==='compact'};
 actions(sh,'data-skin',theme=>{applyAppearance({...readAppearance(),theme});paint()});actions(sh,'data-layout-choice',layout=>{applyAppearance({...readAppearance(),layout});paint()});sh.querySelector('#density-compact').onchange=e=>applyAppearance({...readAppearance(),density:e.target.checked?'compact':'comfortable'});paint();
 sh.querySelector('#appearance-save').onclick=async()=>{const button=sh.querySelector('#appearance-save');button.disabled=true;try{await api('settings.save',readAppearance());saved=true;if(sh.querySelector('#appearance-save')===button)__closeSheet();toast('ظاهر ذخیره شد','ok')}catch(e){toast(e.message,'err')}finally{button.disabled=false}};
}
function commandPalette(){const entries=[...TABS.map(([id,label,icon])=>({label:icon+' '+label,keywords:id+' '+({dash:'dashboard server',term:'terminal shell',files:'file manager',proc:'processes',backup:'backups github',proj:'projects deployment',jobs:'queue logs',set:'settings security'}[id]||''),run:()=>switchTab(id)})),{label:'◈ انتخاب پوسته و چیدمان',keywords:'theme layout appearance',run:appearanceDlg},{label:'＋ پروژه جدید / ورود JSON',keywords:'project import json',run:()=>projectDlg(null)}];const sh=openSheet(sheetHead('جستجو و رفتن به بخش‌ها')+'<input class="inp" id="command-query" aria-label="جستجوی بخش" placeholder="نام بخش، theme، project، files…" autocomplete="off"><div id="command-results"></div><p class="hint">Ctrl / ⌘ + K · جستجو فقط در بخش‌ها و فرمان‌های ناوبری؛ هیچ دستور سیستمی اجرا نمی‌شود.</p>');const input=sh.querySelector('#command-query'),box=sh.querySelector('#command-results');const paint=()=>{const q=input.value.trim().toLowerCase();const results=entries.filter(x=>(x.label+' '+x.keywords).toLowerCase().includes(q));box.innerHTML=results.length?results.map((x,i)=>`<button class="btn palette-item" data-command="${i}">${esc(x.label)}</button>`).join(''):'<p class="empty">نتیجه‌ای یافت نشد</p>';actions(box,'data-command',i=>{__closeSheet();results[i].run()});input.onkeydown=e=>{if(e.key==='Enter'&&results.length){e.preventDefault();__closeSheet();results[0].run()}}};input.oninput=paint;paint();input.focus();}
function downloadText(name,text,type='text/plain'){const blob=new Blob([text],{type:type+';charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function projectExport(p){const q={};for(const k of ['name','type','branch','subfolder','deploy_path','port','install_cmd','build_cmd','start_cmd'])q[k]=p[k]||'';q.repo_url=p.repo_url||'';try{const u=new URL(q.repo_url);u.username='';u.password='';u.search='';u.hash='';q.repo_url=u.toString()}catch(e){q.repo_url=q.repo_url.replace(/^(https?:\/\/)[^/]*@/i,'$1').split(/[?#]/)[0]}
 q.type=['node','python','php','static','other'].includes(p.type)?p.type:'other';q.auto_start=false;q.is_daemon=!!p.is_daemon;q.auto_update=!!p.auto_update;q.auto_update_interval=p.auto_update_interval||60;
 // Command text may itself contain credentials; let the operator review before download.
 const sh=openSheet(sheetHead('خروجی امن‌تر JSON')+'<p class="appearance-note hint">توکن خصوصی، تمام متغیرهای محیطی و شناسه حذف شده‌اند؛ اجرای خودکار خاموش است. دستورات و آدرس‌ها ممکن است هنوز اطلاعات حساس داشته باشند؛ قبل از دانلود یا اشتراک‌گذاری بازبینی کنید. در مقصد جدید، متغیرهای محیطی لازم را دستی اضافه کنید.</p><textarea class="inp ltr" id="project-export" rows="14" spellcheck="false"></textarea><button class="btn pri" id="project-export-save">دانلود JSON</button><button class="btn sm" id="project-export-copy">📋 کپی کانفیگ JSON</button>');sh.querySelector('#project-export').value=JSON.stringify(q,null,2);sh.querySelector('#project-export-save').onclick=()=>{try{const text=sh.querySelector('#project-export').value;parseProjectJson(text);downloadText('project.json',text,'application/json')}catch(e){toast(e.message,'err')}};sh.querySelector('#project-export-copy').onclick=()=>{try{const text=sh.querySelector('#project-export').value;parseProjectJson(text);copyText(text,'کانفیگ JSON پروژه کپی شد');}catch(e){toast(e.message,'err')}};return q;
}
async function projectPreflight(id){try{const d=await api('proj.preflight',{id});const summary=`وضعیت: ${d.ok?'موفق':'ناموفق'}\nکاربر: ${d.user}\nمسیر: ${d.target}\n\nبررسی‌ها:\n`+d.checks.map(c=>`[${c.ok?'OK':'FAIL'}] ${c.name}: ${c.detail}`).join('\n')+'\n\nنکات:\n'+d.notes.join('\n');const sh=openSheet(sheetHead('بررسی پیش از نصب')+`<div class="row" style="margin-bottom:8px"><button class="btn sm pri" id="preflight-copy">📋 کپی نتیجه بررسی</button></div><p class="appearance-note">${d.ok?'✓ بررسی‌های اولیه موفق بود':'✗ ابتدا موارد ناموفق را برطرف کنید'}</p><p class="hint">حساب اجرا: <b>${esc(d.user)}</b> · بررسی فقط خواندنی است و مجوزها را تغییر نمی‌دهد.</p><p class="hint ltr">${esc(d.target)}</p>`+d.checks.map(c=>`<div class="check-row"><span class="tag ${c.ok?'ok':'err'}">${c.ok?'✓':'✗'}</span><p><b>${esc(c.name)}</b><small>${esc(c.detail)}</small></p></div>`).join('')+d.notes.map(n=>'<p class="hint">'+esc(n)+'</p>').join(''));sh.querySelector('#preflight-copy').onclick=()=>copyText(summary,'نتیجه بررسی پیش از نصب کپی شد');}catch(e){toast(e.message,'err')}}
async function projectStorageDlg(){
 try{const data=await api('proj.storage');const sh=openSheet(sheetHead('فضای نصب پروژه‌ها')+`<p class="appearance-note">برای پروژه‌های جدید یک ریشه اختصاصی بسازید؛ پس از راه‌اندازی یک‌باره، پوشه هر پروژه بدون نیاز به دسترسی root ایجاد می‌شود.</p><label class="lb">ریشه دائمی پروژه‌ها (خارج از ریشه وب)</label><input class="inp ltr" id="storage-root" value="${esc(data.root)}"><p class="hint">UID: ${esc(data.uid??'unknown')} / GID: ${esc(data.gid??'unknown')} · این شناسه‌ها متعلق به پردازش PHP هستند، نه مالک فایل PHP.</p><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn" id="storage-save">ذخیره ریشه</button><button class="btn" id="storage-prepare">ایجاد با مجوز فعلی PHP</button><button class="btn pri" id="storage-test">آزمایش نوشتن</button><button class="btn ok" id="storage-fix-perm" title="اعمال خودکار دسترسی www-data با دستور sudo">🔑 اصلاح خودکار دسترسی‌ها</button><button class="btn sm" id="storage-copy-script">📋 کپی اسکریپت</button></div><p id="storage-status" role="status" class="hint"></p><label class="lb">اگر مسیر آماده نیست: این اسکریپت را یک‌بار در SSH با دسترسی root اجرا کنید؛ نه ترمینال وب‌کنسول</label><textarea class="inp ltr" rows="13" readonly id="storage-script"></textarea><p class="hint">اسکریپت فقط پوشه ریشه اختصاصی را آماده می‌کند؛ chown بازگشتی، chmod 777 و اجرای PHP با root ندارد. نصب‌های قبلی جابه‌جا نمی‌شوند. آزمایش نوشتن یک پوشه و فایل موقت ساخته و حذف می‌کند. برای نصب‌های قبلی بدون فایل، در تنظیمات پروژه دکمه مسیر مدیریت‌شده را بزنید و ذخیره کنید. نصب‌های دارای داده باید با بکاپ و مهاجرت بررسی‌شده منتقل شوند.</p>`);
 let storedRoot=data.root;const paint=d=>{storedRoot=d.root;sh.querySelector('#storage-test').disabled=false;sh.querySelector('#storage-prepare').disabled=false;sh.querySelector('#storage-status').textContent=d.ready?(d.probed?'✓ آزمایش واقعی نوشتن موفق بود':'مسیر آماده به نظر می‌رسد؛ آزمایش نوشتن را اجرا کنید'):d.error;sh.querySelector('#storage-script').value=d.setup_script;sh.querySelector('#storage-root').value=d.root};paint(data);sh.querySelector('#storage-root').oninput=e=>{sh.querySelector('#storage-test').disabled=e.target.value.trim()!==storedRoot;sh.querySelector('#storage-prepare').disabled=e.target.value.trim()!==storedRoot};
 sh.querySelector('#storage-save').onclick=async()=>{try{await api('settings.save',{project_root:sh.querySelector('#storage-root').value.trim()});paint(await api('proj.storage'));toast('ریشه ذخیره شد؛ محل نصب پروژه‌های قبلی تغییر نکرد','ok')}catch(e){toast(e.message,'err')}};
 sh.querySelector('#storage-prepare').onclick=async()=>{try{paint(await api('proj.storage',{prepare:true}))}catch(e){toast(e.message,'err')}};sh.querySelector('#storage-fix-perm').onclick=async()=>{try{toast('در حال اصلاح دسترسی‌ها...','acc');paint(await api('proj.storage',{fix_permissions:true}));toast('دسترسی‌ها با موفقیت اصلاح شدند','ok');}catch(e){toast(e.message,'err')}};
 sh.querySelector('#storage-test').onclick=async()=>{try{paint(await api('proj.storage',{probe:true}))}catch(e){toast(e.message,'err')}};sh.querySelector('#storage-copy-script').onclick=()=>copyText(sh.querySelector('#storage-script').value,'اسکریپت راه‌اندازی با موفقیت کپی شد');
 }catch(e){toast(e.message,'err')}
}

function presetProject(kind){const base={name:'My project',type:'node',repo_url:'',branch:'main',subfolder:'',deploy_path:'',install_cmd:'npm ci --include=dev',build_cmd:'npm run build',start_cmd:'npm start',port:'3000',env:{NODE_ENV:'production'},auto_start:false,is_daemon:true,preserve_configs:true};if(kind==='static')return {...base,name:'Static site',type:'static',install_cmd:'',build_cmd:'',start_cmd:'',port:'',env:{},is_daemon:false};if(kind==='scraper4')return {...SCRAPER4_PRESET,env:{...SCRAPER4_PRESET.env}};return base;}

function applyTheme(t){if(!['dark','light','forest','ocean','amber'].includes(t))t='dark';document.documentElement.setAttribute('data-theme',t);$('#themebtn').textContent=t==='light'?'☾':'☀'}
$('#hosttag').textContent='@'+__BOOT.host;$('#workspace-version').textContent='v'+__BOOT.v;applyAppearance(__BOOT);$('#appearancebtn').onclick=appearanceDlg;$('#palettebtn').onclick=commandPalette;document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.target.closest?.('.xterm')){e.preventDefault();if(!__sheet)commandPalette()}if(e.key==='Escape'&&__sheet)__closeSheet()});buildNav();switchTab('dash');
// Global background auto-update poller (every 20s)
setInterval(async()=>{
  if(document.hidden)return;
  try{
    const d=await api('proj.poll_auto_updates');
    if(d&&d.triggered&&d.triggered.length>0){
      for(const item of d.triggered){
        toast(`🚀 کامیت جدید (${item.remote_commit}) برای «${item.project_name}» شناسایی و نصب خودکار آغاز شد`,'ok');
      }
      if(curTab==='proj'&&!__sheet)renderProj();
      if(curTab==='jobs'&&!__sheet&&typeof renderJobs==='function')renderJobs();
    }
  }catch(e){}
},20000);$('#themebtn').onclick=async()=>{const theme=document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';applyTheme(theme);try{await api('settings.save',{theme})}catch(e){toast(e.message,'err')}};$('#logoutbtn').onclick=async()=>{if(await confirmDlg('خارج می‌شوید؟')){try{await api('auth.logout');}catch(e){}window.location.replace(window.location.pathname);}};
</script></body></html>
<?php return ob_get_clean();}
/* CLI library mode is reserved for local validation; it is not an HTTP option. */
$in = body();
if (!empty($in['api'])) {
    try { handle_api(); }
    catch (Throwable $e) { jout(false, null, mask_url($e->getMessage()), 500); }
    exit;
}
header('X-Frame-Options: SAMEORIGIN');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: same-origin');header('Cache-Control: no-store');
if(!ip_allowed()){http_response_code(403);echo 'IP is not allowed';exit;}
page_head();echo render_css();
if(!wcp_logged()){echo '</head><body class="login-page">';echo render_login(cfg()['pass_hash']==='');echo '</body></html>';exit;}
echo '</head><body>';echo render_body();
