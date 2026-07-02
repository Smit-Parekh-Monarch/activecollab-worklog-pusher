'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/Icon';
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
      <p className="su-intro">
        One row per work-log that has a <code>standup</code> block. Click any cell to copy it; <b>Copy</b> copies the whole row tab-separated for Excel/Sheets.
      </p>

      <div className="su-toolbar">
        <div className="su-search">
          <Icon name="search" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter rows…" />
        </div>
        <Button className="su-btn-dark" onClick={copyAll}><Icon name="content_copy" size={17} />Copy all rows</Button>
        <Button variant="outline" onClick={() => copyText(headerTSV(), 'Header row copied')}><Icon name="table_rows" size={17} />Copy header</Button>
        <Button variant="outline" onClick={loadAll} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon name="refresh" size={17} />}Reload
        </Button>
      </div>

      <div className="su-card">
        <table className="su-table">
          <thead>
            <tr>
              <th className="col-name">Name</th>
              <th className="col-project">Project</th>
              <th className="col-prog">In Progress &amp; ETA</th>
              <th>Completed</th>
              <th>Next in Queue</th>
              <th className="col-date">Date</th>
              <th className="col-act"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.rel}>
                <td className="col-name" title="Click to copy" onClick={() => copyText(r.name, 'Cell copied')}>{r.name || '—'}</td>
                <td className="col-project" title="Click to copy" onClick={() => copyText(r.project, 'Cell copied')}><span>{r.project || '—'}</span></td>
                <td title="Click to copy" onClick={() => copyText(r.inProgress.join('\n'), 'Cell copied')}><Bullets lines={r.inProgress} /></td>
                <td title="Click to copy" onClick={() => copyText(r.completed.join('\n'), 'Cell copied')}><Bullets lines={r.completed} /></td>
                <td title="Click to copy" onClick={() => copyText(r.next.join('\n'), 'Cell copied')}><Bullets lines={r.next} /></td>
                <td className="su-date">{r.date || '—'}</td>
                <td className="col-act"><Button variant="outline" size="sm" title="Copy row (tab-separated)" onClick={(e) => { e.stopPropagation(); copyText(rowTSV(r), 'Row copied (paste into Excel)'); }}><Icon name="content_copy" size={15} />Copy</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading
          ? <div className="su-empty"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading standups…</div>
          : empty && <div className="su-empty">{empty}</div>}
      </div>

      {!empty && (
        <div className="su-meta">
          <b>{visible.length} row{visible.length === 1 ? '' : 's'}</b> · click any cell to copy it · “Copy” copies the whole row tab-separated.
        </div>
      )}

      {notifyUi}
    </div>
  );
}
