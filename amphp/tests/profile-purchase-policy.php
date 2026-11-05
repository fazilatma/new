<?php
define('ABSPATH', __DIR__);
$GLOBALS['fixture_dir'] = sys_get_temp_dir().'/amphp-policy-'.uniqid(); mkdir($GLOBALS['fixture_dir']);
$GLOBALS['settings'] = array('catalog_source'=>'scraper');
$GLOBALS['meta'] = array(); $GLOBALS['titles'] = array(); $GLOBALS['products'] = array(); $GLOBALS['notices'] = array();
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function add_action(...$a){} function did_action($n){return false;}
function get_option($k,$d=false){return $k==='scraper_auto_shop_settings'?$GLOBALS['settings']:$d;}
function plugin_dir_path($f){return $GLOBALS['fixture_dir'].'/';}
function sanitize_key($s){return preg_replace('/[^a-z0-9_\-]/','',strtolower($s));}
function wp_json_encode($v,$f=0){return json_encode($v,$f);} function get_post_meta($id,$k,$single=true){return $GLOBALS['meta'][$id][$k]??'';}
function get_the_title($id){return $GLOBALS['titles'][$id]??'';} function wc_get_product($id){return $GLOBALS['products'][$id]??null;}
function wc_add_notice($message,$type){$GLOBALS['notices'][]=$message;} function WC(){return $GLOBALS['wc'];}
require dirname(__DIR__).'/agent.php';
function test($ok,$msg){if(!$ok)throw new RuntimeException($msg);}
class ProductFixture {private $id; private $parent; function __construct($id,$parent=0){$this->id=$id;$this->parent=$parent;} function get_id(){return $this->id;} function get_parent_id(){return $this->parent;}}
class CartFixture {public $items=[]; function get_cart(){return $this->items;}}
$profiles=['a'=>['products'=>[['k1',['title'=>'Allowed','url'=>'https://example.test/1']],['k2',['title'=>'Dup']],['k3',['title'=>'Dup']]]]];
file_put_contents($GLOBALS['fixture_dir'].'/profiles.json',json_encode($profiles));
$hash=md5('Allowedhttps://example.test/1');
$stable=Scraper_Auto_Shop_Plugin::profile_product_id('a',0,$profiles['a']['products'][0],Scraper_Auto_Shop_Plugin::profile_product_key_map($profiles['a']['products']));
$GLOBALS['titles']=[1=>'Allowed',2=>'Other',3=>'Allowed',4=>'Dup',5=>'Allowed',6=>'Allowed'];
$GLOBALS['meta']=[1=>['_scraped_hash'=>$hash],3=>['_amphp_sync_via'=>'direct'],4=>['_amphp_sync_via'=>'direct'],5=>['_amphp_profile_id'=>$stable],6=>['_scraped_hash'=>'deleted']];
foreach(range(1,6) as $i)$GLOBALS['products'][$i]=new ProductFixture($i);
test(Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,$GLOBALS['products'][1]),'current profile hash permitted');
test(!Scraper_Auto_Shop_Plugin::profile_only_wc_filter(false,$GLOBALS['products'][1]),'prior stock or purchase denial preserved');
test(!Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,$GLOBALS['products'][2]),'unrelated WC product denied');
test(Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,3),'old direct sync permitted for unique title');
test(!Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,4),'ambiguous old sync denied');
test(Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,new ProductFixture(50,5)),'variation checks parent');
test(!Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,6),'deleted hash denied');
test(Scraper_Auto_Shop_Plugin::profile_cart_items_allowed([['id'=>$hash,'title'=>'Allowed']]),'current storefront item allowed');
test(!Scraper_Auto_Shop_Plugin::profile_cart_items_allowed([['id'=>$hash,'title'=>'Other']]),'forged title denied');
test(!Scraper_Auto_Shop_Plugin::profile_cart_items_allowed([['id'=>'unknown','title'=>'Allowed']]),'forged id denied');
$GLOBALS['wc']=(object)['cart'=>new CartFixture()]; $GLOBALS['wc']->cart->items=[['data'=>$GLOBALS['products'][2]]];
Scraper_Auto_Shop_Plugin::profile_only_check_cart(); test(count($GLOBALS['notices'])===1,'old cart rejected');
$GLOBALS['settings']['catalog_source']='merge'; test(Scraper_Auto_Shop_Plugin::profile_only_wc_filter(true,$GLOBALS['products'][2]),'merge mode unaffected');
$GLOBALS['settings']['catalog_source']='woocommerce'; test(Scraper_Auto_Shop_Plugin::profile_cart_items_allowed([['id'=>'unknown']]),'woocommerce mode unaffected');
unlink($GLOBALS['fixture_dir'].'/profiles.json'); rmdir($GLOBALS['fixture_dir']); echo "Profile purchase policy tests passed\n";
