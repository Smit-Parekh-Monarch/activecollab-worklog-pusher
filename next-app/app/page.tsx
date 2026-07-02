'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/store';
import { computeMonthlyOvertime, groupByMonth, isoDateFromFile, decimalToHHMM } from '@/lib/overtime-core';
import { Icon } from '@/components/Icon';

const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WDAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function parts(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return { d: +iso.slice(8, 10), m: +iso.slice(5, 7), y: +iso.slice(0, 4), wd: WDAY[d.getDay()] };
}
function fullDate(iso) {
  const p = parts(iso);
  return p ? `${p.wd}, ${p.d} ${MONS[p.m - 1]} ${p.y}` : '—';
}

function openConnect() { window.dispatchEvent(new Event('pusher:connect')); }

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
      {mounted && !connected && (
        <div className="dh-banner">
          <div className="dh-banner-ic"><Icon name="link" /></div>
          <div className="dh-banner-txt">
            <div className="t">Connect to start pushing</div>
            <div className="d">You can browse work-logs freely — connect an ActiveCollab session when you&apos;re ready to push.</div>
          </div>
          <button className="btn btn-primary" onClick={openConnect}><Icon name="link" />Connect now</button>
        </div>
      )}

      {/* stat cards */}
      <div className="dh-stats">
        <div className="dh-stat">
          <div className="dh-stat-top">
            <div className="dh-stat-ic" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}><Icon name="description" /></div>
            <span className="dh-stat-tag" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}>{pushedCount} pushed</span>
          </div>
          <div className="dh-stat-val">{files.length}</div>
          <div className="dh-stat-lbl">Work-logs found</div>
        </div>

        <div className="dh-stat">
          <div className="dh-stat-top">
            <div className="dh-stat-ic" style={{ background: 'var(--info-light)', color: 'var(--info)' }}><Icon name="schedule" /></div>
            <span className="dh-stat-tag" style={{ background: 'var(--info-light)', color: 'var(--info)' }}>{otDays} day{otDays === 1 ? '' : 's'}</span>
          </div>
          <div className="dh-stat-val">{decimalToHHMM(otPush)}</div>
          <div className="dh-stat-lbl">Overtime · {monthLabel}</div>
        </div>

        <div className="dh-stat">
          <div className="dh-stat-top">
            <div className="dh-stat-ic" style={{ background: 'var(--surface-hover)', color: 'var(--text2)' }}><Icon name="hourglass_empty" /></div>
            <span className="dh-stat-tag" style={{ background: 'var(--surface-hover)', color: 'var(--text3)' }}>total</span>
          </div>
          <div className="dh-stat-val">{totalHours.toFixed(0)}h</div>
          <div className="dh-stat-lbl">Hours logged</div>
        </div>

        <div className="dh-stat">
          <div className="dh-stat-top">
            <div className="dh-stat-ic" style={connected
              ? { background: 'var(--success-light)', color: 'var(--success)' }
              : { background: 'var(--surface-hover)', color: 'var(--text3)' }}>
              <Icon name={connected ? 'monitoring' : 'sensors_off'} />
            </div>
            <span className="dh-stat-tag" style={connected
              ? { background: 'var(--success-light)', color: 'var(--success)' }
              : { background: 'var(--primary-light)', color: 'var(--primary-dark)' }}>{connected ? 'live' : 'connect'}</span>
          </div>
          <div className="dh-stat-val" style={{ fontSize: 22, color: connected ? 'var(--success)' : 'var(--text3)' }}>
            {mounted ? (connected ? 'Active' : 'Off') : '…'}
          </div>
          <div className="dh-stat-lbl">{connected ? 'Session connected' : 'No session'}</div>
        </div>
      </div>

      {/* jump back in */}
      <div className="dh-sech">Jump back in</div>
      <div className="dh-tools">
        <a className="dh-tool" href="/worklogs">
          <div className="dh-tool-ic" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}><Icon name="rocket_launch" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dh-tool-h"><h3>Push work-logs</h3><Icon name="arrow_forward" /></div>
            <p>Pick a day, review the tasks, then create → log hours → complete each in ActiveCollab.</p>
          </div>
        </a>
        <a className="dh-tool" href="/overtime">
          <div className="dh-tool-ic" style={{ background: 'var(--info-light)', color: 'var(--info)' }}><Icon name="schedule" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dh-tool-h"><h3>Overtime → Expenses</h3><Icon name="arrow_forward" /></div>
            <p>Convert a month of overtime (weekends count fully) into ActiveCollab expenses.</p>
          </div>
        </a>
      </div>

      {/* recent */}
      <div className="dh-sech-row">
        <div className="dh-sech">Recent work-logs</div>
        <a href="/worklogs">View all →</a>
      </div>
      <div className="dh-recent">
        {recent.length === 0 && <div className="dh-empty">No work-logs found yet.</div>}
        {recent.map((f) => {
          const p = parts(f.date);
          return (
            <a key={f.rel} className="dh-recent-row" href="/worklogs">
              <div className="dh-cal">
                <span className="mon">{p ? MONS[p.m - 1].toUpperCase() : '—'}</span>
                <span className="day">{p ? p.d : '·'}</span>
              </div>
              <div className="dh-recent-main">
                <div className="t">{fullDate(f.date)}</div>
                <div className="m">{f.count} task{f.count === 1 ? '' : 's'} · {(Number(f.hours) || 0).toFixed(2)}h</div>
              </div>
              <span className="dh-badge" style={f.pushed
                ? { background: 'var(--success-light)', color: 'var(--success)' }
                : { background: 'var(--primary-light)', color: 'var(--primary-dark)' }}>
                {f.pushed ? 'pushed' : 'ready'}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
