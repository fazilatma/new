<?php
/**
 * The LLM engine: multi-protocol provider adapter, SSE streaming, the
 * tool-calling agent loop, automatic provider fallback, checkpointing and the
 * self-healing execution loop. Port of agent-python/app/chat.py.
 *
 * Python async generators map onto PHP Generators; `httpx` streaming maps onto
 * a curl_multi pump so tokens can be yielded while the socket is still open.
 */

declare(strict_types=1);

namespace Arena;

final class Chat
{
    public const MAX_STEPS_STREAM = 30;
    public const MAX_STEPS_SYNC = 8;
    public const MAX_ATTEMPTS = 10;

    /* ---------------------------------------------------------------- */
    /* System prompt                                                     */
    /* ---------------------------------------------------------------- */

    public static function buildSystemPrompt(
        ?string $conversationId = null,
        ?array $referencedItems = null,
        ?array $messages = null,
        ?array $workspace = null
    ): string {
        $proj = Projects::active();
        $ws = $workspace ?? Workspaces::active();
        $caps = Bootstrap::capabilities();

        $runtimes = [];
        foreach (['python' => 'python3', 'node' => 'node', 'npm' => 'npm', 'git' => 'git', 'bash' => 'bash', 'docker' => 'docker', 'composer' => 'composer'] as $k => $label) {
            if (!empty($caps[$k])) {
                $runtimes[] = $label;
            }
        }
        $runtimes[] = 'php ' . $caps['phpVersion'];

        $prompt = "You are an expert AI Coding Agent running in the Arena Agent environment, deployed as a "
            . "self-hosted PHP application on a real server with shell access. You have full access to the "
            . "workspace filesystem, a real terminal, an HTTP/browser tool with unrestricted external web "
            . "access, and a real local `git` checkout.\n\n"
            . 'Active Project: ' . ($proj['name'] ?? 'Main Project') . "\n";

        if (!empty($proj['description'])) {
            $prompt .= 'Project Description: ' . $proj['description'] . "\n";
        }
        if (!empty($proj['path'])) {
            $prompt .= 'Project Workspace: ' . $proj['path'] . "\n";
        }
        if (!empty($proj['default_branch'])) {
            $prompt .= 'Target Git Branch: ' . $proj['default_branch'] . "\n";
        }

        $ins = $proj['instructions'] ?: ($ws['instructions'] ?? '');
        if ($ins) {
            $prompt .= "\nProject Instructions & Guidelines:\n{$ins}\n";
        }
        $rules = $proj['agent_rules'] ?: ($ws['agent_rules'] ?? '');
        if ($rules) {
            $prompt .= "\nAgent Rules & Constraints:\n{$rules}\n";
        }

        // Gather references (explicit + @chat:/@project: mentions).
        $refs = array_values($referencedItems ?? []);
        if ($conversationId !== null && $conversationId !== '' && !$refs) {
            try {
                $refs = References::forConversation($conversationId, false);
            } catch (\Throwable) {
                $refs = [];
            }
        }

        if ($messages) {
            foreach ($messages as $m) {
                $content = is_array($m) ? (string) ($m['content'] ?? '') : (string) $m;
                foreach ([['chat', '/@chat:([a-zA-Z0-9_\-]+)/'], ['project', '/@project:([a-zA-Z0-9_\-]+)/']] as [$type, $re]) {
                    if (preg_match_all($re, $content, $mm)) {
                        foreach ($mm[1] as $id) {
                            $known = false;
                            foreach ($refs as $r) {
                                if (($r['target_id'] ?? '') === $id) {
                                    $known = true;
                                    break;
                                }
                            }
                            if ($known) {
                                continue;
                            }
                            $refs[] = ['target_type' => $type, 'target_id' => $id, 'title' => ucfirst($type) . ' ' . $id];
                            if ($conversationId !== null && $conversationId !== '') {
                                try {
                                    References::add($conversationId, $type, $id);
                                } catch (\Throwable) {
                                }
                            }
                        }
                    }
                }
            }
        }

        if ($refs) {
            $prompt .= "\n\n### 🔗 Referenced Chats & Projects (Cross-Session File Access):\n"
                . "This chat references the following other chats and projects. You have FULL permission and "
                . "ability to inspect, read, and copy files from them into the active workspace using the "
                . "`read_referenced_file`, `list_referenced_files`, and `copy_referenced_file` tools (or by "
                . "prefixing paths with `@chat:<id>/path` or `@project:<id>/path`):\n";
            foreach ($refs as $r) {
                $tType = (string) ($r['target_type'] ?? 'chat');
                $tId = (string) ($r['target_id'] ?? '');
                $title = (string) ($r['title'] ?: $tId);
                $prompt .= '- [' . strtoupper($tType) . "] Reference '{$title}' (ID: `{$tId}`):\n";
                try {
                    $files = References::listFiles($tType, $tId, '.');
                    $names = [];
                    foreach ($files as $f) {
                        if (($f['type'] ?? '') === 'file') {
                            $names[] = $f['path'];
                        }
                        if (count($names) >= 15) {
                            break;
                        }
                    }
                    $prompt .= $names
                        ? '  Files (' . count($names) . '): ' . implode(', ', $names) . "\n"
                        : "  Files: (empty or newly created)\n";
                } catch (\Throwable $e) {
                    $prompt .= '  Files: (unable to list: ' . $e->getMessage() . ")\n";
                }
            }
        }

        $codeMode = (string) ($proj['code_generation_mode'] ?? 'smart-auto');
        if ($codeMode === 'single-file') {
            $prompt .= "\n### 📄 CODE GENERATION STRATEGY: SINGLE-FILE (SELF-CONTAINED):\n"
                . "- The project/user is configured for SINGLE-FILE code generation.\n"
                . "- Always generate fully self-contained, standalone single-file code without external local dependencies.\n"
                . "- For HTML / Web applications: Embed ALL CSS in `<style>` tags and ALL JavaScript in `<script>` tags inside the single HTML file (`index.html`). DO NOT reference external local `.css` or `.js` files via `<link>` or `<script src>` tags. This eliminates 404 missing asset errors and ensures immediate live preview rendering.\n"
                . "- For Python / Backend scripts: Include all necessary helper classes, functions, and logic within the single script file (`main.py` or script name).\n"
                . "- Always call `write_file` to save the complete single-file code to the workspace.\n";
        } elseif ($codeMode === 'multi-file') {
            $prompt .= "\n### 📁 CODE GENERATION STRATEGY: MULTI-FILE (MODULAR):\n"
                . "- The project/user is configured for MULTI-FILE modular code generation.\n"
                . "- Split the application into well-organized separate files (e.g. `index.html`, `style.css`, `app.js` or `main.py`, `utils.py`, `models.py`).\n"
                . "- Always call `write_file` for EVERY generated file so no component is missing in the workspace.\n";
        } else { // smart-auto
            $prompt .= "\n### 🌟 CODE GENERATION STRATEGY: SMART AUTO:\n"
                . "- For interactive web applications, UI demos, visual prototypes, dashboards, and calculators: Prefer self-contained single files with inline `<style>` and `<script>` inside `index.html` so that live preview and visual rendering work instantly with zero 404 errors.\n"
                . "- For complex multi-module backend architectures or multi-package projects: Generate structured separate modular files and save each using `write_file`.\n";
        }

        $prompt .= "\n### 🤖 ARENA AGENT WORKFLOW & AGENTIC CODING STANDARD:\n"
            . "You must structure all your multi-step coding, debugging, and implementation responses according to the Arena Agent standard:\n"
            . "1. **اعلام هدف و نیت (Goal & Intent)**: Start immediately with a clear statement of your goal and the approach you will take.\n"
            . "2. **برنامه کاری مرحله‌ای (Step-by-Step Work Plan)**: Provide an explicit numbered work plan under `### 📋 برنامه کاری (Work Plan)`.\n"
            . "3. **اجرای گام‌ها در کشوهای تاشو (Collapsible Step Drawers)**: Wrap each step's execution details, tools called, generated code, and error tracebacks inside `<details class=\"agent-step-drawer\" open>` with a `<summary class=\"agent-step-summary\">` line displaying the step number, title, and badge (e.g. `<span class=\"agent-step-badge done\">تکمیل شد ✓</span>` or `<span class=\"agent-step-badge healed\">اصلاح شد ✓</span>`).\n"
            . "4. **خلاصه کارهای انجام‌شده (Accomplishments Summary)**: End with a clean bulleted report under `### 🏁 خلاصه کارهای انجام‌شده (Accomplishments)` listing all created files, executed tests, and verified results.\n\n"
            . "### 🖥️ HOST RUNTIME CAPABILITIES (IMPORTANT):\n"
            . "- This agent runs on a real server with **full process execution**. Available runtimes: " . implode(', ', $runtimes) . ".\n"
            . "- `run_command` runs a REAL shell inside the workspace directory. You may install dependencies (`pip install`, `npm install`), run tests (`pytest`, `npm test`), build projects and inspect output.\n"
            . "- Every executable file you save is executed automatically, and if it fails you will be given the real traceback and must fix it (self-healing loop, up to 3 attempts).\n"
            . "- Therefore: DO verify your own work by running it. Do not claim something works without executing it.\n"
            . "- Destructive commands (rm -rf /, mkfs, shutdown, fork bombs, ...) are blocked by the sandbox and require explicit user confirmation.\n"
            . "- Version control uses a REAL local git checkout (`git_status`, `git_diff`, and `run_command` with any git subcommand).\n"
            . "- HTML/CSS/JS files can be previewed live from the workspace — prefer them for visual demos.\n\n"
            . "### 🛠️ WORKSPACE FILE CREATION & EDITING RULES:\n"
            . "- When the user asks you to write, create, generate, modify, refactor, or test code or files, you MUST ALWAYS call the `write_file` tool (`write_file(path=..., content=...)`) so the code is saved directly into the active workspace.\n"
            . "- DO NOT just output markdown code blocks without saving the file using `write_file`.\n"
            . "- Always ensure the generated code is completely implemented, production-ready, and saved to the correct relative path in the workspace.\n";

        return $prompt;
    }

    /* ---------------------------------------------------------------- */
    /* Request building (multi-protocol)                                 */
    /* ---------------------------------------------------------------- */

    public static function buildProviderRequest(
        array $provider,
        array $model,
        array $messages,
        string $apiKey,
        bool $stream
    ): array {
        $baseUrl = rtrim((string) ($provider['url'] ?? ''), '/');
        $protocol = (string) ($provider['protocol'] ?? 'openai-compatible');
        $headers = ['Content-Type' => 'application/json'];

        if ($apiKey !== '') {
            if ($protocol === 'anthropic') {
                $headers['x-api-key'] = $apiKey;
                $headers['anthropic-version'] = '2023-06-01';
            } elseif ($protocol === 'azure') {
                $headers['api-key'] = $apiKey;
            } else {
                $headers['Authorization'] = 'Bearer ' . $apiKey;
            }
        }

        if ($protocol === 'anthropic') {
            $url = str_ends_with($baseUrl, '/messages') ? $baseUrl : $baseUrl . '/v1/messages';
            $systemMsg = '';
            $userMsgs = [];
            foreach ($messages as $m) {
                $role = (string) ($m['role'] ?? 'user');
                if ($role === 'system') {
                    if ($systemMsg === '') {
                        $systemMsg = (string) ($m['content'] ?? '');
                    }
                    continue;
                }
                $userMsgs[] = ['role' => $role === 'tool' ? 'user' : $role, 'content' => (string) ($m['content'] ?? '')];
            }
            $body = [
                'model' => $model['id'],
                'system' => $systemMsg,
                'messages' => $userMsgs,
                'max_tokens' => (int) ($model['maxOutputTokens'] ?? 0) ?: 4096,
                'temperature' => 0.2,
            ];
            if ($stream) {
                $body['stream'] = true;
            }
            return ['url' => $url, 'headers' => $headers, 'body' => $body];
        }

        if ($protocol === 'ollama') {
            if (str_ends_with($baseUrl, '/api/chat') || str_ends_with($baseUrl, '/chat')) {
                $url = $baseUrl;
            } elseif (str_ends_with($baseUrl, '/api')) {
                $url = $baseUrl . '/chat';
            } else {
                $url = ($baseUrl !== '' ? $baseUrl : 'http://127.0.0.1:11434') . '/api/chat';
            }
            return ['url' => $url, 'headers' => $headers, 'body' => ['model' => $model['id'], 'messages' => $messages, 'stream' => $stream]];
        }

        if ($protocol === 'gemini') {
            // Google AI Studio exposes an OpenAI-compatible surface at /openai.
            $url = str_ends_with($baseUrl, '/chat/completions')
                ? $baseUrl
                : (rtrim((string) preg_replace('#/openai$#', '', $baseUrl), '/') . '/openai/chat/completions');
        } elseif ($protocol === 'cloudflare' || $protocol === 'workers-ai') {
            // Cloudflare Workers AI native REST API: the model is a *path
            // segment* (`/ai/run/{model}`), never a body field. Strip any
            // `/ai/run/...` or `/ai/v1...` suffix a previously-configured
            // base URL may already carry (e.g. copy-pasted from Cloudflare's
            // docs with a sample model baked in) so the account root can be
            // recombined with whichever model is actually selected — this is
            // what used to make every Cloudflare request hit the exact same
            // hardcoded model regardless of the one the user picked.
            $accountRoot = rtrim((string) preg_replace('#/ai/(run|v1)(/.*)?$#', '', $baseUrl), '/');
            $url = ($accountRoot !== '' ? $accountRoot : 'https://api.cloudflare.com/client/v4') . '/ai/run/' . $model['id'];
            $cfMessages = [];
            foreach ($messages as $m2) {
                $cfMessages[] = ['role' => (string) ($m2['role'] ?? 'user'), 'content' => (string) ($m2['content'] ?? '')];
            }
            $body = ['messages' => $cfMessages];
            if ($stream) {
                $body['stream'] = true;
            }
            return ['url' => $url, 'headers' => $headers, 'body' => $body];
        } else {
            // openai-compatible, mistral, azure, openrouter
            if (str_ends_with($baseUrl, '/chat/completions')) {
                $url = $baseUrl;
            } else {
                $url = ($baseUrl !== '' ? $baseUrl : 'https://api.openai.com/v1') . '/chat/completions';
            }
        }

        $body = ['model' => $model['id'], 'messages' => $messages, 'temperature' => 0.2];
        if ($stream) {
            $body['stream'] = true;
        }
        if (!empty($model['toolCalling'])) {
            $body['tools'] = AgentTools::definitions();
        }
        return ['url' => (string) $url, 'headers' => $headers, 'body' => $body];
    }

    /** @return array{targetUrl:string, proxyClient:?string} */
    public static function resolveTargetUrl(array $provider, string $directUrl): array
    {
        $baseUrl = (string) ($provider['url'] ?? '');
        if (
            ($provider['protocol'] ?? '') === 'ollama'
            || str_contains($baseUrl, '127.0.0.1')
            || str_contains($baseUrl, 'localhost')
        ) {
            return ['targetUrl' => $directUrl, 'proxyClient' => null];
        }
        $cfg = Config::proxyConfig($directUrl, (string) ($provider['proxyUrl'] ?? '') ?: null);
        return ['targetUrl' => (string) $cfg['effectiveUrl'], 'proxyClient' => $cfg['proxyClient']];
    }

    public static function normalizeResponse(array $provider, mixed $data): array
    {
        $protocol = (string) ($provider['protocol'] ?? '');
        if (!is_array($data)) {
            $data = [];
        }
        if ($protocol === 'anthropic') {
            $contentText = '';
            $thinkingText = '';
            foreach ($data['content'] ?? [] as $b) {
                if (($b['type'] ?? '') === 'text') {
                    $contentText .= (string) ($b['text'] ?? '');
                } elseif (($b['type'] ?? '') === 'thinking') {
                    $thinkingText .= (string) ($b['thinking'] ?? '');
                }
            }
            $msg = ['role' => 'assistant', 'content' => $contentText];
            if ($thinkingText !== '') {
                $msg['reasoning_content'] = $thinkingText;
            }
            return ['choices' => [['message' => $msg]]];
        }
        if ($protocol === 'ollama') {
            return ['choices' => [['message' => $data['message'] ?? ['role' => 'assistant', 'content' => '']]]];
        }
        if ($protocol === 'cloudflare' || $protocol === 'workers-ai') {
            $result = $data['result'] ?? null;
            $text = is_string($result) ? $result : (string) ($result['response'] ?? '');
            return ['choices' => [['message' => ['role' => 'assistant', 'content' => $text]]]];
        }
        return $data;
    }

    /* ---------------------------------------------------------------- */
    /* Non-streaming call                                                */
    /* ---------------------------------------------------------------- */

    public static function callProviderApi(
        ProviderStore $store,
        array $provider,
        array $model,
        array $messages,
        string $apiKey,
        ?int $customTimeoutSec = null
    ): array {
        $built = self::buildProviderRequest($provider, $model, $messages, $apiKey, false);
        $resolved = self::resolveTargetUrl($provider, $built['url']);
        $timeout = $customTimeoutSec ?? (int) ($provider['timeoutSec'] ?? 120);
        $started = microtime(true);
        $payload = (string) json_encode($built['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $attempt = static function (string $url) use ($built, $payload, $timeout, $resolved): array {
            $r = HttpClient::request('POST', $url, $built['headers'], $payload, $timeout, $resolved['proxyClient']);
            if (!$r['ok'] || $r['status'] >= 400) {
                $detail = $r['error'] ?? substr((string) $r['body'], 0, 500);
                throw new \RuntimeException('HTTP ' . $r['status'] . ': ' . $detail);
            }
            $json = json_decode((string) $r['body'], true);
            if (!is_array($json)) {
                throw new \RuntimeException('Provider returned a non-JSON response: ' . substr((string) $r['body'], 0, 300));
            }
            return $json;
        };

        try {
            $data = $attempt($resolved['targetUrl']);
            ProviderStore::breaker()->recordSuccess((string) $provider['id']);
            $store->recordMetric((string) $provider['id'], (string) $model['id'], (microtime(true) - $started) * 1000, false);
            return self::normalizeResponse($provider, $data);
        } catch (\Throwable $primaryErr) {
            if ($resolved['targetUrl'] !== $built['url'] && ($provider['protocol'] ?? '') !== 'ollama') {
                try {
                    $data = $attempt($built['url']);
                    ProviderStore::breaker()->recordSuccess((string) $provider['id']);
                    $store->recordMetric((string) $provider['id'], (string) $model['id'], (microtime(true) - $started) * 1000, false);
                    return self::normalizeResponse($provider, $data);
                } catch (\Throwable) {
                    // fall through to the original error
                }
            }
            ProviderStore::breaker()->recordFailure((string) $provider['id']);
            $store->recordMetric((string) $provider['id'], (string) $model['id'], (microtime(true) - $started) * 1000, true);
            throw $primaryErr;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Streaming primitives                                              */
    /* ---------------------------------------------------------------- */

    /**
     * Yield response lines from a streaming POST while the connection is open.
     * Uses curl_multi so the generator can hand tokens to the caller mid-flight.
     *
     * @return \Generator<int, string>
     */
    private static function streamLines(
        string $url,
        array $headers,
        string $body,
        int $timeoutSec,
        ?string $proxy
    ): \Generator {
        if (!function_exists('curl_init')) {
            throw new \RuntimeException('The cURL extension is not enabled on this host');
        }
        $hdrs = [];
        foreach ($headers as $k => $v) {
            $hdrs[] = $k . ': ' . $v;
        }

        $buffer = '';
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $hdrs,
            CURLOPT_TIMEOUT => max(10, $timeoutSec),
            CURLOPT_CONNECTTIMEOUT => min(30, max(5, $timeoutSec)),
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$buffer): int {
                $buffer .= $chunk;
                return strlen($chunk);
            },
        ]);
        if ($proxy !== null && $proxy !== '') {
            curl_setopt($ch, CURLOPT_PROXY, $proxy);
        }

        $mh = curl_multi_init();
        curl_multi_add_handle($mh, $ch);

        $status = 0;
        $errorBody = '';
        $running = 1;
        try {
            do {
                curl_multi_exec($mh, $running);
                if ($running > 0) {
                    curl_multi_select($mh, 0.25);
                }
                if ($status === 0) {
                    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                }
                if ($buffer === '') {
                    continue;
                }
                if ($status >= 400) {
                    $errorBody .= $buffer;
                    $buffer = '';
                    continue;
                }
                if ($status === 0) {
                    continue; // headers not in yet — keep buffering
                }
                $parts = explode("\n", $buffer);
                $buffer = (string) array_pop($parts);
                foreach ($parts as $line) {
                    yield trim($line);
                }
            } while ($running > 0);

            curl_multi_exec($mh, $running);
            $status = $status ?: (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $curlErr = curl_error($ch);

            if ($status >= 400) {
                $errorBody .= $buffer;
                throw new \RuntimeException('HTTP ' . $status . ': ' . substr(trim($errorBody), 0, 500));
            }
            if ($curlErr !== '') {
                throw new \RuntimeException('Connection error: ' . $curlErr);
            }
            if ($status === 0) {
                throw new \RuntimeException('Connection error: no response from ' . $url);
            }
            if (trim($buffer) !== '') {
                yield trim($buffer);
            }
        } finally {
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            curl_multi_close($mh);
        }
    }

    /**
     * Parse one provider stream into {type: token|reasoning|full_message} items.
     *
     * @return \Generator<int, array>
     */
    private static function streamRequest(
        array $provider,
        string $url,
        array $headers,
        array $body,
        int $timeoutSec,
        ?string $proxy
    ): \Generator {
        $protocol = (string) ($provider['protocol'] ?? '');
        $payload = (string) json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $fullContent = [];
        $fullReasoning = [];
        $toolCalls = [];

        foreach (self::streamLines($url, $headers, $payload, $timeoutSec, $proxy) as $line) {
            if ($line === '' || str_starts_with($line, ':')) {
                continue;
            }

            if (str_starts_with($line, 'data:')) {
                $dataStr = trim(substr($line, 5));
                if ($dataStr === '[DONE]') {
                    break;
                }
                $chunk = json_decode($dataStr, true);
                if (!is_array($chunk)) {
                    continue;
                }

                // Anthropic event stream
                if ($protocol === 'anthropic') {
                    if (($chunk['type'] ?? '') === 'content_block_delta') {
                        $delta = $chunk['delta'] ?? [];
                        if (($delta['type'] ?? '') === 'text_delta' && ($delta['text'] ?? '') !== '') {
                            $fullContent[] = (string) $delta['text'];
                            yield ['type' => 'token', 'text' => (string) $delta['text']];
                        } elseif (($delta['type'] ?? '') === 'thinking_delta' && ($delta['thinking'] ?? '') !== '') {
                            $fullReasoning[] = (string) $delta['thinking'];
                            yield ['type' => 'reasoning', 'reasoning' => (string) $delta['thinking']];
                        }
                    }
                    continue;
                }

                // Cloudflare Workers AI native stream: `data: {"response": "..."}`
                if ($protocol === 'cloudflare' || $protocol === 'workers-ai') {
                    $cText = (string) ($chunk['response'] ?? '');
                    if ($cText !== '') {
                        $fullContent[] = $cText;
                        yield ['type' => 'token', 'text' => $cText];
                    }
                    continue;
                }

                $choices = $chunk['choices'] ?? [];
                if (!$choices) {
                    continue;
                }
                $delta = $choices[0]['delta'] ?? [];

                $rText = (string) ($delta['reasoning_content'] ?? $delta['reasoning'] ?? $delta['thought'] ?? '');
                if ($rText !== '') {
                    $fullReasoning[] = $rText;
                    yield ['type' => 'reasoning', 'reasoning' => $rText];
                }

                $cText = (string) ($delta['content'] ?? '');
                if ($cText !== '') {
                    $fullContent[] = $cText;
                    yield ['type' => 'token', 'text' => $cText];
                }

                foreach ($delta['tool_calls'] ?? [] as $tc) {
                    $idx = (int) ($tc['index'] ?? 0);
                    if (!isset($toolCalls[$idx])) {
                        $toolCalls[$idx] = [
                            'id' => (string) ($tc['id'] ?? ('call_' . $idx . '_' . (int) (microtime(true) * 1000))),
                            'type' => 'function',
                            'function' => ['name' => '', 'arguments' => ''],
                        ];
                    }
                    if (!empty($tc['id'])) {
                        $toolCalls[$idx]['id'] = (string) $tc['id'];
                    }
                    $fn = $tc['function'] ?? [];
                    if (!empty($fn['name'])) {
                        $toolCalls[$idx]['function']['name'] .= (string) $fn['name'];
                    }
                    if (isset($fn['arguments']) && $fn['arguments'] !== '') {
                        $toolCalls[$idx]['function']['arguments'] .= (string) $fn['arguments'];
                    }
                }
                continue;
            }

            // Ollama emits bare NDJSON objects
            if ($protocol === 'ollama' && str_starts_with($line, '{')) {
                $chunk = json_decode($line, true);
                if (!is_array($chunk)) {
                    continue;
                }
                $cText = (string) ($chunk['message']['content'] ?? '');
                if ($cText !== '') {
                    $fullContent[] = $cText;
                    yield ['type' => 'token', 'text' => $cText];
                }
                if (!empty($chunk['done'])) {
                    break;
                }
            }
        }

        $finalMsg = ['role' => 'assistant', 'content' => implode('', $fullContent)];
        if ($fullReasoning) {
            $finalMsg['reasoning_content'] = implode('', $fullReasoning);
        }
        if ($toolCalls) {
            ksort($toolCalls);
            $finalMsg['tool_calls'] = array_values($toolCalls);
        }
        yield ['type' => 'full_message', 'message' => $finalMsg];
    }

    /** @return \Generator<int, array> */
    public static function streamCallProviderApi(
        ProviderStore $store,
        array $provider,
        array $model,
        array $messages,
        string $apiKey,
        ?int $customTimeoutSec = null
    ): \Generator {
        $built = self::buildProviderRequest($provider, $model, $messages, $apiKey, true);
        $resolved = self::resolveTargetUrl($provider, $built['url']);
        $timeout = $customTimeoutSec ?? (int) ($provider['timeoutSec'] ?? 120);
        $started = microtime(true);
        $pid = (string) $provider['id'];
        $mid = (string) $model['id'];

        try {
            foreach (self::streamRequest($provider, $resolved['targetUrl'], $built['headers'], $built['body'], $timeout, $resolved['proxyClient']) as $item) {
                yield $item;
            }
            ProviderStore::breaker()->recordSuccess($pid);
            $store->recordMetric($pid, $mid, (microtime(true) - $started) * 1000, false);
            return;
        } catch (\Throwable $proxyErr) {
            if ($resolved['targetUrl'] !== $built['url'] && ($provider['protocol'] ?? '') !== 'ollama') {
                try {
                    foreach (self::streamRequest($provider, $built['url'], $built['headers'], $built['body'], $timeout, null) as $item) {
                        yield $item;
                    }
                    ProviderStore::breaker()->recordSuccess($pid);
                    $store->recordMetric($pid, $mid, (microtime(true) - $started) * 1000, false);
                    return;
                } catch (\Throwable) {
                    // fall through to the non-streaming path
                }
            }

            // Last resort: non-streaming call, chunked client-side (same as Python).
            try {
                $resp = self::callProviderApi($store, $provider, $model, $messages, $apiKey, $customTimeoutSec);
                $msg = $resp['choices'][0]['message'] ?? ['role' => 'assistant', 'content' => ''];
                $reasoning = (string) ($msg['reasoning_content'] ?? $msg['reasoning'] ?? $msg['thought'] ?? '');
                if ($reasoning !== '') {
                    yield ['type' => 'reasoning', 'reasoning' => $reasoning];
                }
                $content = (string) ($msg['content'] ?? '');
                $len = strlen($content);
                for ($i = 0; $i < $len; $i += 25) {
                    yield ['type' => 'token', 'text' => substr($content, $i, 25)];
                }
                yield ['type' => 'full_message', 'message' => $msg];
                return;
            } catch (\Throwable $nonStreamErr) {
                ProviderStore::breaker()->recordFailure($pid);
                $store->recordMetric($pid, $mid, (microtime(true) - $started) * 1000, true);
                throw $nonStreamErr;
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* Auto file detection                                               */
    /* ---------------------------------------------------------------- */

    /** @return array<int, array{path:string,type:string,content:string,isExecutable:bool,isHtml:bool}> */
    public static function autoDetectAndSaveCodeFiles(array $ws, string $content): array
    {
        $saved = [];
        if ($content === '' || !str_contains($content, '```')) {
            return $saved;
        }

        $used = [];
        $blocks = explode('```', $content);
        $count = count($blocks);

        for ($i = 1; $i < $count; $i += 2) {
            $block = $blocks[$i];
            $precedingText = $blocks[$i - 1] ?? '';
            $nl = strpos($block, "\n");
            $firstLine = trim($nl !== false ? substr($block, 0, $nl) : $block);
            $code = $nl !== false ? substr($block, $nl + 1) : '';
            if (trim($code) === '') {
                continue;
            }

            $filename = null;
            $lang = strtolower($firstLine);
            $langParts = preg_split('/[\s:;=]/', $lang) ?: [];
            $cleanLang = trim((string) ($langParts[0] ?? 'code')) ?: 'code';

            // 1. filename attached to the fence info string
            if (preg_match('/(?:^|[\s:])(?:file=|filename=|path=|:)?\s*([a-zA-Z0-9_\-.\/]+\.[a-zA-Z0-9]+)/i', $firstLine, $m)) {
                $filename = trim($m[1]);
            }

            // 2. filename in a leading comment of the block
            if ($filename === null) {
                $codeHead = implode("\n", array_slice(explode("\n", trim($code)), 0, 3));
                if (preg_match('/(?:#|\/\/|\/\*|<!--)\s*(?:filename|filepath|file|path|نام فایل)?\s*:?\s*`?([a-zA-Z0-9_\-.\/]+\.[a-zA-Z0-9]+)`?/iu', $codeHead, $m)) {
                    $filename = trim($m[1]);
                }
            }

            // 3. filename in the preceding prose
            if ($filename === null && trim($precedingText) !== '') {
                $lastLines = array_values(array_filter(array_map('trim', array_slice(explode("\n", trim($precedingText)), -3))));
                foreach (array_reverse($lastLines) as $l) {
                    if (preg_match('/(?:###|##|#|\*\*|فایل|File:?|ساخت فایل|کد فایل)?\s*`?([a-zA-Z0-9_\-.\/]+\.(?:html|htm|py|js|ts|jsx|tsx|css|json|sql|sh|md|txt|php|toml|yaml|yml))`?/iu', $l, $m)) {
                        $filename = trim($m[1]);
                        break;
                    }
                }
            }

            // 4. language-based fallbacks
            if ($filename === null) {
                $lower = strtolower($code);
                $nth = count($used) + 1;
                if (str_contains($lower, '<!doctype html') || str_contains($lower, '<html')) {
                    $filename = 'index.html';
                } elseif (in_array($cleanLang, ['html', 'htm'], true)) {
                    $filename = isset($used['index.html']) ? "page_{$nth}.html" : 'index.html';
                } elseif ($cleanLang === 'css') {
                    $filename = isset($used['style.css']) ? "style_{$nth}.css" : 'style.css';
                } elseif (in_array($cleanLang, ['javascript', 'js'], true)) {
                    $filename = isset($used['app.js']) ? "script_{$nth}.js" : 'app.js';
                } elseif (in_array($cleanLang, ['typescript', 'ts'], true)) {
                    $filename = isset($used['app.ts']) ? "script_{$nth}.ts" : 'app.ts';
                } elseif (in_array($cleanLang, ['python', 'py'], true)) {
                    $filename = isset($used['main.py']) ? "script_{$nth}.py" : 'main.py';
                } elseif ($cleanLang === 'json') {
                    $filename = 'data.json';
                } elseif ($cleanLang === 'sql') {
                    $filename = 'schema.sql';
                } elseif (in_array($cleanLang, ['bash', 'sh', 'zsh'], true)) {
                    $filename = 'run.sh';
                } elseif ($cleanLang === 'php' || str_contains($code, '<?php')) {
                    $filename = isset($used['index.php']) ? "script_{$nth}.php" : 'index.php';
                } elseif ($cleanLang === 'toml') {
                    $filename = 'config.toml';
                }
            }

            if ($filename === null) {
                continue;
            }
            $cleanFn = str_replace('\\', '/', ltrim(trim($filename), '/'));
            if ($cleanFn === '' || str_starts_with($cleanFn, '..') || !str_contains($cleanFn, '.')) {
                continue;
            }

            try {
                $abs = Workspaces::safePath($ws, $cleanFn);
                Files::write($abs, $code);
                ChangeSets::saveVersion($ws, $cleanFn, $code, 'agent-auto-save');
                $used[$cleanFn] = true;
                $lower = strtolower($cleanFn);
                $saved[] = [
                    'path' => $cleanFn,
                    'type' => $cleanLang,
                    'content' => $code,
                    'isExecutable' => (bool) preg_match('/\.(py|pyw|sh|bash|js|mjs|ts|php)$/', $lower),
                    'isHtml' => (bool) preg_match('/\.(html|htm)$/', $lower),
                ];
            } catch (\Throwable) {
                // skip unwritable paths
            }
        }

        return $saved;
    }

    /* ---------------------------------------------------------------- */
    /* Error classification                                              */
    /* ---------------------------------------------------------------- */

    public static function isRateLimitError(\Throwable|string $err): bool
    {
        $s = strtolower($err instanceof \Throwable ? $err->getMessage() : $err);
        foreach (['429', 'rate limit', 'rate_limit', '402', 'quota', 'credit', 'billing', 'insufficient'] as $needle) {
            if (str_contains($s, $needle)) {
                return true;
            }
        }
        return false;
    }

    public static function isNetworkError(\Throwable|string $err): bool
    {
        $s = strtolower($err instanceof \Throwable ? $err->getMessage() : $err);
        foreach ([
            'timeout', 'timed out', 'connect', 'connection', '502', '503', '504',
            '520', '521', '522', '524', 'network', 'disconnected', 'resolve host',
            'ssl', 'eof', 'reset by peer',
        ] as $needle) {
            if (str_contains($s, $needle)) {
                return true;
            }
        }
        return false;
    }

    /* ---------------------------------------------------------------- */
    /* Candidate resolution                                              */
    /* ---------------------------------------------------------------- */

    /** @return array<int, array{provider:array, model:array, isFallback:bool}> */
    private static function buildCandidates(ProviderStore $store, array $primary, array $model): array
    {
        $candidates = [['provider' => $primary, 'model' => $model, 'isFallback' => false]];
        $seen = [$primary['id'] . '::' . $model['id'] => true];

        foreach ($store->verifiedFallbackCandidates((string) $primary['id'], (string) $model['id'], true) as [$vp, $vm]) {
            $key = $vp['id'] . '::' . $vm['id'];
            if (!isset($seen[$key])) {
                $candidates[] = ['provider' => $vp, 'model' => $vm, 'isFallback' => true];
                $seen[$key] = true;
            }
        }

        $sorted = array_values($store->data);
        usort($sorted, static fn(array $a, array $b): int => (int) ($b['priority'] ?? 0) <=> (int) ($a['priority'] ?? 0));
        foreach ($sorted as $p) {
            if (empty($p['enabled']) || $p['id'] === $primary['id'] || ProviderStore::breaker()->isTripped((string) $p['id'])) {
                continue;
            }
            $apiKey = $store->apiKey($p);
            if ($apiKey === '' && !in_array($p['protocol'], ['ollama', 'workers-ai'], true)) {
                continue;
            }
            foreach ($p['models'] ?? [] as $m) {
                $key = $p['id'] . '::' . $m['id'];
                if (!isset($seen[$key])) {
                    $candidates[] = ['provider' => $p, 'model' => $m, 'isFallback' => true];
                    $seen[$key] = true;
                }
            }
        }
        return $candidates;
    }

    private static function nowUtc(): string
    {
        return gmdate('Y-m-d H:i:s') . ' UTC';
    }

    private static function hasAnyOtherUsableProvider(ProviderStore $store, string $excludeId): bool
    {
        foreach ($store->data as $p) {
            if (empty($p['enabled']) || $p['id'] === $excludeId) {
                continue;
            }
            if ($store->apiKey($p) !== '' || ($p['protocol'] ?? '') === 'ollama') {
                return true;
            }
        }
        return false;
    }

    /** Resolve the workspace and checkpoint-aware message list shared by both loops. */
    private static function prepare(array $opts): array
    {
        $conversationId = ($opts['conversationId'] ?? null) ?: null;
        $ws = Workspaces::active();
        if ($conversationId !== null) {
            try {
                $ws = Workspaces::getOrCreateSessionWorkspace($conversationId);
            } catch (\Throwable) {
                // keep the active workspace
            }
        }

        $incoming = array_values(array_filter(
            $opts['messages'] ?? [],
            static fn(array $m): bool => ($m['role'] ?? '') !== 'system'
        ));
        $sysPrompt = self::buildSystemPrompt($conversationId, $opts['references'] ?? null, $opts['messages'] ?? null, $ws);
        $chatMsgs = array_merge([['role' => 'system', 'content' => $sysPrompt]], $incoming);

        $resumed = null;
        if ($conversationId !== null) {
            $cp = Conversations::latestCheckpoint($conversationId);
            $history = $cp['chatHistory'] ?? [];
            if (is_array($history) && $history) {
                $cpNonSys = array_values(array_filter($history, static fn($m): bool => is_array($m) && ($m['role'] ?? '') !== 'system'));
                $hasProgress = false;
                foreach ($history as $m) {
                    if (is_array($m) && in_array($m['role'] ?? '', ['assistant', 'tool'], true)) {
                        $hasProgress = true;
                        break;
                    }
                }
                if (count($cpNonSys) >= count($incoming) && $hasProgress) {
                    $chatMsgs = array_merge([['role' => 'system', 'content' => $sysPrompt]], $cpNonSys);
                    $resumed = $cp;
                }
            }
        }

        return [
            'conversationId' => $conversationId,
            'workspace' => $ws,
            'chatMsgs' => $chatMsgs,
            'resumed' => $resumed,
        ];
    }

    private static function fallbackDetails(array $primary, array $primaryModel, array $p, array $m): array
    {
        return [
            'used' => true,
            'originalProvider' => $primary['name'],
            'originalModel' => $primaryModel['id'],
            'activeProvider' => $p['name'],
            'activeModel' => $m['id'],
        ];
    }

    /* ---------------------------------------------------------------- */
    /* Streaming agent loop                                              */
    /* ---------------------------------------------------------------- */

    /** @return \Generator<int, array> SSE event payloads */
    public static function streamCompleteChat(ProviderStore $store, array $opts): \Generator
    {
        $maxSteps = (int) ($opts['maxSteps'] ?? self::MAX_STEPS_STREAM);
        $prep = self::prepare($opts);
        $conversationId = $prep['conversationId'];
        $ws = $prep['workspace'];
        $chatMsgs = $prep['chatMsgs'];

        $toolCtx = new ToolContext($ws, $conversationId, (string) ($opts['userId'] ?? 'agent'));

        if ($prep['resumed'] !== null) {
            $cp = $prep['resumed'];
            yield [
                'type' => 'checkpoint_resumed',
                'checkpointId' => $cp['id'],
                'stepIndex' => (int) ($cp['stepIndex'] ?? 0),
                'message' => 'Resumed execution from checkpoint at step ' . (((int) ($cp['stepIndex'] ?? 0)) + 1) . '.',
            ];
        }

        $primary = $store->get((string) ($opts['providerId'] ?? ''));
        if ($primary === null) {
            throw new HttpError(400, "Provider '" . ($opts['providerId'] ?? '') . "' is not configured in the Provider Catalog.");
        }
        $primaryModel = $store->findModel($primary, (string) ($opts['modelId'] ?? ''));

        yield ['type' => 'status', 'status' => 'started', 'provider' => $primary['id'], 'model' => $primaryModel['id']];

        $primaryKey = $store->apiKey($primary);
        if ($primaryKey === '' && !in_array($primary['protocol'], ['ollama', 'workers-ai'], true)) {
            if (!self::hasAnyOtherUsableProvider($store, (string) $primary['id'])) {
                $errMsg = "Provider '{$primary['name']}' ({$primary['id']}) does not have an API key configured.";
                yield [
                    'type' => 'error',
                    'error' => $errMsg,
                    'errorDetails' => [
                        'provider' => $primary['id'],
                        'providerName' => $primary['name'],
                        'model' => $primaryModel['id'],
                        'protocol' => $primary['protocol'],
                        'url' => $primary['url'],
                        'error' => $errMsg,
                        'timestamp' => self::nowUtc(),
                        'remediation' => 'Set ' . ($primary['apiKeyEnv'] ?: 'OPENROUTER_API_KEY') . " in the .env file (or enter it in 'Providers & Models' / 'Security & Settings').",
                    ],
                ];
                return;
            }
        }

        $candidates = self::buildCandidates($store, $primary, $primaryModel);
        $pendingApprovals = [];
        $primaryError = null;
        $fallbackErrors = [];
        $maxRetrySleep = (int) Config::rawInt('MAX_RETRY_SLEEP_SEC', 20) ?: 20;

        foreach ($candidates as $cand) {
            $p = $cand['provider'];
            $targetModel = $cand['model'];
            $isFallback = $cand['isFallback'];

            $apiKey = $store->apiKey($p);
            if ($apiKey === '' && !in_array($p['protocol'], ['ollama', 'workers-ai'], true)) {
                continue;
            }

            if ($isFallback) {
                yield ['type' => 'fallback_activated', 'fallbackDetails' => self::fallbackDetails($primary, $primaryModel, $p, $targetModel)];
            }

            $stepIdx = 0;
            try {
                for ($stepIdx = 0; $stepIdx < $maxSteps; $stepIdx++) {
                    $lastMsg = null;

                    // Exponential backoff retry for transient network failures.
                    for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
                        try {
                            foreach (self::streamCallProviderApi($store, $p, $targetModel, $chatMsgs, $apiKey) as $chunk) {
                                if ($chunk['type'] === 'token') {
                                    yield ['type' => 'token', 'text' => $chunk['text']];
                                } elseif ($chunk['type'] === 'reasoning') {
                                    yield ['type' => 'reasoning', 'reasoning' => $chunk['reasoning']];
                                } elseif ($chunk['type'] === 'full_message') {
                                    $lastMsg = $chunk['message'];
                                }
                            }
                            break;
                        } catch (\Throwable $streamErr) {
                            if (self::isRateLimitError($streamErr)) {
                                throw $streamErr;
                            }
                            if (!self::isNetworkError($streamErr) || $attempt >= self::MAX_ATTEMPTS) {
                                throw $streamErr;
                            }
                            $delaySec = min(2 ** ($attempt - 1), 60);
                            $actual = min($delaySec, $maxRetrySleep);
                            yield [
                                'type' => 'retry_countdown',
                                'attempt' => $attempt,
                                'maxAttempts' => self::MAX_ATTEMPTS,
                                'delaySec' => $delaySec,
                                'provider' => $p['name'],
                                'model' => $targetModel['name'] ?? $targetModel['id'],
                                'reason' => "قطع ارتباط شبکه یا تایم‌اوت ({$streamErr->getMessage()}). تلاش مجدد در {$delaySec} ثانیه...",
                            ];
                            if ($actual > 0) {
                                sleep((int) $actual);
                            }
                        }
                    }

                    if ($lastMsg === null) {
                        break;
                    }

                    $chatMsgs[] = $lastMsg;
                    $toolCalls = $lastMsg['tool_calls'] ?? [];

                    if (!$toolCalls) {
                        $savedFiles = self::autoDetectAndSaveCodeFiles($ws, (string) ($lastMsg['content'] ?? ''));
                        $executionReports = [];

                        if ($conversationId !== null) {
                            Conversations::saveCheckpoint([
                                'conversationId' => $conversationId,
                                'stepIndex' => $stepIdx,
                                'providerId' => $p['id'],
                                'modelId' => $targetModel['id'],
                                'accumulatedContent' => (string) ($lastMsg['content'] ?? ''),
                                'accumulatedReasoning' => (string) ($lastMsg['reasoning_content'] ?? ''),
                                'chatHistory' => $chatMsgs,
                                'savedFiles' => $savedFiles,
                                'executionResults' => $executionReports,
                                'status' => 'completed',
                            ]);
                        }

                        // Autonomous execution / self-healing loop (real execution here).
                        foreach ($savedFiles as $sf) {
                            if ($sf['isHtml']) {
                                $qs = ['path' => $sf['path']];
                                if ($conversationId !== null) {
                                    $qs['conversation_id'] = $conversationId;
                                }
                                yield [
                                    'type' => 'render_preview_ready',
                                    'path' => $sf['path'],
                                    'previewUrl' => '/api/workspace/raw?' . http_build_query($qs),
                                    'previewType' => 'html',
                                ];
                                continue;
                            }
                            if (!$sf['isExecutable']) {
                                continue;
                            }

                            $execRes = Terminal::executeFile($ws, $sf['path'], $conversationId);
                            $executionReports[] = $execRes;

                            if ((int) ($execRes['exitCode'] ?? 1) === 0) {
                                yield [
                                    'type' => 'execution_result',
                                    'path' => $sf['path'],
                                    'status' => 'success',
                                    'exitCode' => 0,
                                    'command' => $execRes['command'] ?? '',
                                    'stdout' => $execRes['stdout'] ?? '',
                                    'stderr' => $execRes['stderr'] ?? '',
                                    'attempt' => 1,
                                ];
                                continue;
                            }

                            if (!empty($execRes['unsupported'])) {
                                yield [
                                    'type' => 'execution_result',
                                    'path' => $sf['path'],
                                    'status' => 'unsupported',
                                    'exitCode' => (int) ($execRes['exitCode'] ?? 127),
                                    'command' => $execRes['command'] ?? '',
                                    'stdout' => '',
                                    'stderr' => $execRes['stderr'] ?? '',
                                    'unsupported' => true,
                                    'attempt' => 1,
                                ];
                                continue;
                            }

                            yield [
                                'type' => 'execution_result',
                                'path' => $sf['path'],
                                'status' => 'failed',
                                'exitCode' => (int) ($execRes['exitCode'] ?? 1),
                                'command' => $execRes['command'] ?? '',
                                'stdout' => $execRes['stdout'] ?? '',
                                'stderr' => $execRes['stderr'] ?? '',
                                'attempt' => 1,
                            ];

                            $currentErr = (string) ($execRes['stderr'] ?: $execRes['stdout'] ?: 'Execution failed with non-zero exit code');
                            $lastExec = $execRes;
                            for ($healAttempt = 1; $healAttempt <= 3; $healAttempt++) {
                                $chatMsgs[] = [
                                    'role' => 'user',
                                    'content' => "\n\n[AUTONOMOUS TEST EXECUTION FAILURE - Attempt {$healAttempt}/3]\n"
                                        . "File `{$sf['path']}` was executed and failed with Exit Code " . (int) ($lastExec['exitCode'] ?? 1) . ".\n"
                                        . "Error Traceback:\n```\n{$currentErr}\n```\n\n"
                                        . "Please diagnose this error, fix all issues in `{$sf['path']}`, and output the full corrected code in a code block.",
                                ];
                                yield ['type' => 'token', 'text' => "\n\n⚙️ *در حال رفع خودکار خطای اجرای `{$sf['path']}` (تلاش {$healAttempt})...*\n\n"];

                                $healMsg = null;
                                foreach (self::streamCallProviderApi($store, $p, $targetModel, $chatMsgs, $apiKey) as $chunk) {
                                    if ($chunk['type'] === 'token') {
                                        yield ['type' => 'token', 'text' => $chunk['text']];
                                    } elseif ($chunk['type'] === 'reasoning') {
                                        yield ['type' => 'reasoning', 'reasoning' => $chunk['reasoning']];
                                    } elseif ($chunk['type'] === 'full_message') {
                                        $healMsg = $chunk['message'];
                                    }
                                }
                                if ($healMsg === null) {
                                    break;
                                }

                                $chatMsgs[] = $healMsg;
                                self::autoDetectAndSaveCodeFiles($ws, (string) ($healMsg['content'] ?? ''));

                                $reExec = Terminal::executeFile($ws, $sf['path'], $conversationId);
                                if ((int) ($reExec['exitCode'] ?? 1) === 0) {
                                    yield [
                                        'type' => 'execution_healed',
                                        'path' => $sf['path'],
                                        'status' => 'healed',
                                        'exitCode' => 0,
                                        'command' => $reExec['command'] ?? '',
                                        'stdout' => $reExec['stdout'] ?? '',
                                        'stderr' => $reExec['stderr'] ?? '',
                                        'durationMs' => $reExec['durationMs'] ?? 0,
                                        'attempts' => $healAttempt + 1,
                                    ];
                                    $executionReports[] = $reExec;
                                    break;
                                }
                                $currentErr = (string) ($reExec['stderr'] ?: $reExec['stdout'] ?: $currentErr);
                                $lastExec = $reExec;
                            }
                        }

                        ProviderStore::breaker()->recordSuccess((string) $p['id']);
                        $store->recordMetric((string) $p['id'], (string) $targetModel['id'], 0, false);

                        if ($pendingApprovals) {
                            yield ['type' => 'approvals', 'approvals' => $pendingApprovals];
                        }

                        yield [
                            'type' => 'done',
                            'steps' => $stepIdx + 1,
                            'provider' => $p['id'],
                            'model' => $targetModel['id'],
                            'reasoning' => $lastMsg['reasoning_content'] ?? '',
                            'savedFiles' => $savedFiles,
                            'executionReports' => $executionReports,
                            'isFallback' => $isFallback,
                            'fallbackDetails' => $isFallback ? self::fallbackDetails($primary, $primaryModel, $p, $targetModel) : null,
                        ];
                        if ($conversationId !== null) {
                            Conversations::clearCheckpoints($conversationId);
                        }
                        return;
                    }

                    // Execute tool calls
                    foreach ($toolCalls as $tc) {
                        $name = (string) ($tc['function']['name'] ?? '');
                        $args = json_decode((string) ($tc['function']['arguments'] ?? '{}'), true);
                        if (!is_array($args)) {
                            $args = [];
                        }

                        yield ['type' => 'tool_executing', 'tool' => $name, 'args' => $args];
                        try {
                            $res = AgentTools::execute($toolCtx, $name, $args);
                            if (is_array($res) && !empty($res['requiresApproval'])) {
                                $pendingApprovals[] = $res;
                            }
                        } catch (\Throwable $e) {
                            $res = ['error' => $e->getMessage()];
                        }

                        yield ['type' => 'tool_result', 'tool' => $name, 'result' => $res];

                        $chatMsgs[] = [
                            'role' => 'tool',
                            'tool_call_id' => (string) ($tc['id'] ?? ''),
                            'content' => (string) json_encode($res, JSON_UNESCAPED_UNICODE),
                        ];

                        if ($conversationId !== null) {
                            Conversations::saveCheckpoint([
                                'conversationId' => $conversationId,
                                'stepIndex' => $stepIdx,
                                'providerId' => $p['id'],
                                'modelId' => $targetModel['id'],
                                'chatHistory' => $chatMsgs,
                                'status' => 'in_progress',
                            ]);
                        }
                    }
                }

                ProviderStore::breaker()->recordSuccess((string) $p['id']);
                yield [
                    'type' => 'done',
                    'steps' => $maxSteps,
                    'provider' => $p['id'],
                    'model' => $targetModel['id'],
                    'isFallback' => $isFallback,
                ];
                if ($conversationId !== null) {
                    Conversations::clearCheckpoints($conversationId);
                }
                return;
            } catch (\Throwable $e) {
                $errText = $e->getMessage();
                ProviderStore::breaker()->recordFailure((string) $p['id']);
                $store->recordMetric((string) $p['id'], (string) $targetModel['id'], 0, true);

                if ($conversationId !== null) {
                    Conversations::saveCheckpoint([
                        'conversationId' => $conversationId,
                        'stepIndex' => $stepIdx,
                        'providerId' => $p['id'],
                        'modelId' => $targetModel['id'],
                        'chatHistory' => $chatMsgs,
                        'status' => 'failed',
                        'errorMessage' => $errText,
                    ]);
                }

                if (self::isRateLimitError($e)) {
                    $fallbacks = $store->verifiedFallbackCandidates((string) $p['id'], (string) $targetModel['id'], true);
                    if ($fallbacks) {
                        [$nextP, $nextM] = $fallbacks[0];
                        yield [
                            'type' => 'model_switched_rate_limit',
                            'previousProvider' => $p['name'],
                            'previousModel' => $targetModel['name'] ?? $targetModel['id'],
                            'newProvider' => $nextP['name'],
                            'newModel' => $nextM['name'] ?? $nextM['id'],
                            'reason' => "خطای ریت‌لیمیت یا اتمام اعتبار ({$errText})؛ سوییچ هوشمند به مدل " . ($nextM['name'] ?? $nextM['id']) . ' از ارائه‌دهنده ' . $nextP['name'],
                        ];
                    }
                }

                if ($p['id'] === $primary['id']) {
                    $primaryError = $errText . ' (Endpoint: ' . $p['url'] . ')';
                } else {
                    $fallbackErrors[] = [
                        'provider' => $p['id'],
                        'providerName' => $p['name'],
                        'model' => $targetModel['id'],
                        'url' => $p['url'],
                        'error' => $errText,
                    ];
                }
                continue;
            }
        }

        yield [
            'type' => 'error',
            'error' => "Failed to get response from {$primary['name']}: " . ($primaryError ?? 'Network/API error'),
            'errorDetails' => [
                'provider' => $primary['id'],
                'providerName' => $primary['name'],
                'model' => $primaryModel['id'],
                'protocol' => $primary['protocol'],
                'url' => $primary['url'],
                'error' => $primaryError ?? 'All candidate models failed to respond.',
                'fallbackErrors' => $fallbackErrors,
                'timestamp' => self::nowUtc(),
                'remediation' => "1. Check the provider API keys in the .env file or the Settings tab.\n"
                    . "2. In Providers & Models, run the model health test.\n"
                    . "3. Verify the proxy gateway URL in Settings (AGENT_PROXY_URL).",
            ],
        ];
    }

    /* ---------------------------------------------------------------- */
    /* Non-streaming agent loop                                          */
    /* ---------------------------------------------------------------- */

    public static function completeChat(ProviderStore $store, array $opts): array
    {
        $maxSteps = (int) ($opts['maxSteps'] ?? self::MAX_STEPS_SYNC);
        $prep = self::prepare($opts);
        $conversationId = $prep['conversationId'];
        $ws = $prep['workspace'];
        $chatMsgs = $prep['chatMsgs'];
        $toolCtx = new ToolContext($ws, $conversationId, (string) ($opts['userId'] ?? 'agent'));

        $primary = $store->get((string) ($opts['providerId'] ?? ''));
        if ($primary === null) {
            throw new HttpError(400, "Provider '" . ($opts['providerId'] ?? '') . "' is not configured in the Provider Catalog.");
        }
        $primaryModel = $store->findModel($primary, (string) ($opts['modelId'] ?? ''));

        $primaryKey = $store->apiKey($primary);
        if ($primaryKey === '' && !in_array($primary['protocol'], ['ollama', 'workers-ai'], true)) {
            if (!self::hasAnyOtherUsableProvider($store, (string) $primary['id'])) {
                $errMsg = "Provider '{$primary['name']}' ({$primary['id']}) does not have an API key configured.";
                $envName = $primary['apiKeyEnv'] ?: 'OPENROUTER_API_KEY';
                return [
                    'message' => [
                        'role' => 'assistant',
                        'content' => "⚠️ **API Key Required**: Provider `{$primary['name']}` (`{$primary['id']}`) does not have an API key configured.\n\n"
                            . "Add `{$envName}=...` to the `.env` file, or enter it in the **Providers & Models** / **Security & Settings** tab.",
                    ],
                    'steps' => 0,
                    'provider' => $primary['id'],
                    'model' => $primaryModel['id'],
                    'errorDetails' => [
                        'provider' => $primary['id'],
                        'providerName' => $primary['name'],
                        'model' => $primaryModel['id'],
                        'protocol' => $primary['protocol'],
                        'url' => $primary['url'],
                        'error' => $errMsg,
                        'timestamp' => self::nowUtc(),
                        'remediation' => "Configure the API key for {$primary['name']}.",
                    ],
                    'pendingApprovals' => [],
                ];
            }
        }

        $candidates = self::buildCandidates($store, $primary, $primaryModel);
        $pendingApprovals = [];
        $stepHistory = [];
        $primaryError = null;
        $fallbackErrors = [];
        $maxRetrySleep = (int) Config::rawInt('MAX_RETRY_SLEEP_SEC', 20) ?: 20;

        foreach ($candidates as $cand) {
            $p = $cand['provider'];
            $targetModel = $cand['model'];
            $isFallback = $cand['isFallback'];

            $apiKey = $store->apiKey($p);
            if ($apiKey === '' && !in_array($p['protocol'], ['ollama', 'workers-ai'], true)) {
                continue;
            }

            try {
                for ($stepIdx = 0; $stepIdx < $maxSteps; $stepIdx++) {
                    $resp = null;
                    for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
                        try {
                            $resp = self::callProviderApi($store, $p, $targetModel, $chatMsgs, $apiKey);
                            break;
                        } catch (\Throwable $reqErr) {
                            if (self::isRateLimitError($reqErr) || !self::isNetworkError($reqErr) || $attempt >= self::MAX_ATTEMPTS) {
                                throw $reqErr;
                            }
                            sleep((int) min(min(2 ** ($attempt - 1), 60), $maxRetrySleep));
                        }
                    }
                    if (!is_array($resp) || empty($resp['choices'])) {
                        break;
                    }

                    $msg = $resp['choices'][0]['message'] ?? ['role' => 'assistant', 'content' => ''];
                    $chatMsgs[] = $msg;

                    $toolCalls = $msg['tool_calls'] ?? [];
                    if (!$toolCalls) {
                        $savedFiles = self::autoDetectAndSaveCodeFiles($ws, (string) ($msg['content'] ?? ''));
                        $executionReports = [];
                        foreach ($savedFiles as $sf) {
                            if (!$sf['isExecutable']) {
                                continue;
                            }
                            $executionReports[] = Terminal::executeFile($ws, $sf['path'], $conversationId);
                        }

                        if ($conversationId !== null) {
                            Conversations::saveCheckpoint([
                                'conversationId' => $conversationId,
                                'stepIndex' => $stepIdx,
                                'providerId' => $p['id'],
                                'modelId' => $targetModel['id'],
                                'accumulatedContent' => (string) ($msg['content'] ?? ''),
                                'chatHistory' => $chatMsgs,
                                'savedFiles' => $savedFiles,
                                'executionResults' => $executionReports,
                                'status' => 'completed',
                            ]);
                            Conversations::clearCheckpoints($conversationId);
                        }

                        ProviderStore::breaker()->recordSuccess((string) $p['id']);
                        $store->recordMetric((string) $p['id'], (string) $targetModel['id'], 0, false);

                        return [
                            'message' => $msg,
                            'steps' => $stepIdx + 1,
                            'provider' => $p['id'],
                            'model' => $targetModel['id'],
                            'reasoning' => $msg['reasoning_content'] ?? '',
                            'savedFiles' => $savedFiles,
                            'executionReports' => $executionReports,
                            'stepHistory' => $stepHistory,
                            'pendingApprovals' => $pendingApprovals,
                            'isFallback' => $isFallback,
                            'fallbackDetails' => $isFallback ? self::fallbackDetails($primary, $primaryModel, $p, $targetModel) : null,
                        ];
                    }

                    foreach ($toolCalls as $tc) {
                        $name = (string) ($tc['function']['name'] ?? '');
                        $args = json_decode((string) ($tc['function']['arguments'] ?? '{}'), true);
                        if (!is_array($args)) {
                            $args = [];
                        }
                        $started = microtime(true);
                        $status = 'success';
                        try {
                            $res = AgentTools::execute($toolCtx, $name, $args);
                            if (is_array($res) && !empty($res['requiresApproval'])) {
                                $pendingApprovals[] = $res;
                            }
                        } catch (\Throwable $e) {
                            $res = ['error' => $e->getMessage()];
                            $status = 'error';
                        }
                        $stepHistory[] = [
                            'step' => $stepIdx,
                            'tool' => $name,
                            'args' => $args,
                            'status' => $status,
                            'durationMs' => (int) round((microtime(true) - $started) * 1000),
                            'result' => $res,
                        ];
                        $chatMsgs[] = [
                            'role' => 'tool',
                            'tool_call_id' => (string) ($tc['id'] ?? ''),
                            'content' => (string) json_encode($res, JSON_UNESCAPED_UNICODE),
                        ];
                    }
                }

                return [
                    'message' => ['role' => 'assistant', 'content' => 'Reached the maximum number of agent steps.'],
                    'steps' => $maxSteps,
                    'provider' => $p['id'],
                    'model' => $targetModel['id'],
                    'stepHistory' => $stepHistory,
                    'pendingApprovals' => $pendingApprovals,
                    'isFallback' => $isFallback,
                ];
            } catch (\Throwable $e) {
                $errText = $e->getMessage();
                ProviderStore::breaker()->recordFailure((string) $p['id']);
                $store->recordMetric((string) $p['id'], (string) $targetModel['id'], 0, true);
                if ($p['id'] === $primary['id']) {
                    $primaryError = $errText . ' (Endpoint: ' . $p['url'] . ')';
                } else {
                    $fallbackErrors[] = [
                        'provider' => $p['id'],
                        'providerName' => $p['name'],
                        'model' => $targetModel['id'],
                        'url' => $p['url'],
                        'error' => $errText,
                    ];
                }
                continue;
            }
        }

        return [
            'message' => [
                'role' => 'assistant',
                'content' => "⚠️ Failed to get a response from {$primary['name']}: " . ($primaryError ?? 'Network/API error'),
            ],
            'steps' => 0,
            'provider' => $primary['id'],
            'model' => $primaryModel['id'],
            'errorDetails' => [
                'provider' => $primary['id'],
                'providerName' => $primary['name'],
                'model' => $primaryModel['id'],
                'protocol' => $primary['protocol'],
                'url' => $primary['url'],
                'error' => $primaryError ?? 'All candidate models failed to respond.',
                'fallbackErrors' => $fallbackErrors,
                'timestamp' => self::nowUtc(),
            ],
            'pendingApprovals' => $pendingApprovals,
        ];
    }
}
