-- =====================================================
-- Enforce $100,000 Garage Minimum Migration
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Add a check constraint to ensure future leagues meet the minimum
-- Note: This will prevent any NEW leagues from being created with < $100k
-- Existing leagues are NOT affected
ALTER TABLE leagues
DROP CONSTRAINT IF EXISTS leagues_spending_limit_minimum;

ALTER TABLE leagues
ADD CONSTRAINT leagues_spending_limit_minimum
CHECK (spending_limit >= 100000)
NOT VALID;  -- NOT VALID means existing rows are not checked, only new/updated rows

-- Validate only new rows going forward
-- This allows existing leagues to remain unchanged
ALTER TABLE leagues
VALIDATE CONSTRAINT leagues_spending_limit_minimum;

-- Add comment for documentation
COMMENT ON CONSTRAINT leagues_spending_limit_minimum ON leagues
IS 'Ensures all NEW leagues have a minimum spending limit of $100,000. Existing leagues are grandfathered in.';

-- View current leagues to verify
SELECT
  id,
  name,
  spending_limit,
  created_at
FROM leagues
ORDER BY spending_limit ASC
LIMIT 10;
