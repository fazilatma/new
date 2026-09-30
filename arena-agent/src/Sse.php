<?php

/**
 * Server-sent events.
 *
 * Both the plain chat and the agent loop push events to the browser, so the
 * awkward parts — persuading intermediaries not to buffer, and flushing at
 * every level — live in one place.
 */

declare(strict_types=1);

namespace Arena;

final class Sse
{
    private static bool $open = false;

    /**
     * When set, events go here instead of to the browser and the output
     * buffers are left alone. Streaming normally has to dismantle every
     * buffer to get bytes out promptly, which also destroys any buffer a test
     * had set up to read them — so the test suite asks for them directly.
     *
     * @var null|callable(string,array<string,mixed>):void
     */
    public static $capture = null;

    public static function open(): void
    {
        if (self::$capture !== null) {
            self::$open = true;
            return;
        }
        if (self::$open) {
            return;
        }
        if (!Response::$started && !headers_sent()) {
            http_response_code(200);
            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-cache, no-transform');
            header('Connection: keep-alive');
            header('X-Accel-Buffering: no');   // nginx would otherwise hold it all back
        }
        Response::$started = true;
        self::$open = true;

        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        // Some hosts buffer until a few KB have accumulated; this nudges them.
        echo ': ' . str_repeat(' ', 2048) . "\n\n";
        self::push();
    }

    /** @param array<string,mixed> $data */
    public static function send(string $event, array $data): void
    {
        if (self::$capture !== null) {
            (self::$capture)($event, $data);
            return;
        }
        echo 'event: ' . $event . "\n";
        echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
        self::push();
    }

    public static function end(): void
    {
        if (self::$capture !== null) {
            (self::$capture)('end', []);
            self::$open = false;
            return;
        }
        echo "event: end\ndata: {}\n\n";
        self::push();
        self::$open = false;
    }

    private static function push(): void
    {
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }
}
