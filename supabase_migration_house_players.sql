-- =====================================================
-- Migration: mark seeded players as house players
-- Run in the GAME Supabase project, SQL Editor. Safe to re-run.
-- (Applied to the live database on 2026-11-17.)
-- =====================================================
--
-- WHY: the admin "Seed Fake Players" tool fills tables with players that have
-- realistic usernames and nothing marking them as bots. 57 of them held 74%
-- of all picks. Players can't tell them from people, and a partner asking
-- how many people played needs a count of people.
--
-- users.is_house marks them. The app shows a HOUSE tag beside the name, the
-- seeding tool sets it on every player it creates, and research queries
-- should leave them out (WHERE NOT u.is_house).
--
-- Only accounts with a @fake.bidprix.com address and no sign-in are marked.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_house BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_house IS
    'A player the admin seeded to fill a table, not a person. Shown with a HOUSE tag and left out of player counts and research.';

UPDATE users SET is_house = true
 WHERE email ILIKE '%@fake.bidprix.com'
   AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = users.id);

-- The lock-down migration grants column-level SELECT on users (id, username);
-- players need this one too, to show the tag.
GRANT SELECT (is_house) ON users TO anon, authenticated;

-- Check:
--   SELECT is_house, count(*) FROM users GROUP BY 1;   -- 57 true at the time of writing
