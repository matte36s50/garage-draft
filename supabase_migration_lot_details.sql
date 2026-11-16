-- =====================================================
-- Migration: lot details the player needs when choosing
-- Run in the GAME Supabase project, SQL Editor. Safe to re-run.
-- (Applied to the live database on 2026-11-15.)
-- =====================================================
--
-- WHY: a no-sale costs a player most of a car's value, yet nothing on a card
-- said whether a lot had a reserve, and catalogue lots showed no estimate.
-- These columns carry both. All are nullable: NULL means "not known", which is
-- the case for every row that existed before this migration. BaT listings that
-- start "No Reserve:" are recognised from the title by the app.
--
-- The lock-down migration grants SELECT on the whole auctions table, so the
-- new columns are readable by players without further grants.

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS estimate_low NUMERIC;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS estimate_high NUMERIC;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS no_reserve BOOLEAN;

COMMENT ON COLUMN auctions.estimate_low IS 'Catalogue low estimate (live-auction lots). NULL when unknown or not applicable.';
COMMENT ON COLUMN auctions.estimate_high IS 'Catalogue high estimate (live-auction lots). NULL when unknown or not applicable.';
COMMENT ON COLUMN auctions.no_reserve IS 'TRUE when the lot is offered without reserve, FALSE when it has one, NULL when unknown.';

-- Check:
--   SELECT count(*) FILTER (WHERE no_reserve) AS no_reserve,
--          count(*) FILTER (WHERE estimate_low IS NOT NULL) AS with_estimate
--   FROM auctions;
