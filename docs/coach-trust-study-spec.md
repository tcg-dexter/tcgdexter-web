# Coach trust study — spec for a local session

**Where this runs:** a machine with real cores and a night to spare. Every timing
below was measured in a cloud container that is roughly 2.6x slower than the
hardware the original coach measurements came from — re-measure before sizing a
full run.

**Branch:** `preview` already carries the whole strategist engine and the shipped
Coach Dexter tool. Nothing here needs `strategist`.

**Goal:** answer, with numbers, *which coaching recommendations are worth
surfacing*. Output is two artifacts: a **per-class trust prior** and a
**per-item gate**.

**Explicitly out of scope:** wiring the result into the coach UI, any user-facing
change, any write to a user-visible table, any change to the live AI opponent.
This is an offline measurement study.

---

## 1. The trap this design exists to avoid

`regret` IS the output of a simulation: Q(best) − Q(chosen), produced by rolling
the position forward with `HeuristicPolicy` pilots over determinized hidden
information.

**Validating a recommendation by re-simulating with the same engine grades the
model's own homework.** It will agree with itself to within sampling noise, print
a confident number, and mean nothing. Formally the recommendation is `argmax Q̂`;
re-estimating `Q̂` and checking the argmax still agrees measures estimator
variance, not validity.

Every comparison in this document varies something the generator held fixed.

## 2. What already exists — do not rebuild

| module | role |
|---|---|
| `lib/ml/strategist/regret.ts` | `analyzeDecision` — values every legal move. Exports `sameMove`, `moveKey`, `semanticMoveKey` |
| `lib/ml/strategist/determinize.ts` | `determinizeOpponent`, `determinizeLogSide`, `determinizeRng` |
| `lib/ml/strategist/coachGame.ts` | the production surface; `DEFAULT_SEVERITY` |
| `lib/ml/strategist/calibrate.ts` | `severityOf`, `severityThresholds`, `fitPlatt`, `reliability` |
| `lib/engine/sim/driver.ts` | `onDecision` hook and `resumeGame` — the counterfactual seam |
| `lib/engine/sim/planner.ts` | `buildGhostState(view)` — redacts a true state to what a player can see |
| `scripts/ml/regret_calibration.ts` | **read this first.** NULL / SELECTION BIAS / STABILITY / POSITIVE CONTROL / DISCRIMINATION on self-play positions. Its position-capture block is the one to copy verbatim |
| `scripts/ml/move_agreement.ts` | the McNemar implementation (line ~284) and the rule that fidelity is reported separately from quality |
| `scripts/ml/coach_report.ts` | the aggregator, and the wrong-direction verdict branch |

`regret_calibration.ts` already answers "is the instrument self-consistent." This
study answers a different question — "is it *right*" — and that needs an external
reference.

## 3. The oracle

```ts
analyzeDecision(trueState, actor, ctx, chosenMove, {
  rollouts: 480,
  horizon: null,        // play to a real terminal, score 1 / 0.5 / 0
  evaluate: null,       // NO evaluator — this is the independence
  policies: { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
  seed: decisionSeed,
});
```

Three properties, and each is load-bearing:

- **`horizon: null` means no evaluator is consulted at all.** The oracle shares
  no value model with the thing it is judging. A systematic error in
  `value-gbm-v1` is therefore visible to this study rather than invisible to it.
- **Self-play means perfect information.** No determinization, so the oracle is
  not paying the meta-prior's approximation cost.
- **The pilot stays `HeuristicPolicy`.** See §7.1 — a stronger pilot is desirable
  but cannot be dropped into `analyzeDecision` safely, and is a separate rung.

The oracle is not omniscient. It is "what actually happens when this game is
played out, many times, from here." That is the best available ground truth and
it is genuinely independent of the coach's estimator.

## 4. Measured, in a slow container — use for ratios, re-measure for absolutes

**Error bar vs budget**, play-to-end, on one mid-game decision with real stakes:

| oracle rollouts | 2·se | full table (13 arms) | 2-arm |
|---|---|---|---|
| 48 | ±15.7 pts | 1.62 s | 0.21 s |
| 192 | ±7.5 pts | 6.52 s | 0.88 s |
| 480 | ±4.9 pts | 14.57 s | 2.07 s |

Clean 1/√n. **480 rollouts is the operating point** — it resolves a 10-point
regret, which is roughly the `inaccuracy` threshold (`DEFAULT_SEVERITY.inaccuracy`
= 0.0903). Anything below ~192 cannot resolve the effects this study is about;
the first smoke run at 48 produced ±15.7 and was useless.

**Cost is linear in arms.** 2-arm is 7x cheaper than a 13-arm table, and 2-arm is
all the headline metric needs (§5.2). Budget roughly:

- 2-arm at 480 rollouts: ~2 s/decision → **10,000 decisions ≈ 6 h** here, less on
  real hardware.
- Full table at 480: ~15 s/decision → reserve for a **~1,000-decision subsample**
  for recall and rank correlation.

**Production arm** (16 rollouts, horizon 6, `value-gbm-v1`): 0.22 s/decision.
Negligible next to the oracle.

## 5. What to build

### 5.1 Corpus generation — and the mistake that wasted the first smoke run

Capture positions with `playGame(..., { onDecision })`, keeping
`structuredClone(ev.state)`, `{...ev.ctx}`, `ev.move`, `ev.legal`.

**The captured player must not be the rollout pilot.** The first smoke run used
`HeuristicPolicy` on both sides, and production surfaced **zero** recommendations
in 12 decisions — the coach was grading a player whose policy was identical to its
own pilot, so it found nothing to say. Injecting noise fixed it immediately:

```ts
// epsilon chance of a uniform-random legal move, else heuristic.
// Promotion delegates to the heuristic so the noisy side is not additionally
// handicapped after a KO — skill_ladder.ts's RandomPolicy does the same.
class NoisyPolicy implements DecisionPolicy { /* EPSILON = 0.35 */ }
```

With `ε = 0.35` on one side only, and grading only that side's decisions: 301
gradeable decisions from 6 games, and 6 of 40 sampled decisions surfaced a
recommendation. Sweep `ε` — it is the dial that sets how many genuine mistakes
exist to be caught, and precision should be reported *per ε band*, since a study
run only at high ε measures precision on blunders that no real player makes.

### 5.2 The headline metric — a 2-arm question

"Is this recommendation worth surfacing" does **not** need a full Q table. It is:

> Under oracle conditions, does the move the coach suggested actually beat the
> move the player made?

Paired on common random numbers, since `analyzeDecision` returns index-aligned
`samples` across arms:

```ts
const paired = oracle.candidates[sug].samples.map((v, k) => v - oracle.candidates[chosen].samples[k]);
const m = mean(paired), se = sd(paired) / Math.sqrt(paired.length);
const verdict = m > 2 * se ? "CONFIRMED" : m < -2 * se ? "CONTRADICTED" : "unresolved";
```

**Report `unresolved` as its own class, never folded into either side.** In the
smoke run 4 of 6 surfaced items were unresolved, and two of those had oracle
Δ = 0.0 ± 0.0 exactly — the arms were outcome-identical across all rollouts, i.e.
production flagged a decision where the moves provably do not matter. That is a
distinct and interesting failure mode; give it its own bucket
(`outcome-equivalent`).

### 5.3 The ablation ladder

Production differs from the oracle on four axes. Walking them one at a time
attributes the error instead of merely measuring it — this is what turns the
study into a work queue.

| rung | information | horizon | budget | pilot |
|---|---|---|---|---|
| oracle | perfect | play to end | 480 | heuristic |
| + evaluator | perfect | 6 + `value-gbm-v1` | 480 | heuristic |
| + determinized | ghost + meta prior | 6 | 480 | heuristic |
| + budget | ghost | 6 | 16 | heuristic |
| production | ghost | 6 | 16 | heuristic |

The pilot axis is deliberately *not* varied here; see §7.1.

To build the "+ determinized" rung, redact a true state exactly as the coach sees
a log position:

```ts
const view = viewFor(state, actor, ctx);
const ghost = buildGhostState(view);
analyzeDecision(ghost, "player", { ...ctx }, null, {
  /* ... */
  prepare: (clone, r) => determinizeOpponent(clone, view, determinizeRng(decisionSeed, r)),
});
```

### 5.4 Stratification

Report every metric sliced by: `playedKind`, suggested move kind, turn phase
(early/mid/late), `legalCount` bucket, `stakes` bucket, severity, and ε band.
A class whose precision is at chance is a class to stop surfacing — that is the
per-class trust prior.

### 5.5 The per-item gate

Do **not** perturb at request time. Fit a model offline predicting
oracle-confirmation from features already present on `CoachedDecision`:
`regret / regretSe`, `stakes`, `legalCount`, `capture`, `playedKind`, `severity`.
Production then pays nothing — it already has all of these.

Report held-out AUC **split by game, not by decision**. Every decision in a game
shares a position lineage; a decision-level split leaks and will overstate.

## 6. Outputs

1. `--json out.json` with per-class precision/recall/n and the fitted gate
   coefficients.
2. A stdout report in house grammar (§8).

Do not write `data/ml/` and do not write `ml_runs` — nothing in this repo writes
that table, and the artifact contract for production consumption is deliberately
a separate, later decision.

## 7. Traps that will bite

### 7.1 `analyzeDecision` reuses ONE policy instance across every arm and rollout

Fine for `HeuristicPolicy` and `RankerPolicy`, which are stateless per decision.
**Silently wrong** for `PlannerPolicy`, `RoutePlannerPolicy` and `SearchPolicy`,
which carry per-turn state (`queue`, `plannedTurn`) — arm 2 inherits arm 1's stale
plan, the arms stop being exchangeable, and no error bar will show it.
`lib/engine/sim/rollout.ts` makes `policies` a *factory* for exactly this reason.

Varying the pilot therefore needs a hand-rolled loop with a fresh instance per
rollout, using exported API only (`rollOut` in `regret.ts` is module-private):

```ts
const clone = structuredClone(d.state);
determinizeOpponent(clone, view, determinizeRng(decisionSeed, r));   // log positions: determinizeLogSide
const { outcome } = resumeGame(clone, "player",
  { player: makePilot(), opponent: makePilot() },        // fresh EVERY rollout
  mulberry32(hashSeed(`${decisionSeed}|${r}`)),          // same CRN convention as regret.ts
  { ctx: { ...d.ctx }, firstMove: forcedMove, maxPlies: HORIZON ?? undefined });
const v = outcome ? outcomeValue(outcome, "player") : stateValue(clone, "player", evaluate);
```

### 7.2 Omitting `ctx` on `resumeGame` hands the actor a free card

`runTurn` skips `beginTurn` only when a resume context is supplied. Without it the
actor draws and the once-per-turn flags reset.

### 7.3 `prepare` must be a pure function of the rollout index

If determinization varies per *arm* rather than per *rollout*, common random
numbers break and every paired error bar becomes a lie. `RegretOptions.prepare`
documents this; respect it.

### 7.4 Move identity does not survive determinization

Determinized cards get synthetic ids (`det-…`), so `moveKey` will not match across
the true/ghost boundary. Use `semanticMoveKey`, as `SearchPolicy` does. Expect
misses: in the smoke run **33 of 40** human moves were representable in the ghost,
and the ghost's legal set averaged **1.8 moves smaller** than the true one
(sd 3.9). Report that as fidelity, separately from any quality rate — folding them
together lets missing card support masquerade as bad judgement.

## 8. House conventions (from `scripts/ml/`)

- Long header: the question, and what the script does **not** measure.
- `numArg()` that `process.exit(1)`s on an unreadable flag. A silent default is
  how a four-config sweep of `regret_calibration.ts` returned four byte-identical
  results.
- `seedOrLabel(arg("--seed"), 1, hashSeed)`; seed every unit of work from a
  namespaced string, e.g. `hashSeed(\`coach-trust:${SEED}:${i}\`)`.
- Refuse to run degraded: `createBoardEvaluator()` returning null is a hard exit,
  never a fallback. "A silent fallback here would compare two different stacks."
- Verdict grammar, **with an explicit wrong-direction branch**:
  `SEPARABLE at 95%` / `NOT SEPARABLE` / `SEPARABLE IN THE WRONG DIRECTION — do
  not ship`.
- **Exit 0 regardless of verdict.** A negative result is a result.
- Multi-seed by default. Every single-seed reading this project has taken has been
  wrong; `strategist_duel.ts` has the list.

## 9. Known limits — surface these in the output, do not hide them

- **Self-play positions are not log positions.** Oracle precision is an *upper
  bound* on real-log performance. Reconstructed logs additionally carry ~53%
  coverage loss and a weaker deck reconstruction.
- **`determinize` is biased in a specific, nameable way.** It draws with
  replacement, excludes any already-revealed card name *entirely* (so never a
  second copy of a card on board or in the discard), and enforces no 4-copy or
  60-card legality. The "+ determinized" rung prices exactly this.
- **The oracle's pilot caps what it can see.** `HeuristicPolicy` continuations
  mean a setup play whose payoff needs strong follow-up is undervalued by the
  oracle too — in the same direction as production, which makes agreement
  *optimistic*.
- **Expect to reproduce a known negative:** the search agrees with human players
  less than the incumbent planner (23.6% vs 30.6%, McNemar z = −4.75). Report
  agreement and value-capture as separate columns, the way `coach_report.ts`
  separates raw `regret` (z = −0.20, wrong direction) from `capture` (z = +4.67).
- **`matches.result` is contaminated** and must not be used as a label without
  controls. Live DB: 386 gradeable logs, one handle contributes 165 at a 57.6%
  win rate while every other handle combined is 221 at **78.7%**, and 19 of 41
  handles are singletons that are almost all wins. Casual users appear to log
  wins and drop losses. Any outcome-linked analysis needs player fixed effects or
  a single-player restriction — and the existing z = +4.67 result was measured on
  this same pool, so it is confounded and should be re-derived within-player.

## 10. Acceptance criteria

1. The oracle runs with `horizon: null, evaluate: null` and completes. (A finite
   horizon with no evaluator throws by design — that is the guard working.)
2. Positive control passes: declining an available attack prices as a large,
   significant loss under the oracle. Smoke run: n=3, mean 13.9 pts — PASS, but
   underpowered; the real run should have n in the hundreds.
3. Null control passes: on decisions whose arms are outcome-equivalent, the
   oracle reports ~zero regret with a bar that covers zero.
4. Fidelity (ghost legal-set divergence, unmappable moves) is reported as its own
   number and never folded into precision.
5. `unresolved` and `outcome-equivalent` are reported as their own buckets.
6. Held-out AUC for the per-item gate is split by game.
7. Re-running with the same seed reproduces the output exactly.
8. `npx tsc --noEmit` clean; `npm test` green.

## 11. What this does not answer, and what humans are for

This study measures whether a recommendation is **correct**. It says nothing about
whether it is **teachable**, **comprehensible**, or **worth a player's attention**.

Point human raters — ideally strong players — at the questions automation cannot
reach: is the advice intelligible, does it name a concept a player can carry to
the next game, and is it *alien*? That last one matters because the search
disagrees with human players more than the planner does, and it is unresolved
whether that is the search being right and the humans wrong, or PIMC pathology.
An oracle cannot tell those apart. A strong player can.

There is currently **no feedback surface anywhere in the product** — no ratings,
no thumbs, no dismissals, and no `coach.*` analytics events. Capturing human
judgements is net-new work. `analytics_events` could carry it with no migration,
but a study wants a typed table keyed to `(match_id, decision_index)`.
