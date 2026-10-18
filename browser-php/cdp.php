<?php
/**
 * کلاینتِ خامِ WebSocket و Chrome DevTools Protocol با PHP خالص
 * ------------------------------------------------------------------
 * بدون phpunit/composer/node/python/java. همان کاری که «پلی‌رایت» پشتِ
 * صحنه انجام می‌دهد: حرف‌زدن با کرومیوم از طریق CDP — این‌جا خودمان
 * پیاده‌سازی کرده‌ایم چون تنها پیش‌نیاز، خودِ PHP است.
 *
 * سازگار با PHP 7.3+ (بدون str_contains/arrow-fn/match).
 */

class CdpWs {
    /** @var resource */
    private $sock;
    private $timeoutSec;

    public function __construct(string $host, int $port, string $path, int $timeoutSec = 15) {
        $this->timeoutSec = $timeoutSec;
        $errno = 0; $errstr = '';
        $s = @fsockopen($host, $port, $errno, $errstr, $timeoutSec);
        if (!$s) {
            throw new Exception("websocket connect failed: $errstr ($errno)");
        }
        stream_set_timeout($s, $timeoutSec);
        stream_set_blocking($s, true);
        $key = base64_encode(random_bytes(16));
        $req = "GET $path HTTP/1.1\r\n"
             . "Host: $host:$port\r\n"
             . "Upgrade: websocket\r\n"
             . "Connection: Upgrade\r\n"
             . "Sec-WebSocket-Key: $key\r\n"
             . "Sec-WebSocket-Version: 13\r\n\r\n";
        fwrite($s, $req);
        $hdr = '';
        $guard = 0;
        while (true) {
            $line = fgets($s);
            if ($line === false) { fclose($s); throw new Exception('ws handshake: no HTTP response'); }
            if ($line === "\r\n" || $line === "\n") break;
            $hdr .= $line;
            if (++$guard > 200) { fclose($s); throw new Exception('ws handshake: header flood'); }
        }
        if (strpos($hdr, ' 101') === false) {
            fclose($s);
            throw new Exception('ws handshake rejected: ' . trim(str_replace("\r", ' ', $hdr)));
        }
        $this->sock = $s;
    }

    public function close(): void {
        if ($this->sock) {
            @fwrite($this->sock, chr(0x88) . chr(0x80) . random_bytes(4)); // فریم close
            @fclose($this->sock);
            $this->sock = null;
        }
    }

    /** @return string|null */
    private function readN(int $n) {
        $out = '';
        $guard = 0;
        while (strlen($out) < $n) {
            $chunk = fread($this->sock, $n - strlen($out));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($this->sock);
                if (!empty($meta['timed_out'])) return null;
                if (feof($this->sock)) return null;
                if (++$guard > 100000) return null;
                continue;
            }
            $out .= $chunk;
        }
        return $out;
    }

    /** تایم‌اوتِ خواندن/نوشتن را بعد از اتصال هم می‌توان عوض کرد */
    public function setTimeout(int $sec): void {
        if ($this->sock) stream_set_timeout($this->sock, $sec);
    }

    public function sendText(string $payload): void {
        $mask = random_bytes(4);
        $len  = strlen($payload);
        $head = chr(0x81);                    // FIN | text
        if ($len < 126) {
            $head .= chr(0x80 | $len);
        } elseif ($len < 65536) {
            $head .= chr(0x80 | 126) . pack('n', $len);
        } else {
            $hi = intdiv($len, 2147483648);
            $lo = $len % 2147483648;
            $head .= chr(0x80 | 127) . pack('NN', $hi, $lo);
        }
        $masked = '';
        for ($i = 0; $i < $len; $i++) {
            $masked .= $payload[$i] ^ $mask[$i % 4];
        }
        $written = 0;
        $buf = $head . $mask . $masked;
        $total = strlen($buf);
        while ($written < $total) {
            $w = fwrite($this->sock, substr($buf, $written));
            if ($w === false || $w === 0) throw new Exception('ws write failed');
            $written += $w;
        }
    }

    /**
     * یک پیامِ کامل متنی می‌خواند (فریم‌های تکه‌تکه را می‌چسباند).
     * به ping با pong جواب می‌دهد؛ frameهای کنترلی دیگر را رد می‌کند.
     * @return string|null
     */
    public function recvMessage() {
        $payload = '';
        while (true) {
            $hdr = $this->readN(2);
            if ($hdr === null) return null;
            $b1 = ord($hdr[0]); $b2 = ord($hdr[1]);
            $fin = ($b1 & 0x80) !== 0;
            $op  = $b1 & 0x0f;
            $masked = ($b2 & 0x80) !== 0;
            $len = $b2 & 0x7f;
            if ($len === 126) {
                $e = $this->readN(2); if ($e === null) return null;
                $n = unpack('n', $e); $len = $n[1];
            } elseif ($len === 127) {
                $e = $this->readN(8); if ($e === null) return null;
                $n = unpack('N2', $e); $len = $n[1] * 2147483648 + $n[2];
            }
            if ($len > 64 * 1024 * 1024) return null;      // سقفِ ایمنی
            $mask = $masked ? $this->readN(4) : null;
            if ($masked && $mask === null) return null;
            $data = $len > 0 ? $this->readN($len) : '';
            if ($data === null) return null;
            if ($mask !== null) {
                $tmp = '';
                $ln = strlen($data);
                for ($i = 0; $i < $ln; $i++) $tmp .= $data[$i] ^ $mask[$i % 4];
                $data = $tmp;
            }
            if ($op === 0x8) return null;                   // close
            if ($op === 0x9) {                              // ping → pong
                $this->SendControl(0xA, $data);
                continue;
            }
            if ($op === 0x1 || $op === 0x2 || $op === 0x0) {
                $payload .= $data;
                if ($fin) return $payload;
            }
        }
    }

    private function sendControl(int $opcode, string $payload): void {
        // فریم‌های کنترلی <۱۲۶ بایت‌اند
        $mask = random_bytes(4);
        $masked = '';
        $ln = strlen($payload);
        for ($i = 0; $i < $ln; $i++) $masked .= $payload[$i] ^ $mask[$i % 4];
        @fwrite($this->sock, chr(0x80 | $opcode) . chr(0x80 | $ln) . $mask . $masked);
    }
}

class CdpPage {
    /** @var CdpWs */
    private $ws;
    private int $nextId = 0;
    /** درخواست‌های درجریانِ شبکه برای تشخیص networkidle */
    public int $netInFlight = 0;
    /** تاریخچهٔ رویدادهای مهم برای دیباگ */
    public array $lastEvents = [];

    public function __construct(CdpWs $ws) { $this->ws = $ws; }
    public function cmd(string $method, array $params = [], int $timeoutSec = 30): array {
        $this->nextId++;
        $id = $this->nextId;
        $this->ws->sendText(json_encode([
            'id' => $id, 'method' => $method, 'params' => (object)$params,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $deadline = microtime(true) + $timeoutSec;
        while (true) {
            $left = $deadline - microtime(true);
            if ($left <= 0) throw new Exception("CDP timeout on $method");
            $msg = $this->ws->recvMessage();
            if ($msg === null) {
                if (microtime(true) < $deadline) { usleep(50000); continue; }
                throw new Exception("CDP read failed on $method (socket closed/timeout)");
            }
            $j = json_decode($msg, true);
            if (!is_array($j)) continue;
            if (isset($j['id']) && $j['id'] === $id) {
                if (isset($j['error'])) {
                    throw new Exception("CDP error on $method: " . ($j['error']['message'] ?? 'unknown'));
                }
                return $j;
            }
            $this->trackEvent($j);
        }
    }

    /** تا رسیدنِ پاسخِ دستور بعدی، رویدادهای شبکه را شمارش می‌کند */
    private function trackEvent(array $j): void {
        $ev = isset($j['method']) ? (string)$j['method'] : '';
        if ($ev !== '') {
            $this->lastEvents[] = $ev;
            if (count($this->lastEvents) > 40) array_shift($this->lastEvents);
        }
        if (!isset($j['params'])) return;
        $p = $j['params'];
        // رویدادهای Network.* یک requestId واحد دارند
        $rid = isset($p['requestId']) ? (string)$p['requestId'] : '';
        static $seen = [];
        if ($ev === 'Network.requestWillBeSent' && $rid !== '') {
            $seen[$rid] = true; $this->netInFlight = count($seen);
        } elseif (($ev === 'Network.loadingFinished' || $ev === 'Network.loadingFailed') && $rid !== '') {
            unset($seen[$rid]); $this->netInFlight = count($seen);
        }
    }

    /** مقدار یک عبارت جاوااسکریپت را با returnByValue می‌گیرد */
    public function eval(string $expression, int $timeoutSec = 30) {
        $r = $this->cmd('Runtime.evaluate', [
            'expression'    => $expression,
            'returnByValue' => true,
            'awaitPromise'  => false,
        ], $timeoutSec);
        $res = $r['result']['result'] ?? [];
        return $res['value'] ?? null;
    }

    /** در انتظارِ readyState می‌ماند؛ خروجی: 'interactive'|'complete'|'' */
    public function waitReadyState(string $target, int $timeoutSec): string {
        $deadline = microtime(true) + $timeoutSec;
        $state = '';
        while (microtime(true) < $deadline) {
            try {
                $state = (string)$this->eval('document.readyState', 15);
            } catch (Exception $e) {
                // صفحه درحال جابه‌جایی است؛ فرصت بده
                usleep(200000); continue;
            }
            if ($target === 'domcontentloaded' && ($state === 'interactive' || $state === 'complete')) return $state;
            if ($target === 'load' && $state === 'complete') return $state;
            usleep(200000);
        }
        return $state;
    }

    /** تا آرام‌شدن شبکه (بدون درخواستِ درجریان به‌مدتِ quietMs) صبر می‌کند */
    public function waitNetworkIdle(int $timeoutSec, int $quietMs = 600): void {
        $this->ws->setTimeout(1);            // خواندن ریز — تا آرام‌شدن را «ببینیم»
        $deadline = microtime(true) + $timeoutSec;
        $quietSince = $this->netInFlight <= 0 ? microtime(true) : null;
        while (microtime(true) < $deadline) {
            $msg = $this->ws->recvMessage(); // بیشتر از ۱ ثانیه نمی‌ایستد
            if ($msg !== null) {
                $j = json_decode($msg, true);
                if (is_array($j) && !isset($j['id'])) $this->trackEvent($j);
            }
            if ($this->netInFlight <= 0) {
                if ($quietSince === null) $quietSince = microtime(true);
                if ((microtime(true) - $quietSince) * 1000 >= $quietMs) break;
            } else {
                $quietSince = null;
            }
        }
        $this->ws->setTimeout(15);          // برگرداندن به حالت عادی
    }
}
