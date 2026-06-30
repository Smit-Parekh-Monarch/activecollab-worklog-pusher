import { parseCookieString, csrfFromJar, acFetch, snippet, originOf } from '@/lib/ac';

export const dynamic = 'force-dynamic';

// POST /api/push — create task → log time → complete, streaming NDJSON progress.
// Body: { base, projectId, taskListId, cookie, csrf, userId, tasks: [{name,date,hours,body,summary}] }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { base, projectId, taskListId, cookie, csrf, userId, tasks } = body || {};

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      const end = () => { try { controller.close(); } catch {} };

      if (!base || !projectId || !taskListId || !cookie || !Array.isArray(tasks)) {
        send({ done: true, error: 'Missing required fields (base, projectId, taskListId, cookie, tasks).' });
        return end();
      }

      let origin;
      try { origin = originOf(base); }
      catch { send({ done: true, error: 'Invalid base URL: ' + base }); return end(); }

      const jar = parseCookieString(cookie);
      const ctx = { base, origin, projectId, fallbackCsrf: csrf };

      for (let idx = 0; idx < tasks.length; idx++) {
        const t = tasks[idx];
        try {
          // 1) create task
          send({ idx, step: 'create', status: 'start', name: t.name });
          const createBody: Record<string, unknown> = {
            task_list_id: Number(taskListId),
            name: t.name,
            assignee_id: 0,
            labels: [],
            is_hidden_from_clients: false,
            is_important: false,
          };
          if (t.body && t.body.trim()) createBody.body = t.body;
          const created = await acFetch(jar, ctx, { method: 'POST', path: `/projects/${projectId}/tasks`, body: createBody });
          const taskId = created.json?.single?.id;
          if (!created.ok || !taskId) {
            send({ idx, step: 'create', status: 'error', code: created.status, detail: snippet(created.text) });
            continue;
          }
          send({ idx, step: 'create', status: 'ok', taskId });

          // 2) log time
          send({ idx, step: 'time', status: 'start' });
          const timed = await acFetch(jar, ctx, {
            method: 'POST',
            path: `/projects/${projectId}/time-records`,
            body: {
              user_id: Number(userId) || 0,
              source: 'task_sidebar',
              record_date: t.date,
              parent_id: taskId,
              parent_type: 'Task',
              value: Number(t.hours) || 0,
              job_type_id: 1,
              billable_status: 1,
              summary: t.summary || t.name,
              task_id: taskId,
            },
          });
          if (!timed.ok) send({ idx, step: 'time', status: 'error', code: timed.status, detail: snippet(timed.text) });
          else send({ idx, step: 'time', status: 'ok', hours: Number(t.hours) || 0, date: t.date });

          // 3) complete task
          send({ idx, step: 'complete', status: 'start' });
          const done = await acFetch(jar, ctx, { method: 'PUT', path: `/complete/task/${taskId}`, body: null });
          if (!done.ok) send({ idx, step: 'complete', status: 'error', code: done.status, detail: snippet(done.text) });
          else send({ idx, step: 'complete', status: 'ok' });
        } catch (e) {
          send({ idx, step: 'fatal', status: 'error', detail: String(e && e.message ? e.message : e) });
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
