/** The Trainer Spotlight interview question bank.
 *
 *  Verbatim from the Trainer Spotlight prep PDF sent to participants. The
 *  onboarding form asks them to pick MIN_ANSWERS–MAX_ANSWERS of these and
 *  answer inline; answers are stored as SpotlightQA pairs, the same shape the
 *  published `qa` column uses, so the admin's copy-across is a straight
 *  assignment.
 *
 *  `id` is stable and independent of the wording — rewording a question does
 *  not orphan answers already submitted against it. Never reuse an id for a
 *  different question. */
export interface SpotlightQuestion {
  id: string;
  q: string;
}

export const SPOTLIGHT_QUESTIONS: SpotlightQuestion[] = [
  { id: "archetype", q: "What's your go-to archetype in the current format?" },
  { id: "testing", q: "What's your approach to testing deck lists for a new archetype?" },
  { id: "cut-card", q: "What's a card everyone plays that you've cut, and what do you run instead?" },
  { id: "bad-advice", q: "What's a piece of “standard” competitive advice you think is actually wrong?" },
  { id: "between-rounds", q: "What's the most interesting thing someone has said to you between rounds?" },
  { id: "tired-of-losing", q: "What's one card you're tired of losing to?" },
  { id: "hot-take", q: "What's your hottest take in the current format?" },
  { id: "insights", q: "Where do you get your TCG insights? Streamers, platforms, players, etc." },
  { id: "deck-ready", q: "How do you know when your deck is ready to take to locals?" },
  { id: "pet-peeve", q: "What's your pet peeve at the play table?" },
  { id: "remove-card", q: "If you could remove one card from the current format, what would it be?" },
  { id: "first-locals", q: "What would you say to someone going to play at their first local tournament?" },
  { id: "aspiration", q: "What's your biggest goal/dream/aspiration with Pokémon TCG?" },
  { id: "match-moment", q: "What's your most memorable match moment?" },
  { id: "rule-change", q: "If you could add or update a rule in the game, what would you do?" },
];

/** The PDF asks for "5-8 of the following questions". */
export const MIN_ANSWERS = 5;
export const MAX_ANSWERS = 8;

/** Max cards per favorite-card slot, matching the published columns'
 *  3-card cap (and the PDF's "3 of each"). */
export const MAX_FAVORITE_CARDS = 3;

/** Max featured decks, matching the trainer_spotlights CHECK constraint. */
export const MAX_FEATURED_DECKS = 3;
