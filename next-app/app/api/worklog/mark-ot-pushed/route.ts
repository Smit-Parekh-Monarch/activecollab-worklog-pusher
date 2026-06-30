import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { safeWorklogPath } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// POST /api/worklog/mark-ot-pushed?path=…  body: { value, summary }
// Records that this day's overtime was pushed to ActiveCollab by appending to a
// top-level `ot_pushed` array on the work-log JSON. The /overtime page reads this
// back to mark the day as already-pushed and avoid pushing it twice.
//
//   "ot_pushed": [ { "value": "0.33", "summary": "…", "at": "2026-06-30T…Z" } ]
//
// An array (not a flag) keeps a small history if a day is ever pushed again.
export async function POST(req: Request) {
  const rel = new URL(req.url).searchParams.get('path') || '';
  const full = safeWorklogPath(rel);
  if (!full) return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const value = body && body.value != null ? String(body.value) : '';
  const summary = body && body.summary != null ? String(body.summary) : '';

  try {
    let json: any;
    try { json = JSON.parse(await readFile(full, 'utf8')); }
    catch { return NextResponse.json({ error: 'Could not read work-log file.' }, { status: 404 }); }

    if (Array.isArray(json)) json = { tasks: json }; // normalise to object shape
    if (!Array.isArray(json.ot_pushed)) json.ot_pushed = [];
    json.ot_pushed.push({ value, summary, at: new Date().toISOString() });

    await writeFile(full, JSON.stringify(json, null, 2), 'utf8');
    return NextResponse.json({ ok: true, count: json.ot_pushed.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
