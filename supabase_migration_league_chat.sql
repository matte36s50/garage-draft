-- =====================================================
-- BixPrix League Chat System Migration
-- =====================================================
-- This migration creates:
-- 1. league_messages table for chat messages
-- 2. message_type enum for different message types
-- 3. Triggers for auto-posting system messages
-- 4. Rate limiting support via league_members update
-- 5. Auction notification tracking table
-- =====================================================

-- =====================================================
-- STEP 1: Create message type enum
-- =====================================================
DO $$ BEGIN
    CREATE TYPE message_type AS ENUM (
        'user',
        'system_car_picked',
        'system_price_update',
        'system_auction_ending',
        'system_auction_ended',
        'system_big_move'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- STEP 2: Create league_messages table
-- =====================================================
CREATE TABLE IF NOT EXISTS league_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL for system messages
    message_type message_type NOT NULL DEFAULT 'user',
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_league_messages_league_id
    ON league_messages(league_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_league_messages_user_id
    ON league_messages(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_league_messages_type
    ON league_messages(message_type) WHERE message_type != 'user';

-- =====================================================
-- STEP 3: Create auction_notifications tracking table
-- Tracks which system messages have been sent to prevent duplicates
-- =====================================================
CREATE TABLE IF NOT EXISTS auction_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id TEXT NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL, -- 'ending_soon', 'ended', 'price_update', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(auction_id, league_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_auction_notifications_lookup
    ON auction_notifications(auction_id, league_id, notification_type);

-- =====================================================
-- STEP 4: Add rate limiting column to league_members
-- =====================================================
ALTER TABLE league_members
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- STEP 5: Enable Row Level Security
-- =====================================================
ALTER TABLE league_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read messages from leagues they are members of
CREATE POLICY "Users can read league messages" ON league_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM league_members
            WHERE league_members.league_id = league_messages.league_id
            AND league_members.user_id = auth.uid()
        )
    );

-- Policy: Users can insert their own messages (rate limited in application)
CREATE POLICY "Users can send messages to their leagues" ON league_messages
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND message_type = 'user'
        AND EXISTS (
            SELECT 1 FROM league_members
            WHERE league_members.league_id = league_messages.league_id
            AND league_members.user_id = auth.uid()
        )
    );

-- Policy: System can insert any messages (for triggers)
CREATE POLICY "Service role can insert system messages" ON league_messages
    FOR INSERT
    WITH CHECK (true);

-- Policy for auction_notifications (system only via service role)
CREATE POLICY "Service role can manage notifications" ON auction_notifications
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- STEP 6: Helper function to get username
-- =====================================================
CREATE OR REPLACE FUNCTION get_username(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_username TEXT;
BEGIN
    SELECT COALESCE(
        raw_user_meta_data->>'username',
        raw_user_meta_data->>'name',
        email
    ) INTO v_username
    FROM auth.users
    WHERE id = p_user_id;

    RETURN COALESCE(v_username, 'Unknown User');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 7: Helper function to format price
-- =====================================================
CREATE OR REPLACE FUNCTION format_price(p_price NUMERIC)
RETURNS TEXT AS $$
BEGIN
    RETURN '$' || TO_CHAR(p_price, 'FM999,999,999');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- STEP 8: Helper function to check notification cooldown
-- Returns TRUE if we should send the notification (not in cooldown)
-- =====================================================
CREATE OR REPLACE FUNCTION can_send_notification(
    p_auction_id TEXT,
    p_league_id UUID,
    p_notification_type TEXT,
    p_cooldown_hours INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
    v_last_sent TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT created_at INTO v_last_sent
    FROM auction_notifications
    WHERE auction_id = p_auction_id
      AND league_id = p_league_id
      AND notification_type = p_notification_type
    ORDER BY created_at DESC
    LIMIT 1;

    -- If never sent, allow it
    IF v_last_sent IS NULL THEN
        RETURN TRUE;
    END IF;

    -- Check if cooldown has passed
    RETURN (NOW() - v_last_sent) > (p_cooldown_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 9: Function to post system message
-- =====================================================
CREATE OR REPLACE FUNCTION post_system_message(
    p_league_id UUID,
    p_message_type message_type,
    p_content TEXT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_message_id UUID;
BEGIN
    INSERT INTO league_messages (league_id, user_id, message_type, content, metadata)
    VALUES (p_league_id, NULL, p_message_type, p_content, p_metadata)
    RETURNING id INTO v_message_id;

    RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 10: Trigger function for CAR DRAFTED
-- Fires when someone adds a car to their garage
-- =====================================================
CREATE OR REPLACE FUNCTION notify_car_drafted()
RETURNS TRIGGER AS $$
DECLARE
    v_garage RECORD;
    v_auction RECORD;
    v_username TEXT;
    v_message TEXT;
    v_metadata JSONB;
BEGIN
    -- Get garage info (includes user_id and league_id)
    SELECT g.*, l.id as league_id, l.name as league_name
    INTO v_garage
    FROM garages g
    JOIN leagues l ON l.id = g.league_id
    WHERE g.id = NEW.garage_id;

    -- Get auction info
    SELECT * INTO v_auction
    FROM auctions
    WHERE auction_id = NEW.auction_id;

    -- Get username
    v_username := get_username(v_garage.user_id);

    -- Build message
    v_message := format(
        '%s just drafted: %s at %s',
        v_username,
        COALESCE(v_auction.title, v_auction.year || ' ' || v_auction.make || ' ' || v_auction.model),
        format_price(NEW.purchase_price)
    );

    -- Build metadata
    v_metadata := jsonb_build_object(
        'auction_id', NEW.auction_id,
        'car_title', COALESCE(v_auction.title, v_auction.year || ' ' || v_auction.make || ' ' || v_auction.model),
        'purchase_price', NEW.purchase_price,
        'image_url', v_auction.image_url,
        'user_id', v_garage.user_id,
        'username', v_username
    );

    -- Post system message
    PERFORM post_system_message(
        v_garage.league_id,
        'system_car_picked',
        v_message,
        v_metadata
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for car drafted
DROP TRIGGER IF EXISTS trigger_car_drafted ON garage_cars;
CREATE TRIGGER trigger_car_drafted
    AFTER INSERT ON garage_cars
    FOR EACH ROW
    EXECUTE FUNCTION notify_car_drafted();

-- =====================================================
-- STEP 11: Trigger function for SIGNIFICANT PRICE MOVEMENT
-- Fires when auction price changes by >15%
-- =====================================================
CREATE OR REPLACE FUNCTION notify_price_movement()
RETURNS TRIGGER AS $$
DECLARE
    v_league RECORD;
    v_percent_change NUMERIC;
    v_direction TEXT;
    v_emoji TEXT;
    v_message TEXT;
    v_metadata JSONB;
    v_old_price NUMERIC;
    v_new_price NUMERIC;
BEGIN
    -- Only process if current_bid changed
    IF OLD.current_bid IS NULL OR NEW.current_bid IS NULL THEN
        RETURN NEW;
    END IF;

    v_old_price := OLD.current_bid;
    v_new_price := NEW.current_bid;

    -- Calculate percent change
    IF v_old_price > 0 THEN
        v_percent_change := ((v_new_price - v_old_price) / v_old_price) * 100;
    ELSE
        RETURN NEW;
    END IF;

    -- Only notify if change is >15% (positive or negative)
    IF ABS(v_percent_change) < 15 THEN
        RETURN NEW;
    END IF;

    -- Determine direction
    IF v_percent_change > 0 THEN
        v_direction := 'jumped';
        v_emoji := '';
    ELSE
        v_direction := 'dropped';
        v_emoji := '';
    END IF;

    -- Find all leagues where this auction is in someone's garage
    FOR v_league IN
        SELECT DISTINCT l.id as league_id
        FROM garage_cars gc
        JOIN garages g ON g.id = gc.garage_id
        JOIN leagues l ON l.id = g.league_id
        WHERE gc.auction_id = NEW.auction_id
    LOOP
        -- Check cooldown (1 hour between price update notifications per auction per league)
        IF can_send_notification(NEW.auction_id, v_league.league_id, 'price_update_' || SIGN(v_percent_change)::TEXT, 1) THEN
            -- Build message
            v_message := format(
                '%s %s %s%%! Now at %s (was %s)',
                COALESCE(NEW.title, NEW.year || ' ' || NEW.make || ' ' || NEW.model),
                v_direction,
                ROUND(ABS(v_percent_change))::TEXT,
                format_price(v_new_price),
                format_price(v_old_price)
            );

            -- Build metadata
            v_metadata := jsonb_build_object(
                'auction_id', NEW.auction_id,
                'car_title', COALESCE(NEW.title, NEW.year || ' ' || NEW.make || ' ' || NEW.model),
                'old_price', v_old_price,
                'new_price', v_new_price,
                'percent_change', ROUND(v_percent_change, 1),
                'image_url', NEW.image_url
            );

            -- Post system message
            PERFORM post_system_message(
                v_league.league_id,
                'system_price_update',
                v_message,
                v_metadata
            );

            -- Record notification to prevent spam
            INSERT INTO auction_notifications (auction_id, league_id, notification_type)
            VALUES (NEW.auction_id, v_league.league_id, 'price_update_' || SIGN(v_percent_change)::TEXT)
            ON CONFLICT (auction_id, league_id, notification_type)
            DO UPDATE SET created_at = NOW();
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for price movement
DROP TRIGGER IF EXISTS trigger_price_movement ON auctions;
CREATE TRIGGER trigger_price_movement
    AFTER UPDATE OF current_bid ON auctions
    FOR EACH ROW
    WHEN (OLD.current_bid IS DISTINCT FROM NEW.current_bid)
    EXECUTE FUNCTION notify_price_movement();

-- =====================================================
-- STEP 12: Trigger function for AUCTION ENDED
-- Fires when auction status changes to sold or reserve not met
-- =====================================================
CREATE OR REPLACE FUNCTION notify_auction_ended()
RETURNS TRIGGER AS $$
DECLARE
    v_garage_car RECORD;
    v_username TEXT;
    v_percent_gain NUMERIC;
    v_message TEXT;
    v_metadata JSONB;
    v_car_title TEXT;
    v_is_big_win BOOLEAN;
BEGIN
    -- Only process if final_price was just set (auction ended)
    IF OLD.final_price IS NOT NULL OR NEW.final_price IS NULL THEN
        RETURN NEW;
    END IF;

    v_car_title := COALESCE(NEW.title, NEW.year || ' ' || NEW.make || ' ' || NEW.model);

    -- Find all garage_cars with this auction
    FOR v_garage_car IN
        SELECT
            gc.id,
            gc.garage_id,
            gc.purchase_price,
            g.user_id,
            g.league_id
        FROM garage_cars gc
        JOIN garages g ON g.id = gc.garage_id
        WHERE gc.auction_id = NEW.auction_id
    LOOP
        -- Check if we already notified for this auction in this league
        IF NOT can_send_notification(NEW.auction_id, v_garage_car.league_id, 'auction_ended', 24) THEN
            CONTINUE;
        END IF;

        -- Get username
        v_username := get_username(v_garage_car.user_id);

        -- Calculate percent gain
        IF v_garage_car.purchase_price > 0 THEN
            v_percent_gain := ((NEW.final_price - v_garage_car.purchase_price) / v_garage_car.purchase_price) * 100;
        ELSE
            v_percent_gain := 0;
        END IF;

        -- Check if this is a big win (>30% gain)
        v_is_big_win := v_percent_gain > 30;

        -- Build message for auction ended
        IF v_percent_gain >= 0 THEN
            v_message := format(
                '%s SOLD for %s! %s gains +%s%%',
                v_car_title,
                format_price(NEW.final_price),
                v_username,
                ROUND(v_percent_gain)::TEXT
            );
        ELSE
            v_message := format(
                '%s SOLD for %s! %s at %s%%',
                v_car_title,
                format_price(NEW.final_price),
                v_username,
                ROUND(v_percent_gain)::TEXT
            );
        END IF;

        -- Build metadata
        v_metadata := jsonb_build_object(
            'auction_id', NEW.auction_id,
            'car_title', v_car_title,
            'final_price', NEW.final_price,
            'purchase_price', v_garage_car.purchase_price,
            'percent_gain', ROUND(v_percent_gain, 1),
            'user_id', v_garage_car.user_id,
            'username', v_username,
            'image_url', NEW.image_url
        );

        -- Post auction ended message
        PERFORM post_system_message(
            v_garage_car.league_id,
            'system_auction_ended',
            v_message,
            v_metadata
        );

        -- If big win, also post a big win alert
        IF v_is_big_win THEN
            v_message := format(
                'BIG WIN! %s''s %s sold for +%s%% gain!',
                v_username,
                v_car_title,
                ROUND(v_percent_gain)::TEXT
            );

            PERFORM post_system_message(
                v_garage_car.league_id,
                'system_big_move',
                v_message,
                v_metadata
            );
        END IF;

        -- Record notification
        INSERT INTO auction_notifications (auction_id, league_id, notification_type)
        VALUES (NEW.auction_id, v_garage_car.league_id, 'auction_ended')
        ON CONFLICT (auction_id, league_id, notification_type)
        DO UPDATE SET created_at = NOW();
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for auction ended
DROP TRIGGER IF EXISTS trigger_auction_ended ON auctions;
CREATE TRIGGER trigger_auction_ended
    AFTER UPDATE OF final_price ON auctions
    FOR EACH ROW
    WHEN (OLD.final_price IS NULL AND NEW.final_price IS NOT NULL)
    EXECUTE FUNCTION notify_auction_ended();

-- =====================================================
-- STEP 13: Trigger function for RESERVE NOT MET
-- When auction ends without meeting reserve
-- =====================================================
CREATE OR REPLACE FUNCTION notify_reserve_not_met()
RETURNS TRIGGER AS $$
DECLARE
    v_garage_car RECORD;
    v_message TEXT;
    v_metadata JSONB;
    v_car_title TEXT;
    v_now_unix BIGINT;
BEGIN
    -- Get current unix timestamp
    v_now_unix := EXTRACT(EPOCH FROM NOW())::BIGINT;

    -- Check if auction just ended (timestamp_end just passed) and has no final_price
    -- This trigger assumes an external process sets a flag or we detect via timestamp
    -- For now, we'll rely on an UPDATE that changes some status field

    -- Only process if auction has ended (timestamp in past) and no final_price
    IF NEW.timestamp_end > v_now_unix OR NEW.final_price IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Check if we're being updated and the auction just ended
    IF OLD.timestamp_end = NEW.timestamp_end THEN
        -- No change to end time, might be a price update after end
        RETURN NEW;
    END IF;

    v_car_title := COALESCE(NEW.title, NEW.year || ' ' || NEW.make || ' ' || NEW.model);

    -- Find all garage_cars with this auction
    FOR v_garage_car IN
        SELECT
            gc.id,
            gc.garage_id,
            gc.purchase_price,
            g.user_id,
            g.league_id
        FROM garage_cars gc
        JOIN garages g ON g.id = gc.garage_id
        WHERE gc.auction_id = NEW.auction_id
    LOOP
        -- Check cooldown
        IF NOT can_send_notification(NEW.auction_id, v_garage_car.league_id, 'reserve_not_met', 24) THEN
            CONTINUE;
        END IF;

        -- Build message
        v_message := format(
            '%s - Reserve Not Met at %s',
            v_car_title,
            format_price(COALESCE(NEW.current_bid, 0))
        );

        -- Build metadata
        v_metadata := jsonb_build_object(
            'auction_id', NEW.auction_id,
            'car_title', v_car_title,
            'current_bid', NEW.current_bid,
            'image_url', NEW.image_url
        );

        -- Post system message
        PERFORM post_system_message(
            v_garage_car.league_id,
            'system_auction_ended',
            v_message,
            v_metadata
        );

        -- Record notification
        INSERT INTO auction_notifications (auction_id, league_id, notification_type)
        VALUES (NEW.auction_id, v_garage_car.league_id, 'reserve_not_met')
        ON CONFLICT (auction_id, league_id, notification_type)
        DO UPDATE SET created_at = NOW();
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 14: Function to check and notify ending soon auctions
-- This should be called by a cron job every 30 minutes
-- =====================================================
CREATE OR REPLACE FUNCTION notify_auctions_ending_soon()
RETURNS INTEGER AS $$
DECLARE
    v_auction RECORD;
    v_garage_car RECORD;
    v_message TEXT;
    v_metadata JSONB;
    v_car_title TEXT;
    v_hours_left NUMERIC;
    v_now_unix BIGINT;
    v_notifications_sent INTEGER := 0;
BEGIN
    v_now_unix := EXTRACT(EPOCH FROM NOW())::BIGINT;

    -- Find auctions ending within 4 hours
    FOR v_auction IN
        SELECT *
        FROM auctions
        WHERE timestamp_end > v_now_unix
          AND timestamp_end <= (v_now_unix + (4 * 60 * 60)) -- 4 hours
          AND final_price IS NULL
    LOOP
        v_car_title := COALESCE(v_auction.title, v_auction.year || ' ' || v_auction.make || ' ' || v_auction.model);
        v_hours_left := ROUND(((v_auction.timestamp_end - v_now_unix) / 3600.0)::NUMERIC, 1);

        -- Find all leagues where this auction is in someone's garage
        FOR v_garage_car IN
            SELECT DISTINCT g.league_id
            FROM garage_cars gc
            JOIN garages g ON g.id = gc.garage_id
            WHERE gc.auction_id = v_auction.auction_id
        LOOP
            -- Check if we already notified (only once per auction per league)
            IF NOT can_send_notification(v_auction.auction_id, v_garage_car.league_id, 'ending_soon', 24) THEN
                CONTINUE;
            END IF;

            -- Build message
            IF v_hours_left < 1 THEN
                v_message := format(
                    '%s ending in %s minutes! Currently at %s',
                    v_car_title,
                    ROUND(v_hours_left * 60)::TEXT,
                    format_price(COALESCE(v_auction.current_bid, 0))
                );
            ELSE
                v_message := format(
                    '%s ending in %s hours! Currently at %s',
                    v_car_title,
                    v_hours_left::TEXT,
                    format_price(COALESCE(v_auction.current_bid, 0))
                );
            END IF;

            -- Build metadata
            v_metadata := jsonb_build_object(
                'auction_id', v_auction.auction_id,
                'car_title', v_car_title,
                'current_bid', v_auction.current_bid,
                'hours_left', v_hours_left,
                'timestamp_end', v_auction.timestamp_end,
                'image_url', v_auction.image_url
            );

            -- Post system message
            PERFORM post_system_message(
                v_garage_car.league_id,
                'system_auction_ending',
                v_message,
                v_metadata
            );

            -- Record notification
            INSERT INTO auction_notifications (auction_id, league_id, notification_type)
            VALUES (v_auction.auction_id, v_garage_car.league_id, 'ending_soon')
            ON CONFLICT (auction_id, league_id, notification_type)
            DO UPDATE SET created_at = NOW();

            v_notifications_sent := v_notifications_sent + 1;
        END LOOP;
    END LOOP;

    RETURN v_notifications_sent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 15: Function to send user message with rate limiting
-- =====================================================
CREATE OR REPLACE FUNCTION send_chat_message(
    p_league_id UUID,
    p_user_id UUID,
    p_content TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_last_message TIMESTAMP WITH TIME ZONE;
    v_message_id UUID;
    v_username TEXT;
BEGIN
    -- Check if user is member of league
    IF NOT EXISTS (
        SELECT 1 FROM league_members
        WHERE league_id = p_league_id AND user_id = p_user_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a member of this league');
    END IF;

    -- Check rate limit (3 seconds between messages)
    SELECT last_message_at INTO v_last_message
    FROM league_members
    WHERE league_id = p_league_id AND user_id = p_user_id;

    IF v_last_message IS NOT NULL AND (NOW() - v_last_message) < INTERVAL '3 seconds' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please wait before sending another message');
    END IF;

    -- Get username for metadata
    v_username := get_username(p_user_id);

    -- Insert message
    INSERT INTO league_messages (league_id, user_id, message_type, content, metadata)
    VALUES (
        p_league_id,
        p_user_id,
        'user',
        p_content,
        jsonb_build_object('username', v_username)
    )
    RETURNING id INTO v_message_id;

    -- Update last_message_at for rate limiting
    UPDATE league_members
    SET last_message_at = NOW()
    WHERE league_id = p_league_id AND user_id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'message_id', v_message_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 16: Enable Realtime for league_messages
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE league_messages;

-- =====================================================
-- STEP 17: Grant necessary permissions
-- =====================================================
GRANT SELECT ON league_messages TO authenticated;
GRANT INSERT ON league_messages TO authenticated;
GRANT SELECT ON auction_notifications TO authenticated;

GRANT EXECUTE ON FUNCTION send_chat_message TO authenticated;
GRANT EXECUTE ON FUNCTION get_username TO authenticated;
GRANT EXECUTE ON FUNCTION format_price TO authenticated;

-- =====================================================
-- STEP 18: Function to notify reserve not met auctions
-- This should be called by a cron job after auctions end
-- =====================================================
CREATE OR REPLACE FUNCTION notify_reserve_not_met_auctions()
RETURNS INTEGER AS $$
DECLARE
    v_auction RECORD;
    v_garage_car RECORD;
    v_message TEXT;
    v_metadata JSONB;
    v_car_title TEXT;
    v_now_unix BIGINT;
    v_notifications_sent INTEGER := 0;
    v_username TEXT;
    v_percent_gain NUMERIC;
    v_effective_price NUMERIC;
BEGIN
    v_now_unix := EXTRACT(EPOCH FROM NOW())::BIGINT;

    -- Find auctions that have ended without a final_price (reserve not met)
    FOR v_auction IN
        SELECT *
        FROM auctions
        WHERE timestamp_end < v_now_unix  -- Auction has ended
          AND final_price IS NULL          -- Reserve was not met
          AND current_bid IS NOT NULL      -- Has a high bid
    LOOP
        v_car_title := COALESCE(v_auction.title, v_auction.year || ' ' || v_auction.make || ' ' || v_auction.model);

        -- Find all garage_cars with this auction and notify
        FOR v_garage_car IN
            SELECT
                gc.id,
                gc.garage_id,
                gc.purchase_price,
                g.user_id,
                g.league_id
            FROM garage_cars gc
            JOIN garages g ON g.id = gc.garage_id
            WHERE gc.auction_id = v_auction.auction_id
        LOOP
            -- Check if we already notified
            IF NOT can_send_notification(v_auction.auction_id, v_garage_car.league_id, 'reserve_not_met', 24) THEN
                CONTINUE;
            END IF;

            -- Get username
            v_username := get_username(v_garage_car.user_id);

            -- Calculate percent gain using 50% of high bid
            IF v_garage_car.purchase_price > 0 THEN
                v_effective_price := v_auction.current_bid * 0.5;
                v_percent_gain := ((v_effective_price - v_garage_car.purchase_price) / v_garage_car.purchase_price) * 100;
            ELSE
                v_percent_gain := 0;
            END IF;

            -- Build message with "High bid" instead of "SOLD"
            IF v_percent_gain >= 0 THEN
                v_message := format(
                    '%s high bid %s! %s gains +%s%% (50%% of high bid)',
                    v_car_title,
                    format_price(v_auction.current_bid),
                    v_username,
                    ROUND(v_percent_gain)::TEXT
                );
            ELSE
                v_message := format(
                    '%s high bid %s! %s at %s%% (50%% of high bid)',
                    v_car_title,
                    format_price(v_auction.current_bid),
                    v_username,
                    ROUND(v_percent_gain)::TEXT
                );
            END IF;

            -- Build metadata
            v_metadata := jsonb_build_object(
                'auction_id', v_auction.auction_id,
                'car_title', v_car_title,
                'high_bid', v_auction.current_bid,
                'purchase_price', v_garage_car.purchase_price,
                'percent_gain', ROUND(v_percent_gain, 1),
                'user_id', v_garage_car.user_id,
                'username', v_username,
                'image_url', v_auction.image_url,
                'reserve_not_met', true
            );

            -- Post system message
            PERFORM post_system_message(
                v_garage_car.league_id,
                'system_auction_ended',
                v_message,
                v_metadata
            );

            -- Record notification
            INSERT INTO auction_notifications (auction_id, league_id, notification_type)
            VALUES (v_auction.auction_id, v_garage_car.league_id, 'reserve_not_met')
            ON CONFLICT (auction_id, league_id, notification_type)
            DO UPDATE SET created_at = NOW();

            v_notifications_sent := v_notifications_sent + 1;
        END LOOP;
    END LOOP;

    RETURN v_notifications_sent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permission for the new function
GRANT EXECUTE ON FUNCTION notify_reserve_not_met_auctions TO authenticated;

-- =====================================================
-- DONE!
-- Run notify_auctions_ending_soon() via cron every 30 mins
-- Run notify_reserve_not_met_auctions() via cron every hour
-- =====================================================
