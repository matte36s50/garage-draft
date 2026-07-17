-- Migration: Add engagement-stat columns (MII components) to auctions table
--
-- WHY: The Market Interest Index (MII) is computed from per-listing engagement
-- — bids, views, comments (plus sale amount) — and BaT also publishes watcher
-- counts on live listings. Today the game's `auctions` table only stores
-- prices, so every listing mirrored from it into the canonical auction store
-- shows "—" for bids/views/comments/watchers. These columns let the finalizer
-- and the /api/scrape/* ingest routes persist those stats where the source
-- page provides them; they stay NULL where it doesn't.
--
-- Run this in your Supabase SQL Editor (the GAME project, i.e. the one
-- NEXT_PUBLIC_SUPABASE_URL points at).

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bid_count INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS views INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS watchers INTEGER;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS comments INTEGER;

-- Success!
-- After running this migration, deploy the updated finalize-auctions and
-- scrape routes so scraped engagement stats are stored and mirrored to the
-- canonical auction store.
