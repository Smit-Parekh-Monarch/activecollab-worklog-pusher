import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';
import { readdir, readFile, stat, mkdir } from 'fs/promises';
import { existsSync, watch } from 'fs';
import { networkInterfaces } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '5mb' }));
// STATIC_ROOT is set to beside the .exe when running as a built executable;
// otherwise it's the project directory (normal npm start usage).
const STATIC_ROOT = process.env.STATIC_ROOT || __dirname;
app.use(express.static(join(STATIC_ROOT, 'public')));
app.use('/figma', express.static(join(STATIC_ROOT, 'csv-figmachanegs')));

const PORT = process.env.PORT || 5050;
// Dedicated folder for work-log JSONs (month/week/date.json structure).
// Only files inside here appear in the UI dropdown.
const WORKLOG_DIR = process.env.WORKLOG_DIR || join(__dirname, 'worklogs');
const IGNORE_DIRS  = new Set(['.git']);   // nothing to hide — it's a dedicated folder
const IGNORE_FILES = new Set();

/* ---------- cookie jar helpers ---------- */
function parseCookieString(str) {
  const jar = {};
  if (!str) return jar;
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) jar[k] = v;
  }
  return jar;
}

function jarToCookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function updateJarFromSetCookie(jar, setCookies) {
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i === -1) continue;
    const k = first.slice(0, i).trim();
    const v = first.slice(i + 1).trim();
    if (k) jar[k] = v;
  }
}

// ActiveCollab uses the double-submit cookie pattern: the X-Angie-CsrfValidator
// header must equal the (URL-decoded) activecollab_csrf_validator_for_* cookie.
// Keeping it derived from the jar means it stays in sync if AC rotates the token.
function csrfFromJar(jar, fallback) {
  const key = Object.keys(jar).find(k => k.startsWith('activecollab_csrf_validator_for_'));
  if (key) {
    try { return decodeURIComponent(jar[key]); } catch { return jar[key]; }
  }
  return fallback || '';
}

/* ---------- ActiveCollab request ---------- */
async function acFetch(jar, ctx, { method, path, body }) {
  const url = ctx.base + path;
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Angie-CsrfValidator': csrfFromJar(jar, ctx.fallbackCsrf),
    'Cookie': jarToCookieHeader(jar),
    'Origin': ctx.origin,
    'Referer': `${ctx.origin}/activecollab/projects/${ctx.projectId}`,
    'User-Agent': 'Mozilla/5.0 ActiveCollabWorklogPusher',
  };

  let payload;
  if (body === null) {
    payload = '';
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  const cookieHeader = headers['Cookie'] || '';
  const cookieNames = cookieHeader.split(';').map(c => c.split('=')[0].trim()).filter(Boolean);
  console.log(`\n[AC] --> ${method} ${url}`);
  console.log(`[AC]     cookies sent (${cookieNames.length}): ${cookieNames.join(', ')}`);
  console.log(`[AC]     X-Angie-CsrfValidator: ${headers['X-Angie-CsrfValidator'] || '(none)'}`);
  if (payload) console.log(`[AC]     request body: ${payload}`);

  let res, text;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch (e) {
    console.log(`[AC]     !! network error: ${e.message}`);
    throw e;
  }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  updateJarFromSetCookie(jar, setCookies);
  text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }

  console.log(`[AC]     <-- ${res.status} ${res.statusText} (${res.ok ? 'OK' : 'FAIL'})`);
  console.log(`[AC]     content-type: ${res.headers.get('content-type') || '(none)'}`);
  if (setCookies.length) {
    const rotated = setCookies.map(c => c.split('=')[0]).join(', ');
    console.log(`[AC]     set-cookie (token rotated): ${rotated}`);
  }
  const bodyOut = text.length > 1500 ? text.slice(0, 1500) + ' …[truncated]' : text;
  console.log(`[AC]     response body: ${bodyOut || '(empty)'}`);

  return { status: res.status, ok: res.ok, json, text };
}

const snippet = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 300);

/* ---------- push endpoint (streams NDJSON progress) ---------- */
app.post('/api/push', async (req, res) => {
  const { base, projectId, taskListId, cookie, csrf, userId, tasks } = req.body || {};

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  if (!base || !projectId || !taskListId || !cookie || !Array.isArray(tasks)) {
    send({ done: true, error: 'Missing required fields (base, projectId, taskListId, cookie, tasks).' });
    return res.end();
  }

  let origin;
  try { origin = new URL(base).origin; }
  catch { send({ done: true, error: 'Invalid base URL: ' + base }); return res.end(); }

  const jar = parseCookieString(cookie);
  const ctx = { base, origin, projectId, fallbackCsrf: csrf };

  const jarNames = Object.keys(jar);
  const csrfCookie = jarNames.find(k => k.startsWith('activecollab_csrf_validator_for_'));
  console.log('\n========================================================');
  console.log(`[PUSH] base=${base}  project=${projectId}  taskList=${taskListId}  user=${userId}`);
  console.log(`[PUSH] tasks=${tasks.length}  cookies parsed (${jarNames.length}): ${jarNames.join(', ')}`);
  console.log(`[PUSH] csrf cookie present: ${csrfCookie ? 'yes' : 'NO — auth will likely fail'}`);
  console.log(`[PUSH] csrf header to send: ${csrfFromJar(jar, csrf) || '(none)'}`);
  console.log('========================================================');

  for (let idx = 0; idx < tasks.length; idx++) {
    const t = tasks[idx];
    console.log(`\n[TASK ${idx + 1}/${tasks.length}] "${t.name}"  date=${t.date}  hours=${t.hours}`);
    try {
      // 1) create task
      send({ idx, step: 'create', status: 'start', name: t.name });
      const createBody = {
        task_list_id: Number(taskListId),
        name: t.name,
        assignee_id: 0,
        labels: [],
        is_hidden_from_clients: false,
        is_important: false,
      };
      if (t.body && t.body.trim()) createBody.body = t.body; // only send body when non-empty (matches known-good payload)
      const created = await acFetch(jar, ctx, {
        method: 'POST',
        path: `/projects/${projectId}/tasks`,
        body: createBody,
      });
      const taskId = created.json?.single?.id;
      if (!created.ok || !taskId) {
        send({ idx, step: 'create', status: 'error', code: created.status, detail: snippet(created.text) });
        continue; // can't log/complete without a task id
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
  res.end();
});

/* ---------- work-log folder browsing ---------- */
function parseHoursServer(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return h + (m || 0) / 60; }
    return parseFloat(v) || 0;
  }
  return 0;
}

async function walkJson(dir, base) {
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
      const meta = {
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
        meta.valid = true;
      } catch {}
      out.push(meta);
    }
  }
  return out;
}

// list all *.json under WORKLOG_DIR (e.g. june/week-1/1-6-2026.json)
app.get('/api/worklogs', async (req, res) => {
  if (!existsSync(WORKLOG_DIR)) {
    try { await mkdir(WORKLOG_DIR, { recursive: true }); } catch {}
  }
  const files = await walkJson(WORKLOG_DIR, WORKLOG_DIR);
  files.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel)); // newest first
  res.json({ dir: WORKLOG_DIR, files });
});

// read one work-log file by its relative path (path-traversal guarded)
app.get('/api/worklog', async (req, res) => {
  const rel = String(req.query.path || '');
  const full = resolve(WORKLOG_DIR, rel);
  const insideRel = relative(WORKLOG_DIR, full);
  if (insideRel.startsWith('..') || insideRel.includes('..' + '\\') || insideRel.includes('../')) {
    return res.status(400).json({ error: 'Invalid path.' });
  }
  try {
    const txt = await readFile(full, 'utf8');
    res.type('application/json').send(txt);
  } catch (e) {
    res.status(404).json({ error: 'Cannot read file: ' + e.message });
  }
});

/* ---------- live updates via Server-Sent Events ---------- */
const sseClients = new Set();
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});
function broadcast(event) {
  for (const res of sseClients) { try { res.write('event: ' + event + '\ndata: {}\n\n'); } catch {} }
}

// watch the project folder and push live events (debounced)
let watchTimer = null;
const pending = new Set();
function schedule(type) {
  pending.add(type);
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => { for (const t of pending) broadcast(t); pending.clear(); }, 150);
}
try {
  watch(__dirname, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    const f = String(filename).replace(/\\/g, '/');
    if (/(^|\/)(node_modules|\.git|\.claude|\.playwright-mcp)\//.test(f)) return;
    const low = f.toLowerCase();
    if (low.startsWith('public/') || low.startsWith('csv-figmachanegs/')) {
      if (/\.(html|css|js)$/.test(low)) schedule('reload');      // code/asset changed → reload browser
      else if (low.endsWith('.csv')) schedule('csv');            // figma CSV changed → refresh viewer
    } else if (low.endsWith('.json')) {
      schedule('worklogs');                                       // a work-log file changed → refresh list
    } else if (low.endsWith('.csv')) {
      schedule('csv');
    }
  });
  console.log('  Live updates: on (file watcher active)');
} catch (e) {
  console.log('  Live updates: off (' + e.message + ')');
}

app.listen(PORT, '0.0.0.0', () => {
  // find LAN IP so we can print the shareable address
  let lanIP = 'your-machine-ip';
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list) {
        if (n.family === 'IPv4' && !n.internal) { lanIP = n.address; break; }
      }
      if (lanIP !== 'your-machine-ip') break;
    }
  } catch {}
  console.log(`\n  ┌─────────────────────────────────────────────────────┐`);
  console.log(`  │  Work-log Pusher                                     │`);
  console.log(`  │                                                      │`);
  console.log(`  │  Local  →  http://localhost:${PORT}                  │`);
  console.log(`  │  Share  →  http://${lanIP}:${PORT}          │`);
  console.log(`  │  Figma  →  http://${lanIP}:${PORT}/figma    │`);
  console.log(`  └─────────────────────────────────────────────────────┘\n`);
});
