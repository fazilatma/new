#!/usr/bin/env node
import webpush from 'web-push';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const args=process.argv.slice(2),get=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1]};
const subject=get('--subject',''),output=resolve(get('--out','data/web-push.env'));
try {
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(subject) || /[\r\n"'`]/.test(subject)) throw Error('Use --subject mailto:YOUR-EMAIL or an HTTPS contact URL.');
  const keys=webpush.generateVAPIDKeys();await mkdir(dirname(output),{recursive:true});
  await writeFile(output,`WEB_PUSH_SUBJECT=${subject}\nWEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\n`,{flag:'wx',mode:0o600});
  console.log(`Wrote private environment file: ${output}. Load it in the web and queue services; do not publish it or rotate existing keys.`);
} catch(e) { console.error(e.message);process.exitCode=1; }
