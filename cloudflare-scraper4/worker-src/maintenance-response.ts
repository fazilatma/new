/** Opt-in live transport; existing integrations retain their JSON response. */
export async function maintenanceResponse(c:any,work:()=>Promise<unknown>):Promise<Response>{
 if(c.req.query('live')!=='1')return c.json(await work());
 const encoder=new TextEncoder();let closed=false,timer:ReturnType<typeof setInterval>|undefined;
 const body=new ReadableStream<Uint8Array>({start(controller){
  const send=(event:unknown)=>{if(!closed)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'))};
  send({type:'started'});timer=setInterval(()=>send({type:'heartbeat'}),10000);
  const run=async()=>{try{send({type:'result',data:await work()})}catch(error){send({type:'error',error:error instanceof Error?error.message:String(error)})}finally{clearInterval(timer);if(!closed){closed=true;controller.close()}}};
  const task=run();try{c.executionCtx.waitUntil(task)}catch{void task}
 },cancel(){closed=true;clearInterval(timer)}});
 return new Response(body,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no'}});
}
