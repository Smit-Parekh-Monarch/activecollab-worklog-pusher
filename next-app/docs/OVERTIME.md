# Overtime → Expenses

The `/overtime` page converts a month of work-logs into ActiveCollab **expense**
entries for overtime, and pushes them with the same session you paste.

## The rule

- A normal **weekday** has an **8-hour** standard. Anything beyond 8h that day is
  overtime.
- **Weekends (Sat/Sun) have no standard workday** — every logged weekend hour is
  overtime. (e.g. Saturday with 9:10 logged → the full **9:10** is overtime, not
  9:10 − 8:00.)
- A day whose own overtime is **25 minutes or more** is pushed **that day, in full**
  — a 29-minute, 1-hour or 2-hour day is its own expense and is never carried into
  the next day or merged with the bank.
- Overtime **under 25 minutes banks** day to day. The bank is **released** as one
  expense on the day it first reaches **25 minutes**. Anything left under 25 minutes
  at month end stays as "carry left" and is not pushed.
- **Short / minus days are shown for information only** — on the page they do **not**
  reduce overtime or the bank (the page calls the core with `netDeviation: false`).
  The summary shows the month's total under-hours separately.
- The core also supports a `netDeviation: true` mode (short days subtract from the
  bank) for callers that want net accounting; it is covered by tests but not used by
  the page.

## Recording what was pushed (`ot_pushed`)

After a day's overtime is pushed successfully, the page records it back into that
day's work-log JSON via `POST /api/worklog/mark-ot-pushed`, appending to a top-level
**`ot_pushed`** array:

```jsonc
{
  "pushed": true,
  "ot_description": "…",
  "ot_pushed": [
    { "value": "0.55", "summary": "…", "at": "2026-06-30T09:12:00.000Z" }
  ],
  "tasks": [ /* ... */ ]
}
```

- `value` is the overtime hours pushed (decimal); `summary` is the pushed text; `at`
  is the ISO timestamp.
- `/api/worklogs` surfaces it as `otPushed` per file. The `/overtime` page shows a
  **pushed ✓** badge on those days, skips them in a bulk **Push**, and turns the
  per-row button into **re-push** (which confirms before pushing again). This prevents
  accidental double-pushes across reloads.
- Editing a work-log's tasks in `/worklogs` preserves `ot_pushed` (the save route
  keeps all non-`tasks` keys).

All of this lives in `lib/overtime-core.js` as pure functions and is covered by
`test/overtime-core.test.js`.

### Key functions

| Function | Purpose |
|---|---|
| `isWeekend(iso)` | true for Sat/Sun (UTC-parsed, no timezone drift) |
| `computeMonthlyOvertime(days, opts)` | per-day deviation, banking, release; weekends use `weekendStandard` (default 0) |
| `parseHoursDecimal("8:55")` → `8.92` | h:mm or decimal → decimal |
| `decimalToHHMM(1.09)` → `"1:05"` | decimal → h:mm (rounds to the minute) |
| `groupByMonth(files)` | `YYYY-MM → files[]`, newest month first |

## The push shape

Each pushed row becomes an expense matching a known-good ActiveCollab expense:

```json
{
  "value": "9.17",            // overtime hours as a decimal
  "category_id": 2,           // "overtime" category (from your cURL)
  "user_id": 748,             // you (from your cURL)
  "record_date": "2026-06-27",
  "billable_status": 1,
  "summary": "Came in on the Saturday to push the offboarding...",  // the day's ot_description
  "source": "project_time",
  "task_id": 122333           // optional — attaches the expense to a task
}
```

`task_id` maps to ActiveCollab's `parent_type: Task / parent_id` automatically.

## The expense summary — `ot_description`

The pushed `summary` is **not** a generated `"Overtime 9.17h on 2026-06-27"` line.
Each work-log JSON carries a top-level **`ot_description`** — one short, human-written
note (2–3 lines) describing what was actually done that day, drawn from the day's
work. That text is what gets pushed:

```jsonc
{
  "pushed": true,
  "ot_description": "Came in on the Saturday to push the offboarding and letter-generation work forward ahead of the deadline. Outside the standard week, so the full 9 hours 10 minutes counts as overtime.",
  "tasks": [ /* ... */ ]
}
```

- `/api/worklogs` surfaces it as `otDescription` per file (see `lib/worklogs.ts`).
- The `/overtime` page maps it by date and uses it as the expense `summary` for both
  the bulk **Push** and the per-row **Push** buttons (see `summaryForDate`). The exact
  text that will be sent is shown under "Will push" and on each Push button's tooltip.
- If a day has no `ot_description`, it falls back to the plain `Overtime Xh on DATE` line.
- Editing a work-log's tasks in the `/worklogs` editor preserves `ot_description`
  (the save route keeps all non-`tasks` keys).

## Auto-fill task from ActiveCollab

Rather than typing a task id, the page can fetch the project's task list and let you
pick (or auto-resolve) the right one. It calls `POST /api/tasks` with your pasted
session:

```jsonc
// request
{ "base": "...", "projectId": "6070", "cookie": "...", "csrf": "...",
  "match": { "date": "2026-06-27" } }   // match is optional

// response
{ "tasks": [ { "id": 122439, "name": "27/06/2026 tasks", "task_number": 524, "task_list_id": 32329 }, ... ],
  "resolved": { "id": 122439, "name": "27/06/2026 tasks", "why": "date-in-name" } }
```

Resolution order when `match` is supplied:
1. a task whose **name contains the date** (`27/06/2026`, `27-6-2026`, or `2026-06-27`)
2. a task whose **name contains** `match.name`
3. the **most recently updated open task** (fallback)

The server only ever *reads* the task list here — it does not create or modify tasks.
Pushing expenses is a separate, explicit action (the **Push** button).
