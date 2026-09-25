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
