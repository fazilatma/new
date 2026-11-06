<?php
define('ABSPATH',__DIR__); define('ARRAY_A','ARRAY_A'); define('EMPTY_TRASH_DAYS',getenv('TEST_TRASH_DISABLED') ? 0 : 30); define('HOUR_IN_SECONDS',3600);
$GLOBALS['allow']=true; $GLOBALS['individual_allow']=true; $GLOBALS['store']=array(); $GLOBALS['opts']=array(); $GLOBALS['uid']=1; $GLOBALS['nonces']=true;
$GLOBALS['records']=array(1=>['product','publish','A'],2=>['product','draft','B'],3=>['product_variation','publish','V'],4=>['shop_order','publish','Order'],5=>['product','trash','Old'],6=>['product','private','C']);
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function did_action($a){return false;} function add_action(...$a){}
function current_user_can($cap,...$args){return $GLOBALS['allow'] && ($cap!=='delete_post'||$GLOBALS['individual_allow']);}
function check_ajax_referer($a,$b){if(!$GLOBALS['nonces'])throw new RuntimeException('invalid nonce');}
function wp_unslash($v){return $v;} function wp_generate_password($n,$special=false,$extra=false){return str_repeat('a',$n);}
function set_transient($k,$v,$ttl){$GLOBALS['store'][$k]=$v;return true;} function get_transient($k){return $GLOBALS['store'][$k]??false;} function delete_transient($k){unset($GLOBALS['store'][$k]);}
function get_current_user_id(){return $GLOBALS['uid'];} function get_option($k,$d=false){return $GLOBALS['opts'][$k]??$d;}
function add_option($k,$v,$x='',$a=false){if(isset($GLOBALS['opts'][$k]))return false;$GLOBALS['opts'][$k]=$v;return true;} function delete_option($k){unset($GLOBALS['opts'][$k]);}
function get_post($id){$r=$GLOBALS['records'][$id]??null;return $r?(object)['ID'=>$id,'post_type'=>$r[0],'post_status'=>$r[1]]:null;}
function get_post_status($id){return $GLOBALS['records'][$id][1]??false;}
function wp_trash_post($id){$GLOBALS['records'][$id][1]='trash';return true;}
class Sent extends Exception {public $ok,$data,$status;function __construct($ok,$data,$status){$this->ok=$ok;$this->data=$data;$this->status=$status;}}
function wp_send_json_error($v,$s=200){throw new Sent(false,$v,$s);} function wp_send_json_success($v,$s=200){throw new Sent(true,$v,$s);}
class WooCommerce {}
class FakeDB {
 public $posts='wp_posts',$last_error='';
 function prepare($query,...$args){foreach($args as $v)$query=preg_replace('/%d/',(string)(int)$v,$query,1);return $query;}
 function get_results($query,$format){$group=strpos($query,'GROUP BY')!==false;$out=[];$count=['product'=>0,'product_variation'=>0];preg_match('/ID < (\d+)/',$query,$before);preg_match('/ID <= (\d+)/',$query,$max);foreach(array_reverse($GLOBALS['records'],true) as $id=>$r){if($r[1]==='trash'|| !in_array($r[0],['product','product_variation'],true)||($before&&$id>=(int)$before[1])||($max&&$id>(int)$max[1]))continue;if($group){$count[$r[0]]++;}elseif($r[0]==='product')$out[]=['ID'=>$id,'post_title'=>$r[2],'post_status'=>$r[1]];}if($group){foreach($count as $k=>$n)$out[]=['post_type'=>$k,'n'=>$n];}return array_slice($out,0,51);}
 function get_var($query){$ids=[];foreach($GLOBALS['records'] as $id=>$r)if(in_array($r[0],['product','product_variation'])&&$r[1]!=='trash')$ids[]=$id;return $ids?max($ids):null;}
 function get_col($query){preg_match('/ID <= (\d+)/',$query,$m);$out=[];foreach(array_reverse($GLOBALS['records'],true) as $id=>$r)if(in_array($r[0],['product','product_variation'])&&$r[1]!=='trash'&&$id<=(int)$m[1])$out[]=$id;return array_slice($out,0,20);}
}
$GLOBALS['wpdb']=new FakeDB();
require dirname(__DIR__).'/agent.php';
function ck($v,$m){if(!$v)throw new RuntimeException($m);} function call_ajax($name,$post){$_POST=$post;try{Scraper_Auto_Shop_Plugin::$name();throw new RuntimeException('missing response');}catch(Sent $e){return $e;}}
if ( EMPTY_TRASH_DAYS === 0 ) { $r=call_ajax('ajax_wc_cleanup_start',['confirm'=>'حذف همه']); ck(!$r->ok && $GLOBALS['records'][1][1]==='publish','disabled trash must never delete'); echo "Disabled trash safety test passed\n"; exit; }
$r=call_ajax('ajax_wc_cleanup_list',[]);ck($r->ok&&$r->data['products_count']===3&&$r->data['variations_count']===1&&count($r->data['products'])===3,'list counts and excludes trash and orders');
$GLOBALS['allow']=false;$r=call_ajax('ajax_wc_cleanup_start',['confirm'=>'حذف همه']);ck(!$r->ok&&$r->status===403,'permission required');$GLOBALS['allow']=true;
$GLOBALS['nonces']=false;try{call_ajax('ajax_wc_cleanup_start',['confirm'=>'حذف همه']);throw new RuntimeException('nonce must fail');}catch(RuntimeException $e){ck($e->getMessage()==='invalid nonce','nonce verified');}$GLOBALS['nonces']=true;
$r=call_ajax('ajax_wc_cleanup_start',['confirm'=>'yes']);ck(!$r->ok,'confirmation required');
$r=call_ajax('ajax_wc_cleanup_start',['confirm'=>'حذف همه']);ck($r->ok&&$r->data['products_count']===3&&$r->data['variations_count']===1,'snapshot created');$job=$r->data['job'];
$GLOBALS['uid']=2;$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck(!$r->ok,'user bound job');$GLOBALS['uid']=1;
$GLOBALS['records'][7]=['product','publish','New'];
$GLOBALS['individual_allow']=false;$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck(!$r->ok&&$GLOBALS['records'][6][1]==='private','individual permission checked');$GLOBALS['individual_allow']=true;
$GLOBALS['opts']['amphp_wc_cleanup_batch_lock']=time();$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck(!$r->ok&&$r->status===409,'concurrent batch blocked');unset($GLOBALS['opts']['amphp_wc_cleanup_batch_lock']);
$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck($r->ok&&$r->data['processed']===4&&!$r->data['done'],'batch trashed all eligible types');
ck($GLOBALS['records'][4][1]==='publish'&&$GLOBALS['records'][7][1]==='publish','orders and new products untouched');
$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck($r->ok&&$r->data['done'],'job completes');
$r=call_ajax('ajax_wc_cleanup_batch',['job'=>$job]);ck(!$r->ok,'completed job cannot be reused');
echo "WooCommerce cleanup tests passed\n";
