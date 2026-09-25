/** Evidence from this engine's actual rows, never from another engine or the initial HTML. */
export function benchmarkEvidence(engine:string,products:any[],error='',parser?:string,previous:any={}){
 const sample=products[0]?Object.fromEntries(['title','price','priceText','url','image','sku'].map(k=>[k,k==='price'?(Number.isFinite(Number(products[0][k]))?Number(products[0][k]):0):String(products[0][k]||'').slice(0,2048)])):null;
 const complete={title:products.filter(p=>p.title).length,price:products.filter(p=>p.price>0).length,link:products.filter(p=>p.url).length,image:products.filter(p=>p.image).length};
 let failure:any=null;
 const libs=[...new Set([...error.matchAll(/error while loading shared libraries:\s*([^\s:]+)|((?:lib)[\w.+-]+\.so(?:\.\d+)*)\s*=>\s*not found/g)].map(m=>m[1]||m[2]))];
 if(libs.length||/Host system is missing dependencies/.test(error))failure={category:'missing-os-libraries',missingLibraries:libs,hint:'مرورگر موجود است ولی وابستگی Ubuntu نصب نیست؛ دانلود دوباره یا تغییر سلکتور کمکی نمی‌کند. دستور زیر را در پوشهٔ پروژه با دسترسی مدیر اجرا کنید؛ apt از gateway دانلود مرورگر عبور نمی‌کند.',command:'node node_modules/playwright/cli.js install-deps chromium'};
 else if(/Could not find (?:Chrome|Chromium)|Executable doesn't exist/i.test(error))failure={category:'missing-browser',hint:'نسخهٔ مرورگر مورد نیاز در کش کاربر سرویس نیست. از بخش نصب و تعمیر مرورگر استفاده کنید؛ وجود پوشهٔ کش به‌تنهایی کافی نیست. شکست دانلود gateway را در گزارش نصب بررسی کنید.'};
 else if(/Failed to launch browser|browserType.launch/i.test(error))failure={category:'browser-launch',hint:'راه‌اندازی مرورگر شکست خورد؛ علت داخلی و گزارش نصب مرورگر را بررسی کنید. موفقیت موتور HTTP، سلامت مرورگر را ثابت نمی‌کند.'};
 const browser=['playwright','puppeteer','crawlee_playwright','network_api'].includes(engine);
 return {...(previous||{}),engine,extracted:products.length,complete,sample,signals:{...(previous?.signals||{}),loader:browser?engine:'http',...(parser?{productParser:parser}:{})},...(parser?{productParser:parser,candidates:null,hint:'پارسر HTML ثابت: '+parser+'؛ موتورهای غیرمرورگری همگی HTTP می‌خوانند؛ این مقایسه آزمون مستقل parserهای نام‌برده نیست.'}:{}),...(error?{dropReasons:[error]}:{}),...(failure?{failure,hint:failure.hint}:{})};
}
export function incompatibleBenchmark(engine:string,parser?:string){
 if(engine!=='network_api'||!parser)return null;
 const hint='Network API پاسخ JSON را می‌خواند، نه HTML؛ برای آزمون مستقل آن، کلید پارسر مرحلهٔ دوم را خاموش کنید. تنظیمات شما خودکار تغییر نکرد.';
 return {engine,productParser:parser,ok:false,available:true,status:'incompatible',skipped:true,elapsedMs:0,pagesScanned:0,products:0,productsPerMinute:0,sample:null,diagnosis:{engine,extracted:0,sample:null,complete:{title:0,price:0,link:0,image:0},signals:{compatible:false},hint,failure:{category:'incompatible-parser',hint},dropReasons:[]}};
}
