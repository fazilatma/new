<?php
// Deploy script for sabashopping.ir/project - recovers hostconsole when 404
// URL: https://sabashopping.ir/project/deploy.php?action=cron&api_token=a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9
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
$branch = $_GET['branch'] ?? 'arena/hostconsole-v20';
$branch = preg_replace('/[^a-zA-Z0-9\\/\\-_\\.]/', '', $branch);
if ($branch === '') $branch = 'arena/hostconsole-v20';

$files = [
    'hostconsole.php' => 'hostconsole.php',
    'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php' => 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php',
    'deploy.php' => 'deploy.php',
    'recover.php' => 'recover.php',
];

$results = [];
$changed = 0;
$skipped = 0;
$failed = 0;

foreach ($files as $src => $dest) {
    $localPath = __DIR__.'/'.$dest;
    $remoteContent = null;
    $usedUrl = '';
    
    // Try jsDelivr first (faster purge), then raw GitHub
    $urls = [
        'https://cdn.jsdelivr.net/gh/fazilatma/new@'.rawurlencode($branch).'/'.rawurlencode($src).'?cb='.time().'-'.rand(1000,9999),
        'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/'.rawurlencode($src).'?cb='.time().'-'.rand(1000,9999),
    ];
    foreach ($urls as $url) {
        $c = @file_get_contents($url);
        if (!$c || strlen($c) < 500 || strpos($c, '<?php') !== 0) {
            $c = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
        }
        if ($c && strpos($c, '<?php') === 0 && strlen($c) >= 500) {
            $remoteContent = $c;
            $usedUrl = $url;
            break;
        }
    }
    
    if (!$remoteContent) {
        $results[] = ['name'=>$src, 'ok'=>false, 'changed'=>false, 'dest'=>$dest, 'message'=>'Download failed from '.implode(' | ', $urls)];
        $failed++;
        continue;
    }
    
    $localExists = is_file($localPath);
    $localContent = $localExists ? @file_get_contents($localPath) : '';
    $localHash = $localExists ? md5($localContent) : '';
    $remoteHash = md5($remoteContent);
    
    $isBroken = false;
    if (!$localExists) $isBroken = true;
    else if (strpos($localContent, '<?php') !== 0) $isBroken = true;
    else if (strlen($localContent) < 1000) $isBroken = true;
    else if (stripos($localContent, 'This is somewhat embarrassing') !== false) $isBroken = true;
    else if (stripos($localContent, 'برگه پیدا نشد') !== false) $isBroken = true;
    
    if (!$isBroken && $localHash === $remoteHash) {
        $results[] = ['name'=>$src, 'ok'=>true, 'changed'=>false, 'dest'=>$dest, 'message'=>'بدون تغییر — فایل روی هاست از قبل به‌روز است ('.strlen($localContent).' bytes)'];
        $skipped++;
        continue;
    }
    
    if ($localExists) {
        @copy($localPath, $localPath.'.bak.'.date('Ymd-His'));
    }
    if (@file_put_contents($localPath, $remoteContent) !== false) {
        $results[] = ['name'=>$src, 'ok'=>true, 'changed'=>true, 'dest'=>$dest, 'message'=>'به‌روز شد از '.$branch.' ('.strlen($remoteContent).' bytes via '.parse_url($usedUrl, PHP_URL_HOST).')'.($isBroken ? ' [بازیابی از خرابی]' : '')];
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
