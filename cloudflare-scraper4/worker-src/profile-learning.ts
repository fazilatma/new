import {DEFAULT_SELECTORS} from './types.js';
/** Background learning must not replay an old whole-profile snapshot over edits. */
export function mergeLearnedProfile(current:any,original:any,result:any,discovered:Record<string,unknown>){
 const merged={...current,selectors:{...current.selectors}};
 if(current.url!==original.url)return merged;
 for(const [key,value] of Object.entries(discovered)){
  const before=String(original.selectors?.[key]||'').trim(),defaultValue=String((DEFAULT_SELECTORS as any)[key]||'').trim();
  if(String(value||'').trim()&&(!before||before===defaultValue)&&current.selectors?.[key]===original.selectors?.[key])merged.selectors[key]=String(value);
 }
 if(current.extractionEngine===original.extractionEngine&&current.productParserEnabled===original.productParserEnabled&&current.productParser===original.productParser&&JSON.stringify(current.selectors)===JSON.stringify(original.selectors)){
  for(const key of ['extractionEngineMaster','extractionEngineMs','extractionEngineHost'])if(result[key]!==undefined)merged[key]=result[key];
 }
 return merged;
}
