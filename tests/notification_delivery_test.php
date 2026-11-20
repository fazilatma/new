<?php
/** Offline regression suite: php -d memory_limit=512M tests/notification_delivery_test.php
 * Extracts only selected real functions: never bootstraps WordPress or calls a live API.
 */
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('memory_limit', '512M');
$root = dirname(__DIR__);
$wanted = array_fill_keys([
    'notifLoadState', 'notifSaveState', 'notifRemindCfg', 'notifDecide', 'notifPrune', 'notifSeedIfNeeded',
    'notifEventOn', 'bslChatRouteForShop', 'bslAnyChatRouteOn', 'notifMessengerConfigured',
    'notifMessengerReady', 'notifMessengerChatId', 'notifSend', 'notifDeliveryErrors',
    'notifDrainChatOutbox', 'notifCheckChats', 'msgrResponseAccepted',
    'vc_migrate_legacy_branch_config', 'vc_normalize_branches',
], true);
$tokens = token_get_all(file_get_contents($root . '/scraper4.php'));
for ($i = 0, $count = count($tokens); $i < $count; $i++) {
    if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) continue;
    $j = $i + 1;
    while (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
    if (!is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || !isset($wanted[$tokens[$j][1]])) continue;
    $name = $tokens[$j][1]; $code = ''; $depth = 0; $opened = false;
    for (; $i < $count; $i++) {
        $t = $tokens[$i]; $text = is_array($t) ? $t[1] : $t; $code .= $text;
        if ($t === '{' || (is_array($t) && in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) { $depth++; $opened = true; }
        if ($t === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
    unset($wanted[$name]);
}
unset($tokens);
if ($wanted) throw new RuntimeException('Missing functions: ' . implode(', ', array_keys($wanted)));
$dir = sys_get_temp_dir() . '/s4-notif-test-' . bin2hex(random_bytes(8));
mkdir($dir);
define('NOTIF_STATE_FILE', $dir . '/state.json');
define('PUSH_SUBS_FILE', $dir . '/no-push.json');
define('S4_CODE_UPDATE_BRANCH', 'arena/821be8f1-new');
register_shutdown_function(static function () use ($dir) {
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
});
$checks = 0;
function check(bool $ok, string $message): void {
    global $checks; $checks++;
    if (!$ok) throw new RuntimeException('FAIL: ' . $message);
    echo "PASS: $message\n";
}
// External dependencies are fakes, not the delivery/state/scanner implementation.
function bslAllShops(array $cn): array { return [['vendor_id'=>42,'token'=>'fake-basalam','shop_name'=>'Test shop','shop'=>1,'is_default'=>true]]; }
function notifShouldSuppressAutoDuplicate(array $cn, string $msg, ?string $feed): bool { return !empty($GLOBALS['suppress']); }
function notifRecordAutoSent(string $msg, ?string $feed): void { $GLOBALS['dedup_records']++; }
function notifAppendSourceText(string $msg, array $cn): string { return $msg; }
function msgrSaveMsg(string $channel, string $id, int $chat, int $shop, string $who = ''): void { $GLOBALS['registry'][] = compact('channel','id','chat','shop','who'); }
function bslSendMediaToMessenger(string $channel, string $token, string $chat, array $media): array { return ['ok'=>true]; }
function fakeSend(string $channel, string $dest, string $text): array {
    $GLOBALS['calls'][] = compact('channel','dest','text');
    // Verify a durable payload exists BEFORE automatic network work starts.
    if (empty($GLOBALS['manual'])) check(!empty(notifLoadState()['chat_outbox']), 'network send has durable outbox');
    $failure = $GLOBALS['fail'][$channel] ?? false;
    if ($failure === true || $failure === $text) return ['ok'=>false,'error'=>'HTTP 429 test','message_id'=>''];
    return ['ok'=>true,'error'=>'','message_id'=>(string)count($GLOBALS['calls'])];
}
function bslSendToBaleh(string $t, string $c, string $m, bool $p = false): array { return fakeSend('baleh',$c,$m); }
function bslSendToRubika(string $t, string $c, string $m): array { return fakeSend('rubika',$c,$m); }
function bslSendToTelegram(string $t, string $c, string $m, bool $p = false): array { return fakeSend('telegram',$c,$m); }
function bslReqRead(string $tk, string $path): array { return ['ok'=>true,'body'=>['data'=>['chats'=>$GLOBALS['rows']]]]; }
function notifScanLimit(array $cn): int { return 20; }
function bslNormalizeChat(array $c, string $tk): array { return ['chat_id'=>$c['id'],'customer_id'=>99,'who'=>'Customer','unseen'=>1,'text'=>$c['last_message']['text'],'updated_at'=>date('c')]; }
function bslMyUserId(string $tk): int { return 10; }
function bslFetchChatMessages(...$args): array { return []; }
function s4ChatItemHasProduct(...$args): bool { return false; }
function s4ChatItemHasQuotedProduct(...$args): bool { return false; }
function bslChatCustomerMessengerMsg(array $nc, ...$args): string { return $nc['text']; }
function bslChatAdminMessengerMsg(array $nc, ...$args): string { return $nc['text']; }
function bslChatCollectMedia(...$args): array { return []; }
function s4NotifFormatConversationMessage(array $entry, array $opts = []): array { return [$entry['nc']['text']]; }
function resetFixture(): array {
    $GLOBALS['calls'] = []; $GLOBALS['fail'] = []; $GLOBALS['registry'] = [];
    $GLOBALS['dedup_records'] = 0; $GLOBALS['suppress'] = true; $GLOBALS['manual'] = false;
    $GLOBALS['rows'] = [['id'=>7,'last_message'=>['id'=>12,'sender'=>['id'=>99],'text'=>'New chat','created_at'=>date('c')]]];
    @unlink(NOTIF_STATE_FILE);
    $st = ['items'=>[], 'last_chat_check'=>time()-60, 'seeded_chats'=>1, 'chat_sig3'=>1];
    notifSaveState($st);
    return ['notif_remind_after'=>0,'notif_events'=>['chat_msg'=>true],
        'baleh'=>['enabled'=>true,'token'=>'fake-bale','chat_id'=>'','all_same'=>false,'chat_ids'=>['conversations'=>'bale-talk']],
        'telegram'=>['enabled'=>true,'token'=>'fake-telegram','chat_id'=>'','all_same'=>false,'chat_ids'=>['conversations'=>'tg-talk']]];
}
function channelCalls(string $channel): array { return array_values(array_filter($GLOBALS['calls'], fn($c)=>$c['channel']===$channel)); }

// HTTP status alone must never acknowledge an API error.
check(msgrResponseAccepted(200, '{"ok":true,"result":{"message_id":1}}'), 'Telegram/Bale acknowledgement');
check(!msgrResponseAccepted(200, '{"ok":false,"description":"Forbidden"}'), 'HTTP 200 API rejection is failure');
check(!msgrResponseAccepted(200, '<html>proxy login</html>'), 'HTML 200 is failure');
check(!msgrResponseAccepted(200, '{}'), 'empty JSON is not acknowledgement');
check(!msgrResponseAccepted(429, '{"ok":true}'), 'non-2xx rejected');
check(msgrResponseAccepted(200, '{"status":"OK","data":{"message_id":"abc"}}'), 'Rubika-style acknowledgement');
check(!msgrResponseAccepted(200, '{"status":"INVALID_INPUT"}'), 'Rubika-style API rejection');

$cn = resetFixture(); $GLOBALS['fail']['telegram'] = true;
$r = notifCheckChats($cn);
check(!$r['ok'] && $r['queued'] === 1 && count($r['errors']) > 0, 'partial failure reported and queued');
check(count(channelCalls('baleh')) === 1 && count(channelCalls('telegram')) === 1, 'each channel attempted once');
check($GLOBALS['dedup_records'] === 0, 'outbox bypasses shared content-only deduplication');
check(channelCalls('baleh')[0]['dest'] === 'bale-talk', 'conversation-specific destination used');
check(!str_contains(file_get_contents(NOTIF_STATE_FILE), 'fake-telegram'), 'no raw messenger credentials in outbox');
check(count(array_filter($GLOBALS['registry'], fn($m)=>$m['chat']===7)) === 1, 'reply registry keeps originating conversation');
// Same row seen again: retry once, no extra reminder jobs.
$r = notifCheckChats($cn);
check($r['queued'] === 1 && count(channelCalls('baleh')) === 1 && count(channelCalls('telegram')) === 2, 'no successful-channel replay or duplicate reminder');
// New process state is loaded by scanner; event may have left the first API page.
$GLOBALS['rows'] = []; $GLOBALS['fail'] = [];
$r = notifCheckChats($cn);
check($r['ok'] && $r['queued'] === 0, 'retry survives reload and event disappearing from API page');
check(count(channelCalls('baleh')) === 1 && count(channelCalls('telegram')) === 3, 'only failed destination retried with reminders disabled');

$cn = resetFixture(); $cn['baleh']['enabled'] = false; $cn['telegram']['enabled'] = false;
$r = notifCheckChats($cn);
check($r['queued'] === 1 && !$GLOBALS['calls'] && $r['errors'], 'disabled channels never send or discard work');
$cn['telegram']['enabled'] = true; $cn['telegram']['chat_ids'] = ['orders'=>'orders-only'];
$r = notifCheckChats($cn);
check($r['queued'] === 1 && !$GLOBALS['calls'] && $r['errors'], 'missing conversation destination is actionable, not silent');
$cn['telegram']['chat_ids']['conversations'] = 'fixed-talk';
$r = notifCheckChats($cn);
check($r['queued'] === 0 && channelCalls('telegram')[0]['dest'] === 'fixed-talk', 'configuration repair drains retained messages');

$cn = resetFixture(); $before = file_get_contents(NOTIF_STATE_FILE);
notifCheckChats($cn, false, false);
check(file_get_contents(NOTIF_STATE_FILE) === $before && !$GLOBALS['calls'], 'send=false preview does not consume notification state');
$GLOBALS['manual'] = true; $GLOBALS['suppress'] = false;
$r = notifCheckChats($cn, true, true);
check($r['ok'] && channelCalls('telegram')[0]['dest'] === 'tg-talk', 'chat test works with only a conversation Chat ID');
check(file_get_contents(NOTIF_STATE_FILE) === $before, 'manual chat test leaves scan state untouched');
$GLOBALS['fail']['telegram'] = true;
$r = notifCheckChats($cn, true, true);
check(!$r['ok'] && str_contains($r['error'], 'HTTP 429'), 'manual chat test exposes delivery error');

$cn = resetFixture(); $st = notifLoadState(); unset($st['last_chat_check']); notifSaveState($st);
$r = notifCheckChats($cn);
check(!$GLOBALS['calls'] && !empty($r['shops'][0]['new_shop']), 'first-run baseline remains silent');

$cn = resetFixture(); $cn['baleh']['enabled'] = false;
$st = notifLoadState();
$st['chat_outbox']['multi'] = ['chat_key'=>'chat:7','sig'=>'12','nc'=>['vendor_id'=>42,'chat_id'=>7,'shop'=>1],
    'chunks'=>['first','second'], 'route'=>'chat_customer','acked'=>[]];
notifSaveState($st); $GLOBALS['fail']['telegram'] = 'second';
notifDrainChatOutbox($cn, $st, ['multi']);
check(count(channelCalls('telegram')) === 2 && !empty(notifLoadState()['chat_outbox']), 'failed second chunk retains job');
$GLOBALS['fail'] = []; $st = notifLoadState();
notifDrainChatOutbox($cn, $st, ['multi']);
check(count(channelCalls('telegram')) === 3 && channelCalls('telegram')[2]['text'] === 'second', 'only unacknowledged chunk retried');
check(empty(notifLoadState()['chat_outbox']), 'completed multi-chunk job removed');

$cn = resetFixture(); $cn['notif_remind_after'] = 1; $GLOBALS['fail']['telegram'] = true;
notifCheckChats($cn);
$st = notifLoadState(); $st['items']['chat:7']['last'] = time()-3600; notifSaveState($st);
$GLOBALS['fail'] = []; $r = notifCheckChats($cn);
check($r['queued'] === 0 && count(channelCalls('baleh')) === 1 && count(channelCalls('telegram')) === 2, 'successful retry resets reminder clock without immediate duplicate');

$cn = resetFixture(); $GLOBALS['rows'][] = ['id'=>8,'last_message'=>['id'=>13,'sender'=>['id'=>99],'text'=>'New chat','created_at'=>date('c')]];
$r = notifCheckChats($cn);
check($r['queued'] === 0 && count(channelCalls('telegram')) === 2, 'identical text in distinct conversations is not suppressed');

$cn = resetFixture(); $GLOBALS['fail']['telegram'] = true; notifCheckChats($cn);
$cn['notif_chat_routes'] = ['42'=>['customer'=>false,'admin'=>false]];
$beforeCount = count($GLOBALS['calls']); $r = notifCheckChats($cn);
check(count($GLOBALS['calls']) === $beforeCount && $r['queued'] === 1, 'disabled shop route retains work without sending');

$cn = resetFixture(); $before = file_get_contents(NOTIF_STATE_FILE);
$tmpBlock = NOTIF_STATE_FILE . '.tmp.' . getmypid(); mkdir($tmpBlock);
$r = notifCheckChats($cn); rmdir($tmpBlock);
check(!$r['ok'] && !$GLOBALS['calls'] && file_get_contents(NOTIF_STATE_FILE) === $before, 'failed checkpoint sends nothing and does not consume event');

$cn = resetFixture(); $st = notifLoadState(); $before = file_get_contents(NOTIF_STATE_FILE);
$st['invalid_utf8'] = "\xB1\x31";
check(!notifSaveState($st) && file_get_contents(NOTIF_STATE_FILE) === $before, 'serialization failure preserves previous durable state');
$source = ['branch'=>'arena/ae9391a9-new','branches'=>['arena/ae9391a9-new','custom'], 'pinned_branch'=>'arena/ae9391a9-new','pinned_at'=>123];
$m = vc_migrate_legacy_branch_config($source);
check($m['changed'] && $m['config']['branch'] === S4_CODE_UPDATE_BRANCH && $m['config']['pinned_branch'] === '', 'source branch and pin migrated');
check(in_array('custom', $m['config']['branches'], true) && in_array(S4_CODE_UPDATE_BRANCH, $m['config']['branches'], true), 'custom updater branches preserved');
check(!vc_migrate_legacy_branch_config($m['config'])['changed'], 'updater migration idempotent');
$full = $source; $full['branches'] = array_merge(['arena/ae9391a9-new'], array_map(fn($i)=>'custom'.$i, range(1,19)));
$m = vc_migrate_legacy_branch_config($full);
check(in_array(S4_CODE_UPDATE_BRANCH, $m['config']['branches'], true), 'canonical updater branch survives full branch-list limit');
echo "OK: $checks checks passed\n";
