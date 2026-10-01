<?php
/**
 * Filesystem primitives: path normalisation, MIME detection, previews, trees,
 * archives. Port of the pathlib/shutil/mimetypes usage in
 * agent-python/app/workspaces.py — back on a real local filesystem instead of
 * the R2 object store the Workers build had to fake.
 */

declare(strict_types=1);

namespace Arena;

final class Files
{
    public const IGNORED_SEGMENTS = [
        '.git', '.venv', 'venv', '__pycache__', 'node_modules',
        '.pytest_cache', '.cache', '.DS_Store', '.mypy_cache',
    ];

    public const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];
    public const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
    public const VIDEO_EXT = ['.mp4', '.webm', '.ogv', '.mov', '.mkv'];
    public const EXEC_EXT  = ['.py', '.pyw', '.sh', '.bash', '.js', '.ts', '.html'];

    private const MIME = [
        '.html' => 'text/html; charset=utf-8',
        '.htm' => 'text/html; charset=utf-8',
        '.css' => 'text/css; charset=utf-8',
        '.js' => 'text/javascript; charset=utf-8',
        '.mjs' => 'text/javascript; charset=utf-8',
        '.ts' => 'text/plain; charset=utf-8',
        '.tsx' => 'text/plain; charset=utf-8',
        '.jsx' => 'text/plain; charset=utf-8',
        '.json' => 'application/json; charset=utf-8',
        '.md' => 'text/markdown; charset=utf-8',
        '.markdown' => 'text/markdown; charset=utf-8',
        '.txt' => 'text/plain; charset=utf-8',
        '.csv' => 'text/csv; charset=utf-8',
        '.tsv' => 'text/tab-separated-values; charset=utf-8',
        '.xml' => 'application/xml; charset=utf-8',
        '.yml' => 'text/yaml; charset=utf-8',
        '.yaml' => 'text/yaml; charset=utf-8',
        '.py' => 'text/x-python; charset=utf-8',
        '.pyw' => 'text/x-python; charset=utf-8',
        '.php' => 'text/x-php; charset=utf-8',
        '.sh' => 'text/x-shellscript; charset=utf-8',
        '.bash' => 'text/x-shellscript; charset=utf-8',
        '.sql' => 'application/sql; charset=utf-8',
        '.toml' => 'text/plain; charset=utf-8',
        '.ini' => 'text/plain; charset=utf-8',
        '.png' => 'image/png',
        '.jpg' => 'image/jpeg',
        '.jpeg' => 'image/jpeg',
        '.gif' => 'image/gif',
        '.svg' => 'image/svg+xml',
        '.webp' => 'image/webp',
        '.bmp' => 'image/bmp',
        '.ico' => 'image/x-icon',
        '.pdf' => 'application/pdf',
        '.mp3' => 'audio/mpeg',
        '.wav' => 'audio/wav',
        '.ogg' => 'audio/ogg',
        '.aac' => 'audio/aac',
        '.flac' => 'audio/flac',
        '.m4a' => 'audio/mp4',
        '.mp4' => 'video/mp4',
        '.webm' => 'video/webm',
        '.ogv' => 'video/ogg',
        '.zip' => 'application/zip',
        '.wasm' => 'application/wasm',
    ];

    // ------------------------------------------------------------- paths

    /** Port of workspaces.safe_path normalisation. Returns '' for the root. */
    public static function normalizeRel(?string $raw): string
    {
        $clean = trim((string) ($raw ?? '.'));
        if ($clean === '' || $clean === '.' || $clean === './') {
            return '';
        }
        $clean = str_replace('\\', '/', $clean);
        $clean = ltrim($clean, '/');
        $parts = [];
        foreach (explode('/', $clean) as $seg) {
            if ($seg === '' || $seg === '.') {
                continue;
            }
            if ($seg === '..') {
                if (!$parts) {
                    throw new HttpError(400, "Path traversal detected: '{$raw}' is outside the workspace root");
                }
                array_pop($parts);
                continue;
            }
            $parts[] = $seg;
        }
        return implode('/', $parts);
    }

    public static function isIgnored(string $rel): bool
    {
        foreach (explode('/', $rel) as $seg) {
            if (in_array($seg, self::IGNORED_SEGMENTS, true)) {
                return true;
            }
        }
        return false;
    }

    public static function basename(string $rel): string
    {
        $parts = array_values(array_filter(explode('/', str_replace('\\', '/', $rel)), 'strlen'));
        return $parts ? end($parts) : '';
    }

    public static function dirname(string $rel): string
    {
        $parts = array_values(array_filter(explode('/', str_replace('\\', '/', $rel)), 'strlen'));
        array_pop($parts);
        return implode('/', $parts);
    }

    public static function extname(string $rel): string
    {
        $name = self::basename($rel);
        $i = strrpos($name, '.');
        return ($i !== false && $i > 0) ? strtolower(substr($name, $i)) : '';
    }

    public static function mimeType(string $path): string
    {
        return self::MIME[self::extname($path)] ?? 'application/octet-stream';
    }

    public static function isTextMime(string $path): bool
    {
        $m = self::mimeType($path);
        return str_starts_with($m, 'text/')
            || in_array($m, ['application/json; charset=utf-8', 'application/xml; charset=utf-8', 'application/sql; charset=utf-8'], true);
    }

    // ------------------------------------------------------------ helpers

    public static function ensureDir(string $abs): void
    {
        if (!is_dir($abs) && !@mkdir($abs, 0775, true) && !is_dir($abs)) {
            throw new HttpError(500, 'Unable to create directory: ' . $abs);
        }
    }

    public static function write(string $abs, string $content): int
    {
        self::ensureDir(dirname($abs));
        $bytes = file_put_contents($abs, $content, LOCK_EX);
        if ($bytes === false) {
            throw new HttpError(500, 'Unable to write file: ' . basename($abs));
        }
        return $bytes;
    }

    public static function read(string $abs): string
    {
        $data = @file_get_contents($abs);
        if ($data === false) {
            throw new HttpError(404, 'File not found');
        }
        return $data;
    }

    public static function deleteTree(string $abs): int
    {
        if (is_file($abs) || is_link($abs)) {
            @unlink($abs);
            return 1;
        }
        if (!is_dir($abs)) {
            return 0;
        }
        $count = 0;
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($abs, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $item) {
            /** @var \SplFileInfo $item */
            if ($item->isDir()) {
                @rmdir($item->getPathname());
            } else {
                @unlink($item->getPathname());
                $count++;
            }
        }
        @rmdir($abs);
        return $count;
    }

    public static function copyTree(string $from, string $to): int
    {
        if (is_file($from)) {
            self::ensureDir(dirname($to));
            copy($from, $to);
            return 1;
        }
        if (!is_dir($from)) {
            return 0;
        }
        self::ensureDir($to);
        $count = 0;
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($from, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($it as $item) {
            /** @var \SplFileInfo $item */
            $target = $to . '/' . substr($item->getPathname(), strlen($from) + 1);
            if ($item->isDir()) {
                self::ensureDir($target);
            } else {
                self::ensureDir(dirname($target));
                copy($item->getPathname(), $target);
                $count++;
            }
        }
        return $count;
    }

    public static function dirSize(string $abs): array
    {
        $bytes = 0;
        $files = 0;
        $dirs = 0;
        if (!is_dir($abs)) {
            return ['bytes' => 0, 'files' => 0, 'dirs' => 0];
        }
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($abs, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($it as $item) {
            /** @var \SplFileInfo $item */
            if ($item->isDir()) {
                $dirs++;
            } else {
                $files++;
                $bytes += $item->getSize() ?: 0;
            }
        }
        return ['bytes' => $bytes, 'files' => $files, 'dirs' => $dirs];
    }

    /** Non-recursive directory listing; dirs first, then files, both A→Z. */
    public static function listDir(string $rootAbs, string $rel = ''): array
    {
        $abs = $rel === '' ? $rootAbs : $rootAbs . '/' . $rel;
        if (!is_dir($abs)) {
            return [];
        }
        $entries = [];
        foreach (scandir($abs) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $childRel = $rel === '' ? $name : $rel . '/' . $name;
            if (self::isIgnored($childRel)) {
                continue;
            }
            $childAbs = $abs . '/' . $name;
            $isDir = is_dir($childAbs);
            $entries[] = [
                'path' => $childRel,
                'name' => $name,
                'type' => $isDir ? 'dir' : 'file',
                'size' => $isDir ? 0 : (int) (@filesize($childAbs) ?: 0),
                'extension' => $isDir ? '' : self::extname($name),
                'modified' => (int) (@filemtime($childAbs) ?: 0),
            ];
        }
        usort($entries, static function (array $a, array $b): int {
            if ($a['type'] !== $b['type']) {
                return $a['type'] === 'dir' ? -1 : 1;
            }
            return strcasecmp($a['name'], $b['name']);
        });
        return $entries;
    }

    /** Full recursive listing (files only), used by tree/zip/search. */
    public static function listRecursive(string $rootAbs, string $rel = '', int $limit = 20000): array
    {
        $base = $rel === '' ? $rootAbs : $rootAbs . '/' . $rel;
        if (!is_dir($base)) {
            return [];
        }
        $out = [];
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($it as $item) {
            /** @var \SplFileInfo $item */
            $itemRel = ltrim(str_replace('\\', '/', substr($item->getPathname(), strlen($rootAbs) + 1)), '/');
            if (self::isIgnored($itemRel)) {
                continue;
            }
            $out[] = [
                'path' => $itemRel,
                'name' => $item->getFilename(),
                'type' => $item->isDir() ? 'dir' : 'file',
                'size' => $item->isDir() ? 0 : ($item->getSize() ?: 0),
                'extension' => $item->isDir() ? '' : self::extname($item->getFilename()),
                'modified' => $item->getMTime() ?: 0,
            ];
            if (count($out) >= $limit) {
                break;
            }
        }
        usort($out, static fn(array $a, array $b): int => strcmp($a['path'], $b['path']));
        return $out;
    }

    /** Nested tree structure for the file explorer. */
    public static function buildTree(string $rootAbs, string $rel = '', int $depth = 0, int $maxDepth = 12): array
    {
        $nodes = [];
        foreach (self::listDir($rootAbs, $rel) as $entry) {
            $node = $entry;
            if ($entry['type'] === 'dir') {
                $node['children'] = $depth < $maxDepth
                    ? self::buildTree($rootAbs, $entry['path'], $depth + 1, $maxDepth)
                    : [];
            }
            $nodes[] = $node;
        }
        return $nodes;
    }

    // ----------------------------------------------------------- previews

    public static function parseCsv(string $text, string $delimiter = ','): array
    {
        $rows = [];
        $row = [];
        $field = '';
        $inQuotes = false;
        $len = strlen($text);
        for ($i = 0; $i < $len; $i++) {
            $ch = $text[$i];
            if ($inQuotes) {
                if ($ch === '"') {
                    if (($text[$i + 1] ?? '') === '"') {
                        $field .= '"';
                        $i++;
                    } else {
                        $inQuotes = false;
                    }
                } else {
                    $field .= $ch;
                }
                continue;
            }
            if ($ch === '"') {
                $inQuotes = true;
            } elseif ($ch === $delimiter) {
                $row[] = $field;
                $field = '';
            } elseif ($ch === "\n") {
                $row[] = $field;
                $rows[] = $row;
                $row = [];
                $field = '';
            } elseif ($ch !== "\r") {
                $field .= $ch;
            }
        }
        if ($field !== '' || $row) {
            $row[] = $field;
            $rows[] = $row;
        }
        return $rows;
    }

    /**
     * Build the preview payload consumed by the SPA. Shape must stay identical
     * to the Python/Workers versions.
     */
    public static function buildPreview(string $rootAbs, string $path, string $rawUrlBase): array
    {
        $rel = self::normalizeRel($path);
        $abs = $rel === '' ? $rootAbs : $rootAbs . '/' . $rel;

        if (is_dir($abs)) {
            return [
                'path' => $path,
                'filename' => self::basename($rel) ?: '.',
                'isDir' => true,
                'type' => 'dir',
                'items' => self::listDir($rootAbs, $rel),
            ];
        }
        if (!is_file($abs)) {
            throw new HttpError(404, 'File not found');
        }

        $suffix = self::extname($rel);
        $size = (int) (filesize($abs) ?: 0);
        $mime = self::mimeType($rel);
        $isExecutable = in_array($suffix, self::EXEC_EXT, true);

        $previewType = 'code';
        $contentText = null;
        $base64 = null;
        $csvData = null;

        if (in_array($suffix, self::IMAGE_EXT, true)) {
            $previewType = 'image';
            $base64 = base64_encode(self::read($abs));
        } elseif ($suffix === '.pdf') {
            $previewType = 'pdf';
        } elseif (in_array($suffix, self::AUDIO_EXT, true)) {
            $previewType = 'audio';
        } elseif (in_array($suffix, self::VIDEO_EXT, true)) {
            $previewType = 'video';
        } elseif (in_array($suffix, ['.html', '.htm'], true)) {
            $previewType = 'html';
            $contentText = self::read($abs);
        } elseif (in_array($suffix, ['.md', '.markdown'], true)) {
            $previewType = 'markdown';
            $contentText = self::read($abs);
        } elseif (in_array($suffix, ['.csv', '.tsv'], true)) {
            $previewType = 'csv';
            $contentText = self::read($abs);
            $rows = self::parseCsv($contentText, $suffix === '.tsv' ? "\t" : ',');
            $csvData = [
                'headers' => $rows[0] ?? [],
                'rows' => count($rows) > 1 ? array_slice($rows, 1, 100) : [],
                'totalRows' => count($rows),
            ];
        } else {
            $decoded = self::read($abs);
            if (str_contains($decoded, "\0")) {
                $previewType = 'binary';
            } else {
                $contentText = $decoded;
            }
        }

        return [
            'path' => $path,
            'filename' => self::basename($rel),
            'size' => $size,
            'type' => $previewType,
            'mimeType' => $mime,
            'isExecutable' => $isExecutable,
            'content' => $contentText,
            'base64' => $base64,
            'csvData' => $csvData,
            'rawUrl' => $rawUrlBase . rawurlencode($path),
        ];
    }

    public static function humanSize(int|float $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $i = 0;
        $v = (float) $bytes;
        while ($v >= 1024 && $i < count($units) - 1) {
            $v /= 1024;
            $i++;
        }
        return ($i === 0 ? (string) (int) $v : number_format($v, 1)) . ' ' . $units[$i];
    }

    /** ZIP a directory tree (ZipArchive is a real extension here — no hand-rolled writer). */
    public static function zipDirectory(string $rootAbs, string $zipPath, string $subRel = ''): int
    {
        if (!class_exists('ZipArchive')) {
            throw new HttpError(501, 'The zip extension is not enabled on this host');
        }
        $zip = new \ZipArchive();
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            throw new HttpError(500, 'Unable to create archive');
        }
        $count = 0;
        foreach (self::listRecursive($rootAbs, $subRel) as $entry) {
            if ($entry['type'] === 'dir') {
                $zip->addEmptyDir($entry['path']);
                continue;
            }
            $zip->addFile($rootAbs . '/' . $entry['path'], $entry['path']);
            $count++;
        }
        $zip->close();
        return $count;
    }

    public static function unzip(string $zipPath, string $destAbs): int
    {
        if (!class_exists('ZipArchive')) {
            throw new HttpError(501, 'The zip extension is not enabled on this host');
        }
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new HttpError(400, 'Invalid archive');
        }
        self::ensureDir($destAbs);
        $n = $zip->numFiles;
        $zip->extractTo($destAbs);
        $zip->close();
        return $n;
    }
}
