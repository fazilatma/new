<?php
define('ABSPATH',__DIR__);
$GLOBALS['dir']=sys_get_temp_dir().'/amphp-visitors-'.uniqid(); mkdir($GLOBALS['dir']);
$GLOBALS['opts']=array('scraper_auto_shop_settings'=>array('shop_title'=>'فروشگاه نمونه','notif_event_site_visit'=>true,'telegram_token'=>'fake','telegram_chat_id'=>'100'));
$GLOBALS['transients']=array();$GLOBALS['posts']=array();
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function did_action($a){return false;} function add_action(...$a){}
function get_option($k,$d=false){return $GLOBALS['opts'][$k]??$d;} function update_option($k,$v,$auto=false){$GLOBALS['opts'][$k]=$v;return true;}
function plugin_dir_path($f){return $GLOBALS['dir'].'/';} function wp_json_encode($v,$f=0){return json_encode($v,$f);} function wp_parse_url($url,$component=-1){return parse_url($url,$component);}
function home_url($p='/'){return 'https://store.example/';} function admin_url($p=''){return 'https://store.example/wp-admin/'.$p;}
function is_admin(){return false;} function is_user_logged_in(){return false;} function sanitize_text_field($v){return trim(strip_tags($v));}
function get_transient($k){return $GLOBALS['transients'][$k]??false;} function set_transient($k,$v,$ttl){$GLOBALS['transients'][$k]=$v;return true;} function wp_salt($s){return 'test-salt';}
function wp_remote_post($url,$args){$GLOBALS['posts'][]=array($url,$args);return array('code'=>0,'body'=>'');}
function is_wp_error($v){return false;} function wp_remote_retrieve_response_code($v){return $v['code'];} function wp_remote_retrieve_body($v){return $v['body'];}
require dirname(__DIR__).'/agent.php';
function ck($v,$m){if(!$v)throw new RuntimeException($m);}
$meta=array('visit_page_type'=>'product','visit_referrer_host'=>'google.com','visit_language'=>'fa-IR','visit_screen'=>'small');
$server=array('REMOTE_ADDR'=>'8.8.8.8','HTTP_USER_AGENT'=>'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36');
$info=Scraper_Auto_Shop_Plugin::visitor_notice_details($meta,$server);
ck($info['ip_address']==='8.8.8.8' && $info['device']==='موبایل' && $info['os']==='Android' && $info['browser']==='Chrome 124','Full validated connection address and parsed device');
ck($info['page']==='صفحه محصول' && $info['referrer']==='google.com' && $info['language']==='fa-IR' && $info['screen']==='کوچک','Valid visitor fields');
$spoof=Scraper_Auto_Shop_Plugin::visitor_notice_details(array('visit_referrer_host'=>'google.com/path?key=secret','visit_language'=>'fa\nsecret','visit_screen'=>'huge','visit_page_type'=>'secret'),array('REMOTE_ADDR'=>'invalid','HTTP_USER_AGENT'=>'secret arbitrary user agent'));
ck($spoof['referrer']==='' && $spoof['language']==='' && $spoof['screen']==='' && $spoof['page']==='نامشخص' && $spoof['ip_address']==='', 'Reject arbitrary fields, URLs and invalid IP');
ck(Scraper_Auto_Shop_Plugin::visitor_notice_details(array(),array('REMOTE_ADDR'=>'8.8.8.8\nforged','HTTP_X_FORWARDED_FOR'=>'1.1.1.1'))['ip_address']==='', 'Reject malformed IP and ignore untrusted forwarding header');
$ipv6=Scraper_Auto_Shop_Plugin::visitor_notice_details(array(),array('REMOTE_ADDR'=>'2001:4860:4860::8888','HTTP_USER_AGENT'=>'Googlebot/2.1'));
ck($ipv6['ip_address']==='2001:4860:4860::8888' && $ipv6['device']==='احتمالاً ربات','IPv6 validated and bot labelled');
$_SERVER=$server; Scraper_Auto_Shop_Plugin::record_analytics_event('site_visit',$meta);
ck(count($GLOBALS['posts'])===1,'Visit message dispatched');
$msg=json_decode($GLOBALS['posts'][0][1]['body'],true)['text'];
foreach(array('صفحه محصول','موبایل','Android','Chrome 124','google.com','fa-IR','8.8.8.8','مهمان') as $part) ck(strpos($msg,$part)!==false,'Message missing '.$part);
ck(strpos($msg,'8.8.8.8')!==false && strpos($msg,'Mozilla')===false && $GLOBALS['posts'][0][1]['sslverify']===true,'Full IP included, raw agent omitted; TLS verified');
Scraper_Auto_Shop_Plugin::record_analytics_event('site_visit',$meta);
ck(count($GLOBALS['posts'])===1 && $GLOBALS['opts']['scraper_analytics_data']['totals']['site_visit']===2,'Cooldown suppresses duplicate notifications but not analytics');
$GLOBALS['opts']['scraper_auto_shop_settings']['notif_event_site_visit']=false;
$GLOBALS['transients']=array(); Scraper_Auto_Shop_Plugin::record_analytics_event('site_visit',$meta);
ck(count($GLOBALS['posts'])===1,'Disabled event sends no message');
ob_start(); Scraper_Auto_Shop_Plugin::print_native_visit_tracker(); $disabled=ob_get_clean(); ck($disabled==='','Disabled tracker emits nothing');
$GLOBALS['opts']['scraper_auto_shop_settings']['notif_event_site_visit']=true;
ob_start(); Scraper_Auto_Shop_Plugin::print_native_visit_tracker(); $script=ob_get_clean();
ck(strpos($script,'document.referrer')!==false && strpos($script,'new URL(document.referrer).hostname')!==false && strpos($script,'location.search')===false && strpos($script,'__amphpVisitTracked')!==false,'Native tracker sends only coarse metadata');
@unlink($GLOBALS['dir'].'/scraper_analytics.json');rmdir($GLOBALS['dir']);
echo "Visitor notification tests passed\n";
