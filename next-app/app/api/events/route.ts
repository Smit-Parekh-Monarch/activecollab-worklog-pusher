import { watch } from 'fs';
import { worklogDir } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// GET /api/events — Server-Sent Events. Emits a `worklogs` event (debounced)
// whenever a .json file under the worklog dir changes, so the UI can refresh.
export async function GET() {
  const enc = new TextEncoder();
  let watcher = null;
  let timer = null;
  let ping = null;

  const stream = new ReadableStream({
    start(controller) {
      const write = (s) => { try { controller.enqueue(enc.encode(s)); } catch {} };
      write('retry: 2000\n\n');

      const fire = () => write('event: worklogs\ndata: {}\n\n');
      try {
        watcher = watch(worklogDir(), { recursive: true }, (_evt, filename) => {
          if (filename && String(filename).toLowerCase().endsWith('.json')) {
            clearTimeout(timer);
            timer = setTimeout(fire, 150);
          }
        });
      } catch {}

      ping = setInterval(() => write(': ping\n\n'), 25000);
    },
    cancel() {
      try { watcher && watcher.close(); } catch {}
      clearTimeout(timer);
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
