# Coach Dexter — admin-only MVP spec

**Branch:** all the engine work this depends on lives on `strategist`
(24 commits ahead of `preview`). Start from `strategist`, not `preview`.

**Goal of this MVP:** an admin-only page that takes one imported battle log and
shows, decision by decision, what the player gave up and what they should have
played instead — plus the plays they got right that a competent bot would have
missed.

**Explicitly out of scope:** any user-facing route, any write to a user-visible
table, any change to the live AI opponent, any change to `preview`'s production
paths. This is a read-only admin instrument.

---

## 1. What already exists (do not rebuild)

The analysis engine is done, tested and validated. The MVP is a UI over it.

| module | role |
|---|---|
| `lib/ml/strategist/coachGame.ts` | **the entry point.** Log row in, graded decisions out. |
| `lib/ml/strategist/regret.ts` | values every legal move by rolling it forward |
| `lib/ml/strategist/logDecisions.ts` | replays a log and reconstructs each human decision |
| `lib/ml/strategist/determinize.ts` | fills the opponent's hidden zones from the meta prior |
| `lib/ml/strategist/calibrate.ts` | Q → P(win) map, and severity quantiles |
| `scripts/ml/coach_report.ts` | the CLI that aggregates `coachGame` — **read this first**, it is the reference consumer |

### The one function you need

```ts
import { coachGame, DEFAULT_SEVERITY } from "@/lib/ml/strategist/coachGame";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";

const evaluate = createBotEvaluator();      // null if no artifact is live
if (!evaluate) throw new Error("no value artifact");

const game = coachGame(
  { id, battle_log_raw, player_handle, deck_list },  // LogRow
  { evaluate, rollouts: 16, horizon: 6, seed: 1 },
);
```

Returns `CoachedGame`:

```ts
{
  logId: string;
  decisions: CoachedDecision[];   // every decision it could evaluate, in order
  coverage: number;               // matched / found  — see §5, SHOW THIS
  meanCapture: number | null;     // the game-level skill number
  blunders: CoachedDecision[];    // significant + severity != "ok", worst first
  highlights: CoachedDecision[];  // skilled plays, biggest stakes first
  stats: ScanStats;               // logsUsed/logsFailed/decisions/matched/...
}
```

Each `CoachedDecision`:

```ts
{
  turn: number | null;            // 1-indexed turn in the log
  actionIndex: number;            // index into the parsed action list
  played: string;                 // "Played Poké Pad — fetched Purrloin"
  playedKind: string;             // "play_trainer" | "attack" | "bench" | ...
  bestAlternative: string | null; // the best move that was NOT played
  regret: number;                 // ORDINAL, 0..1 — see §4 before rendering
  regretSe: number;               // paired standard error of `regret`
  regretCalibrated: number | null;// only if a calibration artifact is passed
  severity: "ok" | "inaccuracy" | "mistake" | "blunder";
  significant: boolean;           // regret > 2*regretSe — GATE ON THIS
  capture: number | null;         // share of available value taken, 0..1
  stakes: number;                 // best minus worst: how much the decision mattered
  qChosen: number; qBest: number; // raw values, for debugging
  skilled: boolean;
  legalCount: number;             // how many moves were available
}
```

---

## 2. What to build

### 2.1 Route

`app/admin-tools/coach/page.tsx` — a new tool, server component, following the
**exact** gate used by every other admin tool (copy it verbatim from
`app/admin-tools/ml/page.tsx`):

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");
const { data: me } = await supabase
  .from("profiles").select("is_admin").eq("id", user.id)
  .maybeSingle<{ is_admin: boolean }>();
if (!me?.is_admin) redirect("/");
```

Add an entry to the `TOOLS` array in `app/admin-tools/page.tsx`:

```ts
{
  href: "/admin-tools/coach",
  title: "Coach Dexter",
  description: "Grade a battle log decision by decision — blunders and brilliancies.",
}
```

### 2.2 Log picker

Server-side, list recent imported logs the admin can grade:

```sql
SELECT m.id, m.player_handle, m.opponent_handle, m.result,
       m.played_at, m.total_turns, m.opponent_archetype, d.deck_list
  FROM matches m
  LEFT JOIN saved_decks d ON d.id = m.saved_deck_id
 WHERE m.battle_log_raw IS NOT NULL AND m.player_handle IS NOT NULL
 ORDER BY m.played_at DESC
 LIMIT 50
```

Do **not** select `battle_log_raw` for the list — it is large. Fetch it only
in the analysis route for the chosen id.

`deck_list` is nullable and **matters**: without it the reconstructed deck is
weaker and coverage drops. Show a marker on rows that have no linked deck.

### 2.3 Analysis endpoint

`app/api/admin/coach/route.ts`, `POST { matchId, rollouts?, horizon?, seed? }`.

- Re-check `is_admin` **server-side in the route**. Do not trust the page gate.
- Load the row, call `coachGame`, return the `CoachedGame` minus
  `decisions[].qChosen/qBest` unless `?debug=1`.
- `export const maxDuration = 60;` and `export const dynamic = "force-dynamic";`

**Performance, measured:** ~0.17 s per evaluated decision at `rollouts: 16,
horizon: 6`; a typical log yields ~17 evaluated decisions, so **~3 s per game**.
That fits a serverless request on the Pro plan, but the first call in a cold
lambda also loads the 14.5 MB card catalog and the ~650 KB value artifact.
Expect a slow first request. If that proves painful, the fix is a persisted
result cache keyed by `(matchId, engineVersion, modelVersion, rollouts,
horizon, seed)` — **not** reducing rollouts, which widens every error bar.

### 2.4 The page

Client component, three regions.

**a) Game summary**
- Coverage, stated honestly: *"Evaluated 9 of 17 decisions (53%). The rest are
  plays the engine cannot yet reconstruct — not necessarily good or bad."*
- `meanCapture` as a percentage, labelled **"value captured"**, with one line
  of explanation: *"Of the value available at the decisions we could read, you
  took 58%."*
- Counts by severity, and the number of highlights.

**b) Decision timeline** — one row per decision, in play order:
- turn number, `played`
- a severity chip (`ok` / `inaccuracy` / `mistake` / `blunder`), or a
  distinct "brilliant" chip when `skilled`
- for anything worse than `ok`: `bestAlternative` as *"better: …"*
- **render rows with `significant === false` in a muted style and no chip.**

**c) Detail** — clicking a row expands to show `legalCount`, `stakes`, and the
error bar. Keep it plain.

---

## 3. The gate that must not be skipped

**Only surface a judgement when `decision.significant === true.**

`significant` means `regret > 2 × regretSe` — the play's cost clears its own
error bar. Everything else is noise, and the whole instrument's credibility
rests on not showing it. `game.blunders` is already filtered this way; if you
build your own list, filter it yourself.

---

## 4. Units — read this before writing any copy

This is the single easiest thing to get wrong, and getting it wrong makes the
product say things that are not true.

**`regret` is ORDINAL, not a probability.** It is denominated in the search's
Q, which *discriminates* well on real logs (bottom decile of decisions won
41.5% of the time, top decile 92.9%) but is *not calibrated* to any real
population — mean |predicted − actual| was 27.6 points before correction,
because the value model trained on 50%-base-rate mirror self-play while the
humans who log battles here win ~72%.

So:

- **DO** show `severity`. It is a quantile of the observed regret distribution,
  so "worse than 98% of decisions" is a true statement about an ordinal score
  and needs no calibration at all. This is what a chess site shows.
- **DO** show `capture` for the game-level number.
- **DO NOT** print `regret` as "you lost 8% win probability". Not in the MVP.
- If you want a percentage, pass a `CalibrationArtifact` (`{a: 0.357,
  b: 1.266}`, fit on all 271 logs, reliability 31.3 → 1.4 pts, out-of-fold
  identical) and use `regretCalibrated` — and even then the honest phrasing is
  *"players in positions like this went on to win X% of the time"*, never
  *"you had an X% chance"*.

**Never aggregate raw `regret` over a game.** It scales with the position's
stakes, stakes scale with board development, and a developed board is what
winning looks like — so mean regret *rewards the player who never developed*.
Measured over 271 logs: mean regret separates winners from losers at
**z = −0.20** (nothing, and it pointed the wrong way at small n), while mean
`capture` separates them at **z = +4.67**. Use `meanCapture`.

---

## 5. Known limits to surface, not hide

- **Coverage is ~53%.** Roughly half of a human's decisions cannot be
  reconstructed — the replay reducer learns cards as they surface, and some
  card effects have no engine representation. The UI must say how many
  decisions were evaluated. Never imply a complete review.
- **Q is ordinal** (see §4).
- **The coach cannot see above its rollout pilot.** Move values assume play
  continues at `HeuristicPolicy` strength. A setup play whose payoff needs
  strong follow-up will be undervalued.
- **The search agrees with human players less than the incumbent planner does**
  (23.6% vs 30.6%, McNemar z = −4.75) while winning decisively in self-play.
  Consistent with known PIMC behaviour; unresolved. If advice ever reads as
  alien to a strong player, this is the first thing to suspect.

---

## 6. Acceptance criteria

1. `/admin-tools/coach` is unreachable for a non-admin (redirects) and the API
   route returns 403 for a non-admin **independently of the page**.
2. Picking a log and running the coach returns within ~10 s warm and renders a
   decision timeline.
3. The summary states coverage as a fraction, in words.
4. No row without `significant === true` carries a severity chip.
5. No string anywhere renders `regret` as a win-probability percentage.
6. Re-running the same log with the same seed produces identical output
   (`coachGame` is deterministic given a seed — there is a test for this).
7. `npx tsc --noEmit` clean; `npm test` passes (860 tests on this branch).
8. Nothing outside `app/admin-tools/coach/`, `app/api/admin/coach/`, and the
   one `TOOLS` entry is modified.

---

## 7. Verify against the CLI

`scripts/ml/coach_report.ts` is the reference consumer and already prints all
of this. Cross-check the UI against it for the same log:

```bash
npx tsx scripts/ml/coach_report.ts --limit 1 --rollouts 16 --top 5
```

If the page and the CLI disagree about a log, the page is wrong — they call the
same `coachGame`, and keeping it that way is deliberate.

---

## 8. Repo conventions that apply

- Design tokens in `app/globals.css` (`--bg`, `--surface`, `--accent`,
  `--text-primary/secondary/muted`). Elevated cards use `bg-white`.
- Action buttons: `text-xs font-semibold`, `px-3 py-1.5`.
- **`main` is production.** Work on `strategist`. Do not merge to `preview`
  without `npx tsc --noEmit` and `npm test` passing.
- Adding a page that reads `matches` introduces no new data category, so no
  Privacy Policy change is needed. If this is ever extended to store generated
  coaching output against a user's account, that **is** a new category — flag
  it then.
