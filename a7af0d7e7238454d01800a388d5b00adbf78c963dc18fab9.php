<?php
// Emergency recovery for hostconsole.php - access via https://sabashopping.ir/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php?token=a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9&branch=arena/hostconsole-v19
// Or just https://sabashopping.ir/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php
$token = $_GET['token'] ?? $_GET['password'] ?? '';
$expected = 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9';
$alt = 'KhTn2268';
// Allow without token for emergency, but check if provided
if ($token !== '' && $token !== $expected && $token !== $alt) {
    http_response_code(403);
    die('Invalid token');
}
$branch = $_GET['branch'] ?? 'arena/hostconsole-v19';
$branch = preg_replace('/[^a-zA-Z0-9\/\-_\.]/', '', $branch);
if ($branch === '') $branch = 'arena/hostconsole-v19';
$url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/hostconsole.php?cb='.time().'-'.rand(1000,9999);
$content = @file_get_contents($url);
if (!$content || strlen($content) < 50000) {
    $content = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
}
if (!$content || strpos($content, '<?php') !== 0) {
    // Try jsDelivr fallback
    $url2 = 'https://cdn.jsdelivr.net/gh/fazilatma/new@'.rawurlencode($branch).'/hostconsole.php?cb='.time();
    $content2 = @file_get_contents($url2);
    if ($content2 && strpos($content2, '<?php') === 0 && strlen($content2) > 50000) {
        $content = $content2;
        $url = $url2;
    }
}
if (!$content || strpos($content, '<?php') !== 0 || strlen($content) < 50000) {
    http_response_code(500);
    die('Download failed from '.$url.' size '.strlen($content ?? '').' preview '.substr($content ?? '',0,200));
}
$targets = [
    __DIR__.'/hostconsole.php',
    '/home/sabashop/public_html/project/hostconsole.php',
    dirname(__DIR__).'/hostconsole.php',
];
$written = false;
$out = [];
foreach ($targets as $target) {
    $dir = dirname($target);
    if (!is_dir($dir)) continue;
    if (is_file($target)) {
        @copy($target, $target.'.bak.'.date('Ymd-His'));
    }
    if (@file_put_contents($target, $content) !== false) {
        $out[] = 'Recovered to '.$target.' ('.strlen($content).' bytes) from '.$branch;
        $written = true;
    } else {
        $out[] = 'Failed to write to '.$target;
    }
}
if (function_exists('opcache_reset')) @opcache_reset();
if (!$written) {
    http_response_code(500);
    die('Failed to write to any target: '.implode(', ', $targets).' details: '.implode(' | ', $out));
}
echo implode("<br>\n", $out);
echo "<br><br>Done. Check:<br>";
echo '<a href="hostconsole.php?api=public.monitor&password=KhTn2268">public.monitor</a><br>';
echo '<a href="hostconsole.php?api=public.monitor&password='.$expected.'">public.monitor with token</a><br>';
echo '<a href="../app/api/version">app version</a><br>';
