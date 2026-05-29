-- =====================================================
-- Migration: Server-side drafting RPCs (draft_car / undraft_car)
-- Run this in your Supabase SQL Editor.
-- =====================================================
--
-- WHY: Drafting rules (the per-league budget, the 7-car cap, the draft window,
-- and the locked-in purchase price) were enforced ONLY in the React client
-- (App.js addToGarage/removeFromGarage). A user calling Supabase directly with
-- the anon key could bypass all of them and, because the budget was read then
-- written in two separate statements, concurrent adds could desync the budget.
--
-- These SECURITY DEFINER functions move enforcement server-side and make the
-- car insert + budget update ATOMIC. They derive the user from auth.uid() and
-- never trust a client-supplied user id. The budget source of truth is the
-- garage's actual remaining_budget (not a hardcoded constant), so per-league
-- spending limits keep working.
--
-- =====================================================

-- ---------- draft_car ----------
CREATE OR REPLACE FUNCTION draft_car(
    p_league_id UUID,
    p_auction_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_garage_id UUID;
    v_budget NUMERIC;
    v_use_manual BOOLEAN;
    v_starts TIMESTAMPTZ;
    v_ends TIMESTAMPTZ;
    v_price NUMERIC;
    v_price_at_48h NUMERIC;
    v_current_bid NUMERIC;
    v_timestamp_end BIGINT;
    v_final_price NUMERIC;
    v_in_pool BOOLEAN := FALSE;
    v_car_count INT;
    v_now BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
    v_new_car_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- League draft window
    SELECT use_manual_auctions, draft_starts_at, draft_ends_at
      INTO v_use_manual, v_starts, v_ends
      FROM leagues WHERE id = p_league_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'League not found');
    END IF;
    IF v_starts IS NOT NULL AND NOW() < v_starts THEN
        RETURN jsonb_build_object('success', false, 'error', 'Draft has not opened yet');
    END IF;
    IF v_ends IS NOT NULL AND NOW() > v_ends THEN
        RETURN jsonb_build_object('success', false, 'error', 'Draft is closed');
    END IF;

    -- User's garage for this league (locked to serialize concurrent drafts)
    SELECT id, remaining_budget INTO v_garage_id, v_budget
      FROM garages
     WHERE user_id = v_uid AND league_id = p_league_id
     FOR UPDATE;
    IF v_garage_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Join the league first');
    END IF;

    -- Auction must exist and have a usable price
    SELECT price_at_48h, current_bid, timestamp_end, final_price
      INTO v_price_at_48h, v_current_bid, v_timestamp_end, v_final_price
      FROM auctions WHERE auction_id = p_auction_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Auction not found');
    END IF;

    -- Auction must be part of this league's pool
    IF v_use_manual THEN
        SELECT EXISTS (
            SELECT 1 FROM league_auctions
             WHERE league_id = p_league_id AND auction_id = p_auction_id
        ) INTO v_in_pool;
    ELSE
        -- Auto leagues: the 4-5 day window used by the client/admin portal
        v_in_pool := (
            v_price_at_48h IS NOT NULL
            AND v_final_price IS NULL
            AND v_timestamp_end >= v_now + (4 * 24 * 60 * 60)
            AND v_timestamp_end <= v_now + (5 * 24 * 60 * 60)
        );
    END IF;
    IF NOT v_in_pool THEN
        RETURN jsonb_build_object('success', false, 'error', 'Car is not in this auction pool');
    END IF;

    v_price := COALESCE(v_price_at_48h, v_current_bid);
    IF v_price IS NULL OR v_price <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Car has no valid price');
    END IF;

    -- Already drafted?
    IF EXISTS (
        SELECT 1 FROM garage_cars
         WHERE garage_id = v_garage_id AND auction_id = p_auction_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Car already in your garage');
    END IF;

    -- 7-car cap
    SELECT COUNT(*) INTO v_car_count FROM garage_cars WHERE garage_id = v_garage_id;
    IF v_car_count >= 7 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Garage is full (7 cars)');
    END IF;

    -- Budget
    IF v_budget < v_price THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not enough budget remaining');
    END IF;

    -- Atomic: insert the car and deduct the budget
    INSERT INTO garage_cars (garage_id, auction_id, purchase_price)
    VALUES (v_garage_id, p_auction_id, v_price)
    RETURNING id INTO v_new_car_id;

    UPDATE garages SET remaining_budget = remaining_budget - v_price
     WHERE id = v_garage_id;

    RETURN jsonb_build_object(
        'success', true,
        'garage_car_id', v_new_car_id,
        'purchase_price', v_price,
        'remaining_budget', v_budget - v_price
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------- undraft_car ----------
CREATE OR REPLACE FUNCTION undraft_car(
    p_garage_car_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_garage_id UUID;
    v_league_id UUID;
    v_purchase NUMERIC;
    v_ends TIMESTAMPTZ;
    v_budget NUMERIC;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Find the car and verify ownership via the garage
    SELECT gc.garage_id, gc.purchase_price, g.league_id
      INTO v_garage_id, v_purchase, v_league_id
      FROM garage_cars gc
      JOIN garages g ON g.id = gc.garage_id
     WHERE gc.id = p_garage_car_id AND g.user_id = v_uid;
    IF v_garage_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Car not found in your garage');
    END IF;

    -- Draft must still be open
    SELECT draft_ends_at INTO v_ends FROM leagues WHERE id = v_league_id;
    IF v_ends IS NOT NULL AND NOW() > v_ends THEN
        RETURN jsonb_build_object('success', false, 'error', 'Draft is closed');
    END IF;

    -- Lock the garage, delete the car, refund the budget (atomic)
    SELECT remaining_budget INTO v_budget FROM garages WHERE id = v_garage_id FOR UPDATE;

    DELETE FROM garage_cars WHERE id = p_garage_car_id;

    UPDATE garages SET remaining_budget = remaining_budget + COALESCE(v_purchase, 0)
     WHERE id = v_garage_id;

    RETURN jsonb_build_object(
        'success', true,
        'remaining_budget', COALESCE(v_budget, 0) + COALESCE(v_purchase, 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION draft_car(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION undraft_car(UUID) TO authenticated;

-- =====================================================
-- OPTIONAL (recommended) — close the direct-write bypass.
--
-- The RPCs above enforce the rules, but they only HELP if clients can't also
-- write garage_cars / remaining_budget directly with the anon key. After you've
-- confirmed nothing else writes these tables directly with the anon key
-- (note: joinLeague inserts a garages row; the admin "seed users" tool and the
-- service-role cron also write — the cron bypasses RLS so it is unaffected),
-- tighten RLS so drafting can ONLY go through the RPCs:
--
--   -- garage_cars: no direct INSERT/UPDATE/DELETE from clients
--   DROP POLICY IF EXISTS "garage_cars_insert" ON garage_cars;
--   DROP POLICY IF EXISTS "garage_cars_delete" ON garage_cars;
--   -- (keep a SELECT policy so users can read their own cars)
--
--   -- garages: allow INSERT (joinLeague) + SELECT, but block client UPDATE of
--   -- remaining_budget so it can only change via the SECURITY DEFINER RPCs.
--   DROP POLICY IF EXISTS "garages_update" ON garages;
--
-- Apply these only after verifying your existing policy names and writers.
-- =====================================================
