'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/store';
import { computeMonthlyOvertime, groupByMonth, isoDateFromFile, decimalToHHMM } from '@/lib/overtime-core';

const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const d = +iso.slice(8, 10), m = +iso.slice(5, 7);
  return d + ' ' + MONS[m - 1];
}

export default function Page() {
  const [files, setFiles] = useState([]);
  const cookie = useSession((s) => s.cookie);
  const csrf = useSession((s) => s.csrf);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    fetch('/api/worklogs').then((r) => r.json())
      .then((d) => setFiles((d.files || []).filter((f) => f.valid !== false)))
      .catch(() => {});
  }, []);

  const connected = mounted && !!(cookie && csrf);

  // latest month's overtime, for the headline card. Days already pushed
  // (recorded in each work-log's ot_pushed) are excluded from "ready to push".
  const months = groupByMonth(files);
  const latestKey = [...months.keys()][0];
  let otPush = 0, otDays = 0, otPushedAlready = 0, monthLabel = '—';
  if (latestKey) {
    const monthFiles = months.get(latestKey) || [];
    const pushedByDate = {};
    for (const f of monthFiles) {
      const recs = Array.isArray(f.otPushed) ? f.otPushed : [];
      const sum = recs.reduce((s, p) => s + (Number(p.value) || 0), 0);
      if (sum > 0) pushedByDate[isoDateFromFile(f)] = sum;
      otPushedAlready += sum;
    }
    const days = monthFiles.map((f) => ({ date: isoDateFromFile(f), hours: Number(f.hours) || 0 }));
    const r = computeMonthlyOvertime(days, { standardDay: 8 });
    const pushRows = r.rows.filter((x) => x.pushedOT > 0 && !pushedByDate[x.date]);
    otPush = pushRows.reduce((s, x) => s + x.pushedOT, 0);
    otDays = pushRows.length;
    const [y, m] = latestKey.split('-');
    monthLabel = MONS[+m - 1] + ' ' + y;
  }

  const totalHours = files.reduce((s, f) => s + (Number(f.hours) || 0), 0);
  const pushedCount = files.filter((f) => f.pushed).length;
  const recent = [...files].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);

  return (
    <div>
      <h1 style={{ margin: '0 0 2px', fontSize: 24 }}>Dashboard</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--text2)', fontSize: 14 }}>
        Push ActiveCollab work-logs and overtime from one place.
        {!connected && <> Paste a cURL via <b>Not connected</b> in the top bar to begin.</>}
      </p>

      <div className="ov-grid">
        <div className="ov-card">
          <div className="k"><ion-icon name="documents-outline" />Work-logs</div>
          <div className="v">{files.length}</div>
          <div className="s">{pushedCount} pushed · {totalHours.toFixed(1)}h total</div>
        </div>
        <div className="ov-card">
          <div className="k"><ion-icon name="time-outline" />Overtime · {monthLabel}</div>
          <div className="v">{decimalToHHMM(otPush)}</div>
          <div className="s">{otDays} day{otDays === 1 ? '' : 's'} ready to push{otPushedAlready > 0 ? ` · ${decimalToHHMM(otPushedAlready)} pushed` : ''}</div>
        </div>
        <div className="ov-card">
          <div className="k"><ion-icon name="pulse-outline" />Session</div>
          <div className="v" style={{ fontSize: 20, color: connected ? 'var(--success)' : 'var(--text3)' }}>
            {mounted ? (connected ? 'Active' : 'Not connected') : '…'}
          </div>
          <div className="s">{connected ? 'cookie + CSRF captured' : 'paste a cURL to connect'}</div>
        </div>
      </div>

      <div className="ov-h">Tools</div>
      <div className="ov-tools" style={{ marginBottom: 26 }}>
        <a className="ov-tool" href="/worklogs">
          <div className="ic"><ion-icon name="list-outline" /></div>
          <div>
            <h3>Work-log Pusher</h3>
            <p>Pick a work-log JSON, review the tasks, then create → log hours → complete each in ActiveCollab.</p>
          </div>
        </a>
        <a className="ov-tool" href="/overtime">
          <div className="ic"><ion-icon name="time-outline" /></div>
          <div>
            <h3>Overtime → Expenses</h3>
            <p>Convert a month of overtime (weekends count fully) into ActiveCollab expenses, with auto-filled task.</p>
          </div>
        </a>
      </div>

      <div className="ov-h">Recent work-logs</div>
      <div className="ov-tools">
        {recent.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>No work-logs found yet.</p>}
        {recent.map((f) => (
          <a key={f.rel} className="ov-tool" href="/worklogs">
            <div className="ic" style={{ background: f.pushed ? 'var(--success-light)' : 'var(--primary-light)', color: f.pushed ? 'var(--success)' : 'var(--primary-dark)' }}>
              <ion-icon name={f.pushed ? 'checkmark-done-outline' : 'document-text-outline'} />
            </div>
            <div>
              <h3 style={{ fontSize: 14 }}>{fmtDate(f.date)}</h3>
              <p>{f.count} task{f.count === 1 ? '' : 's'} · {(Number(f.hours) || 0).toFixed(2)}h{f.pushed ? ' · pushed' : ''}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
