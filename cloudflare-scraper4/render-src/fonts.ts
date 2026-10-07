const FONT_FILES={
  vazirmatn:{family:'Vazirmatn',folder:'Vazirmatn',weights:{100:'thin',300:'light',400:'regular',500:'medium',700:'bold',900:'black'}},
  vazir:{family:'Vazir',folder:'Vazir',weights:{100:'ad3cd4cbda94aee8578c1b622b9002f9dfe345c05870eb375a02da853d08f072',300:'046a76746039189feb148c360dfb82d07a1e3464d31a2078363587af6f5a1cfb',400:'d783603a0dd07db6896ecd8a3460e2256a48dca62373a0478706a05490c1a2d8',500:'fc6648da06acebfe96ad5a8f077f569c5c4dd75b77122951723ddfbfeb191728',700:'3b2277e82a583c9f91de41aa9e198a14d7ef7f4ccd04828abdd623acd116a88b',900:'71671477a4b62305fbd3ed4976a31c3c08520cf914656ece6b79543524a49132'}},
  yekan:{family:'Yekan',folder:'Yekan',weights:{400:'1cdce741b89d94b75c1b52dfbfc7bc3b1eb1a8d2ecb9da71753e17219a1b8057',700:'8b3d4ccc94807967874f481b0ea82d0f26cda739c2fad3b923f28d8915af064f'}},
  shabnam:{family:'Shabnam',folder:'Shabnam',weights:{100:'a074a415cfe0e4f57e2ede996a73d0e509c0ea194c9678c7b87c65fb977907e7',300:'87cf5dde711a284c1e25dd414d51a571b7c9aedd91b2b96f9d679869f5d65162',400:'540d3f4e172bd6b5c70dd06bce57e055ce59270e95ea642b414fe0709faaa085',500:'fd5931f57e84baad81cc7243cfc1c83e5ac7f5dd17818d917765063544a54441',700:'1ff187f5320ec4527ebb6a71831b88289a6cb18ca33ac34476b96960f0af7282'}},
  sahel:{family:'Sahel',folder:'Sahel',weights:{300:'8139e9fd0c48b1ec7e4088c3800568a148d2f7096e250db7a47f9591982b41bc',400:'df74c625136d60e981abbd32cc75624007e5b36cc41cc5327dff190d22b21772',600:'6e6a49a9c1d148c3679b60f1144e05cf5651838df6362a04a463ce35556bade0',700:'162c05c4a6c2e975b07390f923425bb5e170e00c8bd3deccd784f6cb4326d289',900:'12c8dcad8a4269d0be152c74db9116837a5c47f5327c64eb422a5bc6e606f0f2'}},
  samim:{family:'Samim',folder:'Samim',weights:{400:'b45379592d11b2bb9135eb78cea8b54220d89b26d67fb19bae5d15a540d32556',500:'669fc8c8559080eab9fa0757424331c641a5134245dfb952e7471454f38e0384',700:'2433289a5eab77e0374c98180640c2eb1fa5301d6ec3c6219d720662cf0904fc'}}
} as const;
type FontName=keyof typeof FONT_FILES;
function font(name:string){return FONT_FILES[name.toLowerCase() as FontName]}
export function fontStylesheet(name:string):Response{
  const item=font(name);if(!item)return new Response('Font not found',{status:404});
  const lower=name.toLowerCase();
  const css=Object.keys(item.weights).map(weight=>{
    // Twin parity with worker-src/fonts.ts: the stylesheet stays same origin and the
    // ./*.woff2 sibling route does the upstream fetching (and disk caching). Relative on
    // purpose so a subfolder mount (example.com/app/...) keeps resolving inside the app.
    const local=`./${lower}-${weight}.woff2`;
    const srcList=[`url("${local}") format("woff2")`,`local("${item.family}")`,'local(Tahoma)'].join(',');
    return `@font-face{font-family:"${item.family}";src:${srcList};font-weight:${weight};font-style:normal;font-display:swap}`;
  }).join('\n');
  return new Response(css,{headers:{'content-type':'text/css; charset=utf-8','cache-control':'public, max-age=86400','access-control-allow-origin':'*','x-content-type-options':'nosniff'}});
}
async function fetchWithTimeout(url:string,init:RequestInit={},timeoutMs=8000):Promise<Response>{
  const controller=new AbortController();
  const id=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{...init,signal:controller.signal});
  } finally { clearTimeout(id); }
}
export async function fontFile(name:string,weight:string):Promise<Response>{
  const item=font(name),hash=item&&(item.weights as Record<string,string>)[weight];if(!item||!hash)return new Response('Font file not found',{status:404});
  const lower=name.toLowerCase();
  // Try local disk cache first (Node only)
  try{
    const { readFile }=await import('node:fs/promises');
    const { join }=await import('node:path');
    const cacheDir=process.env.FONT_CACHE_DIR||join(process.cwd(),'data','fonts');
    const cachePath=join(cacheDir,`${lower}-${weight}.woff2`);
    const buf=await readFile(cachePath);
    if(buf?.length) return new Response(buf,{status:200,headers:{'content-type':'font/woff2','cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff'}});
  } catch {}
  const urls=[
    ...(lower==='vazirmatn'?[
      `https://cdn.fontcdn.ir/Fonts/Vazirmatn/Vazirmatn-${(hash as string).charAt(0).toUpperCase()+(hash as string).slice(1)}.woff2`,
      `https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-${(hash as string).charAt(0).toUpperCase()+(hash as string).slice(1)}.woff2`,
      `https://unpkg.com/vazirmatn@33.003/fonts/webfonts/Vazirmatn-${(hash as string).charAt(0).toUpperCase()+(hash as string).slice(1)}.woff2`,
      `https://cdn.jsdelivr.net/npm/vazirmatn@33.003/fonts/webfonts/Vazirmatn-${(hash as string).charAt(0).toUpperCase()+(hash as string).slice(1)}.woff2`,
      `https://cdnjs.cloudflare.com/ajax/libs/vazirmatn/33.003/fonts/webfonts/Vazirmatn-${(hash as string).charAt(0).toUpperCase()+(hash as string).slice(1)}.woff2`,
    ]:[
      `https://cdn.fontcdn.ir/Fonts/${item.folder}/${hash}.woff2`,
    ]),
    // jsDelivr mirrors for Vazir as fallback when fontcdn.ir is unreachable from host
    ...(lower==='vazir'?[
      `https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/Vazir-${weight==='400'?'Regular':weight==='700'?'Bold':weight}.woff2`,
      `https://unpkg.com/vazir-font@30.1.0/dist/Vazir-${weight==='400'?'Regular':weight==='700'?'Bold':weight}.woff2`,
      `https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2`,
    ]:[]),
  ];
  let lastError:Response|null=null;
  for(const url of urls){
    try{
      const upstream=await fetchWithTimeout(url,{headers:{accept:'font/woff2','user-agent':'Scraper4/'+(process.env.npm_package_version||'1.0')}},8000);
      if(!upstream.ok){ lastError=new Response(`Font upstream ${upstream.status} for ${url}`,{status:502}); continue; }
      const buf=await upstream.arrayBuffer();
      if(!buf?.byteLength){ lastError=new Response('Font upstream empty',{status:502}); continue; }
      // Cache to disk for next time
      try{
        const { mkdir, writeFile }=await import('node:fs/promises');
        const { join }=await import('node:path');
        const cacheDir=process.env.FONT_CACHE_DIR||join(process.cwd(),'data','fonts');
        await mkdir(cacheDir,{recursive:true});
        await writeFile(join(cacheDir,`${lower}-${weight}.woff2`), Buffer.from(buf));
      } catch {}
      return new Response(buf,{status:200,headers:{'content-type':'font/woff2','cache-control':'public, max-age=31536000, immutable','access-control-allow-origin':'*','x-content-type-options':'nosniff'}});
    } catch (e){
      lastError=new Response('Font fetch failed: '+(e instanceof Error?e.message:String(e)),{status:502});
    }
  }
  return lastError||new Response('Font upstream unavailable',{status:502});
}
