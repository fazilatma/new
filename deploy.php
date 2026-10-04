<?php
// Deploy script for sabashopping.ir/project - recovers hostconsole when 404
// URL: https://sabashopping.ir/project/deploy.php?action=cron&api_token=a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9
// Also accepts ?action=deploy&api_token=... or ?api_token=...&branch=arena/hostconsole-v19

$token = $_GET['api_token'] ?? $_GET['token'] ?? $_GET['password'] ?? '';
$expected = 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9';
$alt = 'KhTn2268';
if ($token !== $expected && $token !== $alt) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok'=>false,'error'=>'Invalid api_token'], JSON_UNESCAPED_UNICODE);
    exit;
}

$action = $_GET['action'] ?? 'cron';
$branch = $_GET['branch'] ?? 'arena/hostconsole-v19';
$branch = preg_replace('/[^a-zA-Z0-9\/\-_\.]/', '', $branch);
if ($branch === '') $branch = 'arena/hostconsole-v19';

// Files to deploy - from repo root to project folder
$files = [
    'hostconsole.php' => 'hostconsole.php',
    'webconsole.php' => 'webconsole.php',
    'scraper4.php' => 'scraper4.php',
    'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php' => 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php',
    'deploy.php' => 'deploy.php',
    'recover.php' => 'recover.php',
];

$results = [];
$changed = 0;
$skipped = 0;
$failed = 0;

foreach ($files as $src => $dest) {
    $url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/'.rawurlencode($src).'?cb='.time().'-'.rand(1000,9999);
    $localPath = __DIR__.'/'.$dest;
    
    $remoteContent = @file_get_contents($url);
    if (!$remoteContent || strlen($remoteContent) < 1000) {
        $remoteContent = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
    }
    // Try jsDelivr fallback
    if (!$remoteContent || strlen($remoteContent) < 1000 || strpos($remoteContent, '<?php') !== 0) {
        $url2 = 'https://cdn.jsdelivr.net/gh/fazilatma/new@'.rawurlencode($branch).'/'.rawurlencode($src).'?cb='.time();
        $c2 = @file_get_contents($url2);
        if ($c2 && strpos($c2, '<?php') === 0 && strlen($c2) > 1000) {
            $remoteContent = $c2;
            $url = $url2;
        }
    }
    
    if (!$remoteContent) {
        $results[] = ['name'=>$src, 'ok'=>false, 'changed'=>false, 'dest'=>$dest, 'message'=>'Download failed from '.$url];
        $failed++;
        continue;
    }
    
    // Check if remote is valid PHP
    if (strpos($remoteContent, '<?php') !== 0) {
        $results[] = ['name'=>$src, 'ok'=>false, 'changed'=>false, 'dest'=>$dest, 'message'=>'Invalid PHP content from '.$url.' size '.strlen($remoteContent)];
        $failed++;
        continue;
    }
    
    $localExists = is_file($localPath);
    $localContent = $localExists ? @file_get_contents($localPath) : '';
    $localHash = $localExists ? md5($localContent) : '';
    $remoteHash = md5($remoteContent);
    
    // Consider broken if file doesn't start with <?php or is too small or is WordPress 404 HTML
    $isBroken = false;
    if (!$localExists) $isBroken = true;
    else if (strpos($localContent, '<?php') !== 0) $isBroken = true;
    else if (strlen($localContent) < 1000) $isBroken = true;
    else if (stripos($localContent, 'This is somewhat embarrassing') !== false) $isBroken = true; // WordPress 404 page
    else if (stripos($localContent, 'برگه پیدا نشد') !== false) $isBroken = true;
    
    if (!$isBroken && $localHash === $remoteHash) {
        $results[] = ['name'=>$src, 'ok'=>true, 'changed'=>false, 'dest'=>$dest, 'message'=>'بدون تغییر — فایل روی هاست از قبل به‌روز است'];
        $skipped++;
        continue;
    }
    
    // Backup and write
    if ($localExists) {
        @copy($localPath, $localPath.'.bak.'.date('Ymd-His'));
    }
    if (@file_put_contents($localPath, $remoteContent) !== false) {
        $results[] = ['name'=>$src, 'ok'=>true, 'changed'=>true, 'dest'=>$dest, 'message'=>'به‌روز شد از '.$branch.' ('.strlen($remoteContent).' bytes)'.($isBroken ? ' [بازیابی از خرابی]' : '')];
        $changed++;
    } else {
        $results[] = ['name'=>$src, 'ok'=>false, 'changed'=>false, 'dest'=>$dest, 'message'=>'Write failed to '.$localPath];
        $failed++;
    }
}

if (function_exists('opcache_reset')) @opcache_reset();

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ok'=>true,
    'action'=>$action,
    'branch'=>$branch,
    'results'=>$results,
    'total'=>count($results),
    'changed'=>$changed,
    'skipped'=>$skipped,
    'failed'=>$failed,
    'message'=>$changed > 0 ? 'بازیابی انجام شد' : 'بدون تغییر',
    'check'=>[
        'hostconsole'=>'/project/hostconsole.php?api=public.monitor&password='.$expected,
        'app_version'=>'/app/api/version',
        'fonts'=>'/app/assets/fonts/vazirmatn.css',
    ]
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
