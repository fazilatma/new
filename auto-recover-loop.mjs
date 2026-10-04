#!/usr/bin/env node
// Auto recover loop for sabashopping.ir 503
// Checks /app/api/version every 30s, if 503 then calls hostconsole public endpoints with password KhTn2268
const PASSWORD = 'KhTn2268';
const APP_URL = 'https://sabashopping.ir/app/api/version';
const HOSTCONSOLE_BASE = 'https://sabashopping.ir/project/hostconsole.php';

async function fetchText(url, opts={}) {
  try {
    const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'Scraper4-AutoRecover/1.0', ...(opts.headers||{}) } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: String(e) };
  }
}

async function checkApp() {
  const r = await fetchText(APP_URL);
  const is503 = r.text.includes('503') || r.text.includes('Service Unavailable') || r.status === 503 || r.text.includes('temporarily busy');
  const versionMatch = r.text.match(/"version"\s*:\s*"([^"]+)"/);
  const version = versionMatch ? versionMatch[1] : '';
  console.log(`[${new Date().toISOString()}] App check: status=${r.status} version=${version} 503=${is503} len=${r.text.length}`);
  return { is503, version, text: r.text };
}

async function callHostconsole(api, extra='') {
  const url = `${HOSTCONSOLE_BASE}?api=${api}&password=${PASSWORD}${extra}`;
  console.log(`Calling ${api}...`);
  const r = await fetchText(url);
  console.log(`${api} response: ${r.text.slice(0,2000)}`);
  return r;
}

async function recover() {
  console.log('=== Starting auto recover ===');
  // Try to update hostconsole first via recover-safe.php if exists
  const branches = ['arena/hostconsole-v8', 'arena/hostconsole-v7', 'arena/hostconsole-v6', 'arena/01a0aa17-new'];
  for (const br of branches) {
    const r = await fetchText(`https://sabashopping.ir/project/recover-safe.php?password=${PASSWORD}&branch=${br}`);
    if (r.text.includes('Recovered')) {
      console.log(`Recover-safe success with ${br}: ${r.text.slice(0,500)}`);
      break;
    }
  }
  // Try public endpoints
  await callHostconsole('public.self_update', `&branch=arena/01a0aa17-new`);
  await new Promise(r=>setTimeout(r, 5000));
  await callHostconsole('public.stop_jobs');
  await new Promise(r=>setTimeout(r, 3000));
  await callHostconsole('public.auto_recover', `&branch=arena/01a0aa17-new`);
  console.log('=== Recover calls done, waiting 15s ===');
  await new Promise(r=>setTimeout(r, 15000));
  const check = await checkApp();
  if (!check.is503) {
    console.log(`Recover SUCCESS: version ${check.version}`);
  } else {
    console.log('Recover still 503, will retry next loop');
  }
}

async function loop() {
  while (true) {
    const { is503 } = await checkApp();
    if (is503) {
      await recover();
    }
    await new Promise(r=>setTimeout(r, 30000));
  }
}

loop();
