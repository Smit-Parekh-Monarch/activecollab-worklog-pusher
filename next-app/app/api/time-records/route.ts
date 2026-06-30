import { NextResponse } from 'next/server';
import { parseCookieString, acFetch, originOf } from '@/lib/ac';

export const dynamic = 'force-dynamic';

// POST /api/time-records — real logged time from ActiveCollab for a date range.
// Body: { base, userId, cookie, csrf, from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
//
// Proxies AC's GET /users/:id/time-records/filtered-by-date?from=&to= and returns:
//   { days:   [{ date: "YYYY-MM-DD", hours }],            // summed per day
//     byTask: [{ taskId, name, hours }],                  // summed per task (desc)
//     topTask:{ taskId, name, hours } | null,             // biggest task by hours
//     total }                                              // total hours in range
//
// record_date comes back as epoch seconds; we convert to a UTC YYYY-MM-DD so it
// lines up with the overtime weekend logic (which UTC-parses dates).
function epochToISO(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { base, userId, cookie, csrf, from, to } = body || {};
  if (!base || !userId || !cookie || !from || !to) {
    return NextResponse.json({ error: 'Missing base, userId, cookie, from or to.' }, { status: 400 });
  }

  let origin;
  try { origin = originOf(base); }
  catch { return NextResponse.json({ error: 'Invalid base URL: ' + base }, { status: 400 }); }

  const jar = parseCookieString(cookie);
  const ctx = { base, origin, projectId: '', fallbackCsrf: csrf };
  const path = `/users/${userId}/time-records/filtered-by-date?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  let res;
  try {
    res = await acFetch(jar, ctx, { method: 'GET', path });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach ActiveCollab at ${base} — ${e?.message || e}.` },
      { status: 502 }
    );
  }
  if (!res.ok || !res.json) {
    return NextResponse.json({ error: 'ActiveCollab rejected the request — re-capture a fresh session.', code: res.status }, { status: 502 });
  }

  const recs = Array.isArray(res.json.time_records) ? res.json.time_records : [];
  const taskNames: Record<string, string> = {};
  const relTask = res.json.related && res.json.related.Task ? res.json.related.Task : {};
  for (const k of Object.keys(relTask)) taskNames[k] = relTask[k]?.name || '';

  const dayMap: Record<string, number> = {};
  const taskMap: Record<string, number> = {};
  // per-day per-task hours, to find each day's dominant task
  const dayTaskMap: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const r of recs) {
    const v = Number(r.value) || 0;
    total += v;
    const date = typeof r.record_date === 'number' ? epochToISO(r.record_date)
      : String(r.record_date || '').slice(0, 10);
    if (date) dayMap[date] = (dayMap[date] || 0) + v;
    if (r.parent_type === 'Task' && r.parent_id) {
      const id = String(r.parent_id);
      taskMap[id] = (taskMap[id] || 0) + v;
      if (date) {
        (dayTaskMap[date] = dayTaskMap[date] || {})[id] = (dayTaskMap[date][id] || 0) + v;
      }
    }
  }

  // for each day, the task with the most hours that day → { taskId, name, hours }
  const dayTasks: Record<string, { taskId: string; name: string; hours: number }> = {};
  for (const [date, tmap] of Object.entries(dayTaskMap)) {
    let best: { taskId: string; hours: number } | null = null;
    for (const [id, h] of Object.entries(tmap)) {
      if (!best || h > best.hours) best = { taskId: id, hours: h };
    }
    if (best) dayTasks[date] = { taskId: best.taskId, name: taskNames[best.taskId] || `#${best.taskId}`, hours: +best.hours.toFixed(2) };
  }

  const days = Object.entries(dayMap)
    .map(([date, hours]) => ({ date, hours: +hours.toFixed(2) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byTask = Object.entries(taskMap)
    .map(([taskId, hours]) => ({ taskId, name: taskNames[taskId] || `#${taskId}`, hours: +hours.toFixed(2) }))
    .sort((a, b) => b.hours - a.hours);

  const topTask = byTask.length ? byTask[0] : null;

  return NextResponse.json({ days, byTask, topTask, dayTasks, total: +total.toFixed(2) });
}
