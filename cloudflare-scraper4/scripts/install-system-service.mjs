#!/usr/bin/env node
// Explicit, one-time Linux migration. No PHP, root npm scripts, or network code download.
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,mkdirSync,chmodSync,readdirSync,readlinkSync,statfsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
export const TARGET='/opt/scraper4-node',STATE='/var/lib/scraper4-node',CONFIG='/etc/scraper4-node',SERVICE='scraper4-node.service',ACCOUNT='scraper4-node';
const quote=value=>'"'+String(value).replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
export function systemUnit(node='/usr/bin/node'){
 if(!node.startsWith('/')||/[\r\n\0]/.test(node))throw Error('Invalid Node executable');
 return `[Unit]
Description=Scraper4 Node Deployer and Scraper (independent of PHP)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=${ACCOUNT}
Group=${ACCOUNT}
WorkingDirectory=${TARGET}
EnvironmentFile=${CONFIG}/runtime.env
ExecStart=${quote(node)} ${TARGET}/scripts/local-deployer-ui.mjs
Restart=always
RestartSec=10
KillMode=control-group
TimeoutStopSec=45
OOMPolicy=kill
MemoryAccounting=true
MemoryHigh=40%
MemoryMax=50%
MemorySwapMax=0
CPUAccounting=true
CPUQuota=100%
TasksMax=512
LimitNOFILE=32768
Nice=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=scraper4-node

[Install]
WantedBy=multi-user.target
`;
}
export function parseEnv(text,{literal=false}={}){
 const out=Object.create(null);
 for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(!m)continue;let v=m[2].trim();if(!literal&&v.length>=2&&['"',"'"].includes(v[0])&&v.at(-1)===v[0])v=v.slice(1,-1);out[m[1]]=v;}
 return out;
}
export function runtimeEnvironment(node,token){
 // EnvironmentFile is parsed by systemd, never sourced by a shell.
 const env={PATH:`${dirname(node)}:/usr/local/bin:/usr/bin:/bin`,HOME:STATE,XDG_CACHE_HOME:STATE+'/cache',npm_config_cache:STATE+'/cache/npm',PIP_CACHE_DIR:STATE+'/cache/pip',NODE_ENV:'production',DEPLOYER_UI_HOST:'127.0.0.1',DEPLOYER_UI_PORT:'8790',PORT:'8790',SCRAPER_PORT:'3000',SCRAPER_BIND_HOST:'127.0.0.1',DEPLOYER_UI_TOKEN:token,DEPLOYER_SUPERVISED:'true',LOCAL_SCRAPER_STOP_WITH_UI:'true',LOCAL_SCRAPER_AUTOSTART:'true',LOCAL_SCRAPER_KEEPALIVE:'true',RUN_WORKER_IN_WEB:'true',LOCAL_DEPLOYER_AUTO_UPDATE:'false',LOCAL_DEPLOYER_AUTO_INSTALL_LATEST:'false',LOCAL_SCRAPER_AUTO_UPDATE:'false',LOCAL_SCRAPER_COMMAND:`${node} render-dist/server.js`};
 return Object.entries(env).map(([k,v])=>{if(/[\r\n\0]/.test(v))throw Error('Invalid environment value');return k+'="'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';}).join('\n')+'\n';
}
export function validateSource(source){
 const src=realpathSync(source),pkg=JSON.parse(readFileSync(join(src,'package.json'),'utf8'));
 if(pkg.name!=='scraper4-cloudflare'||!existsSync(join(src,'scripts/local-deployer-ui.mjs'))||!existsSync(join(src,'package-lock.json')))throw Error('Source must be the installed cloudflare-scraper4 directory, including its lockfile.');
 if(['/','/opt','/usr','/var','/var/www','/home','/root'].includes(src)||[TARGET,STATE,CONFIG].some(dest=>src===dest||src.startsWith(dest+'/')||dest.startsWith(src+'/')))throw Error('This is a one-time migration, not an in-place updater.');
 return src;
}
export function migrateEnvironment(env,src){
 const out={...env};const relocate=value=>{const abs=resolve(src,value);if(abs!==src&&!abs.startsWith(src+'/'))throw Error('External database/vault paths require explicit migration; refusing to point a new service at unowned data.');return TARGET+abs.slice(src.length);};
 for(const key of ['VAULT_KEY_FILE','SCRAPER4_SQLITE_PATH'])if(out[key])out[key]=relocate(out[key]);
 if(out.DATABASE_URL&&!/^(postgres|postgresql|mysql|mariadb):/i.test(out.DATABASE_URL)){const raw=out.DATABASE_URL.replace(/^(sqlite|file):(\/\/)?/i,'');out.DATABASE_URL='sqlite:'+relocate(raw);}
 return out;
}
function requireIdleSource(src){for(const pid of readdirSync('/proc').filter(x=>/^\d+$/.test(x))){if(Number(pid)===process.pid)continue;try{const cwd=readlinkSync('/proc/'+pid+'/cwd'),name=readFileSync('/proc/'+pid+'/comm','utf8').trim();if((cwd===src||cwd.startsWith(src+'/'))&&/node|npm|workerd|chrom(e|ium)/i.test(name))throw Error('Source still has a live '+name+' process (PID '+pid+'). Stop it before copying the database.');}catch(e){if(!e.code)throw e;}}}
export function healthUnits(node='/usr/bin/node'){return {
 service:`[Unit]
Description=Scraper4 Node HTTP recovery check
[Service]
Type=oneshot
ExecStart=${quote(node)} ${CONFIG}/healthcheck.mjs
MemoryMax=128M
CPUQuota=25%
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run
`,
 timer:`[Unit]
Description=Check Scraper4 Node Deployer responsiveness
[Timer]
OnBootSec=5min
OnUnitActiveSec=60s
Unit=scraper4-node-health.service
[Install]
WantedBy=timers.target
`};}
function trustedAncestors(path){for(let part=path;part!=='/';part=dirname(part)){if(!existsSync(part)){try{if(lstatSync(part).isSymbolicLink())throw Error('Symlink refused: '+part);}catch(e){if(e.code!=='ENOENT')throw e;}continue;}const st=lstatSync(part);if(st.isSymbolicLink()||st.uid!==0||(st.mode&0o022))throw Error('Expected a root-owned, non-writable trusted path: '+part);}}
export async function requireFreePort(port){await new Promise((yes,no)=>{const socket=createServer();socket.once('error',()=>no(Error(`Port ${port} is occupied. Stop the old WebConsole/manual/systemd supervisor first; no process was killed.`)));socket.listen({port,host:'0.0.0.0'},()=>socket.close(yes));});}
const run=(cmd,args,options={})=>execFileSync(cmd,args,{stdio:'inherit',...options});
// reset-failed is best-effort housekeeping, not a prerequisite for first boot.
export function activateSystemService(execute=run,warn=console.warn){
 execute('systemctl',['daemon-reload']);
 try{execute('systemctl',['reset-failed',SERVICE],{stdio:'ignore'});}
 catch{warn('No failed state could be reset for '+SERVICE+'; continuing with enable/start.');}
 execute('systemctl',['enable','--now',SERVICE]);
 execute('systemctl',['enable','--now','scraper4-node-health.timer']);
}
function assertAccountAbsent(){try{execFileSync('id',[ACCOUNT],{stdio:'ignore'});throw Error('The scraper4-node account already exists. Refusing to take over an unknown installation; see SYSTEMD-VPS.md.');}catch(e){if(!Number.isInteger(e.status))throw e;}}
export async function install(source,confirmed,resume=false){
 if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Run once through root SSH on a systemd Linux VPS.');
 process.umask(0o077);
 if(!confirmed)throw Error('First stop/disable the old WebConsole watchdog or manual supervisor, then pass --confirm-old-supervisor-stopped.');
 if(!existsSync('/run/systemd/system'))throw Error('A running systemd system instance is required.');
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<13))throw Error('Install system-wide Node.js 22.13+ or 24+ first (SQLite support).');
 const node=realpathSync(process.execPath);if(!/^\/(usr|opt)\/[A-Za-z0-9_./-]+$/.test(node))throw Error('Use a system-wide Node binary under /usr or /opt, not root nvm or /home.');trustedAncestors(node);
 const src=validateSource(source);
 const bytes=Number(execFileSync('du',['-sk','--exclude=node_modules','--exclude=.git','--',src],{encoding:'utf8'}).split(/\s+/)[0])*1024;const fs=statfsSync('/opt');if(fs.bavail*fs.bsize<(resume?0:bytes)+2*1024**3)throw Error('Insufficient free space on /opt: need source size plus 2 GiB of build/dependency headroom. No files were removed.');
 if(resume){
  trustedAncestors(CONFIG);trustedAncestors(CONFIG+'/installed.json');for(const file of [SERVICE,'scraper4-node-health.service','scraper4-node-health.timer'])trustedAncestors('/etc/systemd/system/'+file);
  const marker=JSON.parse(readFileSync(CONFIG+'/installed.json','utf8'));
  if(marker.source!==src||marker.target!==TARGET||marker.prepared!==true)throw Error('No matching prepared installation to resume.');
  const uid=Number(execFileSync('id',['-u',ACCOUNT],{encoding:'utf8'}));
  for(const dir of [TARGET,STATE]){trustedAncestors(dirname(dir));const st=lstatSync(dir);if(st.isSymbolicLink()||st.uid!==uid)throw Error('Unexpected runtime ownership: '+dir);}
  if(existsSync('/etc/systemd/system/'+SERVICE))run('systemctl',['stop',SERVICE],{stdio:'ignore'});
 }else for(const p of [TARGET,STATE,CONFIG,'/etc/systemd/system/'+SERVICE,'/etc/systemd/system/scraper4-node-health.service','/etc/systemd/system/scraper4-node-health.timer']){trustedAncestors(p);if(existsSync(p))throw Error('Refusing to overwrite existing installation/config: '+p);}

 if(src.startsWith('/root/'))console.warn('Copying from /root; runtime will be moved outside /root.');
 for(const tool of ['rsync','runuser','systemd-run','systemctl','systemd-analyze','useradd','npm'])run('which',[tool],{stdio:'ignore'});
 if(!resume)assertAccountAbsent();requireIdleSource(src);await requireFreePort(8790);await requireFreePort(3000);
 // Never silently copy external database/data symlinks. Operator must migrate them deliberately.
 const links=execFileSync('find',[src,'-type','d','(','-name','node_modules','-o','-name','.git',')','-prune','-o','-type','l','-print'],{encoding:'utf8'}).trim();if(links)throw Error('Source contains symlinks outside excluded dependency/Git directories. Migrate their targets deliberately before installing.');
 const readEnv=(name,literal=false)=>existsSync(src+'/'+name)?parseEnv(readFileSync(src+'/'+name,'utf8'),{literal}):{};migrateEnvironment({...readEnv('.env.local'),...readEnv('.env.wcp',true)},src);
 // Initial copy only. Resume never rewrites live app data or secrets as root.
 if(!resume){
 run('useradd',['--system','--no-create-home','--user-group','--home-dir',STATE,'--shell','/usr/sbin/nologin',ACCOUNT]);
 mkdirSync(TARGET,{mode:0o700});mkdirSync(STATE,{mode:0o700});mkdirSync(CONFIG,{mode:0o700});
 run('rsync',['-a','--no-perms','--no-links','--no-devices','--no-specials','--no-owner','--no-group','--exclude=node_modules','--exclude=.git','--',src+'/',TARGET+'/']);
 // The source is retained as a rollback copy, including data and vault.key. No --delete.
 const envFile=join(TARGET,'.env.local'),wcpFile=join(TARGET,'.env.wcp');
 const existing=existsSync(envFile)?parseEnv(readFileSync(envFile,'utf8')):{};
 {
  const wcp=existsSync(wcpFile)?parseEnv(readFileSync(wcpFile,'utf8'),{literal:true}):{};
  if(Object.values(wcp).some(v=>/[\r\n\0]/.test(v)))throw Error('Invalid .env.wcp value');
  if(existsSync(envFile))writeFileSync(envFile+'.before-systemd',readFileSync(envFile),{mode:0o600});
  writeFileSync(envFile,Object.entries(migrateEnvironment({...existing,...wcp},src)).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 }
 const effective=existsSync(envFile)?parseEnv(readFileSync(envFile,'utf8')):{};
 writeFileSync(CONFIG+'/runtime.env',runtimeEnvironment(node,effective.DEPLOYER_UI_TOKEN||randomBytes(32).toString('hex')),{mode:0o600});
 run('chown',['-R','--no-dereference',ACCOUNT+':'+ACCOUNT,'--',TARGET,STATE]);
 for(const name of ['.env.local','.env.wcp','.env.local.before-systemd'])if(existsSync(TARGET+'/'+name))chmodSync(TARGET+'/'+name,0o600);
 writeFileSync(CONFIG+'/installed.json',JSON.stringify({source:src,target:TARGET,prepared:true}),{mode:0o600});
 }
 const buildScript=CONFIG+'/build.sh';writeFileSync(buildScript,`#!/bin/sh\nset -eu\ncd ${TARGET}\nnpm ci --include=dev --no-audit --no-fund\n${node} scripts/esbuild-check.mjs\nnpm run version:check\nnpm run render:build\n`,{mode:0o644});
 chmodSync(buildScript,0o644);
 // /etc configuration is traversable only for the dedicated group; secrets remain root-only.
 run('chown',['root:'+ACCOUNT,CONFIG]);chmodSync(CONFIG,0o750);
 run('systemd-run',['--unit=scraper4-node-build','--wait','--pipe','--collect','-p','User='+ACCOUNT,'-p','Group='+ACCOUNT,'-p','WorkingDirectory='+TARGET,'-p','Environment=HOME='+STATE,'-p','Environment=PATH='+dirname(node)+':/usr/local/bin:/usr/bin:/bin','-p','MemoryMax=50%','-p','MemorySwapMax=0','-p','CPUQuota=100%','-p','TasksMax=512','-p','RuntimeMaxSec=1800','/bin/sh',buildScript]);
 if(!existsSync(TARGET+'/render-dist/server.js'))throw Error('Build did not produce render-dist/server.js; no service was enabled.');
 writeFileSync(CONFIG+'/healthcheck.mjs',readFileSync(new URL('./system-service-health.mjs',import.meta.url)),{mode:0o644});
 const health=healthUnits(node);writeFileSync('/etc/systemd/system/scraper4-node-health.service',health.service,{mode:0o644});writeFileSync('/etc/systemd/system/scraper4-node-health.timer',health.timer,{mode:0o644});
 const unitFile='/etc/systemd/system/'+SERVICE;writeFileSync(unitFile,systemUnit(node),{mode:0o644});
 for(const file of [unitFile,'/etc/systemd/system/scraper4-node-health.service','/etc/systemd/system/scraper4-node-health.timer'])chmodSync(file,0o644);
 run('systemd-analyze',['verify',unitFile,'/etc/systemd/system/scraper4-node-health.service','/etc/systemd/system/scraper4-node-health.timer']);
 activateSystemService();
 console.log('Enabled '+SERVICE+'. Old installation left untouched: '+src);
 console.log('Check: systemctl status scraper4-node; journalctl -u scraper4-node -n 80 --no-pager');
 console.log('Expected loopback ports: Deployer 8790, Scraper 3000. Use Caddy/SSH; no web-server configuration was changed.');
 console.log('Tokens stay in /etc/scraper4-node/runtime.env; do not publish logs or secrets.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),i=args.indexOf('--source');
 if(args.includes('--print-unit'))process.stdout.write(systemUnit());
 else if(args.includes('--help')||i<0){console.log('Usage: sudo node scripts/install-system-service.mjs --source /absolute/current/cloudflare-scraper4 --confirm-old-supervisor-stopped\nOne-time migration to /opt/scraper4-node. Source/data kept. Stop old supervisors first. See SYSTEMD-VPS.md.');process.exitCode=args.includes('--help')?0:1;}
 else install(args[i+1],args.includes('--confirm-old-supervisor-stopped'),args.includes('--resume')).catch(e=>{console.error('INSTALL STOPPED: '+e.message+'\nNo automatic deletion/rollback. Preserve source and inspect SYSTEMD-VPS.md before retrying.');process.exitCode=1;});
}
