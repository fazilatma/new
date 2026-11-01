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
		delete_transient( 'scraper_shop_cached_products' );
		wp_cache_flush();
	}

	/**
	 * Initialize plugin hooks.
	 */
	public static function init() {
		// Admin menu
		add_action( 'admin_menu', array( __CLASS__, 'register_admin_menus' ) );

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
				foreach ( $data as $p_key => $p_item ) {
					if ( ! is_array( $p_item ) ) {
						continue;
					}
					$raw_prods = $p_item['products'] ?? array();
					if ( ! is_array( $raw_prods ) ) {
						continue;
					}
					/* productsOrder: ترتیب نمایش اگر باشد */
					$order = $p_item['productsOrder'] ?? $p_item['products_order'] ?? null;
					$ordered_entries = array();
					if ( is_array( $order ) && $order ) {
						$map = array();
						foreach ( $raw_prods as $ek => $entry ) {
							if ( is_array( $entry ) && isset( $entry[1] ) && is_array( $entry[1] ) ) {
								$k = (string) ( $entry[0] ?? $ek );
								$map[ $k ] = $entry;
							} elseif ( is_array( $entry ) && ( isset( $entry['title'] ) || isset( $entry['name'] ) ) ) {
								$k = (string) ( $entry['key'] ?? $ek );
								$map[ $k ] = $entry;
							} else {
								$map[ (string) $ek ] = $entry;
							}
						}
						$used = array();
						foreach ( $order as $ok ) {
							$ok = (string) $ok;
							if ( isset( $map[ $ok ] ) ) {
								$ordered_entries[] = $map[ $ok ];
								$used[ $ok ] = true;
							}
						}
						foreach ( $map as $mk => $mv ) {
							if ( empty( $used[ $mk ] ) ) {
								$ordered_entries[] = $mv;
							}
						}
					} else {
						foreach ( $raw_prods as $entry ) {
							$ordered_entries[] = $entry;
						}
					}

					foreach ( $ordered_entries as $entry ) {
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
						$uid  = $pkey !== '' ? ( 'k:' . $pkey ) : ( 'h:' . $hash );
						if ( isset( $seen[ $uid ] ) || isset( $seen[ 'h:' . $hash ] ) ) {
							continue;
						}
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
							'id'                  => $hash,
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
		foreach ( $woo_temps as $woo_temp ) {
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
		$need_woo = ( $source === 'merge' ) || empty( $products );
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
		if ( empty( $products ) ) {
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
		if ( ! defined( 'SCRAPER4_NO_RENDER' ) ) {
			define( 'SCRAPER4_NO_RENDER', true );
		}
		$ob = ob_get_level();
		@ob_start();
		try {
			require_once $scraper_file;
			$ok = function_exists( 'matrixBuild' ) && function_exists( 'matrixQueryPage' );
		} catch ( \Throwable $e ) {
			error_log( 'matrix engine load: ' . $e->getMessage() );
			$ok = false;
		}
		while ( ob_get_level() > $ob ) {
			@ob_end_clean();
		}
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
				'sslverify'   => false,
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

		if ( ! defined( 'SCRAPER4_NO_RENDER' ) ) {
			define( 'SCRAPER4_NO_RENDER', true );
		}

		$ob_level = ob_get_level();
		@ob_start();
		try {
			require_once $scraper_file;
			$loaded = function_exists( 'aiMasterKey' )
				|| function_exists( 'aiCandidates' )
				|| function_exists( 'aiProviderCall' );
		} catch ( \Throwable $e ) {
			error_log( 'Error loading scraper4 AI engine: ' . $e->getMessage() );
			$loaded = false;
		}
		while ( ob_get_level() > $ob_level ) {
			@ob_end_clean();
		}

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
			. "دسترسی زنده به داده فروشگاه (محصولات، سفارش‌ها، آمار):\n"
			. $catalog_ctx . "\n\n"
			. "قوانین پاسخ:\n"
			. "۱. فقط بر اساس داده بالا جواب بده؛ اگر نبود بگو در دسترس نیست.\n"
			. "۲. برای قیمت/موجودی از کاتالوگ دقیق نقل کن.\n"
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

			$reply = $greeting_prefix . "درباره «{$p_title}»، این محصول هم‌اکنون با قیمت {$p_price} در انبار موجود و آماده ثبت سفارش است.";
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
		self::maybe_send_analytics_messenger_notification( $event_type, $meta, $settings );

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
		$allowed    = array( 'site_visit', 'product_view', 'add_to_cart', 'checkout_step', 'order_placed' );
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

	/**
	 * WooCommerce hook when a real order is placed.
	 */
	public static function on_wc_order_created( $order_id, $order = null ) {
		if ( ! $order && function_exists( 'wc_get_order' ) ) {
			$order = wc_get_order( $order_id );
		}
		$total = $order ? $order->get_total() : 0;
		$name  = $order ? ( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) : '';
		$phone = $order ? $order->get_billing_phone() : '';
		self::record_analytics_event( 'order_placed', array(
			'order_id'       => '#' . $order_id,
			'amount'         => $total,
			'customer_name'  => trim( $name ),
			'customer_phone' => $phone,
			'details'        => 'سفارش آنلاین ووکامرس',
		) );
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
	public static function find_raw_scraped_product( $id ) {
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
				if ( $hash === $id || $pkey === $id || (string) ( $prod['id'] ?? '' ) === $id ) {
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
			$master_ai = self::get_scraper_master_ai_model( $settings );
			$model_lbl = ! empty( $master_ai['model_name'] ) ? $master_ai['model_name'] : $model_lbl;
			$ai_reply  = self::generate_ai_support_reply( $_ai_msg, $thread['name'], $settings );
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

				// Track analytics
				try {
					self::ajax_track_analytics_event_internal( 'order_placed', array(
						'order_id' => $order_id,
						'total'    => $total,
					) );
				} catch ( \Throwable $e ) {}

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
<link rel="stylesheet" href="<?php echo esc_url( $css_url ); ?>?ver=<?php echo esc_attr( $ver ); ?>" id="amphp-storefront-css">
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
<script src="<?php echo esc_url( $js_url ); ?>?ver=<?php echo esc_attr( $ver ); ?>" id="amphp-storefront-js"></script>
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
		<link rel="stylesheet" href="<?php echo esc_url( $css_url ); ?>?ver=<?php echo esc_attr( $ver ); ?>" id="amphp-storefront-css" />
		<?php endif; ?>
		<div id="amphp-storefront-root" class="amphp-storefront-root" data-engine="react" dir="rtl">
			<div class="amphp-sf-bootwait" style="padding:32px 16px;text-align:center;font-family:Tahoma,sans-serif;color:#64748b;font-size:.95rem;font-weight:700;">در حال بارگذاری…</div>
		</div>
		<script id="amphp-storefront-boot">
		window.AMPHP_STOREFRONT = <?php echo $boot_json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
		</script>
		<?php if ( empty( $bare_assets ) ) : ?>
		<script src="<?php echo esc_url( $js_url ); ?>?ver=<?php echo esc_attr( $ver ); ?>" id="amphp-storefront-js"></script>
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
		$js = self::storefront_asset_path( 'storefront.js' );
		if ( $js && is_readable( $js ) ) {
			$parts[] = substr( md5_file( $js ), 0, 10 );
		} else {
			$pack = self::get_embedded_storefront_assets();
			$gz = (string) ( $pack['storefront.js']['gz'] ?? '' );
			$parts[] = $gz !== '' ? substr( md5( $gz ), 0, 10 ) : 'embed';
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
