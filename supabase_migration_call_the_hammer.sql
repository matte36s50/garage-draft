-- =====================================================
-- Migration: Call the hammer, a daily price-calling game
-- Run in the GAME Supabase project, SQL Editor, after
-- supabase_migration_lock_down_rls.sql and supabase_migration_events.sql.
-- Safe to re-run.
-- =====================================================
--
-- Each day (New York calendar date) has a round of five lots. Players call
-- each lot's hammer price before it closes; once the result is in, a call
-- earns up to 100 points:
--
--     points = max(0, round(100 - 200 x |call - result| / result))
--
-- so a perfect call scores 100, 10% off scores 80, 25% off 50, 50% off 0.
-- The same rule is in src/utils/hammer.js.
--
-- What a lot is scored against:
--   sold                      the hammer price (auctions.final_price)
--   online lot, no sale       its high bid
--   catalogue lot, no sale    nothing: the round counts it void, because a
--                             catalogue lot's high bid isn't published
--   withdrawn (final_price=0) void
--
-- Rounds: hammer_round(day) returns a day's lots. When no round exists for
-- today or tomorrow it picks five Bring a Trailer lots closing that day, one
-- from each fifth of the price range, so the round runs from cheap to dear.
-- An admin can set a round by hand instead (insert into hammer_rounds and
-- hammer_lots), as for the Rétromobile New York round below.
--
-- Fairness: a player sees other players' calls only once the lot has closed,
-- and can change a call until then. Calls go through make_hammer_call(),
-- which checks the lot is in a round and still open.

BEGIN;

CREATE TABLE IF NOT EXISTS hammer_rounds (
    day         DATE PRIMARY KEY,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hammer_lots (
    day         DATE NOT NULL REFERENCES hammer_rounds(day) ON DELETE CASCADE,
    auction_id  VARCHAR NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (day, auction_id)
);

CREATE TABLE IF NOT EXISTS hammer_calls (
    id               BIGSERIAL PRIMARY KEY,
    day              DATE NOT NULL,
    auction_id       VARCHAR NOT NULL,
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    predicted_price  NUMERIC NOT NULL CHECK (predicted_price > 0 AND predicted_price < 10000000000),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, day, auction_id),
    FOREIGN KEY (day, auction_id) REFERENCES hammer_lots(day, auction_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hammer_calls_lot ON hammer_calls (day, auction_id);

ALTER TABLE hammer_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE hammer_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hammer_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hammer_rounds, hammer_lots, hammer_calls FROM anon, authenticated;
REVOKE ALL ON SEQUENCE hammer_calls_id_seq FROM anon, authenticated;

GRANT SELECT ON hammer_rounds, hammer_lots TO anon, authenticated;
DROP POLICY IF EXISTS "Anyone can read hammer rounds" ON hammer_rounds;
CREATE POLICY "Anyone can read hammer rounds" ON hammer_rounds FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Anyone can read hammer lots" ON hammer_lots;
CREATE POLICY "Anyone can read hammer lots" ON hammer_lots FOR SELECT TO anon, authenticated USING (true);

-- Own calls always; everyone's once the lot has closed.
GRANT SELECT ON hammer_calls TO authenticated;
DROP POLICY IF EXISTS "Calls are visible once the lot closes" ON hammer_calls;
CREATE POLICY "Calls are visible once the lot closes" ON hammer_calls FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR EXISTS (
            SELECT 1 FROM auctions a
            WHERE a.auction_id = hammer_calls.auction_id
              AND (a.timestamp_end <= extract(epoch FROM now()) OR a.final_price IS NOT NULL OR a.reserve_not_met)
        )
    );

-- ---------- scoring ----------

-- The price a lot is scored against, or NULL while pending or when void.
CREATE OR REPLACE FUNCTION hammer_result(p_final NUMERIC, p_rnm BOOLEAN, p_bid TEXT, p_estimate_low NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_final > 0 THEN p_final
        WHEN p_final = 0 THEN NULL
        WHEN p_rnm AND p_estimate_low IS NULL THEN nullif(nullif(regexp_replace(coalesce(p_bid, ''), '[^0-9.]', '', 'g'), '')::numeric, 0)
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION hammer_points(p_call NUMERIC, p_result NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_call IS NULL OR p_result IS NULL OR p_result <= 0 THEN NULL
        ELSE greatest(0, round(100 - 200 * abs(p_call - p_result) / p_result))::integer
    END;
$$;

-- ---------- rounds ----------

-- Pick five online lots closing on a New York date, one per fifth of the
-- price range. Stable once made: the round is stored.
CREATE OR REPLACE FUNCTION hammer_pick_round(p_day DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_from BIGINT := extract(epoch FROM (p_day::timestamp AT TIME ZONE 'America/New_York'))::bigint;
    v_to   BIGINT := extract(epoch FROM ((p_day + 1)::timestamp AT TIME ZONE 'America/New_York'))::bigint;
    v_soon BIGINT := extract(epoch FROM now() + interval '30 minutes')::bigint;
    v_n    INTEGER;
BEGIN
    -- Two players opening the game at once must not both pick a round.
    PERFORM pg_advisory_xact_lock(hashtext('hammer_pick_round'), (p_day - DATE '2000-01-01'));
    IF EXISTS (SELECT 1 FROM hammer_rounds WHERE day = p_day) THEN
        RETURN 0;
    END IF;
    INSERT INTO hammer_rounds (day, title) VALUES (p_day, 'Bring a Trailer') ON CONFLICT DO NOTHING;
    WITH c AS (
        SELECT a.auction_id,
               nullif(regexp_replace(coalesce(a.current_bid, ''), '[^0-9.]', '', 'g'), '')::numeric AS bid
        FROM auctions a
        WHERE a.url ILIKE '%bringatrailer.com/listing/%'
          AND a.image_url IS NOT NULL
          AND a.final_price IS NULL
          AND NOT a.reserve_not_met
          AND a.timestamp_end >= greatest(v_from, v_soon)
          AND a.timestamp_end < v_to
    ), banded AS (
        SELECT auction_id, bid, ntile(5) OVER (ORDER BY bid) AS band
        FROM c WHERE bid >= 5000
    ), picked AS (
        SELECT DISTINCT ON (band) band, auction_id
        FROM banded
        ORDER BY band, md5(auction_id || p_day::text)
    )
    INSERT INTO hammer_lots (day, auction_id, position)
    SELECT p_day, auction_id, band FROM picked
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        DELETE FROM hammer_rounds WHERE day = p_day AND NOT EXISTS (SELECT 1 FROM hammer_lots WHERE day = p_day);
    END IF;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION hammer_pick_round(DATE) FROM PUBLIC, anon, authenticated;

-- A day's round, for the player asking: each lot, its result once known, the
-- player's own call and points, and the crowd's median call once it closes.
-- Picks the round first when the day is today or tomorrow and has none.
CREATE OR REPLACE FUNCTION hammer_round(p_day DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_today DATE := (now() AT TIME ZONE 'America/New_York')::date;
    v_now   BIGINT := extract(epoch FROM now())::bigint;
    v_out   JSONB;
BEGIN
    IF p_day BETWEEN v_today AND v_today + 1 AND NOT EXISTS (SELECT 1 FROM hammer_rounds WHERE day = p_day) THEN
        PERFORM hammer_pick_round(p_day);
    END IF;
    -- Set tomorrow's round up a day ahead, while all its lots are still open.
    IF p_day = v_today AND NOT EXISTS (SELECT 1 FROM hammer_rounds WHERE day = v_today + 1) THEN
        PERFORM hammer_pick_round(v_today + 1);
    END IF;

    SELECT jsonb_build_object(
        'day', r.day,
        'title', r.title,
        'lots', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'auction_id', a.auction_id,
                'position', hl.position,
                'title', a.title,
                'make', a.make,
                'year', a.year,
                'url', a.url,
                'image_url', a.image_url,
                'current_bid', a.current_bid,
                'price_at_48h', a.price_at_48h,
                'estimate_low', a.estimate_low,
                'estimate_high', a.estimate_high,
                'no_reserve', a.no_reserve,
                'timestamp_end', a.timestamp_end,
                'final_price', a.final_price,
                'reserve_not_met', a.reserve_not_met,
                'closed', (a.timestamp_end <= v_now OR a.final_price IS NOT NULL OR a.reserve_not_met),
                'result', hammer_result(a.final_price, a.reserve_not_met, a.current_bid, a.estimate_low),
                'void', (a.final_price = 0 OR (a.reserve_not_met AND a.estimate_low IS NOT NULL)),
                'my_call', mc.predicted_price,
                'my_points', hammer_points(mc.predicted_price, hammer_result(a.final_price, a.reserve_not_met, a.current_bid, a.estimate_low)),
                'calls', (SELECT count(*) FROM hammer_calls x WHERE x.day = hl.day AND x.auction_id = hl.auction_id),
                'crowd_median', CASE WHEN (a.timestamp_end <= v_now OR a.final_price IS NOT NULL OR a.reserve_not_met) THEN (
                    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x.predicted_price)::numeric)
                    FROM hammer_calls x WHERE x.day = hl.day AND x.auction_id = hl.auction_id) END
            ) ORDER BY hl.position)
            FROM hammer_lots hl
            JOIN auctions a ON a.auction_id = hl.auction_id
            LEFT JOIN hammer_calls mc ON mc.day = hl.day AND mc.auction_id = hl.auction_id AND mc.user_id = v_uid
            WHERE hl.day = r.day
        ), '[]'::jsonb)
    ) INTO v_out
    FROM hammer_rounds r WHERE r.day = p_day;

    RETURN coalesce(v_out, jsonb_build_object('day', p_day, 'title', NULL, 'lots', '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION hammer_round(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hammer_round(DATE) TO anon, authenticated;

-- Make or change a call. Refused once the lot has closed.
CREATE OR REPLACE FUNCTION make_hammer_call(p_day DATE, p_auction_id TEXT, p_price NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_end BIGINT;
    v_final NUMERIC;
    v_rnm BOOLEAN;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sign in to call the hammer');
    END IF;
    IF p_price IS NULL OR p_price <= 0 OR p_price >= 10000000000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a price');
    END IF;
    SELECT a.timestamp_end, a.final_price, a.reserve_not_met INTO v_end, v_final, v_rnm
    FROM hammer_lots hl JOIN auctions a ON a.auction_id = hl.auction_id
    WHERE hl.day = p_day AND hl.auction_id = p_auction_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That lot is not in this round');
    END IF;
    IF v_end <= extract(epoch FROM now()) OR v_final IS NOT NULL OR v_rnm THEN
        RETURN jsonb_build_object('success', false, 'error', 'Calls are closed: this lot has gone under the hammer');
    END IF;
    INSERT INTO hammer_calls (day, auction_id, user_id, predicted_price)
    VALUES (p_day, p_auction_id, v_uid, round(p_price))
    ON CONFLICT (user_id, day, auction_id)
    DO UPDATE SET predicted_price = EXCLUDED.predicted_price, updated_at = now();
    RETURN jsonb_build_object('success', true, 'predicted_price', round(p_price));
END;
$$;
REVOKE ALL ON FUNCTION make_hammer_call(DATE, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION make_hammer_call(DATE, TEXT, NUMERIC) TO authenticated;

-- Standings over a range of days: points from settled lots only, so nothing
-- about an open lot's calls is revealed.
CREATE OR REPLACE FUNCTION hammer_board(p_from DATE, p_to DATE)
RETURNS TABLE (user_id UUID, username TEXT, is_house BOOLEAN, calls INTEGER, scored INTEGER, points INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.user_id,
           coalesce(u.username, 'Player')::text,
           coalesce(u.is_house, false),
           count(*)::integer,
           count(hammer_points(c.predicted_price, hammer_result(a.final_price, a.reserve_not_met, a.current_bid, a.estimate_low)))::integer,
           coalesce(sum(hammer_points(c.predicted_price, hammer_result(a.final_price, a.reserve_not_met, a.current_bid, a.estimate_low))), 0)::integer
    FROM hammer_calls c
    JOIN auctions a ON a.auction_id = c.auction_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.day BETWEEN p_from AND p_to
    GROUP BY c.user_id, u.username, u.is_house
    ORDER BY 6 DESC, 5 DESC, 2;
$$;
REVOKE ALL ON FUNCTION hammer_board(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hammer_board(DATE, DATE) TO anon, authenticated;

-- ---------- event log: accept the hammer events ----------
-- Same function as supabase_migration_events.sql, with two more names.
CREATE OR REPLACE FUNCTION log_events(p_session_id TEXT, p_events JSONB)
RETURNS INTEGER AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_recent INTEGER;
    v_written INTEGER;
BEGIN
    IF v_uid IS NULL OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
        RETURN 0;
    END IF;

    SELECT count(*) INTO v_recent
    FROM events
    WHERE user_id = v_uid AND created_at > now() - INTERVAL '10 minutes';
    IF v_recent >= 1000 THEN
        RETURN 0;
    END IF;

    INSERT INTO events (user_id, session_id, name, league_id, auction_id, props)
    SELECT
        v_uid,
        left(COALESCE(NULLIF(p_session_id, ''), 'unknown'), 64),
        e->>'name',
        CASE WHEN e->>'league_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (e->>'league_id')::uuid END,
        left(e->>'auction_id', 200),
        CASE WHEN jsonb_typeof(e->'props') = 'object' AND pg_column_size(e->'props') <= 4096
             THEN e->'props' ELSE '{}'::jsonb END
    FROM jsonb_array_elements(p_events) WITH ORDINALITY AS x(e, i)
    WHERE x.i <= 50
      AND jsonb_typeof(e) = 'object'
      AND e->>'name' = ANY (ARRAY[
          'screen_view',        -- { screen }
          'sign_in',
          'league_join',        -- { source: list | invite }
          'auction_list_view',  -- { auction_ids (in display order), filter, budget, garage_size }
          'auction_open',       -- { target: source, screen } — opened the listing itself
          'draft_add',          -- { ok, reason, price, garage_size }
          'draft_remove',       -- { ok }
          'prediction_open',
          'prediction_submit',  -- { ok, predicted_price, previous }
          'chat_open',
          'chat_send',          -- { ok, length } — never the text
          'leaderboard_sort',   -- { sort }
          'hammer_view',        -- { day, lots, called }
          'hammer_call'         -- { day, ok, predicted_price, previous, reference, position }
      ]);

    GET DIAGNOSTICS v_written = ROW_COUNT;
    RETURN v_written;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION log_events(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION log_events(TEXT, JSONB) TO authenticated, service_role;

-- ---------- the first hand-set round: Rétromobile New York, Friday ----------
-- Five lots offered without reserve, so all five sell, from $30k to $8M.
-- Calls close when the sale opens (the lots' timestamp_end, 11:00 New York).
INSERT INTO hammer_rounds (day, title)
VALUES ('2026-11-20', 'Gooding Christie''s · Rétromobile New York')
ON CONFLICT (day) DO NOTHING;
INSERT INTO hammer_lots (day, auction_id, position)
SELECT '2026-11-20', v.id, v.pos
FROM (VALUES
    ('manual_gooding-retromobile-ny-2026-lot-1', 1),
    ('manual_gooding-retromobile-ny-2026-lot-11', 2),
    ('manual_gooding-retromobile-ny-2026-lot-20', 3),
    ('manual_gooding-retromobile-ny-2026-lot-74', 4),
    ('manual_gooding-retromobile-ny-2026-lot-43', 5)
) AS v(id, pos)
WHERE EXISTS (SELECT 1 FROM auctions a WHERE a.auction_id = v.id)
ON CONFLICT DO NOTHING;

COMMIT;

-- Check:
--   SELECT hammer_points(100000, 100000), hammer_points(90000, 100000), hammer_points(150000, 100000);  -- 100, 80, 0
--   SELECT hammer_round((now() AT TIME ZONE 'America/New_York')::date);
