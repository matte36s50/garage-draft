-- =====================================================
-- Cleanup: shrink performance_history to one snapshot per player per day
-- Run in the GAME Supabase project, SQL Editor. Two separate runs (below).
-- =====================================================
--
-- WHY: the hourly score cron wrote a performance_history row for every
-- player in every event every hour. By 2026-10-24 that was 353,692 rows and
-- 283 MB of a 478 MB database, against the free plan's 500 MB limit, and
-- nothing in either app reads them (the old Dashboard chart that did is
-- gone). The cron now writes one snapshot a day (update-performance route).
--
-- This keeps each player's last snapshot of each UTC day, about 15,000 rows
-- (~12 MB), so a day-by-day standings history survives, and deletes the
-- rest. Safe to re-run; a second run deletes nothing.

-- ---------------------------------------------------------------------
-- RUN 1: delete the extra hourly rows (one transaction; about a minute)
-- ---------------------------------------------------------------------
DELETE FROM performance_history ph
USING (
    SELECT id,
           row_number() OVER (
               PARTITION BY league_id, user_id, ("timestamp" AT TIME ZONE 'UTC')::date
               ORDER BY "timestamp" DESC
           ) AS rn
    FROM performance_history
) ranked
WHERE ph.id = ranked.id AND ranked.rn > 1;

-- ---------------------------------------------------------------------
-- RUN 2, on its own: give the space back.
-- A DELETE only marks rows free for reuse; the database's size, which is
-- what the plan limit counts, drops only after this rewrites the table. It
-- briefly locks performance_history, which only the cron touches. It can't
-- run in the same query as anything else.
-- ---------------------------------------------------------------------
-- VACUUM FULL performance_history;

-- Check afterwards:
--   SELECT pg_size_pretty(pg_database_size(current_database())) AS database,
--          pg_size_pretty(pg_total_relation_size('performance_history')) AS performance_history,
--          (SELECT count(*) FROM performance_history) AS rows;
