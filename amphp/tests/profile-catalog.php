<?php
// Isolated WordPress stubs; fixtures never touch a real profiles.json.
define( 'ABSPATH', __DIR__ );
$GLOBALS['fixture_dir'] = sys_get_temp_dir() . '/amphp-catalog-' . uniqid();
mkdir( $GLOBALS['fixture_dir'] );
$GLOBALS['settings'] = array( 'catalog_source' => 'scraper' );
function register_activation_hook( ...$args ) {}
function register_deactivation_hook( ...$args ) {}
function did_action( $name ) { return false; }
function add_action( ...$args ) {}
function get_option( $name, $default = false ) { return $name === 'scraper_auto_shop_settings' ? $GLOBALS['settings'] : $default; }
function plugin_dir_path( $file ) { return $GLOBALS['fixture_dir'] . '/'; }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $s ) ); }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function esc_url_raw( $url ) { return $url; }
function wp_strip_all_tags( $value ) { return strip_tags( $value ); }
function get_posts( $args ) { return array(); }
require dirname( __DIR__ ) . '/agent.php';
function check_catalog( $value, $message ) { if ( ! $value ) throw new RuntimeException( $message ); }
$dir = $GLOBALS['fixture_dir'];
$profiles = array(
  'a' => array( 'products' => array(
    array( 'shared', array( 'title' => 'Same', 'url' => 'https://example.test/p', 'price' => 10 ) ),
    array( 'same-key', array( 'title' => 'First', 'price' => 20 ) ),
    array( 'same-key', array( 'title' => 'Second', 'price' => 30 ) ),
    array( 'title' => 'Flat', 'key' => 'flat', 'price' => 40 ),
  ), 'productsOrder' => array( 'flat', 'same-key', 'same-key', 'missing' ) ),
  'b' => array( 'products' => array( array( 'shared', array( 'title' => 'Same', 'url' => 'https://example.test/p', 'price' => 50 ) ) ) ),
);
file_put_contents( $dir . '/profiles.json', json_encode( $profiles ) );
file_put_contents( $dir . '/woo_products_temp.json', json_encode( array( array( 'title' => 'Temporary extra', 'price' => 1 ) ) ) );
$products = Scraper_Auto_Shop_Plugin::get_all_scraped_products();
check_catalog( count( $products ) === 5, 'All five profile entries; no temporary extra' );
check_catalog( array_column( $products, 'title' ) === array( 'Flat', 'First', 'Second', 'Same', 'Same' ), 'Ordering and duplicates' );
check_catalog( count( array_unique( array_column( $products, 'id' ) ) ) === 5, 'Unique IDs' );
foreach ( $products as $product ) {
  $raw = Scraper_Auto_Shop_Plugin::find_raw_scraped_product( $product['id'] );
  check_catalog( $raw && $raw['profile_key'] === $product['profile_key'] && $raw['raw']['title'] === $product['title'], 'Correct details lookup for each entry' );
}
check_catalog( Scraper_Auto_Shop_Plugin::find_raw_scraped_product( md5('Samehttps://example.test/p') ) !== null, 'Legacy hash lookup' );
$GLOBALS['settings']['catalog_source'] = 'merge';
$merged = Scraper_Auto_Shop_Plugin::get_all_scraped_products();
check_catalog( count( $merged ) === 4 && in_array( 'Temporary extra', array_column( $merged, 'title' ), true ), 'Merge mode retains legacy deduplication and temporary products' );
$GLOBALS['settings']['catalog_source'] = 'scraper';
$first_id = $products[3]['id'];
$profiles['a']['productsOrder'] = array( 'shared', 'flat' );
file_put_contents( $dir . '/profiles.json', json_encode( $profiles ) );
check_catalog( Scraper_Auto_Shop_Plugin::get_all_scraped_products()[0]['id'] === $first_id, 'ID stable when display order changes' );
$same = array( 'x' => array( 'products' => array(
  array( 'one', array( 'title' => 'Identical', 'category' => 'first' ) ),
  array( 'two', array( 'title' => 'Identical', 'category' => 'second' ) ),
), 'productsOrder' => array( 'two', 'one' ) ) );
file_put_contents( $dir . '/profiles.json', json_encode( $same ) );
foreach ( Scraper_Auto_Shop_Plugin::get_all_scraped_products() as $product ) {
  $raw = Scraper_Auto_Shop_Plugin::find_raw_scraped_product( $product['id'] );
  check_catalog( $raw['raw']['category'] === $product['category'], 'Duplicate details survive reordered display' );
}
file_put_contents( $dir . '/profiles.json', '{}' );
check_catalog( Scraper_Auto_Shop_Plugin::get_all_scraped_products() === array(), 'Empty profile catalog must not load temporary, WooCommerce or demo products' );
unlink( $dir . '/profiles.json' ); unlink( $dir . '/woo_products_temp.json' ); rmdir( $dir );
echo "Profile catalog tests passed\n";
