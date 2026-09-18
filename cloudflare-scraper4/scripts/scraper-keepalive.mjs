/** Restart policy only; process ownership and port safety stay in the deployer. */
export function createScraperKeepalive(io,{enabled=true,baseMs=5000,maxMs=60000,graceMs=300000,missLimit=6}={}){
 const now=io.now||Date.now,set=io.setTimer||setTimeout,clear=io.clearTimer||clearTimeout;
 let desired=false,closed=false,timer=null,busy=false,failures=0,misses=0,startedAt=0,nextRestartAt=null,restarts=0,lastReason='Not started',epoch=0;
 const status=()=>({enabled,desired:desired&&!closed,restarts,failures,misses,nextRestartAt,lastReason});
 const cancel=()=>{if(timer!==null)clear(timer);timer=null;nextRestartAt=null;};
 function schedule(reason){
  if(!enabled||!desired||closed||timer!==null)return;
  lastReason=reason;const delay=Math.min(maxMs,baseMs*2**Math.min(failures++,10));nextRestartAt=now()+delay;
  io.log?.('Keepalive: '+reason+'; retry in '+Math.ceil(delay/1000)+'s');
  timer=set(async()=>{timer=null;nextRestartAt=null;if(!desired||closed)return;const version=epoch;
   try{restarts++;await io.restart();}catch{if(epoch===version)schedule('Restart failed');}
  },delay);timer?.unref?.();
 }
 return {
  status,
  enable(){if(closed)return;epoch++;desired=true;cancel();failures=0;misses=0;lastReason='Start requested';},
  started(){startedAt=now();misses=0;lastReason='Running / starting';},
  exited(reason){if(now()-startedAt>=60000)failures=0;schedule(reason);},
  stop(){epoch++;desired=false;cancel();misses=0;lastReason='Stopped intentionally';},
  close(){this.stop();closed=true;},
  async check(){
   if(!enabled||!desired||closed||busy||timer!==null||now()-startedAt<graceMs)return;
   busy=true;const version=epoch;
   try{const alive=await io.probe();if(version!==epoch||!desired||closed)return;if(alive){misses=0;failures=0;}else if(++misses>=missLimit){misses=0;schedule('Scraper did not respond to repeated probes');}}
   catch{if(version===epoch&&desired&&!closed&&++misses>=missLimit){misses=0;schedule('Scraper probe repeatedly failed');}}
   finally{busy=false;}
  }
 };
}
