-- =====================================================
-- Per-League Spending Limits Migration
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Add spending_limit column to leagues table
-- Default to 200000 (current hardcoded value) for existing leagues
ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS spending_limit INTEGER DEFAULT 200000 NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN leagues.spending_limit IS 'Maximum budget each player gets when joining this league (in dollars)';
