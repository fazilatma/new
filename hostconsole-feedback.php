<?php
// Public feedback endpoint for scraper4 - no auth, for feedback loop
// Access: https://sabashopping.ir/project/hostconsole-feedback.php
// Or: https://sabashopping.ir/project/hostconsole.php?api=public.monitor (if routed)

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$out = ['timestamp' => date('c'), 'version' => '1.281.0+ feedback'];

// Find data dir like hostconsole does
function find_data_dir() {
    $candidates = [
        __DIR__ . '/.wconsole_data',
        __DIR__ . '/wconsole_data',
        __DIR__ . '/project/.wconsole_data',
        __DIR__ . '/../.wconsole_data',
        sys_get_temp_dir() . '/.wconsole_data_' . substr(md5(__DIR__), 0, 8),
    ];
    foreach ($candidates as $d) {
        if (is_dir($d) && is_readable($d)) return $d;
    }
    // Try to find projects.json
    foreach (['/var/lib/webconsole-projects', '/home/*/webconsole-projects', getenv('HOME').'/webconsole-projects'] as $pattern) {
        foreach (glob($pattern) as $p) {
            if (is_dir($p)) {
                // Check parent for .wconsole_data
                $parent = dirname($p);
                if (is_dir($parent.'/.wconsole_data')) return $parent.'/.wconsole_data';
            }
        }
    }
    return __DIR__ . '/.wconsole_data';
}

$dataDir = find_data_dir();
$out['data_dir'] = $dataDir;
$out['data_dir_exists'] = is_dir($dataDir);

$projectsFile = $dataDir . '/projects.json';
if (is_file($projectsFile)) {
    $projects = json_decode(@file_get_contents($projectsFile), true) ?: [];
    $out['projects_count'] = count($projects);
    $target = null;
    foreach ($projects as $pp) {
        if (stripos($pp['name'] ?? '', 'scraper') !== false || stripos($pp['deploy_path'] ?? '', 'scraper') !== false || stripos($pp['repo_url'] ?? '', 'fazilatma/new') !== false) {
            $target = $pp;
            break;
        }
    }
    if (!$target && !empty($projects)) $target = $projects[0];
    $out['target_project'] = $target ? ['name' => $target['name'] ?? '', 'deploy_path' => $target['deploy_path'] ?? '', 'branch' => $target['branch'] ?? '', 'repo_url' => $target['repo_url'] ?? '', 'port' => $target['port'] ?? ''] : null;
    if ($target) {
        $dp = $target['deploy_path'] ?? '';
        $out['deploy_path'] = $dp;
        $out['deploy_exists'] = is_dir($dp);
        if (is_dir($dp)) {
            $out['git_head'] = trim(@shell_exec('cd ' . escapeshellarg($dp) . ' && git rev-parse --short HEAD 2>&1'));
            $out['git_branch'] = trim(@shell_exec('cd ' . escapeshellarg($dp) . ' && git rev-parse --abbrev-ref HEAD 2>&1'));
            $out['git_status'] = trim(@shell_exec('cd ' . escapeshellarg($dp) . ' && git status --porcelain 2>&1 | head -n 20'));
            $out['git_log'] = trim(@shell_exec('cd ' . escapeshellarg($dp) . ' && git log --oneline -5 2>&1'));
            $pkgPath = $dp . '/cloudflare-scraper4/package.json';
            if (is_file($pkgPath)) {
                $pkg = json_decode(@file_get_contents($pkgPath), true);
                $out['scraper_version'] = $pkg['version'] ?? 'unknown';
            }
            $visualPath = $dp . '/cloudflare-scraper4/render-src/visual.ts';
            if (is_file($visualPath)) {
                $code = @file_get_contents($visualPath);
                $out['visual_full_mode'] = (strpos($code, 'fullModeJsNode') !== false) ? 'yes' : 'no';
                $out['visual_has_proxy'] = (strpos($code, 'toProxy') !== false) ? 'yes' : 'no';
                $out['visual_has_rp'] = (strpos($code, '/api/rp') !== false) ? 'yes' : 'no';
                $out['visual_has_base'] = (strpos($code, '<base') !== false || strpos($code, 'base href') !== false) ? 'yes' : 'no';
                $out['visual_has_data_attrs'] = (strpos($code, 'data-src') !== false) ? 'yes' : 'no';
            }
            $serverPath = $dp . '/cloudflare-scraper4/render-src/server.ts';
            if (is_file($serverPath)) {
                $code = @file_get_contents($serverPath);
                $out['server_has_rp'] = (strpos($code, "'/api/rp'") !== false || strpos($code, '"/api/rp"') !== false) ? 'yes' : 'no';
            }
        }
        // Check jobs
        $jobsDir = $dataDir . '/jobs';
        if (is_dir($jobsDir)) {
            $jobs = [];
            foreach (glob($jobsDir.'/*.json') as $jf) {
                $j = json_decode(@file_get_contents($jf), true);
                if (($j['type'] ?? '') === 'service' && ($j['params']['project_id'] ?? '') === ($target['id'] ?? '')) {
                    $jobs[] = ['id' => $j['id'], 'created' => $j['created'] ?? '', 'pid' => $j['pid'] ?? 0];
                }
            }
            $out['service_jobs'] = $jobs;
        }
    }
}

// Check local APIs (bypass 503 if possible via direct port)
foreach (['8790','3000'] as $port) {
    $out['local_'.$port.'_version'] = trim(@shell_exec('curl -s --max-time 3 http://127.0.0.1:'.$port.'/api/version 2>&1 | head -c 1000'));
    $out['local_'.$port.'_feedback'] = trim(@shell_exec('curl -s --max-time 3 http://127.0.0.1:'.$port.'/api/light-feedback 2>&1 | head -c 1000'));
    $out['local_'.$port.'_rp'] = trim(@shell_exec('curl -s --max-time 3 "http://127.0.0.1:'.$port.'/api/rp?url=https://example.com" 2>&1 | head -c 500'));
}

// Public API via curl
$out['public_version'] = trim(@shell_exec('curl -s --max-time 5 https://sabashopping.ir/app/api/version 2>&1 | head -c 1000'));
$out['public_feedback'] = trim(@shell_exec('curl -s --max-time 5 https://sabashopping.ir/app/api/light-feedback 2>&1 | head -c 1000'));
$out['public_rp'] = trim(@shell_exec('curl -s --max-time 5 "https://sabashopping.ir/app/api/rp?url=https://example.com" 2>&1 | head -c 500'));

// Emalls check
$emallsUrl = 'https://emalls.ir/%D9%84%DB%8C%D8%B3%D8%AA-%D9%82%DB%8C%D9%85%D8%AA_%DA%A9%D9%81%D8%B4-%D8%B2%D9%86%D8%A7%D9%86%D9%87~Category~13145';
$emalls = @shell_exec('curl -s -L --max-time 10 -A "Mozilla/5.0" '.escapeshellarg($emallsUrl).' 2>&1 | wc -c');
$out['emalls_bytes'] = trim($emalls);

// Fonts check - check if fonts are loaded in scraper
$out['fonts_check'] = [];
$fontFiles = glob(__DIR__.'/cloudflare-scraper4/render-src/fonts/*') ?: [];
$out['fonts_check']['render_src_fonts'] = count($fontFiles);
$out['fonts_check']['font_files'] = array_map('basename', array_slice($fontFiles, 0, 10));

// Check dashboard for font references
$dashboardPath = __DIR__.'/cloudflare-scraper4/worker-src/dashboard.ts';
if (is_file($dashboardPath)) {
    $dash = @file_get_contents($dashboardPath);
    $out['fonts_check']['dashboard_has_font'] = strpos($dash, 'font') !== false ? 'yes' : 'no';
    $out['fonts_check']['dashboard_font_refs'] = substr_count(strtolower($dash), 'font');
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
