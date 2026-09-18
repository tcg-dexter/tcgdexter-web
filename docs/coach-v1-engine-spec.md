# Coach Dexter v1 — engine handoff

**Supersedes the engine half of `coach-dexter-mvp-spec.md`.** That spec described
an admin tool over an unvalidated engine. The tool got built and the engine has
since been measured against an independent oracle, so this replaces the numbers,
adds two fields, and changes three UI behaviours. **The MVP spec's §3 (the
significance gate) and §4 (units) still stand verbatim and are restated here
because they are the two things easiest to get wrong.**

**Audience for v1: admin only.** Unchanged from the MVP. No user-facing route, no
write to a user-visible table, no stored coaching output. Storing generated
coaching against a user's account IS a new data category and needs the Privacy
Policy flagged first — that decision is deliberately not taken here.

**Branch:** `coach-trust` (off `preview`).

---

## 1. What changed, in one table

| | MVP spec said | now |
|---|---|---|
| coverage of a real game | ~53% | **78.2%** (9,620 of 12,296 decisions over 371 logs) |
| is the advice correct? | unmeasured | **80.3%** of 1,012 resolved, z=24.3, vs an independent oracle |
| severity thresholds | 9.03 / 24.12 / 58.49 | **5.33 / 17.39 / 58.49** (§5) |
| game-level skill number | mean capture over everything | observed decisions only, 5-pt floor: **+7.0 pts z=3.30** (§5.1) |
| moot advice | unknown | 20% of flagged advice cannot change the result; now **detected** (§4.1) |
| new fields | — | `materialized` (§7), `moot` (§4.1) |
| new option | — | `verifyMoot` (§4.1) |

Nothing about the call signature changed. `coachGame(row, options)` is still the
entry point and `scripts/ml/coach_report.ts` is still the reference consumer.

---

## 2. Why the engine can be trusted now

The MVP shipped on an engine whose advice had never been checked against
anything but itself. `regret` IS a simulation output, so re-simulating to
validate it grades the model's own homework — it agrees with itself to within
sampling noise and means nothing.

`scripts/ml/coach_trust.ts` checks it against an **oracle that shares no value
model with the coach**: `horizon: null, evaluate: null`, which plays each
position to a real terminal and scores 1/0.5/0, at 480 rollouts.

    precision      80.3% of 1,012 resolved recommendations   z=24.3
    by epsilon     81% / 82% / 77%  at player error rates 0.10 / 0.20 / 0.35
    oracle itself  positive control z=3.35, stability 15/15, byte-reproducible

The flat epsilon row is the important one: precision does not depend on grading
a deliberately bad player, so it should hold for real humans.

**Per-class trust prior — use this to order the UI, not to hide things:**

| class | precision | note |
|---|---:|---|
| severity `blunder` | 89.2% | monotone with severity |
| severity `mistake` | 83.3% | |
| severity `inaccuracy` | 75.6% | |
| stakes ≥ 50 pts | 87.1% | monotone with stakes |
| suggested move is `pass` | 68.9% | **significantly worse** — don't lead with these |
| suggested move is `retreat` | 73.2% | suggestive only, partly explained by late-game |

`attach_tool` and `use_ability` looked far worse still, at n=7 and n=5. Those are
below any usable sample size and are deliberately NOT reported as findings.

---

## 3. The gate that must not be skipped (unchanged)

**Only surface a judgement when `decision.significant === true`.**

`significant` means `regret > 2 × regretSe` — the play's cost clears its own
error bar. `game.blunders` is already filtered this way; a hand-built list must
filter itself. Everything else is noise, and the instrument's credibility rests
on not showing it.

---

## 4. The three v1 behaviours

### 4.1 Suppress the chip on moot advice, keep the row

~20% of flagged decisions are ones where the oracle proves both moves lead to
the identical result — measured at 19.6% and 20.1% on self-play positions and
21% on real logs, rising to **32% after turn 21**, and 60% of all advice is
late-game. The advice is correct and irrelevant. A "blunder" chip on a game the
player had already won reads as the coach not understanding the game.

**Behaviour:** the decision still appears in the timeline in play order, with its
move text. It carries **no severity chip and no "better:" line.**

**How to detect it: the engine already does.** Pass `verifyMoot: true` and read
`decision.moot`.

```ts
const game = coachGame(row, { evaluate, rollouts, horizon, seed, verifyMoot: true });
// decision.moot === true   -> no chip, no "better:" line. Keep the row.
// decision.moot === false  -> render normally.
// decision.moot === null   -> undetermined. Treat as false (render normally);
//                             null is NOT "this mattered", it is "we could not tell".
```

**Cost: ~2.3 s per game on top of ~4 s.** It runs only on decisions that would
carry a chip — about 6 a game, not 26 — which is what makes a real-terminal
oracle affordable at all. 192 rollouts gives 98% precision and 100% recall
against a 480-rollout reference; see §7.1 for why a cheaper budget is not a
safe economy.

### 4.2 Per-game accuracy: show `meanCapture`, no comparisons

Show it for the game under review, labelled **"value captured"**, with one line
of plain explanation: *"Of the value available at the decisions we could read,
you took 58%."*

**Do NOT** build a history chart, a cross-player ranking, a leaderboard, or any
badge derived from it. The metric separates a player's own wins from their own
losses — it is not comparable between different players, and the log corpus is
contaminated in a way that makes cross-player comparison actively misleading
(one handle is 43% of all logs at a 57.6% win rate while everyone else averages
78.7%, because casual users log wins and drop losses).

### 4.3 Coverage, stated in words

*"Evaluated 26 of 33 decisions (78%). The rest are plays the engine cannot yet
reconstruct — not necessarily good or bad."*

Never imply a complete review.

---

## 5. Numbers to hard-code

```ts
// Refit over 371 logs / 9,620 valued decisions at the new 78% coverage.
// These are QUANTILES of the regret distribution, so they describe a
// POPULATION — and the population changed when coverage did. The MVP spec's
// values described a population that no longer exists; do not carry them
// forward.
export const DEFAULT_SEVERITY = {
  inaccuracy: 0.0533,  // was 0.0903
  mistake: 0.1739,     // was 0.2412
  blunder: 0.5849,     // unchanged
};
```

Note the shape of that change: the two lower bars fell substantially while
`blunder` did not move at all. The ~4,900 newly readable decisions are almost
entirely small-mistake ones — the coach did not start finding more disasters,
it started seeing the ordinary play it was previously blind to.

**The route already inherits this.** `app/api/admin/coach/route.ts` calls
`coachGame(row, { evaluate, rollouts, horizon, seed })` and never passes
`severity`, so updating the constant is the whole change.

### 5.1 `meanCapture` must exclude recovered decisions

**This is load-bearing and is not a tuning preference.** Measured on 371 logs:

    all decisions        +1.5 pts   z=0.90    NOT separable
    observed only        +5.4 pts   z=2.72    SEPARABLE
    recovered only       +0.6 pts   z=0.22    no signal at all

Recovered decisions (`materialized === true`, §7) carry **no skill signal**.
Not because they are small — their mean stakes are 17.9 pts against observed
20.5 — but because the reconstructed hand is a floor on the real one, so the
alternatives `capture` divides by are incomplete.

Excluding them reproduces the pre-coverage-fix result (+5.5 pts, z=2.57)
almost exactly, which is the tell: the original validation WAS the observed
decisions, and raising coverage added decisions rather than signal.

So:

- **`meanCapture` — observed decisions only.** Including recovered ones makes
  the game-level skill number statistically meaningless.
- **Per-decision advice — show recovered decisions normally.** Their played
  move is CERTAIN; the log says it happened. Only the capture ratio is
  untrustworthy, and only because the alternatives are thin.
- **`severity` — computed over ALL shown decisions,** including recovered. It
  is a quantile of what the coach displays, so the population for it is the
  displayed population. That is why §5's thresholds include them while §5.1
  excludes them; the two numbers answer different questions.

A stakes floor stacks with this, and both are already applied by the engine —
`minStakes` now defaults to **0.05**, not 0.02. Swept against real outcomes,
observed decisions, pooled within player:

    floor    all decisions        observed only
     2 pts   +1.5 z=0.90 (8p)     +5.4 z=2.72 (6p)
     5 pts   +1.9 z=1.09 (8p)     +7.0 z=3.30 (5p)   <-- operating point
    10 pts   +4.8 z=2.29 (6p)     +7.1 z=2.77 (4p)
    20 pts   +9.8 z=2.85 (4p)    +13.0 z=2.98 (2p)   only two usable players

**The final number is +7.0 pts at z=3.30 — stronger than the +5.5/z=2.57 that
existed before coverage rose.** The metric was not merely rescued; it improved,
once the decisions that carry no signal stopped being averaged into it.

The 20-point row shows a larger effect on two players. Do not chase it: a
two-stratum fixed-effects estimate is exactly the fragile reading this project
has been burned by repeatedly.

**Nothing here is the UI's job.** `coachGame` applies both rules internally, so
`meanCapture` is already correct to display as-is.

**Moot-advice predictor:** see §7.1.

---

## 6. Units — restated because it is the easiest thing to get wrong

**`regret` is ORDINAL, not a probability.** It is denominated in the search's Q,
which discriminates well but is not calibrated to any real population.

- **DO** show `severity`. It is a quantile, so "worse than 95% of decisions" is
  a true statement about an ordinal score and needs no calibration. This is what
  a chess site shows.
- **DO** show `capture` as the game-level number (§4.2).
- **DO NOT** print `regret` as "you lost 8% win probability". Not in v1.
- **NEVER aggregate raw `regret` over a game.** It scales with the position's
  stakes, stakes scale with board development, and a developed board is what
  winning looks like — so mean regret *rewards the player who never developed*.
  Measured: mean regret separates winners from losers in the WRONG direction
  (z=−3.26). `meanCapture` is the one to aggregate.

---

## 7. `materialized` — a field the UI should understand

New on `CoachedDecision`.

The replay reducer, handed a played card it never saw, fabricates one straight
into the discard. Correct for replay, but it meant the card was in hand in no
snapshot, so every such decision was unreadable — 60.7% of the reconstruction
gap. `materializePlayedCard` puts it back on the strength of the log's own
testimony, which is what took coverage from 33.7% to 63.2% on synthetic logs and
53% to 78.2% on real ones.

**What it means for a consumer:** a recovered decision's played move is
*certain* — the log says it happened — but the surrounding hand is a **floor** on
the real one, so its alternatives (and therefore its `capture`) carry more
uncertainty than an observed decision's.

**The engine already excludes them from `meanCapture`** (§5.1). Their
per-decision advice still renders normally.

If the UI ever wants to mark them, "reconstructed" is the honest word — but v1
does not need to, and a badge nobody can act on is noise.

## 7.1 Why moot advice is VERIFIED rather than predicted

Recorded so nobody replaces the oracle call with a cheap heuristic and thinks
they have optimised something.

| predictor | AUC for "this advice is moot" |
|---|---:|
| `\|oracleQ − 0.5\|` (truth side, not available in production) | 0.864 |
| **`\|prodQ − 0.5\|` (production's own Q)** | **0.503 — chance** |
| logistic over every production feature, held out by game | 0.691 |
| turn number alone | 0.709 |

Production's Q is not merely uncalibrated, it is **uninformative** about whether
a position is decided: it sits around 0.24–0.29 either way, because horizon-6
scoring with `value-gbm-v1` never reaches extremes. `stakes` actively points the
wrong way, assigning decided positions HIGHER stakes (0.414 vs 0.369).

A turn threshold is the best cheap option and is still a bad trade: suppressing
at turn ≥20 hides 29% of all advice to catch half the moot, and only 34% of what
it hides is genuinely moot.

**Budget curve, against a 480-rollout reference:**

    24 rollouts    84% precision, 100% recall, 0.05 s
    96 rollouts    91% precision, 100% recall, 0.20 s
    192 rollouts   98% precision, 100% recall, 0.39 s   <-- default

Recall is 100% everywhere because genuinely equivalent moves agree in every
rollout. The budget buys PRECISION — i.e. not suppressing real advice — and
below ~90% suppression costs more credibility than the moot advice it removes.

**One trap, because it was hit during implementation.** The check MUST
determinize both sides before rolling out. A log replay knows only what
surfaced, so both decks are empty; rolled to a terminal untreated, both arms
deck out identically in every rollout and **every** decision reads as moot. The
first implementation omitted it and measured 83% moot on real logs against 20%
on self-play. With determinization it measures 21%, matching the independent
figure. If this number ever comes back above ~40%, suspect the `prepare` hook
before believing it.

---

## 8. Known limits to surface, not hide

- **Coverage is 78%,** not 100%. Say so (§4.3).
- **Q is ordinal** (§6).
- **The coach cannot see above its rollout pilot.** Move values assume play
  continues at `HeuristicPolicy` strength, so a setup play whose payoff needs
  strong follow-up is undervalued.
- **80.3% is an upper bound.** It was measured on self-play positions, which
  carry no reconstruction loss. Real logs do.
- **The search agrees with human players less than the incumbent planner**
  (23.6% vs 30.6%, McNemar z=−4.75) while winning decisively in self-play.
  Consistent with known PIMC behaviour; unresolved. If advice ever reads as
  alien to a strong player, suspect this first.
- **Nothing measures whether advice is TEACHABLE.** The study measures only
  whether it is correct. There is no feedback surface anywhere in the product,
  so this is unmeasured rather than measured-and-fine.

---

## 9. Performance

**0.16 s per evaluated decision** at `rollouts: 16, horizon: 6`, measured over
9,620 real decisions. A typical log yields ~26 evaluated decisions, so **~4 s per
game** — up from the MVP's ~3 s, because coverage rose 47%.

The first call in a cold lambda also loads the 14.5 MB card catalog and the
~650 KB value artifact, so expect a slow first request.

**If that proves painful, the fix is a persisted result cache** keyed by
`(matchId, engineVersion, modelVersion, rollouts, horizon, seed)` — **not**
reducing rollouts, which widens every error bar, and **not** raising the horizon,
which is measured as actively harmful at this budget (§10).

---

## 10. Do not "improve" these — they are measured dead ends

Recorded so the next person does not spend a week rediscovering them.

- **Raising the horizon makes the coach WORSE at production's budget.** h6 → h12
  → h20 takes agreement 77% → 68% → 54% at 16 rollouts. Deeper search still picks
  the right direction but can no longer resolve it, and verdicts decay into
  "unresolved".
- **Raising rollouts does not fix that.** There is no crossover at any budget up
  to 16× compute. Determinization is the binding constraint, not samples — under
  a ghost, every extra ply extrapolates further into a guessed world.
- **The remaining accuracy lever is the leaf evaluator**, worth up to 15 points,
  and it is a v2 model-training project rather than a UI change.

### 10.1 The API currently ships a footgun — please fix it

`app/api/admin/coach/route.ts` accepts a caller-supplied `horizon` and clamps it
to `HORIZON_MAX = 16`. Given the measurements above, **every value above 6 makes
the coach worse**, and "look further ahead" is exactly what a caller would
assume helps.

    at 16 rollouts:   h6 77%     h12 68%     h20 54%

Either set `HORIZON_MAX = 6`, or keep the knob and document at the call site
that raising it degrades output. Do NOT expose it in the UI as a quality dial.

`rollouts` (4–32) is safe to expose: more samples only tighten the estimate.
`ROLLOUTS_MAX = 32` is a reasonable ceiling — the sweep found no benefit beyond
the incumbent configuration that justified the compute.

---

## 11. Acceptance criteria

1. `/admin-tools/coach` unreachable for a non-admin, and the API route returns
   403 independently of the page gate.
2. No row without `significant === true` carries a severity chip.
3. No row flagged moot (§4.1) carries a severity chip or a "better:" line.
4. No string anywhere renders `regret` as a win-probability percentage.
5. The summary states coverage as a fraction, in words.
6. `meanCapture` appears once, for the game under review, with no cross-player
   or historical comparison anywhere in the UI.
7. Re-running the same log with the same seed produces identical output.
8. `npx tsc --noEmit` clean; `npm test` passes.
9. Nothing outside `app/admin-tools/coach/`, `app/api/admin/coach/`, and the one
   `TOOLS` entry is modified.

**Note:** `npm test` currently has one PRE-EXISTING failure on `preview`
(`lib/primaryCardImage.test.ts`, `headlineVariantForName` no longer resolving a
Mega variant). It is unrelated to the coach, verified on a clean worktree, and
tracked separately. Do not let it block coach work, and do not "fix" it here.

---

## 12. Verify against the CLI

`scripts/ml/coach_report.ts` is the reference consumer and prints all of this.
Cross-check the UI against it for the same log:

```bash
npx tsx scripts/ml/coach_report.ts --limit 1 --rollouts 16 --top 5
```

If the page and the CLI disagree, the page is wrong — they call the same
`coachGame`, and keeping it that way is deliberate.
