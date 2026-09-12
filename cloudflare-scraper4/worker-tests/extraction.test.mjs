import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {load} from 'cheerio';

const temporary=await mkdtemp(join(tmpdir(),'scraper4-extraction-'));
await build({entryPoints:{scraper:new URL('../worker-src/scraper.ts',import.meta.url).pathname,network:new URL('../worker-src/network.ts',import.meta.url).pathname,env:new URL('../worker-src/env.ts',import.meta.url).pathname,app:new URL('../worker-src/app.ts',import.meta.url).pathname,catalog:new URL('../worker-src/ai-catalog.ts',import.meta.url).pathname,schema:new URL('../worker-src/schema.ts',import.meta.url).pathname},bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',outdir:temporary,entryNames:'[name]',outExtension:{'.js':'.mjs'}});
const scraper=await import(pathToFileURL(join(temporary,'scraper.mjs'))),network=await import(pathToFileURL(join(temporary,'network.mjs'))),env=await import(pathToFileURL(join(temporary,'env.mjs'))),app=await import(pathToFileURL(join(temporary,'app.mjs'))),catalog=await import(pathToFileURL(join(temporary,'catalog.mjs')));
const HTML_VOID_TAGS=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

class CheerioHTMLRewriter {
  constructor(){this.registrations=[]}
  on(selector,handler){load('<i></i>')(selector);this.registrations.push({selector,handler});return this}
  transform(response){return new Response(new ReadableStream({start:async controller=>{try{const source=await response.text(),$=load(source,{decodeEntities:true}),roots=$.root().contents().toArray();for(const root of roots)this.#walk($,root,[]);controller.enqueue(new TextEncoder().encode($.html()));controller.close()}catch(error){controller.error(error)}}}))}
  #walk($,node,active){
    if(node.type==='text'){for(const handler of active)handler.text?.({text:node.data||'',lastInTextNode:true});return}
    if(node.type==='comment')return;
    const matching=[];
    if(node.type==='tag')for(const registration of this.registrations)if($(node).is(registration.selector))matching.push(registration.handler);
    const callbacks=[],wrapper={
      tagName:node.name,getAttribute:name=>node.attribs?.[name]??null,setAttribute:(name,value)=>$(node).attr(name,value),removeAttribute:name=>$(node).removeAttr(name),
      before:(value)=>$(node).before(value),after:(value)=>$(node).after(value),remove:()=>$(node).remove(),onEndTag:callback=>{if(HTML_VOID_TAGS.has(String(node.name).toLowerCase()))throw Error('Parser error: No end tag.');callbacks.push(callback)},
      get attributes(){return Object.entries(node.attribs||{})}
    };
    for(const handler of matching)handler.element?.(wrapper);
    const scoped=[...active,...matching];for(const child of [...(node.children||[])])this.#walk($,child,scoped);
    for(const callback of callbacks.reverse())callback();
  }
}
globalThis.HTMLRewriter=CheerioHTMLRewriter;
const fixture=async name=>readFile(new URL(`./fixtures/${name}`,import.meta.url),'utf8');

test('list extraction handles nested text, Persian price, element attributes, smart links, descendants and stable dedup keys',async()=>{
  const html=await fixture('list-fa.html'),selectors={container:'li.product',title:'.woocommerce-loop-product__title, [data-title]',price:'.price, [data-price]',link:'.woocommerce-loop-product__title a, a.product-link',image:'.product-media, a.product-link',sku:'[data-sku]'};
  const products=await scraper.parseCards(html,'https://shop.example/catalog',selectors);
  assert.equal(products.length,2);assert.equal(products[0].title,'کفش پیاده روی');assert.equal(products[0].price,2_500_000);assert.equal(products[0].sku,'SKU-ATTR-1');
  assert.equal(products[0].url,'https://shop.example/product/kafsh?color=red');assert.equal(products[0].image,'https://shop.example/img/a-1200.webp');
  assert.equal(products[1].title,'کیف چرمی');assert.equal(products[1].price,950_000);assert.equal(products[1].url,'https://shop.example/product/bag');assert.equal(products[1].image,'https://shop.example/img/bag.jpg');
  const trackingChanged=html.replace('utm_source=test&color=red','utm_campaign=other&color=red'),again=await scraper.parseCards(trackingChanged,'https://shop.example/catalog',selectors);assert.equal(again[0].sourceKey,products[0].sourceKey);
});

test('Cloudflare void elements never request an end tag while extracting Tailwind product cards',async()=>{
  const html='<main><div class="flex flex-shrink flex-col"><a class="flex w-full grow" href="/product/902"><img class="aspect-[1/1.2] h-full w-full" src="/product.jpg"><div class="my-1 line-clamp-2 h-12">محصول برف</div><div class="flex flex-row items-center">۷۶۹٬۰۰۰ تومان</div></a></div></main>';
  const selectors={container:'div.flex.flex-shrink.flex-col',title:'div.my-1.line-clamp-2.h-12',price:'div.flex.flex-row.items-center',link:'a.flex.w-full.grow',image:'img.aspect-\\[1\\/1\\.2\\].h-full.w-full'};
  const products=await scraper.parseCards(html,'https://barfbox.ir/search/?page=1',selectors);
  assert.equal(products.length,1);assert.equal(products[0].title,'محصول برف');assert.equal(products[0].price,769000);assert.equal(products[0].url,'https://barfbox.ir/product/902');assert.equal(products[0].image,'https://barfbox.ir/product.jpg');
});

test('product links support data-product attributes and simple onclick navigation',async()=>{
  const html=`<main><article class="card"><h2>اول</h2><span class="go" data-product-url="/product/one?utm_source=x"></span><b class="price">۱۰۰</b></article><article class="card"><h2>دوم</h2><span class="go" data-product-link="/product/two"></span><b class="price">۲۰۰</b></article><article class="card"><h2>سوم</h2><button class="go" onclick="window.location.href='/product/three'">برو</button><b class="price">۳۰۰</b></article></main>`;
  const products=await scraper.parseCards(html,'https://shop.example/list',{container:'.card',title:'h2',price:'.price',link:'.go',image:''});
  assert.deepEqual(products.map(product=>product.url),['https://shop.example/product/one','https://shop.example/product/two','https://shop.example/product/three']);
});

test('detail extraction uses one parse, reads attribute values and gallery descendants, sanitizes HTML and groups variations',async()=>{
  const html=await fixture('detail-fa.html'),detail=await scraper.parseDetailPage(html,'https://shop.example/product/kafsh',{sku:'.summary',brand:'.brand',stock:'.stock',longDesc:'#description',gallery:'.woocommerce-product-gallery',variations:'.variations'});
  assert.equal(detail.sku,'DETAIL-123');assert.equal(detail.brand,'برند نمونه');assert.equal(detail.stock,'موجودی: 12 عدد');
  assert.ok(detail.images.includes('https://shop.example/media/full-1.jpg'));assert.ok(detail.images.includes('https://shop.example/media/pic-1600.webp'));assert.ok(detail.images.includes('https://shop.example/media/large.jpg'));
  assert.doesNotMatch(detail.longDesc,/<script|\sonclick=|javascript:/i);assert.match(detail.longDesc,/توضیح/);
  assert.ok(detail.variations.includes('red'));assert.ok(detail.variations.includes('blue'));assert.ok(detail.variations.includes('L'));assert.equal(detail.variationPrices.red,120000);assert.equal(detail.variationPrices.L,135000);
  assert.ok(detail.variationGroups.some(group=>group.name==='attribute_pa_color'&&group.values.includes('red')));assert.ok(detail.variationGroups.some(group=>group.name==='اندازه'&&group.values.includes('L')));
});

test('gallery supports newline and pipe selectors, dimensional/query dedupe, max, skip-first, tags and detail image',async()=>{
  const html=`<section class="meta"><span class="tags">کفش، ورزشی</span><div class="hero"><img data-large_image="/media/main.jpg"></div></section><div class="g1"><img src="/media/photo-300x300.jpg?size=small"></div><div class="g2"><img src="/media/photo.jpg#full"></div><div class="g3"><a href="/media/second.webp"><img src="/media/second-150x150.webp"></a></div><div class="g4"><img src="/media/third.png"></div>`;
  const selector='.g1 img\n.g2 img|.g3\n.g4 img';
  const limited=await scraper.parseDetailPage(html,'https://shop.example/product/x',{tags:'.tags',detailImage:'.hero',gallery:selector,galleryMax:2});
  assert.equal(limited.tags,'کفش، ورزشی');assert.equal(limited.mainImage,'https://shop.example/media/main.jpg');
  assert.deepEqual(limited.images,['https://shop.example/media/photo-300x300.jpg?size=small','https://shop.example/media/second.webp']);
  const skipped=await scraper.parseDetailPage(html,'https://shop.example/product/x',{gallery:selector,galleryMax:2,gallerySkipFirst:true});
  assert.deepEqual(skipped.images,['https://shop.example/media/second.webp']);
});

test('PHP profile normalization keeps list and detail image selectors separate and maps every gallery mode',()=>{
  const base={id:'php-profile',name:'نمونه',url:'https://shop.example/list',selectors:{container:'.card',title:'h2',price:'.price',link:'a',image:'.list-image'},detailSelectors:{shortDesc:{enabled:true,selector:'.summary'},image:{enabled:true,selector:'.hero'},tags:{enabled:true,selector:'.tags'},brand:{enabled:false,selector:'.disabled'}}};
  const manual=app.normalizeProfile({...base,gallery:{mode:'manual',selectors:'.a img\n.b img',max:2,skip_first:true}});
  assert.equal(manual.selectors.image,'.list-image');assert.equal(manual.selectors.detailImage,'.hero');assert.equal(manual.selectors.shortDesc,'.summary');assert.equal(manual.selectors.tags,'.tags');assert.equal(manual.selectors.brand,undefined);assert.equal(manual.selectors.gallery,'.a img\n.b img');assert.equal(manual.selectors.galleryMax,2);assert.equal(manual.selectors.gallerySkipFirst,true);
  const auto=app.normalizeProfile({...base,gallery:{mode:'auto',box:'.gallery',max:99}});assert.equal(auto.selectors.gallery,'.gallery');assert.equal(auto.selectors.galleryMax,30);
  const numbered=app.normalizeProfile({...base,gallery:{mode:'number',pattern:'.slide-{n} img',from:1,to:3,max:10}});assert.equal(numbered.selectors.gallery,'.slide-1 img\n.slide-2 img\n.slide-3 img');
  const off=app.normalizeProfile({...base,gallery:{mode:'off'}});assert.equal(off.selectors.gallery,'');
  const stringFlag=app.normalizeProfile({...base,selectors:{...base.selectors,gallerySkipFirst:'false'}});assert.equal(stringFlag.selectors.gallerySkipFirst,false);
  assert.throws(()=>app.normalizeProfile({...base,selectors:{...base.selectors,container:''}}),/container/);
});

test('JSON-LD completes partially rendered cards and provides detail variants without overriding gallery off',async()=>{
  const html=`<article class="card"><a href="/p/red"><h2>عطر قرمز</h2></a></article><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"عطر قرمز","url":"https://shop.example/p/red","image":["/img/main.jpg","/img/second.jpg"],"sku":"JSON-1","description":"توضیح ساختاریافته","offers":{"price":"۱۲۵۰۰۰","availability":"https://schema.org/OutOfStock"},"keywords":["عطر","قرمز"],"hasVariant":[{"@type":"Product","name":"قرمز 50 میل","color":"قرمز","size":"50 میل","image":"/img/variant.jpg","offers":{"price":"۱۳۵۰۰۰"}}]}</script>`;
  const cards=await scraper.parseCards(html,'https://shop.example/list',{container:'.card',title:'h2',link:'a',price:'.missing',image:'.missing'});
  assert.equal(cards.length,1);assert.equal(cards[0].price,125000);assert.equal(cards[0].image,'https://shop.example/img/main.jpg');assert.equal(cards[0].sku,'JSON-1');assert.equal(cards[0].shortDesc,'توضیح ساختاریافته');assert.equal(cards[0].stock,0);
  const withoutDomLink=await scraper.parseCards(html.replace('<a href="/p/red">','<div>').replace('</a>','</div>'),'https://shop.example/list',{container:'.card',title:'h2',link:'.missing',price:'.missing',image:'.missing'});assert.equal(withoutDomLink.length,1);assert.equal(withoutDomLink[0].url,'https://shop.example/p/red');assert.equal(withoutDomLink[0].sku,'JSON-1');
  const off=await scraper.parseDetailPage(html,'https://shop.example/p/red',{gallery:''});assert.equal(off.mainImage,'https://shop.example/img/main.jpg');assert.deepEqual(off.images,[]);assert.ok(off.variations.includes('قرمز'));assert.ok(off.variations.includes('50 میل'));assert.equal(off.variationPrices['قرمز'],135000);
  const skipped=await scraper.parseDetailPage('<div class="gallery"><img src="/only.jpg"></div>','https://shop.example/p/red',{gallery:'.gallery',gallerySkipFirst:true});assert.deepEqual(skipped.images,[]);
});

test('heuristic auto extraction accepts only real product-card candidates with title image and price',async()=>{
  const html=`<main>
      <nav><a href="/products/help">Products help</a></nav>
      <article class="card"><a href="/product/real-shirt"><img src="/shirt.jpg" alt="Real Shirt"><h2>Real Shirt</h2><span>$25.00 USD</span></a></article>
      <article class="card"><a href="/product/no-image"><h2>No Image</h2><span>$30.00 USD</span></a></article>
      <article class="card"><a href="/product/no-price"><img src="/blank.jpg" alt="No Price"><h2>No Price</h2></a></article>
    </main>`;
  const products=await scraper.extractHeuristicProducts(html,'https://example.test/search/shirts');
  assert.equal(products.length,1);assert.equal(products[0].title,'Real Shirt');assert.equal(products[0].image,'https://example.test/shirt.jpg');assert.equal(products[0].price,25);
});

test('main extraction reaches the selected speed-test engine after earlier discovery engines are empty',async()=>{
  const html=`<main><article class="card"><a href="/product/bench-winner"><img src="/winner.jpg" alt="Benchmark Winner"><h2>Benchmark Winner</h2><span>$42.00 USD</span></a></article></main>`;
  const previousFetch=globalThis.fetch;
  env.configureEnv({DB:{prepare(){return {bind(){return this},first:async()=>null,all:async()=>({success:true,results:[]}),run:async()=>({success:true,meta:{}})}},batch:async()=>[],exec:async()=>({count:0,duration:0})}});
  globalThis.fetch=async()=>new Response(html,{headers:{'content-type':'text/html'}});
  try{
    const result=await scraper.scrapeListPage('https://example.test/search',{},'',false,'heuristic');
    assert.equal(result.usedEngine,'heuristic');
    assert.equal(result.products.length,1);
    assert.equal(result.products[0].title,'Benchmark Winner');
  }finally{globalThis.fetch=previousFetch}
});

test('metadata extraction rejects category page metadata that would turn the whole page into one product',async()=>{
  const listHtml=`<html><head><title>Shirts | Store</title><meta property="og:type" content="website"><meta property="og:title" content="Shirts | Store"><meta property="og:image" content="/hero.jpg"></head><body><h1>All Shirts</h1></body></html>`;
  const detailHtml=`<html><head><title>Real Shirt</title><meta property="og:type" content="product"><meta property="og:title" content="Real Shirt"><meta property="og:image" content="/shirt.jpg"><meta property="product:price:amount" content="25.00"></head></html>`;
  assert.deepEqual(await scraper.extractMetadataProduct(listHtml,'https://shop.example/search/shirts'),[]);
  const products=await scraper.extractMetadataProduct(detailHtml,'https://shop.example/product/real-shirt');
  assert.equal(products.length,1);assert.equal(products[0].title,'Real Shirt');assert.equal(products[0].price,25);assert.equal(products[0].image,'https://shop.example/shirt.jpg');
});

test('pagination URL construction matches every PHP mode and drops stale path query strings',()=>{
  const profile=(pagination,paginationValue,url='https://shop.test/catalog?sort=asc#items')=>({url,pagination,paginationValue});
  assert.equal(scraper.pageUrl(profile('query_page','wrong'),3),'https://shop.test/catalog?sort=asc&page=3');
  assert.equal(scraper.pageUrl(profile('query_page','wrong','https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=336'),2),'https://snappshop.ir/category/kitchen-appliances?is_available=true&sort=50aLgW&page=337');
  assert.equal(scraper.pageUrl(profile('query_custom','paged'),2),'https://shop.test/catalog?sort=asc&paged=2');
  assert.equal(scraper.pageUrl(profile('query_custom',''),4),'https://shop.test/catalog?sort=asc&paged=4');
  assert.equal(scraper.pageUrl(profile('path_pattern','/p/{page}/','https://shop.test/catalog/page/7/?sort=asc#items'),5),'https://shop.test/catalog/p/5/');
  assert.equal(scraper.pageUrl(profile('full_pattern','','https://shop.test/catalog'),2),'');
  assert.equal(scraper.pageUrl(profile('full_pattern','https://cdn.test/{page}/x/{page}','https://shop.test/catalog'),8),'https://cdn.test/8/x/8');
  assert.equal(scraper.pageUrl(profile('next_selector','.next'),2),'https://shop.test/catalog?sort=asc#items');
});

test('response decoding honors declared legacy encodings and BOMs',()=>{
  const windows1252=Uint8Array.from([0x63,0x61,0x66,0xe9]);assert.equal(network.decodeResponseBody(windows1252,'text/html; charset=windows-1252'),'café');
  const utf16=Uint8Array.from([0xff,0xfe,0x33,0x06,0x44,0x06,0x27,0x06,0x45,0x06]);assert.equal(network.decodeResponseBody(utf16,'text/html'),'سلام');
});

test('hamburger menu preserves PHP order, count, dimensions and moves CSV transfer into products',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),expected=['💾 ذخیره و بازیابی همهٔ تنظیمات','📜 گزارش تغییرات کد','🔄 نسخهٔ کد','🛒 ووکامرس','🏪 باسلام','🤖 هوش مصنوعی','🔔 اعلان‌ها','🗂 محصولات رفته از مبدأ','⚙️ تنظیمات عمومی','🩺 نگهبان صف ارسال','🌐 اتصال به سایت مبدأ','🔍 مغایرت‌گیری با مقصد','🧠 یادگیری دسته‌بندی','✏️ مدیریت جامع محصولات مقصد','🧬 حذف تکراری‌های مقصد (سرورساید)','🖼 عکس‌دار کردن محصولات ووکامرس','🤖 پاسخ خودکار به مشتریان','🌙 گزارش شبانهٔ محصولات','📊 آمار محصولات هر پروفایل'];
  const block=source.slice(source.indexOf('const menuDefs='),source.indexOf('];',source.indexOf('const menuDefs='))),titles=[...block.matchAll(/^ \['([^']+)'/gm)].map(match=>match[1]);assert.deepEqual(titles,expected);assert.doesNotMatch(block,/product-transfer|درون‌ریزی و برون‌ریزی محصولات/);
  assert.match(source,/\.hamburger\{[^}]*width:44px;height:44px/);assert.match(source,/\.drawer\{[^}]*width:400px;max-width:90vw/);assert.match(source,/id="pane-products"[\s\S]*id="transferProfile"/);
});

test('nontechnical settings UI uses visual editors and comprehensive clickable test-result modals',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/id="(?:importJson|aiImportBox)"/);assert.match(source,/id="profileImportFile"/);assert.match(source,/id="basalamShopsList"/);assert.match(source,/id="aiProvidersList"/);assert.match(source,/data-ai-row/);assert.match(source,/data-ai-sort/);assert.match(source,/data-ai-filter/);assert.match(source,/نتیجهٔ دسته‌بندی/);assert.match(source,/categoryTitle/);assert.match(source,/پاسخ خام دسته‌بندی/);assert.match(source,/data-ai-retry="message"/);assert.match(source,/data-ai-retry="category"/);assert.match(source,/function retryAiPart/);assert.match(source,/aiSkipTimeoutMs/);assert.match(source,/ai.skipTimeoutMs/);assert.match(source,/پاسخ خام مدل/);assert.match(source,/استعلام جامع ووکامرس/);assert.match(source,/نتیجهٔ جامع تست پاسخ خودکار/);assert.match(source,/نتیجهٔ بررسی نگهبان صف/);assert.match(source,/api\/ai\/test-results/);assert.match(source,/category-export'[\s\S]*api\('\/api\/category-learning\?limit=5000'/);assert.match(source,/if\(full\)await connect\(\)/);assert.match(source,/id="pane-destination"/);assert.match(source,/data-tab="destination"/);assert.match(source,/id="destBulkPreview"/);assert.match(source,/id="destBulkCategory"/);assert.match(source,/data-dest-action=[^\n]{0,20}category/);assert.match(source,/openDestinationCategoryManager/);assert.match(source,/روش دستی/);assert.match(source,/روش نیمه‌هوشمند/);assert.match(source,/روش هوشمند با مدل‌های انتخابی/);assert.match(source,/categoryAssignments/);assert.match(source,/data-category-row/);assert.match(source,/اصلاح دستی پیشنهاد این محصول/);assert.match(source,/source:'اصلاح دستی'/);assert.match(source,/id="destBulkDeletePreview"/);assert.match(source,/runDestinationBulk\(false,true\)/);assert.match(source,/api\/destination\/'\+dest\.target\+'\/bulk/);assert.match(source,/extraction-diagnostic/);assert.match(source,/No route for that URI|رفع مسیر Cloudflare Workers AI/);assert.match(source,/گزارش تغییرات کد/);
});

test('AI provider export is confidential and the Mistral catalog covers every official Text-to-text endpoint',async()=>{
  const dashboard=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),catalogSource=await readFile(new URL('../worker-src/ai-catalog.ts',import.meta.url),'utf8'),vault=await readFile(new URL('../worker-src/vault.ts',import.meta.url),'utf8');
  assert.match(dashboard,/برون‌ریزی محرمانه/);assert.match(dashboard,/aiExportDownload/);assert.match(dashboard,/showSaveFilePicker/);assert.match(dashboard,/دانلود فایل JSON در مرورگر/);assert.match(dashboard,/کلیدهای API را نیز شامل|کلیدهای API است/);assert.match(dashboard,/ai-export-file'[\s\S]*exportAiProviders\(\)/);assert.match(dashboard,/format:'scraper4-ai-providers'/);assert.match(dashboard,/containsSecrets:true/);assert.match(dashboard,/providers:exportProviders/);assert.match(dashboard,/candidates:Array\.isArray\(ai\.candidates\)/);assert.match(dashboard,/master:String\(ai\.master/);assert.match(dashboard,/network:ai\.network/);assert.match(dashboard,/raw\?\.ai[\s\S]*config\.candidates[\s\S]*config\.network/);assert.match(dashboard,/mistral\.ai\/pricing\/api\//);
  assert.deepEqual([...catalog.MISTRAL_TEXT_TO_TEXT_MODELS],[
    'mistral-medium-latest','mistral-small-latest','mistral-large-latest','zai-glm-5-2','mistral-ocr-latest','voxtral-small-latest','codestral-latest','ministral-3b-latest','ministral-8b-latest','ministral-14b-latest','mistral-embed'
  ]);
  assert.deepEqual(catalog.MISTRAL_MODEL_ENDPOINTS,{'mistral-ocr-latest':'ocr','mistral-embed':'embeddings'});assert.doesNotMatch(JSON.stringify(catalog.MISTRAL_TEXT_TO_TEXT_MODELS),/labs-leanstral-2603/);assert.ok(JSON.stringify(catalog.MISTRAL_CATALOG_V3_ADDITIONS).includes('labs-leanstral-1-5'),'catalog v3 adds the replacement Labs model');
  for(const incompatible of ['voxtral-mini-latest','voxtral-mini-transcribe-realtime-2602','voxtral-mini-tts-latest','mistral-moderation-2603','codestral-embed'])assert.doesNotMatch(JSON.stringify(catalog.MISTRAL_TEXT_TO_TEXT_MODELS),new RegExp(incompatible),`${incompatible} lacks the official Text-to-text capability`);
  const ai={catalogVersion:0,providers:[{id:'mistral',name:'نام کاربر',baseUrl:'https://custom.example/mistral/v1',apiKey:'keep-this-key',models:['private-model'],enabled:true}]};assert.equal(catalog.upgradeAiProviderCatalog(ai),true);assert.equal(ai.catalogVersion,4);assert.ok(ai.providers.length>=3);assert.equal(ai.providers[0].apiKey,'keep-this-key');assert.equal(ai.providers[0].baseUrl,'https://custom.example/mistral/v1');assert.equal(ai.providers[0].enabled,true);assert.ok(ai.providers[0].models.includes('private-model'));assert.ok(ai.providers[0].models.includes('mistral-ocr-latest'));assert.ok(ai.providers[0].models.includes('mistral-embed'));ai.providers[0].models=ai.providers[0].models.filter(model=>model!=='mistral-small-latest');assert.equal(catalog.upgradeAiProviderCatalog(ai),false);assert.equal(ai.providers[0].models.includes('mistral-small-latest'),false,'a user deletion remains stable after the one-time upgrade');
  assert.match(vault,/catalogVersion:num\(input\?\.ai\?\.catalogVersion/);assert.match(vault,/upgradeAiProviderCatalog\(result\.ai\)/);assert.match(dashboard,/OCR و Embedding با endpoint تخصصی/);assert.match(dashboard,/filter\(aiChatCompatibleModel\)/);
});

test('destination modals, green AI filtering, live progress, and clickable queue event details are fully wired',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),processor=await readFile(new URL('../worker-src/processor.ts',import.meta.url),'utf8'),types=await readFile(new URL('../worker-src/types.ts',import.meta.url),'utf8'),networkSource=await readFile(new URL('../worker-src/network.ts',import.meta.url),'utf8');
  for(const token of ['id="destinationManagerModal"','data-open-destination="woo"','data-open-destination="basalam"','data-open-destination="basalam-unapproved"','id="destSelectAll"','data-dest-view="cards"','data-dest-view="rows"','id="destUnapprovedTools"','id="destPerPage"'])assert.match(source,new RegExp(token));
  assert.match(source,/function openDestinationManager\(/);assert.match(source,/function closeDestinationManager\(/);assert.match(source,/function setDestinationView\(/);assert.match(source,/function selectDestinationPage\(/);assert.match(source,/destinationManagerModal'[\s\S]*closeDestinationManager/);
  for(const id of ['aiProgressBar','aiProgressTotal','aiProgressDone','aiProgressRemain','aiProgressResult','aiProgressCategory','aiProgressPercent','aiProgressElapsed','aiProgressCurrent'])assert.match(source,new RegExp(`id="${id}"`));
  assert.doesNotMatch(source,/aiMenuResult/);assert.match(source,/function updateAiTestProgress\(/);assert.match(source,/\.filter\(row=>row\.ok===true&&row\.chatCompatible!==false&&!aiDedicatedEndpoint\(row\.model\)\)/);assert.match(source,/در آخرین اجرای تست مدل‌ها هیچ مدل سبزی ثبت نشده است/);
  for(const event of ['added','updated','failed','removed','out-of-stock','zero-price','price-increased','price-decreased','sync-created','sync-updated'])assert.match(processor+types,new RegExp(`'${event}'`),`${event} event must be recorded`);
  assert.match(source,/data-job-metric/);assert.match(source,/function openJobMetric\(/);assert.match(source,/price-up/);assert.match(source,/price-down/);assert.match(source,/oldPrice/);assert.match(source,/percent/);
  assert.match(networkSource,/WOO_EDGE_ERRORS=new Set\(\[520,521,522,523,524,525,526\]\)/);assert.match(networkSource,/function safeWooFetch/);assert.match(source,/woo\.network\.mode/);assert.match(source,/woo\.network\.workerUrl/);
});

test('font picker, resilient AI result columns, Basalam chat modal, and real destination table are fully wired',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),appSource=await readFile(new URL('../worker-src/app.ts',import.meta.url),'utf8');
  assert.match(source,/فونت کل سایت/);for(const font of ['vazir','yekan','shabnam','sahel','samim'])assert.match(source,new RegExp(`${font}:\\{family:`));
  assert.match(source,/appearance\.font/);assert.match(source,/function applySiteFont\(/);assert.match(source,/appFontStylesheet/);assert.match(source,/\/assets\/fonts\/vazir\.css/);assert.match(appSource,/\/assets\/fonts\/:file/);assert.match(appSource,/\.css\$\/i/);assert.match(appSource,/\.woff2\$\/i/);assert.doesNotMatch(appSource,/v1\.fontapi\.ir|cdn\.fontcdn\.ir/);
  for(const id of ['aiProgressRetries','aiProgressSkipped'])assert.match(source,new RegExp(`id="${id}"`));assert.doesNotMatch(source,/AI_TEST_RESUME_KEY/);assert.match(source,/api\('\/api\/ai\/test-runs'/);assert.match(source,/api\('\/api\/ai\/test-runs\/current'/);assert.match(source,/controlAiModelTests/);assert.match(source,/serverSide:true/);assert.match(source,/messageSucceeded/);assert.match(source,/پاسخ پیام «/);assert.match(source,/خطای پاسخ پیام/);
  assert.match(source,/function openBasalamChats\(/);assert.match(source,/function openBasalamChatDetail\(/);assert.match(source,/api\/basalam\/chats\?limit=50/);assert.match(source,/\/messages\?limit=50/);assert.match(source,/خوانده‌نشده/);assert.match(source,/data-chat-search/);
  assert.match(source,/function destinationTable\(/);assert.match(source,/<table class="dest-table">/);assert.match(source,/else if\(dest\.view==='rows'\)box\.innerHTML=destinationTable\(\)/);assert.match(source,/else box\.innerHTML=dest\.products\.map/,'card mode remains an independent renderer');
});

test('durable background runners cover AI refresh recovery and every unapproved Basalam page',async()=>{
  const dashboard=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),background=await readFile(new URL('../worker-src/background.ts',import.meta.url),'utf8'),app=await readFile(new URL('../worker-src/app.ts',import.meta.url),'utf8'),main=await readFile(new URL('../worker-src/main.ts',import.meta.url),'utf8'),types=await readFile(new URL('../worker-src/types.ts',import.meta.url),'utf8');
  for(const endpoint of ['/api/ai/test-runs','/api/ai/test-runs/current','/api/ai/test-runs/control','/api/ai/test-runs/retry','/api/destination/basalam/category-runs','/api/destination/basalam/category-runs/current','/api/destination/basalam/category-runs/control'])assert.match(app,new RegExp(endpoint.replaceAll('/','\\/')));
  assert.match(background,/type BackgroundRun=/);assert.match(background,/type RunStatus='queued'\|'running'\|'paused'\|'done'\|'failed'/);assert.match(background,/testModelBatch/);assert.match(background,/destinationCatalog\('basalam',[\s\S]*page:run\.page/);assert.match(background,/status:'3567'/);assert.match(background,/applyBasalamCategory/);assert.match(background,/recoverBackgroundRuns/);assert.match(background,/retryJobs/);assert.match(dashboard,/initAutoSave/);assert.match(dashboard,/scheduleAutoSave/);assert.match(background,/STALL_MS=45_000/);assert.match(background,/watchdog-skip/);assert.match(background,/skipNext/);assert.match(background,/DEFAULT_SKIP_TIMEOUT_MS=30_000/);assert.match(background,/function aiSkipTimeoutMs/);
  assert.match(background,/INSERT INTO app_state[\s\S]*ON CONFLICT\(key\) DO UPDATE[\s\S]*WHERE app_state\.updated_at<\?/,'D1 compare-and-set lease prevents duplicate queue deliveries');assert.match(background,/DELETE FROM app_state WHERE key=\? AND value=\?/,'only the lease owner can release it');
  assert.match(types,/task:\s*'ai-test'\s*\|\s*'category-all'/);assert.match(main,/processBackgroundMessage/);assert.match(main,/result\.outcome==='continue'/);assert.match(app,/recoverBackgroundRuns\(waitUntil\)/);
  assert.match(dashboard,/startCategoryAllRun/);assert.match(dashboard,/دسته‌بندی همهٔ تأییدنشده‌ها/);assert.match(dashboard,/refreshCurrentCategoryRun\(true\)/);assert.match(dashboard,/refreshCurrentAiRun\(true\)/);assert.doesNotMatch(dashboard,/destUnapprovedSelect[^\n]*selectDestinationPage\(true\)/,'all-unapproved action must not be limited to the visible page');
});

test('dashboard startup cannot be stopped by a stale file input and settings restore is visibly wired',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\$\('restoreFile'\)/,'removed restoreFile input must not be bound');
  assert.doesNotMatch(source,/\$\('[^']+'\)\.addEventListener/,'literal event bindings must tolerate an optional/moved UI control');
  assert.match(source,/\['sxFile','bkFile'\][\s\S]*restoreSettingsFile\(file\)/);
  assert.match(source,/api\('\/api\/settings-import'/);
  assert.match(source,/بازیابی کامل شد/);
});

test('dashboard remembers and restores the last active profile after refresh',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(source,/LAST_PROFILE_KEY='scraper4:last-profile-id'/);
  assert.match(source,/function rememberProfile\(id\)[\s\S]*localStorage\.setItem\(LAST_PROFILE_KEY,value\)/);
  assert.match(source,/const lastProfileId=rememberedProfileId\(\)\|\|state\.selected[\s\S]*editProfile\(lastProfileId,false\)[\s\S]*forgetRememberedProfile\(lastProfileId\);clearForm\(\)/);
  assert.match(source,/function editProfile\(id,navigate=true\)[\s\S]*rememberProfile\(id\)/);
  assert.match(source,/function activateProfile\(id\)[\s\S]*editProfile\(value,false\)[\s\S]*syncProfileSelects\(value\)/);
  assert.match(source,/\['productProfile','transferProfile','photoProfile','sendProfile','importProfile'\][\s\S]*activateProfile\(event\.target\.value\)/);
  assert.match(source,/rememberProfile\(result\.profile\.id\)[\s\S]*syncProfileSelects\(result\.profile\.id\)/);
  assert.match(source,/forgetRememberedProfile\(id\)[\s\S]*await refreshProfiles\(\)/);
});

test('drawer controls stay above the menu, open section heads are sticky, and general settings expose twelve live themes plus reasoning flags',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),vault=await readFile(new URL('../worker-src/vault.ts',import.meta.url),'utf8'),ai=await readFile(new URL('../worker-src/ai.ts',import.meta.url),'utf8');
  assert.match(source,/<div class="drawer-head">[\s\S]*id="drawerFull"[\s\S]*id="drawerClose"[\s\S]*<div id="menuSections"/,'full-width control is rendered inside the sticky drawer header');
  assert.match(source,/\.drawer-head \.fullwidth-btn\{position:static/);assert.match(source,/\.menu-section\.open>\.menu-title\{position:sticky;top:70px/);assert.match(source,/\.menu-section\.open \.menu-content\{max-height:none;[^}]*overflow:visible/,'long menu sections use drawer scrolling instead of a competing internal scroller');
  assert.match(source,/mSelect\('رنگ‌بندی کل سایت:','siteTheme'/);assert.match(source,/id="themeSwatches"/);assert.match(source,/data-theme-choice/);assert.match(source,/applySiteTheme\(nestedGet\(state\.settings,'appearance\.theme'\)/);
  const themeBlock=source.slice(source.indexOf('const SITE_THEMES='),source.indexOf('const SITE_FONTS=')),themeKeys=[...themeBlock.matchAll(/(?:\{|,)([a-z]+):\[/g)].map(match=>match[1]);assert.equal(themeKeys.length,12);assert.deepEqual(themeKeys,['midnight','ocean','aurora','royal','sunset','rose','cobalt','forest','graphite','coffee','persian','cyber']);
  assert.match(source,/data-ai-reasoning-index/);assert.match(source,/aiEditorReasoning/);assert.match(source,/reasoningModels:models\.filter/);assert.match(source,/مدل رایگان Together/);assert.match(vault,/reasoningModels:string\[\]/);assert.match(vault,/reasoningModels:Array\.isArray/);assert.match(ai,/isReasoningAiModel/);assert.match(ai,/max_tokens:reasoning\?1600:400/);assert.match(ai,/preferredAiChatModel/);
});

test('mobile RTL redesign keeps the requested bottom navigation order and touch-friendly theme',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),start=source.indexOf('<nav class="main-tabs" aria-label="ناوبری اصلی">'),end=source.indexOf('</nav>',start),nav=source.slice(start,end);
  assert.ok(start>0&&end>start,'main navigation must exist');
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(match=>match[1]),['home','settings','selector','products','destination','jobs']);
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(match=>match[1]),['شروع','تنظیمات','سلکتورها','نتایج','ارسال','درون‌ریزی']);
  assert.equal((nav.match(/<svg /g)||[]).length,6);assert.match(nav,/id="productBadge"/);assert.match(nav,/id="jobBadge"/);
  assert.match(source,/--bg:#050a13;--card:#121d30/);assert.match(source,/\.main-tabs\{top:auto!important;bottom:0!important/);assert.match(source,/env\(safe-area-inset-bottom\)/);assert.match(source,/\.hamburger,\.fullwidth-btn\{top:12px;width:52px;height:52px/);assert.match(source,/input,select,textarea\{min-height:50px/);assert.match(source,/\$\('productBadge'\)\.hidden=!data\.total/);
});

test('workflow panes match the reference hierarchy and every new control is operationally wired',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  for(const id of ['releaseBanner','homeProfile','homeExtractionEngine','homeBenchmarkEngines','homeTopDiagnose','homeAutoMode','homeManualMode','homeScrape','homeDiagnose','homeBackend','homeJobs','settingsProfile','savePriceSettings','sendProfile','quickWoo','quickBasalam','destinationJobs','importProfile','importFile','importAnalyze','importExecute','importResult'])assert.equal((source.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} must be unique`);
  assert.doesNotMatch(source.slice(source.indexOf('function renderProfiles'),source.indexOf('async function profileEngineChange')),/profile-engine-select/,'profile cards must not show the engine dropdown');
  for(const id of ['titleSuffix','priceMode','priceValue','roundPrice','minPrice','wooCategoryId','basalamCategoryId','basalamFallbackCategoryIds','enabled','networkIndirect','noExtract','syncWoo','syncBasalam'])assert.equal((source.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} moved to settings without duplication`);
  const settings=source.slice(source.indexOf('<section id="pane-settings"'),source.indexOf('<nav class="main-tabs"'));assert.match(settings,/مدیریت قیمت/);assert.match(settings,/دسته‌بندی جداگانه برای هر مقصد/);assert.match(settings,/settings-help/);
  const destination=source.slice(source.indexOf('<section id="pane-destination"'),source.indexOf('<section id="pane-jobs"'));assert.match(destination,/ارسال سریع محصولات/);assert.match(destination,/مدیریت جامع مقصد/);
  const jobs=source.slice(source.indexOf('<section id="pane-jobs"'),source.indexOf('<section id="pane-settings"'));assert.match(jobs,/درون‌ریزی هوشمند از فایل/);assert.match(jobs,/importDropZone/);assert.match(jobs,/importMappingCard/);assert.match(jobs,/importHistoryList/);
  assert.match(source,/createJob\(\$\('sendProfile'\)\.value,'sync','woo',false\)/);assert.match(source,/createJob\(\$\('sendProfile'\)\.value,'sync','basalam',false\)/);assert.match(source,/analyzeImport\(\)\.catch/);assert.match(source,/executeImport\(\)\.catch/);assert.match(source,/saveProfile\(false,true\)/);
  const appSource=await readFile(new URL('../worker-src/app.ts',import.meta.url),'utf8');assert.match(appSource,/read-excel-file\/web-worker/);assert.match(appSource,/destinationStatus:wooStatus\|\|undefined/);
});

test('settings restore shows a section picker and the changelog keeps growing',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  for(const token of ['SETTINGS_SECTIONS','openRestoreSectionsModal','openExportSectionsModal','doExportWithSections','filterBundleFiles','settingsSectionsHtml','data-restore-sec','data-restore-group','data-export-confirm','restoreAll'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(dash,/profiles\.json/,'profiles section listed');
  assert.match(dash,/connections\.json/,'connections/AI section listed');
  assert.match(dash,/category_learning\.json/,'category learning listed');
  assert.match(dash,/render_settings\.json/,'system settings listed');
  assert.match(dash,/profiles-settings/,'profile settings subsection');assert.match(dash,/profiles-products/,'profile products subsection');assert.match(dash,/conn-woo/);assert.match(dash,/conn-basalam/);assert.match(dash,/conn-ai/);assert.match(dash,/conn-notif/);
  assert.match(dash,/نسخهٔ ۱\.۲۳\.۰/,'changelog includes 1.23.0');
  assert.match(dash,/نسخهٔ ۱\.۲۲\.۰/,'changelog includes 1.22.0');
});

test('selector tab: sticky sub-tabs, product dropdown for detail sample, price detail field, variations-as-gallery',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),scraper=await readFile(new URL('../worker-src/scraper.ts',import.meta.url),'utf8'),types=await readFile(new URL('../worker-src/types.ts',import.meta.url),'utf8');
  assert.match(dash,/\#pane-selector \.sub-tabs\{[^}]*position:sticky/,'sub-tabs sticky');
  assert.match(dash,/id="detailSampleSelect"/,'detail sample product dropdown');
  assert.match(dash,/loadDetailSampleProducts/,'loader fn');
  assert.match(dash,/\[\['shortDesc','توضیحات کوتاه'\],\['price','💰 قیمت'\]/,'price added to detail fields');
  assert.match(dash,/value="variations">🎨 تصاویر تنوع‌ها/,'variations gallery mode option');
  assert.match(types,/'off'\|'auto'\|'manual'\|'number'\|'variations'/);
  assert.match(scraper,/shortDesc:string;longDesc:string;price:string;/,'DetailResult carries price');
  assert.match(scraper,/DETAIL_KEYS=\['shortDesc','price'/,'price in detail keys');
  assert.match(scraper,/تنوع‌ها به‌عنوان گالری عکس/,'variation images feed the gallery');
});

test('provider list: collapsible cards, sticky header, restore after edit, collapsed descriptions',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(dash,/provider-card/,'collapsible provider card');
  assert.match(dash,/data-provider-card/,'card index attr');
  assert.match(dash,/provider-card\[open\]>summary\{position:sticky/,'sticky header when open');
  assert.match(dash,/aiProviderPrevOpen/,'remembers previous open state');
  assert.match(dash,/restoreAiProviderListUi/,'restore helper exists');
  assert.match(dash,/menu-desc/,'section descriptions are collapsible');
  assert.match(dash,/provider-head-actions/,'actions visible in header');
});

test('task manager panel is wired and the activity endpoint exists',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),app=await readFile(new URL('../worker-src/app.ts',import.meta.url),'utf8'),main=await readFile(new URL('../worker-src/main.ts',import.meta.url),'utf8');
  for(const token of ['activityBtn','openActivityManager','activityPoll','/api/activity','activity-stats','activity-runs'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(app,/\/api\/activity/,'activity endpoint');
  assert.match(app,/getPublicBackgroundRun\('ai-test'\)/);
  for(const token of ['data-activity-up','data-activity-down','data-job-id','activityReorderQueued','saveActivityPriorities','activityMoveQueued','wireActivityControls'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(dash,/draggable="true"/,'queued jobs are draggable');
  assert.match(dash,/\/api\/jobs\/priority/,'priority endpoint is wired in the dashboard');
  assert.match(app,/app\.post\('\/api\/jobs\/priority'/,'priority endpoint exists');
  assert.match(app,/listQueuedJobs/,'cron and consumer use the priority-ordered queue');
  for(const token of ['data-activity-run','data-run-kind','data-run-up','data-run-down','activityOpenRun','activityMoveRun','saveRunPriorities','activityReorderRuns'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(dash,/\/api\/runs\/priority/,'runs priority endpoint is wired in the dashboard');
  assert.match(app,/app\.post\('\/api\/runs\/priority'/,'runs priority endpoint exists');
  assert.match(app,/getRunPriorities/,'runs priorities drive the activity ordering');
  assert.match(main,/listQueuedBackgroundRuns/,'queue consumer dispatches background runs by priority');
  for(const token of ['data-job-delete','data-run-delete','data-clear-finished','activityDeleteJob','activityDeleteRun','activityClearFinished'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(app,/category-runs\/reset/,'category-all reset route exists');
  assert.match(app,/getWriteQuotaState/,'activity reports the D1 write-quota state');
  assert.match(app,/quota:\{writeExceeded/,'activity payload carries the quota flag');
  assert.match(dash,/سهمیهٔ نوشتن D1 تمام شده است/,'task manager shows the quota banner');
  assert.match(dash,/r\.phase==='quota'/,'run rows label the quota phase in Persian');
  assert.match(main,/processBackgroundMessage\(item\.body\)/,'displaced incoming run gets its turn instead of starving');
  assert.match(main,/env\.JOBS\.send\(item\.body,\{delaySeconds:2\}\)/,'displaced run message is re-queued so the queue never drains');
  assert.match(main,/processJob\(jobId\)/,'displaced incoming job gets its turn');
});

test('aiEditorAccounts state is always declared so provider edit never throws',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(dash,/aiEditorKeys=\[\],aiEditorAccounts=\[\]/,'aiEditorAccounts is declared next to aiEditorKeys');
  assert.ok((dash.match(/aiEditorAccounts/g)||[]).length>=5,'aiEditorAccounts used and declared consistently');
});

test('every generic provider key row has a test button',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(dash,/data-ai-key="'\+i\+'"[\s\S]*data-ma="ai-key-test:'\+i\+'"/,'generic key row has test button next to the input');
  assert.match(dash,/aiEditorModels\.find\(m=>aiChatCompatibleModel/,'test uses a chat-compatible model first');
});

test('CF editor lists multiple accounts with a test button per account; generic keys keep test buttons',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(dash,/data-ai-account-id="/,'account id input per row');
  assert.match(dash,/data-ai-account-token="/,'token input per row');
  assert.match(dash,/ai-key-test:'\+i\+'/,'test button per key/account');
  assert.match(dash,/async function testAiKey\(/,'test-key handler');
  assert.match(dash,/aiEditorAccounts/,'accounts state');
});

test('Cloudflare AI provider editor shows account-id/token fields and export transforms them',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),vault=await readFile(new URL('../worker-src/vault.ts',import.meta.url),'utf8');
  for(const token of ['aiEditAccountId','aiEditCfToken','aiCloudflareBox','aiIsCloudflareBase','aiCloudflareAccountFromBase','aiCloudflareBaseFromParts'])assert.match(dash,new RegExp(token),token);
  assert.match(dash,/out\.accountId=aiCloudflareAccountFromBase/,'export writes accountId for CF providers');
  assert.match(dash,/p\.accountId&&p\.cfToken\)baseUrl=aiCloudflareBaseFromParts/,'import rebuilds baseUrl from accountId+token');
  assert.match(vault,/accountId\?:string;cfToken\?:string/);
});

test('provider editor supports multiple API keys and model lists show key suffixes',async()=>{
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),ai=await readFile(new URL('../worker-src/ai.ts',import.meta.url),'utf8'),vault=await readFile(new URL('../worker-src/vault.ts',import.meta.url),'utf8');
  for(const token of ['aiEditKeys','ai-key-add','ai-key-remove','renderAiEditKeys','aiKeySuffixLabel','aiProviderKeyCount'])assert.match(dash,new RegExp(token.replace(/[.\/]/g,'\\$&')),token);
  assert.match(ai,/apiKeys\?:Array<string\|CfAccountKey>/);
  assert.match(ai,/providerKeys\(provider/);
  assert.match(ai,/providerWithKey\(provider/);
  assert.match(ai,/parseModelKeySuffix\(/);
  assert.match(ai,/keyLabel:aiKeySuffixLabel\(ki\)/,'test tasks carry a visible key suffix');
  assert.match(ai,/\[K'\+String\(index\+1\)\.replace\(\/\\d\/g,d=>'۰۱۲۳۴۵۶۷۸۹'/,'suffix uses Persian digits');
  assert.match(vault,/apiKeys:Array<string\|\{accountId:string;token:string\}>/);
  assert.match(dash,/apiKeys:keys\.length\?keys/,'export/import round-trips the keys array');
  assert.match(dash,/querySelectorAll\('#aiEditKeys \.ai-account-row'\)/,'Cloudflare accounts are read from their rows when saving');
  assert.match(dash,/renderAiTestEstimate/,'test panel estimate helper exists');
  assert.match(dash,/id="aiTestEstimate"/,'test panel shows the per-key test-entry estimate');
  assert.match(dash,/aiTestOnlyUntested'\)\?\.addEventListener\('change',renderAiTestEstimate/,'candidate checkbox refreshes the estimate');
  assert.match(dash,/last\.keyLabel/,'live progress shows the per-key suffix of the current model');
  assert.match(dash,/aiEditorAccounts\[i\]=\{accountId:el\.matches/,'typing in a CF account row updates the editor state live');
  assert.match(dash,/aiEditorKeys\[i\]=el\.value\.trim\(\)/,'typing in a generic key input updates the editor state live');
  assert.match(dash,/row=rows\[Number\(index\)\],acc=aiEditorAccounts/,'per-account test reads the live row values');
  assert.match(dash,/if\(apiKeys\.length>1\)notice/,'saving a multi-key provider confirms the doubled test list');
  assert.match(dash,/\u00d7 '\+fa\(keyCount\)\+' /,'provider card shows models × keys = test entries');
});

test('import preview header mapping selects + row detail modal + Workers AI catalog UI are wired',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),app=await readFile(new URL('../worker-src/app.ts',import.meta.url),'utf8'),catalog=await readFile(new URL('../worker-src/workers-ai-catalog.ts',import.meta.url),'utf8');
  assert.match(source,/head-map-sel/);assert.match(source,/data-head-col/);assert.match(source,/preview-row/);assert.match(source,/openImportRowModal/);
  assert.match(source,/workersCatalogList/);assert.match(source,/loadWorkersCatalog/);assert.match(source,/api\/ai\/workers-catalog/);
  assert.match(app,/\/api\/ai\/workers-catalog/);
  assert.match(catalog,/WORKERS_AI_MODELS/);assert.match(catalog,/workersAiTaskGroups/);
  const ids=[...catalog.matchAll(/id:'(@cf[^']+)'/g)].map(m=>m[1]);
  assert.ok(ids.length>=80,'catalog covers 80+ models');
  assert.ok(ids.includes('@cf/meta/llama-4-scout-17b-16e-instruct'));
  assert.ok(ids.includes('@cf/qwen/qwen3.8-27b'));
  assert.ok(ids.includes('@cf/deepseek-ai/deepseek-v4-flash-0731'));
  assert.ok(ids.includes('@cf/moonshotai/kimi-k2.7-code'));
});

test('AI chat tab exposes a capability-filtered model picker and chat wiring',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(source,/data-ai-tab="chat"/);
  assert.match(source,/data-ai-panel="chat"/);
  for(const id of ['chatModelSel','chatMessages','chatInput','chatSend'])assert.match(source,new RegExp(`id="${id}"`));
  assert.match(source,/data-chat-filter="chat"/);assert.match(source,/data-chat-filter="toolCalling"/);assert.match(source,/data-chat-filter="reasoning"/);
  for(const token of ["/api/ai/chat-models","/api/ai/chat","function chatFilteredModels","function chatSend","function chatClear","chatState.filters"])assert.match(source,new RegExp(token.replace(/[.\/]/g,'\\$&')));
});

test('DASHBOARD_JS parses as a single valid script (no broken template literal)',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  const start=source.indexOf('export const DASHBOARD_JS');
  const bt=source.indexOf('`',start);
  const close=source.indexOf('`;\n\nfunction escapeHtml',bt);
  assert.ok(start>=0&&bt>=0&&close>bt,'DASHBOARD_JS template literal markers found');
  const js=source.slice(bt+1,close);
  // eslint-disable-next-line no-new-func
  assert.doesNotThrow(()=>new Function(js),'the dashboard script must compile; a broken template literal breaks every button/tab');
  assert.ok(js.length>100000,'dashboard script has real content');
});

test('extraction diagnostic modal keeps a copy-all button with clipboard fallback',async()=>{
  // 1.135.0: one click copies stages, evidence, data and recommendations.
  const dash=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  assert.match(dash,/data-modal-action="copy-diagnostic"/,'copy-all button in the modal');
  assert.match(dash,/lastDiagnosticReport=null/,'module-level slot keeps the last report');
  assert.match(dash,/lastDiagnosticReport=\{profile:/,'runExtractionDiagnostic stores the fetched report');
  assert.match(dash,/'selector-discovery':'کشف خودکار سلکتورها'/,'discovery stage has a Persian label');
  assert.match(dash,/'selectors-auto-saved':'ذخیرهٔ خودکار سلکتورها'/,'auto-saved stage has a Persian label');
  const at=dash.indexOf('async function copyDiagnosticReport');
  assert.ok(at>0,'copy function exists');
  const fn=dash.slice(at,dash.indexOf('\nfunction initMenu',at));
  assert.match(fn,/lastDiagnosticReport/,'copies the stored report');
  assert.match(fn,/navigator\.clipboard\.writeText/,'modern clipboard path');
  assert.match(fn,/execCommand\('copy'\)/,'textarea fallback for non-secure contexts');
});

test('remaining dashboard content follows a topic-first novice workflow without dropping advanced tools',async()=>{
  const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
  const home=source.slice(source.indexOf('<section id="pane-home"'),source.indexOf('<section id="pane-selector"'));
  assert.ok(home.indexOf('پروفایل‌های ذخیره‌شده')<home.indexOf('آدرس و محدودهٔ استخراج'));assert.ok(home.indexOf('آدرس و محدودهٔ استخراج')<home.indexOf('شروع استخراج محصولات'));assert.ok(home.indexOf('شروع استخراج محصولات')<home.indexOf('نمای کلی و فهرست همهٔ پروفایل‌ها'));
  assert.match(home,/<details class="support-panel profile-library">[\s\S]*id="profileList"/);for(const id of ['homeProfileName','homeSaveProfile','homeDeleteProfile','homeSyncEnabled','homeSyncInterval','homeSyncTarget','homeNoExtract','homeSyncWoo','homeSyncBasalam','homeNetworkIndirect','homeUrl','homePages','homePagination','homePaginationValue','homeReset','homeClearJobs','homeRefreshJobs'])assert.match(home,new RegExp(`id="${id}"`));
  const selector=source.slice(source.indexOf('<section id="pane-selector"'),source.indexOf('<section id="pane-products"'));
  assert.deepEqual([...selector.matchAll(/<span class="step-badge">([^<]+)<\/span>/g)].map(x=>x[1]),['۱','۲','۳']);
  assert.ok(selector.indexOf('منبع و صفحه‌بندی')<selector.indexOf('فیلدهای فهرست محصولات')&&selector.indexOf('فیلدهای فهرست محصولات')<selector.indexOf('جزئیات صفحهٔ محصول'));
  const products=source.slice(source.indexOf('<section id="pane-products"'),source.indexOf('<section id="pane-destination"'));
  assert.ok(products.indexOf('محصولات استخراج‌شده')<products.indexOf('ابزارهای خروجی و انتقال'));
  assert.match(products,/id="goImportTab"[\s\S]*ورود CSV \/ Excel جدید/);assert.match(source,/\$\('goImportTab'\)[\s\S]*tab\('jobs'\)/);
  const settings=source.slice(source.indexOf('<section id="pane-settings"'),source.indexOf('<nav class="main-tabs"'));
  assert.ok(settings.indexOf('مدیریت قیمت')<settings.indexOf('ابزارهای فنی و مهاجرت'));assert.match(settings,/<details class="support-panel technical-panel">/);
  assert.deepEqual(Object.values({maintenance:'🧰 نگهداری و نسخه',connections:'🔌 اتصال‌ها و سرویس‌ها',operations:'📦 عملیات محصولات و سلامت',automation:'🤖 اتوماسیون و گزارش'}).filter(label=>source.includes(label)).length,4);
  assert.match(source,/menuDefs\.map\(\(\[title,key,desc,content\],index\)/);
});

test('processor refuses unsafe retirement after empty, duplicate or failed extraction and preserves detail tags',async()=>{
  const source=await readFile(new URL('../worker-src/processor.ts',import.meta.url),'utf8');assert.match(source,/checkpoint\.retireSafe=false;[\s\S]*صفحه.*خالی/);assert.match(source,/فقط محصولات تکراری/);assert.match(source,/if\(checkpoint\.retireSafe&&checkpoint\.seen\.length\)/);assert.match(source,/هیچ محصولی بازنشسته نشد/);assert.match(source,/tags:fresh\.tags\|\|previous\.tags/);
});

test('runtime SCHEMA keeps seeded profile JSON intact and the Apple profile targets real cards',async()=>{
  // Regression: SCHEMA used to be a plain template literal, so every \" inside the
  // seeded profile payloads collapsed to a bare " and the JSON became unparseable.
  // db.ts's json() helper swallows that failure, so every seeded profile silently
  // loaded with no selectors and extracted nothing.
  const source=await readFile(new URL('../worker-src/schema.ts',import.meta.url),'utf8');
  assert.match(source,/export const SCHEMA = String\.raw`/,'SCHEMA must be a raw template literal');

  const {SCHEMA}=await import(pathToFileURL(join(temporary,'schema.mjs')));
  const payloads=[...SCHEMA.matchAll(/'(\{"id":"[^']*?\})'/g)].map(match=>match[1].replace(/''/g,"'"));
  assert.ok(payloads.length>=6,`expected the seeded profiles, found ${payloads.length}`);
  const profiles=payloads.map(payload=>JSON.parse(payload));
  for(const profile of profiles)assert.ok(profile.selectors&&profile.selectors.container,`${profile.id} lost its selectors`);

  const apple=profiles.filter(profile=>profile.id==='us-apple-buy-iphone').pop();
  assert.ok(apple,'the US Apple Store profile must stay seeded');
  // "section li" also matched apple.com's global navigation and the Shopping
  // guides / Ways to save lists, which produced priceless junk rows.
  assert.doesNotMatch(apple.selectors.container,/section li/);
  assert.match(apple.selectors.link,/\/shop\/buy-iphone\//,'the link selector needs a product path segment');
  assert.equal(apple.extractionEngine,'htmlrewriter','hand-tuned CSS selectors must not be bypassed by engine autodetection');
});

test('Apple-style cards extract cleanly while navigation lists are ignored',async()=>{
  const {SCHEMA}=await import(pathToFileURL(join(temporary,'schema.mjs')));
  const payloads=[...SCHEMA.matchAll(/'(\{"id":"us-apple-buy-iphone"[^']*?\})'/g)].map(match=>match[1].replace(/''/g,"'"));
  const {selectors}=JSON.parse(payloads[payloads.length-1]);
  const card=(title,slug,price)=>`<li class="rf-hcard rc-card"><h3 class="rf-hcard-title">${title}</h3>`+
    `<img src="https://store.storeimages.cdn-apple.com/${slug}.jpg" alt="${title}">`+
    `<div class="rc-prices"><span class="rc-prices-fullprice">Buy from $${price} or $45.79/mo. per month for 24 mo.</span></div>`+
    `<a href="/shop/buy-iphone/${slug}">Buy - ${title}</a></li>`;
  const html='<!DOCTYPE html><html><head><title>Buy iPhone - Apple</title></head><body>'+
    '<nav id="globalnav"><section class="globalnav-submenu"><ul>'+
    '<li><a href="https://www.apple.com/shop/buy-mac">Mac</a></li>'+
    '<li><a href="https://www.apple.com/shop/buy-iphone">iPhone</a></li></ul></section></nav>'+
    '<section class="all-models"><ul>'+
    card('iPhone 17 Pro &amp; iPhone 17 Pro Max','iphone-17-pro','1099')+
    card('iPhone Air','iphone-air','999')+'</ul></section>'+
    '<section class="rf-shopping-guides"><ul>'+
    '<li><a href="https://www.apple.com/shop/buy-iphone/carrier-offers">Carrier Deals</a></li>'+
    '<li><a href="https://www.apple.com/shop/refurbished">Certified Refurbished</a></li></ul></section>'+
    '</body></html>';
  const products=await scraper.parseCards(html,'https://www.apple.com/shop/buy-iphone',selectors);
  assert.deepEqual(products.map(product=>product.title),['iPhone 17 Pro & iPhone 17 Pro Max','iPhone Air'],
    'navigation and shopping-guide links must not become products, and entities must be decoded');
  assert.deepEqual(products.map(product=>product.price),[1099,999]);
  assert.ok(products.every(product=>product.url.startsWith('https://www.apple.com/shop/buy-iphone/')));
});

test('prices keep thousands separators and cents apart',async()=>{
  const cases=[['Buy from $1099 or $45.79/mo.',1099],['$1,099.00',1099],['$1,299.99',1299.99],
    ['1.099,00',1099],['1,200,000 تومان',1200000],['۱٬۲۰۰٬۰۰۰ تومان',1200000],['$599',599],['',0]];
  for(const [text,expected] of cases)assert.equal(scraper.numberFromText(text),expected,`numberFromText(${JSON.stringify(text)})`);
});

test('HTML entities in card text are decoded',async()=>{
  // The test harness swaps in a cheerio-backed HTMLRewriter that already decodes
  // entities, but the real Workers runtime hands text chunks over encoded, so
  // "iPhone 17 Pro &amp; iPhone 17 Pro Max" would be stored verbatim and would
  // never match the same product on the destination store.
  const source=await readFile(new URL('../worker-src/scraper.ts',import.meta.url),'utf8');
  assert.match(source,/normalizeDigits\(decodeEntities\(String\(value\|\|''\)\)\)/,'cleanText must decode entities');
  assert.match(source,/&\(\?:amp\|#38\|#x26\);/,'&amp; must be decoded last so &amp;lt; does not become <');
});

// ---------------------------------------------------------------------------
// Last-resort auto-suggest fallback (request 32b).
//
// Three triggers must recover a run instead of failing it: empty selectors, a
// successful connection that yields zero products, and an engine that finds
// nothing. These tests assert the WIRING in both processors (the behaviour of
// suggestSelectors itself is covered separately below).
// ---------------------------------------------------------------------------
const nodeProcessor = await readFile(new URL('../render-src/processor.ts', import.meta.url), 'utf8');
const workerProcessor = await readFile(new URL('../worker-src/processor.ts', import.meta.url), 'utf8');
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('node: zero extracted products triggers the auto-suggest fallback', () => {
  const source = stripComments(nodeProcessor);
  const bail = source.indexOf("'محصولی پیدا نشد'");
  assert.ok(bail > 0, 'the zero-product branch must still exist');
  const branch = source.slice(source.indexOf('if (!list.length)'), bail);
  assert.match(branch, /applySelectorSuggestions\(profile, url, 'list', job, false\)/,
    'the empty-list branch must rediscover list selectors before giving up');
  assert.match(branch, /scrapeListWithMeta/, 'it must retry the page after repairing the selectors');
  assert.match(branch, /listRescued/, 'the retry must be guarded so it cannot loop forever');
});

test('node: the rescue reruns the same page instead of skipping it', () => {
  const source = stripComments(nodeProcessor);
  const branch = source.slice(source.indexOf('if (!list.length)'), source.indexOf("'محصولی پیدا نشد'"));
  assert.match(branch, /page--;\s*continue/, 'a rescued page must be re-scraped, not skipped');
});

test('node: unconfigured list selectors are repaired by the engines and persisted', () => {
  const source = stripComments(nodeProcessor);
  // Since 1.128.0 "not configured" is empty, partial OR still-default
  // (normalizeProfile fills WooCommerce defaults), the engines repair such
  // selectors from page 1 reusing the same fetch, and the run persists them.
  assert.match(source, /listSelectorsStatus\(profile\.selectors\)/,
    'a profile with unconfigured list selectors must run engine-side discovery first');
  assert.match(source, /selectorStatus !== 'custom'/,
    'only non-custom (empty, partial, still-default) selectors trigger the repair');
  assert.match(source, /scraped\.discoveredSelectors/,
    'engine-discovered selectors must be persisted to the profile');
  assert.match(source, /engineSelectorsSaved/,
    'the repair must be saved once per run, not on every page');
});

test('worker: unconfigured list selectors are repaired by the engines and persisted', () => {
  const source = stripComments(workerProcessor);
  // Since 1.129.0 the Worker matches the Render/Node 1.128.0 behavior: "not
  // configured" is empty, partial OR still-default (normalizeProfile fills
  // WooCommerce defaults), the engines repair such selectors from page 1
  // reusing the same fetch, and the run persists them.
  assert.match(source, /listSelectorsStatus\(profile\.selectors\)/,
    'a profile with unconfigured list selectors must run engine-side discovery first');
  assert.match(source, /selectorStatus\s*!==\s*'custom'/,
    'only non-custom (empty, partial, still-default) selectors trigger the repair');
  assert.match(source, /page\.discoveredSelectors/,
    'engine-discovered selectors must be persisted to the profile');
  assert.match(source, /engineSelectorsSaved/,
    'the repair must be saved once per run, not on every page');
});

test('node: the detail stage falls back when no detail field is populated', () => {
  const source = stripComments(nodeProcessor);
  assert.match(source, /if \(!probe && !detailRescued\)/, 'an unproductive detail probe must trigger the rescue');
  assert.match(source, /applySelectorSuggestions\(profile, sample\.url, 'detail', job, false\)/,
    'the detail rescue must re-run discovery with onlyMissing=false');
});

test('node: applySelectorSuggestions reports how many selectors it filled', () => {
  const source = stripComments(nodeProcessor);
  assert.match(source, /mode: 'list'\|'detail', job: Job, onlyMissing = true\): Promise<number>/,
    'callers branch on the count, so void would always be falsy');
  assert.match(source, /return entries\.length;/, 'the success path must return the number of filled entries');
});

test('worker: zero extracted products triggers the auto-suggest fallback', () => {
  const source = stripComments(workerProcessor);
  assert.match(source, /if\(!page\.products\.length&&!checkpoint\.listRescued\)/,
    'the worker must rescue an empty page before throwing');
  const branch = source.slice(source.indexOf('if(!page.products.length&&!checkpoint.listRescued)'));
  assert.match(branch.slice(0, 900), /applySelectorSuggestions\(profile,page\.url,'list',job,false\)/);
  assert.match(branch.slice(0, 900), /scrapeListPage\(/, 'the worker must retry the page after repairing selectors');
});

test('worker: the rescue flags live on the checkpoint so resumes do not loop', () => {
  const source = stripComments(workerProcessor);
  assert.match(source, /listRescued\?:boolean;detailRescued\?:boolean/,
    'both flags must be persisted on ScrapeCheckpoint');
});

test('worker: the detail stage falls back when no detail field is populated', () => {
  const source = stripComments(workerProcessor);
  assert.match(source, /if\(!checkpoint\.detailRescued&&hasDetailSelectors\(profile\.selectors\)\)/);
  assert.match(source, /applySelectorSuggestions\(profile,sample\.url,'detail',job,false\)/);
});

test('both runtimes probe the same detail fields', () => {
  const extract = source => {
    const match = source.match(/const DETAIL_KEYS\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, 'DETAIL_KEYS must exist');
    return match[1].split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  };
  assert.deepEqual(extract(nodeProcessor), extract(workerProcessor),
    'node and worker must agree on what counts as a populated detail');
});

test('end to end: auto-suggest rescues a page that extracted zero products', async () => {
  // A real catalogue whose saved selectors are stale AND whose cards carry no
  // price text, so the discovery engines find nothing either. This is exactly
  // the "connection succeeds but zero products" report.
  const html = `<html><body><div class="products">${[1, 2, 3].map(i => `
    <li class="product">
      <a href="/p/item-${i}/" class="woocommerce-LoopProduct-link">
        <img src="https://cdn.example.test/${i}.jpg">
        <h2 class="woocommerce-loop-product__title">کالای شمارهٔ ${i}</h2>
      </a>
    </li>`).join('')}</div></body></html>`;
  const stale = { container: '.legacy-grid .card', title: '.legacy-title', price: '.legacy-price', link: 'a.legacy', image: 'img.legacy' };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { headers: { 'content-type': 'text/html' } });
  try {
    const before = await scraper.scrapeListPage('https://shop.example.test/c/', stale, '', false, 'auto');
    assert.equal(before.products.length, 0, 'the stale selectors must genuinely extract nothing');

    // What the fallback does: ask for suggestions and merge the non-empty ones.
    const suggestion = await scraper.suggestSelectors('https://shop.example.test/c/', 'list');
    const repaired = { ...stale, ...Object.fromEntries(Object.entries(suggestion.selectors || {}).filter(([, value]) => String(value || '').trim())) };
    assert.ok(repaired.container !== stale.container, 'discovery must propose a new container');

    const after = await scraper.scrapeListPage('https://shop.example.test/c/', repaired, '', false, 'auto');
    assert.equal(after.products.length, 3, 'the repaired selectors must recover every card');
    assert.equal(after.products[0].title, 'کالای شمارهٔ 1');
    assert.match(after.products[0].url, /\/p\/item-1\/?$/, 'links must survive the rescue');
  } finally { globalThis.fetch = previousFetch }
});

test('worker: structural discovery finds selectors for an unknown shop layout', async () => {
  // Tailwind-style shop: no curated selector matches, no JSON-LD, Persian
  // prices, and plain /item-N/ URLs the heuristic engine ignores. With
  // never-configured (WooCommerce default) selectors the engines must still
  // find the cards structurally — the Worker twin of the 1.128.0 Node proof.
  const cards = [1, 2, 3, 4, 5].map(i => `
    <div class="x7f2a shop-card">
      <a href="/item-${i}/"><img src="https://cdn.example.test/${i}.jpg"><span class="x7f2a card-name">کالای فروشگاه شمارهٔ ${i}</span></a>
      <b class="x7f2a cost">${(i * 1250000).toLocaleString('en-US')} تومان</b>
    </div>`).join('');
  const html = `<html><body><div class="x7f2a shop-grid">${cards}</div></body></html>`;
  const base = 'https://shop.example.test/';
  const defaults = { container: 'li.product', title: 'h2, h3, .woocommerce-loop-product__title', price: '.price, .amount', link: 'a[href]', image: 'img' };
  assert.equal(scraper.listSelectorsStatus(defaults), 'default');
  assert.equal(scraper.listSelectorsStatus({ container: '', title: '', price: '', link: '', image: '' }), 'empty');
  assert.equal(scraper.listSelectorsStatus({ ...defaults, container: '.mine' }), 'custom');

  const found = await scraper.discoverListSelectorsFromHtml(html, base);
  assert.equal(found.method, 'structural', 'no curated selector fits this markup');
  assert.ok(found.selectors.container && found.selectors.container.includes('shop-card'), `container must name the card cluster, got ${found.selectors.container}`);
  assert.ok(found.selectors.title, 'a title selector must be derived from inside the cards');
  const verified = await scraper.verifyListSelectors(html, base, { ...defaults, ...found.selectors });
  assert.equal(verified.ok, true, 'the discovered selectors must verify against the same page');
  assert.equal(verified.containerCount, 5);

  // The real scrape path adopts them (reusing the same fetch) and reports
  // them for persistence; autoDiscover=false keeps the old blind behavior.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { headers: { 'content-type': 'text/html' } });
  try {
    const discovered = await scraper.scrapeListPage('https://shop.example.test/', defaults, '', false, 'auto');
    assert.equal(discovered.products.length, 5, 'all five structural cards must extract');
    assert.equal(discovered.products[0].title, 'کالای فروشگاه شمارهٔ 1');
    assert.equal(discovered.products[0].price, 1250000);
    assert.ok(discovered.discoveredSelectors && discovered.discoveredSelectors.container, 'the run must report selectors to persist');
    const blind = await scraper.scrapeListPage('https://shop.example.test/', defaults, '', false, 'auto', undefined, true, false);
    assert.equal(blind.products.length, 0, 'without discovery the default selectors must stay blind');
    assert.equal(blind.discoveredSelectors, undefined);
  } finally { globalThis.fetch = previousFetch }
});

test('dashboard: the selector test buttons run auto-suggest as a last resort', async () => {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const slice = name => {
    const start = dashboard.indexOf(`async function ${name}(`);
    assert.ok(start > 0, `${name} must exist`);
    return dashboard.slice(start, dashboard.indexOf('\nasync function ', start + 10));
  };
  const list = slice('testSelectors');
  assert.match(list, /results\.every\(x=>!x\.ok\)\)\{[^}]*await suggestSelectorFields\(\)/,
    'a list test where nothing matched must invoke the auto-suggest button handler');
  const detail = slice('testDetailSelectors');
  assert.match(detail, /results\.every\(x=>!x\.ok\)\)\{[^}]*await suggestDetailFields\(\)/,
    'a detail test where nothing matched must invoke the detail auto-suggest handler');
});

// ---------------------------------------------------------------------------
// Dashboard usability fixes (request 33).
// ---------------------------------------------------------------------------
test('dashboard: the sync preview reports progress and registers a task', async () => {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const start = dashboard.indexOf("if(action==='recon-unified-preview'||action==='recon-unified-apply')");
  assert.ok(start > 0, 'the unified preview handler must exist');
  const branch = dashboard.slice(start, start + 2200);
  assert.match(branch, /localTaskStart\(taskKey,taskName/, 'it must register a task before the request');
  assert.match(branch, /localTaskEnd\(taskKey,d\.ok!==false/, 'it must close the task on success');
  assert.match(branch, /catch\(error\)\{localTaskEnd\(taskKey,false/, 'it must close the task on failure');
  assert.match(branch, /در حال خواندن مقصدها/, 'it must show immediate in-place feedback');
});

test('dashboard: local tasks are merged into the activity list', async () => {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  assert.match(dashboard, /const runs2=\[\.\.\.Array\.from\(localTasks\.values\(\)\),\.\.\.runs\]/,
    'renderActivity must include client-side tasks');
  assert.match(dashboard, /const runsHtml=runs2\.length\?\(/, 'the empty check must consider local tasks too');
  assert.match(dashboard, /const del=r\.local\?''/, 'a local task has no server run to delete');
});

test('dashboard: an empty sync preview explains which precondition is missing', async () => {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const start = dashboard.indexOf('if(!d.rows.length)');
  const branch = dashboard.slice(start, start + 900);
  assert.match(branch, /if\(!d\.accounts\)/, 'no destination configured must be its own message');
  assert.match(branch, /if\(!d\.local\)/, 'no extracted products must be its own message');
  assert.match(branch, /همه‌چیز هماهنگ است/, 'genuinely in-sync must not look like a failure');
});

test('dashboard: only recent changelog entries render expanded', async () => {
  const dashboard = await readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
  const start = dashboard.indexOf('<div class="change-list">');
  const end = dashboard.indexOf('<div id="changesResult"', start);
  const section = dashboard.slice(start, end);
  const older = section.indexOf('<details class="change-older">');
  assert.ok(older > 0, 'older entries must live in a collapsed <details>');
  const expanded = section.slice(0, older).split('<div class="change-item">').length - 1;
  const collapsed = section.slice(older).split('<div class="change-item">').length - 1;
  assert.ok(expanded > 0 && expanded <= 15, `expected a short expanded list, got ${expanded}`);
  assert.ok(collapsed > 50, `the bulk of the history must be collapsed, got ${collapsed}`);
  const total = section.split('<div class="change-item">').length - 1;
  assert.equal(expanded + collapsed, total, 'no changelog entry may be lost by the split');
  assert.ok(total > 100, `the full history must still be present, got ${total}`);
});

test('dashboard: the newest changelog entry stays visible without expanding', async () => {
  const [dashboard, pkg] = await Promise.all([
    readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  const version = JSON.parse(pkg).version;
  const digits = version.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const start = dashboard.indexOf('<div class="change-list">');
  const visible = dashboard.slice(start, dashboard.indexOf('<details class="change-older">', start));
  assert.ok(visible.includes(`نسخهٔ ${digits}`), 'the current version must be in the expanded part');
});

test('woocommerce has a real price adjustment percentage end to end', async () => {
  const [dashboard, workerVault, nodeVault, workerMaint, nodeMaint, workerSync, nodeSync] = await Promise.all([
    readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/vault.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/vault.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/maintenance.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/maintenance.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/sync.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/sync.ts', import.meta.url), 'utf8')
  ]);
  // 1. It can be entered and is persisted.
  assert.match(dashboard, /BCON\('woo\.pricePercent'\)/, 'the woo settings need a price percent input');
  for (const [name, vault] of [['worker', workerVault], ['node', nodeVault]]) {
    assert.match(vault, /pricePercent:\s*num\(input\?\.woo\?\.pricePercent/, `${name} vault must persist woo.pricePercent`);
  }
  // 2. Reconciliation treats the adjusted price as the correct one.
  assert.match(workerMaint, /name:'ووکامرس',pricePercent:Number\(c\.woo\.pricePercent\)\|\|0/);
  assert.match(nodeMaint, /pricePercent:\s*Number\(c\.woo\.pricePercent\)\s*\|\|\s*0/);
  // 3. Sync actually pushes the adjusted price.
  assert.match(workerSync, /const wooPercent=Number\(c\.pricePercent\)\|\|0/);
  assert.match(workerSync, /regular_price:wooPrice\(product\.price\)/, 'the simple product price must be adjusted');
  assert.match(workerSync, /regular_price:wooPrice\(keyedPrices\[0\]\|\|product\.price\)/, 'variations must be adjusted too');
  assert.match(nodeSync, /regular_price: String\(Math\.round\(product\.price \* \(1 \+ wooPercent \/ 100\)\)\)/);
});

test('the default basalam shop has its own price percentage', async () => {
  const [dashboard, workerSync, nodeSync, workerMaint, nodeMaint] = await Promise.all([
    readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/sync.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/sync.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/maintenance.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/maintenance.ts', import.meta.url), 'utf8')
  ]);
  assert.match(dashboard, /BCON\('basalam\.pricePercent'\)/, 'the default shop needs its own field');
  for (const [name, sync] of [['worker', workerSync], ['node', nodeSync]]) {
    assert.match(sync, /name:'پیش‌فرض',token:c\.token,vendorId:c\.vendorId,pricePercent:Number\(c\.pricePercent\)\|\|0/,
      `${name} sync must stop hardcoding the default shop to 0%`);
  }
  assert.match(workerMaint, /غرفهٔ پیش‌فرض',pricePercent:Number\(c\.basalam\.pricePercent\)\|\|0/);
  assert.match(nodeMaint, /pricePercent:\s*Number\(c\.basalam\.pricePercent\)\s*\|\|\s*0/);
});

// --- Request 36b: duplicates at the DESTINATIONS must be planned for deletion,
// keeping the more expensive listing by default.
test('planDuplicateDeletions keeps the most expensive listing per group', async () => {
  const out = join(temporary, 'recon-core-dupe.mjs');
  await build({ entryPoints: [new URL('../worker-src/recon-core.ts', import.meta.url).pathname],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'error' });
  const core = await import(pathToFileURL(out).href);
  const account = { target: 'basalam', accountKey: '55', name: 'غرفه یک', pricePercent: 0 };
  const remotes = [
    { id: 1, name: 'کیف چرم (کد 11)', price: 100000 },
    { id: 2, name: 'کیف چرم (کد 12)', price: 250000 },
    { id: 3, name: 'کیف چرم (کد 13)', price: 180000 },
    { id: 4, name: 'کفش راحتی (کد 21)', price: 90000 },
    { id: 5, name: 'محصول بدون کد', price: 500000 },
    { id: 6, name: 'محصول بدون کد', price: 400000 },
  ];
  const actions = core.planDuplicateDeletions(remotes, account);
  // The 250000 listing survives; the two cheaper copies are removed.
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map(a => a.remoteId).sort((x, y) => x - y), [1, 3]);
  for (const action of actions) {
    assert.equal(action.kind, 'deleteDuplicate');
    assert.equal(action.keepId, 2);
    assert.equal(action.keepPrice, 250000);
    assert.equal(action.groupSize, 3);
    assert.equal(action.accountKey, '55');
    assert.equal(action.accountName, 'غرفه یک');
    assert.ok(action.price < action.keepPrice, 'only cheaper copies are deleted');
  }
  // A single listing is never a duplicate, and titles without «(کد ایکس)» are
  // ignored entirely even when they repeat.
  assert.equal(actions.some(a => [4, 5, 6].includes(a.remoteId)), false);
  // The cheapest-keeping variant inverts the survivor.
  const cheap = core.planDuplicateDeletions(remotes, account, '', 'cheapest');
  assert.deepEqual(cheap.map(a => a.keepId), [1, 1]);
});

test('planDuplicateDeletions is deterministic when prices tie', async () => {
  const out = join(temporary, 'recon-core-dupe2.mjs');
  await build({ entryPoints: [new URL('../worker-src/recon-core.ts', import.meta.url).pathname],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'error' });
  const core = await import(pathToFileURL(out).href);
  const account = { target: 'woo', accountKey: 'default', name: 'ووکامرس', pricePercent: 0 };
  const remotes = [
    { id: 30, name: 'ساعت مچی (کد 3)', price: 200000 },
    { id: 12, name: 'ساعت مچی (کد 4)', price: 200000 },
  ];
  const first = core.planDuplicateDeletions(remotes, account);
  const second = core.planDuplicateDeletions([...remotes].reverse(), account);
  // Equal prices -> lowest remote id survives, regardless of input order, so a
  // preview and the following apply never disagree.
  assert.deepEqual(first.map(a => a.remoteId), [30]);
  assert.deepEqual(second.map(a => a.remoteId), [30]);
  assert.equal(first[0].keepId, 12);
});

test('expectedPriceFor applies the configured percentage', async () => {
  const out = join(temporary, 'recon-core-test.mjs');
  await build({ entryPoints: [new URL('../worker-src/recon-core.ts', import.meta.url).pathname],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'error' });
  const core = await import(pathToFileURL(out).href);
  assert.equal(core.expectedPriceFor(100000, { pricePercent: 10 }), 110000);
  assert.equal(core.expectedPriceFor(100000, { pricePercent: 0 }), 100000);
  assert.equal(core.expectedPriceFor(100000, { pricePercent: 10, toRial: true }), 1100000);
});

// --- Request 34d: an explicitly chosen engine must actually be the engine that
// runs, in the real scrape path (autoFirst=true) exactly as in the 3-page
// benchmark (autoFirst=false). Discovery engines used to be prepended before
// the explicit choice, so picking "cheerio" silently ran "heuristic" during a
// real run while the diagnostic reported the chosen engine.
test('explicitly chosen engine wins in the real scrape path, not just the 3-page benchmark',async()=>{
  // Head blobs that let the discovery engines produce a bogus early win.
  const html=`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"LD Decoy","offers":{"@type":"Offer","price":"9.99","priceCurrency":"USD"}}</script></head>`
    +`<body><ul><li class="product"><h2 class="woocommerce-loop-product__title">Real Card A</h2><span class="price">120,000</span><a class="woocommerce-LoopProduct-link" href="/p/a"></a><img src="/a.jpg"></li>`
    +`<li class="product"><h2 class="woocommerce-loop-product__title">Real Card B</h2><span class="price">130,000</span><a class="woocommerce-LoopProduct-link" href="/p/b"></a><img src="/b.jpg"></li></ul></body></html>`;
  const previousFetch=globalThis.fetch;
  env.configureEnv({DB:{prepare(){return {bind(){return this},first:async()=>null,all:async()=>({success:true,results:[]}),run:async()=>({success:true,meta:{}})}},batch:async()=>[],exec:async()=>({count:0,duration:0})}});
  globalThis.fetch=async()=>new Response(html,{headers:{'content-type':'text/html'}});
  try{
    const selectors={container:'li.product',title:'.woocommerce-loop-product__title',price:'.price',link:'a.woocommerce-LoopProduct-link',image:'img'};
    for(const engine of ['htmlrewriter','jsonld']){
      const real=await scraper.scrapeListPage('https://shop.test/list',selectors,'',false,engine,undefined,true);
      const bench=await scraper.scrapeListPage('https://shop.test/list',selectors,'',false,engine,undefined,false);
      // When the chosen engine can read the page at all, the real scrape and the
      // 3-page benchmark must report the SAME engine. (If it reads nothing the
      // real run legitimately continues to a fallback, which the benchmark -- by
      // design a single-engine probe -- never does.)
      if(bench.products.length)assert.equal(real.usedEngine,bench.usedEngine,`engine ${engine}: real run and 3-page test must agree`);
      assert.equal(bench.usedEngine,engine,`3-page test must probe exactly the chosen engine (${engine})`);
    }
    // The chosen engine runs first rather than losing to a discovery engine.
    const chosen=await scraper.scrapeListPage('https://shop.test/list',selectors,'',false,'htmlrewriter',undefined,true);
    assert.equal(chosen.usedEngine,'htmlrewriter');
    assert.equal(chosen.products.length,2);
  }finally{globalThis.fetch=previousFetch}
});

test('an explicit engine that finds nothing still falls back instead of returning zero products',async()=>{
  // No JSON-LD at all, so "jsonld" must yield nothing and hand off to a fallback.
  const html=`<html><body><ul><li class="product"><h2 class="woocommerce-loop-product__title">Fallback Card 1</h2><span class="price">91,000</span><a class="woocommerce-LoopProduct-link" href="/p/f1"></a><img src="/f1.jpg"></li><li class="product"><h2 class="woocommerce-loop-product__title">Fallback Card 2</h2><span class="price">92,000</span><a class="woocommerce-LoopProduct-link" href="/p/f2"></a><img src="/f2.jpg"></li><li class="product"><h2 class="woocommerce-loop-product__title">Fallback Card 3</h2><span class="price">93,000</span><a class="woocommerce-LoopProduct-link" href="/p/f3"></a><img src="/f3.jpg"></li><li class="product"><h2 class="woocommerce-loop-product__title">Fallback Card 4</h2><span class="price">94,000</span><a class="woocommerce-LoopProduct-link" href="/p/f4"></a><img src="/f4.jpg"></li></ul></body></html>`;
  const previousFetch=globalThis.fetch;
  env.configureEnv({DB:{prepare(){return {bind(){return this},first:async()=>null,all:async()=>({success:true,results:[]}),run:async()=>({success:true,meta:{}})}},batch:async()=>[],exec:async()=>({count:0,duration:0})}});
  globalThis.fetch=async()=>new Response(html,{headers:{'content-type':'text/html'}});
  try{
    const result=await scraper.scrapeListPage('https://shop.test/list',{container:'li.product',title:'.woocommerce-loop-product__title',price:'.price',link:'a.woocommerce-LoopProduct-link',image:'img'},'',false,'jsonld',undefined,true);
    assert.ok(result.products.length>0,'empty explicit engine must fall back, not return 0 products');
    assert.notEqual(result.usedEngine,'jsonld');
  }finally{globalThis.fetch=previousFetch}
});


// --- Request 35c: reconciliation and sync only cover products whose title ends
// with a «(کد ایکس)» code suffix, where x is any letter or digit. Products
// without one are base/draft titles and must be ignored at both ends.
test('reconciliation only covers products carrying a (کد ایکس) suffix', async () => {
  const out = join(temporary, 'recon-suffix-test.mjs');
  await build({ entryPoints: [new URL('../worker-src/recon-core.ts', import.meta.url).pathname],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'error' });
  const core = await import(pathToFileURL(out).href);

  const account = { target: 'woo', accountKey: 'default', name: 'Woo', pricePercent: 0 };
  const local = [
    { profile_id: 'p1', source_key: 'a', title: 'تیشرت مردانه (کد 1)', price: 100000, active: 1, data: {}, maps: [] },
    { profile_id: 'p1', source_key: 'b', title: 'تیشرت مردانه (کد A2)', price: 100000, active: 1, data: {}, maps: [] },
    { profile_id: 'p1', source_key: 'c', title: 'تیشرت مردانه', price: 100000, active: 1, data: {}, maps: [] },
    { profile_id: 'p1', source_key: 'd', title: 'کفش تکی (کد ۹)', price: 50000, active: 1, data: {}, maps: [] },
  ];
  const rows = core.reconcileAccount(local, [], account, {});
  const titles = rows.map(r => r.title);
  assert.ok(!titles.includes('تیشرت مردانه'), 'a title with no code suffix must be excluded');
  assert.equal(rows.length, 3, 'only the three suffixed products take part');

  // Duplicate count = size of the group sharing a title once the code is removed.
  const byTitle = Object.fromEntries(rows.map(r => [r.title, r.duplicateCount]));
  assert.equal(byTitle['تیشرت مردانه (کد 1)'], 2, 'both تیشرت variants count as one group of 2');
  assert.equal(byTitle['تیشرت مردانه (کد A2)'], 2, 'a letter code groups with a digit code');
  assert.equal(byTitle['کفش تکی (کد ۹)'], 1, 'a product with no sibling reports 1');

  // A destination product outside the convention is not reported as "extra".
  const remoteRows = core.reconcileAccount([], [{ id: 7, name: 'محصول دستی بدون کد', price: 1000 }], account, {});
  assert.equal(remoteRows.length, 0, 'destination products without a code suffix are out of scope');
});

test('code suffix accepts any letter or digit and strips repeated codes', async () => {
  const out = join(temporary, 'dedup-suffix-test.mjs');
  await build({ entryPoints: [new URL('../worker-src/dedup.ts', import.meta.url).pathname],
    bundle: true, platform: 'neutral', format: 'esm', outfile: out, logLevel: 'error' });
  const dedup = await import(pathToFileURL(out).href);
  const patterns = dedup.suffixPatterns(dedup.parseSuffixFormats(''));

  for (const title of ['کالا (کد 12)', 'کالا (کد A5)', 'کالا (کد:ب۳)', 'کالا (code B2)', 'کالا #77'])
    assert.equal(dedup.hasCodeSuffix(title, patterns), true, `${title} must be recognised`);
  for (const title of ['کالای بدون کد', 'لپ تاپ (رنگ مشکی)', ''])
    assert.equal(dedup.hasCodeSuffix(title, patterns), false, `${title} must NOT be recognised`);

  // The grouping key ignores the code, so variants collapse together.
  assert.equal(dedup.stripCodeSuffix('کالا (کد 12)', patterns), 'کالا');
  assert.equal(dedup.stripCodeSuffix('کالا (کد A5)', patterns), 'کالا');
  assert.equal(dedup.stripCodeSuffix('کالا (کد:2) (کد A5)', patterns), 'کالا');
});
