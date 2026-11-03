<?php
// Exercise updater against mocked GitHub and a disposable copy of the plugin.
define( 'ABSPATH', __DIR__ );
$GLOBALS['opts'] = array(); $GLOBALS['http'] = array(); $GLOBALS['fail_file'] = '';
$GLOBALS['sha'] = str_repeat( 'a', 40 );
function add_action( ...$args ) {}
function did_action( $name ) { return false; }
function register_activation_hook( ...$args ) {}
function register_deactivation_hook( ...$args ) {}
function plugin_dir_path( $file ) { return dirname( $file ) . '/'; }
function wp_cache_flush() { $GLOBALS['purges'] = ( $GLOBALS['purges'] ?? 0 ) + 1; }
function get_option( $key, $default = false ) { return $GLOBALS['opts'][$key] ?? $default; }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['opts'][$key] = $value; return true; }
function add_option( $key, $value, $deprecated = '', $autoload = null ) { if ( isset( $GLOBALS['opts'][$key] ) ) return false; $GLOBALS['opts'][$key] = $value; return true; }
function delete_option( $key ) { unset( $GLOBALS['opts'][$key] ); }
function wp_next_scheduled( $hook ) { return false; }
function wp_clear_scheduled_hook( $hook ) {}
function wp_schedule_event( ...$args ) { $GLOBALS['schedule'] = $args; }
class WP_Error { private $message; function __construct( $code, $message ) { $this->message = $message; } function get_error_message() { return $this->message; } }
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function wp_remote_retrieve_response_code( $response ) { return $response['status']; }
function wp_remote_retrieve_body( $response ) { return $response['body']; }
function wp_safe_remote_get( $url, $options ) {
    $GLOBALS['http'][] = array( $url, $options );
    if ( strpos( $url, '/commits/' ) !== false ) return array( 'status' => 200, 'body' => json_encode( array( 'sha' => $GLOBALS['sha'] ) ) );
    if ( $GLOBALS['fail_file'] && strpos( $url, $GLOBALS['fail_file'] ) !== false ) return array( 'status' => 404, 'body' => '' );
    if ( strpos( $url, '/agent.php?' ) !== false ) return array( 'status' => 200, 'body' => $GLOBALS['new_agent'] );
    if ( strpos( $url, '/storefront.css?' ) !== false ) return array( 'status' => 200, 'body' => 'new css' );
    return array( 'status' => 404, 'body' => '' );
}
function check_update( $test, $message ) { if ( ! $test ) throw new RuntimeException( $message ); }
$dir = sys_get_temp_dir() . '/amphp-updater-' . uniqid();
mkdir( $dir ); mkdir( $dir . '/asset', 0777, true ); mkdir( $dir . '/asset/js', 0777, true ); mkdir( $dir . '/asset/js/storefront', 0777, true );
$agent = file_get_contents( dirname( __DIR__ ) . '/agent.php' );
file_put_contents( $dir . '/agent.php', $agent );
file_put_contents( $dir . '/asset/js/storefront/storefront.css', 'old css' );
file_put_contents( $dir . '/profiles.json', 'user data' );
$GLOBALS['new_agent'] = $agent . "\n/* updated fixture */\n";
require $dir . '/agent.php';
$c = 'Scraper_Auto_Shop_Plugin';
check_update( $c::github_update_valid_config( 'fazilatma/new', 'arena/9c213522-new', 'amphp' ), 'Valid config' );
foreach ( array( array('evil/x/extra','main','amphp'), array('evil/x','../main','amphp'), array('evil/x','main','../etc') ) as $bad ) {
    check_update( ! $c::github_update_valid_config( ...$bad ), 'Reject invalid config' );
}
$GLOBALS['opts'][$c::GITHUB_UPDATE_OPTION] = array( 'enabled' => true, 'repo' => 'fazilatma/new', 'branch' => 'arena/9c213522-new', 'path' => 'amphp' );
$c::github_update_schedule(); check_update( $GLOBALS['schedule'][1] === 'hourly', 'Hourly schedule' );
$initial_release = $c::storefront_release_token();
$GLOBALS['fail_file'] = 'agent.php?';
$c::github_update_run();
check_update( file_get_contents( $dir . '/agent.php' ) === $agent, 'Failed download did not modify plugin' );
check_update( file_get_contents( $dir . '/asset/js/storefront/storefront.css' ) === 'old css', 'Failed download did not modify assets' );
check_update( strpos( $GLOBALS['opts'][$c::GITHUB_UPDATE_OPTION]['last_message'], 'Update failed:' ) === 0, 'Failure reported' );
check_update( empty( $GLOBALS['opts'][$c::GITHUB_UPDATE_OPTION]['installed_sha'] ), 'Failure did not mark SHA installed' );
check_update( empty( $GLOBALS['purges'] ), 'Failed update does not purge cache' );
$GLOBALS['fail_file'] = '';
$c::github_update_run();
check_update( file_get_contents( $dir . '/agent.php' ) === $GLOBALS['new_agent'], 'Agent updated' );
check_update( file_get_contents( $dir . '/asset/js/storefront/storefront.css' ) === 'new css', 'Installed disk asset updated' );
check_update( file_get_contents( $dir . '/profiles.json' ) === 'user data', 'Runtime data preserved' );
check_update( $GLOBALS['opts'][$c::GITHUB_UPDATE_OPTION]['installed_sha'] === $GLOBALS['sha'], 'SHA recorded' );
check_update( $c::storefront_release_token() !== $initial_release, 'New release invalidates open storefront version' );
check_update( $GLOBALS['purges'] === 1, 'Successful update purges cache once' );
foreach ( $GLOBALS['http'] as $request ) {
    check_update( strpos( $request[0], 'https://api.github.com/repos/fazilatma/new/' ) === 0 && $request[1]['redirection'] === 0, 'Fixed GitHub host and no redirects' );
    if ( strpos( $request[0], '/contents/' ) !== false ) check_update( strpos( $request[0], 'ref=' . $GLOBALS['sha'] ) !== false, 'Files pinned to commit' );
}
$count = count( $GLOBALS['http'] ); $c::github_update_run();
check_update( count( $GLOBALS['http'] ) === $count + 1, 'Unchanged commit downloads no files' );
check_update( ! isset( $GLOBALS['opts']['amphp_github_update_lock'] ), 'Lock released' );
unlink( $dir . '/agent.php' ); unlink( $dir . '/profiles.json' ); unlink( $dir . '/asset/js/storefront/storefront.css' );
rmdir( $dir . '/asset/js/storefront' ); rmdir( $dir . '/asset/js' ); rmdir( $dir . '/asset' ); rmdir( $dir );
echo "GitHub updater tests passed\n";
