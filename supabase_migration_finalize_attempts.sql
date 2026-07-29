-- Retire auctions the finalizer can never parse.
--
-- /api/cron/finalize-auctions selects up to 200 rows with final_price IS NULL
-- and re-scrapes every one on every run. Nothing ever removes a row that cannot
-- be parsed — a withdrawn lot, a Cloudflare block, a markup change — so the
-- unparseable rows accumulate, saturate the 200-row limit and are fetched and
-- regex-scanned again on every run, forever. That treadmill was the bulk of the
-- project's Vercel Fluid Active CPU.
--
-- finalize_attempts counts consecutive failed finalization passes. The cron
-- skips rows past MAX_FINALIZE_ATTEMPTS and orders by attempts ascending, so
-- freshly ended auctions are always tried before the stuck backlog.
--
-- Safe to re-run.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS finalize_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_finalize_attempt TIMESTAMPTZ;

-- Partial index matching the finalizer's query shape: only unfinalized rows are
-- ever ordered by this, and that set should shrink to near zero once the
-- backlog retires.
CREATE INDEX IF NOT EXISTS idx_auctions_finalize_queue
  ON auctions (finalize_attempts, timestamp_end DESC)
  WHERE final_price IS NULL;

-- One statement per run instead of one UPDATE per pending row. The finalizer
-- targets rows by auction_id, falling back to url for legacy rows inserted
-- without one (the same rule as its eqAuction helper).
CREATE OR REPLACE FUNCTION public.bump_finalize_attempts(
  p_ids  TEXT[] DEFAULT '{}',
  p_urls TEXT[] DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE auctions
     SET finalize_attempts     = COALESCE(finalize_attempts, 0) + 1,
         last_finalize_attempt = NOW()
   WHERE (auction_id IS NOT NULL AND auction_id = ANY(p_ids))
      OR (auction_id IS NULL     AND url        = ANY(p_urls));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_finalize_attempts(TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_finalize_attempts(TEXT[], TEXT[]) TO service_role;

-- Rows that resolve later (a human sets a price, or a re-check succeeds) should
-- start over rather than inherit a spent budget.
CREATE OR REPLACE FUNCTION public.reset_finalize_attempts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.final_price IS NOT NULL AND OLD.final_price IS NULL THEN
    NEW.finalize_attempts := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_finalize_attempts ON auctions;
CREATE TRIGGER trg_reset_finalize_attempts
  BEFORE UPDATE ON auctions
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_finalize_attempts();

-- Inspect what has been retired:
--   SELECT auction_id, title, url, finalize_attempts, last_finalize_attempt
--     FROM auctions
--    WHERE final_price IS NULL AND finalize_attempts >= 12
--    ORDER BY last_finalize_attempt DESC;
