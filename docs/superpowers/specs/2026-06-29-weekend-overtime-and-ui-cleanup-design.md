# Weekend-aware overtime + `/overtime` UI cleanup

Date: 2026-06-29

## Problem

1. The `/overtime` page subtracts a standard 8h workday from **every** day, including
   weekends. A Saturday with 9:10 logged would count only 1:10 as overtime, which is
   wrong — weekends have no standard workday, so every weekend hour is overtime.
2. The screen is confusing: the table columns (Deviation / Carry / Push OT) and the
   carry-forward rule are hard to read, it's not obvious which days actually push, and
   the page feels cluttered.

Concrete trigger: add 9:10 of all-overtime work on Saturday June 27 2026.

## Section 1 — Weekend-aware math (`public/overtime-core.js`)

- Add `isWeekend(isoDate)`: parse a `YYYY-MM-DD` string by component (via `Date.UTC`,
  no local-timezone drift) and return `true` for Saturday (6) and Sunday (0).
- `computeMonthlyOvertime(days, opts)` computes a **per-day** standard:
  `const std = isWeekend(d.date) ? weekendStandard : standardDay;`
  - `weekendStandard` defaults to `0`, overridable via `opts.weekendStandard`.
  - `deviation = hours - std`; `net` accumulates the same per-day deviation.
- Each returned row gains `isWeekend` (bool) and `standard` (the effective std used)
  so the UI can badge weekend rows.
- Carry/release rule is unchanged: only positive deviation banks; releases once carry
  reaches 30 min (`MIN_RELEASE`).

Result: Saturday 9:10 → deviation +9.17 → releases the full 9:10 as `pushedOT`.

### Tests (`test/overtime-core.test.js`)

Existing tests use Jun 1–3 2026 (Mon–Wed) and stay green. Add:
- `isWeekend` true for 2026-06-27 (Sat) / 2026-06-28 (Sun), false for 2026-06-26 (Fri).
- A month mixing a weekday and a Saturday: the Saturday pushes its full hours; a
  weekday at exactly 8h is neutral.

## Section 2 — June 27 worklog entry

Create `worklogs/june/week-4/27-6-2026.json` (week-4 = Jun 22 Mon–26 Fri; the 27th is
that week's Saturday):

```json
{
  "pushed": false,
  "tasks": [
    {
      "name": "Saturday overtime — Jun 27",
      "date": "2026-06-27",
      "hours": "09:10",
      "body": "Saturday overtime",
      "summary": "Overtime work on Saturday June 27"
    }
  ]
}
```

The OT/expense flow only reads the summed hours + date; name/summary matter only if
this day is ever pushed from the main worklog page.

## Section 3 — `/overtime` UI cleanup (`public/overtime.html`)

- **Collapse setup**: wrap the cURL + ID fields in a `<details>` "Connection & settings"
  panel that auto-collapses once a valid session is captured; the summary line shows the
  capture status.
- **Clearer table**: show weekday in the date (`Sat 27`); badge weekend rows
  `weekend · all OT`; rename columns to plain language — **Logged / Over–under /
  Banked / Will push / Status**; gray rows that push nothing, green rows that do; add a
  one-line legend explaining the banked-minutes-release-at-30-min rule.
- **"What will push" panel**: a prominent box — `Will push: N days · H:MM (· decimal)` —
  listing the specific days; Net month / Carry left demoted to secondary text.

No change to connection-field parsing or the `/api/push-expenses` endpoint.

## Out of scope

- No changes to the main worklog push page or push endpoints.
- No per-day standard editing in the UI (weekend rule is automatic); the existing
  inline "Will push" edit field still lets the user override any day.
