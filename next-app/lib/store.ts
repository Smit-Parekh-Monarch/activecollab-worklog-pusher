'use client';

// Global session store (Zustand + persist). One source of truth for the
// ActiveCollab session, shared by every tool in the dashboard. Persisted to
// localStorage under 'ac_session_v1' so it survives refreshes.
//
// You paste a "Copy as cURL" from ActiveCollab once; parseCurl() extracts the
// cookie, CSRF token, base URL and the project/task/category/user ids. Both the
// task cURL (…/tasks) and the expense cURL (…/expenses) are understood.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function grabQuoted(s, flag) {
  let m = s.match(new RegExp(flag + "\\s+'([^']*)'")); if (m) return m[1];
  m = s.match(new RegExp(flag + '\\s+"((?:[^"\\\\]|\\\\.)*)"')); if (m) return m[1].replace(/\\"/g, '"');
  return '';
}

// Result of parsing a pasted cURL.
export interface ParsedCurl {
  ok: boolean;
  missing: string[];
  kind?: 'ac' | 'portal';
  curl?: string;
  cookie?: string;
  csrf?: string;
  base?: string;
  projectId?: string;
  taskListId?: string;
  categoryId?: string;
  userId?: string;
  taskId?: string;
  portalToken?: string;
  portalCookie?: string;
}

// A pasted cURL is the Monarch portal one (Bearer-token API) rather than the
// ActiveCollab one if it hits the portal host / my-project-hours, or carries a
// Bearer header without ActiveCollab's CSRF header.
export function isPortalCurl(c: string): boolean {
  const t = c || '';
  if (/api-portal\.monarch-innovation|my-project-hours/i.test(t)) return true;
  return /authorization:\s*bearer/i.test(t) && !/X-Angie-CsrfValidator/i.test(t);
}

export function parsePortalCurlString(c: string): ParsedCurl {
  const t = c || '';
  const token = (t.match(/authorization:\s*bearer\s+([A-Za-z0-9._-]+)/i) || [])[1] || '';
  const cookie = (t.match(/monarch_auth=([A-Za-z0-9._-]+)/i) || [])[1] || '';
  return { ok: !!token, missing: token ? [] : ['Bearer token'], kind: 'portal', curl: c, portalToken: token, portalCookie: cookie };
}

// Parse a cURL string into the fields we care about. Returns a partial session.
export function parseCurlString(c: string): ParsedCurl {
  c = (c || '').trim();
  if (!c) return { ok: false, missing: ['cookie', 'CSRF'] };
  const url = (c.match(/(https?:\/\/[^\s'"]+)/) || [])[1] || '';
  const pid = (url.match(/\/projects\/(\d+)/) || c.match(/\/projects\/(\d+)/) || [])[1] || '';
  let base = (url.match(/^(https?:\/\/.*\/api\/v\d+)/) || [])[1] || '';
  if (!base) base = (url.match(/^(https?:\/\/.*?)\/projects\//) || [])[1] || '';
  const cookie = grabQuoted(c, '(?:-b|--cookie)');
  const csrf = ((c.match(/X-Angie-CsrfValidator:\s*([^'"\n]+)/) || [])[1] || '').trim();
  const out: ParsedCurl = { ok: false, missing: [], cookie, csrf, curl: c };
  if (base) out.base = base;
  if (pid) out.projectId = pid;
  // ids that may appear in the --data-raw body of either cURL
  const tlid = (c.match(/"task_list_id"\s*:\s*(\d+)/) || [])[1];
  const cat = (c.match(/"category_id"\s*:\s*(\d+)/) || [])[1];
  const uid = (c.match(/"user_id"\s*:\s*(\d+)/) || [])[1];
  const tid = (c.match(/"task_id"\s*:\s*(\d+)/) || [])[1];
  if (tlid) out.taskListId = tlid;
  if (cat) out.categoryId = cat;
  if (uid) out.userId = uid;
  if (tid) out.taskId = tid;
  const missing = [];
  if (!cookie) missing.push('cookie');
  if (!csrf) missing.push('CSRF');
  out.ok = missing.length === 0;
  out.missing = missing;
  return out;
}

// Shape of the persisted session fields.
export interface SessionFields {
  curl: string;
  base: string;
  projectId: string;
  taskListId: string;
  userId: string;
  categoryId: string;
  taskId: string;
  source: string;
  billable: string;
  cookie: string;
  csrf: string;
  capturedAt: number | null;
  // Monarch portal (Bearer-token) session — used by the Portal Hours page.
  // portalCurl is the raw pasted cURL, kept so the Connect box repopulates —
  // exactly like `curl` does for the ActiveCollab session.
  portalCurl: string;
  portalToken: string;
  portalCookie: string;
  portalCapturedAt: number | null;
}

// Full store = fields + actions.
export interface SessionState extends SessionFields {
  setField: (k: keyof SessionFields, v: SessionFields[keyof SessionFields]) => void;
  setFields: (patch: Partial<SessionFields>) => void;
  applyCurl: (curl: string) => ReturnType<typeof parseCurlString>;
  forget: () => void;
  isConnected: () => boolean;
}

const DEFAULTS: SessionFields = {
  curl: '',
  base: 'http://192.168.200.198/activecollab/api/v1',
  projectId: '6070',
  taskListId: '32329',   // MIPL
  userId: '748',
  categoryId: '2',       // overtime category
  taskId: '',
  source: 'project_time',
  billable: '1',
  cookie: '',
  csrf: '',
  capturedAt: null,
  portalCurl: '',
  portalToken: '',
  portalCookie: '',
  portalCapturedAt: null,
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,

      // shallow field setter (also used by tool-specific id fields)
      setField: (k, v) => set({ [k]: v } as Partial<SessionState>),
      setFields: (patch) => set(patch),

      // parse a pasted cURL and merge the result into the session. Accepts EITHER
      // the ActiveCollab cURL (cookie + CSRF) or the Monarch portal cURL (Bearer).
      applyCurl: (curl) => {
        if (isPortalCurl(curl)) {
          const p = parsePortalCurlString(curl);
          // always remember the raw cURL (like the AC session does with `curl`)
          const patch: Partial<SessionFields> = { portalCurl: p.curl ?? curl };
          if (p.ok) { patch.portalToken = p.portalToken!; patch.portalCookie = p.portalCookie || ''; patch.portalCapturedAt = Date.now(); }
          set(patch);
          return p;
        }
        const p = parseCurlString(curl);
        const patch: Partial<SessionFields> = { curl: p.curl ?? curl };
        for (const k of ['base', 'projectId', 'taskListId', 'categoryId', 'userId', 'taskId', 'cookie', 'csrf'] as const) {
          if ((p as any)[k] != null && (p as any)[k] !== '') (patch as any)[k] = (p as any)[k];
        }
        if (p.ok) patch.capturedAt = Date.now();
        set(patch);
        return { ...p, kind: 'ac' as const }; // { ok, missing }
      },

      forget: () => set({ ...DEFAULTS }),

      // convenience selector
      isConnected: () => {
        const s = get();
        return !!(s.cookie && s.csrf);
      },
    }),
    {
      name: 'ac_session_v1',
      // don't persist functions; zustand handles that, but be explicit about fields
      partialize: (s) => ({
        curl: s.curl, base: s.base, projectId: s.projectId, taskListId: s.taskListId,
        userId: s.userId, categoryId: s.categoryId, taskId: s.taskId, source: s.source,
        billable: s.billable, cookie: s.cookie, csrf: s.csrf, capturedAt: s.capturedAt,
        portalCurl: s.portalCurl, portalToken: s.portalToken, portalCookie: s.portalCookie, portalCapturedAt: s.portalCapturedAt,
      }),
    }
  )
);
