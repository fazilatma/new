/** Ledger inventory: Woo = publish (not hidden), Basalam = active/approved (2976) only.
 * Unapproved due to category (3567) is used separately for bulk category correction,
 * not for general ledger/mismatch/send operations. */
export function customerVisible(target:string,remote:any):boolean {
 const raw=remote?.raw||{},status=String(remote?.status??'');
 return target==='basalam'?status==='2976':target==='woo'&&status==='publish'&&raw.catalog_visibility!=='hidden';
}
export function basalamLedgerVisible(remote:any):boolean{
 const status=String(remote?.status??remote?.raw?.status??'');
 return status==='2976';
}
export function basalamUnapprovedVisible(remote:any):boolean{
 const status=String(remote?.status??remote?.raw?.status??'');
 return status==='3567';
}
