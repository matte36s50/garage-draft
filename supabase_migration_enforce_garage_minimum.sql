-- =====================================================
-- Enforce $100,000 Garage Minimum Migration
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Update any existing leagues with spending_limit below $100,000
-- to meet the new minimum requirement
UPDATE leagues
SET spending_limit = 100000
WHERE spending_limit < 100000;

-- Update any existing garages associated with those leagues
-- to have at least $100,000 remaining budget
UPDATE garages
SET remaining_budget = GREATEST(remaining_budget, 100000)
WHERE league_id IN (
  SELECT id FROM leagues WHERE spending_limit = 100000
);

-- Add a check constraint to ensure future leagues meet the minimum
-- Note: This will prevent any new leagues from being created with < $100k
ALTER TABLE leagues
DROP CONSTRAINT IF EXISTS leagues_spending_limit_minimum;

ALTER TABLE leagues
ADD CONSTRAINT leagues_spending_limit_minimum
CHECK (spending_limit >= 100000);

-- Add comment for documentation
COMMENT ON CONSTRAINT leagues_spending_limit_minimum ON leagues
IS 'Ensures all leagues have a minimum spending limit of $100,000';

-- Verify the changes
SELECT
  id,
  name,
  spending_limit,
  created_at
FROM leagues
ORDER BY spending_limit ASC
LIMIT 10;
