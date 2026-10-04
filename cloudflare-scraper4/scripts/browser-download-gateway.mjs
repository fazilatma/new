// Child-process-only reverse-gateway adapter. A Worker URL is not a CONNECT proxy.
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const hosts=['registry.npmjs.org','registry.npmmirror.com','cdn.playwright.dev','playwright.download.prss.microsoft.com','playwright.azureedge.net','playwright-akamai.azureedge.net','playwright-verizon.azureedge.net','storage.googleapis.com','googlechromelabs.github.io','github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'];
export function downloadTarget(raw){const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!hosts.includes(u.hostname)||u.port)throw Error('Browser download destination is not approved');return u.href;}
export function gatewayUrl(raw,target){
 const value=String(raw).trim().replace(/%7Burl%7D/ig,'{url}');let base=/^https?:\/\//i.test(value)?value:'https://'+value;
 if(new URL(base.replace('{url}','target')).hostname.endsWith('.workers.dev'))base=base.replace(/^http:/i,'https:');
 const u=new URL(base.replace('{url}','target'));
 if(u.protocol!=='https:'||u.username||u.password)throw Error('Browser gateway must be an HTTPS URL without credentials');
 if(base.includes('{url}'))return base.replace('{url}',encodeURIComponent(downloadTarget(target)));
 if(u.searchParams.has('url')){u.searchParams.set('url',downloadTarget(target));return u.href;}
 return base.replace(/\/$/,'')+'/'+downloadTarget(target);
}
export function gatewayDownloadEnvironment(env,gateway,cwd=process.cwd()){
 gatewayUrl(gateway,'https://registry.npmjs.org/playwright');
 const out={...env,SCRAPER_BROWSER_GATEWAY:gateway,NODE_OPTIONS:((env.NODE_OPTIONS||'')+' --import='+pathToFileURL(resolve(cwd,'scripts/browser-download-gateway.mjs')).href).trim()};
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','npm_config_proxy','npm_config_https_proxy'])delete out[key];
 out.NO_PROXY='*';out.no_proxy='*';return out;
}
export function installGateway(gateway){
 const original={http:http.request.bind(http),https:https.request.bind(https)},originalFetch=globalThis.fetch;
 const wrap=protocol=>(input,options,callback)=>{
  if(typeof options==='function'){callback=options;options=undefined;}
  let target,opts;
  if(typeof input==='string'||input instanceof URL){target=new URL(input);opts={...(options||{})};}
  else {opts={...input,...options};const hostname=opts.hostname||opts.host||'localhost';target=new URL((opts.protocol||protocol+'://').replace(/:\/\/$/,':')+'//'+hostname+(opts.port?':'+opts.port:'')+(opts.path||'/'));}
  const method=String(opts.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method))throw Error('Browser gateway permits read-only downloads only');
  const destination=gatewayUrl(gateway,target.href),headers={};
  for(const [key,value] of Object.entries(opts.headers||{}))if(['accept','accept-encoding','user-agent','range','if-range','if-none-match','if-modified-since'].includes(key.toLowerCase()))headers[key]=value;
  // Never forward registry auth, cookies, client TLS keys or a caller's proxy agent.
  const request=original.https(destination,{method,headers,timeout:opts.timeout},response=>{
   if(response.statusCode>=400){const ray=String(response.headers['cf-ray']||'not supplied').replace(/[^a-zA-Z0-9 -]/g,'').slice(0,100);console.error('Cloudflare gateway download HTTP '+response.statusCode+'; target host='+target.hostname+'; cf-ray='+ray+'. This response alone does not identify gateway versus upstream failure.');}
   if(response.headers.location)response.headers.location=new URL(response.headers.location,target).href;
   callback?.(response);
  });
  return request;
 };
 http.request=wrap('http');https.request=wrap('https');
 http.get=(...args)=>{const request=http.request(...args);request.end();return request};
 https.get=(...args)=>{const request=https.request(...args);request.end();return request};
 if(originalFetch)globalThis.fetch=(input,init={})=>{const method=String(init.method||input?.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method))throw Error('Browser gateway permits read-only downloads only');return originalFetch(gatewayUrl(gateway,typeof input==='string'||input instanceof URL?String(input):input.url),{method,signal:init.signal,redirect:'error'});};
 syncBuiltinESMExports();
}
if(process.env.SCRAPER_BROWSER_GATEWAY)installGateway(process.env.SCRAPER_BROWSER_GATEWAY);
