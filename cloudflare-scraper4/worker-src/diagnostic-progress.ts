/** Optional, request-local observation. UI/transport failures never change extraction. */
export type DiagnosticObserver = (event: any) => void;
export function diagnosticProgress(observer?: DiagnosticObserver) {
  const started = Date.now();
  const emit = (event: any) => { try { observer?.({ ...event, elapsedMs: Date.now() - started }); } catch { /* observation only */ } };
  return {
    begin(name: string, summary: string, details: any = {}) { emit({ name, status: 'running', summary, ...details }); },
    finish(stage: any) { emit({ ...stage, status: stage.skipped ? 'skipped' : stage.ok ? 'success' : 'error' }); }
  };
}

/** NDJSON POST stream shared by Node and Cloudflare; legacy JSON remains available. */
export function diagnosticStream(run: (observe: DiagnosticObserver) => Promise<any>): Response {
  const encoder = new TextEncoder(), started = Date.now();
  let closed = false, sequence = 0, heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: any) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify({ ...event, sequence: ++sequence, at: new Date().toISOString(), elapsedMs: Date.now() - started }) + '\n')); }
        catch { closed = true; clearInterval(heartbeat); }
      };
      send({ type: 'started', summary: 'ارتباط زنده با عیب‌یاب برقرار شد.' });
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 5000);
      void (async () => {
        try { const report = await run(event => send({ ...event, type: 'progress' })); send({ type: 'result', report }); }
        catch (error) { send({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
        finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); }
  });
  return new Response(body, { headers: {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no'
  } });
}
