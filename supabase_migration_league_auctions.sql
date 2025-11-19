-- Migration: Add manual auction selection for leagues
-- Run this in your Supabase SQL Editor

-- 1. Add use_manual_auctions flag to leagues table
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS use_manual_auctions BOOLEAN DEFAULT FALSE;

-- 2. Create league_auctions table to store manually selected auctions for leagues
CREATE TABLE IF NOT EXISTS league_auctions (
  id BIGSERIAL PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  auction_id TEXT NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
  custom_end_date BIGINT, -- Unix timestamp for custom auction end date (optional)
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(league_id, auction_id)
);

-- 3. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_league_auctions_league_id ON league_auctions(league_id);
CREATE INDEX IF NOT EXISTS idx_league_auctions_auction_id ON league_auctions(auction_id);

-- 4. Add RLS policies for league_auctions (allow public read, admin write)
ALTER TABLE league_auctions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to league_auctions"
  ON league_auctions FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated users to insert league_auctions"
  ON league_auctions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete league_auctions"
  ON league_auctions FOR DELETE
  USING (true);

-- Success!
-- Now you can manually select auctions for specific leagues
