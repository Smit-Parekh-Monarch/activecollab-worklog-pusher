'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/store';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/',          label: 'Dashboard', icon: 'grid-outline' },
  { href: '/worklogs',  label: 'Work-logs', icon: 'list-outline' },
  { href: '/overtime',  label: 'Overtime',  icon: 'time-outline' },
  { href: '/portal-hours', label: 'Portal Hours', icon: 'cloud-download-outline' },
  { href: '/figma',     label: 'Figma',     icon: 'color-palette-outline' },
  { href: '/standup',   label: 'Standup',   icon: 'people-outline' },
];

function relTime(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

export default function Shell({ children }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState(null);

  const cookie = useSession((s) => s.cookie);
  const csrf = useSession((s) => s.csrf);
  const capturedAt = useSession((s) => s.capturedAt);
  const curl = useSession((s) => s.curl);
  const portalToken = useSession((s) => s.portalToken);
  const portalCapturedAt = useSession((s) => s.portalCapturedAt);
  const applyCurl = useSession((s) => s.applyCurl);
  const forget = useSession((s) => s.forget);

  const portalOn = mounted && !!portalToken;

  // avoid hydration mismatch — store is client-only
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setDraft(curl || ''); }, [curl]);

  const connected = mounted && !!(cookie && csrf);

  function doConnect() {
    const p = applyCurl(draft);
    if (p.ok) {
      setMsg({ ok: true, text: p.kind === 'portal' ? 'Portal token captured ✓' : 'ActiveCollab session captured ✓' });
      setTimeout(() => setConnectOpen(false), 800);
    } else setMsg({ ok: false, text: 'Missing ' + p.missing.join(' & ') + ' — check the cURL' });
  }

  return (
    <div className="dash">
      {/* sidebar */}
      <aside className="dash-side">
        <div className="dash-logo">
          <ion-icon name="cloud-upload-outline" />
          <span>Pusher</span>
        </div>
        <nav className="dash-nav">
          {NAV.slice(0, 4).map((n) => (
            <a key={n.href} href={n.href} className={'dash-navitem' + (pathname === n.href ? ' on' : '')}>
              <ion-icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          <div className="dash-navsep" />
          {NAV.slice(4).map((n) => (
            <a key={n.href} href={n.href} className={'dash-navitem' + (pathname === n.href ? ' on' : '')}>
              <ion-icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="dash-side-foot">Monarch Innovation</div>
      </aside>

      {/* main column */}
      <div className="dash-main">
        <header className="dash-top">
          <button className={'dash-conn ' + (connected ? 'on' : 'off')} onClick={() => setConnectOpen((v) => !v)}>
            <span className="dot" />
            {connected ? 'Session active' + (capturedAt ? ' · ' + relTime(capturedAt) : '') : 'Not connected'}
            <ion-icon name="chevron-down-outline" />
          </button>
          {portalOn && (
            <span className="dash-portal" title={'Portal token captured' + (portalCapturedAt ? ' · ' + relTime(portalCapturedAt) : '')}>
              <ion-icon name="cloud-download-outline" /> Portal
            </span>
          )}
          {(connected || portalOn) && (
            <button className="dash-forget" onClick={() => { forget(); setDraft(''); setMsg(null); }} title="Forget all sessions">
              <ion-icon name="log-out-outline" />
            </button>
          )}
        </header>

        {connectOpen && (
          <div className="dash-connect">
            <label>Paste a <b>Copy as cURL</b> — either the <b>ActiveCollab</b> request (cookie + CSRF, for work-logs &amp; overtime)
              <i> or</i> the <b>Portal</b> <code>my-project-hours</code> request (Bearer token, for Portal Hours).
              It&apos;s detected automatically and shared across every tool.</label>
            <textarea rows={4} value={draft} spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="curl 'http://…/projects/6070/tasks' -H 'X-Angie-CsrfValidator: …' -b '…' --data-raw '{…}'" />
            <div className="dash-connect-actions">
              <Button onClick={doConnect}>
                <ion-icon name="flash-outline" />Capture session
              </Button>
              {msg && <span className={'dash-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</span>}
            </div>
          </div>
        )}

        <main className="dash-body">{children}</main>
      </div>
    </div>
  );
}
