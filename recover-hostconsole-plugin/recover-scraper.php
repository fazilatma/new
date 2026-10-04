<?php
/**
 * Plugin Name: Recover Scraper
 * Description: Recovers scraper4-cloudflare when 503
 */

add_action('init', function() {
    if (!isset($_GET['recover_scraper']) || $_GET['recover_scraper'] !== 'KhTn2268') return;
    $branch = $_GET['branch'] ?? 'arena/01a0aa17-new';
    $out = [];
    $out[] = 'Starting recover for branch '.$branch;
    
    // Find git repos
    $foundGit = trim(@shell_exec('find /home/sabashop/public_html/project/.wconsole_data -type d -name .git 2>/dev/null | head -n 20'));
    $out[] = 'Found git repos: '.$foundGit;
    
    $lines = explode("\n", $foundGit);
    foreach ($lines as $line) {
        $line = trim($line);
        if (!$line) continue;
        $repo = dirname($line);
        if (is_file($repo.'/cloudflare-scraper4/package.json') || is_file($repo.'/package.json')) {
            $out[] = 'Processing repo: '.$repo;
            $out[] = trim(@shell_exec('cd '.escapeshellarg($repo).' && git fetch origin '.escapeshellarg($branch).' 2>&1 | tail -n 20'));
            $out[] = trim(@shell_exec('cd '.escapeshellarg($repo).' && git reset --hard origin/'.escapeshellarg($branch).' 2>&1 | tail -n 20'));
            $out[] = trim(@shell_exec('cd '.escapeshellarg($repo).' && git rev-parse --short HEAD 2>&1'));
            
            // If repo has cloudflare-scraper4 subfolder, copy to projects
            if (is_file($repo.'/cloudflare-scraper4/package.json')) {
                // Find corresponding project deploy_path
                $id = basename(dirname($repo)); // proj-xxx -> xxx?
                // Try to find project id from path
                if (preg_match('/proj-([a-f0-9]+)/', $repo, $m)) {
                    $id = $m[1];
                    $deploy = '/home/sabashop/public_html/project/.wconsole_data/projects/scraper4-cloudflare-'.$id;
                    if (is_dir($deploy)) {
                        $out[] = 'Copying from '.$repo.'/cloudflare-scraper4 to '.$deploy;
                        $out[] = trim(@shell_exec('cp -r '.escapeshellarg($repo.'/cloudflare-scraper4').'/* '.escapeshellarg($deploy).'/ 2>&1 | head -n 20'));
                    }
                }
            }
        }
    }
    
    // Find scraper root and build
    $scraperRoots = trim(@shell_exec('find /home/sabashop/public_html/project/.wconsole_data/projects -type f -name package.json 2>/dev/null | xargs grep -l scraper4-cloudflare 2>/dev/null | head -n 5'));
    $out[] = 'Scraper roots: '.$scraperRoots;
    $roots = explode("\n", $scraperRoots);
    foreach ($roots as $root) {
        $root = trim($root);
        if (!$root) continue;
        $dir = dirname($root);
        $out[] = 'Building in '.$dir;
        $out[] = trim(@shell_exec('export NVM_DIR=/home/sabashop/.nvm; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh; nvm use 20 2>&1; cd '.escapeshellarg($dir).' && npm install --no-audit --prefer-online 2>&1 | tail -n 20'));
        $out[] = trim(@shell_exec('export NVM_DIR=/home/sabashop/.nvm; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh; nvm use 20 2>&1; cd '.escapeshellarg($dir).' && npm run render:build 2>&1 | tail -n 30'));
        $out[] = trim(@shell_exec('ls -lh '.escapeshellarg($dir.'/render-dist').' 2>&1 | head -n 10'));
    }
    
    $out[] = trim(@shell_exec('curl -s --max-time 10 https://sabashopping.ir/app/api/version 2>&1 | head -n 10'));
    
    echo '<pre>'.htmlspecialchars(implode("\n\n", $out)).'</pre>';
    exit;
});
