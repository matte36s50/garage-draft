-- =====================================================
-- Migration: each event carries its own scoring rule
-- Run in the GAME Supabase project, SQL Editor. Safe to re-run.
-- (Applied to the live database on 2026-11-16.)
-- =====================================================
--
-- WHY: every event so far was scored on the garage's total VALUE. What a player
-- paid didn't count, so unspent budget was worth nothing and the surest way up
-- the table was to spend more. At the two Amelia Island events real players
-- left 22% and 45% of their budget unspent, which shows they read the score as
-- profit, and at one of them the winner was simply the biggest spender.
--
-- New events are scored on PROFIT: what the garage is worth, plus any bonus
-- prize, minus what was paid for it. Unspent budget neither helps nor hurts.
--
-- The rule is stored per event so that finished events keep the rule, and the
-- results, they were played under:
--   value   garage value + bonus prize                (every event before this)
--   profit  garage value + bonus prize - what was paid
--
-- The rule itself lives in src/utils/eventScore.js (player app) and
-- auction-admin/lib/eventScore.js (hourly score cron). complete_league and
-- calculate_league_ranks order by league_members.total_score, which the cron
-- writes under the event's rule, so they need no change.

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS scoring TEXT NOT NULL DEFAULT 'value';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leagues_scoring_check') THEN
        ALTER TABLE leagues ADD CONSTRAINT leagues_scoring_check CHECK (scoring IN ('value', 'profit'));
    END IF;
END $$;

COMMENT ON COLUMN leagues.scoring IS
    'How the event is scored: value = garage value + bonus prize (events before Nov 2026); '
    'profit = garage value + bonus prize - what was paid.';

-- The column default stays 'value' so that a row written by anything that
-- doesn't know about the column keeps the old behaviour. The admin form sets
-- 'profit' for new events.

-- Check:
--   SELECT name, scoring FROM leagues ORDER BY created_at DESC;
