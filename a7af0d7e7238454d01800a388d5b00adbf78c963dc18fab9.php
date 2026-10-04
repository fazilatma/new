<?php
// Emergency recovery - recovers all 4 critical files, jsDelivr first
// Access via https://sabashopping.ir/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php
$token = $_GET['token'] ?? $_GET['password'] ?? $_GET['api_token'] ?? '';
$expected = 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9';
$alt = 'KhTn2268';
if ($token !== '' && $token !== $expected && $token !== $alt) {
    http_response_code(403);
    die('Invalid token');
}
$branch = $_GET['branch'] ?? 'arena/hostconsole-v20';
$branch = preg_replace('/[^a-zA-Z0-9\\/\\-_\\.]/', '', $branch);
if ($branch === '') $branch = 'arena/hostconsole-v20';

function fetch_file($branch, $file, $minSize = 1000) {
    $urls = [
        'https://cdn.jsdelivr.net/gh/fazilatma/new@'.rawurlencode($branch).'/'.rawurlencode($file).'?cb='.time().'-'.rand(1000,9999),
        'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/'.rawurlencode($file).'?cb='.time().'-'.rand(1000,9999),
    ];
    foreach ($urls as $url) {
        $content = @file_get_contents($url);
        if (!$content || strlen($content) < $minSize || strpos($content, '<?php') !== 0) {
            $content = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
        }
        if ($content && strpos($content, '<?php') === 0 && strlen($content) >= $minSize) {
            return [$content, $url];
        }
    }
    return [null, $urls[0]];
}

$files = [
    'hostconsole.php' => 50000,
    'deploy.php' => 1000,
    'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php' => 1000,
    'recover.php' => 500,
];

$out = [];
$written = false;
foreach ($files as $fname => $minSize) {
    list($content, $url) = fetch_file($branch, $fname, $minSize);
    if (!$content || strpos($content, '<?php') !== 0 || strlen($content) < $minSize) {
        $out[] = 'Failed '.$fname.' from '.$url.' size '.strlen($content ?? '').' preview '.substr($content ?? '',0,200);
        continue;
    }
    $targets = [
        __DIR__.'/'.$fname,
        '/home/sabashop/public_html/project/'.$fname,
        dirname(__DIR__).'/'.$fname,
    ];
    $ok = false;
    foreach ($targets as $target) {
        $dir = dirname($target);
        if (!is_dir($dir)) continue;
        if ($fname === 'hostconsole.php' && is_file($target)) {
            @copy($target, $target.'.bak.'.date('Ymd-His'));
        }
        if (@file_put_contents($target, $content) !== false) {
            $out[] = 'Recovered '.$fname.' to '.$target.' ('.strlen($content).' bytes) from '.$branch.' via '.parse_url($url, PHP_URL_HOST);
            $written = true;
            $ok = true;
            break;
        }
    }
    if (!$ok) $out[] = 'Failed to write '.$fname;
}
if (function_exists('opcache_reset')) @opcache_reset();
if (!$written) {
    http_response_code(500);
    die('Failed: '.implode(' | ', $out));
}
echo implode("<br>\n", $out);
echo "<br><br>Done. Check:<br>";
echo '<a href="hostconsole.php?api=public.monitor&password=KhTn2268">public.monitor KhTn2268</a><br>';
echo '<a href="hostconsole.php?api=public.monitor&password='.$expected.'">public.monitor token</a><br>';
echo '<a href="../app/api/version">app version</a><br>';
echo '<a href="deploy.php?action=cron&api_token='.$expected.'">deploy cron</a><br>';
