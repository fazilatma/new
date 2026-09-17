type DispatcherIO = {
  processOneJob(): Promise<boolean>;
  pollMs: number;
  concurrency?(): Promise<number>;
  onError(error: unknown): void;
  schedule?(fn: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel?(timer: ReturnType<typeof setTimeout>): void;
};

/** One web-process runner for both manual wake-ups and background polling.
 * Database claims remain atomic across separate web/worker processes.
 */
function createSingleJobDispatcher(io: DispatcherIO) {
  const schedule = io.schedule || ((fn, delay) => setTimeout(fn, delay));
  const cancel = io.cancel || clearTimeout;
  const pollMs = Math.max(500, Number(io.pollMs) || 2000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, requested = false, continuous = false, stopped = false;
  let lastAttemptAt: string | null = null, lastError = false, processed = 0;

  function arm(delay: number): void {
    if (stopped || timer !== undefined) return;
    timer = schedule(() => { timer = undefined; void drain(); }, delay);
    timer?.unref?.();
  }
  async function drain(): Promise<void> {
    if (stopped || running) return;
    running = true; requested = false;
    let count = 0, failed = false;
    try {
      // Yield between batches, but don't abandon the 26th queued job.
      while (!stopped && count < 25) {
        lastAttemptAt = new Date().toISOString();
        const found = await io.processOneJob();
        lastError = false;
        if (!found) break;
        count++; processed++;
      }
    } catch (error) {
      failed = lastError = true;
      io.onError(error);
    } finally {
      running = false;
      // A wake-up arriving during an empty claim must not be lost. A failed
      // claim is retried even with RUN_WORKER_IN_WEB=false (manual fallback).
      if (failed) arm(Math.max(2000, pollMs));
      else if (requested || count === 25) arm(0);
      else if (continuous) arm(pollMs);
    }
  }
  function wake(): void {
    if (stopped) return;
    requested = true;
    if (running) return;
    // Keep error backoff; dashboard polling must not hammer a broken DB.
    if (lastError && timer !== undefined) return;
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    arm(0);
  }
  return {
    wake,
    start() { if (!stopped) { continuous = true; wake(); } },
    stop() { stopped = true; continuous = false; if (timer !== undefined) cancel(timer); timer = undefined; },
    status() { return { mode: 'node', running, scheduled: timer !== undefined, continuous, lastAttemptAt, lastError, processed }; }
  };
}

/** Database admission is authoritative across web and standalone worker processes. */
export function createJobDispatcher(io:DispatcherIO){
  if(!io.concurrency)return createSingleJobDispatcher(io);
  const lanes=Array.from({length:8},(_,index)=>createSingleJobDispatcher({...io,processOneJob:async()=>index<Math.max(1,Math.min(8,Number(await io.concurrency!())||2))?io.processOneJob():false}));
  return {wake(){lanes.forEach(l=>l.wake())},start(){lanes.forEach(l=>l.start())},stop(){lanes.forEach(l=>l.stop())},status(){const states=lanes.map(l=>l.status());return {...states[0],running:states.some(s=>s.running),scheduled:states.some(s=>s.scheduled),lastError:states.some(s=>s.lastError),processed:states.reduce((n,s)=>n+s.processed,0),activeLanes:states.filter(s=>s.running).length}}};
}
