# ActiveCollab Work-log Pusher

A tiny local tool (Node + one HTML page) that takes the work-log JSON Claude generates
and pushes it into ActiveCollab — for each entry it **creates the task → logs the hours →
marks it complete**, using the API calls your browser already makes.

## Run

```powershell
npm install
npm start
```

Then open **http://localhost:5050**

## How to use

1. **Get a fresh curl.** In ActiveCollab, open the project, open DevTools → Network,
   create any task (or find the `POST .../tasks` request), right-click → **Copy → Copy as cURL**.
2. **Paste it** into box 1 and click **Parse curl**. It auto-fills base URL, project id,
   `task_list_id`, your cookie and CSRF token. Set **Your user ID** (e.g. `748`).
3. **Paste the work-log JSON** into box 2 (see `sample-worklog.json`) and click **Preview tasks**.
4. Review the table — **date and hours are editable** — then click **Push to ActiveCollab**.
   Each task shows live status: `create ✓  time ✓  complete ✓`.

## Work-log JSON format

```json
[
  {
    "name": "Task title",
    "date": "2026-06-02",
    "hours": "03:30",
    "summary": "short note for the time record",
    "body": "- optional task description bullets"
  }
]
```

- `hours` accepts `"HH:MM"` (e.g. `"02:33"` → 2.55h) or a decimal (`3.5`).
- `summary` and `body` are optional.

## Notes

- **Work-log files** are read from this project folder (`C:\Users\smitp\Smit-Parekh-Monarch\Active collab`),
  organised as `<month>/week-<N>/<d-m-yyyy>.json` (e.g. `june/week-1/2-6-2026.json`). The `/update-stats`
  command writes them here; the UI dropdown lists them (click ↻ to rescan). Override the location with the
  `WORKLOG_DIR` env var. The app's own files (`node_modules`, `public`, `.claude`, `package*.json`) are hidden from the dropdown.
- The browser never calls ActiveCollab directly — the Node backend proxies the calls
  (avoids CORS) and keeps a cookie jar so the rotating CSRF token stays in sync across
  the three calls per task.
- Auth comes from the pasted curl (cookie + CSRF). When the session expires you'll get
  `401`/CSRF errors in the status column — just copy a fresh curl and re-parse.
- Defaults baked in to match your instance: `source: "task_sidebar"`, `job_type_id: 1`,
  `billable_status: 1`. Change them in `server.js` if needed.

## Standup sheet (`/standup`)

A second page, **Smitp standup**, turns each daily work-log into a copy-paste row for
Excel / Google Sheets with the header **Name | Project | In Progress & ETA | Completed | Next in Queue**.
Add a small `standup` block to a daily JSON and it shows up as a row (the **Completed** column
auto-fills from `tasks[]`). Open **http://localhost:5050/standup** or click *Smitp standup* on the
main page. Full details and the JSON format: [`smitp-standup/README.md`](smitp-standup/README.md).

## Files

- `server.js` — Express backend: curl-driven proxy, cookie jar, 3-step push, NDJSON progress stream.
- `public/index.html` — the single-page UI (curl parser, JSON preview, live push).
- `csv-figmachanegs/index.html` — Figma Changes viewer (served at `/figma`).
- `smitp-standup/index.html` — Daily Standup sheet (served at `/standup`).
- `sample-worklog.json` — your three CRM sessions, ready to paste.
