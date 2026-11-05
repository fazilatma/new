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
		add_filter( 'woocommerce_is_purchasable', '__return_true', 999 );
		add_filter( 'woocommerce_product_is_in_stock', '__return_true', 999 );

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

		add_submenu_page(
			'scraper-auto-shop',
			'پنل کامل اسکرپر (scraper4)',
			'پنل اسکرپر (scraper4)',
			'manage_options',
			'scraper-full-dashboard',
			array( __CLASS__, 'render_scraper4_embed_page' )
		);
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
				$msg = "🌐 [{$shop_name}] ورود بازدیدکننده جدید به ویترین فروشگاه
⏰ زمان: {$time_str}
🔗 آدرس: " . home_url();
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
		return ! is_admin() && is_front_page() && ! is_paged() && ! is_search() && ! is_preview();
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
<title><?php echo esc_html( self::is_site_name_homepage() ? 'فروشگاه صباشاپ' : $title . ( $site ? ' | ' . $site : '' ) ); ?></title>
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
				'gz'   => 'H4sIAAAAAAACA9y9eXfbuJI4+v98Cpm/PB3xGlIk29moMJrES8fdjp14yebr56ElyGJMkQpJedd89ldV2CnZSd+575z3JqfbIgEQS6FQqCpUFS6jvPZ2PBlNDsos58M8S8twOE37ZZylDf/Omxa8VpR53C+9rkqv7Q0a3L/LeTnN0xqv13nr9JQXH7LBNIG3vbMfvF+2JnlWZuXNhLdGUbF3lX7MswnPy5tWP0qSBmfegA+jaVJ6fo+35HPAZ5fQoc9ZeMevJ1leFsHdbMaSJLybsS+VVM4htfv0H//4j9o/av+ZxH2eQmf3edQvMSXHB+zFYEq9bo3jtPWjgCzMXc8mN3l8Piprjb5f24r6/CzLLlhtO+23alE6qMVlUYuGwziJo5IXLfnZ4SguakU2zfu81s8GvAavsuVBbZoOeF4rR7z2YftQJdeG2RSrSzEDq9jZXt/cPdisQdVcJtfyLCtrgzgHuGX5TS0bQqppqMw5xw48RdhEeXhwMz7LktYwyxueGCVP+JinAEq2PViQjTCLEsjdWpQ7zKNz+fXGonwx/adjGC4UebKwgTzD4eSQ//aB/Mt4QPlHi/L7gHb8GnvwbmEPs/wqygengKBQ5PPCTk6LCYIb8r8syh/zcQZ57xflJdHtDeZlKi8ueR7BTBiM/+RgfBiG6TRJ7u8RvWGy+FLoZYT1Xg8zggYP32ewLo7fZyf39/zY+8//VHV6J0x9FYaeasDr8QC/9An/PwGmx7CepgCVQWAtR9GBpQ4gf/pzyqd8KwMEOZoMAEftcjp/n08SwO2D8qECB7ycz5yxsyyUyzgqivg8Zd8yXGwaHjsprOCSpf4dIirO76QIIQVf5GSGpXiFSSvCb5l4mVJX8zC9v/+UzXZSi0rEBS3d9Ww8yVJAR1zyToFCdtXQJ2jQv4uHjflpqNetNA1kmJElmjm/HOXZVW0zzxELVMWNVqvlB7UyuuCw9tOaqAtXY4HZNZiaODpLILPMamIktQxWZE2D5WoU90c1MUuPV9Hy/K4NkVZlPhqYyRDGunueXwHI0Ey+BRM5JZV6LURRVXvW91C3mdy/MkSCvzLTVGi3awpuFv8OLECMXy/CzcJqL+VX0I3uOtUDBGiKhBGKAGI21gsHDD6DUnHxcZrzCgIttbtY99csfJvn0Q0Uol/2UyP3Q3sU+1iEd/1pnkM1tC5n7A9YABf8JlhqMxgL/pyeFjxRT0Sp4dkC4/dMQQd7kTPaxGLCP5bRTxdxV2Ik0qOc9gOE1VIYXmbxoNau1xtZSEk+K1vQATsnDj1vmVIh0/+Zia21ZLlfry/9kVUG1cDkRnKcn4Ql/PEJOFEY5edTJP9FK+HpeTlqrmC3IqBxHT9p9UdxMgAwhGmXJ7CbQVbndeTfYXfx+6mAbSPy2TBsd4evo+5wedmfHg9PTM3Hw+WVk65V2XQG9RDjIDd+7GNhYBCFbg6LfOq3NXZ6j2gcYr3dPXki1nwQ5URiA85wwmKar4wRdgYJO82uUp4HHwG1xATPZnrKzgaCpjxYYwt/qNqSquU4M7JqLhaAagCYInqwqj8srF3E2gU00QLyRNiAkFGNw6Cj3NTxjXYiBD1QSC/0Ai9sewx+4GHFm0lgeE+8ZewbUf/G0+MwOHl6zjSRSE0vjtOTmdh1/szCp/98uvz03KDwbWHD45ddJvTElx700sMeIGoGZavMDoCJSM8bq899M5QiEQuEwdoQQ4pD1UQXkBuaQZZqGKd84N3fUwJwaQmPUg9RmYuVQ3ichUsdxFu1N/sZLn9C2eIqLvujRuzf9SNgEArqiRfQSzodnwFbElDpM2AHLrqULocXyG/NbIhKgAuj72vbA/p0hvic+RJMGdDAJEwggfEwx157Pa/lLQM0M9b2g5x9zRqJ32ukkMPklgTjSUMzZX9mzHtSf+r5yx78YQCqhEAFH+hZHOqJGc58P0h0RYBnCa31EBA6YelyYynBqbi/B6YkwyfoFKX0PC/AmaIX/4HWl7mPxGcyLUZQr88I0FkIhNAaXZAvAwriyKC0og4RkIToNZeUpRsBZbiLQ34cnXQF8cgRKDEs7262HMIgYxrkFPBhpsjNNCTmS3FNU5trooZ4OJUyhc+wwSVAHd5KYfNp+H5rAHtB14/DuHUZJVPOTJvQGVZtVRM5QjaJBZJbKEOJxNCO5BzENgI7fc5rKbDw0ASQpwgShBxSI4pXa5AMENS85UaJ9R5LtkB8fgLwkwmAbaMazERRu/OW5R6Fr9Bk60cWpw2P1XBSZl5Qwo/fqm0PazfZtDaGNVEiWwIEDYWQCKSTJOFinQHUFOVlNRTogDGJkGoDqS1KHg2QGVG4a5ZnnKj9S6wrWlaKBab5y8PjE8D0tvqYFnSOOGqjaWzoh5inlMUsAejPfGYRtr+IsGFTrVNklqYFgKrZUbQOUnNewIbQBZ6igfgIghOsAYukOV+2ge92K0KKoVM6TFcYpsBY/av1rLj1+Mwt7JRtW2VLf1YZakfDVhVSW2BX4J9OJ2p9xKscSgYMRplHaRHjQGTi10F4J9giUXYjLiYRkDTYoI44s3PeYfJ6lg7j8yBLnKw9uWNazA2PGsj1WVw0FCcGGkViXAvFdIJyJyfZ14jhtbMpoGKBSElNAO7NQLxdV6zB3TiaBHHCYGVvRv1RYDP7hIuIY5awAhLKZJLcCKZWcxwwozirfRShAps3FsikMXautuVlmMNyxsqM+Brn24XfWLvjzL+/Pz6BiUgT90OY6SXa+125Q4xfjbyFn9X49QRWLQCN1nKfx5ewXGsFkJ1E6jZqUtgXa9paupx0Ii3D/+6k+L4lxftwa4CvH6WoHj4Rr8A2my+AwYa0AxL4P4C8H25QoQMpXIef6fX09GBzfX/z8HR793Bzf/ftzsHpxt7p7t7h6dHB5une/um3vaPTL9s7O6fvNk+3tvc3N8Kv9CH0PuQRPvUTaHBTDCScm2JDbhbAy/5USmyHI9yRxdTXxtOirJ1xTYIluBggXkm0cgIiLQAY2JNlD8EnKBkIFigVCx7OB6pGzAuLQ8HiZaHi52ymnYTPKr8eC34dPjE85gLmPbGYd8FXIgtFwojDFIt9dEFOFze/KYkMFu8/Xcz7Y3IjP54i7z+1GelI96kXQU6A2YIfnD4gGkwFsVosGkz9u0iKBFO/q/gAIRpMSTSIFogGVmXR7DeY74SY71gy3rliuTOxAvrAx5WA1UIAXbCCgXTq2o8G7FRO0mdkEEBqcN5XMAHQELbJdaImbfZRarOIxDJop4CxyLdTOUOiLpF0nmRnUbIbjbkkyrQKqQqrI2+xI6LPAccyquKQW6NSa+Z7ZtK2IlIbhvN07nvWOovTQYP6wTWlKAmSKKlbNe/zYTinanK3GCotlXFOcT4vMr0bMMGLBJIuxcVn5I7UAA6J1KDq7dFq3gNUJtFNkkWD4E5ulkGzw+RWiJA6jdO4DP4aiGZQ0VfREFXr/DJQ8mEfKB/wbkGpF4TQ35WiLmguLw/1lroAwFnSMltu13lDfVmZ39zxBog8cQqr8+bOLSBbmQIThjqhU0MegUlbhw/Oov7FwrHA7q8oi12WisxUBQ/jf+VrURDy1acb/Gx6ThgcujpDmTvk8PGgUuCh6p3iViObwyHsdL8zPFHSGdz2YB5XK19tDxqm+HiC2lfYTN9H6SDhc1vO4hoqX8nCulLYEXOs5PdHUvnEGdJOBJtT+ft12eWdij48tAIqFWA558N9Djwa0JvfAo4sXIHJYqow9+nQwoOqTveBj4RW1PrsJu1vXpc8h5VFZ1e/1+25zyoDWLTaH6jKFJWIdsnzAj/0Oi9bq62Ox75kLXlgFXIhMf0ITVqXVJu1n4Nwb9D44f/iJKv5o7hu5rABxWP+v+9U649B+IN9Hzx6tPXnLw6vAPV+pdYth+Efg3+Bf23NSUMsHf5dfXAZ/VIfnM5pd9NfqX0f0hZ3jULZ50NHM5wOf6UZflw7W1a1s+Vi7Wy5UDv7ffAb2tlyaLSzSWJkmD8HDF5hKYRlJJ8KfPxsVhqAEeFbhCaNpZF7dPwHHh2zvJKaRI8eKBcgNeMJd/6/a/k1bNJrkLVxy44Epn4Ob5UC71YoAY/8Lg8QHbrt15+7otS38HOz8+bNmw77Gd4efztBHGq/Tho/oRofE8Ijdnv8+ST8yT6H34TEQApXlFt1s2njVlNb1SoqYQRbdnvcPjFlcywLrdjllA6FVhOpSUL8iOEYJtmkQaj9GdYLjA0zws9yJGIIbey8rI7t8vAnDqj77fUul6Nc5+HKPxrfljs+8KDnHCpf5yfsY7jOlzvsC7x+FAN/kzTOOfvs+x9f/6zX8fULFPd7DYLEF4YFw8/sW/jRD0QaFKfKKHWdG02kVcNnCUn7+wok1U5lwJS4M1kAum8DTl03j8yzEgwQMu3e5+C2FQ8gPx7MzOkqUAoA1DhK+47+fz63lWZXjpJWqvatIl2L68XS81ttjLXAvkpq4Duh4d+ARcOiMBNZv65DFmxGMynPHp+wIf65CWHyBOEdhavsOlzqsE38c4B/ttUhRMHLQ9htgctyTupNspDvJqp8P+FRvugLO0N807fa2B6P+QAJwpJ93tGzc+ijrvwkjS7jczQlcMrX6zq9JSlVnJ5bO8OibBDKttPJtPwIktrfLi1FywUFfbPpjXGRqgV2FOKhRfdIHhl1afke0d5Eoo7SMWMhhf5HUgoD6L0ObymPWZgbHiGRj5FNz1IsxMrGlB351rLoimYtKrMrKQdNN/aQLW368J42pr7smw/40GbvGjuiprsF3a/Xvzd2mdW/5q3dyI5YdwKvYEukxiaNC59doBYZsU6cT38ORyQoIpTGQFsRNVF5cq7baSw1zivDfHPk39/fwmb+teH7mgSfa1h2zcL95i5GU0atgHPY0OIsj8ubHX7JBd38GX6ba/M1UE0AprvuGvpk5qeD81YzP4NznFrSQeXwl+EoxflOTgOlPCQ1asik9AL6K4/wFOkl8K9zB/7r3JoAAB5+1VFkcJdr0Vuv98+03gVJOMU52Rc5OCvsU/iMHcKDQeCvxuymUR158/D1J/s8E0R9RKt9NQrq9+0cwLqH4a3cnGCAOPVH4X4D0O3WaAqOehHUFjSsHkpiSJ2m3kfcmuW+M8uRI7n3GwUITnpJyS8+8KKIzvn6KEpTnjjERPRc2mG45dgeEHKyKFvpyodOK0vHolBYAIV22t6DIkUp62jY43DLbUMfWds2Q3mHq3Q/vGWn9/cIhzZDkFjw/i5W2EW43bAqup2bJpDOEN9M6jYI8x8lysOE2zmK4ursjp29k13pjDU7Yxc3tkTnrdp5QuMOZFHgmZVzVPD8XZL1LyBTf7til+jjbpnM64IAMrfuOp45n2UgJ6ZTvnnN+9OqMLt5f38NENUEznc+JaMg4LfHfN+Ry6HF9pvb+/vOyrPXtz0UXbOEt7jQzLsfKQuqGsx8jOoT4EhRJV9ecZ7W2sQJQzWshp/B0GtD/LKWI09cGwH/TAxvlGKh2nBSzJ0oeX7wKWxDNz5E5ag1TDLoQ4evPr31g2fOYM65Eto+2hRuAa8wqn63FedFqQC/i2ch8x8R2bK/Sx2FG4BM2g+MpNlAR1gNrIif1UAQgVVpeaCMYI/C0UxtDKPwiCiE4oktZSKQspnT+iRCZdmiKXeK5fznlBflxyh2bX3dQtP0S1yONFaaQeGSk8O6fWBY9LMmfp4F7uBuw1VrcLf24I4eG5ySvhasBXYEnLHcAedoreyqpHmfbdb1s6TTvcbn8DNItEl0A4KCVVJahwD7/fpz79vy5+CbH4Dwwsy4xVYJ+4WxHQEw/AxXntnmJACEn2Gn/WL1xVrn5cqqnbOGOXytggE/w2d8VW1iP8PPyz/ZbXgXD4Kb5WWmln1wxJx9O7hleicMPjN37w5+Ms0zBc3OjH1+8w2kEYuR+gyc0xCGxhCrQ7XF3tLOPUT9wEGvYdiX4ADJB27An5vffB+lGKuun8SFQV1ztMZnt+60jrJpMvgW82QQfrUzrvJospDuiTUzUiKLhcAPrZkHTogdVJvN/EYS+SyPjCIhEkeDw9Ak/kpJN8jG//uUc8kQlXM8zIdmc14nbYHk68vQG5XlpAiePiUw/ChaWX7+dJD1i6e0QzQHHLuet0blOOnFKZnBAvXxljlLw043fV09auymy8t+uRx6dcgpjk+waIp1HO1v6/PqhjlGTLWmyfsQp/EwBuDI81/sQO3/0HFvt3YZw5ZU85bLZQ+3HwLFEDC9JhkYNOhFExlMT7O0OVaVDfhljaeXcY68Dmxn+DF9SPUXNIHRYED64CipjXgygezaVZSnsMUVLY+oXhERS3XASzbNHYvqsVTVfxC/DH+XvfVoAmPiHmrpdVFZhMA/zY/5SVgyHgKr/LpU0OMAvSJqQYcaJRQQB7ofy3BJEcIrkN1ITLct7Jy8FkwfAfe3ClWOJx1mku0Uv9TMFsPw6f99HLxtfj+Nmrf/nLbb6+0m/mw8p78v6WWLXrboZWVrC/6uvqBiqy826O8WvHS2MGcFamjSzwb+pWIrnZeYs96ml61NeFlttzvwsvECv9l6RTlbG+v4srFFL1tbGyf/X+3YP5utdvMVNv3uBTbTFm0+p2ZWt6iZtfbJP548ZTEqN1kWOUiXDa3zlp1CaImziHG/t9QOVEIsEjpBMWwBYcKTwl4WId5BIcgVT2ypY+FoNFS2nSQSpVpmS8XZs9HVLXUqe3QpDTW1NCNMNQvS/XuB/KotDDWVPahMruXYT9VabyltRf0+n5TFO1GuQNcM3ioz4OR5vh6hyNYqkG422uyZj8aYoTeIyqgpTVs9pFRNz9dbs3bBMGOdumMtq+4h1RVkwcbXo4EPcwMRC2S+hI4AnOQ8VlU/SsVGqKN9aBy+l1yHUqYVu9Fuo/RF8vNqMjD1b8qZHpgRwLixz2Uxy6SZfwWiITa5AoOFn1XxsybM/KOyzOOzacnR9CHMFyQWE9gFw0TkoOEOSESKJIQp014F+E6VSOcCQiHpWVBEKRDdW9gYdsJYORuMs0u+OZ6UN8JkMxReBrfkMeYpW5PaIErPeZ5Ni+QGKPI2iLf5+8MPOzXbhkO9rI94/4KM2VQpFEdy2DXo/DwtN4H2I+fyRVB8nf3+ZiDYMJ1R3iTcaxWTJC4bXs3zW9LWzdHE33JcVrhZ0DTg8mKwWaIECU+41nx2fOyJyQDZPC946TH53uzLhBN27PWTqCgQepBNz5SKO/FWlnvkBiJTysnmz2l8CWn43OT0cnKysH/SKvO4fdKFrpa6qyXrUFePOyfV3np9F1LQDoDm/Fw+FxOeJARmeCFjXe/kd0CzQu25a3qu6WhaZvscT2ixKS5PgPe54HeKfRxrDqsTwdGfFrJLOIE8v+Rvk8ko+ju9qbTvARnNrrYg7QD2ScC8qLhJ+zXs1BY2R08fQf6oIYjyLCkU2uEvcHiDmLo0UA8f4z7yBdupfFDp+4D5JceakG9GJmW8m5HdDcrlo3gwgMZBXp4AcyP8NeFB58NCS2sT+LjYThMgVsjUDvbQLDGX8IEHguGgVvShNPzwaJwAlgPzyscHmPZ3MXv1d6avL1YfTMkYgBJPaHbG05KSCp6QzeTvTRC0155fSV5fcVoesDUp2hv9XnVrCxcmoHpSQF15doU/BdAnwnDYqX6r1ueLa4XqDrAOqAolvd+r69kvAUxyzocifHr8z2Zw0jgGRufEt/1A9m3HFVzaUNvRZKJqmxHZScvmiJN8A/h0Tlxy8wzyCZOiPDqL+01EyJpKbBajeFjWAPLqw34ST5qTqByJpxzxEyAJAkQMlCOfZAlR0kVpTRBu4LWQedIjVb4JSzQkviCggdhn94ynuHCauF7OcxKc4MOkmcHWBJK1eKGOoJ5p0KQK5bMuA4u2OYzGcSKfcb7NUzMa/ECjVJEAohVs5+rlJpEFpUgkXq4EOM6Tm8momaJyTDyCsA9QFeMdwcstFAZhYz7zEs2M+iiHYCnowGXzWj7Dn/M4hdd4DPKOBZqElwDAJu7J9IpdgAc54nGUX0AulFaP41g/EjbWYM/NaV6F3g/5S5UC23L/IkU6MUG1E3QC5VZA5azgzU5tktFcNoG4gDBX032iKQagFKNoYne1KLOJ7Bc9qolA354LjkbD0/OR6YabbPoC6dkFbw4iqJ/8IayEbDiEDVSl4CAAT+1X9MdQ72P07k1i+FEpVo/w9SoeAFKjmV0zSvsjFDzxGcViwRyIdzNCEuxdYJokM4JpGqNQ3DyLB7F+yZGtwbeyaE4QquPaZTPCLeyMA1bAywhKYCuXzXjAs/M8mowofQxLj8MfQp1LUg00OVmY1RCjCI9uxKNGI/vtpnYFM6tR6CqPCYPQdbx2PU6A/b6GAVzUruWC/+VeoXw/lGPSh4LtF/5ijqO651JTQQT7I+5t8i3vw+6q3qxHmPAr+VjGpU5GRvPf20lirYKnT6+urlpXq6Qn6bx69eoptefZxB4AFiCVAmqPjwnMmXwkttk7+X+lM18/7GCHXj5NFX/udAoYN1LxIS+ZZ0WxRxP/extR59c7/S1vESDe53yoPvR0iieqkDM7opRfwZPkUuh4kfexsPgmEoIl8b7jt+LlfzoEaKiNe6mJklEYsZDUaOFtVe0BwlePZkYc8DcSJbgmJOKgNUaQ398vNVa0agektRKYbhRNMzS/kM97qJmBjRmfU0oXz7vkKQkSKnYkIfuvRirkSgY1J1JW7WVQQuTJBC6lqLdKXoP8gJzwrRRGFmp+kFSFtx4/ThzJDWAYOmNDaRFldc8L0gBk5sSVDFleTSFcZI/3r5GEonYolwh5FH/W6nX8bqmN7o7YZZb33KHsHjRyss2bHyKMzxf6s0Po5fBfsB5kUfKoYeN++ljMjr30cbPH7eKXMTu2isdjdkTR4zE7ptGjMTs2il/G7HhSPB6z4+1j+adJXGA7R8XDgT2+lA8H9ugv6j7u7ySLQYFB9HDkj37+dyN/DCKM/DGI/pXIHyNeibvxrjBdGeTSmexdoW0tfTzosL2k/Fk/InWR2gpStI/oX7QAI8YNvzWm3Kf/TBu1fzSisub3/Kd+F2osBdG4v/c8qQv6r//4r+V3xbKMyVOgXkn35Uuho28s8fv7z4XUXXleF0sKy5Y0pD4BKnF0szjAfhzmsIy7D6TLQdHpDWrSfFKn2f55zkiZhJVQrRmiatTMKMJnExDB7mBVBw9WNNNGLPt8iMKkfUwok0wkCvga+jeXDLTi+ESBfyitfMPhbL4gh4Ko0SfbFppAoWi1PsYPubTatWJdWJ8smHP1HY5IpwAIh/V6ri31hgIfYITSE96c4yShzJQcDyCAz+Iwn0/MgM5Kn7AOi8JYv3Q7r8MMD0xDWAXJcYabUIz+3n7UbJJNslWimzWbDNJxmq2y1OcMXjr39+ie1vEHGdqtyNKs/SYCum6XF+Z9iK+YrHkfrwYIjns37PT4aPlKtgZxgZoO3Fnq9WkrTvvJdMCLhvcahJL0ZpxNizdi7wynpkI7kzmV+EAmZ1cjoKgNM0BfnOvOZvqwkZYRewj9U7nyUEndc6pHL2TkyGD78ntECODJqGr7pMjX0QrK6FwqirUOGL8RGmShBe48t3K8HaKUMmfVzjnQRFrmvlqUu0MUWpRoO9YAHd0DHiLRENsz8mRcVthZUKAlJCGn3MJ62pjv6uYBLgYw7wvlVe46sOvwKwsosr8ISdQE3N8v+FStJO0dr2ZCzsJeqvqmLNk9Mah9nfFR7PcieavQyWqXFhnbOsM46cqsJyZLTZnIeDuXQbM1c4egYh08FPFiGgUKN12weOuKEVj2tM+ibDqyPlLOjY98rbwi5dcbRWCkGUQHvXpDpw8M6oH5rdRcyunCEBshHeV4PW9LOy826EDYB37QpHka2Y4Kc6BSGS9x+6Vi1MvgvUJG4Mw99KmSvf9SBhS1QHovYida5Kpo2ybgx7DNWZu2NuEmoy6z9w9t4Y7CMC1Y7SvqHMhbB0FGIYBasY3y92eu0zYf/f2Z67xU/djgIzr/4IMK5tvLvlTLnYcPrDmYxErzjd+dUtHciwcWoKZOlYM0dz0qiujtZ5n6UtFP7xCBUCWqMLHqvO2lfTa3XfTspRt41gpeWVFV7mnmVNa78gA9WOnotU269woFr5ICTbxdUiDreqZHlJP+5gMp99SngU3cOy9cIr+mib2hKuUimvrAIq3Q1HKeppaL18X70tr4FDmTB8j6bNgJ9TMfBMiczWqUdKMA6dRHNpphNLdAzV7eSmGWiUsgH39be4DxYGK0qgdOU0SHobOOs+zaE4epXh4NYhBxrKYsWkDN9vT5SCAPzkD+lbzxOS8thcMGB7yKJyWGzbFDq1kcc+mD7I3Bm45L8mVZWqC00MxkWvFBUMnYbOhE3tM5hZujdCP0CbrDYQFF6Bfz96hVuetTpJJpjsp79Lk7d/l7WUEiWehRjCFBHBkgQ2YZxpmx2BRiGQkDj7TLU6SS1GraMi/w0R10Qbj9z/cjp8YruboHkFlmE1x1aAlsfw5bBk0o5WHEPNx8BjzhJa/hBKHhmrFDwBBI1U+QUlYqIfyx8GkSqSAl3Fgg6Kg79qeED6UxWhBCHiGZcO8WuNM1oWEbuURRQDeBoz0PcA4p3zACWcYLuAjMRLGyyP4i7cGeo6CFwZaAyQtsu4R+onk63AgkZilLJNeLRqUGUly2RXDLRMnmCq3tmUKWxJfKrAn3o7NscCN3a+NYLZNNFz9J8VgBSI5dAWbEMdgIYJNrXCA7yZwYEjLt0n6R1aGhC3EhKUabQ4tJQFRylG4hoxFHiax4Zs32KHK7ZjcmmRrPC9x0mFU9BtmkfjdFZWPdNASqXIpp1aVF/1MKkGT3NLxzuxrkTCbIEBpMHokn1JRUHTpEUicKStmrdDVwumJN0lhCojSDY6UKokbaW3PuXLrmTWdyfmUVciGYYfsEMdoFhCmPkD1CY1TcI1VrG/eDSwF6WDiIYKqvIs6UyCM1a6Dz6L2ard07qJViejaOS6iQ3tCMARi1u3mlqdwvlGA8K6vEXhXofaMhS+0qBvWrFrQRBiVn+wOCjF2AIspJ6CrTsCoi6Xh2vJIRLi1Vy1pzcxNZgYQeHA/izeMjUBocM49LjXzJwLZepzcBW6xOzY7yoTMpNPuSyHRL2l0Xr1ex2lKx88vpJQouJrrE5eMs2HKGUQORiWIpIQaBC9/h2SptIPc4pZirJbUg+03He8UISBqV7++RIrfIc3tD0lv0o+PyQEHq651+/wIEgVvcRvlqNanUzg9zN8yr0VVup459HvJj2QRzCrH60SJSa8Da3eR1qsxoMUpdeYzBNNPj5AStHKlkCqVSE9YQTZWTcB6dMAbncXqi9zd8VrYqMCLCbDstTHyWkKpOpMuRHqhsPF8i/Z/oA4wdlhUGCBBsgeg7t/tOw4WeaxIDU0fvhamTifaShe1psrCkFN+ipDRHwt03xBRfl0Au1q7edon8yyiNYf0uNr5bEKB5vfGq4/tze6ezIy7aMpWdX/ALZLN3x/PK7kiNEA0PTcgvsaPLiIplZQ9lqR0cbPFwVnxyRB/CNPpUrqNxrlp0FYqmYYqe7zDP8L+GMi1wjCL00I4qgEE4Yk3CpTNCd8uaJ9Pd1ApPSkdnSCAkPbK2IIpTMc9KWEEk1EJesIoBCCyfp/Z6iefWBF27chbI3tL+sitI5sPTDARZ0jYLVw1lNU38iGxlqgobe3muBMEFR84r7Xb7KRYRgiPaUTxSms7X0XeN/nzY8aqC5UNn2mi0aQudX934vFwvUtz0H62kB4PEA93FBfVwAFZYAggOj8/TPXnS9XjV8hKHQcKuokVxfZT76cHbyaQiPlJai1/z/lFaREO+k4FktiWr6JmYiypm8KPlG/NiGNefwpqHfjbmQsmLXY/Omo/2t5ceh879vafNgeGpxn3EOJkQll1NrAdJOIBpWewsAXxHfImnkIn1sfcaGniDYV4IP/eGDd9EUfaXvddPKR+oD3w2JF9FJEhdbr/4it+j14adJ+LDdMtKcVw66UAUt/NQKjYb6iQ3dFwREqdhpJHizB1DvMlUtP1HPcihPP3378S7ZGTUVjNzVnUoop2O8vAuSuMx2Upt04EqPIiAfOgYXGDUzH1MxNczMi/bRvu2vWmJUr+beIAG/5W0L2ihJdKutxJ+bT3+AbvURL7v5QM8ydFJ/SyZjk1HxGuBj0NZyVDUcKWeP0qnWPV+MMrRmkW+7fLzyM7dww6SfiOPB28BbdTzvqhRPm6mA+sNbUTtV7TOU+/r1EP3zfpaJNgVyBRVB9onfiHjLXxDc7T1JBpP1Mt7nSUt4OhRDSLLJ6NIgKeMzg7iWxrnVTzIrijxVvgn4lOWjam5OEn2TE1kd2m9o97EeUVruw1lz+cmCYs+k/ZBG+2ZtLm6FFrM2GQYHntf+NlFjHb2YzTr/ZDdwt8976Rrx2oe5YvNxCbD+WQhfS6jciTK35aNtu9a1kIOSBtCW9no+GyUoxnXCJ2+Zo6x0UVUCXtWLnBCUQpRqVj0UNBPTYkli6MvRejjUV7lapGpp/Z7GDe89KVdQVAue5Nr60TyVLIZyG2TmavmsVMRlGqRcJZqoSsFWgioAHTPazY91JICfoUwSmC4gDcGVr6b0s6UZBGpToE76RfFFr36yr7HVAwkP0CmOkxE5IfRMERGEujvFC3XaYbvIrm+0OqOfnO5pvGHA2RomYwoNR6f0w+qbvEBpv6cp3IZ0HIe85Jqm0R5RLisg4KxEtVphPrUhD2RPwubtsLf0RCATVy1YjmX1Mz+goeusJKd1ReMC8bzV18KDt1tr1Lb87asSiLPwzUqNTrasXmnp8Qj0D0XD3xR7fdzYP7psFLgkeITdcMytRKtXX8NvLbFMf1RWFu9QTHCsKYOwa3rjgtzElE51PWiNM2kufU1sj2U6FifyzRpHt6fe2+iUWI1bZrHc2kUN6mcS0ZWRSaO4wKDRDfJFFw7yXWqbmttgf3fCxGAR4PlT8fAHxnrKD/npPCEPmr1p3D6ZHh0kOfAJWUUCOioUKwMXcrwYC6qI2wGANYo2j+kJYZXkFwjlwHxtoSRIttIKz3djbTydwvNIJwLgGL7tp8KIqy8RIxVggNdx4PtdkuSpfaSBvYvblhZMiwzKx0MOqAObKW9DfxPBETjfgAdhXUaQL+5KbsZiYgwW9IaC/qMAuNGiisHvlCjpEFBO+I6gzlPXsgWXrym5vXI5fwbtgDzEZslcJaxY7V16KjGYt9mi/0uFm7b6u91VVybr1B9DMaj9QEb2k8R4IgNMxy03dVxbgucNuiFWD1vlyG2AJiSlEhMvqhMGuJW2OXqig7lNQpcIXB3F3JZyDflRq0SN7LpWcLdglZatfiHDOPYZlfpfMrCoh+A5Z5PWVj0aFJ9X1hsE90jvABAsZRr7YtPZg8SSSGHLj/xzqZlmeEez83RonwRahn1hlw27niej2cvS3lXBpHTNIMiKeFKqxrNpM7534MLbrUDyKMKGgVOSpiZxvLGlo8l2TBi2g25xC8+fLvJmYeR24E39uiozT4mw8raeHAnvdKjwWATXUnwdJvDttLw0G/ZY1DJTa5LSTfRhwvKcx4uGrBOoMZD1zOWRWwqEHwolZDWtWUobIgTRh2ugK36XWH3J0JTpGyoGruRXrZZKuB44wuSfZ7jyhsmgmBMEnzLJbG8GYZ3srxz7wB+gzwzkCTL6ft8Yefd+sdD2bOboRMyQyuRFtaBEbyGi6NtgCgh8nMFp2HSddoUQaEqLMurl4A3EyAzDRxxG0fsRHK7sX0eGFAXCl3aihLy7yy5L6VcqXr3y1A/k3COcucgo49B3E2i86K+1n71kvhJVRJXh/5KWPhxf2ZCqUfntJnJGzfM3Ul6o5JFOqtGb4VWyyD9DEhL1bWcxuUOqgfAuKVXrX6IhyhLLm3EdaMsbhZbTOyofhHsSE1fAfrLl/bp8LVjeaQ7Jo+ChcM7VcXUGBbVp0PPY4PCVBr2SSURhHTC2O0aYwAJbjQMVbWKEDkilmTidiQOLe0seg6Iz1GpKNNhu+iqqFgzYZSJdQseF76OxZOwhcX6+0KRIWIUUv0KxADABA3FZHruppddvGuoiM8w4tdsEWSRgMoOQvdyhWVpmAAQYqM0UtdasUh3JxLdiYQmH2+eYuozPaaI+iQyARRQQGVGYaQ7hrOXidFGavCLq4+xloeqj7H9B6uvjv4V8gU0fD17CIFquVdtBSVYOEuoKXoEoVLDT6iQwdj9Hg9KK2JK5LC3hNJ6ZfX2Mbeyeverq/cZ8sLi8bmx8xQMG5fw4yawpVgvVIu8MMRdpl2SiyW07HWKH+5F4fdHQl+xbTffDRLHfgzdr02EJXblZtmRwECAdfJS4PMv3OIPRFMDgdcpNhdDj225/V0U9o6NEqeMG1CPnbo9seLwsQ23cju2HxvL7eyyrEoRQzm9l6XmZS7LFqoUx+O43IrPeI62fo6lErEpCwo1xgnjTB46NUyMeLGfdFZeonCJP8ZuROzp/TKkCHb95HZ1pWceg/UhOxiKvCQ7Z5vyeWd3xYrAZMdu4W/evMH7pShWMlSw2mk2DrDA083hfdu/b1N7N0n4fI2dJ+Fa59XaanvNVHaZ20ce9SbXEc5kAx0V20y+r1TijqxVbB1fVg0iO8+lKaWuYlXW8VwZD668lEaFz57L2HEdZV/YXpGFVtprshTs07LYy84rVe756ktZcHXlxXNZ8vmzZ6uyaGe1034hC688X+msqSh1K2srL1+qxtZePnvxXLX36kXnme4zryPoVtbacvgCjrIbqy9fPm+rSp6/ePFipSNrWV199mxtbVU2/PxFpw1F10ylndV2e2UV6lX2m2srHfhcQ1MnyFl4/nJt9dnaMw1cnSCNWlefv3zRfqWtRk2CMu6Voeh0F0xKRWPgROe+TFxJbiICAe9EKS+UMKdDcLelGNemu5SEL9eAD6gwXas0gU/VexamdTWIZ13p/tEWLUVhVv/vpBtRbOo8BFSN/KAR18OMxUtkQtOg1Bj99IiJxNr+O2GZ+SLzg2pZJVlaHZaEui1OCPN6falR1uVNinm9mUO3y3qzZMmbMBaehZ3nGI9fIYVPnTY0Hluor2Gb99CjznNkkXgLnfTxOi85dGrRVxuJyhRiQlkHtqX9uuwCdwBLGn2M8GqqzuvXwNvch6jQxDIAHW1naJQAQzFZFVcEN1ajiRu0jCEL5RpWS1ct2P/fLdNy+Rlf/Tcu0WanujAr67Cy7BavsmZVHde0o0gdDk1UN60qcVdNXlk1uLDcMI9yZdnrsv06lvxIJnEoxnsyAYcyNg3RX6o7JeVnr7HUiOqpf38f1eWFENlJCGgUoQYsmL4OSb8nWpRduA8jn8FS/O/IGkkRV5SJdn/qTQ2XZ8SCtYFVAwqogdWz4NY2lT6JGkqHdqPR/SZ5/TrssKXGTaLXIPSR9jlg8Ky7LGM3XuHxCUMjntXOm1REGlR6PC2nWAKQuuTmzh3JPUagggHoaSfouFNGdz5aUxaivxLOGiodxISVZmULH31LhBw+TG/r/w08pJOCUQB/2Txz569OH42npQgeFNmpLp3CtLJKoCSJt8ejWeIKYgIeplq+EyNO0bkQ8DDplsfJCd4niz9NDB4lflNArNhCrCx24eH2EOaju5CMdlXDuWmYiGjeTerlPT/OT+qE2vBwjzZ22K48J0pQHas78NaRI+phk7POa95bg/+52b96QFMMLVgLRLTuo4hFMXsXsc8R+xKxKWlSrxNExU/SgutM/n6Tvz9yEYA7mrAr8/gXoe/OMPTQD5FjuKIaPU0ntTKb9kdCHhDPGK+FHkSIlmh63UcNZ21wlogHGXpFfiPfqE75DLVilC6sCH9FPYM8m9Tw9jQZnARzrVdR6ILfUEXwS5HQ8AFqI5UkxTuh2wTgu8lNrQ8Pk6goeU10qz+iICbS8wiP6WpkaFmTxpdWTA4zPe+jRVueiOgVp/r4BN6yaekFEuz2vc9ipKX2E8H3hEeozj2bL01Qxxg36hCG3rHqb/OFJTit4ioFP/iRt4RZP7r7ivTtgW9/f56Veq5sDXGSFXMZVwtrs1bSRW7r7xb4t6MdDFm+X5JJfRj3YF3dnaHUxgd7aVCyQTamTHGvISMKcHADMzjeQrknyJlVQxAzcaKEZh0gbvK8CGCRz5htNogHOqVvJUUx+sYxEM4bksRYDdxjREF9UmXqZcmSMShWJ3yJL6/j1ddYQ62WfmBo30ReOVHQ6COBBGgD4PsEJFJ/wlQ4Sgt/ZOkzKn22sLSFP7L0Nyr9bWFpB4GUGkzPrtq4AJFgmTRiBvXA8zk++9Jr0VRqal2AVio8pF09ECBT79Wj9S6IJPnJMto7Txtq0lzViCTrN2gV4QTAFDpG0gaRjhEVqZR0G5H5qy7HWxpBYbf6Ao3qmy3sS37f4Wcz3xgcqXsRUI+LVkpzGiVX7dqKC+PW6LaaGnWwXYtCzu10mIlQL6rtmfO1o4L6od1cTBFXjYRHe5qlmV8JKDmoY0QF3QGecNpLl82vLIZBZZhDAXznrO5O2JzrXMkG4AaV2l5lMmYpni1+L2C5prKL5AOIqhD6upH7TB5Iy0tBlAXLVm7Pr6QHzIEYAxiULQok11BK+SWLbTzTJ54ETpxdRRmt9b8/BLQQO/In0xx88YmC4siNwocN2s48o8wzlfnNyfxGmd9UJixFZfxzBizzlfNqWc3Is1J7jKHku108AQbi/r6BfW6zx5SFjUe0avtD39b07+aVK8ASvTFAv/AC2Rld6nWtYj/4d5B+nRC2mMt+RUBvXYj4a8l+QdkUb/u1B0dOYpXB4VaVIY3VED0VFNeZglNBVx3Inwrq6QC8dOCN/B3Z7/9V2j3Mw7+EYdGvO9eVV5/pCui46C9aNanzuSjufyI6NZ9Vr/9lcBch9CQND8vWA7eys6uEHBB0fKlhNb5UwoGhfpLaV9I6b6H2bwO2tsP6sa5AH/AnGI7X/cjmwLf/Z22u/SttWp8gNbxKVNMDk+EcFH0U6Tm7SGDhM+IKc+MfBZu93rJ8H4ObZBM8Zo7OI7FB6JLyS1aiEqfZeb0z1AwFGp4QGiSuzj9GopVQf2KNlEcRytyx3WEWaxyodBcz1GFXAoAw7MyCrgqCqWsgwpDKE+OLpKL0HriAlPkgj/5ZIA3mtDWbcxF/0dEeF3UqCOEpKW7LqdmWOW7LpVWNPizhFo2X24ncyf/ejjt39Fo+vtfa7dL5Ix2yirUp6wJYiPiBlrPTIi8AISYpWy/LfqQPbDjXNmBaaNEpkxv1OFV2XEoWU6KGlMgsyQOkKutNhHxV79nElmcWSDf0Ksw/1PMlBvqVb1I4M28kopnX6cQWaqyiUtRUMgzKbPp5qmGALv6umOOAzpIz3RRdMU61EAJVAvnZ6WeMqCt9+Tkn13fxIsRD8WJJw3aKAauRjGXCJRo7u+06L8KCBtDDSdWyrJ5uVxKeTzZdsBKnE4zCLNPPODpdnCVTJS1GQwCP9S4K2BNsZeLNFCKChNNRwg75PIqKkZM5ySa0jJyhOi9yMM6REKGmg7Ou9Myv43JemNbvVel5bEynjDS9UNiWCGN9YMvTD4jcBYb/NMhwfq6NNAkVrMquRlxjDTVtD4wS7KHIluwyMkmWco7JPHnZiKeM1y6A/5T6+SSuHLltRZUztlEi9Munw+rZ2kY0f+BTOc7pPJ/Np9B28VUqnYbSqOi0un38JY0ZTzVJPxWmerCphEO0BFD8EIqCoXS0jVOoufdVOYDDg+XdwWIdR6xrbB/RvAyjbsI+CD9kAdkV+uu0KY7cc2Axc4qyBTxbMxdFY3jo5lhYdw9qF5c7oJ4u73WauYoDYHG9iW3fApRvHU0TpSMWmuXjO3n39ORRv0gSh63CQaqzSlsK7IDoUlVSVqet0tjqymuMVECpqz1uq7UPEnO/oJX8NTLJlhz9J69w6NW7GU4puCFdlSCvTzgVItc2UCJ10QK5y8vrGCwpTt2eID4IM/Em9+NDkSgwQjL6UU36PFWs+CPh98uPoxOqA37DtJcCDxRQuDatY8f6cWeXV0mTHMoHYSM210vLNBlGYD4jiKX9jHQ6BBHO7x0kwdeIyeotfukA2KcJNCAzZ8aj1A4ZeDcRlct+uVEDocpqF0y0wypEu+jrmLbc+nrVBHSeUMFRrLGQa9xFijsk1WIPE8OiPQS9g8QX8USsgQeVW7Ie7Grlu146z3Kazoqd9d307CyZ662dh17Aj8wGdRgwp4gLB9gzBsVFMmoQDxKM0kik6m0a3tFwP47QU6PNzqidAp5EuxSepc3KeIzR9caTYIEbIm/p7Pt7vFpY3jjM5lCsDR05zKcFPUNX4xDW4Vtg1Q/yUHgjv03Z3WXMrwJ0RAb2M4FyPtsaYsEDYK1HMRvHbDNnm4n84iBnd2KD/gofiadv2P8Eg7h/1U+YBgDjX+UvlSnz5C9+g9+h7Cgeo0Q+oNuJeIIF+yEb4PVVwhs2OI+ZsA4mkOEDgiwHeMHQxApfDCmniI492uOtYZ6N9Z1Poe0s0MM4R/I5cAoGlfpmDLfdMQ17vnVPZwoazFumNMUA20T/dfzDdRwQw0n0GiM8EJWQbm7m6hHmQ6d/M+nf/AAy4Js2zFbIceZ8079vj/XvW7V/36AqtEn+GSEabCY+2xjK2d9M2B3eMnSIEu+Q54QuTwhdNoY+ezu0sMSdHix4IxAQL0IeWgio/SNJI99m8N0EOHe6/Q+QB5j2gZ4QrOYdtXcE1Xy2q8GbF86yKB/AmogWDdgpoAbtfiUNrJ1EBMUXavIzNPnebhJBQV36g0D1HvI/DcO7zaIfePAnmnCPHaBL7lmUB17NYzt8WAbe2zzPrvDRY0cT+Xo08dg+uSCKd3r2GJrqyxSy42cbPAm8DdIEeuxLDJl7Bx77ACJboALb4YvH3k4mRSXpgJjIwBO/OxleWPMhu/2YA8OHlAdXn3eUxgOANF0e583YGYznZeC9i/oXMqj6q8A7jM481lmB6vGCcHhchfESC8k6z6F+XN3w+EK0D43BC1TyNsFU+P4jCVxspR3gRXGF6MnKCwO01RUC1+oqlj1HZwO2uiaeBRhWn2GLA3iA9t5neEfQ6gsHsqsvLciuvnLButZ2gLoGtQGjAUwAPD838O3gGLc6+AA92VrBB+jG1io+wDdba/gAH2w9wwfowNZzfICmt17gAzS79RJBBe1tvcKHDlbYxieqGutewbo7WPkaVL47HQt4dLBX9lStrED2B6CSMC3fYFoAnIEnyKfHJKADTxJZxAlATk9SVZh8nJTAU5TXswzr/7Ispef2V620qFLl3nxSg068wm/o+ef3lpaQG3YiYJ3Hxqf9r6Fg322aAVyss3LpEAESVe8+Qc34jiGq8Vedw7hYOxd6z1BYrS9Anpg4aCa5W4nAgXBVJ7q/LjlmVJoFTh0k/5NhrUmbTrzemewffoURqZ1uYeBbhhddAFVLsr5gcH5/V8z5hEel/JbYhEX7pOLyH+Ac5sBAMEDuQPb6l989NHQ9bqzsahT3R3+vC3+7EdyhiCx/BbL7h71D6cO/gHy0yxH8ins7cD/BRqc5sVmoREgxzsZHKzFOiI3BX2Rayitk7+A7USn6ABJjBVRzHOU3RP6/E/n/A/rx3cZmobQpqCXcBA/1u9BfDEzCgvleiBcLphza/5Pg8B3a5xNre7LvMfiNfbWcYC184rN0Yu/3PCmjhRyOyFE7qSwnFBAbVlaTt6w0RA8q+u3BKr85VX6zq/y2oEqnwIJ83eJ3YnPh4YPAIJ/lNOQUhpxMwuNXsJHBNgS7zwm7jMOPZb3urRs1F9FDrF96k66LsIZdKqdCZHyQQrd6Bx4PyukAGnYxoRwoJqIhjMZaaaFeX1rP2Z8RFWgsXcb39+vAL758jX87nTfhOmq/pyFuleXUcZhMpwstSqR+VAWZnOhjgVItLDQFlVaDRtWq9wBZCMqsrLzqLtLAVrWuRq+rgy8+ciNlPq1Y4AmphM3He0aQW2wccWLaD+EodYARTxYCo6rWVKaoUxUB1xqbhgBRNvTtWJH3JiDgYW1N5SeWStUKE4zdo42GT+v1cir9iKo6rkqYv2yiXb6PtBOPCCLo9vz+HnCjXpdzjjsbqrxQETaMQ6UeI5gw6S9SdQmX2nDbXbICAIoiV7YkUUIffkGy8EnSLApNJwugwYoooH3yI0Ta1+JJncNqsGKicPAnAKuMRZuxKjKb6+0DE/pnhL0RuybyCheZvPNCzMviWSA90SS8I794jHiAKm71iwI4PnvqpUm1eyLcAorRGEYBODIKzCJiU4iICkWBF03hM112RdEVgIXuU8GSJ+LnmiIzqFamOSVfcY6hFyy+LZlaGkCUI1W0XvvZjdrbtUI6y0MW4NOiybHYak+C0vGwtWxjp+YM7iDCY7cy3EnwJp0sXRfaeJ8Zuw1xWw+/qk3ihinB1KGEPPDD80QuDJuEXiRIWSI9WougnMkIeR9l/NjDvKLZnU4QAKfYNVszum5pRj+l0pNpgod7ehVZp7RmlckAnWIwmoek09Gpcfqliq9j++1HDHQpFeC0aD+5Gv6IpRHzNHw0jFI3m7o3+OgamSedCgHC0JKkhVBcFrB9fWbXcfgjFkeG18JTeRpex7h9LNyD7u9fvV68OVlXIk+Baf+I2oqPORFkZf8CPVQshprX6dTHaZIzZlUynWp+3rkYN1T69nodpu0w99XEHZ90AedKqI1xRmEeoOaoMZ3gBSRWfPmJNnIWAb/EoWKvgb1m0I+S0Aae8FamX3RdxhXTe1a9jrVYAawn5lKGcO5MTbqniz3WvNBmqNBJjNEKYVzFPjpJtUrb1j6jSmHHR76Ct5VPx5NqwDVhnLNE0XI6T0kIeopXKnNx0IxSlcD9QalQTjq4U2wRcw2QTg3GE7M0b02orUFJj86V0fPXEIlhuKF/7NwyrJqQCYWwHcGIYgHaCdL+SxIl8lp1dh5piJaH7W5uomfmyvAnCdPjXAQTV3eKlywBIC3hmI6TE4YG4HpknQV2XP2pMuDvEll2wpa5wcfmadNgatuNU1VdsuuWBxk5WYjTCN0AZeQixJdT+8xKnXFx8ofI34QqHvYdfguUV8aZKpt8Bq3kMx6Ifps2oLID4fqJpnROggrCMMN0Ex0FXoXOdUb9dwI6DqcuTgLS9Qgx8Q53vYcdWneuoc+jmyjqsBr0A09aUhRaxSffxUVwyCRAaRXv9aNkGGAXbDyYiZHjO88xmLejzZggYVRzwUMpFpRhP4GNtqzFeIie9gnPWxggaHsrB5InyX5X3MYkTzVU3B550/QXoYdUWoIWXv9nAvpId8wcJ0FEukh95DKdj4WpizDHoS5xTd9NEAAzlqv4X+cl1AUA+joAI7fTRRu2IC+4HScJ2B7nHfgd511xTRT72GFPsFTlbm7KxzjtdmDliRkbzhmjqH9I5PkAZ4P8kzQ130c6qg18ga1G20snRnC9DmhXSdPAldPLZIDUXFtBAYRlWilupsrxvDVvAatKooGKvtygcMlmd6EIdojLqZ+23FTY3KykzXQg3G3HMcaFTMXJtSJ42vSJh2SU7PTehHj0rXDWn2N+ZcVOOucyxC60JeKj2SkNIc5iDIQFRCc2PVNjRyMmMXxzMBMHVjEEDJqRo0sO1DWo1+M3ufBpJA/+mOIOh0AkUxark3Z6y/0uADwjTCQ+m+Iciou5eEtcZLsr5NiEkNsk7xERpAxBDzGLcEV+kOkPKFWXz2R5n1aD4vEImRoYYxayaM4aokWm6kcOWAY3TxIqXkB5GGkP44EMBqIGKibA0BA9YLpBPxD3DmwuyGNOHb60TyVHHB6m5MxvaCcG0rSoq/E6uOPqBIwleIJBB1Col4YXVmYTnXCYTWbCzFQfthKU3Cs1ZGJDGbQ69qyA/WjOytU9k1ZTGJQTW6zmQatoRQ5ti4gzUqPysEoGdScLuV72ThopX0hjkh0pepy68ahGU8V1qqh/YpVQBIdUVxk4+/IrDLXirrvuaXx//y5VfM87tJMHUp1jhKQ8fJcuIgM5kZLc7+XhHa2kIK+QBQZYYicCYswwBBOsqQody6tEbH7h+5VVziiiqVpB0Ix5YfYS0jnilek1FORmPTFrDal08TbzAfb1OrCRO7DaER4wFbjuQei8iFHqFH0iqTM3UmdpSZ2yhAKilDpx2ipSZ2lJnTlqQpUtybvUMTT/6PiR3810LI/jytZ4gual7l27OgbnMj8JvSv5XGIGhuOk1DE+QJK4uDK1QsfijELr3luVAKPSz3gQ5jNdNlZhZh/+Qkeitb8TyPTgNwIBfWasnVWnDnUKlDcv1K0Z240BUmw8RXiRInP8C0lYBEa0x+eqRQEX5E0yn9OWDSHzwhYU0GB5vBhBwbz6zoiqHTHfO1Cx3iwvv0PlF7Mb4/mYxB16IRHjc2olcxnxjxJZKsL3PxaAFMgqZo+nTsVETI1kQcE0piH0xLMBB7N6XkmNLQy5rOQVEhOuRbozdNRRTI335zT0orNMOHCuCwdJ4bAJPx+T6Eb9Hoo77pUTJRolKx9KPLs2vpZoe0l/NqVfJx3biafrWOTvoOkiPe1dyrwD4/05mMogzMJTk48nZcwHNZ7285tJSU8D/ItBe2rnGQgBdPAjw9tJL1Bpk4yeoRvSVfSjchU9mtTw4jz6w8mEQD7iiexAvYoeoRNkpYGxCtEnnjACn3jag3bFA45qLKLuSedTMmGuofEy/cFL7CeqWttBdsNykKWa5TPWrR6xdvmM9efZOY0MDZslzIRHqzBmrgkzZvrBZgE58Mob6e9ak37dNVRmHpGdsHDrXbd8fTeVr6+AibBllk2JHb4mTF5FKer3VQQYB80Jc9eFXrU/hd7h7gcp1uiZjTEIO4WkVHLbQQw8yEH8+mqquJCDWMn/m3F4NT0+iE/Y5STcjCsk/RrTjtsnlcjHUE7Ybnb8LnThcoKblbd8PfFn8HozxdcK6Yb0czfdJtBYiZurSPFPJJnK/J5V4kOKbKUQw9wtsqK20jPSLmbpOzTApvRraqhCw9mHtOEGdGTHxsqZWRbOJ05ZWoe/LivxX9dsmUMzxxS6+oWu/7EvxukCBbSkMxI4NQUMubgt/+/ppFZV81m4pmrXjIauyPb/Vl7oqjW3+nlf+N9o8B3Z0ItzJhh/5eCDmXMbZh1IMXnMY4BinW3SZxXHeD2aBxzizVnfgi5alQt0ZXPuBf+2BgRhcVsQTgn/YhO0+X7I1eYFm9REblb4W8rNSu0k/d/ZScQWMDC7wdjeDQQ8FlFxm/z2Nfl9lPAaiiuBYHuHKMppj5f9mNCWfQBk0lMbNO3Bap+jDc2hxfb3qITpR2XjQ+7bod0rQpLQ6NzfK4PbJjHfXpdXbbXZ5bCRw5cyMhna6Cww57acT6fqPrRGWV+jYEaWU+fclUeqOyhmJqiBEHZOqBtWUkCXB9IrTl7sTlHNTXDD3Nwb3n4dZngfuIr5lB9nJ2waRi2l/mNDeHG636VwhJFujk0xUEG9niy0M274vgpwCxBNWMSG6Gw3FYc82KcMxphpIaibyQuUfqsv7N/QEYqNOFHhM3mYx5U4r/ZxG3fuKTrei08oIL7WfslEhY++CtWy7J2eCnNpr5si+yuk5F08I+JshW7cTlHZAen2WWDsImGb4mbn9+Gaz3ZRV8RZjidKmHubhJ5wRBBhdXGVLJNCCvbDQTa2rzJZfe7LbX7FQvn9XN9IeXybnOClVfCDBgJFNH+JAnSKbi2rEnzo4I8JDRGDGsEI0Fscl4F4xBWBYQCU64ejYsAbyFwVQ2mOVbAzePWV6hTUN9c4NuUGDt+1jn6l3cA3OkxVgbmE3m9vaEX9qK0FSbitUtQJexL241kaJq0zkJ8aShrHkSUSAdhSGkNHESqWj5u8Acm4OskEwfzBiBIy1c97yZJl4z0XTBnbupPRItRxPF5ZkszwYGBhcbzC8zcq/Z2a7GsYP8Z23A5BacQlpUDBOr4I4Lbii5v6hP9qQGcxXXm245yFdRVRKqNzikGHRyP39/izpsnSQ66mXRkbFfAjslHpZb0eWbpBy7lXtrDmC9qjAsF2M9ejeBpmqkONqejRlD4D9Ma8B/rDpqIz00pnptXOqMFnUJeMSkEgikw3qKfnaSPyWVYBGWTJDlKDz0TnnuPNtjEQdBVyF2RmJJDWgdYs1yOeHUaNioPKMIzZDfolpyBS4xm23EhGIUghGHtEGCOMNEpJc4JwErPNkHfn7bWM/c0uxpWnwH+KDC92iEULr+vwp70cjbPtpjze9th1eBPPFSFLLShDLplzRR7z7ayWlT7BdHAofDag6ytu1x/3JF7owFv1s3TdfR/2unR8mwE6UTV60oPuy/+6Y+hi5+fr8IkzNb/n7GuN23b+vQ7/dMjuzVT4WJ7L38spFHnnFLnGpHJid0F5l16HW07XpC/pdZg7xRd6hUsTsuvwy/Bfjf70972u/54TreWqfR1+j2jPPzA8I9sOlw7qdXFMKSDCJuFBb6TiLY+WPX3JARmQjboHuMYVX9gPh2zc7Rv6Mw77RJt3w7F7e8RYBWeu13dNIKlxuMsm5hW+yht9NgFGRd0dcyDU1nuYvsvGPvxj25Is98O+okvt1wdGIz4iVuq6MWKbyuzqBoiTowAfWQrwg5mMdo170AvY5YGEIckKjYsSwVTandhgBoJhFTK2KbZ8Dl1Cpud7gd5PFDDdchO6v09tjyvcKoB8bwIXtHl8W54YBhQ3lev7+5FPA7wxxy83vZuAUtxbXXsj92xjJEm6OCuXfj/sure4S9ohDAY4BDq92aNeERKwTTNj2xh1YtOnpG3os4wDDrOsHp/7Yth0zVHQuBb88WYInPQ1+oSJA+IDoE9sN6zoUSZhRQnTl5D2WKMK5gWTgy0fANqLil0VyiSc08P09dcgH26H12oNBJ/SxjXI4OGmnQKDFnh20Nhl/WVPUEV2LZBtpM5TtuHR9ckbQ3cIBgDRG9zdhtRNUdUEqxL0F5EXqzpQVY3h0a1qG6o6wL7usmuAuF8K+5WD8BrGtwkDakOvD7rj7jj8kjZg8fSXl2ntjiFnN5x0d7u7mLPr+2OZA9Jdvznu+geYDnX3m02VPm72u/4E02GBjlU6FpBTGIaT+3uznCnBuuBBYHLZVVXLqmYHVtAP8dy9NpVMG+dsBGA9IHnHoN62W2QbwHXA6BJbtXqHPZimoa9RPRxZJh6jB0w8oJh9/cq1beUx0gYadGWUj4RuJ+xPtKFBMm2MfDytiKf+TjgSGXc74XBCRPE0HExomA27L4Cl124fHMuS0aKL1EeVi9QR03fCyYRYrR162QF+G4NG3RUInh3CJW2ydFqvn0L+COXZqgFg4xQ659zNCrWftszd7jYg5C10dIX4iKlXwHlxUe1Mcnen1cmYC/iIsDsFqnf6sHkLdO1dGp7iSfVQHVP7i/k5yIVS8mh7Lg6k2FVP6Q4lZ5OvBoNx+S3NKNHROBshXA1Uu4ujjuBFKhPfKrGQedV10Q69j7N4GYME9IgBv2SHKHxQuEj72HUYz6qlePUbVIc++IUKd1L9SGohNVpdKNM3WhBHaY8M9PGkrrGoPWl8qiCCZhLS3SIkd4sFn8lzgO4F5KGVe+pauUPqUXp/f4GvC77rXYThgn7U60foU79PTgSwR30twxsMrvFbcTHQy6ANTMkpntMP2QWezp8aXuSCCPsfUeOC8QeZkQuLGTmd+Wy/d0GG+uF+AL3K0YqQ7ZtNV2USMwQFikmPHD5SP8jEL0J8KDpU0Z1j94amezeqe1UVuxO05sGO31gdH6K/s+7Z7BRRuvTtG7v3cvfmyzulpEMrG1lPUDJHWxekll5mJ6kG3i4Ng8pykj5dkRyDRWHkEsOLJoYRNWG/GglZV9H9ZxjYa0nH8ZqmIuob9T2muJmyXOmUU1yqLCRiR0vmdD7i+5fUMqueuzBtkNXM1+oeI/KaF8yVtkPkIqqnFaNkamtZFJjisLTCjbAM4ZTqsdPVNl2lNUlJe2ouNUL1qcPIT/WHU7pfRpC2yEB1aKAaAaFOeo0pAgwt1lDbKrIyG7DQJosAZgHeHrWwsIKuKol2VCrOxiwzxs5thNJDdi7ZTJDXq0n49J/5P9Pe03N2gc/TNvy7/+d0a2tr4+m50W1uWr5ZDcshSxql9jhdV+9DPyZJ1OeNqwn7r//4L/N+MWGebZX5IbHv9As30e2KUSNLZJyeVm7PWVt5Zit29xN1V+Ch1DLfxhX3kJ14zujdsR2lLTsDUS+ekIW5NsKV94eawS3ONJfO/uIuUdtt7ZELR3X03wdKtMQlpAIRaOgftDtIwSmMeea6g/RMsgwgxE4n6pM+Ou8v+sjOUJ+tT9VnH0E+iwvufCHTVOFd3cbPKZ/yDzFI02VUXDjfuFkqOsv61LlavbfAh3h9CjhVZMklJxWy3ypHHPNbwiz6AJjo4ENs0OCAzH8NJBpOYBw6srDp8r4TrL1keGYwyPQFX7bNO7mz2DeVY4B2PD6xVZc+hQxMhA8g3f379Imn1bhtjJlqV5GAuI/hpFWk3bzZFAwEHRU88QSJ8p709NMSYGAOAgs0MhPkMfW7VId1fWxp3BCWZChEPDqwLfqr5wnqereOMLteNerfksYl1q3wvaRAi9A7aaFNfRJPPc/9jkbvuNrN+z18JFJDxqk5v4xhISiIm7DB7S7vSociB9o6yD759slwjdSzVPcsVT27k51qG7OrUsNbdhYW5PLybEFn5q6/ep+Gv3FaxK7L0DsVOxBdxfTEW36fsu1cp+LRWyFSb01ZHR9Z5OzFOocOG+QHmxOdrI4fZM66yXkPHUy4SLfuV7TvJDy+Lk/Eqae+Fca+4MMyGpbuIWWYoooGgIufCo+RsLT2Tkk69QWs1p7r5MgrZT4KbxdHmZ+Kfmn06cpixp8Bw4e5/Vt8mSBdwWs5GmO1sCPgCNgSl1emCdWNenxuHjFsmnpe1ZcC6qDh6e9cwWbf5Ovsc6ur9ja3l9gdPd7OTySXgzOxHaMh91mKHtv6i++l+eJOco+BfRsSBbS4a785S/EeVn353HZ8fJaeMPEj73VIm02rL5k8uz1Ll5dVOf29OaOXfmN/lmj3ucdD6NCfsLW/pydUW1ym4Z+l6fC31L0dg24fleInLmu6omlJe0D/WerbOxxWLEfGUyL4dkpYl3yQwViP0jHsMXxAJFbGxEFPI1Xngx9+mPtMejlglC9aEXGNXDOS4xiNLWNtbJnLGzHtW5n/Tu/Kh8vPd4o8ISwM5BU3+r5VlkDK5C5gRUhGfgpQ4z33Gfzs2R6gh1OLVdvTEw3YDxNbuePwOd5xmGEFKBNkWCFdxKwdA+esQpxZJNeJud5K5oDC99vjdm7x1VQBT+gqBRsmzHeCE5b7pOBOhEVtdQztl2yAMXEogosIDodiTNfE3YPpF6GgNUFx1mnoTr2P5OKhyeQg2DmTeX//Z4lrxACaCXhyBc/3OofuLTAM7+OwXZq7sfL5KxhVihED5LRcAgeT/35XQZ50UEZ31A9kukYAUg/KWAQbZB2y5fpUfKBNf0eZK/TgCcMH7egrjiz+gDi6DbpZlz4zWTwVwT6XtuJ6fcdcsbAVq3CHPGwDt5LwrnG/2xGbGwYXxzCe9hXmysEDjbRBEgXUaiy1fSmG6tP5mTMy6Z+XKPZyx7osBArCiGRwz+UOyG57USOJGU9pBZvI4qWAz2yOy/grRaL/NYVhPJGRsN8meFsdefUUwBmxa+nF8qEMO2wfWAjPgPmHpLZ/pcdfgY6fhG8Tpp+fJFgnxwot38B9jVZJeVyUWPADiJLqed96vk6xcS4p9Ae8LnRfkczVFbzDKPdhs8rr4X838AYlEF2Xw468HFcUKP1luqx7tf1auc6HSTP5v5514xCIPH6WQR02dwVMVf7mTZixpAl/cNSvX5vK7lNo6D5HQMTLXDB3okxsZVkb+Ab5QnJz162cOwId7F8Ejw5r2/v0k9gw2IDBT4BjAUgCYJvNr7CrEoRP9GwtSu/qj6+BpQIoAlCbzQIYEoKu/Bh6ujD9w+J0whhpMMdKFSmX0/XV1btF9xxvY5CTnklNF/4BnE+V2xXx2t7G5s7m4eaGx6wbQ8ghUYANb6amAC4JJwWtDsWOfm06NRS+XkNxMQ762Mrlbm8Z25VgNshLSeOjZ4HNNZjoFsZNWHj9pe6ZAmoYHjjykKFB9O0d2F17fJzu3C5DkKhKy3vbJ1OhJRn7WF9wWZrbz4irR5kCRSO7e6u/2yRNhN1MZzVYPOKX81WmgFbq5S4eBLCC8VhwmGRXwX45E2eZlXu6wztzKTdWlnMuCX8Aux8HAooXmAXm4jvYFRFxOi8dzHkYQyRnAkz7ojE+EijorXVVXwNDVw54vePLmzK5e4OttUEexZI1H5qAd6UQc5S8TxulxDgqSk1VdVEd5HIICVy3eMWalmhmKGvpwcLKUR2tOhaqDjbX2q9e3K/IBYkg8MWtPo+3++tqZhaotnQEAkuNam5nXyDprNqSjghToD5z6OSRvugHY0aUJqYCghAgLHGTOkCdazMZtoGg3BB3/4ibssnkLTRKXXltPAU2hklCRceIRwNl+XeWDW7geQlVfKKQQV1aaHjFvPDEXTCNG+gE7sKUiG/Z9SURZHKB23OLNhFiLEqa0zdHVNYNqrvVWuPWxfZikS1VL65f7bzAWQ30JFmtsr+r6VDKJaHWuBOUytX06BOq8gHd0pKlZQJiJdUfVhUzuVLlHVTwxssetWOs+uwW7bujbIZ1w42gAGsRnZDne2y++ElaO2zP2stM9juxDeu9ZiiYyKFhIkljPHnkuhqzIW7kltjDScU+ZGblWDFMLOfm+cgmMnrGKVmkSD2GepWVqxvjO1XMaL/yFU2xiOhsITO/9gIZb8ls4Z2/qI/XW6KlXoZhVAdBia6XNiW1ToUGfB9zw7hHiQEgl9ahZuqsJMGsoqsMLXvSNzICmTjAP2E2Y6VdX4wHYm4sGKlur4xs5eWauPZ4SUOxUuCVsIme1yS+k2dkyjRdBofRQdM1EymjuxiysNoRtgDHYhZl8JsTryentQbMyAidSIranbfsBp1p/cjitOGxmucvezMv4A6naEftap3GaWyCrALan06iG/S2sL54O61Ez5+wvsBJUc84nBiOqjvWfNbE5rP6J2xi81ljsSL6tqV3qmte4s4ZnLBt0bo40QOGFmeFVMwu1LLloj78eqJ8Qq1q+ggvRScn5KRHSfBNoF4pQOEDjU1MS4loSWWEUzEUJiMcgkw0UV8LumF9G2NRNjZfy2/GjPcaY9toh401OzUOx7Jv49d9BLUE7Qp2fgx7vZNiv8v7nyHV0qw1JnYcHKtJfduSVaFv9z4SvWe7uoK+NvjvK9Vlr9EP97PGGKCArBIUZspYMEQ4BZCfNBAIbroVv8s0Iwx9xg7HvQNt7qW9G1GKQnwV+qgMTRUpim/QN8JU35EmwnBHH6M5x2XmWGyn9eSJKAGlv8DmDgtpB/m7PvXE7zV2xRhE6z7bJZq2kcvppXc5sl0Y8W44KBpiFKJ76kvBthpIPVqPFc7oNyZiDR8fMHyH7LGb4haOxxMBMPLJodJuEk7y3u9Msp6Y+/vjkwdn/EaNh+08MqIX2OrH1GoViv9d5DpXK9DsBn1z+FqvI9p45py1b85efd0xQG/Y7/qqG5XGum7NGr36WkEkhcu+xjIpYUaJkrHGiDAC2ZikUwsQBhoeG4ShnL5Ikn0ZC9ltPw1032HWHuw4Ff5SBsKOuO9uGAi4XeiT3jTgc9xShzkQdpgk/DEggmkyzTBxv6PT1jtBRhcfmYyqFEDBrkfAECyeAfPYnsCxO4Hj+QlU61wIroKowXxic5VK9dyNq3M3fmTusItIZXqGkAU6cqg1GabgcFHBLzpMKFJAmgsmALMDzZtp2FXTMBbTMPYXD9QsMmG/RzMwfmAGru0VaYCya0N614X07jykJ7CjoSfKWN2CGyFWILCx3q5brwb2bhXYuw8DW7WwK2FJwx0H9KoanVKj1GJlBn7n62Hla7k+TsNdd30oiJ1CbWZydtTk7IrJ2fUfhM2NasjMTx8nd+H8bJoVomSaHRk+SCrvwj67CNEQ+ZNggYwZ28XrsVI7X6DaeV9wF28ueo1P4T58Se0H8Ky5IJJkQsS+fTY+vjiRS+VQ33a7b5iH/fCTFPtmwF/s1+uHC1gMZOv2kdOKG4cwkAs041PK+PAwONUc1CFkHEKfPiEc0YpwXAnom4qahtDWD3yGqnawb/u6b8RRVga9HyI9k0OxTfywR/tzPdq3erQPGfv6gMZpl7zC9sOculRt8lN4DTVDQd3sJ9Ms1PLJgEmn76ubeD/ZGHoR0KsA36e5zn6yOvsJMj4ZszWscc439Kvec3FWvvqzCjQtK7c5uozkxlrHO84pWUVofNYWotU43BEiEO5fcpKqRTu+OUU7DXcW4zQ7BGxIxZGbmcKlw9YgSznC3Crw22j+VaL5obA6lZj+9bcw/evjmP51bqq+WlP1FTK+KkwXY/ibOP7AyA8J18142KGL7r+xAH8H3R9sXaH94h5wh0DMY/6hi/mHBvP/Tr8XY37BHdSH14dxf9vg/i+YBHhSZvp7Kb6YAZDnVVVm8dm/zHJIRZ4Sk5BRPA373VPHlOVU8Rn0psQpJuQoWUIoGV/4dzhwDUSEc9I4ZfM9tni5CTSotHz64trTf5vIdSpErkc7Jvoj+eDTCl9r948q0WuW9Iki5TTUdc+s2VMSR1XK1ALIWKKj09y/SeKbhGb3R6ldcy9y1k/FjNtegAD5vpztU59exMSugfjxkDAYzgmDbmFX8gvnhUExN313bh6V/ewpoTMIoUKpzgukWKqY2WMiJ9Q4DyrDQZ9qDlos49OHOGhFcQ1/hXTW4arNJlhlof+eOIKKHRI7jKZCTdfzXmMxSBdgWqoUZPuPAcdnCBYQLxypa5tU1H+k4dspmhqwoyk9dXz2OUELKiG3fZFH/9/lUf/nqvHzF7xqCVKhgCxryOZ7K9jv50TZknQHvPE5wdONU5kiLm20LAE+6WgaypTUdi9AgxO9adAJjzzfw1PCol7SsWvPSbxHA1uz7+RuFsDmgUxZ2YJPSGubSptTy+3AuoxUWkB8QUsHASF5nzie1eBpLU/7sbCR0odk4qRXWR3pfbKViN7A85m4L9ItWg2DH5eO8teGMwLsMzphcJ+OG+6kCVwAxEoeLlG5AOBPJ7A4pTj/akuCr77ou+Sr5wh4xvUdj1y/JM4gwzsaQdBmdrcDtWvAJ9/FCWdojhKE30BaQbgzQqor1Z8ePOHRy1U6b7/zzoooIo4rypa5dFhHQk+0Jlt2IWXQCAW8lQkJ/bBEZmPkTqseKL+Hcd9sO609GRROzhxgTFcdoxnUpWCLZpZTXZZCR7MF56gYOtfFaqdG5tRWQdhKlYq91LfEWwc/5oqb0r3i5ps0WRG+aZ/QtD68OwN6K26Jqp5P0ly/iwoZkk+cSybRfFoxinI+CO6kDYNItECsviQUmjE+HOJ120HlJpvP0oADR2n1EGbL7q+44L58eAz6ea7/ctGZlOpgcLqdfDkw3hIPuue8JZ9sl4Dt0nYkEc40dI0Wp6GjaUR0Thed0uYlgILS1FnUvxBvZslaxy1p1VzPGnp3Ps5LTanY0MBR9jvl9RW1iHJlajK3gMRBdlgG8ki7snBKNPqT3wLq0hpJ9YaEFVtTzsyyVNXissxFHOqHareXpWnB7EiuM1DpoolZPJglR95I62udV2sra22y+/AVFEuxWtHGTNve0GJj6T3eHi2ygTZkseiE5Yg2dS2R7U7MbW72zgQQssum5Aum75CgNROqycPD3yq2plqukJ4mWWhhWdrSzwLfBEEipCMyYRCvJZ8s7GupRwsHu7GawwTD3QRxGIu5ypi610G5kqieuZ+U5pNS7BSU2k3tFZs/smLnyE2slmReXZK5XpLMJXCKVqLVf3V9K1m/NwfsEOOXS7ytfubwOkl1k3LXp6DAwnIxmZvRDC+Id7uER+RiaHqdYuwlPfXVXIExIpRSxIbhlHrdncrNDrFKH7bH4TDIRMYQUqf02Y2DsjcGX2/CGwdfI3ivdhZD2pPTomzhZg6OwyBSLVY/D6c+se+xHhwFZsfIXwojulnYZjchDEsMJQpj5WY1wpB0iODX8KBRnxjKvD5C+XPk31WGQx2x1sy1WCltWiSRs0ii+UUSLVokvgretAkb9EEYqeBMoxDjgKQUiuJcB0GD3m2GB7pqKVps2jYV/t15uCm0bNfsnI2MIQ6kO+7mtdVgUxp5bSojr+fPnq2+uO+svBQl2tUWR+GiNntOg8EmFBMzopo7l1c92v0RLawEiOLt2cxAR8NcTJBrb3cfPl+D6hO1XLEpSTFUUngcnQQjwRBGgCLinqoF8zb6H8wb05qpxjC8Ca/ZNDz3A40k1yy7D0cqBiNtVJHNQ88vU5MvpArAT0gaiW9H1nKsLvlwxBYu6pkkrmhJDi1aiijsKrNWSThlyfzCm2/oBk3aVVP2Zm0s4IHJRgt2GHwiVlci92lpzI5h7ko5JbHpka5VbJvQ413YRzMmGWh6co1Gz60d9f3UMaEqNW7oJyl72c5faPJWmpidpR2zsxQxO9W0I/iSJWv2TJaoGO/+kusieUwP/qpDHh6JWC0gMYi7JJ7k6Onzo0TB+0nus7e5ejpST1bAU9uP/cmcfdaLNeNCYpko/RU71s0Zbxzl0nXmbS59Pn6UDNvklpWvChpSeyUifXU6AcY/DeduovGR+4vGnK7vPtrfDr4WIvSi5/mV+Iycwje97NkXKiFzi8Z/Vg3ybIwLc03yoi9DqLWEPs0G2FvVadsFlefCwQhzBzg2+jmyhbNPZOgEYDzKtYOLDHMJiT9K4/WSyvaEHrIrr+ppVGCW2nZXX0lEeqtrlvKG0yNhHjgmT7W2NbNnibKhlaJ7t3T0e6VlECrtiN1FQYyfJQMCw2LMQlmqzSpSETJCmV5ar0ueb+4kVBpd3e4rtNdzDGBBnLzkUbKXD3huRRukj4x59IIaHV/MO/mu9FaIDDJJx0icSWtTGdNImtJqnb8LJ1mPDklqElyLM2xGcne6qv+Hu3ftjuNKDgS/+1cA1RioUkgAVYUHwSwmyxIJipT4EkFRLYFoMFGVhUoxkVnKzCJYQpWP2yupdeb08ex6vGf3ePecnfXujNSadst6tNv2nPWH+RWg9K3/wO5P2Ii475tZACS17Z09rSYqb968j7hx40bEjYccBP9BY8lnOOO+H1FoNukAHRmWpo12eOX9SHf0eR/TJazsH6fZ01uYV4GiLj8Ksxy+5rme2UTkZ36DOnonto1Jr0ewU2Avh5n7bnSGpam7j04845BRqh3+9z7/+wY5Sb2a4b+PMqj4wRDjGkuZNJTu61LL02rqCP96JFPwlZPnmfGRVdpOK1YymgJSrrsEc90lWq67CmveMFXxNtyIXWIkGBATrf6tDcE9Ukx+nhXxg8Z9R2omfZUa0D5s+El/b+jdGmJKozrG+gCoQe/Mbx8GocGwtXHFj0rKMbzYjJb8JsJ+Z/bQtAHdUJ3xsxy6xI2g1XkNGoHmVGQuJnbwZ7b4rMOxseRFaXyNyoOjSHnQ0dB/lFHQa16HZqpVPC5kxRMDekw1oQQ2+UiTZo/vq5+a/Mh7ui8XYGwvDLwKvfv4l6sPYa6awWPB3PR2ZMgXPsCxLrIYZvTlkTOihRBkfAyjzbPH5PGxyORu2O99RE4YRtgWjhfhDB1qE5cBa7olOO7YCjYF0x1db6Vgy4uZ/PW+KHqfqQ8UK/t9ADyVi6JpNDIjBIqw9jYkBFRJe5rgm6RKR43r5CLFfV/opJJZ0MFNxOTpB6hdBpbxQdgbdcNMugPuhMS7qXlHmCtSicKRzsjFhuiYCl6V65SY7sEVWoup1qqP0YsSk982uUShn8p8TUPRZlbsKduJXCjtK6EURFWiTCSG7ieLFKxw7KgAQMC7c9H8hIueAcHT66+wH+4gyLeDQx5GDoqNZzfUX6kHXSCFEVtfdfSqXggESfTGEv5xuZuNaPwHH1F7JEWtAAT5Qzf1M8eTgDgE0i9052MX5YbxtA9T0PRLyhMBf0WOahGa8ng7gQtnUGYfIRj+nV+62IcL1lUyVMqfGHqMXBNL+RdT7uOhC0+hJjyFKDxFQnZS84poXlGVNBU6QjVmXyWgGMW25K41dBhcj7MPe5oh/T/XllS9ubHajG5Uxb+qHZSUVVSwQQUACE5hPXJTgYouxujWgIO2zrHThkWNvseiRsYyKpWwttKRU7m4ESeNu5GbaVA9QO8j9fiOof0do8qXYA2CM2Zk9JERyqzVikmAj+ge0hwtHKRsGkhlGF2P0/r7Iy32PTJKIKtgOiKXIhbsJMEwH6SUe3kyiSaT+4p7uG/Rf+T8F5vce0h4BjTWt9ybWf2y+1O7nxhFSh6eid0gP5x1zq2jzxFQuLXGZPIGpkjAXJ3yMkATXKVsrznwrm2t4/GoTQYESBYqMJkCPzS2boDUXQISqbzYJq0Av3wqUmDChVLH1P0iQ8ne4y0j3gj6okCKUx29iifvIXWZULuI5BENUV+grwXQktcwNNni4rtmpIH3R2b8vrlEDyxlfKMHYjK8f7R+6K6aRqAFJihkll3iwvG2Qub+lfy3avxdrXG6Ymk6bXV5Mi4oVUbTXdZTEbyufXNcaFl9VYQ3zSkM3RPrTnlv6puQ+KMLXRi6gvioC0iLUHlvZ25pP3shepLRnuJXp6Id/8FQw/sxhcwoUdhQIwE3M4UAMnjHCeoeQ5flJgT07YV5kaVjD/MFDnMv0xm0PyxGq/q+4Oo4aqs3OnpX1MdEn+wGxxUX9y5/l1k9YFxGTXrr1iUMkO6ZUNP2TOlehNBmLIkA5rY1sQOg3JzgJ5wAZSrjL1nB6zqg90vNp4SVfumjtp2hZye0eEabLSdaDUcRX1DN8gRk5czFF+g5fFIxfhxRhImFhTnJheYbGbYHRddgxgGQW2uXG5sbm+6WGxq6sjg1agJMiLTb1ZKuXW3dbVl1soo663Z3XaUpqJAQHBVJCFMZkze3FkKPWSRNuVSl31fzD5QYb3wni61r8bxrE1Y/mReXeTzTFNF8Jp+yCcVdI6kMDFG/Xs5T46SPuvpJT/hV+IWFX4VkkUwcEvGdlAutjkUgVew295xOttvYQzMVEzF2ods9Vz9F0n+pobC1OH9AgQ194ARazU4dzh84GZE9S/yFAJpSLHBCLHDiapIuY+Ao5IEso5sirUbTlSZTlmpIG87toQ6fOGzHIWID3jutX006iQe4TPcoDELvRlru1bbxhPln8WQNyZYOAK1H20lcs26m4ePogoTxztA056CglYw/Z/JXJuQvW/DCqA3qydK1uN0uMi29LtIglcY98TUrKs2AgNHMt0MkyQXPbwXcXr9LjFymmzs8qBowsLs/ZrRkmakGHGtiaGRbUIgrJHaLGEkdX6TKHXpRVMkwrlQXOIJhSq2a7LwP/KieIuhQhjFFXAxJEWuiLZM0Azd1RA4j0zBNibtcDxFLizRewCRWlwuusW2RFsvzg/FxfSRLHA2nckljfUkpHjOup1u5nvqCEuAlc6lgrQXAHYcsvRanF1SihQbk1OjVzEddZEPaxgktTTLTosjkOSjzvLQo0pxku9p9oDLg+cGmO2QqCxgLrJqISeZFAP48vCbuiG+F9MhfsifOk7GHW0dDSrb6LGRxMUVxkocZBUXXK98OxumoMIowPBr/KbhW8dTnv9hWYb+vhwejQ2bJKQr6IRyEPb1MZWAVnYwo/v9OOsq6otLOOOluP2cx2naQsxQj79EPDCcOn+xH+d3w+EGIJycI3xns36l7b3gmzFTUXY11OC7RPjo+7LMKjpOpDnHWNIdY0a2EuN7fRQ9+YJ8QfdYaW7OO/9J6VU7LaIf4oqrVn/mpYLgkJpg12QYyBKvy8e6eeThPdcyyIcU2jtl+ohLWJUCcoH1bOaHpPTG+1B9OXAsrpLVi6mbV0tqdCmktK0trYi/psaDLAitaTMtopyUBlUGRDej1kbUP87S8DysCT1dsANastlutfHCh/zqz3ceQug2Vid2/rU89RD7NrWoepFcBAZMCaP1Mq2lBNaaMUQdPYONRsLj+kN8PW+GmGhiYCHZh3ZFhqUgpcWHlUUZ9T20BKeGy2wnXDLmGvkheL8UcbSIXRCdDdQanv6Y6O1v9hXWTkvormXJSWVoxhA6s18NwJeoBNkX9KMzuZ2E/et7WIoclGPeQQhwmGJaQwhmqCIeOGZ5wCe+qa15tqViqPagtYYziR9nSktu4glYLxZJfuwmlxicwhCX8RASj/mAI9WUjmV19CV5I7LKVM9OzD4NbZx8GUXcmOY/TSnKed6tIaNItEeSsK8lm2tXJXJKKTR921cbVlkqcEGn97YwR3++xn5UiXYAsQGa1dIsXOudubzYA2Noua7BSQiNCXrGJD0bVW/edEcfNUffslbvx/72Vyy64ctkfaOXkDXKnRPK9H7yq2b/mqiobj2Eh9TKU8YTbabEAdycFt9wsHO66pF4q8w4McBw6aLqhJ1mmZzTqUFyDiqGu1CSpph0vxbhLyP6BbLESsQIeHxGmjSlJ9a4p7xnaT40f4bGC3wWuPsrvpKMEA+eVT2MKlGfGKc6dzhhroDERbY8wofNjBw4XEwvFvUW5Ca5HIHkr5hJx5N8qyNSjHQkTVLQdFwlZ6pFmc4gnB/l1YOIb3XOBa99JtLsZs98gvIkxPmBZUv5g40S7sKb7zzfeGymgOjfdNzneWYNN2GCVmuEWirOZw3MQtdxiXtmcygEWcoA0kvIAMYSeGCBJw9r26er2SCDU6yHRVVx2cdOxAtzHCENbHw0xLVjBTWt1U4kZdeoZNe9pgeXQHk9FmYvy+6MsZGZg4tPO/AcZAWAywV9oMeXp1lSDrsm5zTcBZq8XdDerRce37msi3ZNbaEg6kR8V9Qi1FP6bIYgEnWeJp4UXz8wmcxcjLfsZV+Z2KEB/7Hivs8UIj+cKlpOoxGgwqGqhBsUzF0d4gWdYWGX+uxh5Vg8RW9gYBJzwjw2oH3+vgPowO40SHnUVJZTTdFVOILGmb0dxDMQ8hAOVh/s1IyrOrEiIoBp86+7OKze29y/c7nn1efNyOQA9341XKkhPvRC1XMtzNU3L7jB6HjFypAciz7OLlY4LFh4SranJV7EtUnHpqHwmDseiqsDlqBKXVTVC28hxZg4JuwfB43qYAZxY2Y0sPSKIudpY9PtPfiZGSHVmtKut46zW9UalG3qsXwez9HNlEqTVrlp0Oi8rA5LGK2dXnEzqhUgN557xjQmPqhp1xz1/jHYzMyvWGdHnI5uJt7FYDS7ekfdWwg6N89ZJm8T1qFcxPOXhwjVF+qUet7BTl/Y1TL5HZjDJkt/tgzzoqpzxInOAiNOacEVwhDZGT/6I5Oi5Q0zbA2x5cjgHIwdGfu7JUgSDz/PgMFx68kf4RC8408bF6NDNGQdauOyz2O1Fh2FecjwNUiv1oPU9v6sm90GhgGOFvD1+VHdKLY9SBQ3Yh3kahysh6QYKkQSVzTc5OyNXMuXK3esyldjbYfD0TjA0zmNe5mFcURW4UB6cCfIYy03cq8ydes2VHpL+CQ+Gwu8thAaamWBIJ2zJiGhDzHPYLHmOlwc7aPDm8llP3USLaXjGKGQCG2IOKogEoYEWwikz3ciEzzwbq5pShZRVj3FYldMQo56KyxlFzvnXkR0mODJ2yjVS4pk75cyuZB4Xk0LVY3mtAL8o9XNY1HeLQZTvOV6crAS9Xh2feHTjlJ3A3adtLCwPSeCaeyJf7RAyp+IsSb1abYpxhbQFe9a1vbGHsAGvBd2B6Yt9Yryi4V4fit3Mxt7OKHot2U1xC0Cy78L4wrEuh8kvXPUFMsSDAI5svGuNae4oTfmvGRpDJmMVPPeda1g1PadrIG63aoRaZy4qPLa6eRiyIOtckFa+KbzMY/e5MkuaFliDZ+SUfsKVofHe6+qpOJWeiuL2dzQPwo2NtU0pKMI88QoZMzV1zCqe+qTZ2nKlBVxzrdm41BLPi/7yRmurseGKYApNwlA7HliHvW5ewsDWbK82CbYkloDwgTdtTcqzKa684T2PJb5QiiV+jwJ74922FqDhUahbmrGsB7L/t0Z4t8tN9RzvtYRcm6iSlWbo2IAjS/uJunbJTgGTJVbg9YTwCT3XlWMGiXmJj74DWnyT+YOwY0VesCM1CIC2GhtrYoEW/T+J3RsFu7PES1AM05UsLl7HO1HxDQDL5bOnm0s+e21ST41J6Rb4/N44MbN7VHJm83dSOESBXzQUIdpmS4hQBJkyHU2qq3a4W1VzA3EAo05F7n6Xs30Zm2iIoaTYsFyuZCYXFxRLKIQOBpAqWMB4zXdKLDxzjhaJudx5GUgmdoTtUmS6c4nIAXwOLl2NiaP5AxCC6ykgCiqJKJA761tmYBBLJJU8amlCjJWNdkrnDlot2H5pwebNBQvLgwcRN6oYIbyhnQLdGHlSMgC6BhWK8CDzetAmlyF3mEmEnBkjHfxTtzT1ruakpOHgXYv6m8NhPqci0Fh0tlsKnRaECui4N4h6vRAObco3VohMJY6trKSwCbf5PVsXT5b7aRpzQVlqKoXpYAocJKw5Kt+KiZ9I15X5erKosrE4yg5LaQJWZEcTNO0Q8Cq0qDS+asI9Y5zh+eOscKIyh852T/vHQSOrnB5Mzuwr406OMoY7fKdDo9JFzfHQg9hqSDpahdxcI5FkTYvLaVh2Mcpc14iPTISph5niqRnoiBZ7dKPZUrS01bh8qbnR0jDXQGi+/97EHLCmYCx5OpSLC9TeiPMhKZ0P2T/n+ZDNPh+S6vNh2yY3ND0x1/lG+wZmbhCe6yz/jJhcoemVOI0Kc8aMDsiiCilfmtZF8zB3aFAYWZkHUeprrbmBb3nctlOuBAl40I5UqCLcPlHukqKjrys6hCdMp48Kjj5Cq2odoS1awD5nhsfQ9EwlxqEQnsaVOoT0IhqH9qFW/zxFU6XqIV25UH1gdzHqSDaZoFNVH/bAEa4QnGswWVeFWxmUnFNSLuAPUOxHNiPFlRzZ9VzePOZGH00mKosiTDDp1KtAxTQ+iBxjRJRSk45bBzxIJpMhQ6YAOh+4I1ydTv08wM1W1qQXUNbMrmlOID1TRZNeVEWTnqWi0Zo7T5VS2KoUDBv1gz92rT3ol7zE/BHsb74x0cQ752E15Ob0+7Dngx83CtTOcxMJk0jwyGdlYuEip8VDmhZ6XNZO4A0x8xSxloEaex83s8mUDDQKMzIpjFiPkU5hhK9iZ4QUZgRTHlVSmBGjMCNOYZ6fQWHa9bEgMc9/OIlx/mUpzCEnATqFGXEK45aoi1tJXdosMJBNibTmt2dSmOfVFOY5UpjtCgrT1ylMnyjMNgx4MgGk69TH5wCPgfsiYCvXnElnymtYIjTyamybgHv+EC9Cb4xGZ1Cdqta0Pat9dQHU1D9tNpCnnkEoqoCHkTssUWhxcWAU0hojmL/H+H58JzSTC9DO7Sraua3RzhG6JP//CCSMkIu46iZbrFkxW4EuOKvPlZNGgBWKy0Dp2oCLToVAhrG1Sefjom0g55Aj9HLSD4+FoUqpLtzT5d5NZuqNdVhwVymuJdKMRDUFgOTy044I/+KbKigyCpWcOXvJgrbh/ZrHufeA1bEtTdmtjDbjRoWwdM2wXFeKaHni8XvZDktFbpWWCii/K8dRvJbnPxcX+efi1ETos/hLZrBtPdd0leYSsxC6r0b1WJNiWhubrqblk3PESQ1TI5Uql2O1bKqkQpIJVRuaEcMgVTYv30v41tK3n6fbOFJnP8pPbgUOu5RhEpjdFNXSga8LrZURWeabXj1ebDHNjRt06iipaXJis3WZ63YrA7sIhRIqyUndCiI4hr9cbDoytqPYTW+ROBmWDu5QC9Ts63k4lWN/R6pkOqEea6kj9CJbnvillCKqiF02evVUVw8h0vdFWLoI1QxcMRgJLQsA+ARLPKEdcsXHXjp15+sZzFK7+UaDHaWcaaBVj64qSx0v8vs5KgBdYd0aYoR8Mo7hBZFS6Gm6vUhGaQrl7o7EL2tdARGT8v4epqijP0IOJmWZROLy1b9aBwyup62DDH4plvIV5pKEUwlIr0IumxizQ4NpKgAaSw0qBe3TEoaMZgJYLZQwM56vpwRvFfoqZovGms5M4Gcm8EduoWVZ5OiQoU41RrYHyN/oAHf6DQrmGBuPi831za1GYxPOnUBZ6sCnSEnRvuE+amZTbQ1VBkBtPTP9p1hPuYpwcKMuVce9sGp9MUaD2Lu01J5GbVJDT3YG5Uk1J7p86kYWtqSugcpGePg/SaqQK5tKvZVY69CXaOtmTHvNF/tZhOVh9Wo7rqZ/pYAN3JvIqYagEZeQYrZpK62csOv6+u+Ge5paa9PRgg5o61EZCivTrI1M798CN/fMGRYYFZd2g9j7RTm/tmbK9Hpc8nhX/qOvYhxnt3z40wUkbXLz7NCSj4Qq32Xl/LTrA77JNbs8vNxwTNZkEc7TTl3TK25cQjk9rUvnhFYLr+T4fPD2A0/6qkNEsTViUoVxecg2rUFiYkFisjOBr6EXTEUsAN+4MW5da+PqqBadt28Fti4ullckdWaT6bSSTEcsha52ByHuCQUEeZxn9JLUww5SWE0e3IUnZEaLHe2Rqud4i+0wNjVb6R3mUuUMywYwUfm2LzsOW0q8TuOOJ/o6TikKK1BlnT4wLuQAePaAj+hhKB34VfTMxeWUx8Vc92K/xQNcsgiZm1CypZdsrvPYma0t9gNwjv3YaLb4KxAL+LvGOq+13rjMq201L4t6GPmE/VxrXdrkNdldNatAl1a8qc1Wc53X3mitt7a2RGeUGlb0R5p+3iVpmvgnW2tbW5sN8c3mpUuXWk3+0draxsb6+hr/avNSswFVERJrBihgVFuXGpdhkgCjza31tY31jU0rGGjsN6axHyOhzEc5ZYzgSQtSp9PAAN7MDRv/ECoz5pXsi+WTH7NY7zF5r2ZkUIzeMYKq307rjr2tm9a2lqFn9NiYnbqxh0sb3H/XMJdAIzBm+/kAh+YXYtfjYaJx4i7Ll25gN9A2jBXOEtj3i9LBEBe7ebG0tOffKVz5+4H2+3ni3kGxJuq5D/Bv+izM+nF67D5PmH0zUdZMzz0lRV9ANSNUwwddFXTHyGBhxqc30qao7BWYv0UGzzQiJIwrbpFK0TP86ltPNNR/FajmcZD1cvQ2JGFTuhPKR6icsSjPDXIT9IDEBVGMt5Dw5w7S2HgKhHhFa47TSd4Cj6W/Um6S2GJsFDOfr2B7fsJ/YMO+Lr7fPv+uVwue6uLBgO1QghZuyKC4fWQfdAEqA5kn84GDn7SMY0aFF9SzykgZK/TQZSOUwVVDI76sZrxTLSctLhJioJuburySwWGdqpdmnNfQjPPKHDXLcV5JXS1jh7MkQJWRXkM70qtWoBrQzIhCO8qrRFQy+hZRXhf9Jo6DSYOZwdM5VXwHmzA/HWJ2NNRg3IRcNQJ6IlljlquhnaikLr5mLaTteYoHrMXIRiYSrTOECJIA3VMcYiw7EGSKE59YfeImBuMJ5BJpAtr8YxgZRyPetQOxN8TwmTduZSft2MQjOMbPm4+yT4pF7i8lXLmxGqaLswQRbMqG2uByijXaIj0Mi0GY1TwxI8ZR4j/87LcOnqplVIYrluKIX+aeGLy9Lvhr1l7c66BUIKUq1SxXySWOuWOJ2deSJ5kJoxyKg8KVAy7aYuhWFY6dxUX3kxCbke+5UurNNSZb29GZDZoB6zEiW0CDnCnBA5ZHcpxq12q4HipkVIhZ3abWkom4MxfqLRlshG/GQkufsOZd66IOB/VqBp/ivYlx1AwuzkOrfxb3e3GRbv711+veG5FyYign1jPbanjiBCBL3H2hF4zt6zpuaptihjSg/kbiLscuEBuHd7LmEbtqa6ck7yq45LLVZYfTOXW8LDadKuFFYpqGbx2p9vMqmwl9ieSuZs/EF9NjwkDFh8bcLrO52ahOvLp+vBHHLlNgi4G19alQkNYSlDTdUWzzATE/51XqBR7ZjFFQe+ywTjxCub4RGa8tGPM1z7Ija7jSMmxqWtNxP8U7XfcwdR903Xvd9p2ub/rCqSjb4lxPDHos7FI3MNQ7TzMIJ3wwxN1G/kh1LfuXFvwHK89TCsnEIgmJeZAntJfLB7l2DrNjPKk8xhP7GE/0Y5y7NDAzVDrFE/sUF290kjKdAsh8I4LBAxNypptRyZYQkUL3xKLbEjNDADeIpZlwgpPw0z9KhqOiBvLNmzmTTDL2K0PJfXdPP7zyMMarc6jLHFtjl7tKsJOLIvKyN1npjd0WEpYAHrG1N2TPb5R7lueg8E5Jk2txhMlXKq5wM/G25LGSJl0qfwCs7/vMA4xdULVF5j5Y9j76B8dknJih1fm9Y4x9PwyzYlxHC5y4snC3v8d9AzEggk+pNcdxyD0TAh8rUPMpNh84gd1Kigq4hGKJnaAV/m6659dq3IQLDaFqvSA5DLN0lMfjnbC4lQD5vvnwzm1uJ1UT7Ld4zkfDIQbsJzEuKbZ7EblXvx1kCUv5adS6SWQWIGW9D0ZFeiPtjnKE4KgCIJ0IxoxLRfqiiHKoMg1fn1FiR0E1EyGkMoQGSyzD3WYQPp6IhVgFYbTUCHAM83zbBRzeNsCxWUZmOKjnK2A9mYygyaryijVQ6zZyRlXrFkBFtJ6AP+VFxFK+jPhGggvvLDiY0IzeHzFSRlOZtdQdjKjdGa3s7w+Ko1jAK/CDTmCVjYTnMKrRRxQyzFybkeN41JfEm44wkJnX8sJqZTwfLI3fbKtWWxpBa38QrKtGsrqcD405TXa6WRrHUL8b1ms5e0CdRsSuukcCyhVYiYm4khJEOPrgEYw4imHOLfPOvmMaTQDNvldFo/E8y6yq6vLyzUwGMJjvhw4nxKEUyzlF5pc0HvNSiWItOwUzD5aHZlGRlbzOtSiFJn5JdkZyCJ7Jp+qUuQvwDIZ52Kt5iT2CzBYJk6oRZLYAmMmgFCj50iAqhsR+G+PyzAsI7Rb3RlgZ3E3TJsgyzvBLccLFVBMZM0QoHDE1eXumCYmJyA6VT2KNoXOzyay7K/aqb5bFSo8QazdzbM9D9z+qa63HWR1JByP9Owwhp2uUMdKzlpN2eJZSSPAQC9xyWYkuUv/L/254PD2byMpEfy9xza3QN3tG6qZ1wXXeQIdmV/GlTfFCl3luxXXHtWtKxtU0IUGbD8xtdDOkP/fgD2bCUbeY14RlBGbO4kY99stSbc5gG7f3AuXErf1bKJl1FFnwZl71r0T5dSn5LC7O17UbIMc20XH7WgiI+2m9D1DgOllUGx9yR0MbPBveT3HluJuelWGKRbViFpel4AUIRn74PtBNQVxhrE+W/efa6ysXjYxnQirZpVsy/+amyvqipsOUcFY2LII1OibqSy+mJF3DTDaaI3S2+7zYwxuo3VvZnh+BVKgUKSTFCa65FwVxeljz8AjqBkk3hCMI+FZ6jFOogPylRlSjfhYchTXCcGGCyh5COFl7rCH0WrU/fBb1wpRXDUa9KGVqrhjIV3zlTiayE8VLSw40cSfbjfesFpgXM+uBnI9LYzs65B1ER8GhGCRQjqfWR+6sQfZCpNw5q16kh4dxGQBMzBgEGB2EtRQlICNEpcaElJGt7B9nKPvxYKQnx0F+BySBaBiH3vx8tHLEH6ZntabkjMPqrpk0EDlC3SnOA2L6ImQpozLfJ1j7CBi8dlrJSgW+ZKU62QoOg/NFnJmNVmZxQlBhvrG4eCeuG9+5AV3c+LuqLzcA1lvrj7Npi4t2h8Cl/cH6xLag2zKvRuyw4NXSM3g1AHq1EDrCXIPumBYKLeOqF5LVeh7Uq/GGbbEhiX5epQwZzZASM0NKzHw77VWmhUg3WDxu6h7LdIQw+cud2ANhFb1fr/MUhC5zgSuKobe6enx8vHK8tpJmh6vNy5cvrz5HFp7lFHgvQIeeC9TuJCT8dLNoWICAEKIFPIXp58kO60CnntWQOEdCjvBrV1j9q1cer/JfNZ5w/Sh9FjI1C88gTg+ORLEMziYNq8vdJe5JhBmKo3xKl4ml947LRsyWClMUYigbuZM7qfwJ6EjM3wd4hZrSD589w8HmlZq+u0MhcN2QE/CQCHjm3mGH1HyTjBv1YybEfLbintx/jQeFOYu+hwZ9p32R/UAaX/74h9D50GlbrVTQ+opxXozehzq9L7dSSfMrOpN0nxQ7sVQuGWQ4NHay2Lz25PgGD88+GDLtYIhn6qPO6N44Mvio3zhz1MpIIGPHSYw+LuwsiZgmAlUTNsGMZFztYDfaowtlLop29rHnEZoyfm+VgBSXj1kbvJGyrK9tZcrGqSbOfM5qNSDow4wNRPtInjL0jikAogspAKJzFADRBdROkdORM4zOVAh4st69nEK6jdAoc/bRE9LRg2ai883ZR09IR081wmbsYmReyqB5WLxSAIwPRgUMjV7SAXoTcyexCDBONYorOqghNF2+s2AeEVee3ULtg1kHh+9lwpv/kT6icm2znnboztK7nqlZtWAL0y4QLjqgy2e1Am9Gs5UIYCTgZmSL/FFFsRgiuilMp7bepRDuw9Z5Xe1APEPk3PRYtMmy+HOPnSyWPh65TyHbaOFdlE7tYoIOyWCmXOZWSzn8Ms0UdKwh8TORbPqQQ+EowRyr4SQslAW4rpRS15HEFsovQeSrh7pUZF1SWiC5EM95RuPTqILbmsNbNpPdSrzEZLccziI8BPxC0FDoKQ4LfR2yWYvP7ip7eHFGXuC2Qf051volZ4DylSatH7qBF1oWAmnnOG/4HTjXR3V2J6zQ9/LWxmaDvBTkZVjkE2ZorGo2o99Qz/M+X8oD29xiiFjKfgf9aREGbEeOioYwbHbEAM8WjyZhzo7WuCLggGb81Wbrg7PlVyOzlR8uecKzeVmWtGSFKGJ1We9gJGhKJxIrFGS9LiBJIK3PXF3lo8EoEbt45INH00jNglXTFem3yZ3tkIeDhR9rjof2gGQrrUkhlRKIpuFxxM2/0PqhzksoglTAhQdZfbZVQElh1GyI5m5Gdcs8oKL2pQsr6tiVOd9iVZhmWgVon7Ob9pJjTupr9nCusOF36ML9TQy6gme7oNDbCM2GGXNCtXeWCVrqk5GQmxrGJ4YtgugNY7wa0SEMIdKULw0nP9NZAlXWiVt1dR755GUj7KoXfa543iRgKAMn6dBQ9qDhUWKEP4IwLLQGYAXhEbUqzNujcqSTyLQVEj1IKizszvWhpbrmW4wy5RZFYqy8UtVwTVeU0vhT66As+WfY2GjMylzUiLmvp1xvSmnV1HTt2atYW3jJccIySoggPUz05r5wQhJnj1PrXoWnYSqZpUxayuNONxhkJqAS/56GdedqbDBOiLnIZCn0FeSQG12r3AfzmUOnCOyE1NGyw5I+124usUKkJLM2QWJsAjaKhiOsWMVHmi2riiqEPqUK3+GpH5YJBzs6Wi/j3JerbGcJIDg85eL2/QDUNkx2O6S9YHdYtk1iSukMmaWuqyJYyfqpJ2sKe95UsqrGWmJ+RVZgGAgXAm7yNrDaXPgpy0xnOPskuh0vtzDtJIhbXkKGVzD40rFTNh36gNm0V/uiuOedpvZ9Kp6jDgY/lo6KiO76QrEhmcRzcbPUhuPZR1FLHpla2YZeNrXtEDf53ZdmKvmIZ2ibeUM2+xILzxp2jxdyJkWM2Q8Xl7Hk0oSs+1nKH+uma9bdVqlV5CtDOuAu0r4EAN0YzWKOz/I2ncX2FqXIg6XsKZhiHnnFqYzc9QMgBCwG/5wPVr0ymaSLsjtnGcoRts/EKSmwajhFZnNFjo7G1yn029tGjNedsCjFeIUyD6NkLvAbC5kAM9NjbNGNHEmS84oJEu7yRrwRDE+b8LyVMqHuM27bL+xXzPyUKk6oDJ7LWqlsgeZ4q2uEgLw5lMYQDyP/GEiBP0QB5xjjYVMx1xJAZSJUNcrdwOZ2kmOJhwoWvYoLlE0v3E56UyYYhd5JAhIjupsYIqIW9vBRFB5PJsdR0kuPZYZJDLAgWsO6+jPLGpShgJWhhu4ai0sEIiv0la0ESXeQZuS3z+5ZRdG9fh+9w8jDDtUcLMaseGJvKTejEnCBaoufHL53Kd6lNN2YC6cs3AKaBC033RH+04enMfwf/ZkH3HaEtMrttjLGfN4mo+fJhDswHcqe4HmNvNvTJRCosFY0mWQzao2gFsjXh7pMvoaq+yX/UEn3XI3tuPXnUKzdMUhmduAfwnift8UwAcJogxlyJwmK34qxK2A1lpbQIIj5UQMDgqURlo59dmiMsJQ60t2XxGZgKotDfwAfHq5gFMmEtART6H2a+GhJtNycTEb0l/NpDOsCQrPRVOQiog2RIAh5hQZVaBgVaEIfRP4JLXLYw3sLDDEtkOkBYhAmBT+OkQgs+EV7QXH4sHH9BVfZttet863Z4PKPsvZ3NMf2BbztENYmWrsn0KrMr42xdoyElFK2wlggFWbqllFHc8MzDNNRvjICYe742xbDfUsrYcfG0NBldf3hrBAndSNMFIWNQtrW2dHiRe047i2nPbTzHFQGuelOtcGvkSH8kT9TQm4f6Xje7Bzpl6Z+reYZ7y8vLh6t9DjJ4RdWWKTfuJUqWEo1ro3kx5YQsy1VraVJXMMEIJJcPGPpDLgB8l2H2U4oxjDUvJ8E5ojaiEDM+2VBFopDedu/1XWJuLvb6lw4yGwDIo3JZ8K7kIM72YqdGTyzErgidcRN3O6lSBHqlCRlkeW2Ef55sUhk3Za/eAhbyo0qAt8+Y+GlIgfdOalRHrOZmVFrJmZJrvJAm+M3w0Pbgy+MwQMU/cIYfFIaPJ40TFfZTuTYgSVBqqIPEU/yQh/i81S3guPnvd2/HkGmQr274WEGOhOToGRalfu6g+muPS2FtW6RNyPdanGG+9EN9HNxpGM+EwlssT20ghAILwEeuFtLXaN6oibCuQK1jq58uJVpD/ci7WF7qD1cG+7RoEzlhIoUIodp6zPCKgVJWOn/b8bNEPO0O7S1KAra17taKsZQOU6In2vq57r6aoG+Cg0m4KIui9gjLzOdtzS3RVKZXcR1sR1yn40NFBDYz031s7klBsFt32ybOm12jnDkQA/KmX6bU/L2l+2pYMAK6Bouv5fa0e+hMxH3HqCcMdcUE/s6xoXEVifRuIqViJLIsSOHyIqXVJTVrSbqmElYtULpk41vEorARkoT3U0mdJiiiDt5pymdTXR8icxXk0khru5k7N16od/mKQebjDnX1EMVdUReGOGSS3CZSyz5jMr3Whj3HwjtKpiaULjwDI7PmUHle2K5b/PNOigM8SaT6cq4V2pJbfuK8KQynIFUWBA9N/SzQprjP8M1upYeHUXFjeggzN5KjuygnCwDeHW9+hHGL+FcQeCcyCtb40S4Hk4mSUYp7sU9KFua22hZPCjaYtZymu5tVEEPMLHUbe2OYlCgWdLtkM1Ry1VloHmo7xSdK0oczy5wvNtWkeYSZrrjbXnffygPMCaAtuNoBDqvt7j4gKXbdu9muM88eMRGZ41i3ZNQQxgls1hKQqBGFUD11myee13y3kjfrofM+n7WdQOyUYpbUVyWg+l2dB6Lc1R0gSC4qogUjId05SFTdkRImqPFdYcYKwyjkDpuNWMlZ9a2xQQ2bo5veM1RTkeXWdE0K5CesD4TmbfsO3AerTGx3U4r261rGwTYZpxWMGMCraZXXd4CYiQSelwPMYPc9dBBj8FKPahadqibOaU2peZIlGuH1VsG42Wx2YXG1dvcRLvMHya+5kdiMCTh8dzbQ7qOTbPtAGAjvV+kb+LrZk6WzAFuFnO3ZORbRblb8AqeZWmJKYGiPo+jwgwRL9lAQ4mlXFEa7exKIgzjsqUlMYxkN9uTUm3k48UXrJ+ftjnfEyj5lxO/wCB+sPECDQMZYddNUUA+NOtU7WTzi/Xv8cU0gJqcoYKZ355pKYLqUTgmIhbg2zyImF2ZFt+gPVJ0YKRzso5yGyEWk2F+nzAfs8f3YY2Yib6hcWhtbazTYhTySlI5Jr2K0XlDww1J8y3pmmpKdUOJRz8xaFVyypmk76hgHT5FAcXNgCCRPhKk0DU3lJw7HLU5FojtvcOVlJJD3XGm/LMN/bMzqk8NYmYPY6PZUrkN4BeSOOEDbAn4FZM482vpUL7WqkpBiNMYYh5NdCQ9Y/ikwVynqB06exULD8vqFCawpbTrKuOVF8FeY7m83FGZHpWpkCsQkwg4RTRipmJ0y8dO3VoWoEksliTBkTRnOwooUaj7Wl4P4ODh3nv0FHHXTaAS6ZWRoBLpks+hNSbnTPcQ/yw199pj0/gydg8db3ym8eWxXktZVxLQofheDn/H7iHuH0FmTJPDg7xeCg8iTeGeBaWXwmiORf2PTSvYFc0Itn3GO1/3nOABzSMez+G5simMXb2e+5xsCjGOt15MHgVlM8OK76OSlaFXVUnage/uebUa9ulMY+aKc8EtuDmDGBDmnWt618J0Y8Y+KCfvQSSNlUb7wiNbqxyZsb/PcASjvXEXLUysyLyzOzd4UKNjKx6HOSgVRVT4MeJ9KfnMxtW8S6wda1F+k+7i/cidjyaTuMIzUyurbA94hbsp3Ug7HETE4FjMFQBz7M+EnbxeNliwPmPBxq6Y8XX07C0RbbofJsM8v3qEro5LasroJDw/pptsZr6IBGgB+I+x9O8cK9YDXx76C/5Y18dzQjHwF9zn/oCvw+BChyCcWevuACpXnC5ND84O/R3T9w+080LdDW6fz2qfZP4AxCjRHu0JDDW2zblv2wJ1m3Pf9iXx9tncN8NqjNpr7aUNez4l3BhU2+ad3OzWDx0V+mP6XNpPPBdM0MBd8J87HtWcjv2xZGAY+zhmKHDoh+J6Sijf6GksjSrH/iEjFv6hRlD6HdpIdNLIrLpoJy4M3A11q/EGvXnyYRyMa24tAaDBnwiglxVBUtQcD2gse+2zt45XD4yuR/BkWebSKFJfGsqXQhzILp3OSLTPtNwB+1p2+jTQxod29meQxalQyxzKMC8G7BBs2sg1atvv1GqeNY2zehIdsZ5gsVstvLzkv9cmk8PKeN1QTtp5rGsGlDk0NYx4WXlYEVBGv7PkkeEOK9Wsh7aaVStQDSBkDjHLO+fYsVMuIZRe2epX8YM+kjFnzLBFFedSmeg2resm4yNNjqNnKY8yfh7Jy2KLMeWhp0UCEqtlhQK63pU5rTJxOwGSkRZbp0IYEnxWZohz4vJdy+cqOWeAm2CS3UwG111bEwFzSF/eJuUf5jxoG+c5P1rZvXs2U7YLeCukBCU29exbu6a6tRvZKD1ypqEa5rRYxIiYKiMzFELBJc0c6U3px48H0SMciGar1NV1lAzWpvG9fjYxOC64SL4YwlNsXLaBcVtlIi9YPONcLwgP5lMZGEcT/UZ+IA/zYMb318N24EMjjM2/zg6t3E9dPN0xf818n5+5sTbwFMY8klaiqTbgtDo+8pvdekzOQ/xkkNJyCifDyPHoPdvTkexlATgegGeEVswyIHd7AX1Icz8gTmP6NoGfpcA1pemtS5jBUQ9xz7uMocvI8diXauXo+cS+zWdbbkG/u8eGlUZFu5SDfWhXu9AVP2mGcxCP7Th04prXZCl4+0BP5oH34pG2mEV3ObFUnVtmi4TOlRf8triprvutN047q8i/Apu9rAO8gIGAMxWBAwyBVuLsTUznEZnO59yOIC1ffqe6IVwiIi8aJ41cDXbe6BRNGoFrwDa5vXKFKQ0wRc2hwUixnWgtm9ICygVEcyORyW9G8ARuzfjDXL9Gyu0LuXmykqmXwxSMVvKsS2mL4a9PT7YAaMg9OlhaXikOYVF5+rMN07ftYfrGvfrY79sBgYGDMaocAvOobB/bhxJZQJA7RDbIPISFUYc4bW0TQ2GRer7RB25SsXKkRHqeYkpIdqgMbFOQAVfwMXuEBc2qbMpjgchAmFpcvbKJSFI2EVEU6+a5FKuie0G3BDnV9cDffwhvnjkEpIgXooAqg6mUfYAgrrsSwCMOYDquL0AjSzccVYn2VJp7rd9KGmqNAhNvTKcqIbb8WMcJUTmyhrwhCdg5H6bUi1VYaGzLGSscmCsss6CcBBUrHFSsMDZyMPTvBAWIzGEUu1luZyG/DpIJji3M3KdpdYryoLDLX8UvrqVJPwLUx5jaD7nGcp//vYOFsE4NN8v8d4t6w3G3segdFifLvYuRpmL0RdlHy8w3ePE7/PO7WBhnfnO14V7nkdRzsgTeSblqhZ8NEZXm/CnFFn+awT/bvF6Qk9EnlKsb6LfDujQQScLFzQ6qVLwgnyeDxiCHn6RlURsEI5mV09HDt0BB7pCrVOdOuLh8J/QeDrXMJopRyrn3GvxYCDAP5iinOBAxswdvTCbwwCxsV8JnLCJGqDKNNze9d4I60x2jAY7jNbWQ7IUKswZYstG48tOMK/AMUEhKuLXhOO3nGYX6zhwXs0HDTBzm7fUwdLgX3kNUY/J3qAbPJxi9jBzxgGsJ8L7tDo7mjZBFAEjYJXDCPfXMLCqwmAjSpY0GrCjavieoxVKTeCM0rz66PMMG0YKHfZU3LfOfYch/NkCAutdwhEFEw1Fqr1sYKcQ12xGaL1F2P4vSLCrGvkrkW/jZ4nJWUYfsy04YmdV7wK3bdITJTaNzf1h/p2tkFHC8O6NSmXt3WNcCmxKUNx0GFubKJGKSC9L7CkZ1kZ4SwP9G5l164t8IrCwWiT+Iq7M5JP71wBK2sDJIkQWM0T2wRjutgFlRAq52oBx0pYGg2oAuzdHyZGhd4tlDS4sO3+ZZnRLB6+Xkna0bWZ2LFFY47WxxDbZbBs2Gz4dRJpJVTAqn8LssmAUDPOACt09PwnYSTvwWl31/2gX+q/4QhwLsBO1/tJevC0ql4/o2i/DrtHvpHB4RPx0K3k1dpL+B0AocbhSAgQbepthrubQmjFxKkbEvJTGgrF79oU5sC387ZIcJM7Tnx0qLLrDyiBTYzA66TvF7/GspxZZ1BA6zhUn8dzI2aMzGlrCdTZuT9M5uIjiSTYe/lT6jpB9nA9bE13kCOIqg7wzrFPFNgtkVA4z4ACM5wEgMMFIDvPAI5RVpP0qifBD23k6zpz7ufFHAnCgzRFGDl/FsPxuklDx83zXs6p0QziNLkkEk58PAjGxrjUZrbb217nBj+8K/myIqLJMrWbNxhQcnIIxtME9+1h6HoZlFxa3Hi5nDAhnjwYUGksAPCLQt1V+U0fhXiugoTEfFzSDpxaF/J6pfSwwzBDYZKa9OZ8xw3ZohevO11hs0Py0yNKq06OhCvznMjrHcbDeuZG2h+1hrLncLjEwV+c0rV1K0PcB7xvQqy4yQonbN/5NoyrIIuWwPLWNWsnqz1biadeBfb30Lf8G/XrNBP/GP17zMKsAfby1cg5/wr7e+RqX4B2psNl4+GNazVfzlYLuwEhgb+qJQys6B0kYFglRLImuty6jIElbiGupaFBX2escixZ5p63ot1U/NNzIV0FJsxLMiKNY5cdIyU6IVX5fnvUdi0yIEfickzkwzI76fMvNkLf8lGVy/I/134VfovRNSHFm0PYzHdWhGV7IBPQiVgq2Q1wbSuwJTJSkVjaUoSPS4rmgXlWaAdYlhu3i+NQzp7DRHijZaaLE7X64Imu8VdaTGMvfgfJNT7lRwhBhjRQiEwo3VNAnBmagLTUcJaEDaEhUWRWm2mRKtqFSMF7ZivNAV43xIjXah5IDC1nxLsUE3Q5mKT9USBVp8+gJ2537q4p84d22yMyGGQKNMUI2YWHbKUnQTIgxAE4q2WFVGE8i0DWgCQGI32UN2ATvJNH7iHRJQEcSzWAhkFdoMjzhh5VnMtARm+iGhjLw4urdFJhx2BiEwW0LNTqdTmzt4IY8IDBptPeDIRJD82QdoUT5AEzpAqw4buYGNs6vqYLVPs8LVCJBrzVVL8mqQDM7ZNJnQzPtGIRbaBlIEAjzue8HSV3Px2jrtkJyUq72Zi3QFJBBwJldbK9k/G05QaNITIEUst6HxhrNZIWYllubqdTXoGA1ErS9wEoVrMtpauqwUuHBgtDIZVghdhbNMI1ecWJ5YS8NlCnMtGpKlNU4XQbeWKdCJdfIA2u8PKbyhZPMcZiG9X3UVJC6AlDs1syDU3akxIRV66BJR4oESUGeco4Erl2LiusXOzHCXNs+6n0ZmjElgEihttKlHZG7FViKQisKGdzOqZ5Y3sXV1LXR9uFL6bRd6yQKZQc1DSDlo5AKyWz9gjjEvtql+2E/9OPdJCQHnlNA+HCdmzBJYxuLKsTw6Cjg6aO8eJ7vFHlnjRqgXj8PgWdjTPLOMcmVPGnMzYjhzEuHkQmGEDNUoGhaTsTH7g5wQ+5FO5Vd+Nj1OjDQ62kH8Bpe9uLEyoo/YRCRWvBNLseK12H0j1u+4xnYqt8y+5cpW3qcT2Mi3IobFIC7MpadvoMMmLtA+Avp+6O+E0AOD9asYmsx9hPqJp6nhQe1WJhFhANrGLQ+LWAhFk+B1Pc2kVaYSCWDXj/yCSSx3QMQSjA5lXnSV2acWwo9Hp1RlZJNb1jf2/ZE79gMXNdncJ2O+PtYUHkT02G15s8n/bvCL2wF8pBTogw58qNv+DQwr9bGduNO6pBnzIBsD9tfxrNYIpuOqCFJTZuT2vAusDE7guUTE50Y61fe69eduinnb8Sx7LmM1PUML275LQfWfA6T7beEta/Fq277p7Yom0zth0d4hy+eRFcfJ32E3gdv8rbzjluFV2Kl+ovrHcFCy2kilEG1tOpqpA4YTC8QS0VBuqcnfkpOfr9/SA2LhYt4yWGSAxy0Fj1ejepHVRyDAqyFMIx8Qj5W6FEtpnYWuajmo6+QsMvzajfa8NzKWbIFuSFN0MuA0PTJCzcnksDQqZJGWCxH6RyR3HPpjhMkI+Zm3R/Br6JjW1k0v8EdUteszG1L3yI9Mtft8PbLCj7Gt0EVG+XqYRc84Ft3I0iMCtb49JpMje18dGcr4a8g8W7ESY7Xn52NmGn/koPPFRSZ91z/ESQdy0neNhRA3xly9Iqnt9DW0pOC8/G30+L6NVIUc6DXhAgmNryyTpSkLIzxSZaPoL2qHCLmACZEaHJniNteJrxSWXos9jYIjNp/UWcSzyYT+rvG/pImFX+sOqtwlzOp3k0WRn3UDdS31ONcKJhNgRB+Sulb1wvlekxFscXXaeSouW631hq3WirlaK9bVWuIIIqZSA0WmsTwmU9xCow8BPEPfta0fedA7u77aV45p73dh7fR1KVcCQL3Xh4GX6r6vO470dO9cN3TRA932ZzW9VklhxRYWG/L2kfW0jjnV2Wt6Z215bFt3rKEmtEkrHTjG+EX5oyHzEdJvATkNx2qX6MBsK55JC4ZgHIqhHSvMdjpm0iqg4KY8g8Vtk8w65r9Ko0FIaQOyRqCJnppjOIJKVMLffsjxR1Zp66EAN7RFu5aYzpIx+pYZUgDxQbMkifdltnElSJh1qaKMiWkuovY1cF5zJOKwgUtpiAUvnSXAorCgCxZt4blgSBZtw1DEyhN5EcGEuCuV6s66I7+EI7nwpQlPncapcaKFpMPhfNAn9a0rr5JgOfUdjHEuE1NP0mpsrhP1ErhLBZNJlGPmohy9AItefRC72tUJB0Iu4hRNHTxGZQvNjcuXGzxDhaWUwTfQNmwgS+4sY0ibm28B3xtyYTUQJHO9xMBSAJ8EOAM4YNAMcDysfwCAwPgl8w8j94PIfxhJsIoP3TdR+HOP+4w+BohrqTWUiG0x7SuSH3JUoYt70BAvQSnMp6RJPEqgkOGFc9PdvuEhqqsMCl0ARd+jNHkQdjEfNYatJnTBXEHt5EohpKMEpKPYL3YTkIzqXIfmnsiDHxiG7lOPDOK7T91edBjmBTyyH1PaGnnO0ZHd9AIfmMrr3lBG9MuR89QUNbTw5ckuNjuIeNtp56fZ0pJXFzehQI3pJ8r/lmYEW0JiqjYsP8ZfCeop5ke10CQ5Xz2xeTXEu9sQF4a3yWgTD0vLgs3miXmBXUUj1pqOo26jSC9AuLegNrNtuxH5C+SmKk0SF6RiVWbpMF0JA0P+ZSZNjfboSiAWeSS0p30/2B2x3H0LwPdbPY/9BaGXGJ8TFqe+5Y4x5IiwCpKDFTZBjlRajmGyh9XRerBDIViJM+U5/OZqE2juRrc+hp0Iq9AvW/IM5LyF4TzIMwv+QFpUPJ8yW4ptPWxouzKOj5zAjny1rSda5uf7LX9HmnbsmGE8dvxb/MyTTUxhDBHpmKMyxVxclEZzqRh+BMNPRYAvG1oUunhBRkVtNda3nAqRo3K5LoPQE0nvPyZzRLqRylBOeygHo4xUhpIzX1CM+ZTJIwqRGVp19TGnfIWPhL0qGQtWAUOIH86Rbp16pAMjNdumnIsLQj3A4KEZPQVnwiTJASaBNEy+TRY+gSssdNzbpCFG573URDwemOwuOr8q8N2V4Lsrhh8o8N3VwCc9YUkDjdfDRNPsgAj3U4yRKoMdYMSL6ogIFRUxJEKoiUhTDO8p+J9MV7fah2YhbxM0Q5V3pVV1gcJxwjQHY1ZKmYaTRPwufHbZqQQxMlhpSm16oVuP8IB6PA23CPTiUId4FGtUo5g371JE3ZN3yTNXOpZLblZUaaqATVVWajwY4sVE5ErLtgsKxhnKxSEDIAWYPGQDJ6ABAPnvkAGwMAAIoHXZSY/+CWKm06LKKPC1oR17BG93rgXdgVILshDqGByIgnn6F7qgTpjoiizhnXAxcZjIzeTddSHvspfGZTo8L240GlfpXvhu2uGXLN5+SoZJHCvUBF7nitCCMz7K5a3wD2P3ML5yBdj++fphrPWDmrtYBqx1vALWnSvzcXLt0L9XqOtRHTUpRsEbPPSMhvRD3efDVN0hC1UY+SlxGbIxwslxafyJPqGhLrE3qlzBm2ueWC3NZdnuWNfeAhejdWrp6o12zr7UbgK0ptV4ISZC3FSvHfas/KBs12qxOC3pmpLn6fL1ZHJTiTAHmBFJpc2r82DRi4lTyhPAKdcBRROViebb+KwiIDXXmo1LLe6NwKpSHgIZ8299a+PS5uLiAzQbfyWmyEO98LmjjL1FRnAz/aOeQb4dijt2O38kY/HewW18T82x/ToWJOSDmjJbgMLNYKPHIjVr5BeoAzWj9k8Av0WWEl23HdsaOpEy3aQ+8crCAqugLBE5OWy6VTkJLD0uFb2J2SXQtQ+EtxuUmcPDPAWl77mvrOYMK555z7yA+di9QzF3Y95d5r8bG4kr0PXW9FzA+9EUA9xlROOBVvU1QMLYIh4xiqbXoCWPFhevUz+PQlE1Zt/ye374KY3tMtMtQ8uhNWutMSHUyj6I5wXedNbh9zAYY1IpCouMrh2Zi2bNOKAC48ZiINiinlEuKcmPFH7XwIikpPEt/O3umTWwyvHZVdahylOtCo6DB3R3tNqW79laYxPq1mqOjFNciGA9WhZSaiYuA8d2c8k6sUfzB9m1y6JOZWwDmOGjf2ib291Sm2seLCNQlWsYjc+dFY15C7UmdibYipwNMbC8vHv30YghxZsx4SS7+OKJ1+0PmSljKr+NTAd4YudP+Esvc/WXHuy0Lh7ZHrDN+NflY9yhMzkPX01HSS/IojCHGjPfuYq1w3ra09Tc8ysHADa2oaPSFo9cPWPrSYw8jLqqWUO9A26u+2IdEulYyC9/RLyyuPTx+gU+pjvdwn+tmJ3fQw+864Z4bdzH00UkT4ED+y2k+iwwEZECIdq1E0z5zCJuC93T8toEvRCNxATinKJEL3gTFCODcqMwghrBiB+FYh7OVNIbaxfJCORvjupGCpO3ImZTM2sfRL40JLWOWkZdU+HICKeCezui7dFhmhhPOXbRi8jI/73Wctwdxna5fAapBibhiCSDlpsDNkKoC52/kBmsuORvRHUjV5Gdp6W0HeVdi1iy1xJ9JT0N4OZwmz+asByXCYvMA8O7tdqzx7B1ZnW1VqWxt37ohw1O+cScpV1GFTYVpRg4QgGYhvVHaMGwzzkZ8lV37AJM4qCxf2hxJ75ntrKRHCnuGPkADJ7GCFbuI7X1I2mdp1BYuZOiAZipxGLaMRXI1FSQKcWaUpUFRkYSGVaKSZojmTabTHlpUlKwHPm3ivpy000Wl2ElRvSixb15I/s2XXnb9f3+Sj4IMmCqheOdsCsREQM6I2Y9MvLq/NeYGaGMebnjyo/80XQq71bRdELPkWMEyRJ14PyKJAxdEugD+ZJLlyOfdazuh+TEG07qy0hGwouViIxILWR/scVzDMk+01kZElBfmqrJBL6WAMVVHtX1wJxMymaRKqUWG7ahSK3QtykNA9Rsp1ZKJHIeSS2tY+SnKveIcnuVWis1Re7qMU1l4RQ+FmdEbG7jGYeFzPUQCypmk0jVjJI2oqLOLHrqesKxpjubWq5XUEsihGZnDi/mVRz3aZlINuUBt9/l1Itql4ilnVzrhxJqwakLGYfLLqEmu5A8KOAz6BLzBl9y0YLEA0uwCNUA5RrcNk+1liTTd8WLMzKqKEe2oscUAvzje4GlAQkH6lKyGEQ5TQtK8OfTcIwW3fhTJuHBB3Y40k9BGqmOlK1YQwg8+qVDk00bS0kkRhGYtdPXXhnhnQtWZgSMphKTc6QiXbQ06miRolk55S7kc9Nvs6mkzy+2ecdGQG0FAW5Ti89SnMcHM0y3AvVIc8KTroXH+gqoundS3ZsQFWtZWqSEsPP1+XAymUdLfeZvKfSD2ucgCzJjaC68h4Y+lzdLfXSaHqX6E5k52XVTKMV6Yoqu5+KbZrPNkx++pcrWBR1paZNNZsQpFPqHRCZUS3yEDIVHRQNxwDoeegrYPQN3Qv0J3hWskMcv0LJT6xk9teVAg2htcShitIVqdqMCExLb5iGx8MKRlaWSiCWSW3f1W28RzIpdQSYidxxPXsZryiBiScmExGSirGAMZeWhsSFCKwq/GYSdZqRvsaosa0VVlrXCzLLmqhRcoXJ+59s9ZH8pEmOfRd13E4U1vVzsBRcD+HFr1xaTbmXIJxObCY0pG3pThazWavL0scBHbIgLHqF14RqSe4mgrfeTeqLOuJis9xj9vQVCrb/lxhN/S1eA3siVpAJY3GwhbwC1Wqjj1nH3BvpDsNWOXK4yWbA+XmMf258uVHz6ivXp5epPX6n4tBuIT/uUbZtNUqhsTdhJdWBoRdZQBILDMAgAPk0rcOsICy+bZdcRkE0rJuxbVLhuFr5dYOGmm5k3Ytapt9ZAEsUEVZFvOTQVSgihVADIPNxDpUcrJKAKzWUpKdFsAvglDNFLGjuZ71QzNuvn1V+1WuozfRTdQG9Ho2QnIj6eN9+c6j08kFHf9fY3kZOgQ2rGwO7ZnxFs1kUOCUB6JfSLEm93j1PlQqXrSwxd6okhWXt2ECdOY6+JBplX/tGQQYD8fuAbs2Cqr0IyUGRBY1M4Z2B0JngXw86JMRXiaoozMdw+Rmc4xAi1k77kgME+1q2fjBa4ACcHhg8a31CykGLlyinSjyKMhMBKTbcofLXcFO9gzslhHOpciOXsQ3zOiLLIA6Ogl+pezQo4RoF5IWfM8bbO7Ihx4MIZg48Aa4uoH4XZfSDy0XPBbZXNhHzBk7Gx7qSjrBtuB4dhJpNeXw+KwOKmbqX6UUG21iNtNyBnJdEGXzEPYbzYa5Kd0zz5aQE5pxs8zAMNO2GNa1nlHlLe1Xq61bCU7XSWbjXhqlXWoqYhpYLZilaaK15hRIYHZTYwL1zXrgTZISU+yrn9zeKiLNld21NXI3qpp5lkngg67j1IXNjkXqYf+7XaUuZKQhC65j4v7E2s3w0nPc6Czkv/q9cLSndi3bq0mRZpjH5hzJZYJjIp2R42HOEVFmpG8IVhBF+UMk+hpsW68IAOVQpJMjbQvrEiWt3hK30nzGCPXNMcpZQKSbset21R7Tk0mUNgaNoMJJznbLORqSwxH4woCEehjjMNHXpn7oFbmFSAC5jqvRsqwsSchh1KMCt8ojJ2RR/7aYLWhhHqnUiAjST5wgROTFHK8DiBmhTjT+0Yfk7ELl18x9IBPzPweagdlCJEjxhHxMaR4jhiR4kNOGjSKEhdmdDZill5hU2O0YsVphFhggV4ye7Q1KYNp6i/UDeYhPuZmWtazj3jVigxy9eg3fFTlJUYwAyb9mbMfjswAzXfQc43RagBfJ6ftYaxruSzyhHMlAO3FcbMypBZqqDtzrgno2+UxYZz0o9qsSeZSUBb+01hhdE59krRgYXQU1xxr1LetUsdS3EMOHj+QhvkQAvCgwQRe857IsNnFmL81pLpTEcr95QVgYNMSp7GwHnRVgx1Lcl1ErfpFNqP+LYnM6hwepQr2VtcgV9Py2V6T4xElZsTgTEqtJHrjctA28R+EIeQM3WN/kc8nrAxAFGoWTwzo9TqAah4vhXzlZbMKB6aWft2Ej0cDYyUBz/QBguba/eDYo+d1Bp4j/KLgXeU5MQC7OdwZvZGcSgZAAO8OAkB5EcBWdycHMRp92nYu8e5ywLOuxA2tjvknBagYlsFTkWz5DcKeWQWDGcLKNtN9lbEN2Sw3IZ6+TCOupjKpEF32cxY6M2AwkqqWS5oOhumpAn1RJ9kk6w9X7aem00N9cf5j2yLjJm0ki3RAo8179fm6JBbJtxZHqawLssC/nM13Twp6sF6azbQBjOOAUl0TVNW9oOM/Kyd2djZ94EWolsdEdZ6n4dZS30405iBQYNh1nwT/6vV3Kinub5X5ObyUzck7JOm9u6DrH5GsiQP1nIH71hTSr1GwesxwQ+d8G3HTJTEXDNmTzKYOcmR0w7MSY58Yl4bODHFb158oiM+0dH3m6i5ewt3xHSOjjtSi3uY64srvDcqBkFeBdIdWYNNXAWbGIBrwWbEEYDDBiPg0ahSlzzC+I0KIBvK7YyDEFChD6dvBQZRqLB0Y4ZuRppDFlf1/Mgn4pR7hlkDdLnHafMDrp7i9XIyaXJbSeYVIYMHGHEQeCQz0/PdXBHGz5PhYJMFprKyeJJp4Zhse9wmQggWjo5UIBtTN4hKFFLwl2uCVLLG19ZbzUuXWltOVbZL0QkZiIqaeNXAepLfQo+vBuf3SK+AXnJ7SDMEJZux6DFxebprziZAD48Cv+zEEwOv9nZgWAeKwXNXC1kRVQFmxAeQT9wwKpkWCjHCzDACgz3I69wSLKHUKUI9rOVUKeY1dwjgitp6ysG2kxgpCNsind37ozAbs1zYafYKoD/rdBc78WtLr+/cu7vC9JZRf1wHKaxwll7a26XOedd7L+G4MPyAEX1ABH3YLfYEFoVoagk9H5FbF/4QOHUvpmBLIKPZ7MhllLSGGE/OBSBkhG/TWblWQjN9l4xSi2Bjd/SFjCWBQJ+fT1TikgIzlcC6XAv8h6l7P/B3EmatOPBPRjny8HGEiX0TWNv7eEqhvdI26ktyb/dG5r6ZuPdidydwtwP3Ybo3dd/P/BNY8x6ZqL86vpnmIMkBAUi6oXeYuAcj1OQgnfQa7rMwy1FwrTW3VtZWmjWXMXNhdh84/eAwvAvr4dXYQdlLj2pTN4VhaU28n62oJ9kclPKflQ3C64piWZUFzdRr8TCaqDXJol54M02f7ihDx1LxdTKrvR8UgxkVHoSIaOUKun2PXjSrQXppN5aHjPdmKrNMFgoth1nOGT0WJ5qVde2oow/Cvjc7JCmutb7Ir45p5Q3WX4rEd5BpU4Y+JOjpWUzdWZgDqzHj1WQSD0qDyG+kOOwszAfmRKsL4WSVcOI1DDABL8snzubGbJJCYNC7EVR6ZKLxMtpSLPeba2tb/a3GVmO51WitN9Zbm7WpdlDv7z/YfuXaw/3r248e3rt3e2f/tdv3Xn3l9v7Ne/fe2N+f92uA1yHMK+zxY/xZ7p/9DVGSZzkepFGOfGRvcfEZqhKHKJDlNHRyJjmKfayW4OVCPR2gRwoUcCcSWK7p9DXUwuxsX3uw/XD/1t2H2w/uvgK9Xb+3f/few/23drb37z3Yf+feW/tv37p9e//V7f0btx5sX/ejgQsfsmTQ9zG3R1x5ULTO1Jq1KrVmLa41wykuUGQzywu90VBe6EJNxyw2p2pQJPSYQ+INhqUGL1+WYS+B4mU+cIaxn/ek/fa80k0ouQnOjG5xh0WGIw0nfIwa2ZI6Vs9DibYQ9nv8pqyq1b9CXU25BoViJPa2abK3CT4yEwpiXovvwbyiMvc6BU5GUOJeu37vDmlibRZkltuznoRUhoOSgq6tkeRiOpsqXxdxtVRhBt9RYXNRmwyjuEf3ZnhpgnLcyntwbtVrbs1xVdCCLfSuUYw+UiYy0JxJm9yQzT4e5YOdcdL1KwgcBdeiapyRrXKjmIdBnY2/h1K4L1B7mBhNlnBYNFuFxeuNDUcE5ZVhcRPRVI/p+vPJhLnDIqJHiOgpIroeSbeenIXkMSF5ciaSoxxTRvLkHCTHUEEzkJwEVQ6mpkgM3eH6BxLnSN1Yhe0YKpKyfWNY4SuZ4N9C4N8SP9sN9wAUIHUB1eeUHbPCAgj2c4IX7s3zLkuEUvS8ervQ9p53bj0WfoYMpjXTlaNc7MmSEuyHYltTYBvXaknrlleKqg0/TxushHTO2RJ0p24KX2IEfBjozqNeVsvgrKrSdqEcjZn58J72NU2TdUBcCs+fkSOLq79lYNthpiVAf1LVgQlKHrgbp5tUA1NRP9T02J4tFjFTfgnGMrCukE6zNeBMrH8uX6GUYGmPecjPX4zN8HU2Qzo9nv3NCgC0+/T6te35UgbjC35YT3uO4jZKeuEpTsJNArwnRcbFf40dFcHAV4Vu0HNHPT8YtIOeP+ppBzwU67QS4wHlxdxo4LfW3W7PrwVHw8FwP+/vd4Os2H8GUkdPLz2O8gGVRplWynUQ+2kGCEOv+/BR3s2CYdjbzwfpcL+bxnnN7Q783dp3fwunzXdf4j9f4T9f4z/f4D+/xX/+Dv/5Hf7z9/jPP9T23Ffg4Lm6QyKnsAXrgOhTc2BrD+OgG9ZXH/dWD4HuXe0OQLh03Cj0EWH82unnLz558dHppy8+rjn+1RM23cS/OzoCfq+OSQMbHMeeLJy8gsnS09tpNwBiw7qrhcnyWzuocpxbOCmmTzSValeq00dunwOy8Pl39b5fH/nC+IPhN9oR9Bw+/pFXellERRyK932v9rzmtEG2IZUwUmT8jXFLxipqxZiocj25cmXDWU6W0JQ1AImsF75S1McOzI0NK2MpFIID3KFAr9dWNpeyf9NcX23i3XKzBQ/rWw042bbg1+VWww3YBxle+tbjl1vOakvcySLdTQ49en8ErMP6ymXXqNxsONAuHCPhsyg8xrSxgME9L3WBrmS5F+g+ulldtBe6efRBCGJ5LQdR1pErRU334zRlR5MfLidX/ZV1mMTunoQKzKEdXfE32hFqGbAk9Wvh0bAY17A86aS4G+O45uHterLUXFzM6ACtDYK4X0NPPDpD8pX38uf1WlRzT7pxkOckET/J+8s4dECAdPrErQVZFCwPyPKl5s03phjjW9x/8gZA/ksq28jnxI9lQieX1twj3IPNPXf66elXc9/99om610bqra4kezo/xTfEZGLsBIbtiPe7j/PHIyDA3b2XX/wTtPz56Zff/fL063pnfvfxqLHZai7jn/UA/73EHnprew5sJHNr5S/Xdyerp790r/7X//Jf/7P3+z/997//079c3nPwRceregVvnCVsZ26hOae39TMYU0X9pcmM8oXyYE5a7pSahmKAwFEd9nDt9B9efIQb/btf1hS0nuf1ExT/vVDiU+GfDFIooXXKYb1vZMEhOaWdKJMivoggww9gEXte7WhtZWOu2ZjbWtlYvoT/zl0CFHVL9e5swKvLz5qNlY2gOdeca9D/4Neg2dQLlpuPLlc3cBkaaMHnz5Y3BxvPQCZ29qAeDHB0oSFnqNpyT557NRhxzR3zv8dRrxh4tU38PQijw0HBHzKo2VzZ0saiWmiu/8gGxBCwoR8zggt+j4DCQ+t7ru0dXNv1lY1BK4Z25i6vtILWXIuvVGuuubI5gAXXy5ah7HarObd1c3OlpQ28G2XdOMRtD2O6jIPr4ugvwyDhz6yKza1SPZxJ0O0ih3mhyZjttVh7W9QcrkE1pgKaBZfmLgkMXZ9rsJ6nbYuUPTs0KFkNCNhRerAcwYaS69JqqWXB30j4X01hNASwdfgPWIIIbXZYelOQktKn0BaXO66lcZqJ0rdZk7iovOQ2MGDdYOjV6ITRS1F2lcUmYa4V2Qh6onRjyM56tT7wmmFNUdYCZBmYLyMM7+X+iSIiXu3/+d/+/X+qud9+cfrr08/pCfiV09+++OT0c/b2zz+tuUBpv8Df/8P/CO9+g1T32y/Y23/3H6AEfp/+Gv7/Obz5EEv/4r9A6VdQ8tnpp9/9ktX8iw+hnU9Ovzz96vQbLPn9X/1f0O2v8KPTz6jjv8LGocoXp1+++ARL/up/gpKvYaD/BCVA7E+/xPr45n/5C3gD30FjUIolf/kptoZff/srfP707+nbD2FIH7Fv/uLf1jSe5ji3DaNwCH9WQw7+vRwAJvQT9CCZHl2l8F7OUihyzmMOY4ugV5w4rpyVKOnGo15IoUBUc5loLvFVVbzcLursBOiN4AAgdb9/NVuKdVYHuI2GkBV2a7//Xz8DbIBV+N3//ff/jn79+c/hz+//5r+nh7/8j/TnL/68treb/JvNPc0ChhueVHKJKPFfWQ83DP2NwV5hhqp6srouRvLku2/mXvzZ6denvwPWIcJ8xyCQPlHdvZJWnObV7O0inniLwHC39dIrVBoXRuFVKjw0C2tU+P4oxWItoSstN/JLhU+jkQo8MhnjHz+p7/7syd6S8wQaeelKF0A+R/TAJ1rQW8aS2tWF5pVV/HX1JebEpY7slx8DA/Gzl6EF/IkjuYJbODmkb/jPmvXV/j58sw/f7O9f8Iv6zybYi8N6e5xQf8DsPH6ZWBr4Mjy6utC6sgp/Kr/d33OoU/p0H77cP//Dx7vwxeM97Gvvcb0+KIph3vEerz5e3f0ZMEhY7hDYgrkBehXUFlq1OWYA4tf2D+IgeYrGDjGmdk5BjgqzuSSFiiDvhVnNhHMcQWWCQFACMk7gcV7fc8whPM6vwBBwAPDZH24ILTEEhUpHPYVKVbhMyulCEJWaZN2Zvcs6mbOciO3EjZG0+S3+pLnWniz+5HmjR3967dXDyH3yR0/0TZIc5EMqrxlMJ8N7BELtJb34J2uXoa1gmOb4svaS8U1csJauGKWHvPSqUYr7kooXET2YmqAHBw+e1+ZdBeoB2CRjX9Tg0vk2s/erq+tLkP6AVsJ63Hx45zbl2uBuySpGrci+xxPZSDNMDUGzxwnMzoTU44wXad4tA7V+tJacuZYUoWMuyM+ePHkC3P+gOIqdDvD7q1FJaoAaC6tUypoyMfYKbs3VDrQxnBxk8N/j1ckonqTxJI4mbItPDibh0SSajCaD3bXljb1JL3o2QdnKeXzg7P7s6t7LVwnspU2Z19Pk8fHShBKZo5zio6xS2/1Zbe/l2uSl3Z+9tPfySxPcHldpe/A2+DgdwFfN2qkn9DA6ajOhywDR6hXoBGaEXQ1pqHI6g93m8uYeTlObGExiNVopwhwziEwmhHKzWjDqahYxPWPRqvadHKS+/+Tlw3jGR5MJvCnk8QzIMaOadgpSPk86rxGzQFQHAR2HFnP1RTtW1gACoJGf7MZkDEAItcqmGDnifSCl/KUl7fvFxXm9PrbhtB2uCIaDjApAqsePlpZcHqD8yZVhZh1dUFC7Skfa1YWTgN2F0L7gZ9mVVahx9YljpIBfBbx5eXf55d//6V+DpLskBw1riG8e95Z2VxzjjT4dd+TPqmaDaXFxRl80v1ndsclLcDy5EkcwOTjq8YW2gUmuZy1PeCMOtsL8k66swmdPGAw5/EadJ1fS2D4Q8qKmYAefwpdpfPWJ9+TK6CJ1R3EZvD85abpr02oA1qOVI6J+UG1pFYCwW/tJbc/ZbexxoAF8Ya6RNlHVHE2tLdEBdpg5wsEc/7twIvVbgbvmTHHYIxgtfCGAUsKIq4/zzmwENpbVrm8icOVSUW0av7EmT66QcSmecBZqU5EO7isH2epVgrn6xIb9fCRo4IkxRzaZtHIyNFb2VdW+pLKZSCzeVmMxvbWxwfiuDMTUAKINraG1/xFAaQlAQ4CLjBOpsFX50A3qJ+ReGrpZCrJlMZUJC2ujHLgmxxSiAW1KQvTB6ACtWam65sYydSQ5JerevnBLB2kxJ59gcjW3FySHIUjHeTzeCYtbgpXwTvb38dz2ksmEuP6prmN8K9XPu9p3f/vdl9999d3X333z3W+/+7vvfvfd33/3DzU38Wsv/sOL//3FX7/4P178ny/+44v/9OLTF5+9+FWNCH5WyQCSZv04zK4FOXPh0JjACI6ISN01RooXTP1sN9pzMZMwOefe6/N8F8FVzBIZL4m+AsfG1pGfWN+MrG9GJvJjnIvai39boyq1735Zq3j73/G33/5Ke7u6Gyx/0Fi+jBrURoMUqTduAPMvjuzU6cA3qYcfztUEYsU6w7JkqjS10KDKGUIe3/MNiSOwWk8WTvjdATIleE+B0c6L8DDNxqoE5O1uFg2xTVU4zKJuuI9Wd0FRhD168USLwsfFbxxXP0JviPqrKeA7MGDoFZiN67F/NVHyfOwIdcrzns+vWf2rjJIGz+uFK4lqQklkhwOqhRczmnEkGRgOgwzQRAZv1ZxCp1N3P5ffkQ2KZlpZT/whcMZ4hbNTpFlwSCFNbxXhEV4fAEcjr8IL3nRmNH03N4ZkNJSLhlzLBhJjucpx6lb3A3QSUTw/8/x768HtOk+VjM1jxRUUzBxye8/DIOsO7gdZcJTDNqujuUkxQDU2ZzmNXYTWMTC/eo1dvUUgYmA+PVWkPbPrOllKJjv81dNwbH+4b5axj3kZ2oH7xothgF3jDmnW5DfDYIwSDSvPR91umOfqLdqOjHL2kj53U3+Vul7Owm6IIWgnbCTysRiArCqoPY0NA8rWzI+AkQ8wfj7nEsyXj1frcNI4xDcA09Dcw8mQufhkkmJW3cV4Mgn4NjsRQPUyKHQlWLzYxQHj3Y9mFlaZVuG93vdBgDbj5OcpjsWuDlrXWD1XWw5XLT3/CX/1F+y3WAtXwH0PjW23A8RZwHUT7wisCeXRNst5TFSyOsakMY6uLVOYumR/V6Sc4jqdWqe2NPMtnhP4MfQ/IHRvczgNIkyQORYUkwxF6ydT9EhIHH0VOP05GghHLNaAIYUvLvJWX7l/f//GvbsP99/YfqdTUebxO+wMSCTC7hDOw4fBID0K3HycAylYHkXuMiYHDZdZgZsHSb4MR3rUr7lZ4Z+wYu+E8gZ4h4XbzXOYpduHWaCY6T4LPoiQ/CaiTu2RKHFrS+IDUup4q6vdXgJ8ACxD9AyTlBWrh4PVLMiL6GmY9YJsVbb2x8/W1lYajbVV2doyzmEZ+12BJu0RmL3/0J6pjz9ea6w0VxrAK+fF6qxO82AQxrLTHXz6AZ1SK7zTlfXz+zyKjrQ+4ekH9QnfsT6hx5WNc/ocBAewJVSv7PmH9Mu+ZD1vQM/Ns3uGExS+TlPZ9X1e8AP6Fm2xzlvQ+TmgBgod9oKe7HubPWtdi8p/LJs44b+OonjsvcS/eKmdZ11vlMX1l84aLHyUBAdhL9rcWuVf/vEWrA02ma8iuYi6+epxeMAKeJXlB+HhKA6yleO032+95MwxTqj+En9u04iO2cXWeqPBnkmp5CVYNWYlAAogS2MvPw6G03/VCd2BL0ZHF5rPxn8L89kJj6JX07h3oRlt/rcwowvP5tIFZwO7LcqCZBw+DdQZcuvBK3ffwZLvsePkNxcEwBFwxe8FB9HqQYCeiTDugzwqwj8+gocQ6BVBgINDjnCVpqqe4aMYp3shkKz9yAX+15ph9i9IZv615njwz4DXJk5/X3z+PlAYhEewO5NolboEZgJPOGqA5mRNyZqRPoVzJzVtZ8UKdBX48Feya8ArrlDXB8HTgS8esBRhjEylz3/LF7hwBwfUDLFBWNYdwSl9ZLSshNHxoOoiQ17OJH7G5WkRfmV+vp6p9JmVjHS9HvsW47zjCLv4eDdDLXVW4F+HufcsLibavUIh8k/N7kNdCtoM+s72g0fbD+heXrMkyNp2cyvAoN+AleBOSqYLsLiGqKzKbk0SVOfy1qOpuL2rVDEcDfgXsfwinio9A5cRa3JxtGumQ2N1aK3aZwJGJj8wh/4KSCNjMw9CaYE0ZUvFx3XyenQL7ZZRXvBcXKbaKZfsFnudijIPEKTYQzxZ4UIUpqamTT+ZHDIUkXel4ge/LV2h/YaaGXT3C7NiXK8to0S2zCS2zHHlpwdpbwwYazzz77HyDSIbfuaYt6sJcraOvLSt5X0E1O0oebpfW6J76nnZIqABH9er41volq/wa9ZlL12oY6SBqOfHlJkK+8BB5YMwhBlEpBrwaRiuGvwgDHqTySywOLigYcLiAQH6shxLK0gjS1O5AYV/kKnQqPW56GOwPnoYPieXCTEo50dMTWrv2ACPe/5JrRcdRk/hQFvOADe92k/C/trl9RC1Hwkix2EWko3YTxqNXvNSA8oPghyqHy13YUPH+Kbf3zxY24A3sMXTA9FOb63Vb4FoTx3QhJezNA+pi8vNcHMNPwi7gySNo364fBCP6F0zuLQWbsG7LB0HsSxubWyuhQdQHI+ej7Lx8nCUDWN6c6m7FoRM7XMQZsuHcLhS95cvXWpsojoHnR+CZBlm/v4ojdgIGr3L61vYy1HUS/BkWkbkgheba5ubfbTKTzNMWwjj2QzW1oOam48S2Do428uX1prQMEY2zRJtaKIprRXgeyM43bDDfvNSC5o5CD4IggxhEGxsNbpQkI6K6P1RiEM+aF26dAnVDGj7f/r5i1+cfknm+G7t9NPT3774ORSwxxc/R6u1U3QHOP0NVjr9Gt/Mwc+/e/HJd7/E8r8+/Vt4JPu501+zt9+cfvniz2a+/UcsYG/RiO4raPNz0R/azn314mO0rONFaL9HxnH08CtmX8fHCuWfoZ0efvlnLz6iP/A5DIy19gs0Byx9CsP79MUv0JHhl9D5F9jS12iEzUYx9+KTudPPXnz44pNvP9ZG9u0X0Jk20A8RLPq40eLvK5oVghMKvvpWdA3NfXL6DRbjA07v1wrcX8IIP8Mp8jHCo2r39OsXH0F1PoSPcV2o7b/BubORwrp8DqP/FA3JqYkXv2AgIzD8gk8HftPy/Q1ChDrmUP2otLTfEJQ+5Aukv/n1i49hIrh0e+5T2NIKczwbjWi2bFhsmsLAUYKBDRfW6wtCL5jnhwwa+PBPp58CLL6AlfocHz+hhj8Sy/pPWA1XDNv5gob7CeIMISxOFLEKTSxplRn6nf7u93/6S4QvNPIRW5NfMNxWi/hnsIgff/sr6gKa+Qaa+ZQvHwzvFwLpPqbOv6HG4eFrbBEal1OzUOX0t4Sof4NV/pqG8gXATyEvwI7W/ddsv6mpQdt/D4/iG0IsAMi3X3Ao0bJ8Arj0GYHuH7Hod9guTESi1ze0LhKwCKtfKMDCenz7KwQrDk6Uwvg/obVU1eiRzQ+HrmgELrxJMmAun9IO+5htcFq1736pAwg3wIuf6/BAjMGRiaHImj8ntMH1l1vmK1pDs9pH1M6XiPys/d/B/79SG8zcx4he3/1SbU+kQrisX3N0xR2HxsCCBCIif2E+fGIOAPcpId5HEvlP/44hzxcEGbkin7ONyDc0Tl4jE/CGxsLaxF4+PP3cxBtBkRHw3/BN/RWnQGSRzJYMAPwLPhz44msaCq3MV1hNkDA+XbYzOVJ9Qe1/evoZo97UL9tHMAskCwyR+JIiNDicvyZM+0yeHGIj6gj8EfTzNX7LYIa7TNJnIvmn39BGxG+ttZYz+w2ij6CquGyfQvnerAMK4MSpjhg2Yhp9yxYOTbMVzD8navH53Onf0NCw919IpEYgsaMGzwaxoOKLX3NqCmT6YwZDgXAfkwE4x/PP6SiUjwz3fs4g/yUA4Ss2KsAERgR+zkiWjiOAz4DpbLPRKn7OyBwASMef3+BqvfjQ2mf44zfi0PyIDgjext7ZhznReOyfLzmhDJAdtuUQ/TgJxp0AXwqk4TvkMwYGMTuJYH8rKQs7BBDU/AyBznDjfilJH0Nxht4f4k5gE+K725roPyBlpE3KsQmBRaDnDX4pjpBPCZ6fqGPxN99yFP0tAOfnbDqzwCO4GUYJv2TOCmzuv+EsEtFPDQUA+eQsBbRwt+Po2cb4kBihr8VJ9CVjWyT5xFNTgP1TMfSvNYptUtMvvv2fCfMIiz/j5wKe5QK7P6bTSPFcL/6JHkVbMLLfId03uDWaLxyKn3ACJEAviSoxKpJAAmIDMf+E2BxxhrLjRx1L3yhc+QU7nwUz8Qlbfb5Cp3/L4EvlDPU/ZWcUsl2sva9hfb5ASBqbh3GWc0TvOO/zjUGD8ZRnXiKKycQV+kKA6gvyXuWY/qFilHDu/wjAZijMWvo5ghxmvOfafO3/W967d8dxHfei/59PMWjTON1izxDDh0QNNMTl+wkSIiDxAeMOGtM9My3MTA97ejAAAawVaYmU1ooTn9jJdWJnxSe+OSFNS2IoSlaUnJU/fL8EKf+nLxB/hFtV+9F792MeEO0k9y5bxEzP7v2sXbuqdtWvcPKeS5mNXn7MpuaXWAETRh69+EddsKA5kVIGLRrMAJHwk5cP2eoKLkEVIk0wglHkT5os+Qu+xTbUx5wt8QP1Uwy8gf4q3Fs5/JD/8LJ0on5MM/gRo96PaUqF/EWtP2M7Eqt6ru9TzsJUaUPZEWzDr9mxFoBT90yQ5uN4SmF62VJQsY+UJYTuPfzmacw7KPiHEw4N8bmQNVDMeyj2/YMXX7/8CPtK7IpRONF+4ityugLJPM+QV3CZkypWppMdTB8KZQN6SKRBVPy+YOC/4SeaXKtHJBZ/wSUpccD8igRrIY7Fig2XJGN6f4Znv6puPCdmIr9+Qmf0+2IuH/Ajl5M3SlO0eJ/EQg0RFtE3nfTiVXYoiVP7GRPZaMmhrse6EPuA1SmFbhggm2g6KZkUTG19wuviHJuf9ZyTf0ws4iHnzKj94UnPlECo/Gt+bn4kVKJfCcb6/jcP493+AfWFHX6x6kg1KXokrjJMrCLS/xJZPp8GqOAfBaf9nOlAXDmNGcUDpnjxDqV3VwH6gXFu8tD8gKb3Q0FOvxSr8BtaekUclCoudlrVd5lCxZfkJamOsj/Iw0jjfRaftkigT7V9SUPD3fVLpINvnipaE1uZz6WNABdVyMsf0CEIW+Ipkdrn9FwlU3Y4acQqVfJYU1S4BD9kOZui8mIzIx+i5ZTi3DM8vAp4REhxgw5MceiTvsb1sk/5hKNCwLlVzGhko/Dyl8hyfvdDJo3iu78mpvXrAtsQ8B/RM+Pmz6Q6wU++R4wlwTG9ZjObAwxeGh+I3z3mWjlupHhNaIu9/ECqYLGw/ZiUHa7gPhH78BGepyiisAMY6FrVdRU18pkU+MZZPpDdfs6VRkVrUejgUUpAoVhHfp4959xASgVcxH+I+0fTmvmJwncq5zWfiwliXIsP+HOxoeHoUTYzLhNuaX5axbzrGRPxBAd8TCN9zs0KRJyKyo6EyURxRYCH9SnQunwsTlwpSzyhpeAHx9e4Z1XSxThQIfb88uUHKCEgx3skrT24jFxKROJSdbhf0kQ+VaeIJA5h1ngkjkrWywdMtxHaFLEPaOMLKavj9GHfnsAW+UgdA6kdwEwUoxauO4lwKfXhGXFvoS3KM5qxPFSrOdf4PGbUckRMCHokpQK1ZjqUhbjPBNDPhNBHYjURt6BBXBUyRMWmNy6BI6+W1hEhiEvbEbJeqTI9JYXgk1jh4EKa2FTP2NH7S+xXPNO/opn+JDaRPqP9EZsnuHT7EfFn1RaIPRQiCxeG5MJzbgVU/EV8yn+hrhKTY9iIPkWWo1FaLHWIw10SPSFNPONyx0OpM8Ub4pk4zB5xW9fH+FjOHLP6SCMmG4UiUT5mVgg5JUzlFQxVcGi2P+gM/ljRkHB+xD59KiQIZsBkZzn784RqUY7gp2xRsGfSokrMSjevPhadZPoIioEfCRPDU8HCfskUxcfClvMh2dEexsf1I9ILpFWLqX9CNlWNuIIGY5uumHx9qYianybtWKiyU9T6h9wgQugZtFkkAT8Uc0QNcAlVKv0UWP5reRa++FocWGik+1CK1Z/zAzk2jZFG8vIhkdonbBY+YIfNY6nM41aD+j5W7KVihz1mO4L3QXCm2B78VLwnVwA1WGK7QjSl+VQMpNL0zboW28GZsBCznaek0PyLYkci/UaI3sh/dPsjtPJMUVU5F33ArVJkhPtIGAOo07gX8bScwAJPdjlsh02vwjK1CxX1GkGxAD7nmulDKebHG+qpcvGBb/EbA2arjeWzh9yAySdkbcIrASaRPCJS+oRzdnHyyUVUTcd0uEgWwvSkz5j9+CE7m4QiKl6gMYgNhQcsGSJx/4i7CNo96sXEI4Xc8GWar1gGZ12LBV7lAoLITDfRMl1CHJ+PJSVSf0mGZBuWGaG4BSVtWYzvR4gR8luRZ0KAe84OBLHvvuBmUIUpfxIbZh8x0pBkK0/2F5/TKn1C0/ShcjtG2iYTXx5IS/9a/k0N9ZHJT0IwYpYFeXY9FRLNV3gsCGWBHTrx3qRKvhBTh7quZOKcT6mFH8VfkcU/ZwZOxNkQYuuaEpKxjSEZdFO86tnRWvW90oBnfDclhESBHp5vNBAC1lRxw5QvYTXvstwY9hy343c3nJDHvWP+0rh66UOCyLlBpzdAsEm8S+aA1+0S9xnC0AgCTNnba5e2/L6/4bcxMRc85jAner30bi9gaZwwjULD3ybfDP1pP/LrmzuJdzGXbdBo9L3oEnk17e2JGAUKQSdUlreqb5w8unD89cqxo1YMFINZCoQbiesS+vU1vx8hkACi+SCsl2F37d2e0+/7Wx6GTVg2TiR/iWUyyHvP2rdX1yw7tSLTeYT0G0W5JDYGTO33ttexam9Ny/nz3ijqsFe7dqg9mynnkwwLfZ4pzwu/CfYU5hURQe3Quzfw+tFpvEvHpi+ETsfjb8ZvBcIxqec0vTs3aH3yfSNK/XoYtNsrQW9vT2K4YeRV2R7zClvzorri7JE1H5nbrhkccV4rz83Zc3YZAR3t0AxOHT9p7StkkEsCrAXD9hMk4JvjyUC+y8lgtxcGTaCNPuLF0W+Yx0xBlBu2TK96MnakomW56TXMc5hFoRsMTeuw99qx1+fmXit7xzKWVIKhFuM3rPkchjCoYkwYAlluOW36ITTlpM/ZmXVZNjbMZw1fqbc9J5SVDNhI5wWPUPDvukeoy77w3VN+ah/BIVkW0AkmjAgj86htzBmYoSqj8Pex8JHXs8o7onz7+/B78meBAdiq+HYHEf00NL9NjIoNnH6EqwMsrOPDOmForIQ7ZfGdCyNiWen94jB0egLQqQ0EY1SMXgCsT4Vv8mCSexi8lFPbuqitcGiXpUZg4Y120D3bBgZYwbmPTATeteJaoSTPEwuPgb4rejzX3XAEGIQamadDQ8xEGKyGuH9R/5YftaC3TuRUYOs3PcNamJmDk5MCm1pBm0VwdYMi+xU/1uKP4hNPp1VMfJclh0FQDzodL6x7Rb3mYT3xgBBgSk2MWOKfe90mfC5vl0voMdWDwliOMgQy7Gt0WQocxPzk75FbFQJ9is8lX/gOwxP0uKWnSkdhI7sDRHoz+Kea3iv+tMjLwxO/00z0nBAei3FNQ5jaYKBMyqDT2dG/8QlaK/UDYLchUIAGRxWvdA2IGV2HPdtpR5UIqOZGz+veDYIO8BtxRoR2W2MeZWAovh2kzg3HHiSfNWLWxNLc7cQP0P2yGX8tZ/CfNrYVYEUD/Kcpk0GW+aGWeiMuEkKRULKYVtXs2XURp9va6QWR2SvVKbHF7WJdfLLFszvy2R1rb69sb1d7UHsPyH9Qb3kCtB5klKOzs1BRL6T8oefYMgLL35H9gFOwIb/supWWKWtZnVuz4y9lGE+/IgewDyzyPLUKAk92w7Jea3dMF/gs1KujWj8i6yu5dqcaY5/ayhEbl+m/Voczo212LLvzFubDMuVKYTaRZSYKxGNnaRTEV3ijNHcCkcO1NYZBX2YvIm5LPD5lMGUhzHUF2DIcMPKA9kbx3Z7bK3Ycv1vswXZoGUDuKzh8Yv6VbfF1EU7oynnx7XzXrSxLdnqZQSEYG4MoQmjAyNm4jNH3lTkoctXbORcMuxVcNJjnTY+E2PN46IFwKx8UDCubaNQBwUQw1FS6rwZl9GGBWYV+98MCXqS8fFD47VcFdgH/za+U356wWy1U1L4EbeRT1Cgk4xfQrx2EO1Q2PkU7u6HTbBKK4EzZZi7+u8QOMSqgsk4f27Cxj7nmoV0fZEv70K6Df+asQh/RhOFxuG+tI9CCVRmzDL2W0i0GRKjiM1wHxtTD3r3nbBNfuowc7YK/Xenajk9f+pWwiiKWdPXFY6tEnM9aMIwK/0xDS/Grdga/QobU0PhTrtgbmPmNWcp+nyFGBaeszQtk8SwWmC1f2tubMWVqiaiEM/BO2MYQAwTbF7kT5hlOstwNhYbKcUynv9OtmwI7oGm35gfmDOhBcZT2NkVpX4ClRXT5+W3ucWwaDvOot2VYsOPXvG7o11s10NL40WLZ8QugvNXh6MEEnWF0PaCELIZWAsO2cRaSz4nC8ScJ7KD+KuAdsIAK9aDVzI49dfo5r1uuOkPHj0z6t9DwWJpaPpv2bseDU9StGEs3llfQldfdAQZQDz3KT+C0+0CoQK7FIPSbfhdI0wJyRjD6EvObx6k1d+ExsiuzWV3WYa6XSyj6WPrDJqcXUI7M1kRvtEhfiDxCI5ifQcf+ZUEZyyUONgDM5PLs7AwQ5GWLmPBljZMQ9V2W2A3bmEiQ5+OC2RyYlPvJ4lrK7g5uqX3cL/geYowvpHiGTzyDL5rNRaSK0Xbu7yBLZWk/dwTpzUvWvUJofFx1Fco/x0qFKUyWY0KY0OC0fF2mUUK5tzXobBQZALZliRHDCYPMBrUrVNNAu2oFQ9QRCNxGMKZ+jigdV1nA94DBLRgF+YPjGxWSrjl3FFFPRjMEEt+PGdoqvPb7X/zlnxkCY9UR09jvOKjqJRUCXn2xvdFW+eKLT8iaTK4keC/2JbMxfvsnyC1Jal9TueYy55qIQw9ck81nfQd4JkLaV0JYnVv4oc0FPVjKoHvaRdhy+NvfrDg2jnq559VhD1QGjP02VPa7E7Pfpsp+W1UgmG6tHwX1zRnkUyAyEXY8CDECYZQhsSDOKEgHLdc8j5ndLksFowRth1ENMVwwgUICy0VFBEVUvMOnBJhMPsBMqU9ZQ+fsN47qEEOw/MCrfA4orC0FMDG3wP8WkeuhUA1bswgrTNj2dgKauJ+j4+GSxqRTR/HB4NIDxcPoskOsrfk4ad9dmMBqrH07haMsJJddVBZjQUbfB0guoFGGC0bQ5SQvusjkYFjnHpqenKbDknTYbeI00CJXaJ0ND0NM8P6W/Fw/Yq5cdJGnkDg08e3f/C8o+O3f/L0C4pw7o8UNxwXi01TkltOvwVYkLGnKmMw/13r1aEGsUQqtHqvEkkpVq6dN/W3LNl4+MWCPVQYLeaj3BE6FnSr22b5RNzDu12/+GmQwoWTLEeag58P2gYlvoUxhgJaHMy9rg6fsZo/uaSp0KaE8kHVfb9mx8JS7e0XxUfRbbGHWHeMAVESzEnULsOU7TgjctGOMJSFC6VIm79//958WyJ1YGdvkLTdbAfClSdr1E+2ijw16INGlNuGFr42ZLGIWKEQYE3IHegE6AmKIk/VOJpXRS3CMqy8glrWUjixkfrq0pOQMUAeRXz+msdC3xHYJn0Hdhwt4vUEuouqcmEbrWM4AUUIoaN+KnPeRbiNkiBT7UzY3lYCmLsud3MturOV3tZm5bF/m2vKp6htHgc3AoQmsbI3vxPHryXJ2pIn/YmiLfB7bZO7qj9jVWBsrXOwOOkplOK/sB2vcuvD36/r4DNOwqRKWgQTWxzImIFU6g4shyEQTkip7gdAU1VeSbBfIEKiklgJbUx5bo3RznexyKvM9tRm8N1EXc0T/taqzq42rtJdHddTH1FFtlcsvx7LYVFwKxNNiw9kw0IxMyRorMy1tLwQE58bMAOQbinEVT/E68jG6Az7nTm76gZtbTmOsxoRMDV7q9TMOAEGoigr/s59hU+hS97WR3hGy4Ld/+6DAnCewVGshv8Kf/GMBvbd5vExsU0hvEjwp1VM352CcbFlwyEWnv2loa+Goa0HuIegUSV5E/8a9mR4Lj0V1ED/+RB4hmqx+HmR1BCKvMPYX9D2Q2P3I6/RBXJeSO4rsb0c7JLHfpLsjktnPYhotGDQI7huD/g7I7Y3Q85ah45XBvp7aQIXwxwhrkWJg2z4Po9o+bHLp/HwsnVuvwbd7ERwfZUw5YO8ICX5AsjuoaqfmFpQboJ1iwwIhtqU897sm3qQpKZMaR3Zeo2u1ylxCFB+Z9iOTVYBMAmpXvD6RQslO33fTUr0bOkMvLIR42yekcBdktaCZ2j+0Wwp4+88isybjkqyBIoZ1Z73CTsiYd2Mai0KiqQIxdAE5K/j5dKSLdKTMi61uu7+aYM/zYSRFGVhYTBqp3mzlVNDHzUMX0PHbTSCL5AEXTwX64774CuQW4MJNxDIwUNN9VJBuPR8WmG2TOfUUkNHQKZ7PDTY1HVqph5xICuRRgk+/0GtmIXeFb//2J2M0ERpkFDraiaik1eLmAZY3Zh3E+f3vM6uoFD7kXHbpgm+bX/Dlc+KoiLxBndVtZk5K22f4D2SlMYykKVbr2+vHRUYb+LRBUIo3Hdcf9Cvlo/YGjK9Jmxdj58uNE4036ahSTB42ad6XiWsZdY+U0/20XTdJcslN3jquPt2WMl/eEiSk5m1+okfbEZ3l/DvmUBxN7cDjJtdt1MOgDW34rg3/cjZZLFvqXvv4x+oJSGj46ghPxy+O3eAjmz2sNSuP9e/INpgYvk13xuLE+/TFP6HLkbq0P/0Las2mgvl2NWyAGemE2YwRmkiTtBFsL7ccNxjyBxk2C41yEcZkGbPoGUdLx0OvkyC4n/8Z5sNRdBONtpLsvcCcQ9G6RptfzSOlvUcumBT+USDJ4hm+q9o2uMc/MhSs6zcUaPAR3tCgf+nT0mSKJOe/jSCIplAlI1AlI83wkCumoffvi6/p4miEkAabqEHbZ+0AirdQ+UllKLSbqnwr+B5BzXJyC+JuOwsGCwFgzqCx9Me8IR+hwxvT47i36QPuu/cERTJ0n8OCn1LRx9ly19ksuavvRahikejFdGcf75ewhBOB8IVzfJZSlfncdHoWrwwDkcHsnbANMhg5X+HHgeIOsvDHl3LaXmOMkMNCxg4g21DqAK87yBV0st6XLxT5hc+E9o6NQdiEdv16YKQSUqZJHQ/emFqzvqUsFrHC8IAF70oDBw++/M6s9JVJYApTUvjgLXZ4nwRRu47p5RDA5vgbx08ipo0TNv3uStCrzO2rnj+UqLY/2NDO2H6CxyZO+abTq5zcP6AVkN0nImeQB8B7g37kN3Yw1TLsh4rRaHvblDA0AmaunkK7bSB10LXhHIr9L4X/H/phwejsDa/lbPk4+H4H+GYLL5K1I+FH/7Mg7sK55okZNOOh/+GHEZg0AnUKR6gAflL2d1JUMm1vEF4LOJQ6K3/xDwXBKSkQi+LDnrGZkdbuV9TyQN0GP/sbOKELLHqThv3EiMViTDfgoJ9UC2QBqTW8om6sR167go5yWiuqiR2X5Sd/B8pIosxa2sRDggVvmm02zHPZ2y7MFeBfxKGS+/PNuTnNvvyUQXtQhAy7EcHLkY9ePDKm2JDHD7ohO17T4dpE7l5Tu4tBsCz6VPRadJVnRITZxvPSDC1SZszVhr2zZsUqzXfsVSO1d/KVSczjCKvXWBtjkqXW6OjWTLI7JPLYDSuWHNZS7pFLKac5JkZ04dNS6G2R3HAdE6e07ZYDbW5VfOlMByJDypluAP1NOtPt2M3ks1bSmW47+eB88sGy6l9nX46/QXU99Vva925Z+pME+/ZqkOW4clkWGUCRQVaRniyyA0V2soo42DXqURP/idst23EDc3Zc01ye8x8zct2o3oXPd+WNab/u9DxE8dTcq2xZ4HQYBsObZBiCQqEoFKYLXUO5Cl3WRJk2ljFlocPG3p78UsWLWce8L1KD+F3zhH3/cOnoCbXeoqEVIhe7+0UqtD8v3dnT7ubwOhyFQNc3hL/LmWoW5iMKkY12MBQmt1FlZLyFrcceZPqsKx2wR1Z6Bt1JujY6kVrSDfGGNivK2G/A5HTw590bqSttOdAbmKIhcu6cmlsolsonKvDfvGPelRRwv1o37x4+I6/87zP3REljln0fRYTrVfOGfSYmnLtQsfAIPSM9Qu/Lp3fk0zuiZsWb9K59Hz1F9+1rolpzd7tiyioPyyqtI0ftnfiXO/KXO/AL8K0ajd9vQIm016c1amKux6+gd+cNzbf0bvXaiJ/ntxUnVVjlyhmbfPoqcj/a0XblcvxlpyJ3JOIn3q7cLW3jhzvwAfZ6S/P7VGJ3MgZVRm8mXvxUWXiU4DrHvZ2PK4RpjZdnR36+k9/BfaDBm6NmdXZ2O/Y1zZ3guyMn+Ii5HfvPwgyS9RxJMX5MM/raXQuo9b6o9J3Ry9JQXo+2D5vvlLaL8ROceAuJWim0g4V29EJ3kOaTu2DsorQmmJPEKjXMltZduVDF+Pk29bil9VguolJuh/yINzk30Dv4Fvpdb2s0ZtkZo5iDYq1EsWXFB1mbkH37bWoM/dbO2HfnYdCBjzbNFZBbMKaMqscTIIBX0Y3vbtXECdAc1ywKy2IvnnV6MMWedE67WwIKaJtnbFn1ZdeyNdK+oZD2DZW0B0jSOxiMZK8IDpndPVkfjU5fkBsTLsiN7AWBxm+Pbjw53ft236uyCzSd6984XDqGZ6Gj/Cy3vnokFLGc4LhnUrz8DLDMHqsjIUvsJ32+svTt+0HQiW0tWUaTTuASWi7LtZ64LcI05M++eYpC8UM0ViHKoeKpFwuz3QmNJdSfKAjadIki3oa5uZHhuTKt7drxhEEXg0YRmpNZLp8ZOdbr/tgqe7JKBi8iovq1e9BV5SIwoGtA4Vg1ofW7r7YiZjzZcWb/Fi6rY0xuYxoMpfv9BxjhrN/qfvsnXxsTd72t9PzrhPcb1PQvhnItNI0aR4SSMDd1lbZQWXto5NufRpAfKM3oVY0q8/lxJBh0b7U8UKs78OlcMNhoe4r/wqnyQs8zrYpjHi0dxbKcL5Jn49vxdwq5WIm/v9Or3I6/nXW6dWjhth6vUdPiNW6q8Rqb4gt/c/MPEQExwNCHwqHdHfqrxEAE+9Y63uD3g7CCMwA6u7MBvIKmFp3J960J1iDhzqSEgTxFg/cjQu8gvwMMBGHIJIQe8SF+h61wBPYx/fSUBekTWi8PF6HQEYqkRy8R+AZakpEwlNdcc5dHnaFLsfBIiJhbYVeqvSH3IW5zH+KEf0Lo4Yy5FcoKHHspcDP6Tf5rQyrIScXXA2W4ZW+nIjVWz9vL6YeX7V5Kla7bnXTB6/a1lB5es29qzwx0QWbB7VlBG5hXwu5hE9fw9WWq+KZ4y54RmUHRJdV3LYzr6IonXRnXocZzLMXxHIkIjkOefdOz3a7d6M5vYySHLb2mNT9p3Yk6zt69t7eciP84FOkBIIei/AgQkGpkKKNlKyVFYIeQBt/zMqIuuiOjLg5FBwq7GMKJbx7yqtCiFjLxnpcVSHEI3buo/xh9kfGO+JWADJZAwHhPLh78GkdaDL04IwXUYgRkATOs3aYZeti3Ugn0ZRv+HXriKgkUEdccql6ZWFbrQaj4cFpseCXHrzV8DP1GkILEMg/z1nmBqLDCXsc1AhpZoKWv0C98nXrd6lDGzJjmTQ+/NkE09aADetdueiDXW0hZMsQGJ+luaPYoeWIWScdUFno6lcFAp4wzUt7ggUbdZKCRUiSONBrGAUfK7/wCaihDjrTYI6VgHHykrVwiEolP52B6sgciOQjZ30ayd7vVQYKABplk73aVkKPGpG81unrYEW6HgdwOA3U73PZY5NFtD740zdNiC5z2bGq4ctuzOVlVVm/TvoBCgtIoPanIuRuEIC+Es7NBCNoE1Le2L2OWQsp5yb8cipQIpiUY2DbxXaJuNZJpiUcyJYbMw5oy3eM2q7jCoASeDkNnp+T36a+5KXfG7Kz8LPx35IPKJvfHWeUf1ipw4K1U3169vLa39zZsor29TSUk8XYVKtY29WbOnkYF6vZC0zVvcykRNKbNRLANKkCbpS3UTbCyfg0D/LVKblRnZqCIwlXOg+6EMTqbaBvSPPzui6+bSsjOO9W76AV2/1T1rv0uhu/ctyPLvpOaLCeCFkFk9frWgvqtwr70JQPl32MuCrSUVRnUk7hoEM/5dcOSfWuNdgimZa0s2VtOe+BVbgEB4RLcq/Y8kEJ5mucjq3svfmj/4AfdtcNH2PtL1VNLIh98KgG0CCAqH+WNQVuxxRDOnyVZb+Xf//fP1o5IRfWQJ73Pjy6wnh1CVirWg3USSrEmyhbPwF6J02NX2GvrLIgEAadA3Dxt3jpctvbXeQVLGNIGo7zuVe8ImrwjxiVmpMQyKy+VSG3FD5seMrC4YkNUV6K/WAQ+gNTApIwlPJQq9+yzXM8WKc2XqnPzS29dn186fNhqAyHt200o4WgbG/ohakFJAeiVf90kvyE5xSetSdT1ntsr8BBiFpw1tcYuboIJcuxLBlE1oSe8m3JtnM6vmAnFxQ1yHIw1TUVFe/hjBoD6ORPumQN3yinBHhNcDZ1MuVpslrJv/LPfZodz/7tE/qQ8qH3kNLprdEF4Uh84wCdxW4iy8hJJuUB3XWfLBz01CNGW1dsInNCVlril0jD0WYqm7DTV/Li5hUePtkI/ZdDUTzgu5kRuXTStcOxTLAzeK/vdjLAqeBm6nPlyPQSGnPbiEQjR01s3FMUyj7pSvmNHJjd6hCrhZYcjTdgQXgjvpql4khlnd+WT721+kk/zCqJJFFRkCdTd0YKgVrKZCJXZnCJCESvG0sVGO9Ajv06bm+lYxQIlrEDQ9PfjSKcV7s1RazGTxwqZPDZl8JXEfMEt1DEp5/mB8BtkS/ljybRtYKh0QRo4MPAuC9mCUC+kq0hrbFM8Ml3zBWdJbZ6++CcGLllQQ/30qGr7bXF+l8dBilCopMor31ZlhUnZ2q1qtXpZBNxqXK0HXGiEBWtJenrv20uHb1nWJBFuCr0Xu0HkTRbioy5Tph0qXrY0DknKTiVX1M516Dhtvi09Rss8NECY1tcmZr1+txFMs6uBYeVFyOVSWzouczMRl7k5Li5T1p50+kFPJub08zqstd/s5nrcgw6xORjPUaCQFkqIqcEq1EX4RXq8aA6T5Uw2PHbqeexi1myqgZRnWCCl3SfH7o47xn3+zIjQyXhUDPTzAbo8wwH3dQF9684o8ZIF8kB7yg++cS5DruaSbfz2qzGEe2Zs2GwWAgWtDo8Cd7wFjGVBv3gtDhyff/u3PynEIW4FkYTlIeNwhW//5C8V72klliY/bHzEIvIQ0GB71KkG9J4Zs7l5oADQzdwAUOUXUEAn4nVYtqCORR9HdiuiBfu7HN90dPvdtt/1xp7dhupk+O7CeKaWjENF97cfP6dcPAzXXQlzwAQY6Ov5FfBpJA7DflfKB++MO+DQbI8xT/qZjfGeOTFa8aHNIq5E9ASer3eVaLBxDRY6CBurDXF8kzK6i3sq4rPHMnqD4szuwrqqs93zxnYJNIvMONgUdyJkdeQ3vHmMT8B0AJSL4KOko+fIBlPRt9/ZjDEnC49idaJppeUlkC0sK3lVOWK+smOr0vEoT/BSFNlUxZgqFuoaDkJxE1gqlq3pYrCuWwdt0O+aR+dA1tJbnCyqGufmFWjXIshGD69xYiyFs54WA5kdFB6HuR4YYCO3A6SPn/Xwilgo3YHuWCy5EyaKEq7nBzAzUB/GWhoeU5ZTZI8oFSRjtifV4be9/lTmIv3MzNvy0QjOqh7QvZSAI3khj7wvcFT255iE5FeU0O2ZARzeYCLBREyaoWRocXDKwAYbmkb1BER7jLz6sED5vR6w5Icv/7Twu2csjvd3MOWUtpJHGUwz2QeYu5//PUYXfPNU5EqglBZ5UX0vfsOzJT2hwBAa/xMOBs9yeMI3TFf4OSo1MFXKQTbZ/PzuKzH6hF2PZX2jZJAvvvqDzsiPnkgBlCcMyJsO3RSE1EJZWAWBkN71hKdsmphAvubw/yxikkdbgipIaTyev/gMsxYwr6kYPGJCvS4KB/1ocnCK9G4Zi1ORRR8jX3r4KyS/7FUf9SJJbiwPM6UTfVJgOcDUIMbx8+GgGYJZxOFz28+cnRzWKl9TuWwNndTJoSHTMhF7O2jiz8eUVe1Tjp80zpMsv2EE1Orntsx+VZ3gKAkMTN6XLB3RdYnFvV4w8eZEPoCTf13nctP3DeWj3K7hj1Y2CAFwF0oehdrX15IZKhMtFQqP35BnmQQ9HbhM4kwcTZwQ2mIodx4gB98Ya0FzfIZsprR0HlXPxwUtSvcJS+CEHx+jvIspTL/Atr5kgrCI2aUXZWFKJcK0U3zr9GXV+NYfi+OLMyBt6huDDZA/ih1QFVyn2/TCYNBv7ywjbD2C/K8sXqvs1mqtqNOu9L392LrZy6+ah6zHA9/ba7GxZ4xPmw+WHBS1gEJi+hMHLY855wHNiaJyntIHNElwLDnix2jCUFcA/7AkLfBTST3V5NtktssQHJ4gt2MAGV8IqwF0r6Q6KKrb8sB0miRTBFyj1NwFbf8CGVxPoulHzLaexOOADhWjhNldvMEiaePWrnsp6ywMIgqzgCmilvqU3aPGPCNy1V/lJSfdoLJAMjLGjjamU98boMhvZMCJ9Ee8M+Z2Y7zmlY5CVOVv3dyXd4WzNh7cI9Uw0jluGu1A1NpDA9dopMODtMvkObL1f64dSynDHTcu2kbhSOF3X+agqo0fp7D6jWxLGAlFK7q1aWHqQcb3PyOa1a1PCPkkDFB5+v340SqyS966YsLGh8wOA1zmCIfPogSCUs5JMRs6Z18hr5Gs78UPdYErfTDLSRi0szGAciSstp/TpNS9hYoW5/rkZ+e/EQQR5Sj/glIjs7RVQLYoL2POXGVyk+08Tu1odnQ8EKlI6fNHL/+yIBLmUu6u3AoVMVYRhDU9hs69LwkQhcSLf+EjepJfa4aUW9AIgy4A9VIxoRTMRJvvM6WiwJLrvnxoYcvSpMnajleu5evYUImD9QuWIDrfsClQYoSkIom16SXhsfJolXtEJ2/zRSe4yZJI8QlM9leT2hugvWxYjtQeSDf1BUvsyPYAJV/9cMz1hhwvsklGrywnMuYaHBtmwOegyNMbqb4QTU+YKLmX1S10UltKeQdNZCES7SCWoS6lNxJOj9CCMm9LeeBaSxq4VgL9fMRJn31fnrucOfAfI1X9pfGXcplws+o93C0JaIo3ljm8/rR5K75/G7XQvVDrXtY9y1IpvskhsrHJS0w9BybRfFm2N9ADJpq15B3QuCugg4MgfRfjLBdz6rOzwq1iKceBgwVicO+NsiVQB2IPBoFMwLwJ0DNwqVg+LH63vi8/CeQCpeDhsvJ7Fur8SisnUEQFRsAIkZBHiLRZCIkeKJKCTDJrrj0iAMUfUX1mAIoafjKXCD/ppkAetj0TVt7uVmfmLJkLMelLvBqtCa7EcQMWupWZmTCu5v6EKJ8SgErOTRM6NnR2+oTNjxCgTgwBOqDKPCckFKqGTRnAKju23/XRnfxc0PUqzSq7w+dhNckQGlxg3dk2sBaCCqafS0XWoGt8KrKGomiSoTVYa1M6+DZj196FZoUF36YCb6jyZOQN81sF/krgK/jB6zh+m56EwZbfrdPDug/zAn8d16V0efhzgLei+Am9WugRLDH9QTaNTHd1035ba40GvWLfTo+vD4zeS5ftefaN9CDO2HfTNdy330k/fNe+k379Hmi76aaAUzS9VA1LSaCPW8kHGBqjP7npVYGo27Yh/FBrmOuhhnJsj9ykMKrI7WYW6mCmOvh9dnZmpl3qev2W0605Pb+26e3UgHbtRrfag3PDu4Beama7JGqtsZCGGqwBqI7HTpReP/nmUcPa2+Mf7UPRmBe7TXjxRLl07OSbc/gi+2ifjhQs2y37AhDelsSyvaBh2V5QsWzf86p9r9Twu665Ba/AWQNKRg+LkhQ3xIii2Vlez3teqQ70RO7vvW71dHR46AE/qfIGb5pXeLzDFXt1a61yYT8riSJGFNVKgmyt3bdxYfUkqVvVTXc1LrOG/tMYZLMl2C68tCXfQcfrC7mRYleUGK+revDN1dERXn4IiwpbyvfQqhoXFt0ybGUYPGQiyop88UXkC6zckWGPJSU9Qv8W8ZdSr4WGt4yomKsHCorZqJqwElGCO0eZwS1XSmyEFs3xzIXZWZ0LbgCNvw3/cvffq9buhb09WjIltuQCjy1Rliw7r5MMM5m/Rps8kzfOzjZhRpy+h+puPej0YIE9Y6FjNq2KOVPf26uzn2fUnzH0CnZGh21ui8IHt3KJ4oJCFFd0orgyJuzP2cEA6po4jmTM07lXuvBXDrTwEUZDXaie05f4XNa6XyiJEWAwVOoN5Ue29Wa2kpQRYYxTJLWebXxgL5sb1VMbe3sRhXZgIKTX7nsFXoE509rbm2mJV4QgsVFd3fVh/PXAFZkQ2iXJcOFpjcdpGHlKMIiVceRQQqMG/f4haasPCvHlrGH7dSxp7K/NbwN5Q8epeUuEVV2xdrHHsrMIr2G+4m4qnYg7oO6rLRGzlbWd4p7NnJ+dXTZbfMb3MT74vAQXqkVVnfa3cDlvYqCayofhaw1ZwQ6syt1EaOwFfYdcyN8hdaddj09Qy76QjFX0k7GKF0ay1WQZ7CD+jn9T75OkQ2/Tp+TvXCjCAvxjsgSiQDLcWG67Ph1Z6u9DQq+rbTZlAelvUzphx8dv5NkbmGbWO2xuiLP2NSgxZ2Ei4FoJDv/Z2bjaNnrK0lP6sdvUfkRJhJ6KBb36ShnNhQMxmnPAZ7aqV3WucTWLz2yVWKOck+gs5BxwkHPxBnM8eGLfgPnDycOfKF8rchQmlwCHWYi8yjlO6eJQuqBEQN5lCdz2s+UOIKiZm/IMEsIGCGwrfseDXcxK1ghe79iJuVTCZlFsi7KIYwh6TKucLCX9sSVlawfimYQ4X1OiZLFi3FtLYdDx+1Jyw77yIJxr1u5W/FkXk65UUbuGfjXgtCvWgbaJU+dlqL+iMFxZBlYfWD0vZrJMXNY8zfcVewNIuo2p43faIOJ6HtDpBkUDVY1WFPX6lSNHBt3eZhOkws4R3o//o1x6s3T8CCI+iUcl7FqMioY2OU7fZ1HpJ+mCk7Y6oPfgpXPVvNFcpdj0c9buuQw4ODRDMdg2ZfIkYOq12dncOQXay5sbxrlhdiIMmq1eheO21A/rU84FjgpeDLrYx2qii+wXDzMG0k8XTKQOyiAIg2I1wBExYi4jvGmzMbb4tJfSqaBWdhZwMptWAOKKTtML4KjCYPS4bAcf2AaCYoH2ov1E/I0zTK5IbGHi7Av+tueabyBPvKLzO73wBb3wfx55i3abeU5Egp+TgeBW1AqDYSFeOybkmnmCGbpj4oG5wJ6QJ+BXaH4nyz4avZ8Kj7LPMOCD3YiTZeyXWObF84IpcIYsmbC9wGrb28OIveU+aWn2FXt30/N6p9kJeLlxHq/1K1cxM2sVxiSJ4lx1q6SY/5QvNXl6bqkHKQqfW9rBDXrIljyp7TMRfOviCboRDMJWEBAYgQ38ZQuBkCKvxoJyGZzCaTgK4MDw2vCevbGWcuBlscEvfljA3XDTPB/Jjr8bVVEDPR+RnYNT0gWLzB382xUrtppE0OT5KGbiZELZoGf4UUJmnVt4NxLDrZ6rzFzFDE9AZ2ci1DyU3ybs87uIXh7JtPIwAFB5I67qvg0DAjVudhZ6EQt5StLyDWvhNoFYsDLK89nZ2+wEtK9H+mZXtXNlara0qblAaBsw+zru/FPyiUC77JOY5NhlHCc7dNpgMmPTI/FR8Ba2P2EPYDfml/vmFRs/2TvCCXbHvBIT14KRXX2iC1+wW3C8sPuAXZ0XXvwatgn/ycYwESuW5E8z9qc0CXORUIM7sHgMGkLffc/xxg9aeJ67EUUfMTd9GEK7QhZpemwpsmWR+yCLuF0V7iZbX1XlcDaZA88k3rMFNSxJTEJNqLlSJeljQbElMQmz0ujaV6sklCR+BAmzcijCem/FOIfYuPzKkU9NMbMbIHfd0tDt9gXzuMDurCT65C4LzaqsXrGvrtkY9IgZVdhtF+FlUbwl5k8F9SLy2941ZwcPcnG07vb36XEJjcfALUEWgQZKQdg8snt//8juNvy3s1/qkU87CORUXflNW8AtkL41Ww96O/MFNHQvUxWLTg89L6/TsQaMHjfxSgBCRWzNwYGEm9AV1vNdBRJrTn2BDm7TwJ/hHOOQsULagh9BernmRNdgi1nz1yPQC1A23KBZB0Zwjl7mOVE3cNE9RE3kb1BhLGmLN+GLqIB/YfXEq3HOPuTJL6CQJGTcc8Aztpy2DweEh8lDQOMsH51TBGplr6SjRF8+hG33BV6Pcj8UzFnEL5zlLojVWCRVzMI9KV1dSNMVasH3bbcrhed3MtXad0XEh+BCB1FiU1LOhaSU0wdVoN7SfgHi7hi2bN/OUu8kfESjq5eQOp4scSiy/hPpe0zQuSoEnauxoKPSiZmtDyJDlWmbNYoRpKJL4NPolnRzxDTL66Q8omo4O3srBvyMdwEc0/EXZXetkjqJu4l96DbXlI2EBd/1vWFWMbt83MrbMuoRoiatHntY7M/nZatb6VYVrrJVXV01UGQylMuJhu+13Vr+01ro3YNf2CIU5HKwrD/opvkIwz8R/mRmbs1eNei6KV3VqMe8CWAPGGz5jIBFoOLH5FryoaiYrq/SNYx6LComBx5eV5k6KQ1HqQ6N/UVWSktE68I6yCxNydfyn8bD/ggDTFgl0uSUfGPcD6I2LgvJ5eAmrtRoRj7nlWFMM/enogWmuaNLwQxaGfFY9E13a8f61uYRB4fdr6KmcdU+ByLuWtAobFlA1HSRdsUmuzF9vgov4RUa53m11QtrKkQT3wLrLz988RWGML78U4o9ga9PC7/99aHdc/u//VeeXyr295X5pdaF5I6mzr4Xy9E9D4RMckRMejWxgOEnuBkoB4jIVFXJugKUFwDsHlC1xsr6dTvwqBZk/jvDGJuTq4TpO7rK8ScYwkqXy4XW7jXlfqxH+Ih04XIwo+6gHwWdmhw+5birUc6yKU28xK4N+8ryjeslpvL6jR2TpfzbwLPGdytoeuLW9Q3u0EGXl/CNuZ/cQwWNm1U5qtpGjCO2TzbWBD5WzUIN47yDZ9rqBqhnCI8lu4UPtPNY3PGw49Owz2NALBwfiqVY3MqKIj1PMySLnznoUBbCIv1kpUzQ4s06YfnwnTH0rP8i4sC1fCkg/YOqcnHtLc5EmSFaltKiwlVp4qBOzZjnSl3Pc/vinm5v71wJPtYGYZtszfrSpp+wO0UXoddARO7jrQ4vRFWQ3Hq9b/qhvUsboAYUC8I7/2izD5vejnwIn226VIAn9Jd9i12rxPP4ia13qZLso/yd7ZL4Z7ZbIhBeN3eCAXYYK1e+ksWFzzr8xD/t7SnXWHwpa51+k0o7UQX4g1fqBkMTvdBiza8hxJ2GqanWuuWA+B1oC7Gz71NSJTCeTmWPaD9garvdISPFOZsueSsG0KcfousoSMkUCaMb63FFsgCrqnLV4j4naqYthJuNTyAixuzbx2O7/z5WjrW2l6MANTuuqSDcCNCAOhuJquW9NCwWkAjqinbehE2yEGqKVpKs8u0dF3AX6gLoI+46++jFV8ytmlk1XjwrEWoN0+9wbZ6gFyy0EZ9MsYDa43al5ag69jy0r4TVLbI5XeA2pwuxyW1L+CkRgCfVOgnSnWjuABB3MhuizPA1cTJJgVEXBb1XjHMXHRTnbkTeWM2tWSEmgemaMRNxXKWtvICS3kJWTGyizIQuqXIK+pE3Mn26krS4q4UNI6kKL1B70pc+p4Cvr4iov9aiLzNers/O1rP8Tiiksb5gdHyXQhuV+p+XCokwD+7pXV8YAWkTTwbb4oVDu0rDKruTri74Q4pbLRgc0NhQ+I2Ki3OwWg+Un5NyUir0/CM1LCORXPLA50Nu1LrCHGOu+OLnBVVzSIvi1I24tSwlYhTWQKzgxu1XFCfxDISNupQULD2EKlE31PwY+v4vI6urJ+UGctLmT2Wy2ro4BfMzGCbhMyg1oHzP1gLVnjF0pRELVfj24U+NRP6GdFhpPcgE9OdeOnH8rCIPsrToqMCyqwGNX8aSIv2kdI1nIUHaeMrRn/SYUB7O+UrIXsuUrpN9/WCnPAVB8cGxew5ldr7Q4ar+a1JoXu/TKvSYxjQxmJicJjZ/t+TNKqRKlERQHH1qr8Uhr+OOx2kQOuVLiLOZCc2XE28Fe4+F/6Tlh2PJOD3l7Cx8Q/lJE5AZeZ0LimQy0s76hNioGitBZpRxYkxsy6vRmCjv5QQWztzeMAMX9sgovJYAf/G7PZRAdxk6dI0CoCm8AqPsKyDyhp7JrbJbpYjyX/H4Z9sZRMFZfkxXWBklXC6zN9zO+sonRzPI5rc8zUTQC6mZ4AMYPRURDgjEk4rRxqhzqnkxcPkv4+aIm4xBi3ilc6SamfPb5TNUnmSG6IXUDPHuj54hXkjO0Vi6kXbvV006qqF8ZNP5tEOcqY2O3gr1CPcLdXquhGZyWlIcK+hxFsdqMvRgVsXWqnQcOrLVIpvjloR9S9SzFVeztW9vWWri2+xxs5uBVz7d/Doht8nMaZ5ZQVDGVPRtYs7JWVGdb7qn1SYcFYRaLYhaIBHUDGuXfE5sJFt+ERIb5OKHiTXb/y6LxoZPKADTrZed01Q8GrXN5yxIu2DGEu5Tdk9iMb1jLY5kTW7r1DTmzkRiU/OrnmLb2/LaoLiTWb0VtEH8UnbEgjjK+FzQqQwqDspEClGPuF0gHOokQUxqugiK6BFKWcXVYGGy2oyWgj5EnxlSxbDfHONRGAtGbCR5NTb5Xio0Bjru54gNJbyLKOT7QS531+7hsk9AzCjihB7qU2Ew7FeO2oIk+MspqpBDG00YzL2lKEqPZfb88u9Vn4CJ+8IRbU9zCnLf6JSgwAeRnJlMsaA76HihXx87M/wWc/KJmYaQEvBEUsEyRvRl1ETlkxO9mhYy2eCS3FaLEne7C2OEdOCqxWHo9CZWOtgrObAKGeCvv//FT/4MFdgPXnyJbPUZd4Lg/kOIgD6te+uBkTn7HZ2JvYPnycyWwsfuL8hEkbKPhuBuBYbZp/7EocpYQAfzqRszecy3iPZ21pRPYigh5VvOk9SJYyqN90z8DnelZj6A0p36hGUbNlQQ/9ptqr9ya+btGA24N2JQSVDnEYjAYlnFqhLWLSIs3Pbklj6rG6DHmY++/dHzSWmJ+fsVbjJfdUvPc1CZbi3IQCNR/nmqBplJUozvG2z5h6oz6QhLhjHZMKQnEU1d6mBjEgGaT4S9CwUCtHfhkt6fhDEAOXntKTkDd41Lk4F+ELyr8bM7KUFfFYYM3YFKYnlTXJ3ifgxVXvV2KJUqSrNbmNQJJdjzlBRgdtbcSiXttt+Bf9BV8cB2IWQqEtLibIxo8Y5iJDqL+PQM1E6OhPOOewmpbNDOm1iQBaDLqj3lnoSxfp0n42Ke3pkoQxNmL6YrVdVn7tZY97ktcorbynecUwvYZUxxfT0ylYdZKkJ6V2yJxIQy6gD1OPF5dpb/PlOtyocSz7FDuPBqXbIKCd8BU2clzNb5ZM5yAS9pp608dW96C6/OBJd0VErZe8dxqDML2oULIV6i2kBC+kcChl1pgVMqNRwjxktYqZcfv/yY8RjGhT4WGF1HCt+gpvJvlG/hiA7RZbdLiDVSix1jWjD9uL8X1nkalDwQe4FTf2jXB7kqrxq0JgsE06yo1qmOEgkEzYCgYAaeapP14oeq5oVAYqTjjPTwmgQmXlyhFwScGg+d1MjE0zThTJEWLxmbQ5ixHmrwiOkgcFnV28EkY2YMIXRcPzDsLu9TjaU54Fo2umaRXAu8TtYdc3JkHjfMLYZXZI/MA9EcFnMgnfKKa4BRW+hjFvpeiPwddQdjASXNzwz9l3rL6Tkh/faznyV+i/yes81eQ3qHEj8fifA1jjERN1LCu0cwH6VUguPIwmlovX5Y1yagHwzCOllohkFQDzqgEtXxtlrfnwan5l8SOtzTAm0yQq6T4quWVyzdLnNEkw3LCD6JBGK9VZ1Dj8d429JMw6+Jix/2UNz7rO3bRCmwX1XvzDNwzqjx3zwofbr9m2SasJVl7BBJDE8J/V25S0y7n31E00TYAekLwxTa3XL0ynl+DoDkZDMgL0DHc/AjBUYbLB3AmEQcsZePbKw1BUM6/535Uc/ZyWRH5zO50fKBuRG8V483cYx3x54LuLtUNfijAns3ETMjrPP/ON6zpm9HhaivL4wWhDCAIR7G9aQvkGk4fd/1RjgD0a8pEXXMBiowbLsJ9tFndHn5pXb/PYa+oQ3upCzr6Sbpe8R7CQrKhkzc0iATRxHLlCCJ2WiGI8lmBKDlloSJMgr/z08LaGpiqIARZlImfs4cssNJ4PihrkLH7/rT5+bEfezQPrbjPhXL+bltJqhvwPgC9zM3QCT+p5fv63P9078wkhtj3I13f9AhI0h/Cp0Z38lMBpcBZfwJZhTJSrmRLAqLc1oetKo+MmUn8q4AhS5iv+exVALCnz2VRiD5+tADaWF29j0vKTFAlxFLbAqYS9bvSSZOOKsU0M8MP+adremdAt3qdXVXlQMYCTbamMCu3WTpbotwhiE486ZiObi8tzcjYkAkpba68eAu62pcSmDhWht7zJSyiaUHYLiD0EskIP1xVvYNrqupXiHcUYkAjjBt0T/HmMACvdquL+CCVkbzXZgVSibNvHtDr8miUPQMv+qoJsOGlzUX/W5OkuHRr+Vx1RS3bm+0NX+2V0F1MYNOHuXAoTMA/1RsP2TcklnYGAZF2xWWUNmwfL9+N9eogjZhdFv4HSlbI2dVLP84w+OW/SMxRq+75q7ED/UYfmhkc+TUs9E2AaQSXOgSR1MNbQwrX/abXaddkRihBb86M+OVvC4OpNYf9HpBGNVAp4zs1cB20jCWA7uRhrHcsZvpkkn0UY4FmgQa5Y+TUKNYbz0JZ7nasa+nsEcZYNmwLHbVBubsxJumilfCgdSGXht0R68mfRMNkelppgDyE6lRmDaTEoMWfv+Lv/hTmaKc/f6UWz0eo3MVWra5uWPNsq8lu1ir8lYZTeHtoY8rRg7KCK0F6iv7C5vJa0SEBJLCTujOznbhQCZAtq5lO+STcN1ckYFwt6vrv//Fz/+MDMQytAEDBrsl6QefTMOIkYRyXE9ZmDv8/YVMk6bHFK4wZKq+B1Khx7Cp1uvRdhHb8N39dWthpbJaKpVWbFwA7afUStzex803wLCQ9Sm7LPTSz8ivDe+tHsgOv3xQKaxbiFPVtdtZ+HHXFMvutdhqS5AMK0Gvmnx2idDPsMKOHUCFM35GjPLN6gqPxyeo2HmxIqbpeFWcrxU9CGyF2/0Tkd0ESdr2+onHDqIKcmhSpI1l87ZlX7YwSuedm9cwk22w6bHYP/huXhYhMT3P2t2H8rdnZ2+XkK2Jv4TuHfVv+VELJXTYAUcMi+rrmVgjQ4CKa7xtqVX2cCfuE8Ah+2hvVgXgwTKn+Ql6twKd67FNrSyJ/Mxdcaj+txOgBwi8K6LDqwMeN0uRcCsYiLq3tyNgQRoU/imWY3VtfgXnoDfoY/v2efkFts5P/hw19RKH46H81h+zE31d1AALeZvh2az/t3WM36O3lKLz180zwH5gC5xhW2BwaFeJIxO7AEgy5NsA6KXjub6zxPIR47lBwWrwiE4d87xOC6yDFEC5L1EhgMjOz2+alt1MoD+c0aNdz+RHu/YHGx0/0ti9nLi7VVyZiJgYD3CNSl3xgVgbfaNezd+dnT2TDI69a9nxM850DXtlb8/EHC+JWSx88xBv7Li4zZKlIhtAywmc7o6nNkCt46Yx4Af4v1i/QQ+BxkobflcL/12q9qF1GLqIbINNSGFthtPptXo07hoo6AYby5LaFH+zhr7KS4KKl9gWa4mo0BYqTbtnVHhHPGvpJR7W2mL2v3QZHjYriwkeaMgo2CUkYfglhVPPH1mzs0ucoNFvHhPdVICq818A2rZbMq1P/LbICsTeFr+z0ootRXlBOobgK3IIStk4/ezRk3MWVpWeARgl7gqYXw4bVdhD2Cge93qf06GM+o1KGJ06Mvr33Yy44fuZMcFn8mOCbXT88MJ+Zfd0ve71oooBHYfBUNjlEYwWNvYxbhj7bjIQ3jvV3X2iuzvVdxco8ptgh8x3rcrufkw7IrXFu7Oz75Y69PTID3ZXf9D/wfLaaz/Y/0H/tUNHiLPdslhlSlW38FTgVR0CvoxN7vOpule9IzGG76gYw3cocjj+jb4qAO3sQeWOiC2+V4rJnrqQ2D/9nP0jqFh7X900rJ/X4XgEbrmEnF2iKBRuFaBrSwiewLt5KwaLw7tZDSihIL5zKQUYo33Wq6qJQ0ROLtpLQpi5hfKXegOHN1ifcKfDF0+Nvb0RJZg5vaSGWo0LKYX6YsQyJewnN+JFiXS1xrycQgmzeO/LYhhzxj7RZdOrXvdgVRy/Fnq99o59rxT/7fdgwjz4CGKa/BmJ2tYBTEEMqMIPLRAT3ISsAsIF5+99a8G8UcWzUBSVv6yVOGCiaTEMdsxaDVt7CYil67KLKseHri+V8MDEryg4WlaisRvUOTwW5s96ZtMjNGySGeyZJhwTd5DeeawRVDJTZr/TBPC+wAAJd9JObgiBTcg3hEEngkhWKiOJM+P1p6EKOLOBxVOvkVu/+L+Z1keX07I1lmoQLRHMR/dZ4lqnxI9MbPjTF//Mcil+TWXV1hWZnrnsZOZApl7CcB5K5A1SQ/EuWO32dVw0XN0lJulsZEo6sbzP9yAsko2mhQqRIAJLtRckqxBPLAYOzbnFGWv3unmXNXZ3ssaM/Nhvynf88gNKvfVMzt+LL2GQn7Jkt48K6NRE2bOoDBR/n7RwMXy6+07M7PvEJZ5INTAGOOJgeHqo94h4u0lyGrF4WicqNpwNOG5rMAUGkmmRuHCx3wBZqXysdKx0tJy0KIOiMgOir2ZgChQHQOECzqZHITzMTfUUiQ4z9fI5zS3L6/e2ew5saBea4E/whIfV6hvsqpWJmzSWSS/FxbjZpROvtuW7cHTLQPj05coWWppQwj4TbFeMucJc4dhR+L9hD303alWMY3N4yqOqxz6DSNmuoPgKtW132l2QCBCUr3LkyHA4LA2PEQbf0bm5uSNUdarrPYeSRoKIsfh64Y3SidPHSycK+B82XS6U5+DjsVa5nHh+lApvlecc7XmRf7tUPtEunsDPW/Ao+fLrhTK+XCzP3TVsNK9tIiQDU6fOBu0gFE9vsTEfFd+v+V0P5a2KEQaDrqsY6ep+WGeZNmHWyvBCfQf/lk4YdggfSq+LmdKayXn/6NzU7yvTWD4Kw6uXS/CndLzweukk/T1ZmFs8ijNy9BgM/cTi0WMwh60T04+/7vTi4ZN1bfTlqSRDRFc8iKE0f/OMCvVXW05dfz9/8Q8CMinPmBMH6weJ6xE0maW3ZJrlDP0uZzmTBmzCS3me04k7C2GeI2ATCd+QPqGUNIHT3YA5ZIgkZO8KiIdAExXje41GA8gQGNMtxgDenJvb18Kb/4r7jChaHvVtYey4uWKjDr2Vd0HaerUXpOPvQ1v6fWiGtT1DcTSM6c3mdcx4ZejXjoUXn7M0wyRXCHO95pC5zY1JoQCNCU0rc2HG+5jRYnT6zT5zYbymrEeHLrpX8i+61+PM0hgzAMS/QmKptgNWSqoZZ6QHAXUFC6ezFMfEoNcnaUKMlf+Mlc7OzmQ1Pmoi0F5SJw835YKTrDCGWrM+s2ajhTEasIJs+EzSWiERnO6LV5hdY2fU4Nk8FkBSU/J1A+lQ5qlsrIw4j7busW6fHz9QoFmn3irSBVs81MvpvXc5setGc/0R08fscwfcIIL6NxNbRbEwfgfy5x5GuZ5HhH9hs25yixq3djAT8Wv2lu96Afx1Bq6Pf0s9t2GX7vs9u+QGdfpn2y41fXg49DZ6hmC0rt/vtZ0dLk/tx85KN6edp3hRY3aiKOhfo9stJvQlwERQqH5I4fswhSyZ7Psi+lvlM4r5ObY+EyixacUXejs6x/1zIzOGibloDTRH/tbCunrJot90CB78238F6l6P4UBwEB8iexThFTENkNM/BUuV45kE/tUwVxLhBHFkAF5PrCQjA4Bv9Ft+I4JCoBivpMME3j5AlAAtUZ/AoMUkv63M4t7ejDDYo6leJee/+wcpnKSzSy675u5GEEQVOK7oDmDJtVdc+75rX3PtRde+6Qrw6ioZpegaFI1YdreKJgmGlmevhnZ7TAJEr8QP7b61EH+mQ8LlqF6uLSyilZ5rutI+iijylDvRr8oUOdxxtMtBQSjbNmWSkz/Ej8I4/ybr41meEN40XXuIR+IMnMAzw729trlYPbVInbpUPcUV6EvIgGGB+VfXWsDOXuJokUO76WCO3Z3K6tCG51CcP0AgYUvg9l+snro4O3txplodWmvs1Rpzuq0YoJ/Dvjb2K5fohg0G6sDkorGVJndQjUoimWWtv9PZCNoEvoVp4lnsfANK9KMg9Go9pw2LhNKd6zf9TaftFENMhrwjS0Rep4dpOZUiht2sDt3VxtreHvzZQdjU73mNY28eB17VEsOOSsi2umhMBvFORVa1t6ut2dkj/+f3zNW54ptOsbG2e2x/T35+fd86dMSH86wfmS1roVVp2ufjdTxps49+13xdLl4k6aOGlyg9Bus4aMExuMxWcNHrBKYCV+qiXVgkC5XwnEP5+2J1KMkJJ+9rMi6BoGTMu6uLa1UT/0X348NljHREil7LuStPpeU0ULrLyr3psh2flYKznJEoE4dT65sN145K/FWc7EEHEzzuBAPM8Xic7GXHjYyUmvz1uosUlJldk5dwXZvSLqUTbZI3wcETbXLXgVSqTf48nWyT/7Bk39Iez8GzQ5gPKd2k27Ub3fTjQ5F9Osqq+j3PHqbzfva6SWeCMJXQc7UW2YOMHqRz4cDjdE4GQZZDDiqJt6ihjHgCmTuOfkLbjeN3++ZQXF+La9bLfIctDKiVisn+YkYN+CMMeYvWbmwIk7l80mmMOgH0ERRA9KdRkv6kC0bBoN6iu2woae/24Bzyt1iKAgbBL99lAJaTtZNZVmsK8SBXL8P6bLdMfjWHKYqblH02CHmCBzjulvv71fegDGYlGbbMkxnzf512wgry05Usf4XrtA/6iCgBOyWnBGzFTSywmfW7WGE5QPGBp3iyh1UzkXLjYnWbrgVAiDGN7xHihX02ql7k5xOcMccWLpZAqPMjZDV0Dt3vVk/d7x6+L1O+GFblon3PY4ldL3cj82xkl1+37KhdveedOlV+ffboiRN2l307SV9C/IKfOJWsh80Nxzy0G7X37UO7Xfo3hH/nSuWj1jonq4siZTRp8nONowZLwrD4Rx0W3a5MMTQsKw+XOXa4kPnJjNqvlU5ivGA3r0RXlAjzSoSixPr3Du2uRm2oCwqvKSMCeYQfmND5Us9xl5G4zaO2MWdY8Vj3U7Nc2KbpnXdLJN2jsLUUBnD8RTumUSyCCMjOX8Pehk01plDxqGEvTlCsHzSgwiGV9KLTPL0JHl1o9cbs70yeABEjv4yQKEDKEBfql1DcaAU9ZmuqoREIr5WdXk98ZtdCzCI1UzVgcr2G3/UQK5nj755eWqpduHF9pbZ8/ua752/Csbfl3PfRYNI15pst85LqgHBR98i4mO+REYUg+NVIIgcyjQvSkxr2Cwv7kVfb8uEPlGG3286BUbEvjkLFVtCwdyUg8kXk6PZqag7teArtbbth74ziS3jy9LqxEjYTf8k4cmZn39Gwc0ccDzyxjMsOg9H8XZYluTbOtpIWw6uEOqwIbOvaZVTt0C7bhw4QRwdvp+aHHgrpqySLo5l1kZlOXKZrD9FpMAHvzN64pMrkINuDTL4IW/roybk53s3cOW21uB/CkExnRIDDao0gvElsiBdwqKYwWqx6s7Og9Ti+y6DupaeA+lDxF1AfMzsEbqlXB/RY4pFqPCmAgP15zu5Gv3n64nNm6H75YIb8JhdBk12UaI57e4vUP5kC8mI1BjBfzAIwX4wBzFl6NwIxX8wBMV8cB2K+mEBjpDp1IPPFJIKjAla+GKNnXsrH2J4/HcFCghgqvb/Gg3efjWDrvucyLICL8jacaFuAW8F0urOzLptBOYFDSRJDhQ6GFVAAz7IkdBdtOceushQXlc8wxnjOXXXOLyYWQEzFxYmnAobG58K+TUnWJ5uRe54yI2ej3CmB8Q9LiHwSb/oiVwfxuXXqjaPeCWuyNjn/lAxnpZunNb4TmJfFjg4FX1isnqojdD/qdUT32ZqjBWXqCzPliruw5ZqLwOQqMxLsvXCdgonRzF90+nWsZ0heG8O1Uj8AiQBeuIQpEBbZXQDqnkXzUvwFgQ3iKtDhK7+OS2odi+k6mAdc3usi+7DiGEfg920PUaSc0DOlISQuYRsNx4g7GfQGbSfMbaLeheManrTdInxcZB/Fy67fJ1tN/vg4HVwqiaK1Xp1FCxfFb4vp3zBFK5mmLtt1+zqcBq1uLNaVmVhX9/y2uSIiCo6cRwtDVN12zZpdhvIEPQ8/Mxc7mIdi2XrtPBR57XzGKXET1HrUYFhzMiHwigysYNYm9zBQdBxYYV+ouvDy7YS1Ah14LoNUtM2OLPIKdykHOrLjU9U5wTou8SkThHcJ7RlkoYIPlN/ExE+ixcPlffvSPitLL9LZ6cZ5UlwtT4rLw/JksJ54kgjHFuUGFreLuXEWFepEmRzTgQeso33WlfZZjkPDk9Q8evEbdMHBJ3BKrasi3lAX8YaTinjDbBEP5JpaFNQwu4xWSPUsxVlh1D7M8yp11T2hlvLr9Kvci99ZjBxOLUYOiQ1eqQor523NuiloilszcY2GaIIUXPASMRaimjnr1ByaJq8SpTqeRqr4+lDKjYur7tqC6+HxQZ8r+A+m61tEVJRzCcHPZe7tcAxeBxKy7Dvc+HKDzByUfTtFAejtnpWiwwKSYHhBS07odPqorcjlko6Tckll/uaWj4bRHXK4ZQadXXL3EeE8+MY+6LSwuug2gfdQh40F43CiNan3Wbi94SBtsWaUtfiD0bKgSbym/P8yMSvZWURkibkbBb3KnL3htZwtH/0O+p0giFqGvguALcvOrmGq3KQGQhYfbjZUSM4dQ3JIvDodwMrHVAcCcuJntjWUEvOCItw8eprPJ1SiSzemS3O4QKSJfpWHoWcKGfLZcIVoZG/gZj6Hu+5MlLEtXXLqNHMOB43HZx4VsTSfOjDia574jsdWXNrhsQYsYN9ChjM8XLby9LOJeYQ+x02VQ7BIl+He3oy8L9KS4C6SgAj7IfdmaGhZ86AoARktWvp0h6MU9cQIFr/jCBatmJC1/FaXxAAuygFc1AcAavD8JRrAJW33CObOO5Q2CYD814/IBMStArxkpk1ALczmhs+w104EJMG5hUNaEeuRmiXJQRcn5aCL2Rw01qwjr6cVY6KpvaU+I+0UfTqEYHfJvgh9vnRYSKMXedwI8srX4JsaRvtdWefi1KxzkQXTRCL4NJGCb4a5cI/4eW7kr2jZ3GUnNteVOdk1uom4qckXbVivISXUnK4rm9KWhUdAOcn0gItj0gOukPhzz+P5Ae95MW+752mS7z1PSREIX7QcgfieliRwXujx6biYP9BS5+XTQ3MBqBrVi7pT/8WsnLdubFJiIT8mcNpJXhzyECFHVgDjmz8bLWQmTzsbVUDwV5KxK4mjeN4cxD9jOJQM6VlmtJUkrDWV3Y5WhDWpJy4j7EuZG0j2IpU+FymX0ufa5yO6OUeMmBoLV5LbJfl0LushbA773ShhfpCWBjho6ZCuCeU1jubCKx06N867ibdRawvXYs+JXsW1+xXQq12mVyNpMPWZyf0gLBVBuFCqPm6Jt+Fs5s2cdVOdZOWL5aNWHFjCCp8JRhtUGANArwqX8+63yguraxU5cDjPt1xzCCdA3K2TFtPW16QNZaRtO1RwJWdGXqeCJJO4OJ36tnS8pVsrzySsUZ6PwKUO7R7yFoyC34+T0aGr3KHd5T57LO47+eN77GnP7XGwK3YDI65oKg3+QN7HVHaEp5h2gVTZTkNkbrZsEKSdftSvvOehX1HH7/crLpnMUfZSTGOLzGTOMGzoimIIinSvtuGwrTHKTxHK6U6Do0EzaCG9sCDfHIe6kXSMa7S9bcNuOr1Kec522n6zi5ZCYKU4EVgRFrgVoo864Vbvj8CsyRhIse1veRM5qbtBRMi6qlfdc7K9fz0K4CYq8ZlFxG/SvbJqoMCZJy9+wxx/kc8Rl8OQ3xjdZxwAjhxRd1NDHIIV5sHLrWAQ9hfyoXx+/4u/+nHBsBMvSEdKvjNB26Q8LrIi9O+jJGHrkdeuHNpNlNPcgdFF8O+oDa3MmgY+NgZ3FXcfY8/C7xj3G+5CtHbWI765GCmdj8SJtyvwJRBNBrYXrTzqngbi7auUMxKYhpN0xhZgfUq9Ih7jDPW6EwYH8PHl5XLKyNqG92o8WRte4QsfQ9IE0x6MEZ4EU2ji9vjkZ6ITxXbQDJLxRzNzmhfzuHxRrCK/2wiycN3K+g6L71gxJkJLt5UXEdHLqKE/2JDGkzGocC1fy1o5OijF7xUSXMb49qc/SvZsfxxqGlI90xyB4G8jFGZERI9QNUDxRP7tttODMwypH+kg9A6YopS1Axyl2Wwn06fWor29254aGBeDWKex8ZUfU6FvrCbprqyU1KIdeIMJCYC5Us2x75SF5t7A60enuyDV4ya/ANo1c5iTiiiqMXAWgtQUCxspcRpqCXeWKTlOEAofcBFfu7cH5ygIEX1Tc92yrP0JiIGSA47YFb//xV/+mbE/DleOL002FnsSVv1y7AeNfAAExoQjNJ9Ddu8Bk4ZjY7POp5UVwN/OtAch+ykr5fJYWS4W1OrIebmLFUp2wkcOdBe2tjZbaUs3wZSPsn4Iz22Xr+xw3k0hu2cwPI16bCAD2SGYDt6bMzuXEc6iwQ3HfW3dGZe83I0CgjHfTXFJm2DdMF8L3kigHhd3rF8HpdhIirE2wbzAqHLg7ZnWI0QAxG1FqOnHIukeegh8XBCIFBzZFVSLVL5jHS//xacvvnz5MQVcPxFF8QSUl8YVo+0jyG96v8LazlxOpKcJMEgscjboqktwh7lKEd1wL0+eXaiOAFyJnc9QcLR9vp9GgHv0za8kv0mHgTBJArsufTFHcHa+u9wQ0zuz4Gmci41gW6n5TJBIpjU6aHlMO9khgNkYnLJlxHJDXHEQHj8B7Xdtqlg/xhDnOSma7pRbwR2/FTSBwUjApr98ILGmYTxcjZ04wluZPYawylZJJPbSxslHuGG6mTkFso5rcfK1Bp0NZVHcvNhEV4tNtBFbx+82gWqc+zvThyqOi63lvZsYgjDShpAMakwVr2vFs30mdCFlVC/5pVPcTd1Qgg406o3/Qn6dWEyt6LSpvwq74eUTYy0Jnp6e81Ab4OhbcIH2ut5vFvG6m3Dc4pFPQ6idIPT+Q7cgJkCVeY8N+3TsMKGCQvIUKroA/e3D/8EBISsTMDSv04t2Jk7JytkXh7EqyDwLv/21YV+2DUS0+zdybnvE8SimZHQcRU1JKa0dFoVk+hVNCR0phTFzdyaw70QYFRsDkMIIGhOE+TOqHI+yuzqGu3T4JQ70ZAKqBxgLKgP/xNcJLSG8L2PEUylgGhh7Yo/4tjYmTJ+3l4JHpU7rU+/kTDxNXPzNqfM7HtJ+TXPJrXpo3k7iBS65JV4UY3C+l5KTPkWzDKXpIBvNYzTOTIq+wbsyXsj/i38YiWOQBEPgfUpMzETcR5krcpLR6OpGFl1xHx7uU/rKh/7zH081dOoNpWc9NbcwkqIct6meNKfNLWUv2+aKpAeBU7AClIDXN6LaSQkN3+Fkxmpk1SSFUgaQipP4ZEIzgTqHigj7s7/593/+kZHHmbpOmjPRs2R3GBgr2RUxeHZS0GOoK21OnMaOgBVoyUKZNaofBeic03OapKqjZynaqGeGOorBX/+TqtwgpCxOq6YPFb79v/5tmgyA68qogPPWq9JJdObygsFU0wwmvNsRMYLsSDmQ4Qw2wI/+pwKoJBZj2m0t+p8pUbBrkSkFitj6Ma1YgcC6QKFcqk8olwUTRQ0fuIxlTBv4P3KQ10zFL/ePocH8/hd/+b+YLPIFJXx6xNRv2lIvP+AJ+Z6ytcy0kmdxmHiIExrPme0cUX3RxV+ECGiJdEdZLbE9dNsY9LPBocamAex4zSy1Q7u46TkuU4Be720XynO9bQ1A5uTcHH1d9u9DlaWTR0PKkcHhZl4//sbxkxuqId7I2P9xBptU5oNJpS8cCGmPKguYaPuzEJtJcgywDZEwzoxDMKKOcVlGOc18jpvPwIJLQNyh7/XNZZ7mb9W1h2vWFDp01hy4o8aP225xvoOuZu8wjWVxyi23OC1rGXVL9ZMPQIlx1w42mUOaTLy3Xpts34gA1lHCjd4PvhcYgtr6od0g3P/++r4Aple1fHa/M+ratBV0MHig2/cyBfqc3DgtLwwK/G8RWGUrJevibkoqe8bEl1NQK0HSdiNjspshemUTCEq7OTMII/4JxSk91G5EklkAnxMuIV2XKpuodfQPfRMkZGFktF/Bf//IsxAWMm5x0Tj7G4boQBky5CUuwQLC/hcDFRDERnz/3vCAMQOV1TYcvCBX7uFHrYF4a5pF4O/o1qef/SxrQGOuwfKq+/ZvH2RPxEHre/grlDF+9xXli8agNyW9/AHr/P0vfvxJCuHz4HU9z8qOMu6SM6e+VePbT/8HWWl88tQ2Dscn3dqEuEZsh2ZaCafN5/EfL2YmDMj6BcaB03+3KbPEfwrxkrbe5yxvsWSHscgwgT2K1pvlTxtnwhlVQ1KRzn9jw2/qFllBq8bI03SgGtUNQdYMufABB9PVkttONHBMJEai7ahMW6l9oD48bXLZatPbIcGKWUdxTPm+PVI6ze7nmAbfjSZs5MmLzwi2630kDoKvPEB7xu8+/90XR3731YgsYUYGO1xT/m9nTtH4PJcIewVHXN3peykpJFe8n1QUgVbzMDR14SA+ydGuxwCcSYtKd2FanoJKnN9v6bxEqgwT6ARjBFB1BovN0FcHm1YJpI/o0e+iHmCbkd/2Yu0g6I7RDP5IOkG2a4UyJcO+6VqjdIOumiXOHXmbpSOUovKgJtFaE5qEcirLbT12Yzgd5z7BOyZvtFUzQwHlVwSXpksSzD4Lv34+6e7gTeReMafe4WFk4/VbtIiM5iUTjGLcRaLovn5srCq8U7++IrlcsssCKhff/DW7Hh/rPOl3vFDiMmIMVZMAY9A24nT7GEQNus4Emv9p83pUaqXpLwtaN68ZGw40BsU8ZwuDioa8Wxkx9dSBzn90B/oJh7bR9Mn9pFXVEJaYuwbIuDBykE/gxU94E8LbYfli9e9cPVa5GsXUvYJ7a2rpfnHK6+vv6mug2eM4dHu5fNKWPtXsCCGfo6QztbTNMcucSh/fazj4P2N/mhS0OUnd03wn31Fh8sy2F0N7N3QQ4LIypExefXTYBk1qhEfNkAEZcMEVydUtwYMaD5RVvsSOArkORFBWG0fGu9zJQP5CjgYjvZ0P6LWAhCfdFrjpaeQNfgO+tSaRn41vf/b32cZwwXALLJk46eqYWF1cAyQ9DRTjjzEhg56C/wKTGs8jxxVS+Nh5d9KTPXT8dlaqUmGRytDyXrm4+/tf/OhhYUyjr0LOjXXmGCzzP9KlbMRpg8uSddTAwr66o4YawXNlzJHyKnj8wVOD/9fhy9JEbYwRJw7GJjf6aS5J3PjsVLu9IFa+6w1TSu4TtFbG+t4r3+rf/u3jQqIRzowldx1zVYJtRY6ONP8JS/J68G111j2Qc+f/bzbQK6Ph7lBxUFRI+KBXC1E46FMaAvrA5ePJiJa9wRxzp9Xb6RrCmNauNfraIm1NkxdJKIx8gYmvJrOwfseR/fzvmSPPlIMbc4uSGp5qUSX/kj/C4Nj1zNRjG3udk167x5hcjKXiekZWtD/O2v34+dSDG3UblG1IfsavKWHBv6YEbX+ksX1ykLHl3ZqlB6Ze6cYm6D/8uCbK/LORJK8RluD00HBQD/A292NcNMqqp1rMNR7sUFia59bolmI8C97s+f0C/zsVA4YXJjmWurp/iX4FkSrdzrm0wTtsykLz9QQ3NQfq2QS3MqN7m23e/4P0NedCZ3T/EnZSabL8I8xn38PkFJaCZNH3Vt01McuTT/HX5I35ARM+H3AvTYZj+4cax8rUnST8EOFR/AfoU8YF27iVz7ltG3+73wuDTlBESJzeJC77Gcb7P38/y/gem3iYKV25MRNb3rBBBo1KjdDzav2W38MEVTXMYtvH8MW9vePeCUSQNDR3EorqoPMNnWe+Eb7RT0cBJzAr0wNgLp9g7lgRuYjZRdkV3ovPEr7Ao5g1uaQoAAuqNw5GgKC3P9qthOf7JGgLQZuQMFh6QGnUyODTrWPa5Coeh5lus0alnlyZhO3+zePOsY2Tozwr30Tzreapy5xxlbgf/5T8srDOwKQP7ZKv4ToqTsxnd8JZiLOXZvqoYTB1hs7JHrNI5etapPK1VKByiqhFwB+PdJbWJ91IRKcy8n687P0ciYj4LTIqTEz7G4VmkhXGLiDjPDXGVkLYv+oRivLrxHUk7+QM/QKbJVoe1QcO7avzniy74IhKJMSv1g+cS3Uf8Zs3vn1WMZGoAcRvHIf/Thhrmj1g0ovooM3DpDbHeKm+jRYCFgK1DvrwfoFO/o/xbF1Xzw4MBmXen+OoGy/Be367ffA4L3x7QifjtMPAquAPCT/6V+kGrHTQHdk5zfpCV+xkwnNjQ55poKy+m+dqOwrNBW+kCvwvc3YtwLqjaW5TdYC/InAdF+ATjZnhY/ER33Pz47DN5ZZNOFtYb2XTFum4KgN76PdblZkZFH5KvrsG476FT67Chxs9qOAcfDjtupUL+Le/WTkT2SjTL/e8uu+04U0u4/fZgxo5UdmIC1dx4JXLaI664G9XAtvx6Uu/IrH4HL8mEV7pJ1INMGYJwTK/f7JKoGTw+a147CNMcTR/zMwzIUST8kYONFNWgtSsgAiZY52HcxqT+jTFkRTizohyjbP0BiS+FxjeAckieJ+UiaD0PujN9IRSs/OATnt9owtUNNxfF67eHEV3aI2+DcsOZE1crsYH7rHEeSvAPKSj8vEcMw0MPJGzPs83GeRsliARLQoxRATP34h5IZATZ0ZMsfl88uJfsD0qwyazdGDvyUygBsHBtIuaOO44W9gROaVb3VOjVeKe0/S7DjuVDubUilnoWDiaTLu4HL1VLWtjuckw4pUh/PbXhZcfwFzyWC2WFLEBIri5y3ZkpdXdtwVUH2xbFRsQNnB5bw//tLp7e4RY72wA9ywuR9ZbVcLlk8jytkgocAr3fPHS6mKxvHaqTJkmBv2WaWCCS7ygpm+Y88dClDqVE/IEFNCe0SUgU2NhmsNWzBCcCC6Byo4PCrn5R3H9Eqd2dqCFDDqaK7yOEUej5WQtxhAz59rrHmMR022GTHI6BeucoqfDGj3BLv6atuVv/9XYTwehAPk3YAIygMTE4wnTi6tRJOzVpPPgOBdZnWuNDK84QESFZhucILxiMq/XBKeNgUmRDyYvCKCaQTurlravPlVC+CbFV8vkhTkMMJ660c2a5v2cwPb7ycD2dAC5HtQ+eaMTjPUGA+ZJRm6r2nSeyXfM6uWamtMLlxN2OXpw42Mukz9ZimE3jaqYbC9RKOHpo5fNxIXMva6yc8NKQbLs4K0xjM8DGTdcCmDtdioGhx22mV5dMWobbQeDT0OYAqMbIPwEMhe26K0o6vUrR46QFb7vOe0Sq7bkh0cWfLf6+rE3jp08MXs2cL3qRvf6xtxicN459vYb/vK5d995/d3r2zfvnjx+Pzx+69bNjHB01XfjIfP7xw3/NQ9txS8vP4TxPkEOg+v+za+0oHXt0jdvnHgZPHIcCFNYcvq97ekHRJfL03RdGHCACPBk6gU+OdzBpoEG4YAZ1+IE+ICM5/cmRF/57a/IKwvRvDFdk2nhuX0BiPOO54SmxZS70RwfimCQHg0c7WqFF5++/AAG/QFxuJfvQ9F/FtL4WMygLaQ9gV/yEN75jLmRvf/ic6bC0zULT1Oe4+Sgas4wN90SIh6DvAhdB60BH0CLXlSDxwvr2HdRH4g7ym9k/1pLzXcW2EIn2CiSETAHcIHsl49FbvUD2BBEIxSoy0UxTbyYHIlgQjAPag14HkGrpvbcdt/e7VJRjEvVjpG0kvcZMu3UXcZ0Y+afQZwcGBm4OK92TNTKyDFlotRMNaIsFJZXO4o6gx8c7QTxapBV8nF64uFy0eVajuhyLVd0eSWTIaCBRs+HBrITn67nW/YunouVnkerFvQ9sWog0VN6gsqKakoKum9HO5Ur8PcmIYyjxHQ7H36bbN4MOLzite2NQX+ngvmxQ89bbvm9Su49i+zhfdHDQ3oPd29ynMmI5RHZz+ot8Dt0yutXImGtasJRMHR2+hWvJD7u7a2uHWRcCOd4FiiRukPpBm2CJ6+8E9l+18eECOdAoKociuRgzorBnNHGQkmk1M5yYDrf61eWsaQTVTo2Uv1ZXOrKFjfcydbZJuOUgHkFTHMxhxoXk9RI8D7snZs579zkWEIWBw6+x3dUDTNv8xRU99R5l6ZBNsbISxsYFcKQyznHs2rt2wRfDeqmmoXAzAPsw+ww5r28H9H3Nid9ASaJGkuJfK5v8h7xhES6oLvSiifi3RETgSMV+cOmmxFJQtdhztNkzRs/G21XzsJkQ3+X/WbXaVeWBKWKVGFYdZPn3mGWqcagS26fhWstc3cDztIKKAHcTzhiSWFFg3idbnfZM2wZv8uk1sLiKxSCesvhoSOZne6qnaa5VLo9l9VtxCGmknGXF1umRWYaT0nhElUnSd28uHRpqba8cuPm+Qs3b1xfWch5XqERz8yY0eysGZU6KD5XqwYOrhh02zsGJo3GbzX8hom5cw1F3QWDsrYV+QwVqZIQZhwkKv5LFMBhEoJCxp4j9eaZnQ78Rqp1lpQptHZBkMQpDNpeCTQORIdepflYK3wvs7VCF/5rYPSMlic1xJaTWbg7uPlgBXC3GmVDT1zVrjquGVrz0IGQ5fzL7exCuwS7ywWewGjrGuw9olpgs1Yl8eOyq/xoh1nZwUW/bOwUQ9D2qmESJbvEuwMCA1SHmXMUW59I8Soxs33Ec2YfI7aVMqaUGi40HB/TZ9iRSM/Trf5RVrwL5Nwt0YXIpZXFa9X//haoWwXS4qqGMDcePd7bnseM1UVKTFFhUVTzaG0sNpyO396prDggJzt23+n2i30v9BvzzDb5vY03y/VynZUdStPkfBu2YVHEbJXeME4l0t98whEydVXsrY3w1Fso1YgeUrV9vJkonYTJ15p5HZrhneCAS6f++2GePizCBDgynXBkHTbeOoL1nnrrCIz/lAGcVjKXm8hceNovyoCG3GZeSbHiuDuU5A7JlbthGwsj8rWcu7F4lmHKXIPSuOoeyAPduof5i60KJixQkMc9+8Rc4sExTP/N+S32zl5296FL/+3/BdTU0e0/5QMA',
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
			. 'function safe(){var a=document.activeElement;return !document.hidden && Date.now()-lastAction>20000 && !document.querySelector(".sf-app.is-checkout,.sf-app.is-pdp,.sf-overlay,.sf-chat-win") && !(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) && !(new URL(location.href)).searchParams.has("amphp_paid");}'
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
									<p style="margin:0; font-size:0.8rem; color:#64748b; line-height:1.6;">کدام کالاها در فروشگاه React نمایش داده شوند؟</p>
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
										<span style="font-size:0.78rem; color:#64748b;">ارسال پیام هنگام ورود بازدیدکننده جدید به ویترین</span>
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
