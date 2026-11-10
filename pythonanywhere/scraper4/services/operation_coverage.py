"""Reviewed operation families, not an endpoint-count or PHP parity percentage."""
FAMILIES = [
 ('profiles','پروفایل‌ها','connected','ساخت، ذخیره، کپی تنظیمات و حذف محلی','کپی محصولات جداگانه در این دامنه نیست'),
 ('listing','استخراج فهرست','connected','موتور، صفحه‌بندی و checkpoint','تأیید دسترسی زندهٔ هر مبدأ جداگانه لازم است'),
 ('queue','کنترل صف','connected','مرحله، مکث، ادامه، لغو و ادامهٔ همان ردیف','درخواست درحال پرواز فوراً لغو نمی‌شود'),
 ('pipeline','زنجیرهٔ استخراج تا ارسال','connected','ثبت زنجیره و پیوند دقیق فرزندان','ماتریس همگام‌سازی راه‌دور جداست'),
 ('results','نتایج و خروجی پایه','connected','آمار محلی، جستجو، صفحه‌بندی، خروجی','آمار محلی اثبات موجودی مقصد نیست'),
 ('audit','گزارش و آزمایش','connected','آزمایش صریح یک/همهٔ پروفایل‌ها و فایل گزارش','تست fixture جای probe میزبان نیست'),
 ('settings','انتقال تنظیمات پشتیبانی‌شده','connected','انتخاب، پیش‌نمایش، رمزگذاری و بازیابی اتمی','بکاپ کل هاست/محصولات/صف خارج از این دامنه است'),
 ('scheduling','زمان‌بندی صف','connected','کران بیرونی، CLI worker و جایگزین مرورگر','وابسته به پلن/مرورگر؛ نه همهٔ poolهای PHP'),
 ('source-api','APIهای مبدأ','partial','Snappshop/Digikala/Basalam بدون مرورگر','همهٔ فیلدهای جزئیات و تنوع APIها باقی است'),
 ('detail','جزئیات محصول','partial','CSS/API، توضیحات، مشخصات و اجرای مستقل','کشف خودکار، وزن/موجودی/قیمت کامل و layouts پیشرفته باقی است'),
 ('selectors','آزمایش سلکتور','partial','آزمایش فهرست/جزئیات و نمونهٔ واقعی','همهٔ CSSهای پیشرفته و JS custom باقی است'),
 ('gallery','گالری','partial','گالری ذخیره‌شده و تست صریح محصول ذخیره‌شده','ویرایش تصویر، proxy تصویر و پیشنهاد خودکار کامل باقی است'),
 ('woo','ارسال ووکامرس','partial','REST پایه، قیمت/عنوان/توضیحات و شناسهٔ مقصد','آپلود رسانه، taxonomy و همهٔ تنوع‌ها باقی است'),
 ('basalam','ارسال باسلام','partial','REST پایه و شناسهٔ مقصد','payload کامل، رسانه و fanout تنوع‌ها باقی است'),
 ('shops','چندغرفه‌ای','partial','توکن و شناسه/قیمت مستقل هر غرفه','fanout/اجرای موازی و گزارش کامل باقی است'),
 ('github','ورود محصولات GitHub','partial','CSV/XLSX عمومی و فهرست فایل/شاخه','مخزن خصوصی و همهٔ عملیات Excel باقی است'),
 ('network','شبکهٔ مبدأ','partial','direct/HTTP proxy و آزمایش امن','inherit-AI، per-profile indirect، relay/DoH/SOCKS باقی است'),
 ('appearance','پوسته و ظاهر','partial','پوستهٔ اصلی جداشده و منوهای هر دو رابط','همهٔ تم‌ها و ماندگاری تنظیمات ظاهر sandbox باقی است'),
 ('notifications','اعلان و گزارش پیام‌رسان','pending','','ارسال اعلان و گزارش‌های زمان‌بندی‌شده'),
 ('ai','هوش مصنوعی و اتوماسیون محتوا','pending','','دسته‌بندی، محتوا، قواعد و عامل‌های AI'),
 ('chat','چت، سفارش و فروشگاه داخلی','pending','','پنل‌ها و workflowهای عملیاتی'),
 ('matrix','ماتریس قیمت/موجودی مقصد','pending','','خواندن زنده، تطبیق و رفع اختلاف‌ها'),
 ('whole-data','انتقال کامل داده‌های PHP','pending','','محصولات/صف/نقشهٔ مقصد و فایل‌های پشتیبانی‌نشده'),
 ('visual-picker','انتخابگر بصری','pending','','انتخاب زندهٔ عناصر صفحه و explorer کامل'),
]


def report():
    rows=[dict(zip(('id','label','status','connected_scope','remaining'),row)) for row in FAMILIES]
    counts={key:sum(row['status']==key for row in rows) for key in ('connected','partial','pending')}
    return {'ok':True,'format':'scraper4-reviewed-operation-families-v1','families':rows,'counts':counts,'total':len(rows),
            'families_with_remaining_work':counts['partial']+counts['pending'],
            'full_php_parity':False,'completion_percentage':None,
            'basis':'۲۴ خانوادهٔ بازبینی‌شده با دامنهٔ مشخص؛ خانواده‌ها هم‌اندازه نیستند و این عدد پوشش همهٔ handlerهای PHP نیست. connected یعنی دامنهٔ نوشته‌شده متصل است، نه کل امکانات PHP یا تأیید زندهٔ میزبان. ۷۱۲ کلید درخواست و تعداد قراردادهای broker، تعداد عملیات نیستند.'}
