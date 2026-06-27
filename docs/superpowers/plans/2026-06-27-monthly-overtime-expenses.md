# Monthly Overtime → Expenses Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/overtime` page that reads existing daily worklogs, computes monthly overtime beyond an 8-hour day (with a 30-minute carry-forward accumulator), and pushes each overtime day to ActiveCollab as an expense.

**Architecture:** Pure overtime math lives in a standalone ESM module (`public/overtime-core.js`) imported by both a Node test and the browser page. The page (`public/overtime.html`) is vanilla JS (a module script) — no React/Babel — to keep the math testable and the page self-contained. The server gets two additive changes: a `/overtime` route that serves the page, and a `/api/push-expenses` NDJSON route that reuses the existing cookie-jar/CSRF `acFetch` helper. The existing `/api/push` flow and all current pages are untouched.

**Tech Stack:** Node 24 (built-in `node --test` runner, no new deps), Express 4, vanilla ES modules in the browser.

## Global Constraints

- Standard workday = `8` hours; overtime release threshold = `0.5` hours (30 min) — exact values, defined once in `overtime-core.js`.
- Hours parse as **true decimal**: `"8:55"` → `8.92` (`h + m/60`, rounded to 2 decimals). Matches existing `parseHoursServer` in `server.js`.
- Overtime `value` pushed to ActiveCollab = the released overtime in decimal hours, formatted to 2 decimals as a string (e.g. `"0.60"`).
- Expense POST target: `POST /projects/{projectId}/expenses`. Required body fields: `value`, `category_id`, `user_id`, `record_date`, `billable_status`, `summary`, `task_id`, `source`.
- Do not modify the existing `/api/push` route or `public/index.html` behavior. Additive changes only.
- No new npm dependencies.

---

### Task 1: Overtime core math module + tests

**Files:**
- Create: `public/overtime-core.js`
- Test: `test/overtime-core.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STANDARD_DAY = 8`, `MIN_RELEASE = 0.5` (exported constants)
  - `parseHoursDecimal(v: string|number): number` — `"8:55"`→`8.92`, `"3.5"`→`3.5`, `3.5`→`3.5`
  - `isoDateFromFile(file: {date?:string, rel?:string}): string|null` — returns `YYYY-MM-DD` from `file.date`, else parses a `d-m-yyyy.json` basename out of `rel`
  - `monthKeyOf(file): string|null` — `YYYY-MM` from the file's ISO date
  - `groupByMonth(files: object[]): Map<string, object[]>` — keyed by `YYYY-MM`, insertion order = descending month
  - `computeMonthlyOvertime(days: {date:string, rel?:string, hours:number}[], opts?): { rows: {date,rel,hours,deviation,carryAfter,pushedOT}[], net:number, totalPushed:number, remainder:number }`

- [ ] **Step 1: Write the failing tests**

```js
// test/overtime-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHoursDecimal, isoDateFromFile, monthKeyOf, groupByMonth,
  computeMonthlyOvertime, STANDARD_DAY, MIN_RELEASE,
} from '../public/overtime-core.js';

test('constants', () => {
  assert.equal(STANDARD_DAY, 8);
  assert.equal(MIN_RELEASE, 0.5);
});

test('parseHoursDecimal', () => {
  assert.equal(parseHoursDecimal('8:55'), 8.92);
  assert.equal(parseHoursDecimal('3:30'), 3.5);
  assert.equal(parseHoursDecimal('3.5'), 3.5);
  assert.equal(parseHoursDecimal(2), 2);
  assert.equal(parseHoursDecimal(''), 0);
});

test('isoDateFromFile prefers date, falls back to rel basename', () => {
  assert.equal(isoDateFromFile({ date: '2026-06-18' }), '2026-06-18');
  assert.equal(isoDateFromFile({ rel: 'june/week-1/1-6-2026.json' }), '2026-06-01');
  assert.equal(isoDateFromFile({ rel: 'x/25-6-2026.json' }), '2026-06-25');
  assert.equal(isoDateFromFile({ rel: 'nope.json' }), null);
});

test('monthKeyOf and groupByMonth (descending)', () => {
  assert.equal(monthKeyOf({ date: '2026-06-18' }), '2026-06');
  const files = [
    { date: '2026-05-02' }, { date: '2026-06-18' }, { date: '2026-06-01' },
  ];
  const g = groupByMonth(files);
  assert.deepEqual([...g.keys()], ['2026-06', '2026-05']);
  assert.equal(g.get('2026-06').length, 2);
});

test('computeMonthlyOvertime: accumulation releases at 30 min', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.2 },
    { date: '2026-06-02', hours: 8.2 },
    { date: '2026-06-03', hours: 8.2 },
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0, 0.6]);
  assert.deepEqual(r.rows.map(x => x.carryAfter), [0.2, 0.4, 0]);
  assert.equal(r.net, 0.6);
  assert.equal(r.totalPushed, 0.6);
  assert.equal(r.remainder, 0);
});

test('computeMonthlyOvertime: short day shown not pushed; big day releases', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.2 },
    { date: '2026-06-02', hours: 5 },
    { date: '2026-06-03', hours: 10.9 },
  ]);
  assert.deepEqual(r.rows.map(x => x.deviation), [0.2, -3, 2.9]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0, 3.1]);
  assert.equal(r.net, 0.1);
  assert.equal(r.totalPushed, 3.1);
});

test('computeMonthlyOvertime: leftover under 30 min is remainder, not pushed', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.1 },
    { date: '2026-06-02', hours: 8.1 },
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0]);
  assert.equal(r.totalPushed, 0);
  assert.equal(r.remainder, 0.2);
});

test('computeMonthlyOvertime: exactly 8h is neutral; sorts by date', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-02', hours: 9 },
    { date: '2026-06-01', hours: 8 },
  ]);
  assert.deepEqual(r.rows.map(x => x.date), ['2026-06-01', '2026-06-02']);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 1]);
  assert.equal(r.remainder, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/overtime-core.test.js`
Expected: FAIL — `Cannot find module '../public/overtime-core.js'`.

- [ ] **Step 3: Write the implementation**

```js
// public/overtime-core.js
// Pure overtime math, shared by the browser page and the Node test.
export const STANDARD_DAY = 8;   // hours in a normal workday
export const MIN_RELEASE = 0.5;  // overtime is only "released" once carry >= 30 min

const r2 = (n) => +(+n).toFixed(2);

// "8:55" -> 8.92 (true decimal); decimals / numbers pass through.
export function parseHoursDecimal(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return r2(h + (m || 0) / 60); }
    return parseFloat(v) || 0;
  }
  return 0;
}

// ISO date for a worklog file: prefer its `date`, else parse a `d-m-yyyy` basename.
export function isoDateFromFile(file) {
  if (file && file.date && /^\d{4}-\d{2}-\d{2}/.test(file.date)) return file.date.slice(0, 10);
  const rel = (file && file.rel) || '';
  const base = rel.split('/').pop() || '';
  const m = base.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\.json$/i);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function monthKeyOf(file) {
  const iso = isoDateFromFile(file);
  return iso ? iso.slice(0, 7) : null;
}

// Map of YYYY-MM -> files[], months in descending (newest-first) order.
export function groupByMonth(files) {
  const byMonth = new Map();
  for (const f of files) {
    const k = monthKeyOf(f);
    if (!k) continue;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(f);
  }
  return new Map([...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

// days: [{ date, rel?, hours(decimal) }]. Chronological carry accumulator.
export function computeMonthlyOvertime(days, opts = {}) {
  const standardDay = opts.standardDay ?? STANDARD_DAY;
  const minRelease = opts.minRelease ?? MIN_RELEASE;
  const sorted = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let carry = 0, net = 0, totalPushed = 0;
  const rows = sorted.map((d) => {
    const hours = r2(d.hours);
    const deviation = r2(hours - standardDay);
    net = r2(net + deviation);
    carry = r2(carry + Math.max(0, deviation)); // only positive OT accumulates
    let pushedOT = 0;
    if (carry >= minRelease - 1e-9) { pushedOT = carry; carry = 0; }
    totalPushed = r2(totalPushed + pushedOT);
    return { date: d.date, rel: d.rel, hours, deviation, carryAfter: carry, pushedOT };
  });
  return { rows, net: r2(net), totalPushed: r2(totalPushed), remainder: r2(carry) };
}
```

- [ ] **Step 4: Add the test script to package.json**

In `package.json` `"scripts"`, add:

```json
    "test": "node --test test/",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/overtime-core.test.js`
Expected: PASS — all tests green (`# pass 8`).

- [ ] **Step 6: Commit**

```bash
git add public/overtime-core.js test/overtime-core.test.js package.json
git commit -m "feat: add overtime-core math module with tests"
```

---

### Task 2: `/api/push-expenses` server route

**Files:**
- Modify: `server.js` (add new route after the existing `/api/push` handler, ~line 210; add `/overtime` static route near the other `app.use('/standup', ...)` mount ~line 16)

**Interfaces:**
- Consumes: existing `parseCookieString`, `csrfFromJar`, `acFetch`, `snippet` helpers in `server.js`.
- Produces: `POST /api/push-expenses` (NDJSON stream) and `GET /overtime` (serves `public/overtime.html`).

- [ ] **Step 1: Add the `/overtime` page route**

In `server.js`, right after the existing static mounts (after `app.use('/standup', ...)` near line 16), add:

```js
// Overtime → Expenses page (vanilla JS; served at a clean URL)
app.get('/overtime', (_req, res) => res.sendFile(join(STATIC_ROOT, 'public', 'overtime.html')));
```

- [ ] **Step 2: Add the `/api/push-expenses` route**

In `server.js`, immediately after the `app.post('/api/push', ...)` handler ends (after its `res.end();` and closing `});`, ~line 210), add:

```js
/* ---------- push expenses endpoint (streams NDJSON progress) ---------- */
app.post('/api/push-expenses', async (req, res) => {
  const { base, projectId, cookie, csrf, expenses } = req.body || {};

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  if (!base || !projectId || !cookie || !Array.isArray(expenses)) {
    send({ done: true, error: 'Missing required fields (base, projectId, cookie, expenses).' });
    return res.end();
  }

  let origin;
  try { origin = new URL(base).origin; }
  catch { send({ done: true, error: 'Invalid base URL: ' + base }); return res.end(); }

  const jar = parseCookieString(cookie);
  const ctx = { base, origin, projectId, fallbackCsrf: csrf };

  console.log('\n========================================================');
  console.log(`[EXPENSES] base=${base}  project=${projectId}  count=${expenses.length}`);
  console.log('========================================================');

  for (let idx = 0; idx < expenses.length; idx++) {
    const e = expenses[idx] || {};
    console.log(`\n[EXPENSE ${idx + 1}/${expenses.length}] date=${e.record_date} value=${e.value}`);
    try {
      send({ idx, step: 'expense', status: 'start', date: e.record_date, value: e.value });
      const body = {
        value: String(e.value),
        category_id: Number(e.category_id) || 0,
        user_id: Number(e.user_id) || 0,
        record_date: e.record_date,
        billable_status: e.billable_status == null ? 1 : Number(e.billable_status),
        summary: e.summary || '',
        source: e.source || 'project_time',
      };
      if (e.task_id) body.task_id = Number(e.task_id);
      const created = await acFetch(jar, ctx, {
        method: 'POST',
        path: `/projects/${projectId}/expenses`,
        body,
      });
      if (!created.ok) send({ idx, step: 'expense', status: 'error', code: created.status, detail: snippet(created.text) });
      else send({ idx, step: 'expense', status: 'ok', id: created.json?.single?.id || null, value: e.value, date: e.record_date });
    } catch (err) {
      send({ idx, step: 'fatal', status: 'error', detail: String(err && err.message ? err.message : err) });
    }
  }

  send({ done: true });
  res.end();
});
```

- [ ] **Step 3: Verify the server boots and the route exists**

Run: `node -e "require('child_process')" ` is not needed. Instead start the server briefly:

Run: `node server.js &` then `sleep 1` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/overtime` then kill the server.
Expected: `200` (the page route resolves; the file is added in Task 3, so until then expect `404` — acceptable for this step). Then:

Run: `curl -s -X POST http://localhost:5050/api/push-expenses -H "Content-Type: application/json" -d "{}"`
Expected: `{"done":true,"error":"Missing required fields (base, projectId, cookie, expenses)."}`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add /api/push-expenses route and /overtime page route"
```

---

### Task 3: `public/overtime.html` page

**Files:**
- Create: `public/overtime.html`

**Interfaces:**
- Consumes: `computeMonthlyOvertime`, `groupByMonth`, `isoDateFromFile`, `STANDARD_DAY` from `./overtime-core.js`; `GET /api/worklogs`; `POST /api/push-expenses`; existing `styles.css`.
- Produces: nothing (leaf UI).

- [ ] **Step 1: Create the page**

```html
<!-- public/overtime.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Overtime → Expenses · Monarch</title>
<link rel="stylesheet" href="styles.css" />
<style>
  body.ot { max-width: 1000px; margin: 0 auto; padding: 24px; }
  .ot h1 { margin: 0 0 4px; }
  .ot .sub { color: #888; margin: 0 0 20px; }
  .ot .card { border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .ot label { display: block; font-size: 12px; color: #aaa; margin-bottom: 4px; }
  .ot textarea, .ot input, .ot select { width: 100%; box-sizing: border-box; padding: 8px;
    background: #111; color: #eee; border: 1px solid #333; border-radius: 6px; font: inherit; }
  .ot .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .ot table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .ot th, .ot td { padding: 6px 8px; border-bottom: 1px solid #222; text-align: right; font-variant-numeric: tabular-nums; }
  .ot th:first-child, .ot td:first-child { text-align: left; }
  .ot tr.short td { color: #c97; }
  .ot tr.push td { color: #7c7; }
  .ot .summary { display: flex; gap: 24px; margin: 12px 0; font-size: 15px; }
  .ot button { padding: 10px 18px; border-radius: 8px; border: 0; background: #3a6df0; color: #fff;
    font: inherit; cursor: pointer; }
  .ot button:disabled { opacity: .5; cursor: not-allowed; }
  .ot .status { font-size: 12px; }
  .ot .status.ok { color: #7c7; } .ot .status.err { color: #f77; }
  .ot .editot { width: 70px; text-align: right; }
  .ot .wrap { overflow-x: auto; }
  .ot a.back { color: #6af; font-size: 13px; }
</style>
</head>
<body class="ot">
<a class="back" href="/">← Work-log Pusher</a>
<h1>Overtime → Expenses</h1>
<p class="sub">Monthly overtime beyond an 8-hour day. Small overtime carries forward until it reaches 30 minutes, then it's pushed as an expense for that day.</p>

<div class="card">
  <label>Paste a cURL from an ActiveCollab <b>expense</b> request (Network tab → Copy as cURL)</label>
  <textarea id="curl" rows="4" placeholder="curl 'http://…/projects/6070/expenses' -H 'X-Angie-CsrfValidator: …' -b '…' --data-raw '{&quot;category_id&quot;:2,&quot;user_id&quot;:748,&quot;task_id&quot;:…}'"></textarea>
  <div class="grid" style="margin-top:10px">
    <div><label>Base URL</label><input id="base" /></div>
    <div><label>Project ID</label><input id="projectId" /></div>
    <div><label>Category ID</label><input id="categoryId" /></div>
    <div><label>User ID</label><input id="userId" /></div>
    <div><label>Task ID</label><input id="taskId" /></div>
    <div><label>Source</label><input id="source" value="project_time" /></div>
    <div><label>Billable (0/1)</label><input id="billable" value="1" /></div>
  </div>
  <p id="auth" class="status"></p>
</div>

<div class="card">
  <div class="grid">
    <div><label>Month</label><select id="month"></select></div>
    <div><label>Standard day (h)</label><input id="standard" value="8" /></div>
  </div>
  <div class="wrap">
    <table id="tbl">
      <thead><tr><th>Date</th><th>Hours</th><th>Deviation</th><th>Carry</th><th>Push OT (h)</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <div class="summary">
    <div>Net month: <b id="net">0</b> h</div>
    <div>To push: <b id="topush">0</b> h</div>
    <div>Carry left: <b id="remainder">0</b> h</div>
  </div>
  <button id="push" disabled>Push overtime as expenses</button>
</div>

<script type="module">
import { computeMonthlyOvertime, groupByMonth, isoDateFromFile, parseHoursDecimal } from './overtime-core.js';

const $ = (id) => document.getElementById(id);
const LS = 'ac_overtime_v1';
let files = [];           // /api/worklogs metas
let current = { rows: [] };

function loadLS() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function saveLS() {
  const o = { base: $('base').value, projectId: $('projectId').value, categoryId: $('categoryId').value,
    userId: $('userId').value, taskId: $('taskId').value, source: $('source').value, billable: $('billable').value,
    curl: $('curl').value };
  try { localStorage.setItem(LS, JSON.stringify(o)); } catch {}
}
let cookie = '', csrf = '';

function grabQuoted(s, flag) {
  let m = s.match(new RegExp(flag + "\\s+'([^']*)'")); if (m) return m[1];
  m = s.match(new RegExp(flag + '\\s+"((?:[^"\\\\]|\\\\.)*)"')); if (m) return m[1].replace(/\\"/g, '"');
  return '';
}
function parseCurl() {
  const c = $('curl').value.trim();
  if (!c) { cookie = ''; csrf = ''; $('auth').textContent = ''; return; }
  const url = (c.match(/(https?:\/\/[^\s'"]+)/) || [])[1] || '';
  const pid = (url.match(/\/projects\/(\d+)/) || c.match(/\/projects\/(\d+)/) || [])[1] || '';
  let b = (url.match(/^(https?:\/\/.*\/api\/v\d+)/) || [])[1] || '';
  if (!b) b = (url.match(/^(https?:\/\/.*?)\/projects\//) || [])[1] || '';
  cookie = grabQuoted(c, '(?:-b|--cookie)');
  csrf = ((c.match(/X-Angie-CsrfValidator:\s*([^'"\n]+)/) || [])[1] || '').trim();
  const cat = (c.match(/"category_id"\s*:\s*(\d+)/) || [])[1] || '';
  const uid = (c.match(/"user_id"\s*:\s*(\d+)/) || [])[1] || '';
  const tid = (c.match(/"task_id"\s*:\s*(\d+)/) || [])[1] || '';
  if (b) $('base').value = b;
  if (pid) $('projectId').value = pid;
  if (cat) $('categoryId').value = cat;
  if (uid) $('userId').value = uid;
  if (tid) $('taskId').value = tid;
  const miss = [];
  if (!cookie) miss.push('cookie'); if (!csrf) miss.push('CSRF');
  $('auth').className = 'status ' + (miss.length ? 'err' : 'ok');
  $('auth').textContent = miss.length ? 'Missing ' + miss.join(' & ') + ' — check the cURL' : 'Session captured ✓';
  saveLS();
}

async function loadWorklogs() {
  const r = await fetch('/api/worklogs');
  const data = await r.json();
  files = (data.files || []).filter((f) => f.valid !== false);
  const months = groupByMonth(files);
  const sel = $('month');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const k of months.keys()) {
    const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o);
  }
  if ([...months.keys()].includes(prev)) sel.value = prev;
  render();
}

function daysForMonth(monthKey) {
  return files
    .filter((f) => (isoDateFromFile(f) || '').slice(0, 7) === monthKey)
    .map((f) => ({ date: isoDateFromFile(f), rel: f.rel, hours: Number(f.hours) || 0 }));
}

function render() {
  const monthKey = $('month').value;
  const standard = parseFloat($('standard').value) || 8;
  const days = daysForMonth(monthKey);
  current = computeMonthlyOvertime(days, { standardDay: standard });
  const tb = $('tbl').querySelector('tbody');
  tb.innerHTML = '';
  current.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.className = row.deviation < 0 ? 'short' : (row.pushedOT > 0 ? 'push' : '');
    tr.innerHTML =
      `<td>${row.date}</td>` +
      `<td>${row.hours.toFixed(2)}</td>` +
      `<td>${row.deviation > 0 ? '+' : ''}${row.deviation.toFixed(2)}</td>` +
      `<td>${row.carryAfter.toFixed(2)}</td>` +
      `<td><input class="editot" data-i="${i}" value="${row.pushedOT.toFixed(2)}" /></td>` +
      `<td class="status" data-status="${i}"></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('input.editot').forEach((inp) => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      current.rows[i].pushedOT = parseFloat(inp.value) || 0;
      refreshTotals();
    });
  });
  refreshTotals();
  $('push').disabled = false;
}

function refreshTotals() {
  const topush = current.rows.reduce((s, r) => s + (r.pushedOT > 0 ? r.pushedOT : 0), 0);
  $('net').textContent = current.net.toFixed(2);
  $('topush').textContent = topush.toFixed(2);
  $('remainder').textContent = current.remainder.toFixed(2);
}

async function push() {
  if (!cookie || !csrf) { alert('Paste a valid expense cURL first (cookie + CSRF needed).'); return; }
  const pushRows = current.rows.filter((r) => r.pushedOT > 0);
  if (!pushRows.length) { alert('No overtime to push for this month.'); return; }
  const expenses = pushRows.map((r) => ({
    record_date: r.date,
    value: r.pushedOT.toFixed(2),
    summary: `Overtime ${r.pushedOT.toFixed(2)}h on ${r.date}`,
    category_id: $('categoryId').value,
    user_id: $('userId').value,
    task_id: $('taskId').value,
    source: $('source').value || 'project_time',
    billable_status: $('billable').value,
  }));
  const rowByDate = {};
  current.rows.forEach((r, i) => { rowByDate[r.date] = i; });
  $('push').disabled = true;
  const res = await fetch('/api/push-expenses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: $('base').value, projectId: $('projectId').value, cookie, csrf, expenses }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.done) continue;
      const date = msg.date || (expenses[msg.idx] && expenses[msg.idx].record_date);
      const i = rowByDate[date];
      const cell = i != null && $('tbl').querySelector(`[data-status="${i}"]`);
      if (cell) {
        if (msg.status === 'ok') { cell.textContent = 'expense ✓'; cell.className = 'status ok'; }
        else if (msg.status === 'error') { cell.textContent = `error ${msg.code || ''}`; cell.className = 'status err'; cell.title = msg.detail || ''; }
        else if (msg.status === 'start') { cell.textContent = '…'; cell.className = 'status'; }
      }
    }
  }
  $('push').disabled = false;
}

// wire up
const saved = loadLS();
for (const [id, key] of [['base','base'],['projectId','projectId'],['categoryId','categoryId'],['userId','userId'],['taskId','taskId'],['source','source'],['billable','billable'],['curl','curl']]) {
  if (saved[key] != null && saved[key] !== '') $(id).value = saved[key];
}
$('curl').addEventListener('input', () => { parseCurl(); });
['base','projectId','categoryId','userId','taskId','source','billable'].forEach((id) => $(id).addEventListener('change', saveLS));
$('month').addEventListener('change', render);
$('standard').addEventListener('change', render);
$('push').addEventListener('click', push);
if ($('curl').value.trim()) parseCurl();
loadWorklogs();

// live refresh when worklog files change
try {
  const es = new EventSource('/api/events');
  es.addEventListener('worklogs', () => loadWorklogs());
} catch {}
</script>
</body>
</html>
```

- [ ] **Step 2: Manually verify the page loads and computes**

Run: `node server.js` (in a background terminal), then open `http://localhost:5050/overtime`.
Expected:
- The Month dropdown lists `2026-06`.
- The table shows the June days with Hours / Deviation / Carry / Push OT columns.
- Net, To-push, and Carry-left totals populate.
- Editing a Push-OT cell updates the To-push total.

- [ ] **Step 3: Add a link from the main page (optional, matches standup link)**

Confirm whether `public/index.html` has a `/standup` link; if so, add an `/overtime` link beside it. (Grep for `standup` in `public/index.html`; if a nav link exists, mirror it. If not, skip — the page is reachable at `/overtime`.)

- [ ] **Step 4: Commit**

```bash
git add public/overtime.html
git commit -m "feat: add /overtime page (monthly overtime -> expenses)"
```

---

### Task 4: End-to-end verification against the live instance

**Files:** none (manual verification + README note).

- [ ] **Step 1: Push a real overtime month**

With the server running and a fresh expense cURL pasted:
- Select a month that has an overtime day.
- Confirm the To-push total looks right.
- Click **Push overtime as expenses**; watch each row flip to `expense ✓`.
- In ActiveCollab → project → Expenses, confirm the expenses appear with the right dates and values.

- [ ] **Step 2: Document the page in README**

Add a short section to `README.md` after the Standup section:

```markdown
## Overtime → Expenses (`/overtime`)

A third page that totals each month's overtime beyond an 8-hour day and pushes it
to ActiveCollab as **expenses**. It reads the same daily worklogs. Overtime under
30 minutes carries forward day-to-day until it reaches 30 minutes, then it's
pushed for that day. Short days (under 8h) are shown for context but never pushed;
the month's net total is shown for review only. Paste an **expense** cURL (not a
task cURL) so it can read `category_id` / `user_id` / `task_id`. The `value` sent
is the overtime in decimal hours.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the /overtime page"
```

---

## Self-Review

**Spec coverage:**
- Reads worklogs by month, day-by-day, true decimal → Task 1 (`groupByMonth`, `parseHoursDecimal`) + Task 3 (page wiring). ✓
- 8h standard, deviation, net (review-only incl. negatives) → Task 1 `computeMonthlyOvertime`. ✓
- 30-min carry accumulator, release on threshold, short days shown-not-pushed, leftover remainder → Task 1 tests cover all four. ✓
- Push each OT day as its own expense to `/projects/{id}/expenses` → Task 2 route + Task 3 push(). ✓
- value = OT decimal hours; category_id/user_id/task_id/source from curl + editable → Task 2 body + Task 3 fields/parseCurl. ✓
- Additive only (no change to `/api/push` or index.html behavior) → Task 2 appends routes; Task 3 new file; index.html link is optional/non-behavioral. ✓
- Live status per row, auth-expiry surfaces as error → Task 2 NDJSON + Task 3 stream reader. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. Task 3 Step 3 is conditional ("if a nav link exists") but fully specified either way.

**Type consistency:** `computeMonthlyOvertime` returns `{rows:[{date,rel,hours,deviation,carryAfter,pushedOT}], net, totalPushed, remainder}` — used consistently in Task 3 (`current.rows`, `current.net`, `current.remainder`, `row.pushedOT`, `row.deviation`, `row.carryAfter`). `isoDateFromFile`/`groupByMonth`/`parseHoursDecimal` signatures match between module, tests, and page. Server `/api/push-expenses` body fields (`record_date`, `value`, `category_id`, `user_id`, `task_id`, `source`, `billable_status`) match what the page sends.
