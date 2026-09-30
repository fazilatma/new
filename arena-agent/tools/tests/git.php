<?php

/**
 * Git and the shell, against the real binaries.
 *
 * This suite starts actual processes, so the runner needs --spawn:
 *
 *   node ../agent-php/tools/phprun.mjs --root=. --spawn tools/tests/git.php
 *
 * Nothing here is mocked. A throwaway repository is created in /tmp, real
 * commits are made in it, and the assertions read what git actually reports.
 */

declare(strict_types=1);

namespace Arena;

ob_start();

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
        is_dir($path) && !is_link($path) ? rmtree($path) : @unlink($path);
    }
    @rmdir($dir);
}

/* Inside the mounted project, not /tmp: the test starts real git processes,
   and those run on the host, which cannot see the guest's own /tmp. */
$base = '/app/.tmp-git-test';
rmtree($base);
@mkdir($base . '/data', 0775, true);
@mkdir($base . '/storage', 0775, true);
putenv("ARENA_DATA_DIR=$base/data");
putenv("ARENA_STORAGE_DIR=$base/storage");
putenv('ARENA_AUTH=false');
putenv('ARENA_SHELL=true');
putenv('ARENA_GIT=true');

require_once '/app/src/Bootstrap.php';
Bootstrap::init();

$pass = 0;
$fail = 0;

function group(string $name): void
{
    echo "\n=== $name ===\n";
}

function check(string $what, bool $ok, string $note = ''): void
{
    global $pass, $fail;
    if ($ok) {
        $pass++;
        printf("OK  %-48s %s\n", $what, $note);
    } else {
        $fail++;
        printf("**  %-48s %s\n", $what, $note !== '' ? $note : 'FAILED');
    }
}

/** @return mixed */
function caught(callable $fn): mixed
{
    try {
        $fn();
        return null;
    } catch (HttpError $e) {
        return $e;
    }
}

// ------------------------------------------------------------- 0. the host

group('0. the host');

check('proc_open is usable', Shell::available());
check('git is installed', Git::installed(), Git::version());
check('git support is on', Git::enabled());

if (!Git::installed()) {
    echo "\ngit is not available; the rest of this suite cannot run.\n";
    ob_end_flush();
    exit(1);
}

// ------------------------------------------------------------ 1. the shell

group('1. the shell');

$r = Shell::run('echo hello');
check('a command runs and returns its output',
    $r['exitCode'] === 0 && trim($r['stdout']) === 'hello');

$r = Shell::run('python3 -c "print(6*7)"');
check('python is there and works', trim($r['stdout']) === '42', trim($r['stdout']));

$r = Shell::run('node -e "console.log(process.version)"');
check('node is there and works', str_starts_with(trim($r['stdout']), 'v'), trim($r['stdout']));

$r = Shell::run('ls /definitely-not-here');
check('a failing command reports its exit code, not an exception',
    $r['exitCode'] !== 0 && $r['stderr'] !== '');

$r = Shell::run('pwd');
check('commands run inside the workspace',
    str_ends_with(rtrim(trim($r['stdout']), '/'), 'storage/workspaces/default'), trim($r['stdout']));

$e = caught(static fn() => Shell::run('rm -rf /'));
check('the deny-list stops the obvious disaster',
    $e instanceof HttpError && $e->status === 403, $e ? $e->getMessage() : 'not blocked');

$r = Shell::run('sleep 5', '', 1);
check('a command that overruns is stopped', $r['timedOut'] && $r['exitCode'] === 124,
    $r['durationMs'] . ' ms');

// The agent's own tool, now that the shell is on.
$t = Tools::run('run_command', ['command' => 'echo tool-ran']);
check('the run_command tool works', $t['ok'] && str_contains($t['result'], 'tool-ran'));
check('run_command reports the exit code to the model',
    str_contains($t['result'], '[exit 0'), $t['summary']);
$t = Tools::run('run_command', ['command' => 'python3 -c "import sys; sys.exit(3)"']);
check('a non-zero exit is surfaced as failure',
    !$t['ok'] && str_contains($t['result'], '[exit 3'), $t['summary']);

// ------------------------------------------------------- 2. an empty repo

group('2. creating a repository');

check('the workspace starts without a repository', !Git::isRepo());

$e = caught(static fn() => Git::status());
check('asking for status first gives a useful 409',
    $e instanceof HttpError && $e->status === 409
    && str_contains($e->getMessage(), 'not a git repository'));

Git::setIdentity('Test Person', 'test@example.com');
$init = Git::init();
check('init creates a repository', $init['ok'] && Git::isRepo());

$e = caught(static fn() => Git::init());
check('initialising twice is refused', $e instanceof HttpError && $e->status === 409);

$st = Git::status();
check('a fresh repository is clean', $st['clean'] && $st['files'] === []);
check('and starts on main', $st['branch'] === 'main', $st['branch']);
check('log on an empty repository is empty, not an error', Git::log() === []);

// ------------------------------------------------------- 3. the first work

group('3. staging and committing');

Workspace::write('app.py', "def main():\n    print('one')\n");
Workspace::write('notes.md', "# Notes\n");

$st = Git::status();
check('new files show as untracked', count($st['files']) === 2 && $st['files'][0]['untracked']);
check('untracked files are labelled', $st['files'][0]['label'] === 'untracked');
check('nothing is staged yet', $st['staged'] === 0);

Git::stage(['app.py']);
$st = Git::status();
$app = array_values(array_filter($st['files'], static fn(array $f): bool => $f['path'] === 'app.py'))[0];
check('staging moves one file into the index', $app['staged'] && $st['staged'] === 1);
check('the other file is left alone', $st['unstaged'] === 1);

Git::unstage(['app.py']);
check('unstaging puts it back', Git::status()['staged'] === 0);

$e = caught(static fn() => Git::commit(''));
check('a commit with no message is refused', $e instanceof HttpError && $e->status === 400);

$e = caught(static fn() => Git::commit('nothing staged'));
check('committing with an empty index is a 409',
    $e instanceof HttpError && $e->status === 409, $e ? $e->getMessage() : '');

$c = Git::commit('Add the entry point and some notes', ['app.py', 'notes.md']);
check('committing with paths stages them first', $c['ok'] && $c['commit'] !== null);
check('the commit has the message we gave it',
    $c['commit']['subject'] === 'Add the entry point and some notes');
check('and the identity we configured',
    $c['commit']['author'] === 'Test Person' && $c['commit']['email'] === 'test@example.com',
    $c['commit']['author']);
check('the tree is clean afterwards', Git::status()['clean']);

$log = Git::log();
check('the commit appears in the log', count($log) === 1 && $log[0]['short'] !== '');
check('the log entry carries an ISO date',
    (bool) preg_match('/^\d{4}-\d{2}-\d{2}T/', $log[0]['date']), $log[0]['date']);

// ------------------------------------------------------------ 4. changing

group('4. diffs');

Workspace::write('app.py', "def main():\n    print('two')\n\n\nmain()\n");

$st = Git::status();
$app = array_values(array_filter($st['files'], static fn(array $f): bool => $f['path'] === 'app.py'))[0];
check('an edited file is modified, not untracked',
    $app['label'] === 'modified' && !$app['untracked']);

$d = Git::diff();
check('the working diff shows what changed',
    str_contains($d, "-    print('one')") && str_contains($d, "+    print('two')"));

check('the staged diff is empty before staging', trim(Git::diff('', true)) === '');
Git::stage(['app.py']);
check('after staging it moves to the staged diff',
    str_contains(Git::diff('', true), "+    print('two')") && trim(Git::diff()) === '');

Workspace::write('extra.txt', "brand new\n");
$d = Git::diff('extra.txt');
check('an untracked file still gets a readable diff',
    str_contains($d, '+brand new'), 'shown as an addition');

Git::commit('Print two instead of one', [], true);
$st = Git::status();
check('committing with --all sweeps up tracked changes',
    count(array_filter($st['files'], static fn(array $f): bool => !$f['untracked'])) === 0);
check('but leaves untracked files alone, as git does',
    count(array_filter($st['files'], static fn(array $f): bool => $f['untracked'])) === 1);
check('there are now two commits', count(Git::log()) === 2, count(Git::log()) . ' commits');
Git::commit('Add the extra file', ['extra.txt']);

// Discarding.
Workspace::write('app.py', "ruined\n");
check('the file is dirty before discarding', !Git::status()['clean']);
Git::discard(['app.py']);
check('discard restores the committed contents',
    str_contains((string) file_get_contents(Workspace::root() . '/app.py'), "print('two')"));

Workspace::write('junk.tmp', "x\n");
Git::discard(['junk.tmp']);
check('discarding an untracked file removes it',
    !in_array('junk.tmp', scandir(Workspace::root()) ?: [], true));

// --------------------------------------------------------- 5. branches

group('5. branches');

$b = Git::branches();
check('the current branch is reported', $b['current'] === 'main', $b['current']);
check('local branches are listed', in_array('main', $b['local'], true));

Git::checkout('feature/nice-name', true);
check('a new branch can be created and switched to',
    Git::status()['branch'] === 'feature/nice-name');

Workspace::write('feature.txt', "only on the branch\n");
Git::commit('Add a feature file', ['feature.txt']);
Git::checkout('main');
/* scandir, not file_exists: under the wasm bridge the stat cache outlives
   clearstatcache(), while a directory read goes to the real filesystem. On a
   normal host either would do. */
check('switching back removes the branch-only file',
    !in_array('feature.txt', scandir(Workspace::root()) ?: [], true),
    implode(' ', array_diff(scandir(Workspace::root()) ?: [], ['.', '..'])));

$e = caught(static fn() => Git::checkout('no-such-branch'));
check('checking out a branch that does not exist is a 400',
    $e instanceof HttpError && $e->status === 400, $e ? substr($e->getMessage(), 0, 60) : '');

/* Names that a shell would read as syntax. Git allows a semicolon in a ref
   and almost anything in a filename, so if these were interpolated into a
   command line rather than passed as arguments, something would run. */
Git::checkout('evil;touch-pwned', true);
check('a branch name containing shell syntax is just a name',
    Git::status()['branch'] === 'evil;touch-pwned', Git::status()['branch']);
Git::checkout('main');

$nasty = 'a; touch pwned.txt; b.md';
Workspace::write($nasty, "harmless\n");
Git::commit('Add a file with an alarming name', [$nasty]);
$tracked = array_column(Git::log(1), 'subject');
check('a filename containing shell syntax is committed, not executed',
    $tracked === ['Add a file with an alarming name']);
check('and no command ran from it',
    !in_array('pwned.txt', scandir(Workspace::root()) ?: [], true),
    'argument arrays, never shell strings');
check('the file really is in the repository',
    str_contains(Git::diff($nasty, false) . implode('', array_column(Git::status()['files'], 'path'))
        . (Git::status()['clean'] ? 'clean' : ''), 'clean'),
    'committed cleanly');

// ------------------------------------------------------- 6. remotes, keys

group('6. remotes and credentials');

check('there are no remotes yet', Git::remotes() === []);

$e = caught(static fn() => Git::setRemote('origin', 'not-a-url'));
check('a nonsense remote URL is refused', $e instanceof HttpError && $e->status === 400);

$e = caught(static fn() => Git::setRemote('bad name', 'https://example.com/r.git'));
check('a nonsense remote name is refused', $e instanceof HttpError && $e->status === 400);

Git::setRemote('origin', 'https://example.com/acme/repo.git');
check('a remote can be added', Git::remotes()[0]['url'] === 'https://example.com/acme/repo.git');

Git::setRemote('origin', 'https://user:secret@example.com/acme/repo.git');
check('a credential pasted into the URL is not stored',
    !str_contains(Git::remotes()[0]['url'], 'secret'), Git::remotes()[0]['url']);

check('no token is configured to begin with', !Git::hasToken());
Git::setToken('ghp_abcdef1234567890');
check('a token can be stored', Git::hasToken());

$rawSetting = (string) Db::setting('git_token', '');
check('the token is encrypted at rest',
    str_starts_with($rawSetting, 'enc:v1:') && !str_contains($rawSetting, 'ghp_'),
    substr($rawSetting, 0, 16) . '…');

check('the token never appears in text shown to a person',
    !str_contains(Git::scrub('pushing with ghp_abcdef1234567890 now'), 'ghp_abc'),
    Git::scrub('pushing with ghp_abcdef1234567890 now'));
check('credentials in a URL are scrubbed too',
    Git::scrub('https://tok@example.com/x.git') === 'https://example.com/x.git');

$e = caught(static fn() => Git::push('nowhere'));
check('pushing to a remote that does not exist explains itself',
    $e instanceof HttpError && str_contains($e->getMessage(), "no remote called 'nowhere'"));

$e = caught(static fn() => Git::push('origin'));
check('a push to an unreachable host fails with a readable message',
    $e instanceof HttpError && $e->status === 400, substr($e ? $e->getMessage() : '', 0, 72));
check('and the message does not leak the token',
    $e instanceof HttpError && !str_contains($e->getMessage(), 'ghp_abc'));

Git::setToken('');
check('the token can be cleared', !Git::hasToken());

// ---------------------------------------------------- 7. pushing for real

group('7. a real push to a real remote');

/* The workspace root is <base>/storage/workspaces/default, so this is the
   bare repository three levels up. A relative URL resolves identically for
   the guest and for the git process, whichever filesystem it is looking at. */
$remoteDir = $base . '/remote.git';
$remoteRef = '../../../remote.git';
$init = proc_open(['git', 'init', '--bare', '-b', 'main', 'remote.git'],
    [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $base);
if (is_resource($init)) {
    stream_get_contents($pipes[1]);
    stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($init);
}
check('a bare repository was created to push into', is_dir($remoteDir . '/refs'));

Git::setRemote('local', $remoteRef);
$push = Git::push('local', 'main', true);
check('push succeeds', $push['ok'], trim(explode("\n", $push['output'])[0] ?? ''));

$after = Git::status();
check('the branch now tracks the remote', $after['upstream'] !== '', $after['upstream']);
check('and is level with it', $after['ahead'] === 0 && $after['behind'] === 0);

Workspace::write('after-push.txt', "more\n");
Git::commit('Add a file after pushing', ['after-push.txt']);
check('a new commit shows as ahead', Git::status()['ahead'] === 1);
Git::push('local', 'main');
check('pushing again clears it', Git::status()['ahead'] === 0);

$pull = Git::pull('local', 'main');
check('pull works too', $pull['ok'], trim(explode("\n", $pull['output'])[0] ?? ''));

// ------------------------------------------------------- 8. agent tools

group('8. the agent’s git tools');

$names = Tools::availableNames();
check('git tools appear once there is a repository',
    in_array('git_status', $names, true) && in_array('git_commit', $names, true),
    implode(', ', $names));

$t = Tools::run('git_status', []);
check('git_status names the branch', $t['ok'] && str_contains($t['result'], 'On branch main'));

Workspace::write('tooled.py', "x = 1\n");
$t = Tools::run('git_status', []);
check('git_status lists the new file',
    str_contains($t['result'], 'tooled.py') && str_contains($t['result'], 'untracked'));

$t = Tools::run('git_commit', ['message' => 'Add a file through the tool', 'paths' => ['tooled.py']]);
check('git_commit commits', $t['ok'] && str_contains($t['result'], 'Add a file through the tool'));
check('and the tree is clean after it', Git::status()['clean']);

$t = Tools::run('git_log', ['limit' => 3]);
check('git_log lists recent commits',
    substr_count(trim($t['result']), "\n") === 2, $t['summary']);

Workspace::write('tooled.py', "x = 2\n");
$t = Tools::run('git_diff', []);
check('git_diff shows the working change',
    str_contains($t['result'], '-x = 1') && str_contains($t['result'], '+x = 2'));

$t = Tools::run('git_commit', ['message' => '']);
check('git_commit without a message is refused, not crashed', !$t['ok']);

// ----------------------------------------------------------- 9. overview

group('9. the overview endpoint');

$o = Git::overview();
check('overview reports the installation', $o['installed'] && $o['enabled'] && $o['repo']);
check('overview carries status, branches, remotes and log',
    isset($o['status'], $o['branches'], $o['remotes'], $o['log']));
check('overview never includes the token', !array_key_exists('token', $o));
check('it does say whether one is set', array_key_exists('hasToken', $o));

// ----------------------------------------------------------------- report

echo "\n";
echo $fail === 0
    ? "all $pass checks passed\n"
    : "$fail of " . ($pass + $fail) . " checks FAILED\n";

ob_end_flush();
exit($fail === 0 ? 0 : 1);
