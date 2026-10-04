#!/usr/bin/env node
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const shell=s=>"'"+s.replaceAll("'","'\\''")+"'";
const unit=s=>'"'+s.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n')+'"';
export function serviceConfig(kind,{cwd=project,node=process.execPath,path=process.env.PATH||'',home=homedir()}={}){
 if(kind==='systemd')return `[Unit]
Description=Scraper4 deployer and scraper keepalive
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=${unit(cwd)}
ExecStart=${unit(node)} ${unit(resolve(cwd,'scripts/local-deployer-ui.mjs'))}
Environment=${unit('PATH='+path)}
Environment=DEPLOYER_SUPERVISED=true
Environment=LOCAL_SCRAPER_STOP_WITH_UI=true
Environment=LOCAL_SCRAPER_AUTOSTART=true
Environment=LOCAL_SCRAPER_KEEPALIVE=true
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
 if(kind==='termux')return `#!${resolve(process.env.PREFIX||'/data/data/com.termux/files/usr','bin/sh')}
# Run under termux-services/runit. No root required.
export PATH=${shell(path)}
export HOME=${shell(home)}
cd ${shell(cwd)} || exit 1
export DEPLOYER_SUPERVISED=true LOCAL_SCRAPER_STOP_WITH_UI=true
export LOCAL_SCRAPER_AUTOSTART=true LOCAL_SCRAPER_KEEPALIVE=true
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
exec ${shell(node)} ${shell(resolve(cwd,'scripts/local-deployer-ui.mjs'))}
`;
 throw Error('Use --systemd or --termux. This command only prints configuration; it does not install or start services.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(serviceConfig(process.argv.includes('--systemd')?'systemd':process.argv.includes('--termux')?'termux':''));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
