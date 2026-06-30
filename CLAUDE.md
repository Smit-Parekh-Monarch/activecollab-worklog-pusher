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
- Icons: **lucide-react** in shadcn components; legacy `ion-icon` web component elsewhere.

## UI conventions — USE THESE FOR EVERY PAGE

Consistency is the rule. Do not hand-roll buttons, dropdowns, or status pills.

- **Buttons** → always `import { Button } from '@/components/ui/button'`.
  Variants: `default` (primary teal — the main action), `outline` (secondary),
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

The app has TWO token systems that must not collide:

1. **Legacy design system** — `app/globals.css` `:root` defines `--primary`, `--border`,
   `--text`, etc. as **plain colors**. The older pages and `dashboard.css` use these.
2. **shadcn tokens** — `app/shadcn.css` defines them **namespaced as `--sd-*`** (HSL triples),
   tuned to the Monarch palette so shadcn components match the brand (primary = teal `#18B6D9`).
   `tailwind.config.ts` maps shadcn color names (`primary`, `border`, …) to those `--sd-*` vars.

**Never** define shadcn's standard names (`--primary`, `--border`, …) at `:root` — it would
overwrite the legacy colors and break every old page. Keep the `--sd-` prefix.

**Tailwind preflight is DISABLED** (`corePlugins.preflight:false` in `tailwind.config.ts`) on
purpose, so Tailwind's reset never restyles the hand-written CSS pages. Don't re-enable it.

## Sessions

One shared store. The top-bar **Connect** drawer accepts **either** cURL and auto-detects:

- **ActiveCollab** cURL (has `X-Angie-CsrfValidator`) → stores `cookie` + `csrf` + ids. Used to push.
- **Portal** cURL (`my-project-hours`, Bearer token) → stores `portalToken` + `portalCookie`. Used by Portal Hours to load logged hours.

`applyCurl(curl)` branches on `isPortalCurl()`. Both are persisted and shared across tools.

## Overtime rules

- Weekday standard 8h; **weekends count fully** (standard 0).
- `lib/overtime-core.js` (Overtime page): small OT **banks** and **auto-releases** once the
  bank reaches **25 min**; net mode lets short days offset the bank.
- `lib/portal-overtime.js` (Portal Hours page): a day ≥25 min OT is **pushable in full**;
  under 25 min **banks but never auto-releases** (cleared manually); short days are info only.
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
