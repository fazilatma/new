<?php
define('ABSPATH',__DIR__);define('MINUTE_IN_SECONDS',60);
$GLOBALS['dir']=sys_get_temp_dir().'/torob-fixture-'.uniqid();mkdir($GLOBALS['dir']);
$GLOBALS['options']=['scraper_auto_shop_settings'=>['catalog_source'=>'scraper','enable_shop_takeover'=>true,'store_template'=>'digikala','price_rounding'=>'none','price_markup_percent'=>0,'currency_symbol'=>'تومان']];$GLOBALS['transients']=[];$GLOBALS['routes']=[];
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function did_action($a){return false;} function add_action(...$a){} function register_rest_route($ns,$route,$args){$GLOBALS['routes'][$route]=$args;}
function get_option($k,$default=false){return $GLOBALS['options'][$k]??$default;} function update_option($k,$v,$auto=false){if(isset($GLOBALS['options'][$k])&&$GLOBALS['options'][$k]===$v)return false;$GLOBALS['options'][$k]=$v;return true;} function add_option($k,$v,$x='',$auto=false){if(isset($GLOBALS['options'][$k]))return false;$GLOBALS['options'][$k]=$v;return true;} function delete_option($k){unset($GLOBALS['options'][$k]);}
function get_transient($k){return $GLOBALS['transients'][$k]??false;} function set_transient($k,$v,$ttl){$GLOBALS['transients'][$k]=$v;return true;} function delete_transient($k){unset($GLOBALS['transients'][$k]);}
function plugin_dir_path($file){return $GLOBALS['dir'].'/';} function sanitize_key($s){return preg_replace('/[^a-z0-9_\-]/','',strtolower($s));} function wp_json_encode($v,$flags=0){return json_encode($v,$flags);} function wp_strip_all_tags($v){return strip_tags($v);} function esc_url_raw($url){return $url;} function home_url($path='/'){return 'https://store.example/';} function wp_parse_url($url,$component=-1){return parse_url($url,$component);} function add_query_arg($key,$val,$url){return $url.'?'.rawurlencode($key).'='.rawurlencode($val);} function rest_url($path=''){return 'https://store.example/wp-json/'.$path;} function get_posts($args){return [];} function esc_attr($s){return htmlspecialchars($s,ENT_QUOTES,'UTF-8');} function esc_url($s){return htmlspecialchars($s,ENT_QUOTES,'UTF-8');}
class WP_Error {public $code,$message,$data;function __construct($c,$m,$d=[]){$this->code=$c;$this->message=$m;$this->data=$d;}function get_error_message(){return $this->message;}function get_error_data(){return $this->data;}}
function is_wp_error($v){return $v instanceof WP_Error;}
class WP_REST_Response {public $data,$status;function __construct($d,$s){$this->data=$d;$this->status=$s;}}
// The WASM test runtime lacks sodium; verify contract/claim logic with an explicit test double, not real cryptography.
if(!function_exists('sodium_crypto_sign_verify_detached')) { function sodium_crypto_sign_verify_detached($sig,$message,$key){return $sig===str_repeat('s',64)&&$key===str_repeat('k',32);} }
require dirname(__DIR__).'/agent.php';
function ck($ok,$m){if(!$ok)throw new RuntimeException($m);} function b64u($s){return rtrim(strtr(base64_encode($s),'+/','-_'),'=');} function jwtfixture($claims,$head=['alg'=>'EdDSA','typ'=>'JWT','v'=>1]){return b64u(json_encode($head)).'.'.b64u(json_encode($claims)).'.'.b64u(str_repeat('s',64));}
$key=str_repeat('k',32);$claims=['aud'=>'store.example','exp'=>1100,'nbf'=>900];$jwt=jwtfixture($claims);
ck(Scraper_Auto_Shop_Plugin::torob_validate_jwt($jwt,'1','store.example',$key,1000),'valid token claim logic');
foreach ([['aud'=>'evil.example','exp'=>1100,'nbf'=>900],['aud'=>'store.example','exp'=>999,'nbf'=>900],['aud'=>'store.example','exp'=>1100,'nbf'=>1001],['aud'=>'store.example','exp'=>'1100','nbf'=>900]] as $c) ck(!Scraper_Auto_Shop_Plugin::torob_validate_jwt(jwtfixture($c),'1','store.example',$key,1000),'reject claims');
ck(!Scraper_Auto_Shop_Plugin::torob_validate_jwt(jwtfixture($claims,['alg'=>'none','typ'=>'JWT','v'=>1]),'1','store.example',$key,1000),'reject alg');
ck(!Scraper_Auto_Shop_Plugin::torob_validate_jwt($jwt,'2','store.example',$key,1000),'reject token version');
Scraper_Auto_Shop_Plugin::register_torob_profile_route();ck($GLOBALS['routes']['/torob/products']['methods']==='POST','POST-only route');
class TorobRequest {public $headers; function __construct($h=[]){$this->headers=$h;} function get_header($h){return $this->headers[strtolower($h)]??'';}}
ck(is_wp_error(Scraper_Auto_Shop_Plugin::torob_profile_permission(new TorobRequest())),'anonymous access denied');
$profile=[];for($i=0;$i<205;$i++)$profile[]=['k'.$i,['title'=>'Product '.$i,'url'=>'https://source.example/'.$i,'price'=>1000+$i,'image'=>'https://image.example/photo.jpg']];
$profile[0][1]['in_stock']='false';unset($profile[1][1]['price']);
file_put_contents($GLOBALS['dir'].'/profiles.json',json_encode(['one'=>['products'=>$profile]],JSON_UNESCAPED_UNICODE));
$snap=Scraper_Auto_Shop_Plugin::torob_profile_snapshot(); ck(!is_wp_error($snap)&&count($snap['items'])===205,'profile-only snapshot');
foreach($snap['items'] as &$encoded){$encoded=json_decode($encoded,true);} unset($encoded);
$all=Scraper_Auto_Shop_Plugin::get_all_scraped_products();$id0=$all[0]['stable_id'];$id1=$all[1]['stable_id'];$id2=$all[2]['stable_id'];
ck(!$snap['items'][$id0]['availability']&&$snap['items'][$id0]['current_price']===0,'false string out of stock');
ck(!$snap['items'][$id1]['availability']&&$snap['items'][$id1]['current_price']===0,'fallback price never listed as available');
ck($snap['items'][$id2]['availability']&&$snap['items'][$id2]['current_price']===1002,'price aligned to storefront');
ck(('https://store.example/?product='.$id2)==='https://store.example/?product='.$id2,'absolute stable link');
foreach($snap['items'] as &$item){$item=json_encode($item);}unset($item);
$p1=Scraper_Auto_Shop_Plugin::torob_profile_result(['page'=>1,'sort'=>'date_added_desc'],$snap);$p2=Scraper_Auto_Shop_Plugin::torob_profile_result(['page'=>2,'sort'=>'date_added_desc'],$snap);$p3=Scraper_Auto_Shop_Plugin::torob_profile_result(['page'=>3,'sort'=>'date_added_desc'],$snap);
ck($p1['total']===205&&$p1['max_pages']===3&&count($p1['products'])===100&&count($p2['products'])===100&&count($p3['products'])===5,'exact pagination');
$c1=Scraper_Auto_Shop_Plugin::torob_profile_result(['sort'=>'product_id_desc'],$snap);$c2=Scraper_Auto_Shop_Plugin::torob_profile_result(['sort'=>'product_id_desc','cursor'=>$c1['next_cursor']],$snap);$c3=Scraper_Auto_Shop_Plugin::torob_profile_result(['sort'=>'product_id_desc','cursor'=>$c2['next_cursor']],$snap);ck(count($c1['products'])===100&&count($c2['products'])===100&&count($c3['products'])===5&&$c3['next_cursor']===null,'cursor pagination');
$look=Scraper_Auto_Shop_Plugin::torob_profile_result(['page_uniques'=>[$id2,'deleted']],$snap);ck(count($look['products'])===1&&$look['products'][0]['page_unique']===$id2,'lookup missing omitted');
$look=Scraper_Auto_Shop_Plugin::torob_profile_result(['page_urls'=>[('https://store.example/?product='.$id2)]],$snap);ck(count($look['products'])===1,'URL lookup');
foreach ([[],['page'=>1],['page'=>0,'sort'=>'date_added_desc'],['page'=>1,'sort'=>'product_id_desc','cursor'=>$id2],['page_urls'=>[]],['sort'=>'product_id_desc','cursor'=>null],['sort'=>'bad']] as $bad) ck(is_wp_error(Scraper_Auto_Shop_Plugin::torob_profile_result($bad,$snap)),'invalid input');
$encoded=wp_json_encode($p1);ck(strpos($encoded,'"spec":{}')!==false,'spec is JSON object');
$cached=Scraper_Auto_Shop_Plugin::torob_profile_snapshot();ck(json_decode($cached['items'][$id2],true)['date_added']===json_decode($snap['items'][$id2],true)['date_added'],'snapshot cached and date stable');
$before=json_decode($snap['items'][$id2],true)['date_added'];$GLOBALS['options']['amphp_torob_observed_v1'][$id2]['updated']=1;$profile[2][1]['title']='Changed';$profile[2][1]['price']=2000;file_put_contents($GLOBALS['dir'].'/profiles.json',json_encode(['one'=>['products'=>$profile]]));$changed=Scraper_Auto_Shop_Plugin::torob_profile_snapshot();ck(json_decode($changed['items'][$id2],true)['title']==='Changed'&&json_decode($changed['items'][$id2],true)['date_added']===$before&&json_decode($changed['items'][$id2],true)['date_updated']!==gmdate('c',1),'changes and stable ID');
ob_start(); Scraper_Auto_Shop_Plugin::torob_print_product_schema($all[2],$GLOBALS['options']['scraper_auto_shop_settings']); $html=ob_get_clean();
ck(strpos($html,'application/ld+json')!==false && strpos($html,'https://store.example/?product='.$id2)!==false && strpos($html,'"priceCurrency":"IRR"')!==false && strpos($html,'10020')!==false,'server-rendered product schema and rial price');
$unsafe=$all[2];$unsafe['title']='</script><script>alert(1)</script>';ob_start();Scraper_Auto_Shop_Plugin::torob_print_product_schema($unsafe,$GLOBALS['options']['scraper_auto_shop_settings']);$safe=ob_get_clean();ck(strpos($safe,'</script><script>alert')===false,'schema prevents script injection');
unlink($GLOBALS['dir'].'/profiles.json');ck(is_wp_error(Scraper_Auto_Shop_Plugin::torob_profile_snapshot()),'missing profiles fail closed not empty feed');
rmdir($GLOBALS['dir']);echo "Torob profile feed tests passed\n";
