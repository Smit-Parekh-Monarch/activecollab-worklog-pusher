# ActiveCollab Work-log Pusher — Next.js

A Next.js 14 (App Router) port of the original Express + static-HTML tool. It turns
Claude-generated work-log JSON into ActiveCollab entries, and converts monthly
overtime into pushable expenses.

## What it does

- **`/`** — Work-log Pusher. Paste a *task* cURL from ActiveCollab, pick a saved
  work-log JSON (or paste one), review the tasks, then push. For each task it
  **creates the task → logs the hours → marks it complete**.
- **`/overtime`** — Overtime → Expenses. Paste an *expense* cURL, pick a month, and
  the page computes overtime beyond an 8-hour weekday (weekends count fully) and
  pushes it as expenses. Includes **auto-fill task from ActiveCollab** (fetches the
  project's task list so you don't type a task id by hand).

## Run it

```bash
cd next-app
npm install
npm run dev        # http://localhost:5050
```

Production:

```bash
npm run build && npm start
```

Tests (the overtime math):

```bash
npm test
```

## Where the data lives

Work-log JSON files are read from a `worklogs/` folder. By default the app looks at
`../worklogs` (the folder beside `next-app/`, i.e. the original repo's `worklogs/`),
so existing files keep working. Override with the `WORKLOG_DIR` env var:

```bash
WORKLOG_DIR=/abs/path/to/worklogs npm run dev
```

Layout is `worklogs/<month>/<week>/<d-m-yyyy>.json`, each file either an array of
tasks or `{ "pushed": false, "tasks": [...] }`. An object-form file may also carry a
top-level **`ot_description`** — a short, human-written note of that day's work that
the `/overtime` page uses as the pushed expense summary (see `docs/OVERTIME.md`).

## How auth works

You never store a password. You paste a **Copy as cURL** request from ActiveCollab's
DevTools → Network tab; the app extracts the **session cookie** and the
**X-Angie-CsrfValidator** token and replays them server-side. ActiveCollab uses the
double-submit cookie pattern, so the CSRF header is kept in sync with the
`activecollab_csrf_validator_for_*` cookie automatically.

## Architecture

```
next-app/
  app/
    page.js                     Work-log Pusher UI (client component)
    overtime/page.js            Overtime → Expenses UI (client component)
    overtime/overtime.css       scoped styles for the overtime page
    globals.css                 shared design system (light theme)
    layout.js                   html shell + ionicons
    api/
      worklogs/route.js         GET  list worklog files
      worklog/route.js          GET  one file by path (traversal-guarded)
      worklog/mark-pushed/route.js  POST mark a file pushed
      push/route.js             POST create→log→complete  (NDJSON stream)
      push-expenses/route.js    POST one expense per row    (NDJSON stream)
      tasks/route.js            POST proxy AC tasks + resolve a task id
      events/route.js           GET  SSE — live worklog-change refresh
  lib/
    ac.js                       AC cookie-jar + acFetch client
    worklogs.js                 worklog dir walk + safe path resolver
    overtime-core.js            pure overtime math (shared with tests)
  test/overtime-core.test.js    node:test suite (13 tests)
  docs/                         design + feature docs
```

See [docs/OVERTIME.md](docs/OVERTIME.md) and [docs/MIGRATION.md](docs/MIGRATION.md).
