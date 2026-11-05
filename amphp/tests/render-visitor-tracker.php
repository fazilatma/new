<?php
define('ABSPATH',__DIR__);
function register_activation_hook(...$a){} function register_deactivation_hook(...$a){} function add_action(...$a){} function did_action($a){return false;}
function get_option($key,$default=false){return $key==='scraper_auto_shop_settings' ? array('notif_event_site_visit'=>true) : $default;}
function plugin_dir_path($f){return sys_get_temp_dir().'/amphp-visitor-no-fixtures/';}
function is_admin(){return false;} function admin_url($p=''){return 'https://store.example/wp-admin/'.$p;} function wp_json_encode($v,$f=0){return json_encode($v,$f);}
require dirname(__DIR__).'/agent.php';
Scraper_Auto_Shop_Plugin::print_native_visit_tracker();
