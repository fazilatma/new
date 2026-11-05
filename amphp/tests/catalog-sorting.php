<?php
define('ABSPATH', __DIR__);
$GLOBALS['fixture_dir'] = sys_get_temp_dir() . '/amphp-sorting-' . uniqid(); mkdir($GLOBALS['fixture_dir']);
$GLOBALS['options'] = array( 'scraper_auto_shop_settings' => array('catalog_source' => 'scraper') );
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function did_action($a){return false;} function add_action(...$a){}
function get_option($key,$default=false){ return array_key_exists($key,$GLOBALS['options']) ? $GLOBALS['options'][$key] : $default; }
function update_option($key,$val,$auto=null){$GLOBALS['options'][$key]=$val; return true;}
function add_option($key,$val,$deprecated='',$auto=null){if (array_key_exists($key,$GLOBALS['options'])) return false; $GLOBALS['options'][$key]=$val; return true;}
function delete_option($key){unset($GLOBALS['options'][$key]);}
function plugin_dir_path($f){return $GLOBALS['fixture_dir'].'/';} function sanitize_key($s){return preg_replace('/[^a-z0-9_\-]/','',strtolower($s));}
function wp_json_encode($v,$flags=0){return json_encode($v,$flags);} function esc_url_raw($v){return $v;} function wp_strip_all_tags($v){return strip_tags($v);}
function get_posts($args){return array();}
require dirname(__DIR__).'/agent.php';
function ck($ok,$msg){if(!$ok)throw new RuntimeException($msg);}
$c='Scraper_Auto_Shop_Plugin';
ck($c::catalog_creation_timestamp(array('created_at'=>'2021-03-01T00:00:00Z'))===1614556800,'ISO date converted');
ck($c::catalog_creation_timestamp(array('created_at'=>'1614556800000'))===1614556800,'Milliseconds converted');
ck($c::catalog_creation_timestamp(array('updated_at'=>'2024-01-01','created_at'=>'not a date'))===0,'No fabricated date from updates');
ck($c::catalog_creation_timestamp(array('date_created'=>new DateTime('2020-01-02T00:00:00Z')))===1577923200,'WooCommerce date object');
$profiles=array('a'=>array('products'=>array(
 array('first',array('title'=>'محصول قدیمی','link'=>'https://a.example/1','created_at'=>'2021-03-01T00:00:00Z')),
 array('second',array('title'=>'بدون تاریخ','link'=>'https://a.example/2','updated_at'=>'2025-05-01')),
))); file_put_contents($GLOBALS['fixture_dir'].'/profiles.json',json_encode($profiles));
$first=$c::get_all_scraped_products();
ck($first[0]['created_ts']===1614556800 && $first[1]['created_ts']===0,'Explicit date and undated baseline retained');
ck(isset($GLOBALS['options']['amphp_catalog_first_seen_v1']) && !isset($first[0]['_catalog_seen_key']),'Baseline saved without exposing tracking key');
ck(!isset($GLOBALS['options']['amphp_catalog_first_seen_lock']),'Lock released');
$profiles['a']['products'][]=array('third',array('title'=>'محصول تازه','link'=>'https://a.example/3'));
file_put_contents($GLOBALS['fixture_dir'].'/profiles.json',json_encode($profiles));
$second=$c::get_all_scraped_products(); $new=$second[2]['created_ts'];
ck($new>time()-10 && $new<=time(),'New product first observation stored');
$profiles['a']['products'][2][1]['title']='نام جدید'; $profiles['a']['productsOrder']=array('third','second','first');
file_put_contents($GLOBALS['fixture_dir'].'/profiles.json',json_encode($profiles));
$third=$c::get_all_scraped_products();
ck($third[0]['created_ts']===$new && $third[1]['created_ts']===0 && $third[2]['created_ts']===1614556800,'First observation stable across reordering and title change');
$before=$GLOBALS['options']['amphp_catalog_first_seen_v1'];
file_put_contents($GLOBALS['fixture_dir'].'/profiles.json','{}');
ck($c::get_all_scraped_products()===array() && $GLOBALS['options']['amphp_catalog_first_seen_v1']===$before,'Empty catalog does not erase history');
// Actual WooCommerce product path carries its immutable creation time into the catalog.
class SortingWooProduct {
 function get_id(){return 99;} function get_name(){return 'ووکامرس';} function get_price(){return 42;} function get_regular_price(){return 42;} function get_sale_price(){return 0;}
 function get_image_id(){return 0;} function get_short_description(){return '';} function get_description(){return '';} function is_in_stock(){return true;}
 function get_date_created(){return new DateTime('2020-01-02T00:00:00Z');}
}
function wc_get_products($args){return array(new SortingWooProduct());} function get_post_meta(...$args){return '';}
function wc_get_product_category_list($id){return 'کالا';}
$GLOBALS['options']['scraper_auto_shop_settings']['catalog_source']='woocommerce';
$woo=$c::get_all_scraped_products();
ck(count($woo)===1 && $woo[0]['created_ts']===1577923200,'WooCommerce date reaches catalog');
unlink($GLOBALS['fixture_dir'].'/profiles.json');rmdir($GLOBALS['fixture_dir']);
echo "Catalog sorting metadata tests passed\n";
