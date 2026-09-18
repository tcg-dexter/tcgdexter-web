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
| severity thresholds | 9.03 / 24.12 / 58.49 | **refit — see §5** |
| moot advice | unknown | 19% of flagged decisions provably don't change the result |
| new fields | — | `materialized`, and the moot rule in §4.1 |

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

19% of flagged decisions are ones where the oracle proves both moves lead to the
identical result — rising to **32% after turn 21**, and 60% of all advice is
late-game. The advice is correct and irrelevant. A "blunder" chip on a game the
player had already won reads as the coach not understanding the game.

**Behaviour:** the decision still appears in the timeline in play order, with its
move text. It carries **no severity chip and no "better:" line.**

**How to detect it — see §5.** Production cannot run the oracle (480 rollouts to
a terminal is far beyond a request), so this depends on a cheap predictor.

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

A stakes floor helps too and stacks with this — see the operating point in
`scripts/ml/coach_report.ts`'s OPERATING POINT table.

**Moot-advice predictor:** see §7.1 — the cheap rule does NOT exist.

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

TBD — whether v1 excludes recovered decisions from `meanCapture`. See §5.

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
