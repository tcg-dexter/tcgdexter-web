-- Remove the deck-creation-based trainer ranking system.
-- The trainer tier/title was derived from a user's saved-deck high-water-mark,
-- which carried little intrinsic value and was easy to game. The knowledge-based
-- "Certified Trainer" achievement (user_achievements) is unaffected.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS trainer_title,
  DROP COLUMN IF EXISTS highest_deck_count;
