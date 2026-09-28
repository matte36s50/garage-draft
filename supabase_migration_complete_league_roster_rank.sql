-- =====================================================
-- Fix: rank finished events the way the live standings do
--
-- The live leaderboard (and the final-results podium) ranks players with a
-- complete 7-car roster above anyone with fewer cars, then by value.
-- complete_league() ranked by total_score alone, so History could record a
-- different finishing position, and even a different winner, from the one
-- players saw on the podium.
--
-- Same function as supabase_migration_fix_complete_league_rank.sql except for
-- the ranking in the member loop. Run this in your Supabase SQL Editor.
-- =====================================================

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

    -- Process each league member, ranked the way the live standings are:
    -- complete 7-car rosters first, then by total_score.
    FOR v_member IN
        SELECT lm.*,
               u.raw_user_meta_data->>'username' as username,
               ROW_NUMBER() OVER (
                   ORDER BY (COALESCE(cc.car_count, 0) >= 7) DESC, lm.total_score DESC
               )::INTEGER as computed_rank
        FROM league_members lm
        JOIN auth.users u ON u.id = lm.user_id
        LEFT JOIN (
            SELECT g.user_id, COUNT(gc.id) AS car_count
            FROM garages g
            JOIN garage_cars gc ON gc.garage_id = g.id
            WHERE g.league_id = p_league_id
            GROUP BY g.user_id
        ) cc ON cc.user_id = lm.user_id
        WHERE lm.league_id = p_league_id
        ORDER BY computed_rank
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

        -- Insert or update league result using computed_rank (not stored rank)
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
            v_member.computed_rank,
            v_member.total_score,
            v_total_spent,
            v_car_count,
            v_member.computed_rank = 1,
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

GRANT EXECUTE ON FUNCTION complete_league(UUID) TO service_role;
