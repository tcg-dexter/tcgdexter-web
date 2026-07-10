# Security & Data-Access Audit — API Surface + RLS

_Date: 2026-07-10 · Scope: all 40 `app/api/**` route handlers, the Supabase
client wiring, and the row-level-security (RLS) policies behind them._

## TL;DR

The authorization model is **sound**. Every mutating route authenticates via
the session client, every `/api/admin/*` route gates on an explicit admin
check, and all public data access rides on a single consistent RLS cascade:
**a row is publicly visible only when the deck is public AND the owner's
profile is public.** No IDOR, no missing auth gate, and no RLS hole was found.

The findings below are hardening / hygiene items — mostly low-severity, and
several are intentional design that this document exists to record so nobody
"fixes" them into an actual hole. This audit added regression tests
(`lib/cardImages.test.ts`, `lib/bo3.test.ts`) locking in the security-critical
input guards.

## The invariants worth knowing

These are load-bearing. Keep them true.

1. **Two Supabase clients, two trust levels.**
   - `lib/supabase/server.ts` (anon key + session cookie) — RLS applies. This
     is the default for user routes; the DB enforces ownership even if a route
     forgets to.
   - `lib/supabase/admin.ts` (`createAdminClient`, service role) — **RLS is
     bypassed.** Only legitimate for service-role-only tables or routes that
     enforce visibility in application code. Never import it into a client
     component.

2. **Admin gating has two front doors, both verified present on every admin
   route:**
   - `/api/admin/crm/*` and the CRM dashboard → `assertDashboardAdmin()` /
     `requireDashboardAdmin()` (allowlist: `DASHBOARD_ADMIN_EMAILS`, fails
     **closed** on an empty list).
   - `/api/admin/spotlight/*`, `/api/admin/replay/*` → inline
     `requireAdmin()` on `profiles.is_admin = true`.

3. **The public-visibility cascade.** `saved_decks`, `deck_versions`,
   `deck_likes`, and the public battle-log route all require **deck public AND
   owner profile public**. A user flipping their profile back to private
   retroactively hides every public deck and version — RLS re-evaluates per
   query, so this holds without any cleanup job.

4. **Service-role-only tables are locked by having RLS on with _no_ policy.**
   `analysis_submissions`, `analytics_events`, `email_campaigns`,
   `email_sends`, `ops_runs`. RLS-enabled-with-no-policy = deny-all for
   anon/authenticated = correct fail-closed posture. **Do not "fix" the
   Supabase INFO advisor by adding a permissive policy** — that would open
   these tables up. They are reached only through `createAdminClient()`.

5. **User input never becomes a stored `<img src>` unchecked.**
   `cover_image_url` (POST + PATCH `/api/saved-decks`) is validated by
   `isTrustedCardImageUrl` against a host allowlist. The
   admin-only image proxies (`deck-mat`, `social-studio`) validate an outbound
   host allowlist to prevent SSRF/open-relay.

## Findings

### Low severity / hardening

| # | Finding | Notes |
|---|---------|-------|
| L1 | **`profiles.avatar_url` is stored without URL validation** (`PATCH /api/profile`). The route explicitly trusts the string the client sends. | It's only ever rendered as an `<img src>` (React escapes the attribute, so no XSS), but an attacker-controlled URL means a public profile can point its avatar at any third-party host — a privacy/tracking-beacon vector and unbounded hotlink. Recommend running it through the same `isTrustedCardImageUrl`-style allowlist, or at minimum requiring the value to live under the project's own `avatars` bucket (which is where the upload route already puts it). |
| L2 | **`isTrustedCardImageUrl` uses `startsWith`** (`lib/cardImages.ts`). | Safe **only** because every allowlist prefix keeps the trailing `/` after its host, which terminates the URL authority. Drop that slash on any entry and `https://images.pokemontcg.io.evil.com/…` would pass. Now covered by adversarial tests in `lib/cardImages.test.ts` so the property can't silently regress. |
| L3 | **`POST /api/track` is unauthenticated and writes to `analytics_events`** via the service-role client. | By design (browser analytics bridge) and reasonably defended — event names are gated to a prefix allowlist (`playmat`/`spotlight`/`learn`) and a strict regex, unknown events are silently dropped. Residual risk is analytics-table pollution/inflation by an anonymous client; there is no rate limit. Acceptable, noted for completeness. |

### Informational (Supabase advisors — reviewed, mostly intentional)

- **ERROR — `analytics_user_first_events` is a SECURITY DEFINER view.** Runs
  with the creator's privileges rather than the querying user's. It's an
  analytics view read only by the admin dashboard, so impact is limited, but
  best practice is `security_invoker = true`. Worth changing.
- **WARN — anon/authenticated can `EXECUTE` four SECURITY DEFINER functions.**
  Reviewed each:
  - `handle_new_user()`, `deck_likes_count_sync()`, `rls_auto_enable()` are
    trigger / event-trigger functions. Postgres refuses to call these directly
    via RPC ("can only be called as triggers"), so they are **not exploitable**
    — but the `EXECUTE` grant to `anon`/`authenticated` is unnecessary and
    should be revoked to clear the advisor.
  - `deck_fork_count(uuid)` **is** directly callable and, being SECURITY
    DEFINER, returns a fork count that includes private forks. This is
    **intentional** — `GET /api/saved-decks/[id]/fork` relies on it (and allows
    anonymous callers) to show a total fork count. The only thing it leaks is
    an integer count, no content. Leaving as-is.
- **WARN — `function_search_path_mutable`** on a few functions: set
  `search_path` explicitly (`SET search_path = public`) to close the standard
  SECURITY DEFINER search-path-hijack vector. Low priority (all are owned
  functions), but cheap.
- **WARN — public `avatars` bucket allows listing** (`avatars_public_read` is a
  broad SELECT). Public read of objects is required for avatar URLs to resolve,
  but the broad policy also lets a client _enumerate_ every object path. Scope
  the SELECT policy to object reads rather than listing if enumeration matters.
- **WARN — leaked-password protection disabled** in Supabase Auth. One toggle
  in the dashboard (checks passwords against HaveIBeenPwned). Recommend on.

## Suggested remediation (a reviewer can apply as a migration)

None of these are urgent, and DB changes touch **production** — apply through a
reviewed migration, not ad hoc. Suggested `supabase/migrations/*.sql`:

```sql
-- Clear the SECURITY DEFINER trigger-function advisors (defense-in-depth;
-- these are not callable via RPC, but the grant is unnecessary).
revoke execute on function public.handle_new_user()      from anon, authenticated;
revoke execute on function public.deck_likes_count_sync() from anon, authenticated;
revoke execute on function public.rls_auto_enable()       from anon, authenticated;

-- Make the analytics view honor the querying user's RLS.
alter view public.analytics_user_first_events set (security_invoker = true);
```

`deck_fork_count`'s grant is intentional (see above) and deliberately left in
place.

## What was verified clean (non-exhaustive)

- Every `/api/saved-decks/**`, `/api/matches/**`, `/api/collection/**`,
  `/api/profile/**` route authenticates and scopes writes to `auth.uid()` /
  `user.id`; ownership is additionally enforced by RLS.
- `saved_deck_version_id` on match create/edit is validated to belong to the
  match's own deck before it's stored (no cross-deck version stamping).
- Fork / clone routes read the source deck through the RLS client, so a private
  deck can't be forked by a non-owner.
- The public battle-log route (`/api/battles/[id]/log`) uses the admin client
  but manually re-checks deck-public + owner-public before returning anything.
- Admin image proxies restrict outbound fetches to a host allowlist (no SSRF /
  open relay).
