-- Migration: does watcher count predict what a lot sells for?
--
-- Run in the CANONICAL Supabase project. Creates two views; writes no rows;
-- safe to re-run. Depends on auction_bucket_medians
-- (supabase_migration_bucket_medians.sql).
--
-- ---------------------------------------------------------------------------
-- Four decisions that make this measure the thing it claims to measure
-- ---------------------------------------------------------------------------
--
-- 1. THE OUTCOME IS PRICE ÷ THE LOT'S BUCKET MEDIAN, never price ÷ estimate.
--    BaT and Cars & Bids publish no estimate, and they are where essentially
--    all the watcher data comes from. An estimate ratio would silently
--    restrict this to ~3% of ended lots.
--
-- 2. DECILES ARE RANKED WITHIN PRICE BAND AND QUARTER, not globally.
--    Dividing by the bucket median already removes the price LEVEL, so
--    ranking globally would not by itself invent a price effect. What it
--    would do is make every decile a different set of cars: measured on real
--    data shapes, a global bottom decile runs ~80% cheapest-bucket and the
--    top decile ~100% dearest-bucket. Each decile would then carry a
--    different model mix, and any model-specific bias in the ratio would
--    read as a watcher effect. Partitioning keeps the mix comparable across
--    deciles, and the quarter term stops BaT's traffic growth from doing the
--    same thing over time.
--
-- 3. THE BAND COMES FROM THE BUCKET'S MEDIAN, NOT THE LOT'S OWN PRICE.
--    Banding by realized price would leak the outcome into the grouping: a
--    lot that sold high would be pushed into a higher band, which is exactly
--    the variable under test. The bucket median is a property of the model,
--    known before the hammer falls.
--
-- 4. ONLY LOTS FROM THE LAST 12 MONTHS.
--    median_12m is a trailing-12-month figure. Comparing a lot that sold 20
--    months ago against today's median would score market drift as a watcher
--    effect. Matching the windows costs sample size and buys meaning.
--
-- ---------------------------------------------------------------------------
-- THE BIAS THIS CANNOT FIX, and which the UI states plainly
-- ---------------------------------------------------------------------------
-- finalize-auctions scrapes watchers when the auction ENDS. That is a closing
-- count, and a lot accumulates watchers *because* it is bidding up — so the
-- watcher number is partly an effect of the outcome it is being used to
-- predict. Any correlation here is therefore an upper bound.
--
-- The fix is forward-only and cheap: snapshot watchers at a fixed point before
-- close (T-48h pairs naturally with the existing price_at_48h) into its own
-- column. Until that exists, this view is descriptive, not predictive.
-- ---------------------------------------------------------------------------

create or replace view auction_watcher_deciles as
with base as (
  select
    l.id,
    l.watchers,
    l.outcome,
    coalesce(l.price_all_in, l.price)::numeric as amount,
    m.median_12m                               as bucket_median,
    date_trunc('quarter', l.ended_at)          as q,
    case
      when m.median_12m <  25000 then '1 · under $25k'
      when m.median_12m <  50000 then '2 · $25k–$50k'
      when m.median_12m < 100000 then '3 · $50k–$100k'
      when m.median_12m < 250000 then '4 · $100k–$250k'
      else                            '5 · $250k and up'
    end as band
  from auction_listings_all l
  join auction_bucket_medians m on m.bucket_id = l.canonical_model_id
  where l.status = 'ended'
    and l.watchers is not null
    and l.canonical_model_id is not null
    and l.ended_at is not null
    and l.ended_at >= now() - interval '12 months'
    and coalesce(l.currency, 'USD') = 'USD'
    and l.outcome in ('sold', 'reserve_not_met')
    and m.median_12m > 0
    -- A bucket needs enough sales that its median is a market level rather
    -- than an echo of the very lot being scored against it.
    and m.sold_12m >= 4
),
ranked as (
  select
    b.*,
    ntile(10) over (partition by b.band, b.q order by b.watchers) as decile,
    count(*)  over (partition by b.band, b.q)                     as group_n
  from base b
)
select
  r.decile,
  count(*)                                            as lots,
  count(*) filter (where r.outcome = 'sold')          as sold,
  round(100.0 * count(*) filter (where r.outcome = 'sold')
        / nullif(count(*), 0), 1)                     as sell_through,
  round((percentile_cont(0.50) within group (order by r.amount / r.bucket_median)
    filter (where r.outcome = 'sold' and r.amount > 0))::numeric, 3) as median_ratio,
  round(avg(r.watchers))                              as avg_watchers,
  min(r.watchers)                                     as min_watchers,
  max(r.watchers)                                     as max_watchers
from ranked r
-- ntile(10) over a 12-row partition does not produce deciles, it produces
-- twelve groups of one or two. Require a real population per partition.
where r.group_n >= 20
group by r.decile
order by r.decile;

comment on view auction_watcher_deciles is
  'Sale outcome by watcher decile, deciles ranked within (price band, quarter) so neither price '
  'level nor traffic growth can masquerade as a demand signal. Outcome is price / bucket median. '
  'Watchers are a CLOSING count, so treat this as descriptive rather than predictive.';


-- ---------------------------------------------------------------------------
-- Coverage: what the deciles are built on, and what fell out on the way.
-- Exists so the tab can show the reader the size and shape of the sample
-- rather than only the conclusion drawn from it.
-- ---------------------------------------------------------------------------

create or replace view auction_watcher_coverage as
with ended as (
  select
    l.id, l.watchers, l.canonical_model_id, l.outcome, l.ended_at,
    m.median_12m, m.sold_12m
  from auction_listings_all l
  left join auction_bucket_medians m on m.bucket_id = l.canonical_model_id
  where l.status = 'ended'
    and l.ended_at is not null
    and l.ended_at >= now() - interval '12 months'
    and coalesce(l.currency, 'USD') = 'USD'
)
select
  count(*)                                                        as ended_12m,
  count(*) filter (where watchers is null)                        as no_watchers,
  count(*) filter (where watchers is not null
                     and canonical_model_id is null)              as no_bucket,
  count(*) filter (where watchers is not null
                     and canonical_model_id is not null
                     and coalesce(sold_12m, 0) < 4)               as thin_bucket,
  count(*) filter (where watchers is not null
                     and canonical_model_id is not null
                     and coalesce(sold_12m, 0) >= 4
                     and median_12m > 0
                     and outcome in ('sold', 'reserve_not_met'))  as in_scope,
  count(distinct canonical_model_id) filter (
        where watchers is not null and coalesce(sold_12m, 0) >= 4) as buckets_in_scope,
  count(distinct date_trunc('quarter', ended_at))                 as quarters
from ended;

comment on view auction_watcher_coverage is
  'Population behind auction_watcher_deciles, with the reason each excluded group fell out.';


grant select on auction_watcher_deciles  to service_role;
grant select on auction_watcher_coverage to service_role;

-- Verify with:
--   select * from auction_watcher_coverage;
--   select decile, lots, sold, sell_through, median_ratio, avg_watchers
--   from auction_watcher_deciles order by decile;
