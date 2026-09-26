import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {browserPaths,applyBrowserPaths,browserProjectRoot} from '../scripts/browser-paths.mjs';
import {verifyInstalledBrowsers} from '../scripts/browsers-install.mjs';
test('installer/runtime cache destinations are project-local, independent of HOME and CWD',()=>{
 const a=browserPaths({HOME:'/root'},'/app'),b=browserPaths({HOME:'/service'},'/app');
 assert.deepEqual(a,b);assert.equal(a.PLAYWRIGHT_BROWSERS_PATH,'/app/data/browsers/ms-playwright');assert.equal(a.PUPPETEER_CACHE_DIR,'/app/data/browsers/puppeteer');
});
test('saved browser paths match installation and runtime; environment wins; relative paths anchor to project',()=>{
 const root=mkdtempSync(join(tmpdir(),'browser-paths-'));
 try{writeFileSync(join(root,'.env.local'),'PUPPETEER_CACHE_DIR="custom/cache"\nPLAYWRIGHT_BROWSERS_PATH=/shared/pw\nBROWSER_EXECUTABLE_PATH=bin/chrome\nUNRELATED_SECRET=ignored\n');
 const saved=browserPaths({},root);assert.equal(saved.PUPPETEER_CACHE_DIR,join(root,'custom/cache'));assert.equal(saved.PLAYWRIGHT_BROWSERS_PATH,'/shared/pw');assert.equal(saved.BROWSER_EXECUTABLE_PATH,join(root,'bin/chrome'));assert.equal(saved.UNRELATED_SECRET,undefined);
 const override=browserPaths({PUPPETEER_CACHE_DIR:'/override',PLAYWRIGHT_BROWSERS_PATH:'0'},root);assert.equal(override.PUPPETEER_CACHE_DIR,'/override');assert.equal(override.PLAYWRIGHT_BROWSERS_PATH,'0');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('installer creates only cache folders and rejects a file as cache without deleting it',()=>{
 const root=mkdtempSync(join(tmpdir(),'browser-paths-'));
 try{const env={};applyBrowserPaths(env,{root,create:true});assert.ok(existsSync(env.PUPPETEER_CACHE_DIR));const file=join(root,'not-directory');writeFileSync(file,'retain');assert.throws(()=>applyBrowserPaths({PUPPETEER_CACHE_DIR:file},{root,create:true}),/cannot be used by the installer/);assert.ok(existsSync(file));}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('post-download verification uses all four actual launch probes and reports failures',()=>{
 const calls=[],root=mkdtempSync(join(tmpdir(),'browser-paths-'));
 try{const ok=verifyInstalledBrowsers({cwd:root,env:{},run:(exe,args,options)=>{calls.push({exe,args,options});return {status:calls.length===2?1:0};}});
 assert.equal(ok,false);assert.equal(calls.length,4);
 for(const call of calls){assert.equal(call.options.env.PUPPETEER_CACHE_DIR,join(root,'data/browsers/puppeteer'));assert.equal(call.options.timeout,45000);assert.match(call.args[2],/accessSync/);assert.match(call.args[2],/Browser launch OK/);assert.match(call.args[2],/finally/);}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('real browser SDKs resolve executables inside the same assigned caches from another working directory',()=>{
 const script=`const {applyBrowserPaths}=await import(${JSON.stringify(new URL('../scripts/browser-paths.mjs',import.meta.url).href)});applyBrowserPaths();const {createRequire}=await import('node:module');const req=createRequire(${JSON.stringify(join(browserProjectRoot,'package.json'))});const pw=await import(req.resolve('playwright'));const pp=await import(req.resolve('puppeteer'));console.log(JSON.stringify({pw:pw.default.chromium.executablePath(),pp:await pp.default.executablePath()}));`;
 const env={...process.env,HOME:'/different/service/home'};for(const key of ['PLAYWRIGHT_BROWSERS_PATH','PUPPETEER_CACHE_DIR','PUPPETEER_EXECUTABLE_PATH','PUPPETEER_SKIP_DOWNLOAD'])delete env[key];
 const paths=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:tmpdir(),env,encoding:'utf8'}));
 const expected=browserPaths(env);assert.ok(paths.pw.startsWith(expected.PLAYWRIGHT_BROWSERS_PATH));assert.ok(paths.pp.startsWith(expected.PUPPETEER_CACHE_DIR));
});
