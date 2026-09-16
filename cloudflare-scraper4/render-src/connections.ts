import { getState, setState } from './db.js';
import { decryptVault, encryptVault, mergeConnections, type ConnectionVault } from './vault.js';
import { configureSourceNetwork } from './network.js';

const KEY='connection_vault';
let cached: { value:ConnectionVault; expires:number }|null=null;

export async function loadConnections(fresh=false): Promise<ConnectionVault> {
  if(!fresh&&cached&&cached.expires>Date.now())return cached.value;
  const envelope=await getState<unknown>(KEY,null);
  const value=decryptVault(envelope);cached={value,expires:Date.now()+30_000};
  configureSourceNetwork(value.ai?.network);
  return value;
}

export async function saveConnections(input:unknown): Promise<ConnectionVault> {
  const current=await loadConnections(true),value=mergeConnections(current,input);
  await setState(KEY,encryptVault(value));cached={value,expires:Date.now()+30_000};
  configureSourceNetwork(value.ai?.network);
  return value;
}

export function connectionStatus(value:ConnectionVault){return{woo:Boolean(value.woo.url&&value.woo.key&&value.woo.secret),basalam:Boolean(value.basalam.token&&value.basalam.vendorId),ai:Boolean((value.ai.baseUrl&&value.ai.apiKey&&value.ai.model)||value.ai.providers.some(p=>p.enabled&&p.baseUrl&&p.apiKey&&p.models.length)),notifications:Boolean(value.notifications.url||value.notifications.baleToken||value.notifications.rubikaToken)}}
