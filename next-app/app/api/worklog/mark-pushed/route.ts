import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { safeWorklogPath } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// POST /api/worklog/mark-pushed?path=… — writes pushed:true into the JSON file.
export async function POST(req) {
  const rel = new URL(req.url).searchParams.get('path') || '';
  const full = safeWorklogPath(rel);
  if (!full) return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  try {
    const txt = await readFile(full, 'utf8');
    let json = JSON.parse(txt);
    if (Array.isArray(json)) json = { pushed: true, tasks: json };
    else json.pushed = true;
    await writeFile(full, JSON.stringify(json, null, 2), 'utf8');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
