#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { resolve, join } from 'node:path';
const args=process.argv.slice(2),get=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1]},root=resolve(get('--project-dir','.'));
try {
  let local={};try{local=parseEnv(await readFile(join(root,'.env.local'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  const env={...local,...process.env};let token=env.ADMIN_TOKEN||'',source='existing ADMIN_TOKEN';
  if(!token){try{token=(await readFile(resolve(root,env.VAULT_KEY_FILE||'data/vault.key'),'utf8')).trim();source='existing local vault key (preserves encrypted connections)'}catch(error){if(error.code!=='ENOENT')throw error}}
  if(!token){if(!args.includes('--new-install'))throw Error('No existing ADMIN_TOKEN or vault key found. Restore the existing secret; use --new-install only for an empty/new installation.');token=randomBytes(32).toString('hex');source='new installation'}
  if(/[\r\n\0]/.test(token))throw Error('Invalid existing ADMIN_TOKEN: control characters are not supported.');
  const dir=join(root,'data'),file=join(dir,'https.env');await mkdir(dir,{recursive:true});
  await writeFile(file,`# Private: load after the existing application environment.\nADMIN_TOKEN=${JSON.stringify(token)}\nSCRAPER_BIND_HOST=127.0.0.1\n`,{mode:0o600,flag:'wx'});
  console.log(`Prepared ${file} using ${source}. No secret was printed. Keep this file private; load it in the web and worker services, then restart them.`);
} catch(error) { console.error(error.message);process.exitCode=1; }
