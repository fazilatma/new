<?php
// Render the real inline watcher using lightweight WordPress stubs.
define( 'ABSPATH', __DIR__ );
function get_option( $k, $d = false ) { return $d; }
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function wp_json_encode( $v, $f = 0 ) { return json_encode( $v, $f ); }
function home_url( $v ) { return 'https://example.test/'; }
function add_query_arg( $k, $v, $u ) { return $u . '?' . $k . '=' . $v; }
function register_activation_hook( ...$a ) {} function register_deactivation_hook( ...$a ) {} function did_action( $a ) { return false; } function add_action( ...$a ) {}
require dirname( __DIR__ ) . '/agent.php';
echo Scraper_Auto_Shop_Plugin::storefront_refresh_script();
