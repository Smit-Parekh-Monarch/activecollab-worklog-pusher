import { parseCookieString, acFetch, originOf } from '@/lib/ac';

export const dynamic = 'force-dynamic';

// POST /api/expenses — read the project's existing expenses from ActiveCollab so
// the UI can VERIFY which overtime days were already pushed (and avoid double-pushing).
//
// Body: { base, projectId, cookie, csrf, from?, to?, categoryId?, userId?, maxPages? }
// Pages through /projects/{projectId}/expenses, filters to the given category
// (overtime) + user + date range, and returns them keyed by record date.
//
// Read-only: only GETs; never creates or edits anything.
function isoFromRecordDate(rd: any): string {
  const secs = typeof rd === 'number' ? rd : Number(rd);
  if (!Number.isFinite(secs)) return '';
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { base, projectId, cookie, csrf, from, to, categoryId, userId } = body || {};
  const maxPages = Math.min(Number(body?.maxPages) || 12, 30);

  if (!base || !projectId || !cookie) {
    return Response.json({ error: 'Missing base, projectId or cookie.' }, { status: 400 });
  }

  let origin: string;
  try { origin = originOf(base); }
  catch { return Response.json({ error: 'Invalid base URL: ' + base }, { status: 400 }); }

  const jar = parseCookieString(cookie);
  const ctx = { base, origin, projectId, fallbackCsrf: csrf };
  const wantCat = categoryId != null && categoryId !== '' ? Number(categoryId) : null;
  const wantUser = userId != null && userId !== '' ? Number(userId) : null;

  // byDate: date -> { value (summed), count, ids[], summaries[] }
  const byDate: Record<string, { value: number; count: number; ids: number[]; summaries: string[] }> = {};
  let matched = 0;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const res = await acFetch(jar, ctx, { method: 'GET', path: `/projects/${projectId}/expenses?page=${page}` });
      if (!res.ok) {
        if (page === 1) {
          return Response.json({ error: `ActiveCollab rejected the request (${res.status}) — your session may have expired; re-copy the cURL.`, code: res.status }, { status: 502 });
        }
        break; // a later page failing just ends paging
      }
      const list = Array.isArray(res.json?.expenses) ? res.json.expenses : [];
      if (!list.length) break;

      let oldestOnPage = '9999-99-99';
      for (const e of list) {
        const date = isoFromRecordDate(e.record_date);
        if (date && date < oldestOnPage) oldestOnPage = date;
        if (wantCat != null && Number(e.category_id) !== wantCat) continue;
        if (wantUser != null && Number(e.user_id) !== wantUser) continue;
        if (from && date && date < from) continue;
        if (to && date && date > to) continue;
        if (!date) continue;
        const slot = byDate[date] || (byDate[date] = { value: 0, count: 0, ids: [], summaries: [] });
        slot.value = +(slot.value + (Number(e.value) || 0)).toFixed(2);
        slot.count += 1;
        if (e.id) slot.ids.push(e.id);
        if (e.summary) slot.summaries.push(String(e.summary));
        matched++;
      }
      // stop once the page has scrolled past the start of the requested range
      if (from && oldestOnPage < from) break;
    }
  } catch (e: any) {
    return Response.json({ error: `Could not reach ActiveCollab — ${e?.message || e}.` }, { status: 502 });
  }

  return Response.json({ byDate, matched });
}
