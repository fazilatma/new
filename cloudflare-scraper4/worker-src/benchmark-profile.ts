/** Merge only benchmark-owned fields. A long probe must never revert prices,
 * destinations, or selector edits made while it was running. */
export function mergeBenchmarkProfile(current:any,original:any,result:any,discovered:Record<string,string>){
 const merged={...current,extractionEngineBenchmarks:result.extractionEngineBenchmarks};
 if(current.extractionEngine===original.extractionEngine&&current.url===original.url&&JSON.stringify(current.selectors)===JSON.stringify(original.selectors)){for(const key of ['extractionEngine','extractionEngineMaster','extractionEngineMs','extractionEngineHost'])merged[key]=result[key]}
 merged.selectors={...current.selectors};
 for(const [key,value] of Object.entries(discovered))if(current.selectors?.[key]===original.selectors?.[key])merged.selectors[key]=value;
 return merged;
}
