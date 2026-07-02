import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// POST /api/portal-attendance — proxy the Monarch portal's attendance
// monthly-summary endpoint server-side (keeps the Bearer token off the browser
// network tab and avoids CORS).
//
// Body: { token, cookie?, year, month, host? }
// Returns the portal's JSON verbatim:
//   { status, data: { averageWorkingHours, dailyRecords: [{ date, totalHours, status, punchIn, punchOut, ... }] } }
//
// The endpoint identifies the user from the Bearer token (JWT) — no employeeId
// is required to read your own attendance. Read-only: it never writes anything.
const DEFAULT_HOST = 'https://api-portal.monarch-innovation.com';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { token, cookie, year, month } = body || {};
  const host = (body && body.host) || DEFAULT_HOST;
  if (!token || !year || !month) {
    return NextResponse.json({ error: 'Missing token, year or month.' }, { status: 400 });
  }

  const url = `${host.replace(/\/$/, '')}/api/attendance/monthly-summary`
    + `?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    'x-api-version': '1',
    origin: 'https://portal.monarch-innovation.com',
    referer: 'https://portal.monarch-innovation.com/',
  };
  if (cookie) headers.cookie = cookie.startsWith('monarch_auth=') ? cookie : `monarch_auth=${cookie}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not reach the portal API at ${host} — ${e?.message || e}.` },
      { status: 502 },
    );
  }

  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Attendance API rejected the request (${res.status}) — your token may have expired; re-copy the cURL.`, code: res.status, body: (text || '').slice(0, 300) },
      { status: 502 },
    );
  }
  if (!json) {
    return NextResponse.json({ error: 'Attendance API returned a non-JSON response.', body: (text || '').slice(0, 300) }, { status: 502 });
  }
  return NextResponse.json(json);
}
