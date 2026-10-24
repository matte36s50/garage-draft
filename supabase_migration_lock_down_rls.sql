-- =====================================================
-- Migration: lock down the game database before public launch
-- Run in the GAME Supabase project (NEXT_PUBLIC_SUPABASE_URL), SQL Editor.
-- =====================================================
--
-- WHY: the player app ships the anon key in its JavaScript, so anything the
-- anon key may do, any visitor may do. Before this migration, as written in
-- this repo's migrations:
--   - anyone could add or remove cars in any league (league_auctions),
--   - anyone could post chat messages as any member, or as "system"
--     (send_chat_message trusted a client-supplied user id; an open INSERT
--     policy on league_messages; post_system_message callable by anyone),
--   - anyone could read and rewrite auction_notifications,
--   - get_username() handed out a user's email to anyone who called it, and
--     the leaderboard read every member's email,
--   - cron-only functions (complete_league, calculate_league_ranks, ...) were
--     callable by anyone, because Postgres grants EXECUTE to PUBLIC by
--     default and GRANT ... TO service_role doesn't take that away,
--   - the admin portal wrote from the browser with the anon key, so the core
--     tables (auctions, leagues, garages, garage_cars, users, ...) had to
--     accept anon writes, letting a player set a final price, a budget or a
--     draft price directly,
--   - every player's bonus-car prediction was readable while predictions
--     were still open, so a player could copy the leader and shade it.
--
-- AFTER: each table allows exactly what the player app does (mapped from
-- src/App.js, src/components, src/hooks), drafting stays in the draft_car /
-- undraft_car RPCs, chat goes only through send_chat_message, and everything
-- else is the service role's (crons, scrapers, the admin portal's
-- /api/admin/db relay).
--
-- ---------------------------------------------------------------------
-- BEFORE RUNNING — in this order:
--   1. Every server-side writer must use the SERVICE-ROLE key, or its writes
--      will start failing:
--        - Vercel (auction-admin): SUPABASE_SERVICE_ROLE_KEY. The routes no
--          longer fall back to the anon key; /api/cron/test-connection shows
--          whether it is set.
--        - lambda/bat_scraper_finalize.py: SUPABASE_KEY.
--        - Whatever fills the auctions table with live BaT listings (it writes
--          to Supabase directly, outside this repo): its key.
--   2. Deploy the admin portal with /api/admin/db, and the player app whose
--      leaderboard no longer reads users.email. An older player-app bundle
--      still open in a tab gets a leaderboard error until it reloads.
--   3. Run this file. It is one transaction: if any statement fails, nothing
--      changes. It is safe to re-run.
--   4. Run the checks at the bottom, or `node auction-admin/scripts/check-db-access.mjs`.
-- ---------------------------------------------------------------------

BEGIN;

-- =====================================================
-- 1. Start each game table from a clean slate
--    Drops every existing policy on these tables, whatever it is called
--    (some were made in the dashboard, not in this repo), and turns RLS on.
-- =====================================================
DO $$
DECLARE
    r RECORD;
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'auctions', 'leagues', 'league_auctions', 'league_members', 'garages',
        'garage_cars', 'bonus_predictions', 'users', 'league_messages',
        'auction_notifications'
    ] LOOP
        FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END LOOP;
END $$;

-- =====================================================
-- 2. Public game data: readable by everyone, written only by the service role
-- =====================================================
GRANT SELECT ON auctions, leagues, league_auctions, garage_cars TO anon, authenticated;

CREATE POLICY "Anyone can read auctions" ON auctions
    FOR SELECT TO anon, authenticated USING (true);

-- Private leagues are reached by their id (an invite link), so reads aren't
-- filtered on is_public; the app's league list filters on it.
CREATE POLICY "Anyone can read leagues" ON leagues
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Anyone can read league auctions" ON league_auctions
    FOR SELECT TO anon, authenticated USING (true);

-- Garages and their cars are public within the game (leaderboard, draft
-- results). Drafting writes them only through draft_car / undraft_car,
-- which are SECURITY DEFINER and enforce the budget, cap and window.
CREATE POLICY "Anyone can read drafted cars" ON garage_cars
    FOR SELECT TO anon, authenticated USING (true);

-- =====================================================
-- 3. Joining a league: a player creates their own garage and membership
-- =====================================================
GRANT SELECT ON garages, league_members TO anon, authenticated;
GRANT INSERT (user_id, league_id, remaining_budget) ON garages TO authenticated;
GRANT INSERT (league_id, user_id, total_score) ON league_members TO authenticated;

CREATE POLICY "Anyone can read garages" ON garages
    FOR SELECT TO anon, authenticated USING (true);

-- Your own garage, in a league whose draft hasn't closed, with no more than
-- the league's budget.
CREATE POLICY "Players open their own garage" ON garages
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM leagues l
            WHERE l.id = garages.league_id
              AND garages.remaining_budget <= l.spending_limit
              AND (l.draft_ends_at IS NULL OR now() <= l.draft_ends_at)
        )
    );

CREATE POLICY "Anyone can read league members" ON league_members
    FOR SELECT TO anon, authenticated USING (true);

-- Your own membership, starting at zero, in a league whose draft hasn't
-- closed. Scores and ranks are written by the hourly cron.
CREATE POLICY "Players join leagues as themselves" ON league_members
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND COALESCE(total_score, 0) = 0
        AND EXISTS (
            SELECT 1 FROM leagues l
            WHERE l.id = league_members.league_id
              AND (l.draft_ends_at IS NULL OR now() <= l.draft_ends_at)
        )
    );

-- =====================================================
-- 4. Bonus-car predictions
--    Yours are always visible to you. Everyone else's become visible once
--    the bonus auction has ended or has a result, which is when the
--    leaderboard needs them (utils/bonusCar.js pays nothing before a result).
--    You can make or change yours, as a member, until the auction ends.
-- =====================================================
GRANT SELECT ON bonus_predictions TO authenticated;
GRANT INSERT (league_id, user_id, predicted_price) ON bonus_predictions TO authenticated;
-- An upsert's ON CONFLICT DO UPDATE sets every column it was given.
GRANT UPDATE (league_id, user_id, predicted_price) ON bonus_predictions TO authenticated;

CREATE POLICY "Predictions are private until the bonus auction ends" ON bonus_predictions
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (
            SELECT 1 FROM leagues l
            JOIN auctions a ON a.auction_id = l.bonus_auction_id
            WHERE l.id = bonus_predictions.league_id
              AND (
                  a.timestamp_end <= EXTRACT(EPOCH FROM now())
                  OR a.final_price IS NOT NULL
                  OR a.reserve_not_met
              )
        )
    );

CREATE POLICY "Members predict while the bonus auction is open" ON bonus_predictions
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM league_members m
            WHERE m.league_id = bonus_predictions.league_id
              AND m.user_id = (SELECT auth.uid())
        )
        AND EXISTS (
            SELECT 1 FROM leagues l
            JOIN auctions a ON a.auction_id = l.bonus_auction_id
            WHERE l.id = bonus_predictions.league_id
              AND a.final_price IS NULL
              AND NOT a.reserve_not_met
              AND COALESCE(a.timestamp_end > EXTRACT(EPOCH FROM now()), true)
        )
    );

CREATE POLICY "Members change their prediction while the bonus auction is open" ON bonus_predictions
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM leagues l
            JOIN auctions a ON a.auction_id = l.bonus_auction_id
            WHERE l.id = bonus_predictions.league_id
              AND a.final_price IS NULL
              AND NOT a.reserve_not_met
              AND COALESCE(a.timestamp_end > EXTRACT(EPOCH FROM now()), true)
        )
    );

-- =====================================================
-- 5. Users: usernames are public, emails are not
--    Column privileges hide email even though rows are readable. The admin
--    portal reads emails through the service role.
-- =====================================================
GRANT SELECT (id, username) ON users TO anon, authenticated;

CREATE POLICY "Anyone can read usernames" ON users
    FOR SELECT TO anon, authenticated USING (true);

-- New sign-ups get their users row from a trigger on auth.users. If that
-- trigger function isn't SECURITY DEFINER it runs as supabase_auth_admin,
-- which RLS would otherwise stop. Harmless if the trigger is SECURITY DEFINER.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        EXECUTE 'CREATE POLICY "Auth creates users rows" ON users FOR INSERT TO supabase_auth_admin WITH CHECK (true)';
    END IF;
END $$;

-- =====================================================
-- 6. Chat: members read their league's messages; sending goes only
--    through send_chat_message (rate limit, length cap, sender = signed-in user)
-- =====================================================
GRANT SELECT ON league_messages TO authenticated;

CREATE POLICY "Members read their league's messages" ON league_messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM league_members m
            WHERE m.league_id = league_messages.league_id
              AND m.user_id = (SELECT auth.uid())
        )
    );

-- auction_notifications: no policies, no grants. Only the SECURITY DEFINER
-- chat triggers and the service role touch it.

-- A display name that never falls back to the email address. It used to,
-- and its result is posted into chat ("<name> drafted ...").
CREATE OR REPLACE FUNCTION get_username(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_username TEXT;
BEGIN
    SELECT COALESCE(
        NULLIF(btrim(raw_user_meta_data->>'username'), ''),
        NULLIF(btrim(raw_user_meta_data->>'name'), '')
    ) INTO v_username
    FROM auth.users
    WHERE id = p_user_id;

    RETURN COALESCE(v_username, 'Player');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The sender is whoever is signed in. p_user_id is ignored; it stays in the
-- signature so clients that still pass it keep working.
CREATE OR REPLACE FUNCTION send_chat_message(
    p_league_id UUID,
    p_user_id UUID,
    p_content TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_content TEXT := btrim(COALESCE(p_content, ''));
    v_last_message TIMESTAMP WITH TIME ZONE;
    v_message_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    IF v_content = '' OR char_length(v_content) > 1000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Messages must be 1 to 1,000 characters');
    END IF;

    SELECT last_message_at INTO v_last_message
    FROM league_members
    WHERE league_id = p_league_id AND user_id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a member of this league');
    END IF;

    IF v_last_message IS NOT NULL AND (now() - v_last_message) < INTERVAL '3 seconds' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please wait before sending another message');
    END IF;

    INSERT INTO league_messages (league_id, user_id, message_type, content, metadata)
    VALUES (p_league_id, v_uid, 'user', v_content, jsonb_build_object('username', get_username(v_uid)))
    RETURNING id INTO v_message_id;

    UPDATE league_members
    SET last_message_at = now()
    WHERE league_id = p_league_id AND user_id = v_uid;

    RETURN jsonb_build_object('success', true, 'message_id', v_message_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Messages already posted under an email address: show the display name instead.
UPDATE league_messages m
SET content  = replace(m.content, m.metadata->>'username', x.display_name),
    metadata = jsonb_set(m.metadata, '{username}', to_jsonb(x.display_name))
FROM (
    SELECT id, get_username(COALESCE(
        user_id,
        CASE WHEN metadata->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (metadata->>'user_id')::uuid END
    )) AS display_name
    FROM league_messages
    WHERE metadata->>'username' LIKE '%@%'
) x
WHERE m.id = x.id;

-- =====================================================
-- 7. Functions: only the player RPCs are callable from the app
--    Everything else here runs from triggers, the crons (service role) or
--    other SECURITY DEFINER functions, none of which need anon/authenticated
--    to hold EXECUTE. Matched by name so every overload is covered.
-- =====================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS fn, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (ARRAY[
              -- cron / service role
              'complete_league', 'check_and_complete_leagues', 'calculate_league_ranks',
              'notify_auctions_ending_soon', 'bump_finalize_attempts', 'log_league_activity',
              -- called only from other functions
              'get_username', 'post_system_message', 'can_send_notification', 'format_price',
              -- trigger functions
              'notify_car_drafted', 'notify_price_movement', 'notify_auction_ended',
              'notify_reserve_not_met', 'reset_finalize_attempts',
              -- player RPCs: revoked here, granted back to signed-in players below
              'draft_car', 'undraft_car', 'send_chat_message'
          ])
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
        IF r.proname IN ('draft_car', 'undraft_car', 'send_chat_message') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.fn);
        END IF;
    END LOOP;
END $$;

-- =====================================================
-- 8. The cron's tables: keep their policies, drop the client write grants
--    league_results, performance_history, league_activities and
--    user_achievements already let only the service role write (their
--    policies check auth.role()). Removing the table grants means a policy
--    added carelessly later still can't open them. Skipped where a table
--    doesn't exist.
-- =====================================================
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['league_results', 'performance_history', 'league_activities', 'user_achievements'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t);
        END IF;
    END LOOP;
END $$;

COMMIT;

-- =====================================================
-- CHECKS — run after the migration; each should return what it says.
-- =====================================================
--
-- No game table without RLS (expect no rows):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--
-- Anon may write nothing (expect no rows):
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--   WHERE grantee = 'anon' AND table_schema = 'public' AND privilege_type <> 'SELECT';
--
-- Signed-in players may write only these (expect bonus_predictions INSERT and
-- UPDATE, garages INSERT, league_members INSERT, plus any table this
-- migration doesn't know about):
--   SELECT DISTINCT table_name, privilege_type FROM information_schema.column_privileges
--   WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type <> 'SELECT'
--   ORDER BY 1, 2;
--
-- Email is hidden (expect false, true):
--   SELECT has_column_privilege('anon', 'public.users', 'email', 'SELECT'),
--          has_column_privilege('anon', 'public.users', 'username', 'SELECT');
--
-- Functions anon can call (expect none of the game's; review anything listed):
--   SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
--
-- Every policy now in force:
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' ORDER BY 1, 2;
