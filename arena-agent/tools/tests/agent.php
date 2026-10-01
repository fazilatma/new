<?php

/**
 * Agent, tools, diffs and the approval gate — exercised in real PHP.
 *
 * The provider is replaced by a scripted transport, so the whole loop runs
 * for real: the same Agent, the same Tools, the same Changes, the same SSE
 * writer. Only the network is fake.
 *
 *   node ../agent-php/tools/phprun.mjs --root=. tools/tests/agent.php
 */

declare(strict_types=1);

namespace Arena;

ob_start();   // headers_sent() must stay false or status codes freeze at 200

$base = '/tmp/arena-agent-test';
rmtree($base);
@mkdir($base . '/data', 0775, true);
@mkdir($base . '/storage', 0775, true);
putenv("ARENA_DATA_DIR=$base/data");
putenv("ARENA_STORAGE_DIR=$base/storage");
putenv('ARENA_AUTH=false');
putenv('ARENA_SHELL=false');

require_once '/app/src/Bootstrap.php';   // the runner mounts the project at /app
Bootstrap::init();

/** Recursive delete without shelling out — the test must not need a shell. */
function rmtree(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $name) {
        if ($name === '.' || $name === '..') {
            continue;
        }
        $path = $dir . '/' . $name;
        is_dir($path) ? rmtree($path) : @unlink($path);
    }
    @rmdir($dir);
}

$pass = 0;
$fail = 0;
$router = null;
$reqClass = null;

function group(string $name): void
{
    echo "\n=== $name ===\n";
}

function check(string $what, bool $ok, string $note = ''): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        printf("OK  %-46s %s\n", $what, $note);
    } else {
        $fail++;
        printf("**  %-46s %s\n", $what, $note !== '' ? $note : 'FAILED');
    }
}

function ws(string $rel): string
{
    return Workspace::root() . '/' . ltrim($rel, '/');
}

// ---------------------------------------------------------------- 1. diffs

group('1. unified diff');

$before = "one\ntwo\nthree\nfour\nfive\n";
$after = "one\ntwo\nTHREE\nfour\nfive\n";
$d = Diff::unified($before, $after, 'x.txt');
check('header names the file', str_contains($d, "--- a/x.txt\n+++ b/x.txt"));
check('changed line marked both ways',
    str_contains($d, "-three") && str_contains($d, "+THREE"));
check('context lines kept unprefixed', str_contains($d, " two") && str_contains($d, " four"));
check('hunk header counts lines', (bool) preg_match('/@@ -\d+,\d+ \+\d+,\d+ @@/', $d),
    trim(strtok($d === '' ? '' : substr($d, strpos($d, '@@')), "\n")));

check('identical text yields no diff', Diff::unified($before, $before) === '');
check('trailing newline is not a change',
    Diff::unified("a\nb", "a\nb\n") === '', 'rtrim handles the terminator');

$s = Diff::stat("a\nb\nc\n", "a\nx\ny\nc\n");
check('stat counts adds and removes', $s['added'] === 2 && $s['removed'] === 1,
    "+{$s['added']} −{$s['removed']}");

$new = Diff::unified('', "hello\nworld\n", 'new.txt');
check('creating a file is all additions',
    substr_count($new, "\n+") >= 1 && !str_contains($new, "\n-"));

// A change far into a long file must not drag the whole file along.
$long = implode("\n", array_map(static fn(int $i): string => "line $i", range(1, 400)));
$longEdited = str_replace('line 200', 'line 200 changed', $long);
$dl = Diff::unified($long, $longEdited, 'long.txt');
check('only the neighbourhood of a change is emitted',
    substr_count($dl, "\n") < 15, substr_count($dl, "\n") . ' lines for a 400-line file');
check('distant lines are excluded', !str_contains($dl, 'line 100'));

// ------------------------------------------------------------- 2. approval

group('2. approval gate');

Changes::setMode('ask');
check('default mode asks', Changes::mode() === 'ask');

$c = Changes::propose('write', 'src/hello.txt', "hello\n", 'conv1');
check('proposal is pending', $c['status'] === Changes::PENDING, $c['id']);
check('nothing written while pending', !file_exists(ws('src/hello.txt')));
check('proposal carries its diff', str_contains((string) $c['diff'], '+hello'));
check('proposal counts the lines', $c['added'] === 1 && $c['removed'] === 0);
check('pending count sees it', Changes::pendingCount() === 1);

$approved = Changes::approve((string) $c['id']);
check('approval writes the file', file_exists(ws('src/hello.txt')));
check('contents are exactly as proposed', file_get_contents(ws('src/hello.txt')) === "hello\n");
check('status becomes applied', $approved['status'] === Changes::APPLIED);
check('approving twice is refused', (static function () use ($c): bool {
    try {
        Changes::approve((string) $c['id']);
        return false;
    } catch (HttpError $e) {
        return $e->status === 409;
    }
})(), 'second approve -> 409');

$c2 = Changes::propose('write', 'src/hello.txt', "goodbye\n", 'conv1');
Changes::reject((string) $c2['id']);
check('rejection leaves the file alone', file_get_contents(ws('src/hello.txt')) === "hello\n");
check('pending count returns to zero', Changes::pendingCount() === 0);

$c3 = Changes::propose('write', 'src/hello.txt', "third\n", 'conv1');
Changes::approve((string) $c3['id']);
$reverted = Changes::revert((string) $c3['id']);
check('revert restores the previous contents',
    file_get_contents(ws('src/hello.txt')) === "hello\n", $reverted['status']);

$c4 = Changes::propose('write', 'brand/new.txt', "x\n", 'conv1');
Changes::approve((string) $c4['id']);
Changes::revert((string) $c4['id']);
check('reverting a creation removes the file', !file_exists(ws('brand/new.txt')));

$noop = Changes::propose('write', 'src/hello.txt', "hello\n", 'conv1');
check('a no-op change is not queued', $noop['status'] === 'unchanged', (string) $noop['note']);

$del = Changes::propose('delete', 'src/hello.txt', '', 'conv1');
check('delete keeps the old text for undo', str_contains((string) $del['diff'], '-hello'));
Changes::approve((string) $del['id']);
check('approved delete removes the file', !file_exists(ws('src/hello.txt')));
Changes::revert((string) $del['id']);
check('reverting a delete brings it back', file_exists(ws('src/hello.txt')));

Changes::setMode('auto');
$auto = Changes::propose('write', 'auto.txt', "now\n", 'conv1');
check('automatic mode writes at once',
    $auto['status'] === Changes::APPLIED && file_get_contents(ws('auto.txt')) === "now\n");
$recorded = Changes::list('all', 'conv1', 50);
check('automatic changes are still recorded',
    in_array('auto.txt', array_column($recorded, 'path'), true),
    count($recorded) . ' changes on record for this conversation');
Changes::setMode('ask');

// ---------------------------------------------------------------- 3. tools

group('3. tools');

Workspace::write('proj/app.py', "def main():\n    print('hi')\n\nmain()\n");
Workspace::write('proj/readme.md', "# Project\n\nIt prints hi.\n");

$r = Tools::run('list_files', ['path' => 'proj']);
check('list_files finds both files',
    str_contains($r['result'], 'app.py') && str_contains($r['result'], 'readme.md'), $r['summary']);

$r = Tools::run('read_file', ['path' => 'proj/app.py']);
check('read_file returns the source', str_contains($r['result'], "print('hi')"), $r['summary']);

$r = Tools::run('read_file', ['path' => 'proj/nope.py']);
check('missing file is an error the model can act on',
    !$r['ok'] && str_contains($r['result'], 'No such file'));

$r = Tools::run('search_files', ['query' => 'print']);
check('search_files reports file and line',
    $r['ok'] && (bool) preg_match('/proj\/app\.py:\d+:/', $r['result']), $r['summary']);

$r = Tools::run('search_files', ['query' => 'zzz-not-here']);
check('a search with no hits says so plainly', str_contains($r['result'], 'Nothing in the workspace'));

$r = Tools::run('edit_file', ['path' => 'proj/app.py', 'find' => "print('hi')", 'replace' => "print('hello')"]);
check('edit_file proposes a change', $r['ok'] && $r['change'] !== null, $r['summary']);
check('edit_file does not write while pending',
    str_contains((string) file_get_contents(ws('proj/app.py')), "print('hi')"));
Changes::approve((string) $r['change']['id']);
check('approved edit changes exactly one thing',
    file_get_contents(ws('proj/app.py')) === "def main():\n    print('hello')\n\nmain()\n");

$r = Tools::run('edit_file', ['path' => 'proj/app.py', 'find' => 'nowhere', 'replace' => 'x']);
check('edit_file refuses text it cannot find',
    !$r['ok'] && str_contains($r['result'], 'does not appear'));

Workspace::write('dup.txt', "same\nsame\n");
$r = Tools::run('edit_file', ['path' => 'dup.txt', 'find' => 'same', 'replace' => 'other']);
check('edit_file refuses an ambiguous match',
    !$r['ok'] && str_contains($r['result'], 'appears 2 times'), 'and explains how to fix it');

$r = Tools::run('write_file', ['path' => '../escape.txt', 'content' => 'x']);
check('a tool cannot escape the workspace',
    !$r['ok'] && str_contains($r['result'], 'outside the workspace'));

$r = Tools::run('run_command', ['command' => 'echo hi']);
check('a disabled shell is refused, not crashed',
    !$r['ok'] && str_contains($r['result'], 'disabled'));
check('run_command is hidden when the shell is off',
    !in_array('run_command', Tools::availableNames(), true),
    implode(', ', Tools::availableNames()));

$r = Tools::run('make_coffee', []);
check('an invented tool gets a useful reply',
    !$r['ok'] && str_contains($r['result'], 'no tool called'));

$big = str_repeat("noise\n", 20000);
Workspace::write('big.txt', $big);
$r = Tools::run('read_file', ['path' => 'big.txt']);
check('huge output is clipped before it reaches the model',
    strlen($r['result']) < 30000, Workspace::humanSize(strlen($r['result'])));

// --------------------------------------------------- 4. protocol plumbing

group('4. tool calls on the wire');

$tools = Tools::declarations();
$history = [
    ['role' => 'system', 'content' => 'be brief'],
    ['role' => 'user', 'content' => 'read app.py'],
    ['role' => 'assistant', 'content' => 'Looking.',
     'toolCalls' => [['id' => 'call_1', 'name' => 'read_file', 'args' => ['path' => 'proj/app.py']]]],
    ['role' => 'tool', 'toolCallId' => 'call_1', 'name' => 'read_file', 'content' => 'def main():'],
];

$oa = json_decode(Llm::build(
    ['protocol' => 'openai', 'baseUrl' => 'https://api.openai.com/v1', 'apiKey' => 'k', 'name' => 'o'],
    'gpt-4o', $history, false, 0.2, $tools
)['body'], true);
check('openai declares tools as functions',
    ($oa['tools'][0]['type'] ?? '') === 'function'
    && isset($oa['tools'][0]['function']['parameters']['properties']));
check('openai arguments are a JSON string',
    is_string($oa['messages'][2]['tool_calls'][0]['function']['arguments'] ?? null));
check('openai tool result carries the call id',
    ($oa['messages'][3]['tool_call_id'] ?? '') === 'call_1'
    && ($oa['messages'][3]['role'] ?? '') === 'tool');

$an = json_decode(Llm::build(
    ['protocol' => 'anthropic', 'baseUrl' => '', 'apiKey' => 'k', 'name' => 'a'],
    'claude', $history, false, 0.2, $tools
)['body'], true);
check('anthropic lifts system out of the turns',
    ($an['system'] ?? '') === 'be brief' && count($an['messages']) === 3);
check('anthropic uses tool_use blocks',
    ($an['messages'][1]['content'][1]['type'] ?? '') === 'tool_use');
check('anthropic returns results as a user tool_result',
    ($an['messages'][2]['role'] ?? '') === 'user'
    && ($an['messages'][2]['content'][0]['type'] ?? '') === 'tool_result');
check('anthropic schema key is input_schema', isset($an['tools'][0]['input_schema']));

$ge = json_decode(Llm::build(
    ['protocol' => 'gemini', 'baseUrl' => '', 'apiKey' => 'k', 'name' => 'g'],
    'gemini-2.0-flash', $history, false, 0.2, $tools
)['body'], true);
check('gemini nests functionDeclarations', isset($ge['tools'][0]['functionDeclarations'][0]['name']));
check('gemini calls the assistant role "model"', ($ge['contents'][1]['role'] ?? '') === 'model');
check('gemini answers with functionResponse',
    isset($ge['contents'][2]['parts'][0]['functionResponse']['response']['result']));

$ol = json_decode(Llm::build(
    ['protocol' => 'ollama', 'baseUrl' => 'http://127.0.0.1:11434', 'apiKey' => '', 'name' => 'l'],
    'qwen3:8b', $history, true, 0.2, $tools
)['body'], true);
check('ollama arguments stay an object',
    is_array($ol['messages'][2]['tool_calls'][0]['function']['arguments'] ?? null));
check('ollama drops streaming when tools are in play', ($ol['stream'] ?? true) === false,
    'it cannot do both');

// Parsing replies back out again.
$p = Llm::parseReply('openai', (string) json_encode(['choices' => [['finish_reason' => 'tool_calls',
    'message' => ['content' => null, 'tool_calls' => [[
        'id' => 'c1', 'type' => 'function',
        'function' => ['name' => 'read_file', 'arguments' => '{"path":"a.txt"}'],
    ]]]]]]));
check('openai tool call parsed, arguments decoded',
    $p['toolCalls'][0]['name'] === 'read_file' && $p['toolCalls'][0]['args']['path'] === 'a.txt');

$p = Llm::parseReply('anthropic', (string) json_encode(['stop_reason' => 'tool_use', 'content' => [
    ['type' => 'text', 'text' => 'Let me look.'],
    ['type' => 'tool_use', 'id' => 'tu1', 'name' => 'list_files', 'input' => ['path' => 'src']],
]]));
check('anthropic text and tool_use both parsed',
    $p['text'] === 'Let me look.' && $p['toolCalls'][0]['args']['path'] === 'src');

$p = Llm::parseReply('gemini', (string) json_encode(['candidates' => [['content' => ['parts' => [
    ['functionCall' => ['name' => 'search_files', 'args' => ['query' => 'todo']]],
]]]]]));
check('gemini functionCall parsed and given an id',
    $p['toolCalls'][0]['name'] === 'search_files' && $p['toolCalls'][0]['id'] !== '');

$p = Llm::parseReply('ollama', (string) json_encode(['message' => ['content' => 'done',
    'tool_calls' => [['function' => ['name' => 'read_file', 'arguments' => ['path' => 'b.txt']]]]]]));
check('ollama object arguments parsed', $p['toolCalls'][0]['args']['path'] === 'b.txt');

$p = Llm::parseReply('openai', (string) json_encode(['choices' => [[
    'message' => ['content' => 'just text'], 'finish_reason' => 'stop']]]));
check('a plain answer has no tool calls', $p['text'] === 'just text' && $p['toolCalls'] === []);

check('a provider error becomes a 502, not a crash', (static function (): bool {
    try {
        Llm::parseReply('openai', (string) json_encode(['error' => ['message' => 'bad key']]));
        return false;
    } catch (HttpError $e) {
        return $e->status === 502 && str_contains($e->getMessage(), 'bad key');
    }
})());

// ----------------------------------------------------------- 5. the loop

group('5. the agent loop, end to end');

/**
 * Replay a scripted conversation. Each entry is a complete provider response
 * body; the loop consumes them in order.
 *
 * @param array<int,array<string,mixed>> $script
 * @return array{events:array<int,array{0:string,1:array<string,mixed>}>,requests:array<int,array<string,mixed>>}
 */
function replay(array $script, string $message, string $conversationId = ''): array
{
    $requests = [];
    $i = 0;
    Llm::$transport = static function (string $url, array $headers, string $body) use (&$i, $script, &$requests): array {
        $requests[] = json_decode($body, true);
        $reply = $script[$i] ?? ['choices' => [['message' => ['content' => 'out of script']]]];
        $i++;
        return [200, (string) json_encode($reply)];
    };

    $req = new Request();
    $req->method = 'POST';
    $req->path = '/api/agent/stream';
    $req->rawBody = (string) json_encode([
        'providerId' => 'test', 'modelId' => 'test-model',
        'conversationId' => $conversationId, 'message' => $message,
    ]);
    $req->user = ['id' => 'dev', 'username' => 'dev', 'role' => 'admin'];

    $events = [];
    Sse::$capture = static function (string $event, array $data) use (&$events): void {
        $events[] = [$event, $data];
    };
    Agent::run($req);
    Sse::$capture = null;
    Llm::$transport = null;

    return ['events' => $events, 'requests' => $requests];
}

/** @param array<int,array{0:string,1:array<string,mixed>}> $events */
function names(array $events): array
{
    return array_column($events, 0);
}

/** @param array<int,array{0:string,1:array<string,mixed>}> $events */
function firstOf(array $events, string $name): ?array
{
    foreach ($events as [$n, $d]) {
        if ($n === $name) {
            return $d;
        }
    }
    return null;
}

Db::run('DELETE FROM providers');
Providers::save(['id' => 'test', 'name' => 'Scripted', 'protocol' => 'openai',
    'baseUrl' => 'https://example.invalid/v1', 'apiKey' => 'k', 'enabled' => true,
    'models' => [['id' => 'test-model']]]);

$call = static fn(string $id, string $name, array $args): array => [
    'id' => $id, 'type' => 'function',
    'function' => ['name' => $name, 'arguments' => (string) json_encode($args)],
];

// One tool round, then an answer.
$out = replay([
    ['choices' => [['message' => ['content' => 'Let me look at the file.',
        'tool_calls' => [$call('c1', 'read_file', ['path' => 'proj/readme.md'])]]]]],
    ['choices' => [['message' => ['content' => 'It is a project readme.']]]],
], 'what is in the readme?');

$seq = names($out['events']);
check('stream opens with start', $seq[0] === 'start');
check('a step is announced before work', in_array('step', $seq, true));
check('the tool call is reported', in_array('tool', $seq, true));
check('so is its result', in_array('tool_result', $seq, true));
check('tool precedes tool_result',
    array_search('tool', $seq, true) < array_search('tool_result', $seq, true));
check('the stream finishes with end', end($seq) === 'end');
check('done comes before end', $seq[count($seq) - 2] === 'done');

$tool = firstOf($out['events'], 'tool');
check('the call names the tool and its arguments',
    $tool['name'] === 'read_file' && $tool['args']['path'] === 'proj/readme.md');
$result = firstOf($out['events'], 'tool_result');
check('the result carries the file contents',
    $result['ok'] === true && str_contains((string) $result['output'], 'It prints hi'));
$done = firstOf($out['events'], 'done');
check('done counts the steps and the tools',
    $done['steps'] === 2 && $done['toolCalls'] === 1, "steps={$done['steps']}");

$secondRequest = $out['requests'][1];
check('the tool result is fed back to the model',
    ($secondRequest['messages'][3]['role'] ?? '') === 'tool'
    && str_contains((string) ($secondRequest['messages'][3]['content'] ?? ''), 'It prints hi'));
check('tools are offered on every request',
    isset($out['requests'][0]['tools']) && isset($out['requests'][1]['tools']));
check('the system prompt leads the conversation',
    ($out['requests'][0]['messages'][0]['role'] ?? '') === 'system'
    && str_contains((string) $out['requests'][0]['messages'][0]['content'], 'coding agent'));

$conv = firstOf($out['events'], 'start')['conversationId'];
$stored = Db::all('SELECT role FROM messages WHERE conversation_id = ? ORDER BY id', [$conv]);
check('user, assistant, tool and answer are all persisted',
    array_column($stored, 'role') === ['user', 'assistant', 'tool', 'assistant'],
    implode(' → ', array_column($stored, 'role')));

// A second turn must carry the first one's tool history back.
$out2 = replay([['choices' => [['message' => ['content' => 'Still the same readme.']]]]],
    'are you sure?', $conv);
$roles = array_column($out2['requests'][0]['messages'], 'role');
check('a later turn replays the earlier tool exchange',
    in_array('tool', $roles, true), implode(',', $roles));

// A write during the loop becomes a pending change.
Changes::setMode('ask');
$out3 = replay([
    ['choices' => [['message' => ['content' => '',
        'tool_calls' => [$call('c2', 'write_file', ['path' => 'proj/new.py', 'content' => "print(1)\n"])]]]]],
    ['choices' => [['message' => ['content' => 'Added proj/new.py.']]]],
], 'add a script');

check('a change event is emitted for review', in_array('change', names($out3['events']), true));
$change = firstOf($out3['events'], 'change');
check('the change is pending, not written',
    $change['status'] === 'pending' && !file_exists(ws('proj/new.py')));
check('the change event includes the diff', str_contains((string) $change['diff'], '+print(1)'));
check('the model is told it needs approval',
    str_contains((string) firstOf($out3['events'], 'tool_result')['output'], 'waiting for the user'));
check('done reports the pending count', firstOf($out3['events'], 'done')['pending'] >= 1);

Changes::approve((string) $change['id']);
check('approving afterwards writes the agent file',
    file_get_contents(ws('proj/new.py')) === "print(1)\n");

// Several tool calls in one step.
$out4 = replay([
    ['choices' => [['message' => ['content' => '', 'tool_calls' => [
        $call('a', 'read_file', ['path' => 'proj/app.py']),
        $call('b', 'list_files', ['path' => 'proj']),
    ]]]]],
    ['choices' => [['message' => ['content' => 'Both read.']]]],
], 'read and list');
check('two calls in one step both run',
    count(array_filter(names($out4['events']), static fn(string $n): bool => $n === 'tool_result')) === 2);

// A tool that fails must not end the run.
$out5 = replay([
    ['choices' => [['message' => ['content' => '',
        'tool_calls' => [$call('x', 'read_file', ['path' => 'does/not/exist'])]]]]],
    ['choices' => [['message' => ['content' => 'That file is not there.']]]],
], 'read a missing file');
check('a failing tool is reported as failed',
    firstOf($out5['events'], 'tool_result')['ok'] === false);
check('the loop carries on after a tool failure',
    firstOf($out5['events'], 'done') !== null
    && firstOf($out5['events'], 'done')['steps'] === 2);

// A model that never stops must be stopped.
$loop = array_fill(0, 20, ['choices' => [['message' => ['content' => '',
    'tool_calls' => [$call('z', 'list_files', ['path' => ''])]]]]]);
$out6 = replay($loop, 'loop forever');
$done6 = firstOf($out6['events'], 'done');
check('a runaway loop is capped', $done6['steps'] === Agent::MAX_STEPS,
    "stopped at {$done6['steps']} steps");
check('and says it stopped early', $done6['stoppedEarly'] === true);

// Provider failures surface as one error event.
Llm::$transport = static fn(): array => [401, (string) json_encode(['error' => ['message' => 'no key']])];
$errorEvents = [];
Sse::$capture = static function (string $e, array $d) use (&$errorEvents): void {
    $errorEvents[] = [$e, $d];
};
$req = new Request();
$req->method = 'POST';
$req->rawBody = (string) json_encode(['providerId' => 'test', 'modelId' => 'test-model', 'message' => 'hi']);
$req->user = ['id' => 'dev', 'username' => 'dev', 'role' => 'admin'];
Agent::run($req);
Sse::$capture = null;
Llm::$transport = null;
$errorNames = array_column($errorEvents, 0);
check('a provider rejection becomes an error event',
    in_array('error', $errorNames, true)
    && str_contains((string) ($errorEvents[array_search('error', $errorNames, true)][1]['message'] ?? ''), 'no key'));
check('the stream still closes cleanly', end($errorNames) === 'end');

// ------------------------------------------------------------- 6. the API

group('6. routes');

$router = new Router();
Routes::register($router);
$reqClass = new \ReflectionClass(Request::class);

/**
 * Issue one request through the real router, exactly as the front controller
 * does. Modelled on smoke.php so both suites exercise the same path.
 *
 * @param array<string,mixed>|null $body
 * @return array{status:int,json:array<string,mixed>}
 */
function apiCall(string $method, string $path, ?array $body = null): array
{
    global $router, $reqClass;

    $_SERVER = [
        'REQUEST_METHOD' => $method,
        'SCRIPT_NAME' => '/index.php',
        'SCRIPT_FILENAME' => '/app/public/index.php',
        'CONTENT_TYPE' => 'application/json',
    ];
    $_GET = ['p' => $path];
    $_POST = [];
    $reqClass->setStaticPropertyValue('dir', '');
    $reqClass->setStaticPropertyValue('entry', '/index.php');
    Response::$started = false;
    http_response_code(200);

    $req = Request::capture();
    $req->rawBody = $body === null ? '' : (string) json_encode($body);
    Auth::resolve($req);

    ob_start();
    try {
        $router->dispatch($req);
    } catch (HttpError $e) {
        if (!Response::$started) {
            Response::json(['error' => $e->getMessage()], $e->status);
        }
    } catch (\Throwable $e) {
        if (!Response::$started) {
            Response::json(['error' => $e::class . ': ' . $e->getMessage()], 500);
        }
    }
    $out = (string) ob_get_clean();
    return ['status' => http_response_code(), 'json' => json_decode($out, true) ?? []];
}

$res = apiCall('GET', '/api/agent/tools');
check('GET /api/agent/tools lists them', count($res['json']['tools'] ?? []) >= 6,
    implode(', ', array_column($res['json']['tools'] ?? [], 'name')));
check('and says which are unavailable here',
    in_array('run_command', $res['json']['unavailable'] ?? [], true), 'shell is off');

$res = apiCall('GET', '/api/changes');
check('GET /api/changes answers', isset($res['json']['changes']));

$pending = Changes::propose('write', 'route-test.txt', "a\n", '');
$res = apiCall('GET', '/api/changes/' . $pending['id']);
check('GET /api/changes/{id} returns the diff and bodies',
    isset($res['json']['diff'], $res['json']['before'], $res['json']['after']));

$res = apiCall('POST', '/api/changes/' . $pending['id'] . '/approve');
check('POST approve applies it', $res['json']['status'] === 'applied' && file_exists(ws('route-test.txt')));

$res = apiCall('POST', '/api/changes/' . $pending['id'] . '/approve');
check('approving twice is a 409, not a 500', $res['status'] === 409, (string) ($res['json']['error'] ?? ''));

Changes::propose('write', 'bulk-a.txt', "a\n", 'bulk');
Changes::propose('write', 'bulk-b.txt', "b\n", 'bulk');
$res = apiCall('POST', '/api/changes/decide-all', ['decision' => 'reject', 'conversationId' => 'bulk']);
check('decide-all rejects the batch',
    $res['json']['rejected'] === 2 && !file_exists(ws('bulk-a.txt')), 'two rejected');

$res = apiCall('PUT', '/api/changes/mode', ['mode' => 'auto']);
check('mode can be switched', $res['json']['approval'] === 'auto');
$res = apiCall('PUT', '/api/changes/mode', ['mode' => 'sideways']);
check('an invalid mode is refused', $res['status'] === 400);
Changes::setMode('ask');

$res = apiCall('POST', '/api/changes/chg_nope/approve');
check('an unknown change is a 404', $res['status'] === 404);

// ----------------------------------------------------------------- report

echo "\n";
echo $fail === 0
    ? "all $pass checks passed\n"
    : "$fail of " . ($pass + $fail) . " checks FAILED\n";

ob_end_flush();
exit($fail === 0 ? 0 : 1);
