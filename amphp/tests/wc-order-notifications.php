<?php
// Isolated fake WooCommerce/WordPress: no real messages or customer data.
define( 'ABSPATH', __DIR__ );
$GLOBALS['fixture_dir'] = sys_get_temp_dir() . '/amphp-order-' . uniqid(); mkdir( $GLOBALS['fixture_dir'] );
$GLOBALS['options'] = array( 'scraper_auto_shop_settings' => array( 'shop_title' => 'فروشگاه نمونه', 'notif_event_order_placed' => true, 'bale_token' => 'fake', 'bale_chat_id' => '1', 'telegram_token' => 'fake', 'telegram_chat_id' => '2', 'rubika_token' => 'fake', 'rubika_chat_id' => '3' ) );
$GLOBALS['posts'] = array(); $GLOBALS['schedules'] = array(); $GLOBALS['orders'] = array();
function register_activation_hook(...$a) {} function register_deactivation_hook(...$a) {} function did_action($a) { return false; } function add_action(...$a) {}
function plugin_dir_path($f) { return $GLOBALS['fixture_dir'].'/'; } function wp_json_encode($v,$flags=0) { return json_encode($v,$flags); }
function get_option($k,$default=false) { return $GLOBALS['options'][$k] ?? $default; }
function update_option($k,$v,$autoload=false) { $GLOBALS['options'][$k]=$v; return true; }
function add_option($k,$v,$deprecated='',$autoload=true) { if (isset($GLOBALS['options'][$k])) return false; $GLOBALS['options'][$k]=$v; return true; }
function delete_option($k) { unset($GLOBALS['options'][$k]); return true; }
function wp_strip_all_tags($v) { return strip_tags($v); } function sanitize_text_field($v) { return trim(strip_tags($v)); }
function absint($v) { return abs((int)$v); } function wc_get_order($id) { return $GLOBALS['orders'][$id] ?? null; }
function wc_get_order_status_name($status) { return $status === 'pending' ? 'در انتظار پرداخت' : $status; }
function wc_price($n,$args) { return '<span>'.number_format($n,0).' '.($args['currency'] ?? '').'</span>'; }
function wp_next_scheduled($hook,$args) { return $GLOBALS['schedules'][$hook.':'.$args[0]] ?? false; }
function wp_schedule_single_event($when,$hook,$args) { $GLOBALS['schedules'][$hook.':'.$args[0]]=$when; }
function wp_remote_post($url,$args) { $GLOBALS['posts'][]=array($url,$args); return array('code'=>0,'body'=>''); }
function is_wp_error($r) { return false; } function wp_remote_retrieve_response_code($r) { return $r['code']; } function wp_remote_retrieve_body($r) { return $r['body']; }
require dirname(__DIR__).'/agent.php';
function ck($ok,$message) { if (!$ok) throw new RuntimeException($message); }
class FakeDate { function date_i18n($format) { return '1405/08/14 12:34'; } }
class FakeProduct { function get_sku() { return 'SKU-12'; } }
class FakeItem {
 function get_name(){return 'مانتو نمونه';} function get_quantity(){return 2;} function get_product(){return new FakeProduct();}
 function get_formatted_meta_data(){return array((object)array('display_key'=>'رنگ','display_value'=>'<p>آبی</p>'),(object)array('display_key'=>'سایز','display_value'=>'L'));}
 function get_subtotal(){return 500000;} function get_total(){return 450000;} function get_total_tax(){return 9000;}
}
class FakeFee { function get_name(){return 'بسته‌بندی';} function get_total(){return 10000;} }
class FakeOrder {
 public $id; public $status='pending'; public $items=array(); public $meta=array(); public $paid=false;
 function __construct($id){$this->id=$id;} function get_id(){return $this->id;} function get_order_number(){return 'A'.$this->id;}
 function get_currency(){return 'IRT';} function get_status(){return $this->status;} function get_date_created(){return new FakeDate();}
 function get_date_paid(){return $this->paid ? new FakeDate() : null;} function get_payment_method_title(){return 'درگاه تست';}
 function get_address($type){return $type==='billing' ? array('first_name'=>'زهرا','last_name'=>'رضایی','phone'=>'09120000000','email'=>'buyer@example.test','state'=>'تهران','city'=>'تهران','address_1'=>'خیابان نمونه','postcode'=>'1234567890') : array('first_name'=>'علی','city'=>'قم','address_1'=>'نشانی گیرنده','postcode'=>'12345');}
 function get_shipping_method(){return 'پست پیشتاز';} function get_customer_note(){return 'پیش از ارسال تماس بگیرید';}
 function get_items($type='line_item'){return $type==='line_item' ? $this->items : ($type==='fee' ? array(new FakeFee()) : array());}
 function get_subtotal(){return 500000;} function get_discount_total(){return 50000;} function get_shipping_total(){return 20000;}
 function get_total_tax(){return 9000;} function get_total(){return 489000;} function get_coupon_codes(){return array('SALE');}
 function get_edit_order_url(){return 'https://example.test/wp-admin/admin.php?page=wc-orders&action=edit&id='.$this->id;}
 function get_meta($key,$single=true){return $this->meta[$key]??'';} function update_meta_data($key,$value){$this->meta[$key]=$value;} function save_meta_data(){}
 function get_billing_first_name(){return 'زهرا';} function get_billing_last_name(){return 'رضایی';} function get_billing_phone(){return '09120000000';}
}
$order = new FakeOrder(100); $GLOBALS['orders'][100]=$order;
Scraper_Auto_Shop_Plugin::on_wc_order_created(100,$order);
Scraper_Auto_Shop_Plugin::on_wc_order_created(100,$order);
ck(count($GLOBALS['schedules'])===1 && count($GLOBALS['posts'])===0, 'New order schedules once and never sends incomplete data');
Scraper_Auto_Shop_Plugin::on_wc_order_ready($order);
ck(count($GLOBALS['posts'])===0 && !$order->meta, 'Empty order not sent or marked');
$order->items=array(new FakeItem());
Scraper_Auto_Shop_Plugin::on_wc_order_ready($order);
ck(count($GLOBALS['posts'])===3, 'Each enabled messenger receives the completed order');
foreach ($GLOBALS['posts'] as $post) {
 $msg=json_decode($post[1]['body'],true)['text'];
 foreach (array('A100','در انتظار پرداخت','پرداخت ثبت نشده','درگاه تست','زهرا','09120000000','buyer@example.test','خیابان نمونه','نشانی گیرنده','پست پیشتاز','مانتو نمونه','SKU-12','رنگ: آبی','سایز: L','2','450,000','مالیات','بسته‌بندی','489,000','SALE','یادداشت مشتری') as $expected) ck(strpos($msg,$expected)!==false,'Missing '.$expected);
 ck($post[1]['sslverify']===true, 'Customer data must use verified TLS');
 ck(strpos($msg,'order_key')===false, 'No order key in notification');
}
Scraper_Auto_Shop_Plugin::on_wc_order_ready($order);
Scraper_Auto_Shop_Plugin::on_wc_order_notice_fallback(100);
ck(count($GLOBALS['posts'])===3 && $GLOBALS['options']['scraper_analytics_data']['totals']['order_placed']===1, 'Classic, block, custom and cron paths are deduplicated');
$draft = new FakeOrder(101); $draft->status='checkout-draft'; $draft->items=array(new FakeItem()); $GLOBALS['orders'][101]=$draft;
Scraper_Auto_Shop_Plugin::on_wc_order_notice_fallback(101); ck(!$draft->meta && count($GLOBALS['posts'])===3,'Draft checkout is not announced');
$draft->status='processing'; $draft->paid=true; Scraper_Auto_Shop_Plugin::on_wc_order_ready($draft);
ck(count($GLOBALS['posts'])===6 && strpos(json_decode($GLOBALS['posts'][3][1]['body'],true)['text'],'پرداخت ثبت شده')!==false,'Paid status and block checkout');
$GLOBALS['options']['scraper_auto_shop_settings']['notif_event_order_placed']=false;
$disabled=new FakeOrder(102); $disabled->items=array(new FakeItem()); $GLOBALS['orders'][102]=$disabled; Scraper_Auto_Shop_Plugin::on_wc_order_ready($disabled);
ck(count($GLOBALS['posts'])===6 && !empty($disabled->meta) && $GLOBALS['options']['scraper_analytics_data']['totals']['order_placed']===3,'Disabled notifications still track orders without sending');
$chunks=Scraper_Auto_Shop_Plugin::wc_order_notice_chunks(array(str_repeat('😀',6000)), 'A100');
ck(count($chunks)===4 && strpos($chunks[0],'بخش 1/4')!==false, 'Long Unicode messages are split and numbered');
foreach ($chunks as $chunk) ck(mb_strlen($chunk,'UTF-8')<1900,'Each part fits conservative provider limits');
$many=Scraper_Auto_Shop_Plugin::wc_order_notice_chunks(array(str_repeat('a',30000)),'A100');
ck(count($many)===12 && strpos($many[11],'فهرست پیام کامل نیست')!==false, 'Excess parts explicitly marked incomplete');
@unlink($GLOBALS['fixture_dir'].'/scraper_analytics.json'); rmdir($GLOBALS['fixture_dir']);
echo "WooCommerce order notification tests passed\n";
