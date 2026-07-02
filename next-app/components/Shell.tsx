'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/Icon';

const NAV_MAIN = [
  { href: '/',             label: 'Dashboard',    icon: 'grid_view' },
  { href: '/worklogs',     label: 'Work-logs',    icon: 'checklist' },
  { href: '/overtime',     label: 'Overtime',     icon: 'schedule' },
  { href: '/portal-hours', label: 'Portal Hours', icon: 'cloud_download' },
];
const NAV_REF = [
  { href: '/figma',   label: 'Figma',   icon: 'palette' },
  { href: '/standup', label: 'Standup', icon: 'groups' },
];

const PAGES: Record<string, { title: string; desc: string }> = {
  '/':             { title: 'Dashboard',           desc: 'Push ActiveCollab work-logs and overtime from one place.' },
  '/worklogs':     { title: 'Work-log Pusher',     desc: 'Turn a day of work into ActiveCollab tasks — in one go.' },
  '/overtime':     { title: 'Overtime → Expenses', desc: 'Convert a month of overtime into pushable expenses.' },
  '/portal-hours': { title: 'Portal Hours',        desc: 'Load logged hours from the portal and push overtime.' },
  '/figma':        { title: 'Figma changes',       desc: 'Edits and updates to existing pages — copy any cell.' },
  '/standup':      { title: 'Standup',             desc: 'One row per work-log, ready to paste into your standup sheet.' },
};

export default function Shell({ children }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [draftAc, setDraftAc] = useState('');
  const [draftPortal, setDraftPortal] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cookie = useSession((s) => s.cookie);
  const csrf = useSession((s) => s.csrf);
  const curl = useSession((s) => s.curl);
  const portalCurl = useSession((s) => s.portalCurl);
  const portalToken = useSession((s) => s.portalToken);
  const applyCurl = useSession((s) => s.applyCurl);
  const forget = useSession((s) => s.forget);

  // avoid hydration mismatch — store is client-only
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setDraftAc(curl || ''); }, [curl]);
  useEffect(() => { setDraftPortal(portalCurl || ''); }, [portalCurl]);
  // any page can open the Connect modal via window.dispatchEvent(new Event('pusher:connect'))
  useEffect(() => {
    const open = () => setConnectOpen(true);
    window.addEventListener('pusher:connect', open);
    return () => window.removeEventListener('pusher:connect', open);
  }, []);

  const connected = mounted && !!(cookie && csrf);
  const portalOn = mounted && !!portalToken;
  const page = PAGES[pathname] || { title: 'Pusher', desc: '' };

  // capture from one of the two boxes; applyCurl auto-detects AC vs Portal
  function capture(text: string) {
    if (!text.trim()) { setMsg({ ok: false, text: 'Paste a cURL first' }); return; }
    const p = applyCurl(text);
    if (p.ok) setMsg({ ok: true, text: p.kind === 'portal' ? 'Portal token captured ✓' : 'ActiveCollab session captured ✓' });
    else setMsg({ ok: false, text: 'Missing ' + p.missing.join(' & ') + ' — check the cURL' });
  }

  return (
    <div className="app-shell">
      {/* ============ SIDEBAR ============ */}
      <aside className="sb">
        <div className="sb-brand">
          <div className="sb-logo"><Icon name="cloud_upload" /></div>
          <div className="sb-brand-txt">
            <div className="sb-brand-name">Pusher</div>
            <div className="sb-brand-org">Monarch Innovation</div>
          </div>
        </div>

        <div className="sb-sec">Workspace</div>
        <nav className="sb-nav">
          {NAV_MAIN.map((n) => (
            <a key={n.href} href={n.href} className={'sb-link' + (pathname === n.href ? ' on' : '')}>
              <Icon name={n.icon} /><span>{n.label}</span>
            </a>
          ))}
        </nav>

        <div className="sb-sec gap">Reference</div>
        <nav className="sb-nav">
          {NAV_REF.map((n) => (
            <a key={n.href} href={n.href} className={'sb-link' + (pathname === n.href ? ' on' : '')}>
              <Icon name={n.icon} /><span>{n.label}</span>
            </a>
          ))}
        </nav>

        <div className="sb-spacer" />

        <button className="sb-conn" onClick={() => setConnectOpen(true)}>
          <div className="sb-conn-top">
            <span className={'sb-conn-dot ' + (connected ? 'on' : 'off')} />
            <span className="sb-conn-title">{connected ? 'Session active' : 'Not connected'}</span>
          </div>
          <div className="sb-conn-chips">
            <span className={'c' + (connected ? ' on' : '')}>ActiveCollab</span>
            <span className={'c' + (portalOn ? ' on' : '')}>Portal</span>
          </div>
        </button>

        <div className="sb-user">
          <div className="sb-user-ava"><Icon name="person" /></div>
          <div className="sb-user-txt">
            <div className="sb-user-name">Monarch</div>
            <div className="sb-user-role">Local workspace</div>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-titles">
            <h1>{page.title}</h1>
            <p>{page.desc}</p>
          </div>
          <div className="topbar-right">
            {portalOn && (
              <span className="topbar-portal"><Icon name="cloud_download" /> Portal</span>
            )}
            <button className={'conn-pill ' + (connected ? 'on' : 'off')} onClick={() => setConnectOpen(true)}>
              <span className="dot" />
              {connected ? 'Session active' : 'Not connected'}
              <Icon name="expand_more" />
            </button>
          </div>
        </header>

        <main className="app-scroll">
          <div key={pathname} className="page view-enter">{children}</div>
        </main>
      </div>

      {/* ============ CONNECT MODAL ============ */}
      {connectOpen && (
        <div className="cx-overlay" onClick={(e) => { if (e.target === e.currentTarget) setConnectOpen(false); }}>
          <div className="cx-modal" role="dialog" aria-modal="true">
            <div className="cx-head">
              <div className="cx-head-ic"><Icon name="link" /></div>
              <div style={{ flex: 1 }}>
                <h3>Connections</h3>
                <p>Paste a request from your browser once — it&apos;s shared across every tool.</p>
              </div>
              <button className="cx-close" onClick={() => setConnectOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="cx-body">
              {/* ActiveCollab */}
              <div className="cx-sec">
                <div className="cx-sec-head">
                  <span className="t">ActiveCollab session</span>
                  <span className={'cx-chip ' + (connected ? 'on' : 'off')}>{connected ? 'connected ✓' : 'not connected'}</span>
                  <span className="aside">for work-logs &amp; overtime</span>
                </div>
                <p className="hint">In ActiveCollab DevTools → Network, right-click a request → <b>Copy as cURL</b>, then paste below.</p>
                <textarea spellCheck={false} value={draftAc}
                  onChange={(e) => setDraftAc(e.target.value)}
                  placeholder="curl 'https://…/projects/6070/tasks' -H 'X-Angie-CsrfValidator: …' -b '…'" />
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" onClick={() => capture(draftAc)}><Icon name="bolt" />Capture ActiveCollab</Button>
                </div>
              </div>
              {/* Portal */}
              <div className="cx-sec">
                <div className="cx-sec-head">
                  <span className="t">Portal token</span>
                  <span className={'cx-chip ' + (portalOn ? 'on' : 'off')}>{portalOn ? 'captured ✓' : 'optional'}</span>
                  <span className="aside">for the Portal Hours page</span>
                </div>
                <p className="hint">Copy the <code>my-project-hours</code> request as cURL from the portal.</p>
                <textarea spellCheck={false} value={draftPortal}
                  onChange={(e) => setDraftPortal(e.target.value)}
                  placeholder="curl '…/api/activecollab/my-project-hours?startDate=…' -H 'authorization: Bearer …'" />
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" variant="outline" onClick={() => capture(draftPortal)}><Icon name="cloud_download" />Capture Portal</Button>
                </div>
              </div>
              {msg && <span className={'cx-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</span>}
              {(connected || portalOn) && (
                <button className="cx-forget" onClick={() => { forget(); setDraftAc(''); setDraftPortal(''); setMsg(null); }}>
                  Forget all sessions
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
