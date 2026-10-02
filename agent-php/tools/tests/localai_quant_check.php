<?php
declare(strict_types=1);

namespace Arena;

putenv('AUTH_ENABLED=false');
putenv('AGENT_DATA_DIR=/tmp/agentdata_localai_quant');
putenv('AGENT_STORAGE_DIR=/tmp/agentstorage_localai_quant');

require_once '/app/app/Bootstrap.php';

Bootstrap::init();

register_shutdown_function(static function (): void {
    $e = error_get_last();
    if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        fwrite(STDOUT, "FATAL: {$e['message']} in {$e['file']}:{$e['line']}\n");
    }
});

function assertEq($got, $expected, string $label): void {
    if ($got !== $expected) {
        echo "FAIL [$label]: expected " . var_export($expected, true) . " got " . var_export($got, true) . "\n";
    } else {
        echo "OK [$label]\n";
    }
}

$ref = new \ReflectionClass(LocalAI::class);

$extract = $ref->getMethod('extractGgufQuant');
$extract->setAccessible(true);
assertEq($extract->invoke(null, 'qwen2.5-coder-7b-instruct-q4_k_m.gguf'), 'Q4_K_M', 'extract q4_k_m');
assertEq($extract->invoke(null, 'qwen2.5-coder-7b-instruct-q4_k_m-00001-of-00002.gguf'), 'Q4_K_M', 'extract split q4_k_m');
assertEq($extract->invoke(null, 'model-fp16.gguf'), 'F16', 'extract fp16 -> normalised F16');
assertEq($extract->invoke(null, 'model-f16.gguf'), 'F16', 'extract f16');
assertEq($extract->invoke(null, 'model.imatrix.gguf'), null, 'extract no quant -> null');
assertEq($extract->invoke(null, 'DeepSeek-R1-IQ2_M.gguf'), 'IQ2_M', 'extract iq2_m');

$split = $ref->getMethod('isSplitGgufFilename');
$split->setAccessible(true);
assertEq($split->invoke(null, 'model-q4_k_m-00001-of-00002.gguf'), true, 'split detect true');
assertEq($split->invoke(null, 'model-q4_k_m.gguf'), false, 'split detect false');

$quantMap = $ref->getMethod('quantMapFromFiles');
$quantMap->setAccessible(true);
$files = [
    '.gitattributes', 'LICENSE', 'README.md',
    'qwen2.5-coder-7b-instruct-fp16-00001-of-00004.gguf',
    'qwen2.5-coder-7b-instruct-fp16.gguf',
    'qwen2.5-coder-7b-instruct-q2_k.gguf',
    'qwen2.5-coder-7b-instruct-q4_k_m-00001-of-00002.gguf',
    'qwen2.5-coder-7b-instruct-q4_k_m-00002-of-00002.gguf',
    'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    'qwen2.5-coder-7b-instruct-q8_0.gguf',
];
$map = $quantMap->invoke(null, $files);
echo "Quant map keys: " . implode(',', array_keys($map)) . "\n";
assertEq(isset($map['Q4_K_M']), true, 'map has Q4_K_M');
assertEq($map['Q4_K_M']['split'], false, 'map prefers consolidated file over split shards');
assertEq($map['Q4_K_M']['filename'], 'qwen2.5-coder-7b-instruct-q4_k_m.gguf', 'map picks consolidated filename');
assertEq(isset($map['Q8_0']), true, 'map has Q8_0');
assertEq(isset($map['F16']), true, 'fp16 is normalised into an F16 quant entry');
assertEq($map['F16']['filename'], 'qwen2.5-coder-7b-instruct-fp16.gguf', 'F16 map prefers consolidated fp16 file over split shards');

$defaultQuant = $ref->getMethod('defaultQuant');
$defaultQuant->setAccessible(true);
assertEq($defaultQuant->invoke(null, $map), 'Q4_K_M', 'default quant prefers Q4_K_M');

$noQ4 = ['Q8_0' => ['filename' => 'x-q8_0.gguf', 'split' => false], 'Q2_K' => ['filename' => 'x-q2_k.gguf', 'split' => false]];
assertEq($defaultQuant->invoke(null, $noQ4), 'Q8_0', 'default quant falls back to priority order');

// resolveGgufDownload with an explicit file (no network needed)
$resolved = LocalAI::resolveGgufDownload('hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf');
assertEq($resolved['repo'], 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'resolve repo');
assertEq($resolved['quant'], 'Q4_K_M', 'resolve quant');
assertEq($resolved['url'], 'https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf', 'resolve url');

$resolvedUrl = LocalAI::resolveGgufDownload('https://example.com/path/model-q4_k_m.gguf');
assertEq($resolvedUrl['filename'], 'model-q4_k_m.gguf', 'resolve direct url filename');
assertEq($resolvedUrl['quant'], 'Q4_K_M', 'resolve direct url quant');

try {
    LocalAI::resolveGgufDownload('qwen2.5-coder:7b');
    echo "FAIL [bare ollama ref should throw]\n";
} catch (\Throwable $e) {
    echo "OK [bare ollama-style ref without '/' throws: " . $e->getMessage() . "]\n";
}

echo "DONE\n";
