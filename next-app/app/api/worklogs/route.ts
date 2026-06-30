import { NextResponse } from 'next/server';
import { mkdir } from 'fs/promises';
import { walkJson, worklogDir, existsSync } from '@/lib/worklogs';

export const dynamic = 'force-dynamic';

// GET /api/worklogs — list every *.json under the worklog dir (newest date first).
export async function GET() {
  const dir = worklogDir();
  if (!existsSync(dir)) {
    try { await mkdir(dir, { recursive: true }); } catch {}
  }
  const files = await walkJson(dir, dir);
  files.sort((a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da && db && da !== db) return da > db ? -1 : 1;
    return b.mtime - a.mtime || a.rel.localeCompare(b.rel);
  });
  return NextResponse.json({ dir, files });
}
