import { NextResponse } from 'next/server';
import { parseCookieString, acFetch, originOf } from '@/lib/ac';

export const dynamic = 'force-dynamic';

// POST /api/tasks — proxy ActiveCollab's GET /projects/:id/tasks using the pasted
// session, and optionally resolve a single task id for the overtime push.
//
// Body: { base, projectId, cookie, csrf, match? }
//   match: { date?: "YYYY-MM-DD", name?: "substring" }  (optional)
//
// Returns: { tasks: [{ id, name, task_number, task_list_id }], resolved?: {id,name} }
// Resolution order when `match` is given:
//   1. a task whose name contains the date in d/m/yyyy or yyyy-mm-dd form
//   2. a task whose name contains match.name (case-insensitive)
//   3. the most recently updated open task (fallback)
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { base, projectId, cookie, csrf, match } = body || {};
  if (!base || !projectId || !cookie) {
    return NextResponse.json({ error: 'Missing base, projectId or cookie.' }, { status: 400 });
  }

  let origin;
  try { origin = originOf(base); }
  catch { return NextResponse.json({ error: 'Invalid base URL: ' + base }, { status: 400 }); }

  const jar = parseCookieString(cookie);
  const ctx = { base, origin, projectId, fallbackCsrf: csrf };

  let res;
  try {
    res = await acFetch(jar, ctx, { method: 'GET', path: `/projects/${projectId}/tasks` });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach ActiveCollab at ${base} — ${e?.message || e}. Is the host reachable from this machine?` },
      { status: 502 }
    );
  }
  if (!res.ok || !res.json) {
    return NextResponse.json({ error: 'ActiveCollab rejected the request — re-capture a fresh session.', code: res.status }, { status: 502 });
  }

  const raw = Array.isArray(res.json.tasks) ? res.json.tasks : [];
  const tasks = raw.map((t) => ({
    id: t.id,
    name: t.name,
    task_number: t.task_number,
    task_list_id: t.task_list_id,
    updated_on: t.updated_on || 0,
    is_completed: !!t.is_completed,
  }));

  let resolved = null;
  if (match && (match.date || match.name)) {
    resolved = resolveTask(tasks, match);
  }

  return NextResponse.json({ tasks, resolved });
}

function resolveTask(tasks, match) {
  // 1) date-in-name (supports "27/06/2026", "27-6-2026", "2026-06-27")
  if (match.date && /^\d{4}-\d{2}-\d{2}/.test(match.date)) {
    const [y, m, d] = match.date.slice(0, 10).split('-');
    const dn = +d, mn = +m;
    const variants = [
      `${dn}/${mn}/${y}`, `${d}/${m}/${y}`,
      `${dn}-${mn}-${y}`, `${d}-${m}-${y}`,
      `${y}-${m}-${d}`,
    ];
    const hit = tasks.find((t) => variants.some((v) => (t.name || '').includes(v)));
    if (hit) return { id: hit.id, name: hit.name, why: 'date-in-name' };
  }
  // 2) name substring
  if (match.name) {
    const needle = match.name.toLowerCase();
    const hit = tasks.find((t) => (t.name || '').toLowerCase().includes(needle));
    if (hit) return { id: hit.id, name: hit.name, why: 'name-match' };
  }
  // 3) most-recently-updated open task
  const open = tasks.filter((t) => !t.is_completed).sort((a, b) => b.updated_on - a.updated_on);
  if (open.length) return { id: open[0].id, name: open[0].name, why: 'latest-open' };
  return null;
}
