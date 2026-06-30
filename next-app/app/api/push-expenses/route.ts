import { parseCookieString, acFetch, snippet, originOf } from '@/lib/ac';

export const dynamic = 'force-dynamic';

// POST /api/push-expenses — create one expense per row, streaming NDJSON progress.
// Body: { base, projectId, cookie, csrf, expenses: [{record_date,value,summary,category_id,user_id,task_id,source,billable_status}] }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { base, projectId, cookie, csrf, expenses } = body || {};

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      const end = () => { try { controller.close(); } catch {} };

      if (!base || !projectId || !cookie || !Array.isArray(expenses)) {
        send({ done: true, error: 'Missing required fields (base, projectId, cookie, expenses).' });
        return end();
      }

      let origin;
      try { origin = originOf(base); }
      catch { send({ done: true, error: 'Invalid base URL: ' + base }); return end(); }

      const jar = parseCookieString(cookie);
      const ctx = { base, origin, projectId, fallbackCsrf: csrf };

      for (let idx = 0; idx < expenses.length; idx++) {
        const e = expenses[idx] || {};
        try {
          send({ idx, step: 'expense', status: 'start', date: e.record_date, value: e.value });
          const payload: Record<string, unknown> = {
            value: String(e.value),
            category_id: Number(e.category_id) || 0,
            user_id: Number(e.user_id) || 0,
            record_date: e.record_date,
            billable_status: e.billable_status == null ? 1 : Number(e.billable_status),
            summary: e.summary || '',
            source: e.source || 'project_time',
          };
          if (e.task_id) payload.task_id = Number(e.task_id);
          const created = await acFetch(jar, ctx, { method: 'POST', path: `/projects/${projectId}/expenses`, body: payload });
          if (!created.ok) send({ idx, step: 'expense', status: 'error', code: created.status, detail: snippet(created.text) });
          else send({ idx, step: 'expense', status: 'ok', id: created.json?.single?.id || null, value: e.value, date: e.record_date });
        } catch (err) {
          send({ idx, step: 'fatal', status: 'error', detail: String(err && err.message ? err.message : err) });
        }
      }

      send({ done: true });
      end();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
