import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { safeWorklogPath } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// POST /api/worklog/save?path=…  body: { tasks: [...] }
// Writes the edited tasks back into the work-log JSON file, preserving the
// file's existing shape: an object keeps its other keys (e.g. `pushed`), an
// array stays an array. This is the instant-save target for the editor UI.
export async function POST(req: Request) {
  const rel = new URL(req.url).searchParams.get('path') || '';
  const full = safeWorklogPath(rel);
  if (!full) return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON body.' }, { status: 400 }); }
  const tasks = body && Array.isArray(body.tasks) ? body.tasks : null;
  if (!tasks) return NextResponse.json({ error: 'Body must be { tasks: [...] }.' }, { status: 400 });

  // sanitize each task to the known fields (don't persist UI-only props)
  const clean = tasks.map((t: any) => {
    const o: Record<string, unknown> = {
      name: String(t.name ?? ''),
      date: String(t.date ?? ''),
      hours: t.hours ?? '',
    };
    if (t.body != null && t.body !== '') o.body = String(t.body);
    if (t.summary != null && t.summary !== '') o.summary = String(t.summary);
    return o;
  });

  try {
    let json: any;
    try { json = JSON.parse(await readFile(full, 'utf8')); }
    catch { json = { tasks: [] }; } // create-shape if missing/corrupt

    if (Array.isArray(json)) {
      json = clean;                       // file was a bare array → keep array
    } else {
      json = { ...json, tasks: clean };   // object → preserve pushed/etc, swap tasks
    }
    await writeFile(full, JSON.stringify(json, null, 2), 'utf8');
    return NextResponse.json({ ok: true, saved: clean.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
