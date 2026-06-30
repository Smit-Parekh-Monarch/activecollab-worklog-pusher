import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { safeWorklogPath } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// GET /api/worklog?path=june/week-4/27-6-2026.json — read one work-log file.
export async function GET(req) {
  const rel = new URL(req.url).searchParams.get('path') || '';
  const full = safeWorklogPath(rel);
  if (!full) return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  try {
    const txt = await readFile(full, 'utf8');
    return new NextResponse(txt, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({ error: 'Cannot read file: ' + e.message }, { status: 404 });
  }
}
