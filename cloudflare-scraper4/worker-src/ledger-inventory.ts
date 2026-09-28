/** Ledger inventory for reconciliation: Woo = publish (not hidden), Basalam = active (2976) + unapproved due to category (3567). */
export function customerVisible(target:string,remote:any):boolean {
 const raw=remote?.raw||{},status=String(remote?.status??'');
 return target==='basalam'?(status==='2976'||status==='3567'):target==='woo'&&status==='publish'&&raw.catalog_visibility!=='hidden';
}
export function basalamLedgerVisible(remote:any):boolean{
 const status=String(remote?.status??remote?.raw?.status??'');
 return status==='2976'||status==='3567';
}
