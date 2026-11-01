<?php
/**
 * Template Name: فروشگاه بومی وردپرس (افزونه فروشگاه)
 * Template Post Type: page
 * Description: ویترین فروشگاه با هدر و فوتر قالب فعال وردپرس و فهرست محصولات ووکامرس.
 *              مناسب به‌عنوان برگه پشتیبان وقتی ویترین اصلی خاموش، خراب یا با خطای ۴۰۴ است.
 *
 * @package AMPHP
 * @version 13.3.38
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

$settings = array();
if ( class_exists( 'Scraper_Auto_Shop_Plugin' ) && is_callable( array( 'Scraper_Auto_Shop_Plugin', 'get_settings' ) ) ) {
	$settings = Scraper_Auto_Shop_Plugin::get_settings();
}
$title    = ! empty( $settings['shop_title'] ) ? (string) $settings['shop_title'] : get_the_title();
$subtitle = ! empty( $settings['shop_subtitle'] ) ? (string) $settings['shop_subtitle'] : '';
$phone    = ! empty( $settings['contact_phone'] ) ? (string) $settings['contact_phone'] : '';
$accent   = ! empty( $settings['accent_color'] ) ? (string) $settings['accent_color'] : '#2563eb';
$shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );
$cart_url = function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/cart/' );
$account  = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : wp_login_url();

/* شورت‌کد سنگین افزونه فقط در صورت فعال‌بودن صریح در تنظیمات */
$allow_plugin_sc = ! empty( $settings['native_embed_plugin_shortcode'] );

/* برچسب واحد پول برای نمایش خالی */
$currency_label = ! empty( $settings['currency_symbol'] ) ? (string) $settings['currency_symbol'] : 'تومان';
?>
<style id="amphp-native-shop-css">
.amphp-native-shop {
  direction: rtl;
  text-align: right;
  font-family: "Vazirmatn", "Sahel", Tahoma, "Iran Sans", system-ui, sans-serif;
}
.amphp-native-hero {
  background: linear-gradient(135deg, <?php echo esc_attr( $accent ); ?> 0%, #0f172a 100%);
  color: #fff;
  padding: 36px 20px 28px;
  margin: 0 0 24px;
  border-radius: 0 0 24px 24px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, .18);
}
.amphp-native-hero .inner { max-width: 1100px; margin: 0 auto; }
.amphp-native-hero h1 {
  margin: 0 0 8px;
  font-size: clamp(1.4rem, 3vw, 2rem);
  font-weight: 900;
  letter-spacing: -0.02em;
}
.amphp-native-hero p {
  margin: 0;
  opacity: .92;
  line-height: 1.85;
  font-weight: 600;
  max-width: 52ch;
}
.amphp-native-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.amphp-native-actions a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 999px;
  font-weight: 800;
  font-size: .9rem;
  text-decoration: none;
  border: 0;
  cursor: pointer;
}
.amphp-native-actions .primary { background: #fff; color: #0f172a; }
.amphp-native-actions .ghost {
  background: rgba(255, 255, 255, .14);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, .35);
}
.amphp-native-wrap {
  max-width: 1100px;
  margin: 0 auto 40px;
  padding: 0 16px;
}
.amphp-native-note {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  padding: 12px 14px;
  font-size: .85rem;
  color: #475569;
  font-weight: 700;
  margin-bottom: 18px;
  line-height: 1.85;
}
.amphp-native-note strong { color: #0f172a; }
.amphp-native-note .amphp-tag {
  display: inline-block;
  background: #e2e8f0;
  color: #0f172a;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: .78rem;
  font-weight: 800;
  margin-right: 4px;
}
.amphp-native-fallback-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  margin-top: 12px;
}
.amphp-native-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(15, 23, 42, .06);
  display: flex;
  flex-direction: column;
  transition: transform .15s ease, box-shadow .15s ease;
}
.amphp-native-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(15, 23, 42, .12);
}
.amphp-native-card img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f1f5f9;
}
.amphp-native-card .body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.amphp-native-card h3 {
  margin: 0;
  font-size: .92rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.55;
}
.amphp-native-card .price {
  color: <?php echo esc_attr( $accent ); ?>;
  font-weight: 900;
  font-size: 1rem;
  margin-top: auto;
  direction: rtl;
}
.amphp-native-card a.btn {
  margin-top: 8px;
  text-align: center;
  background: <?php echo esc_attr( $accent ); ?>;
  color: #fff;
  text-decoration: none;
  font-weight: 800;
  padding: 8px;
  border-radius: 10px;
  font-size: .85rem;
}
.amphp-native-footer-hint {
  margin-top: 28px;
  padding: 14px;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 12px;
  font-size: .82rem;
  color: #155e75;
  font-weight: 700;
  line-height: 1.85;
}
.amphp-native-empty {
  font-weight: 800;
  color: #64748b;
  padding: 24px;
  text-align: center;
  background: #f8fafc;
  border-radius: 14px;
  line-height: 1.85;
}
.amphp-native-section-title {
  margin: 0 0 12px;
  font-size: 1.05rem;
  font-weight: 900;
  color: #0f172a;
}
@media (max-width: 640px) {
  .amphp-native-fallback-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .amphp-native-actions a {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>

<main id="primary" class="site-main amphp-native-shop" role="main" lang="fa" dir="rtl">
  <section class="amphp-native-hero" aria-label="سربرگ فروشگاه">
    <div class="inner">
      <h1><?php echo esc_html( $title ? $title : 'فروشگاه' ); ?></h1>
      <?php if ( $subtitle ) : ?>
        <p><?php echo esc_html( $subtitle ); ?></p>
      <?php else : ?>
        <p>برگهٔ پشتیبان فروشگاه — سبک و پایدار با قالب وردپرس. ویترین اصلی React جداست.</p>
      <?php endif; ?>
      <div class="amphp-native-actions">
        <?php if ( $shop_url ) : ?>
          <a class="primary" href="<?php echo esc_url( $shop_url ); ?>">🛍 ورود به فروشگاه</a>
        <?php endif; ?>
        <?php if ( $cart_url ) : ?>
          <a class="ghost" href="<?php echo esc_url( $cart_url ); ?>">🛒 سبد خرید</a>
        <?php endif; ?>
        <?php if ( $account ) : ?>
          <a class="ghost" href="<?php echo esc_url( $account ); ?>">👤 حساب کاربری</a>
        <?php endif; ?>
        <?php if ( $phone ) : ?>
          <a class="ghost" href="tel:<?php echo esc_attr( preg_replace( '/\s+/', '', $phone ) ); ?>">📞 <?php echo esc_html( $phone ); ?></a>
        <?php endif; ?>
      </div>
    </div>
  </section>

  <div class="amphp-native-wrap">
    <div class="amphp-native-note" role="note">
      این صفحه با <strong>قالب بومی وردپرس</strong> (همان سربرگ و پاصفحهٔ قالب فعال سایت شما) نمایش داده می‌شود و سبک است.
      اگر ویترین اصلی از کار بیفتد یا خطای چهارصدوچهار رخ دهد، بازدیدکننده به همین برگهٔ پشتیبان هدایت می‌شود.
      <?php if ( function_exists( 'WC' ) ) : ?>
        <span class="amphp-tag">منبع کالا: ووکامرس</span>
      <?php else : ?>
        <span class="amphp-tag">ووکامرس فعال نیست — محتوای برگه نمایش داده می‌شود</span>
      <?php endif; ?>
    </div>

    <h2 class="amphp-native-section-title">محصولات</h2>

    <?php
    $rendered = false;

    if ( $allow_plugin_sc && shortcode_exists( 'modern_shop' ) ) {
      echo do_shortcode( '[modern_shop]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
      $rendered = true;
    } elseif ( shortcode_exists( 'products' ) ) {
      echo do_shortcode( '[products limit="24" columns="4" orderby="date" order="DESC"]' ); // phpcs:ignore
      $rendered = true;
    } elseif ( function_exists( 'wc_get_products' ) ) {
      $prods = wc_get_products(
        array(
          'limit'   => 24,
          'status'  => 'publish',
          'orderby' => 'date',
          'order'   => 'DESC',
        )
      );
      echo '<div class="amphp-native-fallback-grid">';
      foreach ( (array) $prods as $p ) {
        if ( ! is_object( $p ) ) {
          continue;
        }
        $img   = $p->get_image_id()
          ? wp_get_attachment_image_url( $p->get_image_id(), 'medium' )
          : ( function_exists( 'wc_placeholder_img_src' ) ? wc_placeholder_img_src() : '' );
        $plink = get_permalink( $p->get_id() );
        $pname = $p->get_name();
        echo '<article class="amphp-native-card">';
        if ( $img ) {
          echo '<a href="' . esc_url( $plink ) . '"><img src="' . esc_url( $img ) . '" alt="' . esc_attr( $pname ) . '" loading="lazy" width="400" height="400"></a>';
        }
        echo '<div class="body">';
        echo '<h3><a href="' . esc_url( $plink ) . '" style="color:inherit;text-decoration:none;">' . esc_html( $pname ) . '</a></h3>';
        $price_html = $p->get_price_html();
        if ( $price_html ) {
          echo '<div class="price">' . wp_kses_post( $price_html ) . '</div>';
        } else {
          echo '<div class="price">قیمت اعلام نشده</div>';
        }
        echo '<a class="btn" href="' . esc_url( $plink ) . '">مشاهده و خرید</a>';
        echo '</div></article>';
      }
      echo '</div>';
      if ( empty( $prods ) ) {
        echo '<p class="amphp-native-empty">هنوز هیچ محصولی در فروشگاه منتشر نشده است.</p>';
      }
      $rendered = true;
    }

    if ( ! $rendered ) {
      while ( have_posts() ) {
        the_post();
        the_content();
      }
      if ( ! get_the_content() ) {
        echo '<p class="amphp-native-empty">فروشگاهی برای نمایش در دسترس نیست. افزونهٔ ووکامرس را فعال کنید یا محصول اضافه نمایید.</p>';
      }
    }
    ?>

    <div class="amphp-native-footer-hint">
      💡 این برگه می‌تواند «فروشگاه پشتیبان» باشد تا در خطای چهارصدوچهار یا خرابی ویترین اصلی، مشتری به اینجا بیاید.
      حتی پس از خاموش‌کردن افزونهٔ ویترین، لینک همین برگه و (در صورت تنظیم) صفحهٔ فروشگاه ووکامرس همچنان کار می‌کند.
      چت پشتیبانی هوشمند (همان ویترین React) از گوشهٔ صفحه در دسترس است.
    </div>
  </div>
</main>
<?php
/* v13.3.38: چت پشتیبانی هوشمند روی قالب بومی — قبل از فوتر هم force می‌شود */
$GLOBALS['amphp_force_native_chat'] = true;
if ( class_exists( 'Scraper_Auto_Shop_Plugin' ) && is_callable( array( 'Scraper_Auto_Shop_Plugin', 'print_native_support_chat_widget' ) ) ) {
	Scraper_Auto_Shop_Plugin::print_native_support_chat_widget();
}
get_footer();
