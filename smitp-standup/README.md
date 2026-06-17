# Smitp — Daily Standup sheet

A standalone viewer (served at **http://localhost:5050/standup**) that turns your daily
work-log JSON into a copy-paste standup row for Excel / Google Sheets.

It produces exactly this header:

| Name | Project | In Progress & ETA | Completed | Next in Queue |
| ---- | ------- | ----------------- | --------- | ------------- |

One **row per work-log file** that contains a `standup` block.

---

## Where it fits in the workflow

```
 Claude writes the day's work     You add a small `standup`        /standup page reads every
 → worklogs/<month>/week-<N>/  →  block to that same JSON file  →  worklog with a standup block
   <d-m-yyyy>.json (tasks[])       (name/project/inProgress/next)   and renders one table row
                                                                    → click "Copy" → paste in Excel
```

The standup data lives **inside the same daily file** as the tasks — one source of truth.
The **Completed** column is filled automatically from `tasks[]`, so you never retype it.

---

## How to add a standup row (e.g. `worklogs/june/week-3/16-6-2026.json`)

Add a `standup` object next to `tasks` (the file is the object form `{ ... }`, not a bare array):

```json
{
  "pushed": true,
  "standup": {
    "name": "Smit Parekh",
    "project": "MIPL Portal",
    "inProgress": [
      "Open PR for fix/offboarding-dropdown-ui → dev and get it reviewed/merged – ETA: Today EOD"
    ],
    "next": [
      "Add manager notification on resignation submit (currently only HR/Admin are notified)",
      "Verify reporting-manager data is set for existing TL/PL records so they surface correctly"
    ]
  },
  "tasks": [
    { "name": "…", "date": "2026-06-16", "hours": "02:05", "body": "…", "summary": "- …" }
  ]
}
```

That renders as one row:

- **Name** ← `standup.name`
- **Project** ← `standup.project`
- **In Progress & ETA** ← each string in `standup.inProgress` (the `ETA: …` part is bolded automatically)
- **Completed** ← one bullet per task in `tasks[]`, using each task's `body` (falls back to `name`)
- **Next in Queue** ← each string in `standup.next`

### Fields

| Field                | Type            | Required | Notes |
| -------------------- | --------------- | -------- | ----- |
| `standup.name`       | string          | yes      | Person's name shown in the **Name** column. |
| `standup.project`    | string          | yes      | Shown in **Project**. |
| `standup.inProgress` | array of string | yes      | Bullets for **In Progress & ETA**. Put the ETA inline, e.g. `"… – ETA: Today EOD"`. |
| `standup.next`       | array of string | yes      | Bullets for **Next in Queue**. |
| `standup.completed`  | array of string | no       | Optional override. If omitted, **Completed** is auto-built from `tasks[]`. |

A file **without** a `standup` block simply doesn't appear on the standup page — it still works
normally in the Work-log Pusher.

---

## Using the page

1. `npm start`, then open **http://localhost:5050/standup** (or click **Smitp standup** on the main page).
2. Every worklog with a `standup` block shows as a row.
3. **Copy** on a row copies it tab-separated (multi-line cells are quoted so bullets stay in one cell)
   — paste straight into Excel / Sheets.
4. **Copy header** / **Copy all rows** copy the header line / the whole visible table.
5. Click any single cell to copy just that value. Type in the search box to filter rows.
6. The page live-updates: edit a worklog JSON and the row refreshes automatically.

---

## Files

- `smitp-standup/index.html` — the standup viewer (vanilla JS, mirrors the Figma viewer).
- Served at `/standup` by `server.js` (`app.use('/standup', express.static(...))`).
- Data comes from the existing `/api/worklogs` + `/api/worklog?path=…` endpoints — no new backend code.
