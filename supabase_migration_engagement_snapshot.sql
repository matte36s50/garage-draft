-- Migration: latch engagement BEFORE the auction closes
--
-- Run in the GAME project (NEXT_PUBLIC_SUPABASE_URL) — the one that owns the
-- `auctions` table. This is NOT the canonical project the analytics migrations
-- target.
--
-- WHY: the Demand Signals board can currently only be descriptive. `watchers`
-- is captured by finalize-auctions when the auction ENDS, so it is a closing
-- count — a lot accumulates watchers partly BECAUSE it is bidding up. Using it
-- to predict the sale price is therefore circular, and any correlation it shows
-- is an upper bound rather than a forecast.
--
-- A count taken while the auction is still running does not have that problem.
-- These columns hold that snapshot, latched once and never overwritten, so the
-- closing value in `watchers` stays available alongside it.
--
-- This is forward-only. Nothing can reconstruct what a watcher count was two
-- months ago, so the useful history starts the day the cron starts running —
-- which is the argument for turning it on before there is anything to analyse.

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS watchers_at_48h  INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS views_at_48h     INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bid_count_at_48h INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS comments_at_48h  INTEGER;

-- When the latch fired. Together with timestamp_end this gives the exact lead
-- time, so analysis can control for a snapshot taken later than intended
-- rather than assuming every row is exactly 48h out.
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS engagement_snapshot_at TIMESTAMPTZ;

-- The cron scans for live auctions inside the snapshot window that have not
-- been latched yet; this keeps that scan cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_auctions_snapshot_pending
  ON auctions (timestamp_end)
  WHERE engagement_snapshot_at IS NULL;

-- Success.
-- Next: schedule GET /api/cron/snapshot-engagement (every 30-60 min) on the
-- same external cron service as finalize-auctions. Verify with:
--
--   select count(*) filter (where engagement_snapshot_at is not null) as latched,
--          count(*) filter (where watchers_at_48h is not null)        as with_watchers
--   from auctions
--   where timestamp_end > extract(epoch from now() - interval '30 days');
