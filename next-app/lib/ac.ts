// ActiveCollab HTTP client + cookie-jar helpers.
// Ported verbatim (behaviour-preserving) from the original Express server.js.

export function parseCookieString(str) {
  const jar = {};
  if (!str) return jar;
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) jar[k] = v;
  }
  return jar;
}

export function jarToCookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function updateJarFromSetCookie(jar, setCookies) {
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i === -1) continue;
    const k = first.slice(0, i).trim();
    const v = first.slice(i + 1).trim();
    if (k) jar[k] = v;
  }
}

// ActiveCollab uses the double-submit cookie pattern: the X-Angie-CsrfValidator
// header must equal the (URL-decoded) activecollab_csrf_validator_for_* cookie.
export function csrfFromJar(jar, fallback) {
  const key = Object.keys(jar).find((k) => k.startsWith('activecollab_csrf_validator_for_'));
  if (key) {
    try { return decodeURIComponent(jar[key]); } catch { return jar[key]; }
  }
  return fallback || '';
}

// Single AC request. ctx = { base, origin, projectId, fallbackCsrf }.
export async function acFetch(
  jar: Record<string, string>,
  ctx: { base: string; origin: string; projectId: string | number; fallbackCsrf?: string },
  { method, path, body }: { method: string; path: string; body?: unknown }
) {
  const url = ctx.base + path;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Angie-CsrfValidator': csrfFromJar(jar, ctx.fallbackCsrf),
    Cookie: jarToCookieHeader(jar),
    Origin: ctx.origin,
    Referer: `${ctx.origin}/activecollab/projects/${ctx.projectId}`,
    'User-Agent': 'Mozilla/5.0 ActiveCollabWorklogPusher',
  };

  let payload;
  if (body === null) {
    payload = '';
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch (e) {
    throw e;
  }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  updateJarFromSetCookie(jar, setCookies);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, json, text };
}

export const snippet = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 300);

// Resolve { origin } from a base URL, throwing a friendly error if it's bad.
export function originOf(base) {
  return new URL(base).origin;
}
