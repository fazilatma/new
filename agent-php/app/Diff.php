<?php
/**
 * Unified-diff engine — PHP replacement for Python's `difflib.unified_diff`
 * used by agent-python/app/changesets.py. Output is byte-compatible with
 * difflib for the cases the app relies on:
 *   --- a/<file> / +++ b/<file> / @@ -l,s +l,s @@  with 3 lines of context.
 */

declare(strict_types=1);

namespace Arena;

final class Diff
{
    private const CELL_LIMIT = 4000000;

    /** Like Python's str.splitlines(keepends=True). */
    public static function splitLinesKeepEnds(string $text): array
    {
        if ($text === '') {
            return [];
        }
        $out = [];
        $start = 0;
        $len = strlen($text);
        for ($i = 0; $i < $len; $i++) {
            $ch = $text[$i];
            if ($ch === "\n") {
                $out[] = substr($text, $start, $i + 1 - $start);
                $start = $i + 1;
            } elseif ($ch === "\r") {
                if (($text[$i + 1] ?? '') === "\n") {
                    $out[] = substr($text, $start, $i + 2 - $start);
                    $i++;
                } else {
                    $out[] = substr($text, $start, $i + 1 - $start);
                }
                $start = $i + 1;
            }
        }
        if ($start < $len) {
            $out[] = substr($text, $start);
        }
        return $out;
    }

    /** @return array<int, array{0:string,1:int,2:int,3:int,4:int}> */
    private static function computeOpcodes(array $a, array $b): array
    {
        $na = count($a);
        $nb = count($b);
        $ops = [];

        $pre = 0;
        while ($pre < $na && $pre < $nb && $a[$pre] === $b[$pre]) {
            $pre++;
        }
        $suf = 0;
        while ($suf < $na - $pre && $suf < $nb - $pre && $a[$na - 1 - $suf] === $b[$nb - 1 - $suf]) {
            $suf++;
        }

        if ($pre > 0) {
            $ops[] = ['equal', 0, $pre, 0, $pre];
        }

        $aMid = array_slice($a, $pre, $na - $suf - $pre);
        $bMid = array_slice($b, $pre, $nb - $suf - $pre);

        if ($aMid || $bMid) {
            foreach (self::lcsOpcodes($aMid, $bMid) as $op) {
                $ops[] = [$op[0], $op[1] + $pre, $op[2] + $pre, $op[3] + $pre, $op[4] + $pre];
            }
        }
        if ($suf > 0) {
            $ops[] = ['equal', $na - $suf, $na, $nb - $suf, $nb];
        }
        return self::mergeOpcodes($ops);
    }

    private static function mergeOpcodes(array $ops): array
    {
        $out = [];
        foreach ($ops as $op) {
            if ($op[1] === $op[2] && $op[3] === $op[4]) {
                continue;
            }
            $lastIdx = count($out) - 1;
            if ($lastIdx >= 0 && $out[$lastIdx][0] === $op[0]
                && $out[$lastIdx][2] === $op[1] && $out[$lastIdx][4] === $op[3]) {
                $out[$lastIdx][2] = $op[2];
                $out[$lastIdx][4] = $op[4];
            } else {
                $out[] = $op;
            }
        }
        return $out;
    }

    private static function lcsOpcodes(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        if ($n === 0 && $m === 0) {
            return [];
        }
        if ($n === 0) {
            return [['insert', 0, 0, 0, $m]];
        }
        if ($m === 0) {
            return [['delete', 0, $n, 0, 0]];
        }
        if ($n * $m > self::CELL_LIMIT) {
            return [['replace', 0, $n, 0, $m]];
        }

        // dp[i][j] = LCS length of a[i:], b[j:]
        $dp = [];
        $dp[$n] = array_fill(0, $m + 1, 0);
        for ($i = $n - 1; $i >= 0; $i--) {
            $row = array_fill(0, $m + 1, 0);
            $next = $dp[$i + 1];
            $ai = $a[$i];
            for ($j = $m - 1; $j >= 0; $j--) {
                $row[$j] = ($ai === $b[$j])
                    ? $next[$j + 1] + 1
                    : max($next[$j], $row[$j + 1]);
            }
            $dp[$i] = $row;
        }

        $ops = [];
        $i = 0;
        $j = 0;
        $pendA = 0;
        $pendB = 0;
        $eqStartA = -1;

        $flush = static function () use (&$ops, &$pendA, &$pendB, &$i, &$j): void {
            if ($pendA > 0 && $pendB > 0) {
                $ops[] = ['replace', $i - $pendA, $i, $j - $pendB, $j];
            } elseif ($pendA > 0) {
                $ops[] = ['delete', $i - $pendA, $i, $j, $j];
            } elseif ($pendB > 0) {
                $ops[] = ['insert', $i, $i, $j - $pendB, $j];
            }
            $pendA = 0;
            $pendB = 0;
        };

        while ($i < $n && $j < $m) {
            if ($a[$i] === $b[$j]) {
                $flush();
                if ($eqStartA < 0) {
                    $eqStartA = $i;
                }
                $i++;
                $j++;
            } else {
                if ($eqStartA >= 0) {
                    $ops[] = ['equal', $eqStartA, $i, $j - ($i - $eqStartA), $j];
                    $eqStartA = -1;
                }
                if ($dp[$i + 1][$j] >= $dp[$i][$j + 1]) {
                    $i++;
                    $pendA++;
                } else {
                    $j++;
                    $pendB++;
                }
            }
        }
        if ($eqStartA >= 0) {
            $ops[] = ['equal', $eqStartA, $i, $j - ($i - $eqStartA), $j];
        }
        $flush();
        if ($i < $n || $j < $m) {
            if ($i < $n && $j < $m) {
                $ops[] = ['replace', $i, $n, $j, $m];
            } elseif ($i < $n) {
                $ops[] = ['delete', $i, $n, $j, $j];
            } else {
                $ops[] = ['insert', $i, $i, $j, $m];
            }
        }
        return self::mergeOpcodes($ops);
    }

    /** difflib.SequenceMatcher.get_grouped_opcodes. */
    private static function groupOpcodes(array $ops, int $n = 3): array
    {
        if (!$ops) {
            return [];
        }
        $codes = $ops;
        if ($codes[0][0] === 'equal') {
            [$tag, $i1, $i2, $j1, $j2] = $codes[0];
            $codes[0] = [$tag, max($i1, $i2 - $n), $i2, max($j1, $j2 - $n), $j2];
        }
        $lastIdx = count($codes) - 1;
        if ($codes[$lastIdx][0] === 'equal') {
            [$tag, $i1, $i2, $j1, $j2] = $codes[$lastIdx];
            $codes[$lastIdx] = [$tag, $i1, min($i2, $i1 + $n), $j1, min($j2, $j1 + $n)];
        }

        $nn = $n + $n;
        $groups = [];
        $group = [];
        foreach ($codes as $code) {
            [$tag, $i1, $i2, $j1, $j2] = $code;
            if ($tag === 'equal' && $i2 - $i1 > $nn) {
                $group[] = [$tag, $i1, min($i2, $i1 + $n), $j1, min($j2, $j1 + $n)];
                $groups[] = $group;
                $group = [];
                $i1 = max($i1, $i2 - $n);
                $j1 = max($j1, $j2 - $n);
            }
            $group[] = [$tag, $i1, $i2, $j1, $j2];
        }
        if ($group && !(count($group) === 1 && $group[0][0] === 'equal')) {
            $groups[] = $group;
        }
        return $groups;
    }

    private static function rangeStr(int $start, int $stop): string
    {
        $length = $stop - $start;
        $begin = $length ? $start + 1 : $start;
        return $length === 1 ? (string) $begin : "{$begin},{$length}";
    }

    /** Port of changesets.compute_diff. */
    public static function compute(string $oldContent, string $newContent, string $filename): string
    {
        if ($oldContent === $newContent) {
            return '';
        }
        $a = self::splitLinesKeepEnds($oldContent);
        $b = self::splitLinesKeepEnds($newContent);
        $groups = self::groupOpcodes(self::computeOpcodes($a, $b), 3);
        if (!$groups) {
            return '';
        }

        $out = ["--- a/{$filename}\n", "+++ b/{$filename}\n"];
        foreach ($groups as $group) {
            $first = $group[0];
            $last = $group[count($group) - 1];
            $out[] = '@@ -' . self::rangeStr($first[1], $last[2])
                . ' +' . self::rangeStr($first[3], $last[4]) . " @@\n";
            foreach ($group as [$tag, $i1, $i2, $j1, $j2]) {
                if ($tag === 'equal') {
                    foreach (array_slice($a, $i1, $i2 - $i1) as $line) {
                        $out[] = ' ' . $line;
                    }
                    continue;
                }
                if ($tag === 'replace' || $tag === 'delete') {
                    foreach (array_slice($a, $i1, $i2 - $i1) as $line) {
                        $out[] = '-' . $line;
                    }
                }
                if ($tag === 'replace' || $tag === 'insert') {
                    foreach (array_slice($b, $j1, $j2 - $j1) as $line) {
                        $out[] = '+' . $line;
                    }
                }
            }
        }
        return implode('', $out);
    }

    /** Port of changesets.parse_diff_hunks. */
    public static function parseHunks(string $diffText): array
    {
        $lines = explode("\n", $diffText);
        $hunks = [];
        $current = null;
        $idx = 0;
        foreach ($lines as $line) {
            if (str_starts_with($line, '@@')) {
                if ($current !== null) {
                    $hunks[] = $current;
                }
                $idx++;
                $current = ['index' => $idx, 'header' => $line, 'lines' => [], 'status' => 'pending'];
            } elseif ($current !== null) {
                $kind = 'context';
                if (str_starts_with($line, '+')) {
                    $kind = 'add';
                } elseif (str_starts_with($line, '-')) {
                    $kind = 'del';
                }
                $current['lines'][] = ['text' => $line, 'type' => $kind];
            }
        }
        if ($current !== null) {
            $hunks[] = $current;
        }
        return $hunks;
    }

    /** Stats used by the changeset list UI. */
    public static function stats(string $diffText): array
    {
        $additions = 0;
        $deletions = 0;
        foreach (explode("\n", $diffText) as $line) {
            if (str_starts_with($line, '+') && !str_starts_with($line, '+++')) {
                $additions++;
            } elseif (str_starts_with($line, '-') && !str_starts_with($line, '---')) {
                $deletions++;
            }
        }
        return ['additions' => $additions, 'deletions' => $deletions];
    }
}
