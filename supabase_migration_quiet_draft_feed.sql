-- =====================================================
-- Migration: no pick announcements while a draft is open
-- Run in the GAME Supabase project, SQL Editor. Safe to re-run.
-- (Applied to the live database on 2026-11-16.)
-- =====================================================
--
-- WHY: the Pick screen says rivals' picks are hidden until the draft closes,
-- but the trigger on garage_cars posted "<player> just drafted: <car> at
-- <price>" to the event feed on every pick (671 such posts so far). That is
-- unfair to whoever drafts first, and it spoils the picks as research data,
-- which is only worth something when each player chose without seeing the
-- others.
--
-- The trigger now stays quiet while the event's draft is open. Draft times are
-- stored without a zone and mean UTC.
--
-- NOT covered here: other players' picks can still be read straight from the
-- garage_cars table during a draft ("Anyone can read drafted cars"), and the
-- Ranks screen reads them to total each player's garage. Closing that needs a
-- policy change and a Ranks change shipped together.

CREATE OR REPLACE FUNCTION public.notify_car_drafted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_garage RECORD;
    v_auction RECORD;
    v_username TEXT;
    v_message TEXT;
    v_metadata JSONB;
BEGIN
    -- Get garage info (includes user_id and league_id)
    SELECT g.*, l.id as league_id, l.name as league_name, l.draft_ends_at as draft_ends_at
    INTO v_garage
    FROM garages g
    JOIN leagues l ON l.id = g.league_id
    WHERE g.id = NEW.garage_id;

    -- Rivals' picks stay hidden until the draft closes: say nothing while it is open.
    IF v_garage.draft_ends_at IS NULL OR v_garage.draft_ends_at > (now() AT TIME ZONE 'utc') THEN
        RETURN NEW;
    END IF;

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
$function$;

-- Check (in a transaction you roll back): insert a garage_cars row for a garage
-- in an event whose draft is open and confirm league_messages gains no row;
-- repeat for an event whose draft has closed and confirm it gains one.
