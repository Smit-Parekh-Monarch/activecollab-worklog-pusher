'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/Icon';
import './figma.css';

// One parsed CSV row keyed by header name, plus the raw cells for ordered rendering.
type Row = Record<string, string>;

// --- minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines in quotes) ---
// Ported from csv-figmachanegs/index.html.
function parseCSV(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.length && !(r.length === 1 && r[0].trim() === ''));
}

export default function Page() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast, ui: notifyUi } = useNotify();

  // Turn parsed grid into typed state. First row = headers.
  const load = useCallback((text: string) => {
    const grid = parseCSV(text);
    if (!grid.length) {
      setHeaders([]);
      setRows([]);
      return;
    }
    const hdr = grid[0];
    const body: Row[] = grid.slice(1).map((cells) => {
      const r: Row = {};
      hdr.forEach((h, i) => { r[h] = cells[i] ?? ''; });
      return r;
    });
    setHeaders(hdr);
    setRows(body);
    setError('');
  }, []);

  // Auto-load the CSV that ships under public/figma/.
  const reload = useCallback(() => {
    setLoading(true);
    fetch('/figma/figma-changes.csv')
      .then((r) => { if (!r.ok) throw new Error('not ok'); return r.text(); })
      .then(load)
      .catch(() => {
        setHeaders([]);
        setRows([]);
        setError('Could not auto-load figma-changes.csv — choose the file manually below.');
      })
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    reload();
    // optional live refresh — reuse the dashboard SSE stream; never crash if unsupported
    let es: EventSource | undefined;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('worklogs', () => reload());
    } catch { /* EventSource unavailable — manual Reload still works */ }
    return () => { try { es?.close(); } catch { /* noop */ } };
  }, [reload]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => load(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  const statusIdx = headers.findIndex((h) => h.toLowerCase() === 'status');

  // Excel-friendly TSV (quote cells containing tab/newline/quote), like the Standup table.
  const tsvCell = (v: string) => (/[\t\n"]/.test(v || '') ? '"' + (v || '').replace(/"/g, '""') + '"' : (v || ''));
  const rowTSV = (row: Row) => headers.map((h) => tsvCell(row[h] ?? '')).join('\t');
  const copy = (text: string, msg = 'Copied') => {
    try { navigator.clipboard?.writeText(text); toast(msg, 'ok'); }
    catch { toast('Copy failed', 'err'); }
  };
  const copyAll = () => copy([headers.map(tsvCell).join('\t'), ...rows.map(rowTSV)].join('\n'), `All ${rows.length} rows copied`);

  return (
    <div className="page view-enter">
      <section className="fg-card">
        <div className="fg-head">
          <div>
            <div className="fg-head-title">Recent design changes</div>
            <div className="fg-head-sub">Edits and updates to existing pages · click any cell to copy.</div>
          </div>
          <div className="fg-head-actions">
            <Button type="button" onClick={copyAll} disabled={!rows.length}>
              <Copy className="h-4 w-4" />
              Copy all rows
            </Button>
            <Button type="button" variant="ghost" onClick={reload} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon name="refresh" size={16} />}
              Refresh
            </Button>
          </div>
        </div>

        {loading && headers.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><Loader2 className="h-7 w-7 animate-spin" /></div>
            <h3>Loading…</h3>
            <p>Reading figma-changes.csv</p>
          </div>
        ) : headers.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><Icon name="description" size={28} /></div>
            <h3>No CSV loaded</h3>
            <p>{error || 'Nothing to show yet.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="figma-table">
              <thead>
                <tr>{headers.map((h) => <th key={h}>{h}</th>)}<th></th></tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {headers.map((h, ci) => {
                      const cell = row[h] ?? '';
                      const isStatus = ci === statusIdx && cell.trim() !== '';
                      const done = cell.trim().toLowerCase() === 'done';
                      return (
                        <td
                          key={h}
                          className="copyable"
                          title="Click to copy this cell"
                          onClick={() => copy(cell, 'Cell copied')}
                        >
                          {isStatus
                            ? <span className={`pill ${done ? 'ok' : 'warn'}`}>{cell.trim()}</span>
                            : ci === 0 && cell.trim() !== ''
                              ? <span className="fg-pagetag">{cell}</span>
                              : cell}
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        title="Copy row"
                        className="fg-iconbtn"
                        onClick={(e) => { e.stopPropagation(); copy(rowTSV(row), 'Row copied'); }}
                      >
                        <Icon name="content_copy" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
        Auto-loads <code>/figma/figma-changes.csv</code>. If it does not load,{' '}
        <label style={{ color: 'var(--primary-dark)', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}>
          choose the CSV manually
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onPickFile} />
        </label>.
      </p>
      {notifyUi}
    </div>
  );
}
