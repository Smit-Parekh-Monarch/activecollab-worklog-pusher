// Work-log folder helpers — reads the month/week/date.json tree.
// Ported from the original Express server.js (walkJson, parseHoursServer, path guard).

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const IGNORE_DIRS = new Set(['.git']);
const IGNORE_FILES = new Set();

// Worklogs live beside the Next app by default (../worklogs), so they persist
// across rebuilds and match the original layout. Override with WORKLOG_DIR.
export function worklogDir() {
  if (process.env.WORKLOG_DIR) return process.env.WORKLOG_DIR;
  const here = dirname(fileURLToPath(import.meta.url)); // next-app/lib
  return resolve(here, '..', '..', 'worklogs');
}

export function parseHoursServer(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return h + (m || 0) / 60; }
    return parseFloat(v) || 0;
  }
  return 0;
}

export async function walkJson(dir, base) {
  let out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out = out.concat(await walkJson(full, base));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.json') && !IGNORE_FILES.has(e.name)) {
      const meta: any = {
        rel: relative(base, full).replace(/\\/g, '/'),
        mtime: 0, count: 0, hours: 0, date: null, valid: false,
      };
      try { meta.mtime = (await stat(full)).mtimeMs; } catch {}
      try {
        const json = JSON.parse(await readFile(full, 'utf8'));
        const arr = Array.isArray(json) ? json : (json.tasks || []);
        meta.count = arr.length;
        meta.hours = +arr.reduce((s, t) => s + parseHoursServer(t.hours ?? t.duration ?? t.time ?? 0), 0).toFixed(2);
        meta.date = (arr[0] && (arr[0].date || arr[0].record_date)) || null;
        meta.pushed = !Array.isArray(json) && json.pushed === true;
        // one human-written line per day, used as the overtime expense summary
        meta.otDescription = (!Array.isArray(json) && typeof json.ot_description === 'string') ? json.ot_description : '';
        // overtime push history for this day (set by /api/worklog/mark-ot-pushed)
        meta.otPushed = (!Array.isArray(json) && Array.isArray(json.ot_pushed)) ? json.ot_pushed : [];
        meta.valid = true;
      } catch {}
      out.push(meta);
    }
  }
  return out;
}

// Resolve a user-supplied relative path safely inside the worklog dir.
// Returns the absolute path, or null if it would escape the dir.
export function safeWorklogPath(rel) {
  const dir = worklogDir();
  const full = resolve(dir, String(rel || ''));
  const insideRel = relative(dir, full);
  if (insideRel.startsWith('..') || insideRel.includes('..\\') || insideRel.includes('../')) return null;
  return full;
}

export { existsSync };
