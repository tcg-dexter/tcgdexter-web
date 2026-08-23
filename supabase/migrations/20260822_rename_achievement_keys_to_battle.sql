-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- Renames the four achievement_key values that referenced "match" vernacular
-- to their "battle" equivalents, in lockstep with the code-wide rename of
-- lib/learn/achievements.ts's AchievementKey literals. user_achievements has
-- only a composite PK (user_id, achievement_key) and an FK to auth.users —
-- no CHECK constraint on the value — so a plain UPDATE is safe.
update user_achievements
set achievement_key = case achievement_key
  when 'first_match' then 'first_battle'
  when 'matches_10' then 'battles_10'
  when 'matches_50' then 'battles_50'
  when 'matches_100' then 'battles_100'
  else achievement_key
end
where achievement_key in ('first_match', 'matches_10', 'matches_50', 'matches_100');
