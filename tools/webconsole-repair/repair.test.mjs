import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
import {repairWebConsole} from './repair.mjs';

// Minimal reproduction of the supplied source's exact patch boundaries.
// The fixture does not claim to exercise backups, deployment, PHP-FPM, or UI.
const input=String.raw`<?php
/* unchanged header */
define('WCP_VERSION', '1.1.0');
function wcp_init_data_dir(): string {
    return __DIR__ . '/.wconsole_data';
}
function job_start(array &$job) {
    $cmd = 'cd ' . esc(DATA_DIR)
        . ' && ( setsid ' . esc(PHP_BINARY) . ' ' . esc(__FILE__) . ' --bgjob=' . esc($job['id'])
        . ' >> ' . esc($job['log']) . ' 2>&1 < /dev/null & echo $! > ' . esc(JOBS_DIR . '/' . $job['id'] . '.pid') . ' )';
    sh($cmd);
    usleep(150000);
    $job['pid'] = (int)trim((string)@file_get_contents(JOBS_DIR . '/' . $job['id'] . '.pid'));
    job_save($job);
}
function job_pid_alive(int $pid): bool { return $pid > 0 && @file_exists('/proc/' . $pid); }
function job_status(array $job): array {
    if (job_pid_alive((int)$job['pid'])) return ['status' => 'running', 'exit' => null];
    return ['status' => 'dead', 'exit' => -1];
}
function job_stop(array $job) {
    $pid = (int)$job['pid'];
    if ($pid > 0) {
        sh('kill -TERM ' . $pid);
    }
}
function wcp_cli(array $argv) {
    if (isset($argv[1]) && strpos($argv[1], '--bgjob=') === 0) {
        $id = substr($argv[1], 8);
        $job = job_get($id);
        if (!$job) exit(1);
    }
}
function jobs_log(array $job) {
    $size=100; $off=10; $data='hello';
    return ['b64' => base64_encode($data), 'offset' => $size, 'status' => job_status($job)];
}
function term_list(): array {
    $id='abc';
                term_close($id);
    return [];
}
function render_body() { ob_start() ?>
<style>/* unchanged CSS */ .card { color: blue; }</style>
<div id="unchanged-files-and-backups">Original UI stays here</div>
<script>
async function openJob(id,title){
  let offset=0,alive=true,timer=null;
  const sh=openSheet('log',{onclose:()=>{clearInterval(timer)}});
  const poll=async()=>{const s={status:'running'},d={};
    if(s.status==='running'){sh.querySelector('#jstop').classList.remove('hide')}else{sh.querySelector('#jstop').classList.add('hide');clearInterval(timer);}
  };
  await poll();timer=setInterval(poll,1000);
}
</script>
<?php return ob_get_clean(); }
$in = body();
if (!empty($in['api'])) { handle_api(); exit; }
echo render_body();
/* unchanged footer */
`;
const fixed=repairWebConsole(input);

test('patches the known source and keeps unrelated UI and footer intact',()=>{
 assert.equal(fixed.changes.length,13);
 for(const fragment of ['/* unchanged header */','/* unchanged footer */',input.slice(input.indexOf('<style>'),input.indexOf('<script>'))])assert.ok(fixed.source.includes(fragment));
 assert.ok(!fixed.source.includes('esc(PHP_BINARY)'));
 assert.ok(fixed.source.includes("define('WCP_VERSION', '1.1.1');"));
});
test('requires an actual nonce-bound worker receipt and inherited directory',()=>{
 for(const fragment of ['hash_equals($job[\'launch_token\']','getmypid()','--wcp-data-dir=','base64_decode(substr($argument, 15), true)','PHP_SAPI === "cli"','register_argc_argv=1'])assert.ok(fixed.source.includes(fragment));
 assert.ok(fixed.source.includes("file_put_contents($exitFile, \"127\\n\""));
 assert.ok(fixed.source.includes("in_array('--bgjob=' . $job['id'], $args, true)"));
});
test('rejects unsupported, duplicate, incomplete and already-patched source without producing output',()=>{
 assert.throws(()=>repairWebConsole('hello'),/PHP source/);
 assert.throws(()=>repairWebConsole(input.replace("'1.1.0'","'2.0.0'")),/Unexpected source/);
 assert.throws(()=>repairWebConsole(input+"define('WCP_VERSION', '1.1.0');"),/Unexpected source/);
 assert.throws(()=>repairWebConsole(input.replace('                term_close($id);','')),/Unexpected source/);
 assert.throws(()=>repairWebConsole(fixed.source),/already contains/);
});
test('accepts UTF-8 BOM and Windows line endings',()=>{
 assert.equal(repairWebConsole('\uFEFF'+input.replaceAll('\n','\r\n')).source,fixed.source);
});
test('log reader advances only through returned bytes, drains before finishing',()=>{
 assert.ok(fixed.source.includes("'offset' => $off + strlen($data)"));
 assert.ok(fixed.source.includes("if(s.status==='running'||d.has_more)"));
 assert.ok(fixed.source.includes('await poll();if(alive)timer=setInterval'));
 assert.ok(fixed.source.includes("if (wcp_job_alive($job)) {"));
 new Script(fixed.source.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
test('generated offline HTML includes current repair core and valid JavaScript',async()=>{
 const html=await readFile(new URL('./webconsole-repair.html',import.meta.url),'utf8');
 const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];new Script(code);
 const core=(await readFile(new URL('./repair.mjs',import.meta.url),'utf8')).replace('export function repairWebConsole','function repairWebConsole');
 assert.ok(html.includes(core));assert.ok(html.includes("connect-src 'none'"));
 assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!/\bfetch\(/.test(code));
});
test('original and repaired PHP fixture parse successfully', {skip:!process.env.PHP_PARSER_PATH},()=>{
 const require=createRequire(import.meta.url),Engine=require(process.env.PHP_PARSER_PATH);
 const engine=new Engine({parser:{php7:true,suppressErrors:false}});
 assert.equal(engine.parseCode(input).kind,'program');assert.equal(engine.parseCode(fixed.source).kind,'program');
});

test('browser Generate and Download work with a pasted code fence',async()=>{
 const html=await readFile(new URL('./webconsole-repair.html',import.meta.url),'utf8');
 const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const elements=Object.fromEntries(['source','status','changes','download','file','repair'].map(id=>[id,{value:'',textContent:'',children:[],handlers:{},addEventListener(type,cb){this.handlers[type]=cb},replaceChildren(){this.children=[]},append(x){this.children.push(x)}}]));
 let saved,clicked=false;
 const document={getElementById:id=>elements[id],createElement:tag=>({textContent:'',click(){clicked=true}})};
 new Script(code).runInNewContext({document,Blob,URL:{createObjectURL(blob){saved=blob;return 'blob:test'},revokeObjectURL(){}},setTimeout(){}});
 elements.source.value='```php\n'+input+'```';elements.repair.handlers.click();
 assert.equal(elements.status.className,'success',elements.status.textContent);
 assert.equal(elements.download.disabled,false);assert.equal(elements.changes.children.length,13);
 elements.download.handlers.click();assert.equal(clicked,true);assert.equal(await saved.text(),fixed.source);
 elements.source.handlers.input();assert.equal(elements.download.disabled,true);
});
