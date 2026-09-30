<?php

/**
 * Unified diffs.
 *
 * The agent edits files, and nobody should approve an edit they cannot see.
 * This produces the same text `diff -u` would, from pure PHP, so reviewing a
 * proposed change needs no external binary.
 */

declare(strict_types=1);

namespace Arena;

final class Diff
{
    /** Lines of context kept either side of a change. */
    private const CONTEXT = 3;

    /**
     * Above this many lines the quadratic LCS is abandoned in favour of a
     * whole-file replacement. A 5,000-line file would otherwise mean 25
     * million cells, which is slow enough to look like a hang.
     */
    private const MAX_LCS_LINES = 4000;

    /** Unified diff between two strings. Empty when they are identical. */
    public static function unified(string $before, string $after, string $path = 'file'): string
    {
        if ($before === $after) {
            return '';
        }

        $a = self::lines($before);
        $b = self::lines($after);
        $head = "--- a/{$path}\n+++ b/{$path}\n";

        if (count($a) > self::MAX_LCS_LINES || count($b) > self::MAX_LCS_LINES) {
            return $head . sprintf(
                "@@ -1,%d +1,%d @@\n%s%s",
                count($a),
                count($b),
                self::prefixAll($a, '-'),
                self::prefixAll($b, '+')
            );
        }

        $ops = self::operations($a, $b);
        $hunks = self::hunks($ops);
        if ($hunks === []) {
            return '';
        }

        $out = $head;
        foreach ($hunks as $h) {
            $out .= sprintf(
                "@@ -%d,%d +%d,%d @@\n",
                $h['aStart'], $h['aCount'], $h['bStart'], $h['bCount']
            );
            foreach ($h['lines'] as $line) {
                $out .= $line . "\n";
            }
        }
        return $out;
    }

    /** How many lines a change adds and removes. @return array{added:int,removed:int} */
    public static function stat(string $before, string $after): array
    {
        if ($before === $after) {
            return ['added' => 0, 'removed' => 0];
        }
        $a = self::lines($before);
        $b = self::lines($after);
        if (count($a) > self::MAX_LCS_LINES || count($b) > self::MAX_LCS_LINES) {
            return ['added' => count($b), 'removed' => count($a)];
        }
        $added = 0;
        $removed = 0;
        foreach (self::operations($a, $b) as $op) {
            if ($op[0] === '+') {
                $added++;
            } elseif ($op[0] === '-') {
                $removed++;
            }
        }
        return ['added' => $added, 'removed' => $removed];
    }

    /** @return array<int,string> */
    private static function lines(string $s): array
    {
        if ($s === '') {
            return [];
        }
        // A trailing newline terminates the last line rather than starting a
        // new empty one; without this every diff reports a spurious change.
        return explode("\n", str_replace("\r\n", "\n", rtrim($s, "\n")));
    }

    /** @param array<int,string> $lines */
    private static function prefixAll(array $lines, string $sign): string
    {
        return $lines === [] ? '' : $sign . implode("\n" . $sign, $lines) . "\n";
    }

    /**
     * Longest common subsequence, then a walk back through the table to turn
     * it into a list of [sign, text] operations.
     *
     * @param array<int,string> $a
     * @param array<int,string> $b
     * @return array<int,array{0:string,1:string}>
     */
    private static function operations(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);

        // Trim the common head and tail first. Most edits touch a few lines in
        // a long file, and this turns that into a tiny table.
        $head = 0;
        while ($head < $n && $head < $m && $a[$head] === $b[$head]) {
            $head++;
        }
        $tail = 0;
        while ($tail < $n - $head && $tail < $m - $head
               && $a[$n - $tail - 1] === $b[$m - $tail - 1]) {
            $tail++;
        }
        $midA = array_slice($a, $head, $n - $head - $tail);
        $midB = array_slice($b, $head, $m - $head - $tail);

        $ops = [];
        for ($i = 0; $i < $head; $i++) {
            $ops[] = [' ', $a[$i]];
        }
        foreach (self::lcsOps($midA, $midB) as $op) {
            $ops[] = $op;
        }
        for ($i = $n - $tail; $i < $n; $i++) {
            $ops[] = [' ', $a[$i]];
        }
        return $ops;
    }

    /**
     * @param array<int,string> $a
     * @param array<int,string> $b
     * @return array<int,array{0:string,1:string}>
     */
    private static function lcsOps(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        if ($n === 0 && $m === 0) {
            return [];
        }
        if ($n === 0) {
            return array_map(static fn(string $l): array => ['+', $l], $b);
        }
        if ($m === 0) {
            return array_map(static fn(string $l): array => ['-', $l], $a);
        }

        $table = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));
        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                $table[$i][$j] = $a[$i] === $b[$j]
                    ? $table[$i + 1][$j + 1] + 1
                    : max($table[$i + 1][$j], $table[$i][$j + 1]);
            }
        }

        $ops = [];
        $i = 0;
        $j = 0;
        while ($i < $n && $j < $m) {
            if ($a[$i] === $b[$j]) {
                $ops[] = [' ', $a[$i]];
                $i++;
                $j++;
            } elseif ($table[$i + 1][$j] >= $table[$i][$j + 1]) {
                $ops[] = ['-', $a[$i]];
                $i++;
            } else {
                $ops[] = ['+', $b[$j]];
                $j++;
            }
        }
        while ($i < $n) {
            $ops[] = ['-', $a[$i++]];
        }
        while ($j < $m) {
            $ops[] = ['+', $b[$j++]];
        }
        return $ops;
    }

    /**
     * Group operations into hunks, dropping runs of unchanged lines that are
     * further than CONTEXT from any change.
     *
     * @param array<int,array{0:string,1:string}> $ops
     * @return array<int,array{aStart:int,aCount:int,bStart:int,bCount:int,lines:array<int,string>}>
     */
    private static function hunks(array $ops): array
    {
        $changed = [];
        foreach ($ops as $k => $op) {
            if ($op[0] !== ' ') {
                $changed[] = $k;
            }
        }
        if ($changed === []) {
            return [];
        }

        // Merge nearby changes into ranges that share their context.
        $ranges = [];
        $start = $changed[0];
        $end = $changed[0];
        foreach (array_slice($changed, 1) as $k) {
            if ($k - $end <= self::CONTEXT * 2) {
                $end = $k;
            } else {
                $ranges[] = [$start, $end];
                $start = $end = $k;
            }
        }
        $ranges[] = [$start, $end];

        $hunks = [];
        foreach ($ranges as [$from, $to]) {
            $from = max(0, $from - self::CONTEXT);
            $to = min(count($ops) - 1, $to + self::CONTEXT);

            // Line numbers are 1-based and count only the side each belongs to.
            $aLine = 1;
            $bLine = 1;
            for ($k = 0; $k < $from; $k++) {
                if ($ops[$k][0] !== '+') {
                    $aLine++;
                }
                if ($ops[$k][0] !== '-') {
                    $bLine++;
                }
            }

            $lines = [];
            $aCount = 0;
            $bCount = 0;
            for ($k = $from; $k <= $to; $k++) {
                [$sign, $text] = $ops[$k];
                $lines[] = $sign . $text;
                if ($sign !== '+') {
                    $aCount++;
                }
                if ($sign !== '-') {
                    $bCount++;
                }
            }

            $hunks[] = [
                'aStart' => $aCount === 0 ? $aLine - 1 : $aLine,
                'aCount' => $aCount,
                'bStart' => $bCount === 0 ? $bLine - 1 : $bLine,
                'bCount' => $bCount,
                'lines' => $lines,
            ];
        }
        return $hunks;
    }
}
