# Trainer School — lesson content

Lesson bodies for `/learn`. This is a route group (`(content)`), so nothing in
here is routable — `app/learn/[slug]/page.tsx` reads the `.mdx` off disk by
slug and compiles it with `next-mdx-remote/rsc`.

**Tone:** warm, direct, second person. Theme lives in the frame (module names,
badge, CTAs); lesson bodies stay plain.

**Audience:** true beginners. Assume the reader has never played.

**Scope:** rules only. Ten lessons that get someone from "never played" to
"can sit down and play a legal game", then the Trainer Quiz. Deckbuilding and
competitive play are deliberately out of scope.

## Source of truth

`lib/learn/curriculum.ts` owns order, module grouping, titles and estimated
minutes. **Frontmatter here is parsed and discarded by the renderer** — it
carries only `slug` and `title`, as an aid when opening a file directly. Don't
add `module`/`order`/`estimatedMinutes` back; they drifted out of sync last
time and silently did nothing.

`lib/learn/curriculum.test.ts` enforces the invariants: lesson ↔ `.mdx`
parity, unique contiguous orders, frontmatter matching `curriculum.ts`, every
quiz `sourceLesson` resolving, and every `<Card>`/`<CardAnatomy>` id resolving
against the card index.

## Lessons

| # | Slug | Module |
|---|---|---|
| 1 | `what-is-pokemon-tcg` | Know Your Cards |
| 2 | `anatomy-pokemon-card` | Know Your Cards |
| 3 | `anatomy-trainer-card` | Know Your Cards |
| 4 | `anatomy-energy-card` | Know Your Cards |
| 5 | `deck-legality` | Know Your Cards |
| 6 | `game-setup` | Play a Game |
| 7 | `how-a-turn-works` | Play a Game |
| 8 | `attacking-and-damage` | Play a Game |
| 9 | `special-conditions` | Play a Game |
| 10 | `win-conditions` | Play a Game |

Then `/learn/quiz`. The three lessons after it — `reading-a-deck-list`,
`profile-your-first-deck`, `save-to-library` — are an unlisted product tour
reached from the post-quiz CTA. They're routable but don't appear on `/learn`
and aren't covered by the quiz.

## Components available in MDX

Registered in the `mdxComponents` map in `app/learn/[slug]/page.tsx`, so they
need no import inside a lesson. Source in `app/learn/components/`.

| Component | Use |
|---|---|
| `<Card id="me1-114" size? caption? />` | A real card, resolved through the card index. **Never inline an image URL** — per-set CDN routing lives in `lib/cardImages.ts`. |
| `<CardAnatomy id parts={[{label,text,x,y}]} />` | Annotated card; `x`/`y` are percentages of the card face. |
| `<Board stage?="midgame\|setup" />` | The play area, rendered with the real `PlayerMat` from the replay viewer (`app/admin-tools/replay/BoardKit.tsx`) — face-up cards show their *name as text* instead of art (`face="label"`). `stage` picks the moment: `midgame` (default) or `setup`. |
| `<Check question options={[]} answer={n} explain />` | Inline ungraded retrieval question. Local state only — nothing to do with certification. |
| `<Callout kind="rule\|gotcha\|tryit">` | Rule statements, common mistakes, do-it-now prompts. |

## Rules accuracy

Cross-check anything mechanical against `lib/engine/sim/` — it's a working
simulator with its own tests. `conditions.ts` in particular is a precise spec
of the five Special Conditions and the Pokémon Checkup.

Treat the engine as authoritative and check it *before* the lesson, not after.
An earlier draft of this file claimed the engine had the first-turn rules wrong;
it doesn't, and the lesson did. The three gates, all correct:

| Rule | Enforced at |
|---|---|
| Player going first can't **attack** | `moves.ts:493` — `state.turn.number > 1` |
| Player going first can't play a **Supporter** | `moves.ts:309`, `validate.ts:290` — `state.turn.number === 1` |
| Neither player may **evolve** on their own first turn | `moves.ts:307` — `playerTurnNumber > 1` |

Note that `validate.ts` carries no turn check for attacks — it validates against
the move list `moves.ts` generates, so the gate only has to exist once. Grepping
`validate.ts` alone will make a correctly-enforced rule look missing.

Card references must be Standard-legal. `data/cards-standard.json` spans every
era, so filter on the regulation mark — `isStandardMark()` in
`lib/cardPrinting.ts` is the authority. Note that **no Standard-legal Pokémon
prints a Resistance**, which is why lesson 8 teaches the slot as empty rather
than as live math.
