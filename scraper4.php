<?php
/**
 * Temporary bootstrap: restores scraper4.php body from last good commit and
 * re-applies the full-width (⛶) header button fix. Safe to replace with the
 * full file once uploaded.
 */
$SRC = 'https://raw.githubusercontent.com/fazilatma/new/2510741c7f23951fbad0daa0d84617ccea3c00a2/scraper4.php';
$cache = sys_get_temp_dir() . '/scraper4_restored_' . md5($SRC) . '.php';
if (!is_file($cache) || filesize($cache) < 1000000) {
    $ctx = stream_context_create([
        'http' => ['timeout' => 180, 'header' => "User-Agent: scraper4-restore\r\n"],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $c = @file_get_contents($SRC, false, $ctx);
    if (!$c || strlen($c) < 1000000) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Restore failed: could not download base scraper4.php\n";
        exit;
    }
    $old_hdr = "<div class=\"hdr-tools\" id=\"hdrTools\">\n<button class=\"hamburger-btn\" id=\"hamburgerBtn\" onclick=\"toggleSettingsPanel()\">☰</button>\n<button class=\"runtime-pulse checking\" id=\"runtimePulse\"";
    $new_hdr = "<div class=\"hdr-tools\" id=\"hdrTools\">\n<button class=\"hamburger-btn\" id=\"hamburgerBtn\" onclick=\"toggleSettingsPanel()\">☰</button>\n<button class=\"fullwidth-btn\" id=\"hdrFullBtn\" type=\"button\" onclick=\"toggleFullSettings()\" title=\"تمام عرض کردن منوی تنظیمات\" aria-label=\"تمام عرض کردن منوی تنظیمات\">⛶</button>\n<button class=\"runtime-pulse checking\" id=\"runtimePulse\"";
    $c = str_replace($old_hdr, $new_hdr, $c, $count1);

    $pairs = [
        [
            "const fb=document.getElementById('fullBtn');\n  if(!p)return;\n  if(p.classList.contains('open')){",
            "const fb=document.getElementById('fullBtn');\n  const hfb=document.getElementById('hdrFullBtn');\n  if(!p)return;\n  if(p.classList.contains('open')){",
        ],
        [
            "if(fb)fb.classList.add('active');\n      }\n    }catch(e){}\n    syncSmenuStickyOffsets();",
            "if(fb)fb.classList.add('active');\n        if(hfb)hfb.classList.add('active');\n      }\n    }catch(e){}\n    syncSmenuStickyOffsets();",
        ],
        [
            "function toggleFullSettings(){\n  const p=document.getElementById('settingsPanel');\n  const b=document.getElementById('fullBtn');\n  if(!p)return;",
            "function toggleFullSettings(){\n  const p=document.getElementById('settingsPanel');\n  const b=document.getElementById('fullBtn');\n  const hfb=document.getElementById('hdrFullBtn');\n  if(!p)return;",
        ],
        [
            "if(b)b.classList.toggle('active', full);\n  document.body.classList.toggle('spanel-full', full && p.classList.contains('open'));",
            "if(b)b.classList.toggle('active', full);\n  if(hfb)hfb.classList.toggle('active', full);\n  document.body.classList.toggle('spanel-full', full && p.classList.contains('open'));",
        ],
        [
            "const b=document.getElementById('fullBtn');\n      if(p)p.classList.add('full');\n      if(b)b.classList.add('active');",
            "const b=document.getElementById('fullBtn');\n      const hfb=document.getElementById('hdrFullBtn');\n      if(p)p.classList.add('full');\n      if(b)b.classList.add('active');\n      if(hfb)hfb.classList.add('active');",
        ],
        [
            '.settings-panel-head{position:sticky;top:0;z-index:6;background:#1e293b;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155}.settings-panel-head h2{margin:0;font-size:16px;color:#e2e8f0}',
            '.settings-panel-head{position:sticky;top:0;z-index:6;background:#1e293b;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #334155;flex-wrap:nowrap}.settings-panel-head h2{margin:0;font-size:16px;color:#e2e8f0;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        ],
        [
            '.settings-panel-actions{display:flex;align-items:center;gap:7px;margin-right:auto}',
            '.settings-panel-actions{display:flex;align-items:center;gap:7px;flex:0 0 auto;margin-inline-start:auto}',
        ],
    ];
    foreach ($pairs as [$a,$b]) {
        $c = str_replace($a, $b, $c);
    }
    @file_put_contents($cache, $c);
    if (is_writable(__FILE__) || (file_exists(__FILE__) && is_writable(dirname(__FILE__)))) {
        @file_put_contents(__FILE__, $c);
    }
} else {
    $c = file_get_contents($cache);
}
if (strpos($c, '<?php') === 0) {
    $c = substr($c, 5);
    if (isset($c[0]) && $c[0] === "\n") $c = substr($c, 1);
}
eval('?>' . $c);
