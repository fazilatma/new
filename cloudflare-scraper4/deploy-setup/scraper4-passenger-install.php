<?php
/*
 * Scraper4 Passenger host installer
 * =================================
 * Version: 1.0.0
 *
 * WHAT THIS DOES
 * --------------
 * This single PHP file runs on shared hosting and deploys a prebuilt
 * Scraper4 Passenger package into the Node application folder (default:
 * a `scraper4` folder OUTSIDE `public_html`). It:
 *
 *   1. Accepts a package from a local ZIP path, HTTPS URL, or browser upload.
 *   2. Verifies size and optional SHA-256 checksum.
 *   3. Inspects the ZIP for traversal entries, symlinks, bombs, and unexpected files.
 *   4. Extracts only an allowlist into staging:
 *        app.js
 *        package.json
 *        render-dist/
 *        scripts/basalam-sdk-bridge.py
 *        migrations/ (optional)
 *   5. Validates required Passenger files and the slim package.json.
 *   6. Backs up the current deploy files (never data/ or node_modules/).
 *   7. Syncs staging into the app folder while preserving:
 *        data/, node_modules/, tmp/, logs, backups, and unknown files.
 *   8. Creates data/ and tmp/restart.txt, fixes safe permissions.
 *   9. Prints exact cPanel follow-up steps and environment values.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does NOT create the cPanel Node.js app, set Node environment variables,
 * run NPM Install, install Python packages, or reliably restart Passenger.
 * Those remain one-time cPanel UI steps. After a successful file deploy, use
 * Setup Node.js App -> Run NPM Install (first install) -> Restart.
 *
 * HOW TO USE
 * ----------
 * 1. On Termux/localhost, build once:
 *      npm install --ignore-scripts --no-audit --prefer-online
 *      npm run render:build
 *    Then create scraper4-passenger.zip containing:
 *      app.js, package.json, render-dist/, scripts/basalam-sdk-bridge.py
 * 2. Edit INSTALLER TOKEN below to a long random value.
 * 3. Upload ONLY this PHP file to the host, preferably as an unpredictable
 *    public_html filename, for example:
 *      public_html/scraper4-install-9f3k2d8q.php
 * 4. Open it over HTTPS, enter the token, choose dry-run first, then install.
 * 5. Finish in Setup Node.js App, verify /health, then DELETE this installer.
 *
 * CLI (cPanel Terminal, optional):
 *   php scraper4-passenger-install.php --status --token=TOKEN
 *   php scraper4-passenger-install.php --source=local --file=/path/scraper4-passenger.zip \
 *     --sha256=... --dry-run --token=TOKEN
 *   php scraper4-passenger-install.php --source=local --file=/path/scraper4-passenger.zip \
 *     --sha256=... --yes --token=TOKEN
 *
 * SECURITY
 * --------
 * - The script refuses to run until INSTALLER TOKEN is changed.
 * - The app folder must stay OUTSIDE public_html.
 * - ZIP paths are normalized and allowlisted; .., absolute paths, drive
 *   letters, symlinks, bombs, and unexpected files are rejected.
 * - Existing data/ and node_modules/ are never deleted or overwritten.
 * - Delete this file immediately after a successful install.
 */

declare(strict_types=1);

/* ------------------------------- configuration ------------------------------- */

const SCRAPER4_INSTALLER_VERSION = '1.0.0';
const SCRAPER4_APP_DIRNAME = 'scraper4';

/* REQUIRED: change this before uploading. The installer refuses to run otherwise. */
const SCRAPER4_INSTALLER_TOKEN = 'CHANGE-THIS-TO-A-LONG-RANDOM-TOKEN';

/* Optional absolute override, for example: /home/someuser/scraper4
 * Leave empty for auto-detection. Web requests can never override this. */
const SCRAPER4_APP_ROOT_OVERRIDE = '';

const SCRAPER4_MAX_PACKAGE_BYTES = 268435456; /* 256 MB */
const SCRAPER4_MAX_ZIP_ENTRIES = 5000;
const SCRAPER4_MAX_UNCOMPRESSED_BYTES = 1073741824; /* 1 GB */
const SCRAPER4_MAX_BACKUPS = 5;
const SCRAPER4_HOLD_PREFIX = 's4passenger-';

/* --------------------------------- utilities --------------------------------- */

function s4i_is_cli()
{
    return PHP_SAPI === 'cli';
}

function s4i_starts_with($haystack, $needle)
{
    $haystack = (string) $haystack;
    $needle = (string) $needle;
    return $needle !== '' && strncmp($haystack, $needle, strlen($needle)) === 0;
}

function s4i_ends_with($haystack, $needle)
{
    $haystack = (string) $haystack;
    $needle = (string) $needle;
    if ($needle === '') {
        return false;
    }
    return substr($haystack, -strlen($needle)) === $needle;
}

function s4i_contains($haystack, $needle)
{
    return strpos((string) $haystack, (string) $needle) !== false;
}

function s4i_h($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function s4i_format_bytes($bytes)
{
    $bytes = (float) $bytes;
    if ($bytes < 1024) {
        return (string) ((int) $bytes) . ' B';
    }
    $units = array('KB', 'MB', 'GB', 'TB');
    $value = $bytes / 1024;
    foreach ($units as $unit) {
        if ($value < 1024 || $unit === 'TB') {
            return number_format($value, 1) . ' ' . $unit;
        }
        $value = $value / 1024;
    }
    return (string) ((int) $bytes) . ' B';
}

function s4i_result($ok, $message = '', $data = array())
{
    return array('ok' => (bool) $ok, 'message' => (string) $message, 'data' => $data);
}

function s4i_token_configured()
{
    $token = (string) SCRAPER4_INSTALLER_TOKEN;
    return $token !== '' && $token !== 'CHANGE-THIS-TO-A-LONG-RANDOM-TOKEN' && strlen($token) >= 24;
}

function s4i_auth_ok($provided)
{
    if (!s4i_token_configured()) {
        return false;
    }
    $provided = (string) $provided;
    if ($provided === '') {
        return false;
    }
    return hash_equals((string) SCRAPER4_INSTALLER_TOKEN, $provided);
}

/* ------------------------------- path handling ------------------------------- */

function s4i_join_path($base, $rel)
{
    return rtrim((string) $base, '/') . '/' . ltrim((string) $rel, '/');
}

/* Normalize a ZIP relative path. Returns false for dangerous values. */
function s4i_normalize_rel_path($name)
{
    $name = (string) $name;
    if ($name === '' || strpos($name, "\0") !== false) {
        return false;
    }
    $name = str_replace('\\', '/', $name);
    $name = ltrim(trim($name), '/');
    if ($name === '' || $name === '.' || s4i_starts_with($name, './')) {
        $name = ltrim(substr($name, 1), '/');
        if ($name === '' || $name === '.') {
            return false;
        }
    }
    if (preg_match('/^[A-Za-z]:(\/|$)/', $name)) {
        return false;
    }
    $parts = explode('/', $name);
    $clean = array();
    foreach ($parts as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            return false;
        }
        $clean[] = $part;
    }
    if (count($clean) === 0) {
        return false;
    }
    return implode('/', $clean);
}

function s4i_is_ignored_entry($rel)
{
    if (s4i_starts_with($rel, '__MACOSX/')) {
        return true;
    }
    $base = basename($rel);
    return $base === '.DS_Store' || $base === 'Thumbs.db';
}

function s4i_is_allowed_rel($rel)
{
    if ($rel === 'app.js' || $rel === 'package.json' || $rel === 'scripts/basalam-sdk-bridge.py') {
        return true;
    }
    if (s4i_starts_with($rel, 'render-dist/') || s4i_starts_with($rel, 'migrations/')) {
        return true;
    }
    return false;
}

function s4i_required_rel_files()
{
    return array(
        'app.js',
        'package.json',
        'render-dist/server.js',
        'render-dist/cron.js',
        'scripts/basalam-sdk-bridge.py',
    );
}

function s4i_tracked_paths()
{
    return array(
        'app.js',
        'package.json',
        'render-dist',
        'scripts/basalam-sdk-bridge.py',
        'migrations',
    );
}

function s4i_path_inside_public_html($path)
{
    $normalized = str_replace('\\', '/', (string) $path);
    if (s4i_ends_with($normalized, '/public_html') || s4i_ends_with($normalized, '/public_html/')) {
        return true;
    }
    return s4i_contains($normalized, '/public_html/');
}

function s4i_resolve_app_root($cliOverride = '')
{
    $override = trim((string) SCRAPER4_APP_ROOT_OVERRIDE);
    if ($override !== '') {
        return $override;
    }
    if (s4i_is_cli()) {
        $cliOverride = trim((string) $cliOverride);
        if ($cliOverride === '') {
            $cliOverride = trim((string) getenv('SCRAPER4_INSTALL_APP_ROOT'));
        }
        if ($cliOverride !== '') {
            return $cliOverride;
        }
    }
    $home = trim((string) getenv('HOME'));
    if ($home !== '') {
        $candidate = rtrim($home, '/') . '/' . SCRAPER4_APP_DIRNAME;
        if (is_dir($candidate)) {
            return $candidate;
        }
    }
    $here = __DIR__;
    if (basename($here) === 'public_html') {
        return dirname($here) . '/' . SCRAPER4_APP_DIRNAME;
    }
    if ($home !== '') {
        return rtrim($home, '/') . '/' . SCRAPER4_APP_DIRNAME;
    }
    return $here . '/' . SCRAPER4_APP_DIRNAME;
}

function s4i_allowed_local_bases($appRoot)
{
    $bases = array(__DIR__, dirname(__DIR__));
    $home = trim((string) getenv('HOME'));
    if ($home !== '') {
        $bases[] = $home;
    }
    if (is_string($appRoot) && $appRoot !== '') {
        $bases[] = $appRoot;
        $bases[] = dirname(rtrim($appRoot, '/'));
    }
    $real = array();
    foreach ($bases as $base) {
        if (!is_string($base) || $base === '') {
            continue;
        }
        $resolved = realpath($base);
        if ($resolved !== false) {
            $real[] = rtrim(str_replace('\\', '/', $resolved), '/') . '/';
        }
    }
    return array_values(array_unique($real));
}

function s4i_validate_local_package_path($path, $appRoot)
{
    if (!is_string($path) || trim($path) === '') {
        return s4i_result(false, 'Local package path is empty.');
    }
    $real = realpath($path);
    if ($real === false || !is_file($real)) {
        return s4i_result(false, 'Local package file was not found.');
    }
    $normalized = str_replace('\\', '/', $real);
    foreach (s4i_allowed_local_bases($appRoot) as $base) {
        if (s4i_starts_with($normalized, $base)) {
            return s4i_result(true, '', array('path' => $real));
        }
    }
    return s4i_result(false, 'Local package must be inside the installer folder, home folder, or app folder.');
}

/* -------------------------------- filesystem --------------------------------- */

function s4i_mkdir($path, $mode = 0755)
{
    if (is_dir($path)) {
        return true;
    }
    if (!mkdir($path, $mode, true) && !is_dir($path)) {
        return false;
    }
    @chmod($path, $mode);
    return true;
}

function s4i_safe_target($baseReal, $base, $rel)
{
    $rel = (string) $rel;
    if ($rel === '' || strpos($rel, "\0") !== false) {
        return false;
    }
    $target = s4i_join_path($base, $rel);
    $parent = dirname($target);
    if (!s4i_mkdir($parent, 0755)) {
        return false;
    }
    $realParent = realpath($parent);
    if ($realParent === false) {
        return false;
    }
    $realParent = rtrim(str_replace('\\', '/', $realParent), '/') . '/';
    $wanted = rtrim(str_replace('\\', '/', $baseReal), '/') . '/';
    if (!s4i_starts_with($realParent, $wanted)) {
        return false;
    }
    return $target;
}

function s4i_delete_path($path)
{
    if (is_link($path)) {
        @unlink($path);
        return;
    }
    if (is_file($path)) {
        @unlink($path);
        return;
    }
    if (!is_dir($path)) {
        return;
    }
    $handle = opendir($path);
    if ($handle === false) {
        return;
    }
    while (($entry = readdir($handle)) !== false) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        s4i_delete_path($path . DIRECTORY_SEPARATOR . $entry);
    }
    closedir($handle);
    @rmdir($path);
}

function s4i_copy_path($source, $dest, &$warnings, $label = '')
{
    if (is_link($source)) {
        $warnings[] = 'Skipped symlink: ' . ($label !== '' ? $label : $source);
        return true;
    }
    if (is_file($source)) {
        $parent = dirname($dest);
        if (!s4i_mkdir($parent, 0755)) {
            return false;
        }
        if (!copy($source, $dest)) {
            return false;
        }
        @chmod($dest, 0644);
        return true;
    }
    if (!is_dir($source)) {
        return true;
    }
    if (!s4i_mkdir($dest, 0755)) {
        return false;
    }
    $handle = opendir($source);
    if ($handle === false) {
        return false;
    }
    while (($entry = readdir($handle)) !== false) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $childLabel = ($label !== '' ? $label . '/' : '') . $entry;
        if (!s4i_copy_path($source . DIRECTORY_SEPARATOR . $entry, $dest . DIRECTORY_SEPARATOR . $entry, $warnings, $childLabel)) {
            closedir($handle);
            return false;
        }
    }
    closedir($handle);
    return true;
}

function s4i_write_atomic($path, $contents, $mode = 0644)
{
    $dir = dirname($path);
    if (!s4i_mkdir($dir, 0755)) {
        return false;
    }
    $tmp = tempnam($dir, 's4tmp');
    if ($tmp === false) {
        return false;
    }
    if (file_put_contents($tmp, $contents) === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, $mode);
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function s4i_backup_dir($appRoot)
{
    return s4i_join_path($appRoot, '_installer_backups');
}

function s4i_append_log($appRoot, $message)
{
    if (!is_string($appRoot) || $appRoot === '' || s4i_path_inside_public_html($appRoot)) {
        return;
    }
    $dir = s4i_backup_dir($appRoot);
    if (!s4i_mkdir($dir, 0755)) {
        return;
    }
    $line = '[' . date('Y-m-d H:i:s') . '] ' . (string) $message . "\n";
    @file_put_contents($dir . '/install.log', $line, FILE_APPEND);
}

function s4i_rotate_backups($appRoot)
{
    $dir = s4i_backup_dir($appRoot);
    if (!is_dir($dir)) {
        return;
    }
    $handle = opendir($dir);
    if ($handle === false) {
        return;
    }
    $found = array();
    while (($entry = readdir($handle)) !== false) {
        if (preg_match('/^\d{8}-\d{6}$/', $entry) && is_dir($dir . '/' . $entry)) {
            $found[] = $entry;
        }
    }
    closedir($handle);
    sort($found);
    while (count($found) > SCRAPER4_MAX_BACKUPS) {
        $oldest = array_shift($found);
        s4i_delete_path($dir . '/' . $oldest);
    }
}

/* ------------------------------ requirements --------------------------------- */

function s4i_check_requirements($appRoot)
{
    $checks = array();
    $checks[] = array(
        'label' => 'PHP 7.4 or newer',
        'ok' => PHP_VERSION_ID >= 70400,
        'detail' => 'Detected PHP ' . PHP_VERSION,
    );
    $checks[] = array(
        'label' => 'ZipArchive available',
        'ok' => class_exists('ZipArchive'),
        'detail' => class_exists('ZipArchive') ? 'Available.' : 'Enable the PHP ZIP extension.',
    );
    $hasCurl = function_exists('curl_init');
    $hasFopen = (bool) ini_get('allow_url_fopen');
    $checks[] = array(
        'label' => 'Download transport for URL packages',
        'ok' => $hasCurl || $hasFopen,
        'detail' => $hasCurl ? 'cURL is available.' : ($hasFopen ? 'URL fopen wrappers are available.' : 'Neither cURL nor allow_url_fopen is available; use local-path or upload mode.'),
    );
    $checks[] = array(
        'label' => 'JSON support',
        'ok' => function_exists('json_decode') && function_exists('json_encode'),
        'detail' => 'Required to validate package.json.',
    );
    $appRootOk = is_string($appRoot) && $appRoot !== '';
    $insideWeb = $appRootOk && s4i_path_inside_public_html($appRoot);
    $checks[] = array(
        'label' => 'App folder is outside public_html',
        'ok' => $appRootOk && !$insideWeb,
        'detail' => $appRootOk ? $appRoot : 'App folder could not be resolved.',
    );
    $parent = $appRootOk ? dirname(rtrim($appRoot, '/')) : '';
    $writable = $appRootOk && (is_dir($appRoot) ? is_writable($appRoot) : ($parent !== '' && is_writable($parent)));
    $checks[] = array(
        'label' => 'App folder is writable or creatable',
        'ok' => $writable,
        'detail' => $writable ? 'OK.' : 'Fix ownership/permissions for: ' . $appRoot,
    );
    $free = ($appRootOk && is_dir($appRoot)) ? @disk_free_space($appRoot) : @disk_free_space(__DIR__);
    $checks[] = array(
        'label' => 'Free disk space',
        'ok' => $free === false || $free > 268435456,
        'detail' => $free === false ? 'Unknown.' : s4i_format_bytes($free) . ' free.',
    );
    return $checks;
}

function s4i_checks_pass($checks, $requireDownload = false)
{
    foreach ($checks as $check) {
        if (!$check['ok']) {
            if ($check['label'] === 'Download transport for URL packages' && !$requireDownload) {
                continue;
            }
            return false;
        }
    }
    return true;
}

/* ------------------------------- package input ------------------------------- */

function s4i_new_temp_file($prefix)
{
    $tmp = tempnam(sys_get_temp_dir(), $prefix);
    if ($tmp === false) {
        return false;
    }
    return $tmp;
}

function s4i_validate_package_url($url)
{
    $url = trim((string) $url);
    if ($url === '') {
        return s4i_result(false, 'Package URL is empty.');
    }
    if (filter_var($url, FILTER_VALIDATE_URL) === false) {
        return s4i_result(false, 'Package URL is invalid.');
    }
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return s4i_result(false, 'Package URL is invalid.');
    }
    $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
    if ($scheme !== 'http' && $scheme !== 'https') {
        return s4i_result(false, 'Only http:// and https:// package URLs are allowed.');
    }
    if (isset($parts['user']) || isset($parts['pass'])) {
        return s4i_result(false, 'Package URLs with embedded credentials are not allowed.');
    }
    if (!isset($parts['host']) || $parts['host'] === '') {
        return s4i_result(false, 'Package URL host is missing.');
    }
    if ($scheme === 'http') {
        return s4i_result(true, 'HTTP downloads are not encrypted; prefer HTTPS.', array('url' => $url, 'insecure' => true));
    }
    return s4i_result(true, '', array('url' => $url, 'insecure' => false));
}

function s4i_download_with_curl($url, $dest)
{
    $handle = curl_init($url);
    if ($handle === false) {
        return s4i_result(false, 'Could not start the download.');
    }
    $out = fopen($dest, 'wb');
    if ($out === false) {
        curl_close($handle);
        return s4i_result(false, 'Could not write the temporary package file.');
    }
    curl_setopt($handle, CURLOPT_FILE, $out);
    curl_setopt($handle, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($handle, CURLOPT_MAXREDIRS, 3);
    curl_setopt($handle, CURLOPT_CONNECTTIMEOUT, 20);
    curl_setopt($handle, CURLOPT_TIMEOUT, 300);
    curl_setopt($handle, CURLOPT_USERAGENT, 'scraper4-passenger-installer/' . SCRAPER4_INSTALLER_VERSION);
    curl_setopt($handle, CURLOPT_FAILONERROR, true);
    $ok = curl_exec($handle);
    $error = curl_error($handle);
    $code = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    fclose($out);
    if ($ok === false) {
        return s4i_result(false, 'Download failed: ' . ($error !== '' ? $error : 'HTTP ' . $code));
    }
    if ($code >= 400) {
        return s4i_result(false, 'Download failed with HTTP ' . $code . '.');
    }
    return s4i_result(true);
}

function s4i_download_with_fopen($url, $dest)
{
    $context = stream_context_create(array(
        'http' => array(
            'method' => 'GET',
            'timeout' => 300,
            'max_redirects' => 3,
            'header' => "User-Agent: scraper4-passenger-installer/" . SCRAPER4_INSTALLER_VERSION . "\r\n",
        ),
    ));
    $in = @fopen($url, 'rb', false, $context);
    if ($in === false) {
        return s4i_result(false, 'Download failed; the host may block outbound HTTP.');
    }
    $out = fopen($dest, 'wb');
    if ($out === false) {
        fclose($in);
        return s4i_result(false, 'Could not write the temporary package file.');
    }
    $bytes = stream_copy_to_stream($in, $out);
    fclose($in);
    fclose($out);
    if ($bytes === false) {
        return s4i_result(false, 'Download was interrupted.');
    }
    return s4i_result(true);
}

function s4i_download_package($url, $dest)
{
    if (function_exists('curl_init')) {
        $result = s4i_download_with_curl($url, $dest);
    } elseif ((bool) ini_get('allow_url_fopen')) {
        $result = s4i_download_with_fopen($url, $dest);
    } else {
        return s4i_result(false, 'No download transport is available.');
    }
    if (!$result['ok']) {
        return $result;
    }
    $size = filesize($dest);
    if ($size === false || $size <= 0) {
        return s4i_result(false, 'Downloaded package is empty.');
    }
    if ($size > SCRAPER4_MAX_PACKAGE_BYTES) {
        return s4i_result(false, 'Downloaded package exceeds ' . s4i_format_bytes(SCRAPER4_MAX_PACKAGE_BYTES) . '.');
    }
    return s4i_result(true, '', array('bytes' => $size));
}

function s4i_verify_sha256($path, $expected)
{
    $expected = strtolower(trim((string) $expected));
    if ($expected === '') {
        return s4i_result(true, '', array('verified' => false));
    }
    if (!preg_match('/^[0-9a-f]{64}$/', $expected)) {
        return s4i_result(false, 'SHA-256 must be 64 lowercase hex characters.');
    }
    $actual = hash_file('sha256', $path);
    if ($actual === false) {
        return s4i_result(false, 'Could not hash the package.');
    }
    if (!hash_equals($expected, strtolower($actual))) {
        return s4i_result(false, 'SHA-256 mismatch. Expected ' . $expected . ', got ' . strtolower($actual) . '.');
    }
    return s4i_result(true, '', array('verified' => true, 'sha256' => strtolower($actual)));
}

/* -------------------------------- ZIP safety --------------------------------- */

function s4i_zip_entry_is_symlink($stat)
{
    if (!is_array($stat) || !isset($stat['external_attributes'])) {
        return false;
    }
    $mode = ((int) $stat['external_attributes'] >> 16) & 0170000;
    return $mode === 0120000;
}

function s4i_detect_wrapper_prefix($files)
{
    /* If every file shares one top-level folder and no required root file is
     * present, treat that folder as packaging wrapper and strip it. */
    $roots = array();
    foreach ($files as $rel) {
        $slash = strpos($rel, '/');
        if ($slash === false) {
            return '';
        }
        $roots[substr($rel, 0, $slash)] = true;
    }
    if (count($roots) !== 1) {
        return '';
    }
    $names = array_keys($roots);
    $prefix = $names[0] . '/';
    foreach (s4i_required_rel_files() as $required) {
        if (in_array($required, $files, true)) {
            return '';
        }
    }
    return $prefix;
}

function s4i_inspect_zip($zipPath)
{
    if (!class_exists('ZipArchive')) {
        return s4i_result(false, 'PHP ZIP extension is unavailable.');
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        return s4i_result(false, 'Package is not a readable ZIP file.');
    }
    $rawEntries = array();
    $count = $zip->numFiles;
    if ($count > SCRAPER4_MAX_ZIP_ENTRIES) {
        $zip->close();
        return s4i_result(false, 'ZIP has too many entries.');
    }
    for ($i = 0; $i < $count; $i++) {
        $stat = $zip->statIndex($i);
        if (!is_array($stat) || !isset($stat['name'])) {
            continue;
        }
        $rawEntries[] = array('name' => (string) $stat['name'], 'stat' => $stat);
    }
    $zip->close();

    $normalizedFiles = array();
    $rejected = array();
    foreach ($rawEntries as $entry) {
        $name = $entry['name'];
        if ($name === '') {
            continue;
        }
        $isDir = s4i_ends_with($name, '/');
        $rel = s4i_normalize_rel_path($isDir ? rtrim($name, '/') : $name);
        if ($rel === false) {
            $rejected[] = 'Unsafe path: ' . $name;
            continue;
        }
        if ($isDir) {
            continue;
        }
        if (s4i_is_ignored_entry($rel)) {
            continue;
        }
        if (s4i_zip_entry_is_symlink($entry['stat'])) {
            $rejected[] = 'Symlink rejected: ' . $name;
            continue;
        }
        $normalizedFiles[] = array('raw' => $name, 'rel' => $rel, 'stat' => $entry['stat']);
    }
    if (count($rejected) > 0) {
        return s4i_result(false, 'ZIP failed safety checks.', array('rejected' => array_slice($rejected, 0, 20)));
    }

    $rels = array();
    foreach ($normalizedFiles as $file) {
        $rels[] = $file['rel'];
    }
    $wrapper = s4i_detect_wrapper_prefix($rels);
    $files = array();
    $uncompressed = 0;
    $compressed = 0;
    $unexpected = array();
    foreach ($normalizedFiles as $file) {
        $rel = $file['rel'];
        if ($wrapper !== '' && s4i_starts_with($rel, $wrapper)) {
            $rel = substr($rel, strlen($wrapper));
        }
        $rel = s4i_normalize_rel_path($rel);
        if ($rel === false || !s4i_is_allowed_rel($rel)) {
            $unexpected[] = $file['raw'];
            continue;
        }
        $size = isset($file['stat']['size']) ? (int) $file['stat']['size'] : 0;
        $comp = isset($file['stat']['comp_size']) ? (int) $file['stat']['comp_size'] : 0;
        if ($size < 0 || $comp < 0) {
            return s4i_result(false, 'ZIP metadata is invalid.');
        }
        $uncompressed += $size;
        $compressed += $comp;
        $files[] = array('raw' => $file['raw'], 'rel' => $rel, 'size' => $size);
    }
    if (count($unexpected) > 0) {
        return s4i_result(false, 'ZIP contains unexpected files.', array('unexpected' => array_slice($unexpected, 0, 20)));
    }
    if ($uncompressed > SCRAPER4_MAX_UNCOMPRESSED_BYTES) {
        return s4i_result(false, 'ZIP uncompressed size exceeds ' . s4i_format_bytes(SCRAPER4_MAX_UNCOMPRESSED_BYTES) . '.');
    }
    if ($uncompressed > 52428800 && $compressed > 0 && ($uncompressed / $compressed) > 200) {
        return s4i_result(false, 'ZIP compression ratio looks like a zip bomb.');
    }
    $have = array();
    foreach ($files as $file) {
        $have[$file['rel']] = true;
    }
    $missing = array();
    foreach (s4i_required_rel_files() as $required) {
        if (!isset($have[$required])) {
            $missing[] = $required;
        }
    }
    if (count($missing) > 0) {
        return s4i_result(false, 'ZIP is missing required Passenger files.', array('missing' => $missing));
    }
    return s4i_result(true, '', array(
        'files' => $files,
        'count' => count($files),
        'uncompressed' => $uncompressed,
        'compressed' => $compressed,
        'wrapper' => $wrapper,
    ));
}

function s4i_extract_plan($zipPath, $stageDir, $plan)
{
    if (!s4i_mkdir($stageDir, 0755)) {
        return s4i_result(false, 'Could not create the staging folder.');
    }
    $baseReal = realpath($stageDir);
    if ($baseReal === false) {
        return s4i_result(false, 'Could not resolve the staging folder.');
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        return s4i_result(false, 'Package could not be reopened for extraction.');
    }
    $warnings = array();
    foreach ($plan['files'] as $file) {
        $target = s4i_safe_target($baseReal, $stageDir, $file['rel']);
        if ($target === false) {
            $zip->close();
            return s4i_result(false, 'Unsafe extraction target: ' . $file['rel']);
        }
        $in = $zip->getStream($file['raw']);
        if ($in === false) {
            $zip->close();
            return s4i_result(false, 'Could not read ZIP entry: ' . $file['raw']);
        }
        $out = fopen($target, 'wb');
        if ($out === false) {
            fclose($in);
            $zip->close();
            return s4i_result(false, 'Could not write staged file: ' . $file['rel']);
        }
        stream_copy_to_stream($in, $out);
        fclose($in);
        fclose($out);
        @chmod($target, 0644);
    }
    $zip->close();
    return s4i_result(true, '', array('warnings' => $warnings));
}

function s4i_validate_stage($stageDir)
{
    $errors = array();
    $warnings = array();
    foreach (s4i_required_rel_files() as $required) {
        $path = s4i_join_path($stageDir, $required);
        if (!is_file($path) || filesize($path) <= 0) {
            $errors[] = 'Staged file is missing or empty: ' . $required;
        }
    }
    if (count($errors) > 0) {
        return s4i_result(false, 'Staged package failed validation.', array('errors' => $errors, 'warnings' => $warnings));
    }
    $packagePath = s4i_join_path($stageDir, 'package.json');
    $packageRaw = file_get_contents($packagePath);
    $package = json_decode((string) $packageRaw, true);
    if (!is_array($package)) {
        return s4i_result(false, 'Staged package.json is invalid JSON.');
    }
    if (!isset($package['type']) || $package['type'] !== 'module') {
        $errors[] = 'package.json must use "type": "module".';
    }
    $deps = isset($package['dependencies']) && is_array($package['dependencies']) ? $package['dependencies'] : array();
    foreach (array('@hono/node-server', 'cheerio', 'hono', 'pg', 'read-excel-file', 'undici') as $needed) {
        if (!isset($deps[$needed])) {
            $warnings[] = 'package.json is missing expected runtime dependency: ' . $needed;
        }
    }
    foreach (array('playwright', 'puppeteer', 'crawlee') as $heavy) {
        if (isset($deps[$heavy])) {
            $errors[] = 'package.json must not include browser dependency for shared hosting: ' . $heavy;
        }
    }
    $entry = file_get_contents(s4i_join_path($stageDir, 'app.js'));
    if ($entry === false || !s4i_contains($entry, './render-dist/server.js')) {
        $errors[] = 'app.js must import ./render-dist/server.js.';
    }
    if (!is_file(s4i_join_path($stageDir, 'render-dist/worker.js'))) {
        $warnings[] = 'render-dist/worker.js is absent; server and cron are present, so this is only a warning.';
    }
    if (count($errors) > 0) {
        return s4i_result(false, 'Staged package failed validation.', array('errors' => $errors, 'warnings' => $warnings));
    }
    return s4i_result(true, '', array(
        'errors' => $errors,
        'warnings' => $warnings,
        'version' => isset($package['version']) ? (string) $package['version'] : 'unknown',
    ));
}

/* ------------------------------ backup and sync ------------------------------ */

function s4i_backup_current($appRoot)
{
    $stamp = date('Ymd-His');
    $backupRoot = s4i_join_path(s4i_backup_dir($appRoot), $stamp);
    if (!s4i_mkdir($backupRoot, 0755)) {
        return s4i_result(false, 'Could not create the backup folder.');
    }
    $warnings = array();
    $copied = array();
    foreach (s4i_tracked_paths() as $rel) {
        $source = s4i_join_path($appRoot, $rel);
        if (!file_exists($source) && !is_link($source)) {
            continue;
        }
        if (!s4i_copy_path($source, s4i_join_path($backupRoot, $rel), $warnings, $rel)) {
            return s4i_result(false, 'Could not back up: ' . $rel);
        }
        $copied[] = $rel;
    }
    $manifest = array(
        'app' => 'scraper4-passenger-installer',
        'installer' => SCRAPER4_INSTALLER_VERSION,
        'createdAt' => date('c'),
        'copied' => $copied,
        'preserved' => array('data', 'node_modules', 'tmp', '_installer_backups'),
    );
    s4i_write_atomic($backupRoot . '/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", 0644);
    s4i_rotate_backups($appRoot);
    return s4i_result(true, '', array('backup' => $backupRoot, 'copied' => $copied, 'warnings' => $warnings));
}

function s4i_sync_stage_to_app($stageDir, $appRoot)
{
    $warnings = array();
    if (!s4i_mkdir($appRoot, 0755)) {
        return s4i_result(false, 'Could not create the app folder: ' . $appRoot);
    }
    if (!s4i_mkdir(s4i_join_path($appRoot, 'data'), 0755)) {
        return s4i_result(false, 'Could not create the data folder.');
    }
    if (!s4i_mkdir(s4i_join_path($appRoot, 'tmp'), 0755)) {
        return s4i_result(false, 'Could not create the tmp folder.');
    }

    /* Replace generated output wholesale so stale render-dist files cannot survive. */
    $oldRender = s4i_join_path($appRoot, 'render-dist');
    if (file_exists($oldRender) || is_link($oldRender)) {
        s4i_delete_path($oldRender);
    }
    $newRender = s4i_join_path($stageDir, 'render-dist');
    if (!s4i_copy_path($newRender, $oldRender, $warnings, 'render-dist')) {
        return s4i_result(false, 'Could not install render-dist/.');
    }
    foreach (array('app.js', 'package.json', 'scripts/basalam-sdk-bridge.py') as $rel) {
        if (!s4i_copy_path(s4i_join_path($stageDir, $rel), s4i_join_path($appRoot, $rel), $warnings, $rel)) {
            return s4i_result(false, 'Could not install: ' . $rel);
        }
    }
    if (is_dir(s4i_join_path($stageDir, 'migrations'))) {
        $oldMigrations = s4i_join_path($appRoot, 'migrations');
        if (file_exists($oldMigrations) || is_link($oldMigrations)) {
            s4i_delete_path($oldMigrations);
        }
        if (!s4i_copy_path(s4i_join_path($stageDir, 'migrations'), $oldMigrations, $warnings, 'migrations')) {
            return s4i_result(false, 'Could not install migrations/.');
        }
    }
    @chmod(s4i_join_path($appRoot, 'data'), 0755);
    $restart = s4i_join_path($appRoot, 'tmp/restart.txt');
    @touch($restart);
    return s4i_result(true, '', array('warnings' => $warnings, 'restartTouched' => is_file($restart)));
}

function s4i_verify_install($appRoot)
{
    $checks = array();
    foreach (s4i_required_rel_files() as $required) {
        $path = s4i_join_path($appRoot, $required);
        $ok = is_file($path) && filesize($path) > 0;
        $checks[] = array('label' => $required, 'ok' => $ok, 'detail' => $ok ? 'Present.' : 'Missing.');
    }
    $package = json_decode((string) @file_get_contents(s4i_join_path($appRoot, 'package.json')), true);
    $checks[] = array(
        'label' => 'package.json parses',
        'ok' => is_array($package),
        'detail' => is_array($package) ? ('Version ' . (isset($package['version']) ? $package['version'] : 'unknown')) : 'Invalid JSON.',
    );
    $dataDir = s4i_join_path($appRoot, 'data');
    $checks[] = array(
        'label' => 'data/ exists and is writable',
        'ok' => is_dir($dataDir) && is_writable($dataDir),
        'detail' => $dataDir,
    );
    $checks[] = array(
        'label' => 'Node dependencies installed',
        'ok' => is_dir(s4i_join_path($appRoot, 'node_modules')),
        'detail' => is_dir(s4i_join_path($appRoot, 'node_modules')) ? 'node_modules/ exists.' : 'Run Setup Node.js App -> Run NPM Install.',
    );
    $checks[] = array(
        'label' => 'Passenger restart marker',
        'ok' => is_file(s4i_join_path($appRoot, 'tmp/restart.txt')),
        'detail' => 'Also press Restart in Setup Node.js App.',
    );
    return $checks;
}

function s4i_env_helper_text($appRoot, $version)
{
    $sqlite = s4i_join_path($appRoot, 'data/scraper4.sqlite');
    $lines = array(
        'Scraper4 Passenger follow-up',
        'Generated: ' . date('c'),
        'Installer: ' . SCRAPER4_INSTALLER_VERSION,
        'Package version: ' . $version,
        'App folder: ' . $appRoot,
        '',
        'Setup Node.js App values:',
        '  Node.js version: 22.x or newer (22.5+ for built-in SQLite)',
        '  Application mode: Production',
        '  Application root: ' . basename(rtrim($appRoot, '/')),
        '  Application startup file: app.js',
        '',
        'Environment variables:',
        '  SCRAPER4_SQLITE_PATH=' . $sqlite,
        '  LOCAL_SCRAPER_AUTO_UPDATE=false',
        '  RUN_WORKER_IN_WEB=true',
        '  DETAIL_CONCURRENCY=2',
        '  Do not set PORT.',
        '  Leave ADMIN_TOKEN empty for browser-dashboard use.',
        '  Do not set VAULT_SECRET for this Node runtime.',
        '',
        'Finish checklist:',
        '  1. Setup Node.js App -> Run NPM Install',
        '  2. Setup Node.js App -> Restart',
        '  3. Open https://your-domain/health',
        '  4. Open https://your-domain/',
        '  5. Delete this PHP installer from the host.',
        '',
    );
    return implode("\n", $lines);
}

/* ------------------------------- install flow -------------------------------- */

function s4i_run_deploy($packagePath, $appRoot, $dryRun, &$report)
{
    $report = array('steps' => array(), 'warnings' => array());
    $report['steps'][] = 'Resolved app folder: ' . $appRoot;
    if (s4i_path_inside_public_html($appRoot)) {
        return s4i_result(false, 'Refusing to install inside public_html: ' . $appRoot);
    }
    $size = filesize($packagePath);
    if ($size === false || $size <= 0) {
        return s4i_result(false, 'Package file is empty or unreadable.');
    }
    if ($size > SCRAPER4_MAX_PACKAGE_BYTES) {
        return s4i_result(false, 'Package exceeds ' . s4i_format_bytes(SCRAPER4_MAX_PACKAGE_BYTES) . '.');
    }
    $report['steps'][] = 'Package size: ' . s4i_format_bytes($size);

    $inspect = s4i_inspect_zip($packagePath);
    if (!$inspect['ok']) {
        return $inspect;
    }
    $plan = $inspect['data'];
    $report['steps'][] = 'ZIP entries accepted: ' . $plan['count'] . ' (' . s4i_format_bytes($plan['uncompressed']) . ' uncompressed).';
    if ($plan['wrapper'] !== '') {
        $report['steps'][] = 'Stripped packaging wrapper: ' . $plan['wrapper'];
    }

    $stageBase = sys_get_temp_dir() . '/' . SCRAPER4_HOLD_PREFIX . bin2hex(random_bytes(8));
    $extract = s4i_extract_plan($packagePath, $stageBase, $plan);
    if (!$extract['ok']) {
        s4i_delete_path($stageBase);
        return $extract;
    }
    $validate = s4i_validate_stage($stageBase);
    foreach ($validate['data']['warnings'] as $warning) {
        $report['warnings'][] = $warning;
    }
    if (!$validate['ok']) {
        s4i_delete_path($stageBase);
        return $validate;
    }
    $version = $validate['data']['version'];
    $report['steps'][] = 'Staged package version: ' . $version;
    $report['data'] = array('version' => $version, 'files' => $plan['count']);

    if ($dryRun) {
        s4i_delete_path($stageBase);
        $report['steps'][] = 'Dry-run complete; no host files were changed.';
        return s4i_result(true, 'Dry-run passed.', $report);
    }

    $backup = s4i_backup_current($appRoot);
    if (!$backup['ok']) {
        s4i_delete_path($stageBase);
        return $backup;
    }
    foreach ($backup['data']['warnings'] as $warning) {
        $report['warnings'][] = $warning;
    }
    $report['steps'][] = 'Backup created: ' . $backup['data']['backup'];

    $sync = s4i_sync_stage_to_app($stageBase, $appRoot);
    s4i_delete_path($stageBase);
    if (!$sync['ok']) {
        return $sync;
    }
    foreach ($sync['data']['warnings'] as $warning) {
        $report['warnings'][] = $warning;
    }
    $report['steps'][] = 'Files synced; data/ and node_modules/ preserved.';
    $report['steps'][] = $sync['data']['restartTouched'] ? 'Touched tmp/restart.txt.' : 'Could not touch tmp/restart.txt; use cPanel Restart.';

    $helper = s4i_env_helper_text($appRoot, $version);
    $helperPath = s4i_join_path(s4i_backup_dir($appRoot), 'passenger-env-' . date('Ymd-His') . '.txt');
    if (s4i_write_atomic($helperPath, $helper, 0644)) {
        $report['steps'][] = 'Wrote follow-up helper: ' . $helperPath;
    } else {
        $report['warnings'][] = 'Could not write the follow-up helper file.';
    }
    $report['data']['helper'] = $helper;

    $verify = s4i_verify_install($appRoot);
    $failed = array();
    foreach ($verify as $check) {
        if (!$check['ok'] && $check['label'] !== 'Node dependencies installed') {
            $failed[] = $check['label'];
        }
    }
    $report['data']['verify'] = $verify;
    if (count($failed) > 0) {
        return s4i_result(false, 'Install verification failed: ' . implode(', ', $failed), $report);
    }
    s4i_append_log($appRoot, 'Installed package version ' . $version . ' (' . $plan['count'] . ' files).');
    return s4i_result(true, 'Installed Scraper4 Passenger package ' . $version . '.', $report);
}

/* ------------------------------ web authentication ---------------------------- */

function s4i_web_boot()
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $secure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && $_SERVER['HTTPS'] !== 'off';
        session_set_cookie_params(array(
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
        session_start();
    }
}

function s4i_csrf_token()
{
    if (!isset($_SESSION['s4_csrf']) || strlen((string) $_SESSION['s4_csrf']) < 32) {
        $_SESSION['s4_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['s4_csrf'];
}

function s4i_csrf_ok()
{
    return isset($_POST['csrf'], $_SESSION['s4_csrf']) && hash_equals((string) $_SESSION['s4_csrf'], (string) $_POST['csrf']);
}

function s4i_is_authed()
{
    return isset($_SESSION['s4_auth']) && $_SESSION['s4_auth'] === true;
}

function s4i_login_attempts()
{
    if (!isset($_SESSION['s4_attempts']) || !is_array($_SESSION['s4_attempts'])) {
        $_SESSION['s4_attempts'] = array('count' => 0, 'until' => 0);
    }
    return $_SESSION['s4_attempts'];
}

function s4i_login_blocked()
{
    $attempts = s4i_login_attempts();
    return isset($attempts['until']) && $attempts['until'] > time();
}

function s4i_note_login_failure()
{
    $attempts = s4i_login_attempts();
    $attempts['count'] = (int) $attempts['count'] + 1;
    if ($attempts['count'] >= 10) {
        $attempts['until'] = time() + 300;
        $attempts['count'] = 0;
    }
    $_SESSION['s4_attempts'] = $attempts;
}

/* --------------------------------- web pages --------------------------------- */

function s4i_page_head($title)
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . s4i_h($title) . '</title>'
        . '<style>'
        . 'body{margin:0;background:#0b1220;color:#e5e7eb;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}'
        . 'main{max-width:920px;margin:24px auto;padding:0 16px 48px}'
        . '.card{background:#111c33;border:1px solid #274067;border-radius:14px;padding:18px;margin:14px 0}'
        . 'h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:0 0 8px}'
        . 'label{display:block;margin:10px 0 4px;color:#bfdbfe}'
        . 'input[type=text],input[type=password],input[type=file],select{width:100%;box-sizing:border-box;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:10px}'
        . '.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}'
        . 'button{background:#15803d;color:#fff;border:0;border-radius:10px;padding:11px 14px;font-size:15px;margin:10px 8px 0 0;cursor:pointer}'
        . 'button.secondary{background:#334155}button.danger{background:#b91c1c}'
        . 'pre{background:#020617;border:1px solid #1e293b;border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-word}'
        . '.ok{color:#86efac}.bad{color:#fca5a5}.warn{color:#fde68a}.muted{color:#94a3b8}'
        . 'table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #243349;padding:8px;text-align:left;vertical-align:top}'
        . 'a{color:#93c5fd}'
        . '</style></head><body><main>';
}

function s4i_page_foot()
{
    echo '</main></body></html>';
}

function s4i_show_checks($checks)
{
    echo '<table><tr><th>Check</th><th>Status</th><th>Detail</th></tr>';
    foreach ($checks as $check) {
        echo '<tr><td>' . s4i_h($check['label']) . '</td><td class="' . ($check['ok'] ? 'ok' : 'bad') . '">'
            . ($check['ok'] ? 'PASS' : 'FAIL') . '</td><td>' . s4i_h($check['detail']) . '</td></tr>';
    }
    echo '</table>';
}

function s4i_show_report($report)
{
    if (isset($report['steps'])) {
        echo '<ul>';
        foreach ($report['steps'] as $step) {
            echo '<li>' . s4i_h($step) . '</li>';
        }
        echo '</ul>';
    }
    if (isset($report['warnings']) && count($report['warnings']) > 0) {
        echo '<p class="warn">Warnings:</p><ul>';
        foreach ($report['warnings'] as $warning) {
            echo '<li>' . s4i_h($warning) . '</li>';
        }
        echo '</ul>';
    }
}

function s4i_holding_dir()
{
    $dir = rtrim(sys_get_temp_dir(), '/') . '/s4passenger-hold';
    s4i_mkdir($dir, 0700);
    return $dir;
}

function s4i_store_holding_file($sourcePath, $sha256)
{
    $dest = s4i_holding_dir() . '/' . SCRAPER4_HOLD_PREFIX . bin2hex(random_bytes(8)) . '.zip';
    if (!copy($sourcePath, $dest)) {
        return false;
    }
    @chmod($dest, 0600);
    $_SESSION['s4_hold'] = array('path' => $dest, 'sha256' => (string) $sha256, 'at' => time());
    return $dest;
}

function s4i_take_holding_file()
{
    if (!isset($_SESSION['s4_hold']) || !is_array($_SESSION['s4_hold'])) {
        return false;
    }
    $hold = $_SESSION['s4_hold'];
    unset($_SESSION['s4_hold']);
    if (!isset($hold['path']) || !is_file($hold['path'])) {
        return false;
    }
    $expectedDir = rtrim(realpath(s4i_holding_dir()), '/') . '/';
    $real = str_replace('\\', '/', (string) realpath($hold['path']));
    if (!s4i_starts_with($real, $expectedDir)) {
        return false;
    }
    return array('path' => $hold['path'], 'sha256' => isset($hold['sha256']) ? (string) $hold['sha256'] : '');
}

function s4i_handle_upload($field)
{
    if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) {
        return s4i_result(false, 'No uploaded file was received.');
    }
    $file = $_FILES[$field];
    if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
        return s4i_result(false, 'Upload failed with error code ' . (isset($file['error']) ? (int) $file['error'] : -1) . '.');
    }
    if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
        return s4i_result(false, 'Uploaded file failed validation.');
    }
    $size = filesize($file['tmp_name']);
    if ($size === false || $size <= 0 || $size > SCRAPER4_MAX_PACKAGE_BYTES) {
        return s4i_result(false, 'Uploaded package must be 1 byte to ' . s4i_format_bytes(SCRAPER4_MAX_PACKAGE_BYTES) . '.');
    }
    return s4i_result(true, '', array('tmp' => $file['tmp_name'], 'bytes' => $size));
}

function s4i_web_main()
{
    s4i_web_boot();
    $appRoot = s4i_resolve_app_root();
    $action = isset($_POST['action']) ? (string) $_POST['action'] : (isset($_GET['action']) ? (string) $_GET['action'] : 'status');

    if ($action === 'logout') {
        $_SESSION = array();
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        header('Location: ' . $_SERVER['PHP_SELF']);
        exit(0);
    }

    s4i_page_head('Scraper4 Passenger installer');
    echo '<h1>Scraper4 Passenger installer</h1>';
    echo '<p class="muted">Installer ' . s4i_h(SCRAPER4_INSTALLER_VERSION)
        . ' | App folder: ' . s4i_h($appRoot) . '</p>';

    if (!s4i_token_configured()) {
        echo '<div class="card"><h2>Setup required</h2><p class="bad">The installer token is still the placeholder. '
            . 'Edit SCRAPER4_INSTALLER_TOKEN in this PHP file, re-upload it, and reload.</p></div>';
        s4i_page_foot();
        return;
    }

    if (!s4i_is_authed()) {
        $error = '';
        if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
            if (s4i_login_blocked()) {
                $error = 'Too many attempts. Wait five minutes and try again.';
            } elseif (s4i_auth_ok(isset($_POST['token']) ? $_POST['token'] : '')) {
                session_regenerate_id(true);
                $_SESSION['s4_auth'] = true;
                $_SESSION['s4_attempts'] = array('count' => 0, 'until' => 0);
                header('Location: ' . $_SERVER['PHP_SELF']);
                exit(0);
            } else {
                s4i_note_login_failure();
                $error = 'Wrong token.';
            }
        }
        echo '<div class="card"><h2>Login</h2>';
        if ($error !== '') {
            echo '<p class="bad">' . s4i_h($error) . '</p>';
        }
        echo '<form method="post" action="">'
            . '<input type="hidden" name="action" value="login">'
            . '<label>Installer token</label>'
            . '<input type="password" name="token" autocomplete="off" required>'
            . '<div><button type="submit">Unlock installer</button></div>'
            . '</form><p class="muted">Delete this installer immediately after a successful install.</p></div>';
        s4i_page_foot();
        return;
    }

    $message = '';
    $messageOk = true;
    $report = null;
    $detailItems = array();
    $verify = null;
    $helper = '';

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($action === 'preview' || $action === 'install')) {
        if (!s4i_csrf_ok()) {
            $message = 'Security token expired. Reload and try again.';
            $messageOk = false;
        } else {
            $source = isset($_POST['source']) ? (string) $_POST['source'] : 'local';
            $sha256 = isset($_POST['sha256']) ? trim((string) $_POST['sha256']) : '';
            $packagePath = '';
            $tempOwned = '';
            $isUploadHold = false;
            if ($action === 'install' && $source === 'upload') {
                $hold = s4i_take_holding_file();
                if ($hold === false) {
                    $message = 'Uploaded package expired. Upload and preview again.';
                    $messageOk = false;
                } else {
                    $packagePath = $hold['path'];
                    $tempOwned = $hold['path'];
                    if ($sha256 === '') {
                        $sha256 = $hold['sha256'];
                    }
                    $isUploadHold = true;
                }
            } elseif ($source === 'local') {
                $local = s4i_validate_local_package_path(isset($_POST['local_path']) ? $_POST['local_path'] : '', $appRoot);
                if (!$local['ok']) {
                    $message = $local['message'];
                    $messageOk = false;
                } else {
                    $packagePath = $local['data']['path'];
                }
            } elseif ($source === 'url') {
                $checked = s4i_validate_package_url(isset($_POST['package_url']) ? $_POST['package_url'] : '');
                if (!$checked['ok']) {
                    $message = $checked['message'];
                    $messageOk = false;
                } else {
                    if ($checked['data']['insecure']) {
                        $report = array('steps' => array(), 'warnings' => array($checked['message']));
                    }
                    $tempOwned = s4i_new_temp_file(SCRAPER4_HOLD_PREFIX);
                    if ($tempOwned === false) {
                        $message = 'Could not create a temporary download file.';
                        $messageOk = false;
                    } else {
                        $download = s4i_download_package($checked['data']['url'], $tempOwned);
                        if (!$download['ok']) {
                            @unlink($tempOwned);
                            $tempOwned = '';
                            $message = $download['message'];
                            $messageOk = false;
                        } else {
                            $packagePath = $tempOwned;
                        }
                    }
                }
            } elseif ($source === 'upload') {
                if ($action === 'preview') {
                    $upload = s4i_handle_upload('package');
                    if (!$upload['ok']) {
                        $message = $upload['message'];
                        $messageOk = false;
                    } else {
                        $held = s4i_store_holding_file($upload['data']['tmp'], $sha256);
                        if ($held === false) {
                            $message = 'Could not store the uploaded package.';
                            $messageOk = false;
                        } else {
                            $packagePath = $held;
                        }
                    }
                } else {
                    $message = 'Uploaded package expired. Upload and preview again.';
                    $messageOk = false;
                }
            } else {
                $message = 'Unknown package source.';
                $messageOk = false;
            }

            if ($messageOk) {
                $hashCheck = s4i_verify_sha256($packagePath, $sha256);
                if (!$hashCheck['ok']) {
                    $message = $hashCheck['message'];
                    $messageOk = false;
                } else {
                    $deployReport = array();
                    $deploy = s4i_run_deploy($packagePath, $appRoot, $action === 'preview', $deployReport);
                    if (is_array($report) && isset($report['warnings'])) {
                        foreach ($report['warnings'] as $warning) {
                            $deployReport['warnings'][] = $warning;
                        }
                    }
                    if ($hashCheck['data']['verified']) {
                        $deployReport['steps'][] = 'SHA-256 verified: ' . $hashCheck['data']['sha256'];
                    } else {
                        $deployReport['warnings'][] = 'No SHA-256 was supplied, so integrity was checked by structure only.';
                    }
                    $report = $deployReport;
                    $message = $deploy['message'];
                    $messageOk = (bool) $deploy['ok'];
                    if (!$messageOk && is_array($deploy['data'])) {
                        foreach (array('rejected', 'unexpected', 'missing', 'errors') as $key) {
                            if (isset($deploy['data'][$key]) && is_array($deploy['data'][$key])) {
                                foreach ($deploy['data'][$key] as $item) {
                                    $detailItems[] = $key . ': ' . $item;
                                }
                            }
                        }
                    }
                    if ($messageOk && $action === 'install') {
                        $_SESSION['s4_installed'] = true;
                        if (isset($deployReport['data']['verify'])) {
                            $verify = $deployReport['data']['verify'];
                        }
                        if (isset($deployReport['data']['helper'])) {
                            $helper = $deployReport['data']['helper'];
                        }
                    }
                }
            }
            if ($tempOwned !== '' && !($action === 'preview' && $source === 'upload')) {
                @unlink($tempOwned);
            }
            if ($action === 'install' && $isUploadHold && $tempOwned !== '') {
                @unlink($tempOwned);
            }
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'delete') {
        if (!s4i_csrf_ok()) {
            $message = 'Security token expired. Reload and try again.';
            $messageOk = false;
        } elseif (!isset($_POST['confirm']) || trim((string) $_POST['confirm']) !== 'DELETE') {
            $message = 'Type DELETE to confirm installer removal.';
            $messageOk = false;
        } else {
            $path = __FILE__;
            if (@unlink($path)) {
                echo '<div class="card"><h2>Installer deleted</h2><p class="ok">The installer file was removed. '
                    . 'Finish in Setup Node.js App if you have not already.</p></div>';
                s4i_page_foot();
                return;
            }
            $message = 'Could not delete this file. Remove it manually with FTP/File Manager.';
            $messageOk = false;
        }
    }

    $checks = s4i_check_requirements($appRoot);
    echo '<div class="card"><h2>Environment checks</h2>';
    s4i_show_checks($checks);
    echo '<p><a href="?action=logout">Lock installer</a></p></div>';

    if ($message !== '') {
        echo '<div class="card"><h2>' . ($messageOk ? 'Result' : 'Error') . '</h2><p class="'
            . ($messageOk ? 'ok' : 'bad') . '">' . s4i_h($message) . '</p>';
        if (is_array($report)) {
            s4i_show_report($report);
        }
        if (count($detailItems) > 0) {
            echo '<ul>';
            foreach (array_slice($detailItems, 0, 40) as $item) {
                echo '<li>' . s4i_h($item) . '</li>';
            }
            echo '</ul>';
        }
        echo '</div>';
    }
    if (is_array($verify)) {
        echo '<div class="card"><h2>Verification</h2>';
        s4i_show_checks($verify);
        echo '</div>';
    }
    if ($helper !== '') {
        echo '<div class="card"><h2>cPanel follow-up values</h2><pre>' . s4i_h($helper) . '</pre></div>';
    }

    $csrf = s4i_csrf_token();
    echo '<div class="card"><h2>1. Dry-run the package</h2>'
        . '<form method="post" action="" enctype="multipart/form-data">'
        . '<input type="hidden" name="csrf" value="' . s4i_h($csrf) . '">'
        . '<input type="hidden" name="action" value="preview">'
        . '<label>Package source</label>'
        . '<select name="source"><option value="local">Local ZIP already on host</option>'
        . '<option value="url">HTTPS URL</option><option value="upload">Browser upload</option></select>'
        . '<div class="row"><div><label>Local ZIP path</label>'
        . '<input type="text" name="local_path" placeholder="/home/USER/scraper4-passenger.zip"></div>'
        . '<div><label>Package URL</label><input type="text" name="package_url" placeholder="https://.../scraper4-passenger.zip"></div></div>'
        . '<label>Browser upload</label><input type="file" name="package" accept=".zip,application/zip">'
        . '<label>SHA-256 checksum, optional but recommended</label>'
        . '<input type="text" name="sha256" placeholder="64 hex characters">'
        . '<div><button type="submit">Run dry-run</button></div>'
        . '</form></div>';

    echo '<div class="card"><h2>2. Install into scraper4</h2>'
        . '<p class="muted">For browser upload, run the dry-run first in the form above; the install form then reuses that staged upload.</p>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4i_h($csrf) . '">'
        . '<input type="hidden" name="action" value="install">'
        . '<label>Package source</label>'
        . '<select name="source"><option value="local">Local ZIP already on host</option>'
        . '<option value="url">HTTPS URL</option><option value="upload">Use staged browser upload</option></select>'
        . '<div class="row"><div><label>Local ZIP path</label>'
        . '<input type="text" name="local_path" placeholder="/home/USER/scraper4-passenger.zip"></div>'
        . '<div><label>Package URL</label><input type="text" name="package_url" placeholder="https://.../scraper4-passenger.zip"></div></div>'
        . '<label>SHA-256 checksum, optional but recommended</label>'
        . '<input type="text" name="sha256" placeholder="64 hex characters">'
        . '<div><button type="submit">Install now</button></div>'
        . '</form></div>';

    echo '<div class="card"><h2>3. Remove the installer</h2>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="csrf" value="' . s4i_h($csrf) . '">'
        . '<input type="hidden" name="action" value="delete">'
        . '<label>Type DELETE to remove this PHP file</label>'
        . '<input type="text" name="confirm" autocomplete="off">'
        . '<div><button class="danger" type="submit">Delete installer file</button></div>'
        . '</form></div>';

    s4i_page_foot();
}

/* ----------------------------------- CLI ------------------------------------- */

function s4i_cli_args($argv)
{
    $args = array(
        'token' => '',
        'source' => '',
        'file' => '',
        'url' => '',
        'sha256' => '',
        'app-root' => '',
        'dry-run' => false,
        'yes' => false,
        'status' => false,
        'help' => false,
    );
    foreach ($argv as $index => $raw) {
        if ($index === 0) {
            continue;
        }
        if ($raw === '--dry-run') {
            $args['dry-run'] = true;
            continue;
        }
        if ($raw === '--yes') {
            $args['yes'] = true;
            continue;
        }
        if ($raw === '--status') {
            $args['status'] = true;
            continue;
        }
        if ($raw === '--help' || $raw === '-h') {
            $args['help'] = true;
            continue;
        }
        $pos = strpos($raw, '=');
        if ($pos !== false && s4i_starts_with($raw, '--')) {
            $key = substr($raw, 2, $pos - 2);
            $value = substr($raw, $pos + 1);
            if (array_key_exists($key, $args)) {
                $args[$key] = $value;
            }
            continue;
        }
    }
    if ($args['token'] === '') {
        $args['token'] = (string) getenv('SCRAPER4_INSTALL_TOKEN');
    }
    return $args;
}

function s4i_cli_help()
{
    return "Scraper4 Passenger installer " . SCRAPER4_INSTALLER_VERSION . "\n"
        . "\n"
        . "  php scraper4-passenger-install.php --status --token=TOKEN\n"
        . "  php scraper4-passenger-install.php --source=local --file=/path/app.zip --sha256=... --dry-run --token=TOKEN\n"
        . "  php scraper4-passenger-install.php --source=url --url=https://.../app.zip --sha256=... --dry-run --token=TOKEN\n"
        . "  php scraper4-passenger-install.php --source=local --file=/path/app.zip --sha256=... --yes --token=TOKEN\n"
        . "\n"
        . "Options:\n"
        . "  --token=TOKEN        required installer token\n"
        . "  --source=local|url   package source\n"
        . "  --file=PATH          local ZIP path for --source=local\n"
        . "  --url=URL            package URL for --source=url\n"
        . "  --sha256=HEX         optional 64-character checksum\n"
        . "  --app-root=PATH      CLI-only app folder override\n"
        . "  --dry-run            validate without changing host files\n"
        . "  --yes                required confirmation for install\n"
        . "  --status             show checks and resolved paths\n";
}

function s4i_cli_main($argv)
{
    $args = s4i_cli_args($argv);
    if ($args['help']) {
        echo s4i_cli_help();
        return 0;
    }
    if (!s4i_token_configured()) {
        fwrite(STDERR, "Installer token is still the placeholder.\n");
        return 2;
    }
    if (!s4i_auth_ok($args['token'])) {
        fwrite(STDERR, "Wrong or missing installer token.\n");
        return 2;
    }
    $appRoot = s4i_resolve_app_root($args['app-root']);
    $checks = s4i_check_requirements($appRoot);
    if ($args['status']) {
        echo 'App folder: ' . $appRoot . "\n";
        foreach ($checks as $check) {
            echo ($check['ok'] ? '[PASS] ' : '[FAIL] ') . $check['label'] . ' - ' . $check['detail'] . "\n";
        }
        return s4i_checks_pass($checks, false) ? 0 : 1;
    }
    if ($args['source'] !== 'local' && $args['source'] !== 'url') {
        fwrite(STDERR, "Use --source=local or --source=url.\n");
        return 2;
    }
    if (!$args['dry-run'] && !$args['yes']) {
        fwrite(STDERR, "Refusing to install without --dry-run or --yes.\n");
        return 2;
    }
    if (!s4i_checks_pass($checks, $args['source'] === 'url')) {
        fwrite(STDERR, "Environment checks failed.\n");
        return 1;
    }
    $packagePath = '';
    $tempOwned = '';
    if ($args['source'] === 'local') {
        $local = s4i_validate_local_package_path($args['file'], $appRoot);
        if (!$local['ok']) {
            fwrite(STDERR, $local['message'] . "\n");
            return 1;
        }
        $packagePath = $local['data']['path'];
    } else {
        $checked = s4i_validate_package_url($args['url']);
        if (!$checked['ok']) {
            fwrite(STDERR, $checked['message'] . "\n");
            return 1;
        }
        if ($checked['data']['insecure']) {
            fwrite(STDERR, "Warning: " . $checked['message'] . "\n");
        }
        $tempOwned = s4i_new_temp_file(SCRAPER4_HOLD_PREFIX);
        if ($tempOwned === false) {
            fwrite(STDERR, "Could not create a temporary download file.\n");
            return 1;
        }
        $download = s4i_download_package($checked['data']['url'], $tempOwned);
        if (!$download['ok']) {
            @unlink($tempOwned);
            fwrite(STDERR, $download['message'] . "\n");
            return 1;
        }
        $packagePath = $tempOwned;
    }
    $hashCheck = s4i_verify_sha256($packagePath, $args['sha256']);
    if (!$hashCheck['ok']) {
        if ($tempOwned !== '') {
            @unlink($tempOwned);
        }
        fwrite(STDERR, $hashCheck['message'] . "\n");
        return 1;
    }
    $report = array();
    $deploy = s4i_run_deploy($packagePath, $appRoot, $args['dry-run'], $report);
    if ($tempOwned !== '') {
        @unlink($tempOwned);
    }
    if ($hashCheck['data']['verified']) {
        echo 'SHA-256 verified: ' . $hashCheck['data']['sha256'] . "\n";
    } else {
        echo "Warning: no SHA-256 was supplied.\n";
    }
    foreach ($report['steps'] as $step) {
        echo '- ' . $step . "\n";
    }
    foreach ($report['warnings'] as $warning) {
        echo 'Warning: ' . $warning . "\n";
    }
    if (isset($report['data']['helper']) && !$args['dry-run']) {
        echo "\n" . $report['data']['helper'] . "\n";
    }
    if (!$deploy['ok']) {
        fwrite(STDERR, $deploy['message'] . "\n");
        if (isset($deploy['data']) && is_array($deploy['data'])) {
            foreach (array('rejected', 'unexpected', 'missing', 'errors') as $key) {
                if (isset($deploy['data'][$key]) && is_array($deploy['data'][$key])) {
                    foreach ($deploy['data'][$key] as $item) {
                        fwrite(STDERR, '  - ' . $key . ': ' . $item . "\n");
                    }
                }
            }
        }
        return 1;
    }
    echo $deploy['message'] . "\n";
    return 0;
}

/* ---------------------------------- dispatch --------------------------------- */

if (s4i_is_cli()) {
    ini_set('display_errors', '1');
    exit(s4i_cli_main($argv));
}

ini_set('display_errors', '0');
if (function_exists('set_time_limit')) {
    @set_time_limit(300);
}
s4i_web_main();
