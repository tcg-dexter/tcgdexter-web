# TCG Dexter — CI/CD, TDD & Quality Dashboard Plan

_Supersedes `docs/infra-phase-plan.md` (Apr 2026). That plan deferred almost everything pending PMF pressure. This is the graduation spec — what we build so TCG Dexter operates like a proper software business._

## 1. North star

Three properties define "proper" for our stage:

1. **Every shipped change is gated by tests that map back to real user behavior.** Not just type-checks, not just unit smoke — the deck analyzer, RLS visibility, and meta-deck rendering each have a test that fails if a user-visible regression slips in.
2. **Prod health is observable on a dashboard you can open in five seconds.** No spelunking through GitHub Actions tabs and `vercel logs`. `quality.tcgdexter.com` is the single pane.
3. **Test-first is the default authoring posture.** New `lib/` modules and route handlers start with a failing test. Bug fixes start by reproducing the bug in a test that currently passes.

Everything below ladders into one of those three.

## 2. Branch & environment topology (unchanged)

| Env | Branch | URL | Auto-deploy |
|---|---|---|---|
| Local | _(any)_ | localhost:3000 | — |
| Preview | `preview` | preview.tcgdexter.com | on push |
| Prod | `main` | tcgdexter.com | on push (weekly cut) |

The `dev → preview → main` flow from the dev protocol stays. What changes is what gates a merge into each, and what runs on a cadence against each.

## 3. The test pyramid — what lives where

Think of these as your `XCTestCase` tiers, but explicit about which runner and which environment each one targets.

### 3.1 Unit (Vitest, node env) — every PR, every push

- All of `lib/` (`buildMetaAnalysis`, `cardSearch`, `deckMatrix`, `reprice-deck`, `display-name-rules`, `username-rules`, `battle-log/parse`, etc.). Today: 2 of ~20 modules covered.
- Route handlers in `app/api/**/route.ts`, called as functions with a mocked `NextRequest` and Supabase mocked at the `lib/supabase/*` boundary.
- Pure presentational helpers (`metaPrimaryCard`, `primaryCardImage`, `setReleaseDates`).
- **Coverage target**: 80% line coverage on `lib/` by end of Phase 2 (§9); 60% on `app/api/`.
- **Runtime budget**: under 30s on CI.

### 3.2 Component (Vitest + jsdom + RTL) — every PR

Reserved for client islands that carry non-trivial state. The Swift analogy: this is your view-model test layer. Candidates today:

- `app/my-decks/[id]/MyDeckClient.tsx` — rename/delete state, MatchLog inline form
- `app/components/DeckProfileView.tsx` — conditional `subtitle`, `topSlot`, `footerCta` rendering
- Future: any filter/search island (sidebar archetype filter, global search)

Skip for components that are pure layout — those are caught by E2E.

### 3.3 Integration (Vitest, real Supabase branch) — on push to `preview`

The class of bugs you cannot catch with mocks: **RLS policy regressions**. The cascading "deck is public only if its profile is also public" rule from `20260428_phase1_visibility.sql` is one bad migration away from leaking private decks. Integration tests run against an ephemeral Supabase branch that has all migrations applied, seeded with fixture users, and torn down at the end of the run.

What gets covered:

- RLS policies on `saved_decks`, `profiles`, `user_card_collection`
- `POST /api/analyze` end-to-end with a real DB-backed lookup path
- `/api/saved-decks/[id]/clone` and `/like` flows
- `/api/deck-share` short-id generation + retrieval round-trip

### 3.4 E2E (Playwright against preview deploy) — on preview deploy success

Five critical user journeys, run headlessly in Chromium + WebKit. These ride the Vercel deploy-success webhook so we test the artifact a user will actually see, not a `next start` against `localhost`.

1. **Paste-deck-analyze**: paste a known decklist on `/`, expect archetype detected, price computed, meta match shown.
2. **Sign-in + save deck**: Discord OAuth (stubbed), navigate to `/my-decks`, save the analyzed deck, confirm it appears.
3. **Share-deck**: generate a `/d/[shortId]` link, open it in an incognito context, confirm public render.
4. **Log match**: from `/my-decks/[id]`, log a match via the inline form, confirm it appears.
5. **Meta archetype browse**: `/meta-decks`, filter, open one archetype, confirm variants render with images.

### 3.5 Smoke / synthetic (Playwright against prod) — daily cron + on-demand

A tighter subset of the E2E suite, parameterized to hit `tcgdexter.com` instead of `preview.tcgdexter.com`. Read-only — no writes against prod. Catches: Vercel deploy succeeded but a route is 500-ing, the meta-decks JSON commit broke the parser, a Supabase schema drift between preview and prod.

Runs at **06:30 UTC daily** (after `dexter-ops` finishes its 06:00 push). Failure posts to Slack `#radar` and writes a row the dashboard reads.

### 3.6 Data-freshness check — daily cron

Standalone GH Action. Reads `data/meta-decks.json`, `data/cards-standard.json`, `data/shop-listings.json` and asserts the git-commit timestamp on each is < 36 hours old. If a JSON didn't refresh, the dexter-ops mac mini probably went to sleep or hit a rate limit. Surfaces to the dashboard.

## 4. CI/CD workflows — the GitHub Actions set

Six workflows. Each does one job and one job only.

| File | Trigger | Purpose |
|---|---|---|
| `unit.yml` (renamed from `checks.yml`) | PR + push to any branch | typecheck + Vitest unit + component |
| `integration.yml` | push to `preview` | Supabase branch + integration suite |
| `e2e-preview.yml` | Vercel preview `deployment_status: success` | Playwright against the deploy URL |
| `smoke-prod.yml` | cron `30 6 * * *` + `workflow_dispatch` | Playwright smoke against tcgdexter.com |
| `data-freshness.yml` | cron `0 14 * * *` (after smoke) | JSON commit-age guard, writes status row |
| `update-meta-decks.yml` (existing) | manual | unchanged |

Branch protection on `preview` requires: `unit.yml` and `integration.yml` green.
Branch protection on `main` requires: latest `smoke-prod.yml` from `preview` is green within the last 24h (manual override allowed for hotfix cuts).

The Supabase branching dance in `integration.yml`:

```
- Create Supabase branch via supabase-mcp / CLI, named after the GH run ID
- Run migrations from supabase/migrations/ against the branch
- Seed via scripts/seed-test.ts (new — fixtures: 2 users, 4 decks, 1 shared match)
- Run vitest --project=integration with SUPABASE_URL pointing at the branch
- Delete the branch (always, even on failure)
```

The Vitest "projects" config (Vitest 2.1 supports this natively) carves unit/component/integration into separate command flags so we can run only what we need: `vitest --project=unit`, `vitest --project=integration`.

## 5. Test-driven development — how it actually lands

TDD is a workflow change, not a tooling change. The mechanics:

**New feature loop** — a `feature/<thing>` branch begins with an empty PR description, an empty file, and a failing test. The test asserts the user-visible behavior the feature exists to deliver. The Swift analogy: same posture as writing a `XCTestCase` against a stubbed view model before the implementation exists. The test sits red until you fix it; once green, you refactor freely against it.

**Bug fix loop** — start by reproducing the bug as a test that currently passes when it shouldn't (or fails for the wrong reason). Land the test in a single commit, then the fix in the next. Future-you looking at `dev`'s log gets the bug-as-test for free.

**Enforcement, layered**:

1. **Soft (immediate)** — PR template requires an "Evidence" section: which tests added/changed, screenshot of red-to-green if relevant.
2. **Semi-soft (Phase 2)** — `unit.yml` runs a coverage diff. PRs that lower coverage on touched files get a warning comment, not a block.
3. **Hard (Phase 3, once a second contributor joins)** — coverage delta becomes a required check; `lib/` and `app/api/` enforce no-regression.

We are not making test-first a religious rule on the first day. We are wiring the scaffolding so it's the path of least resistance, then ratcheting.

## 6. The quality dashboard — `quality.tcgdexter.com`

### 6.1 Hosting

Lives in `tcgdexter-web` under `app/(quality)/` route group. Vercel rewrite maps `quality.tcgdexter.com/*` → `/(quality)/*`. One Vercel project, one repo, shared auth + Supabase. The route group is gated to admin users only via a server-component check at the layout level.

The iOS analogy: it's a separate scene in the same app target, not a separate target. Way less to maintain.

### 6.2 V1 scope — two surfaces

You picked test health + data pipeline health. So the dashboard ships with two cards:

**Test health card**

- Latest run status per workflow (unit, integration, e2e-preview, smoke-prod), with timestamp and duration
- 14-day pass rate sparkline per workflow
- Flaky test list — any test that has both passed and failed within the last 50 runs, ranked by flake rate
- Coverage trend on `lib/` and `app/api/` (sourced from `vitest --coverage` artifact uploaded each unit run)

Data source: GitHub Actions REST API for run history, plus a new `qa_runs` table in Supabase that each workflow upserts to at the end of its run with `{workflow, conclusion, started_at, duration_ms, sha, flaky_tests[]}`.

**Data pipeline health card**

- Last commit timestamp + author for each of: `data/meta-decks.json`, `data/cards-standard.json`, `data/shop-listings.json`, `data/meta-archetypes.json`, `data/deck-alerts.json`
- "Hours since last refresh" with a green/amber/red dot at 24h/36h thresholds
- Last 7 days of dexter-ops summary email subjects (if we route the Resend webhook to a Supabase function — small lift)

Data source: GitHub Contents API for file commit metadata, no writes needed.

### 6.3 V1 explicitly excludes

- DORA metrics. Deferred until you want them.
- Runtime error / latency observability. Deferred. When that surfaces, the natural next step is wiring Sentry or Axiom and adding a third card.
- Per-user analytics. Different problem class, different tool.

### 6.4 Stretch (post-v1)

Build the dashboard as a live `cowork__create_artifact`-style page even outside Cowork: it refetches GH API on focus, no service worker, no cron job. Keeps the surface area minimal.

## 7. Supabase migrations — graduating from "checked in but unverified"

Migrations live in `supabase/migrations/` already. What's missing: nothing verifies they apply cleanly to a fresh DB. Phase 2 adds:

- `scripts/migrate-check.sh` — spins a temp Supabase branch, applies all migrations, asserts no errors, deletes the branch
- Wired into `unit.yml` as an optional fast job (the branch creation is the bottleneck — ~30s — acceptable on PR)
- The integration suite (§3.3) effectively re-validates this every preview push, since it does the same dance

This is also the gate for whether we ever ship a migration that drops a column or rewrites RLS. The cost of getting that wrong is private decks leaking. Worth the 30s.

## 8. The dexter-ops boundary

`dexter-ops` is out of scope for this plan — it stays on launchd on your Mac for now. But the web side gains:

- The data-freshness check (§3.6) — surfaces when the Mac mini fell over
- A future migration path: when you're ready, the same `daily_ops.py` becomes a GitHub Actions workflow with a `cron` trigger. The dexter-ops repo gets its own `unit.yml` for its Python pipeline. Not Phase 1 — flagged here so we don't paint ourselves into a corner.

## 9. Phased rollout

Six weeks, three phases. Each phase is independently shippable.

### Phase 1 — Foundations (Week 1–2)

- Rename `checks.yml` → `unit.yml`; add `vitest --coverage` + artifact upload
- Add Vitest projects config: unit, component, integration
- Write the first 5 high-leverage unit tests: `lib/buildMetaAnalysis`, `lib/cardSearch`, `lib/deckMatrix`, plus the deck parser + archetype detector extracted out of `app/api/analyze/route.ts` (this extraction is itself a refactor worth doing; the route handler is 707 lines of mixed concerns)
- PR template with Evidence section
- Stand up the `qa_runs` table in Supabase + a tiny `lib/qa-runs.ts` writer

### Phase 2 — Integration & E2E (Week 3–4)

- `integration.yml` with Supabase branching, seed script, first 3 RLS regression tests
- Playwright bootstrap + the 5 E2E user journeys (§3.4)
- `e2e-preview.yml` triggered on Vercel deploy webhook
- Coverage diff warning on PRs

### Phase 3 — Daily & Dashboard (Week 5–6)

- `smoke-prod.yml` daily cron + `#radar` Slack alert
- `data-freshness.yml` daily cron
- `quality.tcgdexter.com` rewrite + the two v1 cards
- Branch protection on `preview` and `main` flipped on
- Update `CLAUDE.md` to reflect the new test-first workflow

## 10. Risks & mitigations

**Supabase branch cost.** Per-PR branches add compute spend. Mitigation: integration runs only on push to `preview`, not on every dev branch push; PR-only previews stay mocked.

**Playwright flake.** E2E suites notoriously flake on real networks. Mitigation: retry-on-failure once at the test level, mark flakes in the dashboard so we can hunt them down rather than ignore them.

**Refactoring the 707-line analyze route.** That extraction (Phase 1) is the riskiest single change in the plan because the route has zero tests today. Mitigation: write characterization tests first (call it with a corpus of real decklists, snapshot the responses), then refactor under that net.

**Dashboard scope creep.** "While we're at it, add DORA / Sentry / latency" will be tempting. Hold the line at v1 scope; expansion goes through a follow-up doc.

---

## Open decisions still needed from you

The decisions below didn't make it into the question round and would each shift Phase 1 or 2 scope. None are blocking — defaults are noted where I have a recommendation.

1. **Test-fixture user provisioning** — for integration tests, we need 2 fixture Supabase users with Discord OAuth completed. Easiest is to create them manually once in the test project and store their refresh tokens as repo secrets, or to fully mock the Discord OAuth callback in the seed script. _Default: mock the callback._

2. **Smoke prod write tolerance** — should daily smoke ever exercise an authenticated write path (e.g., creating a temp deck under a service-account user, then deleting it)? Stronger signal, but adds prod-data risk. _Default: read-only smoke, writes only in preview E2E._

3. **Flaky test policy** — when a test is auto-flagged flaky on the dashboard, do we (a) require a fix within N days or it gets quarantined and the workflow goes red, or (b) leave it in soft mode and just track? _Default: soft for first month, then enforce a 7-day fix window._

4. **Dashboard admin gate** — which list of user IDs counts as "admin" for `quality.tcgdexter.com`? Hardcode by email in env var, or add an `is_admin` column to `profiles`? _Default: env var for v1, migrate to column when there's a second admin._

5. **Coverage tool** — Vitest's built-in c8 vs istanbul. _Default: v8 (Vitest's default in v2.1), reports to text + json-summary for the dashboard parser._

## References

- `docs/infra-phase-plan.md` — the prior lean plan this supersedes
- `CLAUDE.md` — project conventions (will be updated in Phase 3)
- `.github/workflows/checks.yml` — current workflow being renamed/extended
- `tcgdexter-web-dev-protocol.skill` — dev/preview/main branch protocol

---

_Authored: 2026-05-26. Owner: Christian. Next review: end of Phase 1._
