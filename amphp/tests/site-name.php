<?php
// Lightweight WordPress stubs for the server-rendered site-name signals.
define( 'ABSPATH', __DIR__ );
$GLOBALS['front'] = true;
$GLOBALS['admin'] = $GLOBALS['paged'] = $GLOBALS['search'] = $GLOBALS['preview'] = false;
function is_admin() { return $GLOBALS['admin']; }
function is_front_page() { return $GLOBALS['front']; }
function is_paged() { return $GLOBALS['paged']; }
function is_search() { return $GLOBALS['search']; }
function is_preview() { return $GLOBALS['preview']; }
function home_url( $path ) { return 'https://shop.example/' . ltrim( $path, '/' ); }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function register_activation_hook( ...$args ) {}
function register_deactivation_hook( ...$args ) {}
function did_action( $name ) { return false; }
function add_action( ...$args ) {}
require dirname( __DIR__ ) . '/agent.php';

function check( $condition, $message ) {
    if ( ! $condition ) { throw new RuntimeException( $message ); }
}
$class = 'Scraper_Auto_Shop_Plugin';
check( $class::filter_home_document_title( 'old' ) === 'فروشگاه صباشاپ', 'Homepage title' );
ob_start();
$class::print_home_site_name_schema();
$html = ob_get_clean();
check( preg_match( '~^<script type="application/ld\+json">(.*?)</script>\s*$~s', $html, $m ) === 1, 'JSON-LD script' );
$schema = json_decode( $m[1], true );
check( $schema['@type'] === 'WebSite' && $schema['name'] === 'فروشگاه صباشاپ', 'Schema name and type' );
check( $schema['url'] === 'https://shop.example/' && $schema['@id'] === 'https://shop.example/#website', 'Homepage URL' );
foreach ( array( 'front', 'admin', 'paged', 'search', 'preview' ) as $flag ) {
    $GLOBALS[$flag] = $flag !== 'front';
    check( $class::filter_home_document_title( 'unchanged' ) === 'unchanged', "$flag title" );
    ob_start();
    $class::print_home_site_name_schema();
    check( ob_get_clean() === '', "$flag schema" );
    $GLOBALS[$flag] = $flag === 'front';
}
echo "Site name tests passed\n";
