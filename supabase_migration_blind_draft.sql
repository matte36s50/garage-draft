-- =====================================================
-- Migration: rivals' picks stay hidden until the draft closes
-- Run in the GAME Supabase project, SQL Editor, after
-- supabase_migration_lock_down_rls.sql. Safe to re-run.
-- (Applied to the live database on 2026-11-17.)
-- =====================================================
--
-- WHY: the game tells players that rivals' picks are hidden until the draft
-- closes, and supabase_migration_quiet_draft_feed.sql stopped the event feed
-- announcing them. But the "Anyone can read drafted cars" policy still let
-- anyone read every garage's cars straight from garage_cars, and the Ranks
-- screen did exactly that. Picks made without seeing anyone else's are what
-- make the game fair and the pick data worth studying.
--
-- After this:
--   - a player can always read their own drafted cars;
--   - everyone else's become readable once that event's draft has closed
--     (draft_ends_at, stored without a zone, meaning UTC);
--   - while a draft is open, league_roster_counts() tells the Ranks screen how
--     many cars each player has picked, and nothing else.
--
-- The service role (score cron, admin portal) bypasses row security and is
-- unaffected. draft_car / undraft_car are SECURITY DEFINER and unaffected.
--
-- Still visible during a draft: garages.remaining_budget, so a player's total
-- spend can be worked out, though not what they bought.

DROP POLICY IF EXISTS "Anyone can read drafted cars" ON garage_cars;
DROP POLICY IF EXISTS "Drafted cars are visible once the draft closes" ON garage_cars;

CREATE POLICY "Drafted cars are visible once the draft closes" ON garage_cars
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM garages g
            JOIN leagues l ON l.id = g.league_id
            WHERE g.id = garage_cars.garage_id
              AND (
                  g.user_id = (SELECT auth.uid())
                  OR l.draft_ends_at IS NULL
                  OR l.draft_ends_at <= (now() AT TIME ZONE 'utc')
              )
        )
    );

-- How many cars each member of an event has drafted, without saying which.
CREATE OR REPLACE FUNCTION league_roster_counts(p_league_id UUID)
RETURNS TABLE (user_id UUID, car_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT g.user_id, count(gc.id)::INTEGER
    FROM garages g
    LEFT JOIN garage_cars gc ON gc.garage_id = g.id
    WHERE g.league_id = p_league_id
    GROUP BY g.user_id;
$$;

REVOKE ALL ON FUNCTION league_roster_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION league_roster_counts(UUID) TO authenticated, service_role;

-- Check, as a signed-in player of an event whose draft is open:
--   SELECT count(*) FROM garage_cars gc JOIN garages g ON g.id = gc.garage_id
--   WHERE g.league_id = '<open event>' AND g.user_id <> auth.uid();   -- expect 0
--   SELECT * FROM league_roster_counts('<open event>');               -- counts only
