-- Drop display-name uniqueness.
--
-- Display name is presentation-only; the immutable, unique handle is
-- `username` (kept unique via profiles_username_unique_idx). Enforcing a
-- second uniqueness constraint on display_name is unnecessarily rigid — it
-- blocks two users from picking the same friendly name even though the
-- username already disambiguates them. Dropping it makes display names more
-- flexible (closer to how X/Twitter treats @handle vs. name).
--
-- The matching friendly-check in PATCH /api/profile is removed in the same
-- change; the 23505 path there now only fires for username collisions.

drop index if exists public.profiles_display_name_lower_unique;
