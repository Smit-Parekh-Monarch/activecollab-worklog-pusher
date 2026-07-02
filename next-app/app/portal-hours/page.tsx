'use client';
import { useState, useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { Loader2 } from 'lucide-react';
import { parseHoursDecimal, decimalToHHMM, isWeekend } from '@/lib/overtime-core';
import { computePortalOvertime } from '@/lib/portal-overtime';
import { useSession } from '@/lib/store';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MNL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayLabel(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${WD[d.getUTCDay()]} ${+m[3]} ${MN[+m[2] - 1]}`;
}
function signedHHMM(dec: number) {
  if (!dec) return '0:00';
  return (dec > 0 ? '+' : '−') + decimalToHHMM(Math.abs(dec));
}
function dec2(n: number) { return (Number(n) || 0).toFixed(2); }
function lastDayOfMonth(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function monthLabel(key: string) {
  const m = /^(\d{4})-(\d{2})/.exec(key || '');
  return m ? `${MNL[+m[2] - 1]} ${m[1]}` : (key || '');
}
// shift a "YYYY-MM" key by ±1 month
function shiftMonth(key: string, delta: number) {
  const m = /^(\d{4})-(\d{2})/.exec(key || '');
  if (!m) return key;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function normalizeDay(d: any) {
  const tasks: any[] = [];
  for (const p of d.projects || []) {
    for (const t of p.tasks || []) {
      tasks.push({
        taskId: t.taskId,
        name: t.taskName || (t.description ? String(t.description).split('\n')[0] : `#${t.taskId || '?'}`),
        description: t.description || '',
        hours: parseHoursDecimal(t.hours || 0),
      });
    }
  }
  let topTask: any = null;
  for (const t of tasks) if (!topTask || t.hours > topTask.hours) topTask = t;
  return { date: d.date, hours: parseHoursDecimal(d.totalHours || 0), tasks, topTask };
}

// one stat tile: big h:mm + true decimal underneath.
// `accent` = terracotta gradient tile (white text); `tone` colors the value.
function Stat({ label, hhmm, sub, tone, subIcon, accent }: {
  label: string; hhmm: string; sub: React.ReactNode; tone?: string; subIcon?: string; accent?: boolean;
}) {
  const valColor = accent ? '#fff'
    : tone === 'over' || tone === 'ok' ? 'var(--success)'
    : tone === 'under' ? 'var(--error)'
    : tone === 'bank' ? 'var(--warning)'
    : 'var(--text)';
  const subColor = accent ? 'rgba(255,255,255,.85)'
    : tone === 'ok' ? 'var(--success)'
    : 'var(--text3)';
  return (
    <div
      className="card"
      style={accent
        ? { background: 'linear-gradient(150deg,#C4623C,#A94F2E)', border: 0, borderRadius: 14, padding: 15, color: '#fff' }
        : { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 15, boxShadow: 'var(--shadow-xs)' }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: accent ? 'rgba(255,255,255,.85)' : 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)', color: valColor }}>{hhmm}</div>
      <div style={{ fontSize: 11, marginTop: 2, color: subColor, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {subIcon && <Icon name={subIcon} size={13} />}{sub}
      </div>
    </div>
  );
}

export default function Page() {
  const { toast, ui: notifyUi } = useNotify();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sessions come from the shared store — paste either cURL in the top-bar Connect.
  // Portal Bearer token (loads hours):
  const portalToken = useSession((s) => s.portalToken);
  const portalCookie = useSession((s) => s.portalCookie);
  const portalCapturedAt = useSession((s) => s.portalCapturedAt);
  const captured = mounted && !!portalToken;
  // ActiveCollab session (needed only to PUSH):
  const base = useSession((s) => s.base);
  const projectId = useSession((s) => s.projectId);
  const categoryId = useSession((s) => s.categoryId);
  const userId = useSession((s) => s.userId);
  const taskId = useSession((s) => s.taskId);
  const sourceField = useSession((s) => s.source);
  const billable = useSession((s) => s.billable);
  const cookie = useSession((s) => s.cookie);
  const csrf = useSession((s) => s.csrf);
  const acConnected = mounted && !!(cookie && csrf);

  const [month, setMonth] = useState('2026-06');
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<any[]>([]);
  const [apiTotal, setApiTotal] = useState(0);   // ActiveCollab logged total (my-project-hours)
  const [punchTotal, setPunchTotal] = useState(0); // attendance punch total (monthly-summary)
  const [attWarn, setAttWarn] = useState('');     // set when attendance couldn't load (falls back to AC)
  const [msg, setMsg] = useState('');

  const [pushing, setPushing] = useState(false);
  const [rowStatus, setRowStatus] = useState<Record<string, any>>({});
  const [confirmRows, setConfirmRows] = useState<any[] | null>(null);
  // overtime expenses already in ActiveCollab (category = overtime), keyed by
  // date — used to VERIFY what's already pushed so we never double-push.
  const [pushedByDate, setPushedByDate] = useState<Record<string, { value: number; count: number }>>({});

  // worklog ot_description per date — used as the push summary (same as the
  // Overtime page), falling back to the day's top task when none exists.
  const [descByDate, setDescByDate] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/api/worklogs').then((r) => r.json()).then((d) => {
      const map: Record<string, string> = {};
      for (const f of (d.files || [])) {
        if (f.date && f.otDescription) map[String(f.date).slice(0, 10)] = f.otDescription;
      }
      setDescByDate(map);
    }).catch(() => {});
  }, []);

  async function load() {
    if (!captured) { toast('Capture the portal token first (top-bar Connect)', 'err'); return; }
    setLoading(true);
    setMsg('Loading hours from the portal…');
    setAttWarn('');
    try {
      const from = `${month}-01`;
      const to = `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}`;
      const [y, mo] = month.split('-').map(Number);
      // Fetch BOTH sources at once: ActiveCollab logged hours (my-project-hours)
      // and attendance punch hours (monthly-summary). Overtime is based on punch.
      const [acRes, attRes] = await Promise.all([
        fetch('/api/portal-hours', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: portalToken, cookie: portalCookie, from, to }),
        }),
        fetch('/api/portal-attendance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: portalToken, cookie: portalCookie, year: y, month: mo }),
        }),
      ]);

      const acData = await acRes.json().catch(() => ({}));
      if (!acRes.ok) { setMsg(`Load failed${acData.code ? ` (${acData.code})` : ''}: ${acData.error || 'unknown'}`); toast('Load failed', 'err'); return; }
      const d = acData.data || {};
      const acDays = (d.dates || []).map(normalizeDay);   // { date, hours(AC), tasks, topTask }
      const acByDate: Record<string, any> = {};
      acDays.forEach((x: any) => { acByDate[x.date] = x; });
      const acTotal = parseHoursDecimal(d.totalHours || 0);

      // attendance punch hours, keyed by date (best-effort — AC still works if this fails)
      const attByDate: Record<string, any> = {};
      const attData = await attRes.json().catch(() => ({}));
      if (attRes.ok && attData?.data?.dailyRecords) {
        for (const rec of attData.data.dailyRecords) {
          // A day is FINISHED once it has totalHours — this covers COMPLETE,
          // MODIFIED (punch-out corrected after the fact), and any other
          // finalized status. Only a still-logged-in day (punched in, no
          // punch-out / no totalHours) is "in progress". Days with no punch at
          // all (ABSENT / weekends off) are skipped entirely.
          const hasHours = !!rec.totalHours;
          const loggedIn = !hasHours && (rec.status === 'LOGGEDIN' || (!!rec.punchIn && !rec.punchOut));
          if (!hasHours && !loggedIn) continue;
          attByDate[rec.date] = {
            date: rec.date,
            punchHours: hasHours ? parseHoursDecimal(rec.totalHours) : null,
            complete: hasHours,
            status: rec.status,
            punchIn: rec.punchIn || '',
            punchOut: rec.punchOut || '',
          };
        }
      } else {
        setAttWarn('Punch/attendance hours could not be loaded — overtime fell back to ActiveCollab hours. Re-copy the portal cURL if the token expired.');
      }

      // merge by date. OT basis = punch hours; AC hours kept for reference. Tasks come from AC.
      // include every AC date plus every attendance date we have a record for
      // (complete days become normal rows; still-logged-in days show as in-progress)
      const allDates = Array.from(new Set([
        ...acDays.map((x: any) => x.date),
        ...Object.keys(attByDate),
      ]));
      const merged = allDates.map((date) => {
        const ac = acByDate[date];
        const at = attByDate[date];
        const acHours = ac ? ac.hours : 0;
        const punchHours = at ? at.punchHours : null;
        const inProgress = !!(at && !at.complete);
        return {
          date,
          hours: punchHours != null ? punchHours : acHours,  // OT basis
          acHours,
          punchHours,
          inProgress,
          punchStatus: at?.status || null,
          tasks: ac?.tasks || [],
          topTask: ac?.topTask || null,
        };
      });

      setDays(merged);
      setApiTotal(acTotal);
      setPunchTotal(merged.reduce((s, x) => s + (x.punchHours || 0), 0));
      setRowStatus({});
      const nComplete = merged.filter((x) => !x.inProgress).length;
      setMsg(`Loaded ${nComplete} day${nComplete === 1 ? '' : 's'} · punch ${decimalToHHMM(merged.reduce((s, x) => s + (x.punchHours || 0), 0))} · AC ${d.totalHours || '0:00'}`);
      toast(`Loaded ${nComplete} days`, 'ok');

      // verify what's already pushed: read the project's overtime expenses from
      // ActiveCollab and mark matching days. Needs the AC session (cookie+csrf).
      if (acConnected) {
        try {
          const exRes = await fetch('/api/expenses', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base, projectId, cookie, csrf, from, to, categoryId, userId }),
          });
          const exData = await exRes.json().catch(() => ({}));
          setPushedByDate(exRes.ok && exData.byDate ? exData.byDate : {});
        } catch { setPushedByDate({}); }
      } else {
        setPushedByDate({});
      }
    } catch (e: any) {
      setMsg('Load error: ' + (e?.message || e)); toast('Load error', 'err');
    } finally { setLoading(false); }
  }

  // overtime is computed on completed days only; in-progress days (still logged
  // in, no punch-out) are shown for context but never counted or pushed.
  const comp = computePortalOvertime(days.filter((d) => !d.inProgress));
  const inProgressRows = days.filter((d) => d.inProgress);
  const displayRows = [...comp.rows, ...inProgressRows].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // a day counts as already pushed if ActiveCollab has an overtime expense for it
  // (verified on load) or we just pushed it this session
  const isPushed = (r: any) => !!pushedByDate[r.date] || !!rowStatus[r.date]?.ok;
  const pushRows = comp.rows.filter((r) => r.status === 'push' && !isPushed(r));
  const alreadyPushedCount = comp.rows.filter((r) => r.status === 'push' && !!pushedByDate[r.date]).length;
  // total overtime already recorded in ActiveCollab this month (verified), and how many days
  const pushedTotalHrs = +Object.values(pushedByDate).reduce((s, p) => s + (p.value || 0), 0).toFixed(2);
  const pushedDaysCount = Object.keys(pushedByDate).length;
  // "remaining OT" = pushable overtime minus the under-hours shortfall (a net view)
  const remainingOt = +(comp.totalPush - comp.totalShort).toFixed(2);
  const taskIdForRow = (r: any) => (r.topTask && r.topTask.taskId) || taskId;
  // summary = that day's ot_description from the work-log JSON, else a generated
  // line — IDENTICAL to the Overtime page's summaryForDate so both tools push the
  // same description for a given day.
  const summaryForRow = (r: any) =>
    descByDate[r.date] || `Overtime ${dec2(r.pushOT)}h on ${r.date}`;

  async function doPush(rows: any[]) {
    if (!acConnected) { toast('Connect an ActiveCollab session (top bar) to push', 'err'); return; }
    const expenses = rows.map((r) => ({
      record_date: r.date,
      value: dec2(r.pushOT),
      summary: summaryForRow(r),
      category_id: categoryId,
      user_id: userId,
      task_id: taskIdForRow(r),
      source: sourceField || 'project_time',
      billable_status: billable,
    }));
    const byDate: Record<string, string> = {};
    rows.forEach((r) => { byDate[r.date] = r.date; });
    setPushing(true);
    let okN = 0, errN = 0;
    try {
      const res = await fetch('/api/push-expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base, projectId, cookie, csrf, expenses }),
      });
      const reader = (res.body as ReadableStream).getReader();
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
          let m: any; try { m = JSON.parse(line); } catch { continue; }
          if (m.done) continue;
          const date = m.date || (expenses[m.idx] && expenses[m.idx].record_date);
          if (!date) continue;
          if (m.status === 'ok') { okN++; setRowStatus((s) => ({ ...s, [date]: { ok: true } })); }
          else if (m.status === 'error') { errN++; setRowStatus((s) => ({ ...s, [date]: { err: m.code || 'error' } })); }
        }
      }
    } catch (e: any) {
      toast('Push failed: ' + (e?.message || e), 'err');
    } finally {
      setPushing(false);
      if (okN || errN) toast(`Pushed ${okN} day${okN === 1 ? '' : 's'}${errN ? `, ${errN} failed` : ''}`, errN ? 'err' : 'ok');
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* rule explainer */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 14, margin: '0 0 20px', background: '#F7F5F0', border: '1px solid #EAE6DE' }}>
        <Icon name="info" size={20} style={{ color: 'var(--primary)', lineHeight: 1, marginTop: 1 }} />
        <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
          Loads both your <b style={{ color: 'var(--text)' }}>punch/attendance hours</b> (<code style={{ fontFamily: 'var(--mono)', fontSize: 11.5, background: '#EDEAE2', padding: '1px 5px', borderRadius: 5 }}>monthly-summary</code>) and your <b style={{ color: 'var(--text)' }}>ActiveCollab logged hours</b> (<code style={{ fontFamily: 'var(--mono)', fontSize: 11.5, background: '#EDEAE2', padding: '1px 5px', borderRadius: 5 }}>my-project-hours</code>), and works out overtime from the <b style={{ color: 'var(--text)' }}>punch hours</b> (actual time at work). A day with{' '}
          <b style={{ color: 'var(--text)' }}>25 min or more</b> over 8h is pushable that day; under 25 min{' '}
          <b style={{ color: 'var(--text)' }}>banks</b> and is <b style={{ color: 'var(--text)' }}>never auto-released</b> — you clear the bank manually. Weekends count fully. Every time shows in{' '}
          <b style={{ color: 'var(--text)' }}>h:mm and true decimal</b> (the decimal is what&apos;s pushed).
        </p>
      </div>

      {/* two-session status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, marginBottom: 20, background: 'var(--card)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Portal token</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
            background: captured ? 'var(--success-light)' : 'var(--surface-hover)',
            color: captured ? 'var(--success)' : 'var(--text3)',
          }}>{captured ? 'captured ✓' : 'needed'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>loads hours</span>
        </div>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>ActiveCollab</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
            background: acConnected ? 'var(--success-light)' : 'var(--surface-hover)',
            color: acConnected ? 'var(--success)' : 'var(--text3)',
          }}>{acConnected ? 'connected ✓' : 'connect to push'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>needed to push</span>
        </div>
        <Button
          variant="ghost"
          onClick={() => window.dispatchEvent(new Event('pusher:connect'))}
          style={{
            marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, padding: '9px 14px',
            borderRadius: 9, border: '1px solid var(--border-strong)', background: 'var(--card)', color: 'var(--text2)',
          }}
        >
          <Icon name="link" size={16} /> Manage connections
        </Button>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 11, padding: 5 }}>
          <Button variant="ghost" size="icon" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--text3)' }}>
            <Icon name="chevron_left" size={19} />
          </Button>
          <span style={{ fontSize: 13.5, fontWeight: 700, padding: '0 8px', minWidth: 96, textAlign: 'center' }}>{monthLabel(month)}</span>
          <Button variant="ghost" size="icon" onClick={() => setMonth((m) => shiftMonth(m, 1))}
            style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--text3)' }}>
            <Icon name="chevron_right" size={19} />
          </Button>
        </div>
        {/* keep the native month input for precise selection, styled to match */}
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 170 }} />
        <Button variant="ghost" onClick={load} disabled={loading}
          style={{ fontSize: 13, fontWeight: 600, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border-strong)', background: 'var(--card)', color: 'var(--text2)' }}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon name="cloud_download" size={17} />}
          {loading ? 'Loading…' : 'Load portal hours'}
        </Button>
        {days.length > 0 && (
          <Button
            disabled={!pushRows.length || pushing || !acConnected}
            onClick={() => setConfirmRows(pushRows)}
            style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, padding: '10px 18px', borderRadius: 10, background: 'var(--primary)', color: '#fff', boxShadow: '0 2px 8px -2px rgba(196,98,60,.5)' }}
          >
            {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon name="rocket_launch" size={18} />}
            Push {pushRows.length} day{pushRows.length === 1 ? '' : 's'} ({decimalToHHMM(pushRows.reduce((s, r) => s + r.pushOT, 0))})
          </Button>
        )}
      </div>

      {msg && <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text2)' }}>{msg}</p>}
      {attWarn && (
        <p style={{ margin: '0 0 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="warning" size={16} /> {attWarn}
        </p>
      )}
      {days.length > 0 && !acConnected && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--warning)' }}>Connect an ActiveCollab session (top-bar “Not connected”) to enable pushing.</p>
      )}

      {days.length > 0 && (
        <>
          {/* stat tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 12, marginBottom: 20 }}>
            <Stat label="Punch total" hhmm={decimalToHHMM(punchTotal)} subIcon="schedule" sub={`${dec2(punchTotal)} h · attendance`} />
            <Stat label="AC total" hhmm={decimalToHHMM(apiTotal)} sub={`${dec2(apiTotal)} h · ActiveCollab`} />
            <Stat label="Overtime to push" hhmm={decimalToHHMM(comp.totalPush)} accent
              sub={`${comp.daysToPush} day${comp.daysToPush === 1 ? '' : 's'}${alreadyPushedCount ? ` · ${alreadyPushedCount} pushed ✓` : ''}`} />
            <Stat label="Bank (manual)" hhmm={decimalToHHMM(comp.bankTotal)} tone="bank" sub={`${dec2(comp.bankTotal)} h · <25 min`} />
            <Stat label="Under hours" hhmm={(comp.totalShort > 0 ? '−' : '') + decimalToHHMM(comp.totalShort)}
              tone={comp.totalShort > 0 ? 'under' : undefined} sub={`${dec2(comp.totalShort)} h · info`} />
            <Stat label="Remaining OT" hhmm={(remainingOt < 0 ? '−' : '') + decimalToHHMM(Math.abs(remainingOt))}
              tone={remainingOt < 0 ? 'under' : remainingOt > 0 ? 'over' : undefined}
              sub={`${dec2(remainingOt)} h · push − under`} />
            <Stat label="Already pushed" hhmm={decimalToHHMM(pushedTotalHrs)}
              tone={pushedTotalHrs > 0 ? 'ok' : undefined}
              subIcon={pushedDaysCount ? 'verified' : undefined}
              sub={acConnected ? `${dec2(pushedTotalHrs)} h · ${pushedDaysCount} day${pushedDaysCount === 1 ? '' : 's'} in AC` : 'connect AC to verify'} />
          </div>

          {/* day table */}
          <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
            <div className="tablewrap" style={{ overflowX: 'auto' }}>
              <table className="tasks" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    <th style={{ textAlign: 'left', padding: '11px 20px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }} title="Punch / attendance total hours — the overtime basis">Total (punch)</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }} title="Hours logged against ActiveCollab tasks">AC hours</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }}>Over–under</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }}>Result</th>
                    <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--text3)' }}>Day task</th>
                    <th style={{ width: 70 }} />
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => {
                    const st = rowStatus[r.date];
                    const weekend = r.isWeekend ?? isWeekend(r.date);
                    if (r.inProgress) {
                      // still logged in today — punch not final, so no overtime yet
                      return (
                        <tr key={r.date} style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                          <td style={{ padding: '13px 20px', verticalAlign: 'middle' }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{dayLabel(r.date)}</div>
                            {weekend && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning)', marginTop: 1 }}>weekend · all OT</div>}
                          </td>
                          <td style={{ padding: '13px 14px', verticalAlign: 'middle' }}>
                            <span className="pill wait" style={{ fontSize: 10 }}>in progress</span>
                          </td>
                          <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontFamily: 'var(--mono)' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{decimalToHHMM(r.acHours)}</span>{' '}
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{dec2(r.acHours)}h</span>
                          </td>
                          <td style={{ padding: '13px 14px', verticalAlign: 'middle', color: 'var(--text3)' }}>—</td>
                          <td style={{ padding: '13px 14px', verticalAlign: 'middle' }}><span className="pill wait">not punched out</span></td>
                          <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontSize: 12.5, color: 'var(--text2)', maxWidth: 300 }}>
                            {r.topTask ? <span title={r.topTask.description || r.topTask.name}>{r.topTask.name}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                          </td>
                          <td />
                        </tr>
                      );
                    }
                    const devColor = r.deviation > 0.0001 ? 'var(--success)' : r.deviation < -0.0001 ? 'var(--error)' : 'var(--text3)';
                    const acDelta = +(r.acHours - r.hours).toFixed(2); // AC vs punch difference
                    return (
                      <tr key={r.date} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '13px 20px', verticalAlign: 'middle' }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{dayLabel(r.date)}</div>
                          {weekend && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning)', marginTop: 1 }}>weekend · all OT</div>}
                        </td>
                        {/* Total (punch) — the overtime basis */}
                        <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontFamily: 'var(--mono)' }}>
                          {r.punchHours != null ? (
                            <>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{decimalToHHMM(r.punchHours)}</span>{' '}
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{dec2(r.punchHours)}h</span>
                            </>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text3)' }} title="No punch record — overtime uses ActiveCollab hours for this day">— <span style={{ fontSize: 10 }}>(AC)</span></span>
                          )}
                        </td>
                        {/* AC hours */}
                        <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontFamily: 'var(--mono)' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{decimalToHHMM(r.acHours)}</span>{' '}
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{dec2(r.acHours)}h</span>
                          {r.punchHours != null && Math.abs(acDelta) >= 0.02 && (
                            <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: 'var(--info-light)', color: 'var(--info)' }} title="ActiveCollab minus punch">
                              Δ {acDelta > 0 ? '+' : '−'}{decimalToHHMM(Math.abs(acDelta))}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)', color: devColor }}>
                          {signedHHMM(r.deviation)} <span style={{ fontSize: 11, opacity: .7 }}>· {r.deviation >= 0 ? '+' : '−'}{dec2(Math.abs(r.deviation))}</span>
                        </td>
                        <td style={{ padding: '13px 14px', verticalAlign: 'middle' }}>
                          {r.status === 'push' && <span className="pill ok">push {decimalToHHMM(r.pushOT)} · {dec2(r.pushOT)}h</span>}
                          {r.status === 'bank' && <span className="pill warn">bank {decimalToHHMM(r.banked)} · {dec2(r.banked)}h</span>}
                          {r.status === 'short' && <span className="pill err">short</span>}
                          {r.status === 'on' && <span className="pill wait">on target</span>}
                        </td>
                        <td style={{ padding: '13px 14px', verticalAlign: 'middle', fontSize: 12.5, color: 'var(--text2)', maxWidth: 300 }}>
                          {r.topTask ? (
                            <span title={r.topTask.description || r.topTask.name}>
                              {r.topTask.name} <span style={{ fontSize: 11, color: 'var(--text3)' }}>{decimalToHHMM(r.topTask.hours)}</span>
                            </span>
                          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ padding: '13px 20px 13px 14px', verticalAlign: 'middle', textAlign: 'right' }}>
                          {pushedByDate[r.date] ? (
                            <span
                              title={`Already in ActiveCollab: ${dec2(pushedByDate[r.date].value)}h${pushedByDate[r.date].count > 1 ? ` across ${pushedByDate[r.date].count} expenses` : ''}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--success)' }}
                            >
                              <Icon name="verified" size={15} /> pushed {decimalToHHMM(pushedByDate[r.date].value)} <span style={{ fontWeight: 500, opacity: .8 }}>{dec2(pushedByDate[r.date].value)}h</span>
                            </span>
                          ) : r.status === 'push' && (
                            st?.ok
                              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--success)' }}><Icon name="check_circle" size={15} /> pushed</span>
                              : st?.err
                                ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--error)' }}>err {st.err}</span>
                                : <button
                                    title="Push this day"
                                    disabled={pushing || !acConnected}
                                    onClick={() => setConfirmRows([r])}
                                    style={{
                                      width: 32, height: 32, borderRadius: 8, border: '1px solid #E4B79F',
                                      background: 'var(--primary-light)', color: 'var(--primary)', cursor: 'pointer',
                                      display: 'inline-grid', placeItems: 'center', opacity: (pushing || !acConnected) ? .5 : 1,
                                    }}
                                  >
                                    <Icon name="rocket_launch" size={17} />
                                  </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', flexWrap: 'wrap', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text3)' }}>
              <span className="pill ok" style={{ fontSize: 10 }}>push</span><span>≥25 min → pushable in full ·</span>
              <span className="pill warn" style={{ fontSize: 10 }}>bank</span><span>&lt;25 min, accumulates (release manually) ·</span>
              <span className="pill err" style={{ fontSize: 10 }}>short</span><span>under 8h, shown only. The bank is never moved into a push automatically.</span>
            </div>
          </section>
        </>
      )}

      {/* push confirm */}
      <Dialog open={!!confirmRows} onOpenChange={(o) => !o && setConfirmRows(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push overtime as expenses</DialogTitle>
            <DialogDescription>
              {confirmRows?.length === 1
                ? <>Push <b>{dayLabel(confirmRows[0].date)}</b> — {decimalToHHMM(confirmRows[0].pushOT)} ({dec2(confirmRows[0].pushOT)}h) to ActiveCollab?</>
                : <>Push <b>{confirmRows?.length}</b> day{confirmRows && confirmRows.length > 1 ? 's' : ''} ({decimalToHHMM((confirmRows || []).reduce((s, r) => s + r.pushOT, 0))}) to ActiveCollab?</>}
            </DialogDescription>
          </DialogHeader>
          <div style={{ maxHeight: 240, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
            {(confirmRows || []).map((r) => (
              <div key={r.date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 12px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dayLabel(r.date)} · {r.topTask?.name || '—'}</span>
                <span style={{ marginLeft: 12, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{dec2(r.pushOT)}h</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRows(null)}>Cancel</Button>
            <Button onClick={() => { const rows = confirmRows || []; setConfirmRows(null); doPush(rows); }}>
              <Icon name="rocket_launch" size={16} /> Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notifyUi}
    </div>
  );
}
