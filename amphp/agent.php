<?php
/**
 * Plugin Name: Scraper & Auto Shop Pro
 * Plugin URI: https://github.com/fazilatma/amphp
 * Description: افزونه جامع اسکرپر، استخراج هوشمند محصولات، همگام‌ساز ووکامرس و باسلام، همراه با ظاهر مدرن و جذاب برای فروشگاه، سربرگ و منوهای لوکس، تعدیل قیمت خودکار و جایگزینی مستقیم محصولات ووکامرس
 * Version: 13.3.43
 * Author: Fazilatma
 * Text Domain: scraper-auto-shop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Silence is golden.
}

if ( ! class_exists( 'Scraper_Auto_Shop_Plugin' ) ) :

/**
 * Main Scraper & Auto Shop Plugin Class.
 */
class Scraper_Auto_Shop_Plugin {

	/**
	 * Plugin options database key.
	 */
	const OPTION_NAME = 'scraper_auto_shop_settings';

	/**
	 * Get default settings for the plugin.
	 *
	 * @return array
	 */
	public static function get_default_settings() {
		return array(
			// Storefront Dual Controls (4-State System)
			'enable_shop_takeover'        => true, // تیک ۱: قالب و ظاهر مدرن با هدر و منوی اختصاصی
			'enable_scraped_products'     => true, // سازگاری عقب‌رو (true = اسکرپر یا ادغام)
			'catalog_source'              => 'scraper', // scraper | woocommerce | merge
			'catalog_merge_prefer'        => 'scraper', // scraper | woocommerce | keep_both
			'takeover_front_page'         => true, // v13.3.32: صفحه نخست هم ویترین React
			'enable_native_wp_template'   => true, // قالب بومی فقط برای برگهٔ پشتیبان (نه ویترین اصلی React)
			'native_fallback_page_id'     => 0, // برگه پشتیبان فروشگاه (جدا از فروشگاه اصلی)
			'enable_404_shop_redirect'    => true, // ریدایرکت 404 به صفحه پشتیبان
			'set_wc_shop_to_fallback'     => false, // v13.3.32: پیش‌فرض خاموش — پشتیبان جای ویترین React را نگیرد
			'auto_create_fallback_page'   => true, // ساخت خودکار برگه پشتیبان
			'replace_site_header'         => true, // حذف کامل هدر و منوی قالب وردپرس
			'show_top_bar'                => true,
			'top_bar_notice'              => 'تخفیف ویژه امروز: ارسال رایگان برای سفارش‌های بالای ۴۰۰ هزار تومان! 🚚',
			'contact_phone'               => '۰۲۱-۱۲۳۴۵۶۷۸',
			'support_hours'               => 'پاسخگویی ۹ الی ۲۲',
			'shop_title'                  => 'فروشگاه آنلاین نوآوران',
			'shop_subtitle'               => 'تنوع بی‌نظیر کالاها با تضمین اصالت، سلامت فیزیکی و ارسال سریع به سراسر کشور',
			'accent_color'                => '#2563eb',
			'default_column_layout'       => '1', // '1' column default
			'products_per_page'           => 20, // 20 items per page
			'show_features_banner'        => true,
			'show_animated_stats'         => true, // نمایش شماره‌های جذاب انیمیشن‌دار در صفحه فروشگاه
			'show_special_badge'          => true,
			'free_shipping_threshold'     => 400000,

			// Storefront Template & Color Presets
			'store_template'              => 'digikala', // digikala, snappshop, basalam, torob, digistyle, technolife, modern, midnight, minimal, bazaar, boutique, native-wp
			'store_palette'               => 'digikala-red', // digikala-red, snapp-green, basalam-coral, torob-red, digistyle-rose, technolife-blue, royal-blue, luxury-purple, amber-gold, persian-turquoise, midnight-ink, forest, sunset
			'auto_convert_rial'           => true,

			// Custom checkout page (React) — toggle + field controls
			'enable_custom_checkout'      => true,
			'checkout_title'              => 'تسویه حساب امن',
			'checkout_note'               => 'پس از ثبت سفارش، به درگاه پرداخت هدایت می‌شوید یا با شما تماس گرفته می‌شود.',
			'checkout_require_login'      => false,
			'checkout_field_name'         => true,
			'checkout_field_name_req'     => true,
			'checkout_field_phone'        => true,
			'checkout_field_phone_req'    => true,
			'checkout_field_email'        => true,
			'checkout_field_email_req'    => false,
			'checkout_field_province'     => true,
			'checkout_field_province_req' => true,
			'checkout_field_city'         => true,
			'checkout_field_city_req'     => true,
			'checkout_field_address'      => true,
			'checkout_field_address_req'  => true,
			'checkout_field_postal'       => true,
			'checkout_field_postal_req'   => false,
			'checkout_field_notes'        => true,
			'checkout_field_notes_req'    => false,
			'checkout_show_gateways'      => true,
			'checkout_cod_label'          => 'پرداخت در محل (COD)',
			'checkout_success_msg'        => 'سفارش شما با موفقیت ثبت شد. از خریدتان سپاسگزاریم!',
			'checkout_show_shipping'      => true,
			'checkout_show_map'           => true,
			'neshan_api_key'              => '',
			'shipping_origin_city'        => 'تهران',
			'shipping_origin_lat'         => '35.6892',
			'shipping_origin_lng'         => '51.3890',
			'post_shipping_enabled'       => true,
			'chapar_shipping_enabled'     => true,
			'tipax_shipping_enabled'      => true,
			'post_api_token'              => '',
			'chapar_api_token'            => '',
			'tipax_api_token'             => '',
			'shipping_base_post'          => 45000,
			'shipping_base_chapar'        => 65000,
			'shipping_base_tipax'         => 75000,
			'shipping_per_kg'             => 12000,
			'enable_ai_product_images'    => true,
			'ai_image_batch_size'         => 8,
			'ai_image_sideload'           => true,
			'ai_image_search_lang'        => 'fa',
			'enable_google_image_search'  => true,
			'google_cse_api_key'          => '',
			'google_cse_cx'               => '',

			// Pricing & Profit
			'price_markup_percent'        => 20,
			'price_fixed_add'             => 0,
			'price_rounding'              => '1000', // none, 1000, 10000
			'currency_symbol'             => 'تومان',
			'default_fallback_price'      => 150000, // Fallback base price
			'fallback_price_behavior'     => 'use_fallback', // 'use_fallback' or 'call_for_price'

			// Support Chat Settings & Themes
			'enable_support_chat'         => true,
			'chat_theme'                  => 'royal-blue', // 12 themes available
			'chat_button_style'           => 'pill-label', // 6 button designs
			'chat_button_position'        => 'left', // 'left' or 'right'
			'chat_window_title'           => 'پشتیبانی آنلاین فروشگاه',
			'chat_welcome_message'        => 'سلام! خوش آمدید 👋 هرگونه سوالی درباره کالاها، قیمت‌ها یا ثبت سفارش دارید بنویسید تا همکاران ما سریعاً پاسخ دهند.',
			'chat_field_name_enable'      => true,
			'chat_field_name_required'    => false,
			'chat_field_phone_enable'     => true,
			'chat_field_phone_required'   => false,
			'chat_field_email_enable'     => true,
			'chat_field_email_required'   => false,
			'chat_field_subject_enable'   => false,
			'chat_field_subject_required' => false,

			// AI & Human Admin Coordination
			'ai_coordination_mode'        => 'ai_first', // 'ai_first', 'ai_copilot', 'human_only', 'ai_only'
			'ai_support_name'             => 'پشتیبان هوشمند فروشگاه',
			'ai_system_prompt'            => 'شما پشتیبان صمیمی، محترم و متخصص فروشگاه آنلاین هستید. بر اساس مشخصات محصولات به مشتریان در خرید و انتخاب کالا کمک کنید. در صورت نیاز به بررسی شماره فاکتور یا پیگیری سفارش، اطمینان دهید که شماره تماس مشتری ثبت شده و کارشناسان سریعاً تماس خواهند گرفت.',
			'ai_provider'                 => 'auto', // 'auto' (from scraper connections.json), 'openai', 'gemini'
			'ai_api_key'                  => '',
			'ai_model'                    => '',

			// Messengers
			'bale_token'                  => '',
			'bale_chat_id'                => '',
			'telegram_token'              => '',
			'telegram_chat_id'            => '',
			'rubika_token'                => '',
			'rubika_chat_id'              => '',

			// WordPress Internal Cron (WP-Cron) Integration
			'enable_wp_cron_sync'         => true,
			'wp_cron_interval'            => 'every_30_mins',

			// Store Title Typography & Font
			'shop_title_font'             => 'vazirmatn', // vazirmatn, iranyekan, dana, yekanbakh, shabnam, sahel, iransans, morabba, parastoo, system, custom
			'shop_title_custom_font'      => '',
			'shop_title_font_size'        => 'normal', // small, normal, large, xlarge
			'shop_title_font_weight'      => '900', // 500, 700, 800, 900
			'sticky_header'               => true, // هدر و منوی چسبان به بالا

			// Store Analytics & Funnel Messenger Notifications
			'notif_event_site_visit'      => false,
			'notif_event_product_view'    => false,
			'notif_event_add_to_cart'     => true,
			'notif_event_checkout_step'   => true,
			'notif_event_order_placed'    => true,

			// Analytics data source: internal (plugin funnel), wordpress (WP/Woo core), hybrid (merge both)
			'analytics_source'            => 'hybrid',

			// Suppress other plugins' ads, upsells and nag notices in wp-admin
			'hide_admin_nags'             => true,
		);
	}

	/**
	 * Get active settings merged with defaults safely.
	 *
	 * @return array
	 */
	public static function get_settings() {
		$defaults = self::get_default_settings();
		$opts     = get_option( self::OPTION_NAME, $defaults );

		if ( ! is_array( $opts ) ) {
			$opts = $defaults;
		} else {
			$opts = array_merge( $defaults, $opts );
		}

		/* v13.3.8: فونت سراسری از connections.json (انتخاب اسکرپر) اولویت دارد */
		try {
			$cn = self::get_scraper_connections();
			if ( is_array( $cn ) ) {
				$fk = trim( (string) ( $cn['ui_font'] ?? $cn['app_font'] ?? '' ) );
				if ( $fk !== '' ) {
					$opts['shop_title_font'] = $fk;
					$opts['app_font']        = $fk;
				}
			}
		} catch ( \Throwable $e ) {
			// ignore
		}

		/* v13.3.32: ویترین React روی دامنهٔ اصلی (صفحهٔ خانه) — نه فقط /shop یا ?amphp_shop=1 */
		if ( ! empty( $opts['enable_shop_takeover'] ) ) {
			$opts['takeover_front_page'] = true;
		}

		return $opts;
	}

	/**
	 * Activation hook callback.
	 */
	public static function on_activate() {
		try {
			$opts = get_option( self::OPTION_NAME, false );
			if ( false === $opts || ! is_array( $opts ) ) {
				update_option( self::OPTION_NAME, self::get_default_settings() );
			}
			// v13.3.17: ensure native fallback shop page + optional WC shop mapping
			self::ensure_fallback_shop_page( false );
			self::maybe_detach_fallback_from_primary_shop();
			flush_rewrite_rules( false );
		} catch ( \Throwable $e ) {
			wp_die( 'Activation Error: ' . esc_html( $e->getMessage() ) );
		}
	}

	/**
	 * Deactivation hook callback.
	 * Flushes rewrite rules and cached transients so WordPress and WooCommerce
	 * immediately and cleanly revert to their original state without lingering filters.
	 */
	public static function on_deactivate() {
		wp_clear_scheduled_hook( 'scraper_auto_shop_cron_sync' );
		wp_clear_scheduled_hook( self::GITHUB_UPDATE_HOOK );
		delete_transient( 'scraper_shop_cached_products' );
		wp_cache_flush();
	}

	/**
	 * Initialize plugin hooks.
	 */
	public static function init() {
		// Admin menu
		add_action( 'admin_menu', array( __CLASS__, 'register_admin_menus' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_diagnostic_routes' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_torob_profile_route' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_wc_cleanup_routes' ) );
		add_action( 'init', array( __CLASS__, 'github_update_schedule' ) );
		add_action( self::GITHUB_UPDATE_HOOK, array( __CLASS__, 'github_update_run' ) );
		add_action( 'admin_post_amphp_github_update', array( __CLASS__, 'github_update_admin_save' ) );

		// Shortcodes for modern shop
		add_shortcode( 'scraped_shop', array( __CLASS__, 'render_shop_shortcode' ) );
		add_shortcode( 'modern_shop', array( __CLASS__, 'render_shop_shortcode' ) );

		// WooCommerce shop page takeover
		add_filter( 'template_include', array( __CLASS__, 'maybe_takeover_shop_template' ), 99 );
		// Register page templates from plugin + 404 → fallback shop redirect
		add_filter( 'theme_page_templates', array( __CLASS__, 'register_native_page_templates' ) );
		add_filter( 'template_include', array( __CLASS__, 'maybe_load_native_page_template' ), 98 );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_redirect_404_to_fallback_shop' ), 5 );
		add_action( 'admin_init', array( __CLASS__, 'maybe_ensure_fallback_shop_page' ), 20 );
		add_action( 'admin_init', array( __CLASS__, 'maybe_detach_fallback_from_primary_shop' ), 25 );
		add_action( 'admin_head', array( __CLASS__, 'amphp_admin_sticky_assets' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_detach_fallback_from_primary_shop' ), 1 );
		add_action( 'wp_footer', array( __CLASS__, 'maybe_print_native_support_chat' ), 50 );
		add_action( 'wp_footer', array( __CLASS__, 'print_native_visit_tracker' ), 90 );
		add_action( 'wp_ajax_scraper_ensure_fallback_shop', array( __CLASS__, 'ajax_ensure_fallback_shop' ) );
		add_action( 'wp_ajax_scraper_autosave_settings', array( __CLASS__, 'ajax_autosave_settings' ) );

		// Serve storefront JS/CSS via PHP (works even if static files blocked or not yet synced)
		add_action( 'init', array( __CLASS__, 'maybe_serve_storefront_version' ), 0 );
		add_action( 'init', array( __CLASS__, 'maybe_serve_storefront_asset' ), 0 );

		// Complete suppression of legacy WordPress theme header & menu when custom storefront is enabled
		add_action( 'wp_head', array( __CLASS__, 'inject_custom_header_suppression_css' ), 1 );
		// The theme-backed homepage needs the same site-name signals as the bare storefront.
		add_action( 'wp_head', array( __CLASS__, 'print_home_site_name_schema' ), 5 );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'filter_home_document_title' ), 100 );

		// AJAX actions for syncing to WooCommerce
		add_action( 'wp_ajax_scraper_sync_to_woo', array( __CLASS__, 'ajax_sync_to_woo' ) );
		add_action( 'wp_ajax_amphp_wc_cleanup_list', array( __CLASS__, 'ajax_wc_cleanup_list' ) );
		add_action( 'wp_ajax_amphp_wc_cleanup_start', array( __CLASS__, 'ajax_wc_cleanup_start' ) );
		add_action( 'wp_ajax_amphp_wc_cleanup_batch', array( __CLASS__, 'ajax_wc_cleanup_batch' ) );
		add_action( 'wp_ajax_scraper_direct_sync_progress', array( __CLASS__, 'ajax_direct_sync_progress' ) );
		add_action( 'wp_ajax_scraper_test_woo_direct', array( __CLASS__, 'ajax_test_woo_direct' ) );
		add_action( 'wp_ajax_scraper_enable_woo_direct', array( __CLASS__, 'ajax_enable_woo_direct' ) );
		/* v13.3.33 / v10.115: جدول مقایسه نظیر‌به‌نظیر در پنل افزونه */
		add_action( 'wp_ajax_scraper_sync_matrix_start', array( __CLASS__, 'ajax_sync_matrix_start' ) );
		add_action( 'wp_ajax_scraper_sync_matrix_status', array( __CLASS__, 'ajax_sync_matrix_status' ) );
		add_action( 'wp_ajax_scraper_sync_matrix', array( __CLASS__, 'ajax_sync_matrix' ) );
		add_action( 'wp_ajax_scraper_sync_matrix_fix_start', array( __CLASS__, 'ajax_sync_matrix_fix_start' ) );
		add_action( 'wp_ajax_scraper_sync_matrix_fix_status', array( __CLASS__, 'ajax_sync_matrix_fix_status' ) );
		add_action( 'wp_ajax_scraper_sync_matrix_fix_stop', array( __CLASS__, 'ajax_sync_matrix_fix_stop' ) );

		// Support chat AJAX endpoints (Customer & AI thread)
		add_action( 'wp_ajax_submit_support_chat', array( __CLASS__, 'ajax_submit_support_chat' ) );
		add_action( 'wp_ajax_nopriv_submit_support_chat', array( __CLASS__, 'ajax_submit_support_chat' ) );
		add_action( 'wp_ajax_scraper_submit_support_chat', array( __CLASS__, 'ajax_submit_support_chat' ) );
		add_action( 'wp_ajax_nopriv_scraper_submit_support_chat', array( __CLASS__, 'ajax_submit_support_chat' ) );
		add_action( 'wp_ajax_scraper_customer_get_thread', array( __CLASS__, 'ajax_customer_get_thread' ) );
		add_action( 'wp_ajax_nopriv_scraper_customer_get_thread', array( __CLASS__, 'ajax_customer_get_thread' ) );

		// Admin Live Chat Reply Desk endpoints
		add_action( 'wp_ajax_scraper_admin_send_chat_reply', array( __CLASS__, 'ajax_admin_send_chat_reply' ) );
		add_action( 'wp_ajax_scraper_admin_get_thread', array( __CLASS__, 'ajax_admin_get_thread' ) );
		add_action( 'wp_ajax_scraper_admin_delete_thread', array( __CLASS__, 'ajax_admin_delete_thread' ) );

		// Messenger test
		add_action( 'wp_ajax_test_support_messengers', array( __CLASS__, 'ajax_test_support_messengers' ) );

		// Live AI chat test endpoint
		add_action( 'wp_ajax_scraper_test_ai_chat', array( __CLASS__, 'ajax_test_ai_chat' ) );
		add_action( 'wp_ajax_scraper_compare_ai_candidates', array( __CLASS__, 'ajax_compare_ai_candidates' ) );
		add_action( 'wp_ajax_scraper_vote_ai_candidate', array( __CLASS__, 'ajax_vote_ai_candidate' ) );
		add_action( 'wp_ajax_scraper_pin_master_model', array( __CLASS__, 'ajax_pin_master_model' ) );
		add_action( 'wp_ajax_scraper_upload_ai_config', array( __CLASS__, 'ajax_upload_ai_config' ) );
		add_action( 'wp_ajax_scraper_export_ai_config', array( __CLASS__, 'ajax_export_ai_config' ) );

		// WordPress Internal Cron (WP-Cron) Integration for scraper automation
		add_filter( 'cron_schedules', array( __CLASS__, 'filter_cron_schedules' ) );
		add_action( 'scraper_auto_shop_cron_sync', array( __CLASS__, 'execute_scraper_cron_job' ) );
		add_action( 'wp_ajax_scraper_run_wpcron_now', array( __CLASS__, 'ajax_run_wpcron_now' ) );

		// Analytics Tracking Endpoints
		add_action( 'wp_ajax_scraper_track_event', array( __CLASS__, 'ajax_track_analytics_event' ) );
		add_action( 'wp_ajax_nopriv_scraper_track_event', array( __CLASS__, 'ajax_track_analytics_event' ) );
		add_action( 'wp_ajax_scraper_reset_analytics', array( __CLASS__, 'ajax_reset_analytics' ) );
		add_action( 'woocommerce_new_order', array( __CLASS__, 'on_wc_order_created' ), 10, 2 );
		add_action( 'woocommerce_checkout_order_created', array( __CLASS__, 'on_wc_order_ready' ), 20, 1 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( __CLASS__, 'on_wc_order_ready' ), 20, 1 );
		add_action( 'amphp_wc_order_notice_fallback', array( __CLASS__, 'on_wc_order_notice_fallback' ), 10, 1 );
		self::sync_wp_cron_schedule();
		self::sync_ai_image_cron_schedule();

		// WooCommerce Real Cart Session Sync endpoints
		add_action( 'wp_ajax_scraper_wc_add_to_cart', array( __CLASS__, 'ajax_wc_add_to_cart' ) );
		add_action( 'wp_ajax_nopriv_scraper_wc_add_to_cart', array( __CLASS__, 'ajax_wc_add_to_cart' ) );
		add_action( 'wp_ajax_scraper_wc_update_cart_qty', array( __CLASS__, 'ajax_wc_update_cart_qty' ) );
		add_action( 'wp_ajax_nopriv_scraper_wc_update_cart_qty', array( __CLASS__, 'ajax_wc_update_cart_qty' ) );
		add_action( 'wp_ajax_scraper_wc_remove_cart_item', array( __CLASS__, 'ajax_wc_remove_cart_item' ) );
		add_action( 'wp_ajax_nopriv_scraper_wc_remove_cart_item', array( __CLASS__, 'ajax_wc_remove_cart_item' ) );
		add_action( 'wp_ajax_scraper_wc_get_cart', array( __CLASS__, 'ajax_wc_get_cart' ) );
		add_action( 'wp_ajax_nopriv_scraper_wc_get_cart', array( __CLASS__, 'ajax_wc_get_cart' ) );
		add_action( 'wp_ajax_scraper_wc_sync_and_checkout', array( __CLASS__, 'ajax_wc_sync_and_checkout' ) );
		add_action( 'wp_ajax_nopriv_scraper_wc_sync_and_checkout', array( __CLASS__, 'ajax_wc_sync_and_checkout' ) );
		add_action( 'wp_ajax_scraper_custom_checkout_place_order', array( __CLASS__, 'ajax_custom_checkout_place_order' ) );
		add_action( 'wp_ajax_nopriv_scraper_custom_checkout_place_order', array( __CLASS__, 'ajax_custom_checkout_place_order' ) );
		add_action( 'wp_ajax_scraper_get_payment_gateways', array( __CLASS__, 'ajax_get_payment_gateways' ) );
		add_action( 'wp_ajax_nopriv_scraper_get_payment_gateways', array( __CLASS__, 'ajax_get_payment_gateways' ) );
		add_action( 'wp_ajax_scraper_get_iran_cities', array( __CLASS__, 'ajax_get_iran_cities' ) );
		add_action( 'wp_ajax_nopriv_scraper_get_iran_cities', array( __CLASS__, 'ajax_get_iran_cities' ) );
		add_action( 'wp_ajax_scraper_get_shipping_methods', array( __CLASS__, 'ajax_get_shipping_methods' ) );
		add_action( 'wp_ajax_nopriv_scraper_get_shipping_methods', array( __CLASS__, 'ajax_get_shipping_methods' ) );
		add_action( 'wp_ajax_scraper_calc_shipping', array( __CLASS__, 'ajax_calc_shipping' ) );
		add_action( 'wp_ajax_nopriv_scraper_calc_shipping', array( __CLASS__, 'ajax_calc_shipping' ) );
		add_action( 'wp_ajax_scraper_neshan_geocode', array( __CLASS__, 'ajax_neshan_geocode' ) );
		add_action( 'wp_ajax_nopriv_scraper_neshan_geocode', array( __CLASS__, 'ajax_neshan_geocode' ) );
		add_action( 'wp_ajax_scraper_ai_enrich_images', array( __CLASS__, 'ajax_ai_enrich_images' ) );
		add_action( 'wp_ajax_scraper_ai_enrich_one_image', array( __CLASS__, 'ajax_ai_enrich_one_image' ) );
		add_action( 'wp_ajax_nopriv_scraper_ai_enrich_one_image', array( __CLASS__, 'ajax_ai_enrich_one_image' ) );
		add_action( 'scraper_ai_image_enrich_cron', array( __CLASS__, 'cron_ai_enrich_product_images' ) );
		add_action( 'wp_ajax_scraper_get_product', array( __CLASS__, 'ajax_get_product' ) );
		add_action( 'wp_ajax_nopriv_scraper_get_product', array( __CLASS__, 'ajax_get_product' ) );

		// Filters for WooCommerce Cart & Checkout guarantees
		add_action( 'woocommerce_before_calculate_totals', array( __CLASS__, 'fix_cart_item_prices' ), 20, 1 );
		add_filter( 'woocommerce_cart_item_thumbnail', array( __CLASS__, 'filter_cart_item_thumbnail' ), 10, 3 );
		// The storefront source must also constrain direct WooCommerce purchases and feeds.
		add_filter( 'woocommerce_is_purchasable', array( __CLASS__, 'profile_only_wc_filter' ), 10000, 2 );
		add_filter( 'woocommerce_variation_is_purchasable', array( __CLASS__, 'profile_only_wc_filter' ), 10000, 2 );
		add_filter( 'woocommerce_product_is_in_stock', array( __CLASS__, 'profile_only_wc_filter' ), 10000, 2 );
		add_filter( 'woocommerce_variation_is_in_stock', array( __CLASS__, 'profile_only_wc_filter' ), 10000, 2 );
		add_filter( 'woocommerce_product_is_visible', array( __CLASS__, 'profile_only_wc_filter' ), 10000, 2 );
		add_action( 'woocommerce_check_cart_items', array( __CLASS__, 'profile_only_check_cart' ), 100 );
		add_filter( 'posts_where', array( __CLASS__, 'profile_public_products_where' ), 1000, 2 );
		add_action( 'template_redirect', array( __CLASS__, 'profile_hide_direct_product' ), 0 );
		add_filter( 'rest_request_before_callbacks', array( __CLASS__, 'profile_filter_torob_request' ), 10, 3 );
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'profile_hide_store_api_item' ), 10, 3 );
		add_filter( 'rest_request_after_callbacks', array( __CLASS__, 'profile_finish_torob_request' ), 10, 3 );

		// Enqueue scripts & styles for storefront
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_front_assets' ) );
		add_filter( 'body_class', array( __CLASS__, 'filter_storefront_body_class' ) );
		add_filter( 'show_admin_bar', array( __CLASS__, 'maybe_hide_admin_bar_on_storefront' ) );

		// WordPress-core hit counter (used when analytics_source is wordpress/hybrid)
		add_action( 'template_redirect', array( __CLASS__, 'maybe_track_wp_core_hit' ), 1 );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_track_wp_product_view_on_product' ), 2 );
		add_action( 'woocommerce_track_product_view', array( __CLASS__, 'maybe_track_wp_product_view' ) );

		// Hide other plugins' ads / nag notices in wp-admin (toggleable)
		add_action( 'admin_init', array( __CLASS__, 'setup_admin_noise_suppression' ), 0 );
	}

	/**
	 * Register WordPress Admin Menus.
	 */
	/** Private, read-only diagnostics. REST cookie requests require a wp_rest nonce. */
	public static function register_diagnostic_routes() {
		foreach ( array( 'dashboard', 'storefront' ) as $kind ) {
			register_rest_route( 'amphp/v1', '/diagnostics/' . $kind, array(
				'methods'             => 'GET',
				'permission_callback' => function () { return current_user_can( 'manage_options' ); },
				'callback'            => function () use ( $kind ) { return self::diagnostic_result( $kind ); },
			) );
		}
	}

	public static function diagnostic_result( $kind ) {
		$settings = self::get_settings();
		if ( 'dashboard' === $kind ) {
			return rest_ensure_response( array(
				'ok' => true,
				'check' => 'wordpress_plugin_runtime',
				'site_url' => home_url( '/' ),
				'dashboard_url' => admin_url( 'admin.php?page=scraper-auto-shop' ),
				'wordpress_version' => get_bloginfo( 'version' ),
				'php_version' => PHP_VERSION,
				'note' => 'This verifies authenticated WordPress and plugin execution, not a browser interaction test.',
			) );
		}
		if ( 'storefront' !== $kind ) {
			return new WP_Error( 'amphp_invalid_diagnostic', 'Unknown diagnostic', array( 'status' => 400 ) );
		}
		// Fixed site URL only: do not accept a URL from the request. Never forward cookies.
		$response = wp_safe_remote_get( home_url( '/' ), array(
			'timeout' => 15, 'redirection' => 0, 'limit_response_size' => 524288,
			'headers' => array( 'Cache-Control' => 'no-cache' ),
		) );
		$http_error = is_wp_error( $response );
		$status = $http_error ? 0 : (int) wp_remote_retrieve_response_code( $response );
		$body = $http_error ? '' : (string) wp_remote_retrieve_body( $response );
		$marker = strpos( $body, 'amphp-storefront-root' ) !== false || strpos( $body, 'amphp-bare-root' ) !== false;
		return rest_ensure_response( array(
			'ok' => ! $http_error && $status >= 200 && $status < 300,
			'check' => 'homepage_http_loopback',
			'url' => home_url( '/' ),
			'http_status' => $status,
			'error' => $http_error ? $response->get_error_message() : null,
			'modern_storefront_marker' => $marker,
			'takeover_enabled' => ! empty( $settings['enable_shop_takeover'] ),
			'assets_available' => self::has_storefront_assets(),
			'note' => 'A loopback HTTP check only; it does not execute JavaScript or test checkout. Redirects are reported, not followed.',
		) );
	}

	/** GitHub updates are opt-in and only available to users who may update plugins. */
	const GITHUB_UPDATE_OPTION = 'amphp_github_update';
	const GITHUB_UPDATE_HOOK = 'amphp_github_update_cron';

	public static function github_update_config() {
		$config = get_option( self::GITHUB_UPDATE_OPTION, array() );
		return array_merge( array( 'enabled' => false, 'repo' => 'fazilatma/new', 'branch' => 'arena/9c213522-new', 'path' => 'amphp', 'installed_sha' => '', 'last_check' => '', 'last_message' => '' ), is_array( $config ) ? $config : array() );
	}

	public static function github_update_valid_config( $repo, $branch, $path ) {
		if ( ! preg_match( '~^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$~D', $repo ) || strpos( $repo, '..' ) !== false ) { return false; }
		if ( $branch === '' || strlen( $branch ) > 200 || ! preg_match( '~^[A-Za-z0-9_./-]+$~D', $branch ) || strpos( $branch, '..' ) !== false || strpos( $branch, '//' ) !== false || $branch[0] === '/' || substr( $branch, -1 ) === '/' || substr( $branch, -1 ) === '.' ) { return false; }
		if ( $path !== '' && ( ! preg_match( '~^[A-Za-z0-9_./-]+$~D', $path ) || strpos( $path, '..' ) !== false || strpos( $path, '//' ) !== false || $path[0] === '/' || substr( $path, -1 ) === '/' ) ) { return false; }
		return true;
	}

	public static function github_update_schedule() {
		$config = self::github_update_config();
		if ( empty( $config['enabled'] ) ) {
			if ( wp_next_scheduled( self::GITHUB_UPDATE_HOOK ) ) { wp_clear_scheduled_hook( self::GITHUB_UPDATE_HOOK ); }
		} elseif ( ! wp_next_scheduled( self::GITHUB_UPDATE_HOOK ) ) {
			wp_schedule_event( time() + 60, 'hourly', self::GITHUB_UPDATE_HOOK );
		}
	}

	public static function github_update_admin_save() {
		if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'update_plugins' ) ) { wp_die( 'Access denied', 403 ); }
		check_admin_referer( 'amphp_github_update' );
		$old = self::github_update_config();
		$repo = trim( sanitize_text_field( wp_unslash( $_POST['repo'] ?? '' ) ) );
		$branch = trim( sanitize_text_field( wp_unslash( $_POST['branch'] ?? '' ) ) );
		$path = trim( sanitize_text_field( wp_unslash( $_POST['path'] ?? '' ) ), " \t\n\r\0\x0B/" );
		if ( ! self::github_update_valid_config( $repo, $branch, $path ) ) { wp_die( 'Invalid GitHub repository, branch, or plugin path.' ); }
		$old['enabled'] = ! empty( $_POST['enabled'] );
		if ( $old['repo'] !== $repo || $old['branch'] !== $branch || $old['path'] !== $path ) { $old['installed_sha'] = ''; }
		$old['repo'] = $repo; $old['branch'] = $branch; $old['path'] = $path;
		update_option( self::GITHUB_UPDATE_OPTION, $old, false );
		self::github_update_schedule();
		if ( ! empty( $_POST['check_now'] ) ) { self::github_update_run( true ); }
		wp_safe_redirect( admin_url( 'admin.php?page=scraper-auto-shop#amphp-github-update' ) );
		exit;
	}

	/** All requests are fixed to GitHub's API. A single commit SHA pins all downloaded files. */
	public static function github_update_fetch( $url, $raw = false ) {
		$result = wp_safe_remote_get( $url, array(
			'timeout' => 45, 'redirection' => 0, 'limit_response_size' => 16 * 1024 * 1024,
			'headers' => array( 'Accept' => $raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'User-Agent' => 'AMPHP-WordPress-Updater' ),
		) );
		if ( is_wp_error( $result ) ) { return $result; }
		$status = (int) wp_remote_retrieve_response_code( $result );
		if ( $status !== 200 ) { return new WP_Error( 'amphp_github_http', 'GitHub HTTP ' . $status ); }
		return (string) wp_remote_retrieve_body( $result );
	}

	public static function github_update_run( $manual = false ) {
		$config = self::github_update_config();
		if ( ! $manual && empty( $config['enabled'] ) ) { return; }
		if ( ! self::github_update_valid_config( $config['repo'], $config['branch'], $config['path'] ) ) { return; }
		// add_option is atomic; expired locks are reclaimed after ten minutes.
		$lock_key = 'amphp_github_update_lock';
		$now = time();
		$lock = get_option( $lock_key, 0 );
		if ( $lock && (int) $lock < $now - 600 ) { delete_option( $lock_key ); }
		if ( ! add_option( $lock_key, $now, '', false ) ) { return; }
		try {
			$repo = implode( '/', array_map( 'rawurlencode', explode( '/', $config['repo'] ) ) );
			$base = 'https://api.github.com/repos/' . $repo;
			$head = self::github_update_fetch( $base . '/commits/' . rawurlencode( $config['branch'] ) );
			if ( is_wp_error( $head ) ) { throw new \RuntimeException( $head->get_error_message() ); }
			$commit = json_decode( $head, true );
			$sha = (string) ( $commit['sha'] ?? '' );
			if ( ! preg_match( '/^[a-f0-9]{40}$/D', $sha ) ) { throw new \RuntimeException( 'GitHub returned an invalid commit SHA.' ); }
			if ( hash_equals( (string) $config['installed_sha'], $sha ) ) {
				$config['last_message'] = 'Already up to date: ' . substr( $sha, 0, 12 );
			} else {
				self::github_update_install( $base, $sha, $config['path'] );
				$config['installed_sha'] = $sha;
				$config['last_message'] = 'Updated successfully: ' . substr( $sha, 0, 12 );
			}
		} catch ( \Throwable $e ) {
			$config['last_message'] = 'Update failed: ' . $e->getMessage();
		} finally {
			$config['last_check'] = gmdate( 'Y-m-d H:i:s' ) . ' UTC';
			// Do not overwrite configuration changed during a long update.
			$current = self::github_update_config();
			if ( $current['repo'] === $config['repo'] && $current['branch'] === $config['branch'] && $current['path'] === $config['path'] ) {
				$current['installed_sha'] = $config['installed_sha'];
				$current['last_message'] = $config['last_message'];
				$current['last_check'] = $config['last_check'];
				update_option( self::GITHUB_UPDATE_OPTION, $current, false );
				if ( isset( $sha ) && $current['installed_sha'] === $sha && strpos( $current['last_message'], 'Updated successfully:' ) === 0 ) {
					self::purge_storefront_caches();
				}
			}
			delete_option( $lock_key );
		}
	}

	/** Best-effort cache purge after a successful install; never turn success into failure. */
	public static function purge_storefront_caches() {
		foreach ( array( 'wp_cache_flush', 'wp_cache_clear_cache', 'rocket_clean_domain', 'w3tc_flush_all' ) as $purge ) {
			if ( function_exists( $purge ) ) {
				try { call_user_func( $purge ); } catch ( \Throwable $e ) { error_log( 'AMPHP cache purge: ' . $e->getMessage() ); }
			}
		}
	}

	/** Stage and validate every installed code asset before replacing any file. */
	public static function github_update_install( $base, $sha, $path ) {
		$root = realpath( dirname( __FILE__ ) );
		if ( ! $root || is_link( __FILE__ ) ) { throw new \RuntimeException( 'Plugin directory is not supported.' ); }
		$files = array( 'asset/js/storefront/storefront.js', 'asset/js/storefront/storefront.css', 'includes/storefront/storefront.js', 'includes/storefront/storefront.css', 'includes/storefront/embedded-assets.php', 'includes/geo/iran-cities.json', 'templates/native-shop.php', 'scraper4.php', 'agent.php' );
		$staged = array(); $backups = array(); $replaced = array();
		try {
			foreach ( $files as $file ) {
				$target = $root . '/' . $file;
				if ( $file !== 'agent.php' && ! file_exists( $target ) ) { continue; }
				$parent = realpath( dirname( $target ) );
				if ( ! $parent || ( $parent !== $root && strpos( $parent, $root . DIRECTORY_SEPARATOR ) !== 0 ) || is_link( $target ) || ! is_file( $target ) || ! is_writable( $target ) || ! is_writable( $parent ) ) { throw new \RuntimeException( 'Unsafe or unwritable plugin file: ' . $file ); }
				$remote_path = ltrim( ( $path === '' ? '' : $path . '/' ) . $file, '/' );
				$url = $base . '/contents/' . implode( '/', array_map( 'rawurlencode', explode( '/', $remote_path ) ) ) . '?ref=' . rawurlencode( $sha );
				$body = self::github_update_fetch( $url, true );
				if ( is_wp_error( $body ) ) { throw new \RuntimeException( $file . ': ' . $body->get_error_message() ); }
				if ( $body === '' || strlen( $body ) >= 16 * 1024 * 1024 ) { throw new \RuntimeException( 'Empty or oversized file: ' . $file ); }
				if ( substr( $file, -4 ) === '.php' && strpos( ltrim( $body ), '<?php' ) !== 0 ) { throw new \RuntimeException( 'Invalid PHP file: ' . $file ); }
				if ( $file === 'agent.php' && strpos( substr( $body, 0, 4096 ), 'Plugin Name: Scraper & Auto Shop Pro' ) === false ) { throw new \RuntimeException( 'Unexpected plugin header.' ); }
				$tmp = tempnam( $parent, '.amphp-stage-' );
				if ( ! $tmp ) { throw new \RuntimeException( 'Cannot stage ' . $file ); }
				$staged[ $target ] = $tmp;
				if ( file_put_contents( $tmp, $body, LOCK_EX ) !== strlen( $body ) ) { throw new \RuntimeException( 'Cannot write staged file: ' . $file ); }
				@chmod( $tmp, fileperms( $target ) & 0777 );
				$backup = tempnam( $parent, '.amphp-backup-' );
				if ( ! $backup ) { throw new \RuntimeException( 'Cannot create backup: ' . $file ); }
				$backups[ $target ] = $backup;
				if ( ! copy( $target, $backup ) ) { throw new \RuntimeException( 'Cannot back up: ' . $file ); }
				@chmod( $backup, fileperms( $target ) & 0777 );
			}
			foreach ( $staged as $target => $tmp ) {
				if ( ! rename( $tmp, $target ) ) { throw new \RuntimeException( 'Cannot replace ' . basename( $target ) ); }
				$replaced[] = $target;
				if ( function_exists( 'opcache_invalidate' ) ) { @opcache_invalidate( $target, true ); }
			}
		} catch ( \Throwable $e ) {
			foreach ( array_reverse( $replaced ) as $target ) {
				if ( ! @rename( $backups[ $target ], $target ) ) { error_log( 'AMPHP update: rollback failed for ' . $target ); }
				else { unset( $backups[ $target ] ); }
				if ( function_exists( 'opcache_invalidate' ) ) { @opcache_invalidate( $target, true ); }
			}
			throw $e;
		} finally {
			foreach ( $staged as $tmp ) { if ( is_file( $tmp ) ) { @unlink( $tmp ); } }
			foreach ( $backups as $target => $backup ) {
				// Preserve a backup if a rollback failed.
				if ( ! in_array( $target, $replaced, true ) || ! isset( $e ) ) { if ( is_file( $backup ) ) { @unlink( $backup ); } }
			}
		}
	}

	public static function register_admin_menus() {
		add_menu_page(
			'فروشگاه و اسکرپر',
			'فروشگاه و اسکرپر',
			'manage_options',
			'scraper-auto-shop',
			array( __CLASS__, 'render_admin_settings_page' ),
			'dashicons-cart',
			56
		);

		add_submenu_page(
			'scraper-auto-shop',
			'تنظیمات فروشگاه، منوها و قیمت',
			'تنظیمات فروشگاه و منوها',
			'manage_options',
			'scraper-auto-shop',
			array( __CLASS__, 'render_admin_settings_page' )
		);

		add_submenu_page( 'scraper-auto-shop', 'مدیریت سبک محصولات ووکامرس', 'مدیریت سبک محصولات ووکامرس', 'manage_options', 'amphp-wc-cleanup', array( __CLASS__, 'render_wc_cleanup_page' ) );

		add_submenu_page(
			'scraper-auto-shop',
			'پنل کامل اسکرپر (scraper4)',
			'پنل اسکرپر (scraper4)',
			'manage_options',
			'scraper-full-dashboard',
			array( __CLASS__, 'render_scraper4_embed_page' )
		);
	}

	/** Lightweight, independent admin screen; it never loads the scraper catalog. */
	public static function render_wc_cleanup_page() {
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		$nonce = wp_create_nonce( 'amphp_wc_cleanup' );
		?>
		<div class="wrap" dir="rtl" style="text-align:right;max-width:1100px">
			<h1>مدیریت سبک محصولات ووکامرس</h1>
			<p>فهرست بدون تصویر و در صفحه‌های ۵۰تایی نمایش داده می‌شود. این ابزار فقط محصولات ووکامرس و تنوع‌های آن‌ها را به زباله‌دان منتقل می‌کند؛ پروفایل‌ها، سفارش‌ها و فایل‌های رسانه را حذف نمی‌کند.</p>
			<div class="notice notice-warning inline"><p><strong>قبل از اجرا نسخه پشتیبان کامل بگیرید.</strong> همهٔ وضعیت‌ها، از جمله پیش‌نویس و محصولات همگام‌شده، شامل می‌شوند. خرید و فید ترب ممکن است تحت تأثیر قرار گیرند. زباله‌دان وردپرس معمولاً پس از مدت تنظیم‌شده خودکار خالی می‌شود؛ اگر زباله‌دان غیرفعال باشد ابزار اجرا نمی‌شود. همگام‌سازی یا خرید ممکن است بعداً محصولات جدید بسازد.</p></div>
			<p><button type="button" class="button" id="amphp-wc-list">نمایش سبک محصولات</button> <button type="button" class="button button-primary" id="amphp-wc-trash" style="background:#b91c1c;border-color:#991b1b">انتقال همه محصولات ووکامرس به زباله‌دان</button> <button type="button" class="button" id="amphp-wc-stop" disabled>توقف پس از دسته جاری</button></p>
			<p id="amphp-wc-status" role="status" aria-live="polite"></p>
			<table class="widefat striped" id="amphp-wc-table" hidden><thead><tr><th>شناسه</th><th>عنوان</th><th>وضعیت</th></tr></thead><tbody></tbody></table>
			<p><button type="button" class="button" id="amphp-wc-more" hidden>صفحه بعد</button></p>
		</div>
		<script>
		(function(){
		 const url=<?php echo wp_json_encode( admin_url( 'admin-ajax.php' ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?>, nonce=<?php echo wp_json_encode( $nonce ); ?>;
		 const list=document.getElementById('amphp-wc-list'), trash=document.getElementById('amphp-wc-trash'), stop=document.getElementById('amphp-wc-stop'), more=document.getElementById('amphp-wc-more'), table=document.getElementById('amphp-wc-table'), status=document.getElementById('amphp-wc-status');
		 let cursor=0, paused=false, running=false;
		 async function call(action,params={}) {const body=new URLSearchParams({action,nonce,...params});const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});let data;try{data=await response.json()}catch(e){throw new Error('پاسخ سرور نامعتبر است (HTTP '+response.status+').')}if(!response.ok || !data.success) throw new Error((data.data&&data.data.message)||'درخواست ناموفق بود (HTTP '+response.status+').');return data.data;}
		 async function show(next){list.disabled=true;more.disabled=true;try{const data=await call('amphp_wc_cleanup_list',{before:next?String(cursor):'0'});cursor=data.next_cursor;table.hidden=false;let body=table.querySelector('tbody');body.replaceChildren();for(const p of data.products){const tr=document.createElement('tr');for(const value of [p.id,p.title,p.status]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}body.appendChild(tr)}more.hidden=!cursor;status.textContent='محصولات خارج از زباله‌دان: '+data.products_count+'؛ تنوع‌ها: '+data.variations_count+'. فهرست، فقط محصولات اصلی را نشان می‌دهد.';}catch(e){status.textContent=e.message;}finally{list.disabled=running;more.disabled=running;}}
		 list.addEventListener('click',()=>show(false));more.addEventListener('click',()=>show(true));
		 stop.addEventListener('click',()=>{paused=true;stop.disabled=true;status.textContent='در حال توقف پس از دسته جاری…';});
		 trash.addEventListener('click',async()=>{if(running)return;if(!confirm('همه محصولات ووکامرس، از جمله پیش‌نویس‌ها و تنوع‌ها، به زباله‌دان منتقل می‌شوند. از نسخه پشتیبان و اثر آن بر خرید مطمئن هستید؟'))return;const phrase=prompt('برای تأیید عبارت «حذف همه» را بنویسید:');if(phrase!=='حذف همه')return;running=true;paused=false;trash.disabled=list.disabled=more.disabled=true;stop.disabled=false;try{let job=await call('amphp_wc_cleanup_start',{confirm:phrase});let done=0;status.textContent='شروع شد. محدوده محصول اصلی: '+job.products_count+'؛ تنوع: '+job.variations_count+'.';while(!paused){let r=await call('amphp_wc_cleanup_batch',{job:job.job});done+=r.processed;status.textContent='پردازش مستقیم: '+done+' مورد. تنوع‌های فرزند ممکن است همراه محصول اصلی منتقل شوند.';if(r.done){status.textContent='پایان: تمام موارد واجد شرایط در محدوده شروع پردازش شدند. محصولات جدید پس از شروع شامل نبودند. کش سایت و فهرست ترب را بازخوانی کنید.';break;}await new Promise(resolve=>setTimeout(resolve,100));}if(paused)status.textContent='متوقف شد؛ موارد منتقل‌شده باقی می‌مانند. برای ادامه دوباره نمایش و اجرا را انتخاب کنید.';}catch(e){status.textContent='متوقف شد: '+e.message+' موارد منتقل‌شده باقی می‌مانند؛ پس از رفع مشکل می‌توانید دوباره اجرا کنید.';}finally{running=false;trash.disabled=list.disabled=false;more.disabled=false;stop.disabled=true;}});
		})();
		</script>
		<?php
	}

	private static function wc_cleanup_authorize() {
		if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'delete_products' ) ) { wp_send_json_error( array( 'message' => 'دسترسی کافی ندارید.' ), 403 ); }
		check_ajax_referer( 'amphp_wc_cleanup', 'nonce' );
		if ( ! class_exists( 'WooCommerce' ) ) { wp_send_json_error( array( 'message' => 'ووکامرس فعال نیست.' ), 400 ); }
	}

	private static function wc_cleanup_counts( $max_id = 0 ) {
		global $wpdb;
		$where = $max_id > 0 ? $wpdb->prepare( ' AND ID <= %d', $max_id ) : '';
		$rows = $wpdb->get_results( "SELECT post_type, COUNT(*) AS n FROM {$wpdb->posts} WHERE post_type IN ('product','product_variation') AND post_status <> 'trash'{$where} GROUP BY post_type", ARRAY_A );
		if ( ! is_array( $rows ) ) { return null; }
		$counts = array( 'products_count' => 0, 'variations_count' => 0 );
		foreach ( $rows as $row ) { if ( $row['post_type'] === 'product' ) { $counts['products_count'] = (int) $row['n']; } elseif ( $row['post_type'] === 'product_variation' ) { $counts['variations_count'] = (int) $row['n']; } }
		return $counts;
	}


	/** Authentication is performed by WordPress REST (cookie nonce or Application Password). */
	public static function register_wc_cleanup_routes() {
		$permission = array( __CLASS__, 'wc_cleanup_rest_permission' );
		register_rest_route( 'amphp/v1', '/wc-cleanup/products', array(
			'methods' => 'GET', 'permission_callback' => $permission,
			'callback' => array( __CLASS__, 'rest_wc_cleanup_list' ),
			'args' => array( 'before' => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ) ),
		) );
		register_rest_route( 'amphp/v1', '/wc-cleanup/start', array(
			'methods' => 'POST', 'permission_callback' => $permission,
			'callback' => array( __CLASS__, 'rest_wc_cleanup_start' ),
			'args' => array( 'confirm' => array( 'type' => 'string', 'required' => true ) ),
		) );
		register_rest_route( 'amphp/v1', '/wc-cleanup/batch', array(
			'methods' => 'POST', 'permission_callback' => $permission,
			'callback' => array( __CLASS__, 'rest_wc_cleanup_batch' ),
			'args' => array( 'job' => array( 'type' => 'string', 'required' => true ) ),
		) );
	}

	public static function wc_cleanup_rest_permission() {
		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) || ! current_user_can( 'delete_products' ) ) {
			return new WP_Error( 'amphp_cleanup_forbidden', 'دسترسی کافی ندارید.', array( 'status' => rest_authorization_required_code() ) );
		}
		if ( ! class_exists( 'WooCommerce' ) ) { return new WP_Error( 'amphp_cleanup_woo_missing', 'ووکامرس فعال نیست.', array( 'status' => 400 ) ); }
		return true;
	}

	public static function rest_wc_cleanup_list( $request ) { return self::wc_cleanup_list( $request->get_param( 'before' ) ); }
	public static function rest_wc_cleanup_start( $request ) { return self::wc_cleanup_start( $request->get_param( 'confirm' ) ); }
	public static function rest_wc_cleanup_batch( $request ) { return self::wc_cleanup_batch( $request->get_param( 'job' ) ); }

	private static function wc_cleanup_ajax_result( $result ) {
		if ( is_wp_error( $result ) ) {
			$data = $result->get_error_data();
			wp_send_json_error( array( 'message' => $result->get_error_message(), 'processed' => (int) ( $data['processed'] ?? 0 ) ), (int) ( $data['status'] ?? 500 ) );
		}
		wp_send_json_success( $result );
	}

	public static function ajax_wc_cleanup_list() {
		self::wc_cleanup_authorize();
		self::wc_cleanup_ajax_result( self::wc_cleanup_list( $_POST['before'] ?? 0 ) );
	}
	public static function ajax_wc_cleanup_start() {
		self::wc_cleanup_authorize();
		self::wc_cleanup_ajax_result( self::wc_cleanup_start( wp_unslash( $_POST['confirm'] ?? '' ) ) );
	}
	public static function ajax_wc_cleanup_batch() {
		self::wc_cleanup_authorize();
		self::wc_cleanup_ajax_result( self::wc_cleanup_batch( wp_unslash( $_POST['job'] ?? '' ) ) );
	}

	private static function wc_cleanup_list( $before ) {
		global $wpdb;
		$before = max( 0, (int) $before );
		$filter = $before ? $wpdb->prepare( ' AND ID < %d', $before ) : '';
		$rows = $wpdb->get_results( "SELECT ID, post_title, post_status FROM {$wpdb->posts} WHERE post_type='product' AND post_status <> 'trash'{$filter} ORDER BY ID DESC LIMIT 51", ARRAY_A );
		$counts = self::wc_cleanup_counts();
		if ( ! is_array( $rows ) || null === $counts ) { return new WP_Error( 'amphp_cleanup_read_failed', 'خطا در خواندن محصولات.', array( 'status' => 500 ) ); }
		$has_more = count( $rows ) > 50; $rows = array_slice( $rows, 0, 50 ); $products = array();
		foreach ( $rows as $row ) { $products[] = array( 'id' => (int) $row['ID'], 'title' => (string) $row['post_title'], 'status' => (string) $row['post_status'] ); }
		return array_merge( $counts, array( 'products' => $products, 'next_cursor' => $has_more ? (int) end( $rows )['ID'] : 0 ) );
	}

	private static function wc_cleanup_start( $confirm ) {
		if ( ! defined( 'EMPTY_TRASH_DAYS' ) || (int) EMPTY_TRASH_DAYS <= 0 ) { return new WP_Error( 'amphp_cleanup_trash_disabled', 'زباله‌دان وردپرس غیرفعال است؛ برای جلوگیری از حذف دائمی عملیات متوقف شد.', array( 'status' => 400 ) ); }
		if ( ! is_string( $confirm ) || $confirm !== 'حذف همه' ) { return new WP_Error( 'amphp_cleanup_confirmation', 'عبارت تأیید معتبر نیست.', array( 'status' => 400 ) ); }
		global $wpdb;
		$max = $wpdb->get_var( "SELECT MAX(ID) FROM {$wpdb->posts} WHERE post_type IN ('product','product_variation') AND post_status <> 'trash'" );
		if ( ! empty( $wpdb->last_error ) ) { return new WP_Error( 'amphp_cleanup_read_failed', 'خطا در خواندن محصولات.', array( 'status' => 500 ) ); }
		$max = (int) $max;
		$counts = self::wc_cleanup_counts( $max );
		if ( null === $counts ) { return new WP_Error( 'amphp_cleanup_count_failed', 'خطا در شمارش محصولات.', array( 'status' => 500 ) ); }
		$token = wp_generate_password( 32, false, false );
		if ( ! set_transient( 'amphp_wc_cleanup_' . $token, array( 'user' => get_current_user_id(), 'max' => $max ), 2 * HOUR_IN_SECONDS ) ) { return new WP_Error( 'amphp_cleanup_job_failed', 'ثبت عملیات ناموفق بود.', array( 'status' => 500 ) ); }
		return array_merge( $counts, array( 'job' => $token ) );
	}

	private static function wc_cleanup_batch( $token ) {
		if ( ! defined( 'EMPTY_TRASH_DAYS' ) || (int) EMPTY_TRASH_DAYS <= 0 ) { return new WP_Error( 'amphp_cleanup_trash_disabled', 'زباله‌دان غیرفعال است؛ عملیات متوقف شد.', array( 'status' => 400 ) ); }
		if ( ! is_string( $token ) || ! preg_match( '/^[a-zA-Z0-9]{32}$/D', $token ) ) { return new WP_Error( 'amphp_cleanup_bad_job', 'شناسه عملیات نامعتبر است.', array( 'status' => 400 ) ); }
		$job = get_transient( 'amphp_wc_cleanup_' . $token );
		if ( ! is_array( $job ) || (int) ( $job['user'] ?? 0 ) !== get_current_user_id() ) { return new WP_Error( 'amphp_cleanup_expired', 'عملیات منقضی شده یا متعلق به شما نیست؛ دوباره شروع کنید.', array( 'status' => 403 ) ); }
		$lock = 'amphp_wc_cleanup_batch_lock';
		$previous = (int) get_option( $lock, 0 );
		if ( $previous && $previous < time() - 300 ) { delete_option( $lock ); }
		if ( ! add_option( $lock, time(), '', false ) ) { return new WP_Error( 'amphp_cleanup_busy', 'عملیات دیگری در حال اجراست؛ کمی بعد دوباره تلاش کنید.', array( 'status' => 409 ) ); }
		$processed = 0; $error = ''; $done = false;
		try {
			global $wpdb;
			$ids = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type IN ('product','product_variation') AND post_status <> 'trash' AND ID <= %d ORDER BY ID DESC LIMIT 20", (int) $job['max'] ) );
			if ( ! is_array( $ids ) || ! empty( $wpdb->last_error ) ) { $error = 'خواندن دسته محصولات ناموفق بود.'; }
			elseif ( ! $ids ) { $done = true; }
			else {
				foreach ( $ids as $id ) {
					$id = (int) $id; $post = get_post( $id );
					if ( ! $post || $post->post_status === 'trash' ) { continue; }
					if ( ! in_array( $post->post_type, array( 'product', 'product_variation' ), true ) || ! current_user_can( 'delete_post', $id ) ) { $error = 'دسترسی حذف برای محصول #' . $id . ' وجود ندارد.'; break; }
					if ( ! wp_trash_post( $id ) || get_post_status( $id ) !== 'trash' ) { $error = 'انتقال محصول #' . $id . ' به زباله‌دان ناموفق بود.'; break; }
					$processed++;
				}
			}
		} catch ( \Throwable $e ) { $error = 'خطا هنگام انتقال دسته؛ لاگ سرور را بررسی کنید.'; }
		finally { delete_option( $lock ); }
		if ( $error !== '' ) { return new WP_Error( 'amphp_cleanup_batch_failed', $error, array( 'status' => 500, 'processed' => $processed ) ); }
		if ( $done ) { delete_transient( 'amphp_wc_cleanup_' . $token ); }
		return array( 'processed' => $processed, 'done' => $done );
	}


	/**
	 * Convert Persian / Arabic numerals to English ASCII digits.
	 *
	 * @param string|int|float $str
	 * @return string
	 */
	public static function persian_to_english_digits( $str ) {
		$persian = array( '۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹' );
		$arabic  = array( '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩' );
		$english = array( '0', '1', '2', '3', '4', '5', '6', '7', '8', '9' );
		return str_replace( $arabic, $english, str_replace( $persian, $english, (string) $str ) );
	}

	/**
	 * Convert English numbers to Persian digits for display.
	 *
	 * @param string|int|float $str
	 * @return string
	 */
	public static function to_fa_num( $str ) {
		$en = array( '0', '1', '2', '3', '4', '5', '6', '7', '8', '9' );
		$fa = array( '۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹' );
		return str_replace( $en, $fa, (string) $str );
	}

	/**
	 * Format a numeric amount with Persian digits and currency symbol.
	 *
	 * @param float|int|string $amount
	 * @param string|null      $currency
	 * @return string
	 */
	public static function format_price( $amount, $currency = null ) {
		$val = floatval( $amount );
		if ( null === $currency || '' === $currency ) {
			$settings = self::get_settings();
			$currency = (string) ( $settings['currency_symbol'] ?? 'تومان' );
		}
		return self::to_fa_num( number_format( $val ) ) . ( $currency !== '' ? ' ' . $currency : '' );
	}

	/**
	 * Extract raw numeric price from any scraped product object or string.
	 *
	 * @param mixed $prod
	 * @return float
	 */
	public static function extract_raw_price( $prod ) {
		if ( ! is_array( $prod ) ) {
			if ( is_numeric( $prod ) ) {
				return (float) $prod;
			}
			$raw_str = (string) $prod;
			$is_rial = (
				stripos( $raw_str, 'ریال' ) !== false ||
				stripos( $raw_str, 'rial' ) !== false ||
				stripos( $raw_str, 'irr' ) !== false
			);
			$s = self::persian_to_english_digits( $raw_str );
			$s = str_replace( array( ',', '،', '٫', ' ', '-', '_' ), '', $s );
			// In Iranian eCommerce, '.' is widely used as thousands separator (e.g. 150.000 or 1.500.000)
			$s = str_replace( '.', '', $s );
			$c = preg_replace( '/[^\d]/', '', $s );
			if ( empty( $c ) ) {
				return 0;
			}
			$val = (float) $c;
			if ( $is_rial && $val > 1000 ) {
				$val = $val / 10;
			}
			return $val;
		}

		$is_rial = false;
		$unit = strtolower( (string) ( $prod['price_unit'] ?? $prod['unit'] ?? '' ) );
		if ( 'rial' === $unit || 'irr' === $unit || stripos( $unit, 'ریال' ) !== false ) {
			$is_rial = true;
		}

		$candidates = array(
			'sale_price',
			'final_price',
			'price',
			'primary_price',
			'display_price',
			'new_price',
			'price_val',
			'price_min',
			'regular_price',
			'orig_price',
			'display_regular_price',
			'old_price',
			'amount',
			'raw_price',
		);

		foreach ( $candidates as $k ) {
			if ( ! isset( $prod[ $k ] ) || $prod[ $k ] === '' || $prod[ $k ] === null ) {
				continue;
			}
			$val = $prod[ $k ];
			if ( is_array( $val ) ) {
				$val = $val['value'] ?? $val['amount'] ?? $val['raw'] ?? $val['price'] ?? reset( $val );
			}
			if ( is_scalar( $val ) ) {
				$raw_str = (string) $val;
				if ( stripos( $raw_str, 'ریال' ) !== false || stripos( $raw_str, 'rial' ) !== false || stripos( $raw_str, 'irr' ) !== false ) {
					$is_rial = true;
				}
				$s = self::persian_to_english_digits( $raw_str );
				$s = str_replace( array( ',', '،', '٫', ' ', '-', '_' ), '', $s );
				$s = str_replace( '.', '', $s );
				$c = preg_replace( '/[^\d]/', '', $s );
				if ( is_numeric( $c ) && (float) $c > 0 ) {
					$num = (float) $c;
					if ( $is_rial && $num > 1000 ) {
						$num = $num / 10;
					}
					return $num;
				}
			}
		}

		// Check price_rial
		if ( ! empty( $prod['price_rial'] ) ) {
			$s = self::persian_to_english_digits( (string) $prod['price_rial'] );
			$s = str_replace( array( ',', '،', '٫', ' ', '-', '_' ), '', $s );
			$s = str_replace( '.', '', $s );
			$c = preg_replace( '/[^\d]/', '', $s );
			if ( is_numeric( $c ) && (float) $c > 0 ) {
				return (float) $c / 10;
			}
		}

		// Check variation_prices
		if ( ! empty( $prod['variation_prices'] ) && is_array( $prod['variation_prices'] ) ) {
			foreach ( $prod['variation_prices'] as $vp ) {
				$raw_vp = is_array( $vp ) ? ( $vp['price'] ?? reset( $vp ) ) : $vp;
				$num = self::extract_raw_price( $raw_vp );
				if ( $num > 0 ) {
					return $num;
				}
			}
		}

		return 0;
	}

	/**
	 * Accurately extract raw regular / old (strikethrough) price.
	 *
	 * @param mixed $prod
	 * @return float
	 */
	public static function extract_raw_old_price( $prod ) {
		if ( ! is_array( $prod ) ) {
			return 0;
		}

		$old_candidates = array(
			'regular_price',
			'old_price',
			'orig_price',
			'display_regular_price',
			'srcPrice',
			'original_price',
			'del_price',
			'price_before_discount',
		);

		foreach ( $old_candidates as $k ) {
			if ( ! isset( $prod[ $k ] ) || $prod[ $k ] === '' || $prod[ $k ] === null ) {
				continue;
			}
			$val = $prod[ $k ];
			if ( is_array( $val ) ) {
				$val = $val['value'] ?? $val['amount'] ?? $val['raw'] ?? reset( $val );
			}
			$num = self::extract_raw_price( $val );
			if ( $num > 0 ) {
				return $num;
			}
		}

		return 0;
	}

	/**
	 * Price Adjustment Engine.
	 * Calculates adjusted price, preserves discounts, handles Rial/Toman, and supports fallback base prices.
	 *
	 * @param mixed      $raw_price
	 * @param array|null $settings
	 * @return array
	 */
	public static function calculate_price( $raw_price, $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		$original = self::extract_raw_price( $raw_price );
		$old_raw  = is_array( $raw_price ) ? self::extract_raw_old_price( $raw_price ) : 0;

		$fallback   = (float) ( $settings['default_fallback_price'] ?? 150000 );
		$behavior   = (string) ( $settings['fallback_price_behavior'] ?? 'use_fallback' );
		$markup_pct = (float) ( $settings['price_markup_percent'] ?? 0 );
		$fixed_add  = (float) ( $settings['price_fixed_add'] ?? 0 );
		$rounding   = (string) ( $settings['price_rounding'] ?? '1000' );
		$currency   = (string) ( $settings['currency_symbol'] ?? 'تومان' );

		$has_valid_source_price = ( $original > 0 );

		// If no source price was found:
		if ( $original <= 0 ) {
			if ( 'use_fallback' === $behavior && $fallback > 0 ) {
				$original = $fallback;
			} elseif ( $fixed_add > 0 ) {
				$original = $fixed_add;
			} else {
				return array(
					'has_price'              => false,
					'has_valid_source_price' => false,
					'original'               => 0,
					'adjusted'               => 0,
					'old_price'              => 0,
					'has_discount'           => false,
					'discount_pct'           => 0,
					'formatted'              => 'تماس بگیرید',
					'formatted_old'          => '',
					'currency'               => $currency,
					'markup_pct'             => $markup_pct,
				);
			}
		}

		// Calculate adjusted current price
		$adjusted = $original * ( 1 + ( $markup_pct / 100 ) ) + $fixed_add;

		// Apply rounding
		if ( '1000' === $rounding && $adjusted > 1000 ) {
			$adjusted = round( $adjusted / 1000 ) * 1000;
		} elseif ( '10000' === $rounding && $adjusted > 10000 ) {
			$adjusted = round( $adjusted / 10000 ) * 10000;
		} else {
			$adjusted = round( $adjusted );
		}

		// Calculate adjusted old price & discount percent
		$adjusted_old = 0;
		$has_discount = false;
		$discount_pct = 0;
		$formatted_old = '';

		if ( $old_raw > $original ) {
			$adjusted_old = $old_raw * ( 1 + ( $markup_pct / 100 ) ) + $fixed_add;
			if ( '1000' === $rounding && $adjusted_old > 1000 ) {
				$adjusted_old = round( $adjusted_old / 1000 ) * 1000;
			} elseif ( '10000' === $rounding && $adjusted_old > 10000 ) {
				$adjusted_old = round( $adjusted_old / 10000 ) * 10000;
			} else {
				$adjusted_old = round( $adjusted_old );
			}

			if ( $adjusted_old > $adjusted ) {
				$has_discount  = true;
				$discount_pct  = (int) round( ( ( $adjusted_old - $adjusted ) / $adjusted_old ) * 100 );
				$formatted_old = self::to_fa_num( number_format( $adjusted_old ) ) . ' ' . $currency;
			}
		}

		$formatted = self::to_fa_num( number_format( $adjusted ) ) . ' ' . $currency;

		return array(
			'has_price'              => true,
			'has_valid_source_price' => $has_valid_source_price,
			'original'               => $original,
			'adjusted'               => $adjusted,
			'old_price'              => $adjusted_old,
			'has_discount'           => $has_discount,
			'discount_pct'           => $discount_pct,
			'formatted'              => $formatted,
			'formatted_old'          => $formatted_old,
			'currency'               => $currency,
			'markup_pct'             => $markup_pct,
		);
	}

	public static function get_profiles_summary() {
		$summary = array();
		$file = method_exists( __CLASS__, 'find_profiles_json_path' ) ? self::find_profiles_json_path() : '';
		if ( $file === '' ) {
			$candidates = array(
				plugin_dir_path( __FILE__ ) . 'profiles.json',
				dirname( __FILE__ ) . '/profiles.json',
				defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/uploads/profiles.json' : '',
			);
			foreach ( $candidates as $cand ) {
				if ( ! empty( $cand ) && file_exists( $cand ) ) { $file = $cand; break; }
			}
		}

		if ( ! $file ) {
			return $summary;
		}

		$json = @file_get_contents( $file );
		$data = @json_decode( $json, true );
		if ( ! is_array( $data ) ) {
			return $summary;
		}

		foreach ( $data as $key => $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}
			$name = ! empty( $p['name'] ) ? $p['name'] : ( ! empty( $p['url'] ) ? parse_url( $p['url'], PHP_URL_HOST ) : $key );
			$url  = $p['url'] ?? '';
			$prods = $p['products'] ?? array();
			$count = 0;
			if ( is_array( $prods ) ) {
				$count = count( $prods );
			}
			$summary[] = array(
				'key'     => $key,
				'name'    => $name,
				'url'     => $url,
				'count'   => $count,
			);
		}

		return $summary;
	}

	/**
	 * Dynamically load all extracted products from profiles.json and scraper temporary files.
	 *
	 * @return array
	 */
	/**
	 * Retrieve native WooCommerce / WordPress products from the database.
	 * Used when the user unchecks the scraped products toggle (State 2 or State 4).
	 *
	 * @return array
	 */
	/** A real creation/publication date only; never mistake an update time for creation. */
	public static function catalog_creation_timestamp( $raw ) {
		if ( ! is_array( $raw ) ) return 0;
		foreach ( array( 'date_created_gmt', 'date_created', 'created_at', 'createdAt', 'published_at', 'date_published', 'datePublished', 'first_seen_at', 'firstSeenAt', 'added_at' ) as $key ) {
			$value = $raw[$key] ?? null;
			if ( is_object( $value ) && method_exists( $value, 'getTimestamp' ) ) {
				$timestamp = (int) $value->getTimestamp();
			} elseif ( is_int( $value ) || ( is_string( $value ) && preg_match( '/^\d{10,13}$/D', $value ) ) ) {
				$timestamp = (float) $value;
				if ( $timestamp > 9999999999 ) $timestamp /= 1000;
				$timestamp = (int) $timestamp;
			} elseif ( is_string( $value ) && preg_match( '/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/D', trim( $value ) ) ) {
				$timestamp = strtotime( trim( $value ) );
			} else {
				continue;
			}
			if ( $timestamp && $timestamp > 0 && $timestamp <= time() + 86400 ) return (int) $timestamp;
		}
		return 0;
	}

	/** Remember first observation for newly discovered profile products, not an invented history. */
	public static function catalog_assign_first_seen( $products ) {
		if ( ! is_array( $products ) || ! $products ) return $products;
		$opt = 'amphp_catalog_first_seen_v1';
		$state = get_option( $opt, false );
		$lock_key = 'amphp_catalog_first_seen_lock';
		$locked = false;
		if ( function_exists( 'add_option' ) && function_exists( 'update_option' ) && function_exists( 'delete_option' ) ) {
			$prior = (int) get_option( $lock_key, 0 );
			if ( $prior && $prior < time() - 300 ) delete_option( $lock_key );
			$locked = add_option( $lock_key, time(), '', false );
		}
		try {
			if ( $locked ) $state = get_option( $opt, false );
			$initialized = is_array( $state ) && ! empty( $state['initialized'] ) && is_array( $state['items'] ?? null );
			$seen = $initialized ? $state['items'] : array();
			$changed = ! $initialized; $now = time();
			foreach ( $products as &$product ) {
				$key = (string) ( $product['_catalog_seen_key'] ?? '' );
				if ( $key === '' ) continue;
				if ( ! array_key_exists( $key, $seen ) && $locked ) {
					// Existing undated products at activation have unknown historical dates.
					$seen[$key] = $initialized ? $now : 0;
					$changed = true;
				}
				if ( empty( $product['created_ts'] ) && ! empty( $seen[$key] ) ) $product['created_ts'] = (int) $seen[$key];
				unset( $product['_catalog_seen_key'] );
			}
			unset( $product );
			if ( $locked && $changed ) update_option( $opt, array( 'initialized' => true, 'items' => $seen ), false );
		} finally {
			if ( $locked ) delete_option( $lock_key );
		}
		return $products;
	}

	public static function get_woocommerce_native_products() {
		$products = array();

		if ( function_exists( 'wc_get_products' ) ) {
			$wc_prods = wc_get_products( array(
				'limit'   => -1, /* v13.3.8: همهٔ محصولات ووکامرس */
				'status'  => 'publish',
				'orderby' => 'date',
				'order'   => 'DESC',
			) );

			if ( ! empty( $wc_prods ) && is_array( $wc_prods ) ) {
				foreach ( $wc_prods as $wp_prod ) {
					if ( ! is_object( $wp_prod ) ) continue;
					$p_id = $wp_prod->get_id();
					$price = (float) $wp_prod->get_price();
					$reg_price = (float) $wp_prod->get_regular_price();
					$sale_price = (float) $wp_prod->get_sale_price();
					$has_discount = ( $sale_price > 0 && $reg_price > $sale_price );
					$discount_pct = ( $has_discount && $reg_price > 0 ) ? round( ( ( $reg_price - $sale_price ) / $reg_price ) * 100 ) : 0;

					$img_id = $wp_prod->get_image_id();
					$img_url = $img_id ? wp_get_attachment_image_url( $img_id, 'full' ) : '';
					if ( empty( $img_url ) || self::is_bad_product_image( $img_url ) ) {
						$scraped_img = get_post_meta( $p_id, '_scraped_image_url', true );
						$ai_img = get_post_meta( $p_id, '_amphp_ai_image_url', true );
						if ( $ai_img && ! self::is_bad_product_image( $ai_img ) ) {
							$img_url = $ai_img;
						} elseif ( $scraped_img && ! self::is_bad_product_image( $scraped_img ) ) {
							$img_url = $scraped_img;
						} else {
							$img_url = ''; /* v13.3.14: never show WC/Snapp placeholder in storefront */
						}
					}

					$cat_list = wc_get_product_category_list( $p_id );
					$clean_cat = wp_strip_all_tags( $cat_list );
					if ( empty( $clean_cat ) ) {
						$clean_cat = 'کالای عمومی';
					}

					$desc = wp_strip_all_tags( $wp_prod->get_short_description() ?: $wp_prod->get_description() );

					$products[] = array(
						'id'                  => 'wc_' . $p_id,
						'wc_id'               => $p_id,
						'created_ts'          => self::catalog_creation_timestamp( array( 'date_created' => $wp_prod->get_date_created() ) ),
						'title'               => $wp_prod->get_name(),
						'has_price'           => ( $price > 0 ),
						'original_price'      => $reg_price ?: $price,
						'price'               => $price,
						'price_formatted'     => number_format( $price ) . ' تومان',
						'old_price'           => $has_discount ? $reg_price : 0,
						'old_price_formatted' => $has_discount ? ( number_format( $reg_price ) . ' تومان' ) : '',
						'has_discount'        => $has_discount,
						'discount_pct'        => $discount_pct,
						'image'               => $img_url,
						'gallery'             => array( $img_url ),
						'category'            => $clean_cat,
						'description'         => $desc,
						'in_stock'            => $wp_prod->is_in_stock(),
						'source'              => 'woocommerce',
						'source_label'        => 'ووکامرس',
					);
				}
			}
		}

		// Fallback to get_posts if wc_get_products returned empty
		if ( empty( $products ) ) {
			$raw_posts = get_posts( array(
				'post_type'      => 'product',
				'post_status'    => 'publish',
				'posts_per_page' => -1, /* v13.3.8 all */
			) );

			if ( ! empty( $raw_posts ) ) {
				foreach ( $raw_posts as $post ) {
					$pid = $post->ID;
					$price = (float) get_post_meta( $pid, '_price', true );
					$reg_price = (float) get_post_meta( $pid, '_regular_price', true );
					$sale_price = (float) get_post_meta( $pid, '_sale_price', true );
					$has_discount = ( $sale_price > 0 && $reg_price > $sale_price );
					$discount_pct = ( $has_discount && $reg_price > 0 ) ? round( ( ( $reg_price - $sale_price ) / $reg_price ) * 100 ) : 0;

					$img = get_the_post_thumbnail_url( $pid, 'full' );
					if ( empty( $img ) ) {
						$img = get_post_meta( $pid, '_scraped_image_url', true );
					}

					$cats = wp_get_post_terms( $pid, 'product_cat', array( 'fields' => 'names' ) );
					$cat = ( ! empty( $cats ) && ! is_wp_error( $cats ) ) ? $cats[0] : 'کالای عمومی';

					$products[] = array(
						'id'                  => 'wc_' . $pid,
						'wc_id'               => $pid,
						'created_ts'          => self::catalog_creation_timestamp( array( 'date_created_gmt' => $post->post_date_gmt ?? '', 'date_created' => $post->post_date ?? '' ) ),
						'title'               => get_the_title( $pid ),
						'has_price'           => ( $price > 0 ),
						'original_price'      => $reg_price ?: $price,
						'price'               => $price,
						'price_formatted'     => number_format( $price ) . ' تومان',
						'old_price'           => $has_discount ? $reg_price : 0,
						'old_price_formatted' => $has_discount ? ( number_format( $reg_price ) . ' تومان' ) : '',
						'has_discount'        => $has_discount,
						'discount_pct'        => $discount_pct,
						'image'               => $img ?: '',
						'gallery'             => array( $img ?: '' ),
						'category'            => $cat,
						'description'         => wp_strip_all_tags( $post->post_excerpt ?: $post->post_content ),
						'in_stock'            => true,
						'source'              => 'woocommerce',
						'source_label'        => 'ووکامرس',
					);
				}
			}
		}

		return $products;
	}

	/**
	 * v13.3.8: همهٔ محصولات استخراج‌شده از profiles.json (بدون سقف).
	 * مسیر پروفایل مثل get_profiles_summary چندجا چک می‌شود.
	 *
	 * @return array
	 */
	public static function find_profiles_json_path() {
		$candidates = array(
			plugin_dir_path( __FILE__ ) . 'profiles.json',
			dirname( __FILE__ ) . '/profiles.json',
			defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/uploads/profiles.json' : '',
			defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/uploads/amphp/profiles.json' : '',
			dirname( plugin_dir_path( __FILE__ ) ) . '/profiles.json',
		);
		// کنار scraper4.php اگر agent جدا باشد
		$scraper_sib = dirname( __FILE__ ) . '/scraper4.php';
		if ( is_file( $scraper_sib ) ) {
			$candidates[] = dirname( $scraper_sib ) . '/profiles.json';
		}
		foreach ( $candidates as $cand ) {
			if ( ! empty( $cand ) && is_file( $cand ) && is_readable( $cand ) ) {
				return $cand;
			}
		}
		return '';
	}


	/**
	 * v13.3.8: منبع کاتالوگ ویترین — scraper | woocommerce | merge
	 */
	public static function resolve_catalog_source( $settings = null ) {
		if ( ! is_array( $settings ) ) {
			$settings = self::get_settings();
		}
		$cs = sanitize_key( (string) ( $settings['catalog_source'] ?? '' ) );
		if ( in_array( $cs, array( 'scraper', 'woocommerce', 'merge' ), true ) ) {
			return $cs;
		}
		return ! empty( $settings['enable_scraped_products'] ) ? 'scraper' : 'woocommerce';
	}

	public static function catalog_dedupe_key( $p ) {
		if ( ! is_array( $p ) ) {
			return '';
		}
		$title = function_exists( 'mb_strtolower' )
			? mb_strtolower( trim( (string) ( $p['title'] ?? '' ) ), 'UTF-8' )
			: strtolower( trim( (string) ( $p['title'] ?? '' ) ) );
		$title = preg_replace( '/\s+/u', ' ', $title );
		$sku = trim( (string) ( $p['sku'] ?? $p['key'] ?? '' ) );
		if ( $sku !== '' ) {
			$norm = function_exists( 'mb_strtolower' ) ? mb_strtolower( $sku, 'UTF-8' ) : strtolower( $sku );
			return 'sku:' . $norm;
		}
		return 't:' . md5( $title );
	}

	public static function merge_catalog_products( $primary, $secondary, $prefer = 'scraper' ) {
		$out  = array();
		$seen = array();
		$prefer = in_array( $prefer, array( 'scraper', 'woocommerce', 'keep_both' ), true ) ? $prefer : 'scraper';
		foreach ( array( $primary, $secondary ) as $list ) {
			foreach ( (array) $list as $p ) {
				if ( ! is_array( $p ) ) {
					continue;
				}
				if ( trim( (string) ( $p['title'] ?? '' ) ) === '' ) {
					continue;
				}
				if ( $prefer === 'keep_both' ) {
					$idk = 'id:' . (string) ( $p['id'] ?? '' );
					if ( $idk !== 'id:' && isset( $seen[ $idk ] ) ) {
						continue;
					}
					$seen[ $idk ] = true;
					$out[] = $p;
					continue;
				}
				$dk = self::catalog_dedupe_key( $p );
				if ( $dk === '' ) {
					$dk = 'id:' . (string) ( $p['id'] ?? uniqid( 'p', true ) );
				}
				if ( isset( $seen[ $dk ] ) ) {
					continue;
				}
				$seen[ $dk ] = true;
				$out[] = $p;
			}
		}
		return $out;
	}

	/** Map scraper product keys to their original array indexes without dropping duplicates. */
	public static function profile_product_entry_key( $entry, $index ) {
		if ( is_array( $entry ) && isset( $entry[1] ) && is_array( $entry[1] ) ) {
			return (string) ( $entry[0] ?? $index );
		}
		return (string) ( is_array( $entry ) ? ( $entry['key'] ?? $entry['id'] ?? $index ) : $index );
	}

	public static function profile_product_key_map( $entries ) {
		$keys = array();
		foreach ( $entries as $index => $entry ) {
			$keys[ self::profile_product_entry_key( $entry, $index ) ][] = $index;
		}
		return $keys;
	}

	/** Stable for a unique scraper key, scoped to the profile; duplicates use their index. */
	public static function profile_product_id( $profile_key, $entry_key, $entry, $key_map ) {
		$key = self::profile_product_entry_key( $entry, $entry_key );
		$duplicate_index = count( $key_map[ $key ] ?? array() ) > 1 ? (string) $entry_key : '';
		return 'sp_' . md5( wp_json_encode( array( (string) $profile_key, $key, $duplicate_index ), JSON_UNESCAPED_UNICODE ) );
	}


	/** Build an authoritative, request-local index from current profiles, never from WC or temp caches. */
	public static function profile_purchase_index() {
		static $index = null;
		if ( null !== $index ) { return $index; }
		$index = array( 'ids' => array(), 'titles' => array() );
		$path = self::find_profiles_json_path();
		$data = $path !== '' && is_readable( $path ) ? json_decode( (string) file_get_contents( $path ), true ) : null;
		if ( ! is_array( $data ) ) { return $index; }
		foreach ( $data as $profile => $group ) {
			$entries = is_array( $group['products'] ?? null ) ? $group['products'] : array();
			$keys = self::profile_product_key_map( $entries );
			foreach ( $entries as $key => $entry ) {
				$raw = is_array( $entry ) && isset( $entry[1] ) && is_array( $entry[1] ) ? $entry[1] : $entry;
				if ( ! is_array( $raw ) ) { continue; }
				$title = trim( (string) ( $raw['title'] ?? $raw['name'] ?? '' ) );
				if ( $title === '' ) { continue; }
				$legacy = md5( $title . (string) ( $raw['link'] ?? $raw['url'] ?? '' ) );
				$stable = self::profile_product_id( $profile, $key, $entry, $keys );
				$index['ids'][$legacy] = $title;
				$index['ids'][$stable] = $title;
				$index['titles'][$title] = ( $index['titles'][$title] ?? 0 ) + 1;
			}
		}
		return $index;
	}

	public static function profile_purchase_id_allowed( $id ) {
		$index = self::profile_purchase_index();
		return is_scalar( $id ) && isset( $index['ids'][(string) $id] );
	}

	public static function profile_wc_product_allowed( $product ) {
		if ( self::resolve_catalog_source() !== 'scraper' ) { return true; }
		if ( is_numeric( $product ) && function_exists( 'wc_get_product' ) ) { $product = wc_get_product( $product ); }
		if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) { return false; }
		$id = (int) $product->get_id();
		if ( method_exists( $product, 'get_parent_id' ) && $product->get_parent_id() ) { $id = (int) $product->get_parent_id(); }
		foreach ( array( '_amphp_profile_id', '_scraped_hash' ) as $key ) {
			$profile_id = get_post_meta( $id, $key, true );
			if ( self::profile_purchase_id_allowed( $profile_id ) ) {
				$index = self::profile_purchase_index();
				if ( trim( (string) get_the_title( $id ) ) === $index['ids'][(string) $profile_id] ) { return true; }
			}
		}
		// Compatibility for older direct syncs, which stored no profile ID. Never infer
		// membership from title for unrelated WC products; ambiguous titles fail closed.
		if ( get_post_meta( $id, '_amphp_sync_via', true ) === 'direct' ) {
			$title = trim( (string) get_the_title( $id ) );
			$index = self::profile_purchase_index();
			return $title !== '' && ( $index['titles'][$title] ?? 0 ) === 1;
		}
		return false;
	}

	public static function profile_only_wc_filter( $value, $product ) {
		return self::profile_wc_product_allowed( $product ) ? $value : false;
	}

	public static function profile_only_check_cart() {
		if ( self::resolve_catalog_source() !== 'scraper' || ! function_exists( 'WC' ) || ! WC()->cart ) { return; }
		foreach ( WC()->cart->get_cart() as $item ) {
			if ( ! self::profile_wc_product_allowed( $item['data'] ?? null ) ) {
				wc_add_notice( 'یکی از کالاهای سبد در محصولات فعلی پروفایل‌ها نیست. برای ادامه آن را حذف کنید.', 'error' );
				return;
			}
		}
	}

	/** Reject stale or forged storefront carts before creating an order or clearing the WC cart. */
	public static function profile_cart_items_allowed( $items ) {
		if ( self::resolve_catalog_source() !== 'scraper' ) { return true; }
		foreach ( $items as $item ) {
			if ( ! is_array( $item ) || ! self::profile_purchase_id_allowed( $item['id'] ?? $item['hash'] ?? '' ) ) { return false; }
			$index = self::profile_purchase_index();
			$id = (string) ( $item['id'] ?? $item['hash'] ?? '' );
			if ( ! isset( $item['title'] ) || trim( (string) $item['title'] ) !== $index['ids'][$id] ) { return false; }
		}
		return true;
	}


	/** Public restrictions must not interfere with product management or background sync. */
	public static function profile_public_restrictions_active() {
		if ( self::resolve_catalog_source() !== 'scraper' ) { return false; }
		if ( defined( 'WP_CLI' ) && WP_CLI || function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) { return false; }
		if ( ! empty( $GLOBALS['amphp_torob_feed_request'] ) ) { return true; }
		if ( function_exists( 'current_user_can' ) && current_user_can( 'manage_woocommerce' ) ) { return false; }
		if ( function_exists( 'is_admin' ) && is_admin() && ! ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) ) { return false; }
		return true;
	}

	/** Index WC parents in one database read; used before pagination, never stored as a stale cache. */
	public static function profile_public_wc_ids() {
		static $allowed = null;
		if ( null !== $allowed ) { return $allowed; }
		$allowed = array();
		global $wpdb;
		$index = self::profile_purchase_index();
		if ( empty( $index['ids'] ) || ! isset( $wpdb->posts, $wpdb->postmeta ) ) { return $allowed; }
		$sql = "SELECT p.ID, p.post_title, pm.meta_key, pm.meta_value FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} pm ON pm.post_id=p.ID AND pm.meta_key IN ('_amphp_profile_id','_scraped_hash','_amphp_sync_via') WHERE p.post_type='product' AND p.post_status='publish'";
		$rows = $wpdb->get_results( $sql, ARRAY_A );
		if ( ! is_array( $rows ) ) { return $allowed; }
		foreach ( $rows as $row ) {
			$id = (int) $row['ID']; $title = trim( (string) $row['post_title'] ); $value = (string) $row['meta_value'];
			if ( $id <= 0 || $title === '' ) { continue; }
			if ( ( $row['meta_key'] === '_amphp_profile_id' || $row['meta_key'] === '_scraped_hash' ) && isset( $index['ids'][$value] ) && $index['ids'][$value] === $title ) { $allowed[$id] = $id; }
			if ( $row['meta_key'] === '_amphp_sync_via' && $value === 'direct' && ( $index['titles'][$title] ?? 0 ) === 1 ) { $allowed[$id] = $id; }
		}
		return array_values( $allowed );
	}

	/** Restrict SQL before LIMIT and counts; supports mixed searches and product variations. */
	public static function profile_public_products_where( $where, $query ) {
		if ( ! self::profile_public_restrictions_active() || ! is_object( $query ) || ! method_exists( $query, 'get' ) ) { return $where; }
		$type = $query->get( 'post_type' );
		$types = is_array( $type ) ? $type : array( $type );
		$is_search = method_exists( $query, 'is_search' ) && $query->is_search();
		if ( ! $is_search && ! in_array( 'product', $types, true ) && ! in_array( 'product_variation', $types, true ) && ! in_array( 'any', $types, true ) ) { return $where; }
		// Let direct product pages resolve, then return an explicit non-redirecting 404.
		if ( method_exists( $query, 'is_singular' ) && $query->is_singular( 'product' ) && empty( $GLOBALS['amphp_torob_feed_request'] ) ) { return $where; }
		global $wpdb;
		$ids = self::profile_public_wc_ids();
		$ids_sql = empty( $ids ) ? '0' : implode( ',', array_map( 'intval', $ids ) );
		return $where . " AND ({$wpdb->posts}.post_type NOT IN ('product','product_variation') OR ({$wpdb->posts}.post_type='product' AND {$wpdb->posts}.ID IN ({$ids_sql})) OR ({$wpdb->posts}.post_type='product_variation' AND {$wpdb->posts}.post_parent IN ({$ids_sql})))";
	}

	/** Do not let the plugin's optional 404-to-shop redirect expose product information. */
	public static function profile_hide_direct_product() {
		if ( ! self::profile_public_restrictions_active() || ! function_exists( 'is_singular' ) || ! is_singular( 'product' ) ) { return; }
		if ( self::profile_wc_product_allowed( get_queried_object_id() ) ) { return; }
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 ); nocache_headers();
		header( 'X-Robots-Tag: noindex, nofollow', true );
		$template = get_404_template();
		if ( $template ) { include $template; }
		exit;
	}

	/** Official WCPE feed also supports individual ID/slug lookups outside WP_Query. */
	public static function profile_filter_torob_request( $response, $handler, $request ) {
		if ( ! is_object( $request ) || rtrim( $request->get_route(), '/' ) !== '/wcpe/v1/products' || self::resolve_catalog_source() !== 'scraper' ) { return $response; }
		$GLOBALS['amphp_torob_feed_request'] = true;
		$ids = $request->get_param( 'products' );
		if ( is_scalar( $ids ) && (string) $ids !== '' ) {
			$allowed = array();
			foreach ( explode( ',', (string) $ids ) as $id ) {
				$id = (int) trim( $id );
				if ( $id > 0 && self::profile_wc_product_allowed( $id ) ) { $allowed[] = $id; }
			}
			// -1 makes WCPE choose the list-lookup path but resolves to no product.
			$request->set_param( 'products', $allowed ? implode( ',', $allowed ) : '-1' );
		}
		$slugs = $request->get_param( 'slugs' );
		if ( is_scalar( $slugs ) && (string) $slugs !== '' && empty( $ids ) ) {
			$allowed = array();
			foreach ( explode( ',', urldecode( (string) $slugs ) ) as $slug ) {
				$post = get_page_by_path( trim( $slug ), OBJECT, 'product' );
				if ( $post && self::profile_wc_product_allowed( $post->ID ) ) { $allowed[] = trim( $slug ); }
			}
			if ( $allowed ) { $request->set_param( 'slugs', implode( ',', $allowed ) ); }
			else { $request->set_param( 'products', '-1' ); }
		}
		return $response;
	}

	public static function profile_finish_torob_request( $response, $handler, $request ) {
		if ( is_object( $request ) && rtrim( $request->get_route(), '/' ) === '/wcpe/v1/products' ) { unset( $GLOBALS['amphp_torob_feed_request'] ); }
		return $response;
	}

	public static function profile_hide_store_api_item( $result, $server, $request ) {
		if ( null !== $result || ! self::profile_public_restrictions_active() || ! is_object( $request ) ) { return $result; }
		if ( preg_match( '#^/wc/store(?:/v1)?/products/(\d+)/?$#', $request->get_route(), $match ) && ! self::profile_wc_product_allowed( (int) $match[1] ) ) {
			return new WP_Error( 'woocommerce_rest_product_invalid_id', 'محصول یافت نشد.', array( 'status' => 404 ) );
		}
		return $result;
	}

	/** Profile-only Torob Product API v3. Token verification always precedes catalog access. */
	public static function register_torob_profile_route() {
		register_rest_route( 'amphp/v1', '/torob/products', array(
			'methods' => 'POST', 'callback' => array( __CLASS__, 'torob_profile_rest' ),
			'permission_callback' => array( __CLASS__, 'torob_profile_permission' ),
		) );
	}

	public static function torob_decode_base64url( $input ) {
		if ( ! is_string( $input ) || $input === '' || ! preg_match( '/^[A-Za-z0-9_-]+$/D', $input ) ) { return false; }
		$decoded = base64_decode( strtr( $input, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $input ) % 4 ) % 4 ), true );
		if ( $decoded === false || rtrim( strtr( base64_encode( $decoded ), '+/', '-_' ), '=' ) !== $input ) { return false; }
		return $decoded;
	}

	/** $public_key is injectable solely for isolated tests; the REST route always uses Torob's key. */
	public static function torob_validate_jwt( $jwt, $version, $audience, $public_key = null, $now = null ) {
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) || $version !== '1' || ! is_string( $jwt ) || strlen( $jwt ) > 8192 || ! is_string( $audience ) || $audience === '' ) { return false; }
		$parts = explode( '.', $jwt );
		if ( count( $parts ) !== 3 ) { return false; }
		$header_raw = self::torob_decode_base64url( $parts[0] ); $claims_raw = self::torob_decode_base64url( $parts[1] ); $signature = self::torob_decode_base64url( $parts[2] );
		if ( $header_raw === false || $claims_raw === false || $signature === false || strlen( $signature ) !== 64 ) { return false; }
		$header = json_decode( $header_raw, true ); $claims = json_decode( $claims_raw, true );
		if ( ! is_array( $header ) || ! is_array( $claims ) || ( $header['alg'] ?? '' ) !== 'EdDSA' || ( $header['typ'] ?? '' ) !== 'JWT' || ( $header['v'] ?? null ) !== 1 ) { return false; }
		$key = $public_key === null ? base64_decode( 't6Mu4T0pBORY11W+QeM35UsmLO3vsf+6yKpFDEImFk0=', true ) : $public_key;
		if ( ! is_string( $key ) || strlen( $key ) !== 32 ) { return false; }
		try { if ( ! sodium_crypto_sign_verify_detached( $signature, $parts[0] . '.' . $parts[1], $key ) ) { return false; } } catch ( \Throwable $e ) { return false; }
		$now = $now === null ? time() : (int) $now;
		if ( ! isset( $claims['exp'], $claims['nbf'], $claims['aud'] ) || ! is_int( $claims['exp'] ) || ! is_int( $claims['nbf'] ) || ! is_string( $claims['aud'] ) ) { return false; }
		return $claims['exp'] > $now && $claims['nbf'] <= $now && hash_equals( strtolower( $audience ), strtolower( $claims['aud'] ) );
	}

	public static function torob_profile_permission( $request ) {
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) { return new WP_Error( 'amphp_torob_crypto_missing', 'PHP sodium is required.', array( 'status' => 503 ) ); }
		$site = wp_parse_url( rest_url( 'amphp/v1/torob/products' ) );
		$host = strtolower( (string) ( $site['host'] ?? '' ) );
		if ( isset( $site['port'] ) ) { $host .= ':' . (int) $site['port']; }
		$token = $request->get_header( 'X-Torob-Token' ); $version = $request->get_header( 'X-Torob-Token-Version' );
		if ( ! self::torob_validate_jwt( $token, (string) $version, $host ) ) { return new WP_Error( 'amphp_torob_unauthorized', 'Invalid Torob token.', array( 'status' => 401 ) ); }
		return true;
	}

	public static function torob_text( $value, $length ) {
		$value = is_scalar( $value ) ? trim( wp_strip_all_tags( (string) $value ) ) : '';
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $length, 'UTF-8' ) : preg_replace( '/^(.{0,' . (int) $length . '}).*$/us', '$1', $value );
	}

	public static function torob_profile_stock( $raw, $fallback ) {
		if ( isset( $raw['in_stock'] ) && is_string( $raw['in_stock'] ) ) {
			$v = strtolower( trim( $raw['in_stock'] ) );
			if ( in_array( $v, array( 'false', 'no', '0', 'outofstock', 'out_of_stock' ), true ) ) return false;
		}
		return (bool) $fallback;
	}

	public static function torob_profile_url( $id ) { return add_query_arg( 'product', $id, home_url( '/' ) ); }

	/** Build a compressed short-lived snapshot; price/date changes are observed, never guessed. */
	public static function torob_profile_snapshot() {
		$settings = self::get_settings();
		if ( self::resolve_catalog_source( $settings ) !== 'scraper' || empty( $settings['enable_shop_takeover'] ) || in_array( (string) ( $settings['store_template'] ?? '' ), array( 'native', 'native-wp' ), true ) ) {
			return new WP_Error( 'amphp_torob_mode', 'Profile-only React storefront must be enabled.', array( 'status' => 503 ) );
		}
		$path = self::find_profiles_json_path();
		if ( $path === '' || ! is_readable( $path ) || ! function_exists( 'gzencode' ) || ! function_exists( 'gzdecode' ) ) { return new WP_Error( 'amphp_torob_unavailable', 'Profile file or compression unavailable.', array( 'status' => 503 ) ); }
		$digest = @hash_file( 'sha256', $path );
		if ( ! is_string( $digest ) ) { return new WP_Error( 'amphp_torob_read_error', 'Profile file cannot be read.', array( 'status' => 503 ) ); }
		$key = 'amphp_torob_' . substr( hash( 'sha256', $digest . wp_json_encode( $settings ) . home_url( '/' ) . 'v1' ), 0, 32 );
		$cached = get_transient( $key );
		if ( is_string( $cached ) ) { $json = @gzdecode( base64_decode( $cached, true ) ); $data = is_string( $json ) ? json_decode( $json, true ) : null; if ( is_array( $data ) && isset( $data['items'], $data['orders'] ) ) { return $data; } }
		$lock = 'amphp_torob_snapshot_lock'; $old = (int) get_option( $lock, 0 );
		if ( $old && $old < time() - 300 ) { delete_option( $lock ); }
		if ( ! add_option( $lock, time(), '', false ) ) { return new WP_Error( 'amphp_torob_busy', 'Catalog snapshot is being built. Retry shortly.', array( 'status' => 503 ) ); }
		try {
			$raw = @file_get_contents( $path ); $decoded = is_string( $raw ) ? json_decode( $raw, true ) : null;
			if ( ! is_array( $decoded ) || ! hash_equals( $digest, hash( 'sha256', $raw ) ) ) { return new WP_Error( 'amphp_torob_read_error', 'Profiles unavailable or changed during read.', array( 'status' => 503 ) ); }
			unset( $raw );
			$state = get_option( 'amphp_torob_observed_v1', array() ); if ( ! is_array( $state ) ) { $state = array(); }
			$state_changed = false; $items = array(); $now = time();
			$currency = strtolower( (string) ( $settings['currency_symbol'] ?? 'تومان' ) );
			$in_rial = $currency === 'irr' || $currency === 'rial' || strpos( $currency, 'ریال' ) !== false;
			foreach ( $decoded as $profile_key => &$group ) {
				if ( ! is_array( $group ) || ! is_array( $group['products'] ?? null ) ) { continue; }
				$keys = self::profile_product_key_map( $group['products'] );
				foreach ( $group['products'] as $entry_key => &$entry ) {
					$prod = is_array( $entry ) && isset( $entry[1] ) && is_array( $entry[1] ) ? $entry[1] : $entry;
					if ( ! is_array( $prod ) ) { unset( $group['products'][$entry_key], $entry ); continue; }
					$id = self::profile_product_id( $profile_key, $entry_key, $entry, $keys );
					$title = self::torob_text( $prod['title'] ?? $prod['name'] ?? '', 500 );
					if ( $title === '' ) { unset( $group['products'][$entry_key], $entry, $prod ); continue; }
					$price_calc = self::calculate_price( $prod, $settings );
					$price = max( 0, (int) round( (float) $price_calc['adjusted'] / ( $in_rial ? 10 : 1 ) ) );
					$stock = true;
					if ( array_key_exists( 'in_stock', $prod ) ) { $stock = (bool) $prod['in_stock']; }
					elseif ( isset( $prod['stock'] ) && is_numeric( $prod['stock'] ) ) { $stock = (int) $prod['stock'] > 0; }
					elseif ( ! empty( $prod['unavailable'] ) || ! empty( $prod['out_of_stock'] ) ) { $stock = false; }
					$available = self::torob_profile_stock( $prod, $stock ) && ! empty( $price_calc['has_valid_source_price'] ) && $price > 0;
					$img = $prod['image'] ?? $prod['img'] ?? '';
					$gallery = is_array( $prod['images'] ?? null ) ? $prod['images'] : ( is_array( $prod['gallery'] ?? null ) ? $prod['gallery'] : array() );
					if ( empty( $img ) && ! empty( $gallery[0] ) ) $img = $gallery[0];
					$img_res = self::resolve_product_images( array_merge( $prod, array( 'image' => $img, 'gallery' => $gallery ) ) );
					$images = array(); foreach ( array_merge( array( $img_res['image'] ), (array) $img_res['gallery'] ) as $image ) {
						if ( is_string( $image ) && strlen( $image ) <= 1000 && preg_match( '~^https?://~i', $image ) && filter_var( $image, FILTER_VALIDATE_URL ) && ! in_array( $image, $images, true ) ) { $images[] = $image; if ( count( $images ) >= 10 ) break; }
					}
					$cat = $prod['category'] ?? $prod['cat'] ?? 'عمومی'; if ( is_array( $cat ) ) $cat = $cat['name'] ?? $cat[0] ?? 'عمومی';
					$desc = $prod['short_desc'] ?? $prod['shortDesc'] ?? $prod['long_desc'] ?? $prod['longDesc'] ?? $prod['description'] ?? $prod['desc'] ?? '';
					$item = array( 'page_unique' => $id, 'page_url' => self::torob_profile_url( $id ), 'title' => $title, 'current_price' => $available ? $price : 0, 'availability' => $available, 'category_name' => self::torob_text( $cat, 200 ), 'image_links' => $images, 'spec' => (object) array(), 'short_desc' => self::torob_text( $desc, 500 ) );
					$old_price = max( 0, (int) round( (float) $price_calc['old_price'] / ( $in_rial ? 10 : 1 ) ) );
					if ( $available && $old_price > $price ) { $item['old_price'] = $old_price; }
					$encoded_item = wp_json_encode( $item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
					if ( ! is_string( $encoded_item ) ) { return new WP_Error( 'amphp_torob_bad_data', 'A profile product cannot be encoded.', array( 'status' => 503 ) ); }
					$fingerprint = hash( 'sha256', $encoded_item ); $prior = is_array( $state[$id] ?? null ) ? $state[$id] : array();
					$created = self::catalog_creation_timestamp( $prod ); $added = $created > 0 ? $created : (int) ( $prior['added'] ?? $now );
					$updated = ( ! empty( $prior['hash'] ) && hash_equals( (string) $prior['hash'], $fingerprint ) ) ? (int) ( $prior['updated'] ?? $now ) : $now;
					$next_state = array( 'hash' => $fingerprint, 'added' => $added, 'updated' => $updated );
					if ( $next_state !== $prior ) { $state[$id] = $next_state; $state_changed = true; }
					$item['date_added'] = gmdate( 'c', $added ); $item['date_updated'] = gmdate( 'c', $updated );
					$items[$id] = wp_json_encode( $item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
					unset( $group['products'][$entry_key], $entry, $prod );
				}
				unset( $group['products'], $group );
			}
			unset( $group, $decoded );
			if ( ! hash_equals( $digest, (string) @hash_file( 'sha256', $path ) ) ) { return new WP_Error( 'amphp_torob_changed', 'Profiles changed during build. Retry.', array( 'status' => 503 ) ); }
			if ( $state_changed && ! update_option( 'amphp_torob_observed_v1', $state, false ) ) { return new WP_Error( 'amphp_torob_state_failed', 'Catalog observation state could not be saved.', array( 'status' => 503 ) ); }
			$orders = array();
			foreach ( array( 'date_added_desc', 'date_updated_desc', 'product_id_desc' ) as $sort ) {
				$ids = array_keys( $items );
				usort( $ids, function( $a, $b ) use ( &$state, $sort ) { if ( $sort !== 'product_id_desc' ) { $field = $sort === 'date_added_desc' ? 'added' : 'updated'; $d = $state[$b][$field] <=> $state[$a][$field]; if ( $d !== 0 ) return $d; } return strcmp( $b, $a ); } );
				$orders[$sort] = $ids;
			}
			unset( $state );
			$snapshot = array( 'items' => $items, 'orders' => $orders );
			$encoded = wp_json_encode( $snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
			$compressed = is_string( $encoded ) ? gzencode( $encoded, 6 ) : false;
			if ( $compressed === false || ! set_transient( $key, base64_encode( $compressed ), 5 * MINUTE_IN_SECONDS ) ) { return new WP_Error( 'amphp_torob_cache_failed', 'Catalog cache could not be saved.', array( 'status' => 503 ) ); }
			$old_key = get_option( 'amphp_torob_cache_key', '' ); update_option( 'amphp_torob_cache_key', $key, false );
			if ( is_string( $old_key ) && $old_key !== '' && $old_key !== $key ) { delete_transient( $old_key ); }
			return $snapshot;
		} catch ( \Throwable $e ) { return new WP_Error( 'amphp_torob_build_failed', 'Catalog snapshot build failed.', array( 'status' => 503 ) ); }
		finally { delete_option( $lock ); }
	}

	public static function torob_profile_result( $body, $snapshot ) {
		if ( ! is_array( $body ) || ! $body || ! is_array( $snapshot['items'] ?? null ) || ! is_array( $snapshot['orders'] ?? null ) ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid request.', array( 'status' => 400 ) ); }
		$allowed = array( 'page_urls', 'page_uniques', 'page', 'sort', 'cursor' );
		if ( array_diff( array_keys( $body ), $allowed ) ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid parameters.', array( 'status' => 400 ) ); }
		$items = $snapshot['items']; $list = array(); $current = 1; $next = null;
		$url_mode = array_key_exists( 'page_urls', $body ); $id_mode = array_key_exists( 'page_uniques', $body );
		if ( $url_mode || $id_mode ) {
			if ( $url_mode === $id_mode || count( $body ) !== 1 ) { return new WP_Error( 'amphp_torob_invalid', 'Choose one request mode.', array( 'status' => 400 ) ); }
			$values = $body[$url_mode ? 'page_urls' : 'page_uniques'];
			if ( ! is_array( $values ) || ! $values || count( $values ) > 1000 ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid lookup list.', array( 'status' => 400 ) ); }
			$wanted = array();
			foreach ( $values as $v ) { if ( ! is_string( $v ) || strlen( $v ) > 1500 ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid lookup.', array( 'status' => 400 ) ); } $wanted[$v] = true; }
			if ( $id_mode ) { foreach ( $wanted as $id => $_ ) { if ( isset( $items[$id] ) ) { $list[] = json_decode( $items[$id], true ); } } }
			else { foreach ( $items as $id => $item ) { if ( isset( $wanted[self::torob_profile_url( $id )] ) ) { $list[] = json_decode( $item, true ); } } }
			$total = count( $list ); $max = max( 1, (int) ceil( $total / 100 ) );
		} else {
			$sort = $body['sort'] ?? ''; if ( ! is_string( $sort ) || ! isset( $snapshot['orders'][$sort] ) ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid sort.', array( 'status' => 400 ) ); }
			$ids = $snapshot['orders'][$sort];
			if ( array_key_exists( 'page', $body ) ) {
				if ( count( $body ) !== 2 || ! is_int( $body['page'] ) || $body['page'] < 1 ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid page.', array( 'status' => 400 ) ); }
				$current = $body['page']; $total = count( $ids ); $max = max( 1, (int) ceil( $total / 100 ) );
				$selected = $current > $max ? array() : array_slice( $ids, ( $current - 1 ) * 100, 100 );
			} else {
				if ( $sort !== 'product_id_desc' || count( $body ) > 2 || ( array_key_exists( 'cursor', $body ) && ( ! is_string( $body['cursor'] ) || ! preg_match( '/^sp_[a-f0-9]{32}$/D', $body['cursor'] ) ) ) ) { return new WP_Error( 'amphp_torob_invalid', 'Invalid cursor.', array( 'status' => 400 ) ); }
				$current = null; $total = null; $max = null; $cursor = $body['cursor'] ?? ''; $selected = array();
				foreach ( $ids as $id ) { if ( $cursor !== '' && strcmp( $id, $cursor ) >= 0 ) continue; $selected[] = $id; if ( count( $selected ) > 100 ) break; }
				if ( count( $selected ) > 100 ) { array_pop( $selected ); $next = end( $selected ); }
			}
			foreach ( $selected as $id ) { if ( isset( $items[$id] ) ) { $list[] = json_decode( $items[$id], true ); } }
		}
		// JSON object, not an empty array, for required spec.
		foreach ( $list as &$item ) { if ( ! is_array( $item ) ) return new WP_Error( 'amphp_torob_corrupt', 'Catalog snapshot is invalid. Retry.', array( 'status' => 503 ) ); if ( empty( $item['spec'] ) ) $item['spec'] = (object) array(); } unset( $item );
		return array( 'api_version' => 'torob_api_v3', 'current_page' => $current, 'total' => $total, 'max_pages' => $max, 'next_cursor' => $next, 'products' => $list );
	}


	/** Render crawlable product metadata on the same React deep-link page. */
	public static function torob_print_product_schema( $p, $settings ) {
		if ( ! is_array( $p ) || empty( $p['stable_id'] ) ) return;
		$name = self::torob_text( $p['title'] ?? '', 500 ); if ( $name === '' ) return;
		$url = self::torob_profile_url( $p['stable_id'] );
		$desc = self::torob_text( ( $p['short_desc'] ?? '' ) ?: ( $p['description'] ?? '' ), 500 );
		$schema = array( '@context' => 'https://schema.org', '@type' => 'Product', 'name' => $name, 'url' => $url, 'sku' => $p['stable_id'] );
		if ( $desc !== '' ) $schema['description'] = $desc;
		if ( ! empty( $p['image'] ) && is_string( $p['image'] ) && preg_match( '~^https?://~i', $p['image'] ) ) $schema['image'] = $p['image'];
		$currency = strtolower( (string) ( $settings['currency_symbol'] ?? 'تومان' ) );
		$is_rial = $currency === 'irr' || $currency === 'rial' || strpos( $currency, 'ریال' ) !== false;
		$available = ! empty( $p['torob_in_stock'] ) && ! empty( $p['has_valid_source_price'] ) && (float) ( $p['price'] ?? 0 ) > 0;
		if ( ! empty( $p['has_valid_source_price'] ) && (float) ( $p['price'] ?? 0 ) > 0 ) {
			$schema['offers'] = array( '@type' => 'Offer', 'url' => $url, 'priceCurrency' => 'IRR', 'price' => (int) round( (float) $p['price'] * ( $is_rial ? 1 : 10 ) ), 'availability' => $available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' );
		}
		echo '<link rel="canonical" href="' . esc_url( $url ) . '">' . "\n";
		echo '<meta property="og:type" content="product"><meta property="og:title" content="' . esc_attr( $name ) . '">' . "\n";
		if ( $desc !== '' ) echo '<meta name="description" content="' . esc_attr( $desc ) . '">' . "\n";
		echo '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . '</script>' . "\n";
	}

	public static function torob_profile_rest( $request ) {
		$content_type = strtolower( (string) $request->get_header( 'content-type' ) );
		if ( ! preg_match( '~^application/json(?:\s*;|\s*$)~i', $content_type ) || strlen( (string) $request->get_body() ) > 1048576 ) { return new WP_REST_Response( array( 'error' => 'Expected JSON request.' ), 400 ); }
		$body = $request->get_json_params();
		// Reject malformed bodies before building the expensive catalog.
		if ( ! is_array( $body ) || ! $body ) { return new WP_REST_Response( array( 'error' => 'Invalid request.' ), 400 ); }
		$empty = array( 'items' => array(), 'orders' => array( 'date_added_desc' => array(), 'date_updated_desc' => array(), 'product_id_desc' => array() ) );
		$validation = self::torob_profile_result( $body, $empty );
		if ( is_wp_error( $validation ) ) { return new WP_REST_Response( array( 'error' => $validation->get_error_message() ), 400 ); }
		$snapshot = self::torob_profile_snapshot();
		if ( is_wp_error( $snapshot ) ) { return $snapshot; }
		$result = self::torob_profile_result( $body, $snapshot );
		if ( is_wp_error( $result ) ) { $error_data = $result->get_error_data(); return new WP_REST_Response( array( 'error' => $result->get_error_message() ), (int) ( $error_data['status'] ?? 500 ) ); }
		return $result;
	}

	public static function get_all_scraped_products() {
		$settings = self::get_settings();
		$source   = self::resolve_catalog_source( $settings );

		if ( $source === 'woocommerce' ) {
			return self::get_woocommerce_native_products();
		}

		$products = array();
		$seen     = array();

		$profiles_file = self::find_profiles_json_path();
		if ( $profiles_file !== '' ) {
			$json = @file_get_contents( $profiles_file );
			$data = @json_decode( (string) $json, true );
			if ( is_array( $data ) ) {
				// Choose the legacy-ID owner in storage order, as find_raw_scraped_product does.
				$legacy_owners = array();
				foreach ( $data as $owner_profile => $owner_data ) {
					foreach ( (array) ( $owner_data['products'] ?? array() ) as $owner_index => $owner_entry ) {
						$raw = is_array( $owner_entry ) && isset( $owner_entry[1] ) && is_array( $owner_entry[1] ) ? $owner_entry[1] : $owner_entry;
						if ( ! is_array( $raw ) ) { continue; }
						$title = trim( (string) ( $raw['title'] ?? $raw['name'] ?? '' ) );
						if ( $title === '' ) { continue; }
						$hash = md5( $title . (string) ( $raw['link'] ?? $raw['url'] ?? '' ) );
						if ( ! isset( $legacy_owners[ $hash ] ) ) {
							$legacy_owners[ $hash ] = array( (string) $owner_profile, (string) $owner_index );
						}
					}
				}
				foreach ( $data as $p_key => $p_item ) {
					if ( ! is_array( $p_item ) ) {
						continue;
					}
					$raw_prods = $p_item['products'] ?? array();
					if ( ! is_array( $raw_prods ) ) {
						continue;
					}
					// Keep each stored entry, even when order keys or products are duplicated.
					$order = $p_item['productsOrder'] ?? $p_item['products_order'] ?? array();
					$keys_by_order = self::profile_product_key_map( $raw_prods );
					$ordered_keys = array();
					$used = array();
					foreach ( is_array( $order ) ? $order : array() as $order_key ) {
						if ( ! is_scalar( $order_key ) ) { continue; }
						foreach ( $keys_by_order[ (string) $order_key ] ?? array() as $ek ) {
							if ( ! isset( $used[ $ek ] ) ) {
								$ordered_keys[] = $ek;
								$used[ $ek ] = true;
							}
						}
					}
					foreach ( $raw_prods as $ek => $unused ) {
						if ( ! isset( $used[ $ek ] ) ) { $ordered_keys[] = $ek; }
					}

					foreach ( $ordered_keys as $entry_key ) {
						$entry = $raw_prods[ $entry_key ];
						$prod = null;
						if ( is_array( $entry ) ) {
							if ( isset( $entry[1] ) && is_array( $entry[1] ) ) {
								$prod = $entry[1];
								if ( empty( $prod['key'] ) && isset( $entry[0] ) ) {
									$prod['key'] = (string) $entry[0];
								}
							} elseif ( isset( $entry['title'] ) || isset( $entry['name'] ) ) {
								$prod = $entry;
							}
						}
						if ( ! is_array( $prod ) ) {
							continue;
						}

						$title = trim( (string) ( $prod['title'] ?? $prod['name'] ?? '' ) );
						if ( '' === $title ) {
							continue;
						}

						$link = (string) ( $prod['link'] ?? $prod['url'] ?? '' );
						$hash = md5( $title . $link );
						/* key پایدار اگر باشد */
						$pkey = trim( (string) ( $prod['key'] ?? $prod['id'] ?? '' ) );
						// Profile-only shows every entry. Preserve legacy deduplication in merge mode.
						$uid = $pkey !== '' ? ( 'k:' . $pkey ) : ( 'h:' . $hash );
						if ( $source === 'merge' && ( isset( $seen[ $uid ] ) || isset( $seen[ 'h:' . $hash ] ) ) ) {
							continue;
						}
						// Keep the old ID for the first occurrence so existing links and carts still work.
						// Later identical records need a profile-scoped ID to stay independently addressable.
						$is_legacy_owner = ( $legacy_owners[ $hash ] ?? null ) === array( (string) $p_key, (string) $entry_key );
						$profile_id = $source === 'scraper' && ! $is_legacy_owner
							? self::profile_product_id( $p_key, $entry_key, $entry, $keys_by_order )
							: $hash;
						$seen[ $uid ] = true;
						$seen[ 'h:' . $hash ] = true;

						$price_calc = self::calculate_price( $prod, $settings );

						$img = $prod['image'] ?? $prod['img'] ?? '';
						$gallery = array();
						if ( ! empty( $prod['images'] ) && is_array( $prod['images'] ) ) {
							$gallery = $prod['images'];
							if ( empty( $img ) && ! empty( $gallery[0] ) ) {
								$img = $gallery[0];
							}
						} elseif ( ! empty( $prod['gallery'] ) && is_array( $prod['gallery'] ) ) {
							$gallery = $prod['gallery'];
							if ( empty( $img ) && ! empty( $gallery[0] ) ) {
								$img = $gallery[0];
							}
						} elseif ( ! empty( $img ) ) {
							$gallery[] = $img;
						}
						/* v13.3.14: drop Snapp/WC placeholders; prefer AI image */
						$_img_res = self::resolve_product_images( array_merge( $prod, array( 'image' => $img, 'gallery' => $gallery ) ) );
						$img = $_img_res['image'];
						$gallery = $_img_res['gallery'];

						$desc = $prod['long_desc'] ?? $prod['longDesc'] ?? $prod['description'] ?? $prod['desc'] ?? $prod['short_desc'] ?? $prod['shortDesc'] ?? '';
						$cat  = $prod['category'] ?? $prod['cat'] ?? 'عمومی';
						if ( is_array( $cat ) ) {
							$cat = (string) ( $cat['name'] ?? $cat[0] ?? 'عمومی' );
						}
						$cat = trim( (string) $cat );
						if ( $cat === '' ) {
							$cat = 'عمومی';
						}

						$in_stock = true;
						if ( array_key_exists( 'in_stock', $prod ) ) {
							$in_stock = (bool) $prod['in_stock'];
						} elseif ( isset( $prod['stock'] ) && is_numeric( $prod['stock'] ) ) {
							$in_stock = ( (int) $prod['stock'] ) > 0;
						} elseif ( ! empty( $prod['unavailable'] ) || ! empty( $prod['out_of_stock'] ) ) {
							$in_stock = false;
						}

						$products[] = array(
							'id'                  => $profile_id,
							'stable_id'           => self::profile_product_id( $p_key, $entry_key, $entry, $keys_by_order ),
							'has_valid_source_price' => $price_calc['has_valid_source_price'],
							'torob_in_stock'      => self::torob_profile_stock( $prod, $in_stock ),
							'created_ts'          => self::catalog_creation_timestamp( $prod ),
							'_catalog_seen_key'   => self::profile_product_id( $p_key, $entry_key, $entry, $keys_by_order ),
							'key'                 => $pkey,
							'title'               => $title,
							'has_price'           => $price_calc['has_price'],
							'original_price'      => $price_calc['original'],
							'price'               => $price_calc['adjusted'],
							'price_formatted'     => $price_calc['formatted'],
							'old_price'           => $price_calc['old_price'],
							'old_price_formatted' => $price_calc['formatted_old'],
							'has_discount'        => $price_calc['has_discount'],
							'discount_pct'        => $price_calc['discount_pct'],
							'image'               => $img,
							'gallery'             => $gallery,
							'category'            => $cat,
							'description'         => $desc,
							'short_desc'          => (string) ( $prod['short_desc'] ?? $prod['shortDesc'] ?? '' ),
							'in_stock'            => $in_stock,
							'profile_key'         => (string) $p_key,
							'variations_text'     => (string) ( $prod['variations_text'] ?? '' ),
							'variation_groups'    => is_array( $prod['variation_groups'] ?? null ) ? $prod['variation_groups'] : array(),
							'source'              => 'scraper',
							'source_label'        => 'اسکرپر',
						);
					}
				}
			}
		}

		$products = self::catalog_assign_first_seen( $products );

		// Also check scraper temp cache (woo_products_temp.json)
		$woo_temps = array(
			plugin_dir_path( __FILE__ ) . 'woo_products_temp.json',
			plugin_dir_path( __FILE__ ) . 'bsl_products.json',
		);
		foreach ( $source === 'merge' ? $woo_temps : array() as $woo_temp ) {
			if ( ! file_exists( $woo_temp ) ) {
				continue;
			}
			$json = @file_get_contents( $woo_temp );
			$data = @json_decode( (string) $json, true );
			if ( ! is_array( $data ) ) {
				continue;
			}
			foreach ( $data as $prod ) {
				if ( ! is_array( $prod ) ) {
					continue;
				}
				$title = trim( (string) ( $prod['title'] ?? $prod['name'] ?? '' ) );
				if ( '' === $title ) {
					continue;
				}
				$hash = md5( $title . ( $prod['link'] ?? $prod['url'] ?? '' ) );
				if ( isset( $seen[ 'h:' . $hash ] ) ) {
					continue;
				}
				$seen[ 'h:' . $hash ] = true;
				$price_calc = self::calculate_price( $prod, $settings );
				$img        = $prod['image'] ?? $prod['img'] ?? '';
				$gallery    = ! empty( $prod['images'] ) && is_array( $prod['images'] ) ? $prod['images'] : ( ! empty( $img ) ? array( $img ) : array() );
				$_img_res = self::resolve_product_images( array_merge( is_array( $prod ) ? $prod : array(), array( 'image' => $img, 'gallery' => $gallery ) ) );
				$img = $_img_res['image'];
				$gallery = $_img_res['gallery'];
				$products[] = array(
					'id'                  => $hash,
					'created_ts'          => self::catalog_creation_timestamp( $prod ),
					'title'               => $title,
					'has_price'           => $price_calc['has_price'],
					'original_price'      => $price_calc['original'],
					'price'               => $price_calc['adjusted'],
					'price_formatted'     => $price_calc['formatted'],
					'old_price'           => $price_calc['old_price'],
					'old_price_formatted' => $price_calc['formatted_old'],
					'has_discount'        => $price_calc['has_discount'],
					'discount_pct'        => $price_calc['discount_pct'],
					'image'               => $img,
					'gallery'             => $gallery,
					'category'            => (string) ( $prod['category'] ?? $prod['cat'] ?? 'عمومی' ),
					'description'         => (string) ( $prod['description'] ?? $prod['desc'] ?? '' ),
					'in_stock'            => true,
					'source'              => 'scraper',
					'source_label'        => 'اسکرپر',
				);
			}
		}

		/* v13.3.8: ادغام با ووکامرس یا fallback اگر اسکرپر خالی است */
		$need_woo = ( $source === 'merge' );
		if ( $need_woo ) {
			$woo_list = self::get_woocommerce_native_products();
			if ( ! empty( $woo_list ) ) {
				if ( $source === 'merge' ) {
					$prefer = sanitize_key( (string) ( $settings['catalog_merge_prefer'] ?? 'scraper' ) );
					if ( $prefer === 'woocommerce' ) {
						$products = self::merge_catalog_products( $woo_list, $products, 'woocommerce' );
					} elseif ( $prefer === 'keep_both' ) {
						$products = self::merge_catalog_products( $products, $woo_list, 'keep_both' );
					} else {
						$products = self::merge_catalog_products( $products, $woo_list, 'scraper' );
					}
				} elseif ( empty( $products ) ) {
					$products = $woo_list;
				}
			}
		}

		// Demo fallback only when truly empty (preview sandbox)
		if ( empty( $products ) && $source !== 'scraper' ) {
			$demo_items = array(
				array(
					'id'            => 'demo_1',
					'title'         => 'ساعت هوشمند اولترا پرو مدل Max-9 با صفحه نمایش AMOLED',
					'raw_price'     => 1450000,
					'old_price_raw' => 1950000,
					'image'         => 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
					'category'      => 'گجت‌های هوشمند',
					'description'   => 'دارای سنسورهای پایش سلامت، مکالمه بلوتوثی باکیفیت و ضد آب با استاندارد IP68.',
				),
				array(
					'id'            => 'demo_2',
					'title'         => 'هدفون بی‌سیم نویز کنسلینگ استریو مدل Studio Pro',
					'raw_price'     => 890000,
					'old_price_raw' => 1250000,
					'image'         => 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
					'category'      => 'لوازم صوتی',
					'description'   => 'کیفیت صدای Hi-Res، شارژدهی تا ۴۰ ساعت مداوم و بالشتک‌های فوق‌العاده راحت.',
				),
				array(
					'id'            => 'demo_3',
					'title'         => 'اسپیکر قابل حمل بلوتوثی ضدآب باس قدرتمند مدل Boom 3',
					'raw_price'     => 620000,
					'old_price_raw' => 850000,
					'image'         => 'https://images.unsplash.com/photo-1543512214-318c7553f230?w=600&auto=format&fit=crop&q=80',
					'category'      => 'لوازم صوتی',
					'description'   => 'صدای فراگیر ۳۶۰ درجه، باتری قدرتمند ۲۴ ساعته و مقاومت در برابر پاشش آب.',
				),
				array(
					'id'            => 'demo_4',
					'title'         => 'کوله پشتی مسافرتی ارگونومیک ضد سرقت با پورت شارژ USB',
					'raw_price'     => 480000,
					'old_price_raw' => 690000,
					'image'         => 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80',
					'category'      => 'مد و پوشاک',
					'description'   => 'جنس برزنتی ضد آب، محفظه اختصاصی لپ‌تاپ تا ۱۵.۶ اینچ و طراحی سبک و مقاوم.',
				),
				array(
					'id'            => 'demo_5',
					'title'         => 'دستگاه اسپرسوساز خانگی ۲۰ بار تمام استیل اتوماتیک',
					'raw_price'     => 3200000,
					'old_price_raw' => 4100000,
					'image'         => 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=600&auto=format&fit=crop&q=80',
					'category'      => 'لوازم خانگی',
					'description'   => 'پمپ فشار ۲۰ بار ایتالیایی، سیستم کاپوچینوساز سریع و فیلتر دولایه استیل.',
				),
				array(
					'id'            => 'demo_6',
					'title'         => 'کفش ورزشی راحتی مدل Air Cushion مخصوص پیاده‌روی و دویدن',
					'raw_price'     => 750000,
					'old_price_raw' => 980000,
					'image'         => 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
					'category'      => 'مد و پوشاک',
					'description'   => 'کفی طبی ضد شوک، بافت تنفس‌پذیر ژاکارد و انعطاف‌پذیری فوق‌العاده بالا.',
				),
			);

			foreach ( $demo_items as $d ) {
				$calc = self::calculate_price( array(
					'price'         => $d['raw_price'],
					'regular_price' => $d['old_price_raw'],
				), $settings );

				$products[] = array(
					'id'                  => $d['id'],
					'title'               => $d['title'],
					'has_price'           => $calc['has_price'],
					'original_price'      => $calc['original'],
					'price'               => $calc['adjusted'],
					'price_formatted'     => $calc['formatted'],
					'old_price'           => $calc['old_price'],
					'old_price_formatted' => $calc['formatted_old'],
					'has_discount'        => $calc['has_discount'],
					'discount_pct'        => $calc['discount_pct'],
					'image'               => $d['image'],
					'gallery'             => array( $d['image'] ),
					'category'            => $d['category'],
					'description'         => $d['description'],
					'in_stock'            => true,
				);
			}
		}

		return $products;
	}

	/** Transient key for live direct-sync product cards (admin UI). */
	const DIRECT_SYNC_PROGRESS_KEY = 'amphp_direct_sync_progress';

	/**
	 * Write live progress for admin product-card queue UI.
	 *
	 * @param array $data Progress payload.
	 */
	public static function set_direct_sync_progress( $data ) {
		set_transient( self::DIRECT_SYNC_PROGRESS_KEY, $data, 30 * MINUTE_IN_SECONDS );
	}

	/**
	 * Read live progress for admin product-card queue UI.
	 *
	 * @return array
	 */
	public static function get_direct_sync_progress() {
		$d = get_transient( self::DIRECT_SYNC_PROGRESS_KEY );
		return is_array( $d ) ? $d : array();
	}

	/**
	 * Sync scraped products into WooCommerce with per-product card details.
	 * Progress is stored so the admin UI can poll a live product queue.
	 *
	 * @return array
	 */
	public static function sync_to_woocommerce() {
		$settings = self::get_settings();
		$products = self::get_all_scraped_products();
		$created  = 0;
		$updated  = 0;
		$failed   = 0;
		$skipped  = 0;
		$cards    = array();
		$total    = is_array( $products ) ? count( $products ) : 0;
		$run_id   = 'ds_' . time() . '_' . wp_generate_password( 4, false );

		if ( empty( $products ) ) {
			$out = array(
				'ok'      => false,
				'message' => 'هیچ محصولی برای همگام‌سازی یافت نشد.',
				'created' => 0,
				'updated' => 0,
				'failed'  => 0,
				'skipped' => 0,
				'total'   => 0,
				'cards'   => array(),
				'run_id'  => $run_id,
			);
			self::set_direct_sync_progress( array_merge( $out, array(
				'running' => false,
				'done'    => true,
				'current' => 0,
			) ) );
			return $out;
		}

		self::set_direct_sync_progress( array(
			'ok'      => true,
			'running' => true,
			'done'    => false,
			'run_id'  => $run_id,
			'total'   => $total,
			'current' => 0,
			'created' => 0,
			'updated' => 0,
			'failed'  => 0,
			'skipped' => 0,
			'cards'   => array(),
			'message' => 'شروع همگام‌سازی مستقیم…',
			'via'     => 'direct',
			'ts'      => time(),
		) );

		$i = 0;
		foreach ( $products as $p ) {
			$i++;
			$title = isset( $p['title'] ) ? (string) $p['title'] : '';
			$img   = isset( $p['image'] ) ? (string) $p['image'] : '';
			$price = isset( $p['price'] ) ? $p['price'] : 0;
			$orig  = isset( $p['original_price'] ) ? $p['original_price'] : 0;
			$cat   = isset( $p['category'] ) ? (string) $p['category'] : '';
			$key   = isset( $p['key'] ) ? (string) $p['key'] : (string) $i;
			$desc  = isset( $p['description'] ) ? (string) $p['description'] : '';

			$card = array(
				'key'      => $key,
				'title'    => $title,
				'image'    => $img,
				'price'    => $price,
				'category' => $cat,
				'status'   => 'pending',
				'detail'   => '',
				'woo_id'   => 0,
				'via'      => 'direct',
				'at'       => time(),
			);

			if ( $title === '' ) {
				$skipped++;
				$card['status'] = 'skipped';
				$card['detail'] = 'عنوان خالی';
				$cards[] = $card;
				self::set_direct_sync_progress( array(
					'ok' => true, 'running' => true, 'done' => false, 'run_id' => $run_id,
					'total' => $total, 'current' => $i,
					'created' => $created, 'updated' => $updated, 'failed' => $failed, 'skipped' => $skipped,
					'cards' => $cards, 'last_title' => $title, 'via' => 'direct', 'ts' => time(),
					'message' => 'رد شد: بدون عنوان',
				) );
				continue;
			}

			$existing_id = 0;
			$existing = get_posts( array(
				'post_type'   => 'product',
				'title'       => $title,
				'post_status' => 'any',
				'numberposts' => 1,
			) );
			if ( ! empty( $existing ) && isset( $existing[0]->ID ) ) {
				$existing_id = (int) $existing[0]->ID;
			}

			$post_data = array(
				'post_title'   => $title,
				'post_content' => $desc,
				'post_status'  => 'publish',
				'post_type'    => 'product',
			);

			$product_id = 0;
			$action_lbl = 'created';
			try {
				if ( $existing_id > 0 ) {
					$post_data['ID'] = $existing_id;
					$product_id      = wp_update_post( $post_data, true );
					$action_lbl = 'updated';
				} else {
					$product_id = wp_insert_post( $post_data, true );
					$action_lbl = 'created';
				}
			} catch ( Exception $ex ) {
				$product_id = new WP_Error( 'exception', $ex->getMessage() );
			}

			if ( is_wp_error( $product_id ) || ! $product_id ) {
				$failed++;
				$card['status'] = 'failed';
				$card['detail'] = is_wp_error( $product_id )
					? $product_id->get_error_message()
					: 'درج ناموفق';
				$cards[] = $card;
			} else {
				$product_id = (int) $product_id;
				update_post_meta( $product_id, '_price', $price );
				update_post_meta( $product_id, '_regular_price', $price );
				if ( is_numeric( $orig ) && is_numeric( $price ) && (float) $orig > (float) $price ) {
					update_post_meta( $product_id, '_sale_price', $price );
					update_post_meta( $product_id, '_regular_price', $orig );
				}
				update_post_meta( $product_id, '_manage_stock', 'no' );
				update_post_meta( $product_id, '_stock_status', 'instock' );
				update_post_meta( $product_id, '_amphp_sync_via', 'direct' );
				if ( isset( $p['id'] ) && ( $p['source'] ?? '' ) === 'scraper' ) { update_post_meta( $product_id, '_amphp_profile_id', (string) $p['id'] ); }
				update_post_meta( $product_id, '_amphp_sync_at', time() );
				if ( $cat !== '' ) {
					wp_set_object_terms( $product_id, $cat, 'product_cat' );
				}
				if ( $img !== '' && ! has_post_thumbnail( $product_id ) ) {
					self::attach_external_image( $product_id, $img, $title );
				}
				if ( $action_lbl === 'updated' ) {
					$updated++;
					$card['status'] = 'updated';
					$card['detail'] = 'به‌روزرسانی شد';
				} else {
					$created++;
					$card['status'] = 'created';
					$card['detail'] = 'ایجاد شد';
				}
				$card['woo_id'] = $product_id;
				$cards[] = $card;
			}

			/* keep last ~80 cards in live payload for UI weight */
			$live_cards = count( $cards ) > 80 ? array_slice( $cards, -80 ) : $cards;
			self::set_direct_sync_progress( array(
				'ok'         => true,
				'running'    => true,
				'done'       => false,
				'run_id'     => $run_id,
				'total'      => $total,
				'current'    => $i,
				'created'    => $created,
				'updated'    => $updated,
				'failed'     => $failed,
				'skipped'    => $skipped,
				'cards'      => $live_cards,
				'last_title' => $title,
				'last_status'=> $card['status'],
				'via'        => 'direct',
				'ts'         => time(),
				'message'    => $i . '/' . $total . ' — ' . $title,
			) );

			/* allow long runs on shared hosts */
			if ( $i % 5 === 0 && function_exists( 'wp_cache_flush' ) ) {
				/* no-op keep-alive */
			}
		}

		$out = array(
			'ok'      => true,
			'message' => sprintf(
				'همگام‌سازی مستقیم تمام شد: %d جدید، %d آپدیت، %d خطا از %d کالا.',
				$created, $updated, $failed, $total
			),
			'created' => $created,
			'updated' => $updated,
			'failed'  => $failed,
			'skipped' => $skipped,
			'total'   => $total,
			'cards'   => $cards,
			'run_id'  => $run_id,
			'via'     => 'direct',
		);
		self::set_direct_sync_progress( array_merge( $out, array(
			'running' => false,
			'done'    => true,
			'current' => $total,
			'ts'      => time(),
		) ) );
		return $out;
	}

	/**
	 * Attach external image URL as featured thumbnail.
	 *
	 * @param int    $post_id
	 * @param string $image_url
	 * @param string $title
	 */

	/**
	 * Detect empty / placeholder / SnappShop generic card images.
	 *
	 * @param string $url
	 * @return bool true = bad/missing image that should be replaced
	 */
	public static function is_bad_product_image( $url ) {
		$url = trim( (string) $url );
		if ( $url === '' ) {
			return true;
		}
		$u = strtolower( $url );
		// data URIs / tiny placeholders
		if ( strpos( $u, 'data:image' ) === 0 ) {
			return true;
		}
		$bad_bits = array(
			'placeholder', 'no-image', 'no_image', 'noimage', 'default-image', 'default_image',
			'woocommerce-placeholder', 'wc-placeholder', 'blank.gif', 'blank.png', '1x1.',
			'spacer', 'transparent', 'loading.gif', 'lazy-load', 'image-not-found',
			'coming-soon', 'product-default', 'default-product', 'missing-image',
			// SnappShop generic / fallback card art patterns
			'snappshop', 'snapp.ir/static', 'snappshop.ir/static', 'snappshop.ir/assets',
			'cdn.snapp', 'snappfood', 'default_product', 'product_placeholder',
			'img-placeholder', 'empty-product', 'without-image', 'without_image',
			'/static/images/product', '/images/default', 'dummy-image', 'dummy_image',
		);
		foreach ( $bad_bits as $b ) {
			if ( strpos( $u, $b ) !== false ) {
				return true;
			}
		}
		// very short path often = sprite/icon
		$path = (string) ( parse_url( $url, PHP_URL_PATH ) ?: '' );
		if ( $path !== '' && preg_match( '/\.(svg|gif)$/i', $path ) && strlen( basename( $path ) ) < 12 ) {
			return true;
		}
		return false;
	}

	/**
	 * Normalize image URL for storefront: drop placeholders, prefer AI/meta overrides.
	 *
	 * @param array $p product row
	 * @param int   $wc_id optional WC product id
	 * @return array { image, gallery, image_source }
	 */
	public static function resolve_product_images( $p, $wc_id = 0 ) {
		$p = is_array( $p ) ? $p : array();
		$img = trim( (string) ( $p['image'] ?? $p['img'] ?? '' ) );
		$gallery = array();
		if ( ! empty( $p['gallery'] ) && is_array( $p['gallery'] ) ) {
			$gallery = $p['gallery'];
		} elseif ( ! empty( $p['images'] ) && is_array( $p['images'] ) ) {
			$gallery = $p['images'];
		}
		$source = 'original';

		// WC / meta overrides
		if ( $wc_id > 0 ) {
			$ai_url = get_post_meta( $wc_id, '_amphp_ai_image_url', true );
			if ( $ai_url && ! self::is_bad_product_image( $ai_url ) ) {
				$img = (string) $ai_url;
				$source = 'ai_meta';
			} else {
				$scraped = get_post_meta( $wc_id, '_scraped_image_url', true );
				if ( ( $img === '' || self::is_bad_product_image( $img ) ) && $scraped && ! self::is_bad_product_image( $scraped ) ) {
					$img = (string) $scraped;
					$source = 'scraped_meta';
				}
			}
		}
		// product-level AI fields from scraper JSON
		foreach ( array( 'ai_image', 'ai_image_url', 'enriched_image' ) as $k ) {
			if ( ! empty( $p[ $k ] ) && ! self::is_bad_product_image( $p[ $k ] ) ) {
				$img = (string) $p[ $k ];
				$source = 'ai_json';
				break;
			}
		}

		if ( self::is_bad_product_image( $img ) ) {
			$img = '';
			$source = 'none';
		}
		// clean gallery
		$clean_g = array();
		foreach ( (array) $gallery as $g ) {
			$g = trim( (string) $g );
			if ( $g !== '' && ! self::is_bad_product_image( $g ) ) {
				$clean_g[] = $g;
			}
		}
		if ( $img !== '' && ! in_array( $img, $clean_g, true ) ) {
			array_unshift( $clean_g, $img );
		} elseif ( $img === '' && ! empty( $clean_g ) ) {
			$img = $clean_g[0];
			$source = $source === 'none' ? 'gallery' : $source;
		}
		return array(
			'image'        => $img,
			'gallery'      => array_values( array_unique( $clean_g ) ),
			'image_source' => $source,
			'needs_image'  => ( $img === '' ),
		);
	}

	/**
	 * Schedule AI image enrichment cron when enabled.
	 */
	public static function sync_ai_image_cron_schedule( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}
		$hook = 'scraper_ai_image_enrich_cron';
		$enabled = ! empty( $settings['enable_ai_product_images'] );
		if ( ! $enabled ) {
			$ts = wp_next_scheduled( $hook );
			if ( $ts ) {
				wp_unschedule_event( $ts, $hook );
			}
			return;
		}
		if ( ! wp_next_scheduled( $hook ) ) {
			wp_schedule_event( time() + 120, 'every_30_mins', $hook );
		}
	}

	/**
	 * WP-Cron: enrich a batch of products missing real images.
	 */
	public static function cron_ai_enrich_product_images() {
		$settings = self::get_settings();
		if ( empty( $settings['enable_ai_product_images'] ) ) {
			return;
		}
		$batch = max( 1, min( 20, intval( $settings['ai_image_batch_size'] ?? 8 ) ) );
		try {
			self::enrich_missing_product_images( $batch, false );
		} catch ( \Throwable $e ) {
			error_log( 'AMPHP ai image cron: ' . $e->getMessage() );
		}
	}

	/**
	 * Admin AJAX: run batch image enrichment now.
	 */
	public static function ajax_ai_enrich_images() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 180 );
		}
		$limit = max( 1, min( 30, intval( $_POST['limit'] ?? 8 ) ) );
		$result = self::enrich_missing_product_images( $limit, true );
		if ( ! empty( $result['ok'] ) ) {
			wp_send_json_success( $result );
		}
		wp_send_json_error( $result );
	}

	/**
	 * Storefront/public AJAX: enrich one product image on demand (when card has no image).
	 */
	public static function ajax_ai_enrich_one_image() {
		// Soft auth — cart nonce if present, else allow with rate limit
		$nonce = isset( $_REQUEST['nonce'] ) ? (string) $_REQUEST['nonce'] : '';
		if ( $nonce && ! wp_verify_nonce( $nonce, 'scraper_cart_nonce' ) && ! wp_verify_nonce( $nonce, 'scraper_shop_admin_nonce' ) ) {
			// still allow but rate-limit
		}
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '0';
		$rl = 'amphp_img_rl_' . md5( $ip );
		$hits = intval( get_transient( $rl ) );
		if ( $hits > 40 ) {
			wp_send_json_error( 'محدودیت درخواست. کمی بعد دوباره تلاش کنید.' );
		}
		set_transient( $rl, $hits + 1, 10 * MINUTE_IN_SECONDS );

		$settings = self::get_settings();
		if ( empty( $settings['enable_ai_product_images'] ) ) {
			wp_send_json_error( 'غنی‌سازی تصویر غیرفعال است.' );
		}
		$id = sanitize_text_field( wp_unslash( $_REQUEST['id'] ?? $_REQUEST['product_id'] ?? '' ) );
		$title = sanitize_text_field( wp_unslash( $_REQUEST['title'] ?? '' ) );
		$category = sanitize_text_field( wp_unslash( $_REQUEST['category'] ?? '' ) );
		if ( $id === '' && $title === '' ) {
			wp_send_json_error( 'شناسه یا عنوان لازم است.' );
		}
		$one = self::enrich_single_product_image( array(
			'id'       => $id,
			'title'    => $title,
			'category' => $category,
			'image'    => sanitize_text_field( wp_unslash( $_REQUEST['image'] ?? '' ) ),
		) );
		if ( ! empty( $one['ok'] ) && ! empty( $one['image'] ) ) {
			wp_send_json_success( $one );
		}
		wp_send_json_error( $one['message'] ?? 'تصویری یافت نشد.' );
	}

	/**
	 * Find products that need images and enrich up to $limit.
	 *
	 * @param int  $limit
	 * @param bool $verbose
	 * @return array
	 */
	public static function enrich_missing_product_images( $limit = 8, $verbose = false ) {
		$settings = self::get_settings();
		$done = 0;
		$failed = 0;
		$skipped = 0;
		$cards = array();
		$seen = array();

		// 1) WooCommerce products without real featured image
		if ( function_exists( 'wc_get_products' ) ) {
			$wc_prods = wc_get_products( array(
				'limit'  => 80,
				'status' => 'publish',
				'orderby'=> 'date',
				'order'  => 'DESC',
			) );
			foreach ( (array) $wc_prods as $wp_prod ) {
				if ( $done >= $limit ) {
					break;
				}
				if ( ! is_object( $wp_prod ) ) {
					continue;
				}
				$pid = (int) $wp_prod->get_id();
				// already AI-enriched recently?
				if ( get_post_meta( $pid, '_amphp_ai_image_url', true ) && ! self::is_bad_product_image( get_post_meta( $pid, '_amphp_ai_image_url', true ) ) ) {
					$skipped++;
					continue;
				}
				$img_id = $wp_prod->get_image_id();
				$img_url = $img_id ? wp_get_attachment_image_url( $img_id, 'full' ) : '';
				$scraped = get_post_meta( $pid, '_scraped_image_url', true );
				$candidate = $img_url ?: $scraped;
				if ( ! self::is_bad_product_image( $candidate ) ) {
					$skipped++;
					continue;
				}
				// skip if we failed recently
				$fail_at = intval( get_post_meta( $pid, '_amphp_ai_image_fail_at', true ) );
				if ( $fail_at && ( time() - $fail_at ) < DAY_IN_SECONDS ) {
					$skipped++;
					continue;
				}
				$res = self::enrich_single_product_image( array(
					'id'       => 'wc_' . $pid,
					'wc_id'    => $pid,
					'title'    => $wp_prod->get_name(),
					'category' => '',
					'image'    => $candidate,
				) );
				$cards[] = $res;
				if ( ! empty( $res['ok'] ) ) {
					$done++;
				} else {
					$failed++;
				}
				$seen[ 'wc_' . $pid ] = true;
			}
		}

		// 2) Scraped catalog products
		if ( $done < $limit ) {
			$products = self::get_all_scraped_products();
			foreach ( (array) $products as $prod ) {
				if ( $done >= $limit ) {
					break;
				}
				if ( ! is_array( $prod ) ) {
					continue;
				}
				$pid = (string) ( $prod['id'] ?? '' );
				if ( $pid === '' || isset( $seen[ $pid ] ) ) {
					continue;
				}
				$resolved = self::resolve_product_images( $prod );
				if ( empty( $resolved['needs_image'] ) ) {
					$skipped++;
					continue;
				}
				// skip if already has ai_image in raw
				if ( ! empty( $prod['ai_image'] ) && ! self::is_bad_product_image( $prod['ai_image'] ) ) {
					$skipped++;
					continue;
				}
				$res = self::enrich_single_product_image( array(
					'id'       => $pid,
					'title'    => (string) ( $prod['title'] ?? '' ),
					'category' => (string) ( $prod['category'] ?? '' ),
					'image'    => (string) ( $prod['image'] ?? '' ),
				) );
				$cards[] = $res;
				if ( ! empty( $res['ok'] ) ) {
					$done++;
				} else {
					$failed++;
				}
			}
		}

		$msg = sprintf( 'غنی‌سازی تصویر: %d موفق، %d ناموفق، %d ردشده.', $done, $failed, $skipped );
		update_option( 'amphp_ai_image_last_run', array(
			'at'      => time(),
			'done'    => $done,
			'failed'  => $failed,
			'skipped' => $skipped,
			'message' => $msg,
		), false );
		// bust product cache
		delete_transient( 'scraper_shop_cached_products' );
		return array(
			'ok'      => true,
			'message' => $msg,
			'done'    => $done,
			'failed'  => $failed,
			'skipped' => $skipped,
			'cards'   => $verbose ? $cards : array_slice( $cards, -15 ),
		);
	}

	/**
	 * Enrich one product: web image search → optional AI pick → sideload / meta.
	 *
	 * @param array $ctx id, title, category, image, wc_id
	 * @return array
	 */
	public static function enrich_single_product_image( $ctx ) {
		$settings = self::get_settings();
		$title = trim( (string) ( $ctx['title'] ?? '' ) );
		$id    = (string) ( $ctx['id'] ?? '' );
		$cat   = trim( (string) ( $ctx['category'] ?? '' ) );
		$wc_id = intval( $ctx['wc_id'] ?? 0 );
		if ( $wc_id <= 0 && preg_match( '/^wc_(\d+)$/', $id, $m ) ) {
			$wc_id = (int) $m[1];
		}
		if ( $title === '' && $wc_id > 0 && function_exists( 'wc_get_product' ) ) {
			$pr = wc_get_product( $wc_id );
			if ( $pr ) {
				$title = $pr->get_name();
			}
		}
		if ( $title === '' ) {
			return array( 'ok' => false, 'id' => $id, 'message' => 'عنوان خالی است.' );
		}

		// Collect candidate image URLs from the open web
		$candidates = self::search_product_image_candidates( $title, $cat );
		if ( empty( $candidates ) ) {
			if ( $wc_id > 0 ) {
				update_post_meta( $wc_id, '_amphp_ai_image_fail_at', time() );
			}
			return array( 'ok' => false, 'id' => $id, 'title' => $title, 'message' => 'نتیجه‌ای در جستجوی وب یافت نشد.' );
		}

		// Ask AI to pick best URL when available
		$best = self::ai_pick_best_product_image( $title, $cat, $candidates, $settings );
		if ( ! $best || self::is_bad_product_image( $best ) ) {
			$best = $candidates[0]['url'] ?? '';
		}
		if ( ! $best || self::is_bad_product_image( $best ) ) {
			return array( 'ok' => false, 'id' => $id, 'title' => $title, 'message' => 'URL معتبر انتخاب نشد.' );
		}

		// Validate remote image is reachable and looks like an image
		$best = self::normalize_image_url( $best );
		if ( ! self::remote_url_looks_like_image( $best ) ) {
			// try next candidates
			$picked = '';
			foreach ( $candidates as $c ) {
				$u = self::normalize_image_url( $c['url'] ?? '' );
				if ( $u && self::remote_url_looks_like_image( $u ) ) {
					$picked = $u;
					break;
				}
			}
			$best = $picked;
		}
		if ( ! $best ) {
			return array( 'ok' => false, 'id' => $id, 'title' => $title, 'message' => 'دانلود/اعتبارسنجی تصویر ناموفق.' );
		}

		$final_url = $best;
		$sideloaded = false;
		$att_id = 0;

		// Persist on WooCommerce product
		if ( $wc_id > 0 ) {
			update_post_meta( $wc_id, '_amphp_ai_image_url', esc_url_raw( $best ) );
			update_post_meta( $wc_id, '_scraped_image_url', esc_url_raw( $best ) );
			update_post_meta( $wc_id, '_amphp_ai_image_at', time() );
			delete_post_meta( $wc_id, '_amphp_ai_image_fail_at' );

			if ( ! empty( $settings['ai_image_sideload'] ) ) {
				try {
					self::attach_external_image( $wc_id, $best, $title );
					if ( has_post_thumbnail( $wc_id ) ) {
						$att_id = (int) get_post_thumbnail_id( $wc_id );
						$local = wp_get_attachment_image_url( $att_id, 'full' );
						if ( $local ) {
							$final_url = $local;
							$sideloaded = true;
							update_post_meta( $wc_id, '_amphp_ai_image_url', esc_url_raw( $local ) );
						}
					}
				} catch ( \Throwable $e ) {
					// keep remote URL
				}
			}
		}

		// Persist into scraped JSON if this is a scraper product
		try {
			$loc = self::find_raw_scraped_product( $id );
			if ( $loc && is_array( $loc['raw'] ?? null ) ) {
				$raw = $loc['raw'];
				$raw['ai_image'] = $best;
				$raw['ai_image_url'] = $best;
				$raw['image'] = $best;
				if ( empty( $raw['images'] ) || ! is_array( $raw['images'] ) ) {
					$raw['images'] = array( $best );
				} else {
					array_unshift( $raw['images'], $best );
					$raw['images'] = array_values( array_unique( $raw['images'] ) );
				}
				$raw['image_source'] = 'ai_web';
				self::save_raw_scraped_product( $loc, $raw );
			}
		} catch ( \Throwable $e ) {
			// ignore JSON write errors
		}

		delete_transient( 'scraper_shop_cached_products' );

		return array(
			'ok'         => true,
			'id'         => $id,
			'wc_id'      => $wc_id,
			'title'      => $title,
			'image'      => $final_url,
			'remote'     => $best,
			'sideloaded' => $sideloaded,
			'attachment' => $att_id,
			'candidates' => count( $candidates ),
			'message'    => 'تصویر پیدا و ذخیره شد.',
		);
	}

	/**
	 * @param string $url
	 * @return string
	 */
	public static function normalize_image_url( $url ) {
		$url = trim( html_entity_decode( (string) $url ) );
		if ( $url === '' ) {
			return '';
		}
		// protocol-relative
		if ( strpos( $url, '//' ) === 0 ) {
			$url = 'https:' . $url;
		}
		if ( ! preg_match( '#^https?://#i', $url ) ) {
			return '';
		}
		// strip tracking junk
		$url = preg_replace( '/#.*$/', '', $url );
		return esc_url_raw( $url );
	}

	/**
	 * HEAD/GET check that URL returns an image content-type.
	 */
	public static function remote_url_looks_like_image( $url ) {
		$url = self::normalize_image_url( $url );
		if ( $url === '' || self::is_bad_product_image( $url ) ) {
			return false;
		}
		// Fast path: extension
		$path = (string) ( parse_url( $url, PHP_URL_PATH ) ?: '' );
		if ( preg_match( '/\.(jpe?g|png|webp|gif)(\?|$)/i', $path ) ) {
			// still lightly probe
		}
		$res = wp_remote_head( $url, array(
			'timeout'     => 6,
			'redirection' => 3,
			'user-agent'  => 'Mozilla/5.0 (compatible; AMPHP-ImageBot/13.3; +https://wordpress.org)',
			'headers'     => array( 'Accept' => 'image/*,*/*' ),
		) );
		if ( is_wp_error( $res ) ) {
			// try GET range
			$res = wp_remote_get( $url, array(
				'timeout'     => 8,
				'redirection' => 3,
				'user-agent'  => 'Mozilla/5.0 (compatible; AMPHP-ImageBot/13.3)',
				'headers'     => array( 'Range' => 'bytes=0-2048', 'Accept' => 'image/*' ),
			) );
			if ( is_wp_error( $res ) ) {
				return false;
			}
		}
		$code = wp_remote_retrieve_response_code( $res );
		if ( $code >= 400 ) {
			return false;
		}
		$ct = strtolower( (string) wp_remote_retrieve_header( $res, 'content-type' ) );
		if ( $ct && strpos( $ct, 'image/' ) === false && strpos( $ct, 'octet-stream' ) === false ) {
			// allow empty content-type with image extension
			if ( ! preg_match( '/\.(jpe?g|png|webp|gif)(\?|$)/i', $path ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Search the open web for product image candidates (DuckDuckGo / Bing / Wikimedia).
	 *
	 * @return array list of [url, title, source]
	 */
	public static function search_product_image_candidates( $title, $category = '' ) {
		$settings = self::get_settings();
		$q = trim( $title . ( $category ? ' ' . $category : '' ) . ' محصول' );
		$q = preg_replace( '/\s+/u', ' ', $q );
		$out = array();
		$seen = array();

		$add = function( $url, $t = '', $src = '' ) use ( &$out, &$seen ) {
			$url = self::normalize_image_url( $url );
			if ( $url === '' || self::is_bad_product_image( $url ) ) {
				return;
			}
			if ( preg_match( '/\/(logo|icon|sprite|favicon|banner)s?\//i', $url ) ) {
				return;
			}
			// skip google UI chrome
			if ( preg_match( '/google\.(com|co\.[a-z]+)\/(logos|images\/branding|gen_204)/i', $url ) ) {
				return;
			}
			$key = md5( preg_replace( '/\?.*$/', '', $url ) );
			if ( isset( $seen[ $key ] ) ) {
				return;
			}
			$seen[ $key ] = true;
			$out[] = array( 'url' => $url, 'title' => (string) $t, 'source' => (string) $src );
		};

		$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
		$hdrs = array(
			'Accept-Language' => 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
			'Accept'          => 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Cache-Control'   => 'no-cache',
		);

		/* ---- 1) Google Custom Search API (optional keys) — most reliable ---- */
		$gkey = trim( (string) ( $settings['google_cse_api_key'] ?? '' ) );
		$gcx  = trim( (string) ( $settings['google_cse_cx'] ?? '' ) );
		if ( $gkey !== '' && $gcx !== '' ) {
			try {
				$api = add_query_arg( array(
					'key'        => $gkey,
					'cx'         => $gcx,
					'q'          => $q,
					'searchType' => 'image',
					'num'        => 10,
					'safe'       => 'active',
					'imgType'    => 'photo',
					'hl'         => 'fa',
				), 'https://www.googleapis.com/customsearch/v1' );
				$res = wp_remote_get( $api, array(
					'timeout'    => 12,
					'user-agent' => 'AMPHP-Storefront/13.3',
					'headers'    => array( 'Accept' => 'application/json' ),
				) );
				if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
					$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
					foreach ( (array) ( $data['items'] ?? array() ) as $item ) {
						$u = $item['link'] ?? '';
						if ( empty( $u ) && ! empty( $item['image']['contextLink'] ) ) {
							/* prefer direct image link */
						}
						$add( $u, $item['title'] ?? $title, 'google_cse' );
						if ( ! empty( $item['image']['thumbnailLink'] ) ) {
							/* thumb only as last resort — skip small thumbs */
						}
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* ---- 2) Google Images HTML (tbm=isch) — no API key ---- */
		if ( ! empty( $settings['enable_google_image_search'] ) && count( $out ) < 8 ) {
			try {
				$gurl = 'https://www.google.com/search?' . http_build_query( array(
					'tbm' => 'isch',
					'q'   => $q,
					'hl'  => 'fa',
					'safe'=> 'active',
					'ibs' => 'ft',
				) );
				$res = wp_remote_get( $gurl, array(
					'timeout'     => 14,
					'redirection' => 3,
					'user-agent'  => $ua,
					'headers'     => $hdrs,
				) );
				if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
					$body = (string) wp_remote_retrieve_body( $res );
					self::parse_google_images_html( $body, $add, $title );
				}
				/* fallback endpoint sometimes used by clients */
				if ( count( $out ) < 3 ) {
					$gurl2 = 'https://www.google.com/search?' . http_build_query( array(
						'tbm'  => 'isch',
						'q'    => $q,
						'hl'   => 'en',
						'safe' => 'active',
						'tbs'  => 'itp:photo,isz:m',
					) );
					$res2 = wp_remote_get( $gurl2, array(
						'timeout'    => 12,
						'user-agent' => $ua,
						'headers'    => $hdrs,
					) );
					if ( ! is_wp_error( $res2 ) && wp_remote_retrieve_response_code( $res2 ) < 400 ) {
						self::parse_google_images_html( (string) wp_remote_retrieve_body( $res2 ), $add, $title );
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* ---- 3) Bing image search HTML ---- */
		if ( count( $out ) < 6 ) {
			try {
				$bing_url = 'https://www.bing.com/images/search?q=' . rawurlencode( $q ) . '&qft=+filterui:photo-photo&form=IRFLTR';
				$res = wp_remote_get( $bing_url, array(
					'timeout'    => 12,
					'user-agent' => $ua,
					'headers'    => $hdrs,
				) );
				if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
					$body = (string) wp_remote_retrieve_body( $res );
					if ( preg_match_all( '/murl&quot;:&quot;(https?:\\\\\/\\\\\/[^&]+)&quot;/', $body, $mm ) ) {
						foreach ( $mm[1] as $raw ) {
							$u = str_replace( array( '\\/', '\\u0026' ), array( '/', '&' ), $raw );
							$u = html_entity_decode( urldecode( $u ) );
							$add( $u, $title, 'bing' );
							if ( count( $out ) >= 14 ) {
								break;
							}
						}
					}
					if ( count( $out ) < 8 && preg_match_all( '/"murl":"(https?:\\\\\/\\\\\/[^"]+)"/', $body, $mm2 ) ) {
						foreach ( $mm2[1] as $raw ) {
							$u = str_replace( '\\/', '/', stripcslashes( $raw ) );
							$add( $u, $title, 'bing' );
							if ( count( $out ) >= 14 ) {
								break;
							}
						}
					}
					if ( count( $out ) < 8 && preg_match_all( '/mediaurl=([^&"]+)/i', $body, $mm3 ) ) {
						foreach ( $mm3[1] as $enc ) {
							$add( urldecode( $enc ), $title, 'bing' );
							if ( count( $out ) >= 14 ) {
								break;
							}
						}
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* ---- 4) DuckDuckGo HTML ---- */
		if ( count( $out ) < 4 ) {
			try {
				$ddg_url = 'https://duckduckgo.com/html/?q=' . rawurlencode( $q . ' filetype:jpg' );
				$res = wp_remote_get( $ddg_url, array(
					'timeout'    => 10,
					'user-agent' => 'Mozilla/5.0 (compatible; AMPHP/13.3)',
				) );
				if ( ! is_wp_error( $res ) ) {
					$body = (string) wp_remote_retrieve_body( $res );
					if ( preg_match_all( '/uddg=([^&"]+)/', $body, $mm ) ) {
						foreach ( $mm[1] as $enc ) {
							$u = urldecode( $enc );
							if ( preg_match( '/\.(jpe?g|png|webp)/i', $u ) ) {
								$add( $u, $title, 'ddg' );
							}
							if ( count( $out ) >= 12 ) {
								break;
							}
						}
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* ---- 5) Wikimedia Commons ---- */
		if ( count( $out ) < 6 ) {
			try {
				$api = add_query_arg( array(
					'action'       => 'query',
					'format'       => 'json',
					'generator'    => 'search',
					'gsrsearch'    => $title,
					'gsrlimit'     => 8,
					'gsrnamespace' => 6,
					'prop'         => 'imageinfo',
					'iiprop'       => 'url|mime|size',
					'iiurlwidth'   => 800,
				), 'https://commons.wikimedia.org/w/api.php' );
				$res = wp_remote_get( $api, array( 'timeout' => 10, 'user-agent' => 'AMPHP-Storefront/13.3' ) );
				if ( ! is_wp_error( $res ) ) {
					$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
					foreach ( (array) ( $data['query']['pages'] ?? array() ) as $pg ) {
						$info = $pg['imageinfo'][0] ?? null;
						if ( ! $info ) {
							continue;
						}
						$mime = (string) ( $info['mime'] ?? '' );
						if ( $mime && strpos( $mime, 'image/' ) !== 0 ) {
							continue;
						}
						$add( $info['thumburl'] ?? $info['url'] ?? '', $pg['title'] ?? $title, 'wikimedia' );
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* ---- 6) Openverse ---- */
		if ( count( $out ) < 8 ) {
			try {
				$ov = add_query_arg( array(
					'q'         => $title,
					'page_size' => 8,
					'license'   => 'commercial',
				), 'https://api.openverse.org/v1/images/' );
				$res = wp_remote_get( $ov, array(
					'timeout'    => 10,
					'user-agent' => 'AMPHP-Storefront/13.3',
					'headers'    => array( 'Accept' => 'application/json' ),
				) );
				if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
					$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
					foreach ( (array) ( $data['results'] ?? array() ) as $row ) {
						$add( $row['url'] ?? $row['thumbnail'] ?? '', $row['title'] ?? $title, 'openverse' );
					}
				}
			} catch ( \Throwable $e ) {}
		}

		/* Prefer google sources first in list */
		usort( $out, function( $a, $b ) {
			$rank = array( 'google_cse' => 0, 'google' => 1, 'bing' => 2, 'ddg' => 3, 'openverse' => 4, 'wikimedia' => 5 );
			$ra = $rank[ $a['source'] ?? '' ] ?? 9;
			$rb = $rank[ $b['source'] ?? '' ] ?? 9;
			return $ra <=> $rb;
		} );

		return array_slice( $out, 0, 14 );
	}

	/**
	 * Extract original image URLs from Google Images HTML / embedded JSON.
	 *
	 * @param string   $body
	 * @param callable $add function($url,$title,$src)
	 * @param string   $title
	 */
	public static function parse_google_images_html( $body, $add, $title = '' ) {
		if ( ! is_callable( $add ) || $body === '' ) {
			return;
		}
		/* Classic: "ou":"https://..." original url in AF_initData / scripts */
		if ( preg_match_all( '/"ou"\s*:\s*"(https?:\\\\\/\\\\\/[^"]+)"/', $body, $m ) ) {
			foreach ( $m[1] as $raw ) {
				$u = stripcslashes( $raw );
				$u = str_replace( '\\/', '/', $u );
				$add( $u, $title, 'google' );
			}
		}
		if ( preg_match_all( '/"ou":"(https?:\\\\\/\\\\\/[^"]+)"/', $body, $m2 ) ) {
			foreach ( $m2[1] as $raw ) {
				$u = str_replace( '\\/', '/', stripcslashes( $raw ) );
				$add( $u, $title, 'google' );
			}
		}
		/* ["http…jpg", width, height] patterns in side-channel data */
		if ( preg_match_all( '/\["(https?:\\\\\/\\\\\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"\s*,\s*\d+\s*,\s*\d+\]/i', $body, $m3 ) ) {
			foreach ( $m3[1] as $raw ) {
				$u = str_replace( '\\/', '/', stripcslashes( $raw ) );
				$add( $u, $title, 'google' );
			}
		}
		/* imgurl= query param */
		if ( preg_match_all( '/(?:imgurl|imgrefurl)=([^&"\'<>\s]+)/i', $body, $m4 ) ) {
			foreach ( $m4[1] as $enc ) {
				$u = urldecode( html_entity_decode( $enc ) );
				if ( preg_match( '/^https?:\/\//i', $u ) && preg_match( '/\.(jpe?g|png|webp)/i', $u ) ) {
					$add( $u, $title, 'google' );
				}
			}
		}
		/* data-src / unescaped https images in JSON blobs */
		if ( preg_match_all( '/https?:\/\/[^"\'\\\s<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"\'\\\s<>]*)?/i', $body, $m5 ) ) {
			$n = 0;
			foreach ( $m5[0] as $u ) {
				if ( preg_match( '/encrypted-tbn|gstatic\.com\/images|googleusercontent\.com\/\d/i', $u ) ) {
					continue; /* skip google thumbnails when possible — prefer originals from ou */
				}
				$add( $u, $title, 'google' );
				if ( ++$n >= 10 ) {
					break;
				}
			}
		}
	}

	/**
	 * Use master AI to choose the best product photo URL from candidates.
	 *
	 * @param string $title
	 * @param string $category
	 * @param array  $candidates
	 * @param array  $settings
	 * @return string URL or empty
	 */
	public static function ai_pick_best_product_image( $title, $category, $candidates, $settings ) {
		if ( empty( $candidates ) ) {
			return '';
		}
		// If only 1–2, skip AI cost
		if ( count( $candidates ) <= 2 ) {
			return (string) ( $candidates[0]['url'] ?? '' );
		}
		try {
			$master = self::get_scraper_master_ai_model( $settings );
			if ( empty( $master ) || empty( $master['api_key'] ) && empty( $master['endpoint'] ) ) {
				// still try; call_ai_api may resolve keys
			}
			$list = '';
			foreach ( array_slice( $candidates, 0, 8 ) as $i => $c ) {
				$list .= ( $i + 1 ) . ') ' . ( $c['url'] ?? '' ) . "\n";
			}
			$prompt = "تو دستیار انتخاب تصویر محصول برای فروشگاه اینترنتی هستی.\n"
				. "نام محصول: «{$title}»\n"
				. ( $category ? "دسته: «{$category}»\n" : '' )
				. "از بین URLهای زیر، فقط یک URL را برگردان که بهترین عکس واقعی همان کالا باشد (نه لوگو، نه بنر تبلیغاتی، نه تصویر نامرتبط).\n"
				. "فقط خود URL را در یک خط چاپ کن، بدون توضیح.\n\n"
				. $list;
			$reply = self::call_ai_api( is_array( $master ) ? $master : array(), $prompt, 'system', $settings );
			$reply = trim( (string) $reply );
			// extract first URL
			if ( preg_match( '#https?://[^\s\"\'<>]+#i', $reply, $m ) ) {
				$u = self::normalize_image_url( $m[0] );
				// must be one of candidates (or close)
				foreach ( $candidates as $c ) {
					$cu = self::normalize_image_url( $c['url'] ?? '' );
					if ( $cu && ( $cu === $u || strpos( $u, preg_replace( '/\?.*$/', '', $cu ) ) === 0 || strpos( $cu, preg_replace( '/\?.*$/', '', $u ) ) === 0 ) ) {
						return $cu;
					}
				}
				// AI invented URL — only accept if looks like image
				if ( $u && self::remote_url_looks_like_image( $u ) ) {
					return $u;
				}
			}
		} catch ( \Throwable $e ) {
			// fall through
		}
		return (string) ( $candidates[0]['url'] ?? '' );
	}

	private static function attach_external_image( $post_id, $image_url, $title ) {
		if ( ! function_exists( 'media_sideload_image' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}

		$att_id = media_sideload_image( $image_url, $post_id, $title, 'id' );
		if ( ! is_wp_error( $att_id ) && $att_id > 0 ) {
			set_post_thumbnail( $post_id, $att_id );
		}
	}

	/**
	 * Handle AJAX synchronization request.
	 */
	public static function ajax_sync_to_woo() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		/* bump time limit — per-product direct sync can be long */
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 );
		}
		@ignore_user_abort( true );

		$result = self::sync_to_woocommerce();
		if ( ! empty( $result['ok'] ) ) {
			wp_send_json_success( $result );
		} else {
			wp_send_json_error( is_array( $result ) ? $result : array( 'message' => (string) $result ) );
		}
	}

	/**
	 * v13.2 / v10.103: live progress of direct Woo sync (product cards).
	 */
	public static function ajax_direct_sync_progress() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}
		$p = self::get_direct_sync_progress();
		wp_send_json_success( is_array( $p ) ? $p : array() );
	}

	/**
	 * Load connections configuration from scraper's connections.json.
	 *
	 * @return array
	 */

	/**
	 * v10.99: تست اتصال مستقیم ووکامرس از داخل ادمین وردپرس (همیشه in-process).
	 */

	/**
	 * v13.3.32: nonce اتصال مستقیم — هم scraper_woo_bridge و هم scraper_shop_admin_nonce
	 * (قبلاً JS یکی و PHP دیگری می‌فرستاد → 403 body "-1").
	 *
	 * @return bool
	 */
	public static function verify_woo_bridge_nonce() {
		$nonce = isset( $_REQUEST['nonce'] ) ? (string) wp_unslash( $_REQUEST['nonce'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( $nonce === '' && isset( $_REQUEST['_ajax_nonce'] ) ) {
			$nonce = (string) wp_unslash( $_REQUEST['_ajax_nonce'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		}
		if ( $nonce === '' ) {
			return false;
		}
		if ( wp_verify_nonce( $nonce, 'scraper_woo_bridge' ) ) {
			return true;
		}
		if ( wp_verify_nonce( $nonce, 'scraper_shop_admin_nonce' ) ) {
			return true;
		}
		return false;
	}

	public static function ajax_test_woo_direct() {
		if ( ! self::verify_woo_bridge_nonce() ) {
			wp_send_json_error(
				array(
					'message' => 'نشست امنیتی منقضی شده — صفحه را رفرش کنید (Ctrl+F5).',
					'code'    => 'bad_nonce',
				),
				403
			);
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز.' ), 403 );
		}

		$has_wc = class_exists( 'WooCommerce' ) || function_exists( 'wc_get_product' ) || class_exists( 'WC_Product_Simple' );
		$env    = array(
			'in_wp'      => true,
			'has_wc'     => (bool) $has_wc,
			'wc_version' => defined( 'WC_VERSION' ) ? WC_VERSION : '',
			'php'        => PHP_VERSION,
			'blog'       => function_exists( 'home_url' ) ? home_url( '/' ) : '',
		);

		if ( ! $has_wc ) {
			wp_send_json_success( array(
				'ok'      => false,
				'message' => 'ووکامرس فعال نیست',
				'detail'  => 'افزونه WooCommerce را نصب و فعال کنید؛ اتصال مستقیم فقط وقتی WC در همین PHP process باشد کار می‌کند.',
				'hint'    => 'Plugins → Add New → WooCommerce',
				'env'     => $env,
				'direct'  => array( 'ok' => false, 'message' => 'WooCommerce missing', 'via' => 'direct' ),
			) );
		}

		// Prefer scraper4 helpers when loadable under SCRAPER4_NO_RENDER.
		self::load_scraper_ai_engine();
		$result = null;
		if ( function_exists( 'wooTestConnection' ) ) {
			$conn = self::get_scraper_connections();
			$w    = is_array( $conn['woocommerce'] ?? null ) ? $conn['woocommerce'] : array();
			$home = function_exists( 'home_url' ) ? rtrim( (string) home_url( '/' ), '/' ) : '';
			$result = wooTestConnection( array(
				'store_url'       => $home !== '' ? $home : (string) ( $w['store_url'] ?? '' ),
				'consumer_key'    => (string) ( $w['consumer_key'] ?? '' ),
				'consumer_secret' => (string) ( $w['consumer_secret'] ?? '' ),
				'mode'            => 'direct',
			) );
		} else {
			$ok     = false;
			$detail = '';
			$pid    = 0;
			try {
				$product = new WC_Product_Simple();
				$product->set_name( 'AMPHP admin connection ping' );
				$product->set_status( 'draft' );
				$product->set_catalog_visibility( 'hidden' );
				$product->set_regular_price( '1000' );
				$sku = 'amphp-admin-' . substr( md5( uniqid( (string) mt_rand(), true ) ), 0, 8 );
				$product->set_sku( $sku );
				$pid = (int) $product->save();
				$ok  = $pid > 0;
				if ( $pid > 0 && function_exists( 'wp_delete_post' ) ) {
					wp_delete_post( $pid, true );
				}
				$detail = $ok
					? ( 'پیش‌نویس #' . $pid . ' (SKU ' . $sku . ') ساخته و پاک شد' )
					: 'WC_Product_Simple::save() مقدار خالی برگرداند';
			} catch ( \Throwable $e ) {
				$detail = $e->getMessage();
			}
			$result = array(
				'ok'      => $ok,
				'message' => $ok ? 'اتصال مستقیم موفق (از پنل ادمین)' : 'اتصال مستقیم ناموفق',
				'detail'  => $detail,
				'env'     => $env,
				'direct'  => array(
					'ok'      => $ok,
					'message' => $ok ? 'OK' : 'FAIL',
					'detail'  => $detail,
					'via'     => 'direct',
					'product' => $pid,
				),
			);
		}

		if ( is_array( $result ) && empty( $result['env'] ) ) {
			$result['env'] = $env;
		}
		wp_send_json_success( $result );
	}

	/**
	 * v10.99: فعال‌سازی همگام مستقیم در connections.json از پنل ادمین.
	 * اسکراپر خارج از WP نمی‌تواند direct را اجرا کند — این دکمه مسیر ادمین را روشن می‌کند.
	 */
	public static function ajax_enable_woo_direct() {
		if ( ! self::verify_woo_bridge_nonce() ) {
			wp_send_json_error(
				array(
					'message' => 'نشست امنیتی منقضی شده — صفحه را رفرش کنید (Ctrl+F5).',
					'code'    => 'bad_nonce',
				),
				403
			);
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز.' ), 403 );
		}

		$has_wc = class_exists( 'WooCommerce' ) || function_exists( 'wc_get_product' );
		$file   = plugin_dir_path( __FILE__ ) . 'connections.json';
		// Prefer existing path used by get_scraper_connections
		$locations = array(
			dirname( __FILE__ ) . '/connections.json',
			plugin_dir_path( __FILE__ ) . 'connections.json',
		);
		$existing = '';
		foreach ( $locations as $loc ) {
			if ( file_exists( $loc ) ) {
				$existing = $loc;
				break;
			}
		}
		if ( $existing === '' ) {
			$existing = $file;
		}

		$data = array();
		if ( is_readable( $existing ) ) {
			$raw = @file_get_contents( $existing );
			$d   = @json_decode( (string) $raw, true );
			if ( is_array( $d ) ) {
				$data = $d;
			}
		}

		$w = is_array( $data['woocommerce'] ?? null ) ? $data['woocommerce'] : array();
		$w['enabled']   = 1;
		$w['sync_mode'] = 'direct';
		$fb = isset( $_POST['fallback'] ) ? sanitize_text_field( wp_unslash( $_POST['fallback'] ) ) : 'direct_then_api';
		if ( ! in_array( $fb, array( 'api_then_direct', 'direct_then_api', 'none' ), true ) ) {
			$fb = 'direct_then_api';
		}
		$w['sync_fallback'] = $fb;
		if ( empty( $w['store_url'] ) && function_exists( 'home_url' ) ) {
			$w['store_url'] = rtrim( (string) home_url( '/' ), '/' );
		}
		// Keep keys if already set; do not wipe secrets.
		$data['woocommerce'] = $w;

		$json = wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		$ok   = false;
		if ( function_exists( 'WP_Filesystem' ) ) {
			// best-effort plain write
		}
		$ok = (bool) @file_put_contents( $existing, $json . "\n", LOCK_EX );

		if ( ! $ok ) {
			wp_send_json_error( array(
				'message' => 'نوشتن connections.json ناموفق — مجوز نوشتن پوشه پلاگین را بررسی کنید',
				'file'    => $existing,
			) );
		}

		wp_send_json_success( array(
			'ok'          => true,
			'message'     => 'همگام مستقیم فعال شد' . ( $has_wc ? '' : ' (توجه: ووکامرس هنوز فعال نیست)' ),
			'sync_mode'   => 'direct',
			'fallback'    => $fb,
			'store_url'   => $w['store_url'] ?? '',
			'file'        => basename( $existing ),
			'path'        => $existing,
			'has_wc'      => (bool) $has_wc,
			'woocommerce' => array(
				'enabled'       => 1,
				'sync_mode'     => 'direct',
				'sync_fallback' => $fb,
				'store_url'     => $w['store_url'] ?? '',
			),
		) );
	}

	/**
	 * v13.3.8: ذخیرهٔ فونت سراسری در connections.json (منبع حقیقت اسکرپر + ویترین).
	 *
	 * @param string $font_key
	 * @return bool
	 */
	/**
	 * v13.3.33: Ensure scraper4 helpers (matrix*) are loaded without HTML render.
	 *
	 * @return bool
	 */
	/** Load the standalone scraper as a module, never dispatching its HTTP/CLI routes. */
	public static function require_scraper_module( $scraper_file ) {
		// The upstream scraper defaults to running cron in CLI before its no-render guard.
		if ( PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg' ) return false;
		if ( ! defined( 'SCRAPER4_NO_RENDER' ) ) define( 'SCRAPER4_NO_RENDER', true );
		$get = $_GET; $post = $_POST; $request = $_REQUEST;
		$ob = ob_get_level(); $errors = error_reporting();
		$display = ini_get( 'display_errors' ); $execution = ini_get( 'max_execution_time' ); $memory = ini_get( 'memory_limit' );
		$_GET = array(); $_POST = array(); $_REQUEST = array();
		@ob_start();
		try { require_once $scraper_file; return true; }
		catch ( \Throwable $e ) { error_log( 'AMPHP scraper module: ' . $e->getMessage() ); return false; }
		finally {
			$_GET = $get; $_POST = $post; $_REQUEST = $request;
			error_reporting( $errors );
			@ini_set( 'display_errors', (string) $display );
			@ini_set( 'max_execution_time', (string) $execution );
			@ini_set( 'memory_limit', (string) $memory );
			while ( ob_get_level() > $ob ) @ob_end_clean();
		}
	}

	public static function load_scraper_matrix_engine() {
		static $ok = null;
		if ( null !== $ok ) {
			return $ok;
		}
		if ( function_exists( 'matrixBuild' ) && function_exists( 'matrixQueryPage' ) ) {
			$ok = true;
			return true;
		}
		$scraper_file = plugin_dir_path( __FILE__ ) . 'scraper4.php';
		if ( ! file_exists( $scraper_file ) ) {
			$ok = false;
			return false;
		}
		$ok = self::require_scraper_module( $scraper_file ) && function_exists( 'matrixBuild' ) && function_exists( 'matrixQueryPage' );
		return (bool) $ok;
	}

	/**
	 * v13.3.33: شروع ساخت جدول مقایسه روی سرور (پس‌زمینه).
	 */
	public static function ajax_sync_matrix_start() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی — Ctrl+F5' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		if ( ! self::load_scraper_matrix_engine() ) {
			wp_send_json_error( array( 'message' => 'scraper4.php یا توابع matrix در دسترس نیست' ) );
		}
		@set_time_limit( 0 );
		@ignore_user_abort( true );
		$opts = array(
			'profile'    => isset( $_REQUEST['profile'] ) ? sanitize_text_field( wp_unslash( (string) $_REQUEST['profile'] ) ) : 'all',
			'source'     => 'wp_admin',
			'background' => false,
		);
		$lock = defined( 'SYNC_MATRIX_LOCK_FILE' ) ? SYNC_MATRIX_LOCK_FILE : ( plugin_dir_path( __FILE__ ) . 'sync_matrix.lock' );
		$fp   = @fopen( $lock, 'c' );
		if ( ! $fp || ! flock( $fp, LOCK_EX | LOCK_NB ) ) {
			if ( $fp ) {
				@fclose( $fp );
			}
			wp_send_json_success(
				array(
					'ok'      => false,
					'error'   => 'یک ساخت جدول در حال اجراست',
					'running' => true,
				)
			);
		}
		if ( function_exists( 'matrixProgress' ) ) {
			matrixProgress(
				array(
					'running'    => true,
					'done'       => false,
					'error'      => '',
					'pct'        => 1,
					'phase'      => 'start',
					'started_at' => time(),
					'source'     => 'wp_admin',
					'log_add'    => array( '🚀 ساخت جدول از پنل افزونه وردپرس…' ),
				)
			);
		}
		/* پاسخ زود، ادامه در shutdown تا مرورگر timeout نکند */
		$payload = wp_json_encode(
			array(
				'success' => true,
				'data'    => array(
					'ok'      => true,
					'started' => true,
					'message' => 'ساخت روی سرور شروع شد (مسیر WC مستقیم در صورت امکان)',
					'running' => true,
				),
			)
		);
		if ( ! headers_sent() ) {
			header( 'Content-Type: application/json; charset=UTF-8' );
			header( 'Connection: close' );
			header( 'Content-Length: ' . strlen( $payload ) );
		}
		echo $payload;
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			@fastcgi_finish_request();
		} else {
			@ob_end_flush();
			@flush();
		}
		register_shutdown_function(
			function () use ( $fp, $lock, $opts ) {
				try {
					if ( function_exists( 'matrixBuild' ) ) {
						matrixBuild( $opts );
					}
				} catch ( \Throwable $e ) {
					if ( function_exists( 'matrixProgress' ) ) {
						matrixProgress(
							array(
								'running' => false,
								'done'    => true,
								'error'   => $e->getMessage(),
								'pct'     => 100,
								'log_add' => array( '❌ ' . $e->getMessage() ),
							)
						);
					}
				}
				@flock( $fp, LOCK_UN );
				@fclose( $fp );
				@unlink( $lock );
			}
		);
		exit;
	}

	/**
	 * v13.3.33: وضعیت جاب جدول مقایسه.
	 */
	public static function ajax_sync_matrix_status() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی — Ctrl+F5' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		if ( ! self::load_scraper_matrix_engine() ) {
			wp_send_json_error( array( 'message' => 'scraper4 در دسترس نیست' ) );
		}
		$prog = function_exists( 'matrixProgressRead' ) ? matrixProgressRead() : array();
		$fix  = function_exists( 'matrixFixProgressRead' ) ? matrixFixProgressRead() : array();
		$has  = defined( 'SYNC_MATRIX_RESULT_FILE' ) && is_file( SYNC_MATRIX_RESULT_FILE );
		$age  = $has ? ( time() - (int) @filemtime( SYNC_MATRIX_RESULT_FILE ) ) : -1;
		$rows = 0;
		if ( $has && function_exists( 'matrixResultLoad' ) ) {
			$d    = matrixResultLoad();
			$rows = (int) ( $d['row_count'] ?? 0 );
		}
		$direct = function_exists( 'wooDirectAvailable' ) && wooDirectAvailable();
		$any_run = ! empty( $prog['running'] ) || ! empty( $fix['running'] );
		$use_fix = ! empty( $fix['running'] ) || ( ! empty( $fix['done'] ) && empty( $prog['running'] ) );
		wp_send_json_success(
			array(
				'ok'             => true,
				'running'        => $any_run,
				'build_running'  => ! empty( $prog['running'] ),
				'fix_running'    => ! empty( $fix['running'] ),
				'done'           => ! empty( $prog['done'] ) || ! empty( $fix['done'] ),
				'progress'       => $use_fix ? $fix : $prog,
				'build_progress' => $prog,
				'fix_progress'   => $fix,
				'job'            => ! empty( $fix['running'] ) ? 'fix' : ( ! empty( $prog['running'] ) ? 'build' : 'idle' ),
				'has_result'     => $has,
				'result_age_sec' => $age,
				'result_rows'    => $rows,
				'woo_direct'     => (bool) $direct,
			)
		);
	}

	/**
	 * v13.3.33: خواندن صفحه‌بندی‌شدهٔ نتیجهٔ جدول مقایسه.
	 */
	public static function ajax_sync_matrix() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی — Ctrl+F5' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		if ( ! self::load_scraper_matrix_engine() || ! function_exists( 'matrixQueryPage' ) ) {
			wp_send_json_error( array( 'message' => 'scraper4 / matrixQueryPage نیست' ) );
		}
		$opts = array(
			'page'          => max( 1, (int) ( $_REQUEST['page'] ?? 1 ) ),
			'per_page'      => max( 10, min( 200, (int) ( $_REQUEST['per_page'] ?? 50 ) ) ),
			'q'             => isset( $_REQUEST['q'] ) ? sanitize_text_field( wp_unslash( (string) $_REQUEST['q'] ) ) : '',
			'only_dup'      => ! empty( $_REQUEST['only_dup'] ),
			'only_mismatch' => ! empty( $_REQUEST['only_mismatch'] ),
			'only_missing'  => ! empty( $_REQUEST['only_missing'] ),
		);
		$out = matrixQueryPage( $opts );
		if ( ! is_array( $out ) ) {
			$out = array( 'ok' => false, 'error' => 'پاسخ نامعتبر' );
		}
		/* progress overlay */
		if ( function_exists( 'matrixProgressRead' ) ) {
			$out['progress'] = matrixProgressRead();
			$out['running']  = ! empty( $out['progress']['running'] );
		}
		$out['woo_direct'] = function_exists( 'wooDirectAvailable' ) && wooDirectAvailable();
		wp_send_json_success( $out );
	}


	/**
	 * v13.3.38 / v10.121: مغایرت کامل (قیمت+ارسال+حذف+گزارش) از جدول مقایسه.
	 */
	public static function ajax_sync_matrix_fix_start() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی — Ctrl+F5' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		if ( ! self::load_scraper_matrix_engine() || ! function_exists( 'matrixFixRun' ) ) {
			wp_send_json_error( array( 'message' => 'موتور matrixFix در scraper4 نیست' ) );
		}
		@set_time_limit( 0 );
		@ignore_user_abort( true );
		$opts = array(
			'scope'    => isset( $_REQUEST['scope'] ) ? sanitize_key( wp_unslash( (string) $_REQUEST['scope'] ) ) : 'all',
			'delay_ms' => isset( $_REQUEST['delay_ms'] ) ? (int) $_REQUEST['delay_ms'] : 180,
			'source'   => 'wp_admin',
		);
		if ( ! in_array( $opts['scope'], array( 'all', 'woo', 'bsl' ), true ) ) {
			$opts['scope'] = 'all';
		}
		if ( ! defined( 'SYNC_MATRIX_RESULT_FILE' ) || ! is_file( SYNC_MATRIX_RESULT_FILE ) ) {
			wp_send_json_error( array( 'message' => 'اول جدول مقایسه را بسازید' ) );
		}
		$lock = defined( 'SYNC_MATRIX_FIX_LOCK_FILE' ) ? SYNC_MATRIX_FIX_LOCK_FILE : ( plugin_dir_path( __FILE__ ) . 'sync_matrix_fix.lock' );
		$fp   = @fopen( $lock, 'c' );
		if ( ! $fp || ! flock( $fp, LOCK_EX | LOCK_NB ) ) {
			if ( $fp ) {
				@fclose( $fp );
			}
			wp_send_json_success( array( 'ok' => false, 'error' => 'یک اصلاح در حال اجراست', 'running' => true ) );
		}
		if ( function_exists( 'matrixFixProgress' ) ) {
			matrixFixProgress(
				array(
					'running'    => true,
					'done'       => false,
					'error'      => '',
					'pct'        => 1,
					'phase'      => 'queued',
					'started_at' => time(),
					'source'     => 'wp_admin',
					'job'        => 'fix',
					'log'        => array(),
					'live'       => array(),
					'log_add'    => array( '🚀 اصلاح مغایرت از پنل افزونه…' ),
				)
			);
		}
		$payload = wp_json_encode(
			array(
				'success' => true,
				'data'    => array(
					'ok'      => true,
					'started' => true,
					'running' => true,
					'message' => 'اصلاح روی سرور شروع شد',
				),
			)
		);
		if ( ! headers_sent() ) {
			header( 'Content-Type: application/json; charset=UTF-8' );
			header( 'Connection: close' );
			header( 'Content-Length: ' . strlen( $payload ) );
		}
		echo $payload;
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			@fastcgi_finish_request();
		} else {
			@ob_end_flush();
			@flush();
		}
		register_shutdown_function(
			function () use ( $fp, $lock, $opts ) {
				try {
					if ( function_exists( 'matrixFixRun' ) ) {
						matrixFixRun( $opts );
					}
				} catch ( \Throwable $e ) {
					if ( function_exists( 'matrixFixProgress' ) ) {
						matrixFixProgress(
							array(
								'running' => false,
								'done'    => true,
								'error'   => $e->getMessage(),
								'pct'     => 100,
								'log_add' => array( '❌ ' . $e->getMessage() ),
							)
						);
					}
				}
				@flock( $fp, LOCK_UN );
				@fclose( $fp );
				@unlink( $lock );
			}
		);
		exit;
	}

	/** وضعیت جاب اصلاح */
	public static function ajax_sync_matrix_fix_status() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		self::load_scraper_matrix_engine();
		$prog = function_exists( 'matrixFixProgressRead' ) ? matrixFixProgressRead() : array();
		wp_send_json_success(
			array(
				'ok'       => true,
				'running'  => ! empty( $prog['running'] ),
				'done'     => ! empty( $prog['done'] ),
				'progress' => $prog,
				'job'      => 'fix',
			)
		);
	}

	/** توقف اصلاح */
	public static function ajax_sync_matrix_fix_stop() {
		if ( ! self::verify_woo_bridge_nonce() && ! check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => 'نشست امنیتی منقضی' ), 403 );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		self::load_scraper_matrix_engine();
		$stop = defined( 'SYNC_MATRIX_FIX_STOP_FILE' ) ? SYNC_MATRIX_FIX_STOP_FILE : ( plugin_dir_path( __FILE__ ) . 'sync_matrix_fix_stop.json' );
		@file_put_contents( $stop, wp_json_encode( array( 'at' => time() ) ), LOCK_EX );
		if ( function_exists( 'matrixFixProgress' ) ) {
			matrixFixProgress( array( 'log_add' => array( '⏹ درخواست توقف ثبت شد…' ) ) );
		}
		wp_send_json_success( array( 'ok' => true, 'stopping' => true ) );
	}


	public static function sync_ui_font_to_connections( $font_key ) {
		$font_key = sanitize_key( (string) $font_key );
		if ( $font_key === '' ) {
			return false;
		}
		$locations = array(
			dirname( __FILE__ ) . '/connections.json',
			plugin_dir_path( __FILE__ ) . 'connections.json',
			defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/uploads/connections.json' : '',
		);
		$written = false;
		foreach ( $locations as $loc ) {
			if ( empty( $loc ) ) {
				continue;
			}
			$data = array();
			if ( file_exists( $loc ) ) {
				$raw = @file_get_contents( $loc );
				$decoded = @json_decode( (string) $raw, true );
				if ( is_array( $decoded ) ) {
					$data = $decoded;
				}
			}
			$data['ui_font']  = $font_key;
			$data['app_font'] = $font_key;
			$data['ui_font_at'] = time();
			$json = wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT );
			if ( false === $json ) {
				continue;
			}
			$dir = dirname( $loc );
			if ( ! is_dir( $dir ) ) {
				@wp_mkdir_p( $dir );
			}
			if ( @file_put_contents( $loc, $json ) !== false ) {
				$written = true;
				break;
			}
		}
		return $written;
	}

	public static function get_scraper_connections() {
		$locations = array(
			dirname( __FILE__ ) . '/connections.json',
			plugin_dir_path( __FILE__ ) . 'connections.json',
			defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR . '/uploads/connections.json' : '',
		);

		foreach ( $locations as $loc ) {
			if ( ! empty( $loc ) && file_exists( $loc ) ) {
				$json = @file_get_contents( $loc );
				if ( ! empty( $json ) ) {
					$data = @json_decode( $json, true );
					if ( is_array( $data ) ) {
						return $data;
					}
				}
			}
		}

		return array();
	}

	/**
	 * Determine active messengers based on scraper's connections.json and admin settings.
	 *
	 * @param array|null $settings
	 * @return array
	 */
	public static function get_active_messengers( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		$cn = self::get_scraper_connections();
		$active = array();

		// 1. Bale (بله)
		$bale_token = ! empty( $settings['bale_token'] ) ? trim( $settings['bale_token'] ) : ( $cn['baleh']['token'] ?? $cn['bale']['token'] ?? '' );
		$bale_chat  = ! empty( $settings['bale_chat_id'] ) ? trim( $settings['bale_chat_id'] ) : ( $cn['baleh']['chat_id'] ?? $cn['bale']['chat_id'] ?? '' );
		if ( ! empty( $bale_token ) && ! empty( $bale_chat ) ) {
			$source = ! empty( $settings['bale_token'] ) ? 'admin_settings' : 'scraper_connections';
			$active['bale'] = array(
				'title'    => 'پیام‌رسان بله (Bale)',
				'token'    => $bale_token,
				'chat_id'  => $bale_chat,
				'source'   => $source,
				'api_base' => 'https://tapi.bale.ai/bot' . $bale_token . '/',
				'url'      => 'https://tapi.bale.ai/bot' . $bale_token . '/sendMessage',
			);
		}

		// 2. Telegram (تلگرام)
		$tele_token = ! empty( $settings['telegram_token'] ) ? trim( $settings['telegram_token'] ) : ( $cn['telegram']['token'] ?? '' );
		$tele_chat  = ! empty( $settings['telegram_chat_id'] ) ? trim( $settings['telegram_chat_id'] ) : ( $cn['telegram']['chat_id'] ?? '' );
		if ( ! empty( $tele_token ) && ! empty( $tele_chat ) ) {
			$source = ! empty( $settings['telegram_token'] ) ? 'admin_settings' : 'scraper_connections';
			$active['telegram'] = array(
				'title'    => 'تلگرام (Telegram)',
				'token'    => $tele_token,
				'chat_id'  => $tele_chat,
				'source'   => $source,
				'api_base' => 'https://api.telegram.org/bot' . $tele_token . '/',
				'url'      => 'https://api.telegram.org/bot' . $tele_token . '/sendMessage',
			);
		}

		// 3. Rubika (روبیکا)
		$rubi_token = ! empty( $settings['rubika_token'] ) ? trim( $settings['rubika_token'] ) : ( $cn['rubika']['token'] ?? '' );
		$rubi_chat  = ! empty( $settings['rubika_chat_id'] ) ? trim( $settings['rubika_chat_id'] ) : ( $cn['rubika']['chat_id'] ?? '' );
		if ( ! empty( $rubi_token ) && ! empty( $rubi_chat ) ) {
			$source = ! empty( $settings['rubika_token'] ) ? 'admin_settings' : 'scraper_connections';
			$active['rubika'] = array(
				'title'    => 'روبیکا (Rubika)',
				'token'    => $rubi_token,
				'chat_id'  => $rubi_chat,
				'source'   => $source,
				'api_base' => 'https://api.rubika.ir/v1/bot' . $rubi_token . '/',
				'url'      => 'https://api.rubika.ir/v1/bot' . $rubi_token . '/sendMessage',
			);
		}

		return $active;
	}

	/**
	 * Send formatted text message to all active messengers.
	 *
	 * @param string $message_text
	 * @param array|null $settings
	 * @return array
	 */
	public static function send_message_to_messengers( $message_text, $settings = null, $media = array() ) {
		$messengers = self::get_active_messengers( $settings );
		if ( empty( $messengers ) ) {
			return array(
				'ok'      => false,
				'sent'    => 0,
				'total'   => 0,
				'message' => 'هیچ پیام‌رسانی در تنظیمات افزونه یا بخش اعلان‌های اسکرپر (connections.json) فعال نشده است.',
				'details' => array(),
			);
		}

		$sent_count = 0;
		$details    = array();
		$want_preview = ! empty( $media ) || (bool) preg_match( '~https?://\S+~u', (string) $message_text );

		foreach ( $messengers as $key => $m ) {
			$body = array(
				'chat_id' => $m['chat_id'],
				'text'    => $message_text,
			);
			if ( 'telegram' === $key || 'bale' === $key ) {
				$body['disable_web_page_preview'] = ! $want_preview;
			}

			$args = array(
				'method'      => 'POST',
				'timeout'     => 8,
				'redirection' => 2,
				'httpversion' => '1.0',
				'blocking'    => false, // Non-blocking so customer chat is never delayed!
				'headers'     => array(
					'Content-Type' => 'application/json; charset=utf-8',
				),
				'body'        => wp_json_encode( $body ),
				'sslverify'   => true,
			);

			$response = wp_remote_post( $m['url'], $args );

			if ( is_wp_error( $response ) ) {
				$details[ $key ] = array(
					'title' => $m['title'],
					'ok'    => false,
					'error' => $response->get_error_message(),
				);
			} else {
				$code      = wp_remote_retrieve_response_code( $response );
				$resp_body = wp_remote_retrieve_body( $response );
				$json      = @json_decode( $resp_body, true );
				$is_success = ( $code >= 200 && $code < 300 ) && ( ! isset( $json['ok'] ) || true === $json['ok'] );

				if ( $is_success || 0 === $code ) {
					// blocking=false may yield empty code — count as queued/sent
					$sent_count++;
					$details[ $key ] = array(
						'title' => $m['title'],
						'ok'    => true,
						'code'  => $code,
					);
				} else {
					$err_msg = 'HTTP ' . $code;
					if ( is_array( $json ) && ! empty( $json['description'] ) ) {
						$err_msg .= ': ' . $json['description'];
					}
					$details[ $key ] = array(
						'title' => $m['title'],
						'ok'    => false,
						'error' => $err_msg,
					);
				}
			}

			// v13.3.32: فوروارد چندرسانه‌ای (عکس/ویدیو/گیف/فایل/لینک)
			if ( ! empty( $media ) && is_array( $media ) ) {
				foreach ( array_slice( $media, 0, 8 ) as $it ) {
					if ( ! is_array( $it ) ) {
						continue;
					}
					self::send_media_to_messenger( $key, $m, $it );
				}
			}
		}

		$is_ok = ( $sent_count > 0 );
		$summary = $is_ok
			? "پیام با موفقیت به {$sent_count} پیام‌رسان ارسال شد."
			: 'خطا در ارسال پیام به پیام‌رسان‌ها.';

		return array(
			'ok'      => $is_ok,
			'sent'    => $sent_count,
			'total'   => count( $messengers ),
			'message' => $summary,
			'details' => $details,
		);
	}

	/**
	 * v13.3.32: ارسال یک آیتم رسانه به یک پیام‌رسان.
	 * $item = [ kind => photo|video|animation|audio|document|link, url, caption, name ]
	 */
	public static function send_media_to_messenger( $key, $m, $item ) {
		$kind = strtolower( trim( (string) ( $item['kind'] ?? 'document' ) ) );
		$url  = trim( (string) ( $item['url'] ?? '' ) );
		$cap  = trim( (string) ( $item['caption'] ?? '' ) );
		$name = trim( (string) ( $item['name'] ?? '' ) );
		if ( $url === '' ) {
			return array( 'ok' => false, 'error' => 'empty url' );
		}
		$api_base = (string) ( $m['api_base'] ?? '' );
		$chat_id  = $m['chat_id'];

		if ( 'link' === $kind || 'rubika' === $key || $api_base === '' ) {
			$label = array(
				'photo'     => '🖼 تصویر',
				'video'     => '🎬 ویدیو',
				'animation' => '🎞 گیف',
				'audio'     => '🎧 صوت',
				'document'  => '📎 فایل',
				'link'      => '🔗 لینک',
			);
			$txt = ( $label[ $kind ] ?? '📎' ) . ( $name !== '' ? ' (' . $name . ')' : '' ) . "\n" . $url;
			if ( $cap !== '' ) {
				$txt = mb_substr( $cap, 0, 300 ) . "\n" . $txt;
			}
			$body = array(
				'chat_id'                  => $chat_id,
				'text'                     => $txt,
				'disable_web_page_preview' => false,
			);
			$post_url = ! empty( $m['url'] ) ? $m['url'] : ( $api_base . 'sendMessage' );
			wp_remote_post(
				$post_url,
				array(
					'method'    => 'POST',
					'timeout'   => 8,
					'blocking'  => false,
					'headers'   => array( 'Content-Type' => 'application/json; charset=utf-8' ),
					'body'      => wp_json_encode( $body ),
					'sslverify' => false,
				)
			);
			return array( 'ok' => true );
		}

		$method = 'sendDocument';
		$field  = 'document';
		if ( 'photo' === $kind ) {
			$method = 'sendPhoto';
			$field  = 'photo';
		} elseif ( 'video' === $kind ) {
			$method = 'sendVideo';
			$field  = 'video';
		} elseif ( 'animation' === $kind ) {
			$method = 'sendAnimation';
			$field  = 'animation';
		} elseif ( 'audio' === $kind ) {
			$method = 'sendAudio';
			$field  = 'audio';
		}
		$body = array(
			'chat_id' => $chat_id,
			$field    => $url,
		);
		if ( $cap !== '' ) {
			$body['caption'] = mb_substr( $cap, 0, 1000 );
		}
		wp_remote_post(
			$api_base . $method,
			array(
				'method'    => 'POST',
				'timeout'   => 12,
				'blocking'  => false,
				'headers'   => array( 'Content-Type' => 'application/json; charset=utf-8' ),
				'body'      => wp_json_encode( $body ),
				'sslverify' => false,
			)
		);
		return array( 'ok' => true );
	}

	/**
	 * v13.3.32: تشخیص نوع رسانه از URL یا MIME.
	 */
	public static function media_kind_from_meta( $url, $mime = '', $name = '' ) {
		$mime = strtolower( (string) $mime );
		$path = strtolower( (string) ( wp_parse_url( $url, PHP_URL_PATH ) ?: $name ) );
		if ( strpos( $mime, 'image/gif' ) === 0 || preg_match( '~\.gif(\?|$)~', $path ) ) {
			return 'animation';
		}
		if ( strpos( $mime, 'image/' ) === 0 || preg_match( '~\.(jpe?g|png|webp|bmp)(\?|$)~', $path ) ) {
			return 'photo';
		}
		if ( strpos( $mime, 'video/' ) === 0 || preg_match( '~\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)~', $path ) ) {
			return 'video';
		}
		if ( strpos( $mime, 'audio/' ) === 0 || preg_match( '~\.(mp3|ogg|wav|m4a|aac)(\?|$)~', $path ) ) {
			return 'audio';
		}
		if ( preg_match( '~^https?://~i', (string) $url ) && ! preg_match( '~\.(jpe?g|png|gif|webp|mp4|webm|pdf|zip|rar)(\?|$)~i', $path ) ) {
			return 'link';
		}
		return 'document';
	}

	/**
	 * v13.3.32: ذخیره پیوست آپلود‌شدهٔ چت پشتیبانی و ساخت آیتم رسانه.
	 * @return array{ok:bool,item?:array,error?:string,path?:string,url?:string}
	 */
	public static function handle_support_chat_upload() {
		if ( empty( $_FILES['chat_file'] ) || ! is_array( $_FILES['chat_file'] ) ) {
			return array( 'ok' => false, 'error' => 'no_file' );
		}
		$f = $_FILES['chat_file'];
		if ( ! empty( $f['error'] ) && (int) $f['error'] !== UPLOAD_ERR_OK ) {
			return array( 'ok' => false, 'error' => 'upload_error_' . (int) $f['error'] );
		}
		$tmp  = (string) ( $f['tmp_name'] ?? '' );
		$name = sanitize_file_name( (string) ( $f['name'] ?? 'file.bin' ) );
		$size = (int) ( $f['size'] ?? 0 );
		$mime = (string) ( $f['type'] ?? '' );
		if ( $tmp === '' || ! is_uploaded_file( $tmp ) ) {
			return array( 'ok' => false, 'error' => 'invalid_tmp' );
		}
		if ( $size <= 0 || $size > 25 * 1024 * 1024 ) {
			return array( 'ok' => false, 'error' => 'size_limit' );
		}
		$allowed = array(
			'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
			'video/mp4', 'video/webm', 'video/quicktime',
			'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
			'application/pdf', 'application/zip', 'application/x-zip-compressed',
			'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/octet-stream',
		);
		// sniff mime if empty
		if ( $mime === '' && function_exists( 'mime_content_type' ) ) {
			$mime = (string) @mime_content_type( $tmp );
		}
		$ext = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		$ok_ext = in_array( $ext, array( 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mp3', 'ogg', 'wav', 'pdf', 'zip', 'doc', 'docx', 'rar', '7z', 'txt' ), true );
		if ( ! $ok_ext && $mime !== '' && ! in_array( $mime, $allowed, true ) ) {
			return array( 'ok' => false, 'error' => 'type_not_allowed' );
		}

		$upload = function_exists( 'wp_upload_dir' ) ? wp_upload_dir() : null;
		if ( ! is_array( $upload ) || empty( $upload['basedir'] ) ) {
			$dir = plugin_dir_path( __FILE__ ) . 'chat_uploads';
			$base_url = '';
		} else {
			$dir = trailingslashit( $upload['basedir'] ) . 'amphp-chat';
			$base_url = trailingslashit( $upload['baseurl'] ) . 'amphp-chat';
		}
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		$safe = time() . '_' . wp_generate_password( 8, false ) . ( $ext !== '' ? ( '.' . $ext ) : '' );
		$dest = trailingslashit( $dir ) . $safe;
		if ( ! @move_uploaded_file( $tmp, $dest ) ) {
			if ( ! @copy( $tmp, $dest ) ) {
				return array( 'ok' => false, 'error' => 'move_failed' );
			}
		}
		@chmod( $dest, 0644 );
		$file_url = '';
		if ( $base_url !== '' ) {
			$file_url = trailingslashit( $base_url ) . $safe;
		} elseif ( function_exists( 'plugins_url' ) ) {
			$file_url = plugins_url( 'chat_uploads/' . $safe, __FILE__ );
		}
		$kind = self::media_kind_from_meta( $file_url !== '' ? $file_url : $name, $mime, $name );
		$item = array(
			'kind'    => $kind,
			'url'     => $file_url,
			'caption' => '',
			'name'    => $name,
			'path'    => $dest,
			'mime'    => $mime,
			'size'    => $size,
		);
		return array( 'ok' => true, 'item' => $item, 'url' => $file_url, 'path' => $dest );
	}

	/**
	 * v13.3.32: استخراج لینک‌های داخل متن پیام مشتری به‌عنوان آیتم رسانه.
	 */
	public static function extract_links_as_media( $text ) {
		$items = array();
		if ( ! is_string( $text ) || $text === '' ) {
			return $items;
		}
		if ( preg_match_all( '~https?://[^\s<>"\']+~u', $text, $mm ) ) {
			foreach ( $mm[0] as $lnk ) {
				$lnk = rtrim( $lnk, '.,);]' );
				$kind = self::media_kind_from_meta( $lnk );
				$items[] = array(
					'kind'    => $kind,
					'url'     => $lnk,
					'caption' => '',
					'name'    => '',
				);
			}
		}
		return $items;
	}

	/**
	 * Alias for send_message_to_messengers (backward compatible name).
	 */
	public static function send_messenger_notification( $message_text, $settings = null ) {
		return self::send_message_to_messengers( $message_text, $settings );
	}

	public static function get_chat_threads() {
		$threads = get_option( 'scraper_chat_threads', false );
		if ( false === $threads || ! is_array( $threads ) ) {
			$file = plugin_dir_path( __FILE__ ) . 'chat_threads.json';
			if ( file_exists( $file ) ) {
				$threads = @json_decode( file_get_contents( $file ), true );
			}
		}
		return is_array( $threads ) ? $threads : array();
	}

	/**
	 * Save support chat threads (persisting the latest 150 conversations).
	 *
	 * @param array $threads
	 */
	public static function save_chat_threads( $threads ) {
		if ( ! is_array( $threads ) ) {
			$threads = array();
		}
		if ( count( $threads ) > 150 ) {
			$threads = array_slice( $threads, 0, 150, true );
		}
		update_option( 'scraper_chat_threads', $threads, false );
		$file = plugin_dir_path( __FILE__ ) . 'chat_threads.json';
		@file_put_contents( $file, wp_json_encode( $threads, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
	}

	/**
	 * AJAX endpoint for customer support chat submission.
	 * Supports continuous messenger thread, AI automatic answers, and persistent conversation.
	 */
	/**
	 * Retrieve Master AI model configured in scraper4.php / ai_votes.json / connections.json / ai_providers.json.
	 *
	 * @return array
	 */
		/**
	 * Build condensed live catalog context for AI grounding.
	 *
	 * @param int $limit
	 * @return string
	 */
	/**
	 * Full shop intelligence context for AI (products, orders, settings, analytics).
	 *
	 * @param int $limit max products in catalog section
	 * @return string
	 */
	public static function build_catalog_context_for_ai( $limit = 40 ) {
		$settings = self::get_settings();
		$products = self::get_all_scraped_products();
		$parts    = array();

		$shop_title = (string) ( $settings['shop_title'] ?? get_bloginfo( 'name' ) );
		$phone      = (string) ( $settings['contact_phone'] ?? '' );
		$hours      = (string) ( $settings['support_hours'] ?? '' );
		$threshold  = number_format( (float) ( $settings['free_shipping_threshold'] ?? 400000 ) );
		$currency   = (string) ( $settings['currency_symbol'] ?? 'تومان' );

		$parts[] = "=== اطلاعات فروشگاه ===";
		$parts[] = "نام: {$shop_title}";
		if ( $phone ) { $parts[] = "تلفن پشتیبانی: {$phone}"; }
		if ( $hours ) { $parts[] = "ساعات پاسخگویی: {$hours}"; }
		$parts[] = "ارسال رایگان برای خرید بالای {$threshold} {$currency}";
		$parts[] = "ضمانت: ۷ روز بازگشت وجه و تضمین اصالت کالا";
		$parts[] = "قالب ویترین: " . ( $settings['store_template'] ?? 'digikala' );

		// Categories summary
		$cats = array();
		foreach ( (array) $products as $p ) {
			$c = (string) ( $p['category'] ?? 'عمومی' );
			$cats[ $c ] = ( $cats[ $c ] ?? 0 ) + 1;
		}
		if ( $cats ) {
			$cat_bits = array();
			foreach ( $cats as $cn => $cc ) {
				$cat_bits[] = "{$cn} ({$cc})";
			}
			$parts[] = "دسته‌بندی‌ها: " . implode( '، ', array_slice( $cat_bits, 0, 20 ) );
		}
		$parts[] = "تعداد کل کالاهای ویترین: " . count( $products );

		// Products
		$parts[] = "\n=== کاتالوگ محصولات (برای پاسخ دقیق به قیمت/موجودی) ===";
		if ( empty( $products ) ) {
			$parts[] = 'کاتالوگ خالی است یا در حال به‌روزرسانی.';
		} else {
			$count = 0;
			foreach ( $products as $p ) {
				$count++;
				if ( $count > $limit ) {
					$parts[] = '… و ' . ( count( $products ) - $limit ) . ' کالای دیگر.';
					break;
				}
				$title = (string) ( $p['title'] ?? '' );
				$price_txt = ! empty( $p['price_formatted'] ) ? $p['price_formatted'] : ( number_format( (float) ( $p['price'] ?? 0 ) ) . ' ' . $currency );
				$line = "• [{$count}] «{$title}» | قیمت: {$price_txt}";
				if ( ! empty( $p['category'] ) ) {
					$line .= ' | دسته: ' . $p['category'];
				}
				if ( ! empty( $p['has_discount'] ) && ! empty( $p['discount_pct'] ) ) {
					$line .= ' | تخفیف: ' . $p['discount_pct'] . '٪';
					if ( ! empty( $p['old_price_formatted'] ) ) {
						$line .= ' (قبل: ' . $p['old_price_formatted'] . ')';
					}
				}
				$stock = ! empty( $p['in_stock'] ) || ! isset( $p['in_stock'] ) ? 'موجود' : 'ناموجود';
				$line .= " | موجودی: {$stock}";
				if ( ! empty( $p['id'] ) ) {
					$line .= ' | شناسه: ' . $p['id'];
				}
				if ( ! empty( $p['description'] ) ) {
					$desc_snip = mb_substr( wp_strip_all_tags( (string) $p['description'] ), 0, 140 );
					$line .= " | مشخصات: {$desc_snip}";
				}
				$parts[] = $line;
			}
		}

		// WooCommerce / WordPress orders snapshot
		$parts[] = "\n=== سفارش‌ها و فروش (داده واقعی) ===";
		$order_lines = array();
		$orders_count = 0;
		$revenue = 0.0;
		if ( function_exists( 'wc_get_orders' ) ) {
			$orders = wc_get_orders( array(
				'limit'  => 15,
				'orderby'=> 'date',
				'order'  => 'DESC',
				'status' => array( 'completed', 'processing', 'on-hold', 'pending' ),
				'return' => 'objects',
			) );
			if ( is_array( $orders ) ) {
				foreach ( $orders as $order ) {
					if ( ! is_object( $order ) || ! method_exists( $order, 'get_id' ) ) {
						continue;
					}
					$orders_count++;
					$total = (float) $order->get_total();
					$status = method_exists( $order, 'get_status' ) ? $order->get_status() : '';
					if ( in_array( $status, array( 'completed', 'processing', 'on-hold' ), true ) ) {
						$revenue += $total;
					}
					$oid = $order->get_id();
					$date = method_exists( $order, 'get_date_created' ) && $order->get_date_created()
						? $order->get_date_created()->date( 'Y-m-d H:i' )
						: '';
					$buyer = method_exists( $order, 'get_formatted_billing_full_name' )
						? trim( (string) $order->get_formatted_billing_full_name() )
						: '';
					$items_txt = array();
					foreach ( $order->get_items() as $item ) {
						$items_txt[] = $item->get_name() . '×' . $item->get_quantity();
					}
					$order_lines[] = "• سفارش #{$oid} | وضعیت: {$status} | مبلغ: " . number_format( $total ) . " {$currency}"
						. ( $buyer ? " | مشتری: {$buyer}" : '' )
						. ( $date ? " | تاریخ: {$date}" : '' )
						. ( $items_txt ? ' | اقلام: ' . implode( '، ', array_slice( $items_txt, 0, 5 ) ) : '' );
				}
			}
		}
		if ( function_exists( 'wc_orders_count' ) ) {
			$parts[] = 'تعداد سفارش تکمیل/درحال‌پردازش: '
				. ( (int) wc_orders_count( 'completed' ) + (int) wc_orders_count( 'processing' ) );
		}
		$parts[] = 'نمونه آخرین سفارش‌ها: ' . ( $order_lines ? '' : 'سفارشی ثبت نشده.' );
		foreach ( array_slice( $order_lines, 0, 12 ) as $ol ) {
			$parts[] = $ol;
		}
		if ( $revenue > 0 ) {
			$parts[] = 'جمع تقریبی فروش (از نمونه اخیر): ' . number_format( $revenue ) . ' ' . $currency;
		}

		// Analytics funnel
		$parts[] = "\n=== آمار قیف فروشگاه ===";
		try {
			$an = self::get_display_analytics_data();
			$t  = $an['totals'] ?? array();
			$parts[] = 'بازدید سایت: ' . intval( $t['site_visit'] ?? 0 );
			$parts[] = 'مشاهده محصول: ' . intval( $t['product_view'] ?? 0 );
			$parts[] = 'افزودن به سبد: ' . intval( $t['add_to_cart'] ?? 0 );
			$parts[] = 'ورود به تسویه: ' . intval( $t['checkout_step'] ?? 0 );
			$parts[] = 'ثبت سفارش (رویداد): ' . intval( $t['order_placed'] ?? 0 );
			$top = $an['top_products'] ?? array();
			if ( is_array( $top ) && $top ) {
				$parts[] = 'محبوب‌ترین کالاها:';
				$i = 0;
				foreach ( $top as $tp ) {
					$i++;
					if ( $i > 8 ) break;
					$parts[] = '• ' . ( $tp['title'] ?? 'کالا' ) . ' | مشاهده: ' . intval( $tp['views'] ?? 0 ) . ' | سبد: ' . intval( $tp['carts'] ?? 0 );
				}
			}
		} catch ( \Throwable $e ) {
			$parts[] = 'آمار در دسترس نیست.';
		}

		// Open support threads snapshot (no private dump)
		$parts[] = "\n=== چت پشتیبانی ===";
		try {
			$threads = self::get_chat_threads();
			$pending = 0;
			foreach ( (array) $threads as $th ) {
				if ( ( $th['status'] ?? '' ) === 'pending' || ! empty( $th['unread_admin'] ) ) {
					$pending++;
				}
			}
			$parts[] = 'تعداد گفتگوهای ذخیره‌شده: ' . count( (array) $threads );
			$parts[] = 'گفتگوهای در انتظار پاسخ: ' . $pending;
		} catch ( \Throwable $e ) {
			$parts[] = 'چت در دسترس نیست.';
		}

		$parts[] = "\n=== دستورالعمل پاسخ ===";
		$parts[] = 'فقط بر اساس داده‌های بالا جواب بده. اگر چیزی نبود صادقانه بگو.';
		$parts[] = 'برای قیمت و موجودی از کاتالوگ استفاده کن. برای پیگیری سفارش شماره سفارش بخواه.';
		$parts[] = 'می‌توانی از Markdown سبک استفاده کنی: **پررنگ**، لیست با - ، و لینک.';

		return implode( "\n", $parts );
	}

	/**
	 * Load scraper4.php AI subsystem as an in-memory module without rendering HTML.
	 *
	 * @return bool
	 */
	public static function load_scraper_ai_engine() {
		static $loaded = null;
		if ( null !== $loaded ) {
			return $loaded;
		}

		$scraper_file = plugin_dir_path( __FILE__ ) . 'scraper4.php';
		if ( ! file_exists( $scraper_file ) ) {
			$loaded = false;
			return false;
		}

		$loaded = self::require_scraper_module( $scraper_file )
			&& ( function_exists( 'aiMasterKey' ) || function_exists( 'aiCandidates' ) || function_exists( 'aiProviderCall' ) );
		return $loaded;
	}

	/**
	 * Retrieve candidate AI models and votes statistics from scraper4 subsystem / JSON storage.
	 *
	 * @return array
	 */
	public static function get_scraper_ai_candidates() {
		// Do not force-load scraper4.php here — JSON fallback is enough for chat/AJAX.
		$plugin_dir = plugin_dir_path( __FILE__ );

		// 1. Check if scraper4 functions are actively loaded
		if ( function_exists( 'aiCandidates' ) && function_exists( 'aiMasterKey' ) && function_exists( 'aiVotesLoad' ) ) {
			$cands     = aiCandidates();
			$votes     = aiVotesLoad();
			$master    = aiMasterKey();
			$providers = function_exists( 'aiProvidersLoad' ) ? aiProvidersLoad() : array();

			$items = array();
			foreach ( $cands as $c ) {
				$m_id   = $c['model'];
				$m_name = $m_id;
				if ( isset( $providers[ $c['provider'] ]['models'] ) ) {
					foreach ( $providers[ $c['provider'] ]['models'] as $mm ) {
						if ( ( $mm['id'] ?? '' ) === $m_id ) {
							$m_name = $mm['name'] ?? $m_id;
							break;
						}
					}
				}
				$s = $votes['scores'][ $c['key'] ] ?? array( 'wins' => 0, 'losses' => 0, 'votes' => 0 );
				$score = function_exists( 'aiScoreOf' ) ? aiScoreOf( $s ) : ( ! empty( $s['votes'] ) ? round( ( $s['wins'] ?? 0 ) / $s['votes'], 3 ) : 0.0 );
				$items[] = array(
					'provider'     => $c['provider'],
					'model'        => $c['model'],
					'key'          => $c['key'],
					'providerName' => $c['providerName'] ?? ucfirst( $c['provider'] ),
					'modelName'    => $m_name,
					'wins'         => (int) ( $s['wins'] ?? 0 ),
					'losses'       => (int) ( $s['losses'] ?? 0 ),
					'votes'        => (int) ( $s['votes'] ?? 0 ),
					'score'        => $score,
					'is_master'    => ( $c['key'] === $master ),
				);
			}

			usort( $items, function( $a, $b ) {
				if ( $a['is_master'] !== $b['is_master'] ) {
					return $a['is_master'] ? -1 : 1;
				}
				return $b['score'] <=> $a['score'];
			} );

			return array(
				'candidates' => $items,
				'master'     => $master,
				'pin'        => $votes['pin'] ?? '',
				'history'    => array_slice( array_reverse( (array) ( $votes['history'] ?? array() ) ), 0, 50 ),
			);
		}

		// 2. Direct JSON file fallback (connections.json / ai_votes.json / ai_providers.json)
		$conn_file  = $plugin_dir . 'connections.json';
		$votes_file = $plugin_dir . 'ai_votes.json';
		$prov_file  = $plugin_dir . 'ai_providers.json';

		$conn_data  = file_exists( $conn_file ) ? ( @json_decode( file_get_contents( $conn_file ), true ) ?: array() ) : array();
		$votes_data = file_exists( $votes_file ) ? ( @json_decode( file_get_contents( $votes_file ), true ) ?: array() ) : array();
		$prov_data  = file_exists( $prov_file ) ? ( @json_decode( file_get_contents( $prov_file ), true ) ?: array() ) : array();

		$master_key = (string) ( $votes_data['pin'] ?? ( $votes_data['master'] ?? '' ) );
		$raw_cands  = (array) ( $conn_data['ai_candidates'] ?? array() );

		if ( empty( $raw_cands ) ) {
			if ( ! empty( $conn_data['ai_selected']['provider'] ) && ! empty( $conn_data['ai_selected']['model'] ) ) {
				$raw_cands[] = array(
					'provider' => $conn_data['ai_selected']['provider'],
					'model'    => $conn_data['ai_selected']['model'],
				);
			}
		}

		$items  = array();
		$seen   = array();
		$scores = $votes_data['scores'] ?? array();

		foreach ( $raw_cands as $c ) {
			if ( ! is_array( $c ) ) continue;
			$p = trim( (string) ( $c['provider'] ?? '' ) );
			$m = trim( (string) ( $c['model'] ?? '' ) );
			if ( empty( $p ) || empty( $m ) ) continue;
			$k = $p . '::' . $m;
			if ( isset( $seen[ $k ] ) ) continue;
			$seen[ $k ] = 1;

			$p_info = $prov_data[ $p ] ?? array();
			$p_name = $p_info['name'] ?? ucfirst( $p );
			$m_name = $m;
			if ( ! empty( $p_info['models'] ) && is_array( $p_info['models'] ) ) {
				foreach ( $p_info['models'] as $mm ) {
					if ( ( $mm['id'] ?? '' ) === $m ) {
						$m_name = $mm['name'] ?? $m;
						break;
					}
				}
			}

			$s       = $scores[ $k ] ?? array( 'wins' => 0, 'losses' => 0, 'votes' => 0 );
			$v_count = (int) ( $s['votes'] ?? 0 );
			$w_count = (int) ( $s['wins'] ?? 0 );
			$score   = $v_count > 0 ? round( $w_count / $v_count, 3 ) : 0.0;

			$items[] = array(
				'provider'     => $p,
				'model'        => $m,
				'key'          => $k,
				'providerName' => $p_name,
				'modelName'    => $m_name,
				'wins'         => $w_count,
				'losses'       => (int) ( $s['losses'] ?? 0 ),
				'votes'        => $v_count,
				'score'        => $score,
				'is_master'    => ( $k === $master_key ),
			);
		}

		if ( empty( $master_key ) && ! empty( $items ) ) {
			$master_key = $items[0]['key'];
			$items[0]['is_master'] = true;
		}

		usort( $items, function( $a, $b ) {
			if ( $a['is_master'] !== $b['is_master'] ) {
				return $a['is_master'] ? -1 : 1;
			}
			return $b['score'] <=> $a['score'];
		} );

		return array(
			'candidates' => $items,
			'master'     => $master_key,
			'pin'        => $votes_data['pin'] ?? '',
			'history'    => array_slice( array_reverse( (array) ( $votes_data['history'] ?? array() ) ), 0, 50 ),
		);
	}

	/**
	 * Resolve first usable API key from scraper provider config (apiKey / apiKeys[] / keys[]).
	 *
	 * @param array|null $prov_cfg
	 * @param string     $fallback
	 * @return string
	 */
	public static function resolve_provider_api_key( $prov_cfg, $fallback = '' ) {
		if ( ! is_array( $prov_cfg ) ) {
			return trim( (string) $fallback );
		}
		// Prefer scraper's live helpers (apiKeys rotation + legacy apiKey mirror).
		if ( function_exists( 'aiProviderKeys' ) ) {
			$slots = aiProviderKeys( $prov_cfg );
			foreach ( (array) $slots as $sl ) {
				if ( isset( $sl['enabled'] ) && false === $sl['enabled'] ) {
					continue;
				}
				$k = trim( (string) ( $sl['key'] ?? '' ) );
				if ( $k !== '' ) {
					return $k;
				}
			}
		}
		$candidates = array();
		$legacy = trim( (string) ( $prov_cfg['apiKey'] ?? '' ) );
		if ( $legacy !== '' ) {
			$candidates[] = $legacy;
		}
		foreach ( array( 'apiKeys', 'keys' ) as $field ) {
			if ( empty( $prov_cfg[ $field ] ) || ! is_array( $prov_cfg[ $field ] ) ) {
				continue;
			}
			foreach ( $prov_cfg[ $field ] as $row ) {
				if ( is_array( $row ) ) {
					if ( isset( $row['enabled'] ) && false === $row['enabled'] ) {
						continue;
					}
					$k = trim( (string) ( $row['key'] ?? $row['api_key'] ?? $row['token'] ?? '' ) );
				} else {
					$k = trim( (string) $row );
				}
				if ( $k !== '' ) {
					$candidates[] = $k;
				}
			}
		}
		if ( ! empty( $candidates ) ) {
			return $candidates[0];
		}
		return trim( (string) $fallback );
	}

	/**
	 * Retrieve Master AI model directly from scraper4 (connections.json / ai_votes.json / ai_providers.json).
	 *
	 * @param array|null $settings
	 * @return array
	 */
	public static function get_scraper_master_ai_model( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		// Prefer JSON files first (fast). Only load scraper4 if helpers already exist.
		if ( ! function_exists( 'aiMasterKey' ) ) {
			// Soft-load only when explicitly needed later; candidates fall back to JSON.
		}

		$cands_info = self::get_scraper_ai_candidates();
		$master_key = $cands_info['master'];
		$pin_key    = $cands_info['pin'];

		$plugin_dir = plugin_dir_path( __FILE__ );
		$prov_data  = array();
		if ( function_exists( 'aiProvidersLoad' ) ) {
			try {
				$prov_data = aiProvidersLoad();
			} catch ( \Throwable $e ) {
				$prov_data = array();
			}
		}
		if ( empty( $prov_data ) || ! is_array( $prov_data ) ) {
			$prov_candidates = array(
				$plugin_dir . 'ai_providers.json',
				dirname( $plugin_dir ) . '/ai_providers.json',
				$plugin_dir . 'scraper/ai_providers.json',
				$plugin_dir . 'data/ai_providers.json',
			);
			// Also next to scraper4.php if agent is in a subfolder.
			$scraper = $plugin_dir . 'scraper4.php';
			if ( is_file( $scraper ) ) {
				$prov_candidates[] = dirname( $scraper ) . '/ai_providers.json';
			}
			foreach ( $prov_candidates as $prov_file ) {
				if ( is_readable( $prov_file ) ) {
					$decoded = @json_decode( (string) file_get_contents( $prov_file ), true );
					if ( is_array( $decoded ) && ! empty( $decoded ) ) {
						$prov_data = $decoded;
						break;
					}
				}
			}
		}
		if ( ! is_array( $prov_data ) ) {
			$prov_data = array();
		}

		$provider_id = '';
		$model_id    = '';
		if ( ! empty( $master_key ) && strpos( $master_key, '::' ) !== false ) {
			list( $provider_id, $model_id ) = explode( '::', $master_key, 2 );
		}

		$prov_cfg = null;
		if ( $provider_id !== '' && isset( $prov_data[ $provider_id ] ) && is_array( $prov_data[ $provider_id ] ) ) {
			$prov_cfg = $prov_data[ $provider_id ];
			if ( empty( $prov_cfg['id'] ) ) {
				$prov_cfg['id'] = $provider_id;
			}
		}

		$model_name = $model_id;
		if ( $prov_cfg && ! empty( $prov_cfg['models'] ) && is_array( $prov_cfg['models'] ) ) {
			foreach ( $prov_cfg['models'] as $m ) {
				if ( ( $m['id'] ?? '' ) === $model_id ) {
					$model_name = $m['name'] ?? $model_id;
					break;
				}
			}
		}

		// Match candidate stats
		$master_cand = null;
		foreach ( $cands_info['candidates'] as $c ) {
			if ( $c['key'] === $master_key ) {
				$master_cand = $c;
				break;
			}
		}

		$custom_key = trim( (string) ( $settings['ai_api_key'] ?? '' ) );
		$api_key    = self::resolve_provider_api_key( $prov_cfg, $custom_key );
		// Keep provider mirror in sync so aiProviderCall sees a key even when only apiKeys[] is filled.
		if ( is_array( $prov_cfg ) && $api_key !== '' && trim( (string) ( $prov_cfg['apiKey'] ?? '' ) ) === '' ) {
			$prov_cfg['apiKey'] = $api_key;
		}

		$endpoint = '';
		if ( is_array( $prov_cfg ) ) {
			$endpoint = trim( (string) ( $prov_cfg['endpoint'] ?? '' ) );
			if ( $endpoint === '' ) {
				$endpoint = trim( (string) ( $prov_cfg['url'] ?? '' ) );
			}
			// Build OpenAI-compatible chat URL the same way scraper does.
			if ( $endpoint !== '' && function_exists( 'aiProviderEndpoint' ) ) {
				$ep = aiProviderEndpoint( $prov_cfg, $model_id );
				if ( ! empty( $ep['url'] ) && ( $ep['kind'] ?? '' ) !== 'cloudflare' ) {
					$endpoint = (string) $ep['url'];
				}
			} elseif ( $endpoint !== '' && ! preg_match( '~/chat/completions/?$~i', $endpoint )
				&& ! preg_match( '~/ai/run~i', $endpoint ) ) {
				$path = (string) ( parse_url( $endpoint, PHP_URL_PATH ) ?: '' );
				if ( $path === '' || $path === '/' || preg_match( '~/v\d+(\.\d+)?/?$~i', $path ) ) {
					$endpoint = rtrim( $endpoint, '/' ) . '/chat/completions';
				}
			}
		}
		if ( $endpoint === '' ) {
			$endpoints_map = array(
				'openrouter' => 'https://openrouter.ai/api/v1/chat/completions',
				'groq'       => 'https://api.groq.com/openai/v1/chat/completions',
				'deepseek'   => 'https://api.deepseek.com/chat/completions',
				'openai'     => 'https://api.openai.com/v1/chat/completions',
				'gemini'     => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
				'ollama'     => 'http://127.0.0.1:11434/v1/chat/completions',
			);
			$endpoint = $endpoints_map[ $provider_id ] ?? 'https://openrouter.ai/api/v1/chat/completions';
		}

		$has_live = ( $api_key !== '' )
			|| ( strpos( $endpoint, '127.0.0.1' ) !== false )
			|| ( strpos( $endpoint, 'localhost' ) !== false )
			|| ( is_array( $prov_cfg ) && function_exists( 'aiProviderKeys' ) && count( aiProviderKeys( $prov_cfg ) ) > 0 )
			|| ( is_array( $prov_cfg ) && ! empty( $prov_cfg ) );

		return array(
			'provider_id'   => $provider_id ?: 'openrouter',
			'model_id'      => $model_id ?: 'meta-llama/llama-3.3-70b-instruct:free',
			'key'           => $master_key ?: 'openrouter::meta-llama/llama-3.3-70b-instruct:free',
			'model_name'    => $model_name ?: 'Llama 3.3 70B (رایگان)',
			'provider_name' => ( is_array( $prov_cfg ) && ! empty( $prov_cfg['name'] ) ) ? (string) $prov_cfg['name'] : ( ( is_array( $master_cand ) && ! empty( $master_cand['providerName'] ) ) ? (string) $master_cand['providerName'] : ucfirst( $provider_id ?: 'openrouter' ) ),
			'api_key'       => $api_key,
			'endpoint'      => trim( (string) $endpoint ),
			'provider'      => $prov_cfg,
			'is_pinned'     => ( $pin_key === $master_key && $master_key !== '' ),
			'score'         => $master_cand['score'] ?? 0,
			'wins'          => $master_cand['wins'] ?? 0,
			'losses'        => $master_cand['losses'] ?? 0,
			'votes'         => $master_cand['votes'] ?? 0,
			'source'        => 'scraper4_master',
			'has_live'      => $has_live,
		);
	}


	
	/**
	 * Lightweight OpenAI-compatible chat completion via WordPress HTTP API.
	 * Used by storefront chat so we never depend on loading scraper4.php first.
	 *
	 * @param string $endpoint
	 * @param string $api_key
	 * @param string $model_id
	 * @param array  $payload
	 * @param string $site_name
	 * @return string
	 */
	public static function call_ai_api_http( $endpoint, $api_key, $model_id, $payload, $site_name = '' ) {
		if ( ! function_exists( 'wp_remote_post' ) ) {
			return '';
		}
		$endpoint = trim( (string) $endpoint );
		if ( $endpoint === '' ) {
			$endpoint = 'https://openrouter.ai/api/v1/chat/completions';
		}
		// If base URL without /chat/completions, append it (except Cloudflare native).
		if ( ! preg_match( '~/chat/completions/?$~i', $endpoint )
			&& ! preg_match( '~/ai/run~i', $endpoint )
			&& ! preg_match( '~:generateContent~i', $endpoint ) ) {
			$path = (string) ( parse_url( $endpoint, PHP_URL_PATH ) ?: '' );
			if ( $path === '' || $path === '/' || preg_match( '~/v\d+(\.\d+)?/?$~i', $path ) ) {
				$endpoint = rtrim( $endpoint, '/' ) . '/chat/completions';
			}
		}
		if ( empty( $payload['model'] ) && $model_id !== '' ) {
			$payload['model'] = $model_id;
		}
		$headers = array(
			'Content-Type' => 'application/json; charset=utf-8',
			'Accept'       => 'application/json',
		);
		$api_key = trim( (string) $api_key );
		if ( $api_key !== '' && strtolower( $api_key ) !== 'ollama' ) {
			$headers['Authorization'] = 'Bearer ' . $api_key;
		}
		if ( strpos( $endpoint, 'openrouter.ai' ) !== false ) {
			$headers['HTTP-Referer'] = function_exists( 'home_url' ) ? home_url() : '';
			$headers['X-Title']      = $site_name !== '' ? $site_name : 'Storefront Chat';
		}
		$response = wp_remote_post( $endpoint, array(
			'method'    => 'POST',
			'timeout'   => 28,
			'headers'   => $headers,
			'body'      => function_exists( 'wp_json_encode' ) ? wp_json_encode( $payload ) : json_encode( $payload ),
			'sslverify' => false,
		) );
		if ( is_wp_error( $response ) ) {
			error_log( 'AMPHP call_ai_api_http: ' . $response->get_error_message() );
			return '';
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$json = @json_decode( $body, true );
		if ( ! is_array( $json ) ) {
			error_log( 'AMPHP call_ai_api_http bad body HTTP ' . $code . ': ' . substr( (string) $body, 0, 200 ) );
			return '';
		}
		$text = '';
		if ( ! empty( $json['choices'][0]['message']['content'] ) ) {
			$text = trim( (string) $json['choices'][0]['message']['content'] );
		} elseif ( ! empty( $json['choices'][0]['text'] ) ) {
			$text = trim( (string) $json['choices'][0]['text'] );
		} elseif ( ! empty( $json['response'] ) ) {
			$text = trim( (string) $json['response'] );
		} elseif ( ! empty( $json['error']['message'] ) ) {
			error_log( 'AMPHP AI provider error: ' . $json['error']['message'] );
			return '';
		}
		if ( $text === '' ) {
			return '';
		}
		$text = preg_replace( '/<think>.*?<\/think>/si', '', $text );
		return trim( $text );
	}

/**
	 * Call Live AI Provider API via scraper4 engine (preferred) or WordPress HTTP fallback.
	 * Uses the same master model path as scraper4 tests: key rotation, DoH/proxy, aiExtractAnswer.
	 *
	 * @param array  $master_ai
	 * @param string $message
	 * @param string $customer_name
	 * @param array  $settings
	 * @return string
	 */
	public static function call_ai_api( $master_ai, $message, $customer_name, $settings ) {
		$endpoint = (string) ( $master_ai['endpoint'] ?? '' );
		$api_key  = (string) ( $master_ai['api_key'] ?? '' );
		$model_id = (string) ( $master_ai['model_id'] ?? '' );
		$prov_cfg = isset( $master_ai['provider'] ) && is_array( $master_ai['provider'] ) ? $master_ai['provider'] : null;

		if ( empty( $endpoint ) ) {
			$endpoint = 'https://openrouter.ai/api/v1/chat/completions';
		}

		$site_name = function_exists( 'get_bloginfo' ) ? ( get_bloginfo( 'name' ) ?: ( $settings['shop_title'] ?? 'فروشگاه اینترنتی' ) ) : ( $settings['shop_title'] ?? 'فروشگاه اینترنتی' );
		$catalog_ctx = '';
		try {
			$catalog_ctx = self::build_catalog_context_for_ai( 25 );
		} catch ( \Throwable $e ) {
			$catalog_ctx = '(کاتالوگ موقتاً در دسترس نیست)';
		}
		$threshold = number_format( (float) ( $settings['free_shipping_threshold'] ?? 400000 ) );
		$currency  = $settings['currency_symbol'] ?? 'تومان';

		$base_user_prompt = ! empty( $settings['ai_system_prompt'] )
			? $settings['ai_system_prompt']
			: "تو دستیار هوشمند و کارشناس فروش رسمی فروشگاه اینترنتی «{$site_name}» هستی.";
		$system_prompt = $base_user_prompt . "\n"
			. "نام مشتری: «{$customer_name}»\n"
			. "ارسال رایگان برای خریدهای بالای {$threshold} {$currency}.\n"
			. "ضمانت ۷ روز بازگشت و اصالت کالا.\n\n"
			. "داده ثبت‌شده فروشگاه (ممکن است قدیمی باشد):\n"
			. $catalog_ctx . "\n\n"
			. "قوانین پاسخ:\n"
			. "۱. فقط بر اساس داده بالا جواب بده؛ اگر نبود بگو در دسترس نیست.\n"
			. "۲. قیمت، موجودی و تنوع کاتالوگ زنده نیستند؛ هرگز آنها را تأییدشده یا موجود اعلام نکن و برای بررسی محصول، انتخاب آن در ویترین یا نام کامل را بخواه.\n"
			. "۳. برای پیگیری سفارش، شماره سفارش یا موبایل بخواه و از بخش سفارش‌ها استفاده کن.\n"
			. "۴. لحن گرم، حرفه‌ای و فارسی. خودت را ربات معرفی نکن.\n"
			. "۵. می‌توانی Markdown سبک بنویسی: **پررنگ**، لیست با - یا ۱. ، `کد`، و لینک [متن](url).\n"
			. "۶. پاسخ را خوانا و ساخت‌یافته نگه دار (نه یک پاراگراف شلوغ).";

		$payload = array(
			'model'       => $model_id,
			'messages'    => array(
				array( 'role' => 'system', 'content' => $system_prompt ),
				array( 'role' => 'user', 'content' => $message ),
			),
			'max_tokens'  => 700,
			'temperature' => 0.7,
		);

		// v13.3.9: FAST PATH first — wp_remote_post with resolved key (no 4MB scraper4 include).
		// Scraper engine is heavy and can timeout shared-host AJAX before JSON returns.
		$fast = self::call_ai_api_http( $endpoint, $api_key, $model_id, $payload, $site_name );
		if ( $fast !== '' ) {
			return $fast;
		}

		// Optional scraper4 engine — only if already loaded (never require 4MB scraper4 mid-AJAX).
		if ( function_exists( 'aiProviderCall' ) && is_array( $prov_cfg ) && ! empty( $prov_cfg ) ) {
			if ( empty( $prov_cfg['id'] ) && ! empty( $master_ai['provider_id'] ) ) {
				$prov_cfg['id'] = $master_ai['provider_id'];
			}
			if ( $api_key !== '' && trim( (string) ( $prov_cfg['apiKey'] ?? '' ) ) === '' ) {
				$prov_cfg['apiKey'] = $api_key;
			}
			if ( empty( $prov_cfg['url'] ) && ! empty( $prov_cfg['endpoint'] ) ) {
				$prov_cfg['url'] = $prov_cfg['endpoint'];
			}
			try {
				$r = aiProviderCall( $prov_cfg, $model_id, $payload );
				$text = '';
				if ( function_exists( 'aiExtractAnswer' ) ) {
					$text = trim( (string) aiExtractAnswer( $r['body'] ?? null ) );
				} elseif ( function_exists( 'aiExtractText' ) ) {
					$text = trim( (string) aiExtractText( $r['body'] ?? null ) );
				}
				if ( $text === '' && ! empty( $r['body'] ) && is_array( $r['body'] ) ) {
					$b = $r['body'];
					if ( ! empty( $b['choices'][0]['message']['content'] ) ) {
						$text = trim( (string) $b['choices'][0]['message']['content'] );
					} elseif ( ! empty( $b['choices'][0]['text'] ) ) {
						$text = trim( (string) $b['choices'][0]['text'] );
					} elseif ( ! empty( $b['response'] ) ) {
						$text = trim( (string) $b['response'] );
					}
				}
				if ( $text !== '' ) {
					$text = preg_replace( '/<think>.*?<\/think>/si', '', $text );
					return trim( $text );
				}
			} catch ( \Throwable $e ) {
				error_log( 'AMPHP call_ai_api scraper engine: ' . $e->getMessage() );
			}
		}

		// Final HTTP retry (same as fast path).
		return self::call_ai_api_http( $endpoint, $api_key, $model_id, $payload, $site_name );
	}


	/**
	 * Intelligent Dynamic E-Commerce NLP Engine (Analyzes Catalog, Prices, Features & Query).
	 * Eliminates hardcoded canned templates and provides customized, contextual assistance.
	 *
	 * @param string $message
	 * @param string $customer_name
	 * @param array  $settings
	 * @return string
	 */
	public static function generate_smart_local_reply( $message, $customer_name, $settings ) {
		$site_name = get_bloginfo( 'name' ) ?: ( $settings['shop_title'] ?? 'فروشگاه ما' );
		$threshold = (float) ( $settings['free_shipping_threshold'] ?? 400000 );
		$threshold_formatted = number_format( $threshold ) . ' تومان';
		$currency  = $settings['currency_symbol'] ?? 'تومان';

		$msg_raw   = trim( $message );
		$msg_lower = mb_strtolower( $msg_raw, 'UTF-8' );

		$name_clean = trim( $customer_name );
		if ( empty( $name_clean ) || 'کاربر مهمان' === $name_clean ) {
			$name_clean = '';
		}
		$name_greeting = ! empty( $name_clean ) ? "{$name_clean} عزیز" : 'گرامی';

		$has_greeting = (bool) preg_match( '/(سلام|درود|وقت بخیر|صبح بخیر|عصر بخیر|روز بخیر|سلام علیکم)/u', $msg_lower );
		$greeting_prefix = $has_greeting ? "سلام {$name_greeting}، به {$site_name} خوش آمدید! 🌸 " : '';

		$products = array();
		try {
			$products = self::get_all_scraped_products();
			if ( ! is_array( $products ) ) {
				$products = array();
			}
		} catch ( \Throwable $e ) {
			$products = array();
		}

		// Stopwords that shouldn't match product titles
		$stop_words = array(
			'سلام', 'درود', 'صبح', 'بخیر', 'عصر', 'وقت', 'این', 'رو', 'داری', 'دارید', 'هست', 'هستید',
			'قیمت', 'چنده', 'چقدره', 'میخوام', 'لطفا', 'ممنون', 'خرید', 'تومان', 'محصولات', 'کالاها',
			'چی', 'چه', 'چیزهایی', 'ضمانت', 'گارانتی', 'ارسال', 'پست', 'سفارش', 'پیگیری', 'کد', 'تخفیف',
			'آیا', 'کدام', 'کدوم', 'برای', 'میشه', 'دارن', 'داشته', 'باشه'
		);

		// Clean query tokens
		$clean_q = preg_replace( '/[^\p{L}\p{N}\s]/u', ' ', $msg_lower );
		$raw_tokens = preg_split( '/\s+/u', $clean_q, -1, PREG_SPLIT_NO_EMPTY );
		$q_tokens = array();
		foreach ( $raw_tokens as $t ) {
			if ( mb_strlen( $t ) > 1 && ! in_array( $t, $stop_words, true ) ) {
				$q_tokens[] = $t;
			}
		}

		// 1. Match against products in catalog
		$matches = array();
		if ( ! empty( $products ) && ! empty( $q_tokens ) ) {
			foreach ( $products as $p ) {
				$title_low = mb_strtolower( $p['title'] ?? '', 'UTF-8' );
				$cat_low   = mb_strtolower( $p['category'] ?? '', 'UTF-8' );
				$desc_low  = mb_strtolower( $p['description'] ?? '', 'UTF-8' );

				$score = 0;
				foreach ( $q_tokens as $token ) {
					if ( mb_strpos( $title_low, $token ) !== false ) {
						$score += 3;
					} elseif ( mb_strpos( $cat_low, $token ) !== false ) {
						$score += 2;
					} elseif ( mb_strpos( $desc_low, $token ) !== false ) {
						$score += 1;
					}
				}

				if ( $score > 0 ) {
					$matches[] = array( 'score' => $score, 'product' => $p );
				}
			}

			usort( $matches, function( $a, $b ) {
				return $b['score'] <=> $a['score'];
			} );
		}

		// If a matching product was found in catalog with solid score
		if ( ! empty( $matches ) && $matches[0]['score'] >= 2 ) {
			$top_p = $matches[0]['product'];
			$p_title = $top_p['title'];
			$p_price = ! empty( $top_p['price_formatted'] ) ? $top_p['price_formatted'] : ( number_format( (float) ( $top_p['price'] ?? 0 ) ) . ' تومان' );
			$has_disc = ! empty( $top_p['has_discount'] ) && ! empty( $top_p['discount_pct'] );
			$disc_pct = $top_p['discount_pct'] ?? 0;
			$desc     = $top_p['description'] ?? '';
			$desc_low = mb_strtolower( $desc, 'UTF-8' );

			$reply = $greeting_prefix . "درباره «{$p_title}»، اطلاعات ثبت‌شده در کاتالوگ، قیمت {$p_price} را نشان می‌دهد؛ قیمت و موجودی فعلی باید تأیید شود.";
			if ( $has_disc && $disc_pct > 0 ) {
				$reply .= " (این کالا دارای {$disc_pct}٪ تخفیف ویژه می‌باشد).";
			}

			// Specific feature inquiries
			if ( preg_match( '/(ضد آب|ضداب|waterproof|ip6)/u', $msg_lower ) ) {
				if ( mb_strpos( $desc_low, 'ضد آب' ) !== false || mb_strpos( $desc_low, 'ip6' ) !== false ) {
					$reply .= " 💧 این محصول دارای استاندارد مقاومت در برابر نفوذ آب است.";
				} else {
					$reply .= " ℹ️ توصیه می‌شود این محصول دور از تماس مستقیم با رطوبت و آب نگهداری شود.";
				}
			}

			if ( preg_match( '/(مکالمه|تماس|میکروفون|صدا)/u', $msg_lower ) ) {
				if ( mb_strpos( $desc_low, 'مکالمه' ) !== false || mb_strpos( $desc_low, 'میکروفون' ) !== false ) {
					$reply .= " 📞 این کالا قابلیت مکالمه باکیفیت و شفاف را پشتیبانی می‌کند.";
				}
			}

			if ( preg_match( '/(باتری|شارژ|شارژدهی|میلی‌آمپر)/u', $msg_lower ) ) {
				$reply .= " 🔋 این کالا از باتری بادوام با کارایی و بازدهی بالا بهره می‌برد.";
			}

			$p_num_price = (float) ( $top_p['price'] ?? 0 );
			if ( $p_num_price >= $threshold ) {
				$reply .= " همچنین به دلیل مبلغ سفارش، ارسال این کالا کاملاً رایگان خواهد بود! 🚚";
			}

			$reply .= " برای خرید آنلاین، کافی است در کارت محصول دکمه «خرید آنلاین» را لمس فرمایید.";
			return $reply;
		}

		// 2. Shipping & Delivery
		if ( preg_match( '/(ارسال|پست|تیپاکس|هزینه ارسال|چند روزه|کی میرسه|زمان تحویل|تحویل سفارش)/u', $msg_lower ) ) {
			return $greeting_prefix . "کلیه سفارش‌ها با بسته‌بندی ایمن و ضربه‌گیر از طریق پست پیشتاز و تیپاکس ظرف ۲ الی ۳ روز کاری تحویل می‌گردند. برای خریدهای بالای {$threshold_formatted} هزینه ارسال کاملاً رایگان است. 🚚";
		}

		// 3. Order Tracking
		if ( preg_match( '/(پیگیری|کد رهگیری|سفارشم|کجاست|فاکتور|شماره سفارش)/u', $msg_lower ) ) {
			return $greeting_prefix . "برای پیگیری لحظه‌ای وضعیت سفارش، می‌توانید از منوی بالای صفحه دکمه «پیگیری سفارش» را لمس فرمایید یا شماره سفارش خود را اینجا ارسال کنید تا وضعیت مرسوله را فوراً استعلام بگیریم. 📦";
		}

		// 4. Discounts & Pricing General
		if ( preg_match( '/(تخفیف|کد تخفیف|قیمت مناسب|ارزان|حراج|پیشنهاد ویژه)/u', $msg_lower ) ) {
			$disc_items = array();
			foreach ( $products as $p ) {
				if ( ! empty( $p['has_discount'] ) ) $disc_items[] = $p;
			}
			if ( ! empty( $disc_items ) ) {
				usort( $disc_items, function( $a, $b ) {
					return ( $b['discount_pct'] ?? 0 ) <=> ( $a['discount_pct'] ?? 0 );
				} );
				$top_disc = $disc_items[0];
				$pct = $top_disc['discount_pct'] ?? 0;
				return $greeting_prefix . "تمامی قیمت‌های سایت با تخفیف‌های ویژه فروشگاه اعمال شده‌اند! بیشترین تخفیف هم‌اکنون مربوط به «{$top_disc['title']}» با {$pct}٪ تخفیف است. حتماً بخش پیشنهادهای شگفت‌انگیز را بررسی نمایید! ✨";
			}
			return $greeting_prefix . "تمامی قیمت‌های درج شده در سایت رقابتی بوده و تخفیف‌های نقدی مستقیماً روی سبد خرید اعمال می‌شوند.";
		}

				// 5. Guarantee & Returns
		if ( preg_match( '/(گارانتی|ضمانت|مرجوع|بازگشت|خراب|اصل|اورجینال|مهلت تست)/u', $msg_lower ) ) {
			return $greeting_prefix . "تمامی کالاهای فروشگاه دارای ۷ روز مهلت تست و ضمانت بازگشت وجه، تضمین اصالت فیزیکی و پشتیبانی کامل هستند تا خریدی با آرامش خاطر را تجربه کنید. 🛡️";
		}

		// 6. Payment methods
		if ( preg_match( '/(پرداخت|درگاه|کارت به کارت|انتقال|چطور پرداخت|امن|بانک|شاپرک)/u', $msg_lower ) ) {
			return $greeting_prefix . "پرداخت سفارش‌ها به صورت کاملاً امن و آنی از طریق کلیه کارت‌های عضو شتاب در درگاه رسمی شاپرک انجام می‌شود. 💳";
		}

		// 7. Catalog & Categories Overview
		if ( preg_match( '/(چه محصولاتی|چه کالاهایی|لیست محصولات|چی دارید|چه چیزهایی|موجودی فروشگاه|دسته‌بندی|دسته بندی|لیست کالاها|همه محصولات)/u', $msg_lower ) ) {
			$cats = array();
			foreach ( $products as $p ) {
				$c = $p['category'] ?? 'عمومی';
				$cats[ $c ] = true;
			}
			$cats_keys = array_keys( $cats );
			$cats_str  = implode( '، ', array_slice( $cats_keys, 0, 4 ) );
			$total_cnt = count( $products );
			return $greeting_prefix . "ما تنوعی از کالاهای باکیفیت در دسته‌بندی‌های {$cats_str} را عرضه می‌کنیم. هم‌اکنون {$total_cnt} محصول منتخب در انبار موجود است که می‌توانید با دکمه دسته‌بندی‌ها در منوی بالا آن‌ها را مشاهده نمایید. 🛍️";
		}

// 8. Greeting only
		if ( $has_greeting && empty( $q_tokens ) ) {
			$feat_item = ! empty( $products[0]['title'] ) ? " هم‌اکنون محصول «{$products[0]['title']}» با تخفیف ویژه در انبار موجود است." : '';
			return $greeting_prefix . "در خدمت شما هستیم.{$feat_item} هرگونه سوالی درباره مشخصات کالاها، استعلام قیمت یا ثبت سفارش دارید بفرمایید تا فوراً راهنمایی‌تان کنیم! 🌸";
		}

		// 9. Dynamic Contextual Fallback incorporating customer query
		$preview_msg = mb_substr( $msg_raw, 0, 45 ) . ( mb_strlen( $msg_raw ) > 45 ? '...' : '' );
		return $greeting_prefix . "درباره پیام شما («{$preview_msg}»)، اطلاعات شما به همکاران پشتیبانی فروشگاه نیز ارسال شد تا در صورت نیاز با شما تماس بگیرند. برای بررسی سریع کالاها نیز می‌توانید از منوی بالای صفحه یا جستجوی سریع استفاده نمایید. 🙏";
	}

	/**
	 * Generate AI Support Reply (Connecting to Master Model or Dynamic NLP Engine).
	 *
	 * @param string $message
	 * @param string $customer_name
	 * @param array|null $settings
	 * @return string
	 */
	public static function generate_ai_support_reply( $message, $customer_name = '', $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		$coordination = $settings['ai_coordination_mode'] ?? 'ai_first';
		if ( 'human_only' === $coordination ) {
			return '';
		}

		// 1. Resolve master AI configuration (loads scraper4 engine + apiKeys)
		$master_ai = self::get_scraper_master_ai_model( $settings );

		// 2. Always try live master model when scraper provider config / key / local endpoint is present
		$try_live = ! empty( $master_ai['has_live'] )
			|| ! empty( $master_ai['api_key'] )
			|| ( is_array( $master_ai['provider'] ?? null ) && ! empty( $master_ai['provider'] ) )
			|| strpos( (string) ( $master_ai['endpoint'] ?? '' ), '127.0.0.1' ) !== false
			|| strpos( (string) ( $master_ai['endpoint'] ?? '' ), 'localhost' ) !== false;

		if ( $try_live ) {
			$reply = self::call_ai_api( $master_ai, $message, $customer_name, $settings );
			if ( ! empty( $reply ) ) {
				return $reply;
			}
		}

		// 3. Only if live AI failed: local catalog NLP (not preferred for storefront)
		if ( 'ai_only' === $coordination ) {
			return 'متأسفانه ارتباط با پشتیبان هوشمند برقرار نشد. لطفاً چند لحظه بعد دوباره پیام بفرستید.';
		}
		return self::generate_smart_local_reply( $message, $customer_name, $settings );
	}


	/**
	 * AJAX endpoint for live testing AI chat in Admin Tab 4.
	 */
	public static function ajax_test_ai_chat() {
		// Never let notices/fatals turn into jQuery "connection error".
		while ( function_exists( 'ob_get_level' ) && ob_get_level() > 0 ) {
			@ob_end_clean();
		}
		@ob_start();
		@ini_set( 'display_errors', '0' );
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 120 );
		}

		if ( ! empty( $_POST['nonce'] ) ) {
			check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce', false );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			while ( ob_get_level() > 0 ) { @ob_end_clean(); }
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$message = sanitize_text_field( wp_unslash( $_POST['message'] ?? '' ) );
		if ( $message === '' ) {
			while ( ob_get_level() > 0 ) { @ob_end_clean(); }
			wp_send_json_error( 'متن پیام خالی است.' );
		}

		$settings   = self::get_settings();
		$t0         = microtime( true );
		$reply      = '';
		$master_ai  = array();
		$model_label = 'مدل هوشمند مستر اسکرپر';
		$err        = '';

		try {
			$master_ai = self::get_scraper_master_ai_model( $settings );
			$model_label = ! empty( $master_ai['model_name'] ) ? $master_ai['model_name'] : $model_label;
			$reply = self::generate_ai_support_reply( $message, 'کاربر آزمایشی', $settings );
		} catch ( \Throwable $e ) {
			$err = $e->getMessage();
			error_log( 'AMPHP ajax_test_ai_chat: ' . $err );
			try {
				$reply = self::generate_smart_local_reply( $message, 'کاربر آزمایشی', $settings );
				$model_label = 'پاسخ محلی (fallback)';
			} catch ( \Throwable $e2 ) {
				$reply = 'خطا در تولید پاسخ: ' . $e2->getMessage();
			}
		}

		if ( ! is_string( $reply ) || trim( $reply ) === '' ) {
			$reply = 'پاسخی از مدل مستر دریافت نشد. کلید API ارائه‌دهندهٔ مستر را در اسکرپر (ai_providers.json) یا فیلد کلید AI افزونه بررسی کنید.'
				. ( $err !== '' ? ( ' جزئیات: ' . $err ) : '' );
		}

		$time_ms = (int) round( ( microtime( true ) - $t0 ) * 1000 );
		while ( function_exists( 'ob_get_level' ) && ob_get_level() > 0 ) {
			@ob_end_clean();
		}
		wp_send_json_success( array(
			'reply'     => $reply,
			'model'     => $model_label,
			'provider'  => is_array( $master_ai ) ? ( $master_ai['provider_name'] ?? 'اسکرپر' ) : 'اسکرپر',
			'key'       => is_array( $master_ai ) ? ( $master_ai['key'] ?? '' ) : '',
			'score'     => is_array( $master_ai ) ? ( $master_ai['score'] ?? 0 ) : 0,
			'is_pinned' => is_array( $master_ai ) ? ( ! empty( $master_ai['is_pinned'] ) ) : false,
			'source'    => is_array( $master_ai ) ? ( $master_ai['source'] ?? 'scraper4_master' ) : 'local',
			'took_ms'   => $time_ms,
			'api_ready' => is_array( $master_ai ) && ! empty( $master_ai['api_key'] ),
			'endpoint'  => is_array( $master_ai ) ? (string) ( $master_ai['endpoint'] ?? '' ) : '',
			'error'     => $err,
		) );
	}

	/**
	 * AJAX endpoint for comparing all candidate AI models side-by-side with catalog grounding.
	 */
	public static function ajax_compare_ai_candidates() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$message = sanitize_text_field( $_POST['message'] ?? '' );
		if ( empty( $message ) ) {
			wp_send_json_error( 'متن پیام خالی است.' );
		}

		$settings   = self::get_settings();
		$cands_info = self::get_scraper_ai_candidates();
		$candidates = $cands_info['candidates'] ?? array();

		if ( empty( $candidates ) ) {
			wp_send_json_error( 'هیچ مدل کاندیدی در سیستم هوش مصنوعی اسکرپر۴ یافت نشد.' );
		}

		$plugin_dir = plugin_dir_path( __FILE__ );
		$prov_file  = $plugin_dir . 'ai_providers.json';
		$prov_data  = file_exists( $prov_file ) ? ( @json_decode( file_get_contents( $prov_file ), true ) ?: array() ) : array();

		$results = array();
		foreach ( $candidates as $c ) {
			$t0   = microtime( true );
			$p_id = $c['provider'];
			$m_id = $c['model'];
			$p_cfg = $prov_data[ $p_id ] ?? array();

			if ( is_array( $p_cfg ) && empty( $p_cfg['id'] ) ) {
				$p_cfg['id'] = $p_id;
			}
			$cand_master = array(
				'provider_id' => $p_id,
				'model_id'    => $m_id,
				'model_name'  => $c['modelName'],
				'api_key'     => self::resolve_provider_api_key( $p_cfg, (string) ( $settings['ai_api_key'] ?? '' ) ),
				'endpoint'    => $p_cfg['endpoint'] ?? ( $p_cfg['url'] ?? '' ),
				'provider'    => $p_cfg,
				'has_live'    => true,
			);

			$reply = '';
			if ( ! empty( $cand_master['api_key'] ) || ! empty( $p_cfg ) || strpos( (string) $cand_master['endpoint'], '127.0.0.1' ) !== false ) {
				$reply = self::call_ai_api( $cand_master, $message, 'کاربر آزمایشی', $settings );
			}
			if ( empty( $reply ) ) {
				$reply = self::generate_smart_local_reply( $message, 'کاربر آزمایشی', $settings );
			}

			$time_ms = (int) round( ( microtime( true ) - $t0 ) * 1000 );
			$results[] = array(
				'key'          => $c['key'],
				'provider'     => $c['provider'],
				'model'        => $c['model'],
				'providerName' => $c['providerName'],
				'modelName'    => $c['modelName'],
				'score'        => $c['score'],
				'wins'         => $c['wins'],
				'losses'       => $c['losses'],
				'votes'        => $c['votes'],
				'is_master'    => $c['is_master'],
				'latency'      => $time_ms,
				'text'         => $reply,
			);
		}

		wp_send_json_success( array(
			'master'     => $cands_info['master'],
			'pin'        => $cands_info['pin'],
			'candidates' => $results,
		) );
	}

	/**
	 * AJAX endpoint for recording a vote for an AI candidate model (Scraper4 AI voting system).
	 */
	public static function ajax_vote_ai_candidate() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$winner     = sanitize_text_field( $_POST['winner'] ?? '' );
		$task       = sanitize_text_field( $_POST['task'] ?? 'autoreply' );
		$input_text = sanitize_text_field( $_POST['input'] ?? '' );
		$raw_cands  = (array) ( $_POST['candidates'] ?? array() );
		$cands      = array_map( 'sanitize_text_field', $raw_cands );

		if ( empty( $winner ) || empty( $cands ) ) {
			wp_send_json_error( 'اطلاعات رای‌دهی نامعتبر است.' );
		}

		self::load_scraper_ai_engine();
		if ( function_exists( 'aiVoteRecord' ) ) {
			$v = aiVoteRecord( $task, $input_text, $winner, $cands );
			wp_send_json_success( array(
				'master'  => $v['master'] ?? '',
				'pin'     => $v['pin'] ?? '',
				'scores'  => $v['scores'] ?? array(),
				'message' => 'رای شما با موفقیت ثبت شد و رتبه‌بندی مدل مستر در اسکرپر به‌روز گردید.',
			) );
		}

		$plugin_dir = plugin_dir_path( __FILE__ );
		$votes_file = $plugin_dir . 'ai_votes.json';
		$v = file_exists( $votes_file ) ? ( @json_decode( file_get_contents( $votes_file ), true ) ?: array() ) : array();

		if ( ! isset( $v['scores'] ) || ! is_array( $v['scores'] ) ) {
			$v['scores'] = array();
		}
		if ( ! in_array( $winner, $cands, true ) ) {
			$cands[] = $winner;
		}

		foreach ( $cands as $k ) {
			if ( empty( $k ) ) continue;
			if ( ! isset( $v['scores'][ $k ] ) || ! is_array( $v['scores'][ $k ] ) ) {
				$v['scores'][ $k ] = array( 'wins' => 0, 'losses' => 0, 'votes' => 0, 'last_at' => 0 );
			}
			$v['scores'][ $k ]['votes']   = (int) ( $v['scores'][ $k ]['votes'] ?? 0 ) + 1;
			$v['scores'][ $k ]['last_at'] = time();
			if ( $k === $winner ) {
				$v['scores'][ $k ]['wins'] = (int) ( $v['scores'][ $k ]['wins'] ?? 0 ) + 1;
			} else {
				$v['scores'][ $k ]['losses'] = (int) ( $v['scores'][ $k ]['losses'] ?? 0 ) + 1;
			}
			$votes_count = $v['scores'][ $k ]['votes'];
			$v['scores'][ $k ]['score'] = $votes_count > 0 ? round( (int) ( $v['scores'][ $k ]['wins'] ?? 0 ) / $votes_count, 3 ) : 0.0;
		}

		$v['history'][] = array(
			'at'         => time(),
			'task'       => $task,
			'input'      => mb_substr( $input_text, 0, 150 ),
			'winner'     => $winner,
			'candidates' => $cands,
		);
		if ( count( $v['history'] ) > 200 ) {
			$v['history'] = array_slice( $v['history'], -200 );
		}

		if ( empty( $v['pin'] ) ) {
			$best   = '';
			$best_s = -1.0;
			foreach ( $v['scores'] as $sk => $sd ) {
				if ( ( $sd['score'] ?? 0 ) > $best_s ) {
					$best_s = $sd['score'];
					$best   = $sk;
				}
			}
			if ( ! empty( $best ) ) {
				$v['master'] = $best;
			}
		}

		$v['updated_at'] = time();
		@file_put_contents( $votes_file, wp_json_encode( $v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );

		wp_send_json_success( array(
			'master'  => $v['master'] ?? $winner,
			'pin'     => $v['pin'] ?? '',
			'scores'  => $v['scores'] ?? array(),
			'message' => 'رای شما با موفقیت ثبت شد و مدل مستر در اسکرپر به‌روز گردید.',
		) );
	}

	/**
	 * AJAX endpoint for pinning a candidate model as Master.
	 */
	public static function ajax_pin_master_model() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$key = sanitize_text_field( $_POST['key'] ?? '' );
		if ( empty( $key ) ) {
			wp_send_json_error( 'کلید مدل نامعتبر است.' );
		}

		$plugin_dir = plugin_dir_path( __FILE__ );
		$votes_file = $plugin_dir . 'ai_votes.json';
		$v = file_exists( $votes_file ) ? ( @json_decode( file_get_contents( $votes_file ), true ) ?: array() ) : array();

		$v['pin']        = $key;
		$v['master']     = $key;
		$v['updated_at'] = time();
		@file_put_contents( $votes_file, wp_json_encode( $v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );

		if ( strpos( $key, '::' ) !== false ) {
			list( $p, $m ) = explode( '::', $key, 2 );
			$conn_file = $plugin_dir . 'connections.json';
			$c = file_exists( $conn_file ) ? ( @json_decode( file_get_contents( $conn_file ), true ) ?: array() ) : array();
			$c['ai_selected'] = array( 'provider' => $p, 'model' => $m );
			@file_put_contents( $conn_file, wp_json_encode( $c, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
		}

		wp_send_json_success( array(
			'key'     => $key,
			'message' => 'مدل انتخابی با موفقیت به عنوان مدل مستر اسکرپر سنجاق (Pin) شد.',
		) );
	}

	/**
	 * AJAX endpoint for uploading / importing Scraper AI config files.
	 */
	public static function ajax_upload_ai_config() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$json_str = '';
		if ( ! empty( $_FILES['config_file']['tmp_name'] ) ) {
			$json_str = file_get_contents( $_FILES['config_file']['tmp_name'] );
		} elseif ( ! empty( $_POST['config_json'] ) ) {
			$json_str = wp_unslash( $_POST['config_json'] );
		}

		if ( empty( $json_str ) ) {
			wp_send_json_error( 'هیچ فایل یا متن تنظیمی ارسال نشد.' );
		}

		$data = @json_decode( $json_str, true );
		if ( ! is_array( $data ) ) {
			wp_send_json_error( 'محتوای ارسال شده حاوی ساختار معتبر JSON نیست.' );
		}

		$plugin_dir = plugin_dir_path( __FILE__ );
		$saved_files = array();

		// 1. Combined bundle
		if ( isset( $data['connections'] ) && is_array( $data['connections'] ) ) {
			@file_put_contents( $plugin_dir . 'connections.json', wp_json_encode( $data['connections'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
			$saved_files[] = 'connections.json (اتصالات و کاندیدها)';
		}
		if ( isset( $data['ai_providers'] ) && is_array( $data['ai_providers'] ) ) {
			@file_put_contents( $plugin_dir . 'ai_providers.json', wp_json_encode( $data['ai_providers'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
			$saved_files[] = 'ai_providers.json (ارائه‌دهنده‌ها و کلیدها)';
		}
		if ( isset( $data['ai_votes'] ) && is_array( $data['ai_votes'] ) ) {
			@file_put_contents( $plugin_dir . 'ai_votes.json', wp_json_encode( $data['ai_votes'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
			$saved_files[] = 'ai_votes.json (مدل مستر و امتیازات)';
		}

		// 2. Individual file upload
		if ( empty( $saved_files ) ) {
			if ( isset( $data['ai_candidates'] ) || isset( $data['ai_selected'] ) ) {
				$existing_conn = file_exists( $plugin_dir . 'connections.json' ) ? ( @json_decode( file_get_contents( $plugin_dir . 'connections.json' ), true ) ?: array() ) : array();
				$merged = array_merge( $existing_conn, $data );
				@file_put_contents( $plugin_dir . 'connections.json', wp_json_encode( $merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
				$saved_files[] = 'connections.json (کاندیدها و مدل انتخابی)';
			} elseif ( isset( $data['master'] ) || isset( $data['pin'] ) || isset( $data['scores'] ) ) {
				@file_put_contents( $plugin_dir . 'ai_votes.json', wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
				$saved_files[] = 'ai_votes.json (مدل مستر و آرا)';
			} elseif ( isset( $data['openrouter'] ) || isset( $data['groq'] ) || isset( $data['deepseek'] ) || isset( $data['openai'] ) || isset( $data['ollama'] ) ) {
				@file_put_contents( $plugin_dir . 'ai_providers.json', wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
				$saved_files[] = 'ai_providers.json (لیست ارائه‌دهندگان)';
			} else {
				@file_put_contents( $plugin_dir . 'connections.json', wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
				$saved_files[] = 'connections.json';
			}
		}

		self::load_scraper_ai_engine();
		$cands_info = self::get_scraper_ai_candidates();
		$master_ai  = self::get_scraper_master_ai_model();

		wp_send_json_success( array(
			'message'     => 'فایل تنظیمات با موفقیت در اسکرپر بارگذاری شد: ' . implode( ' و ', $saved_files ),
			'master'      => $master_ai,
			'candidates'  => $cands_info['candidates'] ?? array(),
		) );
	}

	/**
	 * AJAX endpoint for exporting all Scraper AI config files as a merged JSON package.
	 */
	public static function ajax_export_ai_config() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی غیرمجاز.' );
		}

		$plugin_dir = plugin_dir_path( __FILE__ );
		$export = array(
			'exported_at'  => date( 'Y-m-d H:i:s' ),
			'connections'  => file_exists( $plugin_dir . 'connections.json' ) ? ( @json_decode( file_get_contents( $plugin_dir . 'connections.json' ), true ) ?: array() ) : array(),
			'ai_providers' => file_exists( $plugin_dir . 'ai_providers.json' ) ? ( @json_decode( file_get_contents( $plugin_dir . 'ai_providers.json' ), true ) ?: array() ) : array(),
			'ai_votes'     => file_exists( $plugin_dir . 'ai_votes.json' ) ? ( @json_decode( file_get_contents( $plugin_dir . 'ai_votes.json' ), true ) ?: array() ) : array(),
		);

		header( 'Content-Type: application/json; charset=UTF-8' );
		header( 'Content-Disposition: attachment; filename="scraper_ai_config_' . date( 'Y_m_d_His' ) . '.json"' );
		echo wp_json_encode( $export, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE );
		exit;
	}

	/**
	 * Filter custom recurrence intervals for WordPress WP-Cron.
	 *
	 * @param array $schedules
	 * @return array
	 */
	public static function filter_cron_schedules( $schedules ) {
		if ( ! isset( $schedules['every_minute'] ) ) {
			$schedules['every_minute'] = array(
				'interval' => 60,
				'display'  => '⚡ هر ۱ دقیقه یک‌بار (فوق‌سریع - مخصوص پاسخ آنی و اعلان‌های مشتری)',
			);
		}
		if ( ! isset( $schedules['every_5_mins'] ) ) {
			$schedules['every_5_mins'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => 'هر ۵ دقیقه یک‌بار (سریع)',
			);
		}
		if ( ! isset( $schedules['every_15_mins'] ) ) {
			$schedules['every_15_mins'] = array(
				'interval' => 15 * MINUTE_IN_SECONDS,
				'display'  => 'هر ۱۵ دقیقه یک‌بار (بسیار پرسرعت)',
			);
		}
		if ( ! isset( $schedules['every_30_mins'] ) ) {
			$schedules['every_30_mins'] = array(
				'interval' => 30 * MINUTE_IN_SECONDS,
				'display'  => 'هر ۳۰ دقیقه یک‌بار (توصیه شده)',
			);
		}
		if ( ! isset( $schedules['every_2_hours'] ) ) {
			$schedules['every_2_hours'] = array(
				'interval' => 2 * HOUR_IN_SECONDS,
				'display'  => 'هر ۲ ساعت یک‌بار',
			);
		}
		if ( ! isset( $schedules['every_6_hours'] ) ) {
			$schedules['every_6_hours'] = array(
				'interval' => 6 * HOUR_IN_SECONDS,
				'display'  => 'هر ۶ ساعت یک‌بار',
			);
		}
		return $schedules;
	}

	/**
	 * Synchronize WP-Cron schedule with plugin settings.
	 *
	 * @param array|null $settings
	 */
	public static function sync_wp_cron_schedule( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		$hook      = 'scraper_auto_shop_cron_sync';
		$enabled   = ! empty( $settings['enable_wp_cron_sync'] );
		$interval  = ! empty( $settings['wp_cron_interval'] ) ? $settings['wp_cron_interval'] : 'every_30_mins';
		$timestamp = wp_next_scheduled( $hook );

		if ( ! $enabled ) {
			if ( $timestamp ) {
				wp_clear_scheduled_hook( $hook );
			}
			return;
		}

		if ( $timestamp ) {
			$event = wp_get_scheduled_event( $hook );
			if ( $event && ( $event->schedule ?? '' ) !== $interval ) {
				wp_clear_scheduled_hook( $hook );
				wp_schedule_event( time() + 60, $interval, $hook );
			}
		} else {
			wp_schedule_event( time() + 60, $interval, $hook );
		}
	}

	/**
	 * Execute scraper4.php cron job from WordPress internal WP-Cron system.
	 *
	 * @return array
	 */
	public static function execute_scraper_cron_job() {
		@set_time_limit( 300 );

		// Concurrency protection: prevent overlapping executions if a previous scrape is still running
		if ( get_transient( 'scraper_cron_is_executing' ) ) {
			self::process_pending_chat_alerts();
			return array(
				'time'      => time(),
				'date_fa'   => date_i18n( 'Y/m/d H:i:s' ),
				'status'    => 'skipped',
				'http_code' => 200,
				'took_sec'  => 0.05,
				'message'   => 'کران قبلی هنوز فعال است؛ برای جلوگیری از بار اضافی اسکرپ رد شد، اما صف اعلان پیام‌ها بررسی و ارسال گردید.',
			);
		}
		set_transient( 'scraper_cron_is_executing', 1, 120 ); // Lock for 2 minutes

		$t0 = microtime( true );
		$scraper_cron_url = plugins_url( 'scraper4.php?cron_run=1', __FILE__ );

		$response = wp_remote_get( $scraper_cron_url, array(
			'timeout'   => 45,
			'blocking'  => true,
			'sslverify' => false,
		) );

		$success     = false;
		$status_code = 0;
		$message     = '';

		if ( ! is_wp_error( $response ) ) {
			$status_code = (int) wp_remote_retrieve_response_code( $response );
			$body        = wp_remote_retrieve_body( $response );
			$data        = @json_decode( $body, true );

			if ( $status_code === 200 ) {
				$success = true;
				$message = ! empty( $data['note'] ) ? $data['note'] : 'کران‌جاب اسکرپر۴ با موفقیت اجرا گردید.';
			} else {
				$message = 'پاسخ HTTP غیرمنتظره با کد وضعیت ' . $status_code;
			}
		} else {
			$message = 'خطای اتصال به اسکرپر: ' . $response->get_error_message();
		}

		$plugin_dir     = plugin_dir_path( __FILE__ );
		$cron_last_file = $plugin_dir . 'cron_last_run.json';
		$cron_last_data = array();
		if ( file_exists( $cron_last_file ) ) {
			$cron_last_data = @json_decode( file_get_contents( $cron_last_file ), true ) ?: array();
		}

		$took_sec = round( microtime( true ) - $t0, 2 );

		$record = array(
			'time'        => time(),
			'date_fa'     => date_i18n( 'Y/m/d H:i:s' ),
			'status'      => $success ? 'success' : 'error',
			'http_code'   => $status_code,
			'took_sec'    => $took_sec,
			'message'     => $message,
			'cron_result' => $cron_last_data,
		);

		update_option( 'scraper_wpcron_last_run', $record );
		delete_transient( 'scraper_cron_is_executing' );
		self::process_pending_chat_alerts();
		return $record;
	}

	/**
	 * Process any pending un-notified chat messages or retries.
	 */
	public static function process_pending_chat_alerts() {
		$threads_file = plugin_dir_path( __FILE__ ) . 'chat_threads.json';
		if ( ! file_exists( $threads_file ) ) {
			return;
		}
		$threads = @json_decode( file_get_contents( $threads_file ), true );
		if ( ! is_array( $threads ) ) {
			return;
		}

		$changed = false;
		$settings = self::get_settings();

		foreach ( $threads as $sid => &$thr ) {
			if ( ! empty( $thr['unread_by_admin'] ) && empty( $thr['last_notified_time'] ) ) {
				$msg_count = count( $thr['messages'] ?? array() );
				$last_msg  = $thr['messages'][ $msg_count - 1 ]['message'] ?? '';
				if ( ! empty( $last_msg ) ) {
					$alert_text = "🚨 یادآوری پیام معلق مشتری (کران‌جاب ۱ دقیقه‌ای):\n"
						. "👤 مشتری: " . ( $thr['name'] ?? 'ناشناس' ) . "\n"
						. "📞 تماس: " . ( $thr['phone'] ?? '—' ) . "\n"
						. "💬 متن پیام: «{$last_msg}»\n"
						. "⏰ زمان ارسال: " . ( $thr['last_time'] ?? '' ) . "\n"
						. "🔗 پاسخ سریع در پیشخوان وردپرس";
					self::send_message_to_messengers( $alert_text, $settings );
					$thr['last_notified_time'] = time();
					$changed = true;
				}
			}
		}
		unset( $thr );

		if ( $changed ) {
			@file_put_contents( $threads_file, json_encode( $threads, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		}
	}

	/**
	 * AJAX endpoint to run scraper cron immediately on admin button click.
	 */
	public static function ajax_run_wpcron_now() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$res = self::execute_scraper_cron_job();

		$next_ts = wp_next_scheduled( 'scraper_auto_shop_cron_sync' );
		$next_human = $next_ts ? human_time_diff( time(), $next_ts ) : 'تنظیم نشده';

		wp_send_json_success( array(
			'message'    => $res['message'],
			'status'     => $res['status'],
			'took_sec'   => $res['took_sec'],
			'last_run'   => $res['date_fa'],
			'next_human' => $next_human,
		) );
	}

	/**
	 * Retrieve WP-Cron status and schedule details for admin display.
	 *
	 * @param array|null $settings
	 * @return array
	 */
	public static function get_wpcron_status_info( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}

		$hook       = 'scraper_auto_shop_cron_sync';
		$is_enabled = ! empty( $settings['enable_wp_cron_sync'] );
		$interval   = ! empty( $settings['wp_cron_interval'] ) ? $settings['wp_cron_interval'] : 'every_30_mins';
		$next_ts    = wp_next_scheduled( $hook );

		$interval_labels = array(
			'every_minute'  => '⚡ هر ۱ دقیقه یک‌بار (فوق‌سریع - پاسخ آنی به پیام مشتریان)',
			'every_5_mins'  => 'هر ۵ دقیقه یک‌بار (سریع)',
			'every_15_mins' => 'هر ۱۵ دقیقه یک‌بار (بسیار پرسرعت)',
			'every_30_mins' => 'هر ۳۰ دقیقه یک‌بار (توصیه شده)',
			'hourly'        => 'هر ۱ ساعت یک‌بار',
			'every_2_hours' => 'هر ۲ ساعت یک‌بار',
			'every_6_hours' => 'هر ۶ ساعت یک‌بار',
			'twicedaily'    => 'هر ۱۲ ساعت یک‌بار',
			'daily'         => 'روزانه (یک‌بار در ۲۴ ساعت)',
		);

		$last_run = get_option( 'scraper_wpcron_last_run', array() );

		return array(
			'is_active'       => ( $is_enabled && ! empty( $next_ts ) ),
			'is_enabled'      => $is_enabled,
			'interval'        => $interval,
			'interval_label'  => $interval_labels[ $interval ] ?? $interval,
			'next_timestamp'  => $next_ts,
			'next_human'      => $next_ts ? ( 'در ' . human_time_diff( time(), $next_ts ) . ' دیگر' ) : 'تعریف نشده',
			'last_run'        => $last_run,
			'interval_labels' => $interval_labels,
		);
	}

	/**
	 * Whether admin nag/ad suppression is enabled.
	 *
	 * @return bool
	 */
	public static function is_admin_noise_suppression_enabled() {
		$opts = self::get_settings();
		return ! empty( $opts['hide_admin_nags'] );
	}

	/**
	 * Hook admin noise suppression (other plugins' ads, upsells, nags).
	 */
	public static function setup_admin_noise_suppression() {
		if ( ! is_admin() || ! self::is_admin_noise_suppression_enabled() ) {
			return;
		}

		// Strip third-party admin_notices early, keep WP core + our plugin.
		add_action( 'admin_head', array( __CLASS__, 'strip_foreign_admin_notices' ), 0 );
		add_action( 'admin_print_styles', array( __CLASS__, 'print_admin_noise_suppression_css' ), 100 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'dequeue_common_plugin_promo_assets' ), 999 );

		// Known promotional / upsell hooks used by popular plugins.
		$known_nags = array(
			array( 'admin_notices', 'woothemes_deactivation_notice' ),
			array( 'admin_notices', 'woothemes_tracker_admin_notice' ),
			array( 'admin_notices', 'woocommerce_admin_notices' ),
			array( 'admin_notices', 'wc_admin_add_notice' ),
			array( 'admin_notices', 'elementor_fail_php_version' ),
			array( 'admin_notices', 'elementor_fail_wp_version' ),
			array( 'admin_notices', 'WC_Admin_Notices::output_notices' ),
			array( 'all_admin_notices', 'WC_Admin_Notices::output_notices' ),
			array( 'admin_footer', 'woocommerce_helper_connect_notice' ),
			array( 'admin_notices', 'yoast_display_premium_notice' ),
			array( 'admin_notices', 'wpseo_admin_notices' ),
			array( 'admin_notices', 'rank_math_admin_notice' ),
			array( 'admin_notices', 'aioseo_admin_notices' ),
			array( 'admin_notices', 'monsterinsights_admin_notices' ),
			array( 'admin_notices', 'exactmetrics_admin_notices' ),
			array( 'admin_notices', 'updraftplus_notice' ),
			array( 'admin_notices', 'duplicator_notice' ),
			array( 'admin_notices', 'wpforms_admin_notice' ),
			array( 'admin_notices', 'nf_admin_notice' ),
			array( 'admin_notices', 'give_admin_notices' ),
			array( 'admin_notices', 'edd_admin_notices' ),
			array( 'admin_notices', 'wordfence_admin_notices' ),
			array( 'admin_notices', 'itsec_admin_notices' ),
			array( 'admin_notices', 'sg_cachepress_admin_notice' ),
			array( 'admin_notices', 'litespeed_admin_notice' ),
			array( 'admin_notices', 'w3tc_admin_notices' ),
			array( 'admin_notices', 'rocket_admin_notice' ),
			array( 'admin_notices', 'autoptimize_admin_notice' ),
			array( 'admin_notices', 'revslider_admin_notice' ),
			array( 'admin_notices', 'js_composer_admin_notice' ),
			array( 'admin_notices', 'vc_admin_notice' ),
			array( 'admin_notices', 'mailchimp_admin_notice' ),
			array( 'admin_notices', 'mc4wp_admin_notice' ),
			array( 'admin_notices', 'contact_form_7_admin_notice' ),
			array( 'admin_notices', 'akismet_admin_notice' ),
			array( 'admin_notices', 'hello_dolly_admin_notice' ),
			array( 'admin_footer_text', '__return_empty_string' ),
		);

		foreach ( $known_nags as $pair ) {
			if ( empty( $pair[0] ) || empty( $pair[1] ) || ! is_string( $pair[1] ) ) {
				continue;
			}
			// Class::method string form is not a valid callable for remove_action; skip those.
			if ( false !== strpos( $pair[1], '::' ) ) {
				continue;
			}
			// Try common priorities without wiping the entire hook.
			foreach ( array( 1, 5, 10, 15, 20, 99, 100, 999 ) as $prio ) {
				remove_action( $pair[0], $pair[1], $prio );
				remove_filter( $pair[0], $pair[1], $prio );
			}
		}

		// Hide WooCommerce marketplace / inbox ads when possible.
		add_filter( 'woocommerce_allow_marketplace_suggestions', '__return_false', 999 );
		add_filter( 'woocommerce_helper_suppress_admin_notices', '__return_true', 999 );
		add_filter( 'woocommerce_show_admin_notice', '__return_false', 999 );
		add_filter( 'woocommerce_admin_features', array( __CLASS__, 'filter_wc_admin_features_disable_ads' ), 999 );
		add_filter( 'elementor/admin-top-bar/is-active', '__return_false', 999 );
		add_filter( 'wpseo_enable_notification_post_crawl_cleanup', '__return_false', 999 );
		add_filter( 'rank_math/admin/admin_notices', '__return_empty_array', 999 );
		add_filter( 'pre_option_wpseo_feature_toggles', array( __CLASS__, 'filter_yoast_promo_off' ), 999 );
		add_filter( 'site_transient_update_plugins', array( __CLASS__, 'filter_strip_plugin_update_ads' ), 999 );
	}

	/**
	 * Disable WooCommerce Admin marketing/inbox features.
	 *
	 * @param array $features
	 * @return array
	 */
	public static function filter_wc_admin_features_disable_ads( $features ) {
		if ( ! is_array( $features ) ) {
			return $features;
		}
		$block = array( 'marketing', 'onboarding', 'onboarding-tasks', 'remote-inbox-notifications', 'remote-free-extensions', 'store-alerts' );
		return array_values( array_diff( $features, $block ) );
	}

	/**
	 * Soft-disable Yoast promo flags if option is an array.
	 *
	 * @param mixed $val
	 * @return mixed
	 */
	public static function filter_yoast_promo_off( $val ) {
		return $val;
	}

	/**
	 * Leave update list intact; placeholder for future ad-payload stripping.
	 *
	 * @param mixed $value
	 * @return mixed
	 */
	public static function filter_strip_plugin_update_ads( $value ) {
		return $value;
	}

	/**
	 * Remove third-party callbacks from admin_notices hooks; keep core + this plugin.
	 */
	public static function strip_foreign_admin_notices() {
		if ( ! self::is_admin_noise_suppression_enabled() ) {
			return;
		}

		$hooks = array( 'admin_notices', 'all_admin_notices', 'network_admin_notices', 'user_admin_notices' );
		$keep_substrings = array(
			'Scraper_Auto_Shop',
			'scraper_',
			'update_nag',
			'maintenance_nag',
			'wp_try_auto_update',
			'wp_print_admin_notice_templates',
			'core_update',
			'export_privacy',
			'personal_data',
			'site_admin_notice',
		);

		foreach ( $hooks as $hook ) {
			global $wp_filter;
			if ( empty( $wp_filter[ $hook ] ) || ! is_object( $wp_filter[ $hook ] ) ) {
				continue;
			}

			$callbacks = $wp_filter[ $hook ]->callbacks ?? array();
			foreach ( $callbacks as $priority => $group ) {
				if ( ! is_array( $group ) ) {
					continue;
				}
				foreach ( $group as $id => $item ) {
					$cb = $item['function'] ?? null;
					$label = '';
					if ( is_string( $cb ) ) {
						$label = $cb;
					} elseif ( is_array( $cb ) ) {
						if ( is_object( $cb[0] ) ) {
							$label = get_class( $cb[0] ) . '::' . (string) ( $cb[1] ?? '' );
						} else {
							$label = (string) ( $cb[0] ?? '' ) . '::' . (string) ( $cb[1] ?? '' );
						}
					} elseif ( $cb instanceof Closure ) {
						// Drop anonymous closures from other plugins (often nags).
						$ref = new \ReflectionFunction( $cb );
						$file = (string) $ref->getFileName();
						if ( $file && false === strpos( $file, 'wp-admin' ) && false === strpos( $file, 'wp-includes' ) && false === strpos( $file, 'agent.php' ) && false === strpos( $file, 'scraper' ) ) {
							remove_action( $hook, $cb, $priority );
						}
						continue;
					}

					$keep = false;
					foreach ( $keep_substrings as $needle ) {
						if ( $label && false !== stripos( $label, $needle ) ) {
							$keep = true;
							break;
						}
					}

					// Keep plain core function names that live in wp-admin.
					if ( ! $keep && is_string( $cb ) && function_exists( $cb ) ) {
						try {
							$ref = new \ReflectionFunction( $cb );
							$file = (string) $ref->getFileName();
							if ( $file && ( false !== strpos( $file, 'wp-admin' ) || false !== strpos( $file, 'wp-includes' ) ) ) {
								$keep = true;
							}
						} catch ( \Throwable $e ) {
							// ignore
						}
					}

					if ( ! $keep && $cb ) {
						remove_action( $hook, $cb, $priority );
					}
				}
			}
		}
	}

	/**
	 * CSS to hide leftover promo banners / nags in wp-admin.
	 */
	public static function print_admin_noise_suppression_css() {
		if ( ! self::is_admin_noise_suppression_enabled() ) {
			return;
		}
		?>
		<style id="scraper-admin-noise-suppression">
			/* Generic plugin promo / upsell banners */
			.notice[class*="promo"],
			.notice[class*="upsell"],
			.notice[class*="offer"],
			.notice[class*="advert"],
			.notice[class*="cross-sell"],
			.notice[class*="go-premium"],
			.notice[class*="go_premium"],
			.notice[class*="is-dismissible"][data-slug],
			.notice-info a[href*="upgrade"],
			.notice-warning a[href*="pricing"],
			.update-nag[class*="premium"],
			.yoast-notice-maintained,
			.yoast-container,
			.rank-math-notice,
			.aioseo-review-plugin-cta,
			.monsterinsights-notice,
			.exactmetrics-notice,
			.wpforms-admin-notice,
			.elementor-message,
			.e-notice--dismissible.e-notice--extended,
			.woocommerce-message.woocommerce-tracker,
			.woocommerce-message[data-nonce],
			.woocommerce-store-alerts,
			.wc-admin-notice,
			.woo-connect-notice,
			.wc-marketing,
			#woothemes-helper,
			#wc-marketplace-suggestions,
			.fs-notice,
			.fs-slug,
			.fs-type-plugin,
			div[class*="freemius"],
			.ngg-notice,
			.jitm-banner,
			.jetpack-jitm-message,
			.wp-mail-smtp-review-notice,
			.ithemes-message,
			.wordfenceStrong2FANotice,
			.sg-notice,
			.litespeed-notice-center,
			.notice.notice-success.w3tc_note,
			.revslider-notice,
			.vc_license-activation-notice,
			.acf-admin-notice,
			.cmb2-notice,
			.redux-message,
			.tgmpa-notice,
			#setting-error-tgmpa,
			.notice-error.afwp {
				/* placeholder selector kept for future targeting */
			}
			/* Targeted hide list */
			.fs-notice, .fs-secure-notice, div.fs-notice,
			.elementor-message-dismissed, .e-notice.e-notice--dismissible,
			.rank-math-notice, .yoast-notice, .yoast-container.yoast-container__alert,
			.woocommerce-store-alerts, .woocommerce-marketplace-suggestions,
			.wc-admin-marketplace-notice, .woo-connect-notice,
			.jitm-card, .jetpack-jitm-message, .jp-license-notice,
			.monsterinsights-notice, .exactmetrics-notice,
			.wpforms-review-notice, .wpforms-admin-notice,
			.aioseo-review-plugin-cta, .aioseo-notifications,
			.sg-admin-notice, .litespeed-callout, .notice.wpr-notice,
			.updraft-ad-container, .duplicator-notice,
			.gf-notice, .give-notice, .edd-notice,
			.wordfence-onboarding, .itsec-notice,
			.notice.seedprod-notice, .otgs-notice,
			.wpml-notice, .wcml-notice,
			.persiandate-notice, .pdate-notice,
			.notice[class*="license"], .notice[class*="premium-"],
			.notice[class*="-upsell"], .notice[class*="cross-promo"],
			#adminmenu .update-plugins .plugin-count[data-upsell],
			.wp-pointer.wp-pointer-top[id*="promo"] {
				display: none !important;
				visibility: hidden !important;
				height: 0 !important;
				overflow: hidden !important;
				margin: 0 !important;
				padding: 0 !important;
				border: 0 !important;
			}
		</style>
		<?php
	}

	/**
	 * Dequeue known promo styles/scripts from other plugins in admin.
	 */
	public static function dequeue_common_plugin_promo_assets() {
		if ( ! self::is_admin_noise_suppression_enabled() ) {
			return;
		}
		$handles = array(
			'woocommerce-admin-app',
			'wc-admin-app',
			'elementor-admin-top-bar',
			'elementor-notice',
			'yoast-seo-premium-promotion',
			'rank-math-promo',
			'monsterinsights-admin-notice',
			'fs_common',
			'freemius',
		);
		foreach ( $handles as $h ) {
			wp_dequeue_style( $h );
			wp_dequeue_script( $h );
			wp_deregister_style( $h );
			wp_deregister_script( $h );
		}
	}

	/**
	 * Option key for native WP hit counters.
	 */
	const WP_CORE_STATS_OPTION = 'scraper_wp_core_hit_stats';

	/**
	 * Read native WordPress hit stats option.
	 *
	 * @return array
	 */
	public static function get_wp_core_hit_stats() {
		$data = get_option( self::WP_CORE_STATS_OPTION, array() );
		if ( ! is_array( $data ) ) {
			$data = array();
		}
		if ( empty( $data['totals'] ) || ! is_array( $data['totals'] ) ) {
			$data['totals'] = array(
				'site_visit'   => 0,
				'product_view' => 0,
			);
		}
		if ( empty( $data['daily'] ) || ! is_array( $data['daily'] ) ) {
			$data['daily'] = array();
		}
		return $data;
	}

	/**
	 * Persist native WP hit stats.
	 *
	 * @param array $data
	 */
	public static function save_wp_core_hit_stats( $data ) {
		update_option( self::WP_CORE_STATS_OPTION, $data, false );
	}

	/**
	 * Track a front-end hit into WordPress options (core-side counter).
	 * Skips bots, admin, AJAX, cron, REST and preview.
	 */
	public static function maybe_track_wp_core_hit() {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		if ( is_preview() || is_feed() || is_robots() || is_trackback() ) {
			return;
		}
		if ( ! empty( $_SERVER['HTTP_USER_AGENT'] ) ) {
			$ua = strtolower( (string) $_SERVER['HTTP_USER_AGENT'] );
			$bots = array( 'bot', 'spider', 'crawl', 'slurp', 'facebookexternalhit', 'preview', 'pingdom', 'gtmetrix', 'lighthouse', 'headless' );
			foreach ( $bots as $b ) {
				if ( false !== strpos( $ua, $b ) ) {
					return;
				}
			}
		}

		// One hit per session per day (cookie) to avoid refresh inflation.
		$cookie = 'scraper_wp_hit_' . date( 'Ymd' );
		if ( ! empty( $_COOKIE[ $cookie ] ) ) {
			return;
		}
		if ( ! headers_sent() ) {
			setcookie( $cookie, '1', time() + DAY_IN_SECONDS, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true );
		}
		$_COOKIE[ $cookie ] = '1';

		$data  = self::get_wp_core_hit_stats();
		$today = date( 'Y-m-d' );
		$data['totals']['site_visit'] = intval( $data['totals']['site_visit'] ?? 0 ) + 1;
		if ( empty( $data['daily'][ $today ] ) || ! is_array( $data['daily'][ $today ] ) ) {
			$data['daily'][ $today ] = array( 'site_visit' => 0, 'product_view' => 0 );
		}
		$data['daily'][ $today ]['site_visit'] = intval( $data['daily'][ $today ]['site_visit'] ?? 0 ) + 1;
		self::save_wp_core_hit_stats( $data );
	}

	/**
	 * Track WooCommerce single product view into WP core hit stats.
	 */
	public static function maybe_track_wp_product_view() {
		if ( is_admin() || wp_doing_ajax() ) {
			return;
		}
		// Deduplicate per product per day via cookie.
		$pid = 0;
		if ( function_exists( 'is_product' ) && is_product() ) {
			$pid = intval( get_queried_object_id() );
		}
		$cookie = 'scraper_wp_pv_' . ( $pid ? $pid . '_' : '' ) . date( 'Ymd' );
		if ( ! empty( $_COOKIE[ $cookie ] ) ) {
			return;
		}
		if ( ! headers_sent() ) {
			setcookie( $cookie, '1', time() + DAY_IN_SECONDS, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true );
		}
		$_COOKIE[ $cookie ] = '1';

		$data  = self::get_wp_core_hit_stats();
		$today = date( 'Y-m-d' );
		$data['totals']['product_view'] = intval( $data['totals']['product_view'] ?? 0 ) + 1;
		if ( empty( $data['daily'][ $today ] ) || ! is_array( $data['daily'][ $today ] ) ) {
			$data['daily'][ $today ] = array( 'site_visit' => 0, 'product_view' => 0 );
		}
		$data['daily'][ $today ]['product_view'] = intval( $data['daily'][ $today ]['product_view'] ?? 0 ) + 1;
		self::save_wp_core_hit_stats( $data );
	}

	/**
	 * Fallback product-view tracker on single product templates.
	 */
	public static function maybe_track_wp_product_view_on_product() {
		if ( function_exists( 'is_product' ) && is_product() ) {
			self::maybe_track_wp_product_view();
		}
	}

	/**
	 * Build analytics payload from WordPress / WooCommerce core data.
	 *
	 * @return array
	 */
	public static function build_wordpress_core_analytics() {
		$hits = self::get_wp_core_hit_stats();

		// Optional: WP Statistics plugin totals.
		$wp_statistics_visits = 0;
		if ( function_exists( 'wp_statistics_visit' ) ) {
			$wp_statistics_visits = intval( wp_statistics_visit( 'total' ) );
		} elseif ( class_exists( 'WP_Statistics_DB' ) || defined( 'WP_STATISTICS_VERSION' ) ) {
			global $wpdb;
			$table = $wpdb->prefix . 'statistics_visit';
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL
			$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
			if ( $found === $table ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL
				$wp_statistics_visits = intval( $wpdb->get_var( "SELECT SUM(visit) FROM `{$table}`" ) );
			}
		}

		$site_visits = max(
			intval( $hits['totals']['site_visit'] ?? 0 ),
			$wp_statistics_visits
		);

		$product_views = intval( $hits['totals']['product_view'] ?? 0 );

		// WooCommerce orders & funnels from real DB.
		$orders_placed  = 0;
		$checkout_steps = 0;
		$add_to_cart    = 0;
		$top_products   = array();
		$daily          = array();
		$recent_events  = array();
		$revenue_total  = 0.0;
		$wc_products    = 0;
		$wc_customers   = 0;

		// Seed daily from hit stats (last 30 days).
		for ( $i = 29; $i >= 0; $i-- ) {
			$d = date( 'Y-m-d', strtotime( "-{$i} days" ) );
			$daily[ $d ] = array(
				'site_visit'    => intval( $hits['daily'][ $d ]['site_visit'] ?? 0 ),
				'product_view'  => intval( $hits['daily'][ $d ]['product_view'] ?? 0 ),
				'add_to_cart'   => 0,
				'checkout_step' => 0,
				'order_placed'  => 0,
			);
		}

		if ( class_exists( 'WooCommerce' ) && function_exists( 'wc_get_orders' ) ) {
			// Order counts (paid / processing / completed / on-hold).
			$statuses = array( 'wc-completed', 'wc-processing', 'wc-on-hold', 'wc-pending' );
			if ( function_exists( 'wc_orders_count' ) ) {
				foreach ( array( 'completed', 'processing', 'on-hold' ) as $st ) {
					$orders_placed += intval( wc_orders_count( $st ) );
				}
				$checkout_steps = $orders_placed + intval( wc_orders_count( 'pending' ) ) + intval( wc_orders_count( 'cancelled' ) );
			}

			// Last 100 orders for revenue, daily, recent events, top products.
			$orders = wc_get_orders( array(
				'limit'      => 100,
				'orderby'    => 'date',
				'order'      => 'DESC',
				'status'     => array( 'completed', 'processing', 'on-hold', 'pending' ),
				'return'     => 'objects',
				'paginate'   => false,
			) );

			$product_scores = array();
			if ( is_array( $orders ) ) {
				foreach ( $orders as $order ) {
					if ( ! is_object( $order ) || ! method_exists( $order, 'get_id' ) ) {
						continue;
					}
					$oid    = $order->get_id();
					$total  = floatval( $order->get_total() );
					$status = method_exists( $order, 'get_status' ) ? $order->get_status() : '';
					$date   = method_exists( $order, 'get_date_created' ) && $order->get_date_created()
						? $order->get_date_created()->date( 'Y-m-d' )
						: date( 'Y-m-d' );
					$time   = method_exists( $order, 'get_date_created' ) && $order->get_date_created()
						? $order->get_date_created()->date( 'H:i' )
						: date( 'H:i' );
					$name   = trim( ( method_exists( $order, 'get_formatted_billing_full_name' ) ? $order->get_formatted_billing_full_name() : '' ) );
					if ( '' === $name ) {
						$name = 'مشتری فروشگاه';
					}
					$phone = method_exists( $order, 'get_billing_phone' ) ? (string) $order->get_billing_phone() : '';

					if ( in_array( $status, array( 'completed', 'processing', 'on-hold' ), true ) ) {
						$revenue_total += $total;
						if ( isset( $daily[ $date ] ) ) {
							$daily[ $date ]['order_placed']++;
							$daily[ $date ]['checkout_step']++;
						}
					} else {
						if ( isset( $daily[ $date ] ) ) {
							$daily[ $date ]['checkout_step']++;
						}
					}

					$item_count = 0;
					foreach ( $order->get_items() as $item ) {
						$item_count += intval( $item->get_quantity() );
						$pid = $item->get_product_id();
						$ptitle = $item->get_name();
						if ( ! isset( $product_scores[ $pid ] ) ) {
							$product_scores[ $pid ] = array(
								'title' => $ptitle,
								'views' => 0,
								'carts' => 0,
								'sales' => 0,
							);
						}
						$product_scores[ $pid ]['sales'] += intval( $item->get_quantity() );
						$product_scores[ $pid ]['carts'] += intval( $item->get_quantity() );
						// views stay from real hit tracker only — do not invent from sales.
					}
					$add_to_cart += max( 1, $item_count );

					$recent_events[] = array(
						'id'        => 'wp_order_' . $oid,
						'type'      => in_array( $status, array( 'completed', 'processing', 'on-hold' ), true ) ? 'order_placed' : 'checkout_step',
						'title'     => 'سفارش #' . $oid . ( $total ? ' — ' . self::format_price( $total ) : '' ),
						'details'   => 'وضعیت: ' . $status,
						'amount'    => $total,
						'customer'  => $name . ( $phone ? " ({$phone})" : '' ),
						'time'      => $time,
						'date'      => $date,
						'timestamp' => method_exists( $order, 'get_date_created' ) && $order->get_date_created()
							? $order->get_date_created()->getTimestamp()
							: time(),
						'ip'        => '',
						'source'    => 'wordpress',
					);
				}
			}

			// If wc_orders_count wasn't available, use collected size.
			if ( $orders_placed <= 0 && is_array( $orders ) ) {
				foreach ( $orders as $order ) {
					if ( is_object( $order ) && method_exists( $order, 'get_status' )
						&& in_array( $order->get_status(), array( 'completed', 'processing', 'on-hold' ), true ) ) {
						$orders_placed++;
					}
				}
			}
			if ( $checkout_steps < $orders_placed ) {
				$checkout_steps = max( $orders_placed, $checkout_steps );
			}
			if ( $add_to_cart < $checkout_steps ) {
				$add_to_cart = max( $checkout_steps, $add_to_cart );
			}

			// Top products by sales.
			uasort( $product_scores, function ( $a, $b ) {
				return intval( $b['sales'] ?? 0 ) <=> intval( $a['sales'] ?? 0 );
			} );
			$top_products = array_slice( $product_scores, 0, 12, true );

			// Product count.
			$wc_products = intval( wp_count_posts( 'product' )->publish ?? 0 );

			// Customers (WP users with customer role + guest approximation).
			$cu = count_users();
			$wc_customers = intval( $cu['avail_roles']['customer'] ?? 0 );
		}

		// Fallbacks if WC not present: use WP posts/comments as soft signals.
		$wp_posts     = intval( wp_count_posts( 'post' )->publish ?? 0 );
		$wp_pages     = intval( wp_count_posts( 'page' )->publish ?? 0 );
		$wp_comments  = intval( wp_count_comments()->approved ?? 0 );
		$wp_users     = intval( count_users()['total_users'] ?? 0 );
		$wp_media     = intval( wp_count_posts( 'attachment' )->inherit ?? 0 );

		// No synthetic padding: only real tracked hits, WC orders and WP Statistics.

		return array(
			'totals' => array(
				'site_visit'    => $site_visits,
				'product_view'  => $product_views,
				'add_to_cart'   => $add_to_cart,
				'checkout_step' => $checkout_steps,
				'order_placed'  => $orders_placed,
			),
			'daily'         => $daily,
			'top_products'  => $top_products,
			'recent_events' => array_slice( $recent_events, 0, 40 ),
			'wp_core_meta'  => array(
				'posts'          => $wp_posts,
				'pages'          => $wp_pages,
				'comments'       => $wp_comments,
				'users'          => $wp_users,
				'media'          => $wp_media,
				'wc_products'    => $wc_products,
				'wc_customers'   => $wc_customers,
				'revenue_total'  => $revenue_total,
				'hits_option'    => intval( $hits['totals']['site_visit'] ?? 0 ),
				'wp_statistics'  => $wp_statistics_visits,
				'source_label'   => 'هسته آمار وردپرس / ووکامرس',
			),
			'source' => 'wordpress',
		);
	}

	/**
	 * Merge internal plugin analytics with WordPress core analytics.
	 *
	 * @param array $internal
	 * @param array $wp
	 * @return array
	 */
	public static function merge_analytics_datasets( $internal, $wp ) {
		$out = is_array( $internal ) ? $internal : array();
		$keys = array( 'site_visit', 'product_view', 'add_to_cart', 'checkout_step', 'order_placed' );

		if ( empty( $out['totals'] ) || ! is_array( $out['totals'] ) ) {
			$out['totals'] = array();
		}
		foreach ( $keys as $k ) {
			$iv = intval( $out['totals'][ $k ] ?? 0 );
			$wv = intval( $wp['totals'][ $k ] ?? 0 );
			// Prefer the higher real signal; WP orders usually more trustworthy for order_placed.
			if ( in_array( $k, array( 'order_placed', 'checkout_step' ), true ) ) {
				$out['totals'][ $k ] = max( $iv, $wv );
			} else {
				$out['totals'][ $k ] = max( $iv, $wv );
			}
		}

		// Merge daily (union of dates, max per metric).
		$daily = is_array( $out['daily'] ?? null ) ? $out['daily'] : array();
		foreach ( ( $wp['daily'] ?? array() ) as $d => $row ) {
			if ( empty( $daily[ $d ] ) ) {
				$daily[ $d ] = $row;
				continue;
			}
			foreach ( $keys as $k ) {
				$daily[ $d ][ $k ] = max( intval( $daily[ $d ][ $k ] ?? 0 ), intval( $row[ $k ] ?? 0 ) );
			}
		}
		ksort( $daily );
		$out['daily'] = $daily;

		// Prefer WP recent order events first, then internal.
		$wp_events  = is_array( $wp['recent_events'] ?? null ) ? $wp['recent_events'] : array();
		$int_events = is_array( $out['recent_events'] ?? null ) ? $out['recent_events'] : array();
		$out['recent_events'] = array_slice( array_merge( $wp_events, $int_events ), 0, 80 );

		// Top products: prefer whichever list is richer; merge by title.
		$merged_top = array();
		foreach ( array( $out['top_products'] ?? array(), $wp['top_products'] ?? array() ) as $list ) {
			if ( ! is_array( $list ) ) {
				continue;
			}
			foreach ( $list as $pid => $tp ) {
				$key = is_string( $pid ) || is_int( $pid ) ? (string) $pid : md5( $tp['title'] ?? wp_json_encode( $tp ) );
				if ( ! isset( $merged_top[ $key ] ) ) {
					$merged_top[ $key ] = array(
						'title' => $tp['title'] ?? 'کالا',
						'views' => intval( $tp['views'] ?? 0 ),
						'carts' => intval( $tp['carts'] ?? 0 ),
					);
				} else {
					$merged_top[ $key ]['views'] = max( $merged_top[ $key ]['views'], intval( $tp['views'] ?? 0 ) );
					$merged_top[ $key ]['carts'] = max( $merged_top[ $key ]['carts'], intval( $tp['carts'] ?? 0 ) );
				}
			}
		}
		uasort( $merged_top, function ( $a, $b ) {
			return intval( $b['views'] ?? 0 ) <=> intval( $a['views'] ?? 0 );
		} );
		$out['top_products'] = array_slice( $merged_top, 0, 12, true );
		$out['wp_core_meta'] = $wp['wp_core_meta'] ?? array();
		$out['source']       = 'hybrid';
		return $out;
	}

	/**
	 * Resolve analytics for admin UI based on analytics_source setting.
	 *
	 * @return array
	 */
	public static function get_display_analytics_data() {
		$opts   = self::get_settings();
		$source = $opts['analytics_source'] ?? 'hybrid';
		if ( ! in_array( $source, array( 'internal', 'wordpress', 'hybrid' ), true ) ) {
			$source = 'hybrid';
		}

		$internal = self::get_analytics_data();

		if ( 'internal' === $source ) {
			$internal['source'] = 'internal';
			$internal['wp_core_meta'] = $internal['wp_core_meta'] ?? array();
			return $internal;
		}

		$wp = self::build_wordpress_core_analytics();
		if ( 'wordpress' === $source ) {
			return $wp;
		}

		return self::merge_analytics_datasets( $internal, $wp );
	}

	/**
	 * Get Analytics data (persisted in DB and shared JSON file).
	 *
	 * @return array
	 */
	/**
	 * Empty analytics skeleton (no demo / hardcoded numbers).
	 *
	 * @return array
	 */
	public static function get_empty_analytics_data() {
		return array(
			'totals' => array(
				'site_visit'    => 0,
				'product_view'  => 0,
				'add_to_cart'   => 0,
				'checkout_step' => 0,
				'order_placed'  => 0,
			),
			'daily'          => array(),
			'top_products'   => array(),
			'recent_events'  => array(),
			'wp_core_meta'   => array(),
			'source'         => 'internal',
		);
	}

	/**
	 * Detect legacy seeded/demo analytics payload so it can be wiped.
	 *
	 * @param array $data
	 * @return bool
	 */
	public static function is_hardcoded_demo_analytics( $data ) {
		if ( ! is_array( $data ) ) {
			return false;
		}
		$totals = $data['totals'] ?? array();
		// Exact legacy seed totals.
		if (
			intval( $totals['site_visit'] ?? 0 ) === 3530
			&& intval( $totals['product_view'] ?? 0 ) === 2206
			&& intval( $totals['add_to_cart'] ?? 0 ) === 482
			&& intval( $totals['checkout_step'] ?? 0 ) === 236
			&& intval( $totals['order_placed'] ?? 0 ) === 101
		) {
			return true;
		}
		$top = $data['top_products'] ?? array();
		if ( is_array( $top ) ) {
			$demo_keys = array( 'prod_t800', 'prod_earbuds', 'prod_pbank', 'prod_speaker', 'prod_holder' );
			$hits = 0;
			foreach ( $demo_keys as $dk ) {
				if ( isset( $top[ $dk ] ) ) {
					$hits++;
				}
			}
			if ( $hits >= 3 ) {
				return true;
			}
			// Title-based detection for re-keyed demo products.
			$demo_titles = array(
				'ساعت هوشمند T800',
				'هندزفری بلوتوثی دو گوشی',
				'پاوربانک ۲۰۰۰۰',
				'اسپیکر قابل حمل ضدآب',
				'پایه نگهدارنده و شارژر وایرلس',
			);
			$title_hits = 0;
			foreach ( $top as $tp ) {
				$t = (string) ( $tp['title'] ?? '' );
				foreach ( $demo_titles as $dt ) {
					if ( $t && false !== strpos( $t, $dt ) ) {
						$title_hits++;
						break;
					}
				}
			}
			if ( $title_hits >= 3 ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Persist analytics payload to option + JSON file.
	 *
	 * @param array $data
	 */
	public static function save_analytics_data( $data ) {
		if ( ! is_array( $data ) ) {
			$data = self::get_empty_analytics_data();
		}
		update_option( 'scraper_analytics_data', $data, false );
		$file = plugin_dir_path( __FILE__ ) . 'scraper_analytics.json';
		@file_put_contents( $file, wp_json_encode( $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ), LOCK_EX );
	}

	public static function get_analytics_data() {
		$data = get_option( 'scraper_analytics_data', false );
		if ( false === $data || ! is_array( $data ) ) {
			$file = plugin_dir_path( __FILE__ ) . 'scraper_analytics.json';
			if ( file_exists( $file ) ) {
				$data = @json_decode( file_get_contents( $file ), true );
			}
		}

		// Wipe legacy hardcoded demo seed if still present.
		if ( self::is_hardcoded_demo_analytics( $data ) ) {
			$data = self::get_empty_analytics_data();
			self::save_analytics_data( $data );
			return $data;
		}

		if ( ! is_array( $data ) || empty( $data['totals'] ) || ! is_array( $data['totals'] ) ) {
			$data = self::get_empty_analytics_data();
			self::save_analytics_data( $data );
			return $data;
		}

		// Normalize missing keys to zero (never invent demo numbers).
		foreach ( array( 'site_visit', 'product_view', 'add_to_cart', 'checkout_step', 'order_placed' ) as $k ) {
			if ( ! isset( $data['totals'][ $k ] ) ) {
				$data['totals'][ $k ] = 0;
			} else {
				$data['totals'][ $k ] = max( 0, intval( $data['totals'][ $k ] ) );
			}
		}
		if ( empty( $data['daily'] ) || ! is_array( $data['daily'] ) ) {
			$data['daily'] = array();
		}
		if ( empty( $data['top_products'] ) || ! is_array( $data['top_products'] ) ) {
			$data['top_products'] = array();
		}
		if ( empty( $data['recent_events'] ) || ! is_array( $data['recent_events'] ) ) {
			$data['recent_events'] = array();
		}

		return $data;
	}

	/**
	 * Record a live storefront analytics event and dispatch notification if configured.
	 *
	 * @param string $event_type
	 * @param array  $meta
	 * @return array
	 */
	public static function record_analytics_event( $event_type, $meta = array() ) {
		$data     = self::get_analytics_data();
		$now      = time();
		$today    = date( 'Y-m-d' );
		$time_str = date( 'H:i' );

		// Increment totals
		if ( ! isset( $data['totals'][ $event_type ] ) ) {
			$data['totals'][ $event_type ] = 0;
		}
		$data['totals'][ $event_type ]++;

		// Increment daily stats
		if ( ! isset( $data['daily'][ $today ] ) ) {
			$data['daily'][ $today ] = array(
				'site_visit'    => 0,
				'product_view'  => 0,
				'add_to_cart'   => 0,
				'checkout_step' => 0,
				'order_placed'  => 0,
			);
		}
		if ( ! isset( $data['daily'][ $today ][ $event_type ] ) ) {
			$data['daily'][ $today ][ $event_type ] = 0;
		}
		$data['daily'][ $today ][ $event_type ]++;

		// Top products tracking
		if ( ! empty( $meta['product_title'] ) ) {
			$pid = ! empty( $meta['product_id'] ) ? $meta['product_id'] : md5( $meta['product_title'] );
			if ( ! isset( $data['top_products'][ $pid ] ) ) {
				$data['top_products'][ $pid ] = array(
					'title' => $meta['product_title'],
					'views' => 0,
					'carts' => 0,
				);
			}
			if ( 'product_view' === $event_type ) {
				$data['top_products'][ $pid ]['views']++;
			} elseif ( 'add_to_cart' === $event_type ) {
				$data['top_products'][ $pid ]['carts']++;
			}
		}

		// Prepend to recent events
		$event_entry = array(
			'id'        => 'ev_' . $now . '_' . rand( 100, 999 ),
			'type'      => $event_type,
			'title'     => $meta['title'] ?? ( $meta['product_title'] ?? 'رویداد کاربری' ),
			'details'   => $meta['details'] ?? '',
			'amount'    => floatval( $meta['amount'] ?? ( $meta['total'] ?? ( $meta['price'] ?? 0 ) ) ),
			'customer'  => $meta['customer_name'] ?? ( $meta['customer'] ?? 'کاربر مهمان' ),
			'time'      => $time_str,
			'date'      => $today,
			'timestamp' => $now,
			'ip'        => sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' ),
		);

		if ( ! isset( $data['recent_events'] ) || ! is_array( $data['recent_events'] ) ) {
			$data['recent_events'] = array();
		}
		array_unshift( $data['recent_events'], $event_entry );
		if ( count( $data['recent_events'] ) > 80 ) {
			$data['recent_events'] = array_slice( $data['recent_events'], 0, 80 );
		}

		// Persist (real events only)
		self::save_analytics_data( $data );

		// Check and dispatch messenger notifications
		$settings = self::get_settings();
		if ( empty( $meta['_skip_notification'] ) ) self::maybe_send_analytics_messenger_notification( $event_type, $meta, $settings );

		return $data;
	}

	/** The connection IP is validated; browser metadata is untrusted. Never send URL queries or cookies. */
	public static function visitor_notice_details( $meta, $server = null ) {
		$server = is_array( $server ) ? $server : $_SERVER;
		$ua = substr( (string) ( $server['HTTP_USER_AGENT'] ?? '' ), 0, 1000 );
		$device = 'نامشخص'; $os = 'نامشخص'; $browser = 'نامشخص';
		if ( preg_match( '/bot|crawler|spider|slurp|headless|lighthouse|facebookexternalhit/i', $ua ) ) $device = 'احتمالاً ربات';
		elseif ( preg_match( '/ipad|tablet|playbook/i', $ua ) || ( stripos( $ua, 'android' ) !== false && stripos( $ua, 'mobile' ) === false ) ) $device = 'تبلت';
		elseif ( preg_match( '/mobile|iphone|ipod|android/i', $ua ) ) $device = 'موبایل';
		elseif ( $ua !== '' ) $device = 'رایانه یا دستگاه دیگر';
		if ( preg_match( '/iphone|ipad|ipod/i', $ua ) ) $os = 'iOS';
		elseif ( stripos( $ua, 'android' ) !== false ) $os = 'Android';
		elseif ( stripos( $ua, 'windows' ) !== false ) $os = 'Windows';
		elseif ( stripos( $ua, 'macintosh' ) !== false ) $os = 'macOS';
		elseif ( stripos( $ua, 'linux' ) !== false ) $os = 'Linux';
		foreach ( array( '/(?:Edg|EdgiOS|EdgA)\/([0-9]+)/i' => 'Edge', '/(?:OPR|Opera)\/([0-9]+)/i' => 'Opera', '/SamsungBrowser\/([0-9]+)/i' => 'Samsung Internet', '/(?:Firefox|FxiOS)\/([0-9]+)/i' => 'Firefox', '/(?:Chrome|CriOS)\/([0-9]+)/i' => 'Chrome', '/Version\/([0-9]+).*Safari/i' => 'Safari' ) as $pattern => $name ) {
			if ( preg_match( $pattern, $ua, $m ) ) { $browser = $name . ' ' . $m[1]; break; }
		}
		$ip = trim( (string) ( $server['REMOTE_ADDR'] ?? '' ) );
		$ip_address = filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
		$type = (string) ( $meta['visit_page_type'] ?? '' );
		$pages = array( 'home' => 'صفحه اصلی / ویترین', 'product' => 'صفحه محصول', 'other' => 'صفحه دیگر سایت' );
		$page = $pages[$type] ?? 'نامشخص';
		$ref = strtolower( trim( (string) ( $meta['visit_referrer_host'] ?? '' ) ) );
		if ( strlen( $ref ) > 253 || ! preg_match( '/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/D', $ref ) || strpos( $ref, '..' ) !== false || filter_var( $ref, FILTER_VALIDATE_IP ) ) $ref = '';
		$home_host = strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) );
		if ( $ref !== '' && $ref === $home_host ) $ref = 'صفحه دیگری از همین سایت';
		$lang = trim( (string) ( $meta['visit_language'] ?? '' ) );
		if ( ! preg_match( '/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/D', $lang ) ) $lang = '';
		$screen = array( 'small' => 'کوچک', 'medium' => 'متوسط', 'large' => 'بزرگ' );
		$screen_key = (string) ( $meta['visit_screen'] ?? '' );
		return array( 'device' => $device, 'os' => $os, 'browser' => $browser, 'ip_address' => $ip_address, 'page' => $page,
			'referrer' => $ref, 'language' => $lang, 'screen' => $screen[$screen_key] ?? '',
			'account' => function_exists( 'is_user_logged_in' ) && is_user_logged_in() ? 'وارد حساب شده' : 'مهمان / ناشناس' );
	}

	/** Best-effort short cooldown prevents accidental duplicate visit alerts, without cookies. */
	public static function visitor_notice_allowed() {
		$ip = trim( (string) ( $_SERVER['REMOTE_ADDR'] ?? '' ) );
		// Shared reverse-proxy addresses are not useful as visitor identifiers.
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) || ! function_exists( 'get_transient' ) || ! function_exists( 'set_transient' ) ) return true;
		$salt = function_exists( 'wp_salt' ) ? wp_salt( 'nonce' ) : '';
		$key = 'amphp_visit_' . substr( hash_hmac( 'sha256', $ip, $salt ), 0, 32 );
		if ( get_transient( $key ) ) return false;
		set_transient( $key, 1, 20 );
		return true;
	}

	/** Non-storefront WordPress pages: no query string, referrer path, or persistent visitor ID. */
	public static function print_native_visit_tracker() {
		$settings = self::get_settings();
		if ( empty( $settings['notif_event_site_visit'] ) || is_admin() ) return;
		$ajax_url = wp_json_encode( admin_url( 'admin-ajax.php' ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		echo '<script id="amphp-native-visit-tracker">(function(){try{if((window.AMPHP_STOREFRONT&&document.getElementById("amphp-storefront-root"))||window.__amphpVisitTracked)return;window.__amphpVisitTracked=true;var f=new FormData(),u=new URL(location.href),r="";try{r=document.referrer?new URL(document.referrer).hostname:""}catch(e){}f.append("action","scraper_track_event");f.append("event_type","site_visit");f.append("visit_page_type",u.searchParams.has("product")||/\\/product\\//i.test(u.pathname)?"product":(u.pathname==="/"?"home":"other"));f.append("visit_referrer_host",r);f.append("visit_language",navigator.language||"");f.append("visit_screen",innerWidth<=600?"small":innerWidth<=1024?"medium":"large");fetch(' . $ajax_url . ',{method:"POST",body:f,credentials:"same-origin",keepalive:true}).catch(function(){})}catch(e){}})();</script>';
	}

	/**
	 * Send formatted Persian alert to Bale, Telegram, Rubika on storefront events.
	 *
	 * @param string $event_type
	 * @param array  $meta
	 * @param array  $settings
	 */
	public static function maybe_send_analytics_messenger_notification( $event_type, $meta, $settings ) {
		$key_map = array(
			'site_visit'    => 'notif_event_site_visit',
			'product_view'  => 'notif_event_product_view',
			'add_to_cart'   => 'notif_event_add_to_cart',
			'checkout_step' => 'notif_event_checkout_step',
			'order_placed'  => 'notif_event_order_placed',
		);

		$setting_key = $key_map[ $event_type ] ?? '';
		if ( empty( $setting_key ) || empty( $settings[ $setting_key ] ) ) {
			return;
		}

		$time_str  = date( 'H:i' );
		$shop_name = ! empty( $settings['shop_title'] ) ? $settings['shop_title'] : 'فروشگاه آنلاین';
		$msg       = '';

		switch ( $event_type ) {
			case 'site_visit':
				if ( ! self::visitor_notice_allowed() ) return;
				$info = self::visitor_notice_details( $meta );
				$visit_time = function_exists( 'wp_date' ) ? wp_date( 'Y/m/d H:i:s' ) : date( 'Y/m/d H:i:s' );
				$msg = "🌐 [{$shop_name}] بازدید از سایت\n⏰ زمان سایت: {$visit_time}\n📄 نوع صفحه: {$info['page']}\n👤 وضعیت حساب: {$info['account']}\n📱 نوع دستگاه: {$info['device']}\n💻 سیستم‌عامل: {$info['os']}\n🌐 مرورگر: {$info['browser']}";
				if ( $info['screen'] !== '' ) $msg .= "\n📐 اندازه تقریبی صفحه: {$info['screen']}";
				if ( $info['language'] !== '' ) $msg .= "\n🗣 زبان مرورگر: {$info['language']}";
				$msg .= "\n↪️ دامنه ارجاع: " . ( $info['referrer'] !== '' ? $info['referrer'] : 'نامشخص' );
				$msg .= "\n🌐 IP اتصال (ممکن است پراکسی باشد): " . ( $info['ip_address'] !== '' ? $info['ip_address'] : 'نامشخص' );
				$msg .= "\nℹ️ اطلاعات دستگاه و ارجاع تقریبی و قابل تغییرند.";
				break;

			case 'product_view':
				$p_title = $meta['product_title'] ?? 'کالای فروشگاه';
				$p_price = ! empty( $meta['price'] ) ? self::format_price( $meta['price'] ) : '';
				$msg     = "👁️ [{$shop_name}] مشاهده محصول توسط مشتری
📦 کالا: {$p_title}
" . ( $p_price ? "💰 قیمت: {$p_price}
" : '' ) . "⏰ زمان: {$time_str}";
				break;

			case 'add_to_cart':
				$p_title = $meta['product_title'] ?? 'کالای فروشگاه';
				$qty     = max( 1, intval( $meta['qty'] ?? 1 ) );
				$p_price = ! empty( $meta['price'] ) ? self::format_price( $meta['price'] * $qty ) : '';
				$msg     = "🛒 [{$shop_name}] افزودن به سبد خرید!
📦 کالا: {$p_title}
🔢 تعداد: " . self::to_fa_num( $qty ) . "
" . ( $p_price ? "💰 مبلغ کل کالا: {$p_price}
" : '' ) . "⏰ زمان: {$time_str}";
				break;

			case 'checkout_step':
				$total = ! empty( $meta['total'] ) ? self::format_price( $meta['total'] ) : '';
				$count = ! empty( $meta['count'] ) ? self::to_fa_num( $meta['count'] ) : '۱';
				$msg   = "💳 [{$shop_name}] مشتری وارد مرحله تسویه‌حساب شد!
🛍️ تعداد اقلام: {$count} قلم
" . ( $total ? "💵 جمع کل سبد خرید: {$total}
" : '' ) . "⏰ زمان: {$time_str}
(مرحله آماده پرداخت - احتمال بالای نهایی‌سازی)";
				break;

			case 'order_placed':
				$order_id = $meta['order_id'] ?? ( '#' . rand( 1000, 9999 ) );
				$total    = ! empty( $meta['amount'] ) ? self::format_price( $meta['amount'] ) : ( ! empty( $meta['total'] ) ? self::format_price( $meta['total'] ) : '' );
				$c_name   = $meta['customer_name'] ?? ( $meta['customer'] ?? 'مشتری فروشگاه' );
				$c_phone  = $meta['customer_phone'] ?? '';
				$msg      = "🎉 [{$shop_name}] ثبت سفارش جدید در فروشگاه!
🔖 شماره سفارش: {$order_id}
👤 مشتری: {$c_name}" . ( $c_phone ? " ({$c_phone})" : '' ) . "
" . ( $total ? "💵 مبلغ نهایی: {$total}
" : '' ) . "⏰ زمان: {$time_str}
🚀 لطفاً جهت آماده‌سازی، بسته‌بندی و ارسال اقدام فرمایید.";
				break;
		}

		if ( ! empty( $msg ) ) {
			try {
				self::send_message_to_messengers( $msg, $settings );
			} catch ( \Throwable $e ) {
				// Never break storefront/checkout because of messenger failure.
			}
		}
	}

	/**
	 * AJAX endpoint for frontend client-side tracking.
	 */
	public static function ajax_track_analytics_event() {
		$event_type = sanitize_text_field( $_POST['event_type'] ?? '' );
		$allowed    = array( 'site_visit', 'product_view', 'add_to_cart', 'checkout_step' );
		if ( ! in_array( $event_type, $allowed, true ) ) {
			wp_send_json_error( 'نوع رویداد نامعتبر است.' );
		}

		$meta = array(
			'product_id'     => sanitize_text_field( $_POST['product_id'] ?? '' ),
			'product_title'  => sanitize_text_field( $_POST['product_title'] ?? '' ),
			'price'          => floatval( $_POST['price'] ?? 0 ),
			'qty'            => intval( $_POST['qty'] ?? 1 ),
			'total'          => floatval( $_POST['total'] ?? 0 ),
			'amount'         => floatval( $_POST['amount'] ?? 0 ),
			'count'          => intval( $_POST['count'] ?? 1 ),
			'order_id'       => sanitize_text_field( $_POST['order_id'] ?? '' ),
			'customer_name'  => sanitize_text_field( $_POST['customer_name'] ?? '' ),
			'customer_phone' => sanitize_text_field( $_POST['customer_phone'] ?? '' ),
			'details'        => sanitize_text_field( $_POST['details'] ?? '' ),
			'visit_page_type' => sanitize_text_field( $_POST['visit_page_type'] ?? '' ),
			'visit_referrer_host' => sanitize_text_field( $_POST['visit_referrer_host'] ?? '' ),
			'visit_language' => sanitize_text_field( $_POST['visit_language'] ?? '' ),
			'visit_screen' => sanitize_text_field( $_POST['visit_screen'] ?? '' ),
		);

		self::record_analytics_event( $event_type, $meta );
		wp_send_json_success( array( 'ok' => true, 'event' => $event_type ) );
	}

	/**
	 * AJAX endpoint for admin resetting analytics.
	 */
	public static function ajax_reset_analytics() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		delete_option( 'scraper_analytics_data' );
		delete_option( self::WP_CORE_STATS_OPTION );
		$file = plugin_dir_path( __FILE__ ) . 'scraper_analytics.json';
		if ( file_exists( $file ) ) {
			@unlink( $file );
		}

		// Persist a real empty skeleton (no demo numbers).
		self::save_analytics_data( self::get_empty_analytics_data() );
		wp_send_json_success( array( 'ok' => true, 'message' => 'آمار فروشگاه با موفقیت بازنشانی شد.' ) );
	}

	/** Format untrusted order fields as bounded plain text, not messenger markup. */
	public static function order_notice_text( $value, $limit = 250 ) {
		if ( ! is_scalar( $value ) ) return '';
		$text = html_entity_decode( wp_strip_all_tags( (string) $value ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = trim( preg_replace( '/[\s\x{00A0}]+/u', ' ', $text ) );
		return mb_strlen( $text, 'UTF-8' ) > $limit ? mb_substr( $text, 0, $limit, 'UTF-8' ) . '…' : $text;
	}

	public static function order_notice_money( $value, $currency ) {
		if ( ! is_numeric( $value ) ) return '';
		if ( function_exists( 'wc_price' ) ) return self::order_notice_text( wc_price( (float) $value, array( 'currency' => $currency ) ), 100 );
		return number_format( (float) $value, 2 ) . ' ' . self::order_notice_text( $currency, 20 );
	}

	/** Full order details come only from the WooCommerce order object, never the browser. */
	public static function wc_order_notice_lines( $order, $settings ) {
		$currency = $order->get_currency();
		$money = function( $n ) use ( $currency ) { return self::order_notice_money( $n, $currency ); };
		$shop = self::order_notice_text( $settings['shop_title'] ?? 'فروشگاه آنلاین', 100 );
		$number = self::order_notice_text( $order->get_order_number(), 50 );
		$status = $order->get_status();
		$status_name = function_exists( 'wc_get_order_status_name' ) ? wc_get_order_status_name( $status ) : $status;
		$date = $order->get_date_created();
		$lines = array( '🎉 سفارش جدید ووکامرس — ' . $shop, '🔖 شماره سفارش: #' . $number, '📌 وضعیت سفارش: ' . self::order_notice_text( $status_name ) );
		if ( $date ) $lines[] = '🗓 تاریخ ثبت: ' . self::order_notice_text( method_exists( $date, 'date_i18n' ) ? $date->date_i18n( 'Y/m/d H:i' ) : $date->date( 'Y/m/d H:i' ) );
		$lines[] = '💳 وضعیت پرداخت: ' . ( $order->get_date_paid() ? 'پرداخت ثبت شده' : 'پرداخت ثبت نشده / در انتظار بررسی' );
		$method = self::order_notice_text( $order->get_payment_method_title() );
		if ( $method !== '' ) $lines[] = 'روش پرداخت: ' . $method;
		$lines[] = '';
		$lines[] = '👤 اطلاعات خریدار';
		$billing = $order->get_address( 'billing' );
		$shipping = $order->get_address( 'shipping' );
		$billing = is_array( $billing ) ? $billing : array();
		$shipping = is_array( $shipping ) ? $shipping : array();
		$fields = array( 'first_name' => 'نام', 'last_name' => 'نام خانوادگی', 'company' => 'شرکت', 'phone' => 'تلفن', 'email' => 'ایمیل', 'country' => 'کشور', 'state' => 'استان', 'city' => 'شهر', 'address_1' => 'آدرس', 'address_2' => 'جزئیات آدرس', 'postcode' => 'کد پستی' );
		foreach ( $fields as $key => $label ) {
			$value = self::order_notice_text( $billing[$key] ?? '', 350 );
			if ( $value !== '' ) $lines[] = $label . ': ' . $value;
		}
		$has_shipping = false;
		foreach ( $fields as $key => $label ) if ( self::order_notice_text( $shipping[$key] ?? '' ) !== '' ) { $has_shipping = true; break; }
		if ( $has_shipping ) {
			$lines[] = ''; $lines[] = '📍 اطلاعات گیرنده و ارسال';
			foreach ( $fields as $key => $label ) {
				$value = self::order_notice_text( $shipping[$key] ?? '', 350 );
				if ( $value !== '' ) $lines[] = $label . ': ' . $value;
			}
		}
		$shipping_method = self::order_notice_text( $order->get_shipping_method(), 250 );
		if ( $shipping_method !== '' ) $lines[] = 'روش ارسال: ' . $shipping_method;
		$note = self::order_notice_text( $order->get_customer_note(), 500 );
		if ( $note !== '' ) $lines[] = '📝 یادداشت مشتری: ' . $note;
		$lines[] = ''; $lines[] = '🛍 اقلام سفارش (مبالغ کالا پیش از مالیات)';
		foreach ( $order->get_items( 'line_item' ) as $item ) {
			if ( ! is_object( $item ) ) continue;
			$name = self::order_notice_text( $item->get_name(), 220 );
			$qty = $item->get_quantity();
			$lines[] = '• ' . $name . ' × ' . self::order_notice_text( $qty, 30 );
			$product = $item->get_product();
			if ( $product && method_exists( $product, 'get_sku' ) ) {
				$sku = self::order_notice_text( $product->get_sku(), 100 );
				if ( $sku !== '' ) $lines[] = '  شناسه کالا (SKU): ' . $sku;
			}
			foreach ( $item->get_formatted_meta_data() as $meta ) {
				if ( ! is_object( $meta ) ) continue;
				$key = self::order_notice_text( $meta->display_key ?? '', 80 );
				$value = self::order_notice_text( $meta->display_value ?? '', 250 );
				if ( $key !== '' && $value !== '' ) $lines[] = '  ' . $key . ': ' . $value;
			}
			$lines[] = '  جمع پیش از تخفیف: ' . $money( $item->get_subtotal() ) . ' | پس از تخفیف: ' . $money( $item->get_total() );
			if ( (float) $item->get_total_tax() != 0 ) $lines[] = '  مالیات کالا: ' . $money( $item->get_total_tax() );
		}
		$lines[] = ''; $lines[] = '💰 خلاصه مالی';
		$lines[] = 'جمع کالاها پیش از تخفیف و مالیات: ' . $money( $order->get_subtotal() );
		$lines[] = 'تخفیف: ' . $money( $order->get_discount_total() );
		$lines[] = 'هزینه ارسال: ' . $money( $order->get_shipping_total() );
		foreach ( $order->get_items( 'fee' ) as $fee ) {
			if ( is_object( $fee ) ) $lines[] = 'هزینه ' . self::order_notice_text( $fee->get_name(), 100 ) . ': ' . $money( $fee->get_total() );
		}
		$lines[] = 'مالیات کل: ' . $money( $order->get_total_tax() );
		$lines[] = 'مبلغ نهایی سفارش: ' . $money( $order->get_total() );
		$codes = array();
		foreach ( $order->get_coupon_codes() as $code ) { $code = self::order_notice_text( $code, 80 ); if ( $code !== '' ) $codes[] = $code; }
		if ( $codes ) $lines[] = 'کدهای تخفیف: ' . implode( '، ', array_slice( $codes, 0, 20 ) );
		if ( method_exists( $order, 'get_edit_order_url' ) ) {
			$admin_url = $order->get_edit_order_url();
			if ( is_string( $admin_url ) && $admin_url !== '' ) $lines[] = 'مدیریت سفارش: ' . $admin_url;
		}
		return $lines;
	}

	/** Split before provider limits; number parts so recipients can reassemble them. */
	public static function wc_order_notice_chunks( $lines, $number ) {
		$chunks = array(); $current = '';
		foreach ( $lines as $line ) {
			$line = (string) $line;
			while ( mb_strlen( $line, 'UTF-8' ) > 1800 ) {
				$piece = mb_substr( $line, 0, 1800, 'UTF-8' );
				$line = mb_substr( $line, 1800, null, 'UTF-8' );
				if ( $current !== '' ) { $chunks[] = $current; $current = ''; }
				$chunks[] = $piece;
			}
			if ( $current !== '' && mb_strlen( $current . "\n" . $line, 'UTF-8' ) > 1800 ) { $chunks[] = $current; $current = ''; }
			$current .= ( $current === '' ? '' : "\n" ) . $line;
		}
		if ( $current !== '' ) $chunks[] = $current;
		if ( count( $chunks ) > 12 ) {
			$chunks = array_slice( $chunks, 0, 12 );
			$chunks[11] .= "\nادامه جزئیات در پنل مدیریت سفارش است؛ فهرست پیام کامل نیست.";
		}
		$total = count( $chunks );
		if ( $total > 1 ) foreach ( $chunks as $i => &$chunk ) $chunk = '🧾 سفارش #' . $number . ' — بخش ' . ( $i + 1 ) . '/' . $total . "\n" . $chunk;
		return $chunks;
	}

	/** New-order fires before line items exist; schedule only a fallback, not an early message. */
	public static function on_wc_order_created( $order_id, $order = null ) {
		$order_id = absint( $order_id );
		if ( $order_id && function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( 'amphp_wc_order_notice_fallback', array( $order_id ) ) ) {
			wp_schedule_single_event( time() + 60, 'amphp_wc_order_notice_fallback', array( $order_id ) );
		}
	}

	public static function on_wc_order_notice_fallback( $order_id ) {
		if ( function_exists( 'wc_get_order' ) ) self::on_wc_order_ready( wc_get_order( $order_id ) );
	}

	/** Called after line items are saved, on classic, block and storefront checkouts. */
	public static function on_wc_order_ready( $order ) {
		if ( ! is_object( $order ) || ! method_exists( $order, 'get_id' ) ) return;
		$id = absint( $order->get_id() );
		if ( ! $id ) return;
		$lock = 'amphp_order_notice_lock_' . $id;
		if ( ! add_option( $lock, time(), '', false ) ) {
			$locked_at = (int) get_option( $lock, 0 );
			if ( ! $locked_at || time() - $locked_at < 300 ) return;
			delete_option( $lock );
			if ( ! add_option( $lock, time(), '', false ) ) return;
		}
		try {
			$fresh = function_exists( 'wc_get_order' ) ? wc_get_order( $id ) : null;
			if ( $fresh ) $order = $fresh;
			if ( $order->get_meta( '_amphp_order_notice_recorded', true ) || in_array( $order->get_status(), array( 'checkout-draft', 'auto-draft', 'draft', 'trash' ), true ) || ! $order->get_items( 'line_item' ) ) return;
			$settings = self::get_settings();
			$lines = ! empty( $settings['notif_event_order_placed'] ) ? self::wc_order_notice_lines( $order, $settings ) : array();
			// Mark before dispatch: queued non-blocking requests cannot be safely retried without duplication.
			$order->update_meta_data( '_amphp_order_notice_recorded', '1' );
			$order->save_meta_data();
			try { self::record_analytics_event( 'order_placed', array(
				'order_id' => '#' . $id, 'amount' => $order->get_total(),
				'customer_name' => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
				'customer_phone' => $order->get_billing_phone(), 'details' => 'سفارش آنلاین ووکامرس',
				'_skip_notification' => true,
			) ); } catch ( \Throwable $analytics_error ) { error_log( 'AMPHP order analytics: ' . $analytics_error->getMessage() ); }
			foreach ( self::wc_order_notice_chunks( $lines, self::order_notice_text( $order->get_order_number(), 50 ) ) as $chunk ) self::send_message_to_messengers( $chunk, $settings );
		} catch ( \Throwable $e ) {
			error_log( 'AMPHP order notification: ' . $e->getMessage() );
		} finally {
			delete_option( $lock );
		}
	}



	/**
	 * v10.100: جزئیات کامل یک محصول برای صفحه/مودال ویترین (توضیح، گالری، …).
	 * بوت اولیه lean است؛ این endpoint سنگین را on-demand می‌آورد.
	 */
	/**
	 * v13.3: پیدا کردن محصول خام در profiles.json + کلید پروفایل (برای ذخیرهٔ AI).
	 *
	 * @param string $id md5(title+link) یا key محصول
	 * @return array{raw:array,profile_key:string,entry_key:string}|null
	 */
	public static function find_raw_scraped_product( $id, $strict_id = false ) {
		$id = (string) $id;
		if ( $id === '' ) {
			return null;
		}
		$profiles_file = self::find_profiles_json_path();
		if ( $profiles_file === '' || ! file_exists( $profiles_file ) ) {
			return null;
		}
		$data = @json_decode( (string) @file_get_contents( $profiles_file ), true );
		if ( ! is_array( $data ) ) {
			return null;
		}
		foreach ( $data as $p_key => $p_item ) {
			if ( ! is_array( $p_item ) ) {
				continue;
			}
			$raw_prods = $p_item['products'] ?? array();
			if ( ! is_array( $raw_prods ) ) {
				continue;
			}
			$key_map = self::profile_product_key_map( $raw_prods );
			foreach ( $raw_prods as $ek => $entry ) {
				$prod = null;
				$entry_is_pair = false;
				if ( is_array( $entry ) ) {
					if ( isset( $entry[1] ) && is_array( $entry[1] ) ) {
						$prod = $entry[1];
						$entry_is_pair = true;
					} elseif ( isset( $entry['title'] ) || isset( $entry['name'] ) ) {
						$prod = $entry;
					}
				}
				if ( ! is_array( $prod ) ) {
					continue;
				}
				$title = trim( (string) ( $prod['title'] ?? $prod['name'] ?? '' ) );
				$link  = (string) ( $prod['link'] ?? $prod['url'] ?? '' );
				$hash  = md5( $title . $link );
				$pkey  = (string) ( $prod['key'] ?? ( $entry_is_pair ? (string) ( $entry[0] ?? '' ) : (string) $ek ) );
				if ( self::profile_product_id( $p_key, $ek, $entry, $key_map ) === $id || $hash === $id || ( ! $strict_id && ( $pkey === $id || (string) ( $prod['id'] ?? '' ) === $id ) ) ) {
					return array(
						'raw'         => $prod,
						'profile_key' => (string) $p_key,
						'entry_key'   => $ek,
						'entry_pair'  => $entry_is_pair,
						'pair_key'    => $entry_is_pair ? (string) ( $entry[0] ?? $pkey ) : $pkey,
					);
				}
			}
		}
		return null;
	}

	/**
	 * v13.3: ذخیرهٔ فیلدهای پرشدهٔ AI روی profiles.json.
	 *
	 * @param array $loc  خروجی find_raw_scraped_product
	 * @param array $prod محصول به‌روز
	 * @return bool
	 */
	public static function save_raw_scraped_product( $loc, $prod ) {
		if ( ! is_array( $loc ) || ! is_array( $prod ) ) {
			return false;
		}
		$profiles_file = self::find_profiles_json_path();
		if ( $profiles_file === '' || ! file_exists( $profiles_file ) ) {
			return false;
		}
		$fp = @fopen( $profiles_file, 'c+' );
		if ( ! $fp ) {
			return false;
		}
		if ( ! flock( $fp, LOCK_EX ) ) {
			fclose( $fp );
			return false;
		}
		$raw = stream_get_contents( $fp );
		$data = @json_decode( (string) $raw, true );
		if ( ! is_array( $data ) ) {
			flock( $fp, LOCK_UN );
			fclose( $fp );
			return false;
		}
		$pk = $loc['profile_key'];
		$ek = $loc['entry_key'];
		if ( ! isset( $data[ $pk ]['products'] ) || ! is_array( $data[ $pk ]['products'] ) ) {
			flock( $fp, LOCK_UN );
			fclose( $fp );
			return false;
		}
		$entry = $data[ $pk ]['products'][ $ek ] ?? null;
		if ( ! empty( $loc['entry_pair'] ) && is_array( $entry ) && isset( $entry[1] ) ) {
			$data[ $pk ]['products'][ $ek ] = array( $loc['pair_key'], $prod );
		} elseif ( is_array( $entry ) ) {
			$data[ $pk ]['products'][ $ek ] = $prod;
		} else {
			flock( $fp, LOCK_UN );
			fclose( $fp );
			return false;
		}
		$json = wp_json_encode( $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( ! is_string( $json ) || $json === '' ) {
			flock( $fp, LOCK_UN );
			fclose( $fp );
			return false;
		}
		ftruncate( $fp, 0 );
		rewind( $fp );
		fwrite( $fp, $json );
		fflush( $fp );
		flock( $fp, LOCK_UN );
		fclose( $fp );
		return true;
	}

	/**
	 * v13.3: اگر توضیح خالی است، با موتور AI اسکرپر۴ فوری پر کن (on-view).
	 *
	 * @param array $raw محصول خام پروفایل
	 * @return array{product:array,filled:bool,ai:bool,error?:string}
	 */

	/**
	 * v13.3.8: decode entity-escaped AI HTML so PDP never shows &lt;p&gt; literally.
	 *
	 * @param string $html Raw AI / stored description.
	 * @return string Safe HTML fragment.
	 */
	public static function sanitize_product_description_html( $html ) {
		$html = trim( (string) $html );
		if ( $html === '' ) {
			return '';
		}
		if ( function_exists( 'aiSanitizeDescriptionHtml' ) ) {
			return aiSanitizeDescriptionHtml( $html );
		}
		$html = preg_replace( '/^```(?:html)?\s*/i', '', $html );
		$html = preg_replace( '/\s*```$/', '', $html );
		for ( $i = 0; $i < 4; $i++ ) {
			$prev = $html;
			$html = html_entity_decode( $html, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
			if ( $html === $prev ) {
				break;
			}
		}
		$html = str_replace( array( "\r\n", "\r", '&#13;', '&#x0D;', '&#xd;' ), "\n", $html );
		$html = preg_replace( '/\n{3,}/u', "\n\n", $html );
		$allowed = '<p><br><br/><ul><ol><li><strong><b><em><i><u><h3><h4><h5><div><span>';
		$html = strip_tags( $html, $allowed );
		$html = preg_replace( '/\s(on\w+|style)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/iu', '', $html );
		$html = trim( $html );
		if ( $html !== '' && strpos( $html, '<' ) === false ) {
			$parts = preg_split( '/\n{2,}/u', $html ) ?: array( $html );
			$buf = '';
			foreach ( $parts as $part ) {
				$part = trim( $part );
				if ( $part === '' ) {
					continue;
				}
				$buf .= '<p>' . esc_html( $part ) . '</p>';
			}
			$html = $buf !== '' ? $buf : ( '<p>' . esc_html( $html ) . '</p>' );
		}
		return $html;
	}

	public static function maybe_ai_fill_product_on_view( $raw ) {
		$out = array( 'product' => $raw, 'filled' => false, 'ai' => false );
		if ( ! is_array( $raw ) ) {
			return $out;
		}
		$desc = trim( wp_strip_all_tags( (string) ( $raw['long_desc'] ?? $raw['longDesc'] ?? $raw['description'] ?? $raw['desc'] ?? '' ) ) );
		$short = trim( wp_strip_all_tags( (string) ( $raw['short_desc'] ?? $raw['shortDesc'] ?? $raw['brief'] ?? '' ) ) );
		$need = ( $desc === '' && $short === '' ) || mb_strlen( $desc !== '' ? $desc : $short ) < 40;
		if ( ! $need ) {
			return $out;
		}
		// جلوگیری از اسپم AI روی یک محصول در چند ثانیه
		$lock_key = 'amphp_pdp_ai_' . md5( (string) ( $raw['title'] ?? $raw['name'] ?? '' ) . (string) ( $raw['link'] ?? '' ) );
		if ( get_transient( $lock_key ) ) {
			$out['error'] = 'in_progress';
			return $out;
		}
		set_transient( $lock_key, 1, 90 );

		$filled_prod = null;
		$err = '';
		try {
			if ( self::load_scraper_ai_engine() && function_exists( 'aiFillProductContent' ) ) {
				$r = aiFillProductContent( $raw, true, false, null );
				if ( ! empty( $r['filled'] ) && is_array( $r['product'] ?? null ) ) {
					$filled_prod = $r['product'];
					$out['ai'] = true;
				} elseif ( ! empty( $r['error'] ) ) {
					$err = (string) $r['error'];
				}
			}
		} catch ( \Throwable $e ) {
			$err = $e->getMessage();
		}

		// fallback: call_ai_api ساده اگر موتور اسکرپر در دسترس نبود
		if ( ! $filled_prod ) {
			try {
				$settings = self::get_settings();
				$master = self::get_scraper_master_ai_model( $settings );
				$title = trim( (string) ( $raw['title'] ?? $raw['name'] ?? '' ) );
				if ( $title !== '' && ! empty( $master['endpoint'] ) ) {
					$prompt = "برای محصول «{$title}» یک توضیح فروشگاهی فارسی بنویس.\n"
						. "خروجی فقط JSON: {\"short_description\":\"...\",\"description_html\":\"<p>...</p>\"}";
					$txt = self::call_ai_api( $master, $prompt, 'سیستم', $settings );
					if ( is_string( $txt ) && $txt !== '' ) {
						$j = null;
						if ( preg_match( '/\{[\s\S]*\}/u', $txt, $m ) ) {
							$j = @json_decode( $m[0], true );
						}
						if ( is_array( $j ) ) {
							$filled_prod = $raw;
							$sh = trim( (string) ( $j['short_description'] ?? '' ) );
							$html = trim( (string) ( $j['description_html'] ?? $j['description'] ?? '' ) );
							if ( $sh !== '' ) {
								$filled_prod['short_desc'] = $sh;
								$filled_prod['shortDesc'] = $sh;
							}
							if ( $html !== '' ) {
								$filled_prod['long_desc'] = $html;
								$filled_prod['longDesc'] = $html;
								$filled_prod['description'] = $html;
							}
							$filled_prod['ai_content_at'] = time();
							$out['ai'] = true;
						}
					}
				}
			} catch ( \Throwable $e2 ) {
				$err = $e2->getMessage();
			}
		}

		delete_transient( $lock_key );

		if ( $filled_prod && is_array( $filled_prod ) ) {
			/* v13.3.8: HTML خام entity-encoded را قبل از ذخیره پاک کن */
			foreach ( array( 'long_desc', 'longDesc', 'description', 'desc' ) as $fk ) {
				if ( ! empty( $filled_prod[ $fk ] ) && is_string( $filled_prod[ $fk ] ) ) {
					$filled_prod[ $fk ] = self::sanitize_product_description_html( $filled_prod[ $fk ] );
				}
			}
			foreach ( array( 'short_desc', 'shortDesc', 'brief' ) as $fk ) {
				if ( ! empty( $filled_prod[ $fk ] ) && is_string( $filled_prod[ $fk ] ) ) {
					$filled_prod[ $fk ] = trim( html_entity_decode( wp_strip_all_tags( $filled_prod[ $fk ] ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
				}
			}
			/* تنوع بلند AI را دور بریز */
			if ( ! empty( $filled_prod['variations'] ) && is_array( $filled_prod['variations'] ) ) {
				$filled_prod['variations'] = array_values( array_filter( array_map( function ( $v ) {
					$v = trim( (string) $v );
					if ( $v === '' || mb_strlen( $v, 'UTF-8' ) > 28 ) {
						return null;
					}
					$w = preg_split( '/\s+/u', $v, -1, PREG_SPLIT_NO_EMPTY ) ?: array();
					return count( $w ) <= 4 ? $v : null;
				}, $filled_prod['variations'] ) ) );
			}
			if ( ! empty( $filled_prod['variation_groups'] ) && is_array( $filled_prod['variation_groups'] ) ) {
				$ng = array();
				foreach ( $filled_prod['variation_groups'] as $g ) {
					if ( ! is_array( $g ) ) {
						continue;
					}
					$name = trim( (string) ( $g['name'] ?? '' ) );
					if ( mb_strlen( $name, 'UTF-8' ) > 24 ) {
						$name = 'ویژگی';
					}
					$vals = array();
					foreach ( (array) ( $g['values'] ?? $g['options'] ?? array() ) as $vv ) {
						$vv = trim( (string) $vv );
						if ( $vv === '' || mb_strlen( $vv, 'UTF-8' ) > 28 ) {
							continue;
						}
						$w = preg_split( '/\s+/u', $vv, -1, PREG_SPLIT_NO_EMPTY ) ?: array();
						if ( count( $w ) <= 4 ) {
							$vals[] = $vv;
						}
					}
					if ( $vals ) {
						$ng[] = array( 'name' => ( $name !== '' ? $name : 'ویژگی' ), 'values' => $vals );
					}
				}
				$filled_prod['variation_groups'] = $ng;
				$parts = array();
				foreach ( $ng as $g ) {
					$parts[] = ( $g['name'] !== 'ویژگی' ? $g['name'] . ': ' : '' ) . implode( '، ', $g['values'] );
				}
				$filled_prod['variations_text'] = implode( ' | ', $parts );
			} elseif ( ! empty( $filled_prod['variations_text'] ) ) {
				$vt = trim( (string) $filled_prod['variations_text'] );
				if ( mb_strlen( $vt, 'UTF-8' ) > 160 ) {
					unset( $filled_prod['variations_text'] );
				}
			}
			$out['product'] = $filled_prod;
			$out['filled'] = true;
		} elseif ( $err !== '' ) {
			$out['error'] = $err;
		}
		return $out;
	}

	public static function ajax_get_product() {
		$id = sanitize_text_field( wp_unslash( $_REQUEST['id'] ?? $_REQUEST['product_id'] ?? '' ) );
		if ( $id === '' ) {
			wp_send_json_error( array( 'message' => 'شناسه محصول خالی است' ), 400 );
		}
		$ai_filled = false;
		$ai_error  = '';
		$wc_id = 0;
		if ( preg_match( '/^wc_(\d+)$/', $id, $mm ) ) {
			$wc_id = (int) $mm[1];
		} elseif ( ctype_digit( $id ) && function_exists( 'wc_get_product' ) ) {
			$wc_id = (int) $id;
		}
		if ( $wc_id > 0 && function_exists( 'wc_get_product' ) ) {
			$wp_prod = wc_get_product( $wc_id );
			if ( $wp_prod ) {
				$price = (float) $wp_prod->get_price();
				$reg_price = (float) $wp_prod->get_regular_price();
				$sale_price = (float) $wp_prod->get_sale_price();
				$has_discount = ( $sale_price > 0 && $reg_price > $sale_price );
				$discount_pct = ( $has_discount && $reg_price > 0 ) ? round( ( ( $reg_price - $sale_price ) / $reg_price ) * 100 ) : 0;
				$img_id = $wp_prod->get_image_id();
				$img_url = $img_id ? wp_get_attachment_image_url( $img_id, 'full' ) : '';
				$gallery = $img_url ? array( $img_url ) : array();
				foreach ( (array) $wp_prod->get_gallery_image_ids() as $gid ) {
					$gu = wp_get_attachment_image_url( $gid, 'full' );
					if ( $gu ) { $gallery[] = $gu; }
				}
				$cat_list = function_exists( 'wc_get_product_category_list' ) ? wp_strip_all_tags( wc_get_product_category_list( $wc_id ) ) : '';
				wp_send_json_success( array(
					'product' => array(
						'id' => 'wc_' . $wc_id, 'wc_id' => $wc_id, 'title' => $wp_prod->get_name(),
						'has_price' => ( $price > 0 ), 'price' => $price, 'price_formatted' => number_format( $price ) . ' تومان',
						'old_price' => $has_discount ? $reg_price : 0,
						'old_price_formatted' => $has_discount ? ( number_format( $reg_price ) . ' تومان' ) : '',
						'has_discount' => $has_discount, 'discount_pct' => $discount_pct,
						'image' => $img_url, 'gallery' => $gallery,
						'category' => $cat_list ?: 'کالای عمومی',
						'description' => $wp_prod->get_description() ?: $wp_prod->get_short_description(),
						'short_desc' => $wp_prod->get_short_description(),
						'in_stock' => $wp_prod->is_in_stock(), 'sku' => $wp_prod->get_sku(),
						'source' => 'woocommerce', 'source_label' => 'ووکامرس',
					),
					'ai_filled' => false,
				) );
			}
		}
		// v13.3: اول محصول خام — اگر توضیح خالی، AI فوری پر می‌کند
		$loc = self::find_raw_scraped_product( $id );
		if ( $loc && is_array( $loc['raw'] ?? null ) ) {
			$fill = self::maybe_ai_fill_product_on_view( $loc['raw'] );
			if ( ! empty( $fill['filled'] ) && is_array( $fill['product'] ?? null ) ) {
				self::save_raw_scraped_product( $loc, $fill['product'] );
				$ai_filled = true;
			}
			if ( ! empty( $fill['error'] ) ) {
				$ai_error = (string) $fill['error'];
			}
		}

		$products = self::get_all_scraped_products();
		$found    = null;
		foreach ( (array) $products as $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}
			$pid = (string) ( $p['id'] ?? '' );
			if ( $pid === $id || (string) ( $p['key'] ?? '' ) === $id ) {
				$found = $p;
				break;
			}
		}
		// اگر get_all هنوز کش قدیمی دارد، از raw پر‌شده بساز
		if ( ! $found && $loc && is_array( $loc['raw'] ?? null ) ) {
			$raw = ! empty( $fill['product'] ) ? $fill['product'] : $loc['raw'];
			$settings = self::get_settings();
			$price_calc = self::calculate_price( $raw, $settings );
			$img = $raw['image'] ?? $raw['img'] ?? '';
			$found = array(
				'id'                  => $id,
				'title'               => trim( (string) ( $raw['title'] ?? $raw['name'] ?? '' ) ),
				'has_price'           => $price_calc['has_price'],
				'price'               => $price_calc['adjusted'],
				'price_formatted'     => $price_calc['formatted'],
				'old_price'           => $price_calc['old_price'],
				'old_price_formatted' => $price_calc['formatted_old'],
				'has_discount'        => $price_calc['has_discount'],
				'discount_pct'        => $price_calc['discount_pct'],
				'image'               => $img,
				'gallery'             => ! empty( $raw['images'] ) && is_array( $raw['images'] ) ? $raw['images'] : ( $img ? array( $img ) : array() ),
				'category'            => (string) ( $raw['category'] ?? 'عمومی' ),
				'description'         => (string) ( $raw['long_desc'] ?? $raw['longDesc'] ?? $raw['description'] ?? '' ),
				'short_desc'          => (string) ( $raw['short_desc'] ?? $raw['shortDesc'] ?? '' ),
				'in_stock'            => true,
				'variations_text'     => (string) ( $raw['variations_text'] ?? '' ),
				'variation_groups'    => is_array( $raw['variation_groups'] ?? null ) ? $raw['variation_groups'] : array(),
				'specs'               => is_array( $raw['specs'] ?? null ) ? $raw['specs'] : array(),
			);
		}
		if ( ! $found ) {
			wp_send_json_error( array( 'message' => 'محصول یافت نشد', 'id' => $id ), 404 );
		}
		// اگر AI پر کرد ولی get_all هنوز توضیح قدیمی دارد — از raw ادغام کن
		if ( $ai_filled && $loc && is_array( $fill['product'] ?? null ) ) {
			$rp = $fill['product'];
			$ld = (string) ( $rp['long_desc'] ?? $rp['longDesc'] ?? $rp['description'] ?? '' );
			$sd = (string) ( $rp['short_desc'] ?? $rp['shortDesc'] ?? '' );
			if ( $ld !== '' ) {
				$found['description'] = $ld;
			}
			if ( $sd !== '' ) {
				$found['short_desc'] = $sd;
			}
			if ( ! empty( $rp['category'] ) ) {
				$found['category'] = (string) $rp['category'];
			}
			if ( ! empty( $rp['variations_text'] ) ) {
				$found['variations_text'] = (string) $rp['variations_text'];
			}
			if ( ! empty( $rp['variation_groups'] ) && is_array( $rp['variation_groups'] ) ) {
				$found['variation_groups'] = $rp['variation_groups'];
			}
		}

		$gallery = array();
		if ( ! empty( $found['gallery'] ) && is_array( $found['gallery'] ) ) {
			foreach ( $found['gallery'] as $g ) {
				$u = esc_url_raw( (string) $g );
				if ( $u !== '' ) {
					$gallery[] = $u;
				}
			}
		}
		if ( ! empty( $found['images'] ) && is_array( $found['images'] ) ) {
			foreach ( $found['images'] as $g ) {
				$u = esc_url_raw( (string) $g );
				if ( $u !== '' && ! in_array( $u, $gallery, true ) ) {
					$gallery[] = $u;
				}
			}
		}
		$img = esc_url_raw( (string) ( $found['image'] ?? '' ) );
		if ( $img !== '' && ! in_array( $img, $gallery, true ) ) {
			array_unshift( $gallery, $img );
		}
		if ( ! $gallery && $img ) {
			$gallery = array( $img );
		}

		$desc = (string) ( $found['description'] ?? $found['long_desc'] ?? $found['longDesc'] ?? $found['desc'] ?? '' );
		$short = (string) ( $found['short_desc'] ?? $found['shortDesc'] ?? '' );
		// v13.3.8: HTML واقعی برای PDP (نه entity-encoded)
		$desc_out = self::sanitize_product_description_html( $desc );
		$short_clean = trim( html_entity_decode( wp_strip_all_tags( $short ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		if ( $desc_out === '' && $short_clean !== '' ) {
			$desc_out = '<p>' . esc_html( $short_clean ) . '</p>';
		}
		$desc_clean = wp_strip_all_tags( $desc_out );

		$specs = array();
		if ( ! empty( $found['specs'] ) && is_array( $found['specs'] ) ) {
			$specs = $found['specs'];
		} elseif ( ! empty( $found['attributes'] ) && is_array( $found['attributes'] ) ) {
			$specs = $found['attributes'];
		}
		$variations_text = (string) ( $found['variations_text'] ?? '' );
		if ( $variations_text === '' && ! empty( $found['variations'] ) && is_array( $found['variations'] ) ) {
			$variations_text = implode( '، ', array_map( 'strval', $found['variations'] ) );
		}
		/* v13.3.8: متن تنوع بلند (جمله) را نشان نده */
		if ( $variations_text !== '' && mb_strlen( $variations_text, 'UTF-8' ) > 160 ) {
			$variations_text = '';
		}
		$variation_groups_out = is_array( $found['variation_groups'] ?? null ) ? $found['variation_groups'] : array();
		if ( $variation_groups_out ) {
			$vg2 = array();
			foreach ( $variation_groups_out as $g ) {
				if ( ! is_array( $g ) ) {
					continue;
				}
				$vals = array();
				foreach ( (array) ( $g['values'] ?? array() ) as $vv ) {
					$vv = trim( (string) $vv );
					if ( $vv !== '' && mb_strlen( $vv, 'UTF-8' ) <= 28 ) {
						$vals[] = $vv;
					}
				}
				if ( $vals ) {
					$vg2[] = array(
						'name'   => mb_substr( trim( (string) ( $g['name'] ?? 'ویژگی' ) ), 0, 24 ),
						'values' => $vals,
					);
				}
			}
			$variation_groups_out = $vg2;
		}

		$out = array(
			'id'                   => (string) ( $found['id'] ?? $id ),
			'title'                => (string) ( $found['title'] ?? '' ),
			'has_price'            => ! empty( $found['has_price'] ),
			'price'                => floatval( $found['price'] ?? 0 ),
			'price_formatted'      => (string) ( $found['price_formatted'] ?? '' ),
			'old_price'            => floatval( $found['old_price'] ?? 0 ),
			'old_price_formatted'  => (string) ( $found['old_price_formatted'] ?? '' ),
			'has_discount'         => ! empty( $found['has_discount'] ),
			'discount_pct'         => intval( $found['discount_pct'] ?? 0 ),
			'image'                => $img,
			'gallery'              => array_values( array_slice( $gallery, 0, 12 ) ),
			'category'             => (string) ( $found['category'] ?? 'عمومی' ),
			'description'          => $desc_out !== '' ? $desc_out : $desc_clean,
			'short_desc'           => $short_clean,
			'in_stock'             => isset( $found['in_stock'] ) ? (bool) $found['in_stock'] : true,
			'specs'                => $specs,
			'variations_text'      => $variations_text,
			'variation_groups'     => isset( $variation_groups_out ) ? $variation_groups_out : ( is_array( $found['variation_groups'] ?? null ) ? $found['variation_groups'] : array() ),
			'ai_filled'            => $ai_filled,
			'ai_pending'           => ( $ai_error === 'in_progress' ),
		);
		wp_send_json_success( array( 'product' => $out ) );
	}

	/** Normalize product names only for conservative matching; never use a chat URL for fetching. */
	public static function live_name( $text ) {
		$text = mb_strtolower( strtr( (string) $text, array( 'ي' => 'ی', 'ك' => 'ک', '‌' => ' ' ) ), 'UTF-8' );
		return trim( preg_replace( '/\s+/u', ' ', preg_replace( '/[^\p{L}\p{N}]+/u', ' ', $text ) ) );
	}

	/** A deliberately small CSS subset for saved detail selectors; unsupported selectors fail closed. */
	public static function live_selector_xpath( $selector ) {
		if ( ! is_string( $selector ) || strlen( $selector ) > 300 ) return '';
		$branches = array();
		foreach ( explode( ',', $selector ) as $branch ) {
			$tokens = preg_split( '/\s+/', trim( preg_replace( '/\s*>\s*/', ' > ', trim( $branch ) ) ), -1, PREG_SPLIT_NO_EMPTY );
			if ( ! $tokens || count( $tokens ) > 12 ) return '';
			$xpath = ''; $axis = '//';
			foreach ( $tokens as $token ) {
				if ( $token === '>' ) { if ( $xpath === '' || $axis === '/' ) return ''; $axis = '/'; continue; }
				if ( ! preg_match( '/^(\*|[a-zA-Z][a-zA-Z0-9_-]*)?((?:[.#][a-zA-Z0-9_-]+)*)$/', $token, $m ) || ( $m[1] === '' && $m[2] === '' ) ) return '';
				$step = $m[1] !== '' ? $m[1] : '*';
				preg_match_all( '/([.#])([a-zA-Z0-9_-]+)/', $m[2], $selectors, PREG_SET_ORDER );
				foreach ( $selectors as $selector_part ) {
					$step .= $selector_part[1] === '#' ? "[@id='" . $selector_part[2] . "']" : "[contains(concat(' ',normalize-space(@class),' '),' " . $selector_part[2] . " ')]";
				}
				$xpath .= $axis . $step; $axis = '//';
			}
			if ( $axis === '/' ) return '';
			$branches[] = $xpath;
		}
		return implode( ' | ', $branches );
	}

	/** Extract only structured, bounded facts. Page text is never used as an AI instruction. */
	public static function live_product_parse( $html, $title, $selectors = array() ) {
		$out = array( 'price' => '', 'currency' => '', 'stock' => '', 'variants' => array(), 'options' => array(), 'truncated' => false );
		if ( ! class_exists( 'DOMDocument' ) || ! is_string( $html ) || $html === '' ) return $out;
		$previous = libxml_use_internal_errors( true );
		$dom = new \DOMDocument();
		$ok = @$dom->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING );
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		if ( ! $ok ) return $out;
		$xp = new \DOMXPath( $dom );
		// Find the matching Product rather than an arbitrary recommendation on the page.
		$products = array();
		$walk = function ( $node, $depth = 0 ) use ( &$walk, &$products ) {
			if ( ! is_array( $node ) || $depth > 12 || count( $products ) >= 100 ) return;
			$type = $node['@type'] ?? '';
			if ( in_array( 'Product', (array) $type, true ) || in_array( 'ProductGroup', (array) $type, true ) ) $products[] = $node;
			foreach ( $node as $v ) if ( is_array( $v ) ) $walk( $v, $depth + 1 );
		};
		foreach ( $xp->query( '//script[@type="application/ld+json"]' ) as $script ) {
			$walk( json_decode( $script->textContent, true ) );
		}
		$norm_title = self::live_name( $title );
		$matched = array();
		foreach ( $products as $product ) {
			$name = isset( $product['name'] ) && is_string( $product['name'] ) ? self::live_name( $product['name'] ) : '';
			if ( $name !== '' && $name === $norm_title ) $matched[] = $product;
		}
		if ( count( $matched ) === 1 ) {
			$offers = $matched[0]['offers'] ?? array();
			if ( isset( $offers[0] ) ) $offers = count( $offers ) === 1 ? $offers[0] : array();
			if ( is_array( $offers ) ) {
				$price = $offers['price'] ?? '';
				if ( is_scalar( $price ) && preg_match( '/^\d{1,12}(?:\.\d{1,2})?$/', (string) $price ) && (float) $price > 0 ) $out['price'] = (string) $price;
				$currency = $offers['priceCurrency'] ?? '';
				if ( is_string( $currency ) && preg_match( '/^[A-Za-z]{3}$/', $currency ) ) $out['currency'] = strtoupper( $currency );
				$availability = $offers['availability'] ?? '';
				if ( is_string( $availability ) && preg_match( '~(?:^|[/#])(InStock|OutOfStock)$~i', $availability, $m ) ) $out['stock'] = strtolower( $m[1] ) === 'instock' ? 'موجود' : 'ناموجود';
			}
		}
		// WooCommerce variation combinations carry per-combination stock; do not infer it from option labels.
		$forms = $xp->query( '//*[@data-product_variations]' );
		if ( $forms && $forms->length === 1 ) {
			$vars = json_decode( $forms->item(0)->getAttribute( 'data-product_variations' ), true );
			if ( is_array( $vars ) ) foreach ( array_slice( $vars, 0, 100 ) as $v ) {
				if ( ! is_array( $v ) || ! is_array( $v['attributes'] ?? null ) ) continue;
				$parts = array(); $incomplete = false;
				foreach ( $v['attributes'] as $key => $value ) {
					if ( ! is_string( $value ) || $value === '' ) { $incomplete = true; continue; }
					if ( mb_strlen( $value, 'UTF-8' ) > 50 || ! preg_match( '/^[\p{L}\p{N}\s_\-\.]+$/u', $value ) ) { $incomplete = true; continue; }
					$key = rawurldecode( (string) $key );
					$label = preg_match( '/color|colour|رنگ/i', $key ) ? 'رنگ' : ( preg_match( '/size|سایز|اندازه/i', $key ) ? 'سایز' : '' );
					if ( $label === '' ) {
						$label = preg_replace( '/^(attribute_)?(pa_)?/', '', $key );
						if ( ! preg_match( '/^[\p{L}\p{N}_-]{1,40}$/u', $label ) ) { $incomplete = true; continue; }
					}
					$parts[] = $label . ': ' . $value;
				}
				if ( ! $parts ) continue;
				$stock = 'موجودی نامشخص';
				if ( isset( $v['is_in_stock'] ) && is_bool( $v['is_in_stock'] ) ) {
					$stock = $v['is_in_stock'] ? 'موجود' : 'ناموجود';
					if ( $v['is_in_stock'] && ( ! empty( $v['backorders_allowed'] ) || ( is_string( $v['availability_html'] ?? null ) && strpos( $v['availability_html'], 'available-on-backorder' ) !== false ) ) ) $stock = 'قابل سفارش؛ موجودی انبار نامشخص';
					if ( ( isset( $v['variation_is_active'] ) && $v['variation_is_active'] === false ) || ( isset( $v['variation_is_purchasable'] ) && $v['variation_is_purchasable'] === false ) || ( isset( $v['variation_is_visible'] ) && $v['variation_is_visible'] === false ) ) $stock = 'غیرقابل خرید';
				}
				if ( $incomplete && $stock === 'موجود' ) $stock = 'موجودی ترکیب دقیق نامشخص';
				$variation_price = $v['display_price'] ?? '';
				$price_note = is_scalar( $variation_price ) && preg_match( '/^\d{1,12}(?:\.\d{1,2})?$/', (string) $variation_price ) && (float) $variation_price > 0 ? '، قیمت مبدأ: ' . $variation_price . ' ' . ( $out['currency'] ?: 'با واحد نامشخص' ) : '';
				$out['variants'][] = implode( '، ', $parts ) . ' — ' . $stock . $price_note;
			}
		}
		// Saved detail selectors are trusted configuration, but page values remain untrusted data.
		foreach ( array( 'price', 'variations' ) as $field ) {
			$config = $selectors[ $field ] ?? '';
			if ( is_array( $config ) ) $config = array_key_exists( 'enabled', $config ) && ! $config['enabled'] ? '' : ( $config['selector'] ?? '' );
			$path = self::live_selector_xpath( $config );
			if ( $path === '' ) continue;
			$nodes = @$xp->query( $path );
			if ( ! $nodes ) continue;
			if ( $field === 'price' && $out['price'] === '' && $nodes->length === 1 ) {
				$text = strtr( $nodes->item(0)->textContent, array_combine( preg_split( '//u', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', -1, PREG_SPLIT_NO_EMPTY ), str_split( '01234567890123456789' ) ) );
				if ( preg_match_all( '/(?<![\d])([\d][\d,،٬\s]*[\d]|[\d])\s*(تومان|تومن|ریال)(?![\p{L}])/u', $text, $found, PREG_SET_ORDER ) === 1 ) {
					$amount = preg_replace( '/[^0-9]/', '', $found[0][1] );
					if ( strlen( $amount ) <= 12 && (float) $amount > 0 ) { $out['price'] = $amount; $out['currency'] = $found[0][2]; }
				}
			} elseif ( $field === 'variations' && ! $out['variants'] ) {
				foreach ( $nodes as $node ) {
					$candidates = strtolower( $node->nodeName ) === 'select' ? $xp->query( './/option[@value and @value!=""]', $node ) : array( $node );
					foreach ( $candidates as $item ) {
						$value = trim( $item->textContent );
						if ( $value !== '' && mb_strlen( $value, 'UTF-8' ) <= 50 && preg_match( '/^[\p{L}\p{N}\s_\-\.]+$/u', $value ) ) $out['options'][] = $value;
						if ( count( $out['options'] ) >= 20 ) break;
					}
					if ( count( $out['options'] ) >= 20 ) break;
				}
			}
		}
		$out['options'] = array_values( array_unique( $out['options'] ) );
		$out['variants'] = array_values( array_unique( $out['variants'] ) );
		return $out;
	}

	/** Only recognize exact upstream hosts and product paths; API hosts are constants. */
	public static function live_marketplace_endpoint( $parts ) {
		$host = strtolower( (string) ( $parts['host'] ?? '' ) );
		$path = (string) ( $parts['path'] ?? '' );
		if ( in_array( $host, array( 'digikala.com', 'www.digikala.com' ), true ) ) {
			if ( preg_match( '~^/product/dkp-([0-9]{1,15})(?:/|$)~i', $path, $m ) ) return array( 'provider' => 'digikala', 'id' => $m[1], 'url' => 'https://api.digikala.com/v2/product/' . $m[1] . '/' );
			return array( 'provider' => 'digikala', 'id' => '', 'url' => '' );
		}
		if ( in_array( $host, array( 'snappshop.ir', 'www.snappshop.ir' ), true ) ) {
			if ( preg_match( '~^/product/(?:snp-([0-9]{1,15})|([A-Za-z0-9]{1,20}))(?:/|$)~i', $path, $m ) ) {
				$id = $m[1] !== '' ? $m[1] : $m[2];
				return array( 'provider' => 'snappshop', 'id' => $id, 'url' => 'https://apix.snappshop.ir/products/v2/' . $id );
			}
			return array( 'provider' => 'snappshop', 'id' => '', 'url' => '' );
		}
		return null;
	}

	public static function live_api_label( $value ) {
		if ( ! is_string( $value ) && ! is_numeric( $value ) ) return '';
		$value = trim( (string) $value );
		return $value !== '' && mb_strlen( $value, 'UTF-8' ) <= 60 && preg_match( '/^[\p{L}\p{N}\s_\-\.]+$/u', $value ) ? $value : '';
	}

	public static function live_api_price( $value ) {
		return is_scalar( $value ) && preg_match( '/^\d{1,12}(?:\.\d{1,2})?$/', (string) $value ) && (float) $value > 0 ? (string) $value : '';
	}

	/** Whitelist known fields; never forward external descriptions or instructions to the model. */
	public static function live_marketplace_parse( $body, $market ) {
		$j = json_decode( $body, true );
		if ( ! is_array( $j ) || ( isset( $j['status'] ) && $j['status'] === false ) ) return null;
		$data = $j['data'] ?? null;
		if ( ! is_array( $data ) ) return null;
		$out = array( 'price' => '', 'currency' => '', 'stock' => '', 'variants' => array(), 'options' => array(), 'truncated' => false );
		if ( $market['provider'] === 'digikala' ) {
			$p = $data['product'] ?? null;
			if ( ! is_array( $p ) || ! isset( $p['id'] ) || ! is_scalar( $p['id'] ) || (string) $p['id'] !== $market['id'] ) return null;
			$out['currency'] = 'ریال';
			$default = is_array( $p['default_variant'] ?? null ) ? $p['default_variant'] : array();
			$out['price'] = self::live_api_price( $default['price']['selling_price'] ?? '' );
			$status = $p['status'] ?? '';
			if ( $status === 'marketable' ) $out['stock'] = 'موجود';
			elseif ( in_array( $status, array( 'out_of_stock', 'unavailable' ), true ) ) $out['stock'] = 'ناموجود';
			if ( is_array( $p['variants'] ?? null ) && count( $p['variants'] ) > 100 ) $out['truncated'] = true;
			foreach ( array_slice( is_array( $p['variants'] ?? null ) ? $p['variants'] : array(), 0, 100 ) as $v ) {
				if ( ! is_array( $v ) ) continue;
				$labels = array();
				foreach ( array( 'color' => 'رنگ', 'size' => 'سایز' ) as $key => $name ) {
					$raw = $v[$key] ?? '';
					$label = self::live_api_label( is_array( $raw ) ? ( $raw['title'] ?? $raw['title_fa'] ?? '' ) : $raw );
					if ( $label !== '' ) $labels[] = $name . ': ' . $label;
				}
				if ( ! $labels ) continue;
				$seller = self::live_api_label( $v['seller']['title'] ?? '' );
				if ( $seller !== '' ) $labels[] = 'فروشنده: ' . $seller;
				$stock = 'موجودی نامشخص';
				if ( isset( $v['status'] ) && $v['status'] === 'marketable' ) $stock = 'موجود';
				elseif ( in_array( $v['status'] ?? '', array( 'out_of_stock', 'unavailable' ), true ) ) $stock = 'ناموجود';
				$qty = $v['stock'] ?? null;
				if ( is_array( $qty ) ) $qty = $qty['is_in_stock'] ?? $qty['available'] ?? null;
				if ( ( $qty === false || ( is_numeric( $qty ) && (float) $qty <= 0 ) ) && $stock === 'موجود' ) $stock = 'موجودی نامشخص';
				$price = self::live_api_price( $v['price']['selling_price'] ?? '' );
				$out['variants'][] = implode( '، ', $labels ) . ' — ' . $stock . ( $price !== '' ? '، قیمت مبدأ: ' . $price . ' ریال' : '' );
			}
		} else {
			// Numeric snp IDs can map to opaque internal IDs. Require an independent canonical/sku match.
			$identity_ok = isset( $data['id'] ) && is_scalar( $data['id'] ) && (string) $data['id'] === $market['id'];
			$page = is_array( $data['page'] ?? null ) ? $data['page'] : array();
			$urls = array( $page['canonical_url'] ?? '', $page['redirect_url'] ?? '' );
			foreach ( (array) ( $page['extra_meta'] ?? array() ) as $meta ) if ( is_array( $meta ) && ( $meta['property'] ?? '' ) === 'og:url' ) $urls[] = $meta['content'] ?? '';
			foreach ( $urls as $url ) {
				if ( ! is_string( $url ) ) continue;
				$parsed = wp_parse_url( $url );
				$canonical = is_array( $parsed ) ? self::live_marketplace_endpoint( $parsed ) : null;
				if ( $canonical && $canonical['provider'] === 'snappshop' && $canonical['id'] === $market['id'] ) $identity_ok = true;
			}
			if ( ! $identity_ok ) return null;
			$out['currency'] = 'تومان'; // SnappShop vendor price fields are in toman, unlike JSON-LD prices in rial.
			$attr_map = array();
			foreach ( array_slice( is_array( $data['configurable_attribute'] ?? null ) ? $data['configurable_attribute'] : array(), 0, 200 ) as $attr ) {
				if ( ! is_array( $attr ) || ! is_array( $attr['value'] ?? null ) || ! isset( $attr['value']['id'] ) ) continue;
				$value = self::live_api_label( $attr['value']['title'] ?? '' );
				$name = self::live_api_label( $attr['title'] ?? '' );
				if ( $name !== '' && $value !== '' ) $attr_map[(string) $attr['value']['id']] = $name . ': ' . $value;
			}
			$default = is_array( $data['default_variant'] ?? null ) ? $data['default_variant'] : array();
			$seller_map = array();
			foreach ( array_slice( is_array( $data['vendors'] ?? null ) ? $data['vendors'] : array(), 0, 200 ) as $seller ) {
				if ( is_array( $seller ) && isset( $seller['id'] ) && is_scalar( $seller['id'] ) ) $seller_map[(string) $seller['id']] = self::live_api_label( $seller['title'] ?? $seller['title_fa'] ?? '' );
			}
			$seen_stock = array();
			if ( is_array( $data['variants'] ?? null ) && count( $data['variants'] ) > 100 ) $out['truncated'] = true;
			foreach ( array_slice( is_array( $data['variants'] ?? null ) ? $data['variants'] : array(), 0, 100 ) as $variant ) {
				if ( ! is_array( $variant ) ) continue;
				$labels = array(); $complete = true;
				foreach ( (array) ( $variant['attribute_ids'] ?? array() ) as $attribute ) {
					$id = is_array( $attribute ) ? (string) ( $attribute['attribute_value_id'] ?? '' ) : '';
					if ( isset( $attr_map[$id] ) ) $labels[] = $attr_map[$id]; else $complete = false;
				}
				if ( is_array( $variant['vendor'] ?? null ) && count( $variant['vendor'] ) > 100 ) $out['truncated'] = true;
				foreach ( array_slice( is_array( $variant['vendor'] ?? null ) ? $variant['vendor'] : array(), 0, 100 ) as $vendor ) {
					if ( ! is_array( $vendor ) ) continue;
					$stock = 'موجودی نامشخص';
					$flags = array( $vendor['is_available_in_shop'] ?? null, $vendor['is_available_in_vendor_inventory'] ?? null );
					if ( in_array( true, $flags, true ) ) $stock = 'موجود';
					elseif ( $flags[0] === false && $flags[1] === false && isset( $vendor['stock'] ) && is_numeric( $vendor['stock'] ) && (float) $vendor['stock'] <= 0 ) $stock = 'ناموجود';
					if ( isset( $vendor['stock'] ) && is_numeric( $vendor['stock'] ) && (float) $vendor['stock'] <= 0 && $stock === 'موجود' ) $stock = 'موجودی نامشخص';
					$seen_stock[] = $stock;
					$price = self::live_api_price( $vendor['price'] ?? '' );
					$special = self::live_api_price( $vendor['special_price'] ?? '' );
					if ( $special !== '' && ( $price === '' || (float) $special < (float) $price ) ) $price = $special;
					if ( isset( $default['vendor_product_info_id'], $vendor['vendor_product_info_id'] ) && (string) $default['vendor_product_info_id'] === (string) $vendor['vendor_product_info_id'] ) $out['price'] = $price;
					if ( ! $labels ) continue;
					if ( ! $complete && $stock === 'موجود' ) $stock = 'موجودی ترکیب دقیق نامشخص';
					$offer_labels = $labels;
					$seller_id = is_scalar( $vendor['vendor_id'] ?? null ) ? (string) $vendor['vendor_id'] : '';
					if ( ! empty( $seller_map[$seller_id] ) ) $offer_labels[] = 'فروشنده: ' . $seller_map[$seller_id];
					$out['variants'][] = implode( '، ', $offer_labels ) . ' — ' . $stock . ( $price !== '' ? '، قیمت مبدأ: ' . $price . ' تومان' : '' );
				}
			}
			if ( in_array( 'موجود', $seen_stock, true ) ) $out['stock'] = 'حداقل یک پیشنهاد موجود است';
			// Absence of an available offer in a possibly truncated list does not prove unavailability.
		}
		$out['variants'] = array_values( array_unique( $out['variants'] ) );
		return $out;
	}

	/** Returns null for unrelated chat; otherwise an honest, deterministic live-product reply. */
	public static function live_product_chat_reply( $message, $product_id = '' ) {
		$products = self::get_all_scraped_products();
		$matches = array();
		$normalized = self::live_name( $message );
		foreach ( (array) $products as $p ) {
			if ( ( $p['source'] ?? '' ) !== 'scraper' ) continue;
			$title = self::live_name( $p['title'] ?? '' );
			if ( $product_id !== '' ? (string) ( $p['id'] ?? '' ) === (string) $product_id : ( $title !== '' && mb_strlen( $title, 'UTF-8' ) >= 4 && mb_strpos( ' ' . $normalized . ' ', ' ' . $title . ' ' ) !== false ) ) $matches[] = $p;
		}
		if ( ! $matches ) {
			if ( $product_id !== '' || ( preg_match( '/(سایز|سايز|رنگ|موجودی|موجوده|ناموجود|قیمت|چنده|چقدره)/u', $message ) && ! preg_match( '/(ارسال|پست|پیک)/u', $message ) ) ) return 'برای بررسی قیمت و موجودی، لطفاً محصول را از ویترین انتخاب کنید یا نام کامل و دقیق آن را بفرستید.';
			return null;
		}
		if ( count( $matches ) !== 1 ) return 'چند محصول با این نام پیدا شد؛ لطفاً محصول موردنظر را از ویترین انتخاب کنید تا اشتباه نشود.';
		$p = $matches[0];
		$loc = self::find_raw_scraped_product( $p['id'], true );
		if ( ! $loc || $loc['profile_key'] !== (string) $p['profile_key'] ) return 'محصول در پروفایل پیدا نشد؛ لطفاً از پشتیبانی استعلام بگیرید.';
		$url = trim( (string) ( $loc['raw']['link'] ?? $loc['raw']['url'] ?? '' ) );
		$parts = wp_parse_url( $url );
		$safe = is_array( $parts ) && isset( $parts['host'], $parts['scheme'] ) && in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) && empty( $parts['user'] ) && empty( $parts['pass'] ) && ( ! isset( $parts['port'] ) || ( strtolower( $parts['scheme'] ) === 'https' ? (int) $parts['port'] === 443 : (int) $parts['port'] === 80 ) );
		$unavailable = 'برای «' . $p['title'] . '» اطلاعات زنده قیمت، موجودی و تنوع قابل تأیید نیست؛ لطفاً از پشتیبانی استعلام بگیرید.';
		if ( ! $safe ) return $unavailable;
		$market = self::live_marketplace_endpoint( $parts );
		$fetch_url = $market ? $market['url'] : $url;
		if ( $fetch_url === '' || ! wp_http_validate_url( $fetch_url ) ) return $unavailable;
		// Bound repeated anonymous requests without caching source data as current.
		$rate_key = 'amphp_live_' . md5( (string) ( $_SERVER['REMOTE_ADDR'] ?? 'unknown' ) );
		$count = (int) get_transient( $rate_key );
		if ( $count >= 10 ) return $unavailable;
		set_transient( $rate_key, $count + 1, 60 );
		$headers = $market ? array( 'Accept' => 'application/json', 'Referer' => $market['provider'] === 'digikala' ? 'https://www.digikala.com/' : 'https://snappshop.ir/' ) : array( 'Accept' => 'text/html,application/xhtml+xml' );
		if ( $market && $market['provider'] === 'snappshop' ) $headers['Origin'] = 'https://snappshop.ir';
		$response = wp_safe_remote_get( $fetch_url, array( 'timeout' => 8, 'redirection' => 0, 'limit_response_size' => 2097152, 'sslverify' => true, 'headers' => $headers ) );
		if ( is_wp_error( $response ) || (int) wp_remote_retrieve_response_code( $response ) !== 200 ) return $unavailable;
		$body = wp_remote_retrieve_body( $response );
		if ( ! is_string( $body ) || $body === '' || strlen( $body ) >= 2097152 ) return $unavailable;
		$profile_data = @json_decode( (string) @file_get_contents( self::find_profiles_json_path() ), true );
		$selectors = is_array( $profile_data[ $loc['profile_key'] ]['detailSelectors'] ?? null ) ? $profile_data[ $loc['profile_key'] ]['detailSelectors'] : array();
		$facts = $market ? self::live_marketplace_parse( $body, $market ) : self::live_product_parse( $body, $p['title'], $selectors );
		if ( ! is_array( $facts ) ) return $unavailable;
		$reply = ( $market ? 'بررسی API مبدأ' : 'بررسی صفحه مبدأ' ) . ' «' . $p['title'] . '»: ';
		$reply .= $facts['price'] !== '' ? ( $market ? 'قیمت گزینه پیش‌فرض مبدأ: ' : 'قیمت مبدأ: ' ) . $facts['price'] . ' ' . ( $facts['currency'] !== '' ? $facts['currency'] : 'با واحد نامشخص' ) . '؛ این مبلغ لزوماً قیمت فروش فروشگاه نیست و باید تأیید شود. ' : 'قیمت فعلی قابل تأیید نیست. ';
		$reply .= $facts['stock'] !== '' ? 'وضعیت کلی مبدأ: ' . $facts['stock'] . '. ' : 'موجودی کلی نامشخص است. ';
		if ( $facts['variants'] ) {
			$reply .= 'ترکیب‌های سایز و رنگ ثبت‌شده در مبدأ (قیمت‌ها قیمت مبدأ هستند، نه لزوماً قیمت فروش): ' . implode( '؛ ', array_slice( $facts['variants'], 0, 20 ) ) . '.';
			if ( count( $facts['variants'] ) > 20 || ! empty( $facts['truncated'] ) ) $reply .= ' فهرست کامل نیست؛ برای سایر گزینه‌ها استعلام بگیرید.';
		} elseif ( $facts['options'] ) {
			$reply .= 'گزینه‌های دیده‌شده: ' . implode( '، ', $facts['options'] ) . '؛ نوع و موجودی هر گزینه نامشخص است.';
		} else {
			$reply .= 'سایز، رنگ و موجودی هر گزینه قابل تأیید نیست؛ برای جزئیات بیشتر از پشتیبانی استعلام بگیرید.';
		}
		return $reply;
	}

	public static function ajax_submit_support_chat() {
		// Clean buffer so PHP notices never corrupt JSON for the storefront chat widget.
		while ( function_exists( 'ob_get_level' ) && ob_get_level() > 0 ) {
			@ob_end_clean();
		}
		if ( function_exists( 'ob_start' ) ) {
			@ob_start();
		}
		@ini_set( 'display_errors', '0' );
		if ( ! empty( $_POST['nonce'] ) ) {
			check_ajax_referer( 'scraper_support_chat_nonce', 'nonce', false );
		}
		$settings = self::get_settings();

		$session_id = sanitize_text_field( $_POST['session_id'] ?? '' );
		if ( empty( $session_id ) ) {
			$session_id = 'sess_' . wp_generate_password( 16, false );
		}

		$name    = sanitize_text_field( $_POST['name'] ?? '' );
		$phone   = sanitize_text_field( $_POST['phone'] ?? '' );
		$email   = sanitize_email( $_POST['email'] ?? '' );
		$subject = sanitize_text_field( $_POST['subject'] ?? '' );
		$message = sanitize_textarea_field( $_POST['message'] ?? '' );
		$media_items = array(); // v13.3.32
		$product_id    = sanitize_text_field( $_POST['product_id'] ?? '' );
		$product_title = sanitize_text_field( $_POST['product_title'] ?? '' );
		$product_ctx   = sanitize_textarea_field( $_POST['product_context'] ?? '' );
		if ( $product_title !== '' || $product_ctx !== '' ) {
			$ctx_block = "\n\n[زمینه محصول]";
			if ( $product_title !== '' ) {
				$ctx_block .= "\nنام: " . $product_title;
			}
			if ( $product_id !== '' ) {
				$ctx_block .= "\nشناسه: " . $product_id;
			}
			if ( $product_ctx !== '' ) {
				$ctx_block .= "\n" . $product_ctx;
			}
			// پیام کاربر دست‌نخورده برای نمایش؛ زمینه فقط به AI می‌رود
			$GLOBALS['_amphp_chat_product_ctx'] = $ctx_block;
			$GLOBALS['_amphp_chat_product_title'] = $product_title;
			$GLOBALS['_amphp_chat_product_id'] = $product_id;
		}

		$has_upload = ! empty( $_FILES['chat_file']['tmp_name'] );
		$has_media_url = trim( (string) ( $_POST['media_url'] ?? '' ) ) !== '';
		if ( empty( $message ) && ! $has_upload && ! $has_media_url ) {
			wp_send_json_error( 'لطفاً متن پیام، لینک یا فایل خود را ارسال کنید.' );
		}
		if ( empty( $message ) && ( $has_upload || $has_media_url ) ) {
			$message = '📎 پیوست چندرسانه‌ای';
		}

		if ( ! empty( $settings['chat_field_name_enable'] ) && ! empty( $settings['chat_field_name_required'] ) && empty( $name ) ) {
			wp_send_json_error( 'لطفاً نام و نام خانوادگی خود را وارد نمایید.' );
		}
		if ( empty( $name ) ) {
			$name = 'کاربر مهمان';
		}

		if ( ! empty( $settings['chat_field_phone_enable'] ) && ! empty( $settings['chat_field_phone_required'] ) && empty( $phone ) ) {
			wp_send_json_error( 'لطفاً شماره تماس یا موبایل خود را وارد نمایید.' );
		}

		if ( ! empty( $settings['chat_field_email_enable'] ) && ! empty( $settings['chat_field_email_required'] ) && ( empty( $email ) || ! is_email( $email ) ) ) {
			wp_send_json_error( 'لطفاً یک آدرس ایمیل معتبر وارد نمایید.' );
		}

		$threads   = self::get_chat_threads();
		$thread_id = 'th_' . substr( md5( $session_id ), 0, 12 );
		$now_time  = current_time( 'timestamp' );
		$time_str  = date_i18n( 'H:i' );
		$full_time = date_i18n( 'Y/m/d - H:i' );

		// Find existing thread or initialize new
		$thread = null;
		$thread_key = $thread_id;
		if ( isset( $threads[ $thread_id ] ) ) {
			$thread = $threads[ $thread_id ];
		} else {
			foreach ( $threads as $k => $t ) {
				if ( ( $t['session_id'] ?? '' ) === $session_id ) {
					$thread     = $t;
					$thread_key = $k;
					break;
				}
			}
		}

		if ( ! $thread ) {
			$thread = array(
				'id'           => $thread_id,
				'session_id'   => $session_id,
				'name'         => $name,
				'phone'        => $phone,
				'email'        => $email,
				'subject'      => $subject,
				'status'       => 'pending',
				'unread_admin' => true,
				'created_at'   => $full_time,
				'updated_at'   => $now_time,
				'messages'     => array(),
			);
		} else {
			if ( ! empty( $name ) && 'کاربر مهمان' !== $name ) {
				$thread['name'] = $name;
			}
			if ( ! empty( $phone ) ) {
				$thread['phone'] = $phone;
			}
			if ( ! empty( $email ) ) {
				$thread['email'] = $email;
			}
			if ( ! empty( $subject ) ) {
				$thread['subject'] = $subject;
			}
			$thread['status']       = 'pending';
			$thread['unread_admin'] = true;
			$thread['updated_at']   = $now_time;
		}

		// 1. Customer Message
		$client_msg_id = sanitize_text_field( $_POST['client_msg_id'] ?? '' );
		$customer_msg_id = ! empty( $client_msg_id ) ? $client_msg_id : ( 'msg_' . $now_time . '_' . rand( 100, 999 ) );
		$media_items = array();
		$upload_res = self::handle_support_chat_upload();
		if ( ! empty( $upload_res['ok'] ) && ! empty( $upload_res['item'] ) ) {
			$media_items[] = $upload_res['item'];
		}
		// لینک‌های چسبانده‌شده در متن
		foreach ( self::extract_links_as_media( $message ) as $li ) {
			$media_items[] = $li;
		}
		// media_url مستقیم از کلاینت (مثلاً URL عمومی)
		$client_media_url = esc_url_raw( trim( (string) ( $_POST['media_url'] ?? '' ) ) );
		if ( $client_media_url !== '' ) {
			$media_items[] = array(
				'kind'    => self::media_kind_from_meta( $client_media_url ),
				'url'     => $client_media_url,
				'caption' => '',
				'name'    => sanitize_text_field( (string) ( $_POST['media_name'] ?? '' ) ),
			);
		}

		$customer_msg = array(
			'id'          => $customer_msg_id,
			'sender'      => 'customer',
			'sender_name' => ( ! empty( $thread['name'] ) && 'کاربر مهمان' !== $thread['name'] ) ? $thread['name'] : 'شما',
			'text'        => $message,
			'time'        => $time_str,
			'timestamp'   => $now_time,
		);
		if ( $media_items ) {
			$customer_msg['media'] = $media_items;
			$first_url = (string) ( $media_items[0]['url'] ?? '' );
			if ( $first_url !== '' ) {
				$customer_msg['media_url']  = $first_url;
				$customer_msg['media_kind'] = (string) ( $media_items[0]['kind'] ?? '' );
			}
		}
		if ( ! empty( $GLOBALS['_amphp_chat_product_id'] ) || ! empty( $GLOBALS['_amphp_chat_product_title'] ) ) {
			$customer_msg['product_id']    = (string) ( $GLOBALS['_amphp_chat_product_id'] ?? '' );
			$customer_msg['product_title'] = (string) ( $GLOBALS['_amphp_chat_product_title'] ?? '' );
			if ( empty( $thread['subject'] ) && ! empty( $customer_msg['product_title'] ) ) {
				$thread['subject'] = 'سوال درباره: ' . $customer_msg['product_title'];
			}
		}
		$thread['messages'][] = $customer_msg;

		// 2. Generate Master AI Reply if enabled (never let AI failures kill the AJAX JSON)
		$_ai_msg = $message;
		if ( ! empty( $GLOBALS['_amphp_chat_product_ctx'] ) ) {
			$_ai_msg .= (string) $GLOBALS['_amphp_chat_product_ctx'];
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 90 );
		}
		if ( function_exists( 'wp_raise_memory_limit' ) ) {
			@wp_raise_memory_limit( 'admin' );
		}
		$ai_reply  = '';
		$master_ai = array();
		$model_lbl = 'هوش مصنوعی پشتیبان';
		try {
			try {
				$live_reply = self::live_product_chat_reply( $message, $product_id );
			} catch ( \Throwable $live_error ) {
				$live_reply = 'اطلاعات زنده محصول قابل تأیید نیست؛ لطفاً از پشتیبانی استعلام بگیرید.';
			}
			if ( $live_reply !== null ) {
				$ai_reply = $live_reply;
				$model_lbl = 'بررسی محصول';
			} else {
				$master_ai = self::get_scraper_master_ai_model( $settings );
				$model_lbl = ! empty( $master_ai['model_name'] ) ? $master_ai['model_name'] : $model_lbl;
				$ai_reply = self::generate_ai_support_reply( $_ai_msg, $thread['name'], $settings );
			}
		} catch ( \Throwable $e ) {
			error_log( 'AMPHP support chat AI error: ' . $e->getMessage() );
			try {
				$ai_reply = self::generate_smart_local_reply( $_ai_msg, $thread['name'], $settings );
				$model_lbl = 'پاسخ محلی فروشگاه';
			} catch ( \Throwable $e2 ) {
				$ai_reply = '';
			}
		}
		if ( ! is_string( $ai_reply ) ) {
			$ai_reply = '';
		}
		$ai_reply = trim( $ai_reply );
		// Never leave the customer with an empty bot bubble.
		if ( $ai_reply === '' ) {
			$ai_reply = self::generate_smart_local_reply( $_ai_msg, $thread['name'], $settings );
			if ( ! is_string( $ai_reply ) || trim( $ai_reply ) === '' ) {
				$site = function_exists( 'get_bloginfo' ) ? ( get_bloginfo( 'name' ) ?: 'فروشگاه' ) : 'فروشگاه';
				$ai_reply = "سلام! پیام شما در «{$site}» دریافت شد. همکاران پشتیبانی به‌زودی پاسخ می‌دهند. برای پیگیری سریع‌تر می‌توانید شماره تماس خود را همین‌جا بنویسید.";
			}
			if ( $model_lbl === 'هوش مصنوعی پشتیبان' ) {
				$model_lbl = 'پشتیبان فروشگاه';
			}
		}

		if ( ! empty( $ai_reply ) ) {
			$ai_msg = array(
				'id'          => 'msg_' . ( $now_time + 1 ) . '_' . rand( 100, 999 ),
				'sender'      => 'ai',
				'sender_name' => ( $settings['ai_support_name'] ?? 'پشتیبان هوشمند' ) . ' (' . $model_lbl . ')',
				'text'        => $ai_reply,
				'time'        => $time_str,
				'timestamp'   => $now_time + 1,
			);
			$thread['messages'][] = $ai_msg;
		}

		// Save updated thread at the front of the list
		unset( $threads[ $thread_key ] );
		$threads = array( $thread_key => $thread ) + $threads;
		self::save_chat_threads( $threads );

		// 3. Forward Customer Message & AI Reply to Messengers (Bale, Telegram, Rubika)
		$site_name      = get_bloginfo( 'name' ) ?: ( $settings['shop_title'] ?? 'فروشگاه آنلاین' );
		$formatted_text = "💬 پیام جدید چت آنلاین ({$site_name})

"
			. "👤 نام مشتری: {$thread['name']}
";
		if ( ! empty( $thread['phone'] ) ) {
			$formatted_text .= "📱 شماره تماس: {$thread['phone']}
";
		}
		if ( ! empty( $thread['email'] ) ) {
			$formatted_text .= "📧 ایمیل: {$thread['email']}
";
		}
		$formatted_text .= "🕒 زمان: {$full_time}
"
			. "━━━━━━━━━━━━━━━━━━━
"
			. "📝 متن پیام مشتری:
"
			. "{$message}
";

		if ( ! empty( $GLOBALS['_amphp_chat_product_title'] ) ) {
			$formatted_text .= "\n🛍 محصول: " . (string) $GLOBALS['_amphp_chat_product_title'];
			if ( ! empty( $GLOBALS['_amphp_chat_product_id'] ) ) {
				$formatted_text .= " (" . (string) $GLOBALS['_amphp_chat_product_id'] . ")";
			}
			$formatted_text .= "\n";
		}

		if ( ! empty( $ai_reply ) ) {
			$formatted_text .= "━━━━━━━━━━━━━━━━━━━
"
				. "🤖 پاسخ هوش مصنوعی مستر ({$model_lbl}):
"
				. "«{$ai_reply}»

"
				. "━━━━━━━━━━━━━━━━━━━
"
				. "⚡ وضعیت: پاسخ هوشمند برای مشتری ارسال شد. جهت پاسخ مستقیم ادمین، به تب ۳ میز پاسخگویی در پیشخوان مراجعه فرمایید.";
		} else {
			$formatted_text .= "━━━━━━━━━━━━━━━━━━━
"
				. "⚡ وضعیت: در انتظار پاسخ مستقیم ادمین در پیشخوان وردپرس (تب ۳ میز پاسخگویی)";
		}

		if ( ! empty( $media_items ) ) {
			$formatted_text .= "
━━━━━━━━━━━━━━━━━━━
📎 پیوست‌ها:
";
			foreach ( array_slice( $media_items, 0, 8 ) as $_mi ) {
				$_u = (string) ( $_mi['url'] ?? '' );
				$_k = (string) ( $_mi['kind'] ?? 'file' );
				$_n = (string) ( $_mi['name'] ?? '' );
				$formatted_text .= '• ' . $_k . ( $_n !== '' ? " ({$_n})" : '' ) . ( $_u !== '' ? ( "
" . $_u ) : '' ) . "
";
			}
			// caption روی اولین رسانه
			if ( ! empty( $media_items[0] ) && is_array( $media_items[0] ) ) {
				$media_items[0]['caption'] = mb_substr( $message, 0, 200 );
			}
		}
		$send_result = self::send_message_to_messengers( $formatted_text, $settings, $media_items );

		// Legacy logs update
		$logs = get_option( 'scraper_support_chat_logs', array() );
		if ( ! is_array( $logs ) ) {
			$logs = array();
		}
		array_unshift( $logs, array(
			'name'     => $thread['name'],
			'phone'    => $thread['phone'],
			'email'    => $thread['email'],
			'subject'  => $thread['subject'],
			'message'  => $message,
			'ai_reply' => $ai_reply,
			'model'    => $model_lbl,
			'time'     => $full_time,
			'sent_ok'  => $send_result['ok'],
			'sent_to'  => $send_result['sent'],
		) );
		$logs = array_slice( $logs, 0, 50 );
		update_option( 'scraper_support_chat_logs', $logs, false );

		$ai_source = 'live';
		if ( $model_lbl === 'پاسخ محلی فروشگاه' || $model_lbl === 'پشتیبان فروشگاه' ) {
			$ai_source = 'local';
		}
		while ( function_exists( 'ob_get_level' ) && ob_get_level() > 0 ) {
			@ob_end_clean();
		}
		wp_send_json_success( array(
			'message'    => 'ok',
			'session_id' => $session_id,
			'thread_id'  => $thread_id,
			'ai_reply'   => $ai_reply,
			'reply'      => $ai_reply,
			'bot_reply'  => $ai_reply,
			'text'       => $ai_reply,
			'ai_model'   => $model_lbl,
			'ai_source'  => $ai_source,
			'ai_key'     => is_array( $master_ai ) ? ( $master_ai['key'] ?? '' ) : '',
			'thread'     => $thread,
			'status'     => $send_result,
		) );
	}

	/**
	 * AJAX endpoint for customer polling updates for active conversation thread.
	 */
	public static function ajax_customer_get_thread() {
		if ( ! empty( $_POST['nonce'] ) ) { check_ajax_referer( 'scraper_support_chat_nonce', 'nonce', false ); }

		$session_id = sanitize_text_field( $_POST['session_id'] ?? '' );
		if ( empty( $session_id ) ) {
			wp_send_json_error( 'شناسه جلسه خالی است.' );
		}

		$threads = self::get_chat_threads();
		foreach ( $threads as $t ) {
			if ( ( $t['session_id'] ?? '' ) === $session_id ) {
				wp_send_json_success( array( 'thread' => $t ) );
			}
		}

		wp_send_json_success( array( 'thread' => null ) );
	}

	/**
	 * AJAX endpoint for admin sending replies from the WordPress Support Desk.
	 * Dispatches reply to customer's live chat AND forwards to messengers (Bale, Telegram, Rubika).
	 */
	public static function ajax_admin_send_chat_reply() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$settings   = self::get_settings();
		$thread_id  = sanitize_text_field( $_POST['thread_id'] ?? '' );
		$reply_text = sanitize_textarea_field( $_POST['reply_text'] ?? '' );

		if ( empty( $thread_id ) || empty( $reply_text ) ) {
			wp_send_json_error( 'شناسه گفتگو یا متن پاسخ نمی‌تواند خالی باشد.' );
		}

		$threads = self::get_chat_threads();
		$key     = null;
		if ( isset( $threads[ $thread_id ] ) ) {
			$key = $thread_id;
		} else {
			foreach ( $threads as $k => $t ) {
				if ( ( $t['id'] ?? '' ) === $thread_id || ( $t['session_id'] ?? '' ) === $thread_id ) {
					$key = $k;
					break;
				}
			}
		}

		if ( null === $key || ! isset( $threads[ $key ] ) ) {
			wp_send_json_error( 'گفتگوی مورد نظر یافت نشد.' );
		}

		$current_user = wp_get_current_user();
		$admin_name   = $current_user->display_name ?: 'مدیریت فروشگاه';
		$now_time     = current_time( 'timestamp' );
		$time_str     = date_i18n( 'H:i' );

		$admin_msg = array(
			'id'          => 'msg_' . $now_time . '_' . rand( 100, 999 ),
			'sender'      => 'admin',
			'sender_name' => $admin_name,
			'text'        => $reply_text,
			'time'        => $time_str,
			'timestamp'   => $now_time,
		);

		$threads[ $key ]['messages'][]   = $admin_msg;
		$threads[ $key ]['status']       = 'replied';
		$threads[ $key ]['unread_admin'] = false;
		$threads[ $key ]['updated_at']   = $now_time;

		self::save_chat_threads( $threads );

		// Forward admin reply to messengers!
		$site_name    = get_bloginfo( 'name' ) ?: ( $settings['shop_title'] ?? 'فروشگاه آنلاین' );
		$target_name  = ! empty( $threads[ $key ]['name'] ) ? $threads[ $key ]['name'] : 'مشتری';
		$target_phone = ! empty( $threads[ $key ]['phone'] ) ? $threads[ $key ]['phone'] : '';

		$admin_forward_text = "👨‍💼 پاسخ پشتیبان در چت آنلاین ({$site_name})

"
			. "👤 مخاطب: {$target_name}
";
		if ( ! empty( $target_phone ) ) {
			$admin_forward_text .= "📱 تلفن مشتری: {$target_phone}
";
		}
		$admin_forward_text .= "🕒 زمان پاسخ: " . date_i18n( 'Y/m/d - H:i' ) . "
"
			. "✍️ ارسال کننده: {$admin_name}

"
			. "━━━━━━━━━━━━━━━━━━━
"
			. "💬 متن پاسخ همکار / ادمین:
"
			. "{$reply_text}

"
			. "━━━━━━━━━━━━━━━━━━━
"
			. "✅ وضعیت: پاسخ در صفحه چت مشتری ثبت و ارسال گردید.";

		$messenger_status = self::send_message_to_messengers( $admin_forward_text, $settings );

		wp_send_json_success( array(
			'message'          => 'پاسخ شما با موفقیت ثبت شد و به پیام‌رسان‌ها فوروارد گردید.',
			'thread'           => $threads[ $key ],
			'messenger_status' => $messenger_status,
		) );
	}

	public static function ajax_admin_get_thread() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$threads   = self::get_chat_threads();
		$thread_id = sanitize_text_field( $_POST['thread_id'] ?? '' );

		if ( ! empty( $thread_id ) ) {
			foreach ( $threads as $t ) {
				if ( ( $t['id'] ?? '' ) === $thread_id || ( $t['session_id'] ?? '' ) === $thread_id ) {
					wp_send_json_success( array( 'thread' => $t ) );
				}
			}
			wp_send_json_error( 'گفتگو پیدا نشد.' );
		}

		wp_send_json_success( array( 'threads' => array_values( $threads ) ) );
	}

	/**
	 * AJAX endpoint for admin deleting a chat thread.
	 */
	public static function ajax_admin_delete_thread() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$thread_id = sanitize_text_field( $_POST['thread_id'] ?? '' );
		if ( empty( $thread_id ) ) {
			wp_send_json_error( 'شناسه گفتگو ارسال نشده است.' );
		}

		$threads = self::get_chat_threads();
		$found   = false;
		foreach ( $threads as $k => $t ) {
			if ( ( $t['id'] ?? '' ) === $thread_id || ( $t['session_id'] ?? '' ) === $thread_id ) {
				unset( $threads[ $k ] );
				$found = true;
				break;
			}
		}

		if ( $found ) {
			self::save_chat_threads( $threads );
			wp_send_json_success( array( 'message' => 'گفتگو با موفقیت حذف گردید.' ) );
		} else {
			wp_send_json_error( 'گفتگو یافت نشد.' );
		}
	}

	/**
	 * AJAX endpoint for admin testing messenger connection.
	 */
	public static function ajax_test_support_messengers() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}

		$time_str  = date_i18n( 'Y/m/d - H:i:s' );
		$site_name = get_bloginfo( 'name' );

		$test_text = "🔔 پیام آزمایشی سیستم پشتیبانی فروشگاه\n\n"
			. "✅ این یک پیام تستی برای بررسی اتصال به پیام‌رسان‌های بخش اعلان اسکرپر است.\n"
			. "🕒 زمان تست: {$time_str}\n"
			. "🏢 فروشگاه: {$site_name}\n"
			. "وضعیت: اتصال صحیح و بدون مشکل برقرار است.";

		$result = self::send_message_to_messengers( $test_text );

		if ( $result['ok'] ) {
			wp_send_json_success( $result );
		} else {
			wp_send_json_error( $result );
		}
	}

	/**
	 * Ensure WooCommerce Cart and Session are initialized in AJAX requests.
	 *
	 * @return bool
	 */
	public static function init_wc_cart() {
		if ( ! function_exists( 'WC' ) ) {
			return false;
		}

		if ( is_null( WC()->session ) ) {
			$session_class = apply_filters( 'woocommerce_session_handler', 'WC_Session_Handler' );
			if ( class_exists( $session_class ) ) {
				WC()->session = new $session_class();
				WC()->session->init();
			}
		}

		if ( is_null( WC()->customer ) && class_exists( 'WC_Customer' ) ) {
			WC()->customer = new WC_Customer( get_current_user_id(), true );
		}

		if ( is_null( WC()->cart ) && class_exists( 'WC_Cart' ) ) {
			WC()->cart = new WC_Cart();
		}

		if ( WC()->session && ! WC()->session->has_session() ) {
			WC()->session->set_customer_session_cookie( true );
		}

		return ( ! is_null( WC()->cart ) );
	}

	/**
	 * Find an existing WooCommerce product by scraped hash or exact title, or create it dynamically.
	 *
	 * @param array $item_data
	 * @return int Product ID or 0
	 */
	public static function find_or_create_wc_product( $item_data ) {
		if ( ! class_exists( 'WooCommerce' ) ) {
			return 0;
		}

		if ( ! self::profile_cart_items_allowed( array( $item_data ) ) ) { return 0; }

		$hash  = sanitize_text_field( $item_data['id'] ?? $item_data['hash'] ?? '' );
		$title = sanitize_text_field( $item_data['title'] ?? '' );
		$price = floatval( $item_data['price'] ?? 0 );
		$img   = esc_url_raw( $item_data['image'] ?? '' );
		$cat   = sanitize_text_field( $item_data['category'] ?? 'عمومی' );

		if ( empty( $title ) && empty( $hash ) ) {
			return 0;
		}

		$product_id = 0;

		// 1. Try lookup by scraped hash
		if ( ! empty( $hash ) ) {
			$existing = get_posts( array(
				'post_type'      => 'product',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'meta_key'       => '_scraped_hash',
				'meta_value'     => $hash,
				'fields'         => 'ids',
			) );
			if ( ! empty( $existing ) ) {
				$product_id = (int) $existing[0];
			}
		}

		// 2. Try lookup by exact title
		if ( ! $product_id && ! empty( $title ) ) {
			$existing = get_posts( array(
				'post_type'      => 'product',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'title'          => $title,
				'fields'         => 'ids',
			) );
			if ( ! empty( $existing ) ) {
				$product_id = (int) $existing[0];
			}
		}

		// 3. If found, ensure price and active stock status
		if ( $product_id > 0 ) {
			if ( $price > 0 ) {
				update_post_meta( $product_id, '_price', $price );
				update_post_meta( $product_id, '_regular_price', $price );
			}
			update_post_meta( $product_id, '_stock_status', 'instock' );
			if ( ! empty( $hash ) ) {
				update_post_meta( $product_id, '_scraped_hash', $hash );
			}
			if ( ! empty( $img ) && ! get_post_meta( $product_id, '_scraped_image_url', true ) ) {
				update_post_meta( $product_id, '_scraped_image_url', $img );
			}
			return $product_id;
		}

		// 4. If not found, create new WooCommerce simple product
		$post_data = array(
			'post_title'   => $title,
			'post_content' => sanitize_textarea_field( $item_data['description'] ?? '' ),
			'post_status'  => 'publish',
			'post_type'    => 'product',
		);
		$product_id = wp_insert_post( $post_data );

		if ( $product_id && ! is_wp_error( $product_id ) ) {
			wp_set_object_terms( $product_id, 'simple', 'product_type' );
			if ( ! empty( $cat ) ) {
				wp_set_object_terms( $product_id, $cat, 'product_cat' );
			}
			update_post_meta( $product_id, '_scraped_hash', $hash );
			update_post_meta( $product_id, '_price', $price );
			update_post_meta( $product_id, '_regular_price', $price );
			update_post_meta( $product_id, '_stock_status', 'instock' );
			update_post_meta( $product_id, '_visibility', 'visible' );
			update_post_meta( $product_id, '_virtual', 'no' );
			update_post_meta( $product_id, '_manage_stock', 'no' );
			if ( ! empty( $img ) ) {
				update_post_meta( $product_id, '_scraped_image_url', $img );
			}
			return (int) $product_id;
		}

		return 0;
	}

	/**
	 * Build JSON response with current WooCommerce Cart contents.
	 *
	 * @return array
	 */
	public static function get_wc_cart_response() {
		if ( ! self::init_wc_cart() ) {
			return array(
				'items'        => array(),
				'count'        => 0,
				'total'        => 0,
				'checkout_url' => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : '#',
				'cart_url'     => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '#',
			);
		}

		$items     = array();
		$raw_total = 0;

		foreach ( WC()->cart->get_cart() as $cart_item_key => $cart_item ) {
			$product = $cart_item['data'] ?? null;
			if ( ! $product || ! is_object( $product ) ) {
				continue;
			}

			$pid  = $cart_item['product_id'];
			$hash = get_post_meta( $pid, '_scraped_hash', true );
			if ( empty( $hash ) ) {
				$hash = (string) $pid;
			}
			$img = get_post_meta( $pid, '_scraped_image_url', true );
			if ( empty( $img ) && has_post_thumbnail( $pid ) ) {
				$img = get_the_post_thumbnail_url( $pid, 'thumbnail' );
			}

			$price      = floatval( $product->get_price() );
			$qty        = intval( $cart_item['quantity'] );
			$line_total = $price * $qty;
			$raw_total += $line_total;

			$items[] = array(
				'id'         => $hash,
				'product_id' => $pid,
				'key'        => $cart_item_key,
				'title'      => $product->get_name(),
				'price'      => $price,
				'priceTxt'   => number_format( $price ) . ' تومان',
				'img'        => $img,
				'qty'        => $qty,
				'line_total' => $line_total,
			);
		}

		return array(
			'items'        => $items,
			'count'        => WC()->cart->get_cart_contents_count(),
			'total'        => $raw_total,
			'checkout_url' => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : '#',
			'cart_url'     => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '#',
		);
	}

	/**
	 * AJAX endpoint to add scraped product directly into WooCommerce Cart.
	 */
	public static function ajax_wc_add_to_cart() {
		check_ajax_referer( 'scraper_cart_nonce', 'nonce' );

		$hash  = sanitize_text_field( $_POST['id'] ?? '' );
		$title = sanitize_text_field( $_POST['title'] ?? '' );
		$price = floatval( $_POST['price'] ?? 0 );
		$img   = esc_url_raw( $_POST['image'] ?? '' );
		$qty   = max( 1, intval( $_POST['qty'] ?? 1 ) );

		if ( empty( $title ) && empty( $hash ) ) {
			wp_send_json_error( 'اطلاعات محصول نامعتبر است.' );
		}
		if ( ! self::profile_cart_items_allowed( array( array( 'id' => $hash, 'title' => $title ) ) ) ) { wp_send_json_error( 'این محصول در پروفایل‌های فعلی نیست.' ); }

		if ( ! self::init_wc_cart() ) {
			wp_send_json_error( 'ووکامرس فعال نیست.' );
		}

		$product_id = self::find_or_create_wc_product( array(
			'id'    => $hash,
			'title' => $title,
			'price' => $price,
			'image' => $img,
		) );

		if ( ! $product_id ) {
			wp_send_json_error( 'ثبت محصول در دیتابیس با شکست مواجه شد.' );
		}

		// Find if already in cart
		$cart_item_key = null;
		foreach ( WC()->cart->get_cart() as $key => $item ) {
			if ( (int) $item['product_id'] === (int) $product_id ) {
				$cart_item_key = $key;
				break;
			}
		}

		if ( $cart_item_key ) {
			$current_qty = WC()->cart->get_cart()[ $cart_item_key ]['quantity'];
			WC()->cart->set_quantity( $cart_item_key, $current_qty + $qty );
		} else {
			$cart_item_key = WC()->cart->add_to_cart( $product_id, $qty );
		}

		if ( ! $cart_item_key ) {
			wp_send_json_error( 'افزودن به سبد خرید ووکامرس انجام نشد.' );
		}

		WC()->cart->calculate_totals();

		wp_send_json_success( self::get_wc_cart_response() );
	}

	/**
	 * AJAX endpoint to update quantity of an item in WooCommerce Cart.
	 */
	public static function ajax_wc_update_cart_qty() {
		check_ajax_referer( 'scraper_cart_nonce', 'nonce' );

		$hash = sanitize_text_field( $_POST['id'] ?? '' );
		$qty  = intval( $_POST['qty'] ?? 0 );

		if ( ! self::init_wc_cart() ) {
			wp_send_json_error( 'ووکامرس فعال نیست.' );
		}

		$target_key = null;
		foreach ( WC()->cart->get_cart() as $key => $item ) {
			$pid       = $item['product_id'];
			$item_hash = get_post_meta( $pid, '_scraped_hash', true );
			if ( $item_hash === $hash || (string) $pid === (string) $hash ) {
				$target_key = $key;
				break;
			}
		}

		if ( $target_key ) {
			if ( $qty <= 0 ) {
				WC()->cart->remove_cart_item( $target_key );
			} else {
				WC()->cart->set_quantity( $target_key, $qty );
			}
			WC()->cart->calculate_totals();
		}

		wp_send_json_success( self::get_wc_cart_response() );
	}

	/**
	 * AJAX endpoint to remove an item from WooCommerce Cart.
	 */
	public static function ajax_wc_remove_cart_item() {
		check_ajax_referer( 'scraper_cart_nonce', 'nonce' );

		$hash = sanitize_text_field( $_POST['id'] ?? '' );

		if ( ! self::init_wc_cart() ) {
			wp_send_json_error( 'ووکامرس فعال نیست.' );
		}

		$target_key = null;
		foreach ( WC()->cart->get_cart() as $key => $item ) {
			$pid       = $item['product_id'];
			$item_hash = get_post_meta( $pid, '_scraped_hash', true );
			if ( $item_hash === $hash || (string) $pid === (string) $hash ) {
				$target_key = $key;
				break;
			}
		}

		if ( $target_key ) {
			WC()->cart->remove_cart_item( $target_key );
			WC()->cart->calculate_totals();
		}

		wp_send_json_success( self::get_wc_cart_response() );
	}

	/**
	 * AJAX endpoint to read current WooCommerce Cart items.
	 */
	public static function ajax_wc_get_cart() {
		if ( ! self::init_wc_cart() ) {
			wp_send_json_error( 'ووکامرس فعال نیست.' );
		}

		wp_send_json_success( self::get_wc_cart_response() );
	}

	/**
	 * Synchronize entire frontend cart to WooCommerce Cart and return checkout URL.
	 */
	public static function ajax_wc_sync_and_checkout() {
		check_ajax_referer( 'scraper_cart_nonce', 'nonce' );

		$raw_items = $_POST['items'] ?? '[]';
		$items     = json_decode( stripslashes( $raw_items ), true );
		if ( ! is_array( $items ) || empty( $items ) ) {
			wp_send_json_error( 'سبد خرید خالی است.' );
		}
		if ( ! self::profile_cart_items_allowed( $items ) ) { wp_send_json_error( 'یکی از کالاهای سبد در پروفایل‌های فعلی نیست؛ سبد را به‌روز کنید.' ); }

		if ( ! self::init_wc_cart() ) {
			wp_send_json_error( 'ووکامرس فعال نیست.' );
		}

		// Clear previous session items to guarantee clean 1:1 match
		WC()->cart->empty_cart();

		$added = 0;
		foreach ( $items as $item ) {
			$product_id = self::find_or_create_wc_product( $item );
			$qty        = max( 1, intval( $item['qty'] ?? 1 ) );
			if ( $product_id > 0 ) {
				$cart_key = WC()->cart->add_to_cart( $product_id, $qty );
				if ( $cart_key ) {
					$added++;
				}
			}
		}

		WC()->cart->calculate_totals();
		if ( WC()->session ) {
			WC()->session->set_customer_session_cookie( true );
		}

		$checkout_url = function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : ( function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/checkout/' ) );

	wp_send_json_success( array(
			'count'        => WC()->cart->get_cart_contents_count(),
			'added'        => $added,
			'checkout_url' => $checkout_url,
		) );
	}

	/**
	 * List all enabled WooCommerce payment gateways for the custom checkout UI.
	 *
	 * @return array<int, array{id:string,title:string,description:string,icon:string,method_title:string}>
	 */
	public static function get_active_payment_gateways_list() {
		$list = array();
		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->payment_gateways() ) {
			// Sandbox / no WC: still offer a COD-like placeholder
			$list[] = array(
				'id'           => 'cod',
				'title'        => 'پرداخت در محل',
				'description'  => 'پرداخت هنگام تحویل سفارش',
				'icon'         => '',
				'method_title' => 'COD',
			);
			return $list;
		}
		try {
			$gateways = WC()->payment_gateways()->get_available_payment_gateways();
			if ( empty( $gateways ) && method_exists( WC()->payment_gateways(), 'payment_gateways' ) ) {
				// Fallback: all registered gateways that are enabled
				$all = WC()->payment_gateways()->payment_gateways();
				$gateways = array();
				foreach ( (array) $all as $gid => $gw ) {
					if ( is_object( $gw ) && method_exists( $gw, 'is_available' ) && $gw->is_available() ) {
						$gateways[ $gid ] = $gw;
					} elseif ( is_object( $gw ) && isset( $gw->enabled ) && 'yes' === $gw->enabled ) {
						$gateways[ $gid ] = $gw;
					}
				}
			}
			foreach ( (array) $gateways as $id => $gw ) {
				if ( ! is_object( $gw ) ) {
					continue;
				}
				$title = method_exists( $gw, 'get_title' ) ? (string) $gw->get_title() : (string) ( $gw->title ?? $id );
				$desc  = method_exists( $gw, 'get_description' ) ? wp_strip_all_tags( (string) $gw->get_description() ) : (string) ( $gw->description ?? '' );
				$icon  = '';
				if ( method_exists( $gw, 'get_icon' ) ) {
					$raw_icon = $gw->get_icon();
					if ( is_string( $raw_icon ) && preg_match( '/src=[\'"]([^\'"]+)[\'"]/', $raw_icon, $m ) ) {
						$icon = $m[1];
					}
				}
				$list[] = array(
					'id'           => (string) $id,
					'title'        => $title !== '' ? $title : (string) $id,
					'description'  => $desc,
					'icon'         => $icon,
					'method_title' => (string) ( $gw->method_title ?? $title ),
				);
			}
		} catch ( \Throwable $e ) {
			// ignore
		}
		if ( empty( $list ) ) {
			$list[] = array(
				'id'           => 'cod',
				'title'        => 'پرداخت در محل',
				'description'  => 'درگاه فعالی یافت نشد — پرداخت هنگام تحویل',
				'icon'         => '',
				'method_title' => 'COD',
			);
		}
		return $list;
	}

	/**
	 * AJAX: return active payment gateways.
	 */
	public static function ajax_get_payment_gateways() {
		wp_send_json_success( array(
			'gateways' => self::get_active_payment_gateways_list(),
		) );
	}

	/**
	 * AJAX: place order from custom React checkout.
	 * Creates a real WC order when WooCommerce is available.
	 */

	/**
	 * Load Iran province→cities map (bundled JSON).
	 */
	public static function get_iran_cities_map() {
		static $map = null;
		if ( null !== $map ) {
			return $map;
		}
		$path = plugin_dir_path( __FILE__ ) . 'includes/geo/iran-cities.json';
		$map  = array();
		if ( is_readable( $path ) ) {
			$raw = file_get_contents( $path );
			$decoded = json_decode( (string) $raw, true );
			if ( is_array( $decoded ) ) {
				$map = $decoded;
			}
		}
		return $map;
	}

	/**
	 * AJAX: province list or cities for a province.
	 */
	public static function ajax_get_iran_cities() {
		$map = self::get_iran_cities_map();
		$province = sanitize_text_field( wp_unslash( $_REQUEST['province'] ?? $_POST['province'] ?? '' ) );
		if ( $province !== '' ) {
			$cities = array();
			if ( isset( $map[ $province ] ) && is_array( $map[ $province ] ) ) {
				$cities = array_values( $map[ $province ] );
			} else {
				// fuzzy match (normalized spaces)
				$norm = function( $s ) {
					$s = str_replace( array( 'ي', 'ك', '‌', ' ' ), array( 'ی', 'ک', '', '' ), (string) $s );
					return $s;
				};
				$np = $norm( $province );
				foreach ( $map as $k => $v ) {
					if ( $norm( $k ) === $np ) {
						$cities = array_values( (array) $v );
						break;
					}
				}
			}
			wp_send_json_success( array(
				'province' => $province,
				'cities'   => $cities,
			) );
		}
		wp_send_json_success( array(
			'provinces' => array_keys( $map ),
			'map'       => $map,
		) );
	}

	/**
	 * Collect shipping methods from WooCommerce + built-in Iran carriers.
	 *
	 * @param array $ctx optional context: province, city, postcode, subtotal, weight_kg, lat, lng
	 * @return array
	 */
	public static function get_shipping_methods_list( $ctx = array() ) {
		$settings = self::get_settings();
		$subtotal = floatval( $ctx['subtotal'] ?? 0 );
		$threshold = floatval( $settings['free_shipping_threshold'] ?? 400000 );
		$weight = max( 0.5, floatval( $ctx['weight_kg'] ?? 1 ) );
		$province = (string) ( $ctx['province'] ?? '' );
		$city = (string) ( $ctx['city'] ?? '' );
		$list = array();

		// WooCommerce zone methods
		if ( function_exists( 'WC' ) && class_exists( 'WC_Shipping_Zones' ) ) {
			try {
				self::init_wc_cart();
				$package = array(
					'contents'        => array(),
					'contents_cost'   => $subtotal,
					'applied_coupons' => array(),
					'user'            => array( 'ID' => get_current_user_id() ),
					'destination'     => array(
						'country'   => 'IR',
						'state'     => $province,
						'city'      => $city,
						'postcode'  => (string) ( $ctx['postcode'] ?? '' ),
						'address'   => (string) ( $ctx['address'] ?? '' ),
						'address_1' => (string) ( $ctx['address'] ?? '' ),
					),
				);
				// Prefer cart packages when available
				$packages = array();
				if ( WC()->cart && ! WC()->cart->is_empty() ) {
					WC()->customer->set_shipping_country( 'IR' );
					WC()->customer->set_shipping_state( $province );
					WC()->customer->set_shipping_city( $city );
					WC()->customer->set_shipping_postcode( (string) ( $ctx['postcode'] ?? '' ) );
					WC()->shipping()->calculate_shipping( WC()->cart->get_shipping_packages() );
					$packages = WC()->shipping()->get_packages();
				} else {
					$zones = \WC_Shipping_Zones::get_zones();
					// Also include "Rest of the World" / zone 0
					$zone0 = new \WC_Shipping_Zone( 0 );
					$all_methods = array();
					foreach ( $zones as $z ) {
						$zone_obj = new \WC_Shipping_Zone( $z['id'] );
						foreach ( $zone_obj->get_shipping_methods( true ) as $m ) {
							$all_methods[] = $m;
						}
					}
					foreach ( $zone0->get_shipping_methods( true ) as $m ) {
						$all_methods[] = $m;
					}
					foreach ( $all_methods as $method ) {
						if ( ! is_object( $method ) ) {
							continue;
						}
						$id = method_exists( $method, 'get_rate_id' ) ? $method->get_rate_id() : ( ( $method->id ?? 'method' ) . ':' . ( $method->instance_id ?? 0 ) );
						$title = method_exists( $method, 'get_title' ) ? $method->get_title() : (string) ( $method->title ?? $id );
						$cost = 0.0;
						if ( isset( $method->cost ) && is_numeric( $method->cost ) ) {
							$cost = floatval( $method->cost );
						} elseif ( method_exists( $method, 'get_option' ) ) {
							$c = $method->get_option( 'cost', '' );
							if ( $c !== '' && is_numeric( $c ) ) {
								$cost = floatval( $c );
							}
						}
						// free_shipping threshold aware
						if ( ( $method->id ?? '' ) === 'free_shipping' ) {
							$cost = 0.0;
						}
						$list[] = array(
							'id'          => (string) $id,
							'title'       => (string) $title,
							'description' => method_exists( $method, 'get_method_description' ) ? wp_strip_all_tags( (string) $method->get_method_description() ) : '',
							'cost'        => $cost,
							'cost_formatted' => self::format_price( $cost, $settings['currency_symbol'] ?? 'تومان' ),
							'source'      => 'woocommerce',
							'carrier'     => (string) ( $method->id ?? 'wc' ),
							'meta'        => array( 'instance_id' => intval( $method->instance_id ?? 0 ) ),
						);
					}
				}
				foreach ( (array) $packages as $pkg ) {
					foreach ( (array) ( $pkg['rates'] ?? array() ) as $rate_id => $rate ) {
						if ( ! is_object( $rate ) ) {
							continue;
						}
						$cost = floatval( method_exists( $rate, 'get_cost' ) ? $rate->get_cost() : 0 );
						$label = method_exists( $rate, 'get_label' ) ? $rate->get_label() : (string) $rate_id;
						$list[] = array(
							'id'             => (string) $rate_id,
							'title'          => (string) $label,
							'description'    => '',
							'cost'           => $cost,
							'cost_formatted' => self::format_price( $cost, $settings['currency_symbol'] ?? 'تومان' ),
							'source'         => 'woocommerce',
							'carrier'        => (string) ( method_exists( $rate, 'get_method_id' ) ? $rate->get_method_id() : 'wc' ),
							'meta'           => array(),
						);
					}
				}
			} catch ( \Throwable $e ) {
				// ignore WC shipping errors
			}
		}

		// Built-in Iran carriers (Post / Chapar / Tipax) — estimate or API when token set
		$carriers = array();
		if ( ! empty( $settings['post_shipping_enabled'] ) ) {
			$carriers[] = array(
				'id' => 'amphp_post',
				'title' => 'پست پیشتاز',
				'carrier' => 'post',
				'base' => floatval( $settings['shipping_base_post'] ?? 45000 ),
				'desc' => 'ارسال با پست جمهوری اسلامی ایران',
				'token' => (string) ( $settings['post_api_token'] ?? '' ),
			);
		}
		if ( ! empty( $settings['chapar_shipping_enabled'] ) ) {
			$carriers[] = array(
				'id' => 'amphp_chapar',
				'title' => 'چاپار',
				'carrier' => 'chapar',
				'base' => floatval( $settings['shipping_base_chapar'] ?? 65000 ),
				'desc' => 'پیک سریع چاپار',
				'token' => (string) ( $settings['chapar_api_token'] ?? '' ),
			);
		}
		if ( ! empty( $settings['tipax_shipping_enabled'] ) ) {
			$carriers[] = array(
				'id' => 'amphp_tipax',
				'title' => 'تیپاکس',
				'carrier' => 'tipax',
				'base' => floatval( $settings['shipping_base_tipax'] ?? 75000 ),
				'desc' => 'ارسال تیپاکس درب به درب',
				'token' => (string) ( $settings['tipax_api_token'] ?? '' ),
			);
		}

		$per_kg = floatval( $settings['shipping_per_kg'] ?? 12000 );
		$origin_city = (string) ( $settings['shipping_origin_city'] ?? 'تهران' );
		$same_city = ( $city !== '' && $origin_city !== '' && mb_strpos( $city, $origin_city ) !== false )
			|| ( $city !== '' && $origin_city !== '' && mb_strpos( $origin_city, $city ) !== false );

		foreach ( $carriers as $c ) {
			$cost = self::estimate_carrier_cost( $c, array(
				'subtotal'   => $subtotal,
				'weight_kg'  => $weight,
				'province'   => $province,
				'city'       => $city,
				'same_city'  => $same_city,
				'per_kg'     => $per_kg,
				'threshold'  => $threshold,
			) );
			// Free shipping threshold applies to flat estimates
			if ( $threshold > 0 && $subtotal >= $threshold ) {
				$cost = 0.0;
			}
			$list[] = array(
				'id'             => $c['id'],
				'title'          => $c['title'],
				'description'    => $c['desc'] . ( $cost <= 0 && $subtotal >= $threshold ? ' — ارسال رایگان' : '' ),
				'cost'           => $cost,
				'cost_formatted' => $cost <= 0 ? 'رایگان' : self::format_price( $cost, $settings['currency_symbol'] ?? 'تومان' ),
				'source'         => 'amphp',
				'carrier'        => $c['carrier'],
				'meta'           => array( 'api' => $c['token'] !== '' ),
			);
		}

		// Always offer a free/local pickup style fallback if list empty
		if ( empty( $list ) ) {
			$cost = ( $threshold > 0 && $subtotal >= $threshold ) ? 0.0 : floatval( $settings['shipping_base_post'] ?? 45000 );
			$list[] = array(
				'id'             => 'amphp_flat',
				'title'          => 'ارسال استاندارد',
				'description'    => 'هزینه ارسال پس از ثبت مقصد',
				'cost'           => $cost,
				'cost_formatted' => $cost <= 0 ? 'رایگان' : self::format_price( $cost, $settings['currency_symbol'] ?? 'تومان' ),
				'source'         => 'amphp',
				'carrier'        => 'flat',
				'meta'           => array(),
			);
		}

		// Dedupe by id
		$seen = array();
		$out = array();
		foreach ( $list as $row ) {
			$id = (string) ( $row['id'] ?? '' );
			if ( $id === '' || isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$out[] = $row;
		}
		return $out;
	}

	/**
	 * Estimate carrier shipping cost (token APIs optional; graceful fallback).
	 */
	public static function estimate_carrier_cost( $carrier, $ctx ) {
		$base = floatval( $carrier['base'] ?? 45000 );
		$weight = max( 0.5, floatval( $ctx['weight_kg'] ?? 1 ) );
		$per_kg = floatval( $ctx['per_kg'] ?? 12000 );
		$same_city = ! empty( $ctx['same_city'] );
		$token = (string) ( $carrier['token'] ?? '' );
		$cost = $base + max( 0, $weight - 1 ) * $per_kg;
		if ( $same_city ) {
			$cost *= 0.7;
		}
		// Try live API when token present (best-effort; never block checkout)
		if ( $token !== '' ) {
			try {
				$live = self::fetch_carrier_api_rate( $carrier['carrier'] ?? '', $token, $ctx );
				if ( $live !== null && $live >= 0 ) {
					return floatval( $live );
				}
			} catch ( \Throwable $e ) {
				// fall through to estimate
			}
		}
		return round( $cost / 1000 ) * 1000;
	}

	/**
	 * Optional live rate from Post / Chapar / Tipax APIs.
	 * Returns null when unavailable so estimate is used.
	 */
	public static function fetch_carrier_api_rate( $carrier, $token, $ctx ) {
		$carrier = strtolower( (string) $carrier );
		$timeout = 6;
		if ( $carrier === 'chapar' ) {
			// Chapar public-ish quote endpoint pattern (token as Bearer) — soft fail
			$url = 'https://api.chaparnet.com/v1/rate';
			$res = wp_remote_post( $url, array(
				'timeout' => $timeout,
				'headers' => array(
					'Authorization' => 'Bearer ' . $token,
					'Content-Type'  => 'application/json',
					'Accept'        => 'application/json',
				),
				'body' => wp_json_encode( array(
					'to_city'   => (string) ( $ctx['city'] ?? '' ),
					'to_state'  => (string) ( $ctx['province'] ?? '' ),
					'weight'    => floatval( $ctx['weight_kg'] ?? 1 ),
				) ),
			) );
			if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
				$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
				if ( isset( $body['price'] ) ) {
					return floatval( $body['price'] );
				}
				if ( isset( $body['data']['price'] ) ) {
					return floatval( $body['data']['price'] );
				}
			}
		} elseif ( $carrier === 'tipax' ) {
			$url = 'https://api.tipax.ir/api/v1/pricing/quote';
			$res = wp_remote_post( $url, array(
				'timeout' => $timeout,
				'headers' => array(
					'Authorization' => 'Bearer ' . $token,
					'Content-Type'  => 'application/json',
					'Accept'        => 'application/json',
				),
				'body' => wp_json_encode( array(
					'destination_city' => (string) ( $ctx['city'] ?? '' ),
					'weight'           => floatval( $ctx['weight_kg'] ?? 1 ),
				) ),
			) );
			if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
				$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
				foreach ( array( 'price', 'amount', 'total' ) as $k ) {
					if ( isset( $body[ $k ] ) && is_numeric( $body[ $k ] ) ) {
						return floatval( $body[ $k ] );
					}
					if ( isset( $body['data'][ $k ] ) && is_numeric( $body['data'][ $k ] ) ) {
						return floatval( $body['data'][ $k ] );
					}
				}
			}
		} elseif ( $carrier === 'post' ) {
			// Iran Post e-commerce style — soft fail to estimate
			$url = 'https://ecommerce.post.ir/api/v1/price';
			$res = wp_remote_post( $url, array(
				'timeout' => $timeout,
				'headers' => array(
					'ApiKey'       => $token,
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
				),
				'body' => wp_json_encode( array(
					'CityName' => (string) ( $ctx['city'] ?? '' ),
					'Weight'   => floatval( $ctx['weight_kg'] ?? 1 ) * 1000,
					'ServiceType' => 1,
				) ),
			) );
			if ( ! is_wp_error( $res ) && wp_remote_retrieve_response_code( $res ) < 400 ) {
				$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
				foreach ( array( 'Price', 'price', 'TotalPrice' ) as $k ) {
					if ( isset( $body[ $k ] ) && is_numeric( $body[ $k ] ) ) {
						return floatval( $body[ $k ] );
					}
					if ( isset( $body['Data'][ $k ] ) && is_numeric( $body['Data'][ $k ] ) ) {
						return floatval( $body['Data'][ $k ] );
					}
				}
			}
		}
		return null;
	}

	/**
	 * AJAX: list shipping methods (WC + Iran carriers).
	 */
	public static function ajax_get_shipping_methods() {
		$ctx = array(
			'province' => sanitize_text_field( wp_unslash( $_POST['province'] ?? '' ) ),
			'city'     => sanitize_text_field( wp_unslash( $_POST['city'] ?? '' ) ),
			'postcode' => sanitize_text_field( wp_unslash( $_POST['postal'] ?? $_POST['postcode'] ?? '' ) ),
			'address'  => sanitize_text_field( wp_unslash( $_POST['address'] ?? '' ) ),
			'subtotal' => floatval( $_POST['subtotal'] ?? 0 ),
			'weight_kg'=> floatval( $_POST['weight_kg'] ?? 1 ),
			'lat'      => sanitize_text_field( wp_unslash( $_POST['lat'] ?? '' ) ),
			'lng'      => sanitize_text_field( wp_unslash( $_POST['lng'] ?? '' ) ),
		);
		$methods = self::get_shipping_methods_list( $ctx );
		$settings = self::get_settings();
		wp_send_json_success( array(
			'methods'   => $methods,
			'threshold' => floatval( $settings['free_shipping_threshold'] ?? 400000 ),
			'neshan'    => array(
				'enabled' => ! empty( $settings['checkout_show_map'] ) && ! empty( $settings['neshan_api_key'] ),
				'has_key' => ! empty( $settings['neshan_api_key'] ),
			),
		) );
	}

	/**
	 * AJAX: recalculate shipping for destination (alias of methods with costs).
	 */
	public static function ajax_calc_shipping() {
		self::ajax_get_shipping_methods();
	}

	/**
	 * AJAX: Neshan reverse/forward geocode proxy (keeps API key server-side).
	 */
	/**
	 * Normalize Neshan "state" / province names to match IRAN_PROVINCES / cities map.
	 */
	public static function neshan_normalize_province( $state ) {
		$s = trim( (string) $state );
		if ( $s === '' ) {
			return '';
		}
		// "استان تهران" → "تهران"
		$s = preg_replace( '/^استان\s+/u', '', $s );
		$s = str_replace( array( 'ي', 'ك' ), array( 'ی', 'ک' ), $s );
		$map = self::get_iran_cities_map();
		if ( isset( $map[ $s ] ) ) {
			return $s;
		}
		// fuzzy contains
		foreach ( array_keys( $map ) as $prov ) {
			if ( $prov === $s || mb_strpos( $prov, $s ) !== false || mb_strpos( $s, $prov ) !== false ) {
				return $prov;
			}
		}
		// common aliases
		$aliases = array(
			'تهران' => 'تهران',
			'آذربایجان‌شرقی' => 'آذربایجان شرقی',
			'آذربایجانشرقی' => 'آذربایجان شرقی',
			'آذربایجان‌غربی' => 'آذربایجان غربی',
			'آذربایجانغربی' => 'آذربایجان غربی',
			'خراسان‌رضوی' => 'خراسان رضوی',
			'خراسانرضوی' => 'خراسان رضوی',
			'خراسان‌شمالی' => 'خراسان شمالی',
			'خراسان‌جنوبی' => 'خراسان جنوبی',
			'کهگیلویه وبویراحمد' => 'کهگیلویه و بویراحمد',
			'کهگیلویه و بویراحمد' => 'کهگیلویه و بویراحمد',
			'چهارمحال وبختیاری' => 'چهارمحال و بختیاری',
			'چهارمحال و بختیاری' => 'چهارمحال و بختیاری',
			'سیستان وبلوچستان' => 'سیستان و بلوچستان',
			'سیستان و بلوچستان' => 'سیستان و بلوچستان',
		);
		$compact = str_replace( array( ' ', '‌' ), '', $s );
		foreach ( $aliases as $k => $v ) {
			if ( str_replace( array( ' ', '‌' ), '', $k ) === $compact || $k === $s ) {
				return $v;
			}
		}
		return $s;
	}

	/**
	 * Call Neshan Reverse Geocoding API (مختصات → آدرس).
	 * Docs: GET https://api.neshan.org/v5/reverse?lat=&lng=  Header: Api-Key
	 *
	 * @param float|string $lat
	 * @param float|string $lng
	 * @param string       $api_key
	 * @return array|\WP_Error normalized payload
	 */
	public static function neshan_reverse_geocode( $lat, $lng, $api_key = '' ) {
		if ( $api_key === '' ) {
			$settings = self::get_settings();
			$api_key  = trim( (string) ( $settings['neshan_api_key'] ?? '' ) );
		}
		if ( $api_key === '' ) {
			return new \WP_Error( 'neshan_no_key', 'کلید API نشان تنظیم نشده است.' );
		}
		$lat = floatval( $lat );
		$lng = floatval( $lng );
		if ( ! is_finite( $lat ) || ! is_finite( $lng ) || abs( $lat ) > 90 || abs( $lng ) > 180 ) {
			return new \WP_Error( 'neshan_bad_coord', 'مختصات نامعتبر است.' );
		}
		// Iran rough bounds soft-check (still allow; Neshan validates)
		$url = add_query_arg(
			array(
				'lat' => sprintf( '%.7f', $lat ),
				'lng' => sprintf( '%.7f', $lng ),
			),
			'https://api.neshan.org/v5/reverse'
		);
		$res = wp_remote_get( $url, array(
			'timeout'     => 12,
			'redirection' => 2,
			'headers'     => array(
				'Api-Key' => $api_key,
				'Accept'  => 'application/json',
			),
			'user-agent'  => 'AMPHP-Storefront/13.3 (Neshan Reverse Geocoding)',
		) );
		if ( is_wp_error( $res ) ) {
			return new \WP_Error( 'neshan_http', 'خطا در ارتباط با نشان: ' . $res->get_error_message() );
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$body_raw = (string) wp_remote_retrieve_body( $res );
		$body = json_decode( $body_raw, true );
		if ( ! is_array( $body ) ) {
			$body = array();
		}
		if ( $code >= 400 ) {
			$status = (string) ( $body['status'] ?? $body['message'] ?? $body['error'] ?? '' );
			$map_err = array(
				'KeyNotFound'          => 'کلید API نشان نامعتبر است یا ارسال نشده.',
				'LimitExceeded'        => 'سقف فراخوانی نشان پر شده است.',
				'RateExceeded'         => 'تعداد درخواست نشان در دقیقه بیش از حد مجاز است.',
				'ApiKeyTypeError'      => 'نوع کلید نشان با سرویس Reverse Geocoding هم‌خوان نیست. از کلید سرویس «تبدیل مختصات به آدرس» استفاده کنید.',
				'ApiWhiteListError'    => 'IP یا دامنه برای این کلید نشان مجاز نیست.',
				'ApiServiceListError'  => 'سرویس Reverse روی این کلید فعال نیست.',
				'CoordinateParseError' => 'مختصات قابل‌خواندن نیست.',
				'INVALID_ARGUMENT'     => 'پارامترهای ورودی نامعتبر است.',
			);
			$msg = $map_err[ $status ] ?? ( $status !== '' ? $status : ( 'خطای نشان HTTP ' . $code ) );
			return new \WP_Error( 'neshan_api', $msg, array( 'status' => $code, 'body' => $body ) );
		}
		$api_status = strtoupper( (string) ( $body['status'] ?? 'OK' ) );
		if ( $api_status && $api_status !== 'OK' && empty( $body['formatted_address'] ) ) {
			return new \WP_Error( 'neshan_status', 'پاسخ نشان ناموفق: ' . $api_status, array( 'body' => $body ) );
		}

		$formatted = trim( (string) ( $body['formatted_address'] ?? '' ) );
		$route     = trim( (string) ( $body['route_name'] ?? '' ) );
		$neigh     = trim( (string) ( $body['neighbourhood'] ?? '' ) );
		$city_raw  = trim( (string) ( $body['city'] ?? '' ) );
		$state_raw = trim( (string) ( $body['state'] ?? '' ) );
		$village   = trim( (string) ( $body['village'] ?? '' ) );
		$county    = trim( (string) ( $body['county'] ?? '' ) );
		$district  = trim( (string) ( $body['district'] ?? '' ) );
		$place     = trim( (string) ( $body['place'] ?? '' ) );
		$zone      = trim( (string) ( $body['municipality_zone'] ?? '' ) );

		$province = self::neshan_normalize_province( $state_raw );
		$city = $city_raw !== '' ? $city_raw : ( $village !== '' ? $village : $county );
		// strip "شهرستان " prefix sometimes present on county fallback
		$city = preg_replace( '/^شهرستان\s+/u', '', (string) $city );

		// Build street-level address for the form (prefer Neshan formatted)
		$address = $formatted;
		if ( $address === '' ) {
			$parts = array_filter( array( $place, $route, $neigh, $city, $province ) );
			$address = implode( '، ', $parts );
		}

		return array(
			'ok'                 => true,
			'service'            => 'neshan_reverse_v5',
			'status'             => $api_status ?: 'OK',
			'formatted'          => $formatted,
			'formatted_address'  => $formatted,
			'address'            => $address,
			'province'           => $province,
			'state'              => $state_raw,
			'city'               => $city,
			'neighbourhood'      => $neigh,
			'route_name'         => $route,
			'route_type'         => (string) ( $body['route_type'] ?? '' ),
			'place'              => $place,
			'municipality_zone'  => $zone,
			'in_traffic_zone'    => ! empty( $body['in_traffic_zone'] ),
			'in_odd_even_zone'   => ! empty( $body['in_odd_even_zone'] ),
			'village'            => $village,
			'county'             => $county,
			'district'           => $district,
			'lat'                => $lat,
			'lng'                => $lng,
			'raw'                => $body,
		);
	}

	/**
	 * AJAX: Neshan reverse geocode (مختصات→آدرس) + search proxy.
	 * Key stays server-side (Api-Key header).
	 */
	public static function ajax_neshan_geocode() {
		$settings = self::get_settings();
		$key = trim( (string) ( $settings['neshan_api_key'] ?? '' ) );
		if ( $key === '' ) {
			wp_send_json_error( 'کلید API نشان تنظیم نشده است. از panel.neshan.org کلید سرویس Reverse Geocoding را وارد کنید.' );
		}
		$mode = sanitize_text_field( wp_unslash( $_REQUEST['mode'] ?? $_POST['mode'] ?? 'reverse' ) );
		$lat = sanitize_text_field( wp_unslash( $_REQUEST['lat'] ?? $_POST['lat'] ?? '' ) );
		$lng = sanitize_text_field( wp_unslash( $_REQUEST['lng'] ?? $_POST['lng'] ?? '' ) );
		$term = sanitize_text_field( wp_unslash( $_REQUEST['term'] ?? $_POST['term'] ?? $_POST['address'] ?? '' ) );

		if ( $mode === 'search' || $mode === 'forward' ) {
			if ( $term === '' ) {
				wp_send_json_error( 'عبارت جستجو خالی است.' );
			}
			$url = add_query_arg( array(
				'term' => $term,
				'lat'  => $lat !== '' ? $lat : (string) ( $settings['shipping_origin_lat'] ?? '35.6892' ),
				'lng'  => $lng !== '' ? $lng : (string) ( $settings['shipping_origin_lng'] ?? '51.3890' ),
			), 'https://api.neshan.org/v1/search' );
			$res = wp_remote_get( $url, array(
				'timeout' => 10,
				'headers' => array(
					'Api-Key' => $key,
					'Accept'  => 'application/json',
				),
			) );
			if ( is_wp_error( $res ) ) {
				wp_send_json_error( 'خطا در ارتباط با نشان: ' . $res->get_error_message() );
			}
			$code = wp_remote_retrieve_response_code( $res );
			$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
			if ( $code >= 400 ) {
				$msg = is_array( $body ) ? ( $body['message'] ?? $body['status'] ?? $body['error'] ?? 'خطای نشان' ) : 'خطای نشان';
				wp_send_json_error( (string) $msg );
			}
			$items = array();
			foreach ( (array) ( $body['items'] ?? $body['data'] ?? array() ) as $it ) {
				$plat = isset( $it['location']['y'] ) ? floatval( $it['location']['y'] ) : floatval( $it['lat'] ?? 0 );
				$plng = isset( $it['location']['x'] ) ? floatval( $it['location']['x'] ) : floatval( $it['lng'] ?? 0 );
				$items[] = array(
					'title'    => (string) ( $it['title'] ?? $it['address'] ?? '' ),
					'address'  => (string) ( $it['address'] ?? $it['title'] ?? '' ),
					'lat'      => $plat,
					'lng'      => $plng,
					'province' => self::neshan_normalize_province( $it['state'] ?? $it['province'] ?? '' ),
					'city'     => (string) ( $it['city'] ?? $it['region'] ?? '' ),
					'neighbourhood' => (string) ( $it['neighbourhood'] ?? '' ),
				);
			}
			wp_send_json_success( array(
				'mode'    => 'search',
				'service' => 'neshan_search_v1',
				'items'   => $items,
				'raw'     => $body,
			) );
		}

		/* default: reverse geocoding — سرویس تبدیل مختصات به آدرس */
		$result = self::neshan_reverse_geocode( $lat, $lng, $key );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( $result->get_error_message() );
		}
		wp_send_json_success( $result );
	}

	public static function ajax_custom_checkout_place_order() {
		check_ajax_referer( 'scraper_cart_nonce', 'nonce' );
		$settings = self::get_settings();
		if ( empty( $settings['enable_custom_checkout'] ) ) {
			wp_send_json_error( 'صفحه تسویه اختصاصی غیرفعال است.' );
		}
		if ( ! empty( $settings['checkout_require_login'] ) && ! is_user_logged_in() ) {
			wp_send_json_error( 'برای ثبت سفارش ابتدا وارد حساب کاربری شوید.' );
		}

		$raw_items = $_POST['items'] ?? '[]';
		$items     = json_decode( stripslashes( (string) $raw_items ), true );
		if ( ! is_array( $items ) || empty( $items ) ) {
			wp_send_json_error( 'سبد خرید خالی است.' );
		}
		if ( ! self::profile_cart_items_allowed( $items ) ) { wp_send_json_error( 'یکی از کالاهای سبد در پروفایل‌های فعلی نیست؛ سبد را به‌روز کنید.' ); }

		$customer = array(
			'name'     => sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) ),
			'phone'    => sanitize_text_field( wp_unslash( $_POST['phone'] ?? '' ) ),
			'email'    => sanitize_email( wp_unslash( $_POST['email'] ?? '' ) ),
			'province' => sanitize_text_field( wp_unslash( $_POST['province'] ?? '' ) ),
			'city'     => sanitize_text_field( wp_unslash( $_POST['city'] ?? '' ) ),
			'address'  => sanitize_textarea_field( wp_unslash( $_POST['address'] ?? '' ) ),
			'postal'   => sanitize_text_field( wp_unslash( $_POST['postal'] ?? '' ) ),
			'notes'    => sanitize_textarea_field( wp_unslash( $_POST['notes'] ?? '' ) ),
		);
		$payment_method = sanitize_text_field( wp_unslash( $_POST['payment_method'] ?? '' ) );
		$shipping_method = sanitize_text_field( wp_unslash( $_POST['shipping_method'] ?? '' ) );
		$shipping_title  = sanitize_text_field( wp_unslash( $_POST['shipping_title'] ?? '' ) );
		$shipping_cost   = floatval( $_POST['shipping_cost'] ?? 0 );
		$geo_lat         = sanitize_text_field( wp_unslash( $_POST['lat'] ?? '' ) );
		$geo_lng         = sanitize_text_field( wp_unslash( $_POST['lng'] ?? '' ) );

		/* v13.3.16: if destination coords set, enrich address via Neshan reverse geocoding */
		if ( $geo_lat !== '' && $geo_lng !== '' && ! empty( $settings['neshan_api_key'] ) ) {
			try {
				$rev = self::neshan_reverse_geocode( $geo_lat, $geo_lng, (string) $settings['neshan_api_key'] );
				if ( ! is_wp_error( $rev ) && is_array( $rev ) ) {
					if ( $customer['address'] === '' && ! empty( $rev['formatted'] ) ) {
						$customer['address'] = $rev['formatted'];
					}
					if ( $customer['province'] === '' && ! empty( $rev['province'] ) ) {
						$customer['province'] = $rev['province'];
					}
					if ( $customer['city'] === '' && ! empty( $rev['city'] ) ) {
						$customer['city'] = $rev['city'];
					}
				}
			} catch ( \Throwable $e ) { /* non-fatal */ }
		}

		// Validate required fields from settings
		$req_map = array(
			'name'     => array( 'checkout_field_name', 'checkout_field_name_req', 'نام و نام خانوادگی' ),
			'phone'    => array( 'checkout_field_phone', 'checkout_field_phone_req', 'شماره موبایل' ),
			'email'    => array( 'checkout_field_email', 'checkout_field_email_req', 'ایمیل' ),
			'province' => array( 'checkout_field_province', 'checkout_field_province_req', 'استان' ),
			'city'     => array( 'checkout_field_city', 'checkout_field_city_req', 'شهر' ),
			'address'  => array( 'checkout_field_address', 'checkout_field_address_req', 'آدرس' ),
			'postal'   => array( 'checkout_field_postal', 'checkout_field_postal_req', 'کد پستی' ),
			'notes'    => array( 'checkout_field_notes', 'checkout_field_notes_req', 'توضیحات' ),
		);
		foreach ( $req_map as $key => $meta ) {
			$enabled  = ! empty( $settings[ $meta[0] ] );
			$required = ! empty( $settings[ $meta[1] ] );
			if ( $enabled && $required && '' === trim( (string) ( $customer[ $key ] ?? '' ) ) ) {
				wp_send_json_error( 'لطفاً فیلد «' . $meta[2] . '» را تکمیل کنید.' );
			}
		}

		$gateways = self::get_active_payment_gateways_list();
		$gw_ids   = array_map( function( $g ) { return $g['id']; }, $gateways );
		if ( ! empty( $settings['checkout_show_gateways'] ) && $payment_method && ! in_array( $payment_method, $gw_ids, true ) ) {
			// still allow if list empty or cod
			if ( ! empty( $gw_ids ) ) {
				wp_send_json_error( 'روش پرداخت نامعتبر است.' );
			}
		}
		if ( empty( $payment_method ) && ! empty( $gw_ids ) ) {
			$payment_method = $gw_ids[0];
		}

		$gw_title = $payment_method;
		foreach ( $gateways as $g ) {
			if ( $g['id'] === $payment_method ) {
				$gw_title = $g['title'];
				break;
			}
		}

		// Build name parts
		$name_parts = preg_split( '/\s+/', trim( $customer['name'] ), 2 );
		$first_name = $name_parts[0] ?? '';
		$last_name  = $name_parts[1] ?? '';

		$order_id     = 0;
		$order_key    = '';
		$pay_url      = '';
		$thankyou_url = '';
		$total        = 0.0;
		$currency     = (string) ( $settings['currency_symbol'] ?? 'تومان' );

		if ( function_exists( 'wc_create_order' ) && class_exists( 'WC_Order' ) ) {
			try {
				if ( ! self::init_wc_cart() ) {
					// still try create order without session
				}
				$order = wc_create_order( array(
					'status'      => 'pending',
					'customer_id' => get_current_user_id() ?: 0,
				) );
				if ( is_wp_error( $order ) ) {
					wp_send_json_error( $order->get_error_message() );
				}

				foreach ( $items as $item ) {
					$product_id = self::find_or_create_wc_product( $item );
					$qty        = max( 1, intval( $item['qty'] ?? 1 ) );
					$price      = floatval( $item['price'] ?? 0 );
					if ( $product_id > 0 ) {
						$product = wc_get_product( $product_id );
						if ( $product ) {
							if ( $price > 0 ) {
								$product->set_price( $price );
							}
							$order->add_product( $product, $qty );
						}
					} else {
						// line item without product object
						$li = new \WC_Order_Item_Product();
						$li->set_name( (string) ( $item['title'] ?? 'کالا' ) );
						$li->set_quantity( $qty );
						$li->set_subtotal( $price * $qty );
						$li->set_total( $price * $qty );
						$order->add_item( $li );
					}
					$total += $price * $qty;
				}

				$order->set_billing_first_name( $first_name );
				$order->set_billing_last_name( $last_name );
				$order->set_billing_phone( $customer['phone'] );
				$order->set_billing_email( $customer['email'] ?: ( $customer['phone'] . '@guest.local' ) );
				$order->set_billing_state( $customer['province'] );
				$order->set_billing_city( $customer['city'] );
				$order->set_billing_address_1( $customer['address'] );
				$order->set_billing_postcode( $customer['postal'] );
				$order->set_shipping_first_name( $first_name );
				$order->set_shipping_last_name( $last_name );
				$order->set_shipping_state( $customer['province'] );
				$order->set_shipping_city( $customer['city'] );
				$order->set_shipping_address_1( $customer['address'] );
				$order->set_shipping_postcode( $customer['postal'] );
				$order->set_shipping_phone( $customer['phone'] );

				if ( $customer['notes'] ) {
					$order->set_customer_note( $customer['notes'] );
				}

				$order->set_payment_method( $payment_method );
				$order->set_payment_method_title( $gw_title );

				/* v13.3.13: shipping method + cost */
				if ( $shipping_method !== '' || $shipping_cost > 0 ) {
					try {
						$ship_item = new \WC_Order_Item_Shipping();
						$ship_label = $shipping_title !== '' ? $shipping_title : $shipping_method;
						if ( $ship_label === '' ) {
							$ship_label = 'ارسال';
						}
						$ship_item->set_method_title( $ship_label );
						$ship_item->set_method_id( $shipping_method !== '' ? $shipping_method : 'amphp_flat' );
						$ship_item->set_total( max( 0, $shipping_cost ) );
						$order->add_item( $ship_item );
					} catch ( \Throwable $e ) {
						// ignore shipping line failures
					}
				}
				if ( $geo_lat !== '' && $geo_lng !== '' ) {
					try {
						$order->update_meta_data( '_amphp_dest_lat', $geo_lat );
						$order->update_meta_data( '_amphp_dest_lng', $geo_lng );
					} catch ( \Throwable $e ) {}
				}
				$order->calculate_totals();
				$order->save();

				// Attempt payment gateway process for redirect gateways
				$pay_url = $order->get_checkout_payment_url();
				$thankyou_url = $order->get_checkout_order_received_url();
				$order_id  = $order->get_id();
				$order_key = $order->get_order_key();
				$total     = (float) $order->get_total();

				/* v13.1.8: بازگشت از درگاه به ویترین با amphp_paid تا React پیام تکمیل را فقط بعد از پرداخت نشان دهد */
				$shop_return = add_query_arg(
					array(
						'amphp_paid'  => '1',
						'amphp_order' => $order_id,
						'amphp_key'   => $order_key,
					),
					home_url( '/' )
				);
				$shop_page_id = intval( get_option( 'scraper_shop_page_id', 0 ) );
				if ( $shop_page_id <= 0 ) {
					$shop_page_id = intval( $settings['shop_page_id'] ?? 0 );
				}
				if ( $shop_page_id > 0 ) {
					$plink = get_permalink( $shop_page_id );
					if ( $plink ) {
						$shop_return = add_query_arg(
							array(
								'amphp_paid'  => '1',
								'amphp_order' => $order_id,
								'amphp_key'   => $order_key,
							),
							$plink
						);
					}
				}
				try {
					$order->update_meta_data( '_amphp_return_url', $shop_return );
					$order->save();
				} catch ( \Throwable $e ) { /* ignore */ }

				// Try gateway process_payment when available (redirect gateways)
				if ( function_exists( 'WC' ) && WC()->payment_gateways() ) {
					$available = WC()->payment_gateways()->get_available_payment_gateways();
					if ( isset( $available[ $payment_method ] ) ) {
						$gw = $available[ $payment_method ];
						if ( is_object( $gw ) && method_exists( $gw, 'process_payment' ) ) {
							try {
								$return_filter = function( $url, $o ) use ( $shop_return, $order_id ) {
									if ( $o && is_object( $o ) && (int) $o->get_id() === (int) $order_id ) {
										return $shop_return;
									}
									return $url;
								};
								add_filter( 'woocommerce_get_return_url', $return_filter, 99, 2 );
								$result = $gw->process_payment( $order_id );
								remove_filter( 'woocommerce_get_return_url', $return_filter, 99 );
								if ( is_array( $result ) && ! empty( $result['result'] ) && 'success' === $result['result'] && ! empty( $result['redirect'] ) ) {
									$pay_url = $result['redirect'];
								}
							} catch ( \Throwable $e ) {
								// keep pay_url fallback
							}
						}
					}
				}
				$thankyou_url = $shop_return;

				// Send the same complete, deduplicated WooCommerce order notification.
				self::on_wc_order_ready( $order );

			} catch ( \Throwable $e ) {
				wp_send_json_error( 'خطا در ثبت سفارش: ' . $e->getMessage() );
			}
		} else {
			// No WooCommerce — store a lightweight order record
			foreach ( $items as $item ) {
				$total += floatval( $item['price'] ?? 0 ) * max( 1, intval( $item['qty'] ?? 1 ) );
			}
			$order_id = intval( get_option( 'amphp_local_order_seq', 1000 ) ) + 1;
			update_option( 'amphp_local_order_seq', $order_id, false );
			$records = get_option( 'amphp_local_orders', array() );
			if ( ! is_array( $records ) ) {
				$records = array();
			}
			$total += max( 0, $shipping_cost );
			$records[] = array(
				'id'       => $order_id,
				'customer' => $customer,
				'items'    => $items,
				'total'    => $total,
				'payment'  => $payment_method,
				'shipping_method' => $shipping_method,
				'shipping_title'  => $shipping_title,
				'shipping_cost'   => $shipping_cost,
				'lat' => $geo_lat,
				'lng' => $geo_lng,
				'created'  => current_time( 'mysql' ),
			);
			update_option( 'amphp_local_orders', array_slice( $records, -200 ), false );
			$order_key = 'local_' . $order_id;
		}

		$is_cod = ( $payment_method === 'cod' || $payment_method === 'cheque' || $payment_method === 'bacs' );
		$needs_payment = ( ! $is_cod && $pay_url !== '' );
		$success_msg = (string) ( $settings['checkout_success_msg'] ?? 'سفارش شما با موفقیت تکمیل شد. از خریدتان سپاسگزاریم!' );
		/* قبل از پرداخت پیام «کامل شد» نفرست */
		$client_msg = $needs_payment
			? 'سفارش ثبت شد. در حال انتقال به درگاه پرداخت…'
			: $success_msg;

		wp_send_json_success( array(
			'order_id'        => $order_id,
			'order_key'       => $order_key,
			'total'           => $total,
			'total_formatted' => self::format_price( $total, $currency ),
			'payment_method'  => $payment_method,
			'payment_title'   => $gw_title,
			'pay_url'         => $pay_url,
			'thankyou_url'    => $thankyou_url,
			'needs_payment'   => $needs_payment,
			'is_cod'          => $is_cod,
			'message'         => $client_msg,
			'success_message' => $success_msg,
		) );
	}

	/**
	 * Internal analytics helper (safe no-op if missing).
	 */
	public static function ajax_track_analytics_event_internal( $type, $extra = array() ) {
		try {
			if ( method_exists( __CLASS__, 'record_analytics_event' ) ) {
				self::record_analytics_event( $type, (array) $extra );
				return;
			}
		} catch ( \Throwable $e ) {}
		try {
			$opts = get_option( 'scraper_shop_analytics', array() );
			if ( ! is_array( $opts ) ) {
				$opts = array();
			}
			if ( ! isset( $opts['events'] ) || ! is_array( $opts['events'] ) ) {
				$opts['events'] = array();
			}
			$opts['events'][] = array_merge( array(
				'type' => $type,
				'ts'   => time(),
			), (array) $extra );
			$opts['events'] = array_slice( $opts['events'], -5000 );
			if ( ! isset( $opts['totals'] ) || ! is_array( $opts['totals'] ) ) {
				$opts['totals'] = array();
			}
			$opts['totals'][ $type ] = intval( $opts['totals'][ $type ] ?? 0 ) + 1;
			update_option( 'scraper_shop_analytics', $opts, false );
		} catch ( \Throwable $e ) {}
	}

	/**
	 * Ensure scraped product price is kept during WooCommerce cart totals calculation.
	 *
	 * @param WC_Cart $cart
	 */
	public static function fix_cart_item_prices( $cart ) {
		if ( is_admin() && ! defined( 'DOING_AJAX' ) ) {
			return;
		}
		if ( did_action( 'woocommerce_before_calculate_totals' ) >= 2 ) {
			return;
		}
		foreach ( $cart->get_cart() as $cart_item_key => $cart_item ) {
			$product = $cart_item['data'] ?? null;
			if ( $product && is_object( $product ) ) {
				$product_id   = $product->get_id();
				$custom_price = get_post_meta( $product_id, '_price', true );
				if ( '' !== $custom_price && floatval( $custom_price ) > 0 ) {
					$product->set_price( floatval( $custom_price ) );
				}
			}
		}
	}

	/**
	 * Display scraped image in WooCommerce Cart & Checkout tables if no media thumbnail exists.
	 *
	 * @param string $thumbnail
	 * @param array $cart_item
	 * @param string $cart_item_key
	 * @return string
	 */
	public static function filter_cart_item_thumbnail( $thumbnail, $cart_item, $cart_item_key ) {
		$product = $cart_item['data'] ?? null;
		if ( $product && is_object( $product ) ) {
			$product_id  = $product->get_id();
			$scraped_img = get_post_meta( $product_id, '_scraped_image_url', true );
			if ( ! empty( $scraped_img ) && ! has_post_thumbnail( $product_id ) ) {
				return '<img width="64" height="64" src="' . esc_url( $scraped_img ) . '" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" alt="" style="object-fit:cover; border-radius:8px; width:64px; height:64px;">';
			}
		}
		return $thumbnail;
	}

	/**
	 * Hijack WooCommerce shop template with modern full-experience shop.
	 *
	 * @param string $template
	 * @return string
	 */
	/**
	 * Inject custom CSS to completely remove WordPress theme header & menu on shop pages
	 * when custom storefront takeover is enabled.
	 */
	/**
	 * True when the current front request should use bare React storefront (no WP theme chrome).
	 *
	 * @return bool
	 */
	public static function is_bare_storefront_request() {
		$settings = self::get_settings();
		if ( empty( $settings['enable_shop_takeover'] ) ) {
			return false;
		}
		if ( self::is_site_home_request() ) {
			return true;
		}
		if ( ( function_exists( 'is_shop' ) && is_shop() ) || ( function_exists( 'is_product_taxonomy' ) && is_product_taxonomy() ) ) {
			return true;
		}
		if ( ! empty( $settings['takeover_front_page'] ) && ( is_front_page() || is_home() ) ) {
			return true;
		}
		global $post;
		if ( ! empty( $post ) && is_a( $post, 'WP_Post' ) ) {
			if ( has_shortcode( $post->post_content, 'scraped_shop' ) || has_shortcode( $post->post_content, 'modern_shop' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Strip every theme/plugin front asset so only the React storefront ships.
	 */
	public static function strip_all_theme_assets() {
		if ( is_admin() || ! empty( $GLOBALS['amphp_bare_storefront'] ) ) {
			return;
		}
		if ( ! self::is_bare_storefront_request() ) {
			return;
		}
		global $wp_styles, $wp_scripts;
		$keep_style = array( 'amphp-storefront', 'admin-bar', 'dashicons' );
		$keep_script = array( 'amphp-storefront', 'admin-bar', 'hoverintent-js', 'hoverIntent', 'jquery', 'jquery-core', 'jquery-migrate' );

		// Only dequeue from print queue — do NOT deregister (breaks late printers / our bundle).
		if ( $wp_styles instanceof \WP_Styles ) {
			foreach ( array_keys( (array) $wp_styles->queue ) as $i ) {
				$handle = $wp_styles->queue[ $i ] ?? null;
			}
			foreach ( (array) $wp_styles->queue as $handle ) {
				if ( $handle && ! in_array( $handle, $keep_style, true ) ) {
					wp_dequeue_style( $handle );
				}
			}
		}
		if ( $wp_scripts instanceof \WP_Scripts ) {
			foreach ( (array) $wp_scripts->queue as $handle ) {
				if ( $handle && ! in_array( $handle, $keep_script, true ) ) {
					wp_dequeue_script( $handle );
				}
			}
		}
	}

	public static function inject_custom_header_suppression_css() {
		// Bare takeover renders its own document — no theme CSS to suppress.
		if ( ! empty( $GLOBALS['amphp_bare_storefront'] ) ) {
			return;
		}
		$settings = self::get_settings();
		if ( empty( $settings['enable_shop_takeover'] ) || empty( $settings['replace_site_header'] ) ) {
			return;
		}
		if ( ! self::is_bare_storefront_request() ) {
			return;
		}
		?>
		<style id="scraper-suppress-wp-theme-header">
			/* Kill WP theme chrome when shortcode is embedded in a theme template */
			body.amphp-react-storefront header:not(.sf-header):not(.sf-header-wrap),
			body.amphp-react-storefront #masthead,
			body.amphp-react-storefront .site-header,
			body.amphp-react-storefront #site-header,
			body.amphp-react-storefront .elementor-location-header,
			body.amphp-react-storefront .ast-main-header-wrap,
			body.amphp-react-storefront footer.site-footer,
			body.amphp-react-storefront #colophon,
			body.amphp-react-storefront .site-footer,
			body.amphp-react-storefront .elementor-location-footer,
			body.amphp-react-storefront .widget-area,
			body.amphp-react-storefront aside.widget-area,
			body.amphp-react-storefront #secondary,
			body.amphp-react-storefront .sidebar,
			body.amphp-react-storefront nav.main-navigation,
			body.amphp-react-storefront .storefront-primary-navigation,
			body.amphp-react-storefront .woocommerce-breadcrumb,
			body.amphp-react-storefront .entry-header,
			body.amphp-react-storefront .page-title,
			body.amphp-react-storefront .wp-block-template-part {
				display: none !important;
				height: 0 !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important;
			}
			body.amphp-react-storefront .site-content,
			body.amphp-react-storefront #content,
			body.amphp-react-storefront #primary,
			body.amphp-react-storefront .content-area,
			body.amphp-react-storefront main {
				margin: 0 !important; padding: 0 !important; max-width: none !important; width: 100% !important;
			}
		</style>
		<?php
	}

	/**
	 * Hijack WooCommerce shop template with modern full-experience shop.
	 *
	 * @param string $template
	 * @return string
	 */

	/**
	 * Absolute path to plugin native WP page template.
	 */
	public static function get_native_shop_template_path() {
		return plugin_dir_path( __FILE__ ) . 'templates/native-shop.php';
	}

	/**
	 * Register "Native WP shop" in the page template dropdown.
	 *
	 * @param array $templates
	 * @return array
	 */
	public static function register_native_page_templates( $templates ) {
		$templates['templates/native-shop.php'] = 'فروشگاه بومی وردپرس';
		return $templates;
	}

	/**
	 * Load plugin file when a page uses the native shop template.
	 *
	 * @param string $template
	 * @return string
	 */
	public static function maybe_load_native_page_template( $template ) {
		if ( is_admin() || ! is_singular( 'page' ) ) {
			return $template;
		}
		/* v13.3.32: صفحهٔ خانه همیشه React — قالب native را اینجا بارگذاری نکن */
		$settings = self::get_settings();
		if ( ! empty( $settings['enable_shop_takeover'] ) && self::is_site_home_request() ) {
			return $template;
		}
		$page_template = get_page_template_slug( get_queried_object_id() );
		if ( $page_template !== 'templates/native-shop.php' && $page_template !== 'native-shop.php' ) {
			// Also allow meta-selected fallback page without explicit template slug if content has shortcode only
			return $template;
		}
		$path = self::get_native_shop_template_path();
		if ( is_readable( $path ) ) {
			return $path;
		}
		return $template;
	}

	/**
	 * Create or repair the native fallback shop page (theme chrome + shortcode).
	 *
	 * @param bool $assign_wc_shop If true and WC shop empty/missing, set this page as WC shop.
	 * @return array{id:int,url:string,created:bool,message:string}
	 */

	/**
	 * Copy native-shop.php into the active theme so the page template
	 * keeps working after the plugin is deactivated.
	 *
	 * @return bool
	 */
	public static function sync_native_template_to_theme() {
		$src = self::get_native_shop_template_path();
		if ( ! is_readable( $src ) ) {
			return false;
		}
		$theme_dir = trailingslashit( get_stylesheet_directory() );
		if ( ! $theme_dir || ! is_dir( $theme_dir ) ) {
			return false;
		}
		$dest_dir = $theme_dir . 'templates';
		if ( ! is_dir( $dest_dir ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_mkdir
			@mkdir( $dest_dir, 0755, true );
		}
		$dest = $dest_dir . '/native-shop.php';
		// Also place at theme root for older WP template discovery
		$dest_root = $theme_dir . 'native-shop.php';
		$ok = false;
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_copy
		if ( @copy( $src, $dest ) ) {
			$ok = true;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_copy
		@copy( $src, $dest_root );
		return $ok;
	}

	public static function ensure_fallback_shop_page( $assign_wc_shop = null ) {
		$settings = self::get_settings();
		if ( null === $assign_wc_shop ) {
			$assign_wc_shop = ! empty( $settings['set_wc_shop_to_fallback'] );
		}
		$auto = ! isset( $settings['auto_create_fallback_page'] ) || ! empty( $settings['auto_create_fallback_page'] );
		$page_id = intval( $settings['native_fallback_page_id'] ?? 0 );
		if ( $page_id <= 0 ) {
			$page_id = intval( get_option( 'scraper_native_fallback_page_id', 0 ) );
		}
		$created = false;
		$title = (string) ( $settings['shop_title'] ?? 'فروشگاه' );
		if ( $title === '' ) {
			$title = 'فروشگاه';
		}
		$fallback_title = $title . ' — پشتیبان';

		// Validate existing
		if ( $page_id > 0 ) {
			$post = get_post( $page_id );
			if ( ! $post || $post->post_status === 'trash' || $post->post_type !== 'page' ) {
				$page_id = 0;
			}
		}

		// Find by meta / slug
		if ( $page_id <= 0 ) {
			$found = get_posts( array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => 1,
				'meta_key'       => '_amphp_native_fallback_shop',
				'meta_value'     => '1',
				'fields'         => 'ids',
			) );
			if ( ! empty( $found ) ) {
				$page_id = (int) $found[0];
			}
		}
		if ( $page_id <= 0 ) {
			$by_path = get_page_by_path( 'amphp-shop-fallback' );
			if ( $by_path && ! is_wp_error( $by_path ) ) {
				$page_id = (int) $by_path->ID;
			}
		}

		// Copy template into active theme so it survives plugin deactivation
		self::sync_native_template_to_theme();

		if ( $page_id <= 0 && $auto ) {
			// WC-native shortcode so the page still lists products if plugin is off
			$content = "<!-- wp:shortcode -->\n[products limit=\"24\" columns=\"4\" orderby=\"date\"]\n<!-- /wp:shortcode -->\n\n"
				. "<!-- برگهٔ پشتیبان فروشگاه بومی وردپرس -->\n";
			$page_id = wp_insert_post( array(
				'post_title'   => $fallback_title,
				'post_name'    => 'amphp-shop-fallback',
				'post_content' => $content,
				'post_status'  => 'publish',
				'post_type'    => 'page',
				'post_author'  => get_current_user_id() ?: 1,
			), true );
			if ( is_wp_error( $page_id ) ) {
				return array(
					'id'      => 0,
					'url'     => '',
					'created' => false,
					'message' => $page_id->get_error_message(),
				);
			}
			$page_id = (int) $page_id;
			$created = true;
		}

		if ( $page_id > 0 ) {
			update_post_meta( $page_id, '_amphp_native_fallback_shop', '1' );
			update_post_meta( $page_id, '_wp_page_template', 'templates/native-shop.php' );
			// Ensure shortcode present if content empty
			$post = get_post( $page_id );
			if ( $post && trim( wp_strip_all_tags( $post->post_content ) ) === '' ) {
				wp_update_post( array(
					'ID'           => $page_id,
					'post_content' => '[products limit="24" columns="4"]\n',
				) );
			}
			self::sync_native_template_to_theme();
			update_option( 'scraper_native_fallback_page_id', $page_id, false );
			// v13.3.32: برگهٔ پشتیبان ≠ صفحهٔ فروشگاه اصلی — shop_page_id را روی پشتیبان ننویس
			$settings['native_fallback_page_id'] = $page_id;
			update_option( self::OPTION_NAME, $settings );

			/* v13.3.32: فقط وقتی صریحاً خواسته شده و takeover React خاموش است،
			   فروشگاه ووکامرس را روی پشتیبان بگذار — وگرنه ویترین React می‌میرد. */
			$react_takeover = ! empty( $settings['enable_shop_takeover'] );
			$tpl_now = (string) ( $settings['store_template'] ?? 'digikala' );
			$want_native_primary = ( $tpl_now === 'native-wp' || $tpl_now === 'native' );
			if ( $assign_wc_shop && function_exists( 'wc_get_page_id' ) && ( ! $react_takeover || $want_native_primary ) ) {
				$wc_shop = (int) wc_get_page_id( 'shop' );
				$need_set = ( $wc_shop <= 0 || get_post_status( $wc_shop ) === false || get_post_status( $wc_shop ) === 'trash' );
				if ( $need_set && ! empty( $settings['set_wc_shop_to_fallback'] ) ) {
					update_option( 'woocommerce_shop_page_id', $page_id );
				}
			}
		}

		$url = $page_id > 0 ? get_permalink( $page_id ) : '';
		return array(
			'id'      => $page_id,
			'url'     => $url ? (string) $url : '',
			'created' => $created,
			'message' => $page_id > 0
				? ( $created ? 'برگه پشتیبان ساخته شد.' : 'برگه پشتیبان آماده است.' )
				: 'ساخت برگه پشتیبان ناموفق بود.',
			'template'=> 'templates/native-shop.php',
		);
	}

	/**
	 * admin_init soft ensure (non-blocking).
	 */
	public static function maybe_ensure_fallback_shop_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = self::get_settings();
		if ( empty( $settings['enable_native_wp_template'] ) && empty( $settings['auto_create_fallback_page'] ) ) {
			return;
		}
		$id = intval( $settings['native_fallback_page_id'] ?? 0 );
		if ( $id > 0 && get_post_status( $id ) ) {
			return;
		}
		// Throttle
		if ( get_transient( 'amphp_fb_page_checked' ) ) {
			return;
		}
		set_transient( 'amphp_fb_page_checked', 1, 10 * MINUTE_IN_SECONDS );
		try {
			self::ensure_fallback_shop_page( false );
		} catch ( \Throwable $e ) {
			// ignore
		}
	}

	/**
	 * AJAX: create/repair fallback page from admin button.
	 */
	
	/**
	 * v13.3.32: ذخیرهٔ خودکار تنظیمات ادمین (AJAX) بدون رفرش صفحه.
	 */
	public static function ajax_autosave_settings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'دسترسی غیرمجاز' ), 403 );
		}
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );

		// Reuse POST field parsing from full save by simulating the same keys
		if ( empty( $_POST ) || count( $_POST ) < 3 ) {
			wp_send_json_error( array( 'message' => 'داده خالی' ) );
		}

		// Build settings the same way as render_admin_settings_page save block
		// Call internal merge helper
		try {
			$new_settings = self::build_settings_from_request();
			if ( ! is_array( $new_settings ) || ! $new_settings ) {
				wp_send_json_error( array( 'message' => 'ساخت تنظیمات ناموفق' ) );
			}
			update_option( self::OPTION_NAME, $new_settings );
			delete_transient( 'scraper_shop_cached_products' );

			// Light side-effects (no heavy ensure loops)
			if ( ! empty( $new_settings['enable_shop_takeover'] ) ) {
				$_tpl = (string) ( $new_settings['store_template'] ?? 'digikala' );
				if ( $_tpl !== 'native-wp' && $_tpl !== 'native' ) {
					$new_settings['set_wc_shop_to_fallback'] = false;
					update_option( self::OPTION_NAME, $new_settings );
				}
				try {
					self::maybe_detach_fallback_from_primary_shop();
				} catch ( \Throwable $e ) { /* ignore */ }
			}

			wp_send_json_success(
				array(
					'message'   => 'ذخیره شد',
					'saved_at'  => current_time( 'H:i:s' ),
					'version'   => '13.3.32',
					'takeover'  => ! empty( $new_settings['enable_shop_takeover'] ),
					'template'  => (string) ( $new_settings['store_template'] ?? '' ),
					'wc_fb'     => ! empty( $new_settings['set_wc_shop_to_fallback'] ),
				)
			);
		} catch ( \Throwable $e ) {
			wp_send_json_error( array( 'message' => $e->getMessage() ) );
		}
	}

	/**
	 * v13.3.32: استخراج آرایهٔ تنظیمات از درخواست POST (ذخیره دستی و خودکار مشترک).
	 *
	 * @return array
	 */
	public static function build_settings_from_request() {
		$__post_cs = sanitize_key( $_POST['catalog_source'] ?? '' );
		if ( ! in_array( $__post_cs, array( 'scraper', 'woocommerce', 'merge' ), true ) ) {
			$__post_cs = ! empty( $_POST['enable_scraped_products'] ) ? 'scraper' : 'woocommerce';
		}
		$__post_mp = sanitize_key( $_POST['catalog_merge_prefer'] ?? 'scraper' );
		if ( ! in_array( $__post_mp, array( 'scraper', 'woocommerce', 'keep_both' ), true ) ) {
			$__post_mp = 'scraper';
		}

		// Start from current settings so missing fields (other tabs) are preserved on partial autosave
		$cur = self::get_settings();
		$posted = array();
		// Only overwrite keys that appear in POST (autosave sends whole form)
		$map_bool = array(
			'enable_shop_takeover', 'takeover_front_page', 'enable_native_wp_template',
			'auto_create_fallback_page', 'enable_404_shop_redirect', 'set_wc_shop_to_fallback',
			'enable_support_chat', 'enable_custom_checkout', 'checkout_require_login',
			'checkout_show_gateways', 'checkout_show_shipping', 'checkout_show_map',
			'show_top_bar', 'show_features_banner', 'show_animated_stats', 'show_special_badge',
			'sticky_header', 'enable_scraped_products', 'replace_site_header',
			'enable_wp_cron_sync', 'chat_field_name_enable', 'chat_field_name_required',
			'chat_field_phone_enable', 'chat_field_phone_required', 'chat_field_email_enable',
			'chat_field_email_required',
		);
		foreach ( $map_bool as $k ) {
			if ( array_key_exists( $k, $_POST ) ) {
				$v = $_POST[ $k ];
				if ( $k === 'set_wc_shop_to_fallback' ) {
					$posted[ $k ] = ( (string) $v === '1' );
				} else {
					$posted[ $k ] = ! empty( $v ) && (string) $v !== '0';
				}
			}
		}
		$map_text = array(
			'shop_title', 'shop_subtitle', 'contact_phone', 'support_hours', 'accent_color',
			'currency_symbol', 'store_template', 'store_palette', 'shop_title_font',
			'shop_title_custom_font', 'shop_title_font_size', 'shop_title_font_weight',
			'default_column_layout', 'top_bar_notice', 'chat_window_title', 'chat_welcome_message',
			'chat_button_position', 'ai_support_name', 'ai_system_prompt', 'checkout_title',
			'checkout_note', 'checkout_cod_label', 'checkout_success_msg', 'wp_cron_interval',
			'bale_token', 'bale_chat_id', 'telegram_token', 'telegram_chat_id', 'rubika_token',
			'rubika_chat_id', 'catalog_source', 'catalog_merge_prefer',
		);
		foreach ( $map_text as $k ) {
			if ( array_key_exists( $k, $_POST ) ) {
				if ( in_array( $k, array( 'chat_welcome_message', 'ai_system_prompt', 'checkout_note', 'checkout_success_msg' ), true ) ) {
					$posted[ $k ] = sanitize_textarea_field( wp_unslash( (string) $_POST[ $k ] ) );
				} else {
					$posted[ $k ] = sanitize_text_field( wp_unslash( (string) $_POST[ $k ] ) );
				}
			}
		}
		if ( array_key_exists( 'catalog_source', $_POST ) || array_key_exists( 'enable_scraped_products', $_POST ) ) {
			$posted['catalog_source'] = $__post_cs;
			$posted['enable_scraped_products'] = ( 'woocommerce' !== $__post_cs );
		}
		if ( array_key_exists( 'catalog_merge_prefer', $_POST ) ) {
			$posted['catalog_merge_prefer'] = $__post_mp;
		}
		if ( array_key_exists( 'products_per_page', $_POST ) ) {
			$posted['products_per_page'] = max( 1, min( 200, intval( $_POST['products_per_page'] ) ) );
		}
		if ( array_key_exists( 'native_fallback_page_id', $_POST ) ) {
			$posted['native_fallback_page_id'] = intval( $_POST['native_fallback_page_id'] );
		}
		// checkout field toggles
		foreach ( $_POST as $pk => $pv ) {
			$pk = (string) $pk;
			if ( strpos( $pk, 'checkout_field_' ) === 0 ) {
				$posted[ sanitize_key( $pk ) ] = ! empty( $pv ) && (string) $pv !== '0';
			}
		}

		$merged = array_merge( is_array( $cur ) ? $cur : array(), $posted );

		/* v13.3.32: خانهٔ سایت همیشه React وقتی takeover روشن است */
		if ( ! empty( $merged['enable_shop_takeover'] ) ) {
			$merged['takeover_front_page'] = true;
		}

		// Keep accent in sync with palette when palette posted
		if ( ! empty( $merged['store_palette'] ) ) {
			$__pal_map = array(
				'digikala-red' => '#ef394e', 'snapp-green' => '#00d170', 'basalam-coral' => '#ff6b35',
				'torob-red' => '#d32f2f', 'digistyle-rose' => '#e11d48', 'technolife-blue' => '#0284c7',
				'royal-blue' => '#2563eb', 'luxury-purple' => '#7c3aed', 'amber-gold' => '#d97706',
				'persian-turquoise' => '#0d9488', 'midnight-ink' => '#1e293b', 'forest' => '#166534',
				'sunset' => '#ea580c',
			);
			$pal = (string) $merged['store_palette'];
			if ( isset( $__pal_map[ $pal ] ) && empty( $_POST['accent_color'] ) ) {
				$merged['accent_color'] = $__pal_map[ $pal ];
			}
		}
		return $merged;
	}

	public static function ajax_ensure_fallback_shop() {
		check_ajax_referer( 'scraper_shop_admin_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'دسترسی غیرمجاز.' );
		}
		$assign = ! empty( $_POST['assign_wc'] );
		$res = self::ensure_fallback_shop_page( $assign );
		if ( ! empty( $res['id'] ) ) {
			wp_send_json_success( $res );
		}
		wp_send_json_error( $res['message'] ?? 'خطا' );
	}

	/**
	 * On 404 (and optionally when React takeover target is broken), send visitors to fallback shop.
	 */
	public static function maybe_redirect_404_to_fallback_shop() {
		if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$settings = self::get_settings();
		if ( empty( $settings['enable_404_shop_redirect'] ) ) {
			return;
		}
		if ( ! is_404() ) {
			return;
		}
		// Don't loop
		$fb_id = intval( $settings['native_fallback_page_id'] ?? 0 );
		if ( $fb_id <= 0 ) {
			$fb_id = intval( get_option( 'scraper_native_fallback_page_id', 0 ) );
		}
		if ( $fb_id <= 0 ) {
			$ensured = self::ensure_fallback_shop_page( false );
			$fb_id = intval( $ensured['id'] ?? 0 );
		}
		if ( $fb_id <= 0 ) {
			// Last resort: WooCommerce shop
			if ( function_exists( 'wc_get_page_id' ) ) {
				$fb_id = (int) wc_get_page_id( 'shop' );
			}
		}
		if ( $fb_id <= 0 ) {
			return;
		}
		$url = get_permalink( $fb_id );
		if ( ! $url ) {
			return;
		}
		// Avoid redirect loop if the 404 path is already the fallback slug
		$req = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		$path = (string) ( wp_parse_url( $url, PHP_URL_PATH ) ?: '' );
		if ( $path && $req && strpos( $req, trim( $path, '/' ) ) !== false ) {
			return;
		}
		nocache_headers();
		wp_safe_redirect( $url, 302 );
		exit;
	}


	/**
	 * v13.3.32: اگر فروشگاه ووکامرس اشتباهاً روی برگهٔ «پشتیبان» نشسته و
	 * ویترین React فعال است، ارتباط را قطع کن تا رفرش دوباره native نیاید.
	 */
	public static function maybe_detach_fallback_from_primary_shop() {
		$settings = self::get_settings();
		$tpl = (string) ( $settings['store_template'] ?? 'digikala' );
		// فقط وقتی کاربر عمداً native را به‌عنوان ویترین اصلی خواسته، دست نزن
		if ( $tpl === 'native-wp' || $tpl === 'native' ) {
			return;
		}
		// اگر صریحاً خواسته پشتیبان = فروشگاه WC و takeover خاموش است، دست نزن
		if ( empty( $settings['enable_shop_takeover'] ) && ! empty( $settings['set_wc_shop_to_fallback'] ) ) {
			return;
		}
		$fb_id = intval( $settings['native_fallback_page_id'] ?? get_option( 'scraper_native_fallback_page_id', 0 ) );
		if ( $fb_id <= 0 ) {
			return;
		}

		// throttle: یک‌بار در هر درخواست / هر چند دقیقه روی فرانت
		static $done = false;
		if ( $done ) {
			return;
		}
		$done = true;

		$changed = false;
		$primary_id = 0;

		if ( function_exists( 'wc_get_page_id' ) ) {
			$wc_shop = (int) wc_get_page_id( 'shop' );
			if ( $wc_shop > 0 && $wc_shop === $fb_id ) {
				// بساز / پیدا کن برگهٔ اصلی فروشگاه (جدا از پشتیبان)
				$primary_id = self::ensure_primary_react_shop_page( $settings, $fb_id );
				if ( $primary_id > 0 && $primary_id !== $fb_id ) {
					update_option( 'woocommerce_shop_page_id', $primary_id );
					$changed = true;
				}
				update_option(
					'amphp_detached_fallback_shop',
					array(
						'at'          => time(),
						'fallback_id' => $fb_id,
						'primary_id'  => $primary_id,
						'reason'      => 'v13.3.32_react_primary',
					),
					false
				);
			}
		}

		// shop_page_id افزونه نباید = پشتیبان باشد
		if ( intval( $settings['shop_page_id'] ?? 0 ) === $fb_id ) {
			if ( $primary_id <= 0 ) {
				$primary_id = self::ensure_primary_react_shop_page( $settings, $fb_id );
			}
			$settings['shop_page_id'] = $primary_id > 0 ? $primary_id : 0;
			// force set_wc off so save loops don't re-bind
			if ( ! empty( $settings['set_wc_shop_to_fallback'] ) && ! empty( $settings['enable_shop_takeover'] ) ) {
				$settings['set_wc_shop_to_fallback'] = false;
			}
			update_option( self::OPTION_NAME, $settings );
			$changed = true;
		}
		$sp = intval( get_option( 'scraper_shop_page_id', 0 ) );
		if ( $sp === $fb_id ) {
			if ( $primary_id > 0 ) {
				update_option( 'scraper_shop_page_id', $primary_id, false );
			} else {
				delete_option( 'scraper_shop_page_id' );
			}
			$changed = true;
		}
		if ( $changed && function_exists( 'wc_delete_shop_order_transients' ) ) {
			// no-op friendly
		}
	}

	/**
	 * v13.3.32: برگهٔ اصلی فروشگاه برای takeover React (جدا از «— پشتیبان»).
	 *
	 * @param array $settings
	 * @param int   $fallback_id
	 * @return int page id
	 */
	public static function ensure_primary_react_shop_page( $settings, $fallback_id = 0 ) {
		$fallback_id = (int) $fallback_id;
		$title = trim( (string) ( $settings['shop_title'] ?? '' ) );
		if ( $title === '' ) {
			$title = function_exists( 'get_bloginfo' ) ? (string) get_bloginfo( 'name' ) : 'فروشگاه';
		}
		// نگذار عنوان «… — پشتیبان» باشد
		$title = preg_replace( '/\s*[—\-]\s*پشتیبان\s*$/u', '', $title );
		if ( $title === '' ) {
			$title = 'فروشگاه';
		}

		$existing = intval( $settings['shop_page_id'] ?? 0 );
		if ( $existing > 0 && $existing !== $fallback_id ) {
			$p = get_post( $existing );
			if ( $p && $p->post_type === 'page' && $p->post_status !== 'trash' ) {
				// مطمئن شو قالب native روی primary نیست
				$tpl = get_page_template_slug( $existing );
				if ( $tpl === 'templates/native-shop.php' || $tpl === 'native-shop.php' ) {
					update_post_meta( $existing, '_wp_page_template', 'default' );
				}
				delete_post_meta( $existing, '_amphp_native_fallback_shop' );
				return $existing;
			}
		}

		// by meta
		$found = get_posts(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft' ),
				'posts_per_page' => 1,
				'meta_key'       => '_amphp_primary_react_shop',
				'meta_value'     => '1',
				'fields'         => 'ids',
			)
		);
		if ( ! empty( $found ) ) {
			$pid = (int) $found[0];
			if ( $pid !== $fallback_id ) {
				return $pid;
			}
		}

		$by_path = get_page_by_path( 'amphp-shop' );
		if ( $by_path && ! is_wp_error( $by_path ) && (int) $by_path->ID !== $fallback_id ) {
			update_post_meta( (int) $by_path->ID, '_amphp_primary_react_shop', '1' );
			update_post_meta( (int) $by_path->ID, '_wp_page_template', 'default' );
			return (int) $by_path->ID;
		}

		// create
		$content = "<!-- wp:shortcode -->\n[modern_shop]\n<!-- /wp:shortcode -->\n\n"
			. "<!-- ویترین اصلی React — برگهٔ پشتیبان جداست -->\n";
		$pid = wp_insert_post(
			array(
				'post_title'   => $title,
				'post_name'    => 'amphp-shop',
				'post_content' => $content,
				'post_status'  => 'publish',
				'post_type'    => 'page',
				'post_author'  => get_current_user_id() ?: 1,
			),
			true
		);
		if ( is_wp_error( $pid ) || ! $pid ) {
			return 0;
		}
		$pid = (int) $pid;
		update_post_meta( $pid, '_amphp_primary_react_shop', '1' );
		update_post_meta( $pid, '_wp_page_template', 'default' );
		return $pid;
	}


	/**
	 * v13.3.32: آیا این درخواست باید ویترین React bare (دیجی‌کالا و …) باشد؟
	 */
	
	/**
	 * v13.3.32: نوار/منوی خود پیشخوان وردپرس — فقط دسکتاپ sticky؛ موبایل دست‌نخورده
	 * (position:fixed روی #adminmenuwrap در موبایل باعث پرت شدن همبرگر به چپ می‌شد).
	 */
	public static function amphp_admin_sticky_assets() {
		if ( ! is_admin() ) {
			return;
		}
		$page = isset( $_GET['page'] ) ? sanitize_key( (string) $_GET['page'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$ours = ( $page === 'scraper-auto-shop' || $page === 'scraper-full-dashboard' );
		// CSS سراسری پیشخوان: فقط sticky امن دسکتاپ — بدون دستکاری موبایل
		echo '<style id="amphp-wp-admin-chrome-sticky">
/* دسکتاپ: نوار بالا و منوی کناری چسبان */
@media screen and (min-width: 783px) {
  #wpadminbar{
    position:fixed!important;
    top:0!important;left:0!important;right:0!important;
    width:100%!important;z-index:99999!important;
  }
  #adminmenuback,#adminmenuwrap{
    position:fixed!important;
    top:32px!important;
    bottom:0!important;
    z-index:9990!important;
    height:auto!important;
    overflow-y:auto!important;
    overflow-x:hidden!important;
  }
  #adminmenuback{z-index:9989!important}
  #adminmenu{margin-top:0!important}
}
/* موبایل: منو/همبرگر وردپرس دست‌نخورده — فقط نوار بالا و جلوگیری از اسکرول افقی */
@media screen and (max-width: 782px) {
  #wpadminbar{
    position:fixed!important;
    top:0!important;left:0!important;right:0!important;
    width:100%!important;max-width:100vw!important;
    z-index:99999!important;
  }
  /* عمداً #adminmenuwrap و #adminmenuback را override نمی‌کنیم */
  body.wp-admin #wpwrap{overflow-x:hidden;max-width:100vw}
}
</style>';
		if ( $ours ) {
			echo '<style id="amphp-admin-panel-v27">
/* ——— پنل افزونه v13.3.32: فشرده، بدون اسکرول افقی، موبایل‌دوست ——— */
html.wp-toolbar{overflow-x:hidden!important}
body.wp-admin{overflow-x:hidden!important;max-width:100vw!important}
#wpbody-content{overflow-x:hidden!important;padding-bottom:40px}
.wrap.scraper-admin-dashboard{
  direction:rtl!important;text-align:right!important;
  box-sizing:border-box!important;
  max-width:100%!important;width:100%!important;
  margin:12px 0 24px!important;padding:0 4px!important;
  font-family:Tahoma,Tahoma,ui-sans-serif,system-ui,-apple-system,sans-serif!important;
  font-size:13px!important;line-height:1.55!important;color:#1e293b!important;
  overflow-x:hidden!important;
}
.wrap.scraper-admin-dashboard *,
.wrap.scraper-admin-dashboard *::before,
.wrap.scraper-admin-dashboard *::after{box-sizing:border-box!important}
.wrap.scraper-admin-dashboard img,
.wrap.scraper-admin-dashboard svg,
.wrap.scraper-admin-dashboard table,
.wrap.scraper-admin-dashboard pre{max-width:100%!important}
.wrap.scraper-admin-dashboard h1{font-size:1.25rem!important;font-weight:800!important;line-height:1.35!important;margin:0 0 6px!important}
.wrap.scraper-admin-dashboard h2{font-size:1.1rem!important;font-weight:800!important}
.wrap.scraper-admin-dashboard h3{font-size:1rem!important;font-weight:800!important;margin:0!important}
.wrap.scraper-admin-dashboard h4{font-size:0.95rem!important;font-weight:800!important}
.wrap.scraper-admin-dashboard p{font-size:0.84rem!important;line-height:1.65!important}
.wrap.scraper-admin-dashboard .form-table th{
  font-size:0.84rem!important;font-weight:700!important;color:#334155!important;
  padding:10px 0 6px!important;width:auto!important;
}
.wrap.scraper-admin-dashboard .form-table td{padding:6px 0 12px!important;font-size:0.84rem!important}
.wrap.scraper-admin-dashboard input[type=text],
.wrap.scraper-admin-dashboard input[type=password],
.wrap.scraper-admin-dashboard input[type=number],
.wrap.scraper-admin-dashboard input[type=url],
.wrap.scraper-admin-dashboard input[type=email],
.wrap.scraper-admin-dashboard select,
.wrap.scraper-admin-dashboard textarea{
  font-size:13px!important;max-width:100%!important;
  border-radius:8px!important;
}
.wrap.scraper-admin-dashboard .button,
.wrap.scraper-admin-dashboard .button-primary,
.wrap.scraper-admin-dashboard .button-secondary{
  font-size:12.5px!important;font-weight:700!important;
  border-radius:8px!important;padding:6px 12px!important;height:auto!important;line-height:1.4!important;
}
.wrap.scraper-admin-dashboard .admin-card{
  background:#fff!important;border:1px solid #e2e8f0!important;
  border-radius:12px!important;padding:14px 14px!important;margin-bottom:14px!important;
  box-shadow:0 1px 3px rgba(15,23,42,.04)!important;
  overflow:hidden!important;max-width:100%!important;
}
.wrap.scraper-admin-dashboard .admin-card-header{
  display:flex!important;justify-content:space-between!important;align-items:center!important;
  flex-wrap:wrap!important;gap:8px!important;
  margin-bottom:12px!important;padding-bottom:10px!important;border-bottom:1px solid #f1f5f9!important;
}
.wrap.scraper-admin-dashboard .field-badge{
  font-size:0.72rem!important;font-weight:700!important;padding:3px 8px!important;border-radius:999px!important;
}
.amphp-admin-hero{
  background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#1d4ed8 140%)!important;
  color:#fff!important;border-radius:14px!important;
  padding:14px 16px!important;margin-bottom:14px!important;
  display:flex!important;justify-content:space-between!important;align-items:flex-start!important;
  flex-wrap:wrap!important;gap:12px!important;
  box-shadow:0 8px 24px rgba(15,23,42,.18)!important;
  max-width:100%!important;overflow:hidden!important;
}
.amphp-admin-hero h1{color:#fff!important;font-size:1.15rem!important;margin:0 0 4px!important}
.amphp-admin-hero p{color:#cbd5e1!important;margin:0!important;font-size:0.8rem!important;max-width:560px!important}
.amphp-admin-hero .amphp-hero-badge{
  display:inline-flex!important;align-items:center!important;gap:4px!important;
  background:rgba(37,99,235,.95)!important;color:#fff!important;
  font-size:0.72rem!important;font-weight:800!important;
  padding:3px 10px!important;border-radius:999px!important;margin-bottom:8px!important;
}
.amphp-admin-hero .scraper-admin-topbar{
  display:flex!important;flex-wrap:wrap!important;gap:8px!important;align-items:center!important;
}
.amphp-admin-hero .scraper-admin-topbar .button{margin:0!important;white-space:nowrap!important}
.scraper-tab-nav-row{
  display:flex!important;justify-content:space-between!important;align-items:center!important;
  flex-wrap:wrap!important;gap:8px!important;
  border-bottom:1px solid #e2e8f0!important;margin-bottom:12px!important;padding-bottom:10px!important;
  max-width:100%!important;
}
.scraper-tab-nav{
  display:flex!important;flex-wrap:wrap!important;gap:6px!important;flex:1 1 auto!important;
  max-width:100%!important;
}
.scraper-tab-link{
  display:inline-flex!important;align-items:center!important;justify-content:center!important;
  gap:4px!important;padding:7px 10px!important;
  font-size:0.78rem!important;font-weight:700!important;color:#475569!important;
  text-decoration:none!important;border-radius:8px!important;
  border:1px solid #e2e8f0!important;background:#f8fafc!important;
  cursor:pointer!important;line-height:1.3!important;white-space:nowrap!important;
}
.scraper-tab-link:hover{background:#e2e8f0!important;color:#0f172a!important}
.scraper-tab-link.active{
  color:#fff!important;background:#2563eb!important;border-color:#2563eb!important;
  box-shadow:0 2px 8px rgba(37,99,235,.25)!important;
}
.scraper-top-save-btn{
  background:#2563eb!important;border-color:#2563eb!important;color:#fff!important;
  font-weight:800!important;padding:7px 14px!important;border-radius:8px!important;
  font-size:0.8rem!important;cursor:pointer!important;white-space:nowrap!important;flex-shrink:0!important;
}
.scraper-tab-panel{display:none}
.scraper-tab-panel.active{display:block}
.scraper-mobile-tab-bar{display:none;margin-bottom:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px}
.scraper-mobile-tab-bar label{display:block;font-size:0.78rem;font-weight:800;color:#0f172a;margin-bottom:4px}
.scraper-mobile-tab-bar select{
  width:100%!important;max-width:100%!important;padding:8px 10px!important;
  font-size:14px!important;font-weight:700!important;border:1.5px solid #2563eb!important;border-radius:8px!important;
}
/* جلوگیری از اسکرول افقی داخل ویترین */
.wrap.scraper-admin-dashboard [style*="grid-template-columns"],
.wrap.scraper-admin-dashboard [style*="display:grid"],
.wrap.scraper-admin-dashboard [style*="display:flex"]{
  max-width:100%!important;
}
.wrap.scraper-admin-dashboard .amphp-fluid-grid{
  display:grid!important;
  grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))!important;
  gap:10px!important;margin-bottom:12px!important;width:100%!important;
}
#amphpAutosavePill{font-size:0.75rem!important;padding:4px 10px!important;border-radius:8px!important}
.scraper-save-bar{max-width:100%!important;box-sizing:border-box!important}

@media screen and (max-width: 782px) {
  .wrap.scraper-admin-dashboard{
    margin:6px 0 20px!important;padding:0!important;font-size:12.5px!important;
  }
  .amphp-admin-hero{padding:12px!important;border-radius:12px!important;margin-bottom:10px!important}
  .amphp-admin-hero h1{font-size:1rem!important}
  .amphp-admin-hero p{font-size:0.75rem!important}
  .amphp-admin-hero .scraper-admin-topbar{width:100%!important}
  .amphp-admin-hero .scraper-admin-topbar .button{
    flex:1 1 auto!important;text-align:center!important;font-size:11.5px!important;padding:8px 10px!important;
  }
  .scraper-mobile-tab-bar{display:block!important}
  .scraper-tab-nav-row{flex-direction:column!important;align-items:stretch!important;gap:8px!important}
  .scraper-tab-nav{
    display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
    gap:6px!important;width:100%!important;
  }
  .scraper-tab-link{
    width:100%!important;padding:8px 4px!important;font-size:0.72rem!important;
    white-space:normal!important;text-align:center!important;line-height:1.25!important;
  }
  .scraper-top-save-btn{width:100%!important;text-align:center!important;padding:10px!important}
  .wrap.scraper-admin-dashboard .admin-card{padding:12px!important;border-radius:10px!important;margin-bottom:10px!important}
  .wrap.scraper-admin-dashboard .form-table,
  .wrap.scraper-admin-dashboard .form-table tbody,
  .wrap.scraper-admin-dashboard .form-table tr,
  .wrap.scraper-admin-dashboard .form-table th,
  .wrap.scraper-admin-dashboard .form-table td{
    display:block!important;width:100%!important;max-width:100%!important;
  }
  .wrap.scraper-admin-dashboard .form-table th{padding:8px 0 2px!important}
  .wrap.scraper-admin-dashboard .form-table td{padding:2px 0 10px!important}
  .wrap.scraper-admin-dashboard input[type=text],
  .wrap.scraper-admin-dashboard input[type=password],
  .wrap.scraper-admin-dashboard input[type=number],
  .wrap.scraper-admin-dashboard select,
  .wrap.scraper-admin-dashboard textarea{
    width:100%!important;max-width:100%!important;font-size:16px!important; /* iOS zoom avoid */
    min-height:40px!important;
  }
  .wrap.scraper-admin-dashboard .wp-list-table{
    display:block!important;width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;
  }
  .scraper-support-desk{flex-direction:column!important;height:auto!important}
  .desk-threads-col{width:100%!important;height:260px!important;border-left:none!important;border-bottom:1px solid #e2e8f0!important}
  .desk-threads-col.mobile-hide{display:none!important}
  .desk-view-col{width:100%!important;height:400px!important}
  #btnDeskBackToList{display:inline-block!important}
  .scraper-save-bar{
    position:static!important;width:100%!important;flex-direction:column!important;
    gap:8px!important;text-align:center!important;padding:12px!important;
  }
  .scraper-save-btn{width:100%!important;display:block!important;padding:11px!important;font-size:0.9rem!important}
  /* کارت‌های عریض تب ویترین */
  .wrap.scraper-admin-dashboard div[style*="minmax(280px"]{grid-template-columns:1fr!important}
  #amphp-wc-shop-fallback-card button{flex:1 1 140px!important;min-width:0!important;height:42px!important;font-size:0.85rem!important}
}
@media screen and (max-width: 480px) {
  .scraper-tab-nav{grid-template-columns:1fr 1fr!important}
  .amphp-admin-hero .amphp-hero-badge{font-size:0.68rem!important}
}
</style>';
		}
	}



	/**
	 * v13.3.32: آیا درخواست فعلی صفحهٔ اصلی دامنه است؟ (/, front page، posts home)
	 * حتی اگر show_on_front=page و page_on_front برگهٔ دیگری باشد.
	 *
	 * @return bool
	 */
	public static function is_site_home_request() {
		if ( is_admin() ) {
			return false;
		}
		// پرچم‌های کوئری اصلی وردپرس (پس از parse_query)
		if ( function_exists( 'is_front_page' ) && is_front_page() ) {
			return true;
		}
		if ( function_exists( 'is_home' ) && is_home() ) {
			// فقط وقتی «نوشته‌ها» همان صفحهٔ نخست‌اند
			if ( (string) get_option( 'show_on_front', 'posts' ) === 'posts' ) {
				return true;
			}
		}
		// برگهٔ ثابتِ صفحهٔ نخست
		$fp = (int) get_option( 'page_on_front', 0 );
		if ( $fp > 0 && function_exists( 'is_page' ) && is_page( $fp ) ) {
			return true;
		}
		// اگر کوئری اصلی قبلاً اجرا شده و front نبود، دیگر URI را حدس نزن
		if ( did_action( 'wp' ) || did_action( 'template_redirect' ) ) {
			return false;
		}
		// قبل از main query: فقط مسیر ریشه بدون آرگومان محتوا
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		$path = (string) ( wp_parse_url( $uri, PHP_URL_PATH ) ?: '/' );
		$path = untrailingslashit( $path );
		$home_path = untrailingslashit( (string) ( wp_parse_url( home_url( '/' ), PHP_URL_PATH ) ?: '/' ) );
		if ( $path !== '' && $path !== '/' && $path !== $home_path ) {
			return false;
		}
		$skip = array( 'p', 'page_id', 'pagename', 'name', 'product', 'product_cat', 'post_type', 's', 'rest_route', 'wc-ajax', 'preview', 'amphp_sf' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		foreach ( $skip as $k ) {
			if ( isset( $_GET[ $k ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				return false;
			}
		}
		return true;
	}

	/** Site-name signals belong on the actual homepage, not shop or search pages. */
	public static function is_site_name_homepage() {
		return ! is_admin() && is_front_page() && ! is_paged() && ! is_search() && ! is_preview() && ! isset( $_GET['product'] );
	}

	public static function filter_home_document_title( $title ) {
		return self::is_site_name_homepage() ? 'فروشگاه صباشاپ' : $title;
	}

	/** Print server-rendered WebSite structured data for Google site-name discovery. */
	public static function print_home_site_name_schema() {
		if ( ! self::is_site_name_homepage() ) {
			return;
		}
		$home = home_url( '/' );
		$schema = array(
			'@context' => 'https://schema.org',
			'@type'    => 'WebSite',
			'@id'      => $home . '#website',
			'url'      => $home,
			'name'     => 'فروشگاه صباشاپ',
		);
		echo '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	public static function should_render_react_storefront( $settings = null ) {
		if ( null === $settings ) {
			$settings = self::get_settings();
		}
		if ( empty( $settings['enable_shop_takeover'] ) ) {
			return false;
		}
		if ( is_admin() || ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return false;
		}
		// /?amphp_shop=1 — لینک مستقیم ویترین React
		if ( isset( $_GET['amphp_shop'] ) && (string) $_GET['amphp_shop'] !== '' && (string) $_GET['amphp_shop'] !== '0' ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return true;
		}
		// v13.3.32: صفحهٔ اصلی دامنه (/, front page, blog home) → React bare
		if ( self::is_site_home_request() ) {
			return true;
		}
		if ( ( function_exists( 'is_shop' ) && is_shop() ) || ( function_exists( 'is_product_taxonomy' ) && is_product_taxonomy() ) ) {
			return true;
		}
		if ( ! empty( $settings['takeover_front_page'] ) && ( is_front_page() || is_home() ) ) {
			return true;
		}
		$fb_id = intval( $settings['native_fallback_page_id'] ?? get_option( 'scraper_native_fallback_page_id', 0 ) );
		/* اگر صفحهٔ اصلی همان برگهٔ پشتیبان باشد، React روی خانه اولویت دارد (v13.3.32) */
		$__home_react = self::is_site_home_request();
		if ( is_singular( 'page' ) ) {
			$pid = (int) get_queried_object_id();
			if ( $pid > 0 ) {
				// برگهٔ پشتیبان native = نه React — مگر همین برگه صفحهٔ خانه باشد
				if ( ! $__home_react && $fb_id > 0 && $pid === $fb_id ) {
					return false;
				}
				if ( ! $__home_react && get_post_meta( $pid, '_amphp_native_fallback_shop', true ) === '1' ) {
					return false;
				}
				$tpl_slug = get_page_template_slug( $pid );
				if ( ! $__home_react && ( $tpl_slug === 'templates/native-shop.php' || $tpl_slug === 'native-shop.php' ) ) {
					return false;
				}
				if ( get_post_meta( $pid, '_amphp_primary_react_shop', true ) === '1' ) {
					return true;
				}
				$shop_pid = intval( $settings['shop_page_id'] ?? get_option( 'scraper_shop_page_id', 0 ) );
				if ( $shop_pid > 0 && $pid === $shop_pid ) {
					return true;
				}
				if ( function_exists( 'wc_get_page_id' ) ) {
					$wc_shop = (int) wc_get_page_id( 'shop' );
					if ( $wc_shop > 0 && $pid === $wc_shop ) {
						return true;
					}
				}
				$post = get_post( $pid );
				if ( $post ) {
					if ( $post->post_name === 'amphp-shop' ) {
						return true;
					}
					if ( is_string( $post->post_content )
						&& ( has_shortcode( $post->post_content, 'modern_shop' ) || has_shortcode( $post->post_content, 'scraped_shop' ) ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	public static function maybe_takeover_shop_template( $template ) {
		$settings = self::get_settings();
		if ( empty( $settings['enable_shop_takeover'] ) ) {
			return $template;
		}
		if ( ! self::should_render_react_storefront( $settings ) ) {
			return $template;
		}
		// ویترین React bare — مگر قالب صریحاً native-wp
		$tpl = (string) ( $settings['store_template'] ?? 'digikala' );
		if ( $tpl === 'native-wp' || $tpl === 'native' ) {
			$path = self::get_native_shop_template_path();
			if ( is_readable( $path ) ) {
				return $path;
			}
			$fb = self::ensure_fallback_shop_page( false );
			if ( ! empty( $fb['url'] ) ) {
				wp_safe_redirect( $fb['url'], 302 );
				exit;
			}
		}
		self::render_standalone_shop_page();
		exit;
	}

	/**
	 * Enqueue front-end assets.
	 */

	/**
	 * Tag body so theme-kill CSS can target.
	 */
	public static function filter_storefront_body_class( $classes ) {
		if ( self::is_bare_storefront_request() ) {
			$classes[] = 'amphp-react-storefront';
			$classes[] = 'amphp-bare-mode';
		}
		return $classes;
	}

	/**
	 * Hide WP admin bar on customer storefront for cleaner paint (admins still get mini strip on bare page).
	 */
	public static function maybe_hide_admin_bar_on_storefront( $show ) {
		if ( ! empty( $GLOBALS['amphp_bare_storefront'] ) ) {
			return false;
		}
		return $show;
	}

	public static function enqueue_front_assets() {
		if ( is_admin() ) {
			return;
		}
		// Bare standalone page never reaches here (exits earlier). For shortcode-in-theme:
		$settings = self::get_settings();
		$load = ! empty( $settings['enable_shop_takeover'] ) || ! empty( $settings['enable_scraped_products'] );
		if ( ! $load ) {
			return;
		}
		// Dequeue theme/plugin bulk after they register.
		add_action( 'wp_print_styles', array( __CLASS__, 'strip_all_theme_assets' ), 100 );
		add_action( 'wp_print_scripts', array( __CLASS__, 'strip_all_theme_assets' ), 100 );
		add_action( 'wp_footer', array( __CLASS__, 'strip_all_theme_assets' ), 1 );
		self::enqueue_storefront_react_assets();
	}

	/**
	 * Render Standalone Modern Shop Page.
	 * Completely removes the WordPress theme's header and menu, replacing them with
	 * our dedicated custom header, navbar, mega categories dropdown, and hamburger drawer.
	 */
	public static function render_standalone_shop_page() {
		// Bare document: NO wp_head / wp_footer → zero theme CSS/JS.
		$GLOBALS['amphp_bare_storefront'] = true;
		$settings = self::get_settings();
		$title    = (string) ( $settings['shop_title'] ?? 'فروشگاه آنلاین' );
		$site     = get_bloginfo( 'name' );
		// Prefer PHP proxy URLs so shop works even when /asset/*.js is missing or blocked by host.
		$ver = self::storefront_assets_ver();
		$css_url  = add_query_arg( array( 'amphp_sf' => 'storefront.css', 'ver' => $ver ), home_url( '/' ) );
		$js_url   = add_query_arg( array( 'amphp_sf' => 'storefront.js', 'ver' => $ver ), home_url( '/' ) );
		// Fail only if neither disk files NOR embedded payload exist (v13.1.5+ embeds JS/CSS).
		$shop_html = self::render_shop_shortcode( true ); // skip asset tags; we print once below
		if ( ! self::has_storefront_assets() ) {
			/* v13.3.17: soft-fail → native fallback page if available */
			$fb = self::ensure_fallback_shop_page( false );
			if ( ! empty( $fb['url'] ) && empty( $GLOBALS['amphp_fallback_redirecting'] ) ) {
				$GLOBALS['amphp_fallback_redirecting'] = true;
				wp_safe_redirect( $fb['url'], 302 );
				exit;
			}
			$shop_html = '<div style="max-width:640px;margin:48px auto;padding:24px;background:#fef2f2;border:1px solid #fecaca;border-radius:16px;font-family:Tahoma,sans-serif;direction:rtl;text-align:right;line-height:1.8">'
				. '<div style="font-size:1.1rem;font-weight:900;color:#b91c1c;margin-bottom:8px">فایل‌های ویترین روی سرور پیدا نشد</div>'
				. '<p style="margin:0 0 10px;color:#7f1d1d;font-weight:700">agent.php را دوباره آپلود کنید یا پوشه <code>includes/storefront/</code> را کنار agent.php قرار دهید.</p>'
				. '<p style="margin:0;color:#64748b;font-size:.88rem">مسیر افزونه: <code style="direction:ltr;display:inline-block">' . esc_html( plugin_dir_path( __FILE__ ) ) . '</code></p>'
				. '</div>';
		}

		$adminbar  = '';
		if ( is_user_logged_in() && current_user_can( 'manage_options' ) ) {
			// Minimal admin bar only (no theme).
			if ( function_exists( 'wp_admin_bar_render' ) ) {
				ob_start();
				// Lightweight top strip instead of full admin-bar scripts.
				$admin_url = admin_url( 'admin.php?page=scraper-auto-shop' );
				echo '<div id="amphp-mini-admin" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#1d2327;color:#f0f0f1;font:12px/32px Tahoma,sans-serif;padding:0 12px;display:flex;justify-content:space-between;direction:rtl;">';
				echo '<a href="' . esc_url( $admin_url ) . '" style="color:#72aee6;text-decoration:none;font-weight:700;">⚙ مدیریت فروشگاه</a>';
				echo '<a href="' . esc_url( admin_url() ) . '" style="color:#f0f0f1;text-decoration:none;">پیشخوان وردپرس</a>';
				echo '</div>';
				echo '<style>html{--sf-adminbar:32px}body{padding-top:32px!important}</style>';
				$adminbar = ob_get_clean();
			}
		}
		header( 'Content-Type: text/html; charset=UTF-8' );
		header( 'X-AMPHP-Storefront: bare-v13.3.32' );
		// Avoid caching heavy theme shells.
		nocache_headers();
		?><!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="<?php echo esc_attr( $settings['accent_color'] ?? '#2563eb' ); ?>">
<meta name="robots" content="index,follow">
<title><?php echo esc_html( ! empty( $GLOBALS['amphp_torob_page_product']['title'] ) ? $GLOBALS['amphp_torob_page_product']['title'] . ' | ' . $title : ( self::is_site_name_homepage() ? 'فروشگاه صباشاپ' : $title . ( $site ? ' | ' . $site : '' ) ) ); ?></title>
<?php self::torob_print_product_schema( $GLOBALS['amphp_torob_page_product'] ?? null, $settings ); ?>
<?php if ( self::is_site_name_homepage() ) : ?>
<meta property="og:site_name" content="فروشگاه صباشاپ">
<?php self::print_home_site_name_schema(); ?>
<?php endif; ?>
<link rel="preconnect" href="<?php echo esc_url( admin_url() ); ?>">
<?php echo self::get_storefront_font_boot_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
<link rel="stylesheet" href="<?php echo esc_url( $css_url ); ?>" id="amphp-storefront-css">
<style id="amphp-bare-reset">
html,body{margin:0;padding:0;background:#f5f5f5;font-family:var(--app-font,Tahoma,system-ui,sans-serif)}
*{box-sizing:border-box}
img{max-width:100%;height:auto}
#wpadminbar,.wp-site-blocks,header.wp-block-template-part,footer.wp-block-template-part{display:none!important}
</style>
</head>
<body class="scraper-standalone-shop-takeover amphp-react-storefront amphp-bare">
<?php echo $adminbar; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
<div class="scraper-shop-fullscreen-wrap" id="amphp-bare-root">
<?php echo $shop_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
</div>
<script src="<?php echo esc_url( $js_url ); ?>" id="amphp-storefront-js"></script>
<script>
(function(){
  setTimeout(function(){
    var el = document.getElementById('amphp-storefront-root');
    if (!el || el.getAttribute('data-mounted') === '1') return;
    if (el.querySelector('.amphp-sf-bootwait')) {
      el.innerHTML = '<div style="padding:28px;text-align:center;font-family:Tahoma,sans-serif;color:#b91c1c;font-weight:800;line-height:1.7">فروشگاه بارگذاری نشد.<br><span style="font-weight:600;color:#64748b;font-size:.85rem">اسکریپت لود نشد. اگر تازه آپدیت کرده‌اید کش را پاک کنید.<br>URL: <?php echo esc_js( $js_url ); ?></span></div>';
    }
  }, 8000);
})();
</script>
</body>
</html><?php
		exit;
	}

	/**
	 * Shortcode [scraped_shop] / [modern_shop] HTML Renderer.
	 * 100% customer-facing, ultra-modern luxury e-commerce experience.
	 */
	public static function render_shop_shortcode( $atts = array(), $content = null, $tag = '' ) {
		// Allow internal bare-shell call: render_shop_shortcode( true )
		$bare_assets = false;
		if ( true === $atts || 1 === $atts || '1' === $atts ) {
			$bare_assets = true;
			$atts = array();
		} elseif ( is_array( $atts ) && ! empty( $atts['bare'] ) ) {
			$bare_assets = true;
		}

		$settings = self::get_settings();
		$products = self::get_all_scraped_products();
		$total_catalog = is_array( $products ) ? count( $products ) : 0;
		$GLOBALS['amphp_torob_page_product'] = null;
		if ( isset( $_GET['product'] ) && is_string( $_GET['product'] ) ) {
			$requested = sanitize_text_field( wp_unslash( $_GET['product'] ) );
			foreach ( (array) $products as $product ) { if ( $requested !== '' && ( $requested === (string) ( $product['stable_id'] ?? '' ) || $requested === (string) ( $product['id'] ?? '' ) ) ) { $GLOBALS['amphp_torob_page_product'] = $product; break; } }
		}

		/* v13.3.8: همهٔ محصولات کاتالوگ — بدون سقف ۱۲۰.
		   payload lean است (بدون گالری/توضیح بلند) تا TTFB سبک بماند. */
		$safe_products = array();
		foreach ( (array) $products as $p ) {
			if ( ! is_array( $p ) ) {
				continue;
			}
			$desc = wp_strip_all_tags( (string) ( $p['description'] ?? $p['short_desc'] ?? '' ) );
			if ( function_exists( 'mb_substr' ) ) {
				$desc = mb_substr( $desc, 0, 160 );
			} else {
				$desc = substr( $desc, 0, 160 );
			}
			$src = sanitize_key( (string) ( $p['source'] ?? '' ) );
			if ( ! in_array( $src, array( 'scraper', 'woocommerce' ), true ) ) {
				$src = ( strpos( (string) ( $p['id'] ?? '' ), 'wc_' ) === 0 ) ? 'woocommerce' : 'scraper';
			}
			$safe_products[] = array(
				'id'           => (string) ( $p['id'] ?? '' ),
				'stable_id'    => (string) ( $p['stable_id'] ?? '' ),
				'created_ts'   => max( 0, (int) ( $p['created_ts'] ?? 0 ) ),
				'title'        => (string) ( $p['title'] ?? '' ),
				'has_price'    => ! empty( $p['has_price'] ),
				'price'        => floatval( $p['price'] ?? 0 ),
				'price_formatted' => (string) ( $p['price_formatted'] ?? '' ),
				'old_price'    => floatval( $p['old_price'] ?? 0 ),
				'old_price_formatted' => (string) ( $p['old_price_formatted'] ?? '' ),
				'has_discount' => ! empty( $p['has_discount'] ),
				'discount_pct' => intval( $p['discount_pct'] ?? 0 ),
				'image'        => esc_url_raw( (string) ( $p['image'] ?? '' ) ),
				'category'     => (string) ( $p['category'] ?? 'عمومی' ),
				'description'  => $desc,
				'in_stock'     => isset( $p['in_stock'] ) ? (bool) $p['in_stock'] : true,
				'source'       => $src,
				'source_label' => (string) ( $p['source_label'] ?? ( $src === 'woocommerce' ? 'ووکامرس' : 'اسکرپر' ) ),
			);
		}

		$account_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : wp_login_url();
		$admin_url   = current_user_can( 'manage_options' ) ? admin_url( 'admin.php?page=scraper-auto-shop' ) : '';
		$checkout    = function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' );
		$gateways    = self::get_active_payment_gateways_list();

		/* v13.1.8: سفارش پرداخت‌شده از بازگشت درگاه */
		$paid_order_boot = null;
		if ( ! empty( $_GET['amphp_paid'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$po_id  = absint( $_GET['amphp_order'] ?? $_GET['order_id'] ?? 0 ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$po_key = sanitize_text_field( wp_unslash( $_GET['amphp_key'] ?? $_GET['key'] ?? '' ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$po_msg = (string) ( $settings['checkout_success_msg'] ?? 'سفارش شما با موفقیت تکمیل شد. از خریدتان سپاسگزاریم!' );
			$po_total = 0;
			$po_fmt = '';
			$po_pm = '';
			$po_pt = '';
			if ( $po_id > 0 && function_exists( 'wc_get_order' ) ) {
				$po = wc_get_order( $po_id );
				if ( $po && ( ! $po_key || $po->get_order_key() === $po_key ) ) {
					$po_total = (float) $po->get_total();
					$po_fmt   = self::format_price( $po_total, (string) ( $settings['currency_symbol'] ?? 'تومان' ) );
					$po_pm    = (string) $po->get_payment_method();
					$po_pt    = (string) $po->get_payment_method_title();
				}
			}
			$paid_order_boot = array(
				'order_id'        => $po_id,
				'order_key'       => $po_key,
				'total'           => $po_total,
				'total_formatted' => $po_fmt,
				'payment_method'  => $po_pm,
				'payment_title'   => $po_pt,
				'message'         => $po_msg,
				'paid'            => true,
			);
		}

		$boot = array(
			'settings' => array(
				'shop_title'              => (string) ( $settings['shop_title'] ?? 'فروشگاه آنلاین' ),
				'shop_subtitle'           => (string) ( $settings['shop_subtitle'] ?? '' ),
				'accent_color'            => (string) ( $settings['accent_color'] ?? '#2563eb' ),
				'currency_symbol'         => (string) ( $settings['currency_symbol'] ?? 'تومان' ),
				'contact_phone'           => (string) ( $settings['contact_phone'] ?? '' ),
				'support_hours'           => (string) ( $settings['support_hours'] ?? '' ),
				'top_bar_notice'          => (string) ( $settings['top_bar_notice'] ?? '' ),
				'show_top_bar'            => ! empty( $settings['show_top_bar'] ),
				'show_features_banner'    => ! empty( $settings['show_features_banner'] ),
				'show_animated_stats'     => ! empty( $settings['show_animated_stats'] ),
				'show_special_badge'      => ! empty( $settings['show_special_badge'] ),
				'sticky_header'           => ! empty( $settings['sticky_header'] ),
				'default_column_layout'   => (string) ( $settings['default_column_layout'] ?? '1' ),
				'products_per_page'       => intval( $settings['products_per_page'] ?? 20 ),
				'store_template'          => (string) ( $settings['store_template'] ?? 'digikala' ),
				'store_palette'           => (string) ( $settings['store_palette'] ?? 'digikala-red' ),
				'enable_custom_checkout'  => ! empty( $settings['enable_custom_checkout'] ),
				'checkout_title'          => (string) ( $settings['checkout_title'] ?? 'تسویه حساب امن' ),
				'checkout_note'           => (string) ( $settings['checkout_note'] ?? '' ),
				'checkout_require_login'  => ! empty( $settings['checkout_require_login'] ),
				'checkout_field_name'     => ! isset( $settings['checkout_field_name'] ) || ! empty( $settings['checkout_field_name'] ),
				'checkout_field_name_req' => ! empty( $settings['checkout_field_name_req'] ),
				'checkout_field_phone'    => ! isset( $settings['checkout_field_phone'] ) || ! empty( $settings['checkout_field_phone'] ),
				'checkout_field_phone_req'=> ! empty( $settings['checkout_field_phone_req'] ),
				'checkout_field_email'    => ! empty( $settings['checkout_field_email'] ),
				'checkout_field_email_req'=> ! empty( $settings['checkout_field_email_req'] ),
				'checkout_field_province' => ! isset( $settings['checkout_field_province'] ) || ! empty( $settings['checkout_field_province'] ),
				'checkout_field_province_req' => ! empty( $settings['checkout_field_province_req'] ),
				'checkout_field_city'     => ! isset( $settings['checkout_field_city'] ) || ! empty( $settings['checkout_field_city'] ),
				'checkout_field_city_req' => ! empty( $settings['checkout_field_city_req'] ),
				'checkout_field_address'  => ! isset( $settings['checkout_field_address'] ) || ! empty( $settings['checkout_field_address'] ),
				'checkout_field_address_req' => ! empty( $settings['checkout_field_address_req'] ),
				'checkout_field_postal'   => ! empty( $settings['checkout_field_postal'] ),
				'checkout_field_postal_req' => ! empty( $settings['checkout_field_postal_req'] ),
				'checkout_field_notes'    => ! empty( $settings['checkout_field_notes'] ),
				'checkout_field_notes_req'=> ! empty( $settings['checkout_field_notes_req'] ),
				'checkout_show_gateways'  => ! isset( $settings['checkout_show_gateways'] ) || ! empty( $settings['checkout_show_gateways'] ),
				'checkout_cod_label'      => (string) ( $settings['checkout_cod_label'] ?? 'پرداخت در محل (COD)' ),
				'checkout_success_msg'    => (string) ( $settings['checkout_success_msg'] ?? '' ),
				'checkout_show_shipping'  => ! isset( $settings['checkout_show_shipping'] ) || ! empty( $settings['checkout_show_shipping'] ),
				'checkout_show_map'       => ! isset( $settings['checkout_show_map'] ) || ! empty( $settings['checkout_show_map'] ),
				'neshan_api_key_set'      => ! empty( $settings['neshan_api_key'] ),
				'shipping_origin_city'    => (string) ( $settings['shipping_origin_city'] ?? 'تهران' ),
				'shipping_origin_lat'     => (string) ( $settings['shipping_origin_lat'] ?? '35.6892' ),
				'shipping_origin_lng'     => (string) ( $settings['shipping_origin_lng'] ?? '51.3890' ),
				'post_shipping_enabled'   => ! isset( $settings['post_shipping_enabled'] ) || ! empty( $settings['post_shipping_enabled'] ),
				'chapar_shipping_enabled' => ! isset( $settings['chapar_shipping_enabled'] ) || ! empty( $settings['chapar_shipping_enabled'] ),
				'tipax_shipping_enabled'  => ! isset( $settings['tipax_shipping_enabled'] ) || ! empty( $settings['tipax_shipping_enabled'] ),
				'enable_ai_product_images' => ! isset( $settings['enable_ai_product_images'] ) || ! empty( $settings['enable_ai_product_images'] ),
				'enable_support_chat'     => ! empty( $settings['enable_support_chat'] ),
				'chat_theme'              => (string) ( $settings['chat_theme'] ?? 'royal-blue' ),
				'chat_button_style'       => (string) ( $settings['chat_button_style'] ?? 'pill-label' ),
				'chat_button_position'    => (string) ( $settings['chat_button_position'] ?? 'left' ),
				'chat_window_title'       => (string) ( $settings['chat_window_title'] ?? 'پشتیبانی آنلاین فروشگاه' ),
				'chat_welcome_message'    => (string) ( $settings['chat_welcome_message'] ?? '' ),
				'free_shipping_threshold' => floatval( $settings['free_shipping_threshold'] ?? 400000 ),
				'catalog_source'         => (string) self::resolve_catalog_source( $settings ),
				'catalog_merge_prefer'   => (string) ( $settings['catalog_merge_prefer'] ?? 'scraper' ),
				'shop_title_font'         => (string) ( $settings['shop_title_font'] ?? 'vazirmatn' ),
				'app_font'                => (string) ( $settings['shop_title_font'] ?? 'vazirmatn' ),
				'shop_title_font_size'    => (string) ( $settings['shop_title_font_size'] ?? 'normal' ),
				'shop_title_font_weight'  => (string) ( $settings['shop_title_font_weight'] ?? '900' ),
			),
			'products' => $safe_products,
			'urls'     => array(
				'account'  => esc_url_raw( $account_url ),
				'admin'    => esc_url_raw( $admin_url ),
				'home'     => esc_url_raw( home_url( '/' ) ),
				'checkout' => esc_url_raw( $checkout ),
				'fallback_shop' => esc_url_raw( ( $settings['native_fallback_page_id'] ?? 0 ) ? get_permalink( intval( $settings['native_fallback_page_id'] ) ) : '' ),
				'shop'     => esc_url_raw( function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' ) ),
			),
			'ajax'     => array(
				'ajaxUrl'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
				'cartNonce'  => wp_create_nonce( 'scraper_cart_nonce' ),
				'chatNonce'  => wp_create_nonce( 'scraper_support_chat_nonce' ),
				'checkoutUrl'=> esc_url_raw( $checkout ),
			),
			'gateways' => $gateways,
			'paid_order' => $paid_order_boot,
			'meta'     => array(
				'version'     => '13.3.32',
				'asset_ver'   => self::storefront_assets_ver(),
				'engine'      => 'react',
				'count'       => count( $safe_products ),
				'total_count' => isset( $total_catalog ) ? (int) $total_catalog : count( $safe_products ),
				'catalog_source' => (string) self::resolve_catalog_source( $settings ),
				'scraper_count'  => count( array_filter( $safe_products, function ( $x ) { return ( $x['source'] ?? '' ) === 'scraper'; } ) ),
				'woo_count'      => count( array_filter( $safe_products, function ( $x ) { return ( $x['source'] ?? '' ) === 'woocommerce'; } ) ),
				'is_admin'    => current_user_can( 'manage_options' ),
			),
		);

		$css_url = self::storefront_asset_url( 'storefront.css' );
		$js_url  = self::storefront_asset_url( 'storefront.js' );
		$ver = self::storefront_assets_ver();

		// Mark assets as printed so wp_enqueue does not double-load the bundle.
		$GLOBALS['amphp_storefront_assets_printed'] = true;

		$boot_json = wp_json_encode( $boot, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_UNESCAPED_SLASHES );
		if ( false === $boot_json ) {
			$boot_json = '{"settings":{},"products":[],"urls":{},"ajax":{},"meta":{"error":"json"}}';
		}

		ob_start();
		?>
		<!-- ویترین فروشگاه v13.3.32 -->
		<?php echo self::get_storefront_font_boot_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
		<?php if ( empty( $bare_assets ) ) : ?>
		<link rel="stylesheet" href="<?php echo esc_url( $css_url ); ?>" id="amphp-storefront-css" />
		<?php endif; ?>
		<div id="amphp-storefront-root" class="amphp-storefront-root" data-engine="react" dir="rtl">
			<div class="amphp-sf-bootwait" style="padding:32px 16px;text-align:center;font-family:Tahoma,sans-serif;color:#64748b;font-size:.95rem;font-weight:700;">در حال بارگذاری…</div>
		</div>
		<script id="amphp-storefront-boot">
		window.AMPHP_STOREFRONT = <?php echo $boot_json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
		</script>
		<?php echo self::storefront_refresh_script(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
		<?php if ( empty( $bare_assets ) ) : ?>
		<script src="<?php echo esc_url( $js_url ); ?>" id="amphp-storefront-js"></script>
		<script>
		(function(){
			// Fail-soft if bundle 404 / blocked
			setTimeout(function(){
				var el = document.getElementById('amphp-storefront-root');
				if (!el || el.getAttribute('data-mounted') === '1') return;
				if (el.querySelector('.amphp-sf-bootwait')) {
					el.innerHTML = '<div style="padding:28px;text-align:center;font-family:Tahoma,sans-serif;color:#b91c1c;font-weight:800;line-height:1.7">فروشگاه بارگذاری نشد.<br><span style="font-weight:600;color:#64748b;font-size:.85rem">مسیر اسکریپت را بررسی کنید یا کش را پاک کنید.</span></div>';
				}
			}, 8000);
		})();
		</script>
		<?php endif; ?>
		<?php
		return ob_get_clean();
	}

	/**
	 * Candidate filesystem paths for a storefront build file.
	 *
	 * @param string $file basename e.g. storefront.js
	 * @return string[]
	 */

	/**
	 * Load scraper4.php font boot snippet (APP_FONTS + --app-font) if available.
	 * Falls back to a self-contained registry matching scraper4 keys.
	 *
	 * @return string HTML (style+script) safe for <head>
	 */
	public static function get_storefront_font_boot_html() {
		static $html = null;
		if ( null !== $html ) {
			return $html;
		}
		$scraper = plugin_dir_path( __FILE__ ) . 'scraper4.php';
		if ( is_readable( $scraper ) ) {
			if ( ! defined( 'SCRAPER4_NO_RENDER' ) ) {
				define( 'SCRAPER4_NO_RENDER', true );
			}
			$ob = ob_get_level();
			@ob_start();
			try {
				require_once $scraper;
			} catch ( \Throwable $e ) {
				// ignore
			}
			while ( ob_get_level() > $ob ) {
				@ob_end_clean();
			}
			if ( function_exists( 'app_font_boot' ) ) {
				$html = (string) app_font_boot();
				return $html;
			}
		}
		// Inline fallback (same keys as scraper4 registry).
		$fb = 'Tahoma,system-ui,sans-serif';
		$reg = array(
			'system'    => array( 'label' => 'سیستم', 'stack' => $fb, 'css' => '', 'face' => '' ),
			'vazirmatn' => array( 'label' => 'وزیرمتن', 'stack' => 'Vazirmatn,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css', 'face' => '' ),
			'vazir'     => array( 'label' => 'وزیر', 'stack' => 'Vazir,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@30.1.0/dist/font-face.css', 'face' => '' ),
			'sahel'     => array( 'label' => 'ساحل', 'stack' => 'Sahel,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@3.4.0/dist/font-face.css', 'face' => '' ),
			'samim'     => array( 'label' => 'صمیم', 'stack' => 'Samim,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@4.0.5/dist/font-face.css', 'face' => '' ),
			'shabnam'   => array( 'label' => 'شبنم', 'stack' => 'Shabnam,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/shabnam-font@5.0.1/dist/font-face.css', 'face' => '' ),
			'parastoo'  => array( 'label' => 'پرستو', 'stack' => 'Parastoo,' . $fb, 'css' => 'https://cdn.jsdelivr.net/gh/rastikerdar/parastoo-font@2.0.0/dist/font-face.css', 'face' => '' ),
			'iranyekan' => array( 'label' => 'ایران‌یکان', 'stack' => 'IRANYekan,' . $fb, 'css' => '', 'face' => '' ),
			'yekan'     => array( 'label' => 'یکان', 'stack' => 'Yekan,' . $fb, 'css' => '', 'face' => '' ),
			'estedad'   => array( 'label' => 'استعداد', 'stack' => 'Estedad,' . $fb, 'css' => '', 'face' => '' ),
		);
		/* v13.3.8: فونت سرور از settings/connections — برای همهٔ بازدیدکننده‌ها */
		$server_key = 'vazirmatn';
		try {
			$st = self::get_settings();
			$cand = trim( (string) ( $st['shop_title_font'] ?? $st['app_font'] ?? '' ) );
			if ( $cand !== '' && isset( $reg[ $cand ] ) ) {
				$server_key = $cand;
			} elseif ( $cand !== '' && isset( $reg['vazirmatn'] ) ) {
				/* alias map */
				$map = array( 'dana' => 'vazirmatn', 'yekanbakh' => 'yekan', 'iransans' => 'iranyekan', 'morabba' => 'sahel', 'custom' => 'vazirmatn' );
				$server_key = isset( $map[ $cand ] ) ? $map[ $cand ] : 'vazirmatn';
			}
		} catch ( \Throwable $e ) {
			$server_key = 'vazirmatn';
		}
		if ( ! isset( $reg[ $server_key ] ) ) {
			$server_key = 'vazirmatn';
		}
		$server_stack = $reg[ $server_key ]['stack'];
		$server_css   = $reg[ $server_key ]['css'];
		$json = wp_json_encode( $reg, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		$html  = '<style id="appFontVars">:root{--app-font:' . esc_attr( $server_stack ) . '}</style>';
		if ( $server_css !== '' ) {
			$html .= '<link id="appFontLink_' . esc_attr( $server_key ) . '" rel="stylesheet" href="' . esc_url( $server_css ) . '">';
		}
		$html .= '<script>(function(){var F=' . $json . ';var KEY="scraper_font",FB=' . wp_json_encode( $fb ) . ',SERVER_FONT=' . wp_json_encode( $server_key ) . ';window.APP_FONTS=F;window.APP_FONT_KEY=KEY;window.APP_FONT_FALLBACK=FB;window.APP_FONT_SERVER=SERVER_FONT;function head(){return document.head||document.documentElement;}function readFont(){if(SERVER_FONT&&F[SERVER_FONT])return SERVER_FONT;try{var v=localStorage.getItem(KEY);return (v&&F[v])?v:"vazirmatn";}catch(e){return"vazirmatn";}}function applyFont(k,save){if(!F[k])k="vazirmatn";var f=F[k];if(save){try{localStorage.setItem(KEY,k);}catch(e){}}try{document.documentElement.style.setProperty("--app-font",f.stack);if(document.body)document.body.style.fontFamily=f.stack;}catch(e){}if(f.css){var lid="appFontLink_"+k;if(!document.getElementById(lid)){var l=document.createElement("link");l.id=lid;l.rel="stylesheet";l.href=f.css;head().appendChild(l);}}if(f.face){var sid="appFontFace_"+k;if(!document.getElementById(sid)){var s=document.createElement("style");s.id=sid;s.appendChild(document.createTextNode(f.face));head().appendChild(s);}}window.APP_FONT_CURRENT=k;return k;}window.appFontApply=applyFont;window.appFontCurrent=readFont;applyFont(readFont(),false);})();</script>';
		return $html;
	}

	public static function storefront_asset_paths( $file ) {
		$file = basename( (string) $file );
		$base = plugin_dir_path( __FILE__ );
		return array_values( array_filter( array(
			$base . 'asset/js/storefront/' . $file,
			$base . 'includes/storefront/' . $file,
			$base . 'storefront/' . $file,
			dirname( $base ) . '/asset/js/storefront/' . $file,
		) ) );
	}

	/**
	 * Absolute path to first existing storefront asset on disk, or empty string.
	 *
	 * @param string $file
	 * @return string
	 */
	public static function storefront_asset_path( $file ) {
		foreach ( self::storefront_asset_paths( $file ) as $p ) {
			if ( $p && is_readable( $p ) ) {
				return $p;
			}
		}
		return '';
	}

	/**
	 * Gzip+base64 payload baked into agent.php so a single-file upload still boots the shop.
	 * Disk files (asset/ or includes/storefront/) still take priority when present.
	 *
	 * @return array<string,array{mime:string,gz:string}>
	 */
	
	/**
	 * Cache-busting version for storefront assets (content hash).
	 *
	 * @return string
	 */
	public static function storefront_assets_ver() {
		static $ver = null;
		if ( null !== $ver ) {
			return $ver;
		}
		$parts = array( '13.3.32' );
		$pack = null;
		foreach ( array( 'storefront.js', 'storefront.css' ) as $file ) {
			$path = self::storefront_asset_path( $file );
			if ( $path && is_readable( $path ) ) {
				$parts[] = substr( md5_file( $path ), 0, 10 );
			} else {
				if ( null === $pack ) { $pack = self::get_embedded_storefront_assets(); }
				$gz = (string) ( $pack[ $file ]['gz'] ?? '' );
				$parts[] = $gz !== '' ? substr( md5( $gz ), 0, 10 ) : 'embed';
			}
		}
		$ver = implode( '.', $parts );
		return $ver;
	}

public static function get_embedded_storefront_assets() {
		static $cache = null;
		if ( null !== $cache ) {
			return $cache;
		}
		// Prefer external pack next to plugin (always rebuildable).
		$pack = plugin_dir_path( __FILE__ ) . 'includes/storefront/embedded-assets.php';
		if ( is_readable( $pack ) ) {
			$loaded = include $pack;
			if ( is_array( $loaded ) && ! empty( $loaded['storefront.js']['gz'] ) ) {
				$cache = $loaded;
				return $cache;
			}
		}
		// Inline fallback baked at build time (v13.3.32) — single-file deploy.
		$cache = array(
			'storefront.js'  => array(
				'mime' => 'application/javascript; charset=UTF-8',
				'gz'   => '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',
			),
			'storefront.css' => array(
				'mime' => 'text/css; charset=UTF-8',
				'gz'   => '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',
			),
		);
		return $cache;
	}

	/**
	 * Decode one embedded asset body, or empty string.
	 *
	 * @param string $file
	 * @return string
	 */
	public static function get_embedded_storefront_body( $file ) {
		$file = basename( (string) $file );
		$all  = self::get_embedded_storefront_assets();
		if ( empty( $all[ $file ]['gz'] ) ) {
			return '';
		}
		$raw = base64_decode( (string) $all[ $file ]['gz'], true );
		if ( false === $raw ) {
			return '';
		}
		if ( function_exists( 'gzuncompress' ) ) {
			$out = @gzuncompress( $raw );
			if ( false !== $out && '' !== $out ) {
				return $out;
			}
		}
		if ( function_exists( 'gzdecode' ) ) {
			$out = @gzdecode( $raw );
			if ( false !== $out && '' !== $out ) {
				return $out;
			}
		}
		return '';
	}

	/**
	 * True when storefront JS can be served (disk or embedded).
	 *
	 * @return bool
	 */
	public static function has_storefront_assets() {
		if ( self::storefront_asset_path( 'storefront.js' ) ) {
			return true;
		}
		$body = self::get_embedded_storefront_body( 'storefront.js' );
		return ( '' !== $body && strlen( $body ) > 1000 );
	}

	/** Opaque release token changes after auto-updates and ordinary file deployments. */
	public static function storefront_release_token() {
		$config = self::github_update_config();
		$parts = array( (string) $config['installed_sha'], self::storefront_assets_ver() );
		foreach ( array( __FILE__, self::storefront_asset_path( 'storefront.js' ), self::storefront_asset_path( 'storefront.css' ), plugin_dir_path( __FILE__ ) . 'includes/storefront/embedded-assets.php' ) as $file ) {
			if ( $file && is_file( $file ) ) {
				clearstatcache( true, $file );
				$parts[] = (string) filemtime( $file ) . ':' . (string) filesize( $file );
			}
		}
		return substr( hash( 'sha256', implode( '|', $parts ) ), 0, 24 );
	}

	/** Read-only, no-cache version endpoint; does not expose configuration. */
	public static function maybe_serve_storefront_version() {
		if ( ! isset( $_GET['amphp_update_version'] ) || (string) $_GET['amphp_update_version'] !== '1' ) { return; } // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		nocache_headers();
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		wp_send_json( array( 'version' => self::storefront_release_token() ) );
	}

	/** Refresh an open storefront after a release, but never interrupt checkout or editing. */
	public static function storefront_refresh_script() {
		$initial = wp_json_encode( self::storefront_release_token() );
		$endpoint = wp_json_encode( add_query_arg( 'amphp_update_version', '1', home_url( '/' ) ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
		return '<script id="amphp-release-watch">(function(){'
			. 'if(window.__amphpReleaseWatch)return;window.__amphpReleaseWatch=true;'
			. 'var initial=' . $initial . ',endpoint=' . $endpoint . ',lastAction=Date.now(),busy=false;'
			. "['pointerdown','keydown','input','touchstart'].forEach(function(e){document.addEventListener(e,function(){lastAction=Date.now()},{passive:true})});"
			. 'function safe(){var a=document.activeElement;return !document.hidden && Date.now()-lastAction>20000 && !document.querySelector(".sf-app.is-checkout,.sf-app.is-pdp,.sf-overlay,.sf-chat-win,.sf-vendor-modal") && !(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) && !(new URL(location.href)).searchParams.has("amphp_paid");}'
			. 'function check(){if(busy||document.hidden)return;busy=true;var u=new URL(endpoint,location.href);u.searchParams.set("_",Date.now());fetch(u.toString(),{cache:"no-store",credentials:"same-origin"}).then(function(r){if(!r.ok)throw Error("version");return r.json()}).then(function(data){var v=data&&data.version;if(!/^[a-f0-9]{24}$/.test(v||"")||v===initial||!safe())return;var target=new URL(location.href);if(target.searchParams.get("amphp_refresh")===v)return;target.searchParams.set("amphp_refresh",v);location.replace(target.toString())}).catch(function(){}).finally(function(){busy=false})}'
			. 'setInterval(check,60000);document.addEventListener("visibilitychange",function(){if(!document.hidden)check()});'
			. '})();</script>';
	}

	/**
	 * Public URL for storefront CSS/JS via PHP proxy (works with agent.php-only deploy).
	 *
	 * @param string $file
	 * @return string
	 */
	public static function storefront_asset_url( $file ) {
		$file = basename( (string) $file );
		$ver = self::storefront_assets_ver();
		return add_query_arg(
			array(
				'amphp_sf' => $file,
				'ver'      => $ver,
			),
			home_url( '/' )
		);
	}

	/**
	 * Stream storefront.js / storefront.css with correct MIME (disk first, then embedded).
	 */
	public static function maybe_serve_storefront_asset() {
		if ( empty( $_GET['amphp_sf'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$file = basename( sanitize_text_field( wp_unslash( $_GET['amphp_sf'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! in_array( $file, array( 'storefront.js', 'storefront.css' ), true ) ) {
			status_header( 404 );
			header( 'Content-Type: text/plain; charset=UTF-8' );
			echo 'AMPHP storefront: invalid asset';
			exit;
		}

		$mime = ( 'storefront.css' === $file ) ? 'text/css; charset=UTF-8' : 'application/javascript; charset=UTF-8';
		$path = self::storefront_asset_path( $file );
		$body = '';
		$src  = '';

		if ( $path ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			$body = (string) file_get_contents( $path );
			$src  = 'disk:' . $path;
		}
		if ( '' === $body ) {
			$body = self::get_embedded_storefront_body( $file );
			$src  = $body !== '' ? 'embedded' : '';
		}

		if ( '' === $body ) {
			status_header( 404 );
			header( 'Content-Type: text/plain; charset=UTF-8' );
			header( 'X-AMPHP-Asset: missing' );
			echo 'AMPHP storefront asset missing: ' . $file . "\n";
			echo "Upload agent.php v13.1.5+ (embedded assets) or includes/storefront/ files.\n";
			foreach ( self::storefront_asset_paths( $file ) as $p ) {
				echo ' - ' . $p . "\n";
			}
			exit;
		}

		status_header( 200 );
		header( 'Content-Type: ' . $mime );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-AMPHP-Asset: ' . $src );
		header( 'Cache-Control: no-cache, no-store, must-revalidate, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'Expires: ' . gmdate( 'D, d M Y H:i:s', time() + 86400 ) . ' GMT' );
		echo $body;
		exit;
	}

	/**
	 * Enqueue built React storefront assets (CSS/JS).
	 */
	
	/**
	 * v13.3.32: Boot سبک برای چت پشتیبانی هوشمند (صفحه بومی / پشتیبان).
	 *
	 * @return array
	 */
	public static function get_support_chat_boot() {
		$settings = self::get_settings();
		$ajax_url = admin_url( 'admin-ajax.php' );
		return array(
			'mode'      => 'chat-only',
			'chat_only' => true,
			'settings'  => array(
				'enable_support_chat'  => ! empty( $settings['enable_support_chat'] ),
				'chat_window_title'    => (string) ( $settings['chat_window_title'] ?? 'پشتیبانی آنلاین' ),
				'chat_welcome_message' => (string) ( $settings['chat_welcome_message'] ?? '' ),
				'chat_button_position' => (string) ( $settings['chat_button_position'] ?? 'left' ),
				'chat_field_name_enable'     => ! empty( $settings['chat_field_name_enable'] ),
				'chat_field_name_required'   => ! empty( $settings['chat_field_name_required'] ),
				'chat_field_phone_enable'    => ! empty( $settings['chat_field_phone_enable'] ),
				'chat_field_phone_required'  => ! empty( $settings['chat_field_phone_required'] ),
				'chat_field_email_enable'    => ! empty( $settings['chat_field_email_enable'] ),
				'chat_field_email_required'  => ! empty( $settings['chat_field_email_required'] ),
				'shop_title'           => (string) ( $settings['shop_title'] ?? '' ),
				'contact_phone'        => (string) ( $settings['contact_phone'] ?? '' ),
				'accent_color'         => (string) ( $settings['accent_color'] ?? '#2563eb' ),
				'ai_support_name'      => (string) ( $settings['ai_support_name'] ?? 'پشتیبان هوشمند' ),
			),
			'ajax'      => array(
				'ajaxUrl'   => $ajax_url,
				'url'       => $ajax_url,
				'chatNonce' => wp_create_nonce( 'scraper_support_chat_nonce' ),
				'nonce'     => wp_create_nonce( 'scraper_support_chat_nonce' ),
			),
			'meta'      => array(
				'version'   => '13.3.32',
				'asset_ver' => self::storefront_assets_ver(),
				'mode'      => 'chat-only',
			),
			'urls'      => array(
				'home' => home_url( '/' ),
			),
			'products'  => array(),
		);
	}

	/**
	 * v13.3.32: چاپ ویجت چت پشتیبانی هوشمند روی قالب بومی / هر صفحهٔ غیر React.
	 * فقط FAB + پنجرهٔ چت (بدون کل ویترین).
	 */
	public static function print_native_support_chat_widget() {
		if ( ! empty( $GLOBALS['amphp_bare_storefront'] ) ) {
			return; // bare React already has SupportChat
		}
		if ( ! empty( $GLOBALS['amphp_native_chat_printed'] ) ) {
			return;
		}
		$settings = self::get_settings();
		if ( empty( $settings['enable_support_chat'] ) ) {
			return;
		}
		// فقط روی برگهٔ native / پشتیبان / فروشگاه بومی — یا وقتی صریحاً خواسته شده
		$force = ! empty( $GLOBALS['amphp_force_native_chat'] );
		if ( ! $force ) {
			$is_native = false;
			if ( is_singular( 'page' ) ) {
				$pid = get_queried_object_id();
				$tpl = get_page_template_slug( $pid );
				if ( $tpl === 'templates/native-shop.php' || $tpl === 'native-shop.php' ) {
					$is_native = true;
				}
				if ( get_post_meta( $pid, '_amphp_native_fallback_shop', true ) === '1' ) {
					$is_native = true;
				}
			}
			if ( ! $is_native ) {
				return;
			}
		}
		if ( ! self::has_storefront_assets() ) {
			return;
		}
		$GLOBALS['amphp_native_chat_printed'] = true;
		$boot = self::get_support_chat_boot();
		$boot_json = wp_json_encode( $boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( ! $boot_json ) {
			$boot_json = '{}';
		}
		$ver = self::storefront_assets_ver();
		$css_url = add_query_arg( array( 'amphp_sf' => 'storefront.css', 'ver' => $ver ), home_url( '/' ) );
		$js_url  = add_query_arg( array( 'amphp_sf' => 'storefront.js', 'ver' => $ver ), home_url( '/' ) );
		// Minimal CSS isolation so theme chrome stays; chat FAB is fixed
		echo "\n<!-- AMPHP support chat (native) v13.3.32 -->\n";
		echo '<link rel="stylesheet" href="' . esc_url( $css_url ) . '" id="amphp-storefront-css-chat" />' . "\n";
		echo '<div id="amphp-support-chat-root" class="amphp-support-chat-root" data-engine="react-chat" dir="rtl" style="position:relative;z-index:99999;"></div>' . "\n";
		echo '<script id="amphp-storefront-boot">window.AMPHP_STOREFRONT = ' . $boot_json . ';</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '<script src="' . esc_url( $js_url ) . '" id="amphp-storefront-js-chat" defer></script>' . "\n";
	}

	/**
	 * v13.3.32: wp_footer hook — چت روی قالب بومی.
	 */
	public static function maybe_print_native_support_chat() {
		self::print_native_support_chat_widget();
	}

	public static function enqueue_storefront_react_assets() {
		if ( ! empty( $GLOBALS['amphp_storefront_assets_printed'] ) ) {
			return;
		}
		if ( wp_style_is( 'amphp-storefront', 'enqueued' ) || wp_script_is( 'amphp-storefront', 'enqueued' ) ) {
			return;
		}
		$css = self::storefront_asset_url( 'storefront.css' );
		$js  = self::storefront_asset_url( 'storefront.js' );
		$ver = self::storefront_assets_ver();
		wp_register_style( 'amphp-storefront', $css, array(), $ver );
		wp_enqueue_style( 'amphp-storefront' );
		wp_register_script( 'amphp-storefront', $js, array(), $ver, true );
		wp_enqueue_script( 'amphp-storefront' );
	}

	/**
	 * Admin settings page HTML.
	 */
		public static function render_admin_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$updated = false;
		if ( isset( $_POST['scraper_shop_save'] ) && check_admin_referer( 'scraper_shop_settings_action', 'scraper_shop_settings_nonce' ) ) {
			$__post_cs = sanitize_key( $_POST['catalog_source'] ?? '' );
			if ( ! in_array( $__post_cs, array( 'scraper', 'woocommerce', 'merge' ), true ) ) {
				$__post_cs = ! empty( $_POST['enable_scraped_products'] ) ? 'scraper' : 'woocommerce';
			}
			$__post_mp = sanitize_key( $_POST['catalog_merge_prefer'] ?? 'scraper' );
			if ( ! in_array( $__post_mp, array( 'scraper', 'woocommerce', 'keep_both' ), true ) ) {
				$__post_mp = 'scraper';
			}
			$new_settings = array(
				// Tab 1: Storefront & Appearance
				'enable_shop_takeover'        => ! empty( $_POST['enable_shop_takeover'] ),
				'catalog_source'              => $__post_cs,
				'catalog_merge_prefer'        => $__post_mp,
				'enable_scraped_products'     => ( 'woocommerce' !== $__post_cs ),
				'takeover_front_page'         => ! empty( $_POST['takeover_front_page'] ) || ! empty( $_POST['enable_shop_takeover'] ),
				'enable_native_wp_template'   => ! empty( $_POST['enable_native_wp_template'] ),
				'native_fallback_page_id'     => intval( $_POST['native_fallback_page_id'] ?? 0 ),
				'enable_404_shop_redirect'    => ! empty( $_POST['enable_404_shop_redirect'] ),
				'set_wc_shop_to_fallback'     => ( isset( $_POST['set_wc_shop_to_fallback'] ) && (string) $_POST['set_wc_shop_to_fallback'] === '1' ),
				'auto_create_fallback_page'   => ! empty( $_POST['auto_create_fallback_page'] ),
				'replace_site_header'         => ! empty( $_POST['replace_site_header'] ),
				'show_top_bar'                => ! empty( $_POST['show_top_bar'] ),
				'top_bar_notice'              => sanitize_text_field( $_POST['top_bar_notice'] ?? '' ),
				'contact_phone'               => sanitize_text_field( $_POST['contact_phone'] ?? '' ),
				'support_hours'               => sanitize_text_field( $_POST['support_hours'] ?? '' ),
				'shop_title'                  => sanitize_text_field( $_POST['shop_title'] ?? '' ),
				'shop_title_font'             => sanitize_text_field( $_POST['shop_title_font'] ?? 'vazirmatn' ),
				'shop_title_custom_font'      => sanitize_text_field( $_POST['shop_title_custom_font'] ?? '' ),
				'shop_title_font_size'        => sanitize_text_field( $_POST['shop_title_font_size'] ?? 'normal' ),
				'shop_title_font_weight'      => sanitize_text_field( $_POST['shop_title_font_weight'] ?? '900' ),
				'sticky_header'               => ! empty( $_POST['sticky_header'] ),
				'notif_event_site_visit'      => ! empty( $_POST['notif_event_site_visit'] ),
				'notif_event_product_view'    => ! empty( $_POST['notif_event_product_view'] ),
				'notif_event_add_to_cart'     => ! empty( $_POST['notif_event_add_to_cart'] ),
				'notif_event_checkout_step'   => ! empty( $_POST['notif_event_checkout_step'] ),
				'notif_event_order_placed'    => ! empty( $_POST['notif_event_order_placed'] ),
				'analytics_source'            => in_array( $_POST['analytics_source'] ?? '', array( 'internal', 'wordpress', 'hybrid' ), true ) ? $_POST['analytics_source'] : 'hybrid',
				'hide_admin_nags'             => ! empty( $_POST['hide_admin_nags'] ),
				'shop_subtitle'               => sanitize_text_field( $_POST['shop_subtitle'] ?? '' ),
				'accent_color'                => sanitize_text_field( $_POST['accent_color'] ?? '#2563eb' ),
				'default_column_layout'       => in_array( $_POST['default_column_layout'] ?? '', array( '1', '2' ), true ) ? $_POST['default_column_layout'] : '1',
				'products_per_page'           => intval( $_POST['products_per_page'] ?? 20 ),
				'show_features_banner'        => ! empty( $_POST['show_features_banner'] ),
				'show_animated_stats'         => ! empty( $_POST['show_animated_stats'] ),
				'show_special_badge'          => ! empty( $_POST['show_special_badge'] ),
				'free_shipping_threshold'     => floatval( $_POST['free_shipping_threshold'] ?? 400000 ),
				'store_template'              => sanitize_text_field( $_POST['store_template'] ?? 'digikala' ),
				'store_palette'               => sanitize_text_field( $_POST['store_palette'] ?? 'digikala-red' ),
				'auto_convert_rial'           => ! empty( $_POST['auto_convert_rial'] ),
				'enable_custom_checkout'      => ! empty( $_POST['enable_custom_checkout'] ),
				'checkout_title'              => sanitize_text_field( $_POST['checkout_title'] ?? 'تسویه حساب امن' ),
				'checkout_note'               => sanitize_textarea_field( $_POST['checkout_note'] ?? '' ),
				'checkout_require_login'      => ! empty( $_POST['checkout_require_login'] ),
				'checkout_field_name'         => ! empty( $_POST['checkout_field_name'] ),
				'checkout_field_name_req'     => ! empty( $_POST['checkout_field_name_req'] ),
				'checkout_field_phone'        => ! empty( $_POST['checkout_field_phone'] ),
				'checkout_field_phone_req'    => ! empty( $_POST['checkout_field_phone_req'] ),
				'checkout_field_email'        => ! empty( $_POST['checkout_field_email'] ),
				'checkout_field_email_req'    => ! empty( $_POST['checkout_field_email_req'] ),
				'checkout_field_province'     => ! empty( $_POST['checkout_field_province'] ),
				'checkout_field_province_req' => ! empty( $_POST['checkout_field_province_req'] ),
				'checkout_field_city'         => ! empty( $_POST['checkout_field_city'] ),
				'checkout_field_city_req'     => ! empty( $_POST['checkout_field_city_req'] ),
				'checkout_field_address'      => ! empty( $_POST['checkout_field_address'] ),
				'checkout_field_address_req'  => ! empty( $_POST['checkout_field_address_req'] ),
				'checkout_field_postal'       => ! empty( $_POST['checkout_field_postal'] ),
				'checkout_field_postal_req'   => ! empty( $_POST['checkout_field_postal_req'] ),
				'checkout_field_notes'        => ! empty( $_POST['checkout_field_notes'] ),
				'checkout_field_notes_req'    => ! empty( $_POST['checkout_field_notes_req'] ),
				'checkout_show_gateways'      => ! empty( $_POST['checkout_show_gateways'] ),
				'checkout_cod_label'          => sanitize_text_field( $_POST['checkout_cod_label'] ?? 'پرداخت در محل (COD)' ),
				'checkout_success_msg'        => sanitize_textarea_field( $_POST['checkout_success_msg'] ?? '' ),
				'checkout_show_shipping'      => ! empty( $_POST['checkout_show_shipping'] ),
				'checkout_show_map'           => ! empty( $_POST['checkout_show_map'] ),
				'neshan_api_key'              => sanitize_text_field( $_POST['neshan_api_key'] ?? '' ),
				'shipping_origin_city'        => sanitize_text_field( $_POST['shipping_origin_city'] ?? 'تهران' ),
				'shipping_origin_lat'         => sanitize_text_field( $_POST['shipping_origin_lat'] ?? '35.6892' ),
				'shipping_origin_lng'         => sanitize_text_field( $_POST['shipping_origin_lng'] ?? '51.3890' ),
				'post_shipping_enabled'       => ! empty( $_POST['post_shipping_enabled'] ),
				'chapar_shipping_enabled'     => ! empty( $_POST['chapar_shipping_enabled'] ),
				'tipax_shipping_enabled'      => ! empty( $_POST['tipax_shipping_enabled'] ),
				'post_api_token'              => sanitize_text_field( $_POST['post_api_token'] ?? '' ),
				'chapar_api_token'            => sanitize_text_field( $_POST['chapar_api_token'] ?? '' ),
				'tipax_api_token'             => sanitize_text_field( $_POST['tipax_api_token'] ?? '' ),
				'shipping_base_post'          => floatval( $_POST['shipping_base_post'] ?? 45000 ),
				'shipping_base_chapar'        => floatval( $_POST['shipping_base_chapar'] ?? 65000 ),
				'shipping_base_tipax'         => floatval( $_POST['shipping_base_tipax'] ?? 75000 ),
				'shipping_per_kg'             => floatval( $_POST['shipping_per_kg'] ?? 12000 ),
				'enable_ai_product_images'    => ! empty( $_POST['enable_ai_product_images'] ),
				'ai_image_batch_size'         => max( 1, min( 30, intval( $_POST['ai_image_batch_size'] ?? 8 ) ) ),
				'ai_image_sideload'           => ! empty( $_POST['ai_image_sideload'] ),
				'ai_image_search_lang'        => sanitize_text_field( $_POST['ai_image_search_lang'] ?? 'fa' ),
				'enable_google_image_search'  => ! empty( $_POST['enable_google_image_search'] ),
				'google_cse_api_key'          => sanitize_text_field( $_POST['google_cse_api_key'] ?? '' ),
				'google_cse_cx'               => sanitize_text_field( $_POST['google_cse_cx'] ?? '' ),

				// Tab 2: Pricing & Profit
				'price_markup_percent'        => floatval( $_POST['price_markup_percent'] ?? 0 ),
				'price_fixed_add'             => floatval( $_POST['price_fixed_add'] ?? 0 ),
				'default_fallback_price'      => floatval( $_POST['default_fallback_price'] ?? 150000 ),
				'fallback_price_behavior'     => sanitize_text_field( $_POST['fallback_price_behavior'] ?? 'use_fallback' ),
				'price_rounding'              => sanitize_text_field( $_POST['price_rounding'] ?? '1000' ),
				'currency_symbol'             => sanitize_text_field( $_POST['currency_symbol'] ?? 'تومان' ),

				// Tab 3: Chat Settings & Themes
				'enable_support_chat'         => ! empty( $_POST['enable_support_chat'] ),
				'chat_theme'                  => sanitize_text_field( $_POST['chat_theme'] ?? 'royal-blue' ),
				'chat_button_style'           => sanitize_text_field( $_POST['chat_button_style'] ?? 'pill-label' ),
				'chat_button_position'        => in_array( $_POST['chat_button_position'] ?? '', array( 'left', 'right' ), true ) ? $_POST['chat_button_position'] : 'left',
				'chat_window_title'           => sanitize_text_field( $_POST['chat_window_title'] ?? 'پشتیبانی آنلاین فروشگاه' ),
				'chat_welcome_message'        => sanitize_textarea_field( $_POST['chat_welcome_message'] ?? '' ),
				'chat_field_name_enable'      => ! empty( $_POST['chat_field_name_enable'] ),
				'chat_field_name_required'    => ! empty( $_POST['chat_field_name_required'] ),
				'chat_field_phone_enable'     => ! empty( $_POST['chat_field_phone_enable'] ),
				'chat_field_phone_required'   => ! empty( $_POST['chat_field_phone_required'] ),
				'chat_field_email_enable'     => ! empty( $_POST['chat_field_email_enable'] ),
				'chat_field_email_required'   => ! empty( $_POST['chat_field_email_required'] ),
				'chat_field_subject_enable'   => ! empty( $_POST['chat_field_subject_enable'] ),
				'chat_field_subject_required' => ! empty( $_POST['chat_field_subject_required'] ),

				// Tab 4: AI & Coordination
				'ai_coordination_mode'        => in_array( $_POST['ai_coordination_mode'] ?? '', array( 'ai_first', 'ai_copilot', 'human_only', 'ai_only' ), true ) ? $_POST['ai_coordination_mode'] : 'ai_first',
				'ai_support_name'             => sanitize_text_field( $_POST['ai_support_name'] ?? 'پشتیبان هوشمند فروشگاه' ),
				'ai_system_prompt'            => sanitize_textarea_field( $_POST['ai_system_prompt'] ?? '' ),
				'ai_provider'                 => sanitize_text_field( $_POST['ai_provider'] ?? 'auto' ),
				'ai_api_key'                  => sanitize_text_field( $_POST['ai_api_key'] ?? '' ),
				'ai_model'                    => sanitize_text_field( $_POST['ai_model'] ?? '' ),
				'ai_endpoint'                 => sanitize_text_field( $_POST['ai_endpoint'] ?? '' ),

				// Tab 5: Messengers
				'bale_token'                  => sanitize_text_field( $_POST['bale_token'] ?? '' ),
				'bale_chat_id'                => sanitize_text_field( $_POST['bale_chat_id'] ?? '' ),
				'telegram_token'              => sanitize_text_field( $_POST['telegram_token'] ?? '' ),
				'telegram_chat_id'            => sanitize_text_field( $_POST['telegram_chat_id'] ?? '' ),
				'rubika_token'                => sanitize_text_field( $_POST['rubika_token'] ?? '' ),
				'rubika_chat_id'              => sanitize_text_field( $_POST['rubika_chat_id'] ?? '' ),

				// WordPress Cron (WP-Cron) Integration
				'enable_wp_cron_sync'         => ! empty( $_POST['enable_wp_cron_sync'] ),
				'wp_cron_interval'            => sanitize_text_field( $_POST['wp_cron_interval'] ?? 'every_30_mins' ),
			);
			update_option( self::OPTION_NAME, $new_settings );
			delete_transient( 'scraper_shop_cached_products' );
			/* v13.3.8: همگام فونت با connections.json برای همهٔ بازدیدکننده‌ها */
			/* v13.3.12: keep accent in sync with selected palette so theme colors apply */
			$__pal_map = array(
				'digikala-red' => '#ef394e', 'snapp-green' => '#00d170', 'basalam-coral' => '#ff6b35',
				'torob-red' => '#d32f2f', 'digistyle-rose' => '#e91e63', 'technolife-blue' => '#1a73e8',
				'royal-blue' => '#2563eb', 'luxury-purple' => '#7c3aed', 'amber-gold' => '#d97706',
				'persian-turquoise' => '#0d9488', 'midnight-ink' => '#6366f1', 'forest' => '#16a34a', 'sunset' => '#f97316',
			);
			$__pal = (string) ( $new_settings['store_palette'] ?? '' );
			if ( $__pal && isset( $__pal_map[ $__pal ] ) ) {
				// If user didn't manually override accent in the same save, palette wins.
				// Admin palette radios already set accent_color via JS; still enforce map for reliability.
				$posted_accent = sanitize_text_field( $_POST['accent_color'] ?? '' );
				if ( $posted_accent === '' || strtolower( $posted_accent ) === strtolower( (string) ( $opts['accent_color'] ?? '' ) ) || isset( $_POST['store_palette'] ) ) {
					// Prefer explicit accent if user typed custom; else palette hex.
					if ( $posted_accent !== '' && preg_match( '/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $posted_accent ) ) {
						$new_settings['accent_color'] = $posted_accent;
					} else {
						$new_settings['accent_color'] = $__pal_map[ $__pal ];
					}
				}
			}
			self::sync_ui_font_to_connections( (string) ( $new_settings['shop_title_font'] ?? 'vazirmatn' ) );
			if ( ! empty( $new_settings['enable_native_wp_template'] ) || ! empty( $new_settings['auto_create_fallback_page'] ) ) {
				try {
					$fb_res = self::ensure_fallback_shop_page( ! empty( $new_settings['set_wc_shop_to_fallback'] ) );
					if ( ! empty( $fb_res['id'] ) ) {
						$new_settings['native_fallback_page_id'] = intval( $fb_res['id'] );
						// v13.3.32: shop_page_id را با پشتیبان یکی نکن
						update_option( self::OPTION_NAME, $new_settings );
					}
					self::maybe_detach_fallback_from_primary_shop();
				} catch ( \Throwable $e ) { /* ignore */ }
			}
			// v13.3.32: با React روشن، primary بساز و پشتیبان را از /shop جدا کن
			if ( ! empty( $new_settings['enable_shop_takeover'] ) ) {
				try {
					$_tpl_s = (string) ( $new_settings['store_template'] ?? 'digikala' );
					if ( $_tpl_s !== 'native-wp' && $_tpl_s !== 'native' ) {
						$new_settings['set_wc_shop_to_fallback'] = false;
					}
					$pid = self::ensure_primary_react_shop_page( $new_settings, intval( $new_settings['native_fallback_page_id'] ?? 0 ) );
					if ( $pid > 0 ) {
						$new_settings['shop_page_id'] = $pid;
						update_option( 'scraper_shop_page_id', $pid, false );
						if ( function_exists( 'wc_get_page_id' ) ) {
							$wc = (int) wc_get_page_id( 'shop' );
							$fb = intval( $new_settings['native_fallback_page_id'] ?? 0 );
							if ( $wc <= 0 || $wc === $fb ) {
								update_option( 'woocommerce_shop_page_id', $pid );
							}
						}
					}
					update_option( self::OPTION_NAME, $new_settings );
					self::maybe_detach_fallback_from_primary_shop();
				} catch ( \Throwable $e ) { /* ignore */ }
			}
			self::sync_wp_cron_schedule( $new_settings );
			self::sync_ai_image_cron_schedule( $new_settings );
			$updated = true;
		}

		$opts             = self::get_settings();
		$scraped_products = self::get_all_scraped_products();
		$profiles_summary = self::get_profiles_summary();
		$active_msgrs     = self::get_active_messengers( $opts );
		$chat_logs        = get_option( 'scraper_support_chat_logs', array() );
		$chat_threads     = self::get_chat_threads();
		$cands_info       = self::get_scraper_ai_candidates();
		$master_ai        = self::get_scraper_master_ai_model( $opts );
		$wpcron_info      = self::get_wpcron_status_info( $opts );
		$analytics_data   = self::get_display_analytics_data();

		$scraper_embed_url  = admin_url( 'admin.php?page=scraper-full-dashboard' );

		// v10.99: وضعیت اتصال مستقیم ووکامرس (از connections.json + محیط WP)
		$woo_conn_all = self::get_scraper_connections();
		$woo_conn     = is_array( $woo_conn_all['woocommerce'] ?? null ) ? $woo_conn_all['woocommerce'] : array();
		$woo_has_wc   = class_exists( 'WooCommerce' ) || function_exists( 'wc_get_product' );
		$woo_sync_mode = (string) ( $woo_conn['sync_mode'] ?? 'api' );
		$woo_enabled  = ! empty( $woo_conn['enabled'] );
		$woo_store    = (string) ( $woo_conn['store_url'] ?? ( function_exists( 'home_url' ) ? home_url( '/' ) : '' ) );
		$woo_direct_ready = $woo_has_wc && $woo_enabled && in_array( $woo_sync_mode, array( 'direct', 'auto' ), true );
		$scraper_direct_url = plugins_url( 'scraper4.php', __FILE__ );
		?>
		<div class="wrap scraper-admin-dashboard">
			
			<!-- Header Title Area v13.3.32 -->
			<div class="amphp-admin-hero">
				<div style="min-width:0;flex:1 1 220px;">
					<div class="amphp-hero-badge">⚡ پنل فروشگاه · v13.3.32</div>
					<h1>تنظیمات ویترین، چت و هوش مصنوعی</h1>
					<p>ظاهر فروشگاه، قیمت‌گذاری، پشتیبانی، پیام‌رسان‌ها و همگام‌سازی ووکامرس — فشرده و مناسب موبایل.</p>
				</div>
				<div class="scraper-admin-topbar">
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>" target="_blank" class="button button-secondary">خانه / ویترین ↗</a>
					<a href="#amphp-wc-shop-fallback-card" class="button" style="background:#ea580c;border-color:#c2410c;color:#fff;">ووکامرس=پشتیبان</a>
					<a href="<?php echo esc_url( $scraper_embed_url ); ?>" class="button button-primary" style="background:#2563eb;border:none;">پنل اسکرپر</a>
				</div>
			</div>

			<?php if ( $updated ) : ?>
				<div class="notice notice-success is-dismissible" style="border-radius:10px; margin-bottom:20px;">
					<p><strong>✅ تمامی تنظیمات با موفقیت ذخیره شدند.</strong></p>
				</div>
			<?php endif; ?>

			<style id="amphp-admin-inline-extras">
				/* extras that stay next to markup (desk / theme menu) */
				.desk-thread-item:hover { background: #f1f5f9; }
				.desk-thread-item.active { background: #eff6ff !important; border-right: 4px solid #2563eb !important; }
				.desk-canned-chip {
					background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 14px;
					padding: 2px 8px; font-size: 0.72rem; font-weight: 700; color: #334155; cursor: pointer;
				}
				.desk-canned-chip:hover { background: #e2e8f0; color: #0f172a; }
				.desk-bubble { max-width: 82%; padding: 7px 10px; border-radius: 10px; font-size: 0.8rem; line-height: 1.45; word-break: break-word; }
				.desk-bubble.customer { align-self: flex-start; background: #fff; border: 1px solid #cbd5e1; color: #0f172a; border-bottom-right-radius: 2px; }
				.desk-bubble.ai { align-self: flex-start; background: #faf5ff; border: 1px solid #e9d5ff; color: #581c87; border-bottom-right-radius: 2px; }
				.desk-bubble.admin { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-left-radius: 2px; }
				.theme-menu-card-item:hover { background: #f1f5f9 !important; }
				.theme-menu-card-item.active { background: #eff6ff !important; border-right: 3px solid #2563eb !important; }
				.scraper-tab-panel { display: none; }
				.scraper-tab-panel.active { display: block; animation: amphpFadeTab .2s ease; }
				@keyframes amphpFadeTab { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
			</style>

			<?php if ( current_user_can( 'update_plugins' ) ) : $update_config = self::github_update_config(); ?>
			<section id="amphp-github-update" style="background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:12px 0;">
				<h3>به‌روزرسانی خودکار افزونه از گیت‌هاب</h3>
				<p>فقط مخزن عمومی و مورد اعتماد: هر کسی که روی برنچ انتخاب‌شده پوش کند، می‌تواند کد سایت را تغییر دهد. فایل‌های داده و تنظیمات جایگزین نمی‌شوند. قبل از فعال‌سازی نسخهٔ پشتیبان تهیه کنید.</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="amphp_github_update">
					<?php wp_nonce_field( 'amphp_github_update' ); ?>
					<p><label>مخزن (owner/repo): <input name="repo" required value="<?php echo esc_attr( $update_config['repo'] ); ?>" dir="ltr"></label></p>
					<p><label>برنچ: <input name="branch" required value="<?php echo esc_attr( $update_config['branch'] ); ?>" dir="ltr"></label></p>
					<p><label>پوشهٔ افزونه در مخزن (برای ریشه خالی): <input name="path" value="<?php echo esc_attr( $update_config['path'] ); ?>" dir="ltr"></label></p>
					<p><label><input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $update_config['enabled'] ) ); ?>> فعال‌سازی به‌روزرسانی خودکار</label></p>
					<button type="submit" class="button button-primary">ذخیره تنظیمات</button>
					<button type="submit" name="check_now" value="1" class="button">ذخیره و بررسی فوری</button>
				</form>
				<p>بررسی تقریباً ساعتی با WP-Cron انجام می‌شود؛ روی سایت کم‌ترافیک ممکن است دیرتر اجرا شود. هاست باید به api.github.com دسترسی و اجازهٔ نوشتن فایل‌ها را داشته باشد.</p>
				<p>آخرین بررسی: <?php echo esc_html( $update_config['last_check'] ?: 'هنوز انجام نشده' ); ?><br>نتیجه: <?php echo esc_html( $update_config['last_message'] ?: '—' ); ?></p>
			</section>
			<?php endif; ?>
			<section style="background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:12px 0;">
				<h3>آزمایش زندهٔ سایت</h3>
				<p>فقط برای مدیر: بررسی اجرای وردپرس و پاسخ HTTP صفحهٔ اصلی. این آزمایش جایگزین تست مرورگر یا پرداخت نیست.</p>
				<button type="button" class="button" data-amphp-diagnostic="dashboard">بررسی داشبورد</button>
				<button type="button" class="button" data-amphp-diagnostic="storefront">بررسی ویترین</button>
				<pre id="amphp-diagnostic-result" dir="ltr" style="white-space:pre-wrap;overflow-wrap:anywhere;"></pre>
			</section>
			<script>
			(function(){
			  var endpoints = <?php echo wp_json_encode( array( 'dashboard' => rest_url( 'amphp/v1/diagnostics/dashboard' ), 'storefront' => rest_url( 'amphp/v1/diagnostics/storefront' ) ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?>;
			  var nonce = <?php echo wp_json_encode( wp_create_nonce( 'wp_rest' ) ); ?>;
			  var output = document.getElementById('amphp-diagnostic-result');
			  document.querySelectorAll('[data-amphp-diagnostic]').forEach(function(button) {
			    button.addEventListener('click', async function() {
			      button.disabled = true; output.textContent = 'در حال بررسی…';
			      try {
			        var response = await fetch(endpoints[button.dataset.amphpDiagnostic], {credentials:'same-origin',headers:{'X-WP-Nonce':nonce}});
			        var data = await response.json();
			        output.textContent = 'HTTP ' + response.status + '\n' + JSON.stringify(data, null, 2);
			      } catch (error) { output.textContent = 'خطا در ارتباط: ' + error.message; }
			      finally { button.disabled = false; }
			    });
			  });
			})();
			</script>

			<form method="post" action="" id="scraperAdminForm">
				<?php wp_nonce_field( 'scraper_shop_settings_action', 'scraper_shop_settings_nonce' ); ?>

				<!-- Mobile Quick Tab Selector Dropdown -->
				<div class="scraper-mobile-tab-bar">
					<label for="mobileTabSelector">📂 انتخاب بخش تنظیمات (پرش سریع):</label>
					<select id="mobileTabSelector">
						<option value="tab-storefront">🎨 ۱. ویترین و ظاهر فروشگاه</option>
						<option value="tab-pricing">💰 ۲. قیمت‌گذاری و سود</option>
						<option value="tab-chat">💬 ۳. چت آنلاین و میز پاسخگویی</option>
						<option value="tab-ai">🤖 ۴. هوش مصنوعی و هماهنگی</option>
						<option value="tab-messengers">📡 ۵. پیام‌رسان‌ها (بله/تلگرام/روبیکا)</option>
						<option value="tab-woocommerce">🏪 ۶. فروشگاه و آمار</option>
						<option value="tab-logs">📋 ۷. گزارش پیام‌های مشتریان</option>
					</select>
				</div>

				<!-- All 7 Tabs Navigation (Always Fully Visible & Wrapping) + Top Save Button -->
				<div class="scraper-tab-nav-row scraper-sticky-admin-head">
					<div class="scraper-tab-nav" id="scraperAdminTabs">
						<button type="button" class="scraper-tab-link active" data-tab="tab-storefront">🎨 ۱. ویترین فروشگاه</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-pricing">💰 ۲. قیمت‌گذاری</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-chat">💬 ۳. چت و پاسخگویی</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-ai">🤖 ۴. هوش مصنوعی</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-messengers">📡 ۵. پیام‌رسان‌ها</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-woocommerce">🏪 ۶. فروشگاه</button>
						<button type="button" class="scraper-tab-link" data-tab="tab-logs">📋 ۷. گزارش پیام‌ها</button>
					</div>
					<div>
						<span id="amphpAutosavePill" class="scraper-autosave-pill" title="ذخیرهٔ خودکار">⏳ آمادهٔ ذخیرهٔ خودکار</span>
						<button type="submit" name="scraper_shop_save" id="scraperShopSaveBtn" class="button scraper-top-save-btn">
							💾 ذخیره تغییرات
						</button>
					</div>
				</div>

				<!-- ================= TAB 1: STOREFRONT & APPEARANCE ================= -->
				<div id="tab-storefront" class="scraper-tab-panel active">
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>🎨</span> تنظیمات سربرگ، نوار اعلان و ظاهر فروشگاه</h3>
							<span class="field-badge field-badge-blue">طراحی لوکس اختصاصی</span>
						</div>

						<?php
						$catalog_src = sanitize_key( (string) ( $opts['catalog_source'] ?? '' ) );
						if ( ! in_array( $catalog_src, array( 'scraper', 'woocommerce', 'merge' ), true ) ) {
							$catalog_src = ! empty( $opts['enable_scraped_products'] ) ? 'scraper' : 'woocommerce';
						}
						$merge_pref = sanitize_key( (string) ( $opts['catalog_merge_prefer'] ?? 'scraper' ) );
						if ( ! in_array( $merge_pref, array( 'scraper', 'woocommerce', 'keep_both' ), true ) ) {
							$merge_pref = 'scraper';
						}
						?>
						<!-- v13.3.8: کنترل قالب + منبع کاتالوگ (اسکرپر / ووکامرس / ادغام) -->
						<div style="margin-bottom:14px; background:linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%); border:1.5px solid #3b82f6; border-radius:12px; padding:14px; box-shadow:0 2px 10px rgba(37,99,235,0.06); max-width:100%; overflow:hidden;">
							<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
								<h4 style="margin:0; font-size:1.15rem; color:#1e3a8a; font-weight:900; display:flex; align-items:center; gap:8px;">
									<span>🎛️</span> کنترل قالب و منبع محصولات ویترین
								</h4>
								<span style="background:#7c3aed; color:#fff; font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:20px;">ادغام اسکرپر + ووکامرس</span>
							</div>
							<p style="margin:0 0 16px; font-size:0.88rem; color:#334155; line-height:1.7;">
								ظاهر ویترین را با تیک زیر، و <strong>منبع کالاهای نمایش‌داده‌شده</strong> را با سه حالت اسکرپر / ووکامرس / <strong>ادغام هر دو</strong> تنظیم کنید.
							</p>
							<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap:10px; margin-bottom:12px; width:100%;">
								<label style="background:#ffffff; border:2px solid #2563eb; border-radius:14px; padding:16px; cursor:pointer; display:flex; flex-direction:column; gap:10px; box-shadow:0 4px 14px rgba(37,99,235,.12);" id="labelStoreTakeover">
									<div style="display:flex; align-items:center; gap:10px;">
										<input type="checkbox" name="enable_shop_takeover" id="chkStoreTakeover" value="1" <?php checked( ! empty( $opts['enable_shop_takeover'] ) ); ?> style="width:22px; height:22px; accent-color:#2563eb;">
										<strong style="font-size:1.05rem; color:#1e3a8a;">🚀 ویترین React اختصاصی (دیجی‌کالا / اسنپ‌شاپ / …)</strong>
									</div>
									<div style="font-size:0.84rem; color:#334155; line-height:1.7; padding-right:32px;">
										<strong style="color:#0f172a;">این تیک باید روشن باشد</strong> تا با انتخاب «قالب دیجی‌کالا» (یا سایر پوسته‌ها) فروشگاه React تمام‌صفحه بیاید.<br>
										✅ هدر وردپرس حذف و هدر/منوی اختصاصی React فعال می‌شود.<br>
										❌ خاموش = ظاهر قالب وردپرس / برگهٔ پشتیبان بومی.
									</div>
								</label>
								<div style="background:#ffffff; border:1.5px solid #a78bfa; border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:12px;" id="labelCatalogSource">
									<strong style="font-size:1rem; color:#0f172a;">📦 منبع محصولات ویترین</strong>
									<p style="margin:0; font-size:0.8rem; color:#64748b; line-height:1.6;">کدام کالاها در فروشگاه React نمایش داده شوند؟ در حالت فقط پروفایل، نمایش عمومی و خرید ووکامرس نیز به کالاهای قابل شناسایی در پروفایل‌های فعلی محدود می‌شود؛ فهرست ترب ممکن است تا بازخوانی یا پاک‌سازی کش به‌روز نشود.</p>
									<label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:10px; border:1.5px solid <?php echo ( 'scraper' === $catalog_src ) ? '#10b981' : '#e2e8f0'; ?>; background:<?php echo ( 'scraper' === $catalog_src ) ? '#ecfdf5' : '#f8fafc'; ?>; cursor:pointer;">
										<input type="radio" name="catalog_source" id="catSrcScraper" value="scraper" <?php checked( $catalog_src, 'scraper' ); ?> style="margin-top:3px; accent-color:#10b981;">
										<span><strong style="color:#047857;">فقط پروفایل‌های اسکرپر</strong><span style="display:block; font-size:0.78rem; color:#64748b; margin-top:2px;">محصولات profiles.json با ضریب سود اسکرپر</span></span>
									</label>
									<label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:10px; border:1.5px solid <?php echo ( 'woocommerce' === $catalog_src ) ? '#2563eb' : '#e2e8f0'; ?>; background:<?php echo ( 'woocommerce' === $catalog_src ) ? '#eff6ff' : '#f8fafc'; ?>; cursor:pointer;">
										<input type="radio" name="catalog_source" id="catSrcWoo" value="woocommerce" <?php checked( $catalog_src, 'woocommerce' ); ?> style="margin-top:3px; accent-color:#2563eb;">
										<span><strong style="color:#1d4ed8;">فقط محصولات ووکامرس</strong><span style="display:block; font-size:0.78rem; color:#64748b; margin-top:2px;">کاتالوگ publish دیتابیس ووکامرس</span></span>
									</label>
									<label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:10px; border:1.5px solid <?php echo ( 'merge' === $catalog_src ) ? '#7c3aed' : '#e2e8f0'; ?>; background:<?php echo ( 'merge' === $catalog_src ) ? '#f5f3ff' : '#f8fafc'; ?>; cursor:pointer;">
										<input type="radio" name="catalog_source" id="catSrcMerge" value="merge" <?php checked( $catalog_src, 'merge' ); ?> style="margin-top:3px; accent-color:#7c3aed;">
										<span><strong style="color:#6d28d9;">ادغام اسکرپر + ووکامرس</strong><span style="display:block; font-size:0.78rem; color:#64748b; margin-top:2px;">هر دو منبع در یک ویترین</span></span>
									</label>
									<div id="mergePreferBox" style="margin-top:4px; padding:12px; border-radius:10px; background:#faf5ff; border:1px dashed #c4b5fd;<?php echo ( 'merge' === $catalog_src ) ? '' : ' display:none;'; ?>">
										<div style="font-size:0.8rem; font-weight:800; color:#5b21b6; margin-bottom:8px;">در صورت تکراری بودن کالا (عنوان/SKU یکسان):</div>
										<label style="display:flex; gap:8px; align-items:center; font-size:0.8rem; margin-bottom:6px; cursor:pointer;"><input type="radio" name="catalog_merge_prefer" value="scraper" <?php checked( $merge_pref, 'scraper' ); ?> style="accent-color:#7c3aed;"> اولویت با <strong>اسکرپر</strong></label>
										<label style="display:flex; gap:8px; align-items:center; font-size:0.8rem; margin-bottom:6px; cursor:pointer;"><input type="radio" name="catalog_merge_prefer" value="woocommerce" <?php checked( $merge_pref, 'woocommerce' ); ?> style="accent-color:#7c3aed;"> اولویت با <strong>ووکامرس</strong></label>
										<label style="display:flex; gap:8px; align-items:center; font-size:0.8rem; cursor:pointer;"><input type="radio" name="catalog_merge_prefer" value="keep_both" <?php checked( $merge_pref, 'keep_both' ); ?> style="accent-color:#7c3aed;"> <strong>هر دو را نگه دار</strong></label>
									</div>
									<input type="checkbox" name="enable_scraped_products" id="chkScrapedProducts" value="1" <?php checked( 'woocommerce' !== $catalog_src ); ?> style="position:absolute;left:-9999px;opacity:0;width:1px;height:1px;" tabindex="-1" aria-hidden="true">
								</div>
							</div>
							<div id="boxDualStateIndicator" style="background:#ffffff; border:1.5px dashed #2563eb; border-radius:12px; padding:14px 18px; display:flex; flex-wrap:wrap; gap:12px;">
								<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:0.85rem; color:#64748b;">وضعیت فعال فروشگاه:</span> <strong id="dualStateTitle" style="font-size:0.95rem; color:#1d4ed8;">—</strong></div>
								<div id="dualStateDesc" style="font-size:0.84rem; color:#475569; line-height:1.5; width:100%;">—</div>
							</div>
						</div>


						<?php
						// v13.3.32: وضعیت ویترین React در برابر پشتیبان — راهنمای پیدا کردن تیک‌ها
						$_sf_take = ! empty( $opts['enable_shop_takeover'] );
						$_sf_tpl  = (string) ( $opts['store_template'] ?? 'digikala' );
						$_sf_wc_fb = ! empty( $opts['set_wc_shop_to_fallback'] );
						$_sf_fb_id = intval( $opts['native_fallback_page_id'] ?? get_option( 'scraper_native_fallback_page_id', 0 ) );
						$_sf_wc_shop = function_exists( 'wc_get_page_id' ) ? (int) wc_get_page_id( 'shop' ) : 0;
						$_sf_bound = ( $_sf_fb_id > 0 && $_sf_wc_shop > 0 && $_sf_fb_id === $_sf_wc_shop );
						$_sf_react_ok = $_sf_take && $_sf_tpl !== 'native-wp' && $_sf_tpl !== 'native' && ! $_sf_bound;
						$_sf_primary = intval( $opts['shop_page_id'] ?? get_option( 'scraper_shop_page_id', 0 ) );
						/* v13.3.32: لینک اصلی ویترین = دامنهٔ خانه */
						$_sf_react_url = home_url( '/' );
						$_sf_shop_url = '';
						if ( $_sf_primary > 0 ) {
							$_sf_shop_url = get_permalink( $_sf_primary );
						}
						if ( ! $_sf_shop_url && function_exists( 'wc_get_page_permalink' ) ) {
							$_sf_shop_url = wc_get_page_permalink( 'shop' );
						}
						?>
						<div style="margin:0 0 12px; padding:12px 14px; border-radius:12px; max-width:100%; overflow:hidden; border:1.5px solid <?php echo $_sf_react_ok ? '#10b981' : '#f59e0b'; ?>; background:<?php echo $_sf_react_ok ? 'linear-gradient(135deg,#ecfdf5,#f0fdf4)' : 'linear-gradient(135deg,#fffbeb,#fef3c7)'; ?>;">
							<div style="font-weight:900; font-size:1.05rem; color:<?php echo $_sf_react_ok ? '#065f46' : '#92400e'; ?>; margin-bottom:8px;">
								<?php echo $_sf_react_ok ? '✅ ویترین React آماده است' : '⚠️ ویترین React هنوز کامل فعال نیست'; ?>
							</div>
							<ul style="margin:0 0 10px; padding-right:18px; font-size:0.86rem; line-height:1.85; color:#334155; font-weight:700;">
								<li>تیک «ویترین React اختصاصی»: <strong style="color:<?php echo $_sf_take ? '#059669' : '#dc2626'; ?>"><?php echo $_sf_take ? 'روشن' : 'خاموش — روشن کنید'; ?></strong></li>
								<li>پوسته انتخاب‌شده: <strong><?php echo esc_html( $_sf_tpl ); ?></strong><?php echo ( $_sf_tpl === 'native-wp' ) ? ' <span style="color:#dc2626">(بومی = نه React؛ دیجی‌کالا را بزنید)</span>' : ''; ?></li>
								<li>تیک «صفحه فروشگاه ووکامرس = پشتیبان»: <strong style="color:<?php echo $_sf_wc_fb || $_sf_bound ? '#dc2626' : '#059669'; ?>"><?php echo ( $_sf_wc_fb || $_sf_bound ) ? 'روشن/متصل — برای React خاموش کنید' : 'خاموش (درست)'; ?></strong>
									— کارت نارنجی <strong>بلافاصله زیر همین بنر</strong></li>
							</ul>
							<p style="margin:0; font-size:0.84rem; font-weight:800;">
								🏠 ویترین React روی <strong>صفحهٔ اصلی سایت</strong>:
								<a href="<?php echo esc_url( $_sf_react_url ); ?>" target="_blank" rel="noopener" style="color:#1d4ed8;"><?php echo esc_html( $_sf_react_url ); ?></a>
								<?php if ( ! empty( $_sf_shop_url ) && untrailingslashit( (string) $_sf_shop_url ) !== untrailingslashit( (string) $_sf_react_url ) ) : ?>
									· فروشگاه: <a href="<?php echo esc_url( $_sf_shop_url ); ?>" target="_blank" rel="noopener" style="color:#1d4ed8;"><?php echo esc_html( $_sf_shop_url ); ?></a>
								<?php endif; ?>
							</p>
						</div>

						
						<!-- v13.3.32: کلید روشن/خاموش ووکامرس=پشتیبان — بدون اتکا به ظاهر چک‌باکس وردپرس -->
						<div id="amphp-wc-shop-fallback-card" style="margin:0 0 14px;padding:14px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:2px solid #ea580c;border-radius:12px;box-shadow:0 4px 14px rgba(234,88,12,.12);max-width:100%;overflow:hidden;">
							<div style="font-weight:900;font-size:1.15rem;color:#9a3412;margin-bottom:6px;">🟧 فروشگاه ووکامرس = برگهٔ پشتیبان؟</div>
							<p style="margin:0 0 14px;font-size:0.88rem;font-weight:700;color:#7c2d12;line-height:1.7;">
								اگر فقط کادر نارنجی می‌بینید و تیک نیست، از دکمه‌های زیر استفاده کنید (ظاهر چک‌باکس وردپرس گاهی مخفی می‌شود).
							</p>
							<?php
							$_wc_fb_on = ! empty( $opts['set_wc_shop_to_fallback'] );
							?>
							<!-- مقدار واقعی برای ذخیرهٔ فرم -->
							<input type="hidden" name="set_wc_shop_to_fallback" id="amphpWcFbHidden" value="<?php echo $_wc_fb_on ? '1' : '0'; ?>">

							<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px;">
								<button type="button" id="amphpWcFbOffBtn" class="button" style="min-width:160px;height:48px;font-size:1rem;font-weight:900;border-radius:12px;border:3px solid #059669 !important;<?php echo ! $_wc_fb_on ? 'background:#059669!important;color:#fff!important;' : 'background:#fff!important;color:#065f46!important;'; ?>">
									✓ خاموش (مناسب React)
								</button>
								<button type="button" id="amphpWcFbOnBtn" class="button" style="min-width:160px;height:48px;font-size:1rem;font-weight:900;border-radius:12px;border:3px solid #dc2626 !important;<?php echo $_wc_fb_on ? 'background:#dc2626!important;color:#fff!important;' : 'background:#fff!important;color:#991b1b!important;'; ?>">
									روشن (پشتیبان = /shop)
								</button>
								<span id="amphpWcFbStatus" style="font-weight:900;font-size:1rem;padding:10px 14px;border-radius:10px;<?php echo $_wc_fb_on ? 'background:#fef2f2;color:#b91c1c;' : 'background:#ecfdf5;color:#047857;'; ?>">
									وضعیت: <?php echo $_wc_fb_on ? 'روشن' : 'خاموش'; ?>
								</span>
							</div>

							<!-- چک‌باکس یدکی خیلی درشت (اگر قالب مخفی‌اش نکند) -->
							<label style="display:flex !important;align-items:center;gap:12px;margin:12px 0 0;padding:12px;background:#fff;border:2px dashed #fb923c;border-radius:10px;cursor:pointer;visibility:visible !important;opacity:1 !important;">
								<input type="checkbox" id="chkWcShopFallback" value="1" <?php checked( $_wc_fb_on ); ?>
									style="position:static !important;left:auto !important;width:28px !important;height:28px !important;min-width:28px !important;min-height:28px !important;margin:0 !important;opacity:1 !important;visibility:visible !important;display:inline-block !important;appearance:auto !important;-webkit-appearance:checkbox !important;accent-color:#ea580c;flex-shrink:0;z-index:5;"
									onchange="if(window.amphpSetWcFb) window.amphpSetWcFb(this.checked);">
								<span style="font-weight:800;color:#7c2d12;font-size:0.95rem;">یا از این تیک استفاده کنید: صفحه فروشگاه ووکامرس = پشتیبان</span>
							</label>

							<p style="margin:12px 0 0;font-size:0.8rem;color:#78716c;font-weight:700;line-height:1.65;">
								برای <strong>دیجی‌کالا / React</strong> دکمهٔ <strong style="color:#059669;">خاموش</strong> را بزنید و تنظیمات را ذخیره کنید.
								نسخه افزونه: <code>۱۳٫۳٫۲۴</code>
							</p>
						</div>
						<script>
						(function(){
						  var hidden = document.getElementById('amphpWcFbHidden');
						  var chk = document.getElementById('chkWcShopFallback');
						  var st = document.getElementById('amphpWcFbStatus');
						  var onB = document.getElementById('amphpWcFbOnBtn');
						  var offB = document.getElementById('amphpWcFbOffBtn');
						  function paint(on){
						    if (hidden) hidden.value = on ? '1' : '0';
						    if (chk) chk.checked = !!on;
						    if (st) {
						      st.textContent = 'وضعیت: ' + (on ? 'روشن' : 'خاموش');
						      st.style.background = on ? '#fef2f2' : '#ecfdf5';
						      st.style.color = on ? '#b91c1c' : '#047857';
						    }
						    if (onB) {
						      onB.style.background = on ? '#dc2626' : '#fff';
						      onB.style.color = on ? '#fff' : '#991b1b';
						    }
						    if (offB) {
						      offB.style.background = !on ? '#059669' : '#fff';
						      offB.style.color = !on ? '#fff' : '#065f46';
						    }
						  }
						  window.amphpSetWcFb = function(on){ paint(!!on); };
						  if (onB) onB.addEventListener('click', function(e){ e.preventDefault(); paint(true); });
						  if (offB) offB.addEventListener('click', function(e){ e.preventDefault(); paint(false); });
						  // ذخیره: hidden همیشه ارسال می‌شود؛ PHP فقط '1' را true می‌گیرد
						  function goWcCard(){
						    var card=document.getElementById('amphp-wc-shop-fallback-card');
						    if(!card) return;
						    var tabBtn=document.querySelector('.scraper-tab-link[data-tab="tab-storefront"]');
						    if(tabBtn) try{ tabBtn.click(); }catch(e){}
						    setTimeout(function(){
						      card.scrollIntoView({behavior:'smooth',block:'center'});
						      card.style.outline='4px solid #ea580c';
						    }, 150);
						  }
						  if(location.hash==='#amphp-wc-shop-fallback-card' || location.hash==='#wc-fallback') goWcCard();
						  document.querySelectorAll('a[href="#amphp-wc-shop-fallback-card"]').forEach(function(a){
						    a.addEventListener('click', function(e){ e.preventDefault(); goWcCard(); });
						  });
						})();
						</script>



<!-- Visual eCommerce Storefront Templates Selector -->
						<div style="margin-bottom:24px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:20px;">
							<h4 style="margin:0 0 6px; font-size:1.05rem; color:#0f172a; font-weight:800;">🛍️ انتخاب پوسته فروشگاه (eCommerce Templates)</h4>
							<p style="margin:0 0 16px; font-size:0.85rem; color:#64748b;">
								پوسته ظاهری مورد نظر خود را متناسب با سبک برند انتخاب نمایید تا تمامی رنگ‌بندی‌ها، انحناها و برچسب‌های ویترین به صورت خودکار منطبق شوند:
							</p>

							<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">
								<!-- Digikala -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? 'digikala' ) === 'digikala' ? '#ef394e' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="digikala" <?php checked( ( $opts['store_template'] ?? 'digikala' ), 'digikala' ); ?>>
											<strong style="color:#ef394e; font-size:0.95rem;">قالب دیجی‌کالا</strong>
										</div>
										<span style="background:#fef2f2; color:#ef394e; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">پیشنهاد شگفت‌انگیز</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">نشان‌های قرمز نمادین، ارسال اکسپرس، برچسب تخفیف درصدی و ساختار استاندارد پرفروش‌ترین فروشگاه ایران.</span>
								</label>

								<!-- SnappShop -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'snappshop' ? '#00c073' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="snappshop" <?php checked( ( $opts['store_template'] ?? '' ), 'snappshop' ); ?>>
											<strong style="color:#00c073; font-size:0.95rem;">قالب اسنپ‌شاپ</strong>
										</div>
										<span style="background:#ecfdf5; color:#059669; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">سوپراپ</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">سبک سبز مدرن سوپراپ اسنپ، انحنای گرد ۱۸ پیکسلی و برچسب‌های ارسال فوری با تحویل پیک.</span>
								</label>

								<!-- Basalam -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'basalam' ? '#df3826' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="basalam" <?php checked( ( $opts['store_template'] ?? '' ), 'basalam' ); ?>>
											<strong style="color:#df3826; font-size:0.95rem;">قالب باسلام</strong>
										</div>
										<span style="background:#fff7ed; color:#c2410c; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">بازارچه صمیمی</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">رنگ مرجانی گرم، برچسب‌های غرفه برتر باسلام، تجربه خرید صمیمی و گفتگوی مستقیم با مشتری.</span>
								</label>

								<!-- Torob -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'torob' ? '#d32f2f' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="torob" <?php checked( ( $opts['store_template'] ?? '' ), 'torob' ); ?>>
											<strong style="color:#d32f2f; font-size:0.95rem;">قالب ترب</strong>
										</div>
										<span style="background:#fef2f2; color:#b91c1c; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">کمترین قیمت</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">طراحی مقایسه قیمت هوشمند ترب، تراکم داده بهینه، ضمانت بازگشت و بهترین قیمت بازار.</span>
								</label>

								<!-- Digistyle -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'digistyle' ? '#e11d48' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="digistyle" <?php checked( ( $opts['store_template'] ?? '' ), 'digistyle' ); ?>>
											<strong style="color:#e11d48; font-size:0.95rem;">قالب دیجی‌استایل</strong>
										</div>
										<span style="background:#fff1f2; color:#be123c; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">مد و لاکچری</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">سبک مد و فشن لوکس، عکس‌های کشیده عمودی، حروف‌نگاری مینیمال و برچسب‌های کالکشن خاص.</span>
								</label>

								<!-- Technolife -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'technolife' ? '#0284c7' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="technolife" <?php checked( ( $opts['store_template'] ?? '' ), 'technolife' ); ?>>
											<strong style="color:#0284c7; font-size:0.95rem;">قالب تکنولایف</strong>
										</div>
										<span style="background:#f0f9ff; color:#0369a1; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">دیجیتال و گجت</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">تم آبی دیجیتال و تکنولوژی، چیپ‌های مشخصات سخت‌افزاری و برچسب ضمانت شرکتی.</span>
								</label>

								<!-- Modern Luxury -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'modern' ? '#2563eb' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="modern" <?php checked( ( $opts['store_template'] ?? '' ), 'modern' ); ?>>
											<strong style="color:#2563eb; font-size:0.95rem;">مدرن استاندارد</strong>
										</div>
										<span style="background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">سلطنتی شیشه‌ای</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">تم آبی لاجوردی، افکت‌های ملایم گلس‌مورفیزم و سایه‌های نرم شناور بر پایه طراحی بین‌المللی.</span>
								</label>

								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'midnight' ? '#6366f1' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#0f172a; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="midnight" <?php checked( ( $opts['store_template'] ?? '' ), 'midnight' ); ?>>
											<strong style="color:#a5b4fc; font-size:0.95rem;">نیمه‌شب (Dark)</strong>
										</div>
										<span style="background:#312e81; color:#c7d2fe; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">کاملاً تیره</span>
									</div>
									<span style="font-size:0.78rem; color:#94a3b8; line-height:1.5;">پس‌زمینه تیره، کنتراست بالا، مناسب گجت و برندهای تکنولوژی.</span>
								</label>

								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'minimal' ? '#0f172a' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#ffffff; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="minimal" <?php checked( ( $opts['store_template'] ?? '' ), 'minimal' ); ?>>
											<strong style="color:#0f172a; font-size:0.95rem;">مینیمال سفید</strong>
										</div>
										<span style="background:#f1f5f9; color:#334155; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">ساده و لوکس</span>
									</div>
									<span style="font-size:0.78rem; color:#64748b; line-height:1.5;">فضای زیاد سفید، تایپوگرافی قوی، کارت‌های تخت بدون سایه سنگین.</span>
								</label>

								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'bazaar' ? '#ea580c' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#fff7ed; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="bazaar" <?php checked( ( $opts['store_template'] ?? '' ), 'bazaar' ); ?>>
											<strong style="color:#c2410c; font-size:0.95rem;">بازار سنتی</strong>
										</div>
										<span style="background:#ffedd5; color:#9a3412; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">گرم و شلوغ</span>
									</div>
									<span style="font-size:0.78rem; color:#9a3412; line-height:1.5;">الهام از بازار ایرانی: رنگ‌های گرم، بج‌های تخفیف درشت، کارت‌های شلوغ.</span>
								</label>

								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'boutique' ? '#be185d' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#fdf2f8; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<input type="radio" name="store_template" value="boutique" <?php checked( ( $opts['store_template'] ?? '' ), 'boutique' ); ?>>
											<strong style="color:#be185d; font-size:0.95rem;">بوتیک مد</strong>
										</div>
										<span style="background:#fce7f3; color:#9d174d; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800;">فشن</span>
									</div>
									<span style="font-size:0.78rem; color:#9d174d; line-height:1.5;">ظاهر فشن‌مگزین: تصاویر بزرگ، فونت ظریف، هدر باریک و شیک.</span>
								</label>
								<!-- فروشگاه بومی وردپرس -->
								<label style="border:2px solid <?php echo ( $opts['store_template'] ?? '' ) === 'native-wp' ? '#2563eb' : '#e2e8f0'; ?>; border-radius:12px; padding:14px; background:#eff6ff; cursor:pointer; display:flex; flex-direction:column; gap:8px;">
									<div style="display:flex; justify-content:space-between; align-items:center;">
										<span style="font-weight:900; color:#1e3a8a;">🧱 فروشگاه بومی وردپرس</span>
										<input type="radio" name="store_template" value="native-wp" <?php checked( ( $opts['store_template'] ?? '' ), 'native-wp' ); ?>>
									</div>
									<div style="font-size:0.8rem; color:#334155; line-height:1.7;">
										فقط وقتی می‌خواهید <strong>کل ویترین</strong> با پوستهٔ وردپرس باشد این را بزنید. برای ویترین React (پیشنهادی) یکی از پوسته‌های بالا را نگه دارید؛ پشتیبان جداگانه در باکس پایین ساخته می‌شود.
									</div>
								</label>
							</div>
						</div>

						<!-- Color Presets Visual Swatches -->
						<div style="margin-bottom:24px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:20px;">
							<h4 style="margin:0 0 6px; font-size:1.05rem; color:#0f172a; font-weight:800;">🎨 پلت‌های رنگی جذاب (Color Palettes)</h4>
							<p style="margin:0 0 14px; font-size:0.85rem; color:#64748b;">
								روی هر پالت کلیک کنید تا رنگ تاکید فروشگاه فوراً به‌روز شود:
							</p>

							<div style="display:flex; gap:10px; flex-wrap:wrap;">
								<?php 
								$palettes = array(
									'digikala-red'       => array( 'title' => 'قرمز دیجی‌کالا', 'hex' => '#ef394e' ),
									'snapp-green'        => array( 'title' => 'سبز اسنپ', 'hex' => '#00c073' ),
									'basalam-coral'      => array( 'title' => 'مرجانی باسلام', 'hex' => '#df3826' ),
									'torob-red'          => array( 'title' => 'قرمز ترب', 'hex' => '#d32f2f' ),
									'digistyle-rose'     => array( 'title' => 'رز دیجی‌استایل', 'hex' => '#e11d48' ),
									'technolife-blue'    => array( 'title' => 'آبی تکنولایف', 'hex' => '#0284c7' ),
									'royal-blue'         => array( 'title' => 'آبی سلطنتی', 'hex' => '#2563eb' ),
									'luxury-purple'      => array( 'title' => 'بنفش لوکس', 'hex' => '#7c3aed' ),
									'amber-gold'         => array( 'title' => 'طلایی کهربایی', 'hex' => '#d97706' ),
									'persian-turquoise'  => array( 'title' => 'فیروزه‌ای ایرانی', 'hex' => '#0d9488' ),
									'midnight-ink'       => array( 'title' => 'مرکب نیمه‌شب', 'hex' => '#6366f1' ),
									'forest'             => array( 'title' => 'جنگل عمیق', 'hex' => '#16a34a' ),
									'sunset'             => array( 'title' => 'غروب گرم', 'hex' => '#f97316' ),
								);
								$active_pal = $opts['store_palette'] ?? 'digikala-red';
								foreach ( $palettes as $p_key => $p_data ) :
									$is_sel = ( $active_pal === $p_key );
								?>
									<label style="display:inline-flex; align-items:center; gap:6px; background:#fff; border:2px solid <?php echo $is_sel ? $p_data['hex'] : '#cbd5e1'; ?>; padding:6px 12px; border-radius:20px; cursor:pointer; transition:all 0.2s;">
										<input type="radio" name="store_palette" value="<?php echo esc_attr( $p_key ); ?>" <?php checked( $active_pal, $p_key ); ?> onchange="document.querySelector('input[name=accent_color]').value='<?php echo esc_js( $p_data['hex'] ); ?>';">
										<span style="width:14px; height:14px; border-radius:50%; background:<?php echo esc_attr( $p_data['hex'] ); ?>; display:inline-block;"></span>
										<span style="font-size:0.8rem; font-weight:700; color:#334155;"><?php echo esc_html( $p_data['title'] ); ?></span>
									</label>
								<?php endforeach; ?>
							</div>
						</div>

						<table class="form-table">
							<tr>
								<th scope="row">جایگزینی سربرگ قالب با سربرگ لوکس:</th>
								<td>
									<label>
										<input type="checkbox" name="replace_site_header" value="1" <?php checked( $opts['replace_site_header'] ); ?>>
										سربرگ قالب فعلی در صفحه فروشگاه با سربرگ فروشگاهی مدرن، مگامنو دسته‌بندی و ناوبری ویژه جایگزین شود.
									</label>
								</td>
							</tr>
							<tr>
								<th scope="row">نوار اعلان بالایی (Top Bar):</th>
								<td>
									<label>
										<input type="checkbox" name="show_top_bar" value="1" <?php checked( $opts['show_top_bar'] ); ?>>
										نمایش نوار باریک اطلاع‌رسانی، تماس و ارسال رایگان در بالاترین نقطه سربرگ
									</label>
								</td>
							</tr>
							<tr>
								<th scope="row">متن نوار اعلان بالایی:</th>
								<td>
									<input type="text" name="top_bar_notice" value="<?php echo esc_attr( $opts['top_bar_notice'] ); ?>" class="large-text">
								</td>
							</tr>
							<tr>
								<th scope="row">عنوان فروشگاه (Brand Title):</th>
								<td>
									<input type="text" name="shop_title" id="shopTitleInput" value="<?php echo esc_attr( $opts['shop_title'] ); ?>" class="large-text" placeholder="نام فروشگاه">
								</td>
							</tr>
							<tr>
								<th scope="row">فونت عنوان فروشگاه (Title Font):</th>
								<td>
									<select name="shop_title_font" id="shopTitleFontSelect" class="regular-text" style="font-weight:700;">
										<option value="vazirmatn" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'vazirmatn' ); ?>>وزیرمتن (Vazirmatn - وب‌فونت رسمی و استاندارد گوگل)</option>
										<option value="iranyekan" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'iranyekan' ); ?>>ایران‌یکان (IRANYekan - استایل دیجی‌کالا و اسنپ)</option>
										<option value="dana" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'dana' ); ?>>دانا (Dana - هندسی، مدرن و پرطرفدار)</option>
										<option value="yekanbakh" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'yekanbakh' ); ?>>یکان‌بخ (Yekan Bakh - لوکس و شکیل مخصوص تیترها)</option>
										<option value="shabnam" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'shabnam' ); ?>>شبنم (Shabnam - گوشه‌های گرد، صمیمی و دلنشین)</option>
										<option value="sahel" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'sahel' ); ?>>ساحل (Sahel - آراسته، خوانا و کلاسیک)</option>
										<option value="iransans" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'iransans' ); ?>>ایران‌سنس (IRANSans - متداول و رسمی)</option>
										<option value="morabba" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'morabba' ); ?>>مربع (Morabba - پرانرژی و فانتزی برای برندینگ)</option>
										<option value="parastoo" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'parastoo' ); ?>>پرستو (Parastoo - شیک و چشم‌نواز)</option>
										<option value="system" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'system' ); ?>>سیستمی (System UI / Tahoma / Segoe UI)</option>
										<option value="custom" <?php selected( $opts['shop_title_font'] ?? 'vazirmatn', 'custom' ); ?>>فونت سفارشی دلخواه (Custom Font Family)</option>
									</select>
									<p class="description">فونت انتخابی به طور یکپارچه روی عنوان اصلی سربرگ، بنر هیرو، منوی کشویی و فوتر فروشگاه اعمال می‌شود.</p>
								</td>
							</tr>
							<tr id="customFontRow" style="<?php echo ( ( $opts['shop_title_font'] ?? '' ) === 'custom' ) ? '' : 'display:none;'; ?>">
								<th scope="row">نام فونت سفارشی:</th>
								<td>
									<input type="text" name="shop_title_custom_font" id="customFontInput" value="<?php echo esc_attr( $opts['shop_title_custom_font'] ?? '' ); ?>" class="regular-text" placeholder="مثال: Shabnam, Sahel, B Yekan">
									<p class="description">نام فونت را به انگلیسی وارد فرمایید. در صورت نصب بودن روی سیستم یا پوسته لود خواهد شد.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">اندازه فونت عنوان فروشگاه:</th>
								<td>
									<select name="shop_title_font_size" id="shopTitleSizeSelect" class="regular-text">
										<option value="small" <?php selected( $opts['shop_title_font_size'] ?? 'normal', 'small' ); ?>>جمع و جور (کوچک - ۱.۱۸rem)</option>
										<option value="normal" <?php selected( $opts['shop_title_font_size'] ?? 'normal', 'normal' ); ?>>استاندارد (۱.۳۸rem - پیش‌فرض توصیه شده)</option>
										<option value="large" <?php selected( $opts['shop_title_font_size'] ?? 'normal', 'large' ); ?>>بزرگ و برجسته (۱.۶۵rem)</option>
										<option value="xlarge" <?php selected( $opts['shop_title_font_size'] ?? 'normal', 'xlarge' ); ?>>خیلی بزرگ و چشمگیر (۱.۹۵rem)</option>
									</select>
								</td>
							</tr>
							<tr>
								<th scope="row">ضخامت و وزن فونت عنوان:</th>
								<td>
									<select name="shop_title_font_weight" id="shopTitleWeightSelect" class="regular-text">
										<option value="500" <?php selected( $opts['shop_title_font_weight'] ?? '900', '500' ); ?>>متوسط (Medium - ۵۰۰)</option>
										<option value="700" <?php selected( $opts['shop_title_font_weight'] ?? '900', '700' ); ?>>ضخیم (Bold - ۷۰۰)</option>
										<option value="800" <?php selected( $opts['shop_title_font_weight'] ?? '900', '800' ); ?>>خیلی ضخیم (Extra Bold - ۸۰۰)</option>
										<option value="900" <?php selected( $opts['shop_title_font_weight'] ?? '900', '900' ); ?>>فوق‌العاده توپر / بلک (Black - ۹۰۰ پیش‌فرض)</option>
									</select>
								</td>
							</tr>
							<tr>
								<th scope="row">پیش‌نمایش زنده عنوان فروشگاه:</th>
								<td>
									<div id="shopTitleLivePreviewCard" style="background:#ffffff; border:1.5px solid #cbd5e1; border-radius:14px; padding:16px 20px; display:inline-flex; align-items:center; gap:14px; box-shadow:0 4px 15px rgba(0,0,0,0.04); min-width:320px; max-width:100%;">
										<div style="width:44px; height:44px; border-radius:12px; background:linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; flex-shrink:0;">
											🛍️
										</div>
										<div>
											<div id="previewTitleText" style="font-size:1.38rem; font-weight:900; color:#0f172a; line-height:1.2;">
												<?php echo esc_html( $opts['shop_title'] ); ?>
											</div>
											<div id="previewSubtitleText" style="font-size:0.8rem; color:#64748b; margin-top:2px;">
												<?php echo esc_html( $opts['shop_subtitle'] ); ?>
											</div>
										</div>
									</div>
									<p class="description">با تغییر فونت، اندازه یا ویرایش متن، پیش‌نمایش به صورت لحظه‌ای و خودکار به‌روزرسانی می‌شود.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">هدر و منوی چسبان (Sticky Header):</th>
								<td>
									<label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
										<input type="checkbox" name="sticky_header" value="1" <?php checked( ! empty( $opts['sticky_header'] ) ); ?> style="width:18px; height:18px; accent-color:#2563eb;">
										<strong style="color:#0f172a;">📌 ثابت و چسبان ماندن هدر و منو در بالای صفحه هنگام اسکرول (Sticky Header & Menu)</strong>
									</label>
									<p class="description">هنگام اسکرول صفحه به سمت پایین، هدر اصلی شامل جستجوی زنده، دکمه‌های ورود، سبد خرید، منوی دسترسی و نوار دسته‌بندی‌ها به بالای صفحه می‌چسبند تا دسترسی همیشگی برای مشتری فراهم باشد.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">زیرعنوان و شعار فروشگاه:</th>
								<td>
									<input type="text" name="shop_subtitle" id="shopSubtitleInput" value="<?php echo esc_attr( $opts['shop_subtitle'] ); ?>" class="large-text">
								</td>
							</tr>
							<tr>
								<th scope="row">شماره تماس پشتیبانی و ساعات کاری:</th>
								<td>
									<input type="text" name="contact_phone" value="<?php echo esc_attr( $opts['contact_phone'] ); ?>" class="regular-text" placeholder="۰۲۱-۱۲۳۴۵۶۷۸" dir="ltr" style="margin-left:10px;">
									<input type="text" name="support_hours" value="<?php echo esc_attr( $opts['support_hours'] ); ?>" class="regular-text" placeholder="پاسخگویی ۹ الی ۲۲">
								</td>
							</tr>
							<tr>
								<th scope="row">رنگ اصلی تم (Accent Color):</th>
								<td>
									<input type="color" name="accent_color" value="<?php echo esc_attr( $opts['accent_color'] ); ?>" style="width:60px; height:36px; border-radius:8px; cursor:pointer;">
								</td>
							</tr>
							<tr>
								<th scope="row">چیدمان پیش‌فرض ستون‌ها:</th>
								<td>
									<select name="default_column_layout" class="regular-text">
										<option value="1" <?php selected( $opts['default_column_layout'] ?? '1', '1' ); ?>>تک ستونه (پیش‌فرض سفارش شده)</option>
										<option value="2" <?php selected( $opts['default_column_layout'] ?? '1', '2' ); ?>>دو ستونه</option>
									</select>
									<p class="description">مشتری در ویترین می‌تواند از طریق دکمه‌های چیدمان، تعداد ستون‌ها را به دلخواه تغییر دهد.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">تعداد محصولات در هر صفحه (صفحه‌بندی):</th>
								<td>
									<input type="number" name="products_per_page" value="<?php echo esc_attr( $opts['products_per_page'] ?? 20 ); ?>" class="small-text"> کالا
									<p class="description">پیش‌فرض: ۲۰ کالا در هر صفحه همراه با دکمه‌های شماره صفحه.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">سقف ارسال رایگان (تومان):</th>
								<td>
									<input type="number" name="free_shipping_threshold" value="<?php echo esc_attr( $opts['free_shipping_threshold'] ); ?>" class="regular-text"> تومان
									<p class="description">نوار پیشرفت در سبد خرید کشویی انگیزه خرید تا این سقف را به مشتری نشان می‌دهد.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">نشان‌های اعتماد و پیشنهاد ویژه:</th>
								<td>
									<label style="display:block; margin-bottom:8px;">
										<input type="checkbox" name="show_special_badge" value="1" <?php checked( ! empty( $opts['show_special_badge'] ) ); ?>>
										نمایش نشان «پیشنهاد ویژه» روی کارت کالا
									</label>
									<label style="display:block; margin-bottom:8px;">
										<input type="checkbox" name="show_features_banner" value="1" <?php checked( $opts['show_features_banner'] ); ?>>
										نمایش بنر ویژگی‌های فروشگاه (ارسال سریع، تضمین اصالت و ضمانت بازگشت)
									</label>
									<label style="display:block; margin-top:8px;">
										<input type="checkbox" name="show_animated_stats" value="1" <?php checked( ! empty( $opts['show_animated_stats'] ) ); ?> style="accent-color:#2563eb;">
										<strong style="color:#0f172a;">✨ نمایش شماره‌های جذاب انیمیشن‌دار در صفحه فروشگاه (اعتماد خریداران و رضایت مشتریان)</strong>
									</label>
								</td>
							</tr>
							<tr>
								<th scope="row">جایگزینی صفحه نخست وب‌سایت (Home Page):</th>
								<td>
									<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:#ecfdf5;border:2px solid #10b981;border-radius:12px;font-weight:800;">
										<span style="font-size:1.4rem;line-height:1;">🏠</span>
										<span>صفحهٔ <strong>اصلی دامنه (Home / /)</strong> = ویترین React اختصاصی<br>
										<span style="font-size:0.82rem;font-weight:700;color:#047857;">از v13.3.32 با روشن بودن «ویترین React» صفحهٔ خانه خودکار React است — نه آدرس فرعی.</span></span>
										<input type="hidden" name="takeover_front_page" value="1">
									</div>
								</td>
							</tr>
						</table>
					</div>

						
						<!-- v13.3.32 قالب بومی وردپرس + برگه پشتیبان -->
						<div style="margin:20px 0 24px; background:linear-gradient(135deg,#f8fafc,#eff6ff); border:1px solid #93c5fd; border-radius:14px; padding:20px;">
							<h4 style="margin:0 0 8px; font-size:1.08rem; color:#1e3a8a;">🧱 قالب بومی وردپرس + برگهٔ پشتیبان فروشگاه</h4>
							<p style="margin:0 0 14px; color:#1e40af; font-size:0.85rem; line-height:1.85;">
								<strong>ویترین اصلی</strong> همان فروشگاه React است (دیجی‌کالا/اسنپ‌شاپ/…). این بخش فقط یک
								<strong>برگهٔ پشتیبان</strong> با قالب بومی وردپرس می‌سازد تا در خطای ۴۰۴ یا خرابی ویترین، مشتری جایی برای خرید داشته باشد.
								عنوان «نام‌فروشگاه — پشتیبان» طبیعی است و <em>نباید</em> جای ویترین اصلی را بگیرد.
							</p>
							<p style="margin:0 0 14px; padding:10px 12px; background:#fef3c7; border:1px solid #f59e0b; border-radius:10px; color:#92400e; font-size:0.82rem; font-weight:700; line-height:1.7;">
								⚠️ اگر با رفرش فقط صفحهٔ «… — پشتیبان» می‌بینید: قالب ویترین را روی native نگذارید، تیک «صفحه فروشگاه ووکامرس = پشتیبان» را خاموش کنید، ذخیره کنید. از v13.3.32 افزونه خودش پشتیبان را از فروشگاه اصلی جدا می‌کند.
							</p>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:800; color:#0f172a;">
								<input type="checkbox" name="enable_native_wp_template" value="1" <?php checked( ! isset( $opts['enable_native_wp_template'] ) || ! empty( $opts['enable_native_wp_template'] ) ); ?> style="width:18px;height:18px;accent-color:#2563eb;">
								فعال‌سازی قالب بومی وردپرس (سربرگ و پاصفحهٔ پوسته)
							</label>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:700; color:#334155;">
								<input type="checkbox" name="auto_create_fallback_page" value="1" <?php checked( ! isset( $opts['auto_create_fallback_page'] ) || ! empty( $opts['auto_create_fallback_page'] ) ); ?>>
								ساخت خودکار برگهٔ پشتیبان فروشگاه
							</label>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:700; color:#334155;">
								<input type="checkbox" name="enable_404_shop_redirect" value="1" <?php checked( ! isset( $opts['enable_404_shop_redirect'] ) || ! empty( $opts['enable_404_shop_redirect'] ) ); ?>>
								هدایت خطای چهارصدوچهار به برگهٔ پشتیبان فروشگاه
							</label>
							<div id="amphp-wc-fallback-bind" style="margin:12px 0 14px; padding:12px 14px; background:#fff7ed; border:1px dashed #fb923c; border-radius:10px;">
								<p style="margin:0; font-size:0.86rem; font-weight:800; color:#9a3412; line-height:1.7;">
									🟧 تیک «صفحه فروشگاه ووکامرس = پشتیبان» را <a href="#amphp-wc-shop-fallback-card" style="color:#c2410c;text-decoration:underline;">بالای همین تب ویترین</a> (کارت نارنجی، زیر بنر وضعیت) ببینید و تغییر دهید.
									وضعیت: <strong><?php echo ! empty( $opts['set_wc_shop_to_fallback'] ) ? 'روشن' : 'خاموش'; ?></strong>
								</p>
							</div>
							<?php
							$fb_id  = intval( $opts['native_fallback_page_id'] ?? get_option( 'scraper_native_fallback_page_id', 0 ) );
							$fb_url = $fb_id ? get_permalink( $fb_id ) : '';
							$pages  = get_pages( array( 'sort_column' => 'post_title', 'post_status' => 'publish' ) );
							?>
							<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">برگهٔ پشتیبان فروشگاه</label>
							<select name="native_fallback_page_id" style="width:100%; max-width:480px; margin-bottom:10px;">
								<option value="0">— ساخت یا انتخاب خودکار —</option>
								<?php foreach ( (array) $pages as $pg ) : ?>
									<option value="<?php echo esc_attr( $pg->ID ); ?>" <?php selected( $fb_id, (int) $pg->ID ); ?>>
										<?php echo esc_html( $pg->post_title . ' (#' . $pg->ID . ')' ); ?>
									</option>
								<?php endforeach; ?>
							</select>
							<?php if ( $fb_url ) : ?>
								<p style="margin:0 0 10px; font-size:0.84rem; color:#0f172a;">
									🔗 آدرس فعلی:
									<a href="<?php echo esc_url( $fb_url ); ?>" target="_blank" rel="noopener" style="font-weight:800;"><?php echo esc_html( $fb_url ); ?></a>
									· قالب: <code>فروشگاه بومی وردپرس</code>
								</p>
							<?php else : ?>
								<p style="margin:0 0 10px; font-size:0.84rem; color:#b45309; font-weight:700;">هنوز برگهٔ پشتیبان تنظیم نشده — با دکمهٔ زیر بسازید یا تنظیمات را ذخیره کنید.</p>
							<?php endif; ?>
							<button type="button" class="button button-primary" id="amphpEnsureFallbackBtn">🛠 ساخت یا تعمیر برگهٔ پشتیبان الان</button>
							<span id="amphpEnsureFallbackStatus" style="margin-right:10px;font-weight:700;color:#1e40af;"></span>
							<script>
							(function(){
							  var btn=document.getElementById('amphpEnsureFallbackBtn');
							  var st=document.getElementById('amphpEnsureFallbackStatus');
							  if(!btn) return;
							  btn.addEventListener('click', function(){
							    btn.disabled=true; st.textContent='در حال ایجاد…';
							    var fd=new FormData();
							    fd.append('action','scraper_ensure_fallback_shop');
							    fd.append('nonce','<?php echo esc_js( wp_create_nonce( "scraper_shop_admin_nonce" ) ); ?>');
							    fd.append('assign_wc', (document.getElementById('amphpWcFbHidden')||{}).value==='1' || document.getElementById('chkWcShopFallback')?.checked ? '1' : '');
							    fetch(ajaxurl,{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){
							      btn.disabled=false;
							      if(d && d.success){
							        st.textContent = (d.data && d.data.message ? d.data.message : 'انجام شد') + (d.data && d.data.url ? ' — ' + d.data.url : '');
							        if(d.data && d.data.id){
							          var sel=document.querySelector('[name="native_fallback_page_id"]');
							          if(sel){ sel.value=String(d.data.id); }
							        }
							      } else {
							        st.textContent = (d && d.data) ? d.data : 'خطا';
							      }
							    }).catch(function(){ btn.disabled=false; st.textContent='خطا در ارتباط با سرور'; });
							  });
							})();
							</script>
						</div>

<!-- Custom Checkout Settings -->
						<div style="margin:20px 0 24px; background:linear-gradient(135deg,#f0fdf4,#ecfeff); border:1px solid #86efac; border-radius:14px; padding:20px;">
							<h4 style="margin:0 0 8px; font-size:1.08rem; color:#14532d;">🛒 صفحه تسویه حساب اختصاصی (React)</h4>
							<p style="margin:0 0 14px; color:#166534; font-size:0.88rem; line-height:1.7;">
								با فعال‌سازی، به‌جای هدایت مستقیم به چک‌اوت ووکامرس، صفحه تسویه زیبا داخل ویترین باز می‌شود و <strong>تمام درگاه‌های فعال ووکامرس/وردپرس</strong> لیست می‌شوند.
							</p>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:14px; font-weight:800; color:#0f172a;">
								<input type="checkbox" name="enable_custom_checkout" value="1" <?php checked( ! empty( $opts['enable_custom_checkout'] ) ); ?> style="width:18px;height:18px;accent-color:#16a34a;">
								فعال‌سازی صفحه چک‌اوت اختصاصی
							</label>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:14px; font-weight:700; color:#334155;">
								<input type="checkbox" name="checkout_require_login" value="1" <?php checked( ! empty( $opts['checkout_require_login'] ) ); ?>>
								فقط کاربران واردشده بتوانند سفارش ثبت کنند
							</label>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:14px; font-weight:700; color:#334155;">
								<input type="checkbox" name="checkout_show_gateways" value="1" <?php checked( ! isset( $opts['checkout_show_gateways'] ) || ! empty( $opts['checkout_show_gateways'] ) ); ?>>
								نمایش همه درگاه‌های پرداخت فعال ووکامرس
							</label>
							<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
								<div>
									<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">عنوان صفحه تسویه</label>
									<input type="text" name="checkout_title" class="regular-text" style="width:100%;" value="<?php echo esc_attr( $opts['checkout_title'] ?? 'تسویه حساب امن' ); ?>">
								</div>
								<div>
									<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">برچسب COD (در صورت نبود درگاه)</label>
									<input type="text" name="checkout_cod_label" class="regular-text" style="width:100%;" value="<?php echo esc_attr( $opts['checkout_cod_label'] ?? 'پرداخت در محل (COD)' ); ?>">
								</div>
							</div>
							<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">توضیح زیر عنوان</label>
							<textarea name="checkout_note" rows="2" style="width:100%; border-radius:8px; padding:8px;"><?php echo esc_textarea( $opts['checkout_note'] ?? '' ); ?></textarea>
							<label style="font-weight:800; font-size:0.85rem; display:block; margin:12px 0 4px;">پیام موفقیت پس از ثبت سفارش</label>
							<textarea name="checkout_success_msg" rows="2" style="width:100%; border-radius:8px; padding:8px;"><?php echo esc_textarea( $opts['checkout_success_msg'] ?? 'سفارش شما با موفقیت ثبت شد. از خریدتان سپاسگزاریم!' ); ?></textarea>

							<h5 style="margin:16px 0 8px; color:#14532d;">فیلدهای فرم تسویه (نمایش / اجباری)</h5>
							<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px;">
								<?php
								$co_fields = array(
									'name'     => 'نام و نام خانوادگی',
									'phone'    => 'موبایل',
									'email'    => 'ایمیل',
									'province' => 'استان',
									'city'     => 'شهر',
									'address'  => 'آدرس کامل',
									'postal'   => 'کد پستی',
									'notes'    => 'توضیحات سفارش',
								);
								foreach ( $co_fields as $fk => $flabel ) :
									$en_key  = 'checkout_field_' . $fk;
									$req_key = 'checkout_field_' . $fk . '_req';
									$en_val  = ! isset( $opts[ $en_key ] ) ? in_array( $fk, array( 'name', 'phone', 'province', 'city', 'address' ), true ) : ! empty( $opts[ $en_key ] );
									$req_val = ! empty( $opts[ $req_key ] );
									?>
									<div style="background:#fff; border:1px solid #bbf7d0; border-radius:10px; padding:10px 12px;">
										<div style="font-weight:800; margin-bottom:6px; color:#0f172a;"><?php echo esc_html( $flabel ); ?></div>
										<label style="display:flex; gap:6px; align-items:center; font-size:0.82rem; margin-bottom:4px;">
											<input type="checkbox" name="<?php echo esc_attr( $en_key ); ?>" value="1" <?php checked( $en_val ); ?>> نمایش
										</label>
										<label style="display:flex; gap:6px; align-items:center; font-size:0.82rem;">
											<input type="checkbox" name="<?php echo esc_attr( $req_key ); ?>" value="1" <?php checked( $req_val ); ?>> اجباری
										</label>
									</div>
								<?php endforeach; ?>
							</div>

							<h5 style="margin:18px 0 8px; color:#14532d;">🚚 ارسال، نقشه نشان و هزینه پستی</h5>
							<p style="margin:0 0 12px; color:#166534; font-size:0.85rem; line-height:1.7;">
								شهرها بعد از انتخاب استان پر می‌شوند. روش‌های ارسال ووکامرس + پست/چاپار/تیپاکس در چک‌اوت نمایش داده می‌شوند.
								با کلید <strong>نشان (Neshan)</strong> از سرویس رسمی <strong>تبدیل مختصات به آدرس (Reverse Geocoding v5)</strong> استفاده می‌شود: با کلیک/درگ روی نقشه، آدرس کامل، استان و شهر از نشان پر می‌شود.
							</p>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:700; color:#334155;">
								<input type="checkbox" name="checkout_show_shipping" value="1" <?php checked( ! isset( $opts['checkout_show_shipping'] ) || ! empty( $opts['checkout_show_shipping'] ) ); ?>>
								نمایش روش‌های ارسال در تسویه حساب
							</label>
							<label style="display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:700; color:#334155;">
								<input type="checkbox" name="checkout_show_map" value="1" <?php checked( ! isset( $opts['checkout_show_map'] ) || ! empty( $opts['checkout_show_map'] ) ); ?>>
								نمایش نقشه انتخاب مقصد (نشان)
							</label>
							<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
								<div>
									<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">کلید API نشان (Neshan)</label>
									<input type="text" name="neshan_api_key" class="regular-text" style="width:100%;" dir="ltr" placeholder="service.xxxxx" value="<?php echo esc_attr( $opts['neshan_api_key'] ?? '' ); ?>">
									<small style="color:#64748b;">از platform.neshan.org/panel — کلید سرویس Reverse Geocoding. روی سرور می‌ماند (هدر Api-Key) و به فرانت نمی‌رود.</small>
								</div>
								<div>
									<label style="font-weight:800; font-size:0.85rem; display:block; margin-bottom:4px;">شهر مبدأ ارسال</label>
									<input type="text" name="shipping_origin_city" class="regular-text" style="width:100%;" value="<?php echo esc_attr( $opts['shipping_origin_city'] ?? 'تهران' ); ?>">
								</div>
							</div>
							<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:12px;">
								<label style="font-weight:700; font-size:0.82rem;">مبدأ lat
									<input type="text" name="shipping_origin_lat" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_origin_lat'] ?? '35.6892' ); ?>">
								</label>
								<label style="font-weight:700; font-size:0.82rem;">مبدأ lng
									<input type="text" name="shipping_origin_lng" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_origin_lng'] ?? '51.3890' ); ?>">
								</label>
								<label style="font-weight:700; font-size:0.82rem;">هزینه هر کیلو (تخمین)
									<input type="number" name="shipping_per_kg" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_per_kg'] ?? 12000 ); ?>">
								</label>
							</div>
							<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:8px;">
								<div style="background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:10px;">
									<label style="display:flex;gap:6px;align-items:center;font-weight:800;margin-bottom:8px;">
										<input type="checkbox" name="post_shipping_enabled" value="1" <?php checked( ! isset( $opts['post_shipping_enabled'] ) || ! empty( $opts['post_shipping_enabled'] ) ); ?>> پست پیشتاز
									</label>
									<label style="font-size:0.78rem;font-weight:700;">پایه (تومان)
										<input type="number" name="shipping_base_post" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_base_post'] ?? 45000 ); ?>">
									</label>
									<label style="font-size:0.78rem;font-weight:700;margin-top:6px;display:block;">توکن API (اختیاری)
										<input type="text" name="post_api_token" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['post_api_token'] ?? '' ); ?>">
									</label>
								</div>
								<div style="background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:10px;">
									<label style="display:flex;gap:6px;align-items:center;font-weight:800;margin-bottom:8px;">
										<input type="checkbox" name="chapar_shipping_enabled" value="1" <?php checked( ! isset( $opts['chapar_shipping_enabled'] ) || ! empty( $opts['chapar_shipping_enabled'] ) ); ?>> چاپار
									</label>
									<label style="font-size:0.78rem;font-weight:700;">پایه (تومان)
										<input type="number" name="shipping_base_chapar" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_base_chapar'] ?? 65000 ); ?>">
									</label>
									<label style="font-size:0.78rem;font-weight:700;margin-top:6px;display:block;">توکن API (اختیاری)
										<input type="text" name="chapar_api_token" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['chapar_api_token'] ?? '' ); ?>">
									</label>
								</div>
								<div style="background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:10px;">
									<label style="display:flex;gap:6px;align-items:center;font-weight:800;margin-bottom:8px;">
										<input type="checkbox" name="tipax_shipping_enabled" value="1" <?php checked( ! isset( $opts['tipax_shipping_enabled'] ) || ! empty( $opts['tipax_shipping_enabled'] ) ); ?>> تیپاکس
									</label>
									<label style="font-size:0.78rem;font-weight:700;">پایه (تومان)
										<input type="number" name="shipping_base_tipax" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['shipping_base_tipax'] ?? 75000 ); ?>">
									</label>
									<label style="font-size:0.78rem;font-weight:700;margin-top:6px;display:block;">توکن API (اختیاری)
										<input type="text" name="tipax_api_token" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['tipax_api_token'] ?? '' ); ?>">
									</label>
								</div>
							</div>
						</div>

				</div>

				<!-- ================= TAB 2: PRICING & PROFIT ================= -->
				<div id="tab-pricing" class="scraper-tab-panel">
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>💰</span> تنظیمات قیمت‌گذاری، درصد سود و گرد کردن قیمت‌ها</h3>
							<span class="field-badge field-badge-green">محاسبه خودکار</span>
						</div>

						<table class="form-table">
							<tr>
								<th scope="row">درصد سود و افزایش قیمت (Markup %):</th>
								<td>
									<input type="number" step="0.5" name="price_markup_percent" value="<?php echo esc_attr( $opts['price_markup_percent'] ); ?>" class="small-text"> ٪
									<p class="description">این درصد به قیمت خام استخراج شده اضافه می‌شود (مثلاً ۲۰٪ سود).</p>
								</td>
							</tr>
							<tr>
								<th scope="row">مبلغ ثابت اضافه شونده:</th>
								<td>
									<input type="number" name="price_fixed_add" value="<?php echo esc_attr( $opts['price_fixed_add'] ); ?>" class="regular-text"> تومان
									<p class="description">مبلغ ثابت اضافه به ازای هر محصول (مثلاً هزینه بسته‌بندی یا کارمزد).</p>
								</td>
							</tr>
							<tr>
								<th scope="row">قیمت پایه پیش‌فرض:</th>
								<td>
									<input type="number" name="default_fallback_price" value="<?php echo esc_attr( $opts['default_fallback_price'] ); ?>" class="regular-text"> تومان
									<p class="description">اگر کالایی در منبع بدون قیمت بود، از این قیمت پایه استفاده می‌شود تا عبارت «تماس بگیرید» ظاهر نشود.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">رفتار هنگام نبود قیمت:</th>
								<td>
									<select name="fallback_price_behavior" class="regular-text">
										<option value="use_fallback" <?php selected( $opts['fallback_price_behavior'], 'use_fallback' ); ?>>استفاده از قیمت پایه پیش‌فرض و نمایش قیمت (توصیه شده)</option>
										<option value="call_for_price" <?php selected( $opts['fallback_price_behavior'], 'call_for_price' ); ?>>نمایش عبارت «تماس بگیرید»</option>
									</select>
								</td>
							</tr>
							<tr>
								<th scope="row">گرد کردن قیمت‌ها:</th>
								<td>
									<select name="price_rounding" class="regular-text">
										<option value="none" <?php selected( $opts['price_rounding'], 'none' ); ?>>بدون گرد کردن</option>
										<option value="1000" <?php selected( $opts['price_rounding'], '1000' ); ?>>گرد کردن به نزدیک‌ترین ۱,۰۰۰ تومان (توصیه شده)</option>
										<option value="10000" <?php selected( $opts['price_rounding'], '10000' ); ?>>گرد کردن به نزدیک‌ترین ۱۰,۰۰۰ تومان</option>
									</select>
								</td>
							</tr>
							<tr>
								<th scope="row">واحد پول فروشگاه:</th>
								<td>
									<input type="text" name="currency_symbol" value="<?php echo esc_attr( $opts['currency_symbol'] ); ?>" class="regular-text">
								</td>
							</tr>
						</table>
					</div>
				</div>

				<!-- ================= TAB 3: CHAT & ADMIN LIVE SUPPORT DESK ================= -->
				<div id="tab-chat" class="scraper-tab-panel">
					
					<!-- 1. ADMIN LIVE CHAT SUPPORT DESK -->
					<div class="admin-card" style="border-top: 4px solid #2563eb; padding: 20px;">
						<div class="admin-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px; padding-bottom:12px;">
							<div>
								<h3 style="margin:0; display:flex; align-items:center; gap:8px; font-size:1.15rem; font-weight:800; color:#0f172a;">
									<span>📬</span> میز کار و کنسول پاسخگویی زنده به مشتریان
								</h3>
								<p style="margin:4px 0 0; color:#64748b; font-size:0.85rem;">
									پاسخ شما به صورت زنده در پنجره چت مشتری نمایش داده می‌شود و رشته گفتگو دوطرفه ادامه می‌یابد.
								</p>
							</div>
							<div style="display:flex; align-items:center; gap:10px;">
								<span class="field-badge field-badge-blue" id="deskThreadsCountBadge"><?php echo count( $chat_threads ); ?> گفتگو</span>
								<button type="button" class="button button-secondary button-small" id="btnRefreshAdminDesk" style="font-weight:700;">🔄 به‌روزرسانی زنده</button>
							</div>
						</div>

						<!-- Two-Column Desk Console (Organized & Responsive) -->
						<div class="scraper-support-desk" style="display:flex; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; background:#ffffff; height:620px; box-shadow:0 8px 24px rgba(15,23,42,0.06);">
							
							<!-- Column 1: Conversations List (Right Column in RTL) -->
							<div class="desk-threads-col" style="width:310px; border-left:1px solid #e2e8f0; display:flex; flex-direction:column; background:#f8fafc; height:100%; flex-shrink:0;">
								<!-- Search & Filter Bar -->
								<div style="padding:10px 12px; border-bottom:1px solid #e2e8f0; background:#ffffff;">
									<input type="text" id="deskSearchInput" placeholder="🔍 جستجو در نام، شماره یا پیام..." style="width:100%; border:1px solid #cbd5e1; border-radius:8px; padding:6px 10px; font-size:0.82rem; box-sizing:border-box;">
									<div style="display:flex; gap:4px; margin-top:8px;">
										<button type="button" class="desk-filter-btn active" data-filter="all" style="flex:1; border:1px solid #cbd5e1; background:#2563eb; color:#fff; border-radius:6px; padding:4px 2px; font-size:0.72rem; font-weight:700; cursor:pointer;">همه</button>
										<button type="button" class="desk-filter-btn" data-filter="pending" style="flex:1; border:1px solid #cbd5e1; background:#ffffff; border-radius:6px; padding:4px 2px; font-size:0.72rem; font-weight:700; cursor:pointer; color:#d97706;">در انتظار</button>
										<button type="button" class="desk-filter-btn" data-filter="replied" style="flex:1; border:1px solid #cbd5e1; background:#ffffff; border-radius:6px; padding:4px 2px; font-size:0.72rem; font-weight:700; cursor:pointer; color:#059669;">پاسخ‌داده</button>
									</div>
								</div>

								<!-- Threads Scroll List -->
								<div class="desk-threads-scroll" id="deskThreadsList" style="flex:1; overflow-y:auto; padding:0;">
									<?php if ( empty( $chat_threads ) ) : ?>
										<div style="text-align:center; padding:35px 15px; color:#94a3b8; font-size:0.85rem;">
											💬 هنوز پیامی از سمت مشتریان ارسال نشده است.
										</div>
									<?php else : ?>
										<?php foreach ( $chat_threads as $t_id => $t ) : 
											$msgs = $t['messages'] ?? array();
											$last_msg = ! empty( $msgs ) ? end( $msgs ) : null;
											$is_unread = ! empty( $t['unread_admin'] ) || ( ( $t['status'] ?? '' ) === 'pending' );
										?>
											<div class="desk-thread-item <?php echo $is_unread ? 'unread' : ''; ?>" 
												data-id="<?php echo esc_attr( $t['id'] ?? $t_id ); ?>" 
												data-session="<?php echo esc_attr( $t['session_id'] ?? '' ); ?>"
												data-name="<?php echo esc_attr( $t['name'] ?? 'مشتری' ); ?>"
												data-phone="<?php echo esc_attr( $t['phone'] ?? '' ); ?>"
												data-email="<?php echo esc_attr( $t['email'] ?? '' ); ?>"
												data-subject="<?php echo esc_attr( $t['subject'] ?? '' ); ?>"
												data-status="<?php echo esc_attr( $t['status'] ?? 'pending' ); ?>"
												style="padding:10px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.15s; position:relative;">
												<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
													<strong style="color:#0f172a; font-size:0.88rem;"><?php echo esc_html( $t['name'] ?? 'مشتری مهمان' ); ?></strong>
													<span style="font-size:0.7rem; color:#94a3b8;"><?php echo esc_html( $last_msg['time'] ?? '' ); ?></span>
												</div>
												<?php if ( ! empty( $t['phone'] ) ) : ?>
													<div style="font-size:0.75rem; color:#2563eb; font-weight:700; direction:ltr; text-align:right; margin-bottom:3px;"><?php echo esc_html( $t['phone'] ); ?></div>
												<?php endif; ?>
												<div style="font-size:0.78rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
													<?php echo esc_html( mb_substr( $last_msg['text'] ?? 'بدون متن', 0, 45 ) ); ?>
												</div>
												<div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
													<?php if ( $is_unread ) : ?>
														<span style="font-size:0.68rem; font-weight:800; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:6px;">⏳ نیاز به پاسخ</span>
													<?php else : ?>
														<span style="font-size:0.68rem; font-weight:800; background:#ecfdf5; color:#047857; padding:2px 6px; border-radius:6px;">✅ پاسخ داده شد</span>
													<?php endif; ?>
													<span style="font-size:0.7rem; color:#94a3b8;"><?php echo count( $msgs ); ?> پیام</span>
												</div>
											</div>
										<?php endforeach; ?>
									<?php endif; ?>
								</div>
							</div>

							<!-- Column 2: Conversation View & Reply (Left Column in RTL) -->
							<div class="desk-view-col" style="flex:1; display:flex; flex-direction:column; background:#ffffff; height:100%; min-width:0;">
								
								<!-- Empty State (Shown before a thread is selected) -->
								<div id="deskEmptyState" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; color:#94a3b8; text-align:center;">
									<div style="font-size:2.8rem; margin-bottom:10px;">💬</div>
									<h4 style="margin:0 0 6px; font-size:1.05rem; color:#475569; font-weight:800;">گفتگویی انتخاب نشده است</h4>
									<p style="margin:0; font-size:0.85rem; max-width:320px; line-height:1.5;">جهت مشاهده مکالمه و پاسخ به مشتری، یک گفتگو را از ستون کناری انتخاب نمایید.</p>
								</div>

								<!-- Active Conversation Box -->
								<div id="deskActiveBox" style="display:none; flex-direction:column; height:100%; min-width:0;">
									
									<!-- Customer Card Header -->
									<div style="padding:10px 16px; border-bottom:1px solid #e2e8f0; background:#f8fafc; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
										<div>
											<div style="display:flex; align-items:center; gap:8px;">
												<button type="button" id="btnDeskBackToList" class="button button-small" style="display:none;">◀ لیست</button>
												<h4 style="margin:0; font-size:0.98rem; font-weight:800; color:#0f172a;" id="deskHeaderName">نام مشتری</h4>
												<span id="deskHeaderStatus" style="font-size:0.7rem; font-weight:800; padding:2px 6px; border-radius:6px; background:#fef3c7; color:#b45309;">در انتظار پاسخ</span>
											</div>
											<div style="font-size:0.78rem; color:#64748b; margin-top:3px; display:flex; gap:12px; flex-wrap:wrap;">
												<span id="deskHeaderPhone"></span>
												<span id="deskHeaderEmail"></span>
												<span id="deskHeaderSubject"></span>
											</div>
										</div>

										<!-- Action Buttons (Call / WhatsApp / Delete) -->
										<div style="display:flex; gap:6px; align-items:center;">
											<a href="#" id="deskDirectCallBtn" class="button button-secondary button-small" style="font-weight:700; font-size:0.78rem; padding:2px 8px;">📞 تماس</a>
											<a href="#" id="deskDirectWaBtn" target="_blank" class="button button-small" style="background:#25D366; color:#fff; border-color:#25D366; font-weight:700; font-size:0.78rem; padding:2px 8px;">💬 واتساپ</a>
											<button type="button" id="deskDeleteBtn" class="button button-small" style="color:#dc2626; border-color:#fca5a5; font-weight:700; font-size:0.78rem; padding:2px 8px;">🗑️ حذف</button>
										</div>
									</div>

									<!-- Messages Stream Scroll Area -->
									<div class="desk-msg-stream" id="deskMsgStream" style="flex:1; overflow-y:auto; padding:14px 16px; background:#f8fafc; display:flex; flex-direction:column; gap:10px;">
										<!-- Dynamic Bubbles Rendered Here -->
									</div>

									<!-- Quick Canned Replies Row -->
									<div style="padding:6px 12px; background:#ffffff; border-top:1px solid #f1f5f9; display:flex; gap:6px; overflow-x:auto; white-space:nowrap; align-items:center;">
										<span style="font-size:0.72rem; color:#64748b; font-weight:700; flex-shrink:0;">⚡ پاسخ آماده:</span>
										<button type="button" class="desk-canned-chip" data-text="سلام و درود، سفارش شما در حال آماده‌سازی و ارسال است.">📦 آماده‌سازی</button>
										<button type="button" class="desk-canned-chip" data-text="کد پیگیری مرسوله پستی تا ساعاتی دیگر پیامک خواهد شد.">🚚 ارسال کد پیگیری</button>
										<button type="button" class="desk-canned-chip" data-text="کالای مورد نظر شما در انبار موجود و آماده تحویل است.">🛍️ استعلام موجودی</button>
										<button type="button" class="desk-canned-chip" data-text="جهت هماهنگی سریع‌تر لطفاً با تلفن پشتیبانی تماس حاصل فرمایید.">📞 تماس تکمیلی</button>
									</div>

									<!-- Reply Composer Form -->
									<div style="padding:10px 14px; border-top:1px solid #e2e8f0; background:#ffffff;">
										<div style="display:flex; gap:8px;">
											<textarea id="deskReplyInput" rows="2" placeholder="متن پاسخ خود را به این مشتری بنویسید (فوراً در چت مشتری نمایش داده می‌شود)..." style="flex:1; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-family:inherit; font-size:0.85rem; resize:none;"></textarea>
											<button type="button" id="deskSendReplyBtn" class="button button-primary" style="background:#2563eb; font-weight:800; padding:0 18px; border-radius:8px; align-self:stretch; font-size:0.88rem;">
												ارسال پاسخ 🚀
											</button>
										</div>
										<div id="deskReplyFeedback" style="font-size:0.78rem; margin-top:4px; font-weight:700;"></div>
									</div>

								</div>
							</div>
						</div>
					</div>

					<!-- 2. CARD DROPDOWN THEME SELECTOR WITH LIVE PREVIEW (NO MORE ENDLESS LIST!) -->
					<div class="admin-card" style="margin-top:20px; padding:20px;">
						<div class="admin-card-header" style="margin-bottom:16px; padding-bottom:12px;">
							<h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">
								<span>🎨</span> انتخاب تم گرافیکی پنجره چت (۱۲ تم با دراپ‌داون کارتی و پیش‌نمایش زنده)
							</h3>
							<span class="field-badge field-badge-purple">دراپ‌داون کارتی مدرن</span>
						</div>

						<p style="color:#64748b; font-size:0.88rem; line-height:1.5; margin:0 0 16px;">
							تم مورد نظر خود را از منوی کارتی زیر انتخاب نمایید. پیش‌نمایش زنده در کنار آن بلافاصله ظاهر جدید چت را نشان می‌دهد:
						</p>

						<!-- Hidden Native Select (for form submission) -->
						<select name="chat_theme" id="chat_theme_selector" style="display:none;">
							<option value="royal-blue" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'royal-blue' ); ?>>royal-blue</option>
							<option value="cyberpunk-dark" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'cyberpunk-dark' ); ?>>cyberpunk-dark</option>
							<option value="emerald-whatsapp" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'emerald-whatsapp' ); ?>>emerald-whatsapp</option>
							<option value="magenta-rose" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'magenta-rose' ); ?>>magenta-rose</option>
							<option value="gold-vip" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'gold-vip' ); ?>>gold-vip</option>
							<option value="minimal-slate" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'minimal-slate' ); ?>>minimal-slate</option>
							<option value="aurora-gradient" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'aurora-gradient' ); ?>>aurora-gradient</option>
							<option value="sunset-coral" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'sunset-coral' ); ?>>sunset-coral</option>
							<option value="telegram-ocean" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'telegram-ocean' ); ?>>telegram-ocean</option>
							<option value="warm-caramel" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'warm-caramel' ); ?>>warm-caramel</option>
							<option value="mint-pastel" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'mint-pastel' ); ?>>mint-pastel</option>
							<option value="frosted-glass" <?php selected( $opts['chat_theme'] ?? 'royal-blue', 'frosted-glass' ); ?>>frosted-glass</option>
						</select>

						<!-- Two-Column Layout: Card Dropdown on Right, Single Live Preview on Left -->
						<div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
							
							<!-- Right Column: Interactive Card Dropdown Component -->
							<div style="flex:1; min-width:280px; max-width:460px;">
								<label style="display:block; font-weight:800; font-size:0.92rem; color:#0f172a; margin-bottom:8px;">
									کلیک روی کارت برای انتخاب تم:
								</label>
								
								<div class="card-dropdown-wrap" style="position:relative;">
									<!-- Dropdown Trigger Card Button -->
									<div id="themeCardDropdownBtn" style="background:#ffffff; border:2px solid #2563eb; border-radius:12px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.08); user-select:none; transition:all 0.2s;">
										<div style="display:flex; align-items:center; gap:12px;">
											<div id="themeActiveDots" style="display:flex; gap:4px;">
												<span style="width:14px; height:14px; border-radius:50%; background:#1e3a8a; display:inline-block;"></span>
												<span style="width:14px; height:14px; border-radius:50%; background:#2563eb; display:inline-block;"></span>
												<span style="width:14px; height:14px; border-radius:50%; background:#60a5fa; display:inline-block;"></span>
											</div>
											<div>
												<strong id="themeActiveTitle" style="font-size:0.95rem; color:#0f172a; display:block;">آبی رویال و کریستالی</strong>
												<span id="themeActiveBadge" style="font-size:0.75rem; color:#2563eb; font-weight:700;">پیش‌فرض رسمی</span>
											</div>
										</div>
										<div style="color:#2563eb; font-size:0.9rem; font-weight:800; display:flex; align-items:center; gap:6px;">
											<span>انتخاب تم</span>
											<span id="themeDropdownArrow" style="transition:transform 0.2s;">▾</span>
										</div>
									</div>

									<!-- Dropdown Menu List Popup (12 Clean Cards) -->
									<div id="themeCardDropdownMenu" style="display:none; position:absolute; top:calc(100% + 6px); right:0; left:0; background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,0.15); z-index:100; max-height:360px; overflow-y:auto; padding:6px;">
										
										<?php
										$themes_data = array(
											'royal-blue'       => array('name' => '۱. آبی رویال و کریستالی', 'badge' => 'پیش‌فرض رسمی', 'dots' => array('#1e3a8a', '#2563eb', '#60a5fa')),
											'cyberpunk-dark'   => array('name' => '۲. دارک نئونی و بنفش', 'badge' => 'OLED Dark Mode', 'dots' => array('#090514', '#7c3aed', '#a855f7')),
											'emerald-whatsapp' => array('name' => '۳. سبز زمردی و واتساپی', 'badge' => 'پیام‌رسان محبوب', 'dots' => array('#064e3b', '#059669', '#25D366')),
											'magenta-rose'     => array('name' => '۴. صورتی نئونی و سرخابی', 'badge' => 'بیوتی و فشن', 'dots' => array('#831843', '#db2777', '#fb7185')),
											'gold-vip'         => array('name' => '۵. مشکی طلایی VIP', 'badge' => 'طلا و اکسسوری VIP', 'dots' => array('#09090b', '#d97706', '#fbbf24')),
											'minimal-slate'    => array('name' => '۶. مینیمال خنثی و تمیز', 'badge' => 'طراحی اسکاندیناوی', 'dots' => array('#1e293b', '#475569', '#94a3b8')),
											'aurora-gradient'  => array('name' => '۷. گرادینت شفق قطبی', 'badge' => 'ارغوانی و فیروزه‌ای', 'dots' => array('#4338ca', '#6366f1', '#06b6d4')),
											'sunset-coral'     => array('name' => '۸. غروب آفتاب کالیفرنیا', 'badge' => 'مرجانی و صمیمی', 'dots' => array('#9a3412', '#ea580c', '#fb923c')),
											'telegram-ocean'   => array('name' => '۹. چت تلگرامی اقیانوسی', 'badge' => 'آبی تلگرامی', 'dots' => array('#0369a1', '#0284c7', '#38bdf8')),
											'warm-caramel'     => array('name' => '۱۰. شکلاتی و کاراملی', 'badge' => 'گرم و نوستالژیک', 'dots' => array('#451a03', '#92400e', '#f59e0b')),
											'mint-pastel'      => array('name' => '۱۱. نعنایی و فیروزه‌ای', 'badge' => 'آرامش‌بخش و سلامت', 'dots' => array('#115e59', '#0d9488', '#2dd4bf')),
											'frosted-glass'    => array('name' => '۱۲. شیشه‌ای گلس‌مورفیسم', 'badge' => 'کریستالی شفاف ۲۰۲۶', 'dots' => array('#1e293b', '#2563eb', '#cbd5e1')),
										);

										$cur_theme = $opts['chat_theme'] ?? 'royal-blue';

										foreach ( $themes_data as $slug => $th ) :
											$is_sel = ( $cur_theme === $slug );
										?>
											<div class="theme-menu-card-item <?php echo $is_sel ? 'active' : ''; ?>" data-theme="<?php echo esc_attr( $slug ); ?>" style="padding:10px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; margin-bottom:4px; transition:background 0.15s; <?php echo $is_sel ? 'background:#eff6ff;' : ''; ?>">
												<div style="display:flex; align-items:center; gap:10px;">
													<div style="display:flex; gap:3px;">
														<?php foreach ( $th['dots'] as $d ) : ?>
															<span style="width:12px; height:12px; border-radius:50%; background:<?php echo esc_attr( $d ); ?>; display:inline-block;"></span>
														<?php endforeach; ?>
													</div>
													<span style="font-weight:700; font-size:0.88rem; color:#0f172a;"><?php echo esc_html( $th['name'] ); ?></span>
												</div>
												<span style="font-size:0.72rem; color:#64748b; font-weight:700; background:#f1f5f9; padding:2px 8px; border-radius:6px;"><?php echo esc_html( $th['badge'] ); ?></span>
											</div>
										<?php endforeach; ?>
									</div>
								</div>
								<div style="margin-top:10px; font-size:0.8rem; color:#64748b;">
									💡 با انتخاب هر تم از منوی بالا، پیش‌نمایش سمت چپ فوراً تغییر می‌کند.
								</div>
							</div>

							<!-- Left Column: Single Live Mockup Preview Card (Clean & Compact) -->
							<div style="flex:1; min-width:280px; max-width:440px;">
								<label style="display:block; font-weight:800; font-size:0.92rem; color:#0f172a; margin-bottom:8px;">
									پیش‌نمایش زنده تم انتخابی:
								</label>
								
								<div id="liveThemePreviewCard" style="border:1px solid #cbd5e1; border-radius:16px; overflow:hidden; box-shadow:0 8px 25px rgba(0,0,0,0.06); background:#ffffff;">
									<!-- Mockup Top Bar -->
									<div id="mockHdr" style="background:linear-gradient(135deg, #1e3a8a, #2563eb); color:#ffffff; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
										<div style="display:flex; align-items:center; gap:8px;">
											<span style="font-size:1.2rem;">👩‍💼</span>
											<strong style="font-size:0.88rem;">پشتیبانی آنلاین فروشگاه</strong>
										</div>
										<span style="font-size:0.7rem; opacity:0.9;">🟢 آنلاین</span>
									</div>

									<!-- Mockup Chat Stream -->
									<div id="mockBody" style="padding:14px; background:#f8fafc; display:flex; flex-direction:column; gap:8px; font-size:0.8rem;">
										<!-- Customer Bubble -->
										<div id="mockUserBubble" style="align-self:flex-end; background:linear-gradient(135deg, #2563eb, #1d4ed8); color:#ffffff; border-radius:10px; border-bottom-left-radius:2px; padding:6px 10px; max-width:80%;">
											سلام، ارسال فوری دارید؟
										</div>
										<!-- AI Bubble -->
										<div id="mockAiBubble" style="align-self:flex-start; background:#ffffff; border:1px solid #e2e8f0; color:#0f172a; border-radius:10px; border-bottom-right-radius:2px; padding:6px 10px; max-width:85%;">
											<div style="font-size:0.68rem; font-weight:800; color:#7c3aed; margin-bottom:2px;">🤖 پشتیبان هوشمند</div>
											بله، کلیه سفارشات ثبت‌شده تا ۱۲ همان روز ارسال می‌شوند.
										</div>
										<!-- Admin Bubble -->
										<div id="mockAdminBubble" style="align-self:flex-start; background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; border-radius:10px; border-bottom-right-radius:2px; padding:6px 10px; max-width:85%;">
											<div style="font-size:0.68rem; font-weight:800; color:#059669; margin-bottom:2px;">👨‍💼 کارشناس پشتیبانی</div>
											همچنین بسته‌بندی ویژه اکسپرس نیز فعال است.
										</div>
									</div>

									<!-- Mockup Palette Strip -->
									<div id="mockPaletteStrip" style="padding:8px 14px; background:#ffffff; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
										<span style="font-size:0.75rem; color:#64748b; font-weight:700;">پالت رنگی تم:</span>
										<div id="mockPaletteDots" style="display:flex; gap:6px;">
											<span style="width:14px; height:14px; border-radius:50%; background:#1e3a8a; display:inline-block;"></span>
											<span style="width:14px; height:14px; border-radius:50%; background:#2563eb; display:inline-block;"></span>
											<span style="width:14px; height:14px; border-radius:50%; background:#60a5fa; display:inline-block;"></span>
										</div>
									</div>
								</div>
							</div>

						</div>
					</div>

					<!-- 3. BUTTON STYLE CARD DROPDOWN WITH LIVE PREVIEW -->
					<div class="admin-card" style="margin-top:20px; padding:20px;">
						<div class="admin-card-header" style="margin-bottom:16px; padding-bottom:12px;">
							<h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">
								<span>🔘</span> طرح دکمه شناور چت در صفحه فروشگاه (۶ طرح با دراپ‌داون کارتی)
							</h3>
							<span class="field-badge field-badge-blue">انتخاب سریع</span>
						</div>

						<p style="color:#64748b; font-size:0.88rem; line-height:1.5; margin:0 0 16px;">
							طرح دکمه گوشه صفحه فروشگاه را انتخاب کنید:
						</p>

						<div style="display:flex; gap:20px; flex-wrap:wrap; align-items:center;">
							<div style="flex:1; min-width:280px; max-width:460px;">
								<select name="chat_button_style" id="chat_button_style_selector" style="width:100%; font-size:0.95rem; font-weight:700; padding:10px 14px; border-radius:10px; border:2px solid #2563eb; color:#0f172a; background:#ffffff;">
									<option value="pill-label" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'pill-label' ); ?>>۱. کپسولی با متن «پشتیبانی آنلاین» و آیکون (پیش‌فرض)</option>
									<option value="circle-glow" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'circle-glow' ); ?>>۲. دایره مدرن نئونی با نور رنگی (Glowing Circle)</option>
									<option value="avatar-ring" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'avatar-ring' ); ?>>۳. آواتار پشتیبان انسانی با حلقه آنلاین (Avatar Ring)</option>
									<option value="frosted-glass" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'frosted-glass' ); ?>>۴. شیشه‌ای مات فلوتینگ بلورین (Frosted Glass)</option>
									<option value="edge-tab" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'edge-tab' ); ?>>۵. زبانه چسبان لبه صفحه بدون اشغال فضا (Edge Tab)</option>
									<option value="radar-pulse" <?php selected( $opts['chat_button_style'] ?? 'pill-label', 'radar-pulse' ); ?>>۶. رادار صوتی با امواج دوگانه متحرک (Radar Wave)</option>
								</select>
							</div>
							<div style="font-size:0.85rem; color:#64748b;">
								(دکمه شناور در گوشه پایین صفحه با موقعیت و طرح انتخابی شما نمایش داده خواهد شد)
							</div>
						</div>
					</div>

					<!-- 4. CHAT FORM FIELDS & GENERAL SETTINGS (CLEAN RESPONSIVE TABLE) -->
					<div class="admin-card" style="margin-top:20px; padding:20px;">
						<div class="admin-card-header" style="margin-bottom:16px; padding-bottom:12px;">
							<h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">
								<span>⚙️</span> تنظیمات فیلدهای ورودی فرم چت و عناوین پنجره
							</h3>
							<span class="field-badge field-badge-purple">سفارشی‌سازی فرم</span>
						</div>

						<table class="form-table" style="margin-top:0;">
							<tr>
								<th scope="row" style="width:220px; font-weight:700;">فعال‌سازی چت آنلاین:</th>
								<td>
									<label>
										<input type="checkbox" name="enable_support_chat" value="1" <?php checked( ! empty( $opts['enable_support_chat'] ) ); ?>>
										دکمه چت آنلاین و پنجره گفتگو در فروشگاه فعال باشد.
									</label>
								</td>
							</tr>
							<tr>
								<th scope="row" style="font-weight:700;">موقعیت دکمه چت:</th>
								<td>
									<select name="chat_button_position" class="regular-text" style="border-radius:8px;">
										<option value="left" <?php selected( $opts['chat_button_position'] ?? 'left', 'left' ); ?>>پایین سمت چپ (توصیه شده)</option>
										<option value="right" <?php selected( $opts['chat_button_position'] ?? 'left', 'right' ); ?>>پایین سمت راست</option>
									</select>
								</td>
							</tr>
							<tr>
								<th scope="row" style="font-weight:700;">عنوان پنجره چت:</th>
								<td>
									<input type="text" name="chat_window_title" value="<?php echo esc_attr( $opts['chat_window_title'] ?? 'پشتیبانی آنلاین فروشگاه' ); ?>" class="large-text" style="border-radius:8px;">
								</td>
							</tr>
							<tr>
								<th scope="row" style="font-weight:700;">پیام خوش‌آمدگویی اولیه:</th>
								<td>
									<textarea name="chat_welcome_message" rows="2" class="large-text" style="border-radius:8px;"><?php echo esc_textarea( $opts['chat_welcome_message'] ?? 'سلام! خوش آمدید 👋 هرگونه سوالی درباره کالاها، قیمت‌ها یا ثبت سفارش دارید بنویسید تا همکاران ما سریعاً پاسخ دهند.' ); ?></textarea>
								</td>
							</tr>
						</table>

						<!-- Field Customization Table -->
						<div style="margin-top:16px; border-top:1px solid #f1f5f9; padding-top:16px;">
							<h4 style="margin:0 0 10px; font-size:0.95rem; font-weight:800; color:#1e293b;">
								📋 تنظیم فیلدهای ورودی (امکان فعال/غیرفعال‌سازی و اجباری بودن):
							</h4>

							<table class="wp-list-table widefat fixed striped" style="border-radius:8px; overflow:hidden;">
								<thead>
									<tr>
										<th style="font-weight:800; width:160px;">عنوان فیلد</th>
										<th style="font-weight:800; width:130px;">نمایش در فرم</th>
										<th style="font-weight:800; width:130px;">الزامی بودن</th>
										<th style="font-weight:800;">توضیحات کاربردی</th>
									</tr>
								</thead>
								<tbody>
									<tr>
										<td><strong>👤 نام و نام خانوادگی</strong></td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_name_enable" value="1" <?php checked( ! empty( $opts['chat_field_name_enable'] ) ); ?>>
												فعال
											</label>
										</td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_name_required" value="1" <?php checked( ! empty( $opts['chat_field_name_required'] ) ); ?>>
												الزامی باشد
											</label>
										</td>
										<td style="color:#64748b; font-size:0.82rem;">خطاب قرار دادن مشتری در پاسخ‌ها.</td>
									</tr>
									<tr>
										<td><strong>📱 شماره تماس / موبایل</strong></td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_phone_enable" value="1" <?php checked( ! empty( $opts['chat_field_phone_enable'] ) ); ?>>
												فعال
											</label>
										</td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_phone_required" value="1" <?php checked( ! empty( $opts['chat_field_phone_required'] ) ); ?>>
												الزامی باشد
											</label>
										</td>
										<td style="color:#64748b; font-size:0.82rem;">امکان تماس تلفنی یا واتساپ مستقیم با مشتری (توصیه: الزامی).</td>
									</tr>
									<tr>
										<td><strong>📧 آدرس ایمیل</strong></td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_email_enable" value="1" <?php checked( ! empty( $opts['chat_field_email_enable'] ) ); ?>>
												فعال
											</label>
										</td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_email_required" value="1" <?php checked( ! empty( $opts['chat_field_email_required'] ) ); ?>>
												الزامی باشد
											</label>
										</td>
										<td style="color:#64748b; font-size:0.82rem;">ارسال پاسخ رسمی به ایمیل مشتری.</td>
									</tr>
									<tr>
										<td><strong>📌 موضوع سوال / سفارش</strong></td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_subject_enable" value="1" <?php checked( ! empty( $opts['chat_field_subject_enable'] ) ); ?>>
												فعال
											</label>
										</td>
										<td>
											<label>
												<input type="checkbox" name="chat_field_subject_required" value="1" <?php checked( ! empty( $opts['chat_field_subject_required'] ) ); ?>>
												الزامی باشد
											</label>
										</td>
										<td style="color:#64748b; font-size:0.82rem;">دسته‌بندی موضوع پیام (استعلام، پیگیری و ...).</td>
									</tr>
									<tr>
										<td><strong>📝 متن پیام یا سوال</strong></td>
										<td><span style="color:#059669; font-weight:700;">همیشه فعال</span></td>
										<td><span style="color:#dc2626; font-weight:700;">همیشه الزامی</span></td>
										<td style="color:#64748b; font-size:0.82rem;">متن پیام اصلی مشتری.</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

				</div>

				<!-- ================= TAB 4: AI & COORDINATION ================= -->
				<div id="tab-ai" class="scraper-tab-panel">

					<!-- 1. کارت مدل مستر اسکرپر۴ -->
					<div class="admin-card" style="border: 2px solid #fbbf24; background: linear-gradient(180deg, #fffbeb 0%, #ffffff 100%);">
						<div class="admin-card-header" style="border-bottom: 1px solid #fde68a;">
							<h3><span>⭐</span> مدل مستر هوش مصنوعی اسکرپر (Master AI Model)</h3>
							<span class="field-badge" style="background:#10b981; color:#fff;">🟢 متصل به سیستم هوش مصنوعی اسکرپر (scraper4)</span>
						</div>

						<div style="padding:15px 0 5px;">
							<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
								<div>
									<div style="font-size:1.25rem; font-weight:900; color:#1e293b; display:flex; align-items:center; gap:8px;">
										<span>🤖</span>
										<span id="masterModelTitle"><?php echo esc_html( $master_ai['model_name'] ); ?></span>
										<span style="font-size:0.8rem; background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:2px 8px; border-radius:8px; font-weight:800;">⭐ مدل مستر فعال</span>
									</div>
									<div style="color:#64748b; font-size:0.88rem; margin-top:4px;">
										ارائه‌دهنده: <strong id="masterModelProvider" style="color:#2563eb;"><?php echo esc_html( $master_ai['provider_name'] ); ?></strong> | 
										کلید مرجع: <code id="masterModelKey" dir="ltr" style="background:#f1f5f9; padding:2px 6px; border-radius:4px;"><?php echo esc_html( $master_ai['key'] ); ?></code>
									</div>
								</div>
								<div style="text-align:left;">
									<div style="font-size:0.85rem; font-weight:800; color:#059669;">
										درصد موفقیت در آزمون‌ها: <span id="masterModelScore"><?php echo esc_html( round( ( $master_ai['score'] ?? 0.889 ) * 100, 1 ) ); ?>٪</span>
									</div>
									<div style="font-size:0.8rem; color:#64748b;">
										(<span id="masterModelWins"><?php echo esc_html( $master_ai['wins'] ?? 8 ); ?></span> برد از <span id="masterModelVotes"><?php echo esc_html( $master_ai['votes'] ?? 9 ); ?></span> آزمون مقایسه‌ای)
									</div>
								</div>
							</div>

							<div style="background:#ffffff; border:1px solid #fed7aa; border-radius:10px; padding:12px 16px; font-size:0.88rem; color:#475569; line-height:1.7;">
								<strong>💡 نحوه عملکرد مدل مستر:</strong>
								تمامی پاسخ‌های چت آنلاین مشتریان و دسته‌بندی‌های هوشمند با استفاده از این مدل و کاتالوگ زنده محصولات تولید می‌شود. سیستم به طور خودکار بهترین مدل را از نظر آماری از بین کاندیدهای اسکرپر برمی‌گزیند یا می‌توانید مدل دلخواه خود را در جدول زیر «سنجاق (Pin)» کنید.
							</div>
						</div>
					</div>

					<!-- 2. جدول مدل‌های کاندید هوش مصنوعی اسکرپر۴ -->
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>🏆</span> فهرست مدل‌های کاندید هوش مصنوعی (Candidates List)</h3>
							<span class="field-badge field-badge-purple">رقابت و رتبه‌بندی مدل‌ها</span>
						</div>

						<p style="color:#64748b; font-size:0.9rem; line-height:1.6; margin-top:0;">
							مدل‌های زیر در سیستم هوش مصنوعی <code>scraper4.php</code> تنظیم شده‌اند. در بخش آزمون می‌توانید پاسخ این مدل‌ها را در کنار هم مقایسه کرده و با ثبت رأی، مدل مستر را تغییر دهید یا مستقیماً مدلی را به عنوان مستر سنجاق فرمایید:
						</p>

						<div style="overflow-x:auto;">
							<table class="wp-list-table widefat fixed striped" style="border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
								<thead>
									<tr style="background:#f8fafc;">
										<th style="width:70px; text-align:center; font-weight:800;">وضعیت</th>
										<th style="width:130px; font-weight:800;">ارائه‌دهنده</th>
										<th style="font-weight:800;">مدل هوش مصنوعی</th>
										<th style="width:140px; text-align:center; font-weight:800;">امتیاز موفقیت</th>
										<th style="width:120px; text-align:center; font-weight:800;">تعداد آزمون</th>
										<th style="width:140px; text-align:center; font-weight:800;">عملیات</th>
									</tr>
								</thead>
								<tbody id="aiCandidatesTableBody">
									<?php if ( ! empty( $cands_info['candidates'] ) ) : ?>
										<?php foreach ( $cands_info['candidates'] as $cand ) : ?>
											<tr id="cand-row-<?php echo esc_attr( md5( $cand['key'] ) ); ?>">
												<td style="text-align:center;">
													<?php if ( ! empty( $cand['is_master'] ) ) : ?>
														<span style="font-size:1.1rem;" title="مدل مستر فعلی">⭐</span>
													<?php else : ?>
														<span style="color:#94a3b8; font-size:0.9rem;">—</span>
													<?php endif; ?>
												</td>
												<td>
													<strong style="color:#2563eb;"><?php echo esc_html( $cand['providerName'] ); ?></strong>
												</td>
												<td>
													<div style="font-weight:700; color:#1e293b;"><?php echo esc_html( $cand['modelName'] ); ?></div>
													<code dir="ltr" style="font-size:0.75rem; color:#64748b;"><?php echo esc_html( $cand['model'] ); ?></code>
												</td>
												<td style="text-align:center;">
													<span style="font-weight:800; color:<?php echo $cand['score'] > 0.7 ? '#059669' : ( $cand['score'] > 0.4 ? '#d97706' : '#64748b' ); ?>;">
														<?php echo esc_html( round( $cand['score'] * 100, 1 ) ); ?>٪
													</span>
													<div style="font-size:0.75rem; color:#64748b;">(<?php echo esc_html( $cand['wins'] ); ?> برد)</div>
												</td>
												<td style="text-align:center; color:#475569; font-weight:700;">
													<?php echo esc_html( $cand['votes'] ); ?>
												</td>
												<td style="text-align:center;">
													<?php if ( ! empty( $cand['is_master'] ) ) : ?>
														<span style="font-size:0.8rem; background:#fef3c7; color:#b45309; padding:4px 10px; border-radius:6px; font-weight:800;">
															✓ مستر فعال
														</span>
													<?php else : ?>
														<button type="button" class="button button-small btn-pin-candidate" data-key="<?php echo esc_attr( $cand['key'] ); ?>" style="font-size:0.8rem; border-radius:6px;">
															📌 سنجاق مستر
														</button>
													<?php endif; ?>
												</td>
											</tr>
										<?php endforeach; ?>
									<?php else : ?>
										<tr>
											<td colspan="6" style="text-align:center; color:#64748b; padding:20px;">هیچ مدل کاندیدی تعریف نشده است. می‌توانید فایل کانفیگ را بارگذاری کنید.</td>
										</tr>
									<?php endif; ?>
								</tbody>
							</table>
						</div>
					</div>

					<!-- 3. جعبه بارگذاری و مدیریت فایل‌های کانفیگ اسکرپر (Upload & Import Config Files) -->
					<div class="admin-card" style="background:#f8fafc; border:1.5px solid #cbd5e1;">
						<div class="admin-card-header">
							<h3><span>📂</span> بارگذاری و درون‌ریزی فایل‌های کانفیگ هوش مصنوعی (Config Upload)</h3>
							<span class="field-badge field-badge-blue">همگام‌سازی آسان اسکرپر</span>
						</div>

						<p style="color:#64748b; font-size:0.9rem; line-height:1.6; margin-top:0;">
							اگر تنظیمات، ارائه‌دهندگان یا کلیدهای API هوش مصنوعی را در فایل‌های <code>connections.json</code>، <code>ai_providers.json</code> یا <code>ai_votes.json</code> اسکرپر۴ دارید یا می‌خواهید فایل کانفیگ را از کامپیوتر بارگذاری نمایید، کافیست فایل JSON را اینجا آپلود یا رها کنید:
						</p>

						<div style="background:#ffffff; border:2px dashed #cbd5e1; border-radius:12px; padding:24px; text-align:center; margin-bottom:15px;" id="aiConfigDropZone">
							<div style="font-size:2rem; margin-bottom:8px;">📁</div>
							<div style="font-weight:700; color:#1e293b; margin-bottom:6px; font-size:0.95rem;">فایل کانفیگ (JSON) را بکشید و اینجا رها کنید یا دکمه زیر را بزنید:</div>
							<div style="color:#94a3b8; font-size:0.82rem; margin-bottom:14px;">پشتیبانی از connections.json، ai_providers.json، ai_votes.json یا پکیج جامع تنظیمات اسکرپر</div>
							
							<input type="file" id="aiConfigFileInput" accept=".json" style="display:none;">
							<div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
								<button type="button" id="btnSelectAiConfigFile" class="button button-secondary" style="font-weight:700; padding:6px 16px; border-radius:8px;">
									📂 انتخاب فایل کانفیگ از سیستم
								</button>
								<button type="button" id="btnUploadAiConfigFile" class="button button-primary" style="background:#059669; border-color:#047857; font-weight:800; padding:6px 20px; border-radius:8px;" disabled>
									📥 بارگذاری و اعمال فوری در اسکرپر
								</button>
								<button type="button" id="btnExportAiConfigFile" class="button button-secondary" style="font-weight:700; padding:6px 16px; border-radius:8px;">
									📤 دانلود نسخه پشتیبان تنظیمات (Export)
								</button>
							</div>
							<div id="aiConfigSelectedFileName" style="margin-top:10px; font-size:0.85rem; color:#2563eb; font-weight:700; display:none;"></div>
						</div>

						<div id="aiConfigUploadStatus" style="display:none; border-radius:8px; padding:12px 16px; font-size:0.9rem; margin-top:10px;"></div>
					</div>

					<!-- 4. کنسول تست زنده هوش مصنوعی و آزمون مقایسه‌ای کاندیدها -->
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>🧪</span> کنسول تست زنده هوش مصنوعی و آزمون مقایسه‌ای کاندیدها</h3>
							<span class="field-badge field-badge-purple">تست واقعی و ثبت رای</span>
						</div>

						<p style="color:#64748b; font-size:0.9rem; line-height:1.6; margin-top:0;">
							می‌توانید پیام دلخواه خود یا یکی از سوالات پرتکرار زیر را انتخاب کنید و عملکرد مدل مستر یا همه کاندیدها را کنار هم ارزیابی نمایید:
						</p>

						<!-- پرسش‌های آماده سریع -->
						<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
							<button type="button" class="button button-small btn-quick-preset" data-msg="سلام، ساعت هوشمند T800 ضد آبه؟ چه قابلیت‌هایی داره؟" style="border-radius:20px; font-size:0.82rem;">
								🔹 ساعت T800 ضد آب است؟
							</button>
							<button type="button" class="button button-small btn-quick-preset" data-msg="سلام وقت بخیر، قیمت ساعت الترا چنده و تخفیف داره؟" style="border-radius:20px; font-size:0.82rem;">
								🔹 قیمت ساعت الترا با تخفیف
							</button>
							<button type="button" class="button button-small btn-quick-preset" data-msg="سفارشات چند روزه ارسال میشه و هزینه ارسال چقدره؟" style="border-radius:20px; font-size:0.82rem;">
								🔹 شرایط و هزینه ارسال
							</button>
							<button type="button" class="button button-small btn-quick-preset" data-msg="آیا محصولات شما ضمانت تعویض یا گارانتی دارند؟" style="border-radius:20px; font-size:0.82rem;">
								🔹 گارانتی و ضمانت اصالت
							</button>
						</div>

						<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
							<input type="text" id="testAiChatMessage" placeholder="سوال خود را بنویسید (مثال: سلام، ساعت هوشمند با قابلیت مکالمه موجود دارید؟)" style="flex:1; min-width:280px; padding:10px 14px; border:1.5px solid #cbd5e1; border-radius:10px; font-size:0.9rem; outline:none;">
							<button type="button" id="btnRunTestAiChat" class="button button-primary" style="padding:8px 20px; font-weight:800; background:#2563eb; border-color:#1d4ed8; border-radius:10px; font-size:0.9rem;">
								🚀 پرسش از مدل مستر (Master AI)
							</button>
							<button type="button" id="btnCompareAiCandidates" class="button button-secondary" style="padding:8px 20px; font-weight:800; background:#7c3aed; color:#fff; border-color:#6d28d9; border-radius:10px; font-size:0.9rem;">
								⚖️ آزمون مقایسه‌ای همه کاندیدها
							</button>
						</div>

						<!-- نتیجه تست مدل مستر -->
						<div id="testAiChatResultBox" style="display:none; background:#ffffff; border:1.5px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:10px;">
							<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
								<div style="font-weight:800; font-size:0.9rem; color:#059669; display:flex; align-items:center; gap:6px;">
									<span>⭐</span> پاسخ زنده مدل مستر اسکرپر:
								</div>
								<div style="display:flex; gap:8px; align-items:center;">
									<span id="testAiModelUsedBadge" style="font-size:0.75rem; background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:6px; font-family:monospace;"></span>
									<span id="testAiTimeBadge" style="font-size:0.75rem; background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:6px;"></span>
								</div>
							</div>
							<div id="testAiResponseText" style="font-size:0.95rem; color:#1e293b; line-height:1.8; white-space:pre-wrap;"></div>
						</div>

						<!-- نتیجه آزمون مقایسه‌ای کاندیدها -->
						<div id="testAiCandidatesCompareBox" style="display:none; margin-top:14px;">
							<div style="font-weight:800; font-size:0.95rem; color:#7c3aed; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
								<span>⚖️</span> پاسخ همزمان همه کاندیدها (بهترین را برگزینید تا به عنوان رأی ثبت شود):
							</div>
							<div id="compareCandidatesCardsGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap:14px;"></div>
						</div>
					</div>

					<!-- 5. شیوه هماهنگی هوش مصنوعی، ادمین و دستورالعمل رفتاری -->
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>⚙️</span> تنظیمات هماهنگی هوش مصنوعی و پرامپت فروشگاه</h3>
							<span class="field-badge field-badge-purple">تنظیمات سیستمی</span>
						</div>

						<table class="form-table">
							<tr>
								<th scope="row">شیوه هماهنگی و تعامل (Coordination Mode):</th>
								<td>
									<fieldset>
										<label style="display:block; margin-bottom:12px; background:#f8fafc; padding:12px 16px; border-radius:10px; border:1px solid #e2e8f0;">
											<input type="radio" name="ai_coordination_mode" value="ai_first" <?php checked( ( $opts['ai_coordination_mode'] ?? 'ai_first' ) === 'ai_first' ); ?>>
											<strong style="color:#0f172a; font-size:0.95rem;">🤖 هوش مصنوعی پاسخگوی اول + ارجاع فوری به ادمین (توصیه شده):</strong>
											<div style="color:#64748b; font-size:0.85rem; margin-top:4px; margin-right:24px;">
												هوش مصنوعی فوراً به سوال مشتری در چت آنلاین پاسخ می‌دهد. همزمان پیام مشتری همراه با پاسخ داده‌شده برای ادمین در پیام‌رسان‌ها (بله/تلگرام/روبیکا) ارسال می‌شود تا ادمین در جریان مکالمه قرار گرفته و در صورت نیاز با شماره تماس مشتری ارتباط بگیرد.
											</div>
										</label>

										<label style="display:block; margin-bottom:12px; background:#f8fafc; padding:12px 16px; border-radius:10px; border:1px solid #e2e8f0;">
											<input type="radio" name="ai_coordination_mode" value="ai_copilot" <?php checked( ( $opts['ai_coordination_mode'] ?? 'ai_first' ) === 'ai_copilot' ); ?>>
											<strong style="color:#0f172a; font-size:0.95rem;">🤝 دستیار کمکی ادمین (AI Co-Pilot):</strong>
											<div style="color:#64748b; font-size:0.85rem; margin-top:4px; margin-right:24px;">
												هوش مصنوعی پاسخ پیشنهادی را برای ادمین در پیام‌رسان آماده می‌کند تا ادمین انسانی پس از بررسی پاسخ نهایی را به مشتری ارائه دهد.
											</div>
										</label>

										<label style="display:block; margin-bottom:12px; background:#f8fafc; padding:12px 16px; border-radius:10px; border:1px solid #e2e8f0;">
											<input type="radio" name="ai_coordination_mode" value="human_only" <?php checked( ( $opts['ai_coordination_mode'] ?? 'ai_first' ) === 'human_only' ); ?>>
											<strong style="color:#0f172a; font-size:0.95rem;">🧑‍💼 فقط ادمین انسانی (Human Only):</strong>
											<div style="color:#64748b; font-size:0.85rem; margin-top:4px; margin-right:24px;">
												هوش مصنوعی غیرفعال بوده و کلیه پیام‌های چت مستقیماً برای ادمین‌ها ارسال شده و پاسخ توسط انسان داده می‌شود.
											</div>
										</label>

										<label style="display:block; background:#f8fafc; padding:12px 16px; border-radius:10px; border:1px solid #e2e8f0;">
											<input type="radio" name="ai_coordination_mode" value="ai_only" <?php checked( ( $opts['ai_coordination_mode'] ?? 'ai_first' ) === 'ai_only' ); ?>>
											<strong style="color:#0f172a; font-size:0.95rem;">⚡ پاسخگویی تمام‌اتوماتیک ۲۴ ساعته (Full Auto AI):</strong>
											<div style="color:#64748b; font-size:0.85rem; margin-top:4px; margin-right:24px;">
												پاسخگویی سریع به سوالات مشتریان به طور کامل توسط هوش مصنوعی انجام می‌شود.
											</div>
										</label>
									</fieldset>
								</td>
							</tr>
							<tr>
								<th scope="row">نام نمایشی دستیار در چت:</th>
								<td>
									<input type="text" name="ai_support_name" value="<?php echo esc_attr( $opts['ai_support_name'] ?? 'پشتیبان هوشمند فروشگاه' ); ?>" class="regular-text">
								</td>
							</tr>
							<tr>
								<th scope="row">دستورالعمل و پرامپت رفتاری هوش مصنوعی:</th>
								<td>
									<textarea name="ai_system_prompt" rows="4" class="large-text"><?php echo esc_textarea( $opts['ai_system_prompt'] ?? '' ); ?></textarea>
									<p class="description">تعیین لحن، قوانین و اطلاعات فروشگاه که هوش مصنوعی در پاسخگویی به مشتریان رعایت می‌کند.</p>
								</td>
							</tr>
							<tr>
								<th scope="row">کلید API سفارشی (اختیاری):</th>
								<td>
									<input type="password" name="ai_api_key" value="<?php echo esc_attr( $opts['ai_api_key'] ?? '' ); ?>" class="regular-text" dir="ltr" placeholder="sk-... (اختیاری، پیش‌فرض از ai_providers.json اسکرپر خوانده می‌شود)">
									<p class="description">در صورت خالی بودن، کلید به صورت خودکار از تنظیمات فایل اسکرپر خوانده می‌شود.</p>
								</td>
							</tr>
						</table>

						<div style="margin-top:18px;background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #93c5fd;border-radius:14px;padding:16px;">
							<h4 style="margin:0 0 8px;color:#1e3a8a;">🖼️ تکمیل خودکار تصویر محصولات (جستجوی وب + AI)</h4>
							<p style="margin:0 0 12px;color:#1e40af;font-size:0.85rem;line-height:1.7;">
								برای کالاهایی که <strong>عکس ندارند</strong> یا فقط <strong>placeholder / کارت پیش‌فرض اسنپ‌شاپ</strong> دارند،
								سیستم در <strong>Google Images</strong> (و Bing/Openverse) جستجو می‌کند، با AI مناسب‌ترین عکس را برمی‌گزیند و در متای ووکامرس
								(<code>_amphp_ai_image_url</code>) ذخیره می‌کند — در صورت امکان فایل را هم sideload می‌کند.
							</p>
							<label style="display:flex;gap:8px;align-items:center;font-weight:800;margin-bottom:10px;">
								<input type="checkbox" name="enable_ai_product_images" value="1" <?php checked( ! isset( $opts['enable_ai_product_images'] ) || ! empty( $opts['enable_ai_product_images'] ) ); ?>>
								فعال‌سازی غنی‌سازی خودکار تصویر
							</label>
							<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:10px;color:#334155;">
								<input type="checkbox" name="ai_image_sideload" value="1" <?php checked( ! isset( $opts['ai_image_sideload'] ) || ! empty( $opts['ai_image_sideload'] ) ); ?>>
								دانلود و پیوست تصویر به رسانه وردپرس (Featured Image)
							</label>
							<label style="font-weight:700;font-size:0.85rem;display:block;margin-bottom:8px;">تعداد در هر اجرا (کرون / دکمه)
								<input type="number" name="ai_image_batch_size" min="1" max="30" value="<?php echo esc_attr( $opts['ai_image_batch_size'] ?? 8 ); ?>" style="width:80px;margin-right:8px;">
							</label>
							<label style="display:flex;gap:8px;align-items:center;font-weight:800;margin:12px 0 8px;color:#1e3a8a;">
								<input type="checkbox" name="enable_google_image_search" value="1" <?php checked( ! isset( $opts['enable_google_image_search'] ) || ! empty( $opts['enable_google_image_search'] ) ); ?>>
								جستجو در Google Images (اولویت اول)
							</label>
							<p style="margin:0 0 10px;font-size:0.8rem;color:#334155;line-height:1.6;">
								بدون کلید هم از صفحهٔ Google Images استفاده می‌شود. برای نتیجه پایدارتر،
								<a href="https://developers.google.com/custom-search/v1/overview" target="_blank" rel="noopener">Google Programmable Search (CSE)</a>
								با <code>searchType=image</code> بسازید و کلید را وارد کنید.
							</p>
							<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
								<label style="font-weight:700;font-size:0.82rem;display:block;">Google CSE API Key
									<input type="password" name="google_cse_api_key" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['google_cse_api_key'] ?? '' ); ?>" placeholder="AIza…">
								</label>
								<label style="font-weight:700;font-size:0.82rem;display:block;">Search Engine ID (cx)
									<input type="text" name="google_cse_cx" dir="ltr" style="width:100%;margin-top:4px;" value="<?php echo esc_attr( $opts['google_cse_cx'] ?? '' ); ?>" placeholder="a1b2c3d4e">
								</label>
							</div>
							<?php
							$img_last = get_option( 'amphp_ai_image_last_run', array() );
							if ( is_array( $img_last ) && ! empty( $img_last['at'] ) ) :
								?>
								<p style="font-size:0.8rem;color:#64748b;margin:8px 0;">آخرین اجرا: <?php echo esc_html( date_i18n( 'Y/m/d H:i', intval( $img_last['at'] ) ) ); ?> — <?php echo esc_html( (string) ( $img_last['message'] ?? '' ) ); ?></p>
							<?php endif; ?>
							<button type="button" class="button button-primary" id="amphpAiImgEnrichBtn" style="margin-top:6px;">🔍 اجرای الان غنی‌سازی تصویر</button>
							<span id="amphpAiImgEnrichStatus" style="margin-right:10px;font-weight:700;color:#1e40af;"></span>
							<script>
							(function(){
							  var btn=document.getElementById('amphpAiImgEnrichBtn');
							  var st=document.getElementById('amphpAiImgEnrichStatus');
							  if(!btn) return;
							  btn.addEventListener('click', function(){
							    btn.disabled=true; st.textContent='در حال جستجو و ذخیره…';
							    var fd=new FormData();
							    fd.append('action','scraper_ai_enrich_images');
							    fd.append('nonce', '<?php echo esc_js( wp_create_nonce( "scraper_shop_admin_nonce" ) ); ?>');
							    fd.append('limit', document.querySelector('[name="ai_image_batch_size"]')?.value||'8');
							    fetch(ajaxurl,{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){
							      btn.disabled=false;
							      st.textContent = (d && d.success) ? (d.data && d.data.message ? d.data.message : 'انجام شد') : (d && d.data ? d.data : 'خطا');
							    }).catch(function(){ btn.disabled=false; st.textContent='خطا در ارتباط با سرور'; });
							  });
							})();
							</script>
						</div>
					</div>

				</div>

				<!-- ================= TAB 5: MESSENGERS & NOTIFICATIONS ================= -->
				<div id="tab-messengers" class="scraper-tab-panel">
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>📡</span> وضعیت اتصال به پیام‌رسان‌ها (بله / تلگرام / روبیکا)</h3>
							<span class="field-badge field-badge-blue">اتصال به اعلان‌های اسکرپر</span>
						</div>

						<p style="color:#64748b; font-size:0.92rem; line-height:1.6; margin-top:0;">
							تنظیمات زیر پیام‌های مشتریان را به پیام‌رسان‌های فایل اسکرپر ارسال می‌کند. اگر در بخش اعلان‌های اسکرپر (<code>connections.json</code>) توکن‌ها را وارد کرده باشید، سیستم به طور خودکار آن‌ها را شناسایی می‌نماید:
						</p>

						<!-- Status overview cards -->
						<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:20px;">
							<!-- Bale -->
							<div style="background:#f8fafc; border:1px solid <?php echo isset( $active_msgrs['bale'] ) ? '#bbf7d0' : '#e2e8f0'; ?>; border-radius:12px; padding:14px;">
								<div style="font-weight:800; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
									<span>🔹 پیام‌رسان بله:</span>
									<?php if ( isset( $active_msgrs['bale'] ) ) : ?>
										<span style="color:#16a34a; font-size:0.8rem; font-weight:800;">🟢 متصل</span>
									<?php else : ?>
										<span style="color:#94a3b8; font-size:0.8rem;">⚪ تنظیم نشده</span>
									<?php endif; ?>
								</div>
								<div style="font-size:0.8rem; color:#64748b;">
									<?php echo isset( $active_msgrs['bale'] ) ? 'منبع: ' . ( 'scraper_connections' === $active_msgrs['bale']['source'] ? 'connections.json اسکرپر' : 'تنظیمات افزونه' ) : 'توکن یا Chat ID خالی است.'; ?>
								</div>
							</div>

							<!-- Telegram -->
							<div style="background:#f8fafc; border:1px solid <?php echo isset( $active_msgrs['telegram'] ) ? '#bbf7d0' : '#e2e8f0'; ?>; border-radius:12px; padding:14px;">
								<div style="font-weight:800; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
									<span>🔹 تلگرام:</span>
									<?php if ( isset( $active_msgrs['telegram'] ) ) : ?>
										<span style="color:#16a34a; font-size:0.8rem; font-weight:800;">🟢 متصل</span>
									<?php else : ?>
										<span style="color:#94a3b8; font-size:0.8rem;">⚪ تنظیم نشده</span>
									<?php endif; ?>
								</div>
								<div style="font-size:0.8rem; color:#64748b;">
									<?php echo isset( $active_msgrs['telegram'] ) ? 'منبع: ' . ( 'scraper_connections' === $active_msgrs['telegram']['source'] ? 'connections.json اسکرپر' : 'تنظیمات افزونه' ) : 'توکن یا Chat ID خالی است.'; ?>
								</div>
							</div>

							<!-- Rubika -->
							<div style="background:#f8fafc; border:1px solid <?php echo isset( $active_msgrs['rubika'] ) ? '#bbf7d0' : '#e2e8f0'; ?>; border-radius:12px; padding:14px;">
								<div style="font-weight:800; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
									<span>🔹 روبیکا:</span>
									<?php if ( isset( $active_msgrs['rubika'] ) ) : ?>
										<span style="color:#16a34a; font-size:0.8rem; font-weight:800;">🟢 متصل</span>
									<?php else : ?>
										<span style="color:#94a3b8; font-size:0.8rem;">⚪ تنظیم نشده</span>
									<?php endif; ?>
								</div>
								<div style="font-size:0.8rem; color:#64748b;">
									<?php echo isset( $active_msgrs['rubika'] ) ? 'منبع: ' . ( 'scraper_connections' === $active_msgrs['rubika']['source'] ? 'connections.json اسکرپر' : 'تنظیمات افزونه' ) : 'توکن یا Chat ID خالی است.'; ?>
								</div>
							</div>
						</div>

						<!-- Test Messenger Button -->
						<div style="margin-bottom:24px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
							<div>
								<strong>تست اتصال زنده:</strong>
								<span style="color:#475569; font-size:0.88rem; margin-right:6px;">برای اطمینان از دریافت پیام‌ها در بله، تلگرام یا روبیکا، یک پیام آزمایشی ارسال نمایید:</span>
							</div>
							<div style="display:flex; align-items:center; gap:10px;">
								<button type="button" id="btnTestMessengers" class="button button-secondary" style="font-weight:800; border-color:#2563eb; color:#2563eb; padding:5px 16px;">
									🔔 ارسال پیام آزمایشی
								</button>
								<span id="testMessengersStatus" style="font-size:0.88rem;"></span>
							</div>
						</div>

						<table class="form-table">
							<tr>
								<th scope="row" colspan="2">
									<strong style="color:#0f172a; font-size:1rem;">تنظیمات دستی پیام‌رسان‌ها (اختیاری):</strong>
								</th>
							</tr>
							<tr>
								<th scope="row">ربات بله (Bale):</th>
								<td>
									<input type="password" name="bale_token" value="<?php echo esc_attr( $opts['bale_token'] ?? '' ); ?>" placeholder="Bot Token بله" class="regular-text" dir="ltr" style="margin-left:10px;">
									<input type="text" name="bale_chat_id" value="<?php echo esc_attr( $opts['bale_chat_id'] ?? '' ); ?>" placeholder="شناسه عددی چت (Chat ID)" class="regular-text" dir="ltr">
								</td>
							</tr>
							<tr>
								<th scope="row">ربات تلگرام (Telegram):</th>
								<td>
									<input type="password" name="telegram_token" value="<?php echo esc_attr( $opts['telegram_token'] ?? '' ); ?>" placeholder="Bot Token تلگرام" class="regular-text" dir="ltr" style="margin-left:10px;">
									<input type="text" name="telegram_chat_id" value="<?php echo esc_attr( $opts['telegram_chat_id'] ?? '' ); ?>" placeholder="شناسه عددی چت (Chat ID)" class="regular-text" dir="ltr">
								</td>
							</tr>
							<tr>
								<th scope="row">ربات روبیکا (Rubika):</th>
								<td>
									<input type="password" name="rubika_token" value="<?php echo esc_attr( $opts['rubika_token'] ?? '' ); ?>" placeholder="Bot Token روبیکا" class="regular-text" dir="ltr" style="margin-left:10px;">
									<input type="text" name="rubika_chat_id" value="<?php echo esc_attr( $opts['rubika_chat_id'] ?? '' ); ?>" placeholder="شناسه عددی چت (Chat ID)" class="regular-text" dir="ltr">
								</td>
							</tr>
						</table>
					</div>
				</div>

				<!-- ================= TAB 6: STORE, ANALYTICS & WOOCOMMERCE ================= -->
				<div id="tab-woocommerce" class="scraper-tab-panel">

					<!-- Permanent WP-Cron Quick Action & Status Banner -->
					<div class="admin-cron-highlight-box" style="background:linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border:2px solid #3b82f6; border-radius:14px; padding:16px 20px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; box-shadow:0 4px 14px rgba(37,99,235,0.08);">
						<div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
							<span style="font-size:2rem; background:#fff; width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.06);">⏰</span>
							<div>
								<div style="font-size:1.02rem; font-weight:900; color:#1e3a8a; display:flex; align-items:center; gap:8px;">
									سیستم اجرای خودکار و کران‌جاب وردپرس (WP-Cron):
									<span class="field-badge" style="background:<?php echo $wpcron_info['is_active'] ? '#10b981' : '#ef4444'; ?>; color:#fff; font-size:0.82rem; padding:3px 12px; border-radius:20px;">
										<?php echo $wpcron_info['is_active'] ? '🟢 فعال و زمان‌بندی‌شده' : '🔴 غیرفعال'; ?>
									</span>
								</div>
								<div style="font-size:0.86rem; color:#334155; margin-top:4px;">
									⏱️ زمان اجرای بعدی: <strong style="color:#2563eb;" id="wpCronQuickNextRun"><?php echo esc_html( $wpcron_info['next_human'] ); ?></strong> &nbsp;|&nbsp; 
									بازه تکرار: <strong><?php echo esc_html( $wpcron_info['interval_label'] ); ?></strong> &nbsp;|&nbsp; 
									آخرین اجرا: <strong id="wpCronQuickLastRun"><?php echo ! empty( $wpcron_info['last_run']['date_fa'] ) ? esc_html( $wpcron_info['last_run']['date_fa'] ) : 'هنوز اجرا نشده'; ?></strong>
								</div>
							</div>
						</div>
						<div style="display:flex; align-items:center; gap:10px;">
							<button type="button" class="btnRunWpCronNow button button-primary" style="background:#2563eb; border-color:#1d4ed8; font-weight:800; padding:8px 20px; border-radius:8px; font-size:0.9rem; display:inline-flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(37,99,235,0.25);">
								<span>⚡</span> اجرای دستی کران‌جاب همین حالا (Run Now)
							</button>
						</div>
					</div>

					<!-- Sub-Tabs Navigation for Tab 6 -->
					<div class="shop-subtabs-nav" style="display:flex; gap:8px; margin-bottom:22px; border-bottom:2px solid #e2e8f0; padding-bottom:12px; flex-wrap:wrap;">
						<button type="button" class="shop-subtab-btn active" data-subtab="subtab-cron" style="padding:10px 20px; font-weight:800; font-size:0.92rem; border-radius:10px; border:1.5px solid #2563eb; background:#2563eb; color:#fff; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(37,99,235,0.2);">
							<span>⏰</span> ۱. زمان‌بندی و کرون‌جاب خودکار (WP-Cron)
						</button>
						<button type="button" class="shop-subtab-btn" data-subtab="subtab-analytics" style="padding:10px 20px; font-weight:800; font-size:0.92rem; border-radius:10px; border:1.5px solid #cbd5e1; background:#f8fafc; color:#475569; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
							<span>📊</span> ۲. آمار و تحلیل جامع فروشگاه
						</button>
						<button type="button" class="shop-subtab-btn" data-subtab="subtab-products" style="padding:10px 20px; font-weight:800; font-size:0.92rem; border-radius:10px; border:1.5px solid #cbd5e1; background:#f8fafc; color:#475569; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
							<span>🔄</span> ۳. ووکامرس و محصولات اسکرپر
						</button>
					</div>

					<input type="hidden" name="active_shop_subtab" id="activeShopSubtabInput" value="<?php echo esc_attr( sanitize_key( $_POST['active_shop_subtab'] ?? 'subtab-cron' ) ); ?>">

					<!-- ================= SUB-TAB 3: WP-CRON AUTOMATIC SYNC ================= -->
					<div id="subtab-cron" class="shop-subtab-panel active">
						<div class="admin-card" style="border:2px solid #3b82f6; background:linear-gradient(180deg, #eff6ff 0%, #ffffff 100%); margin:0; border-radius:12px;">
							<div class="admin-card-header" style="border-bottom:1px solid #bfdbfe;">
								<h3><span>⏰</span> اجرای خودکار استخراج و همگام‌سازی با کران‌جاب داخلی وردپرس (WP-Cron)</h3>
								<span class="field-badge" style="background:<?php echo $wpcron_info['is_active'] ? '#10b981' : '#64748b'; ?>; color:#fff;">
									<?php echo $wpcron_info['is_active'] ? '🟢 کران‌جاب وردپرس فعال و زمان‌بندی‌شده' : '⚪ کران‌جاب وردپرس غیرفعال'; ?>
								</span>
							</div>

							<p style="color:#475569; font-size:0.9rem; line-height:1.7; margin-top:0;">
								<strong>بدون نیاز به تنظیمات پیچیده cPanel یا هاست!</strong> سیستم کران‌جاب داخلی وردپرس (WP-Cron) به صورت کاملاً خودکار و در بازه‌های مشخص، فرآیند اجرای کران‌جاب این صفحه (<code>scraper4.php?cron_run=1</code>)، استخراج محصولات جدید، بررسی تغییر قیمت‌ها و همگام‌سازی را در پس‌زمینه انجام می‌دهد.
							</p>

							<!-- وضعیت زنده کران‌جاب -->
							<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:16px;">
								<div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; padding:14px;">
									<div style="color:#64748b; font-size:0.8rem; font-weight:700; margin-bottom:4px;">⏱️ زمان اجرای بعدی:</div>
									<div style="font-size:1.05rem; font-weight:900; color:#2563eb;" id="wpCronNextRunText">
										<?php echo esc_html( $wpcron_info['next_human'] ); ?>
									</div>
									<div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">
										(بازه: <?php echo esc_html( $wpcron_info['interval_label'] ); ?>)
									</div>
								</div>

								<div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; padding:14px;">
									<div style="color:#64748b; font-size:0.8rem; font-weight:700; margin-bottom:4px;">📋 آخرین اجرای خودکار:</div>
									<div style="font-size:0.95rem; font-weight:800; color:#1e293b;" id="wpCronLastRunText">
										<?php echo ! empty( $wpcron_info['last_run']['date_fa'] ) ? esc_html( $wpcron_info['last_run']['date_fa'] ) : 'هنوز اجرا نشده'; ?>
									</div>
									<div style="font-size:0.75rem; color:<?php echo ( ( $wpcron_info['last_run']['status'] ?? '' ) === 'success' ) ? '#059669' : '#64748b'; ?>; margin-top:2px;">
										<?php echo ! empty( $wpcron_info['last_run']['took_sec'] ) ? ( 'مدت زمان: ' . esc_html( $wpcron_info['last_run']['took_sec'] ) . ' ثانیه' ) : '—'; ?>
									</div>
								</div>
							</div>

							<!-- فرم تنظیمات زمان‌بندی WP-Cron -->
							<table class="form-table" style="margin-bottom:16px;">
								<tr>
									<th scope="row" style="width:230px;">فعال‌سازی کران‌جاب وردپرس:</th>
									<td>
										<label style="display:flex; align-items:center; gap:8px; font-weight:700; cursor:pointer;">
											<input type="checkbox" name="enable_wp_cron_sync" value="1" <?php checked( ! empty( $opts['enable_wp_cron_sync'] ) ); ?> style="width:18px; height:18px; accent-color:#2563eb;">
											اجرای دوره‌ای و پس‌زمینه اسکرپر توسط سیستم زمان‌بندی وردپرس (WP-Cron)
										</label>
									</td>
								</tr>
								<tr>
									<th scope="row">دوره تکرار اجرا (Interval):</th>
									<td>
										<select name="wp_cron_interval" class="regular-text" style="font-weight:700;">
											<?php foreach ( $wpcron_info['interval_labels'] as $int_key => $int_label ) : ?>
												<option value="<?php echo esc_attr( $int_key ); ?>" <?php selected( $wpcron_info['interval'], $int_key ); ?>>
													<?php echo esc_html( $int_label ); ?>
												</option>
											<?php endforeach; ?>
										</select>
										<p class="description">تعیین بازه تکرار اجرای خودکار کران اسکرپر در سیستم وردپرس.</p>
									</td>
								</tr>
							</table>

							<!-- دکمه اجرای دستی همین حالا -->
							<div style="background:#ffffff; border:1px solid #bfdbfe; border-radius:10px; padding:14px 16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
								<div>
									<strong style="color:#1e293b; font-size:0.92rem; display:block;">آزمایش و اجرای فوری کران‌جاب:</strong>
									<span style="color:#64748b; font-size:0.82rem;">می‌توانید بدون معطلی برای رسیدن زمان‌بندی، کران‌جاب اسکرپر را همین الان اجرا و نتیجه را بررسی نمایید.</span>
								</div>
								<button type="button" id="btnRunWpCronNow" class="button button-primary" style="background:#2563eb; border-color:#1d4ed8; font-weight:800; padding:6px 20px; border-radius:8px;">
									⚡ اجرای دستی کران‌جاب همین حالا (Run Now)
								</button>
							</div>
							<div id="wpCronRunNowStatus" style="display:none; margin-top:10px; padding:10px 14px; border-radius:8px; font-size:0.88rem;"></div>

							<!-- راهنمای تضمینی کران‌جاب ۱ دقیقه‌ای سرور -->
							<div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:10px; padding:16px 18px; margin-top:18px;">
								<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
									<span style="font-size:1.3rem;">⚡</span>
									<strong style="color:#0f172a; font-size:0.95rem;">راهکار تضمینی اجرای دقیق راس هر ۱ دقیقه (حتی بدون هیچ بازدیدکننده):</strong>
								</div>
								<p style="color:#475569; font-size:0.86rem; line-height:1.7; margin:0 0 10px 0;">
									<strong>نکته مهم:</strong> اعلان پیام‌های مشتری به محض ارسال در چت، به صورت <strong>کاملاً آنی (زیر ۱ ثانیه)</strong> به پیام‌رسان‌های بله، تلگرام و روبیکا فرستاده می‌شود. علاوه بر آن، با انتخاب بازه «هر ۱ دقیقه یک‌بار»، کران‌جاب هر ۶۰ ثانیه صف پیام‌های معلق را بازرسی می‌کند. برای اینکه این چرخه حتی وقتی هیچ کاربری در سایت آنلاین نیست دقیقاً کار کند، می‌توانید دستور زیر را در بخش <strong>Cron Jobs کنترل‌پنل هاست (cPanel / DirectAdmin)</strong> قرار دهید:
								</p>
								<div style="background:#0f172a; color:#38bdf8; font-family:monospace; padding:12px 16px; border-radius:8px; font-size:0.88rem; direction:ltr; text-align:left; user-select:all; overflow-x:auto; border:1px solid #334155;">
									* * * * * wget -q -O - "<?php echo esc_url( site_url( '/wp-cron.php?doing_wp_cron' ) ); ?>" >/dev/null 2>&1
								</div>
							</div>
						</div>
					</div>

					<!-- ================= SUB-TAB 1: ANALYTICS & FUNNEL ================= -->
					<div id="subtab-analytics" class="shop-subtab-panel" style="display:none;">
						<?php
						$analytics_source = $opts['analytics_source'] ?? 'hybrid';
						$wp_meta          = $analytics_data['wp_core_meta'] ?? array();
						$source_labels    = array(
							'internal'  => 'آمار داخلی افزونه (قیف رویدادها)',
							'wordpress' => 'هسته آمار وردپرس / ووکامرس',
							'hybrid'    => 'ترکیبی (افزونه + هسته وردپرس)',
						);
						$source_label_fa = $source_labels[ $analytics_source ] ?? $source_labels['hybrid'];
						?>

						<!-- Analytics Source + Admin Clean-up Settings -->
						<div class="admin-card" style="border:2px solid #6366f1; background:linear-gradient(180deg,#eef2ff 0%,#ffffff 100%); margin-bottom:20px;">
							<div class="admin-card-header" style="border-bottom:1px solid #c7d2fe;">
								<h3><span>⚙️</span> منبع آمار و پاکسازی پنل ادمین</h3>
								<span class="field-badge" style="background:#6366f1;color:#fff;">تنظیمات جدید</span>
							</div>

							<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap:16px;">
								<div>
									<label style="display:block; font-weight:800; color:#312e81; margin-bottom:8px; font-size:0.92rem;">
										📊 منبع نمایش آمار فروشگاه
									</label>
									<select name="analytics_source" style="width:100%; max-width:420px; padding:10px 12px; border-radius:10px; border:1.5px solid #a5b4fc; font-weight:700; background:#fff;">
										<option value="internal"  <?php selected( $analytics_source, 'internal' ); ?>>فقط آمار داخلی افزونه (رویدادهای ویترین)</option>
										<option value="wordpress" <?php selected( $analytics_source, 'wordpress' ); ?>>فقط هسته آمار وردپرس / ووکامرس</option>
										<option value="hybrid"    <?php selected( $analytics_source, 'hybrid' ); ?>>ترکیبی — ادغام افزونه + هسته وردپرس (پیشنهادی)</option>
									</select>
									<p style="margin:8px 0 0; font-size:0.8rem; color:#64748b; line-height:1.6;">
										در حالت <strong>هسته وردپرس</strong>، بازدیدها از شمارندهٔ بومی وردپرس (و در صورت نصب بودن افزونه WP Statistics)، سفارش‌ها و کالاهای پرفروش مستقیماً از دیتابیس ووکامرس خوانده می‌شوند.
									</p>
									<div style="margin-top:10px; background:#fff; border:1px dashed #a5b4fc; border-radius:10px; padding:10px 12px; font-size:0.82rem; color:#4338ca; font-weight:700;">
										منبع فعال الان: <?php echo esc_html( $source_label_fa ); ?>
									</div>
								</div>

								<div>
									<label style="display:flex; align-items:flex-start; gap:10px; background:#fff; border:1.5px solid #c4b5fd; border-radius:12px; padding:14px; cursor:pointer;">
										<input type="checkbox" name="hide_admin_nags" value="1" <?php checked( ! empty( $opts['hide_admin_nags'] ) ); ?> style="width:18px; height:18px; accent-color:#7c3aed; margin-top:2px;">
										<div>
											<strong style="display:block; font-size:0.92rem; color:#5b21b6;">🧹 غیرفعال‌سازی تبلیغات و هشدارهای آزاردهنده افزونه‌ها</strong>
											<span style="display:block; font-size:0.78rem; color:#64748b; margin-top:4px; line-height:1.6;">
												بنرهای ارتقا، پیشنهاد پرمیوم، Freemius، اعلان‌های بازاریابی ووکامرس/المنتور/یواست و سایر nagهای غیرضروری در کل پنل وردپرس مخفی می‌شوند. اعلان‌های خطای حیاتی و پیام‌های خود این افزونه حفظ می‌گردند.
											</span>
										</div>
									</label>
									<button type="submit" name="scraper_shop_save" class="button button-primary" style="margin-top:12px; background:#6366f1; border-color:#4f46e5; font-weight:800; border-radius:8px; padding:8px 18px;">
										💾 ذخیره منبع آمار و پاکسازی ادمین
									</button>
								</div>
							</div>

							<?php if ( ! empty( $wp_meta ) && in_array( $analytics_source, array( 'wordpress', 'hybrid' ), true ) ) : ?>
							<div style="margin-top:16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px;">
								<?php
								$meta_cards = array(
									array( '📦', 'محصولات ووکامرس', $wp_meta['wc_products'] ?? 0 ),
									array( '👥', 'کاربران', $wp_meta['users'] ?? 0 ),
									array( '🧾', 'مشتریان WC', $wp_meta['wc_customers'] ?? 0 ),
									array( '📝', 'نوشته‌ها', $wp_meta['posts'] ?? 0 ),
									array( '📄', 'برگه‌ها', $wp_meta['pages'] ?? 0 ),
									array( '💬', 'دیدگاه‌ها', $wp_meta['comments'] ?? 0 ),
									array( '🖼️', 'رسانه', $wp_meta['media'] ?? 0 ),
									array( '💰', 'جمع فروش', isset( $wp_meta['revenue_total'] ) ? self::format_price( $wp_meta['revenue_total'] ) : '—' ),
								);
								foreach ( $meta_cards as $mc ) :
									$is_money = ( false !== strpos( (string) $mc[1], 'فروش' ) );
									?>
									<div style="background:#fff; border:1px solid #e0e7ff; border-radius:10px; padding:10px; text-align:center;">
										<div style="font-size:1.1rem;"><?php echo $mc[0]; ?></div>
										<div style="font-size:0.72rem; color:#64748b; font-weight:700; margin:4px 0;"><?php echo esc_html( $mc[1] ); ?></div>
										<div style="font-size:0.95rem; font-weight:900; color:#312e81;">
											<?php echo $is_money ? esc_html( $mc[2] ) : self::to_fa_num( is_numeric( $mc[2] ) ? number_format( intval( $mc[2] ) ) : $mc[2] ); ?>
										</div>
									</div>
								<?php endforeach; ?>
							</div>
							<?php endif; ?>
						</div>

						<?php
						$totals         = $analytics_data['totals'] ?? array();
						$site_visits    = max( 0, intval( $totals['site_visit'] ?? 0 ) );
						$product_views  = max( 0, intval( $totals['product_view'] ?? 0 ) );
						$add_to_cart    = max( 0, intval( $totals['add_to_cart'] ?? 0 ) );
						$checkout_steps = max( 0, intval( $totals['checkout_step'] ?? 0 ) );
						$orders_placed  = max( 0, intval( $totals['order_placed'] ?? 0 ) );

						$view_rate     = $site_visits > 0 ? round( ( $product_views / $site_visits ) * 100, 1 ) : 0;
						$cart_rate     = $product_views > 0 ? round( ( $add_to_cart / $product_views ) * 100, 1 ) : 0;
						$checkout_rate = $add_to_cart > 0 ? round( ( $checkout_steps / $add_to_cart ) * 100, 1 ) : 0;
						$order_rate    = $checkout_steps > 0 ? round( ( $orders_placed / $checkout_steps ) * 100, 1 ) : 0;
						$overall_conv  = $site_visits > 0 ? round( ( $orders_placed / $site_visits ) * 100, 2 ) : 0;
						?>

						<!-- 1. KPI Metric Summary Cards -->
						<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:24px;">
							<!-- Site Visits -->
							<div style="background:linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border:1.5px solid #bfdbfe; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(37,99,235,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#1e40af;">🌐 بازدید از سایت</span>
									<span style="background:#dbeafe; color:#1d4ed8; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;">کل</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#0f172a; line-height:1.2;">
									<?php echo self::to_fa_num( number_format( $site_visits ) ); ?>
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">ورود به صفحات فروشگاه</div>
							</div>

							<!-- Product Views -->
							<div style="background:linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border:1.5px solid #99f6e4; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(13,148,136,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#0f766e;">👁️ مشاهده محصول</span>
									<span style="background:#ccfbf1; color:#0d9488; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;"><?php echo self::to_fa_num( $view_rate ); ?>%</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#0f172a; line-height:1.2;">
									<?php echo self::to_fa_num( number_format( $product_views ) ); ?>
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">مشاهده جزئیات کالا</div>
							</div>

							<!-- Add to Cart -->
							<div style="background:linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%); border:1.5px solid #a7f3d0; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(16,185,129,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#065f46;">🛒 افزودن به سبد</span>
									<span style="background:#d1fae5; color:#059669; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;"><?php echo self::to_fa_num( $cart_rate ); ?>%</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#0f172a; line-height:1.2;">
									<?php echo self::to_fa_num( number_format( $add_to_cart ) ); ?>
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">انتخاب برای خرید</div>
							</div>

							<!-- Checkout Steps -->
							<div style="background:linear-gradient(135deg, #fffbeb 0%, #ffffff 100%); border:1.5px solid #fde68a; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(217,119,6,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#92400e;">💳 رفتن به تسویه</span>
									<span style="background:#fef3c7; color:#d97706; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;"><?php echo self::to_fa_num( $checkout_rate ); ?>%</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#0f172a; line-height:1.2;">
									<?php echo self::to_fa_num( number_format( $checkout_steps ) ); ?>
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">ورود به نهایی‌سازی</div>
							</div>

							<!-- Orders Placed -->
							<div style="background:linear-gradient(135deg, #fdf2f8 0%, #ffffff 100%); border:1.5px solid #fbcfe8; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(219,39,119,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#9d174d;">🎁 ثبت سفارش</span>
									<span style="background:#fce7f3; color:#db2777; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;"><?php echo self::to_fa_num( $order_rate ); ?>%</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#0f172a; line-height:1.2;">
									<?php echo self::to_fa_num( number_format( $orders_placed ) ); ?>
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">فروش‌های نهایی موفق</div>
							</div>

							<!-- Overall Conversion Rate -->
							<div style="background:linear-gradient(135deg, #faf5ff 0%, #ffffff 100%); border:1.5px solid #e9d5ff; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(124,58,237,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
									<span style="font-size:0.8rem; font-weight:800; color:#6b21a8;">📈 نرخ تبدیل کل</span>
									<span style="background:#f3e8ff; color:#7c3aed; font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:8px;">قیف</span>
								</div>
								<div style="font-size:1.6rem; font-weight:900; color:#7c3aed; line-height:1.2;">
									<?php echo self::to_fa_num( $overall_conv ); ?>%
								</div>
								<div style="font-size:0.75rem; color:#64748b; margin-top:4px;">تبدیل بازدید به سفارش</div>
							</div>
						</div>

						<?php if ( $site_visits + $product_views + $add_to_cart + $checkout_steps + $orders_placed <= 0 ) : ?>
						<div style="margin-bottom:18px; background:linear-gradient(90deg,#eef2ff,#fdf2f8); border:1.5px solid #c7d2fe; border-radius:14px; padding:14px 18px; display:flex; gap:12px; align-items:flex-start;">
							<span style="font-size:1.4rem;">🧹</span>
							<div>
								<strong style="display:block; color:#312e81; font-size:0.95rem;">آمار ساختگی حذف شد — شروع از صفر</strong>
								<span style="font-size:0.82rem; color:#64748b; line-height:1.6;">اعداد دمو (مثل ۳۵۳۰ بازدید) دیگر نمایش داده نمی‌شوند. منبع آمار را روی «هسته وردپرس» یا «ترکیبی» بگذارید تا داده واقعی ووکامرس/بازدیدها نشان داده شود، یا منتظر رویدادهای زنده ویترین بمانید.</span>
							</div>
						</div>
						<?php endif; ?>

						<!-- 2. Visual Conversion Funnel — elegant line/area chart -->
						<div class="admin-card" style="overflow:hidden;">
							<div class="admin-card-header">
								<h3><span>📈</span> قیف تبدیل خطی فروشگاه (Line Conversion Funnel)</h3>
								<span class="field-badge field-badge-blue">تحلیل ریزش و تبدیل کاربران</span>
							</div>

							<p style="color:#64748b; font-size:0.88rem; line-height:1.6; margin-top:0;">
								مسیر تبدیل مشتری از ورود تا ثبت سفارش به‌صورت نمودار خطی نرم با سایه گرادیانی نمایش داده می‌شود:
							</p>

							<?php
							$funnel_steps = array(
								array(
									'key'   => 'site_visit',
									'label' => 'ورود به سایت',
									'short' => 'بازدید',
									'value' => $site_visits,
									'rate'  => 100,
									'color' => '#3b82f6',
									'color2'=> '#60a5fa',
								),
								array(
									'key'   => 'product_view',
									'label' => 'مشاهده محصول',
									'short' => 'مشاهده',
									'value' => $product_views,
									'rate'  => $view_rate,
									'color' => '#14b8a6',
									'color2'=> '#2dd4bf',
								),
								array(
									'key'   => 'add_to_cart',
									'label' => 'افزودن به سبد',
									'short' => 'سبد',
									'value' => $add_to_cart,
									'rate'  => $cart_rate,
									'color' => '#10b981',
									'color2'=> '#34d399',
								),
								array(
									'key'   => 'checkout_step',
									'label' => 'تسویه‌حساب',
									'short' => 'تسویه',
									'value' => $checkout_steps,
									'rate'  => $checkout_rate,
									'color' => '#f59e0b',
									'color2'=> '#fbbf24',
								),
								array(
									'key'   => 'order_placed',
									'label' => 'ثبت سفارش',
									'short' => 'سفارش',
									'value' => $orders_placed,
									'rate'  => $overall_conv,
									'color' => '#ec4899',
									'color2'=> '#f472b6',
								),
							);
							$funnel_max   = max( 1, $site_visits );
							$fv_w         = 720;
							$fv_h         = 260;
							$fv_pad_l     = 48;
							$fv_pad_r     = 24;
							$fv_pad_t     = 28;
							$fv_pad_b     = 52;
							$fv_plot_w    = $fv_w - $fv_pad_l - $fv_pad_r;
							$fv_plot_h    = $fv_h - $fv_pad_t - $fv_pad_b;
							$fv_n         = count( $funnel_steps );
							$fv_pts       = array();
							foreach ( $funnel_steps as $fi => $fs ) {
								$fx = $fv_pad_l + ( $fv_n > 1 ? ( $fi / ( $fv_n - 1 ) ) * $fv_plot_w : $fv_plot_w / 2 );
								$fy = $fv_pad_t + $fv_plot_h - ( max( 0, min( 1, $fs['value'] / $funnel_max ) ) * $fv_plot_h );
								$fv_pts[] = array( 'x' => round( $fx, 2 ), 'y' => round( $fy, 2 ), 'step' => $fs );
							}
							// Smooth cubic path
							$fv_line = '';
							$fv_area = '';
							if ( ! empty( $fv_pts ) ) {
								$fv_line = 'M ' . $fv_pts[0]['x'] . ' ' . $fv_pts[0]['y'];
								for ( $i = 1; $i < count( $fv_pts ); $i++ ) {
									$p0 = $fv_pts[ $i - 1 ];
									$p1 = $fv_pts[ $i ];
									$cx = ( $p0['x'] + $p1['x'] ) / 2;
									$fv_line .= ' C ' . $cx . ' ' . $p0['y'] . ', ' . $cx . ' ' . $p1['y'] . ', ' . $p1['x'] . ' ' . $p1['y'];
								}
								$last = $fv_pts[ count( $fv_pts ) - 1 ];
								$first = $fv_pts[0];
								$base_y = $fv_pad_t + $fv_plot_h;
								$fv_area = $fv_line . ' L ' . $last['x'] . ' ' . $base_y . ' L ' . $first['x'] . ' ' . $base_y . ' Z';
							}
							?>

							<div style="position:relative; background:linear-gradient(180deg, #f8fafc 0%, #ffffff 55%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:16px; padding:8px 4px 4px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.8);">
								<svg id="scraperFunnelLineChart" viewBox="0 0 <?php echo (int) $fv_w; ?> <?php echo (int) $fv_h; ?>" width="100%" height="280" style="display:block; max-width:100%; font-family:system-ui,Tahoma,sans-serif;" role="img" aria-label="نمودار خطی قیف تبدیل">
									<defs>
										<linearGradient id="funnelAreaGrad" x1="0" y1="0" x2="0" y2="1">
											<stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
											<stop offset="55%" stop-color="#3b82f6" stop-opacity="0.12"/>
											<stop offset="100%" stop-color="#3b82f6" stop-opacity="0.02"/>
										</linearGradient>
										<linearGradient id="funnelStrokeGrad" x1="0" y1="0" x2="1" y2="0">
											<stop offset="0%" stop-color="#3b82f6"/>
											<stop offset="25%" stop-color="#14b8a6"/>
											<stop offset="50%" stop-color="#10b981"/>
											<stop offset="75%" stop-color="#f59e0b"/>
											<stop offset="100%" stop-color="#ec4899"/>
										</linearGradient>
										<filter id="funnelGlow" x="-20%" y="-20%" width="140%" height="140%">
											<feGaussianBlur stdDeviation="3.5" result="blur"/>
											<feMerge>
												<feMergeNode in="blur"/>
												<feMergeNode in="SourceGraphic"/>
											</feMerge>
										</filter>
										<filter id="funnelSoftShadow" x="-10%" y="-10%" width="120%" height="130%">
											<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#6366f1" flood-opacity="0.18"/>
										</filter>
									</defs>

									<!-- subtle grid -->
									<?php for ( $gi = 0; $gi <= 4; $gi++ ) :
										$gy = $fv_pad_t + ( $gi / 4 ) * $fv_plot_h;
										$gval = (int) round( $funnel_max * ( 1 - $gi / 4 ) );
										?>
										<line x1="<?php echo $fv_pad_l; ?>" y1="<?php echo $gy; ?>" x2="<?php echo $fv_w - $fv_pad_r; ?>" y2="<?php echo $gy; ?>" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 6"/>
										<text x="<?php echo $fv_pad_l - 8; ?>" y="<?php echo $gy + 4; ?>" text-anchor="end" fill="#94a3b8" font-size="10" font-weight="700"><?php echo esc_html( self::to_fa_num( number_format( $gval ) ) ); ?></text>
									<?php endfor; ?>

									<!-- area + glow line -->
									<?php if ( $fv_area ) : ?>
										<path d="<?php echo esc_attr( $fv_area ); ?>" fill="url(#funnelAreaGrad)" filter="url(#funnelSoftShadow)"/>
										<path d="<?php echo esc_attr( $fv_line ); ?>" fill="none" stroke="url(#funnelStrokeGrad)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#funnelGlow)"/>
										<path d="<?php echo esc_attr( $fv_line ); ?>" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-opacity="0.55"/>
									<?php endif; ?>

									<!-- points + labels -->
									<?php foreach ( $fv_pts as $fi => $pt ) :
										$fs = $pt['step'];
										?>
										<!-- vertical guide -->
										<line x1="<?php echo $pt['x']; ?>" y1="<?php echo $fv_pad_t; ?>" x2="<?php echo $pt['x']; ?>" y2="<?php echo $fv_pad_t + $fv_plot_h; ?>" stroke="<?php echo esc_attr( $fs['color'] ); ?>" stroke-width="1" stroke-opacity="0.12" stroke-dasharray="3 5"/>
										<!-- outer glow ring -->
										<circle cx="<?php echo $pt['x']; ?>" cy="<?php echo $pt['y']; ?>" r="11" fill="<?php echo esc_attr( $fs['color'] ); ?>" fill-opacity="0.15"/>
										<circle cx="<?php echo $pt['x']; ?>" cy="<?php echo $pt['y']; ?>" r="6.5" fill="#fff" stroke="<?php echo esc_attr( $fs['color'] ); ?>" stroke-width="3"/>
										<circle cx="<?php echo $pt['x']; ?>" cy="<?php echo $pt['y']; ?>" r="2.8" fill="<?php echo esc_attr( $fs['color'] ); ?>"/>
										<!-- value bubble -->
										<rect x="<?php echo $pt['x'] - 28; ?>" y="<?php echo max( 6, $pt['y'] - 28 ); ?>" width="56" height="18" rx="9" fill="<?php echo esc_attr( $fs['color'] ); ?>" fill-opacity="0.95"/>
										<text x="<?php echo $pt['x']; ?>" y="<?php echo max( 6, $pt['y'] - 28 ) + 12.5; ?>" text-anchor="middle" fill="#fff" font-size="10" font-weight="800"><?php echo esc_html( self::to_fa_num( number_format( $fs['value'] ) ) ); ?></text>
										<!-- x label -->
										<text x="<?php echo $pt['x']; ?>" y="<?php echo $fv_h - 28; ?>" text-anchor="middle" fill="#334155" font-size="11" font-weight="800"><?php echo esc_html( $fs['short'] ); ?></text>
										<text x="<?php echo $pt['x']; ?>" y="<?php echo $fv_h - 12; ?>" text-anchor="middle" fill="<?php echo esc_attr( $fs['color'] ); ?>" font-size="10" font-weight="700"><?php echo esc_html( self::to_fa_num( $fs['rate'] ) ); ?>٪</text>
									<?php endforeach; ?>
								</svg>

								<!-- step chips under chart -->
								<div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; padding:4px 10px 12px;">
									<?php foreach ( $funnel_steps as $fi => $fs ) : ?>
										<div style="display:inline-flex; align-items:center; gap:6px; background:#fff; border:1px solid <?php echo esc_attr( $fs['color'] ); ?>33; border-radius:999px; padding:5px 12px; box-shadow:0 2px 8px <?php echo esc_attr( $fs['color'] ); ?>14;">
											<span style="width:8px; height:8px; border-radius:50%; background:<?php echo esc_attr( $fs['color'] ); ?>; box-shadow:0 0 0 3px <?php echo esc_attr( $fs['color'] ); ?>22;"></span>
											<span style="font-size:0.78rem; font-weight:800; color:#0f172a;"><?php echo esc_html( ( $fi + 1 ) . '. ' . $fs['label'] ); ?></span>
											<span style="font-size:0.75rem; font-weight:800; color:<?php echo esc_attr( $fs['color'] ); ?>;"><?php echo self::to_fa_num( number_format( $fs['value'] ) ); ?></span>
										</div>
									<?php endforeach; ?>
								</div>
							</div>
						</div>

						<!-- 3. Multi-series smooth Daily Line Chart -->
						<div class="admin-card" style="overflow:hidden;">
							<div class="admin-card-header">
								<h3><span>📉</span> روند خطی فعالیت‌های روزانه (Smooth Line Chart)</h3>
								<div id="scraperDailyLegend" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; font-size:0.78rem; font-weight:700;"></div>
							</div>

							<?php
							$daily_stats = $analytics_data['daily'] ?? array();
							if ( empty( $daily_stats ) || ! is_array( $daily_stats ) ) {
								$daily_stats = array();
							}
							ksort( $daily_stats );
							$recent_days = array_slice( $daily_stats, -14, 14, true );
							// Keep real days only — never invent synthetic series for empty stats.

							$series_def = array(
								'site_visit'    => array( 'label' => 'بازدید سایت', 'color' => '#3b82f6', 'color2' => '#93c5fd' ),
								'product_view'  => array( 'label' => 'مشاهده محصول', 'color' => '#14b8a6', 'color2' => '#99f6e4' ),
								'add_to_cart'   => array( 'label' => 'افزودن به سبد', 'color' => '#10b981', 'color2' => '#6ee7b7' ),
								'order_placed'  => array( 'label' => 'سفارش نهایی', 'color' => '#ec4899', 'color2' => '#f9a8d4' ),
							);

							$day_keys = array_keys( $recent_days );
							$n_days   = count( $day_keys );
							$max_day_val = 10;
							foreach ( $recent_days as $d_row ) {
								foreach ( array_keys( $series_def ) as $sk ) {
									$max_day_val = max( $max_day_val, intval( $d_row[ $sk ] ?? 0 ) );
								}
							}
							// nice max headroom
							$max_day_val = (int) max( 10, ceil( $max_day_val * 1.12 ) );

							$dv_w = 860;
							$dv_h = 320;
							$dv_pl = 52;
							$dv_pr = 20;
							$dv_pt = 24;
							$dv_pb = 44;
							$dv_pw = $dv_w - $dv_pl - $dv_pr;
							$dv_ph = $dv_h - $dv_pt - $dv_pb;

							$series_paths = array();
							$series_areas = array();
							$series_points = array();

							foreach ( $series_def as $sk => $smeta ) {
								$pts = array();
								foreach ( $day_keys as $di => $dk ) {
									$val = intval( $recent_days[ $dk ][ $sk ] ?? 0 );
									$x = $dv_pl + ( $n_days > 1 ? ( $di / ( $n_days - 1 ) ) * $dv_pw : $dv_pw / 2 );
									$y = $dv_pt + $dv_ph - ( max( 0, min( 1, $val / $max_day_val ) ) * $dv_ph );
									$pts[] = array(
										'x'     => round( $x, 2 ),
										'y'     => round( $y, 2 ),
										'val'   => $val,
										'date'  => $dk,
										'label' => $smeta['label'],
										'color' => $smeta['color'],
									);
								}
								$line = '';
								if ( ! empty( $pts ) ) {
									$line = 'M ' . $pts[0]['x'] . ' ' . $pts[0]['y'];
									for ( $i = 1; $i < count( $pts ); $i++ ) {
										$p0 = $pts[ $i - 1 ];
										$p1 = $pts[ $i ];
										$cx = ( $p0['x'] + $p1['x'] ) / 2;
										$line .= ' C ' . $cx . ' ' . $p0['y'] . ', ' . $cx . ' ' . $p1['y'] . ', ' . $p1['x'] . ' ' . $p1['y'];
									}
								}
								$area = '';
								if ( $line && ! empty( $pts ) ) {
									$last = $pts[ count( $pts ) - 1 ];
									$first = $pts[0];
									$base = $dv_pt + $dv_ph;
									$area = $line . ' L ' . $last['x'] . ' ' . $base . ' L ' . $first['x'] . ' ' . $base . ' Z';
								}
								$series_paths[ $sk ]  = $line;
								$series_areas[ $sk ]  = $area;
								$series_points[ $sk ] = $pts;
							}

							$daily_chart_payload = array(
								'days'   => $day_keys,
								'series' => array(),
							);
							foreach ( $series_def as $sk => $smeta ) {
								$vals = array();
								foreach ( $day_keys as $dk ) {
									$vals[] = intval( $recent_days[ $dk ][ $sk ] ?? 0 );
								}
								$daily_chart_payload['series'][] = array(
									'key'   => $sk,
									'label' => $smeta['label'],
									'color' => $smeta['color'],
									'values'=> $vals,
								);
							}
							?>

							<?php if ( $n_days < 1 ) : ?>
							<div style="background:linear-gradient(135deg,#f8fafc,#eef2ff); border:1.5px dashed #c7d2fe; border-radius:16px; padding:36px 20px; text-align:center;">
								<div style="font-size:2rem; margin-bottom:8px;">📭</div>
								<div style="font-weight:900; color:#312e81; font-size:1rem;">هنوز آمار واقعی ثبت نشده است</div>
								<p style="margin:8px auto 0; max-width:420px; color:#64748b; font-size:0.86rem; line-height:1.7;">
									اعداد نمایشی ساختگی حذف شده‌اند. با بازدید کاربران از فروشگاه، مشاهده محصولات و ثبت سفارش، نمودارها به‌صورت خودکار با داده‌های واقعی پر می‌شوند.
								</p>
							</div>
							<?php else : ?>
							<div style="position:relative; background:
								radial-gradient(1200px 200px at 10% -10%, rgba(59,130,246,0.10), transparent 60%),
								radial-gradient(900px 180px at 90% 0%, rgba(236,72,153,0.08), transparent 55%),
								linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #0f172a 100%);
								border-radius:18px; padding:14px 10px 8px; box-shadow:0 18px 40px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.06);">
								<div style="display:flex; justify-content:space-between; align-items:center; padding:0 12px 8px; flex-wrap:wrap; gap:8px;">
									<div style="color:#e2e8f0; font-size:0.82rem; font-weight:700; opacity:0.9;">
										<span style="display:inline-flex; align-items:center; gap:6px;">
											<span style="width:8px; height:8px; border-radius:50%; background:#22d3ee; box-shadow:0 0 10px #22d3ee;"></span>
											روند ۱۴ روز اخیر — مقیاس نرمال‌شده
										</span>
									</div>
									<div id="scraperDailyTooltip" style="display:none; background:rgba(15,23,42,0.92); color:#f8fafc; border:1px solid rgba(148,163,184,0.35); border-radius:12px; padding:8px 12px; font-size:0.78rem; font-weight:700; box-shadow:0 10px 30px rgba(0,0,0,0.35); min-width:160px; backdrop-filter:blur(8px);"></div>
								</div>

								<svg id="scraperDailyLineChart" viewBox="0 0 <?php echo (int) $dv_w; ?> <?php echo (int) $dv_h; ?>" width="100%" height="300" style="display:block; max-width:100%; cursor:crosshair; font-family:system-ui,Tahoma,sans-serif;" role="img" aria-label="نمودار خطی روند روزانه">
									<defs>
										<?php foreach ( $series_def as $sk => $smeta ) : ?>
											<linearGradient id="area_<?php echo esc_attr( $sk ); ?>" x1="0" y1="0" x2="0" y2="1">
												<stop offset="0%" stop-color="<?php echo esc_attr( $smeta['color'] ); ?>" stop-opacity="0.38"/>
												<stop offset="70%" stop-color="<?php echo esc_attr( $smeta['color'] ); ?>" stop-opacity="0.06"/>
												<stop offset="100%" stop-color="<?php echo esc_attr( $smeta['color'] ); ?>" stop-opacity="0"/>
											</linearGradient>
											<linearGradient id="stroke_<?php echo esc_attr( $sk ); ?>" x1="0" y1="0" x2="1" y2="0">
												<stop offset="0%" stop-color="<?php echo esc_attr( $smeta['color2'] ); ?>"/>
												<stop offset="100%" stop-color="<?php echo esc_attr( $smeta['color'] ); ?>"/>
											</linearGradient>
										<?php endforeach; ?>
										<filter id="dailyLineGlow" x="-30%" y="-30%" width="160%" height="160%">
											<feGaussianBlur stdDeviation="2.8" result="b"/>
											<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
										</filter>
										<clipPath id="dailyPlotClip">
											<rect x="<?php echo $dv_pl; ?>" y="<?php echo $dv_pt; ?>" width="<?php echo $dv_pw; ?>" height="<?php echo $dv_ph; ?>" rx="4"/>
										</clipPath>
									</defs>

									<!-- dark grid -->
									<?php for ( $gi = 0; $gi <= 5; $gi++ ) :
										$gy = $dv_pt + ( $gi / 5 ) * $dv_ph;
										$gval = (int) round( $max_day_val * ( 1 - $gi / 5 ) );
										?>
										<line x1="<?php echo $dv_pl; ?>" y1="<?php echo $gy; ?>" x2="<?php echo $dv_w - $dv_pr; ?>" y2="<?php echo $gy; ?>" stroke="rgba(148,163,184,0.15)" stroke-width="1" stroke-dasharray="3 7"/>
										<text x="<?php echo $dv_pl - 10; ?>" y="<?php echo $gy + 3; ?>" text-anchor="end" fill="rgba(226,232,240,0.55)" font-size="10" font-weight="700"><?php echo esc_html( self::to_fa_num( number_format( $gval ) ) ); ?></text>
									<?php endfor; ?>

									<!-- vertical day guides -->
									<?php foreach ( $day_keys as $di => $dk ) :
										$x = $dv_pl + ( $n_days > 1 ? ( $di / ( $n_days - 1 ) ) * $dv_pw : $dv_pw / 2 );
										$show_lbl = ( 0 === $di % max( 1, (int) ceil( $n_days / 7 ) ) ) || $di === $n_days - 1;
										?>
										<line x1="<?php echo $x; ?>" y1="<?php echo $dv_pt; ?>" x2="<?php echo $x; ?>" y2="<?php echo $dv_pt + $dv_ph; ?>" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>
										<?php if ( $show_lbl ) : ?>
											<text x="<?php echo $x; ?>" y="<?php echo $dv_h - 14; ?>" text-anchor="middle" fill="rgba(226,232,240,0.65)" font-size="10" font-weight="700" direction="ltr"><?php echo esc_html( substr( $dk, 5 ) ); ?></text>
										<?php endif; ?>
									<?php endforeach; ?>

									<g clip-path="url(#dailyPlotClip)">
										<?php
										// draw areas first (under), then lines
										foreach ( array_reverse( $series_def, true ) as $sk => $smeta ) :
											if ( empty( $series_areas[ $sk ] ) ) {
												continue;
											}
											?>
											<path d="<?php echo esc_attr( $series_areas[ $sk ] ); ?>" fill="url(#area_<?php echo esc_attr( $sk ); ?>)"/>
										<?php endforeach; ?>

										<?php foreach ( $series_def as $sk => $smeta ) :
											if ( empty( $series_paths[ $sk ] ) ) {
												continue;
											}
											?>
											<path class="scraper-daily-line" data-series="<?php echo esc_attr( $sk ); ?>" d="<?php echo esc_attr( $series_paths[ $sk ] ); ?>" fill="none" stroke="url(#stroke_<?php echo esc_attr( $sk ); ?>)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#dailyLineGlow)" style="transition:stroke-opacity .2s;"/>
										<?php endforeach; ?>
									</g>

									<!-- interactive dots -->
									<?php foreach ( $series_def as $sk => $smeta ) :
										foreach ( $series_points[ $sk ] as $pt ) : ?>
											<circle
												class="scraper-daily-dot"
												data-series="<?php echo esc_attr( $sk ); ?>"
												data-date="<?php echo esc_attr( $pt['date'] ); ?>"
												data-val="<?php echo esc_attr( $pt['val'] ); ?>"
												data-label="<?php echo esc_attr( $pt['label'] ); ?>"
												data-color="<?php echo esc_attr( $pt['color'] ); ?>"
												cx="<?php echo $pt['x']; ?>"
												cy="<?php echo $pt['y']; ?>"
												r="4.2"
												fill="#0f172a"
												stroke="<?php echo esc_attr( $smeta['color'] ); ?>"
												stroke-width="2.4"
												style="cursor:pointer; transition: r .15s;"
											/>
										<?php endforeach;
									endforeach; ?>

									<!-- hover crosshair -->
									<line id="scraperDailyCrosshair" x1="0" y1="<?php echo $dv_pt; ?>" x2="0" y2="<?php echo $dv_pt + $dv_ph; ?>" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-dasharray="4 4" opacity="0"/>
								</svg>
							</div>
							<?php endif; ?>

							<script type="application/json" id="scraperDailyChartData"><?php echo wp_json_encode( $daily_chart_payload, JSON_UNESCAPED_UNICODE ); ?></script>
							<script>
							(function(){
								var svg = document.getElementById('scraperDailyLineChart');
								var tip = document.getElementById('scraperDailyTooltip');
								var legend = document.getElementById('scraperDailyLegend');
								var cross = document.getElementById('scraperDailyCrosshair');
								var dataEl = document.getElementById('scraperDailyChartData');
								if (!svg || !dataEl) return;
								var payload = {};
								try { payload = JSON.parse(dataEl.textContent || '{}'); } catch(e) { payload = {}; }

								function toFa(n){
									return String(n).replace(/\d/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'[d]; });
								}

								// Legend with toggle
								var active = {};
								(payload.series || []).forEach(function(s){ active[s.key] = true; });
								function renderLegend(){
									if (!legend) return;
									legend.innerHTML = '';
									(payload.series || []).forEach(function(s){
										var btn = document.createElement('button');
										btn.type = 'button';
										btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;border:1.5px solid '+(active[s.key]?s.color:'#cbd5e1')+';background:'+(active[s.key]?'#fff':'#f8fafc')+';color:'+(active[s.key]?'#0f172a':'#94a3b8')+';font-weight:800;font-size:0.75rem;cursor:pointer;opacity:'+(active[s.key]?'1':'0.55');
										btn.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:'+s.color+';box-shadow:0 0 0 3px '+s.color+'22"></span>' + s.label;
										btn.addEventListener('click', function(){
											active[s.key] = !active[s.key];
											applyVisibility();
											renderLegend();
										});
										legend.appendChild(btn);
									});
								}
								function applyVisibility(){
									svg.querySelectorAll('.scraper-daily-line, .scraper-daily-dot').forEach(function(el){
										var k = el.getAttribute('data-series');
										el.style.opacity = active[k] ? '1' : '0.08';
										el.style.pointerEvents = active[k] ? 'auto' : 'none';
									});
								}
								renderLegend();
								applyVisibility();

								function showTip(html){
									if (!tip) return;
									tip.style.display = 'block';
									tip.innerHTML = html;
								}
								function hideTip(){
									if (!tip) return;
									tip.style.display = 'none';
									if (cross) cross.setAttribute('opacity', '0');
									svg.querySelectorAll('.scraper-daily-dot').forEach(function(d){ d.setAttribute('r', '4.2'); });
								}

								svg.querySelectorAll('.scraper-daily-dot').forEach(function(dot){
									dot.addEventListener('mouseenter', function(){
										var date = dot.getAttribute('data-date');
										var rows = [];
										svg.querySelectorAll('.scraper-daily-dot[data-date="'+date+'"]').forEach(function(d){
											var k = d.getAttribute('data-series');
											if (!active[k]) return;
											d.setAttribute('r', '6.5');
											rows.push('<div style="display:flex;justify-content:space-between;gap:14px;margin:2px 0"><span style="color:'+d.getAttribute('data-color')+'">● '+d.getAttribute('data-label')+'</span><strong>'+toFa(d.getAttribute('data-val'))+'</strong></div>');
										});
										var cx = parseFloat(dot.getAttribute('cx')) || 0;
										if (cross) {
											cross.setAttribute('x1', cx);
											cross.setAttribute('x2', cx);
											cross.setAttribute('opacity', '1');
										}
										showTip('<div style="opacity:.7;margin-bottom:4px;direction:ltr;text-align:left">📅 '+date+'</div>' + rows.join(''));
									});
									dot.addEventListener('mouseleave', hideTip);
								});
							})();
							</script>
						</div>

						<!-- 4. Messenger Notification Toggles for Funnel Events -->
						<div class="admin-card" style="border:2px solid #3b82f6; background:linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);">
							<div class="admin-card-header" style="border-bottom:1px solid #bfdbfe;">
								<h3><span>🔔</span> تنظیمات اعلان‌های لحظه‌ای پیام‌رسان (بله، تلگرام، روبیکا)</h3>
								<span class="field-badge field-badge-green">اعلان خودکار به ادمین</span>
							</div>

							<p style="color:#334155; font-size:0.88rem; line-height:1.7; margin-top:0;">
								با فعال‌سازی هر یک از گزینه‌های زیر، به محض وقوع رویداد توسط مشتری در ویترین فروشگاه، یک پیام فوری همراه با جزئیات کامل به پیام‌رسان‌های متصل شما (بله، تلگرام یا روبیکا) ارسال خواهد شد:
							</p>

							<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap:14px; margin-bottom:14px;">
								<!-- 1. Site Visit -->
								<label style="background:#ffffff; border:1.5px solid #cbd5e1; border-radius:12px; padding:14px; cursor:pointer; display:flex; align-items:flex-start; gap:10px;">
									<input type="checkbox" name="notif_event_site_visit" value="1" <?php checked( ! empty( $opts['notif_event_site_visit'] ) ); ?> style="width:18px; height:18px; accent-color:#2563eb; margin-top:2px;">
									<div>
										<strong style="font-size:0.92rem; color:#0f172a; display:block;">🌐 اعلان بازدید از سایت</strong>
										<span style="font-size:0.78rem; color:#64748b;">ارسال نوع صفحه، دستگاه، مرورگر، سیستم‌عامل، زبان، دامنه ارجاع و IP کامل اتصال به پیام‌رسان؛ IP ممکن است متعلق به پراکسی باشد و ارجاع ممکن است در دسترس نباشد. اعلان‌های بسیار نزدیک ممکن است ادغام شوند.</span>
									</div>
								</label>

								<!-- 2. Product View -->
								<label style="background:#ffffff; border:1.5px solid #cbd5e1; border-radius:12px; padding:14px; cursor:pointer; display:flex; align-items:flex-start; gap:10px;">
									<input type="checkbox" name="notif_event_product_view" value="1" <?php checked( ! empty( $opts['notif_event_product_view'] ) ); ?> style="width:18px; height:18px; accent-color:#2563eb; margin-top:2px;">
									<div>
										<strong style="font-size:0.92rem; color:#0f172a; display:block;">👁️ اعلان مشاهده محصول</strong>
										<span style="font-size:0.78rem; color:#64748b;">ارسال پیام با نام و قیمت محصول هنگام کلیک و مشاهده کالا</span>
									</div>
								</label>

								<!-- 3. Add to Cart -->
								<label style="background:#ffffff; border:1.5px solid #10b981; border-radius:12px; padding:14px; cursor:pointer; display:flex; align-items:flex-start; gap:10px;">
									<input type="checkbox" name="notif_event_add_to_cart" value="1" <?php checked( ! empty( $opts['notif_event_add_to_cart'] ) ); ?> style="width:18px; height:18px; accent-color:#10b981; margin-top:2px;">
									<div>
										<strong style="font-size:0.92rem; color:#065f46; display:block;">🛒 اعلان افزودن به سبد خرید (توصیه شده)</strong>
										<span style="font-size:0.78rem; color:#64748b;">ارسال نام کالا، تعداد و قیمت به محض افزودن به سبد توسط مشتری</span>
									</div>
								</label>

								<!-- 4. Checkout Step -->
								<label style="background:#ffffff; border:1.5px solid #f59e0b; border-radius:12px; padding:14px; cursor:pointer; display:flex; align-items:flex-start; gap:10px;">
									<input type="checkbox" name="notif_event_checkout_step" value="1" <?php checked( ! empty( $opts['notif_event_checkout_step'] ) ); ?> style="width:18px; height:18px; accent-color:#f59e0b; margin-top:2px;">
									<div>
										<strong style="font-size:0.92rem; color:#92400e; display:block;">💳 اعلان ورود به تسویه‌حساب (مهم)</strong>
										<span style="font-size:0.78rem; color:#64748b;">ارسال مبلغ کل سبد خرید و تعداد اقلام هنگام مراجعه به برگه پرداخت</span>
									</div>
								</label>

								<!-- 5. Order Placed -->
								<label style="background:#ffffff; border:1.5px solid #ec4899; border-radius:12px; padding:14px; cursor:pointer; display:flex; align-items:flex-start; gap:10px;">
									<input type="checkbox" name="notif_event_order_placed" value="1" <?php checked( ! empty( $opts['notif_event_order_placed'] ) ); ?> style="width:18px; height:18px; accent-color:#ec4899; margin-top:2px;">
									<div>
										<strong style="font-size:0.92rem; color:#9d174d; display:block;">🎉 اعلان ثبت سفارش جدید (بسیار مهم)</strong>
										<span style="font-size:0.78rem; color:#64748b;">ارسال شماره فاکتور، مبلغ، نام مشتری و شماره موبایل برای آماده‌سازی سریع</span>
									</div>
								</label>
							</div>

							<div style="background:#ffffff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
								<span style="font-size:0.84rem; color:#475569;">
									📡 پیام‌رسان‌های فعال برای دریافت اعلان: 
									<strong><?php echo implode( ' ، ', array_map( function($k){ return $k === 'bale' ? 'بله' : ( $k === 'telegram' ? 'تلگرام' : 'روبیکا' ); }, array_keys($active_msgrs) ) ) ?: 'هیچ پیام‌رسانی تنظیم نشده (از تب پیام‌رسان‌ها متصل کنید)'; ?></strong>
								</span>
								<button type="submit" name="scraper_shop_save" class="button button-primary" style="background:#2563eb; border-color:#1d4ed8; font-weight:800; border-radius:8px;">
									💾 ذخیره تنظیمات اعلان‌ها
								</button>
							</div>
						</div>

						<!-- 5. Live Events Log & Top Products -->
						<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap:20px;">
							<!-- Live Recent Events Table -->
							<div class="admin-card" style="margin-bottom:0;">
								<div class="admin-card-header">
									<h3><span>⚡</span> آخرین رویدادهای زنده کاربران</h3>
									<button type="button" id="btnResetAnalytics" class="button button-small" style="color:#ef4444; border-color:#fca5a5;">
										🗑️ بازنشانی آمار
									</button>
								</div>

								<div style="max-height:360px; overflow-y:auto;">
									<table class="wp-list-table widefat fixed striped" style="font-size:0.82rem;">
										<thead>
											<tr>
												<th style="width:85px;">زمان</th>
												<th style="width:110px;">نوع رویداد</th>
												<th>شرح رویداد / کالا</th>
											</tr>
										</thead>
										<tbody>
											<?php
											$recent_events = $analytics_data['recent_events'] ?? array();
											if ( empty( $recent_events ) ) : ?>
												<tr><td colspan="3" style="text-align:center; color:#94a3b8;">هنوز رویدادی ثبت نشده است.</td></tr>
											<?php else :
												foreach ( array_slice( $recent_events, 0, 15 ) as $ev ) :
													$ev_type = $ev['type'] ?? '';
													$badge_color = '#2563eb';
													$badge_lbl   = 'بازدید سایت';
													if ( 'product_view' === $ev_type ) { $badge_color = '#0d9488'; $badge_lbl = 'مشاهده کالا'; }
													elseif ( 'add_to_cart' === $ev_type ) { $badge_color = '#059669'; $badge_lbl = 'افزودن به سبد'; }
													elseif ( 'checkout_step' === $ev_type ) { $badge_color = '#d97706'; $badge_lbl = 'تسویه‌حساب'; }
													elseif ( 'order_placed' === $ev_type ) { $badge_color = '#db2777'; $badge_lbl = 'ثبت سفارش'; }
													?>
													<tr>
														<td style="color:#64748b; font-size:0.75rem;"><?php echo esc_html( $ev['time'] ?? '' ); ?></td>
														<td>
															<span style="background:<?php echo $badge_color; ?>18; color:<?php echo $badge_color; ?>; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem;">
																<?php echo esc_html( $badge_lbl ); ?>
															</span>
														</td>
														<td>
															<strong><?php echo esc_html( $ev['title'] ?? '' ); ?></strong>
															<?php if ( ! empty( $ev['customer'] ) && 'کاربر مهمان' !== $ev['customer'] ) : ?>
																<div style="font-size:0.72rem; color:#64748b;"><?php echo esc_html( $ev['customer'] ); ?></div>
															<?php endif; ?>
														</td>
													</tr>
												<?php endforeach;
											endif; ?>
										</tbody>
									</table>
								</div>
							</div>

							<!-- Top Products Table -->
							<div class="admin-card" style="margin-bottom:0;">
								<div class="admin-card-header">
									<h3><span>🔥</span> محبوب‌ترین کالاهای مورد توجه مشتریان</h3>
									<span class="field-badge field-badge-purple">تحلیل تقاضا</span>
								</div>

								<div style="max-height:360px; overflow-y:auto;">
									<table class="wp-list-table widefat fixed striped" style="font-size:0.82rem;">
										<thead>
											<tr>
												<th>نام کالا</th>
												<th style="width:75px;">مشاهده</th>
												<th style="width:75px;">سبد خرید</th>
											</tr>
										</thead>
										<tbody>
											<?php
											$top_prods = $analytics_data['top_products'] ?? array();
											if ( empty( $top_prods ) ) : ?>
												<tr><td colspan="3" style="text-align:center; color:#94a3b8;">اطلاعاتی ثبت نشده است.</td></tr>
											<?php else :
												foreach ( array_slice( $top_prods, 0, 8 ) as $tp ) : ?>
													<tr>
														<td><strong><?php echo esc_html( $tp['title'] ?? '' ); ?></strong></td>
														<td><span style="color:#0d9488; font-weight:800;"><?php echo self::to_fa_num( $tp['views'] ?? 0 ); ?></span></td>
														<td><span style="color:#059669; font-weight:800;"><?php echo self::to_fa_num( $tp['carts'] ?? 0 ); ?></span></td>
													</tr>
												<?php endforeach;
											endif; ?>
										</tbody>
									</table>
								</div>
							</div>
						</div>
					</div>

					<!-- ================= SUB-TAB 2: PRODUCTS & WOOCOMMERCE SYNC ================= -->
					<div id="subtab-products" class="shop-subtab-panel" style="display:none;">
						<div class="admin-card" style="border:1px solid #93c5fd;padding:16px;margin-bottom:18px;border-radius:12px;">
							<h3 style="margin:0 0 8px">فید مستقیم محصولات پروفایل برای ترب</h3>
							<p>این نشانی Product API v3 فقط با توکن امضاشدهٔ ترب پاسخ می‌دهد. نشانی را پس از نصب و آزمایش به پشتیبانی ترب بدهید؛ مسیر قدیمی ووکامرس به‌صورت خودکار جایگزین نمی‌شود.</p>
							<code dir="ltr" style="display:inline-block;word-break:break-all"><?php echo esc_html( rest_url( 'amphp/v1/torob/products' ) ); ?></code>
							<p class="description">نیازمند حالت «فقط پروفایل‌ها»، ویترین React، PHP sodium و zlib است. بارگذاری اولین فید ممکن است روی کاتالوگ بزرگ منابع زیادی مصرف کند؛ محصولات بدون قیمت معتبر ناموجود ارسال می‌شوند.</p>
						</div>
						<div class="admin-card">
							<div class="admin-card-header">
								<h3><span>🔄</span> وضعیت اسکرپر، پروفایل‌ها و درج در ووکامرس</h3>
								<span class="field-badge field-badge-green">مجموع: <?php echo self::to_fa_num( count( $scraped_products ) ); ?> کالا</span>
							</div>

							<div style="margin-bottom:20px;">
								<h4 style="margin:0 0 10px; font-size:1rem; font-weight:800; color:#1e293b;">پروفایل‌های فعال استخراج:</h4>
								<?php if ( empty( $profiles_summary ) ) : ?>
									<p style="color:#64748b;">هنوز پروفایلی در <code>profiles.json</code> ایجاد نشده است.</p>
								<?php else : ?>
									<table class="wp-list-table widefat fixed striped" style="border-radius:10px; overflow:hidden;">
										<thead>
											<tr>
												<th>نام پروفایل</th>
												<th>آدرس منبع</th>
												<th style="width:140px;">تعداد کالا</th>
												<th style="width:140px;">عملیات</th>
											</tr>
										</thead>
										<tbody>
											<?php foreach ( $profiles_summary as $prof ) : ?>
												<tr>
													<td><strong><?php echo esc_html( $prof['name'] ); ?></strong></td>
													<td dir="ltr" style="text-align:right;"><code><?php echo esc_html( $prof['url'] ); ?></code></td>
													<td><strong style="color:#059669;"><?php echo self::to_fa_num( $prof['count'] ); ?></strong> کالا</td>
													<td><a href="<?php echo esc_url( $scraper_embed_url ); ?>" class="button button-small">مدیریت در اسکرپر</a></td>
												</tr>
											<?php endforeach; ?>
										</tbody>
									</table>
								<?php endif; ?>
							</div>

							<!-- Direct Sync to WooCommerce Action -->
						<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px 20px; margin-bottom:24px;">
							<h4 style="margin:0 0 8px; font-size:1rem; font-weight:800; color:#0f172a;">درج مستقیم در دیتابیس محصولات ووکامرس</h4>
							<p style="color:#64748b; font-size:0.88rem; margin:0 0 14px;">
								تمامی محصولات استخراج‌شده را با قیمت‌های تعدیل‌شده به صورت کالای رسمی ووکامرس در دیتابیس وردپرس درج می‌کند.
							</p>
							<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
								<button type="button" id="btnSyncToWoo" class="button button-secondary" style="font-weight:800; border-color:#2563eb; color:#2563eb; padding:6px 20px;">
									همگام‌سازی و درج در دیتابیس ووکامرس
								</button>
								<span id="syncWooStatus" style="font-size:0.88rem; font-weight:700;"></span>
							</div>
							<!-- v13.2 / v10.103: صف کارت‌محصول همگام مستقیم -->
							<div id="amphpDirectSyncQueue" style="display:none; margin-top:16px; border:1px solid #cbd5e1; border-radius:14px; overflow:hidden; background:#0f172a;">
								<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 14px; background:#1e293b; border-bottom:1px solid #334155; flex-wrap:wrap;">
									<div style="color:#e2e8f0; font-weight:900; font-size:0.95rem;">📦 صف همگام‌سازی مستقیم — هر کارت یک محصول</div>
									<div id="amphpDirectSyncSum" style="color:#94a3b8; font-size:0.82rem; font-weight:700;"></div>
								</div>
								<div style="height:6px; background:#1e293b;"><div id="amphpDirectSyncBar" style="height:100%; width:0%; background:linear-gradient(90deg,#2563eb,#22d3ee); transition:width .35s;"></div></div>
								<div id="amphpDirectSyncCards" style="max-height:420px; overflow:auto; padding:10px 12px; display:flex; flex-direction:column; gap:8px;"></div>
							</div>
						</div>

						<!-- v10.99: پل اتصال مستقیم ووکامرس از پنل ادمین -->
						<div id="amphpWooBridgeCard" style="background:linear-gradient(135deg,#eff6ff 0%,#f0fdf4 100%); border:2px solid #3b82f6; border-radius:14px; padding:20px 22px; margin-bottom:24px;">
							<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:12px;">
								<div>
									<h4 style="margin:0 0 6px; font-size:1.05rem; font-weight:900; color:#1e3a8a;">🔌 اتصال مستقیم ووکامرس (از داخل وردپرس)</h4>
									<p style="margin:0; color:#334155; font-size:0.88rem; line-height:1.7; max-width:640px;">
										اسکرپر خارج از وردپرس نمی‌تواند «direct» را اجرا کند. از این بخش اتصال in-process را <strong>تست</strong> و در <code>connections.json</code> با <code>sync_mode=direct</code> <strong>فعال</strong> کنید.
									</p>
								</div>
								<span class="field-badge <?php echo $woo_direct_ready ? 'field-badge-green' : 'field-badge-blue'; ?>" id="amphpWooBridgeBadge">
									<?php echo $woo_direct_ready ? 'آماده · direct' : ( $woo_has_wc ? 'WC هست · نیاز به فعال‌سازی' : 'ووکامرس نیست' ); ?>
								</span>
							</div>
							<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:14px; font-size:0.84rem;">
								<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
									<div style="color:#64748b; font-weight:700;">WooCommerce</div>
									<div style="font-weight:900; color:<?php echo $woo_has_wc ? '#059669' : '#dc2626'; ?>;">
										<?php echo $woo_has_wc ? ( 'فعال' . ( defined( 'WC_VERSION' ) ? ' · ' . esc_html( WC_VERSION ) : '' ) ) : 'غیرفعال / نصب‌نشده'; ?>
									</div>
								</div>
								<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
									<div style="color:#64748b; font-weight:700;">sync_mode</div>
									<div style="font-weight:900; color:#0f172a;" id="amphpWooSyncModeLabel"><?php echo esc_html( $woo_sync_mode !== '' ? $woo_sync_mode : 'api' ); ?></div>
								</div>
								<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
									<div style="color:#64748b; font-weight:700;">enabled</div>
									<div style="font-weight:900; color:<?php echo $woo_enabled ? '#059669' : '#b45309'; ?>;" id="amphpWooEnabledLabel"><?php echo $woo_enabled ? 'بله' : 'خیر'; ?></div>
								</div>
								<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
									<div style="color:#64748b; font-weight:700;">store_url</div>
									<div style="font-weight:800; color:#0f172a; direction:ltr; text-align:right; word-break:break-all;" id="amphpWooStoreLabel"><?php echo esc_html( $woo_store !== '' ? $woo_store : '—' ); ?></div>
								</div>
							</div>
							<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
								<label style="font-size:0.85rem; font-weight:700; color:#334155;">fallback:
									<select id="amphpWooFallback" style="margin-right:6px; font-weight:700;">
										<option value="direct_then_api" selected>direct_then_api</option>
										<option value="api_then_direct">api_then_direct</option>
										<option value="none">none</option>
									</select>
								</label>
								<button type="button" id="btnTestWooDirect" class="button button-secondary" style="font-weight:800; border-color:#059669; color:#059669;">
									🧪 تست اتصال مستقیم
								</button>
								<button type="button" id="btnEnableWooDirect" class="button button-primary" style="font-weight:800; background:#2563eb; border:none;">
									⚡ فعال‌سازی اتصال مستقیم
								</button>
								<span id="amphpWooBridgeStatus" style="font-size:0.88rem; font-weight:700;"></span>
							</div>
							<pre id="amphpWooBridgeReport" style="display:none; margin:8px 0 0; max-height:280px; overflow:auto; background:#0f172a; color:#e2e8f0; border-radius:10px; padding:12px 14px; font-size:0.78rem; line-height:1.55; direction:ltr; text-align:left; white-space:pre-wrap; word-break:break-word;"></pre>
						</div>
						</div>
					</div>
				
<!-- v13.3.33 / v10.115: جدول مقایسه نظیر‌به‌نظیر در پنل افزونه -->
				<div class="admin-card" id="amphpSyncMatrixCard" style="margin-top:18px;background:linear-gradient(135deg,#0f172a,#1e1b4b);border:2px solid #7c3aed;border-radius:14px;padding:0;overflow:hidden;">
					<div class="admin-card-header" style="background:transparent;border-bottom:1px solid #4c1d95;padding:14px 18px;">
						<h3 style="color:#e9d5ff;margin:0;"><span>📊</span> جدول مقایسهٔ نظیر‌به‌نظیر</h3>
						<span class="field-badge field-badge-blue" id="amphpSmBadge">پروفایل × WC × غرفه‌ها</span>
					</div>
					<div style="padding:16px 18px;">
						<p style="margin:0 0 12px;color:#c4b5fd;font-size:0.86rem;line-height:1.75;">
							ساخت <b>کاملاً سرورساید</b> است — مناسب کاتالوگ بزرگ.
							وقتی اتصال مستقیم ووکامرس فعال باشد، محصولات WC از <b>دیتابیس محلی</b> خوانده می‌شوند (خیلی سریع‌تر از REST API). از باسلام فقط محصولات <b>فعال و قابل‌مشاهده برای مشتری</b> می‌آید. «🔧 اصلاح مغایرت‌ها»: قیمت + ارسال missing + حذف/بایگانی extra — سرورساید؛ دو ردیف گزارش به انتهای جدول.
							نتیجه در فایل سرور ذخیره می‌شود؛ این صفحه فقط صفحه‌بندی می‌خواند.
						</p>
						<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
							<button type="button" class="button button-primary" id="amphpSmStart" style="font-weight:800;background:#7c3aed;border:none;">🚀 ساخت روی سرور</button>
							<button type="button" class="button" id="amphpSmLoad" style="font-weight:800;border-color:#06b6d4;color:#0e7490;">📖 خواندن نتیجه</button>
							<button type="button" class="button" id="amphpSmFix" style="font-weight:800;background:#16a34a;border:none;color:#fff;">🔧 اصلاح مغایرت‌ها</button>
							<button type="button" class="button" id="amphpSmFixWoo" style="font-weight:700;font-size:12px;">فقط WC</button>
							<button type="button" class="button" id="amphpSmFixBsl" style="font-weight:700;font-size:12px;">فقط غرفه‌ها</button>
							<button type="button" class="button" id="amphpSmFixStop" style="font-weight:700;font-size:12px;color:#b91c1c;display:none;">⏹ توقف</button>
							<span id="amphpSmHint" style="font-size:0.82rem;font-weight:700;color:#a5b4fc;"></span>
						</div>
						<div id="amphpSmJobBar" style="display:none;margin-bottom:12px;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:10px;">
							<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#e2e8f0;margin-bottom:6px;">
								<span id="amphpSmJobLabel">در حال ساخت…</span><span id="amphpSmJobPct">0٪</span>
							</div>
							<div style="height:8px;background:#1e293b;border-radius:99px;overflow:hidden;">
								<div id="amphpSmJobFill" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#2563eb);transition:width .3s;"></div>
							</div>
							<div id="amphpSmJobLog" style="margin-top:8px;max-height:240px;overflow:auto;font-size:0.78rem;color:#e2e8f0;line-height:1.7;font-family:ui-monospace,Tahoma,sans-serif;"></div>
							<div id="amphpSmFixBanner" style="display:none;margin-top:8px;padding:8px 10px;background:#14532d33;border:1px solid #22c55e55;border-radius:8px;font-size:0.8rem;color:#bbf7d0;"></div>
				<div id="amphpSmFixReport" style="display:none;margin:8px 0;padding:12px 14px;background:linear-gradient(135deg,#0f172a,#14532d44);border:1px solid #34d39966;border-radius:10px;color:#e2e8f0"></div>
						</div>
						<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center;">
							<input type="search" id="amphpSmQ" placeholder="جستجوی عنوان…" style="flex:1;min-width:140px;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;">
							<select id="amphpSmPer" style="max-width:120px;font-size:13px;padding:6px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;">
								<option value="25">۲۵ / صفحه</option>
								<option value="50" selected>۵۰ / صفحه</option>
								<option value="100">۱۰۰ / صفحه</option>
								<option value="200">۲۰۰ / صفحه</option>
							</select>
							<label style="font-size:0.8rem;color:#cbd5e1;display:flex;gap:4px;align-items:center;cursor:pointer;"><input type="checkbox" id="amphpSmOnlyMis"> فقط مغایرت</label>
							<label style="font-size:0.8rem;color:#cbd5e1;display:flex;gap:4px;align-items:center;cursor:pointer;"><input type="checkbox" id="amphpSmOnlyMiss"> فقط ناقص</label>
							<label style="font-size:0.8rem;color:#cbd5e1;display:flex;gap:4px;align-items:center;cursor:pointer;"><input type="checkbox" id="amphpSmOnlyDup"> فقط تکراری</label>
							<button type="button" class="button" id="amphpSmFilter" style="font-weight:700;">اعمال فیلتر</button>
						</div>
						<div id="amphpSmSummary" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:0.8rem;"></div>
						<div id="amphpSmMeta" style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px;"></div>
						<div style="overflow:auto;max-height:min(70vh,560px);border:1px solid #334155;border-radius:10px;background:#0f172a;">
							<table id="amphpSmTable" style="width:100%;border-collapse:collapse;font-size:0.78rem;min-width:680px;color:#e2e8f0;">
								<thead style="position:sticky;top:0;background:#1e293b;z-index:2;">
									<tr id="amphpSmHead"></tr>
								</thead>
								<tbody id="amphpSmBody">
									<tr><td style="padding:18px;color:#64748b;text-align:center;">برای شروع «ساخت روی سرور» یا «خواندن نتیجه» را بزنید</td></tr>
								</tbody>
							</table>
						</div>
						<div id="amphpSmPager" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;margin-top:12px;"></div>
					</div>
				</div>

				
				</div>


				<!-- ================= TAB 7: CHAT LOGS & HISTORY ================= -->
				<div id="tab-logs" class="scraper-tab-panel">
					<div class="admin-card">
						<div class="admin-card-header">
							<h3><span>📋</span> گزارش و تاریخچه آخرین پیام‌های دریافتی از مشتریان</h3>
							<span class="field-badge field-badge-blue"><?php echo count( $chat_logs ); ?> پیام ثبت‌شده</span>
						</div>

						<?php if ( empty( $chat_logs ) ) : ?>
							<p style="color:#94a3b8; text-align:center; padding:30px 10px;">هنوز پیامی از طرف مشتریان در چت آنلاین ثبت نشده است.</p>
						<?php else : ?>
							<table class="wp-list-table widefat fixed striped" style="border-radius:10px; overflow:hidden;">
								<thead>
									<tr>
										<th style="width:120px; font-weight:800;">زمان</th>
										<th style="width:130px; font-weight:800;">نام مشتری</th>
										<th style="width:120px; font-weight:800;">تماس</th>
										<th style="width:140px; font-weight:800;">ایمیل / موضوع</th>
										<th style="font-weight:800;">متن پیام مشتری</th>
										<th style="font-weight:800;">پاسخ هوش مصنوعی</th>
										<th style="width:120px; font-weight:800;">وضعیت</th>
									</tr>
								</thead>
								<tbody>
									<?php foreach ( array_slice( $chat_logs, 0, 20 ) as $log ) : ?>
										<tr>
											<td style="font-size:0.8rem; color:#64748b;"><?php echo esc_html( $log['time'] ?? '—' ); ?></td>
											<td><strong><?php echo esc_html( $log['name'] ?? '—' ); ?></strong></td>
											<td dir="ltr" style="text-align:right;">
												<?php if ( ! empty( $log['phone'] ) ) : ?>
													<a href="tel:<?php echo esc_attr( $log['phone'] ); ?>" style="font-weight:700; color:#2563eb;"><?php echo esc_html( $log['phone'] ); ?></a>
												<?php else : ?>
													<span style="color:#94a3b8;">—</span>
												<?php endif; ?>
											</td>
											<td style="font-size:0.82rem;">
												<?php if ( ! empty( $log['email'] ) ) : ?>
													<div>📧 <?php echo esc_html( $log['email'] ); ?></div>
												<?php endif; ?>
												<?php if ( ! empty( $log['subject'] ) ) : ?>
													<div>📌 <?php echo esc_html( $log['subject'] ); ?></div>
												<?php endif; ?>
											</td>
											<td style="font-size:0.88rem; line-height:1.5;"><?php echo esc_html( $log['message'] ?? '—' ); ?></td>
											<td style="font-size:0.82rem; color:#7c3aed; line-height:1.4;">
												<?php echo ! empty( $log['ai_reply'] ) ? '🤖 ' . esc_html( mb_substr( $log['ai_reply'], 0, 90 ) ) . '...' : '<span style="color:#94a3b8;">بدون هوش مصنوعی</span>'; ?>
											</td>
											<td>
												<?php if ( ! empty( $log['sent_ok'] ) ) : ?>
													<span style="color:#16a34a; font-weight:800; font-size:0.8rem;">✅ ارسال شد</span>
												<?php else : ?>
													<span style="color:#d97706; font-weight:800; font-size:0.8rem;">⚠️ ثبت در سیستم</span>
												<?php endif; ?>
											</td>
										</tr>
									<?php endforeach; ?>
								</tbody>
							</table>
						<?php endif; ?>
					</div>
				</div>

				<!-- Compact Responsive Save Settings Bar -->
				<div class="scraper-save-bar" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:14px 20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:24px; box-shadow:0 4px 14px rgba(0,0,0,0.03); max-width:100%; box-sizing:border-box;">
					<div style="font-size:0.88rem; color:#475569; font-weight:700;">
						💡 کلیه تغییرات در هر یک از ۷ زبانه با زدن کلید زیر ذخیره می‌شوند.
					</div>
					<button type="submit" name="scraper_shop_save" class="button button-primary scraper-save-btn" style="background:#2563eb; border-color:#2563eb; font-weight:800; padding:8px 24px; font-size:0.95rem; border-radius:8px; cursor:pointer;">
						💾 ذخیره تغییرات
					</button>
				</div>
			</form>

			<script>
			(function(){
			  // v13.3.32: ذخیرهٔ خودکار تنظیمات + وضعیت
			  var form = document.getElementById('scraperAdminForm');
			  var pill = document.getElementById('amphpAutosavePill');
			  if (!form) return;
			  var timer = null, saving = false, lastPayload = '';
			  var nonce = <?php echo wp_json_encode( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>;
			  function setPill(state, text){
			    if (!pill) return;
			    pill.className = 'scraper-autosave-pill' + (state ? ' is-' + state : '');
			    pill.textContent = text || '';
			  }
			  function collect(){
			    var fd = new FormData(form);
			    fd.set('action', 'scraper_autosave_settings');
			    fd.set('nonce', nonce);
			    // ensure wc fallback hidden is authoritative
			    var h = document.getElementById('amphpWcFbHidden');
			    if (h) fd.set('set_wc_shop_to_fallback', h.value === '1' ? '1' : '0');
			    return fd;
			  }
			  function payloadKey(fd){
			    try {
			      var o = {};
			      fd.forEach(function(v,k){ if (k==='nonce'||k==='action') return; o[k]=String(v); });
			      return JSON.stringify(o);
			    } catch(e) { return String(Date.now()); }
			  }
			  function doSave(force){
			    if (saving) return;
			    var fd = collect();
			    var key = payloadKey(fd);
			    if (!force && key === lastPayload) {
			      setPill('', '✓ همگام');
			      return;
			    }
			    saving = true;
			    setPill('saving', '⏳ در حال ذخیره…');
			    fetch((window.ajaxurl || <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>), {
			      method: 'POST',
			      body: fd,
			      credentials: 'same-origin'
			    }).then(function(r){ return r.json(); }).then(function(d){
			      saving = false;
			      if (d && d.success) {
			        lastPayload = key;
			        var t = (d.data && d.data.saved_at) ? d.data.saved_at : '';
			        setPill('saved', '✓ ذخیره شد' + (t ? ' ' + t : ''));
			      } else {
			        var msg = (d && d.data && d.data.message) ? d.data.message : 'خطا در ذخیره';
			        setPill('error', '✗ ' + msg);
			      }
			    }).catch(function(){
			      saving = false;
			      setPill('error', '✗ خطای شبکه');
			    });
			  }
			  function schedule(){
			    setPill('', '… تغییر کرد — ذخیره تا چند ثانیه دیگر');
			    if (timer) clearTimeout(timer);
			    timer = setTimeout(function(){ doSave(false); }, 1200);
			  }
			  form.addEventListener('input', schedule, true);
			  form.addEventListener('change', schedule, true);
			  // buttons for wc fb already update hidden — listen click
			  document.addEventListener('click', function(e){
			    if (e.target && (e.target.id === 'amphpWcFbOnBtn' || e.target.id === 'amphpWcFbOffBtn')) {
			      schedule();
			    }
			  }, true);
			  // initial mark
			  setPill('', '✓ ذخیرهٔ خودکار فعال');
			  // expose
			  window.amphpAdminAutosave = function(){ doSave(true); };
			})();
			</script>

		</div>

		<script>
		jQuery(document).ready(function($){
			// Tab switching logic
			$('#mobileTabSelector').on('change', function(){
				var targetTab = $(this).val();
				$('#scraperAdminTabs .scraper-tab-link[data-tab="' + targetTab + '"]').click();
			});

			
			// Sub-tabs switcher in Tab 6 (فروشگاه)
			$('.shop-subtab-btn').on('click', function() {
				var target = $(this).attr('data-subtab');
				$('.shop-subtab-btn').css({'background':'#f8fafc','color':'#475569','border-color':'#cbd5e1','box-shadow':'none'});
				$(this).css({'background':'#2563eb','color':'#fff','border-color':'#2563eb','box-shadow':'0 4px 12px rgba(37,99,235,0.2)'});
				$('.shop-subtab-panel').hide();
				$('#' + target).fadeIn(200);
				$('#activeShopSubtabInput').val(target);
				try { sessionStorage.setItem('scraper_active_shop_subtab', target); } catch(e){}
			});

			// Restore active subtab on load
			try {
				var storedShopSubtab = sessionStorage.getItem('scraper_active_shop_subtab') || $('#activeShopSubtabInput').val();
				if (storedShopSubtab && $('.shop-subtab-btn[data-subtab="' + storedShopSubtab + '"]').length) {
					$('.shop-subtab-btn[data-subtab="' + storedShopSubtab + '"]').trigger('click');
				}
			} catch(e){}

			// Live Font Preview Updater in Tab 1
			function updateTitleFontPreview() {
				var title = $('#shopTitleInput').val() || 'عنوان فروشگاه';
				var font = $('#shopTitleFontSelect').val() || 'vazirmatn';
				var size = $('#shopTitleSizeSelect').val() || 'normal';
				var weight = $('#shopTitleWeightSelect').val() || '900';

				if (font === 'custom') {
					$('#customFontRow').show();
				} else {
					$('#customFontRow').hide();
				}

				var fontMap = {
					'vazirmatn': "'Vazirmatn', Tahoma, sans-serif",
					'iranyekan': "'IRANYekan', 'IRANYekanX', 'Vazirmatn', Tahoma, sans-serif",
					'dana': "'Dana', 'DanaVF', 'Vazirmatn', Tahoma, sans-serif",
					'yekanbakh': "'YekanBakh', 'Yekan Bakh', 'Vazirmatn', Tahoma, sans-serif",
					'shabnam': "'Shabnam', 'Vazirmatn', Tahoma, sans-serif",
					'sahel': "'Sahel', 'Vazirmatn', Tahoma, sans-serif",
					'iransans': "'IRANSans', 'IRANSansX', 'Vazirmatn', Tahoma, sans-serif",
					'morabba': "'Morabba', 'Dana', Tahoma, sans-serif",
					'parastoo': "'Parastoo', 'Sahel', Tahoma, sans-serif",
					'system': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, sans-serif",
					'custom': ($('#customFontInput').val() || 'Tahoma') + ", sans-serif"
				};

				var sizeMap = {
					'small': '1.18rem',
					'normal': '1.38rem',
					'large': '1.65rem',
					'xlarge': '1.95rem'
				};

				$('#previewTitleText').text(title)
					.css({
						'font-family': fontMap[font] || fontMap['vazirmatn'],
						'font-size': sizeMap[size] || '1.38rem',
						'font-weight': weight
					});
			}

			$('#shopTitleInput, #shopTitleFontSelect, #shopTitleSizeSelect, #shopTitleWeightSelect, #customFontInput').on('input change', updateTitleFontPreview);
			updateTitleFontPreview();

			// Reset Analytics AJAX
			$('#btnResetAnalytics').on('click', function() {
				if (!confirm('آیا از بازنشانی کامل آمار و نمودارهای فروشگاه اطمینان دارید؟')) return;
				var $btn = $(this);
				$btn.prop('disabled', true).text('در حال بازنشانی...');
				$.post(ajaxurl, {
					action: 'scraper_reset_analytics',
					nonce: '<?php echo esc_js( wp_create_nonce( "scraper_shop_admin_nonce" ) ); ?>'
				}, function(res) {
					if (res.success) {
						alert('✅ ' + (res.data.message || 'آمار با موفقیت بازنشانی شد. صفحه تازه‌سازی می‌شود.'));
						window.location.reload();
					} else {
						alert('❌ خطا در بازنشانی آمار: ' + (res.data || 'خطای ناشناخته'));
						$btn.prop('disabled', false).text('🗑️ بازنشانی آمار');
					}
				}).fail(function() {
					alert('❌ خطای ارتباط با سرور.');
					$btn.prop('disabled', false).text('🗑️ بازنشانی آمار');
				});
			});

$('#scraperAdminTabs .scraper-tab-link').on('click', function(e){
				e.preventDefault();
				var tabId = $(this).attr('data-tab');
				$('#scraperAdminTabs .scraper-tab-link').removeClass('active');
				$(this).addClass('active');
				$('.scraper-tab-panel').removeClass('active');
				$('#' + tabId).addClass('active');

				$('#mobileTabSelector').val(tabId);
				try {
					sessionStorage.setItem('scraper_active_tab', tabId);
				} catch(err){}
			});

			// Restore tab from session
			try {
				var savedTab = sessionStorage.getItem('scraper_active_tab');
				if (savedTab && $('#' + savedTab).length) {
					$('#scraperAdminTabs .scraper-tab-link[data-tab="' + savedTab + '"]').click();
				}
			} catch(err){}

			// ================= CARD DROPDOWN THEME SELECTOR =================
			var themesCatalog = {
				'royal-blue': {
					name: '۱. آبی رویال و کریستالی',
					title: 'آبی رویال و کریستالی',
					badge: 'پیش‌فرض رسمی',
					hdr_bg: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
					body_bg: '#f8fafc',
					user_bg: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#e2e8f0',
					ai_c: '#0f172a',
					adm_bg: '#ecfdf5',
					adm_b: '#a7f3d0',
					adm_c: '#065f46',
					dots: ['#1e3a8a', '#2563eb', '#60a5fa']
				},
				'cyberpunk-dark': {
					name: '۲. دارک نئونی و بنفش',
					title: 'دارک نئونی و بنفش سایبرپانک',
					badge: 'OLED Dark Mode',
					hdr_bg: 'linear-gradient(135deg, #090514, #2e1065)',
					body_bg: '#0f172a',
					user_bg: 'linear-gradient(135deg, #7c3aed, #a855f7)',
					user_c: '#ffffff',
					ai_bg: '#1e293b',
					ai_b: '#475569',
					ai_c: '#f1f5f9',
					adm_bg: '#064e3b',
					adm_b: '#10b981',
					adm_c: '#a7f3d0',
					dots: ['#090514', '#7c3aed', '#a855f7']
				},
				'emerald-whatsapp': {
					name: '۳. سبز زمردی و واتساپی',
					title: 'سبز زمردی و واتساپی',
					badge: 'پیام‌رسان محبوب',
					hdr_bg: 'linear-gradient(135deg, #064e3b, #059669)',
					body_bg: '#efeae2',
					user_bg: '#d9fdd3',
					user_c: '#111827',
					ai_bg: '#ffffff',
					ai_b: '#e5e7eb',
					ai_c: '#111827',
					adm_bg: '#e0f2fe',
					adm_b: '#bae6fd',
					adm_c: '#075985',
					dots: ['#064e3b', '#059669', '#25D366']
				},
				'magenta-rose': {
					name: '۴. صورتی نئونی و سرخابی',
					title: 'صورتی نئونی و سرخابی لوکس',
					badge: 'بیوتی و فشن',
					hdr_bg: 'linear-gradient(135deg, #831843, #db2777)',
					body_bg: '#fff1f2',
					user_bg: 'linear-gradient(135deg, #db2777, #f43f5e)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#fecdd3',
					ai_c: '#881337',
					adm_bg: '#f0fdf4',
					adm_b: '#bbf7d0',
					adm_c: '#166534',
					dots: ['#831843', '#db2777', '#fb7185']
				},
				'gold-vip': {
					name: '۵. مشکی طلایی VIP',
					title: 'مشکی طلایی VIP لاکچری',
					badge: 'طلا و اکسسوری VIP',
					hdr_bg: 'linear-gradient(135deg, #09090b, #1c1917)',
					body_bg: '#18181b',
					user_bg: 'linear-gradient(135deg, #b45309, #d97706)',
					user_c: '#ffffff',
					ai_bg: '#27272a',
					ai_b: '#78350f',
					ai_c: '#fef3c7',
					adm_bg: '#292524',
					adm_b: '#f59e0b',
					adm_c: '#fef9c3',
					dots: ['#09090b', '#d97706', '#fbbf24']
				},
				'minimal-slate': {
					name: '۶. مینیمال خنثی و تمیز',
					title: 'مینیمال خنثی و تمیز',
					badge: 'طراحی اسکاندیناوی',
					hdr_bg: 'linear-gradient(135deg, #1e293b, #334155)',
					body_bg: '#f8fafc',
					user_bg: '#334155',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#cbd5e1',
					ai_c: '#0f172a',
					adm_bg: '#f1f5f9',
					adm_b: '#94a3b8',
					adm_c: '#0f172a',
					dots: ['#1e293b', '#475569', '#94a3b8']
				},
				'aurora-gradient': {
					name: '۷. گرادینت شفق قطبی',
					title: 'گرادینت شفق قطبی',
					badge: 'ارغوانی و فیروزه‌ای',
					hdr_bg: 'linear-gradient(135deg, #4338ca, #06b6d4)',
					body_bg: '#f5f3ff',
					user_bg: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#c7d2fe',
					ai_c: '#312e81',
					adm_bg: '#ecfeff',
					adm_b: '#a5f3fc',
					adm_c: '#164e63',
					dots: ['#4338ca', '#6366f1', '#06b6d4']
				},
				'sunset-coral': {
					name: '۸. غروب آفتاب کالیفرنیا',
					title: 'غروب آفتاب کالیفرنیا',
					badge: 'مرجانی و صمیمی',
					hdr_bg: 'linear-gradient(135deg, #9a3412, #ea580c)',
					body_bg: '#fff7ed',
					user_bg: 'linear-gradient(135deg, #f97316, #ea580c)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#fed7aa',
					ai_c: '#7c2d12',
					adm_bg: '#fef2f2',
					adm_b: '#fecaca',
					adm_c: '#991b1b',
					dots: ['#9a3412', '#ea580c', '#fb923c']
				},
				'telegram-ocean': {
					name: '۹. چت تلگرامی اقیانوسی',
					title: 'چت تلگرامی اقیانوسی',
					badge: 'آبی تلگرامی',
					hdr_bg: 'linear-gradient(135deg, #0369a1, #0284c7)',
					body_bg: '#f0f9ff',
					user_bg: '#e0f2fe',
					user_c: '#0369a1',
					ai_bg: '#ffffff',
					ai_b: '#bae6fd',
					ai_c: '#0c4a6e',
					adm_bg: '#f0fdf4',
					adm_b: '#bbf7d0',
					adm_c: '#14532d',
					dots: ['#0369a1', '#0284c7', '#38bdf8']
				},
				'warm-caramel': {
					name: '۱۰. شکلاتی و کاراملی',
					title: 'شکلاتی و کاراملی کافه‌ای',
					badge: 'گرم و نوستالژیک',
					hdr_bg: 'linear-gradient(135deg, #451a03, #92400e)',
					body_bg: '#fffbeb',
					user_bg: 'linear-gradient(135deg, #b45309, #92400e)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#fde68a',
					ai_c: '#78350f',
					adm_bg: '#fef3c7',
					adm_b: '#f59e0b',
					adm_c: '#78350f',
					dots: ['#451a03', '#92400e', '#f59e0b']
				},
				'mint-pastel': {
					name: '۱۱. نعنایی و فیروزه‌ای',
					title: 'نعنایی و فیروزه‌ای پاستلی',
					badge: 'آرامش‌بخش و سلامت',
					hdr_bg: 'linear-gradient(135deg, #115e59, #0d9488)',
					body_bg: '#f0fdfa',
					user_bg: 'linear-gradient(135deg, #0d9488, #14b8a6)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#ccfbf1',
					ai_c: '#134e4a',
					adm_bg: '#ecfdf5',
					adm_b: '#a7f3d0',
					adm_c: '#065f46',
					dots: ['#115e59', '#0d9488', '#2dd4bf']
				},
				'frosted-glass': {
					name: '۱۲. شیشه‌ای گلس‌مورفیسم',
					title: 'شیشه‌ای نیمه‌شفاف گلس‌مورفیسم',
					badge: 'کریستالی شفاف ۲۰۲۶',
					hdr_bg: 'linear-gradient(135deg, #1e293b, #2563eb)',
					body_bg: '#f1f5f9',
					user_bg: 'linear-gradient(135deg, #2563eb, #3b82f6)',
					user_c: '#ffffff',
					ai_bg: '#ffffff',
					ai_b: '#cbd5e1',
					ai_c: '#0f172a',
					adm_bg: '#ecfdf5',
					adm_b: '#a7f3d0',
					adm_c: '#065f46',
					dots: ['#1e293b', '#2563eb', '#cbd5e1']
				}
			};

			function applyThemeSelection(themeSlug) {
				var info = themesCatalog[themeSlug] || themesCatalog['royal-blue'];

				// Update select
				$('#chat_theme_selector').val(themeSlug);

				// Update Trigger Button
				$('#themeActiveTitle').text(info.title || info.name);
				$('#themeActiveBadge').text(info.badge);

				var dotsHtml = '';
				info.dots.forEach(function(d){
					dotsHtml += '<span style="width:14px; height:14px; border-radius:50%; background:' + d + '; display:inline-block;"></span>';
				});
				$('#themeActiveDots').html(dotsHtml);

				// Update active class in menu
				$('.theme-menu-card-item').removeClass('active').css('background', 'transparent');
				$('.theme-menu-card-item[data-theme="' + themeSlug + '"]').addClass('active').css('background', '#eff6ff');

				// Update Live Mockup Preview Card
				$('#mockHdr').css('background', info.hdr_bg);
				$('#mockBody').css('background', info.body_bg);
				$('#mockUserBubble').css({
					background: info.user_bg,
					color: info.user_c
				});
				$('#mockAiBubble').css({
					background: info.ai_bg,
					borderColor: info.ai_b,
					color: info.ai_c
				});
				$('#mockAdminBubble').css({
					background: info.adm_bg,
					borderColor: info.adm_b,
					color: info.adm_c
				});
				$('#mockPaletteDots').html(dotsHtml);
			}

			// Toggle theme card dropdown
			$('#themeCardDropdownBtn').on('click', function(e){
				e.stopPropagation();
				var $menu = $('#themeCardDropdownMenu');
				var isOpen = $menu.is(':visible');
				$menu.toggle(!isOpen);
				$('#themeDropdownArrow').css('transform', isOpen ? 'rotate(0deg)' : 'rotate(180deg)');
			});

			// Select theme item from dropdown
			$(document).on('click', '.theme-menu-card-item', function(e){
				e.stopPropagation();
				var slug = $(this).attr('data-theme');
				applyThemeSelection(slug);
				$('#themeCardDropdownMenu').hide();
				$('#themeDropdownArrow').css('transform', 'rotate(0deg)');
			});

			// Close dropdown when clicking outside
			$(document).on('click', function(e){
				if (!$(e.target).closest('.card-dropdown-wrap').length) {
					$('#themeCardDropdownMenu').hide();
					$('#themeDropdownArrow').css('transform', 'rotate(0deg)');
				}
			});

			// Initialize theme preview on load
			var initialTheme = $('#chat_theme_selector').val() || 'royal-blue';
			applyThemeSelection(initialTheme);

			// ================= SUPPORT DESK INTERACTION =================
			var activeThreadData = null;

			function escapeHtml(text) {
				if (!text) return '';
				return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
			}

			function selectThreadItem($item) {
				$('.desk-thread-item').removeClass('active');
				$item.addClass('active');

				var threadId = $item.attr('data-id');
				var threadSession = $item.attr('data-session');
				var name = $item.attr('data-name') || 'مشتری';
				var phone = $item.attr('data-phone') || '';
				var email = $item.attr('data-email') || '';
				var subject = $item.attr('data-subject') || '';
				var status = $item.attr('data-status') || 'pending';

				activeThreadData = {
					id: threadId,
					session: threadSession,
					name: name,
					phone: phone,
					email: email,
					subject: subject,
					status: status,
					element: $item
				};

				// Mobile responsiveness: switch to full conversation view
				if ($(window).width() <= 782) {
					$('.desk-threads-col').addClass('mobile-hide');
					$('#btnDeskBackToList').show();
				}

				// Populate header card
				$('#deskEmptyState').hide();
				$('#deskActiveBox').css('display', 'flex');
				$('#deskHeaderName').text(name);
				$('#deskHeaderPhone').html(phone ? '📱 <strong>' + escapeHtml(phone) + '</strong>' : '');
				$('#deskHeaderEmail').html(email ? '📧 ' + escapeHtml(email) : '');
				$('#deskHeaderSubject').html(subject ? '📌 ' + escapeHtml(subject) : '');

				if (status === 'replied') {
					$('#deskHeaderStatus').css({background: '#ecfdf5', color: '#047857'}).text('✅ پاسخ داده شد');
				} else {
					$('#deskHeaderStatus').css({background: '#fef3c7', color: '#b45309'}).text('⏳ در انتظار پاسخ');
				}

				// Action buttons
				if (phone) {
					$('#deskDirectCallBtn').attr('href', 'tel:' + phone).show();
					var cleanPhone = phone.replace(/[^0-9]/g, '');
					if (cleanPhone.startsWith('0')) cleanPhone = '98' + cleanPhone.substring(1);
					$('#deskDirectWaBtn').attr('href', 'https://wa.me/' + cleanPhone).show();
				} else {
					$('#deskDirectCallBtn').hide();
					$('#deskDirectWaBtn').hide();
				}

				// Fetch full thread history via AJAX
				$('#deskMsgStream').html('<div style="text-align:center; padding:30px; color:#64748b;">در حال دریافت تاریخچه پیام‌ها... ⏳</div>');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_admin_get_thread',
						nonce: '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>',
						thread_id: threadId
					},
					success: function(res){
						if (res.success && res.data && res.data.thread) {
							renderDeskStream(res.data.thread.messages || []);
						} else {
							$('#deskMsgStream').html('<div style="color:#dc2626; text-align:center; padding:20px;">خطا در بارگذاری پیام‌ها.</div>');
						}
					},
					error: function(){
						$('#deskMsgStream').html('<div style="color:#dc2626; text-align:center; padding:20px;">خطای ارتباط با سرور.</div>');
					}
				});

				$('#deskReplyInput').focus();
			}

			function renderDeskStream(messages) {
				var $stream = $('#deskMsgStream');
				$stream.empty();

				if (!messages || messages.length === 0) {
					$stream.html('<div style="text-align:center; padding:30px; color:#94a3b8;">هنوز پیامی در این گفتگو وجود ندارد.</div>');
					return;
				}

				messages.forEach(function(msg){
					var $b = $('<div>').addClass('desk-bubble');
					var timeStr = msg.time || '';

					if (msg.sender === 'customer') {
						$b.addClass('customer');
						$b.html('<div style="font-size:0.75rem; font-weight:800; color:#2563eb; margin-bottom:3px;">👤 ' + escapeHtml(msg.sender_name || 'مشتری') + '</div><div>' + escapeHtml(msg.text) + '</div><div style="font-size:0.68rem; color:#94a3b8; margin-top:4px; text-align:left; direction:ltr;">' + escapeHtml(timeStr) + '</div>');
					} else if (msg.sender === 'ai') {
						$b.addClass('ai');
						$b.html('<div style="font-size:0.75rem; font-weight:800; color:#7c3aed; margin-bottom:3px;">🤖 ' + escapeHtml(msg.sender_name || 'پشتیبان هوشمند') + '</div><div>' + escapeHtml(msg.text).replace(/\n/g, '<br>') + '</div><div style="font-size:0.68rem; color:#94a3b8; margin-top:4px; text-align:left; direction:ltr;">' + escapeHtml(timeStr) + '</div>');
					} else if (msg.sender === 'admin') {
						$b.addClass('admin');
						$b.html('<div style="font-size:0.75rem; font-weight:800; color:#fef08a; margin-bottom:3px;">👨‍💼 ' + escapeHtml(msg.sender_name || 'مدیریت فروشگاه (پاسخ شما)') + '</div><div>' + escapeHtml(msg.text).replace(/\n/g, '<br>') + '</div><div style="font-size:0.68rem; opacity:0.8; margin-top:4px; text-align:left; direction:ltr;">' + escapeHtml(timeStr) + '</div>');
					}

					$stream.append($b);
				});

				$stream.scrollTop($stream[0].scrollHeight);
			}

			// Click thread item
			$(document).on('click', '.desk-thread-item', function(){
				selectThreadItem($(this));
			});

			// Mobile back button to list
			$('#btnDeskBackToList').on('click', function(){
				$('.desk-threads-col').removeClass('mobile-hide');
				$('#btnDeskBackToList').hide();
			});

			// Canned response quick insert
			$(document).on('click', '.desk-canned-chip', function(){
				var text = $(this).attr('data-text');
				var cur = $('#deskReplyInput').val();
				if (cur) {
					$('#deskReplyInput').val(cur + ' ' + text);
				} else {
					$('#deskReplyInput').val(text);
				}
				$('#deskReplyInput').focus();
			});

			// Send Admin Reply via AJAX
			$('#deskSendReplyBtn').on('click', function(){
				if (!activeThreadData || !activeThreadData.id) {
					alert('لطفاً ابتدا یک گفتگو را انتخاب نمایید.');
					return;
				}

				var replyText = $('#deskReplyInput').val().trim();
				if (!replyText) {
					alert('لطفاً متن پاسخ را بنویسید.');
					$('#deskReplyInput').focus();
					return;
				}

				var $btn = $(this);
				var $feedback = $('#deskReplyFeedback');
				$btn.prop('disabled', true).text('در حال ارسال... ⏳');
				$feedback.html('<span style="color:#2563eb;">ارسال پاسخ به چت مشتری...</span>');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_admin_send_chat_reply',
						nonce: '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>',
						thread_id: activeThreadData.id,
						reply_text: replyText
					},
					success: function(res){
						$btn.prop('disabled', false).text('ارسال پاسخ 🚀');
						if (res.success && res.data && res.data.thread) {
							$('#deskReplyInput').val('');
							$feedback.html('<span style="color:#059669;">✅ پاسخ ارسال شد و بلافاصله در چت مشتری نمایش داده شد.</span>');
							setTimeout(function(){ $feedback.empty(); }, 4000);

							// Update stream
							renderDeskStream(res.data.thread.messages || []);

							// Update thread item in list
							if (activeThreadData.element) {
								activeThreadData.element.attr('data-status', 'replied').removeClass('unread');
								activeThreadData.element.find('span:contains("نیاز به پاسخ")')
									.css({background:'#ecfdf5', color:'#047857'})
									.text('✅ پاسخ داده شد');
							}
							$('#deskHeaderStatus').css({background: '#ecfdf5', color: '#047857'}).text('✅ پاسخ داده شد');
						} else {
							$feedback.html('<span style="color:#dc2626;">❌ ' + (res.data || 'خطا در ارسال پاسخ.') + '</span>');
						}
					},
					error: function(){
						$btn.prop('disabled', false).text('ارسال پاسخ 🚀');
						$feedback.html('<span style="color:#dc2626;">❌ خطای ارتباط با سرور.</span>');
					}
				});
			});

			// Delete Thread Button
			$('#deskDeleteBtn').on('click', function(){
				if (!activeThreadData || !activeThreadData.id) return;
				if (!confirm('آیا از حذف کامل این گفتگو اطمینان دارید؟')) return;

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_admin_delete_thread',
						nonce: '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>',
						thread_id: activeThreadData.id
					},
					success: function(res){
						if (res.success) {
							if (activeThreadData.element) {
								activeThreadData.element.slideUp(function(){ $(this).remove(); });
							}
							$('#deskActiveBox').hide();
							$('#deskEmptyState').show();
							activeThreadData = null;
							if ($(window).width() <= 782) {
								$('.desk-threads-col').removeClass('mobile-hide');
								$('#btnDeskBackToList').hide();
							}
						} else {
							alert(res.data || 'خطا در حذف گفتگو.');
						}
					}
				});
			});

			// Search input filter
			$('#deskSearchInput').on('input', function(){
				var q = $(this).val().toLowerCase().trim();
				$('.desk-thread-item').each(function(){
					var name = ($(this).attr('data-name') || '').toLowerCase();
					var phone = ($(this).attr('data-phone') || '').toLowerCase();
					var text = $(this).text().toLowerCase();
					if (!q || name.indexOf(q) > -1 || phone.indexOf(q) > -1 || text.indexOf(q) > -1) {
						$(this).show();
					} else {
						$(this).hide();
					}
				});
			});

			// Filter buttons (all / pending / replied)
			$('.desk-filter-btn').on('click', function(){
				$('.desk-filter-btn').removeClass('active').css({background:'#ffffff', color:'#334155'});
				$(this).addClass('active').css({background:'#2563eb', color:'#ffffff'});
				var filter = $(this).attr('data-filter');

				$('.desk-thread-item').each(function(){
					var st = $(this).attr('data-status') || 'pending';
					if (filter === 'all') {
						$(this).show();
					} else if (filter === 'pending' && st === 'pending') {
						$(this).show();
					} else if (filter === 'replied' && st === 'replied') {
						$(this).show();
					} else {
						$(this).hide();
					}
				});
			});

						function updateDualStateUI() {
				var hasTakeover = $('#chkStoreTakeover').is(':checked');
				var catSrc = $('input[name="catalog_source"]:checked').val() || 'scraper';
				var $box = $('#boxDualStateIndicator');
				var $title = $('#dualStateTitle');
				var $desc = $('#dualStateDesc');
				$('#labelStoreTakeover').css('border-color', hasTakeover ? '#2563eb' : '#cbd5e1');
				$('#labelCatalogSource').css('border-color', catSrc === 'merge' ? '#7c3aed' : (catSrc === 'woocommerce' ? '#2563eb' : '#10b981'));
				$('#mergePreferBox').toggle(catSrc === 'merge');
				$('#chkScrapedProducts').prop('checked', catSrc !== 'woocommerce');
				var themeTxt = hasTakeover ? 'ویترین و هدر اختصاصی React' : 'قالب و هدر اصلی وردپرس';
				if (catSrc === 'merge') {
					$box.css({background: '#f5f3ff', borderColor: '#7c3aed'});
					$title.css('color', '#6d28d9').html('🔀 ' + themeTxt + ' + ادغام کاتالوگ');
					$desc.html('محصولات پروفایل‌های اسکرپر و کالاهای publish ووکامرس با هم در ویترین می‌آیند. تکراری‌ها طبق «اولویت ادغام» مدیریت می‌شوند.');
				} else if (catSrc === 'woocommerce') {
					$box.css({background: hasTakeover ? '#eff6ff' : '#f8fafc', borderColor: '#2563eb'});
					$title.css('color', '#1d4ed8').html('🛒 ' + themeTxt + ' + محصولات ووکامرس');
					$desc.html('کاتالوگ ویترین مستقیماً از دیتابیس ووکامرس خوانده می‌شود.');
				} else {
					$box.css({background: hasTakeover ? '#ecfdf5' : '#fffbeb', borderColor: '#10b981'});
					$title.css('color', '#047857').html('🌟 ' + themeTxt + ' + محصولات اسکرپر');
					$desc.html('محصولات profiles.json اسکرپر در ویترین نمایش می‌یابند. اگر خالی باشد، fallback به ووکامرس.');
				}
			}
			$('#chkStoreTakeover').on('change', updateDualStateUI);
			$('input[name="catalog_source"], input[name="catalog_merge_prefer"]').on('change', updateDualStateUI);
			updateDualStateUI();


			// Quick Preset Questions
			$('.btn-quick-preset').on('click', function(e){
				e.preventDefault();
				var q = $(this).attr('data-msg');
				$('#testAiChatMessage').val(q);
			});

			var adminNonce = '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>';

			// 1. Live AI Chat Test with Master Model
			$('#btnRunTestAiChat').on('click', function(e){
				e.preventDefault();
				var msg = $('#testAiChatMessage').val().trim();
				if (!msg) {
					alert('لطفاً یک پیام آزمایشی وارد کنید.');
					$('#testAiChatMessage').focus();
					return;
				}

				var $btn = $(this);
				var $box = $('#testAiChatResultBox');
				var $text = $('#testAiResponseText');
				var $badge = $('#testAiModelUsedBadge');
				var $time = $('#testAiTimeBadge');

				$btn.prop('disabled', true).text('در حال پاسخگویی مستر... ⏳');
				$('#testAiCandidatesCompareBox').hide();
				$box.show();
				$text.html('<span style="color:#2563eb;">در حال استعلام از مدل مستر اسکرپر با تحلیل کاتالوگ فروشگاه...</span>');
				$badge.text('مدل مستر');
				$time.text('');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					timeout: 120000,
					dataType: 'json',
					data: {
						action: 'scraper_test_ai_chat',
						nonce: adminNonce,
						message: msg
					},
					success: function(res){
						$btn.prop('disabled', false).text('🚀 پرسش از مدل مستر (Master AI)');
						if (res && res.success && res.data) {
							$text.text(res.data.reply || '(پاسخ خالی)');
							var meta = 'مدل مستر: ' + (res.data.model || 'هوشمند') + ' (' + (res.data.provider || 'اسکرپر') + ')';
							if (res.data.api_ready === false) meta += ' — ⚠️ کلید API خالی';
							$badge.text(meta);
							$time.text((res.data.took_ms || 0) + ' میلی‌ثانیه');
						} else {
							var err = (res && res.data) ? (typeof res.data === 'string' ? res.data : (res.data.message || JSON.stringify(res.data))) : 'عدم دریافت پاسخ.';
							$text.html('<span style="color:#dc2626;">خطا: ' + err + '</span>');
						}
					},
					error: function(xhr, status, err){
						$btn.prop('disabled', false).text('🚀 پرسش از مدل مستر (Master AI)');
						var body = (xhr && xhr.responseText) ? String(xhr.responseText).replace(/<[^>]+>/g,' ').slice(0, 280) : '';
						var hint = status === 'timeout' ? 'زمان انتظار تمام شد (timeout).' : ('HTTP ' + (xhr && xhr.status ? xhr.status : '?') + ' / ' + (err || status || ''));
						$text.html('<span style="color:#dc2626;">خطای ارتباط با سرور: ' + hint + (body ? ('<br><small style="color:#64748b;direction:ltr;display:block;margin-top:8px;text-align:left;">' + $('<div/>').text(body).html() + '</small>') : '') + '</span>');
					}
				});
			});

			// 2. Candidate Models Comparison & Voting
			var lastCompareCandidates = [];
			var lastCompareMsg = '';

			$('#btnCompareAiCandidates').on('click', function(e){
				e.preventDefault();
				var msg = $('#testAiChatMessage').val().trim();
				if (!msg) {
					alert('لطفاً یک پیام آزمایشی وارد کنید.');
					$('#testAiChatMessage').focus();
					return;
				}

				lastCompareMsg = msg;
				var $btn = $(this);
				var $compareBox = $('#testAiCandidatesCompareBox');
				var $grid = $('#compareCandidatesCardsGrid');

				$btn.prop('disabled', true).text('در حال پرسش از همه کاندیدها... ⏳');
				$('#testAiChatResultBox').hide();
				$compareBox.show();
				$grid.html('<div style="grid-column:1/-1; text-align:center; padding:30px; color:#64748b; font-size:0.95rem;">⏳ در حال فراخوانی موازی مدل‌های کاندید و ارزیابی پاسخ‌ها با هوش مصنوعی اسکرپر...</div>');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_compare_ai_candidates',
						nonce: adminNonce,
						message: msg
					},
					success: function(res){
						$btn.prop('disabled', false).text('⚖️ آزمون مقایسه‌ای همه کاندیدها');
						if (res.success && res.data && res.data.candidates && res.data.candidates.length) {
							lastCompareCandidates = res.data.candidates;
							var masterKey = res.data.master || '';
							var html = '';

							res.data.candidates.forEach(function(cand, idx){
								var isM = (cand.key === masterKey || cand.is_master);
								var scorePct = Math.round((cand.score || 0) * 100);

								html += '<div class="candidate-test-card" style="background:#ffffff; border:1.5px solid ' + (isM ? '#fbbf24' : '#e2e8f0') + '; border-radius:12px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:' + (isM ? '0 4px 14px rgba(251,191,36,0.18)' : '0 2px 6px rgba(0,0,0,0.03)') + ';">';
								
								// Card Header
								html += '<div style="border-bottom:1px solid #f1f5f9; padding-bottom:10px; margin-bottom:10px;">';
								html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">';
								html += '<strong style="color:' + (isM ? '#b45309' : '#1e293b') + '; font-size:0.95rem;">' + $('<div>').text(cand.providerName).html() + '</strong>';
								if (isM) {
									html += '<span style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:8px;">⭐ مدل مستر</span>';
								}
								html += '</div>';
								html += '<div style="color:#64748b; font-size:0.8rem; margin-top:2px;" dir="ltr">' + $('<div>').text(cand.model).html() + ' · <span style="color:#2563eb; font-weight:700;">' + cand.latency + 'ms</span></div>';
								html += '<div style="font-size:0.78rem; color:#059669; font-weight:700; margin-top:3px;">امتیاز موفقیت: ' + scorePct + '٪ (' + cand.wins + ' برد از ' + cand.votes + ' آزمون)</div>';
								html += '</div>';

								// Card Body (Reply)
								html += '<div style="font-size:0.92rem; color:#334155; line-height:1.7; flex:1; margin-bottom:12px; white-space:pre-wrap;">' + $('<div>').text(cand.text).html() + '</div>';

								// Card Footer / Actions
								html += '<div style="display:flex; gap:6px; flex-wrap:wrap; padding-top:10px; border-top:1px solid #f8fafc;">';
								html += '<button type="button" class="button button-small btn-vote-candidate" data-winner="' + $('<div>').text(cand.key).html() + '" style="background:#10b981; color:#fff; border-color:#059669; font-weight:800; border-radius:6px; flex:1;">✓ این پاسخ بهتر بود (ثبت رأی)</button>';
								if (!isM) {
									html += '<button type="button" class="button button-small btn-pin-candidate" data-key="' + $('<div>').text(cand.key).html() + '" style="border-radius:6px;">📌 سنجاق مستر</button>';
								}
								html += '</div>';

								html += '</div>';
							});

							$grid.html(html);
						} else {
							$grid.html('<div style="grid-column:1/-1; color:#dc2626; padding:20px; text-align:center;">خطا: ' + (res.data || 'هیچ پاسخی از کاندیدها دریافت نشد.') + '</div>');
						}
					},
					error: function(){
						$btn.prop('disabled', false).text('⚖️ آزمون مقایسه‌ای همه کاندیدها');
						$grid.html('<div style="grid-column:1/-1; color:#dc2626; padding:20px; text-align:center;">خطای ارتباط با سرور.</div>');
					}
				});
			});

			// 3. Voting for a Candidate
			$(document).on('click', '.btn-vote-candidate', function(e){
				e.preventDefault();
				var $btn = $(this);
				var winnerKey = $btn.attr('data-winner');
				var allKeys = lastCompareCandidates.map(function(c){ return c.key; });

				$btn.prop('disabled', true).text('در حال ثبت رأی... ⏳');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_vote_ai_candidate',
						nonce: adminNonce,
						winner: winnerKey,
						task: 'autoreply',
						input: lastCompareMsg,
						candidates: allKeys
					},
					success: function(res){
						if (res.success) {
							alert('✅ ' + (res.data.message || 'رای شما با موفقیت ثبت شد!'));
							location.reload();
						} else {
							alert('خطا در ثبت رای: ' + (res.data || 'ناموفق'));
							$btn.prop('disabled', false).text('✓ این پاسخ بهتر بود (ثبت رأی)');
						}
					},
					error: function(){
						alert('خطای ارتباط با سرور.');
						$btn.prop('disabled', false).text('✓ این پاسخ بهتر بود (ثبت رأی)');
					}
				});
			});

			// 4. Pinning a Candidate as Master
			$(document).on('click', '.btn-pin-candidate', function(e){
				e.preventDefault();
				var $btn = $(this);
				var key = $btn.attr('data-key');
				if (!confirm('آیا مایلید این مدل را به عنوان مدل مستر اصلی اسکرپر سنجاق (Pin) کنید؟')) {
					return;
				}

				$btn.prop('disabled', true).text('در حال سنجاق... ⏳');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_pin_master_model',
						nonce: adminNonce,
						key: key
					},
					success: function(res){
						if (res.success) {
							alert('✅ ' + (res.data.message || 'مدل به عنوان مستر سنجاق شد.'));
							location.reload();
						} else {
							alert('خطا: ' + (res.data || 'ناموفق'));
							$btn.prop('disabled', false).text('📌 سنجاق مستر');
						}
					},
					error: function(){
						alert('خطای ارتباط با سرور.');
						$btn.prop('disabled', false).text('📌 سنجاق مستر');
					}
				});
			});

			// 5. Config File Upload & Import
			var selectedConfigFile = null;

			$('#btnSelectAiConfigFile').on('click', function(e){
				e.preventDefault();
				$('#aiConfigFileInput').click();
			});

			$('#aiConfigFileInput').on('change', function(e){
				var files = e.target.files;
				if (files && files.length) {
					selectedConfigFile = files[0];
					$('#aiConfigSelectedFileName').show().text('فایل انتخاب شده: ' + selectedConfigFile.name + ' (' + (Math.round(selectedConfigFile.size/1024*10)/10) + ' کیلوبایت)');
					$('#btnUploadAiConfigFile').prop('disabled', false);
				}
			});

			// Drag and drop for config file
			var dropZone = document.getElementById('aiConfigDropZone');
			if (dropZone) {
				['dragenter', 'dragover'].forEach(function(eventName){
					dropZone.addEventListener(eventName, function(e){ e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = '#2563eb'; dropZone.style.background = '#eff6ff'; }, false);
				});
				['dragleave', 'drop'].forEach(function(eventName){
					dropZone.addEventListener(eventName, function(e){ e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = '#cbd5e1'; dropZone.style.background = '#ffffff'; }, false);
				});
				dropZone.addEventListener('drop', function(e){
					var dt = e.dataTransfer;
					var files = dt.files;
					if (files && files.length) {
						selectedConfigFile = files[0];
						$('#aiConfigSelectedFileName').show().text('فایل انتخاب شده: ' + selectedConfigFile.name + ' (' + (Math.round(selectedConfigFile.size/1024*10)/10) + ' کیلوبایت)');
						$('#btnUploadAiConfigFile').prop('disabled', false);
					}
				}, false);
			}

			$('#btnUploadAiConfigFile').on('click', function(e){
				e.preventDefault();
				if (!selectedConfigFile) {
					alert('لطفاً ابتدا یک فایل JSON انتخاب کنید.');
					return;
				}

				var $btn = $(this);
				var $status = $('#aiConfigUploadStatus');

				$btn.prop('disabled', true).text('در حال بارگذاری و تحلیل... ⏳');
				$status.show().css({'background': '#eff6ff', 'color': '#1d4ed8', 'border': '1px solid #bfdbfe'}).html('در حال انتقال فایل تنظیمات و ذخیره در سیستم هوش مصنوعی اسکرپر... ⏳');

				var formData = new FormData();
				formData.append('action', 'scraper_upload_ai_config');
				formData.append('nonce', adminNonce);
				formData.append('config_file', selectedConfigFile);

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: formData,
					processData: false,
					contentType: false,
					success: function(res){
						$btn.prop('disabled', false).text('📥 بارگذاری و اعمال فوری در اسکرپر');
						if (res.success && res.data) {
							$status.css({'background': '#f0fdf4', 'color': '#15803d', 'border': '1px solid #bbf7d0'}).html('✅ ' + (res.data.message || 'فایل کانفیگ با موفقیت در اسکرپر بارگذاری و مدل مستر فعال گردید!'));
							setTimeout(function(){ location.reload(); }, 1200);
						} else {
							$status.css({'background': '#fef2f2', 'color': '#b91c1c', 'border': '1px solid #fecaca'}).html('❌ خطا: ' + (res.data || 'بارگذاری ناموفق بود.'));
						}
					},
					error: function(){
						$btn.prop('disabled', false).text('📥 بارگذاری و اعمال فوری در اسکرپر');
						$status.css({'background': '#fef2f2', 'color': '#b91c1c', 'border': '1px solid #fecaca'}).html('❌ خطای ارتباط با سرور هنگام بارگذاری فایل.');
					}
				});
			});

			// 6. Config File Export
			$('#btnExportAiConfigFile').on('click', function(e){
				e.preventDefault();
				window.location.href = ajaxurl + '?action=scraper_export_ai_config&nonce=' + adminNonce;
			});

			// Refresh desk button
			$('#btnRefreshAdminDesk').on('click', function(){
				location.reload();
			});

			// Run WP-Cron Immediately Button (Both Quick Banner and Card Buttons)
			$(document).on('click', '#btnRunWpCronNow, .btnRunWpCronNow', function(e){
				e.preventDefault();
				var $allBtns = $('#btnRunWpCronNow, .btnRunWpCronNow');
				var $status = $('#wpCronRunNowStatus');

				$allBtns.prop('disabled', true).text('در حال اجرای کران‌جاب اسکرپر... ⏳');
				$status.show().css({'background': '#eff6ff', 'color': '#1d4ed8', 'border': '1px solid #bfdbfe'}).html('در حال فراخوانی کران‌جاب وردپرس و اجرای عملیات استخراج اسکرپر۴... ⏳');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'scraper_run_wpcron_now',
						nonce: adminNonce
					},
					success: function(res){
						$allBtns.prop('disabled', false).html('<span>⚡</span> اجرای دستی کران‌جاب همین حالا (Run Now)');
						if (res.success && res.data) {
							$status.css({'background': '#f0fdf4', 'color': '#15803d', 'border': '1px solid #bbf7d0'}).html('✅ ' + (res.data.message || 'کران‌جاب با موفقیت اجرا گردید.') + ' (زمان: ' + res.data.took_sec + ' ثانیه)');
							$('#wpCronLastRunText, #wpCronQuickLastRun').text(res.data.last_run);
							$('#wpCronNextRunText, #wpCronQuickNextRun').text('در ' + res.data.next_human + ' دیگر');
						} else {
							$status.css({'background': '#fef2f2', 'color': '#b91c1c', 'border': '1px solid #fecaca'}).html('❌ خطا در اجرا: ' + (res.data || 'عملیات با خطا مواجه شد.'));
						}
					},
					error: function(){
						$allBtns.prop('disabled', false).html('<span>⚡</span> اجرای دستی کران‌جاب همین حالا (Run Now)');
						$status.css({'background': '#fef2f2', 'color': '#b91c1c', 'border': '1px solid #fecaca'}).html('❌ خطای ارتباط با سرور هنگام اجرای کران‌جاب.');
					}
				});
			});

			// Test Messengers Button
			$('#btnTestMessengers').on('click', function(e){
				e.preventDefault();
				var $btn = $(this);
				var $status = $('#testMessengersStatus');
				$btn.prop('disabled', true).text('در حال ارسال تست... ⏳');
				$status.html('<span style="color:#2563eb;">ارسال پیام آزمایشی به پیام‌رسان‌ها...</span>');

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					data: {
						action: 'test_support_messengers',
						nonce: '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>'
					},
					success: function(res){
						$btn.prop('disabled', false).text('🔔 ارسال پیام آزمایشی');
						if (res.success) {
							$status.html('<span style="color:#16a34a; font-weight:700;">✅ ' + (res.data.message || 'با موفقیت ارسال شد!') + '</span>');
						} else {
							var err = (res.data && res.data.message) ? res.data.message : 'خطا در ارسال.';
							$status.html('<span style="color:#dc2626; font-weight:700;">❌ ' + err + '</span>');
						}
					},
					error: function(){
						$btn.prop('disabled', false).text('🔔 ارسال پیام آزمایشی');
						$status.html('<span style="color:#dc2626; font-weight:700;">❌ خطای ارتباط با سرور.</span>');
					}
				});
			});

			// Sync to WooCommerce Button — product-card live queue (v13.2 / v10.103)
			var amphpDirectSyncTimer = null;
			var amphpShopNonce = '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>';

			/* v13.3.33 / v10.115: جدول مقایسه در پنل افزونه */
			if (typeof amphpEsc !== 'function') {
				window.amphpEsc = function(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); };
			}
			window._amphpSmPage = 1;
			window._amphpSmPoll = null;
			function amphpSmFa(n){
				try {
					return String(n).replace(/\d/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'[d]; });
				} catch(e){ return String(n); }
			}
			function amphpSmMoney(n){
				n = parseInt(n,10)||0; if(n<=0) return '—';
				try { return amphpSmFa(n.toLocaleString('en-US')); } catch(e){ return String(n); }
			}
			function amphpSmToneBg(t){
				return ({ok:'#14532d',warn:'#713f12',bad:'#7f1d1d',missing_dst:'#1e3a8a',extra:'#334155',no_src:'#3f3f46',na:'#0f172a'})[t]||'#0f172a';
			}
			function amphpSmToneFg(t){
				return ({ok:'#bbf7d0',warn:'#fde68a',bad:'#fecaca',missing_dst:'#bfdbfe',extra:'#e2e8f0',no_src:'#d4d4d8',na:'#64748b'})[t]||'#94a3b8';
			}
			function amphpSmCell(html, tone){
				var bg=amphpSmToneBg(tone), fg=amphpSmToneFg(tone);
				return '<td style="padding:7px 8px;border-bottom:1px solid #1e293b;background:'+bg+';color:'+fg+';vertical-align:top;line-height:1.55">'+html+'</td>';
			}
			function amphpSmShowJob(on){
				var bar=document.getElementById('amphpSmJobBar');
				if(bar) bar.style.display = on ? 'block' : 'none';
			}
			function amphpSmPaintProgress(p){
				p = p || {};
				amphpSmShowJob(true);
				var pct = Math.max(0, Math.min(100, parseInt(p.pct,10)||0));
				var elP = document.getElementById('amphpSmJobPct');
				var elF = document.getElementById('amphpSmJobFill');
				var elL = document.getElementById('amphpSmJobLabel');
				var elG = document.getElementById('amphpSmJobLog');
				if(elP) elP.textContent = amphpSmFa(pct)+'٪';
				if(elF) elF.style.width = pct+'%';
				if(elL){
					var ph = p.phase || '';
					elL.textContent = p.running ? ('⏳ '+(ph||'در حال ساخت')+'…') : (p.done ? (p.error?'❌ خطا':'✅ تمام') : '—');
				}
				if(elG && Array.isArray(p.log)){
					var lines = p.log.slice(-80).map(function(x){ return (x && x.m) ? x.m : String(x); });
					elG.innerHTML = lines.map(function(l){ return '<div style="border-bottom:1px solid #1e293b;padding:2px 0">'+amphpEsc(l)+'</div>'; }).join('');
					try{ elG.scrollTop = elG.scrollHeight; }catch(e){}
				}
				var stopBtn = document.getElementById('amphpSmFixStop');
				if(stopBtn){
					var fixing = !!(p.running && (p.job==='fix' || p.ok_n!=null || String(p.phase||'').match(/fix|send|del|queued|start/)));
					stopBtn.style.display = fixing ? '' : 'none';
				}
				var ban = document.getElementById('amphpSmFixBanner');
				if(ban && (p.ok_n!=null || p.job==='fix' || String(p.phase||'').match(/fix|send|del|queued|start/))){
					ban.style.display = 'block';
					ban.innerHTML = (p.running?'⏳ در حال مغایرت‌گیری… ':'')
						+'✅ '+amphpSmFa(p.ok_n||0)+' · ❌ '+amphpSmFa(p.fail_n||0)
						+' · '+amphpSmFa(p.cur||0)+'/'+amphpSmFa(p.total||0)
						+' · 💰'+amphpSmFa(p.price_n||0)+' · 📤'+amphpSmFa(p.sent_n||0)+' · 🗑'+amphpSmFa(p.del_n||0);
				}
			}
			function amphpSmAjax(action, extra, cb){
				var data = $.extend({
					action: action,
					nonce: (typeof amphpShopNonce !== 'undefined' ? amphpShopNonce : ''),
					_ajax_nonce: (typeof amphpShopNonce !== 'undefined' ? amphpShopNonce : '')
				}, extra || {});
				if(typeof amphpWooNonce !== 'undefined' && amphpWooNonce){
					data.nonce = amphpWooNonce;
					data._ajax_nonce = amphpWooNonce;
				}
				$.ajax({
					url: (typeof ajaxurl !== 'undefined' ? ajaxurl : '<?php echo esc_js( admin_url( "admin-ajax.php" ) ); ?>'),
					type: 'POST', dataType: 'json', data: data,
					success: function(res){
						var d = (res && res.success && res.data) ? res.data : (res && res.data) ? res.data : res;
						if(cb) cb(d, res);
					},
					error: function(xhr){
						var msg = 'خطای شبکه';
						try {
							var b = xhr && xhr.responseText ? String(xhr.responseText) : '';
							if(b === '-1' || (xhr && xhr.status === 403)) msg = 'نشست امنیتی — Ctrl+F5';
						} catch(e){}
						if(cb) cb({ ok:false, error: msg }, null);
					}
				});
			}
			function amphpSmStart(){
				amphpSmShowJob(true);
				var elL = document.getElementById('amphpSmJobLabel');
				var body = document.getElementById('amphpSmBody');
				if(elL) elL.textContent = '🚀 ارسال جاب…';
				if(body) body.innerHTML = '<tr><td style="padding:16px;text-align:center;color:#a5b4fc">ساخت روی سرور شروع شد — می‌توانید این صفحه را باز بگذارید</td></tr>';
				var hint = document.getElementById('amphpSmHint');
				if(hint) hint.textContent = 'شروع…';
				amphpSmAjax('scraper_sync_matrix_start', { source: 'wp_admin' }, function(d){
					if(!d || (!d.ok && !d.started && !d.running)){
						if(hint) hint.innerHTML = '<span style="color:#f87171">'+(d && (d.error||d.message) || 'شروع ناموفق')+'</span>';
						if(d && d.running) amphpSmPoll();
						return;
					}
					if(hint) hint.innerHTML = '<span style="color:#4ade80">✓ جاب روی سرور</span>';
					amphpSmPoll();
				});
			}
			function amphpSmPoll(){
				if(window._amphpSmPoll) clearInterval(window._amphpSmPoll);
				var tick = function(){
					amphpSmAjax('scraper_sync_matrix_status', {}, function(d){
						if(!d) return;
						var p = d.progress || {};
						if(d.fix_running && d.fix_progress) amphpSmPaintProgress(d.fix_progress);
						else if(p) amphpSmPaintProgress(p);
						var badge = document.getElementById('amphpSmBadge');
						if(badge && typeof d.woo_direct !== 'undefined'){
							badge.textContent = d.woo_direct ? '⚡ WC مستقیم' : '🌐 WC از API';
						}
						if(d.running || d.fix_running || d.build_running){
							if(d.fix_running){
								window._amphpSmFixTick = (window._amphpSmFixTick||0)+1;
								if(window._amphpSmFixTick % 3 === 0){
									try{ amphpSmLoad(window._amphpSmPage||1, true); }catch(e){}
								}
							}
						} else {
							if(window._amphpSmPoll){ clearInterval(window._amphpSmPoll); window._amphpSmPoll=null; }
							if(d.has_result){ setTimeout(function(){ amphpSmLoad(window._amphpSmLastPages||1); }, 500); }
						}
					});
				};
				tick();
				window._amphpSmPoll = setInterval(tick, 1500);
			}
			function amphpSmFixStart(scope){
				scope = scope || 'all';
				if(!confirm('مغایرت‌گیری کامل از جدول؟\n• قیمت + ارسال missing + حذف extra\nمحدوده: '+(scope==='woo'?'فقط ووکامرس':(scope==='bsl'?'فقط غرفه‌ها':'همه'))+'\nدو ردیف گزارش به جدول اضافه می‌شود.')) return;
				amphpSmShowJob(true);
				var elL=document.getElementById('amphpSmJobLabel');
				if(elL) elL.textContent='🔧 شروع اصلاح…';
				var stop=document.getElementById('amphpSmFixStop'); if(stop) stop.style.display='';
				var log=document.getElementById('amphpSmJobLog'); if(log) log.innerHTML='';
				amphpSmAjax('scraper_sync_matrix_fix_start', { scope: scope, source: 'wp_admin' }, function(d){
					if(!d || (!d.ok && !d.started && !d.running)){
						alert((d && (d.error||d.message)) || 'شروع ناموفق');
						if(d && d.running) amphpSmPoll();
						return;
					}
					window._amphpSmFixTick=0;
					amphpSmPoll();
				});
			}
			function amphpSmFixStop(){
				amphpSmAjax('scraper_sync_matrix_fix_stop', {}, function(d){
					var hint=document.getElementById('amphpSmHint');
					if(hint) hint.textContent = (d && d.ok) ? 'درخواست توقف…' : 'توقف ناموفق';
				});
			}
			function amphpSmPaintReports(d){
				var box = document.getElementById('amphpSmFixReport');
				if(!box) return;
				var reps = (d && d.reports) ? d.reports : [];
				var st = (d && d.fix_stats) ? d.fix_stats : null;
				if((!reps || !reps.length) && !st){ box.style.display='none'; box.innerHTML=''; return; }
				var html = '<div style="font-weight:900;color:#fde68a;font-size:13px;margin-bottom:8px">📋 گزارش آخرین مغایرت‌گیری'
					+(d.fix_at?(' <span style="font-weight:600;color:#94a3b8;font-size:10px">· '+new Date(d.fix_at*1000).toLocaleString('fa-IR')+'</span>'):'')
					+'</div>';
				if(st){
					html += '<div style="font-size:12px;color:#bbf7d0;margin-bottom:8px;font-weight:700">'
						+(st.stopped?'⏹ متوقف — ':'✅ ')
						+'موفق '+amphpSmFa(st.ok||0)+' · ناموفق '+amphpSmFa(st.fail||0)+' از '+amphpSmFa(st.total||0)
						+' · 💰'+amphpSmFa(st.priced||0)+' · 📤'+amphpSmFa(st.sent||0)+' · 🗑'+amphpSmFa(st.deleted||0)
						+'</div>';
				}
				(reps||[]).forEach(function(r){
					if(!r) return;
					var bg = r.report_type==='work' ? 'rgba(30,58,95,.55)' : 'rgba(20,83,45,.55)';
					html += '<div style="background:'+bg+';border:1px solid #334155;border-radius:8px;padding:8px 10px;margin-bottom:6px">';
					html += '<div style="font-weight:800;color:#fde68a;margin-bottom:4px">'+amphpEsc(r.title||'گزارش')+'</div>';
					if(r.report_text) html += '<div style="font-size:11px;color:#bbf7d0;margin-bottom:4px">'+amphpEsc(r.report_text)+'</div>';
					(r.report_lines||[]).forEach(function(x){
						html += '<div style="font-size:10.5px;border-bottom:1px solid #33415544;padding:2px 0">'+amphpEsc(String(x))+'</div>';
					});
					html += '</div>';
				});
				if(st && st.total===0){
					html += '<div style="font-size:11px;color:#fbbf24">⚠️ کاری پیدا نشد — جدول را از نو بسازید و دوباره اصلاح کنید.</div>';
				}
				box.innerHTML = html;
				box.style.display = 'block';
			}
			function amphpSmLoad(page, silent){
				page = page || 1; window._amphpSmPage = page;
				silent = !!silent;
				var body = document.getElementById('amphpSmBody');
				var sum = document.getElementById('amphpSmSummary');
				var meta = document.getElementById('amphpSmMeta');
				var pager = document.getElementById('amphpSmPager');
				var head = document.getElementById('amphpSmHead');
				if(body && !silent) body.innerHTML = '<tr><td style="padding:16px;text-align:center;color:#67e8f9">📖 خواندن از فایل سرور…</td></tr>';
				var extra = {
					page: String(page),
					per_page: String((document.getElementById('amphpSmPer')||{}).value || 50),
					q: (document.getElementById('amphpSmQ')||{}).value || ''
				};
				if((document.getElementById('amphpSmOnlyMis')||{}).checked) extra.only_mismatch = '1';
				if((document.getElementById('amphpSmOnlyMiss')||{}).checked) extra.only_missing = '1';
				if((document.getElementById('amphpSmOnlyDup')||{}).checked) extra.only_dup = '1';
				amphpSmAjax('scraper_sync_matrix', extra, function(d){
					if(d && d.progress) amphpSmPaintProgress(d.progress);
					if(d && d.running) amphpSmPoll();
					if(!d || d.ok === false){
						if(d && d.need_build){
							if(body) body.innerHTML = '<tr><td style="padding:16px;text-align:center;color:#fbbf24">هنوز جدولی نیست. «🚀 ساخت روی سرور» را بزنید'+(d.running?' (در حال ساخت…)':'')+'</td></tr>';
							if(d.running) amphpSmPoll();
							return;
						}
						/* wp_send_json_success wraps — if message */
						var err = (d && (d.error || d.message)) ? (d.error || d.message) : 'ناموفق';
						if(body) body.innerHTML = '<tr><td style="padding:12px;color:#f87171">'+amphpEsc(err)+'</td></tr>';
						return;
					}
					if(d.done || (d.progress && d.progress.done)) amphpSmShowJob(!!(d.progress && d.progress.running));
					var shops = d.shops || [];
					var h = '<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">#</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">عنوان</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">پروفایل</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">مبدأ</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">پروفایل ﷼</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">WC انتظار</th>'
						+'<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">WC واقعی</th>';
					shops.forEach(function(s){
						h += '<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">🏪 '+(s.name||('#'+s.vendor_id))+'</th>';
					});
					h += '<th style="padding:8px;text-align:right;border-bottom:1px solid #475569">وضعیت</th>';
					if(head) head.innerHTML = h;
					var s = d.summary || {};
					if(sum){
						var chip = function(lab,val,bg){ return '<span style="background:'+bg+';color:#fff;padding:4px 8px;border-radius:8px;font-weight:800">'+lab+': '+amphpSmFa(val||0)+'</span>'; };
						sum.innerHTML = chip('کل', d.row_count_all||s.total,'#4c1d95')+chip('فیلتر',d.total,'#5b21b6')+chip('یکسان',s.ok,'#166534')+chip('مغایرت',s.price_mismatch,'#b91c1c')
							+chip('نیست WC',s.missing_woo,'#1d4ed8')+chip('نیست غرفه',s.missing_bsl,'#0369a1');
					}
					var when = d.generated_at ? new Date(d.generated_at*1000).toLocaleString('fa-IR') : '—';
					if(meta){
						meta.innerHTML = '📖 '+when+' · منبع '+(d.source||'—')
							+' · صفحه '+amphpSmFa(d.page)+'/'+amphpSmFa(d.pages)
							+' · WC: '+amphpSmFa(d.woo_count||0)
							+(d.woo_direct ? ' · <b style="color:#4ade80">⚡ مستقیم</b>' : ' · 🌐 API')
							+(d.woo_error ? (' · ⚠️ '+amphpEsc(d.woo_error)) : '')
							+(d.bsl_error ? (' · ⚠️ BSL: '+amphpEsc(d.bsl_error)) : '');
					}
					var badge = document.getElementById('amphpSmBadge');
					if(badge && typeof d.woo_direct !== 'undefined'){
						badge.textContent = d.woo_direct ? '⚡ WC مستقیم' : '🌐 WC از API';
					}
					try{ amphpSmPaintReports(d); }catch(e){}
				var rows = d.rows || [];
					if(!rows.length){
						if(body) body.innerHTML = '<tr><td colspan="20" style="padding:16px;text-align:center;color:#94a3b8">ردیفی در این فیلتر نیست</td></tr>';
					} else if(body){
						var start = ((d.page||1)-1)*(d.per_page||50);
						body.innerHTML = rows.map(function(r,i){
							if(r && (r.is_report || String(r.bare||'').indexOf('__report_')===0)){
								var lines=(r.report_lines||[]).map(function(x){return '<div style="padding:2px 0;border-bottom:1px solid #33415544">'+amphpEsc(String(x))+'</div>';}).join('');
								var bg = (r.report_type==='work') ? '#1e3a5f' : '#14532d';
								var tr='<tr style="background:'+bg+'">';
								tr += amphpSmCell(amphpSmFa(start+i+1),'na');
								tr += '<td colspan="'+(6+(shops.length||0)+1)+'" style="padding:10px 12px;border-bottom:1px solid #334155;color:#e2e8f0;vertical-align:top">';
								tr += '<div style="font-weight:900;font-size:12px;margin-bottom:6px;color:#fde68a">'+amphpEsc(r.title||'گزارش')+'</div>';
								tr += '<div style="font-size:11px;color:#bbf7d0;margin-bottom:6px">'+amphpEsc(r.report_text||'')+'</div>';
								tr += '<div style="font-size:10.5px;line-height:1.7;max-height:160px;overflow:auto">'+lines+'</div>';
								tr += '</td></tr>';
								return tr;
							}
							var stMap = {ok:['✅ یکسان','ok'],mismatch:['❌ مغایرت','bad'],missing:['📤 ناقص','missing_dst'],only_profile:['📘 فقط مبدأ','missing_dst'],only_dest:['📦 فقط مقصد','extra'],partial:['➖ ناقص','warn'],removed:['🗑 حذف‌شد','extra'],report:['📋 گزارش','na']};
							var st = stMap[r.status] || ['?','na'];
							var flags = '';
							(r.flags||[]).forEach(function(f){
								if(String(f).indexOf('dup')===0) flags += ' <span style="background:#6d28d9;color:#fff;border-radius:4px;padding:0 5px;font-size:10px">تکراری</span>';
							});
							var tr = '<tr>';
							tr += amphpSmCell(amphpSmFa(start+i+1),'na');
							tr += amphpSmCell('<div style="font-weight:700;max-width:200px">'+amphpEsc(r.title||r.bare||'')+'</div>','na');
							tr += amphpSmCell(amphpEsc(r.profile||'—'),'na');
							tr += amphpSmCell(amphpSmMoney(r.src_price), r.src_price>0?'na':'no_src');
							tr += amphpSmCell(amphpSmMoney(r.profile_price), r.profile_price>0?'na':'no_src');
							tr += amphpSmCell(amphpSmMoney(r.woo_expect), r.woo_expect>0?'na':'no_src');
							if(r.woo){
								tr += amphpSmCell(amphpSmMoney(r.woo.price)+'<div style="font-size:9px;opacity:.75">#'+amphpSmFa(r.woo.id)+' · '+amphpEsc(r.woo.status||'')+'</div>', r.woo_tone||'na');
							} else {
								tr += amphpSmCell(r.profile_hits?'نیست':'—', r.profile_hits?'missing_dst':'na');
							}
							shops.forEach(function(sh){
								var cell = (r.shops && r.shops[sh.vendor_id]) ? r.shops[sh.vendor_id] : null;
								if(cell){
									var exp = cell.expect || r.bsl_expect || 0;
									tr += amphpSmCell(amphpSmMoney(cell.price)+'<div style="font-size:9px;opacity:.75">انتظار '+amphpSmMoney(exp)+' · #'+amphpSmFa(cell.id)+'</div>', cell.tone||'na');
								} else {
									tr += amphpSmCell(r.profile_hits?'نیست':'—', r.profile_hits?'missing_dst':'na');
								}
							});
							tr += amphpSmCell(st[0]+flags, st[1]);
							tr += '</tr>';
							return tr;
						}).join('');
					}
					if(pager){
						var pg = '';
						var mk = function(lab,p,dis){
							return '<button type="button" class="button'+(p===d.page?' button-primary':'')+'" '+(dis?'disabled':'')+' data-sm-page="'+p+'" style="font-size:12px;min-width:36px">' + lab + '</button>';
						};
						pg += mk('«', Math.max(1,(d.page||1)-1), (d.page||1)<=1);
						var a = Math.max(1,(d.page||1)-2), b = Math.min(d.pages||1,(d.page||1)+2);
						for(var p=a;p<=b;p++) pg += mk(amphpSmFa(p), p, false);
						pg += mk('»', Math.min(d.pages||1,(d.page||1)+1), (d.page||1)>=(d.pages||1));
						pager.innerHTML = pg;
						$(pager).find('[data-sm-page]').on('click', function(){
							var p = parseInt($(this).attr('data-sm-page'),10)||1;
							amphpSmLoad(p);
						});
					}
				});
			}
			$(function(){
				$('#amphpSmStart').on('click', function(e){ e.preventDefault(); amphpSmStart(); });
				$('#amphpSmLoad, #amphpSmFilter').on('click', function(e){ e.preventDefault(); amphpSmLoad(1); });
				$('#amphpSmFix').on('click', function(e){ e.preventDefault(); amphpSmFixStart('all'); });
				$('#amphpSmFixWoo').on('click', function(e){ e.preventDefault(); amphpSmFixStart('woo'); });
				$('#amphpSmFixBsl').on('click', function(e){ e.preventDefault(); amphpSmFixStart('bsl'); });
				$('#amphpSmFixStop').on('click', function(e){ e.preventDefault(); amphpSmFixStop(); });
				$('#amphpSmPer').on('change', function(){ amphpSmLoad(1); });
				$('#amphpSmQ').on('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); amphpSmLoad(1); }});
				/* silent status on load */
				amphpSmAjax('scraper_sync_matrix_status', {}, function(d){
					if(!d) return;
					if(d.running){ amphpSmPaintProgress(d.progress||{}); amphpSmPoll(); }
					var badge = document.getElementById('amphpSmBadge');
					if(badge && typeof d.woo_direct !== 'undefined'){
						badge.textContent = d.woo_direct ? '⚡ WC مستقیم' : '🌐 WC از API';
					}
					var hint = document.getElementById('amphpSmHint');
					if(hint && d.has_result){
						hint.innerHTML = '<span style="color:#67e8f9">نتیجهٔ قبلی: '+amphpSmFa(d.result_rows||0)+' ردیف — «خواندن» را بزنید</span>';
					}
				});
			});

			function amphpEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
			function amphpRenderDirectCards(p){
				var $box = $('#amphpDirectSyncQueue');
				var $list = $('#amphpDirectSyncCards');
				var $sum = $('#amphpDirectSyncSum');
				var $bar = $('#amphpDirectSyncBar');
				if(!$box.length) return;
				$box.show();
				var total = parseInt(p.total||0,10)||0;
				var cur = parseInt(p.current||0,10)||0;
				var pct = total>0 ? Math.min(100, Math.round(cur/total*100)) : (p.done?100:0);
				$bar.css('width', pct+'%');
				$sum.html('✅ '+(p.created||0)+' جدید · ⚡ '+(p.updated||0)+' آپدیت · ❌ '+(p.failed||0)+' خطا · ⏭ '+(p.skipped||0)+' رد · '+cur+'/'+total);
				var cards = Array.isArray(p.cards) ? p.cards : [];
				var html = '';
				var statusMap = {
					created:{c:'#4ade80',t:'ایجاد شد',i:'✅'},
					updated:{c:'#facc15',t:'آپدیت شد',i:'⚡'},
					failed:{c:'#f87171',t:'خطا',i:'❌'},
					skipped:{c:'#94a3b8',t:'رد شد',i:'⏭'},
					pending:{c:'#60a5fa',t:'در صف',i:'⏳'}
				};
				for(var i=0;i<cards.length;i++){
					var c = cards[i]||{};
					var st = statusMap[c.status] || statusMap.pending;
					var img = c.image ? '<img src="'+amphpEsc(c.image)+'" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;background:#0f172a;flex-shrink:0" onerror="this.style.display=\'none\'">' : '<div style="width:48px;height:48px;border-radius:8px;background:#1e293b;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#475569">📦</div>';
					html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid #334155;border-radius:10px;background:#1e293b;border-right:3px solid '+st.c+'">';
					html += img;
					html += '<div style="flex:1;min-width:0">';
					html += '<div style="color:#e2e8f0;font-weight:800;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+amphpEsc(c.title||'—')+'</div>';
					html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:3px;font-size:0.78rem;color:#94a3b8">';
					if(c.price) html += '<span style="color:#4ade80;font-family:ui-monospace,monospace">'+amphpEsc(c.price)+'</span>';
					if(c.category) html += '<span style="color:#c084fc">📂 '+amphpEsc(c.category)+'</span>';
					if(c.woo_id) html += '<span style="color:#60a5fa">ID #'+amphpEsc(c.woo_id)+'</span>';
					html += '<span style="color:#64748b">🔌 مستقیم</span>';
					html += '</div>';
					if(c.detail) html += '<div style="margin-top:3px;font-size:0.75rem;color:#64748b">'+amphpEsc(c.detail)+'</div>';
					html += '</div>';
					html += '<div style="color:'+st.c+';font-weight:900;font-size:0.8rem;white-space:nowrap">'+st.i+' '+st.t+'</div>';
					html += '</div>';
				}
				if(!html) html = '<div style="color:#64748b;padding:12px;text-align:center;font-size:0.85rem">در انتظار اولین محصول…</div>';
				$list.html(html);
				/* keep scrolled to latest */
				try{ $list[0].scrollTop = $list[0].scrollHeight; }catch(e){}
			}
			function amphpPollDirectSync(){
				$.ajax({
					url: ajaxurl, type:'POST',
					data:{ action:'scraper_direct_sync_progress', nonce: amphpShopNonce },
					success:function(res){
						var p = (res && res.success && res.data) ? res.data : (res && res.data) || {};
						if(p && (p.total || p.cards)) amphpRenderDirectCards(p);
						if(p && p.done){
							if(amphpDirectSyncTimer){ clearInterval(amphpDirectSyncTimer); amphpDirectSyncTimer=null; }
						}
					}
				});
			}
			$('#btnSyncToWoo').on('click', function(){
				var $btn = $(this);
				var $status = $('#syncWooStatus');
				$btn.prop('disabled', true).text('در حال همگام‌سازی... ⏳');
				$status.html('<span style="color:#2563eb;">همگام‌سازی مستقیم — کارت هر محصول به‌روز می‌شود…</span>');
				$('#amphpDirectSyncQueue').show();
				$('#amphpDirectSyncCards').html('<div style="color:#64748b;padding:12px;text-align:center">در حال آماده‌سازی صف…</div>');
				$('#amphpDirectSyncBar').css('width','2%');
				if(amphpDirectSyncTimer) clearInterval(amphpDirectSyncTimer);
				amphpDirectSyncTimer = setInterval(amphpPollDirectSync, 1200);
				amphpPollDirectSync();

				$.ajax({
					url: ajaxurl,
					type: 'POST',
					timeout: 0,
					data: {
						action: 'scraper_sync_to_woo',
						nonce: amphpShopNonce
					},
					success: function(res){
						$btn.prop('disabled', false).text('همگام‌سازی و درج در دیتابیس ووکامرس');
						if(amphpDirectSyncTimer){ clearInterval(amphpDirectSyncTimer); amphpDirectSyncTimer=null; }
						amphpPollDirectSync();
						if (res.success) {
							var d = res.data || {};
							$status.html('<span style="color:#16a34a; font-weight:700;">✅ ' + (d.message || 'تمام شد') + '</span>');
							if(d.cards || d.total) amphpRenderDirectCards(d);
						} else {
							var err = (res.data && res.data.message) ? res.data.message : (typeof res.data==='string'?res.data:'خطا در همگام‌سازی');
							$status.html('<span style="color:#dc2626; font-weight:700;">❌ ' + err + '</span>');
						}
					},
					error: function(){
						$btn.prop('disabled', false).text('همگام‌سازی و درج در دیتابیس ووکامرس');
						if(amphpDirectSyncTimer){ clearInterval(amphpDirectSyncTimer); amphpDirectSyncTimer=null; }
						amphpPollDirectSync();
						$status.html('<span style="color:#dc2626; font-weight:700;">❌ خطای ارتباط با سرور — آخرین وضعیت کارت‌ها را ببینید.</span>');
					}
				});
			});

			/* v10.99: تست / فعال‌سازی اتصال مستقیم ووکامرس */
			/* v13.3.32: nonce درست برای پل ووکامرس (قبلاً mismatch → 403/-1) */
			var amphpWooNonce = '<?php echo esc_js( wp_create_nonce( 'scraper_woo_bridge' ) ); ?>';
			var amphpWooNonceAlt = '<?php echo esc_js( wp_create_nonce( 'scraper_shop_admin_nonce' ) ); ?>';
			function amphpShowWooReport(obj) {
				var $pre = $('#amphpWooBridgeReport');
				try {
					$pre.text(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)).show();
				} catch (e) {
					$pre.text(String(obj)).show();
				}
			}
			function amphpParseWooXhrError(xhr) {
				var body = (xhr && xhr.responseText) ? String(xhr.responseText).trim() : '';
				var parsed = null;
				try { parsed = body ? JSON.parse(body) : null; } catch (e) { parsed = null; }
				if (body === '-1' || body === '0' || (xhr && xhr.status === 403 && !parsed)) {
					return {
						http: xhr ? xhr.status : 0,
						body: body,
						message: 'نشست امنیتی نامعتبر (nonce). صفحه را یک‌بار رفرش کنید (Ctrl+F5) و دوباره تست کنید.',
						code: 'bad_nonce'
					};
				}
				if (parsed && parsed.data) {
					return parsed.data;
				}
				return { http: xhr ? xhr.status : 0, body: body, message: 'خطای ارتباط با سرور' };
			}
			function amphpWooAjax(action, extra, $btn, idleLabel, busyLabel, onOk) {
				var $st = $('#amphpWooBridgeStatus');
				$btn.prop('disabled', true).text(busyLabel);
				var payload = $.extend({
					action: action,
					nonce: amphpWooNonce,
					_ajax_nonce: amphpWooNonce
				}, extra || {});
				$.ajax({
					url: (typeof ajaxurl !== 'undefined' ? ajaxurl : '<?php echo esc_js( admin_url( 'admin-ajax.php' ) ); ?>'),
					type: 'POST',
					dataType: 'json',
					data: payload,
					success: function(res){
						$btn.prop('disabled', false).text(idleLabel);
						if (res && res.success) {
							onOk(res);
						} else {
							var d = (res && res.data) ? res.data : {};
							var err = (typeof d === 'string') ? d : (d.message || 'خطا');
							$st.html('<span style="color:#dc2626;">❌ ' + err + '</span>');
							amphpShowWooReport(d);
						}
					},
					error: function(xhr){
						/* یک‌بار با nonce جایگزین تلاش کن */
						if (!payload._amphpRetried && (xhr.status === 403 || String(xhr.responseText||'').trim() === '-1')) {
							payload._amphpRetried = 1;
							payload.nonce = amphpWooNonceAlt;
							payload._ajax_nonce = amphpWooNonceAlt;
							$.ajax({
								url: payload.url || (typeof ajaxurl !== 'undefined' ? ajaxurl : '<?php echo esc_js( admin_url( 'admin-ajax.php' ) ); ?>'),
								type: 'POST', dataType: 'json', data: payload,
								success: function(res2){
									$btn.prop('disabled', false).text(idleLabel);
									if (res2 && res2.success) { onOk(res2); }
									else {
										var d2 = (res2 && res2.data) ? res2.data : {};
										$st.html('<span style="color:#dc2626;">❌ ' + ((d2 && d2.message) || 'خطا') + '</span>');
										amphpShowWooReport(d2);
									}
								},
								error: function(xhr2){
									$btn.prop('disabled', false).text(idleLabel);
									var info = amphpParseWooXhrError(xhr2);
									$st.html('<span style="color:#dc2626;">❌ ' + (info.message || 'خطای ارتباط') + '</span>');
									amphpShowWooReport(info);
								}
							});
							return;
						}
						$btn.prop('disabled', false).text(idleLabel);
						var info = amphpParseWooXhrError(xhr);
						$st.html('<span style="color:#dc2626;">❌ ' + (info.message || 'خطای ارتباط') + '</span>');
						amphpShowWooReport(info);
					}
				});
			}
			$('#btnTestWooDirect').on('click', function(){
				var $btn = $(this);
				$('#amphpWooBridgeStatus').html('<span style="color:#2563eb;">آزمایش ایجاد draft و پاک‌سازی...</span>');
				amphpWooAjax('scraper_test_woo_direct', {}, $btn, '🧪 تست اتصال مستقیم', 'در حال تست...', function(res){
					var d = (res && res.data) ? res.data : res;
					var ok = !!(d && (d.ok === true || (d.direct && d.direct.ok)));
					var msg = (d && (d.message || (d.direct && d.direct.message))) || (ok ? 'OK' : 'ناموفق');
					$('#amphpWooBridgeStatus').html(ok
						? '<span style="color:#16a34a;">✅ ' + msg + '</span>'
						: '<span style="color:#dc2626;">❌ ' + msg + '</span>');
					amphpShowWooReport(d);
				});
			});
			$('#btnEnableWooDirect').on('click', function(){
				var $btn = $(this);
				if (!window.confirm('sync_mode=direct در connections.json نوشته شود؟')) return;
				$('#amphpWooBridgeStatus').html('<span style="color:#2563eb;">نوشتن connections.json...</span>');
				amphpWooAjax('scraper_enable_woo_direct', {
					fallback: $('#amphpWooFallback').val() || 'direct_then_api'
				}, $btn, '⚡ فعال‌سازی اتصال مستقیم', 'در حال فعال‌سازی...', function(res){
					var d = (res && res.data) ? res.data : {};
					$('#amphpWooBridgeStatus').html('<span style="color:#16a34a;">✅ ' + (d.message || 'فعال شد') + '</span>');
					$('#amphpWooSyncModeLabel').text(d.sync_mode || 'direct');
					$('#amphpWooEnabledLabel').text('بله').css('color', '#059669');
					if (d.store_url) $('#amphpWooStoreLabel').text(d.store_url);
					$('#amphpWooBridgeBadge').text('آماده · direct').removeClass('field-badge-blue').addClass('field-badge-green');
					amphpShowWooReport(d);
				});
			});
		});
		</script>
		<?php
	}

	public static function render_scraper4_embed_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$scraper_url = plugins_url( 'scraper4.php', __FILE__ );
		?>
		<div class="wrap" style="direction:rtl; text-align:right;">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
				<h1 style="font-weight:800; margin:0;">⚡ پنل کامل اسکرپر هوشمند (scraper4)</h1>
				<a href="<?php echo esc_url( $scraper_url ); ?>" target="_blank" class="button button-primary button-large" style="background:#2563eb;">
					باز کردن در پنجرهٔ مجزا ↗
				</a>
			</div>
			<p style="color:#64748b; margin-bottom:15px;">می‌توانید تمامی عملیات استخراج، مدیریت پروفایل‌ها، صف و ارتباط با باسلام/ووکامرس را مستقیماً از فریم زیر مدیریت نمایید:</p>
			<iframe src="<?php echo esc_url( $scraper_url ); ?>" style="width:100%; height:840px; border:1px solid #cbd5e1; border-radius:12px; background:#fff; box-shadow:0 4px 12px rgba(0,0,0,0.05);"></iframe>
		</div>
		<?php
	}
}

endif; // class_exists

// Global activation and deactivation hooks
register_activation_hook( __FILE__, array( 'Scraper_Auto_Shop_Plugin', 'on_activate' ) );
register_deactivation_hook( __FILE__, array( 'Scraper_Auto_Shop_Plugin', 'on_deactivate' ) );

// Initialize
if ( did_action( 'plugins_loaded' ) ) {
	Scraper_Auto_Shop_Plugin::init();
} else {
	add_action( 'plugins_loaded', array( 'Scraper_Auto_Shop_Plugin', 'init' ) );
}
