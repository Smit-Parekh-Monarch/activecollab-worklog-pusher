'use client';
import { useState, useEffect } from 'react';
import { Upload, CloudDownload, Loader2, Check } from 'lucide-react';
import { parseHoursDecimal, decimalToHHMM, isWeekend } from '@/lib/overtime-core';
import { computePortalOvertime } from '@/lib/portal-overtime';
import { useSession } from '@/lib/store';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// one stat tile: big h:mm + true decimal underneath
function Stat({ label, hhmm, sub, tone }: { label: string; hhmm: string; sub: string; tone?: string }) {
  const color = tone === 'over' ? 'text-success' : tone === 'under' ? 'text-destructive' : tone === 'bank' ? 'text-warning' : tone === 'ok' ? 'text-success' : 'text-foreground';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{hhmm}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
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
  const [apiTotal, setApiTotal] = useState(0);
  const [msg, setMsg] = useState('');

  const [pushing, setPushing] = useState(false);
  const [rowStatus, setRowStatus] = useState<Record<string, any>>({});
  const [confirmRows, setConfirmRows] = useState<any[] | null>(null);

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
    try {
      const from = `${month}-01`;
      const to = `${month}-${String(lastDayOfMonth(month)).padStart(2, '0')}`;
      const res = await fetch('/api/portal-hours', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: portalToken, cookie: portalCookie, from, to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(`Load failed${data.code ? ` (${data.code})` : ''}: ${data.error || 'unknown'}`); toast('Load failed', 'err'); return; }
      const d = data.data || {};
      const norm = (d.dates || []).map(normalizeDay);
      setDays(norm);
      setApiTotal(parseHoursDecimal(d.totalHours || 0));
      setRowStatus({});
      setMsg(`Loaded ${norm.length} days · API total ${d.totalHours || '0:00'}`);
      toast(`Loaded ${norm.length} days`, 'ok');
    } catch (e: any) {
      setMsg('Load error: ' + (e?.message || e)); toast('Load error', 'err');
    } finally { setLoading(false); }
  }

  const comp = computePortalOvertime(days);
  const computedTotal = comp.totalLogged;
  const totalDelta = +(computedTotal - apiTotal).toFixed(2);
  const totalsMatch = Math.abs(totalDelta) < 0.05;

  const pushRows = comp.rows.filter((r) => r.status === 'push');
  const taskIdForRow = (r: any) => (r.topTask && r.topTask.taskId) || taskId;
  // summary = that day's ot_description from the work-log JSON (same as the
  // Overtime page); fall back to the day's top task, then a generated line.
  const summaryForRow = (r: any) =>
    descByDate[r.date] || (r.topTask && (r.topTask.name || r.topTask.description)) || `Overtime ${dec2(r.pushOT)}h on ${r.date}`;

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
    <div className="max-w-[1100px]">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Portal Hours</h1>
        <Badge variant="warning">test</Badge>
      </div>
      <p className="mt-1 mb-4 max-w-[780px] text-sm leading-relaxed text-muted-foreground">
        Loads your logged hours from the portal (<code>my-project-hours</code>) and works out overtime. A day with{' '}
        <b>25 min or more</b> over 8h is pushable that day; anything <b>under 25 min banks</b> and is{' '}
        <b>never auto-released</b> — you clear the bank manually. Weekends count fully. Timings are shown in{' '}
        <b>h:mm and true decimal</b> (the decimal is the value pushed to ActiveCollab).
      </p>

      {/* session status — the portal token lives in the shared session now */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="font-semibold">Portal token</span>
          <Badge variant={captured ? 'success' : 'secondary'}>{captured ? 'captured ✓' : 'needed'}</Badge>
          <span className="text-muted-foreground">
            {captured
              ? `Loaded from the shared session${portalCapturedAt ? '' : ''}.`
              : 'Paste the my-project-hours cURL in the top-bar Connect — it’s detected and stored automatically.'}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="font-semibold">Push to AC</span>
            <Badge variant={acConnected ? 'success' : 'secondary'}>{acConnected ? 'connected ✓' : 'connect to push'}</Badge>
          </span>
        </CardContent>
      </Card>

      {/* controls */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Month</label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[180px]" />
            </div>
            <Button onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
              {loading ? 'Loading…' : 'Load portal hours'}
            </Button>
            {days.length > 0 && (
              <Button variant="default" disabled={!pushRows.length || pushing || !acConnected}
                onClick={() => setConfirmRows(pushRows)} className="ml-auto">
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Push {pushRows.length} day{pushRows.length === 1 ? '' : 's'} ({decimalToHHMM(comp.totalPush)})
              </Button>
            )}
          </div>
          {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
          {days.length > 0 && !acConnected && (
            <p className="mt-2 text-sm text-warning">Connect an ActiveCollab session (top-bar “Not connected”) to enable pushing.</p>
          )}

          {days.length > 0 && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="API total" hhmm={decimalToHHMM(apiTotal)} sub={`${dec2(apiTotal)} h`} />
                <Stat label="Computed total" hhmm={decimalToHHMM(computedTotal)} tone={totalsMatch ? 'ok' : undefined}
                  sub={totalsMatch ? 'matches API ✓' : `off by ${totalDelta > 0 ? '+' : '−'}${decimalToHHMM(Math.abs(totalDelta))}`} />
                <Stat label="Overtime to push" hhmm={decimalToHHMM(comp.totalPush)} tone="over" sub={`${dec2(comp.totalPush)} h · ${comp.daysToPush} day${comp.daysToPush === 1 ? '' : 's'}`} />
                <Stat label="Bank (manual)" hhmm={decimalToHHMM(comp.bankTotal)} tone="bank" sub={`${dec2(comp.bankTotal)} h · <25 min`} />
                <Stat label="Under hours" hhmm={(comp.totalShort > 0 ? '−' : '') + decimalToHHMM(comp.totalShort)} tone={comp.totalShort > 0 ? 'under' : undefined} sub={`${dec2(comp.totalShort)} h · info`} />
              </div>

              <div className="mt-4 rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Logged</TableHead>
                      <TableHead>Over–under</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Day task</TableHead>
                      <TableHead className="text-right">Push</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comp.rows.map((r) => {
                      const st = rowStatus[r.date];
                      return (
                        <TableRow key={r.date}>
                          <TableCell>
                            <div className="font-medium">{dayLabel(r.date)}</div>
                            {r.isWeekend && <div className="text-[10px] text-warning">weekend · all OT</div>}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {decimalToHHMM(r.hours)} <span className="text-xs text-muted-foreground">· {dec2(r.hours)}h</span>
                          </TableCell>
                          <TableCell className={`tabular-nums ${r.deviation > 0.0001 ? 'text-success' : r.deviation < -0.0001 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {signedHHMM(r.deviation)} <span className="text-xs opacity-70">· {r.deviation >= 0 ? '+' : '−'}{dec2(Math.abs(r.deviation))}</span>
                          </TableCell>
                          <TableCell>
                            {r.status === 'push' && <Badge variant="success">push {decimalToHHMM(r.pushOT)} · {dec2(r.pushOT)}h</Badge>}
                            {r.status === 'bank' && <Badge variant="warning">bank {decimalToHHMM(r.banked)} · {dec2(r.banked)}h</Badge>}
                            {r.status === 'short' && <Badge variant="destructive">short</Badge>}
                            {r.status === 'on' && <Badge variant="secondary">on target</Badge>}
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            {r.topTask ? (
                              <span title={r.topTask.description || r.topTask.name} className="text-sm">
                                {r.topTask.name} <span className="text-xs text-muted-foreground">{decimalToHHMM(r.topTask.hours)}</span>
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.status === 'push' && (
                              st?.ok
                                ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Check className="h-3.5 w-3.5" /> pushed</span>
                                : st?.err
                                  ? <span className="text-xs font-semibold text-destructive">err {st.err}</span>
                                  : <Button size="sm" variant="outline" disabled={pushing || !acConnected} onClick={() => setConfirmRows([r])}>Push</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                <Badge variant="success" className="mr-1">push</Badge> ≥25 min → pushable in full ·
                <Badge variant="warning" className="mx-1">bank</Badge> &lt;25 min, accumulates (release manually) ·
                <Badge variant="destructive" className="mx-1">short</Badge> under 8h (shown only). The bank is never moved into a push automatically.
              </p>
            </>
          )}
        </CardContent>
      </Card>

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
          <div className="max-h-[240px] overflow-y-auto rounded-md border border-border text-sm">
            {(confirmRows || []).map((r) => (
              <div key={r.date} className="flex items-center justify-between border-b border-border px-3 py-1.5 last:border-0">
                <span className="truncate">{dayLabel(r.date)} · {r.topTask?.name || '—'}</span>
                <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">{dec2(r.pushOT)}h</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRows(null)}>Cancel</Button>
            <Button onClick={() => { const rows = confirmRows || []; setConfirmRows(null); doPush(rows); }}>
              <Upload className="h-4 w-4" /> Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notifyUi}
    </div>
  );
}
