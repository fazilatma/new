import { createDestinationLedger, ledgerScope } from '../worker-src/destination-ledger.js';
import { getState,setState,ledgerRows,ledgerGet,ledgerPut,ledgerPrune } from './db.js';
import { loadConnections } from './connections.js';
export const destinationLedger=createDestinationLedger({getState,setState,ledgerRows,ledgerGet,ledgerPut,ledgerPrune});
export async function destinationScope(target:'woo'|'basalam',accountKey='default'){const c=await loadConnections();return ledgerScope(target,target==='woo'?c.woo.url:c.basalam.api,target==='woo'?'default':accountKey)}
