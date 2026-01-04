-- Migration: Add auction_reference field to auctions table
-- This field allows grouping auctions by their parent auction event
-- (e.g., "RM Arizona Car Week", "Mecum Kissimmee 2025")
-- Run this in your Supabase SQL Editor

-- 1. Add auction_reference column to auctions table
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS auction_reference TEXT;

-- 2. Create index for faster filtering by auction_reference
CREATE INDEX IF NOT EXISTS idx_auctions_auction_reference ON auctions(auction_reference);

-- 3. Optional: Add a comment to describe the column
COMMENT ON COLUMN auctions.auction_reference IS 'Parent auction event name (e.g., RM Arizona Car Week)';

-- Success!
-- Now you can group auctions by their parent auction event
