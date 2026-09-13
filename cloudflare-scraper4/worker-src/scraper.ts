import { loadConnections } from './connections.js';
import { safeText, safeTextViaWorker } from './network.js';
import { escapeHtml, sha256 } from './utils.js';
import type { ExtractionEngine, Product, Profile, Selectors, VariationGroup } from './types.js';
import { DEFAULT_SELECTORS } from './types.js';

type SelectorMap=Partial<Selectors>;

interface RewriterResponse { text():Promise<string> }
declare class HTMLRewriter {
  on(selector:string,handler:any):HTMLRewriter;
  transform(response:Response):RewriterResponse;
}

type HtmlElement={
  tagName?:string;
  getAttribute(name:string):string|null;
  setAttribute(name:string,value:string):void;
  removeAttribute(name:string):void;
  before(value:string,options?:{html?:boolean}):void;
  after(value:string,options?:{html?:boolean}):void;
  remove():void;
  onEndTag(callback:()=>void):void;
  attributes:Iterable<[string,string]>;
};
type TextChunk={text:string;lastInTextNode?:boolean};

type FieldName='title'|'price'|'link'|'image'|'sku';
type RankedValue={value:string;rank:number};
type Card={values:Partial<Record<FieldName,RankedValue>>};
type DetailResult={
  shortDesc:string;longDesc:string;price:string;sku:string;brand:string;stock:string;weight:string;category:string;tags:string;mainImage:string;
  images:string[];variations:string[];variationGroups:VariationGroup[];variationPrices:Record<string,number>;
  /** Specification rows parsed from the marked specs block. */
  specs?:Array<{name:string;value:string}>;
};

const DEFAULT_CONTAINER='.product, li.product, article.product, .product-item, .product-card, [data-product-id], [itemtype*="Product"]';
const FALLBACKS:Record<FieldName,string>={
  title:'.woocommerce-loop-product__title, .product-title, .product-name, [itemprop="name"], h1, h2, h3',
  price:'.price ins, .sale-price, [itemprop="price"], .price, .amount, [data-price]',
  link:'a.woocommerce-LoopProduct-link, a.product-link, a[href*="/product/"], a[href*="/products/"], a[href]',
  image:'img.wp-post-image, img.product-image, [itemprop="image"], picture img, img, source',
  sku:'[data-sku], [itemprop="sku"], .sku'
};
const DETAIL_KEYS=['shortDesc','price','sku','category','tags','weight','stock','brand'] as const;
const IMAGE_ATTRS=['data-zoom-image','data-large_image','data-large-image','data-full','data-src','data-lazy-src','data-original','src','content','href'];
const LINK_ATTRS=['data-href','href','data-url','data-link','data-product-url','data-product-link','content'];
function onclickUrl(element:HtmlElement):string{return element.getAttribute('onclick')?.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i)?.[1]||''}
const TITLE_ATTRS=['data-title','title','aria-label','content'];
const PRICE_ATTRS=['data-price','data-regular-price','data-sale-price','content','value'];
const SKU_ATTRS=['data-sku','data-product-sku','content','value'];
// Cloudflare's streaming parser rejects Element.onEndTag() for HTML void
// elements (for example img/input/source) with "Parser error: No end tag".
// Attribute-only fields never need an end callback, and text handlers must skip
// it for tags which cannot contain text.
const VOID_TAGS=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function hasEndTag(element:HtmlElement):boolean{return !VOID_TAGS.has(String(element.tagName||'').toLowerCase())}
async function sourceKey(value:string):Promise<string>{return (await sha256(value)).slice(0,32)}
export async function sourceText(url:string,indirect=false,maxBytes=8_000_000){
  const network=(await loadConnections()).ai.network;
  // A Worker URL saved in «روش اتصال» now applies to source pages too, not only
  // to AI calls. Previously it was used only when a profile had ticked the
  // per-profile «اتصال غیرمستقیم» box, so users who configured the gateway to
  // bypass a sanction block still hit the block on every extraction.
  const useWorker=Boolean(network.workerUrl)&&(indirect||network.mode==='worker');
  if(useWorker)return safeTextViaWorker(url,network.workerUrl,maxBytes);
  if(indirect&&network.mode!=='worker')throw new Error('اتصال غیرمستقیم مبدأ در Cloudflare فقط با روش Worker URL پشتیبانی می‌شود. (در محیط Cloudflare پروکسی HTTP در دسترس نیست؛ آدرس Worker واسط را وارد کنید.)');
  return safeText(url,maxBytes);
}
function toAbsoluteUrl(value:string,base:string):string{try{return new URL(value,base).href}catch{return ''}}

const TRACKING_PARAMS=/^(utm_.+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|ref_.*|source)$/i;
/** Pagination/sorting noise: never part of a product's identity. */
const PAGING_PARAMS=/^(page|paged|p|offset|start|limit|per_page|perpage|sort|order|orderby|view|display)$/i;

function selectorParts(selector?:string):string[]{
  const out:string[]=[],value=String(selector||'');let part='',round=0,square=0,quote='';
  for(const char of value){
    if(quote){part+=char;if(char===quote)quote='';continue}
    if(char==='"'||char==="'"){quote=char;part+=char}else if(char==='('){round++;part+=char}else if(char===')'){round=Math.max(0,round-1);part+=char}else if(char==='['){square++;part+=char}else if(char===']'){square=Math.max(0,square-1);part+=char}else if(char===','&&!round&&!square){if(part.trim())out.push(part.trim());part=''}else part+=char;
  }
  if(part.trim())out.push(part.trim());return out;
}
function multilineSelectorParts(selector?:string):string[]{return String(selector||'').split(/[\r\n|]+/).flatMap(part=>selectorParts(part)).filter(Boolean)}
/**
 * 1.141.0 — Chrome copy-XPath → CSS converter. Users paste the container from
 * DevTools ("Copy XPath"), e.g. `//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article`.
 * The convertible dialect is exactly what Chrome emits: absolute `/a/b` and `//a`
 * paths, `*` steps, positional `[N]` / `[position()=N]` / `[last()]` predicates,
 * `@attr="value"` equality, `contains()` / `starts-with()` / `ends-with()` on
 * attributes, `and`-joined predicate lists, `./` + `.//` relative paths, and `|`
 * unions of the above. Anything else (axes, `..`, `text()`, `or`, `name()`, bare
 * `(//x)[N]`) returns null so the caller keeps the original selector and the run
 * fails honestly with the tagged invalid-selector error instead of matching the
 * wrong elements. Twin: render-src/scraper.ts.
 */
export function isXPathSelector(selector:string):boolean{
  const value=String(selector||'').trim();if(!value)return false;
  if(/^(\(\/\/|\/\/|\/html\b|\/\*|\.\/\/|\.\/)/.test(value))return true;
  return value.startsWith('/')&&(value.includes('@')||value.includes('['));
}
function splitOutsideXPath(input:string,seps:string):string[]{
  const parts:string[]=[];let depth=0,quote='',current='';
  for(const ch of input){
    if(quote){current+=ch;if(ch===quote)quote='';continue}
    if(ch==='"'||ch==="'"){quote=ch;current+=ch;continue}
    if(ch==='[')depth++;else if(ch===']')depth=Math.max(0,depth-1);
    if(depth===0&&seps.includes(ch)){parts.push(current);current='';continue}
    current+=ch;
  }
  parts.push(current);return parts;
}
function splitXPathAnd(predicate:string):string[]{
  const parts:string[]=[];let depth=0,quote='',current='';
  for(let i=0;i<predicate.length;i++){
    const ch=predicate[i];
    if(quote){current+=ch;if(ch===quote)quote='';continue}
    if(ch==='"'||ch==="'"){quote=ch;current+=ch;continue}
    if(ch==='['||ch==='(')depth++;else if(ch===']'||ch===')')depth=Math.max(0,depth-1);
    if(depth===0&&predicate.startsWith(' and ',i)){parts.push(current);current='';i+=4;continue}
    current+=ch;
  }
  parts.push(current);return parts;
}
function xpathSinglePredicateToCss(part:string,tag:string):string|null{
  const nth=tag==='*'?'nth-child':'nth-of-type',last=tag==='*'?'last-child':'last-of-type';
  let match=part.match(/^(\d+)$/)||part.match(/^position\(\)\s*=\s*(\d+)$/);
  if(match)return `:${nth}(${match[1]})`;
  if(/^last\(\)$/.test(part))return `:${last}`;
  match=part.match(/^@([\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')$/);
  if(match)return `[${match[1]}="${String(match[3]??match[4]??'').replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"]`;
  match=part.match(/^(contains|starts-with|ends-with)\(\s*@([\w.-]+)\s*,\s*("([^"]*)"|'([^']*)')\s*\)$/);
  if(match){const operator=match[1]==='contains'?'*=':(match[1]==='starts-with'?'^=':'$=');return `[${match[2]}${operator}"${String(match[4]??match[5]??'').replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"]`}
  return null;
}
function xpathPredicateToCss(predicate:string,tag:string):string|null{
  let css='';for(const raw of splitXPathAnd(predicate.trim())){const converted=xpathSinglePredicateToCss(raw.trim(),tag);if(converted===null)return null;css+=converted}return css;
}
type XPathStep={axis:'child'|'descendant';tag:string;predicates:string[]};
function xpathParseStep(raw:string):Omit<XPathStep,'axis'>|null{
  const bracket=raw.indexOf('['),tag=(bracket<0?raw:raw.slice(0,bracket)).trim();
  if(!/^(\*|[A-Za-z_][\w.-]*)$/.test(tag))return null;
  const predicates:string[]=[];
  if(bracket>=0){
    const rest=raw.slice(bracket);let cursor=0;
    while(cursor<rest.length){
      if(rest[cursor]!=='[')return null;
      let depth=0,quote='',end=cursor;
      for(;end<rest.length;end++){const ch=rest[end];if(quote){if(ch===quote)quote=''}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='[')depth++;else if(ch===']'){depth--;if(depth===0)break}}
      if(depth!==0)return null;
      predicates.push(rest.slice(cursor+1,end).trim());cursor=end+1;
      while(rest[cursor]===' '||rest[cursor]==='\t')cursor++;
    }
  }
  return{tag,predicates};
}
function xpathSingleToCss(input:string):string|null{
  if(input.startsWith('('))return null;
  let cursor=0,pendingAxis:'child'|'descendant'='descendant',scoped=false;
  if(input.startsWith('.//'))cursor=3;
  else if(input.startsWith('./')){cursor=2;pendingAxis='child';scoped=true}
  else if(input.startsWith('//'))cursor=2;
  else if(input.startsWith('/')){cursor=1;pendingAxis='child'}
  else return null;
  const steps:XPathStep[]=[];
  while(cursor<input.length){
    let end=cursor,depth=0,quote='';
    for(;end<input.length;end++){const ch=input[end];if(quote){if(ch===quote)quote=''}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='[')depth++;else if(ch===']'){depth--;if(depth<0)return null}else if(ch==='/'&&depth===0)break}
    const step=xpathParseStep(input.slice(cursor,end).trim());if(!step)return null;
    steps.push({...step,axis:pendingAxis});
    if(end>=input.length)break;
    if(input[end+1]==='/'){pendingAxis='descendant';cursor=end+2}else{pendingAxis='child';cursor=end+1}
  }
  if(!steps.length)return null;
  let css=scoped?':scope':'';
  for(let index=0;index<steps.length;index++){
    const step=steps[index];let chunk=step.tag==='*'?'':cssEscapeIdent(step.tag);
    for(const predicate of step.predicates){const converted=xpathPredicateToCss(predicate,step.tag);if(converted===null)return null;chunk+=converted}
    if(!chunk)chunk='*';
    if(index>0)css+=step.axis==='descendant'?' ':' > ';else if(scoped)css+=' > ';
    css+=chunk;
  }
  return css||null;
}
export function xpathToCss(selector:string):string|null{
  const input=String(selector||'').trim();
  if(!isXPathSelector(input))return null;
  const arms=splitOutsideXPath(input,'|');
  if(arms.length>1){const converted:string[]=[];for(const arm of arms){const css=xpathSingleToCss(arm.trim());if(css===null)return null;converted.push(css)}return converted.join(', ')}
  return xpathSingleToCss(input);
}
function safeOn(rewriter:HTMLRewriter,selector:string,handler:any):boolean{
  // Pasted copy-XPath compiles as its CSS equivalent; out-of-dialect XPath
  // keeps the original text and still fails safe (skip) as before.
  const css=xpathToCss(selector)??selector;
  try{rewriter.on(css,handler);return true}catch{return false}
}
function cleanText(value:string):string{
  // HTMLRewriter hands text chunks and attributes over with entities still encoded,
  // so "iPhone 17 Pro &amp; iPhone 17 Pro Max" would otherwise be stored verbatim
  // and then never match the same product on the destination store.
  return normalizeDigits(decodeEntities(String(value||''))).replace(/[\u200c\u200e\u200f\u202a-\u202e]/g,' ').replace(/\s+/g,' ').trim();
}
function decodeEntities(value:string):string{
  if(!value.includes('&'))return value;
  return value
    .replace(/&(?:nbsp|#160|#xa0);/gi,' ')
    .replace(/&(?:quot|#34|#x22);/gi,'"')
    .replace(/&(?:apos|#39|#x27);/gi,"'")
    .replace(/&(?:lt|#60|#x3c);/gi,'<')
    .replace(/&(?:gt|#62|#x3e);/gi,'>')
    .replace(/&#(\d{1,7});/g,(_,code)=>safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi,(_,code)=>safeCodePoint(parseInt(code,16)))
    .replace(/&(?:amp|#38|#x26);/gi,'&');
}
function safeCodePoint(code:number):string{
  if(!Number.isFinite(code)||code<=0||code>0x10ffff)return '';
  try{return String.fromCodePoint(code)}catch{return ''}
}
function normalizeDigits(value:string):string{
  return String(value||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
function firstAttribute(element:HtmlElement,names:string[]):string{
  for(const name of names){const value=element.getAttribute(name);if(value&&value.trim())return value.trim()}
  return '';
}
function srcsetValue(value:string):string{
  const items=String(value||'').split(',').map(part=>part.trim()).filter(Boolean).map(part=>{
    const match=part.match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
    return {url:match?.[1]||part.split(/\s+/)[0],score:Number(match?.[2]||1)*(match?.[3]?.toLowerCase()==='x'?10000:1)};
  }).filter(item=>item.url);
  return items.sort((a,b)=>b.score-a.score)[0]?.url||'';
}
function elementValue(field:FieldName,element:HtmlElement,text=''):string{
  if(field==='link')return firstAttribute(element,LINK_ATTRS)||onclickUrl(element);
  if(field==='image')return firstAttribute(element,IMAGE_ATTRS)||srcsetValue(element.getAttribute('data-srcset')||element.getAttribute('srcset')||'');
  if(field==='title')return cleanText(text)||firstAttribute(element,TITLE_ATTRS);
  if(field==='price')return cleanText(text)||firstAttribute(element,PRICE_ATTRS);
  if(field==='sku')return cleanText(text)||firstAttribute(element,SKU_ATTRS);
  return cleanText(text);
}
function canonicalUrl(value:string,baseUrl:string,stripAllQuery=false):string{
  const raw=String(value||'').trim();if(!raw||/^(?:#|javascript:|mailto:|tel:|data:|blob:)/i.test(raw))return '';
  const absolute=toAbsoluteUrl(raw.replace(/&amp;/gi,'&'),baseUrl);
  if(!absolute||!/^(https?):/i.test(absolute))return '';
  try{
    const url=new URL(absolute);url.hash='';
    if(stripAllQuery){
      for(const key of [...url.searchParams.keys()]){
        // Keep identifying parameters (?id=, ?p=, ?product=...); drop only noise.
        if(TRACKING_PARAMS.test(key)||PAGING_PARAMS.test(key))url.searchParams.delete(key);
      }
      url.searchParams.sort();
    }
    else for(const key of [...url.searchParams.keys()])if(TRACKING_PARAMS.test(key))url.searchParams.delete(key);
    url.pathname=url.pathname.replace(/\/{2,}/g,'/');
    return url.toString().replace(/\/$/,'');
  }catch{return absolute}
}
function imageUrl(value:string,baseUrl:string):string{
  const raw=String(value||'').trim();
  if(!raw||/^(data:|blob:|javascript:|#)/i.test(raw)||/(?:placeholder|spacer|transparent|loading)(?:[-_.]|$)/i.test(raw))return '';
  const absolute=toAbsoluteUrl(raw.replace(/&amp;/gi,'&'),baseUrl);
  return /^(https?):/i.test(absolute)?absolute:'';
}
function galleryKey(url:string):string{return url.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]{3,5}(?:[?#]|$))/i,'').replace(/[?#].*$/,'')}
function addGalleryImage(images:string[],raw:string,baseUrl:string,max=30):void{const url=imageUrl(raw,baseUrl);if(url&&images.length<Math.max(1,Math.min(30,max))&&!images.some(existing=>galleryKey(existing)===galleryKey(url)))images.push(url)}
function linkScore(value:string):number{
  if(!value||/^(javascript:|mailto:|tel:|#)/i.test(value))return -1000;
  let score=0;
  if(/\/products?\//i.test(value))score+=40;
  if(/[?&](?:add-to-cart|remove_item)=|\/cart\/?|wishlist|compare/i.test(value))score-=200;
  return score;
}
function setCardValue(card:Card,field:FieldName,value:string,rank:number,baseUrl:string):void{
  let clean=String(value||'').trim();
  if(field==='link'){clean=canonicalUrl(clean,baseUrl);rank+=linkScore(clean)}
  else if(field==='image')clean=imageUrl(clean,baseUrl);
  else clean=cleanText(clean);
  if(!clean)return;
  const previous=card.values[field];
  if(!previous||rank>previous.rank)card.values[field]={value:clean,rank};
}

class CardHandler {
  stack:Card[]=[];
  constructor(private output:Card[],private baseUrl:string){}
  element(element:HtmlElement):void{
    const card:Card={values:{}};this.stack.push(card);
    setCardValue(card,'link',firstAttribute(element,LINK_ATTRS),15,this.baseUrl);
    setCardValue(card,'image',firstAttribute(element,IMAGE_ATTRS)||srcsetValue(element.getAttribute('srcset')||''),15,this.baseUrl);
    setCardValue(card,'title',firstAttribute(element,TITLE_ATTRS),15,this.baseUrl);
    setCardValue(card,'price',firstAttribute(element,PRICE_ATTRS),15,this.baseUrl);
    setCardValue(card,'sku',firstAttribute(element,SKU_ATTRS),15,this.baseUrl);
    if(!hasEndTag(element)){this.stack.pop();this.output.push(card);return}
    element.onEndTag(()=>{const ended=this.stack.pop();if(ended)this.output.push(ended)});
  }
  current():Card|undefined{return this.stack[this.stack.length-1]}
}
class CardFieldHandler {
  private captures:Array<{card:Card;text:string;element:HtmlElement}>=[];
  constructor(private cards:CardHandler,private field:FieldName,private rank:number,private baseUrl:string){}
  element(element:HtmlElement):void{
    const card=this.cards.current();if(!card||this.captures.some(capture=>capture.card===card))return;
    const immediate=elementValue(this.field,element);
    if(immediate)setCardValue(card,this.field,immediate,this.rank+2,this.baseUrl);
    if(this.field==='link'||this.field==='image'||!hasEndTag(element))return;
    const capture={card,text:'',element};this.captures.push(capture);
    element.onEndTag(()=>{
      setCardValue(card,this.field,elementValue(this.field,element,capture.text),this.rank,this.baseUrl);
      const index=this.captures.indexOf(capture);if(index>=0)this.captures.splice(index,1);
    });
  }
  text(chunk:TextChunk):void{for(const capture of this.captures)capture.text+=chunk.text}
}

export function numberFromText(value:string):number{
  const normalized=normalizeDigits(value).replace(/[٬،]/g,',').replace(/\u00a0/g,' ');
  const matches=normalized.match(/\d[\d\s,._]{0,30}\d|\d/g)||[];
  const numbers=matches.map(raw=>{
    let token=raw.trim().replace(/\s/g,'');
    if(/^\d+[.,]\d{1,2}$/.test(token)&&!/[٬،]/.test(raw))return Number(token.replace(',','.'));
    // Thousands separators plus decimal cents, e.g. "1,099.00" or "1.099,00":
    // stripping every non-digit would turn $1,099.00 into 109900.
    if(/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(token))return Number(token.replace(/,/g,''));
    if(/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(token))return Number(token.replace(/\./g,'').replace(',','.'));
    token=token.replace(/[^\d]/g,'');return Number(token||0);
  }).filter(n=>Number.isFinite(n)&&n>=0);
  return numbers.length?Math.max(...numbers):0;
}

async function parseJsonLdProducts(html:string,baseUrl:string):Promise<Product[]>{
  const products:Product[]=[];
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const data=JSON.parse(match[1].replace(/^\s*<!--|-->\s*$/g,''));
      const walk=(node:unknown,insideVariant=false):void=>{
        if(!node||typeof node!=='object')return;
        if(Array.isArray(node)){node.forEach(item=>walk(item,insideVariant));return}
        const item=node as Record<string,any>,types=Array.isArray(item['@type'])?item['@type']:[item['@type']];
        if(!insideVariant&&types.some(type=>String(type||'').toLowerCase()==='product')){
          const offers=Array.isArray(item.offers)?item.offers[0]:item.offers||{};
          const image=Array.isArray(item.image)?item.image[0]:(typeof item.image==='object'?item.image?.url:item.image),imageValue=imageUrl(String(image||''),baseUrl);
          const title=cleanText(item.name||'');const url=canonicalUrl(item.url||item['@id']||'',baseUrl),availability=String(offers.availability||'');
          const priceText=cleanText(String(offers.price||offers.lowPrice||''));if(title&&imageValue&&priceText&&numberFromText(priceText)>0)products.push({sourceKey:'',title,price:numberFromText(priceText),priceText,url,image:imageValue,images:imageValue?[imageValue]:[],sku:cleanText(String(item.sku||item.mpn||'')),brand:cleanText(String(typeof item.brand==='object'?item.brand?.name:item.brand||'')),shortDesc:cleanText(String(item.description||'')),longDesc:'',stock:/outofstock|soldout|discontinued/i.test(availability)?0:undefined,weight:undefined,category:cleanText(String(item.category||'')),tags:cleanText(Array.isArray(item.keywords)?item.keywords.join(', '):String(item.keywords||'')),variations:[],variationGroups:[],variationPrices:{},sourcePage:baseUrl,scrapedAt:new Date().toISOString()})
        }
        for(const[key,value]of Object.entries(item))walk(value,insideVariant||key==='hasVariant'||key==='isVariantOf');
      };walk(data);
    }catch{/* malformed structured data must not abort the page */}
  }
  return products;
}

export async function parseCards(html:string,baseUrl:string,selectors:SelectorMap):Promise<Product[]>{
  const cards:Card[]=[];const cardHandler=new CardHandler(cards,baseUrl);const rewriter=new HTMLRewriter();
  // The visual picker pins the clicked card with :nth-of-type(N), which makes the
  // container match exactly ONE card instead of repeating over the whole grid.
  // A container is meant to repeat, so drop the positional pins (the Node runtime
  // does the same in containerNodes(), keeping both runtimes in parity).
  const containers=selectorParts(selectors.container||DEFAULT_CONTAINER)
    .map(selector=>selector.includes(':nth-of-type(')?(selector.replace(/:nth-of-type\(\d+\)/g,'').trim()||selector):selector);
  let validContainer=false;for(const selector of containers)validContainer=safeOn(rewriter,selector,cardHandler)||validContainer;
  if(!validContainer)throw new Error('سلکتور ظرف محصول نامعتبر است.');
  for(const field of ['title','price','link','image','sku'] as FieldName[]){
    const configured=selectorParts(selectors[field]);
    for(const selector of configured){
      safeOn(rewriter,selector,new CardFieldHandler(cardHandler,field,100,baseUrl));
      if(field==='image')for(const suffix of ['img','source','a'])safeOn(rewriter,`${selector} ${suffix}`,new CardFieldHandler(cardHandler,field,99,baseUrl));
      if(field==='link')for(const suffix of ['a[href]','[data-href]','[data-url]','[data-link]','[data-product-url]','[data-product-link]','[onclick]'])safeOn(rewriter,`${selector} ${suffix}`,new CardFieldHandler(cardHandler,field,99,baseUrl));
    }
    for(const selector of selectorParts(FALLBACKS[field]))safeOn(rewriter,selector,new CardFieldHandler(cardHandler,field,10,baseUrl));
  }
  try{await rewriter.transform(new Response(html,{headers:{'content-type':'text/html; charset=UTF-8'}})).text()}catch(error){throw new Error(`پردازش HTML فهرست شکست خورد: ${error instanceof Error?error.message:String(error)}`)}
  const output:Product[]=[];const seen=new Set<string>();
  for(const card of cards){
    let title=card.values.title?.value||'',url=card.values.link?.value||'',image=card.values.image?.value||'';
    const priceText=card.values.price?.value||'',sku=card.values.sku?.value||'';
    if(!title&&url){try{title=decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()||'').replace(/[-_]+/g,' ')}catch{/* ignored */}}
    if(!title&&!url)continue;
    const identity=url?canonicalUrl(url,baseUrl,true):`${title}|${priceText}`;
    const key=await sourceKey(identity);if(seen.has(key))continue;seen.add(key);
    output.push({sourceKey:key,title,price:numberFromText(priceText),priceText,url,image,images:image?[image]:[],sku,shortDesc:'',longDesc:'',brand:'',stock:undefined,weight:undefined,category:'',variations:[],variationGroups:[],variationPrices:{},sourcePage:baseUrl,scrapedAt:new Date().toISOString()});
  }
  // Structured data is not only an all-or-nothing fallback: many storefronts render
  // cards with one missing field while keeping the complete product in JSON-LD.
  const structured=await parseJsonLdProducts(html,baseUrl),byKey=new Map<string,Product>(),byUrl=new Map<string,Product|null>(),bySku=new Map<string,Product|null>(),byTitle=new Map<string,Product|null>();
  const addUnique=(map:Map<string,Product|null>,key:string,product:Product)=>{if(key)map.set(key,map.has(key)?null:product)};
  for(const product of structured){
    const identity=product.url?canonicalUrl(product.url,baseUrl,true):`${product.title}|${product.priceText}`;product.sourceKey=await sourceKey(identity);byKey.set(product.sourceKey,product);
    addUnique(byUrl,canonicalUrl(product.url,baseUrl,true),product);addUnique(bySku,cleanText(product.sku||'').toLowerCase(),product);addUnique(byTitle,cleanText(product.title).toLowerCase(),product);
  }
  for(let index=0;index<output.length;index++){
    const product=output[index],urlKey=canonicalUrl(product.url,baseUrl,true),skuKey=cleanText(product.sku||'').toLowerCase(),titleKey=cleanText(product.title).toLowerCase();
    const fallback=byKey.get(product.sourceKey)||byUrl.get(urlKey)||bySku.get(skuKey)||byTitle.get(titleKey)||null;if(!fallback)continue;
    const merged:Product={...fallback,...product,title:product.title||fallback.title,price:product.price>0?product.price:fallback.price,priceText:product.priceText||fallback.priceText,url:product.url||fallback.url,image:product.image||fallback.image,images:product.images.length?product.images:fallback.images,shortDesc:product.shortDesc||fallback.shortDesc,longDesc:product.longDesc||fallback.longDesc,sku:product.sku||fallback.sku,brand:product.brand||fallback.brand,stock:product.stock??fallback.stock,weight:product.weight??fallback.weight,category:product.category||fallback.category,tags:product.tags||fallback.tags,variations:product.variations?.length?product.variations:fallback.variations,variationGroups:product.variationGroups?.length?product.variationGroups:fallback.variationGroups,variationPrices:Object.keys(product.variationPrices||{}).length?product.variationPrices:fallback.variationPrices};
    const mergedIdentity=merged.url?canonicalUrl(merged.url,baseUrl,true):`${merged.title}|${merged.priceText}`;merged.sourceKey=await sourceKey(mergedIdentity);output[index]=merged;byKey.delete(fallback.sourceKey);
  }
  const final:Product[]=[],finalSeen=new Set<string>();for(const product of [...output,...byKey.values()])if(!finalSeen.has(product.sourceKey)){finalSeen.add(product.sourceKey);final.push(product)}return final;
}

const DETAIL_ATTRS:Record<string,string[]>={shortDesc:['data-description','data-summary','content','title','aria-label'],sku:SKU_ATTRS,category:['data-category','data-category-name','content','title'],tags:['data-tags','data-keywords','content'],weight:['data-weight','data-product-weight','content','value'],stock:['data-stock','data-quantity','data-stock-quantity','content','value'],brand:['data-brand','data-brand-name','content','title']};
class ScalarHandler {
  private captures:Array<{text:string;element:HtmlElement}>=[];
  constructor(private key:string,private values:Map<string,string>){}
  element(element:HtmlElement):void{
    if(this.values.get(this.key)||this.captures.length)return;
    const immediate=firstAttribute(element,DETAIL_ATTRS[this.key]||['data-value','content','value']);
    if(immediate)this.values.set(this.key,cleanText(immediate));
    if(!hasEndTag(element))return;
    const capture={text:'',element};this.captures.push(capture);
    element.onEndTag(()=>{
      if(!this.values.get(this.key)){const value=cleanText(capture.text);if(value)this.values.set(this.key,value)}
      const index=this.captures.indexOf(capture);if(index>=0)this.captures.splice(index,1);
    });
  }
  text(chunk:TextChunk):void{for(const capture of this.captures)capture.text+=chunk.text}
}
class DetailImageHandler {
  constructor(private result:DetailResult,private baseUrl:string){}
  element(element:HtmlElement):void{if(this.result.mainImage)return;const value=firstAttribute(element,IMAGE_ATTRS)||srcsetValue(element.getAttribute('data-srcset')||element.getAttribute('srcset')||'');this.result.mainImage=imageUrl(value,this.baseUrl)}
}
class GalleryHandler {
  constructor(private images:string[],private baseUrl:string,private max=30){}
  element(element:HtmlElement):void{
    const candidates=[...IMAGE_ATTRS.map(attr=>element.getAttribute(attr)||''),element.getAttribute('href')||'',element.getAttribute('content')||'',srcsetValue(element.getAttribute('data-srcset')||''),srcsetValue(element.getAttribute('srcset')||'')];
    for(const candidate of candidates)addGalleryImage(this.images,candidate,this.baseUrl,this.max)
  }
}
class LongDescriptionHandler {
  constructor(private marker:string){}
  element(element:HtmlElement):void{element.before(`<!--${this.marker}:START-->`,{html:true});element.after(`<!--${this.marker}:END-->`,{html:true})}
}
class SanitizeHandler {
  element(element:HtmlElement):void{
    for(const [name] of Array.from(element.attributes))if(/^on/i.test(name)||name.toLowerCase()==='srcdoc')element.removeAttribute(name);
    for(const name of ['href','src','data-src']){const value=element.getAttribute(name);if(value&&/^\s*(?:javascript|data\s*:\s*text\/html)/i.test(value))element.removeAttribute(name)}
  }
}
class RemoveHandler {element(element:HtmlElement):void{element.remove()}}

function variationName(element:HtmlElement):string{return cleanText(firstAttribute(element,['data-attribute_name','data-attribute-name','data-name','name','data-label','aria-label']))}
class VariationContext {
  stack:string[]=[];
  current():string{return this.stack[this.stack.length-1]||''}
}
class VariationScopeHandler {
  constructor(private context:VariationContext){}
  element(element:HtmlElement):void{if(!hasEndTag(element))return;const name=variationName(element);this.context.stack.push(name);element.onEndTag(()=>this.context.stack.pop())}
}
function mergeVariation(result:DetailResult,element:HtmlElement,text:string,baseUrl:string,inheritedName=''):void{
  const attrs=Object.fromEntries(Array.from(element.attributes));
  let json:Record<string,any>={};for(const key of ['data-product_variation','data-variation','data-product-variation']){try{if(attrs[key])json=JSON.parse(attrs[key])}catch{/* ignored */}}
  const name=variationName(element)||cleanText(String(json.attribute_name||json.name||''))||inheritedName;
  const explicitValue=firstAttribute(element,['data-value','value','data-variation','data-slug'])||String(json.variation||json.value||'');
  const tag=String(element.tagName||'').toLowerCase();
  if(!name&&!explicitValue&&!['option','button','input'].includes(tag))return;
  const value=cleanText(explicitValue||text);
  if(!value||/^(انتخاب|choose|select|لطفا)/i.test(value))return;
  const label=cleanText(text);for(const item of [value,label])if(item&&item.length<=180&&!result.variations.includes(item))result.variations.push(item);
  if(name){let group=result.variationGroups.find(group=>group.name===name);if(!group){group={name,values:[]};result.variationGroups.push(group)}if(!group.values.includes(value))group.values.push(value)}
  const price=numberFromText(String(json.display_price||json.price||firstAttribute(element,['data-display_price','data-display-price','data-price','data-regular-price','data-sale-price'])||text));
  if(price>0){result.variationPrices[value]=price;if(label)result.variationPrices[label]=price}
  const variationImage=String(json.image?.full_src||json.image?.src||json.image||firstAttribute(element,IMAGE_ATTRS)||'');addGalleryImage(result.images,variationImage,baseUrl);
}
class VariationHandler {
  private captures:Array<{element:HtmlElement;text:string}>=[];
  constructor(private result:DetailResult,private baseUrl:string,private context:VariationContext){}
  element(element:HtmlElement):void{
    if(!hasEndTag(element)){mergeVariation(this.result,element,'',this.baseUrl,this.context.current());return}
    const capture={element,text:''};this.captures.push(capture);
    element.onEndTag(()=>{mergeVariation(this.result,element,capture.text,this.baseUrl,this.context.current());const index=this.captures.indexOf(capture);if(index>=0)this.captures.splice(index,1)});
  }
  text(chunk:TextChunk):void{for(const capture of this.captures)capture.text+=chunk.text}
}
/**
 * Turns a captured specification block into name/value rows. Shops write it as a
 * table, a definition list, or "name: value" bullets, so all three are accepted.
 */
function parseSpecFragment(html:string):Array<{name:string;value:string}>{
  if(!html)return [];
  const rows:Array<{name:string;value:string}>=[];
  const cell=(value:string)=>cleanText(value.replace(/<[^>]*>/g,' '));
  for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)){
    const cells=[...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)\s*>/gi)].map(m=>cell(m[1]));
    if(cells.length>=2&&cells[0]&&cells[1])rows.push({name:cells[0],value:cells.slice(1).filter(Boolean).join(' ')});
  }
  if(!rows.length){
    const terms=[...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>/gi)].map(m=>cell(m[1]));
    const values=[...html.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi)].map(m=>cell(m[1]));
    terms.forEach((name,index)=>{const value=values[index]||'';if(name&&value)rows.push({name,value})});
  }
  if(!rows.length)for(const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)){
    const parts=cell(match[1]).split(/\s*[:：]\s*/);
    if(parts.length>=2&&parts[0]&&parts[1])rows.push({name:parts[0],value:parts.slice(1).join(': ')});
  }
  return rows.filter(row=>row.name&&row.value).slice(0,60);
}
function extractMarkedFragment(html:string,marker:string):string{
  const start=`<!--${marker}:START-->`,end=`<!--${marker}:END-->`,from=html.indexOf(start);if(from<0)return '';
  const to=html.indexOf(end,from+start.length);return to<0?'':html.slice(from+start.length,to).trim();
}
function stripUnsafeHtml(html:string):string{return html.replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(script|style|iframe|object|embed|form)\b[^>]*\/?\s*>/gi,'').replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\s+(href|src|srcdoc)\s*=\s*(["'])\s*(?:javascript|data\s*:\s*text\/html)[\s\S]*?\2/gi,'')}

export async function parseDetailPage(html:string,baseUrl:string,selectors:SelectorMap):Promise<DetailResult>{
  const result:DetailResult={shortDesc:'',longDesc:'',price:'',sku:'',brand:'',stock:'',weight:'',category:'',tags:'',mainImage:'',images:[],variations:[],variationGroups:[],variationPrices:{}};
  const values=new Map<string,string>(),rewriter=new HTMLRewriter();
  for(const key of DETAIL_KEYS)for(const selector of selectorParts(selectors[key]))safeOn(rewriter,selector,new ScalarHandler(key,values));
  const marker=`SCRAPER4_${Math.random().toString(36).slice(2)}`;
  for(const selector of selectorParts(selectors.longDesc)){
    safeOn(rewriter,selector,new LongDescriptionHandler(marker));
  }
  const specsMarker=`SCRAPER4S_${Math.random().toString(36).slice(2)}`;
  for(const selector of multilineSelectorParts(selectors.specs)){
    safeOn(rewriter,selector,new LongDescriptionHandler(specsMarker));
    for(const suffix of ['script','style','iframe','object','embed','form'])safeOn(rewriter,`${selector} ${suffix}`,new RemoveHandler());
    safeOn(rewriter,`${selector} *`,new SanitizeHandler());
  }
  const detailImage=new DetailImageHandler(result,baseUrl);
  for(const selector of selectorParts(selectors.detailImage)){safeOn(rewriter,selector,detailImage);for(const suffix of ['img','source','a[href]','[data-src]','[data-large_image]','[data-zoom-image]'])safeOn(rewriter,`${selector} ${suffix}`,detailImage)}
  const galleryMax=Math.max(1,Math.min(30,Math.trunc(Number(selectors.galleryMax)||30)));
  const galleryImages:string[]=[],gallery=new GalleryHandler(galleryImages,baseUrl,galleryMax);
  for(const selector of multilineSelectorParts(selectors.gallery)){
    safeOn(rewriter,selector,gallery);
    for(const suffix of ['img','source','a','meta','[data-src]','[data-zoom-image]'])safeOn(rewriter,`${selector} ${suffix}`,gallery);
  }
  const includeGallery=multilineSelectorParts(selectors.gallery).length>0;
  const variationContext=new VariationContext();
  for(const selector of multilineSelectorParts(selectors.variations)){
    safeOn(rewriter,`${selector} select`,new VariationScopeHandler(variationContext));
    safeOn(rewriter,selector,new VariationHandler(result,baseUrl,variationContext));
    for(const suffix of ['option','button','input','[data-value]','[data-variation]','[data-product_variation]'])safeOn(rewriter,`${selector} ${suffix}`,new VariationHandler(result,baseUrl,variationContext));
    // تنوع‌ها به‌عنوان گالری عکس: تصاویر داخل عناصر تنوع هم به گالری اضافه می‌شوند، نه فقط متن.
    if(includeGallery)for(const suffix of ['img','source','a[href]','[data-src]','[data-large_image]','[data-zoom-image]'])safeOn(rewriter,`${selector} ${suffix}`,gallery);
  }
  let transformed='';try{transformed=await rewriter.transform(new Response(html,{headers:{'content-type':'text/html; charset=UTF-8'}})).text()}catch(error){throw new Error(`پردازش HTML جزئیات شکست خورد: ${error instanceof Error?error.message:String(error)}`)}
  for(const key of DETAIL_KEYS)result[key]=values.get(key)||'';
  result.longDesc=stripUnsafeHtml(extractMarkedFragment(transformed,marker));
  const specRows=parseSpecFragment(extractMarkedFragment(transformed,specsMarker));if(specRows.length)result.specs=specRows;if(includeGallery)for(const image of result.images)addGalleryImage(galleryImages,image,baseUrl,galleryMax);result.images=galleryImages;
  applyJsonLdDetail(html,baseUrl,result,galleryMax,includeGallery);
  if(selectors.gallerySkipFirst&&result.images.length)result.images=result.images.slice(1);
  result.variations=[...new Set(result.variations.map(cleanText).filter(Boolean))];
  result.variationGroups=result.variationGroups.filter(group=>group.name&&group.values.length).map(group=>({...group,values:[...new Set(group.values.map(cleanText).filter(Boolean))]}));
  return result;
}
function applyJsonLdDetail(html:string,baseUrl:string,result:DetailResult,galleryMax=30,includeGallery=true):void{
  const imageValue=(raw:any)=>String(typeof raw==='object'?(raw?.url||raw?.contentUrl||raw?.['@id']||''):raw||'');
  const addVariant=(variant:any)=>{
    if(!variant||typeof variant!=='object')return;const groups:Array<[string,string]>=[];
    for(const key of ['color','size','material','pattern']){const value=cleanText(String(variant[key]||''));if(value)groups.push([key,value])}
    const properties=Array.isArray(variant.additionalProperty)?variant.additionalProperty:[variant.additionalProperty];for(const property of properties)if(property&&typeof property==='object'){const name=cleanText(String(property.name||property.propertyID||'ویژگی')),value=cleanText(String(property.value||property.valueReference?.name||''));if(value)groups.push([name,value])}
    if(!groups.length&&variant.isVariantOf){const value=cleanText(String(variant.name||''));if(value)groups.push(['تنوع',value])}
    const offer=Array.isArray(variant.offers)?variant.offers[0]:variant.offers||{},price=numberFromText(String(offer.price||offer.lowPrice||offer.highPrice||''));
    for(const[name,value]of groups){if(!result.variations.includes(value))result.variations.push(value);let group=result.variationGroups.find(item=>item.name===name);if(!group){group={name,values:[]};result.variationGroups.push(group)}if(!group.values.includes(value))group.values.push(value);if(price>0)result.variationPrices[value]=price}
    if(includeGallery){const images=Array.isArray(variant.image)?variant.image:[variant.image];for(const raw of images)addGalleryImage(result.images,imageValue(raw),baseUrl,galleryMax)}
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))try{
    const root=JSON.parse(match[1].replace(/^\s*<!--|-->\s*$/g,'')),queue:any[]=[root];while(queue.length){const node=queue.shift();if(!node||typeof node!=='object')continue;if(Array.isArray(node)){queue.push(...node);continue}queue.push(...Object.values(node).filter(value=>value&&typeof value==='object'));
      const types=(Array.isArray(node['@type'])?node['@type']:[node['@type']]).map((type:unknown)=>String(type||'').toLowerCase());if(!types.includes('product')&&!types.includes('productgroup'))continue;
      if(types.includes('product')){if(!result.sku)result.sku=cleanText(String(node.sku||node.mpn||''));if(!result.brand)result.brand=cleanText(String(typeof node.brand==='object'?node.brand?.name:node.brand||''));if(!result.category)result.category=cleanText(String(node.category||''));if(!result.tags)result.tags=cleanText(Array.isArray(node.keywords)?node.keywords.join(', '):String(node.keywords||''));if(!result.shortDesc)result.shortDesc=cleanText(String(node.description||''));if(!result.weight)result.weight=cleanText(String(typeof node.weight==='object'?(node.weight.value||node.weight.valueReference?.value||''):node.weight||''));const offer=Array.isArray(node.offers)?node.offers[0]:node.offers||{},availability=String(offer.availability||'');if(!result.stock&&/outofstock|soldout|discontinued/i.test(availability))result.stock='0';
        const images=Array.isArray(node.image)?node.image:[node.image];if(!result.mainImage)for(const raw of images){const candidate=imageUrl(imageValue(raw),baseUrl);if(candidate){result.mainImage=candidate;break}}if(includeGallery)for(const raw of images)addGalleryImage(result.images,imageValue(raw),baseUrl,galleryMax);if(node.isVariantOf)addVariant(node)}
      const variants=Array.isArray(node.hasVariant)?node.hasVariant:[node.hasVariant];for(const variant of variants)addVariant(variant)
    }
  }catch{/* malformed structured data is only a fallback and must not abort extraction */}
}
function hasDetailSelectors(selectors:SelectorMap):boolean{return ([...DETAIL_KEYS,'longDesc','detailImage','gallery','variations'] as Array<keyof Selectors>).some(key=>String(selectors[key]||'').trim().length>0)}

export async function scrapeDetails(product:Product,selectors:Selectors,indirect=false,maxBytes=4_000_000):Promise<Product>{
  if(!product.url||!hasDetailSelectors(selectors))return product;
  const {text}=await sourceText(product.url,indirect,maxBytes);
  const detail=await parseDetailPage(text,product.url,selectors);
  const mainImage=detail.mainImage||product.image||'',images=[...new Set([mainImage,...detail.images].filter(Boolean))];
  const detailPrice=detail.price?numberFromText(detail.price):0;
  return {...product,price:detailPrice>0?detailPrice:product.price,priceText:detailPrice>0?(detail.price||product.priceText):product.priceText,shortDesc:detail.shortDesc||product.shortDesc,longDesc:detail.longDesc||product.longDesc,sku:detail.sku||product.sku,brand:detail.brand||product.brand,stock:detail.stock?numberFromText(detail.stock):product.stock,weight:detail.weight?numberFromText(detail.weight):product.weight,category:detail.category||product.category,tags:detail.tags||product.tags,images,image:mainImage||images[0]||product.image,variations:detail.variations.length?detail.variations:(product.variations||[]),variationGroups:detail.variationGroups.length?detail.variationGroups:(product.variationGroups||[]),variationPrices:Object.keys(detail.variationPrices).length?detail.variationPrices:(product.variationPrices||{})};
}

export async function extractVariations(html:string,baseUrl:string,selector:string):Promise<Pick<Product,'variations'|'variationGroups'|'variationPrices'|'images'>>{
  const parsed=await parseDetailPage(html,baseUrl,{variations:selector});return {variations:parsed.variations,variationGroups:parsed.variationGroups,variationPrices:parsed.variationPrices,images:parsed.images};
}

export async function extractSelectorValues(html:string,baseUrl:string,selector:string,type:'text'|'link'|'image'|'html'|'variations'):Promise<string[]>{
  if(type==='variations'){const result=await extractVariations(html,baseUrl,selector);return result.variations||[]}
  const values:string[]=[];
  class ValueHandler {
    private captures:Array<{element:HtmlElement;text:string}>=[];
    element(element:HtmlElement):void{
      if(type==='link'){const value=canonicalUrl(firstAttribute(element,LINK_ATTRS)||onclickUrl(element),baseUrl);if(value)values.push(value);return}
      if(type==='image'){const value=imageUrl(firstAttribute(element,IMAGE_ATTRS)||srcsetValue(element.getAttribute('srcset')||''),baseUrl);if(value)values.push(value);return}
      if(!hasEndTag(element)){const value=firstAttribute(element,[...TITLE_ATTRS,...PRICE_ATTRS,...SKU_ATTRS]);if(value)values.push(cleanText(value));return}
      const capture={element,text:''};this.captures.push(capture);element.onEndTag(()=>{const value=cleanText(capture.text)||firstAttribute(element,[...TITLE_ATTRS,...PRICE_ATTRS,...SKU_ATTRS]);if(value)values.push(value);const i=this.captures.indexOf(capture);if(i>=0)this.captures.splice(i,1)})
    }
    text(chunk:TextChunk):void{for(const capture of this.captures)capture.text+=chunk.text}
  }
  const rewriter=new HTMLRewriter(),handler=new ValueHandler();let valid=false;for(const part of selectorParts(selector))valid=safeOn(rewriter,part,handler)||valid;if(!valid)throw new Error('سلکتور نامعتبر است.');await rewriter.transform(new Response(html)).text();return [...new Set(values)].slice(0,100);
}

class NextLinkHandler {
  url='';
  constructor(private baseUrl:string){}
  element(element:HtmlElement):void{if(!this.url)this.url=canonicalUrl(firstAttribute(element,LINK_ATTRS),this.baseUrl)}
}
type EngineResult={products:Product[];usedEngine:ExtractionEngine;engineError?:string};
const NODE_ONLY_ENGINES=new Set<ExtractionEngine>(['playwright','puppeteer','crawlee_playwright','structural','network_api']);
const WORKER_DISCOVERY_ENGINES:ExtractionEngine[]=['snappshop','jsonld','next_data','script_json','heuristic','metadata'];
const WORKER_MANUAL_ENGINES=new Set<ExtractionEngine>(['htmlrewriter','cheerio']);
const WORKER_AUTO_ENGINES:ExtractionEngine[]=[...WORKER_DISCOVERY_ENGINES,'htmlrewriter'];
function engineOrder(requested:ExtractionEngine,master?:ExtractionEngine,autoFirst=true):ExtractionEngine[]{
  const out:ExtractionEngine[]=[],add=(engine?:ExtractionEngine)=>{if(engine&&!out.includes(engine))out.push(engine)};
  if(!autoFirst&&requested!=='auto'){add(requested);return out}
  // An EXPLICIT engine choice must be tried first (see the Node twin): putting
  // the discovery engines ahead of it meant a chosen engine was silently
  // replaced whenever the page carried any inline JSON.
  if(requested!=='auto'){
    add(requested);
    if(master&&!NODE_ONLY_ENGINES.has(master)&&!WORKER_MANUAL_ENGINES.has(master))add(master);
    // Fall back through the discovery engines AND the selector engine. Leaving
    // htmlrewriter out meant a page that only the configured selectors can read
    // returned zero products whenever the chosen engine came up empty.
    for(const engine of WORKER_AUTO_ENGINES)add(engine);
    return out;
  }
  if(master&&!NODE_ONLY_ENGINES.has(master)&&!WORKER_MANUAL_ENGINES.has(master))add(master);
  for(const engine of WORKER_DISCOVERY_ENGINES)add(engine);
  for(const engine of WORKER_AUTO_ENGINES)add(engine);
  return out;
}

export async function scrapeListPage(url:string,selectors:Selectors,nextSelector='',indirect=false,engine:ExtractionEngine='auto',master?:ExtractionEngine,autoFirst=true,autoDiscover=true):Promise<{products:Product[];nextUrl:string;url:string;usedEngine?:ExtractionEngine;elapsedMs?:number;selectorsUsed?:Selectors;discoveredSelectors?:Partial<Selectors>;discoveryMethod?:string;engineError?:string}>{
  const page=await sourceText(url,indirect),next=new NextLinkHandler(page.url);
  if(nextSelector){const rewriter=new HTMLRewriter();for(const selector of selectorParts(nextSelector))safeOn(rewriter,selector,next);await rewriter.transform(new Response(page.text)).text()}
  // 1.129.0 — PROACTIVE AUTO-DISCOVERY (Worker parity with 1.128.0 on
  // Render/Node). Profiles created through the API always carry the
  // WooCommerce DEFAULT_SELECTORS (empty list selectors are rejected), so
  // "selectors not configured" never looked empty and the engines ran blind.
  // When the selectors were never configured for this shop (empty, partial, or
  // still the defaults), repair them from the fetched page BEFORE the engine
  // loop — reusing the same HTML, so no extra fetch — and report what was
  // found so the caller can persist it. Fully custom selectors keep the exact
  // old behavior (the job-level last-resort rescue in processor.ts still
  // covers custom selectors that break later).
  let ensured:EnsuredListSelectors={selectors,method:''};
  if(autoDiscover){try{ensured=await ensureListSelectors(page.text,page.url,selectors)}catch{/* discovery is best-effort; the engine loop below still runs */}}
  const started=Date.now(),result=await parseByEngine(page.text,page.url,ensured.selectors,engine,master,autoFirst);
  return {products:result.products,nextUrl:next.url,url:page.url,usedEngine:result.usedEngine,elapsedMs:Date.now()-started,selectorsUsed:ensured.selectors,discoveredSelectors:ensured.discovered,discoveryMethod:ensured.method,engineError:result.engineError};
}
export async function scrapeList(url:string,selectors:Selectors,indirect=false,engine:ExtractionEngine='auto',autoDiscover=true):Promise<Product[]>{return (await scrapeListPage(url,selectors,'',indirect,engine,undefined,true,autoDiscover)).products}

async function parseByEngine(html:string,baseUrl:string,selectors:Selectors,engine:ExtractionEngine,master?:ExtractionEngine,autoFirst=true):Promise<EngineResult>{
  if(engine!=='auto'&&NODE_ONLY_ENGINES.has(engine))throw new Error(`موتور ${engine} به اجراگر Node نیاز دارد (Termux، ویندوز، VPS یا Render). ${engine==='structural'?'Cloudflare Worker موتور DOM (cheerio) ندارد؛ از heuristic استفاده کنید.':'Cloudflare Worker نمی‌تواند مرورگر اجرا کند؛ از htmlrewriter استفاده کنید.'}`);
  const tryOne=async(name:ExtractionEngine):Promise<Product[]>=>{
    if(name==='htmlrewriter'||name==='cheerio')return parseCards(html,baseUrl,selectors);
    if(name==='snappshop')return extractSnappShopProducts(html,baseUrl);
    if(name==='jsonld')return parseJsonLdProducts(html,baseUrl);
    if(name==='next_data')return extractNextDataProducts(html,baseUrl);
    if(name==='metadata')return extractMetadataProduct(html,baseUrl);
    if(name==='script_json')return extractScriptJsonProducts(html,baseUrl);
    if(name==='heuristic')return extractHeuristicProducts(html,baseUrl);
    return [];
  };
  // Python parity (scraper4.py parse_html): a throwing engine must not kill
  // the run — the remaining engines still get their chance (an explicit
  // choice is tried FIRST, as before, just no longer fatally). Probing
  // callers (benchmark: autoFirst=false, single-engine list) still get the
  // loud original error; real runs report it as engineError so the
  // processor's last-resort rescue and the diagnostic can show it.
  let firstError:unknown=null,explicitError:unknown=null;
  for(const name of engineOrder(engine,master,autoFirst)){
    try{
      const products=dedupeProducts(await tryOne(name));
      if(products.length)return{products,usedEngine:name};
      // Empty result from the explicit engine: keep trying the fallbacks.
    }catch(error){
      if(!firstError)firstError=error;
      if(engine!=='auto'&&name===engine&&!explicitError)explicitError=error;
    }
  }
  if(!autoFirst&&firstError)throw firstError;
  const engineError=explicitError instanceof Error?explicitError.message:explicitError?String(explicitError):undefined;
  return{products:[],usedEngine:engine,engineError};
}
function dedupeProducts(products:Product[]):Product[]{const seen=new Set<string>(),out:Product[]=[];for(const p of products){const key=p.sourceKey||p.url||p.title;if(!key||seen.has(key))continue;seen.add(key);out.push(p)}return out}
function productFromObject(obj:any,baseUrl:string):Product|null{if(!obj||typeof obj!=='object')return null;const title=cleanText(String(obj.name||obj.title||obj.productName||obj.label||''));const offer=Array.isArray(obj.offers)?obj.offers[0]:obj.offers||obj.offer||{};const priceText=cleanText(String(obj.price||obj.finalPrice||obj.salePrice||obj.sellingPrice||obj.priceText||offer.price||offer.lowPrice||offer.highPrice||''));const rawUrl=String(obj.url||obj.href||obj.link||obj.webUrl||obj.canonicalUrl||(typeof obj.slug==='string'?(obj.slug.startsWith('/')?obj.slug:`/product/${obj.slug}`):'')||'');const url=canonicalUrl(rawUrl,baseUrl);const image=imageUrl(firstImageValue(obj.image||obj.images||obj.thumbnail||obj.cover||obj.imageUrl||obj.picture),baseUrl);if(!title||!image||!priceText||numberFromText(priceText)<=0)return null;return{sourceKey:'',title,price:numberFromText(priceText),priceText,url,image,images:image?[image]:[],sku:cleanText(String(obj.sku||obj.id||'')),shortDesc:cleanText(String(obj.description||'')),longDesc:'',brand:cleanText(String(typeof obj.brand==='object'?obj.brand?.name:obj.brand||'')),stock:undefined,weight:undefined,category:cleanText(String(obj.category||'')),tags:'',variations:[],variationGroups:[],variationPrices:{},sourcePage:baseUrl,scrapedAt:new Date().toISOString()}}
function firstImageValue(value:any):string{if(!value)return'';if(typeof value==='string')return value;if(Array.isArray(value))return firstImageValue(value[0]);if(typeof value==='object')return String(value.url||value.src||value.href||value.original||value.medium||value.large||'');return''}
async function finalizeFound(products:Product[],baseUrl:string):Promise<Product[]>{const out:Product[]=[];for(const p of products){const identity=p.url?canonicalUrl(p.url,baseUrl,true):`${p.title}|${p.priceText}`;p.sourceKey=await sourceKey(identity);out.push(p)}return dedupeProducts(out)}
function walkObjects(value:any,baseUrl:string,out:Product[],depth=0):void{if(!value||depth>12||out.length>1000)return;if(Array.isArray(value)){for(const item of value)walkObjects(item,baseUrl,out,depth+1);return}if(typeof value!=='object')return;const p=productFromObject(value,baseUrl);if(p)out.push(p);for(const [key,v] of Object.entries(value))if(/product|item|result|data|pageProps|props|list|card|entity|catalog|shop|store/i.test(key))walkObjects(v,baseUrl,out,depth+1)}
export async function extractNextDataProducts(html:string,baseUrl:string):Promise<Product[]>{const m=html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);if(!m)return[];try{const out:Product[]=[];walkObjects(JSON.parse(decodeHtml(m[1])),baseUrl,out);return finalizeFound(out,baseUrl)}catch{return[]}}
function decodeHtml(value:string):string{return value.replace(/&nbsp;|&#160;|&#xa0;/gi,' ').replace(/&quot;/g,'"').replace(/&#34;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function stripHtml(value:string):string{return cleanText(decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')))}
function metaContent(html:string,key:string):string{const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*content=["']([^"']+)["'][^>]*>`,'i');return decodeHtml(html.match(re)?.[1]||'')}
// True-ancestor matching on raw HTML (1.136.0): the nearest PRECEDING open
// tag is often a sibling subtree, and the first close after the anchor often
// ends a nested child — both built frankenchunks that clustered under the
// wrong signature and failed verification. Walk the tag depth instead.
function enclosingOpen(html:string,pos:number,tag:string,endTag:string):number{
  let extra=0,cursor=pos;
  while(cursor>0){
    const closeAt=html.lastIndexOf(endTag,cursor-1),openAt=html.lastIndexOf('<'+tag,cursor-1);
    if(openAt<0)return -1;
    if(closeAt>openAt){extra++;cursor=closeAt;continue}
    if(extra===0)return openAt;
    extra--;cursor=openAt;
  }
  return -1;
}
function matchingClose(html:string,openPos:number,tag:string,endTag:string):number{
  const openEnd=html.indexOf('>',openPos);
  if(openEnd<0)return -1;
  let depth=1,cursor=openEnd+1;
  while(depth>0){
    if(cursor-openPos>6000)return -1;
    const nextOpen=html.indexOf('<'+tag,cursor),nextClose=html.indexOf(endTag,cursor);
    if(nextClose<0)return -1;
    if(nextOpen>=0&&nextOpen<nextClose){depth++;cursor=nextOpen+1}
    else{depth--;if(depth===0)return nextClose;cursor=nextClose+endTag.length}
  }
  return -1;
}
function enclosingChunks(html:string,index:number):string[]{const out:string[]=[];let cursor=index;for(let level=0;level<6&&cursor>0;level++){let best='',bestOpen=-1;for(const [tag,endTag] of [['article','</article>'],['li','</li>'],['tr','</tr>'],['div','</div>']] as const){const open=enclosingOpen(html,cursor,tag,endTag);if(open<0||index-open>1800)continue;const end=matchingClose(html,open,tag,endTag);if(end<0||end-open>5000)continue;const chunk=html.slice(open,end+endTag.length);if(!best||chunk.length<best.length){best=chunk;bestOpen=open}}if(!best||bestOpen<0)break;out.push(best);cursor=bestOpen}return out}
function productContextChunk(html:string,index:number,anchor:string):string{void anchor;const candidates=enclosingChunks(html,index);if(!candidates.length)return'';return candidates.find(chunk=>/<img\b/i.test(chunk)&&chunkHasPriceText(stripPriceFormatChars(stripHtml(chunk))))||candidates[0]}
export async function extractMetadataProduct(html:string,baseUrl:string):Promise<Product[]>{const title=metaContent(html,'og:title')||metaContent(html,'twitter:title')||stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(!title)return[];const ogType=(metaContent(html,'og:type')||'').toLowerCase(),priceText=metaContent(html,'product:price:amount')||metaContent(html,'og:price:amount')||'',url=canonicalUrl(metaContent(html,'og:url')||baseUrl,baseUrl),image=imageUrl(metaContent(html,'og:image')||metaContent(html,'twitter:image'),baseUrl),price=numberFromText(priceText);if(!/(?:product|product.item)/i.test(ogType)||!priceText||price<=0||!image)return[];return finalizeFound([{sourceKey:'',title,price,priceText,url,image,images:image?[image]:[],sku:'',shortDesc:'',longDesc:'',brand:'',stock:undefined,weight:undefined,category:'',tags:'',variations:[],variationGroups:[],variationPrices:{},sourcePage:baseUrl,scrapedAt:new Date().toISOString()}],baseUrl)}
export async function extractScriptJsonProducts(html:string,baseUrl:string):Promise<Product[]>{const out:Product[]=[];for(const m of html.matchAll(/<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)){const body=decodeHtml(m[1].trim());if(!/(product|products|price|__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__)/i.test(body))continue;for(const j of body.matchAll(/(?:window\.)?(?:__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__)?\s*=\s*(\{[\s\S]{50,200000}\}|\[[\s\S]{50,200000}\])\s*;?/g)){try{walkObjects(JSON.parse(j[1]),baseUrl,out)}catch{}}}return finalizeFound(out,baseUrl)}
function chunkTitle(chunk:string):string{let best='';for(const m of chunk.matchAll(/<(span|div|p|h5|h6|strong|b|em|li|td)\b[^>]*>([^<>]{6,160})<\/\1>/gi)){const text=cleanText(decodeHtml(m[2]||''));if(text.length>=6&&text.length>best.length&&!looksLikePrice(text))best=text}return best}
function heuristicImage(chunk:string,baseUrl:string):string{
  const tag=chunk.match(/<img\b[^>]*>/i)?.[0]||'';
  const dataSrc=tag.match(/\sdata-(?:src|lazy-src|lazyload|original|image)\s*=\s*["']([^"']+)["']/i)?.[1]||'';
  const srcAttr=(tag.match(/\ssrc(?:set)?\s*=\s*["']([^"']+)["']/i)?.[1]||'').split(',')[0].trim().split(/\s+/)[0];
  return imageUrl(decodeHtml(dataSrc||srcAttr),baseUrl);
}
const NON_PRODUCT_URL_RE=/[\/-](category|categories|collection|collections|tag|tags|brand|brands|search|blog|news|page)([\/?#]|$)/i;
export async function extractHeuristicProducts(html:string,baseUrl:string):Promise<Product[]>{const out:Product[]=[];const seenUrls=new Set<string>();for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,2500}?)<\/a>/gi)){const url=canonicalUrl(decodeHtml(m[1]),baseUrl);if(!url||seenUrls.has(url)||!/(product|products|\/p\/|\/pd\/|\/shop\/|snp-|kala|sku)/i.test(url)||NON_PRODUCT_URL_RE.test(url))continue;const chunk=productContextChunk(html,m.index||0,m[0]);if(!chunk)continue;const title=stripHtml(chunk.match(/<h[1-4]\b[^>]*>([\s\S]{0,500}?)<\/h[1-4]>/i)?.[1]||'')||cleanText(decodeHtml(chunk.match(/<img\b[^>]*(?:alt|title)=["']([^"']+)["']/i)?.[1]||''))||stripHtml(m[2])||chunkTitle(chunk);const image=heuristicImage(chunk,baseUrl);const priceText=heuristicPriceText(stripPriceFormatChars(stripHtml(chunk.replace(/<(del|s|strike)\b[\s\S]*?<\/\1>/gi, ' '))));if(!title||title.length<3||!image||!priceText||numberFromText(priceText)<=0)continue;seenUrls.add(url);out.push({sourceKey:'',title,price:numberFromText(priceText),priceText,url,image,images:image?[image]:[],sku:'',shortDesc:'',longDesc:'',brand:'',stock:undefined,weight:undefined,category:'',tags:'',variations:[],variationGroups:[],variationPrices:{},sourcePage:baseUrl,scrapedAt:new Date().toISOString()})}return finalizeFound(out,baseUrl)}

/** Runs the same network, list parser and detail parser used by real jobs, but never writes or syncs products. */
export type EngineDiagnosis={engine:ExtractionEngine;candidates:number;extracted:number;complete:{title:number;price:number;link:number;image:number};sample:{title:string;priceText:string;url:string;image:string}|null;dropReasons:string[];hint:string;signals:Record<string,number|string|boolean>};
const countMatches=(html:string,re:RegExp):number=>{const global=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let n=0;global.lastIndex=0;while(global.exec(html)){n++;if(n>5000)break}return n};
/**
 * Normalize any invalid-selector failure into the one diagnosis reason, so the
 * report names the breakage instead of blaming the container. Twin: render.
 */
function invalidSelectorMessage(error:unknown):string{
  const msg=error instanceof Error?error.message:String(error||'');
  if(!msg)return'';
  if(msg.startsWith('سلکتور نامعتبر'))return msg;
  if(/attribute selector|didn't terminate|not a valid selector|unknown pseudo/i.test(msg))return`سلکتور نامعتبر: ${msg}`;
  return'';
}
export function fetchErrorHint(error:unknown):string{
  const message=error instanceof Error?error.message:String(error||'');
  if(!message||/سلکتور نامعتبر/.test(message))return'';
  if(/HTTP 429/.test(message))return'سایت درخواست‌ها را محدود کرده (خطای 429)؛ یک دقیقه صبر کنید و بعد با صفحه‌های کمتر دوباره تلاش کنید.';
  if(/HTTP 403/.test(message))return'سایت دسترسی را بست (خطای 403)؛ معمولاً IP دیتاسنتر یا VPN است. اتصال غیرمستقیم (Worker واسط) را امتحان کنید.';
  if(/مهلت|timeout|timed out|abort|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|network|Network|ERR_|HTTP (502|503|504)/.test(message))return'دریافت صفحه از سایت ناموفق بود؛ آدرس، اتصال اینترنت و وضعیت سایت را بررسی کنید و دوباره تلاش کنید.';
  return'';
}
/** Per-engine diagnosis for the 3-page speed test (1.137.0). Twin: render-src/scraper.ts diagnoseBenchmarkEngine — same shape, same Persian copy. */
export async function diagnoseBenchmarkEngine(engine:ExtractionEngine,html:string,baseUrl:string,selectors:Selectors,products:Product[],error=''):Promise<EngineDiagnosis>{
  const list=Array.isArray(products)?products:[];
  const complete={title:0,price:0,link:0,image:0};
  for(const p of list){if(p.title)complete.title++;if(Number(p.price)>0)complete.price++;if(p.url)complete.link++;if(p.image)complete.image++}
  const first=list.find(p=>p.title||p.url)||list[0];
  const sample=first?{title:String(first.title||''),priceText:String(first.priceText||''),url:String(first.url||''),image:String(first.image||'')}:null;
  const dropReasons:string[]=[];
  const signals:Record<string,number|string|boolean>={};
  const text=String(html||'');
  let candidates=0,hint='';
  const partialNote=():string=>{const missing:string[]=[];if(complete.title<list.length)missing.push('عنوان');if(complete.price<list.length)missing.push('قیمت');if(complete.link<list.length)missing.push('لینک');if(complete.image<list.length)missing.push('تصویر');return missing.length?` ولی ${list.length-Math.min(complete.title,complete.price,complete.link,complete.image)} محصول ${missing.join('/')} کامل ندارند`:''};
  if(!text){
    candidates=list.length;signals.pageFetched=false;
    if(error)dropReasons.push(error);
    else if(!list.length)dropReasons.push('صفحهٔ اول برای بررسی سیگنال‌ها دریافت نشد و محصولی هم استخراج نشد.');
    hint=list.length?`موتور ${list.length} محصول استخراج کرد (صفحهٔ اول برای بررسی عمیق در دسترس نبود).`:'دسترسی شبکه به صفحهٔ اول ناموفق بود؛ آدرس و اتصال را بررسی کنید.';
    if(!list.length){const bad=invalidSelectorMessage(error),fetch=fetchErrorHint(error);if(bad)hint='یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.';else if(fetch)hint=fetch}
    return{engine,candidates,extracted:list.length,complete,sample,dropReasons,hint,signals};
  }
  signals.pageFetched=true;
  if(engine==='cheerio'||engine==='htmlrewriter'){
    let verified:ListSelectorVerification|null=null;
    try{verified=await verifyListSelectors(text,baseUrl,selectors)}catch{verified=null}
    const containers=verified?.containerCount||0,titles=verified?.title.count||0,prices=verified?.price.count||0,links=verified?.link.count||0,images=verified?.image.count||0;
    candidates=containers;signals.containers=containers;signals.titles=titles;signals.prices=prices;signals.links=links;signals.images=images;
    const containerSel=String((selectors as any)?.container||'').trim();
    const badSelector=invalidSelectorMessage(error)||verified?.error||'';
    if(badSelector){dropReasons.push(badSelector);hint='یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.'}
    else if(!containerSel){dropReasons.push('سلکتور ظرف خالی است؛ موتور سلکتوری بدون ظرف نمی‌تواند کارتی پیدا کند.');hint='سلکتور ظرف را وارد کنید یا «پیشنهاد خودکار سلکتورها» را بزنید.'}
    else if(!containers){dropReasons.push(`سلکتور ظرف «${containerSel}» هیچ کارتی در صفحه پیدا نکرد.`);hint='سلکتور ظرف اشتباه است یا صفحه جاوااسکریپتی است؛ «پیشنهاد خودکار سلکتورها» را بزنید.'}
    else if(!titles){dropReasons.push(`${containers} کارت پیدا شد ولی داخل هیچ‌کدام عنوانی نیست؛ یعنی سلکتور عنوان بیرون از ظرف را می‌بیند یا ظرف کل فهرست را گرفته است.`);hint='سلکتور عنوان باید نسبت به ظرف داخلی باشد، یا ظرف باید هر کارت باشد نه کل فهرست.'}
    else if(!list.length){
      if(error)dropReasons.push(error);
      if(!prices)dropReasons.push(`${containers} کارت و ${titles} عنوان هست ولی قیمت داخل کارت‌ها پیدا نشد.`);
      if(!links)dropReasons.push('لینک محصول داخل کارت‌ها پیدا نشد.');
      if(!images)dropReasons.push('تصویر داخل کارت‌ها پیدا نشد.');
      if(!dropReasons.length)dropReasons.push(`${containers} کارت دیده شد ولی هیچ محصول کاملی استخراج نشد.`);
      hint='سلکتورهای عنوان/قیمت/لینک/تصویر را نسبت به ظرف اصلاح کنید.';
    }else{
      if(containers>list.length)dropReasons.push(`از ${containers} کارت، ${list.length} محصول نگه داشته شد؛ بقیه عنوان/قیمت/تصویر کامل نداشتند.`);
      hint=`موتور سالم است: ${list.length} محصول استخراج شد${partialNote()}.`;
    }
  }else if(engine==='jsonld'){
    const blocks=[...text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]||'');
    const productBlocks=blocks.filter(b=>/"@type"\s*:\s*"(Product|ItemList|ProductGroup|Offer|AggregateOffer|SearchResultsPage)"/i.test(b)).length;
    candidates=countMatches(text,/"@type"\s*:\s*"Product"/i)+countMatches(text,/"@type"\s*:\s*"ListItem"/i);
    signals.ldBlocks=blocks.length;signals.productBlocks=productBlocks;
    if(!blocks.length){dropReasons.push('صفحه هیچ بلوک JSON-LD ندارد.');hint='این سایت دادهٔ ساخت‌یافته ندارد؛ htmlrewriter یا heuristic را امتحان کنید.'}
    else if(!list.length){dropReasons.push(`${blocks.length} بلوک JSON-LD هست ولی هیچ‌کدام محصول یا فهرست محصول نیست.`);hint='بلوک‌های JSON-LD این صفحه محصول ندارند؛ htmlrewriter یا heuristic را امتحان کنید.'}
    else hint=`موتور سالم است: ${list.length} محصول از JSON-LD استخراج شد${partialNote()}.`;
  }else if(engine==='next_data'){
    const m=text.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i),payload=m?.[1]||'';
    candidates=countMatches(payload,/"(price|priceText|finalPrice|salePrice)"\s*:/i);
    signals.hasNextData=Boolean(m);signals.nextBytes=payload.length;signals.priceKeys=candidates;
    if(!m){dropReasons.push('صفحه دادهٔ __NEXT_DATA__ ندارد (سایت Next.js نیست).');hint='این موتور فقط برای سایت‌های Next.js است؛ موتور دیگری را امتحان کنید.'}
    else if(!list.length){dropReasons.push('دادهٔ __NEXT_DATA__ هست ولی موتور محصولی از آن استخراج نکرد؛ ساختار کاتالوگ با الگوهای شناخته‌شده فرق دارد.');hint='کاتالوگ داخل __NEXT_DATA__ ساختار غیراستاندارد دارد؛ heuristic یا موتور سلکتوری را امتحان کنید.'}
    else hint=`موتور سالم است: ${list.length} محصول از __NEXT_DATA__ استخراج شد${partialNote()}.`;
  }else if(engine==='script_json'){
    const inline=[...text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]||'');
    const withProduct=inline.filter(s=>/"(price|priceText|finalPrice|salePrice)"\s*:/i.test(s)&&/"(title|name|productName)"\s*:/i.test(s)).length;
    candidates=countMatches(text,/"(price|priceText|finalPrice|salePrice)"\s*:/i);
    signals.inlineScripts=inline.length;signals.productScripts=withProduct;signals.priceKeys=candidates;
    if(!withProduct){dropReasons.push('هیچ اسکریپت درون‌خطی‌ای آبجکت محصول (نام+قیمت) ندارد.');hint='این صفحه کاتالوگ JSON در اسکریپت ندارد؛ heuristic یا موتور سلکتوری را امتحان کنید.'}
    else if(!list.length){dropReasons.push(`${withProduct} اسکریپت دادهٔ محصول‌دار هست ولی موتور نتوانست آن‌ها را بخواند (ساختار غیراستاندارد).`);hint='ساختار JSON اسکریپت‌ها غیراستاندارد است؛ heuristic یا موتور سلکتوری را امتحان کنید.'}
    else hint=`موتور سالم است: ${list.length} محصول از JSON اسکریپت استخراج شد${partialNote()}.`;
  }else if(engine==='metadata'){
    const og=countMatches(text,/<meta\b[^>]*property=["']og:/i);
    candidates=/<meta\b[^>]*property=["']og:title["']/i.test(text)?1:0;signals.ogTags=og;
    if(!og){dropReasons.push('صفحه متاتگ OpenGraph ندارد.');hint='این موتور فقط برای صفحات دارای متاتگ og است؛ موتور دیگری را امتحان کنید.'}
    else if(!list.length){dropReasons.push('متاتگ og هست ولی محصول کاملی از آن ساخته نشد (این موتور تک‌محصولی است و برای صفحهٔ فهرست مناسب نیست).');hint='موتور metadata برای صفحهٔ جزئیات تک‌محصول است، نه فهرست؛ heuristic یا موتور سلکتوری را امتحان کنید.'}
    else hint=`موتور سالم است: ${list.length} محصول از متاتگ‌ها استخراج شد${partialNote()}.`;
  }else if(engine==='heuristic'){
    let anchors=0;
    for(const m of text.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)){if(/(product|products|\/p\/|\/pd\/|\/shop\/|snp-|kala|sku)/i.test(m[1]||'')&&!NON_PRODUCT_URL_RE.test(m[1]||''))anchors++;if(anchors>5000)break}
    const priceHints=countMatches(stripPriceFormatChars(stripHtml(text)),PRICE_HINT_RE),barePrices=countMatches(stripHtml(text),THOUSANDS_RE),images=countMatches(text,/<img\b/i);
    candidates=anchors;signals.productAnchors=anchors;signals.priceHints=priceHints;signals.barePrices=barePrices;signals.images=images;
    if(!anchors){dropReasons.push('هیچ لینکی با الگوی آدرس محصول (/product/ ،/shop/ ،snp- و…) پیدا نشد.');hint='آدرس محصولات این سایت الگوی شناخته‌شده ندارد؛ موتور سلکتوری (htmlrewriter) را امتحان کنید.'}
    else if(!list.length){
      if(error)dropReasons.push(error);
      dropReasons.push(`${anchors} لینک محصول هست ولی هیچ‌کدام داخل کارتی با تصویر+قیمت کامل نبودند (حذف شدند).`);
      if(!priceHints&&!barePrices)dropReasons.push('در کل صفحه هیچ متن قیمت‌داری (تومان/ریال/…) دیده نشد؛ احتمالاً قیمت‌ها با جاوااسکریپت می‌آیند.');else if(!priceHints)dropReasons.push(`${barePrices} عدد هزارگان‌بندی‌شده بدون واحد پولی دیده شد؛ احتمالاً واحد پول با استایل/جاوااسکریپت اضافه می‌شود یا قیمت‌ها داینامیک‌اند.`);
      hint=!priceHints?'قیمت‌ها احتمالاً با جاوااسکریپت بارگذاری می‌شوند؛ موتور مرورگری (نمایشی) را امتحان کنید.':'کارت‌ها تصویر یا قیمت کامل ندارند؛ موتور سلکتوری (htmlrewriter) را امتحان کنید.';
    }else{
      if(anchors>list.length)dropReasons.push(`از ${anchors} لینک محصول، ${list.length} محصول کامل نگه داشته شد؛ بقیه تصویر/قیمت/عنوان کامل نداشتند.`);
      hint=`موتور سالم است: ${list.length} محصول بدون نیاز به سلکتور پیدا شد${partialNote()}.`;
    }
  }else{
    candidates=list.length;signals.note='engine-specific signals are not measured for this engine';
    if(error)dropReasons.push(error);
    else if(!list.length)dropReasons.push('موتور محصولی استخراج نکرد.');
    const badSelectorError=invalidSelectorMessage(error);
    hint=list.length?`موتور ${list.length} محصول استخراج کرد${partialNote()}.`:(badSelectorError?'یکی از سلکتورهای ذخیره‌شده خراب است؛ آن را اصلاح کنید یا «پیشنهاد خودکار سلکتورها» را بزنید تا سلکتورهای سالم ساخته شوند.':(error||'موتور محصولی استخراج نکرد؛ خطا را بررسی کنید.'));
  }
  if(error&&!dropReasons.includes(error)&&!dropReasons.some(reason=>reason.includes(error))&&!list.length)dropReasons.unshift(error);
  const fetchHint=!list.length?fetchErrorHint(error):'';
  if(fetchHint&&!dropReasons.some(reason=>String(reason).includes('سلکتور نامعتبر')))hint=fetchHint;
  return{engine,candidates,extracted:list.length,complete,sample,dropReasons,hint,signals};
}
export async function diagnoseExtraction(profile:Profile,urlOverride=''){
  const started=Date.now(),url=String(urlOverride||profile.url||'').trim(),stages:any[]=[],recommendations:string[]=[];
  const add=(name:string,ok:boolean,summary:string,details:any={})=>stages.push({name,ok,summary,...details});
  if(!url){add('configuration',false,'آدرس مبدأ خالی است.');return{ok:false,profileId:profile.id,url,stages,selectorsToSave:{},recommendations:['آدرس صفحهٔ فهرست محصولات را در پروفایل وارد کنید.']}}
  let page:{text:string;url:string;contentType:string};
  try{
    page=await sourceText(url,Boolean(profile.networkIndirect));
    const bytes=new TextEncoder().encode(page.text).byteLength,title=cleanText(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g,' ')||'');
    add('network',true,`صفحه با ${bytes.toLocaleString('fa-IR')} بایت دریافت شد.`,{requestedUrl:url,finalUrl:page.url,contentType:page.contentType,bytes,title,indirect:Boolean(profile.networkIndirect)});
  }catch(error){const text=error instanceof Error?error.message:String(error);add('network',false,text,{requestedUrl:url,indirect:Boolean(profile.networkIndirect)});recommendations.push(/ضدربات|چالش/.test(text)?'سایت صفحهٔ ضدربات برگردانده است؛ دسترسی Worker را در مبدأ مجاز کنید یا Worker واسط معتبر تنظیم کنید.':'آدرس، دسترسی عمومی سایت و تنظیمات روش اتصال مبدأ را بررسی کنید.');return{ok:false,profileId:profile.id,url,startedAt:new Date(Date.now()-(Date.now()-started)).toISOString(),durationMs:Date.now()-started,stages,selectorsToSave:{},recommendations}}
  let products:Product[]=[];
  // 1.135.0 — verified discoveries the route persists when the profile's
  // selectors were never configured (empty/partial/default). Fully custom
  // selectors are never touched (ensure only reports discoveries for
  // non-custom sets), and an overridden test URL never rewrites the profile.
  const selectorsToSave:Record<string,string>={},overriddenTestUrl=String(urlOverride||'').trim().length>0&&url!==String(profile.url||'').trim();
  try{
    let listSelectors=profile.selectors;
    try{const ensured=await ensureListSelectors(page.text,page.url,profile.selectors);listSelectors=ensured.selectors;if(!overriddenTestUrl&&ensured.discovered)for(const [key,value] of Object.entries(ensured.discovered))if(String(value||'').trim())selectorsToSave[key]=String(value)}catch{/* best-effort; extraction below uses the profile selectors */}
    const engineResult=await parseByEngine(page.text,page.url,listSelectors,profile.extractionEngine||'auto',profile.extractionEngineMaster);
    products=engineResult.products;
    const complete={title:products.filter(x=>x.title).length,price:products.filter(x=>x.price>0).length,link:products.filter(x=>x.url).length,image:products.filter(x=>x.image).length,sku:products.filter(x=>x.sku).length};
    add('list-extraction',products.length>0,products.length?`${products.length.toLocaleString('fa-IR')} محصول با pipeline واقعی استخراج شد.`:'هیچ محصولی از موتورهای خودکار یا سلکتورهای دستی استخراج نشد.',{count:products.length,usedEngine:engineResult.usedEngine,...(engineResult.engineError?{engineError:engineResult.engineError}:{}),complete,selectors:profile.selectors,samples:products.slice(0,5).map(x=>({title:x.title,price:x.price,priceText:x.priceText,url:x.url,image:x.image,sku:x.sku}))});
  }catch(error){add('list-extraction',false,error instanceof Error?error.message:String(error),{selectors:profile.selectors})}
  // 1.129.0 — when nothing extracted, show what proactive auto-discovery sees
  // on the same page. Verified discoveries above are handed to the route for
  // auto-save (1.135.0); this block still shows raw, unverified findings for
  // the manual suggest button when auto-save had nothing to persist.
  if(!products.length){
    try{
      const discovery=await discoverListSelectorsFromHtml(page.text,page.url);
      const proposed=Object.entries(discovery.selectors).filter(([,value])=>String(value||'').trim());
      if(discovery.method!=='none'&&proposed.length>=2&&discovery.selectors.container&&discovery.selectors.title){
        add('selector-discovery',true,`موتور استخراج ${discovery.containerCount.toLocaleString('fa-IR')} کارت محصول را بدون نیاز به سلکتور دستی پیدا کرد (روش: ${discovery.method==='structural'?'تحلیل ساختاری صفحه':discovery.method==='mixed'?'ترکیبی':'الگوهای آماده'})؛ این سلکتورها راستی‌آزمایی شدند و با ذخیرهٔ آن‌ها استخراج شروع می‌شود.`,{method:discovery.method,selectors:discovery.selectors,evidence:discovery.evidence,containerCount:discovery.containerCount});
        if(!Object.keys(selectorsToSave).length)recommendations.push('دکمهٔ «پیشنهاد خودکار سلکتورها» را بزنید تا همین سلکتورهای پیداشده ذخیره شوند، سپس استخراج را دوباره اجرا کنید.');
      }else{
        add('selector-discovery',false,'کشف خودکار هم الگوی کارت محصولی در این صفحه پیدا نکرد؛ احتمالاً صفحه جاوااسکریپتی است (پس از بارگذاری کامل رندر می‌شود)، نیازمند ورود است، یا محصولی در آن نیست.',{method:discovery.method});
      }
    }catch{/* informational only */}
  }
  const evidence:Record<string,unknown>={};
  for(const field of ['container','title','price','link','image'] as const){const selector=String(profile.selectors[field]||'').trim();if(!selector){evidence[field]={ok:false,count:0,error:'سلکتور خالی است'};continue}try{const type=field==='link'?'link':field==='image'?'image':'text',values=await extractSelectorValues(page.text,page.url,selector,type);evidence[field]={ok:values.length>0,count:values.length,sample:values.slice(0,3)}}catch(error){evidence[field]={ok:false,count:0,error:error instanceof Error?error.message:String(error)}}}
  const evidenceOk=['container','title'].every(key=>(evidence[key] as any)?.ok);
  add('selector-evidence',evidenceOk,evidenceOk?'سلکتورهای پایه روی پاسخ واقعی نشانه دارند.':'یک یا چند سلکتور پایه روی پاسخ واقعی نتیجه نداد.',{evidence});
  let detail:any=null;
  const candidate=products.find(product=>product.url);
  if(candidate&&hasDetailSelectors(profile.selectors))try{const extracted=await scrapeDetails(candidate,profile.selectors,Boolean(profile.networkIndirect));detail={url:candidate.url,title:extracted.title,shortDesc:extracted.shortDesc,descriptionCharacters:String(extracted.longDesc||'').length,sku:extracted.sku,brand:extracted.brand,stock:extracted.stock,weight:extracted.weight,category:extracted.category,tags:extracted.tags,image:extracted.image,galleryCount:extracted.images.length,variations:extracted.variations?.slice(0,20)};add('detail-extraction',true,'صفحهٔ جزئیات نمونه با pipeline واقعی پردازش شد.',{sample:detail})}catch(error){add('detail-extraction',false,error instanceof Error?error.message:String(error),{url:candidate.url})}
  else add('detail-extraction',true,candidate?'برای این پروفایل سلکتور جزئیات تنظیم نشده است.':'محصول دارای لینک برای تست جزئیات پیدا نشد.',{skipped:true});
  // Detail selectors are suggested from a real product page only when some
  // are missing; already-configured keys are never overwritten.
  const detailSample=candidate&&candidate.url?candidate.url:'';
  if(!overriddenTestUrl&&detailSample){const missingDetail=(['shortDesc','price','longDesc','sku','category','tags','weight','stock','brand','detailImage','gallery','variations'] as Array<keyof Selectors>).filter(key=>!String(profile.selectors[key]||'').trim());if(missingDetail.length)try{const suggested=await suggestSelectors(detailSample,'detail');for(const [key,value] of Object.entries(suggested.selectors||{}))if(String(value||'').trim()&&(missingDetail as string[]).includes(key))selectorsToSave[key]=String(value)}catch{/* discovery is best-effort; the report below still stands */}}
  if(Object.keys(selectorsToSave).length)recommendations.push('سلکتورهای پیداشده به‌صورت خودکار در تب سلکتورها ذخیره شدند؛ استخراج را دوباره اجرا کنید.');
  const deepPage=Number((url.match(/[?&](page|pg|pageNumber|page_number)=(\d+)/i)||[])[2]||0);
  if(!products.length&&deepPage>1)recommendations.push(`آدرس صفحهٔ ${deepPage.toLocaleString('fa-IR')} است؛ اول همین عیب‌یاب را روی صفحهٔ اول (بدون پارامتر صفحه) اجرا کنید — صفحه‌های عمیق اغلب خالی‌اند یا ساختار دیگری دارند.`);
  if(!products.length)recommendations.push('سلکتور ظرف محصول را با HTML واقعی اصلاح کنید؛ پیشنهاد خودکار را اجرا و سپس دوباره همین عیب‌یاب را بزنید.');
  else{if(!products.some(x=>x.price>0))recommendations.push('محصول پیدا شده ولی قیمت صفر است؛ سلکتور قیمت و واحد/متن قیمت را بررسی کنید.');if(!products.some(x=>x.url))recommendations.push('لینک محصول پیدا نشده است؛ سلکتور لینک باید به عنصر a یا ویژگی href/data-url برسد.');if(!products.some(x=>x.image))recommendations.push('تصویر پیدا نشده است؛ data-src، srcset یا سلکتور تصویر را بررسی کنید.')}
  const failed=stages.filter(stage=>!stage.ok);return{ok:products.length>0&&failed.length===0,profileId:profile.id,url,finalUrl:page.url,startedAt:new Date(Date.now()-(Date.now()-started)).toISOString(),durationMs:Date.now()-started,productCount:products.length,stages,recommendations,detail,selectorsToSave};
}

export function transformProduct(product:Product,profile:Profile):Product{
  product.title=cleanText(product.title+profile.titleSuffix).slice(0,300);const value=profile.priceValue;
  if(profile.priceMode==='add')product.price+=value;if(profile.priceMode==='percent')product.price*=1+value/100;if(profile.priceMode==='multiply')product.price*=value;
  if(profile.roundPrice>0)product.price=Math.ceil(product.price/profile.roundPrice)*profile.roundPrice;product.price=Math.max(0,Math.round(product.price));return product;
}
export function pageUrl(profile:Profile,page:number):string{
  const url=new URL(profile.url);if(page<=1||profile.pagination==='none'||profile.pagination==='next_selector')return url.href;
  const pageNumber=(base:number)=>Math.max(1,base)+(page-1);
  if(profile.pagination==='full_pattern')return profile.paginationValue.split('{page}').join(String(pageNumber(1)));
  if(profile.pagination==='path_page'||profile.pagination==='path_pattern'){
    const next=profile.pagination==='path_page'?pageNumber(Number(url.pathname.match(/\/page\/(\d+)\/?$/i)?.[1]||1)):page;
    const pattern=profile.pagination==='path_page'?'/page/{page}/':(profile.paginationValue||'/page/{page}/');
    const basePath=url.pathname.replace(/\/page\/\d+\/?$/i,'').replace(/\/$/,'');
    return url.origin+basePath+pattern.split('{page}').join(String(next));
  }
  const param=profile.pagination==='query_custom'?(profile.paginationValue||'paged'):'page',current=Number(url.searchParams.get(param)||1);url.hash='';url.searchParams.set(param,String(pageNumber(current)));return url.href;
}
export function benchmarkProbeUrl(profile:Profile):string{
  try{
    const pagination=String((profile as any)?.pagination||'query');
    if(pagination==='none'||pagination==='next_selector'||pagination==='full_pattern')return profile.url;
    const url=new URL(profile.url);url.hash='';
    if(pagination==='path_page'||pagination==='path_pattern'){url.pathname=url.pathname.replace(/\/page\/\d+\/?$/i,'')||'/';return url.href}
    const custom=pagination==='query_custom'?String((profile as any)?.paginationValue||'paged'):'page';
    for(const param of new Set([custom,'page','paged']))url.searchParams.delete(param);
    return url.href;
  }catch{return profile.url}
}
export async function mapLimit<T>(items:T[],limit:number,fn:(item:T,index:number)=>Promise<void>):Promise<void>{
  let next=0;await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{while(true){const index=next++;if(index>=items.length)return;await fn(items[index],index)}}));
}
export async function testSelector(url:string,selector:string,type='text'):Promise<{count:number;values:string[]}>{
  const page=await safeText(url,4_000_000),values=await extractSelectorValues(page.text,page.url,selector,type==='link'?'link':type==='image'?'image':'text');return {count:values.length,values:values.slice(0,20)};
}
export async function testVariations(url:string,selector:string){const page=await safeText(url,4_000_000);return {url:page.url,...await extractVariations(page.text,page.url,selector)}}
export async function testGallery(url:string,selector:string,max=30,skipFirst=false){const page=await safeText(url,4_000_000),detail=await parseDetailPage(page.text,page.url,{gallery:selector,galleryMax:max,gallerySkipFirst:skipFirst});return{url:page.url,count:detail.images.length,values:detail.images}}
const SUGGESTION_CANDIDATES:Record<string,{type?:'text'|'link'|'image';selectors:string[]}>= {
  container:{selectors:['li.product','article.product','.products .product','.product-card','.product-item','[data-product-id]',
    // Generic / non-WooCommerce grids (1.128.0 on Render/Node, 1.129.0 on the
    // Worker). Platform-specific guesses stay first; these only win when
    // nothing above matched. Structural inference below is the real fallback
    // when none of these exist either.
    'article','[class*="product-card"]','[class*="product-item"]','[class*="product-box"]','[data-product]','.grid-item','.product','.product-box','.item-card']},
  title:{selectors:['.woocommerce-loop-product__title','.product-title','.card-title','h2','h3','[itemprop="name"]',
    '.product-name','[class*="product-title"]','[class*="product-name"]','.name','h4']},
  price:{selectors:['.price ins','.sale-price','.price','[itemprop="price"]','.amount',
    '[class*="price"]','.money','[data-price]','.product-price']},
  link:{type:'link',selectors:['a.woocommerce-LoopProduct-link','a.product-link','a[href*="/product/"]','a[href]','h2 a','h3 a','article a[href]']},
  image:{type:'image',selectors:['img.wp-post-image','img.product-image','picture img','img','.product-media img','article img']},
  shortDesc:{selectors:['.woocommerce-product-details__short-description','.short-description','[itemprop="description"]','.product-info','.short-desc','[class*="short-description"]']},
  longDesc:{selectors:['#tab-description','.woocommerce-Tabs-panel--description','.product-description','.description','.product-tabs','[class*="description"]']},
  sku:{selectors:['.sku','[itemprop="sku"]','[data-sku]','[class*="sku"]']},
  brand:{selectors:['.brand','[itemprop="brand"]','.product-brand','[class*="brand"]']},
  stock:{selectors:['.stock','[itemprop="availability"]','.inventory']},
  weight:{selectors:['.product_weight','.weight','[data-weight]']},
  category:{selectors:['.posted_in','.product_meta .category','.breadcrumb']},
  tags:{selectors:['.tagged_as','.product_meta .tags','[rel="tag"]']},
  detailImage:{type:'image',selectors:['.woocommerce-product-gallery__image img','.product-main-image img','img.wp-post-image','[itemprop="image"]']},
  gallery:{type:'image',selectors:['.woocommerce-product-gallery img','.product-gallery img','[data-gallery] img','.gallery img','.product-images img','[class*="gallery"] img']},
  variations:{selectors:['.variations','.variations_form','[data-product_variations]','.product-options']}
};
export async function suggestSelectors(url:string,mode:'list'|'detail'|'all'='all'){
  const page=await safeText(url,4_000_000),selectors:Record<string,string>={},evidence:Record<string,unknown>={};
  // List fields go through the same discovery the engines use (1.128.0 on
  // Render/Node, 1.129.0 on the Worker), so the dashboard button proposes
  // structural selectors for unknown shops too.
  if(mode==='list'||mode==='all'){
    const found=await discoverListSelectorsFromHtml(page.text,page.url);
    for(const [key,value] of Object.entries(found.selectors))if(value)selectors[key]=value as string;
    for(const [key,value] of Object.entries(found.evidence))evidence[key]=value;
    evidence.discoveryMethod=found.method;evidence.containerCount=found.containerCount;
  }
  if(mode==='detail'||mode==='all'){
    const wanted=['shortDesc','price','longDesc','sku','category','tags','weight','stock','brand','detailImage','gallery','variations'];
    for(const field of wanted){const config=SUGGESTION_CANDIDATES[field];if(!config)continue;for(const candidate of config.selectors)try{const values=await extractSelectorValues(page.text,page.url,candidate,config.type||'text');const count=values.length,minimum=1;if(count>=minimum){selectors[field]=candidate;evidence[field]={count,sample:values[0]||''};break}}catch{}}
  }
  return{url:page.url,mode,selectors,evidence};
}

// ---------------------------------------------------------------------------
// Proactive list-selector auto-discovery (1.128.0 on Render/Node, 1.129.0 on
// the Cloudflare Worker).
//
// "Selectors not configured" is NOT "all empty": normalizeProfile() fills every
// new profile with WooCommerce DEFAULT_SELECTORS and rejects empties, so an
// unconfigured profile looks exactly like a WooCommerce one. Auto-discovery
// therefore triggers on empty, partial AND still-default selectors, verifies
// proposals against the real page, and only then lets the engines run with
// them. Fully custom selectors are left untouched.
//
// The Worker has no DOM: verification counts matches with HTMLRewriter (the
// container page-wide; title/price/link/image scoped to descendants of the
// container) and structural inference clusters anchor-context HTML chunks by
// their tag+class signature. Same gates and method names as Render/Node.
// ---------------------------------------------------------------------------
const LIST_SELECTOR_KEYS=['container','title','price','link','image'] as const;
export type SelectorConfigStatus='empty'|'partial'|'default'|'custom';
export function listSelectorsStatus(selectors:Selectors|undefined|null):SelectorConfigStatus{
  const values=LIST_SELECTOR_KEYS.map(key=>String((selectors as any)?.[key]||'').trim());
  if(values.every(value=>!value))return 'empty';
  if(values.some(value=>!value))return 'partial';
  const isDefault=LIST_SELECTOR_KEYS.every(key=>String((selectors as any)?.[key]).trim()===String((DEFAULT_SELECTORS as any)[key]));
  return isDefault?'default':'custom';
}

export type SelectorFieldEvidence={count:number;sample:string};
export type ListSelectorVerification={
  containerCount:number;
  cardsSampled:number;
  title:SelectorFieldEvidence;
  price:SelectorFieldEvidence;
  link:SelectorFieldEvidence;
  image:SelectorFieldEvidence;
  /** Container repeats and titles resolve inside most cards. */
  ok:boolean;
  /** A selector that failed to compile (tagged message); counts are partial. */
  error?:string;
};
const emptyVerification=(containerCount=0):ListSelectorVerification=>({
  containerCount,cardsSampled:0,
  title:{count:0,sample:''},price:{count:0,sample:''},
  link:{count:0,sample:''},image:{count:0,sample:''},ok:false
});
async function countSelectorMatches(html:string,selector:string):Promise<number>{
  let count=0;const rewriter=new HTMLRewriter(),handler={element(){count++}};let valid=false;
  for(const part of selectorParts(selector))valid=safeOn(rewriter,part,handler)||valid;
  if(!valid)return 0;
  try{await rewriter.transform(new Response(html)).text()}catch{return 0}
  return count;
}
/** `container descendant` pairs so field evidence is card-scoped, not page-wide. */
function descendantSelector(container:string,field:string):string{
  const combos:string[]=[];
  for(const outer of selectorParts(container).slice(0,4))for(const inner of selectorParts(field).slice(0,4))combos.push(`${outer} ${inner}`);
  return combos.join(', ');
}
/**
 * Check list selectors against REAL page HTML the same way extraction reads it:
 * container matches are counted page-wide, but title/price/link/image must
 * resolve INSIDE the containers (descendant selectors), otherwise the evidence
 * is the classic contradiction — green page-wide, zero products.
 */
export async function verifyListSelectors(html:string,baseUrl:string,selectors:Selectors):Promise<ListSelectorVerification>{
  const container=String(selectors?.container||'').trim();
  if(!container||!html)return emptyVerification();
  const containerCount=await countSelectorMatches(html,container);
  if(containerCount<1)return emptyVerification(containerCount);
  const [titleHits,priceHits,linkHits,imageHits]=await Promise.all([
    extractSelectorValues(html,baseUrl,descendantSelector(container,selectors.title||''),'text').catch(()=>[] as string[]),
    extractSelectorValues(html,baseUrl,descendantSelector(container,selectors.price||''),'text').catch(()=>[] as string[]),
    extractSelectorValues(html,baseUrl,descendantSelector(container,selectors.link||''),'link').catch(()=>[] as string[]),
    extractSelectorValues(html,baseUrl,descendantSelector(container,selectors.image||''),'image').catch(()=>[] as string[]),
  ]);
  const moneyHits=priceHits.filter(value=>numberFromText(value)>0);
  const evidence=(hits:string[]):SelectorFieldEvidence=>({count:hits.length,sample:(hits[0]||'').slice(0,200)});
  // Title is mandatory (extraction skips title-less cards); price/link/image
  // are reported but do not fail verification — "without price" products are
  // filtered later with their own warning, not here.
  const needed=Math.max(1,Math.ceil(Math.min(containerCount,12)/2));
  return{containerCount,cardsSampled:Math.min(containerCount,12),title:evidence(titleHits),price:evidence(moneyHits),link:evidence(linkHits),image:evidence(imageHits),ok:containerCount>=2&&titleHits.length>=needed};
}

const PRICE_HINT_RE=/[۰-۹٠-٩\d][۰-۹٠-٩\d,٬.,\s]{0,30}\s*(?:تومان|تومن|ریال|IRR|IRT|USD|EUR|GBP|€|\$|£|TL|₺|AED|درهم|﷼)/i;
const THOUSANDS_RE=/[0-9۰-۹٠-٩]{1,3}([,٬.][0-9۰-۹٠-٩]{3})+/;
const THOUSANDS_GLOBAL_RE=new RegExp(THOUSANDS_RE.source,'g');
/** Card text holds a price when a currency hint OR a bare thousands-grouped
 * number («۵۲۵٬۰۰۰» with no تومان, the barfbox.ir layout) is present. */
function chunkHasPriceText(plainText:string):boolean{
  return PRICE_HINT_RE.test(plainText)||THOUSANDS_RE.test(plainText);
}
/**
 * Python parity (scraper4.py extract_price): a currency word wins, but a bare
 * thousands-grouped number is still a price — the longest digit run wins.
 */
function heuristicPriceText(plainText:string):string{
  const hint=plainText.match(PRICE_HINT_RE)?.[0];
  if(hint)return cleanText(hint);
  let best='';
  for(const m of plainText.matchAll(THOUSANDS_GLOBAL_RE)){
    if(m[0].replace(/[^\d۰-۹٠-٩]/g,'').length>best.replace(/[^\d۰-۹٠-٩]/g,'').length)best=m[0];
  }
  return cleanText(best);
}
const PRICE_FORMAT_CHARS_RE=/[ـ‌‍﻿]/g;
function stripPriceFormatChars(value:string):string{return value.replace(PRICE_FORMAT_CHARS_RE,'')}
function looksLikePrice(text:string):boolean{
  const value=stripPriceFormatChars(cleanText(text));
  if(!value||value.length>80)return false;
  if(PRICE_HINT_RE.test(value))return numberFromText(value)>0;
  return THOUSANDS_RE.test(value)&&numberFromText(value)>0;
}
function cssEscapeIdent(value:string):string{
  return value.replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char).replace(/^(\d)/,'\\3$1 ');
}
const VOLATILE_CLASS_RE=/^(active|selected|current|open|opened|hover|focus|disabled|loading|ng-|v-|is-|has-|js-)/i;
const HASH_CLASS_RE=/^[a-f0-9]{6,}$/i;
function stableClasses(classAttr:string|undefined):string[]{
  const all=String(classAttr||'').split(/\s+/).filter(Boolean);
  const stable=all.filter(name=>name.length<=40&&!VOLATILE_CLASS_RE.test(name)&&!HASH_CLASS_RE.test(name));
  // Prefer plain readable classes over escaped Tailwind utilities.
  const rank=(name:string)=>(/[^a-zA-Z0-9_-]/.test(name)?100:0)+name.length;
  return [...new Set(stable)].sort((a,b)=>rank(a)-rank(b));
}
/** Minimal `tag.class` selector for a chunk root (relative-safe inside a card). */
function selectorForTagClasses(tag:string,classAttr:string|undefined):string{
  const base=/^[a-z][a-z0-9]*$/i.test(tag)?tag.toLowerCase():'div';
  const classes=stableClasses(classAttr);
  if(classes.length>=2)return `${base}.${cssEscapeIdent(classes[0])}.${cssEscapeIdent(classes[1])}`;
  if(classes.length===1)return `${base}.${cssEscapeIdent(classes[0])}`;
  return base;
}

export type ListDiscoveryMethod='curated'|'structural'|'mixed'|'none';
export type ListDiscovery={
  selectors:Partial<Selectors>;
  evidence:Record<string,unknown>;
  method:ListDiscoveryMethod;
  containerCount:number;
};
/**
 * Find list selectors for a page whose profile never configured them.
 *
 * Pass 1 tests the curated e-commerce selector list (fast, precise on known
 * platforms). Pass 2 — structural inference — handles everything else: it
 * clusters link+image HTML chunks by their tag+class signature, picks the
 * repeating product-card pattern, and derives title/price/link/image selectors
 * from inside the cards. Every proposal is verified against the same HTML
 * before it is returned, so callers can persist it without a second check.
 */
export async function discoverListSelectorsFromHtml(html:string,baseUrl:string):Promise<ListDiscovery>{
  const selectors:Partial<Selectors>={};
  const evidence:Record<string,unknown>={};
  for(const field of LIST_SELECTOR_KEYS){
    const config=SUGGESTION_CANDIDATES[field];
    for(const candidate of config.selectors){
      try{
        const values=await extractSelectorValues(html,baseUrl,candidate,config.type||'text');
        const minimum=field==='container'?2:1;
        if(values.length>=minimum){
          (selectors as any)[field]=candidate;
          evidence[field]={count:values.length,sample:(values[0]||'').slice(0,200),via:'curated'};
          break;
        }
      }catch{/* next candidate */}
    }
  }
  const curatedSelectors={...selectors};
  const curatedEvidence={...evidence};
  let structuralSelectors:Partial<Selectors>|null=null;
  let structuralEvidence:Record<string,unknown>={};
  if(!selectors.container||!selectors.title){
    try{
      const structural=await inferStructuralListSelectors(html,baseUrl);
      if(structural){
        structuralSelectors={...structural.selectors};
        structuralEvidence={...structural.evidence};
        for(const [key,value] of Object.entries(structural.selectors)){
          if(value&&!(selectors as any)[key]){
            (selectors as any)[key]=value;
            (evidence as any)[key]={...((structural.evidence as any)[key]||{}),via:'structural'};
          }
        }
      }
    }catch{/* structural pass is best-effort */}
  }
  // Final gate, best-of ranking (twin of the Render fix): curated candidates
  // match page-wide (an 'h2' page heading wins 'title'), while structural
  // selectors are card-scoped — merging both can poison a good structural
  // container with a bad curated title (barfbox.ir). Verify merged first,
  // then each pass alone; the first set whose titles resolve INSIDE the
  // cards wins, so a stale stowaway can never veto a working set.
  const mergedMethod:ListDiscoveryMethod=!structuralSelectors?'curated'
    :(curatedSelectors.container&&curatedSelectors.title?'mixed':'structural');
  const candidates:Array<{sel:Partial<Selectors>;ev:Record<string,unknown>;method:ListDiscoveryMethod}>=[
    {sel:selectors,ev:evidence,method:mergedMethod},
    ...(structuralSelectors?[{sel:structuralSelectors,ev:structuralEvidence,method:'structural' as ListDiscoveryMethod}]:[]),
    {sel:curatedSelectors,ev:curatedEvidence,method:'curated'},
  ];
  let containerCount=0;
  for(const candidate of candidates){
    if(!candidate.sel.container||!candidate.sel.title)continue;
    const verified=await verifyListSelectors(html,baseUrl,{...DEFAULT_SELECTORS,...candidate.sel}as Selectors);
    containerCount=verified.containerCount;
    if(verified.ok)return{selectors:candidate.sel,evidence:candidate.ev,method:candidate.method,containerCount};
  }
  return{selectors:{},evidence:{},method:'none',containerCount};
}

/** The anchor itself plus up to two enclosing card-like elements, as HTML. */
function contextChunks(html:string,index:number,anchorOpen:string):string[]{
  void anchorOpen;
  const chunks:string[]=[];
  const close=html.indexOf('</a>',index);
  if(close>index&&close-index<6000)chunks.push(html.slice(index,close+4));
  let cursor=index;
  for(let depth=0;depth<4;depth++){
    let best='',bestOpen=-1;
    for(const [tag,endTag] of [['article','</article>'],['li','</li>'],['tr','</tr>'],['div','</div>']] as const){
      const open=enclosingOpen(html,cursor,tag,endTag);
      if(open<0||cursor-open>1800)continue;
      const end=matchingClose(html,open,tag,endTag);
      if(end<0||end-open>5000)continue;
      const chunk=html.slice(open,end+endTag.length);
      if(!best||chunk.length<best.length){best=chunk;bestOpen=open}
    }
    if(!best||bestOpen<0)break;
    chunks.push(best);cursor=bestOpen;
  }
  return chunks;
}

/**
 * Structural card inference: cluster every link+image HTML chunk by its
 * tag+class signature and treat the largest repeating cluster as the product
 * grid. Unlike the `heuristic` engine (which extracts products directly from
 * price-shaped text), this produces reusable CSS selectors, so the selector
 * engines — and every later page and run — work with them.
 */
async function inferStructuralListSelectors(html:string,baseUrl:string):Promise<{selectors:Partial<Selectors>;evidence:Record<string,unknown>}|null>{
  const groups=new Map<string,{chunks:string[];seen:Set<string>;priceHits:number}>();
  const anchors:RegExpExecArray[]=[];
  try{
    const anchorRe=/<a\b[^>]*href=["']([^"']*)["'][^>]*>/gi;
    let match:RegExpExecArray|null;
    while((match=anchorRe.exec(html))&&anchors.length<800)anchors.push(match);
  }catch{return null}
  if(anchors.length<2)return null;
  for(const anchor of anchors){
    const href=String(anchor[1]||'').trim();
    if(!href||href==='#'||/^javascript:/i.test(href))continue;
    for(const chunk of contextChunks(html,anchor.index,anchor[0])){
      const open=chunk.match(/^<(\w+)\b([^>]*)>/);
      if(!open)continue;
      const tag=open[1].toLowerCase();
      if(!tag||tag==='html'||tag==='body')continue;
      const text=stripHtml(chunk);
      if(!text||text.length<12||text.length>1500)continue;
      if(!/<img\b/i.test(chunk))continue;
      if((chunk.match(/<a\b[^>]*href\s*=/gi)||[]).length>4)continue;
      const classAttr=open[2].match(/\bclass=["']([^"']*)["']/)?.[1]||'';
      const signature=selectorForTagClasses(tag,classAttr);
      if(!signature.includes('.')&&tag!=='li'&&tag!=='article')continue;
      let group=groups.get(signature);
      if(!group){group={chunks:[],seen:new Set(),priceHits:0};groups.set(signature,group)}
      if(group.seen.has(chunk))continue;
      group.seen.add(chunk);group.chunks.push(chunk);
      if(PRICE_HINT_RE.test(stripPriceFormatChars(text))||THOUSANDS_RE.test(text))group.priceHits++;
    }
  }
  const clusters=[...groups.entries()]
    .map(([selector,group])=>({selector,chunks:group.chunks,priceHits:group.priceHits}))
    .filter(cluster=>cluster.chunks.length>=2)
    .sort((a,b)=>(b.chunks.length*(1+b.priceHits))-(a.chunks.length*(1+a.priceHits)));
  for(const cluster of clusters.slice(0,5)){
    const derived=deriveStructuralFieldSelectors(cluster.chunks.slice(0,8));
    if(!derived||!derived.title)continue;
    const linkSelector=derived.cardIsLink?cluster.selector:'a[href]';
    const merged={...DEFAULT_SELECTORS,container:cluster.selector,title:derived.title,price:derived.price||'',link:linkSelector,image:'img'}as Selectors;
    const verified=await verifyListSelectors(html,baseUrl,merged);
    if(!verified.ok)continue;
    return{
      selectors:{container:cluster.selector,title:derived.title,...(derived.price?{price:derived.price}:{}),link:linkSelector,image:'img'},
      evidence:{
        container:{count:verified.containerCount,sample:cluster.selector},
        title:verified.title,price:verified.price,link:verified.link,image:verified.image
      }
    };
  }
  return null;
}

const BLOCK_TAG_RE=/<(div|ul|ol|li|table|section|article|header|footer|main|form|p|h[1-6])\b/i;
/** Derive title/price selectors from inside sampled chunks of one cluster. */
function deriveStructuralFieldSelectors(sampleChunks:string[]):{title:string;price:string;cardIsLink:boolean}|null{
  const titleVotes=new Map<string,{count:number;bonus:number}>();
  const priceVotes=new Map<string,{count:number;length:number}>();
  let cardIsLink=0;
  const classOf=(attrs:string)=>attrs.match(/\bclass=["']([^"']*)["']/)?.[1]||'';
  for(const chunk of sampleChunks){
    if(/^<a\b/i.test(chunk))cardIsLink++;
    // Title: headings/itemprop first, else the longest mid-length text node.
    let titleSig='';
    const headingH=chunk.match(/<h([1-4])\b([^>]*)>([\s\S]{0,600}?)<\/h[1-4]>/i);
    const headingProp:RegExpMatchArray|null=!headingH?chunk.match(/<([a-z][a-z0-9]*)\b([^>]*itemprop=["']name["'][^>]*)>([\s\S]{0,600}?)<\/\1>/i):null;
    const heading=headingH||headingProp;
    if(heading){
      const text=stripHtml(heading[3]||'');
      if(text.length>=8&&text.length<=200&&!looksLikePrice(text)){
        const tag=headingH?`h${headingH[1]}`:(headingProp?.[1]||'div');
        titleSig=selectorForTagClasses(tag,classOf(heading[2]||''));
      }
    }else{
      let bestLen=0,bestIndex=-1;
      const considerTitle=(tag:string,attrs:string,rawInner:string,index:number)=>{
        const text=stripHtml(rawInner);
        if(text.length>=15&&text.length<=160&&(text.length>bestLen||(text.length===bestLen&&index>bestIndex))&&!looksLikePrice(text)){bestLen=text.length;bestIndex=index;titleSig=selectorForTagClasses(tag,classOf(attrs))}
      };
      for(const m of chunk.matchAll(/<(span|div|p|a|li|td|strong|b)\b([^>]*)>([^<>]{15,160})<\/\1>/gi))considerTitle(m[1],m[2]||'',m[3]||'',m.index??0);
      // Inline-wrapped titles (`<p class="name"><a>…</a></p>`): the tolerant
      // pass sees through inline markup but skips block wrappers. The chunk
      // root itself is excluded — its text is the whole card.
      const body=chunk.replace(/^<[a-z][a-z0-9]*\b[^>]*>/i,'');
      for(const m of body.matchAll(/<(span|div|p|a|li|td|strong|b)\b([^>]*)>([\s\S]{15,220}?)<\/\1>/gi)){
        const inner=m[3]||'';
        if(!/[<>]/.test(inner))continue;
        if(BLOCK_TAG_RE.test(inner))continue;
        considerTitle(m[1],m[2]||'',inner,m.index??0);
      }
    }
    if(titleSig){
      const vote=titleVotes.get(titleSig)||{count:0,bonus:/^h[1-4][.]/.test(titleSig)?2:0};
      vote.count++;
      titleVotes.set(titleSig,vote);
    }
    // Price: the SHORTEST price-shaped text — wrappers that also contain the
    // title lose to the leaf element that holds just the price. On a length
    // tie the deeper element wins (open tags come before their children in
    // document order, so the later index is the leaf).
    const priceCandidates:Array<{sig:string;length:number;index:number}>=[];
    const considerPrice=(tag:string,attrs:string,rawInner:string,index:number)=>{
      const text=stripHtml(rawInner);
      if(!text||text.length>80||!looksLikePrice(text))return;
      priceCandidates.push({sig:selectorForTagClasses(tag,classOf(attrs)),length:text.length,index});
    };
    for(const m of chunk.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([^<>]{1,80})<\/\1>/gi))considerPrice(m[1],m[2]||'',m[3]||'',m.index??0);
    const priceBody=chunk.replace(/^<[a-z][a-z0-9]*\b[^>]*>/i,'');
    for(const m of priceBody.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([\s\S]{1,160}?)<\/\1>/gi)){
      const inner=m[3]||'';
      if(!/[<>]/.test(inner))continue;
      if(BLOCK_TAG_RE.test(inner))continue;
      considerPrice(m[1],m[2]||'',inner,m.index??0);
    }
    priceCandidates.sort((a,b)=>a.length-b.length||b.index-a.index);
    if(priceCandidates.length){
      const winner=priceCandidates[0].sig;
      const vote=priceVotes.get(winner)||{count:0,length:priceCandidates[0].length};
      vote.count++;
      priceVotes.set(winner,vote);
    }
  }
  const titleWinner=[...titleVotes.entries()].sort((a,b)=>(b[1].count*10+b[1].bonus)-(a[1].count*10+a[1].bonus))[0];
  if(!titleWinner)return null;
  const priceWinner=[...priceVotes.entries()].sort((a,b)=>b[1].count-a[1].count||a[1].length-b[1].length)[0];
  return{title:titleWinner[0],price:priceWinner?priceWinner[0]:'',cardIsLink:cardIsLink*2>=sampleChunks.length};
}

export type EnsuredListSelectors={selectors:Selectors;discovered?:Partial<Selectors>;method:string};
/**
 * Repair unconfigured list selectors from already-fetched page HTML (no extra
 * fetch): when the profile's selectors were never configured for this shop and
 * do not verify, discover replacements and adopt them only if the merged set
 * verifies. Fully custom selectors pass through untouched.
 */
export async function ensureListSelectors(html:string,baseUrl:string,selectors:Selectors):Promise<EnsuredListSelectors>{
  if(listSelectorsStatus(selectors)==='custom')return{selectors,method:''};
  if((await verifyListSelectors(html,baseUrl,selectors)).ok)return{selectors,method:''};
  const found=await discoverListSelectorsFromHtml(html,baseUrl);
  const merged={...selectors,...found.selectors}as Selectors;
  if(found.method!=='none'&&found.selectors.container&&found.selectors.title&&(await verifyListSelectors(html,baseUrl,merged)).ok)
    return{selectors:merged,discovered:found.selectors,method:found.method};
  return{selectors,method:''};
}
export function safeLongDescription(value:string):string{return value||`<p>${escapeHtml(value)}</p>`}
