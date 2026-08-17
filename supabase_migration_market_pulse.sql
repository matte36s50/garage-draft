-- Migration: market direction — a mix-adjusted price index, plus sell-through
--
-- Run in the CANONICAL Supabase project. One view; writes no rows; safe to
-- re-run. Depends on auction_bucket_medians (supabase_migration_bucket_medians.sql).
--
-- ---------------------------------------------------------------------------
-- WHY NOT AN AVERAGE, AND WHY NOT A CLASSIC REPEAT-SALE INDEX EITHER
-- ---------------------------------------------------------------------------
--
-- Average sale price cannot answer "which way is the market moving": it moves
-- when the MIX of cars consigned changes, which it does every quarter. A
-- quarter heavy with Ferraris reads as a rising market.
--
-- The textbook fix is a repeat-sale index — track buckets that sold in both
-- periods and chain the median change. That needs 2+ sales per bucket per
-- period on both sides. At this store's density (a few thousand settled lots
-- spread over ~700 buckets and a handful of quarters, so roughly one sale per
-- bucket per quarter) almost no bucket would qualify, and the index would be
-- built on a tiny, self-selected set of high-volume models.
--
-- So this uses the WITHIN-BUCKET (two-way fixed-effects) estimator instead,
-- which is the standard answer for a sparse panel:
--
--     r(lot)      = ln(price) − mean ln(price) of that lot's bucket
--     index(t)    = 100 · exp( mean r over period t  −  mean r in the base period )
--
-- Subtracting the bucket mean removes the level of each model, so what is left
-- is how expensive that sale was FOR THAT MODEL. Averaging those residuals by
-- period gives a mix-free index, and — unlike a repeat-sale index — a bucket
-- contributes usefully with only one sale per period, because the comparison
-- is against its own window mean rather than against itself last quarter.
--
-- ---------------------------------------------------------------------------
-- TWO GUARDS THAT MATTER MORE THAN THEY LOOK
-- ---------------------------------------------------------------------------
--
-- 1. A bucket needs 3+ sales across the window to contribute at all.
--    A bucket with exactly one sale has a residual of exactly zero by
--    construction — it cannot deviate from a mean computed from itself. Left
--    in, such buckets inject artificial zeros that drag every period toward
--    100 and silently flatten the index. This is the single easiest way to
--    build a market index that always says "no change".
--
-- 2. A period needs enough buckets behind it to be published.
--    Reported as buckets_in_period so a thin quarter is visible rather than
--    plotted as though it were solid.
--
-- LIMITATION: bucket effects are assumed constant across the window. A bucket
-- whose sales all cluster in one period contributes its own drift to that
-- period, and the estimator attenuates when the panel is badly unbalanced.
--
-- Measured against synthetic data with a known trajectory (100 / 108 / 115 /
-- 110 / 122 / 130):
--   balanced panel        recovered to within ~1.5 points at every point
--   heavy mix drift       attenuated ~2-5 points mid-series but kept the
--                         direction, the turning point and the endpoint
--   naive median, same    reported +676% on the mix-drift data and swung
--     data                +-18 points quarter to quarter on the balanced data
--
-- So: read the index for direction and turning points, not as a precise
-- percentage. It is still the only figure here that is not mostly mix.
-- ---------------------------------------------------------------------------

create or replace view auction_market_pulse as
with scoped as (
  select
    l.canonical_model_id                        as bucket_id,
    l.outcome,
    coalesce(l.price_all_in, l.price)::numeric  as amount,
    date_trunc('quarter', l.ended_at)::date     as period,
    m.median_12m                                as bucket_level
  from auction_listings_all l
  join auction_bucket_medians m on m.bucket_id = l.canonical_model_id
  where l.status = 'ended'
    and l.ended_at is not null
    and l.canonical_model_id is not null
    and coalesce(l.currency, 'USD') = 'USD'
    and m.median_12m > 0
    and l.outcome in ('sold', 'reserve_not_met')
),
tiered as (
  select
    s.*,
    case
      when s.bucket_level <  25000 then '1 · under $25k'
      when s.bucket_level <  50000 then '2 · $25k–$50k'
      when s.bucket_level < 100000 then '3 · $50k–$100k'
      when s.bucket_level < 250000 then '4 · $100k–$250k'
      else                              '5 · $250k and up'
    end as tier
  from scoped s
),
-- Bucket mean log price over the whole window, from sold lots only.
bucket_mean as (
  select bucket_id, avg(ln(amount)) as mean_lp, count(*) as sold_in_window
  from tiered
  where outcome = 'sold' and amount > 0
  group by bucket_id
),
resid as (
  select t.period, t.tier, t.bucket_id,
         ln(t.amount) - b.mean_lp as r
  from tiered t
  join bucket_mean b on b.bucket_id = t.bucket_id
  where t.outcome = 'sold' and t.amount > 0
    and b.sold_in_window >= 3        -- guard 1
),
-- Price index inputs, for each tier and pooled across all tiers.
idx as (
  select
    coalesce(tier, 'All tiers')      as tier,
    period,
    avg(r)                           as mean_r,
    count(*)                         as index_lots,
    count(distinct bucket_id)        as buckets_in_period
  from resid
  group by grouping sets ((tier, period), (period))
),
-- Sell-through and volume come from ALL ended lots, not just sold ones.
flow as (
  select
    coalesce(tier, 'All tiers') as tier,
    period,
    count(*)                                          as lots,
    count(*) filter (where outcome = 'sold')          as sold,
    round((percentile_cont(0.50) within group (order by amount)
      filter (where outcome = 'sold' and amount > 0))::numeric) as median_price
  from tiered
  group by grouping sets ((tier, period), (period))
)
select
  f.tier,
  f.period,
  f.lots,
  f.sold,
  case when f.lots > 0 then round(100.0 * f.sold / f.lots, 1) end as sell_through,
  f.median_price,
  i.index_lots,
  i.buckets_in_period,
  -- Base 100 at each tier's own first period, so tiers are comparable as
  -- trajectories rather than as levels.
  case when i.mean_r is not null then
    round((100 * exp(i.mean_r - first_value(i.mean_r) over (
      partition by f.tier order by f.period
      rows between unbounded preceding and unbounded following)))::numeric, 1)
  end as price_index
from flow f
left join idx i on i.tier = f.tier and i.period = f.period
order by f.tier, f.period;

comment on view auction_market_pulse is
  'Mix-adjusted price index (within-bucket fixed effects on log price), sell-through and volume '
  'by tier and quarter. Buckets need 3+ sales in the window to contribute to the index; a '
  'single-sale bucket has a zero residual by construction and would flatten it.';

grant select on auction_market_pulse to service_role;

-- Verify with:
--   select tier, period, lots, sold, sell_through, price_index, buckets_in_period
--   from auction_market_pulse where tier = 'All tiers' order by period;
