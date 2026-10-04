<?php
// Simple recover for hostconsole.php - upload to /project/ folder as recover.php and access via browser
// https://sabashopping.ir/project/recover.php?password=KhTn2268
$pw = $_GET['password'] ?? $_POST['password'] ?? '';
if ($pw !== 'KhTn2268') { http_response_code(403); die('Invalid password'); }
$branch = $_GET['branch'] ?? 'arena/01a0aa17-new';
$url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/hostconsole.php';
$content = @file_get_contents($url);
if (!$content) {
    $content = @shell_exec('curl -s -L --max-time 15 '.escapeshellarg($url).' 2>&1');
}
if (!$content || strlen($content) < 10000) die('Download failed: '.strlen($content).' bytes from '.$url);
$target = __DIR__ . '/hostconsole.php';
if (!is_file($target)) $target = __DIR__ . '/../project/hostconsole.php';
if (!is_file($target)) $target = __DIR__ . '/project/hostconsole.php';
if (!is_file(dirname($target))) die('Target dir not found');
@copy($target, $target.'.bak.'.date('Ymd-His'));
if (@file_put_contents($target, $content) === false) die('Write failed to '.$target);
echo 'Recovered hostconsole.php to '.$target.' ('.strlen($content).' bytes) from branch '.$branch;
