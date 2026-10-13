<?php

namespace App\Services\Scraping;

/**
 * پورتِ وفادارِ cssToXpath() / cssStepToXpath() / xpClassCond() / xpLit()
 * از scraper4.php (شامل اصلاحات v9.85..v9.87 و v8.56).
 *
 *  • گروهِ کامایی: هر شاخه جدا ترجمه و با | وصل می‌شود
 *  • ترکیب‌گرِ فرزندی « > » پشتیبانی می‌شود؛ « + » و « ~ » نه (سلکتور باطل)
 *  • تحلیلگرِ گام: tag / .class / #id / [attr] / [attr=val] / [*=] / [^=] / [$=]
 *    و شبه‌کلاس‌های nth-child(n) / first-child / last-child
 *  • strictClass: تطبیقِ کلاسِ دقیق (بین دو فاصله) مثل مرورگر، وگرنه contains
 */
class CssToXpath
{
    public static function convert(string $css, bool $strictClass = false): string
    {
        $css = trim($css);
        if ($css === '') {
            return '';
        }

        // گروه: هر شاخه جدا ترجمه و با | به هم وصل می‌شود
        if (strpos($css, ',') !== false) {
            $out = [];
            foreach (explode(',', $css) as $branch) {
                $branch = trim($branch);
                if ($branch === '') {
                    continue;
                }
                $one = self::convert($branch, $strictClass);
                if ($one === '') {
                    return '';   // یک شاخهٔ نامفهوم کل گروه را باطل می‌کند
                }
                $out[] = $one;
            }
            return $out ? implode(' | ', $out) : '';
        }

        // + و ~ پشتیبانی نمی‌شوند
        if (preg_match('/[+~]/', $css)) {
            return '';
        }
        $norm = preg_replace('~\s*>\s*~', ' > ', $css) ?? $css;
        $tokens = preg_split('~\s+~', trim($norm), -1, PREG_SPLIT_NO_EMPTY);
        if (!$tokens) {
            return '';
        }

        $xpath = '';
        $axis = '//';
        foreach ($tokens as $tok) {
            if ($tok === '>') {
                $axis = '/';
                continue;
            }
            $stepXp = self::step($tok, $strictClass);
            if ($stepXp === '') {
                return '';
            }
            $xpath .= $axis . $stepXp;
            $axis = '//';
        }
        return $xpath;
    }

    /** شرط تطبیقِ کلاس — دقیق (مرورگری) یا شامل */
    public static function classCond(string $class, bool $strict): string
    {
        return $strict
            ? "contains(concat(' ',normalize-space(@class),' '),' " . $class . " ')"
            : "contains(@class,'" . $class . "')";
    }

    /** لیترالِ امنِ XPath 1.0 (بدون کاراکتر گریز — برای ' و " با concat) */
    public static function literal(string $s): string
    {
        if (strpos($s, "'") === false) {
            return "'" . $s . "'";
        }
        if (strpos($s, '"') === false) {
            return '"' . $s . '"';
        }
        return "concat('" . str_replace("'", "',\"'\",'", $s) . "')";
    }

    protected static function step(string $step, bool $strictClass): string
    {
        $step = trim($step);
        if ($step === '') {
            return '';
        }
        if ($step === '*') {
            return '*';
        }

        $tag = '*';
        $conds = [];
        $i = 0;
        $len = strlen($step);

        if (preg_match('~^([A-Za-z][\w-]*)~', $step, $m)) {
            $tag = strtolower($m[1]);
            $i = strlen($m[1]);
        }

        while ($i < $len) {
            $rest = substr($step, $i);
            $ch = $step[$i];

            if ($ch === '.') {
                if (!preg_match('~^\.([\w-]+)~', $rest, $m)) {
                    return '';
                }
                $conds[] = self::classCond($m[1], $strictClass);
                $i += strlen($m[0]);
                continue;
            }

            if ($ch === '#') {
                if (!preg_match('~^#([\w:-]+)~', $rest, $m)) {
                    return '';
                }
                $conds[] = '@id=' . self::literal($m[1]);
                $i += strlen($m[0]);
                continue;
            }

            if ($ch === '[') {
                $close = strpos($step, ']', $i);
                if ($close === false) {
                    return '';
                }
                $inner = substr($step, $i + 1, $close - $i - 1);
                $i = $close + 1;
                if (!preg_match('~^\s*([\w:.-]+)\s*(?:([*^$]?=)\s*(.*?))?\s*$~', $inner, $m)) {
                    return '';
                }
                $attr = '@' . $m[1];
                if (!isset($m[2]) || $m[2] === '') {
                    $conds[] = $attr;
                    continue;
                }
                $val = trim($m[3]);
                if (mb_strlen($val) >= 2) {
                    $q0 = mb_substr($val, 0, 1);
                    $q1 = mb_substr($val, -1);
                    if (($q0 === '"' && $q1 === '"') || ($q0 === "'" && $q1 === "'")) {
                        $val = mb_substr($val, 1, -1);
                    }
                }
                $lit = self::literal($val);
                if ($m[2] === '=') {
                    $conds[] = $attr . '=' . $lit;
                } elseif ($m[2] === '*=') {
                    $conds[] = 'contains(' . $attr . ',' . $lit . ')';
                } elseif ($m[2] === '^=') {
                    $conds[] = 'starts-with(' . $attr . ',' . $lit . ')';
                } elseif ($m[2] === '$=') {
                    // XPath 1.0 ends-with ندارد؛ با substring ساخته می‌شود
                    $n = mb_strlen($val);
                    $conds[] = 'substring(' . $attr . ',string-length(' . $attr . ')-' . ($n - 1) . ')=' . $lit;
                } else {
                    return '';
                }
                continue;
            }

            if ($ch === ':') {
                if (preg_match('~^::?nth-child\((\d+)\)~', $rest, $m)) {
                    $conds[] = 'count(preceding-sibling::*)=' . ((int) $m[1] - 1);
                    $i += strlen($m[0]);
                    continue;
                }
                if (preg_match('~^::?first-child~', $rest, $m)) {
                    $conds[] = 'count(preceding-sibling::*)=0';
                    $i += strlen($m[0]);
                    continue;
                }
                if (preg_match('~^::?last-child~', $rest, $m)) {
                    $conds[] = 'count(following-sibling::*)=0';
                    $i += strlen($m[0]);
                    continue;
                }
                return '';   // :hover، :not(...) و بقیه — ترجمه نمی‌شوند
            }

            return '';       // کاراکتر ناشناخته
        }

        return $conds ? $tag . '[' . implode(' and ', $conds) . ']' : $tag;
    }
}
