-- Migration: Add reserve_not_met column to auctions table
-- Tracks auctions that have been explicitly confirmed as "reserve not met"
-- so they are permanently removed from the admin Finalize tab.
--
-- WHY: When an admin clicks "Reserve Not Met" (or the auto-scraper detects
-- no_sale), the auction must be flagged in the DB. Without this, the auction
-- keeps reappearing in the Finalize tab on every refresh because its
-- final_price remains NULL and the query filters on `final_price IS NULL`.
--
-- Scoring is unaffected: scoreCalculation.js already handles reserve_not_met
-- via the `auctionEnded && finalPrice === null` branch.
--
-- Run this in your Supabase SQL Editor.

-- 1. Add reserve_not_met column (defaults to false for all existing rows)
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS reserve_not_met BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Index for efficient filtering in the Finalize tab query
CREATE INDEX IF NOT EXISTS idx_auctions_reserve_not_met ON auctions(reserve_not_met);

-- Success!
-- After running this migration, deploy the updated AdminPortal.jsx and
-- finalize-auctions/route.js so the application uses the new column.
