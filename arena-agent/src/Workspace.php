<?php

/**
 * Sandboxed file access under storage/workspaces.
 *
 * Every path is resolved and then checked to still be inside the root, so a
 * traversal attempt fails closed rather than being pattern-matched away.
 */

declare(strict_types=1);

namespace Arena;

final class Workspace
{
    private const MAX_EDIT_BYTES = 2 * 1024 * 1024;

    public static function root(): string
    {
        $root = Bootstrap::$storageDir . '/workspaces/default';
        if (!is_dir($root)) {
            @mkdir($root, 0775, true);
        }
        return $root;
    }

    /** Resolve a user-supplied relative path to an absolute one inside the root. */
    public static function resolve(string $relative): string
    {
        $root = self::root();
        $relative = str_replace('\\', '/', trim($relative));
        $relative = ltrim($relative, '/');
        if ($relative === '' || $relative === '.') {
            return $root;
        }
        if (str_contains($relative, "\0")) {
            throw new HttpError(400, 'Invalid path.');
        }
        // Resolve '.' and '..' lexically. realpath() cannot be used here: a
        // file being created does not exist yet, and neither does the folder
        // it is going into, so realpath() returns false for perfectly valid
        // new paths. Collapsing the segments ourselves also means a traversal
        // is rejected on its own merits rather than by luck of the filesystem.
        $segments = [];
        foreach (explode('/', $relative) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                if ($segments === []) {
                    throw new HttpError(400, 'That path is outside the workspace.');
                }
                array_pop($segments);
                continue;
            }
            $segments[] = $segment;
        }
        $full = $segments === [] ? $root : $root . '/' . implode('/', $segments);

        // Anything that already exists must also survive symlink resolution,
        // so a link planted inside the workspace cannot point out of it.
        $realRoot = realpath($root);
        if ($realRoot === false) {
            throw new HttpError(500, 'The workspace folder is missing.');
        }
        $existing = $full;
        while ($existing !== $root && !file_exists($existing)) {
            $existing = dirname($existing);
        }
        $real = realpath($existing);
        if ($real === false || ($real !== $realRoot && !str_starts_with($real . '/', $realRoot . '/'))) {
            throw new HttpError(400, 'That path is outside the workspace.');
        }
        return $full;
    }

    /** @return array<string,mixed> */
    public static function list(string $relative = ''): array
    {
        $dir = self::resolve($relative);
        if (!is_dir($dir)) {
            throw new HttpError(404, 'No such directory: ' . ($relative ?: '/'));
        }
        $items = [];
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = $dir . '/' . $name;
            $isDir = is_dir($path);
            $items[] = [
                'name' => $name,
                'path' => trim(($relative === '' ? '' : rtrim($relative, '/') . '/') . $name, '/'),
                'isDir' => $isDir,
                'size' => $isDir ? 0 : (int) @filesize($path),
                'modified' => gmdate('Y-m-d\TH:i:s\Z', (int) @filemtime($path)),
            ];
        }
        usort($items, static fn(array $a, array $b): int => [$b['isDir'], strtolower($a['name'])]
            <=> [$a['isDir'], strtolower($b['name'])]);
        return ['path' => trim($relative, '/'), 'items' => $items];
    }

    /** @return array<string,mixed> */
    public static function read(string $relative): array
    {
        $path = self::resolve($relative);
        if (!is_file($path)) {
            throw new HttpError(404, 'No such file: ' . $relative);
        }
        $size = (int) filesize($path);
        if ($size > self::MAX_EDIT_BYTES) {
            throw new HttpError(413, sprintf(
                'That file is %s; the editor handles up to %s.',
                self::humanSize($size), self::humanSize(self::MAX_EDIT_BYTES)
            ));
        }
        $content = (string) file_get_contents($path);
        $binary = $content !== '' && !mb_check_encoding($content, 'UTF-8');
        return [
            'path' => trim($relative, '/'),
            'size' => $size,
            'binary' => $binary,
            'content' => $binary ? '' : $content,
            'modified' => gmdate('Y-m-d\TH:i:s\Z', (int) @filemtime($path)),
        ];
    }

    /** @return array<string,mixed> */
    public static function write(string $relative, string $content): array
    {
        $path = self::resolve($relative);
        $dir = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new HttpError(500, 'Could not create the folder: ' . dirname(trim($relative, '/')));
        }
        if (file_exists($path) && !is_writable($path)) {
            throw new HttpError(403, 'That file is read-only on disk: ' . $relative);
        }
        if (!file_exists($path) && !is_writable($dir)) {
            throw new HttpError(403, 'The folder is not writable: ' . dirname(trim($relative, '/')));
        }
        if (@file_put_contents($path, $content, LOCK_EX) === false) {
            throw new HttpError(500, 'The write failed: ' . $relative);
        }
        return ['ok' => true, 'path' => trim($relative, '/'), 'size' => strlen($content)];
    }

    public static function mkdir(string $relative): array
    {
        $path = self::resolve($relative);
        if (is_dir($path)) {
            return ['ok' => true, 'path' => trim($relative, '/'), 'existed' => true];
        }
        if (!@mkdir($path, 0775, true) && !is_dir($path)) {
            throw new HttpError(500, 'Could not create: ' . $relative);
        }
        return ['ok' => true, 'path' => trim($relative, '/')];
    }

    public static function delete(string $relative): array
    {
        $path = self::resolve($relative);
        if ($path === self::root()) {
            throw new HttpError(400, 'The workspace root cannot be deleted.');
        }
        if (!file_exists($path)) {
            throw new HttpError(404, 'No such path: ' . $relative);
        }
        self::removeRecursive($path);
        return ['ok' => true, 'path' => trim($relative, '/')];
    }

    private static function removeRecursive(string $path): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach (scandir($path) ?: [] as $n) {
                if ($n !== '.' && $n !== '..') {
                    self::removeRecursive($path . '/' . $n);
                }
            }
            @rmdir($path);
            return;
        }
        @unlink($path);
    }

    public static function humanSize(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        $n = (float) $bytes;
        while ($n >= 1024 && $i < count($units) - 1) {
            $n /= 1024;
            $i++;
        }
        return ($i === 0 ? (string) $bytes : number_format($n, 1)) . ' ' . $units[$i];
    }
}
