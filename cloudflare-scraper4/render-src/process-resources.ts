import {randomUUID} from 'node:crypto';
const instanceId=randomUUID();
/** Self-reported Node process only: works without Android /proc permissions. */
export function processResources(){
 const cpu=process.cpuUsage(),memory=process.memoryUsage();
 return {scope:'scraper-node-process',instanceId,pid:process.pid,uptimeMs:process.uptime()*1000,cpuMicros:cpu.user+cpu.system,rss:memory.rss,heapUsed:memory.heapUsed};
}
