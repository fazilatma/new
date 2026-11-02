<?php
define( 'ABSPATH', __DIR__ );
$GLOBALS['routes'] = array();
$GLOBALS['admin_allowed'] = false;
$GLOBALS['response'] = array( 'code' => 200, 'body' => '<div id="amphp-storefront-root"></div>' );
function register_activation_hook( ...$args ) {}
function register_deactivation_hook( ...$args ) {}
function did_action( $name ) { return false; }
function add_action( ...$args ) {}
function register_rest_route( $namespace, $route, $args ) { $GLOBALS['routes'][$route] = $args; }
function current_user_can( $cap ) { return $cap === 'manage_options' && $GLOBALS['admin_allowed']; }
function get_option( $name, $default = false ) { return $default; }
function plugin_dir_path( $file ) { return dirname( $file ) . '/'; }
function home_url( $path ) { return 'https://example.test/' . ltrim( $path, '/' ); }
function admin_url( $path ) { return 'https://example.test/wp-admin/' . $path; }
function get_bloginfo( $name ) { return '6.8'; }
function rest_ensure_response( $data ) { return $data; }
function wp_safe_remote_get( $url, $args ) { $GLOBALS['request'] = array( $url, $args ); return $GLOBALS['response']; }
function is_wp_error( $response ) { return $response instanceof WP_Error; }
function wp_remote_retrieve_response_code( $response ) { return $response['code']; }
function wp_remote_retrieve_body( $response ) { return $response['body']; }
class WP_Error { function __construct( ...$args ) {} function get_error_message() { return 'network error'; } }
require dirname( __DIR__ ) . '/agent.php';
function check_diag( $value, $message ) { if ( ! $value ) throw new RuntimeException( $message ); }
Scraper_Auto_Shop_Plugin::register_diagnostic_routes();
foreach ( array( '/diagnostics/dashboard', '/diagnostics/storefront' ) as $route ) {
    $entry = $GLOBALS['routes'][$route];
    check_diag( $entry['methods'] === 'GET', 'GET only' );
    check_diag( ! $entry['permission_callback'](), 'Denied to unauthenticated user' );
    $GLOBALS['admin_allowed'] = true;
    check_diag( $entry['permission_callback'](), 'Allowed to administrator' );
    $GLOBALS['admin_allowed'] = false;
}
$d = Scraper_Auto_Shop_Plugin::diagnostic_result( 'dashboard' );
check_diag( $d['ok'] && $d['check'] === 'wordpress_plugin_runtime', 'Dashboard' );
$s = Scraper_Auto_Shop_Plugin::diagnostic_result( 'storefront' );
check_diag( $s['ok'] && $s['modern_storefront_marker'] && $s['http_status'] === 200, 'Storefront' );
check_diag( $GLOBALS['request'][0] === 'https://example.test/' && $GLOBALS['request'][1]['redirection'] === 0, 'Fixed URL and redirects disabled' );
$GLOBALS['response'] = new WP_Error();
$s = Scraper_Auto_Shop_Plugin::diagnostic_result( 'storefront' );
check_diag( ! $s['ok'] && $s['error'] === 'network error', 'Loopback failure' );
echo "Diagnostic tests passed\n";
