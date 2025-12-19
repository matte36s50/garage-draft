-- =====================================================
-- League History & Results Migration
-- Run this in your Supabase SQL Editor
-- =====================================================

-- 1. Add completed_at column to leagues table
ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN leagues.completed_at IS 'Timestamp when the league was marked as completed. NULL means still active.';

-- 2. Create league_results table to store frozen final standings
CREATE TABLE IF NOT EXISTS league_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    final_rank INTEGER NOT NULL,
    final_score NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    car_count INTEGER NOT NULL DEFAULT 0,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    cars_snapshot JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Each user can only have one result per league
    CONSTRAINT unique_league_result UNIQUE (league_id, user_id)
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_league_results_user_id ON league_results(user_id);
CREATE INDEX IF NOT EXISTS idx_league_results_league_id ON league_results(league_id);
CREATE INDEX IF NOT EXISTS idx_league_results_final_rank ON league_results(final_rank);
CREATE INDEX IF NOT EXISTS idx_league_results_is_winner ON league_results(is_winner) WHERE is_winner = TRUE;

COMMENT ON TABLE league_results IS 'Stores frozen final standings when a league is completed';
COMMENT ON COLUMN league_results.final_rank IS 'Final rank position (1 = winner)';
COMMENT ON COLUMN league_results.final_score IS 'Final percentage gain score';
COMMENT ON COLUMN league_results.is_winner IS 'TRUE if user finished in 1st place';
COMMENT ON COLUMN league_results.cars_snapshot IS 'JSON array of cars with final prices at league completion';

-- 3. Enable RLS on league_results
ALTER TABLE league_results ENABLE ROW LEVEL SECURITY;

-- Users can view their own results
CREATE POLICY "Users can view their own results"
    ON league_results FOR SELECT
    USING (auth.uid() = user_id);

-- Users can view results of leagues they participated in
CREATE POLICY "Users can view league results they participated in"
    ON league_results FOR SELECT
    USING (
        league_id IN (
            SELECT league_id FROM league_members WHERE user_id = auth.uid()
        )
    );

-- Service role can insert/update (for cron job)
CREATE POLICY "Service role can manage league_results"
    ON league_results FOR ALL
    USING (auth.role() = 'service_role');

-- 4. Function to complete a league and freeze standings
CREATE OR REPLACE FUNCTION complete_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_league RECORD;
    v_member RECORD;
    v_garage RECORD;
    v_car RECORD;
    v_cars_snapshot JSONB;
    v_total_spent NUMERIC;
    v_car_count INTEGER;
    v_results_count INTEGER := 0;
BEGIN
    -- Check if league exists and isn't already completed
    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'League not found');
    END IF;

    IF v_league.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'League already completed');
    END IF;

    -- Process each league member
    FOR v_member IN
        SELECT lm.*, u.raw_user_meta_data->>'username' as username
        FROM league_members lm
        JOIN auth.users u ON u.id = lm.user_id
        WHERE lm.league_id = p_league_id
        ORDER BY lm.total_score DESC
    LOOP
        -- Get garage for this member
        SELECT * INTO v_garage
        FROM garages
        WHERE user_id = v_member.user_id AND league_id = p_league_id;

        IF FOUND THEN
            -- Build cars snapshot
            v_cars_snapshot := '[]'::jsonb;
            v_total_spent := 0;
            v_car_count := 0;

            FOR v_car IN
                SELECT
                    gc.purchase_price,
                    a.auction_id,
                    a.title,
                    a.make,
                    a.model,
                    a.year,
                    a.final_price,
                    a.current_bid,
                    a.image_url
                FROM garage_cars gc
                JOIN auctions a ON a.auction_id = gc.auction_id
                WHERE gc.garage_id = v_garage.id
            LOOP
                v_cars_snapshot := v_cars_snapshot || jsonb_build_object(
                    'auction_id', v_car.auction_id,
                    'title', v_car.title,
                    'make', v_car.make,
                    'model', v_car.model,
                    'year', v_car.year,
                    'purchase_price', v_car.purchase_price,
                    'final_price', COALESCE(v_car.final_price, v_car.current_bid),
                    'image_url', v_car.image_url
                );
                v_total_spent := v_total_spent + v_car.purchase_price;
                v_car_count := v_car_count + 1;
            END LOOP;
        ELSE
            v_cars_snapshot := '[]'::jsonb;
            v_total_spent := 0;
            v_car_count := 0;
        END IF;

        -- Insert or update league result
        INSERT INTO league_results (
            league_id,
            user_id,
            username,
            final_rank,
            final_score,
            total_spent,
            car_count,
            is_winner,
            cars_snapshot
        ) VALUES (
            p_league_id,
            v_member.user_id,
            COALESCE(v_member.username, 'Unknown'),
            v_member.rank,
            v_member.total_score,
            v_total_spent,
            v_car_count,
            v_member.rank = 1,
            v_cars_snapshot
        )
        ON CONFLICT (league_id, user_id) DO UPDATE SET
            final_rank = EXCLUDED.final_rank,
            final_score = EXCLUDED.final_score,
            total_spent = EXCLUDED.total_spent,
            car_count = EXCLUDED.car_count,
            is_winner = EXCLUDED.is_winner,
            cars_snapshot = EXCLUDED.cars_snapshot;

        v_results_count := v_results_count + 1;
    END LOOP;

    -- Mark league as completed
    UPDATE leagues SET completed_at = NOW() WHERE id = p_league_id;

    RETURN jsonb_build_object(
        'success', true,
        'league_id', p_league_id,
        'results_created', v_results_count,
        'completed_at', NOW()
    );
END;
$$;

-- 5. Function to check if a league should be auto-completed
-- A league is ready to complete when:
-- - All auctions in garages have final_price set (auction ended)
-- - OR all auction timestamp_end has passed
CREATE OR REPLACE FUNCTION check_and_complete_leagues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_league RECORD;
    v_result JSONB;
    v_completed_count INTEGER := 0;
    v_results JSONB := '[]'::jsonb;
BEGIN
    -- Find leagues that should be completed
    FOR v_league IN
        SELECT DISTINCT l.id, l.name
        FROM leagues l
        WHERE l.completed_at IS NULL
        AND l.draft_ends_at < NOW() -- Draft period has ended
        AND NOT EXISTS (
            -- No auctions in any garage that haven't ended yet
            SELECT 1
            FROM garages g
            JOIN garage_cars gc ON gc.garage_id = g.id
            JOIN auctions a ON a.auction_id = gc.auction_id
            WHERE g.league_id = l.id
            AND a.final_price IS NULL
            AND a.timestamp_end > EXTRACT(EPOCH FROM NOW())
        )
        -- Must have at least one member with cars
        AND EXISTS (
            SELECT 1
            FROM garages g
            JOIN garage_cars gc ON gc.garage_id = g.id
            WHERE g.league_id = l.id
        )
    LOOP
        -- Complete this league
        v_result := complete_league(v_league.id);

        IF (v_result->>'success')::boolean THEN
            v_completed_count := v_completed_count + 1;
            v_results := v_results || jsonb_build_object(
                'league_id', v_league.id,
                'league_name', v_league.name,
                'status', 'completed'
            );
        ELSE
            v_results := v_results || jsonb_build_object(
                'league_id', v_league.id,
                'league_name', v_league.name,
                'status', 'failed',
                'error', v_result->>'error'
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'leagues_completed', v_completed_count,
        'results', v_results,
        'checked_at', NOW()
    );
END;
$$;

-- 6. Grant execute permissions
GRANT EXECUTE ON FUNCTION complete_league(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION check_and_complete_leagues() TO service_role;

-- =====================================================
-- VERIFICATION QUERIES (run these to verify setup)
-- =====================================================

-- Check if columns/tables exist:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'leagues' AND column_name = 'completed_at';
-- SELECT * FROM information_schema.tables WHERE table_name = 'league_results';

-- Test the auto-complete check (dry run - won't actually complete anything if no leagues are ready):
-- SELECT check_and_complete_leagues();

-- View user's league history:
-- SELECT * FROM league_results WHERE user_id = 'your-user-id-here' ORDER BY created_at DESC;
