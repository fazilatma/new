/** Public inventory only; stock zero does not imply that a listing is invisible. */
export function customerVisible(target:string,remote:any):boolean {
 const raw=remote?.raw||{},status=String(remote?.status??'');
 return target==='basalam'?status==='2976':target==='woo'&&status==='publish'&&raw.catalog_visibility!=='hidden';
}
