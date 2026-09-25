import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
test('owner auth opt-out preserves the existing credential-vault key and is reversible',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'optional-auth-'));
 try{
  const bundle=join(dir,'fixture.mjs');
  await build({stdin:{contents:"export {config} from './config.js';export {encryptVault,decryptVault,emptyConnections} from './vault.js';",resolveDir:fileURLToPath(new URL('../render-src/',import.meta.url)),loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const prefix='import {config,encryptVault,decryptVault,emptyConnections} from '+JSON.stringify(pathToFileURL(bundle).href)+';';
  const run=(flag,code,input='')=>execFileSync(process.execPath,['--input-type=module','-e',prefix+code],{cwd:dir,input,encoding:'utf8',env:{...process.env,ADMIN_TOKEN:'fixture-existing-vault-key',ADMIN_AUTH_DISABLED:flag,VAULT_KEY_FILE:join(dir,'vault.key')}});
  const encrypted=run('false',"const v=emptyConnections();v.woo.key='fixture-saved-credential';console.log(JSON.stringify(encryptVault(v))); ");
  const decrypt="import {readFileSync} from 'node:fs';const v=decryptVault(JSON.parse(readFileSync(0,'utf8')));console.log(JSON.stringify({disabled:config.adminAuthDisabled,key:v.woo.key}));";
  assert.deepEqual(JSON.parse(run('true',decrypt,encrypted)),{disabled:true,key:'fixture-saved-credential'});
  assert.deepEqual(JSON.parse(run('false',decrypt,encrypted)),{disabled:false,key:'fixture-saved-credential'});
  assert.equal(run('TRUE','console.log(config.adminAuthDisabled)').trim(),'false');
  assert.equal(existsSync(join(dir,'vault.key')),false,'must not replace the existing encryption password with a generated key');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
