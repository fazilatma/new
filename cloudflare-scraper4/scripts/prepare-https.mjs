#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function caddyConfig(domain, port = 3000) {
  if (typeof domain !== 'string' || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) throw Error('Supply a public hostname only, e.g. scraper.example.com (no URL, path or wildcard).');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('App port must be an integer from 1024 to 65535.');
  return `${domain.toLowerCase()} {
  # Caddy obtains and renews a public certificate and redirects HTTP to HTTPS.
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
  }
  reverse_proxy 127.0.0.1:${port} {
    # Keep extraction-diagnosis NDJSON live.
    flush_interval -1
    transport http {
      response_header_timeout 180s
    }
  }
  # Do not log request URLs: visual tickets and deployment tokens are sensitive.
}
`;
}
async function main() {
  const args=process.argv.slice(2),get=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1]};
  const domain=get('--domain',''),port=Number(get('--port','3000')),dir=resolve(get('--out','.deploy/https'));
  const content=caddyConfig(domain,port);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'Caddyfile'),content,{flag:'wx',mode:0o600});
  console.log(`Prepared ${join(dir,'Caddyfile')}. No DNS, firewall or running service was changed.`);
  console.log('Read HTTPS-PUSH-VISUAL.md before installing it. Existing output is never overwritten.');
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(e=>{console.error(e.message);process.exitCode=1});
