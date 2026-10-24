-- =====================================================
-- Migration: first-party event log
-- Run in the GAME Supabase project (NEXT_PUBLIC_SUPABASE_URL), SQL Editor,
-- after supabase_migration_lock_down_rls.sql.
-- =====================================================
--
-- WHY: the game only kept outcomes (who drafted what, who predicted what).
-- What players looked at, opened, tried and gave up on was lost, and that is
-- what tells us (a) where the game loses people and (b) which cars draw
-- enthusiast interest, a signal the MII/MAI research can test.
--
-- The player app (src/utils/track.js) sends events in batches to log_events().
-- Rules, enforced here rather than trusted from the client:
--   - signed-in players only; the user is taken from the session,
--   - event names from a fixed list; anything else is dropped,
--   - at most 50 events per call and 1,000 per player per 10 minutes,
--   - props capped at 4 KB per event. The app never sends chat text or any
--     other free text.
-- Nobody but the service role can read the table.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    league_id   UUID,
    auction_id  TEXT,
    props       JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE events IS
    'What signed-in players look at and do in the game. Written only by log_events(); '
    'read only by the service role. Deleting an account keeps its events but clears user_id.';

CREATE INDEX IF NOT EXISTS idx_events_name_time ON events (name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_auction ON events (auction_id) WHERE auction_id IS NOT NULL;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE events_id_seq FROM anon, authenticated;

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
          'leaderboard_sort'    -- { sort }
      ]);

    GET DIAGNOSTICS v_written = ROW_COUNT;
    RETURN v_written;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION log_events(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION log_events(TEXT, JSONB) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Per-car interest among players: the crowd signal to test against MII/MAI.
-- One row per auction: how many distinct players were shown it, opened its
-- listing, drafted it, dropped it, and the share of those shown who drafted.
-- security_invoker makes the view obey the events table's access (service
-- role only); the REVOKE is belt and braces.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW auction_player_interest WITH (security_invoker = true) AS
WITH touches AS (
    SELECT e.user_id, ids.auction_id, 'shown' AS kind, e.created_at
    FROM events e
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(e.props->'auction_ids') = 'array' THEN e.props->'auction_ids' ELSE '[]'::jsonb END
    ) AS ids(auction_id)
    WHERE e.name = 'auction_list_view'
    UNION ALL
    SELECT user_id, auction_id, 'opened', created_at FROM events WHERE name = 'auction_open' AND auction_id IS NOT NULL
    UNION ALL
    SELECT user_id, auction_id, 'drafted', created_at FROM events
    WHERE name = 'draft_add' AND auction_id IS NOT NULL AND (props->>'ok')::boolean IS TRUE
    UNION ALL
    SELECT user_id, auction_id, 'dropped', created_at FROM events
    WHERE name = 'draft_remove' AND auction_id IS NOT NULL AND (props->>'ok')::boolean IS TRUE
)
SELECT
    t.auction_id,
    a.title,
    a.make,
    a.model,
    a.year,
    a.url,
    count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'shown')   AS players_shown,
    count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'opened')  AS players_opened,
    count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'drafted') AS players_drafted,
    count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'dropped') AS players_dropped,
    round(
        count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'drafted')::numeric
        / NULLIF(count(DISTINCT t.user_id) FILTER (WHERE t.kind = 'shown'), 0), 3
    ) AS draft_rate,
    min(t.created_at) AS first_seen,
    max(t.created_at) AS last_seen
FROM touches t
LEFT JOIN auctions a ON a.auction_id = t.auction_id
GROUP BY t.auction_id, a.title, a.make, a.model, a.year, a.url;

COMMENT ON VIEW auction_player_interest IS
    'Per auction: distinct players shown, opened, drafted and dropped it, and the draft rate among those shown.';

REVOKE ALL ON auction_player_interest FROM anon, authenticated;
GRANT SELECT ON auction_player_interest TO service_role;

COMMIT;

-- Check (expect false, false, true):
--   SELECT has_table_privilege('anon', 'public.events', 'SELECT'),
--          has_table_privilege('authenticated', 'public.events', 'INSERT'),
--          has_function_privilege('authenticated', 'log_events(text, jsonb)', 'EXECUTE');
--
-- What players did today:
--   SELECT name, count(*), count(DISTINCT user_id) FROM events
--   WHERE created_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;
--
-- The cars players were most drawn to:
--   SELECT * FROM auction_player_interest ORDER BY players_drafted DESC, players_opened DESC LIMIT 50;
