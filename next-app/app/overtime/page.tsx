'use client';
import { useState, useEffect } from 'react';
import { computeMonthlyOvertime, groupByMonth, isoDateFromFile, parseHoursDecimal, decimalToHHMM, isWeekend } from '@/lib/overtime-core';
import { useSession } from '@/lib/store';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import './overtime.css';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// "2026-06-27" -> "Sat 27 Jun" (UTC parse, no timezone drift).
function weekdayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${WD[d.getUTCDay()]} ${+m[3]} ${MN[+m[2] - 1].slice(0, 3)}`;
}

// "2026-06" -> "June 2026"
function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})/.exec(key || '');
  return m ? `${MN[+m[2] - 1]} ${m[1]}` : (key || '');
}

// signed h:mm, e.g. +1:00 / −0:30 / 0:00  (uses a real minus glyph)
function signedHHMM(dec) {
  if (!dec) return '0:00';
  const sign = dec > 0 ? '+' : '−';
  return sign + decimalToHHMM(Math.abs(dec));
}

export default function Page() {
  // hydration guard (avoids mismatch between server render and persisted store)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // shared toast + confirm (no native alert/confirm dialogs)
  const { toast, confirm, ui: notifyUi } = useNotify();

  // session (shared store)
  const base = useSession((s) => s.base);
  const projectId = useSession((s) => s.projectId);
  const categoryId = useSession((s) => s.categoryId);
  const userId = useSession((s) => s.userId);
  const taskId = useSession((s) => s.taskId);
  const source = useSession((s) => s.source);
  const billable = useSession((s) => s.billable);
  const cookie = useSession((s) => s.cookie);
  const csrf = useSession((s) => s.csrf);
  const setField = useSession((s) => s.setField);

  const connected = mounted && !!(cookie && csrf);

  // expense settings panel open state (open by default so the task picker is visible)
  const [setOpen, setSetOpen] = useState(true);

  // worklogs / table
  const [files, setFiles] = useState([]);
  const [months, setMonths] = useState([]); // list of month keys
  const [month, setMonth] = useState('');
  const [standard, setStandard] = useState('8');
  const [current, setCurrent] = useState({ rows: [], net: 0, totalPushed: 0, remainder: 0 });
  const [rowStatus, setRowStatus] = useState({}); // index -> {text, cls, title}
  const [pushing, setPushing] = useState(false);

  // auto-fetch task feature
  const [tasks, setTasks] = useState([]);
  const [taskMsg, setTaskMsg] = useState({ text: '', cls: 'status' });
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskFilter, setTaskFilter] = useState('');
  const [topTaskNote, setTopTaskNote] = useState('');

  // real hours from ActiveCollab (time-records) vs local worklog files
  const [acDays, setAcDays] = useState(null); // [{date, hours}] | null
  const [hoursMsg, setHoursMsg] = useState({ text: '', cls: 'status' });
  const [loadingHours, setLoadingHours] = useState(false);
  const usingAc = Array.isArray(acDays);

  // per-day dominant task: { "YYYY-MM-DD": { taskId, name } } — used per row for OT push
  const [dayTasks, setDayTasks] = useState({});
  const taskForDate = (date) => dayTasks[date] || null;
  const taskIdForDate = (date) => (dayTasks[date] && dayTasks[date].taskId) || taskId;

  // The expense summary for a day is that work-log's own `ot_description`
  // (a short, human-written note of what was done). Only if a day has none do
  // we fall back to a plain generated line.
  const fileForDate = (date) => files.find((x) => isoDateFromFile(x) === date) || null;
  const descForDate = (date) => {
    const f = fileForDate(date);
    return (f && f.otDescription && String(f.otDescription).trim()) || '';
  };
  const summaryForDate = (date, pushedOT) =>
    descForDate(date) || `Overtime ${Number(pushedOT).toFixed(2)}h on ${date}`;

  // already-pushed overtime for a day (persisted in the work-log's `ot_pushed`)
  const pushedForDate = (date) => {
    const f = fileForDate(date);
    return (f && Array.isArray(f.otPushed)) ? f.otPushed : [];
  };
  // record a successful overtime push back into that day's work-log file
  async function markOtPushed(date, value, summary) {
    const f = fileForDate(date);
    if (!f || !f.rel) return; // no local file for this date → nothing to mark
    try {
      await fetch('/api/worklog/mark-ot-pushed?path=' + encodeURIComponent(f.rel), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Number(value).toFixed(2), summary }),
      });
    } catch {}
  }

  // ---- mount: fetch worklogs, subscribe to events ----
  useEffect(() => {
    loadWorklogs();

    let es;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('worklogs', () => loadWorklogs());
    } catch {}
    return () => { if (es) es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadWorklogs() {
    const r = await fetch('/api/worklogs');
    const data = await r.json();
    const fl = (data.files || []).filter((f) => f.valid !== false);
    setFiles(fl);
    const monthMap = groupByMonth(fl);
    const keys = [...monthMap.keys()];
    setMonths(keys);
    setMonth((prev) => (keys.includes(prev) ? prev : (keys[0] || '')));
  }

  function daysForMonth(monthKey) {
    return files
      .filter((f) => (isoDateFromFile(f) || '').slice(0, 7) === monthKey)
      .map((f) => ({ date: isoDateFromFile(f), rel: f.rel, hours: Number(f.hours) || 0 }));
  }

  // ---- recompute table whenever month / standard / files / source change ----
  useEffect(() => {
    const std = parseFloat(standard) || 8;
    const days = usingAc ? acDays : daysForMonth(month);
    // Push overtime regardless of short days — minus days are NOT subtracted from
    // the bank (netDeviation:false). Under-hours are shown for information only.
    const computed = computeMonthlyOvertime(days, { standardDay: std, netDeviation: false });
    setCurrent(computed);
    setRowStatus({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, standard, files, acDays]);

  // switching month invalidates any ActiveCollab hours / per-day tasks we pulled
  useEffect(() => { setAcDays(null); setHoursMsg({ text: '', cls: 'status' }); setDayTasks({}); }, [month]);

  // editable "Will push" — normalize to h:mm and update row.pushedOT
  function onEditOT(i, value) {
    const dec = parseHoursDecimal(value.trim()); // accepts "0:30" or "0.5"
    setCurrent((prev) => {
      const rows = prev.rows.map((r, j) => (j === i ? { ...r, pushedOT: dec } : r));
      return { ...prev, rows };
    });
  }

  // derived totals (mirror refreshTotals)
  const pushRows = current.rows.filter((r) => r.pushedOT > 0);
  const topush = pushRows.reduce((s, r) => s + r.pushedOT, 0);
  const topushDec = pushRows.length
    ? `across ${pushRows.length} day${pushRows.length > 1 ? 's' : ''} · ${topush.toFixed(2)} h`
    : '';

  // month-wise summary (worked vs standard, deviation, day counts)
  const totalLogged = current.rows.reduce((s, r) => s + (r.hours || 0), 0);
  const totalStd = current.rows.reduce((s, r) => s + (r.standard ?? 0), 0);
  const daysOver = current.rows.filter((r) => r.deviation > 0.0001).length;
  const daysUnder = current.rows.filter((r) => r.deviation < -0.0001).length;
  const daysOn = current.rows.filter((r) => Math.abs(r.deviation) <= 0.0001).length;
  // total under-hours (sum of short days) — shown for info, NOT subtracted from OT
  const totalUnder = current.rows.reduce((s, r) => s + (r.deviation < 0 ? -r.deviation : 0), 0);
  // overtime already pushed this month (persisted in each day's ot_pushed)
  const totalPushedSoFar = current.rows.reduce((s, r) => {
    const recs = pushedForDate(r.date);
    return s + recs.reduce((a, p) => a + (Number(p.value) || 0), 0);
  }, 0);

  async function push() {
    if (!cookie || !csrf) { toast('Capture a session first (cookie + CSRF needed).', 'err'); return; }
    const withOT = current.rows.filter((r) => r.pushedOT > 0);
    const skipped = withOT.filter((r) => pushedForDate(r.date).length > 0);
    const rows = withOT.filter((r) => pushedForDate(r.date).length === 0);
    if (!rows.length) {
      toast(skipped.length ? 'All overtime this month is already pushed — use a row’s “re-push” to send one again.' : 'No overtime to push for this month.', 'info');
      return;
    }
    const ok = await confirm({
      title: 'Push overtime as expenses',
      body: `<b>${rows.length}</b> day${rows.length > 1 ? 's' : ''} will be pushed${skipped.length ? `; <b>${skipped.length}</b> already-pushed day${skipped.length > 1 ? 's' : ''} will be skipped` : ''}.`,
      items: rows.map((r) => ({ name: weekdayLabel(r.date), hours: r.pushedOT })),
      ok: 'Push',
    });
    if (!ok) return;
    const expenses = rows.map((r) => ({
      record_date: r.date,
      value: r.pushedOT.toFixed(2),
      summary: summaryForDate(r.date, r.pushedOT), // the day's ot_description
      category_id: categoryId,
      user_id: userId,
      task_id: taskIdForDate(r.date), // that day's dominant task (falls back to global Task ID)
      source: source || 'project_time',
      billable_status: billable,
    }));
    const rowByDate = {};
    current.rows.forEach((r, i) => { rowByDate[r.date] = i; });
    setPushing(true);
    let okN = 0, errN = 0;
    try {
      const res = await fetch('/api/push-expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, projectId, cookie, csrf, expenses }),
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
          if (i != null) {
            if (msg.status === 'ok') {
              okN++;
              setRowStatus((s) => ({ ...s, [i]: { text: 'expense ✓', cls: 'status ok', title: '' } }));
              const exp = expenses.find((e) => e.record_date === date);
              if (exp) await markOtPushed(date, exp.value, exp.summary);
            }
            else if (msg.status === 'error') { errN++; setRowStatus((s) => ({ ...s, [i]: { text: `error ${msg.code || ''}`, cls: 'status err', title: msg.detail || '' } })); }
            else if (msg.status === 'start') setRowStatus((s) => ({ ...s, [i]: { text: '…', cls: 'status', title: '' } }));
          }
        }
      }
    } catch (e) {
      toast('Push failed: ' + (e?.message || e), 'err');
    } finally {
      setPushing(false);
      loadWorklogs(); // refresh so pushed days show their persisted state
      if (okN || errN) toast(`Pushed ${okN} day${okN === 1 ? '' : 's'}${errN ? `, ${errN} failed` : ''}`, errN ? 'err' : 'ok');
    }
  }

  // push a SINGLE day's overtime as one expense (its own dominant task)
  async function pushOne(i) {
    const r = current.rows[i];
    if (!r || !(r.pushedOT > 0)) return;
    if (!cookie || !csrf) { toast('Capture a session first (cookie + CSRF needed).', 'err'); return; }
    const expense = {
      record_date: r.date,
      value: r.pushedOT.toFixed(2),
      summary: summaryForDate(r.date, r.pushedOT), // the day's ot_description
      category_id: categoryId,
      user_id: userId,
      task_id: taskIdForDate(r.date),
      source: source || 'project_time',
      billable_status: billable,
    };
    setRowStatus((s) => ({ ...s, [i]: { text: '…', cls: 'status', title: '' } }));
    try {
      const res = await fetch('/api/push-expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, projectId, cookie, csrf, expenses: [expense] }),
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
          if (msg.status === 'ok') {
            setRowStatus((s) => ({ ...s, [i]: { text: 'expense ✓', cls: 'status ok', title: '' } }));
            await markOtPushed(r.date, expense.value, expense.summary);
            loadWorklogs(); // refresh persisted pushed state
            toast(`${weekdayLabel(r.date)} pushed ✓ ${decimalToHHMM(r.pushedOT)}`, 'ok');
          }
          else if (msg.status === 'error') { setRowStatus((s) => ({ ...s, [i]: { text: `error ${msg.code || ''}`, cls: 'status err', title: msg.detail || '' } })); toast(`Push failed for ${weekdayLabel(r.date)}`, 'err'); }
        }
      }
    } catch (e) {
      setRowStatus((s) => ({ ...s, [i]: { text: 'error', cls: 'status err', title: String(e?.message || e) } }));
      toast('Push error: ' + (e?.message || e), 'err');
    }
  }

  // Across the selected month's work-logs, find the task NAME with the most
  // total hours (worklog tasks have no AC id, so we match to AC tasks by name).
  async function computeTopTask(monthKey) {
    const monthFiles = files.filter((f) => (isoDateFromFile(f) || '').slice(0, 7) === monthKey);
    const agg = {};
    for (const f of monthFiles) {
      try {
        const r = await fetch('/api/worklog?path=' + encodeURIComponent(f.rel));
        const j = await r.json();
        const ts = Array.isArray(j) ? j : (j.tasks || []);
        for (const t of ts) {
          const name = (t.name || '').trim();
          if (!name) continue;
          agg[name] = (agg[name] || 0) + parseHoursDecimal(t.hours ?? t.duration ?? t.time ?? 0);
        }
      } catch {}
    }
    let top = null;
    for (const [name, hours] of Object.entries(agg)) {
      if (!top || hours > top.hours) top = { name, hours };
    }
    return top; // { name, hours } | null
  }

  // From local worklog JSON: each day's dominant task (most hours), matched to a
  // fetched AC task by name → { "YYYY-MM-DD": { taskId, name } }. Used when we're
  // not pulling real ActiveCollab time-records.
  async function computeLocalDayTasks(monthKey, acList) {
    const idx = acList.map((t) => ({ id: String(t.id), lname: (t.name || '').toLowerCase(), name: t.name || '' }));
    const monthFiles = files.filter((f) => (isoDateFromFile(f) || '').slice(0, 7) === monthKey);
    const out = {};
    for (const f of monthFiles) {
      const date = isoDateFromFile(f);
      try {
        const r = await fetch('/api/worklog?path=' + encodeURIComponent(f.rel));
        const j = await r.json();
        const ts = Array.isArray(j) ? j : (j.tasks || []);
        const agg = {};
        for (const t of ts) {
          const nm = (t.name || '').trim();
          if (!nm) continue;
          agg[nm] = (agg[nm] || 0) + parseHoursDecimal(t.hours ?? t.duration ?? t.time ?? 0);
        }
        let top = null;
        for (const [nm, h] of Object.entries(agg)) if (!top || h > top.hours) top = { name: nm, hours: h };
        if (top) {
          const q = top.name.toLowerCase();
          const hit = idx.find((x) => x.lname && (x.lname.includes(q) || q.includes(x.lname)));
          out[date] = hit ? { taskId: hit.id, name: hit.name } : { taskId: '', name: top.name };
        }
      } catch {}
    }
    return out;
  }

  // ---- fetch tasks from ActiveCollab + auto-select the biggest worklog task ----
  async function loadTasks() {
    if (!base || !projectId || !cookie) {
      setTaskMsg({ text: 'Need base, project ID and a captured session first.', cls: 'status err' });
      setSetOpen(true);
      return;
    }
    setLoadingTasks(true);
    setTaskMsg({ text: 'Loading tasks…', cls: 'status' });
    setTopTaskNote('');
    try {
      const top = await computeTopTask(month); // biggest task this month, by hours
      const res = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, projectId, cookie, csrf, match: top ? { name: top.name } : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTasks([]);
        setTaskMsg({ text: `Task fetch failed${data.code ? ' (' + data.code + ')' : ''}${data.error ? ': ' + data.error : ''}`, cls: 'status err' });
        return;
      }
      const list = Array.isArray(data.tasks) ? data.tasks : [];
      setTasks(list);
      setTaskMsg({ text: `Loaded ${list.length} task${list.length === 1 ? '' : 's'} for ${monthLabel(month)}`, cls: 'status ok' });
      // per-day task from local worklogs (unless real AC hours already drive it)
      if (!usingAc) {
        const dt = await computeLocalDayTasks(month, list);
        setDayTasks(dt);
      }
      // auto-select the resolved task (matched to your biggest worklog task)
      if (data.resolved && data.resolved.id) {
        setField('taskId', String(data.resolved.id));
        const why = data.resolved.why === 'name-match' ? 'matched your biggest task'
          : data.resolved.why === 'date-in-name' ? 'matched by date'
          : 'most recently updated task';
        setTopTaskNote(
          `Auto-selected #${data.resolved.id} — ${data.resolved.name}`
          + (top ? ` · ${why}: “${top.name}” (${decimalToHHMM(top.hours)})` : ` · ${why}`)
        );
      } else if (top) {
        setTopTaskNote(`Biggest task this month: “${top.name}” (${decimalToHHMM(top.hours)}) — no matching ActiveCollab task; pick one below.`);
      }
    } catch (e) {
      setTasks([]);
      setTaskMsg({ text: 'Task fetch error: ' + (e?.message || e), cls: 'status err' });
    } finally {
      setLoadingTasks(false);
    }
  }

  function onPickTask(id) {
    if (!id) return;
    setField('taskId', id);
    setTopTaskNote('');
  }

  // last calendar day of a "YYYY-MM" month (UTC)
  function lastDayOfMonth(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  // ---- pull REAL logged hours for the month from ActiveCollab time-records ----
  async function loadRealHours() {
    if (!base || !userId || !cookie) {
      setHoursMsg({ text: 'Need base, your user ID and a captured session first.', cls: 'status err' });
      setSetOpen(true);
      return;
    }
    if (!month) return;
    setLoadingHours(true);
    setHoursMsg({ text: 'Loading real hours from ActiveCollab…', cls: 'status' });
    try {
      const from = `${month}-01`;
      const to = `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}`;
      const res = await fetch('/api/time-records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, userId, cookie, csrf, from, to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHoursMsg({ text: `Hours fetch failed${data.code ? ' (' + data.code + ')' : ''}${data.error ? ': ' + data.error : ''}`, cls: 'status err' });
        return;
      }
      const days = Array.isArray(data.days) ? data.days : [];
      setAcDays(days);
      setDayTasks(data.dayTasks || {}); // each day's dominant task (real AC ids)
      setHoursMsg({ text: `Real hours loaded — ${days.length} day${days.length === 1 ? '' : 's'} · ${decimalToHHMM(data.total || 0)} (${(data.total || 0).toFixed(2)} h) from ActiveCollab`, cls: 'status ok' });
      // auto-select the task with the most REAL hours (exact AC task id) as the global fallback
      if (data.topTask && data.topTask.taskId) {
        setField('taskId', String(data.topTask.taskId));
        setTopTaskNote(`Auto-selected #${data.topTask.taskId} — ${data.topTask.name} · most hours this month (${decimalToHHMM(data.topTask.hours)}). Each day also uses its own biggest task below.`);
      }
    } catch (e) {
      setHoursMsg({ text: 'Hours fetch error: ' + (e?.message || e), cls: 'status err' });
    } finally {
      setLoadingHours(false);
    }
  }

  // expense-settings chip
  let setChip = { cls: 'chip idle', text: 'no session' };
  if (mounted) {
    if (connected) setChip = { cls: 'chip ok', text: 'session captured ✓' };
    else setChip = { cls: 'chip err', text: 'needs cookie / CSRF' };
  }

  return (
    <div className="ot">
      <a className="back" href="/">← Work-log Pusher</a>
      <h1>Overtime → Expenses</h1>
      <p className="sub">Overtime beyond an 8-hour weekday (weekends count fully). A day with <b>25 minutes or more</b> overtime is pushed that day, in full. Overtime <b>under 25 minutes</b> banks up day to day and is released once the bank reaches 25 minutes. <b>Short days are shown for information only</b> — they don&apos;t reduce your overtime.</p>

      <details className="conn" open={setOpen} onToggle={(e) => setSetOpen(e.currentTarget.open)}>
        <summary>Expense settings <span className={setChip.cls}>{setChip.text}</span></summary>
        <div className="body">
          <div className="grid">
            <div><label>Category ID</label><input value={categoryId} onChange={(e) => setField('categoryId', e.target.value)} /></div>
            <div>
              <label>Task ID</label>
              <input value={taskId} onChange={(e) => setField('taskId', e.target.value)} />
              <div style={{ marginTop: 8 }}>
                <Button type="button" variant="outline" size="sm" onClick={loadTasks} disabled={loadingTasks}>
                  {loadingTasks && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loadingTasks ? 'Loading…' : 'Load tasks from ActiveCollab'}
                </Button>
              </div>
            </div>
            <div><label>Source</label><input value={source} onChange={(e) => setField('source', e.target.value)} /></div>
            <div><label>Billable (0/1)</label><input value={billable} onChange={(e) => setField('billable', e.target.value)} /></div>
          </div>

          {/* task picker — fetched from ActiveCollab, shown as a searchable table */}
          {taskMsg.text && <p className={taskMsg.cls} style={{ marginTop: 10 }}>{taskMsg.text}</p>}
          {topTaskNote && <p className="toptask">{topTaskNote}</p>}
          {tasks.length > 0 && (
            <div className="tasklist">
              <input
                className="taskfilter"
                placeholder={`Filter ${tasks.length} tasks…`}
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              />
              <div className="wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th style={{ width: 70 }}>#</th><th>Task</th><th style={{ width: 70 }}></th></tr></thead>
                  <tbody>
                    {tasks
                      .filter((t) => {
                        const q = taskFilter.trim().toLowerCase();
                        if (!q) return true;
                        return (t.name || '').toLowerCase().includes(q) || String(t.task_number || '').includes(q) || String(t.id) === q;
                      })
                      .map((t) => (
                        <tr key={t.id} className={String(t.id) === String(taskId) ? 'sel' : ''}>
                          <td>#{t.task_number}</td>
                          <td style={{ textAlign: 'left' }}>{t.name}</td>
                          <td>
                            <Button type="button" variant={String(t.id) === String(taskId) ? 'default' : 'outline'} size="sm" onClick={() => onPickTask(String(t.id))}>
                              {String(t.id) === String(taskId) ? '✓ used' : 'Use'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </details>

      <div className="card" style={{ position: 'relative' }}>
        {loadingHours && (
          <div className="otloading">
            <span className="otspin" /> Loading real hours from ActiveCollab…
          </div>
        )}
        <div className="controls">
          <div className="field month">
            <label>Month</label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                {months.map((k) => <SelectItem key={k} value={k}>{monthLabel(k)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="field std">
            <label>Standard day (h)</label>
            <input value={standard} onChange={(e) => setStandard(e.target.value)} />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <Button type="button" onClick={loadRealHours} disabled={loadingHours}>
              {loadingHours && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingHours ? 'Loading…' : 'Use real ActiveCollab hours'}
            </Button>
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <span className={'srcbadge ' + (usingAc ? 'ac' : 'local')}>
              {usingAc ? 'Source: ActiveCollab (live)' : 'Source: local work-logs'}
            </span>
            {usingAc && (
              <Button type="button" variant="link" size="sm" onClick={() => { setAcDays(null); setHoursMsg({ text: '', cls: 'status' }); }}>
                use local
              </Button>
            )}
          </div>
        </div>
        {hoursMsg.text && <p className={hoursMsg.cls} style={{ margin: '0 0 6px' }}>{hoursMsg.text}</p>}

        {/* month-wise summary — worked vs standard, net deviation, day counts */}
        <div className="otsummary">
          <div className="s"><span className="k">Worked</span><b>{decimalToHHMM(totalLogged)}</b><span className="d">{totalLogged.toFixed(2)} h</span></div>
          <div className="s"><span className="k">Standard</span><b>{decimalToHHMM(totalStd)}</b><span className="d">{totalStd.toFixed(2)} h</span></div>
          <div className="s"><span className="k">Overtime to push</span>
            <b className="over">{decimalToHHMM(topush)}</b>
            <span className="d">{topush.toFixed(2)} h · {pushRows.length} day{pushRows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="s"><span className="k">Under hours (info)</span>
            <b className={totalUnder > 0.0001 ? 'under' : ''}>{totalUnder > 0.0001 ? '−' : ''}{decimalToHHMM(totalUnder)}</b>
            <span className="d">{daysUnder} short day{daysUnder === 1 ? '' : 's'} · not subtracted</span>
          </div>
          <div className="s"><span className="k">Already pushed</span>
            <b className={totalPushedSoFar > 0.0001 ? 'ok' : ''}>{decimalToHHMM(totalPushedSoFar)}</b>
            <span className="d">{totalPushedSoFar.toFixed(2)} h recorded</span>
          </div>
          <div className="s"><span className="k">Days</span>
            <b><span className="over">{daysOver}↑</span> · <span className="under">{daysUnder}↓</span> · {daysOn}=</b>
            <span className="d">over · under · on-target</span>
          </div>
        </div>
        <div className="wrap">
          <table>
            <thead><tr>
              <th>Date</th><th>Logged</th><th>Over–under</th><th>Banked</th><th>Day task</th><th>Will push (h:mm)</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {current.rows.map((row, i) => {
                const cls = row.pushedOT > 0 ? 'push' : (row.deviation < 0 ? 'short' : 'muted');
                const st = rowStatus[i] || { text: '', cls: 'status', title: '' };
                const pushedRec = pushedForDate(row.date);
                const alreadyPushed = pushedRec.length > 0;
                const pushedTotal = pushedRec.reduce((s2, p) => s2 + (Number(p.value) || 0), 0);
                return (
                  <tr key={row.date || i} className={cls}>
                    <td>
                      <span className="day">{weekdayLabel(row.date)}</span>
                      {row.isWeekend ? <span className="wkend">weekend · all OT</span> : null}
                    </td>
                    <td>{decimalToHHMM(row.hours)} <span className="hdec">({row.hours.toFixed(2)})</span></td>
                    <td>
                      <span className={'dev ' + (row.deviation > 0.0001 ? 'over' : row.deviation < -0.0001 ? 'under' : 'zero')}>
                        {signedHHMM(row.deviation)}
                        <span className="devdec">{Math.abs(row.deviation) < 0.0001 ? '' : ` (${row.deviation > 0 ? '+' : '−'}${Math.abs(row.deviation).toFixed(2)})`}</span>
                      </span>
                    </td>
                    <td>{row.carryAfter > 0.0001 ? decimalToHHMM(row.carryAfter) : '—'}</td>
                    <td className="daytask">
                      {(() => {
                        const dt = taskForDate(row.date);
                        if (dt && dt.taskId) return <span title={dt.name}>#{dt.taskId} <span className="dtname">{dt.name}</span></span>;
                        if (dt && dt.name) return <span className="dtnomatch" title="known locally, no ActiveCollab match — uses global Task ID">{dt.name} <em>(no match)</em></span>;
                        return <span className="dtfallback">{taskId ? `#${taskId}` : '—'}</span>;
                      })()}
                    </td>
                    <td>
                      <input
                        className="editot"
                        defaultValue={decimalToHHMM(row.pushedOT)}
                        title="Type as h:mm (e.g. 0:30) or a decimal"
                        key={`${row.date}-${row.pushedOT}`}
                        onChange={(e) => onEditOT(i, e.target.value)}
                        onBlur={(e) => { e.target.value = decimalToHHMM(parseHoursDecimal(e.target.value.trim())); }}
                      />
                    </td>
                    <td className={st.cls} title={st.title}>
                      {st.text || (alreadyPushed
                        ? <span className="pushedtag" title={`Pushed ${decimalToHHMM(pushedTotal)} on ${pushedRec[pushedRec.length - 1].at?.slice(0, 10) || ''}`}>pushed ✓ {decimalToHHMM(pushedTotal)}</span>
                        : '')}
                    </td>
                    <td>
                      {row.pushedOT > 0 && (alreadyPushed ? (
                        <Button type="button" variant="outline" size="sm" disabled={pushing}
                          title="Already pushed — click to push this day again"
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Push this day again?',
                              body: `<b>${weekdayLabel(row.date)}</b> was already pushed (<b>${decimalToHHMM(pushedTotal)}</b>). Pushing again creates another expense in ActiveCollab.`,
                              ok: 'Re-push',
                            });
                            if (ok) pushOne(i);
                          }}>
                          re-push
                        </Button>
                      ) : (
                        <Button type="button" size="sm" disabled={pushing}
                          title={`Pushes as: ${summaryForDate(row.date, row.pushedOT)}`}
                          onClick={() => pushOne(i)}>
                          Push
                        </Button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="legend">
          <b>Logged</b> is your real hours that day; <b>Over–under</b> is vs the {standard}h standard (weekends = 0, so every weekend hour is overtime).
          A day with <b>25 min or more</b> overtime is pushed that day, in full — a 29-min, 1-hour or 2-hour day is its own expense and is never carried forward.
          Overtime <b>under 25 min banks</b> day-to-day and <b>releases into “Will push” on the day the bank first reaches 25 min</b>.
          <b>Short (minus) days are shown for information only</b> — they don’t reduce your overtime or the bank.
        </p>

        <div className="pushbox">
          <div className="big">Will push <b>{decimalToHHMM(topush)}</b> <span className="dec">{topushDec}</span></div>
          <div className="days">
            {pushRows.length
              ? pushRows.map((r) => <span className="d" key={r.date} title={summaryForDate(r.date, r.pushedOT)}>{weekdayLabel(r.date)}: {decimalToHHMM(r.pushedOT)}</span>)
              : <span className="none">Nothing to push this month.</span>}
          </div>
          {pushRows.length > 0 && (
            <ul className="otsummaries">
              {pushRows.map((r) => (
                <li key={r.date}>
                  <span className="d">{weekdayLabel(r.date)}</span>
                  <span className="txt">{summaryForDate(r.date, r.pushedOT)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="secondary">Under hours <b>{decimalToHHMM(totalUnder)}</b> (info only) · Bank left <b>{decimalToHHMM(current.remainder)}</b> · Already pushed <b>{decimalToHHMM(totalPushedSoFar)}</b></div>
        </div>

        <Button onClick={push} disabled={pushing || current.rows.length === 0} className="mt-3">
          {pushing && <Loader2 className="h-4 w-4 animate-spin" />}Push overtime as expenses
        </Button>
      </div>
      {notifyUi}
    </div>
  );
}
