# CLAUDE.md — development guide

ActiveCollab work-log & overtime pusher. A local-only dashboard that pushes
work-logs and overtime expenses to ActiveCollab, and reads logged hours from the
Monarch portal. The real app lives in **`next-app/`** (the root `public/` +
`server.js` are the old Express version, kept only for reference).

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** — lenient tsconfig (`strict:false`).
  Dev uses **Turbopack** (`next dev --turbopack`); `turbopack.root` is pinned in
  `next.config.mjs` (a lockfile exists at the repo root too).
- **Zustand + persist** — one shared session store (`lib/store.ts`), localStorage key `ac_session_v1`.
- **Tailwind CSS + shadcn/ui** — component library for all UI controls.
- **Pure JS math modules** (`lib/overtime-core.js`, `lib/portal-overtime.js`) covered by `node --test`.
- **Type**: **IBM Plex Sans** (body) + **IBM Plex Mono** (numbers/code), loaded via Google Fonts
  `<link>` in `app/layout.tsx` and wired to `--font` / `--mono`.
- Icons: **Material Symbols Outlined** via the `<Icon name="…" />` component (`components/Icon.tsx`,
  renders `<span class="ms">name</span>`). Use underscored symbol names. `lucide-react` still
  appears inside some shadcn components (e.g. `Loader2` spinners) — that's fine. `ion-icon` has
  been fully removed from pages/shell.

## UI conventions — USE THESE FOR EVERY PAGE

Consistency is the rule. Do not hand-roll buttons, dropdowns, or status pills.

- **Buttons** → always `import { Button } from '@/components/ui/button'`.
  Variants: `default` (primary terracotta — the main action), `outline` (secondary),
  `ghost` (toolbar/low-emphasis), `destructive` (delete), `link` (inline), `secondary`.
  Sizes: `default`, `sm`, `lg`, `icon`. Never use a raw `<button>` or the old `.btn` CSS classes.
- **Dropdowns** → always shadcn `<Select>` (`@/components/ui/select`). Never a native `<select>`.
  Radix Select can't have an empty-string `value` — use `undefined` + a `placeholder` for "none/custom".
- **Inputs / textareas** → `<Input>` / `<Textarea>` from `@/components/ui`.
- **Cards** → `<Card>`/`<CardContent>` etc. **Badges/pills** → `<Badge>` (variants: `default`, `secondary`, `success`, `warning`, `destructive`, `outline`).
- **Tables** → shadcn `<Table>` family, or the existing scoped CSS tables on older pages.
- **Toasts + confirm dialogs** → the shared `useNotify()` hook (`@/components/notify`):
  `const { toast, confirm, ui } = useNotify()`; render `{ui}` once; `toast(msg, 'ok'|'err'|'info')`,
  `await confirm({ title, body?, items?, ok? })`. **Never use native `alert()`/`confirm()`.**
- **Loading states** → every async action shows feedback: a `Loader2` from lucide with
  `className="animate-spin"` swapped in while pending, and the button `disabled`. Data fetches
  show a loading row/overlay until resolved.

## Colors / theming (IMPORTANT)

**Brand palette: terracotta on warm paper.** Accent primary is terracotta `#C4623C` on a warm
paper background `#F4F2EE`, deep-ink sidebar `#211F1B`. (This replaced the old teal `#18B6D9`
Monarch palette in the July 2026 redesign.) Status colors: success `#3F8F5F`, warning/bank
`#B07D2E`, error/short `#C0483A`, info blue `#3E6C82`.

The app has TWO token systems that must not collide:

1. **Design-system tokens** — `app/globals.css` `:root` defines `--primary`, `--border`,
   `--text`, `--bg`, `--success`, etc. as **plain colors** (the terracotta/paper palette). The
   pages, `dashboard.css`, and shared primitives use these. The rebrand kept every token *name*
   and only changed *values*, so restyling flows through here.
2. **shadcn tokens** — `app/shadcn.css` defines them **namespaced as `--sd-*`** (HSL triples),
   tuned to the terracotta palette so shadcn components match the brand (primary = terracotta).
   `tailwind.config.ts` maps shadcn color names (`primary`, `border`, …) to those `--sd-*` vars.

**Never** define shadcn's standard names (`--primary`, `--border`, …) at `:root` — it would
overwrite the legacy colors and break every old page. Keep the `--sd-` prefix.

**Tailwind preflight is DISABLED** (`corePlugins.preflight:false` in `tailwind.config.ts`) on
purpose, so Tailwind's reset never restyles the hand-written CSS pages. Don't re-enable it.

## Sessions

One shared store. The **Connect** modal (opened from the sidebar connection card or the top-bar
pill; any page can open it via `window.dispatchEvent(new Event('pusher:connect'))`, which `Shell`
listens for) accepts **either** cURL and auto-detects:

- **ActiveCollab** cURL (has `X-Angie-CsrfValidator`) → stores `cookie` + `csrf` + ids. Used to push.
- **Portal** cURL (`my-project-hours`, Bearer token) → stores `portalToken` + `portalCookie`. Used by Portal Hours to load logged hours.

`applyCurl(curl)` branches on `isPortalCurl()`. Both are persisted and shared across tools.

## Overtime rules

- Weekday standard 8h; **weekends count fully** (standard 0).
- `lib/overtime-core.js` (Overtime page): small OT **banks** and **auto-releases** once the
  bank reaches **25 min**; net mode lets short days offset the bank.
- `lib/portal-overtime.js` (Portal Hours page): a day ≥25 min OT is **pushable in full**;
  under 25 min **banks but never auto-releases** (cleared manually); short days are info only.
- **Portal Hours loads BOTH sources** and overtime is computed from **punch hours**: the
  attendance **punch/actual** hours (`/api/portal-attendance` → portal `/api/attendance/monthly-summary`,
  the OT basis) and the **ActiveCollab logged** hours (`/api/portal-hours` → `my-project-hours`,
  shown for reference with a Δ chip). Both endpoints use the same portal Bearer token; the
  attendance endpoint derives the user from the JWT (the `employeeId` query param is ignored
  server-side). A day is treated as **finished whenever it has `totalHours`** (covers `COMPLETE`
  **and `MODIFIED`** — a punch-out corrected after the fact); only a still-logged-in day
  (`LOGGEDIN`, no `totalHours`) shows as "in progress" and is excluded from overtime; days with no
  punch at all are skipped.
- **Push verification:** on load (when an ActiveCollab session is connected) Portal Hours reads the
  project's existing overtime expenses via `/api/expenses` (pages `/projects/{id}/expenses`,
  filters `category_id` = overtime + `user_id` + the month's date range, keyed by `record_date`).
  Days already pushed are marked "✓ pushed {value}" (the real expense value from AC) and excluded
  from the push list, so nothing is double-pushed. `/api/expenses` is read-only.
- The pushed expense **summary** is the day's `ot_description` from the work-log JSON
  (`/api/worklogs` surfaces it as `otDescription`), falling back to the day's top task.

## Adding shadcn components

The shadcn skill is installed at `.agents/skills/shadcn` (symlinked into `.claude/skills`).
To add a component, prefer hand-adding to `components/ui/` in the same style as the existing
ones (they use `cn()` from `lib/utils.ts`), or `npx shadcn@latest add <name>`. New Radix
primitives need an `npm install @radix-ui/react-<x>` first.

## Commands

```bash
cd next-app
npm run dev      # dev server (Turbopack)
npm run build    # production build
npm test         # node --test on lib/*.test.js
```

If `npm run` can't find `next` in git-bash, run `node node_modules/next/dist/bin/next <cmd>`.

**React 19 note:** the `ion-icon` JSX typing is declared for BOTH the classic global
`JSX.IntrinsicElements` and the React-19 `declare module 'react' { namespace JSX }` in
`types/global.d.ts` — keep both or the type check fails.
