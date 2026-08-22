# TCG Dexter — Claude Code Guide

## Project Overview
Pokémon TCG deck management web app. Core features: deck profiling (legality, price, meta match), saved deck library, match logging, deck sharing via QR/link.

## Stack
- **Next.js 14** (App Router, server components + client islands)
- **TypeScript 5**, **Tailwind CSS 3**, **React 18**
- **Supabase** — auth + database (server client via `@/lib/supabase/server`, client via `@/lib/supabase/client`)

## Deployment
- **Main branch = production** on Vercel. Every push to `main` triggers a deploy.
- Always run `npx tsc --noEmit` before pushing — Vercel runs a full type-check build and will fail on any TS error.

### Branches: `main` / `preview` / `learn-hold`
- `preview` is the working branch and is **always safe to merge into `main`** — nothing is held back on it. Keep it that way.
- `learn-hold` carries the **Learn to Play** rework (the lesson board rendered with the real `PlayerMat`), deliberately kept out of production until it's ready. It is the *only* place that work lives.
  - Files it owns: `app/learn/(content)/*.mdx`, `app/learn/(content)/README.md`, `app/learn/components/Board.tsx`, `lib/learn/curriculum.test.ts`.
  - **Do Learn to Play work on `learn-hold`, not on `preview`.** Putting it on `preview` is what makes it leak to prod on the next merge.
  - Keep it current with `git merge preview` into `learn-hold` (not the reverse) — it should trail preview, never lead it.
  - When it's ready to ship: merge `learn-hold` → `preview`, then `preview` → `main` as usual.
- Why the branch exists rather than excluding files at merge time: two earlier `preview` → `main` merges had to reset those five files back to `main`'s versions by hand. That only auto-resolves while `preview` leaves them alone, so the moment anyone edited them on `preview` again it would have shipped silently. `BoardKit.tsx` is *shared* with the replay viewer and is NOT held back — only the five files above are.

## Migrations & the `ON CONFLICT` / partial-index trap
- Migrations live in `supabase/migrations/` and are applied **manually via Supabase MCP `apply_migration`** — there is no CI migration runner. Each file's header says so.
- **Hard-won gotcha:** a bare `.upsert({ onConflict: "col_a,col_b" })` (supabase-js) or `ON CONFLICT (col_a, col_b)` **cannot** target a **PARTIAL** unique index (one with a `WHERE`). Postgres can't infer it and raises **42P10**. Because the notify helpers swallow write errors, this fails *silently* — it's exactly how `deck_liked` notifications broke (fixed in `20260727_notifications_dedup_fix.sql` by making the index full/non-partial).
  - If you need a partial dedup index, **don't** use `ON CONFLICT` inference against it — insert and, on the `23505`, update the existing row (see `notifyNewFollower` in `lib/notifications/notify.ts`, whose `notifications_follow_dedup_idx` is intentionally partial and safe).
- **Regression guard:** `lib/notifications/notifications-dedup.test.ts` boots an in-process real Postgres (PGlite — no external service), applies the real `*notifications*` migrations, and asserts the `deck_liked` upsert dedups to one row. It runs as part of `npm run test` (and thus CI). Re-partialing that index turns the second upsert back into a 42P10 and fails the test.

## Legal & Privacy
- Live docs: `/privacy` (`app/privacy/page.tsx`) and `/terms` (`app/terms/page.tsx`), built on the shared `LegalDoc`/`LegalSection` components (`app/components/ui/LegalDoc.tsx`). Linked from the footer and the sign-in page.
- Both docs describe TCG Dexter's *actual* data practices — not generic boilerplate. When a change does any of the following, flag to the user that the Privacy Policy and/or Terms may need updating, and note which section:
  - Collects a new category of personal data, or a new table/column that stores user-identifying info.
  - Adds a new third-party service/vendor that touches user data (currently just Supabase + Vercel).
  - Adds or changes cookies/tracking behavior (currently `dx_aid`, `dx_sid`, and Supabase session cookies — see the Privacy Policy's "Cookies" section).
  - Introduces payments, ads, or any data sale/sharing arrangement.
- Self-service account deletion lives at `/settings` ("Danger Zone" → `app/settings/DeleteAccountButton.tsx`), calling `POST /api/account/delete` (`app/api/account/delete/route.ts`). That route is the reference for which tables/storage buckets are user-scoped — update it if you add a new one (see the Legal & Privacy bullets above).
- The Terms have no governing-law clause (deliberately omitted — the entity isn't formally incorporated yet). Don't add one without asking first.

## Key Architecture

### Routes
| Route | Description |
|---|---|
| `/` | Home — paste deck list, get instant analysis |
| `/my-decks` | Saved deck library (auth required) |
| `/my-decks/[id]` | Individual saved deck profile |
| `/d/[shortId]` | Public shared deck page |
| `/meta-decks/[slug]` | Meta archetype profile |

### API Routes (`app/api/`)
| Route | Purpose |
|---|---|
| `POST /api/analyze` | Analyze a deck list |
| `GET/POST /api/saved-decks` | List / create saved decks |
| `PATCH/DELETE /api/saved-decks/[id]` | Rename / delete a saved deck |
| `POST /api/matches` | Log a match result |
| `POST /api/deck-share` | Generate a shareable short URL |

### Component Conventions
- **`DeckProfileView`** (`app/components/DeckProfileView.tsx`) — shared full-page layout used by both public shared decks and private saved deck profiles. Key props: `pageTitle`, `titleAction`, `subtitle`, `topSlot`, `footerCta`, `hideSave`.
  - `topSlot` renders inside the main `flex flex-col gap-4` container, above the analysis modules.
  - `subtitle` is conditionally rendered — pass `false` to suppress the default "Created on…" date fallback without leaving dead space.
  - `titleAction` renders inline after the `<h1>` (use for pencil/rename icon).
- **`SavedDeckRow`** (`app/my-decks/SavedDeckRow.tsx`) — list item in `/my-decks`. Row tap navigates to the deck profile. Log Match button expands an inline form.
- **`MyDeckClient`** (`app/my-decks/[id]/MyDeckClient.tsx`) — client wrapper for saved deck detail. Owns rename + delete state; passes action buttons, MatchLog, DeckNotes, and DeckList into `topSlot`.

### Design Tokens (globals.css)
```
--bg: #f2f2f2          (page background)
--surface: #e8e8e8     (card/cell default background)
--border: #d95555
--text-primary: #1a1a1a
--text-secondary: #4a4a4a
--text-muted: #888888
--accent: #d95555
```
White (`bg-white`) is used for elevated cards (match log, deck list, saved deck rows) to stand out from `--surface`.

### Button Sizing Convention
Action button rows use `text-xs font-semibold` with `px-3 py-1.5` for text buttons and `px-3 py-[7px]` for icon-only buttons (the 1px extra vertical padding compensates for the missing text line-height, keeping all buttons the same height). Black background buttons use `border border-transparent` to match the height of bordered buttons like Log Match.

## Tailwind Notes
- Content paths: `./app/**/*.{ts,tsx}` and `./components/**/*.{ts,tsx}`
- No custom font sizes defined — uses Tailwind defaults (`text-xs` = 12px, `text-sm` = 14px, `text-base` = 16px, `text-lg` = 18px, `text-xl` = 20px, `text-2xl` = 24px)
- Arbitrary values (e.g. `py-[7px]`) are supported via JIT

## Dev Server
```bash
npm run dev   # runs on port 3000
```
Preview server config lives at `.claude/launch.json`.
