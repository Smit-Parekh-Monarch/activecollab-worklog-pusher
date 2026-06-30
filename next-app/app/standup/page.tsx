'use client';

import { useState, useEffect, useCallback } from 'react';
import { Copy, RefreshCw, Loader2 } from 'lucide-react';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import './standup.css';

// One row per work-log that carries a `standup` block. Excel-friendly:
// click a cell to copy it, "Copy" copies the whole row tab-separated.
const COLS = ['Name', 'Project', 'In Progress & ETA', 'Completed', 'Next in Queue'];

interface Row {
  rel: string;
  date: string;
  name: string;
  project: string;
  inProgress: string[];
  completed: string[];
  next: string[];
}

function asLines(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v).split('\n').map((x) => x.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
}

// Excel/Sheets: wrap a cell in quotes (doubled) if it has newline/tab/quote,
// so multi-line bullets stay inside one cell.
function tsvCell(v: string): string {
  const s = v == null ? '' : String(v);
  return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function rowTSV(r: Row): string {
  return [r.name, r.project, r.inProgress.join('\n'), r.completed.join('\n'), r.next.join('\n')]
    .map(tsvCell).join('\t');
}
function headerTSV(): string { return COLS.map(tsvCell).join('\t'); }

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [empty, setEmpty] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast, ui: notifyUi } = useNotify();

  async function copyText(text: string, msg: string) {
    try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); }
    catch { toast('Copy failed', 'err'); }
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    let list: any[];
    try {
      const r = await fetch('/api/worklogs');
      list = (await r.json()).files || [];
    } catch {
      setRows([]); setEmpty('Could not reach the server.'); setLoading(false); return;
    }
    const built: Row[] = [];
    for (const f of list) {
      if (!f.valid) continue;
      let json: any;
      try {
        const r = await fetch('/api/worklog?path=' + encodeURIComponent(f.rel));
        json = await r.json();
      } catch { continue; }
      const s = json && json.standup;
      if (!s) continue; // only work-logs with a standup block
      const tasks = Array.isArray(json) ? json : (json.tasks || []);
      built.push({
        rel: f.rel,
        date: f.date || '',
        name: s.name || '',
        project: s.project || '',
        inProgress: asLines(s.inProgress),
        completed: s.completed ? asLines(s.completed)
          : tasks.map((t: any) => (t.body || t.name || '').trim()).filter(Boolean),
        next: asLines(s.next),
      });
    }
    setRows(built);
    setEmpty(built.length ? null : 'No work-logs with a "standup" block yet. Add a `standup` object to a daily JSON.');
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('worklogs', () => loadAll());
      return () => es.close();
    } catch {}
  }, [loadAll]);

  const f = filter.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (!f) return true;
    return [r.name, r.project, ...r.inProgress, ...r.completed, ...r.next].join(' ').toLowerCase().includes(f);
  });

  function copyAll() {
    const out = [headerTSV(), ...visible.map(rowTSV)].join('\n');
    copyText(out, 'All rows + header copied (paste into Excel)');
  }

  const Bullets = ({ lines }: { lines: string[] }) => (
    <ul className="su-bullets">
      {(lines.length ? lines : ['—']).map((l, i) => <li key={i}>{l}</li>)}
    </ul>
  );

  return (
    <div>
      <h1 style={{ margin: '0 0 2px', fontSize: 24 }}>Standup</h1>
      <p style={{ margin: '0 0 14px', color: 'var(--text2)', fontSize: 14 }}>
        One row per work-log that has a <code>standup</code> block. Click any cell to copy it; <b>Copy</b> copies the whole row tab-separated for Excel/Sheets.
      </p>

      <div className="su-toolbar">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter rows…" />
        <Button onClick={copyAll}><Copy className="h-4 w-4" />Copy all rows</Button>
        <Button variant="outline" onClick={() => copyText(headerTSV(), 'Header row copied')}>Copy header</Button>
        <Button variant="ghost" onClick={loadAll} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Reload
        </Button>
      </div>

      <div className="su-card">
        <div className="su-tablewrap">
          <table className="su-table">
            <thead>
              <tr>
                {COLS.map((c) => <th key={c}>{c}</th>)}
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.rel}>
                  <td className="col-name" title="Click to copy" onClick={() => copyText(r.name, 'Cell copied')}>{r.name || '—'}</td>
                  <td className="col-project" title="Click to copy" onClick={() => copyText(r.project, 'Cell copied')}>{r.project || '—'}</td>
                  <td title="Click to copy" onClick={() => copyText(r.inProgress.join('\n'), 'Cell copied')}><Bullets lines={r.inProgress} /></td>
                  <td title="Click to copy" onClick={() => copyText(r.completed.join('\n'), 'Cell copied')}><Bullets lines={r.completed} /></td>
                  <td title="Click to copy" onClick={() => copyText(r.next.join('\n'), 'Cell copied')}><Bullets lines={r.next} /></td>
                  <td className="su-date">{r.date || '—'}</td>
                  <td><Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); copyText(rowTSV(r), 'Row copied (paste into Excel)'); }}><Copy className="h-3.5 w-3.5" />Copy</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading
          ? <div className="su-empty"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading standups…</div>
          : empty && <div className="su-empty">{empty}</div>}
      </div>

      {!empty && (
        <div className="su-meta">
          {visible.length} row{visible.length === 1 ? '' : 's'} · click any cell to copy it · “Copy” copies the whole row tab-separated.
        </div>
      )}

      {notifyUi}
    </div>
  );
}
