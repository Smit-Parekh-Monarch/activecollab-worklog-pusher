# Migration: Express + HTML → Next.js

This documents how the original app maps onto the Next.js port, so nothing is lost.

## Endpoint mapping

| Original (Express `server.js`) | Next.js (App Router) | Notes |
|---|---|---|
| `GET /api/worklogs` | `app/api/worklogs/route.js` | same JSON `{ dir, files }` |
| `GET /api/worklog?path=` | `app/api/worklog/route.js` | path-traversal guarded |
| `POST /api/worklog/mark-pushed?path=` | `app/api/worklog/mark-pushed/route.js` | writes `pushed:true` |
| `POST /api/push` | `app/api/push/route.js` | NDJSON stream, create→time→complete |
| `POST /api/push-expenses` | `app/api/push-expenses/route.js` | NDJSON stream, one expense/row |
| `GET /api/events` | `app/api/events/route.js` | SSE, fs.watch on worklog dir |
| `GET /` (static `index.html`) | `app/page.js` | React client component |
| `GET /overtime` (static `overtime.html`) | `app/overtime/page.js` | React client component |
| static `/figma`, `/standup` | not ported | were separate static folders; re-add as needed |

## Page mapping

- `public/index.html` (Babel-in-browser React) → `app/page.js` — same component, now a
  compiled `'use client'` component. The browser CDN scripts (React UMD, Babel) are
  gone; React comes from the framework.
- `public/overtime.html` (vanilla JS) → `app/overtime/page.js` — rewritten as React;
  same DOM/logic, plus the new **auto-fill task** feature.
- `public/styles.css` → `app/globals.css` (verbatim).
- `public/overtime-core.js` → `lib/overtime-core.js` (verbatim, still the test target).

## Behaviour preserved

- cURL parsing regexes (cookie, CSRF, base, ids) are unchanged.
- AC request headers, cookie-jar, and CSRF double-submit handling are ported verbatim
  in `lib/ac.js`.
- The overtime banking/release math is byte-for-byte the same module, same tests.

## What changed on purpose

- **New**: `POST /api/tasks` + the overtime page's "auto-fill task" UI.
- **New (already in the math)**: weekends count as all-overtime (weekend standard = 0).
- Single-`.exe` packaging (`pkg`) from the original is not carried over; run via
  `npm run build && npm start` or deploy as a normal Next.js app.

## Data

`worklogs/` is **not** moved — the Next app reads the existing folder at `../worklogs`
by default (override with `WORKLOG_DIR`). Your existing files, including
`june/week-4/27-6-2026.json`, work as-is.
