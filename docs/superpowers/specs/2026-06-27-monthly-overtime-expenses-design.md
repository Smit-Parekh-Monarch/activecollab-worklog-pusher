# Monthly Overtime → Expenses page

**Date:** 2026-06-27
**Status:** Approved design (pending spec review)

## Goal

Add a **new page** that reads the existing daily worklogs, computes **monthly
overtime** (hours worked beyond a fixed 8-hour workday), and pushes each
overtime day into ActiveCollab as an **expense** via
`POST /projects/{projectId}/expenses`.

The existing push page (`/`) and its `/api/push` flow are **not changed**. All
new behavior is additive: one new static page + one new server route.

## Non-goals

- No change to the existing task-push flow, worklog format, or standup page.
- No money/rate conversion (value is the overtime hours themselves).
- No editing of worklog files from this page.

## Data source

Reuses existing endpoints — no new file format:

- `GET /api/worklogs` — lists every `*.json` under `worklogs/`, each with
  `rel`, `date`, and `hours` (already summed in **true decimal**, e.g.
  `8:55 → 8.916`). One file = one day.
- The new page groups files by **month** (derived from each file's `date`),
  sorts days ascending by date, and does all overtime math client-side.

## Overtime math (per month, processed day-by-day in date order)

Constants:
- `STANDARD_DAY = 8` (hours)
- `MIN_RELEASE = 0.5` (30 minutes)

For each day:
- `actual` = that day's total hours (true decimal).
- `deviation = actual − 8` (can be negative for short days).

Two separate numbers are produced:

### 1. Net total — review only

```
net = Σ deviation   (over all days in the month, including negatives)
```

Example: overtime days sum to +4h, one 5-hour day is −3h → **net = +1h**.
This is displayed so the user can sanity-check the month. It does **not** drive
what gets pushed.

### 2. Pushed overtime — chronological carry accumulator

Only *positive* overtime feeds the accumulator. Sub-30-minute amounts carry
forward and combine across days until they reach 30 minutes, then the whole
accumulated amount is "released" as that day's expense.

```
carry = 0
for each day (date ascending):
    ot = max(0, deviation)
    carry += ot
    if carry >= MIN_RELEASE (0.5):
        pushedOT[day] = carry      # release full accumulated amount
        carry = 0
    else:
        pushedOT[day] = 0          # carried forward
# leftover carry < 0.5 at month end is NOT pushed (shown as remainder)
```

- Short (negative) days are **shown but never pushed** and do **not** reduce the
  carry.
- A day with `pushedOT > 0` becomes exactly one expense, dated to that day.

### Worked example

| Day | Hours | Deviation | Carry after | Pushed that day |
|-----|-------|-----------|-------------|-----------------|
| 1   | 8:10  | +0:10     | 0:10        | —               |
| 2   | 8:10  | +0:10     | 0:20        | —               |
| 3   | 8:10  | +0:10     | 0:00        | **0:30** ✓      |
| 4   | 5:00  | −3:00     | 0:00        | — (short day)   |
| 5   | 10:55 | +2:55     | 0:00        | **2:55** ✓      |

Net for the month = (0:10×3) + (−3:00) + (2:55) = −2:25 (review only).
Total pushed = 0:30 + 2:55 = 3:25.

## UI (`public/overtime.html`, served at `/overtime`)

- **Auth box** — same "paste curl → parse" control as the main page, filling
  base URL, project id, cookie, CSRF, plus the expense fields below.
- **Expense fields** (parsed from the curl as defaults, all editable):
  `category_id`, `user_id`, `task_id`, `source` (default `project_time`),
  `billable_status` (default `1`).
- **Month dropdown** — months discovered from worklog dates.
- **Day-by-day table** — columns: date, hours, deviation, carry, pushed-OT.
  Pushed-OT cells are editable so the user can override before pushing.
- **Summary** — month net total and total OT to push.
- **Push to ActiveCollab** button — streams live per-row status
  (`create ✓ / error`) like the existing push page (NDJSON).
- Reuses the existing SSE auto-reload (`/api/events`) so the table refreshes
  when worklog files change.

## Server route (`server.js`)

New route only — existing routes untouched. A static mount
`app.use('/overtime', express.static(...))` is added next to the existing
`/standup` and `/figma` mounts (the page can also live in `public/` and be
served directly; final location chosen at implementation).

```
POST /api/push-expenses   (streams NDJSON progress)
body: {
  base, projectId, cookie, csrf,
  expenses: [
    { record_date, value, summary, category_id, user_id, task_id,
      source, billable_status }
  ]
}
```

For each expense it calls (reusing the existing `acFetch` cookie-jar / CSRF
helper):

```
POST /projects/{projectId}/expenses
{
  "value": "<otHours>",          // decimal hours, e.g. "0.50", "2.92"
  "category_id": <from field>,
  "user_id": <from field>,
  "record_date": "<YYYY-MM-DD>",
  "billable_status": 1,
  "summary": "<generated OT note>",
  "task_id": <from field>,
  "source": "project_time"
}
```

The `value` for each pushed day is that day's released overtime in decimal
hours (formatted to 2 decimals).

## Error handling

- Same as existing push: per-row `start/ok/error` events with HTTP status and a
  response snippet. A failed row does not stop the rest.
- Auth expiry surfaces as `401`/CSRF errors per row → user re-pastes a fresh
  curl (same recovery flow as the main page).

## Testing

- Unit-test the overtime accumulator (`computeMonthlyOvertime`) against the
  worked example and edge cases: all-short month, exactly-8h days, a single big
  OT day, sub-30 amounts that never reach 30 (leftover remainder not pushed).
- Manual: load a month, verify table + net + total-to-push, push against the
  live instance using a fresh curl, confirm expenses appear in ActiveCollab.
