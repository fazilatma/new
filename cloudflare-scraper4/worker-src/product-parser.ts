/** Optional second stage. Missing/false enablement must never alter legacy extraction. */
export const PRODUCT_PARSERS=['auto','lxml','selectolax','jsonld','next_data','script_json','metadata','heuristic'] as const;
export type ProductParser=typeof PRODUCT_PARSERS[number];
export function normalizeProductParser(raw:any){return {productParserEnabled:raw.productParserEnabled===true,productParser:PRODUCT_PARSERS.includes(raw.productParser)?raw.productParser as ProductParser:'auto' as ProductParser};}
export function selectedProductParser(profile:{productParserEnabled?:boolean;productParser?:string}):ProductParser|undefined{
 if(profile.productParserEnabled!==true)return undefined;
 if(!PRODUCT_PARSERS.includes((profile.productParser||'auto') as ProductParser))throw Error('Unknown product parser');
 return (profile.productParser||'auto') as ProductParser;
}
export async function parseDownloadedProducts<T>(parser:ProductParser,readers:Record<Exclude<ProductParser,'auto'>,()=>T[]|Promise<T[]>>):Promise<T[]>{
 if(parser!=='auto'){if(!PRODUCT_PARSERS.includes(parser))throw Error('Unknown product parser');return readers[parser]();}
 for(const name of ['jsonld','next_data','script_json','lxml','selectolax','metadata','heuristic'] as const){const rows=await readers[name]();if(rows.length)return rows;}
 return [];
}

/** Parse JSON only: never evaluate embedded JavaScript. Nuxt expressions stay unsupported. */
export function embeddedProductData(html:string,mode:'next_data'|'script_json'):unknown[]{
 const out:unknown[]=[];
 const read=(text:string)=>{if(text.length>200_000)return;try{out.push(JSON.parse(text))}catch{/* not JSON */}};
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  const attrs=match[1],body=match[2].trim();
  if(mode==='script_json'||/\bid\s*=\s*["']__(?:NEXT|NUXT)_DATA__["']/i.test(attrs))read(body);
  const assignments=mode==='next_data'?/(?:window\.)?__NUXT__\s*=\s*([\s\S]+)/g:/(?:window\.)?(?:__NUXT__|__APOLLO_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__)\s*=\s*([\s\S]+)/g;
  for(const found of body.matchAll(assignments))read(found[1].replace(/;\s*$/,''));
 }
 return out;
}

/** Read-only comparison. One failing parser cannot hide the other seven. */
export async function compareProductParsers(read:(parser:ProductParser)=>Promise<any[]>,source='downloaded-html'){
 const results:any[]=[];
 for(const parser of PRODUCT_PARSERS){const started=Date.now();try{const rows=await read(parser);results.push({parser,engine:parser,ok:rows.length>0,status:rows.length?'success':'empty',count:rows.length,elapsedMs:Date.now()-started,source,selectorBased:['lxml','selectolax'].includes(parser),complete:{title:rows.filter(p=>p.title).length,price:rows.filter(p=>p.price>0).length,link:rows.filter(p=>p.url).length,image:rows.filter(p=>p.image).length},sample:rows[0]||null,samples:rows.slice(0,5)});}catch(error){results.push({parser,engine:parser,ok:false,status:'failed',count:0,elapsedMs:Date.now()-started,source,error:error instanceof Error?error.message:String(error),sample:null});}}
 return results;
}
export function unavailableProductParsers(error:string){return PRODUCT_PARSERS.map(parser=>({parser,engine:parser,ok:false,status:'skipped',count:0,elapsedMs:0,source:'unavailable',error,sample:null}));}
